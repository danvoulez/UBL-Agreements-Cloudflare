/**
 * UBL MVP-1 LedgerShardObject Durable Object
 *
 * Manages the append-only ledger with hash chain:
 * - Atomic receipts (action.v1 and effect.v1)
 * - Hash chain integrity (head_hash)
 * - Hot atom cache (bounded)
 * - Deduplication map
 *
 * Storage keys:
 * - seq: integer (global sequence number)
 * - head: string (current head_hash)
 * - hot: JSON blob (array of atoms, bounded to hot_limit)
 * - dedupe: JSON blob (map cid → seq)
 *
 * Per Blueprint:
 * - cid = SHA256(canonical_json(atom_without_cid))
 * - head_hash = SHA256(prev_head_hash + ":" + cid)
 * - Genesis hash: "h:genesis"
 * - Hot limit: 2000 atoms
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  Identity,
  Atom,
  ActionAtom,
  EffectAtom,
  LedgerReceipt,
  DORequest,
} from '../types';
import {
  computeCID,
  computeHeadHash,
  genesisHash,
  GENESIS_HASH,
} from '../utils/hash';

/**
 * Default settings.
 */
const DEFAULT_HOT_ATOMS_LIMIT = 2000;
const DEFAULT_DEDUPE_LIMIT = 5000;

export class LedgerShardObject extends DurableObject<Env> {
  private seq = 0;
  private head: string = GENESIS_HASH;
  private hot: Atom[] = [];
  private dedupe: Map<string, number> = new Map();
  private initialized = false;
  private shardId = '0';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initializes the DO by loading state from storage.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const [seq, head, hot, dedupe] = await Promise.all([
      this.ctx.storage.get<number>('seq'),
      this.ctx.storage.get<string>('head'),
      this.ctx.storage.get<Atom[]>('hot'),
      this.ctx.storage.get<Record<string, number>>('dedupe'),
    ]);

    this.seq = seq || 0;
    this.head = head || GENESIS_HASH;
    this.hot = hot || [];
    this.dedupe = new Map(Object.entries(dedupe || {}));
    this.initialized = true;
  }

  /**
   * Saves seq to storage.
   */
  private async saveSeq(): Promise<void> {
    await this.ctx.storage.put('seq', this.seq);
  }

  /**
   * Saves head to storage.
   */
  private async saveHead(): Promise<void> {
    await this.ctx.storage.put('head', this.head);
  }

  /**
   * Saves hot atoms to storage.
   */
  private async saveHot(): Promise<void> {
    await this.ctx.storage.put('hot', this.hot);
  }

  /**
   * Saves dedupe map to storage.
   */
  private async saveDedupe(): Promise<void> {
    const dedupeObj = Object.fromEntries(this.dedupe);
    await this.ctx.storage.put('dedupe', dedupeObj);
  }

  /**
   * Appends an atom to the ledger.
   * Computes CID and updates hash chain.
   *
   * @param atomWithoutCid - The atom without CID (will be computed)
   * @returns Receipt with seq, cid, and head_hash
   */
  async appendAtom(
    atomWithoutCid: Omit<ActionAtom, 'cid' | 'prev_hash'> | Omit<EffectAtom, 'cid'>
  ): Promise<{ receipt: LedgerReceipt; cid: string }> {
    await this.initialize();

    const now = new Date().toISOString();

    // Compute CID
    const cid = await computeCID(atomWithoutCid);

    // Check for duplicate
    const existingSeq = this.dedupe.get(cid);
    if (existingSeq !== undefined) {
      // Return existing receipt
      const existingAtom = this.hot.find(a => a.cid === cid);
      if (existingAtom) {
        const prevAtom = this.hot.find(a => 'prev_hash' in a && a.cid === cid);
        return {
          receipt: {
            ledger_shard: this.shardId,
            seq: existingSeq,
            cid,
            head_hash: this.head, // This is approximate for duplicates
            time: now,
          },
          cid,
        };
      }
    }

    // Increment sequence
    this.seq++;
    const currentSeq = this.seq;

    // Compute new head_hash
    const prevHash = this.head;
    const newHead = await computeHeadHash(prevHash, cid);

    // Create complete atom with CID and prev_hash
    let completeAtom: Atom;

    if (atomWithoutCid.kind === 'action.v1') {
      completeAtom = {
        ...atomWithoutCid,
        cid,
        prev_hash: prevHash,
      } as ActionAtom;
    } else {
      completeAtom = {
        ...atomWithoutCid,
        cid,
      } as EffectAtom;
    }

    // Update head
    this.head = newHead;

    // Add to hot cache
    this.hot.push(completeAtom);

    // Trim hot cache if too large
    const hotLimit = parseInt(this.env.HOT_ATOMS_LIMIT || String(DEFAULT_HOT_ATOMS_LIMIT), 10);
    if (this.hot.length > hotLimit) {
      this.hot.shift();
    }

    // Add to dedupe map
    this.dedupe.set(cid, currentSeq);

    // Trim dedupe map if too large
    if (this.dedupe.size > DEFAULT_DEDUPE_LIMIT) {
      const keysToDelete = Array.from(this.dedupe.keys()).slice(0, this.dedupe.size - DEFAULT_DEDUPE_LIMIT);
      for (const key of keysToDelete) {
        this.dedupe.delete(key);
      }
    }

    // Persist all changes atomically
    await this.ctx.storage.transaction(async () => {
      await Promise.all([
        this.saveSeq(),
        this.saveHead(),
        this.saveHot(),
        this.saveDedupe(),
      ]);
    });

    // Also store in D1 for querying
    await this.storeAtomInD1(completeAtom, currentSeq, newHead);

    // Create receipt
    const receipt: LedgerReceipt = {
      ledger_shard: this.shardId,
      seq: currentSeq,
      cid,
      head_hash: newHead,
      time: now,
    };

    return { receipt, cid };
  }

  /**
   * Stores an atom in D1 for persistent storage and querying.
   */
  private async storeAtomInD1(atom: Atom, seq: number, headHash: string): Promise<void> {
    try {
      const query = `
        INSERT INTO spans (id, tenant_id, user_id, app_id, ts, kind, hash, size, r2_key, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING
      `;

      const userId = 'who' in atom ? atom.who.user_id : null;
      const atomStr = JSON.stringify(atom);

      await this.env.D1_LEDGER.prepare(query).bind(
        `span:${seq}`,
        atom.tenant_id,
        userId,
        'ubl-mvp1',
        atom.kind === 'action.v1' ? atom.when : (atom as EffectAtom).when,
        atom.kind,
        atom.cid,
        atomStr.length,
        null, // r2_key - will be populated when archiving
        JSON.stringify({
          seq,
          head_hash: headHash,
          atom,
        })
      ).run();
    } catch (error) {
      console.error('Failed to store atom in D1:', error);
      // Don't throw - D1 storage is secondary to DO storage
    }
  }

  /**
   * Gets atoms by sequence number.
   * Returns action+effect pairs when applicable.
   */
  async getBySeq(seq: number): Promise<Atom[]> {
    await this.initialize();

    // First try hot cache
    const hotAtoms = this.hot.filter(a => {
      // For action atoms, we store seq in a different way
      // We need to find atoms around the given seq
      return true; // Return all and filter by other means
    });

    // Try D1 for more reliable lookup
    try {
      const query = `
        SELECT metadata FROM spans
        WHERE id = ?
      `;

      const result = await this.env.D1_LEDGER.prepare(query)
        .bind(`span:${seq}`)
        .first<{ metadata: string }>();

      if (result) {
        const metadata = JSON.parse(result.metadata) as { seq: number; head_hash: string; atom: Atom };
        const atoms: Atom[] = [metadata.atom];

        // Try to find the associated effect
        const effectQuery = `
          SELECT metadata FROM spans
          WHERE id = ?
        `;
        const effectResult = await this.env.D1_LEDGER.prepare(effectQuery)
          .bind(`span:${seq + 1}`)
          .first<{ metadata: string }>();

        if (effectResult) {
          const effectMetadata = JSON.parse(effectResult.metadata) as { atom: Atom };
          if (effectMetadata.atom.kind === 'effect.v1') {
            atoms.push(effectMetadata.atom);
          }
        }

        return atoms;
      }
    } catch (error) {
      console.error('Failed to query D1:', error);
    }

    // Fallback: return empty if not found
    return [];
  }

  /**
   * Queries recent atoms with pagination.
   */
  async queryRecent(cursor?: number, limit = 50): Promise<{ atoms: Atom[]; next_cursor: number | null }> {
    await this.initialize();

    const effectiveLimit = Math.min(limit, 200);

    // If no cursor, start from the end
    const startSeq = cursor !== undefined ? cursor : this.seq;

    // Get atoms from hot cache
    const atoms = this.hot
      .filter((_, index) => {
        // Approximate: assume atoms are in order
        return index <= startSeq && index > startSeq - effectiveLimit;
      })
      .slice(-effectiveLimit);

    // Determine next cursor
    let nextCursor: number | null = null;
    if (atoms.length > 0 && this.seq > effectiveLimit) {
      nextCursor = startSeq - effectiveLimit;
      if (nextCursor < 1) nextCursor = null;
    }

    return { atoms, next_cursor: nextCursor };
  }

  /**
   * Gets current ledger state (seq and head_hash).
   */
  async getState(): Promise<{ seq: number; head_hash: string }> {
    await this.initialize();
    return {
      seq: this.seq,
      head_hash: this.head,
    };
  }

  /**
   * Verifies the hash chain integrity.
   * Returns true if the chain is valid.
   */
  async verifyChain(): Promise<{ valid: boolean; errors: string[] }> {
    await this.initialize();

    const errors: string[] = [];
    let computedHead = GENESIS_HASH;

    for (let i = 0; i < this.hot.length; i++) {
      const atom = this.hot[i];
      if (!atom) continue;

      // Verify CID
      const expectedCid = await computeCID(atom);
      if (expectedCid !== atom.cid) {
        errors.push(`Atom at index ${i} has invalid CID: expected ${expectedCid}, got ${atom.cid}`);
      }

      // For action atoms, verify prev_hash and update computedHead
      if (atom.kind === 'action.v1') {
        const actionAtom = atom as ActionAtom;
        if (actionAtom.prev_hash !== computedHead) {
          errors.push(`Atom at index ${i} has invalid prev_hash: expected ${computedHead}, got ${actionAtom.prev_hash}`);
        }
        computedHead = await computeHeadHash(computedHead, atom.cid);
      }
    }

    // Verify final head matches stored head
    if (computedHead !== this.head) {
      errors.push(`Final head_hash mismatch: computed ${computedHead}, stored ${this.head}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
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
          case 'append_atom': {
            const { atom } = payload as { atom: Omit<ActionAtom, 'cid' | 'prev_hash'> | Omit<EffectAtom, 'cid'> };
            const result = await this.appendAtom(atom);
            return new Response(JSON.stringify({ success: true, data: result }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_by_seq': {
            const { seq } = payload as { seq: number };
            const atoms = await this.getBySeq(seq);
            return new Response(JSON.stringify({ success: true, data: atoms }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'query_recent': {
            const { cursor, limit } = payload as { cursor?: number; limit?: number };
            const result = await this.queryRecent(cursor, limit);
            return new Response(JSON.stringify({ success: true, data: result }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_state': {
            const state = await this.getState();
            return new Response(JSON.stringify({ success: true, data: state }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'verify_chain': {
            const result = await this.verifyChain();
            return new Response(JSON.stringify({ success: true, data: result }), {
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
      console.error('LedgerShardObject error:', error);
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
