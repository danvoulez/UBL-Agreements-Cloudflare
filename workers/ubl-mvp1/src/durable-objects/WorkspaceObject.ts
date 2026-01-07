/**
 * UBL MVP-1 WorkspaceObject Durable Object
 *
 * Manages workspace state for Office functionality:
 * - Workspace configuration
 * - Document storage and management
 * - Search functionality
 *
 * Storage keys:
 * - config: JSON blob (Workspace config)
 * - documents: JSON blob (map document_id → Document)
 *
 * Per Blueprint:
 * - Workspace is a Container that holds Documents
 * - All operations emit action.v1 + effect.v1 to LedgerShard
 * - Reference WorkspaceAgreement in action.v1.agreement_id
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  Identity,
  Document,
  WorkspaceConfig,
  CreateDocumentInput,
  SearchDocumentsInput,
  Receipt,
  ActionAtom,
  EffectAtom,
  DORequest,
  RoomMember,
} from '../types';
import {
  generateDocumentId,
  generateRequestId,
  computeContentHash,
} from '../utils/hash';
import {
  createWorkspaceAgreement,
  storeAgreement,
  getWorkspaceAgreementId,
} from '../utils/agreements';

export class WorkspaceObject extends DurableObject<Env> {
  private config: WorkspaceConfig | null = null;
  private documents: Map<string, Document> = new Map();
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initializes the DO by loading state from storage.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const [config, documents] = await Promise.all([
      this.ctx.storage.get<WorkspaceConfig>('config'),
      this.ctx.storage.get<Record<string, Document>>('documents'),
    ]);

    this.config = config || null;
    this.documents = new Map(Object.entries(documents || {}));
    this.initialized = true;
  }

  /**
   * Saves config to storage.
   */
  private async saveConfig(): Promise<void> {
    if (this.config) {
      await this.ctx.storage.put('config', this.config);
    }
  }

  /**
   * Saves documents to storage.
   */
  private async saveDocuments(): Promise<void> {
    const docsObj = Object.fromEntries(this.documents);
    await this.ctx.storage.put('documents', docsObj);
  }

  /**
   * Initializes the workspace with given configuration.
   */
  async initWorkspace(
    workspaceId: string,
    tenantId: string,
    name: string,
    creatorId: string
  ): Promise<void> {
    await this.initialize();

    if (this.config) {
      return; // Already initialized
    }

    const now = new Date().toISOString();

    this.config = {
      workspace_id: workspaceId,
      tenant_id: tenantId,
      name,
      created_at: now,
      created_by: creatorId,
      members: {
        [creatorId]: {
          role: 'owner',
          joined_at: now,
        },
      },
      documents: [],
    };

    await this.saveConfig();

    // Store WorkspaceAgreement in D1
    const agreement = createWorkspaceAgreement(workspaceId, tenantId, creatorId);
    try {
      await storeAgreement(this.env.D1_LEDGER, agreement);
    } catch (error) {
      console.error('Failed to store workspace agreement:', error);
    }
  }

  /**
   * Asserts that the identity is a member of the workspace.
   * Auto-adds members in MVP-1 frictionless mode.
   */
  private assertMember(identity: Identity): void {
    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    if (!this.config.members[identity.user_id]) {
      const now = new Date().toISOString();
      this.config.members[identity.user_id] = {
        role: 'member',
        joined_at: now,
      };
      this.saveConfig().catch(console.error);
    }
  }

  /**
   * Appends an atom to the ledger and returns the receipt.
   */
  private async appendToLedger(
    actionAtom: Omit<ActionAtom, 'cid' | 'prev_hash'>,
    when: string,
    documentId: string
  ): Promise<Receipt> {
    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    const ledgerKey = `${this.config.tenant_id}|ledger|0`;
    const ledgerDO = this.env.LEDGER_SHARD_OBJECT.idFromName(ledgerKey);
    const ledgerStub = this.env.LEDGER_SHARD_OBJECT.get(ledgerDO);

    // Append action atom
    const actionResponse = await ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: actionAtom },
        identity: { user_id: actionAtom.who.user_id, email: actionAtom.who.email },
        request_id: actionAtom.trace.request_id,
      }),
    }));

    const actionResult = await actionResponse.json() as { success: boolean; data?: { receipt: Receipt; cid: string } };
    if (!actionResult.success || !actionResult.data) {
      throw new Error('Failed to append action atom');
    }

    const actionReceipt = actionResult.data.receipt;
    const actionCid = actionResult.data.cid;

    // Create and append effect atom
    const effectAtom: Omit<EffectAtom, 'cid'> = {
      kind: 'effect.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      ref_action_cid: actionCid,
      when,
      outcome: 'ok',
      effects: [
        {
          op: 'document.create',
          workspace_id: this.config.workspace_id,
          document_id: documentId,
        },
      ],
      pointers: {
        document_id: documentId,
      },
    };

    await ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: effectAtom },
        identity: { user_id: actionAtom.who.user_id, email: actionAtom.who.email },
        request_id: actionAtom.trace.request_id,
      }),
    }));

    return actionReceipt;
  }

  /**
   * Creates a new document in the workspace.
   */
  async createDocument(
    input: CreateDocumentInput,
    identity: Identity,
    requestId: string
  ): Promise<Document> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    this.assertMember(identity);

    const now = new Date().toISOString();
    const documentId = generateDocumentId();
    const contentHash = await computeContentHash(input.content);

    // Create action atom
    const actionAtom: Omit<ActionAtom, 'cid' | 'prev_hash'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      prev_hash: '',
      when: now,
      who: {
        user_id: identity.user_id,
        email: identity.email,
      },
      did: 'office.document.create',
      this: {
        workspace_id: this.config.workspace_id,
        document_id: documentId,
        content_hash: contentHash,
      },
      agreement_id: getWorkspaceAgreementId(this.config.workspace_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Append to ledger
    const receipt = await this.appendToLedger(actionAtom, now, documentId);

    // Create document
    const document: Document = {
      document_id: documentId,
      workspace_id: this.config.workspace_id,
      tenant_id: this.config.tenant_id,
      title: input.title,
      content: input.content,
      content_hash: contentHash,
      created_at: now,
      created_by: identity.user_id,
      updated_at: now,
      version: 1,
      receipt,
    };

    // Store document
    this.documents.set(documentId, document);
    this.config.documents.push(documentId);
    await Promise.all([this.saveDocuments(), this.saveConfig()]);

    return document;
  }

  /**
   * Gets a document by ID.
   */
  async getDocument(
    documentId: string,
    identity: Identity,
    requestId: string
  ): Promise<Document | null> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    this.assertMember(identity);

    const document = this.documents.get(documentId);
    if (!document) {
      return null;
    }

    // Emit action.v1 for the read operation
    const now = new Date().toISOString();
    const actionAtom: Omit<ActionAtom, 'cid' | 'prev_hash'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      prev_hash: '',
      when: now,
      who: {
        user_id: identity.user_id,
        email: identity.email,
      },
      did: 'office.document.get',
      this: {
        workspace_id: this.config.workspace_id,
        document_id: documentId,
      },
      agreement_id: getWorkspaceAgreementId(this.config.workspace_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Fire and forget - don't wait for ledger append for reads
    this.appendToLedger(actionAtom, now, documentId).catch(console.error);

    return document;
  }

  /**
   * Searches documents in the workspace.
   */
  async searchDocuments(
    input: SearchDocumentsInput,
    identity: Identity,
    requestId: string
  ): Promise<Document[]> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    this.assertMember(identity);

    const query = input.query.toLowerCase();
    const limit = input.limit || 20;

    // Simple search: match title or content
    const results: Document[] = [];
    for (const document of this.documents.values()) {
      if (
        document.title.toLowerCase().includes(query) ||
        document.content.toLowerCase().includes(query)
      ) {
        results.push(document);
        if (results.length >= limit) break;
      }
    }

    // Emit action.v1 for the search operation
    const now = new Date().toISOString();
    const actionAtom: Omit<ActionAtom, 'cid' | 'prev_hash'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      prev_hash: '',
      when: now,
      who: {
        user_id: identity.user_id,
        email: identity.email,
      },
      did: 'office.document.search',
      this: {
        workspace_id: this.config.workspace_id,
      },
      agreement_id: getWorkspaceAgreementId(this.config.workspace_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Fire and forget
    const ledgerKey = `${this.config.tenant_id}|ledger|0`;
    const ledgerDO = this.env.LEDGER_SHARD_OBJECT.idFromName(ledgerKey);
    const ledgerStub = this.env.LEDGER_SHARD_OBJECT.get(ledgerDO);

    ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: actionAtom },
        identity: { user_id: identity.user_id, email: identity.email },
        request_id: requestId,
      }),
    })).catch(console.error);

    return results;
  }

  /**
   * Handles LLM completion requests.
   * In MVP-1, this is a placeholder that emits receipts.
   * Full AI Gateway integration is in MVP-6.
   */
  async llmComplete(
    prompt: string,
    model: string,
    maxTokens: number,
    identity: Identity,
    requestId: string
  ): Promise<{ completion: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    this.assertMember(identity);

    const now = new Date().toISOString();

    // Emit action.v1 for the LLM call
    const actionAtom: Omit<ActionAtom, 'cid' | 'prev_hash'> = {
      kind: 'action.v1',
      tenant_id: this.config.tenant_id,
      cid: '',
      prev_hash: '',
      when: now,
      who: {
        user_id: identity.user_id,
        email: identity.email,
      },
      did: 'office.llm.complete',
      this: {
        workspace_id: this.config.workspace_id,
      },
      agreement_id: getWorkspaceAgreementId(this.config.workspace_id),
      status: 'executed',
      trace: {
        request_id: requestId,
      },
    };

    // Append to ledger
    const ledgerKey = `${this.config.tenant_id}|ledger|0`;
    const ledgerDO = this.env.LEDGER_SHARD_OBJECT.idFromName(ledgerKey);
    const ledgerStub = this.env.LEDGER_SHARD_OBJECT.get(ledgerDO);

    await ledgerStub.fetch(new Request('http://internal/append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'append_atom',
        payload: { atom: actionAtom },
        identity: { user_id: identity.user_id, email: identity.email },
        request_id: requestId,
      }),
    }));

    // In MVP-1, return a placeholder response
    // In MVP-6, this will route through AI Gateway
    return {
      completion: `[MVP-1 Placeholder] LLM completion for prompt: "${prompt.slice(0, 50)}..." (model: ${model}, max_tokens: ${maxTokens})`,
      usage: {
        prompt_tokens: prompt.split(' ').length,
        completion_tokens: 20,
      },
    };
  }

  /**
   * Lists all documents in the workspace.
   */
  async listDocuments(identity: Identity): Promise<Document[]> {
    await this.initialize();

    if (!this.config) {
      throw new Error('Workspace not initialized');
    }

    this.assertMember(identity);

    return Array.from(this.documents.values());
  }

  /**
   * Gets workspace configuration.
   */
  async getConfig(): Promise<WorkspaceConfig | null> {
    await this.initialize();
    return this.config;
  }

  /**
   * HTTP request handler for the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method === 'POST') {
        const body = await request.json() as DORequest;
        const { type, payload, identity, request_id } = body;

        switch (type) {
          case 'init': {
            const { workspace_id, tenant_id, name, creator_id } = payload as {
              workspace_id: string;
              tenant_id: string;
              name: string;
              creator_id: string;
            };
            await this.initWorkspace(workspace_id, tenant_id, name, creator_id);
            return new Response(JSON.stringify({ success: true }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'create_document': {
            const input = payload as CreateDocumentInput;
            const document = await this.createDocument(input, identity, request_id);
            return new Response(JSON.stringify({ success: true, data: document }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_document': {
            const { document_id } = payload as { document_id: string };
            const document = await this.getDocument(document_id, identity, request_id);
            return new Response(JSON.stringify({ success: true, data: document }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'search_documents': {
            const input = payload as SearchDocumentsInput;
            const results = await this.searchDocuments(input, identity, request_id);
            return new Response(JSON.stringify({ success: true, data: results }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'llm_complete': {
            const { prompt, model, max_tokens } = payload as {
              prompt: string;
              model?: string;
              max_tokens?: number;
            };
            const result = await this.llmComplete(
              prompt,
              model || 'gpt-4',
              max_tokens || 1000,
              identity,
              request_id
            );
            return new Response(JSON.stringify({ success: true, data: result }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'list_documents': {
            const documents = await this.listDocuments(identity);
            return new Response(JSON.stringify({ success: true, data: documents }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_config': {
            const config = await this.getConfig();
            return new Response(JSON.stringify({ success: true, data: config }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          default:
            return new Response(JSON.stringify({ success: false, error: 'Unknown type' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
        }
      }

      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('WorkspaceObject error:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }
}
