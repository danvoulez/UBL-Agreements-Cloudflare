/**
 * UBL MVP-1 MCP Handler
 * Implements MCP (Model Context Protocol) JSON-RPC server.
 *
 * Endpoints:
 * - POST /mcp - JSON-RPC handler
 * - GET /mcp?session_id=... - Streamable HTTP (keepalive-only in MVP-1)
 *
 * Methods:
 * - initialize
 * - tools/list
 * - tools/call
 */

import type {
  Env,
  Identity,
  IdentityContext,
  MCPRequest,
  MCPResponse,
  MCPError,
  MCPServerInfo,
  MCPCapabilities,
  MCPInitializeResult,
  MCPTool,
  MCPToolsListResult,
  MCPToolCallParams,
  MCPToolCallResult,
  Message,
  RoomSummary,
  HistoryResult,
  Document,
} from '../types';
import { mcpResponse, mcpToolResult, formatSSEKeepalive } from '../utils/response';
import { mcpErrorResponse, MCPErrorCode, UBLError, originNotAllowedError } from '../utils/errors';
import { generateSessionId, generateRequestId } from '../utils/hash';

/**
 * MCP Server configuration.
 */
const SERVER_INFO: MCPServerInfo = {
  name: 'ubl-mvp1',
  version: '1.0.0',
};

const CAPABILITIES: MCPCapabilities = {
  tools: true,
  streaming: true,
};

/**
 * Allowed origins for MCP requests.
 * In production, this should be configured via environment variables.
 */
const ALLOWED_ORIGINS = [
  'http://localhost:8787',
  'http://localhost:3000',
  'https://ubl.agency',
  'https://voulezvous.tv',
];

/**
 * MCP Tool definitions with JSON schemas.
 */
const MCP_TOOLS: MCPTool[] = [
  // Messenger tools
  {
    name: 'messenger.list_rooms',
    description: 'List all rooms the user has access to',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: {
          type: ['string', 'null'],
          description: 'Optional cursor for pagination',
        },
        limit: {
          type: ['integer', 'null'],
          minimum: 1,
          maximum: 500,
          description: 'Optional limit',
        },
      },
    },
  },
  {
    name: 'messenger.send',
    description: 'Send a message to a room. Returns the full message with receipt.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['room_id', 'type', 'body'],
      properties: {
        room_id: {
          type: 'string',
          pattern: '^r:[A-Za-z0-9._-]{1,128}$',
        },
        type: {
          type: 'string',
          enum: ['text', 'system'],
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: {
            text: {
              type: 'string',
              minLength: 1,
              maxLength: 8000,
            },
          },
        },
        reply_to: {
          type: ['string', 'null'],
          pattern: '^m:[A-Za-z0-9._-]{1,256}$',
        },
        client_request_id: {
          type: ['string', 'null'],
          maxLength: 128,
        },
      },
    },
  },
  {
    name: 'messenger.history',
    description: 'Get message history for a room',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['room_id'],
      properties: {
        room_id: {
          type: 'string',
          pattern: '^r:[A-Za-z0-9._-]{1,128}$',
        },
        cursor: {
          type: ['integer', 'null'],
          minimum: 1,
        },
        limit: {
          type: ['integer', 'null'],
          minimum: 1,
          maximum: 200,
        },
      },
    },
  },
  // Office tools
  {
    name: 'office.document.create',
    description: 'Create a new document in a workspace',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'title', 'content'],
      properties: {
        workspace_id: {
          type: 'string',
          pattern: '^w:[A-Za-z0-9._-]{1,128}$',
        },
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
        },
        content: {
          type: 'string',
          maxLength: 1000000,
        },
      },
    },
  },
  {
    name: 'office.document.get',
    description: 'Get a document by ID',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'document_id'],
      properties: {
        workspace_id: {
          type: 'string',
          pattern: '^w:[A-Za-z0-9._-]{1,128}$',
        },
        document_id: {
          type: 'string',
          pattern: '^d:[A-Za-z0-9._-]{1,256}$',
        },
      },
    },
  },
  {
    name: 'office.document.search',
    description: 'Search documents in a workspace',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'query'],
      properties: {
        workspace_id: {
          type: 'string',
          pattern: '^w:[A-Za-z0-9._-]{1,128}$',
        },
        query: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
        },
        limit: {
          type: ['integer', 'null'],
          minimum: 1,
          maximum: 100,
        },
      },
    },
  },
  {
    name: 'office.llm.complete',
    description: 'Request LLM completion (via AI Gateway in MVP-6)',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace_id', 'prompt'],
      properties: {
        workspace_id: {
          type: 'string',
          pattern: '^w:[A-Za-z0-9._-]{1,128}$',
        },
        prompt: {
          type: 'string',
          minLength: 1,
          maxLength: 100000,
        },
        model: {
          type: ['string', 'null'],
          maxLength: 64,
        },
        max_tokens: {
          type: ['integer', 'null'],
          minimum: 1,
          maximum: 100000,
        },
      },
    },
  },
];

/**
 * Validates the Origin header for MCP requests.
 */
function validateOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('Origin');

  // No origin header (non-browser request) - allow
  if (!origin) {
    return;
  }

  // Check against allowed origins
  // In production, this should also include the portal origin
  const allowedOrigins = [...ALLOWED_ORIGINS];

  // Add any configured origins from env
  // env.ALLOWED_ORIGINS could be a comma-separated list

  if (!allowedOrigins.some(allowed => origin === allowed || origin.endsWith(allowed.replace('https://', '.')))) {
    throw originNotAllowedError(origin);
  }
}

/**
 * Handles MCP initialize method.
 */
function handleInitialize(id: number | string): MCPResponse {
  const sessionId = generateSessionId();
  const result: MCPInitializeResult = {
    serverInfo: SERVER_INFO,
    capabilities: CAPABILITIES,
    session_id: sessionId,
  };

  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Handles MCP tools/list method.
 */
function handleToolsList(id: number | string): MCPResponse {
  const result: MCPToolsListResult = {
    tools: MCP_TOOLS,
  };

  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Handles MCP tools/call method.
 */
async function handleToolsCall(
  id: number | string,
  params: MCPToolCallParams,
  env: Env,
  ctx: IdentityContext
): Promise<MCPResponse> {
  const { name, arguments: args } = params;
  const { identity, tenant_id, request_id } = ctx;

  let result: MCPToolCallResult;

  switch (name) {
    case 'messenger.list_rooms': {
      const rooms = await callListRooms(env, identity, tenant_id, request_id);
      result = mcpToolResult({ rooms, next_cursor: null });
      break;
    }

    case 'messenger.send': {
      const message = await callSendMessage(
        env,
        identity,
        tenant_id,
        request_id,
        args as { room_id: string; type: string; body: { text: string }; reply_to?: string; client_request_id?: string }
      );
      result = mcpToolResult({ message });
      break;
    }

    case 'messenger.history': {
      const history = await callGetHistory(
        env,
        identity,
        tenant_id,
        request_id,
        args as { room_id: string; cursor?: number; limit?: number }
      );
      result = mcpToolResult(history);
      break;
    }

    case 'office.document.create': {
      const document = await callCreateDocument(
        env,
        identity,
        tenant_id,
        request_id,
        args as { workspace_id: string; title: string; content: string }
      );
      result = mcpToolResult({ document });
      break;
    }

    case 'office.document.get': {
      const document = await callGetDocument(
        env,
        identity,
        tenant_id,
        request_id,
        args as { workspace_id: string; document_id: string }
      );
      result = mcpToolResult({ document });
      break;
    }

    case 'office.document.search': {
      const documents = await callSearchDocuments(
        env,
        identity,
        tenant_id,
        request_id,
        args as { workspace_id: string; query: string; limit?: number }
      );
      result = mcpToolResult({ documents });
      break;
    }

    case 'office.llm.complete': {
      const completion = await callLLMComplete(
        env,
        identity,
        tenant_id,
        request_id,
        args as { workspace_id: string; prompt: string; model?: string; max_tokens?: number }
      );
      result = mcpToolResult(completion);
      break;
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: MCPErrorCode.METHOD_NOT_FOUND,
          message: `Unknown tool: ${name}`,
        },
      };
  }

  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

// ============================================================================
// Tool Implementation Functions
// ============================================================================

async function callListRooms(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string
): Promise<RoomSummary[]> {
  const tenantDO = env.TENANT_OBJECT.idFromName(tenantId);
  const tenantStub = env.TENANT_OBJECT.get(tenantDO);

  // Ensure tenant
  await tenantStub.fetch(new Request('http://internal/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ensure_tenant_and_member',
      payload: { tenant_id: tenantId },
      identity,
      request_id: requestId,
    }),
  }));

  // List rooms
  const response = await tenantStub.fetch(new Request('http://internal/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'list_rooms',
      payload: {},
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: RoomSummary[] };
  return result.data || [];
}

async function callSendMessage(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { room_id: string; type: string; body: { text: string }; reply_to?: string; client_request_id?: string }
): Promise<Message> {
  const roomKey = `${tenantId}|${args.room_id}`;
  const roomDO = env.ROOM_OBJECT.idFromName(roomKey);
  const roomStub = env.ROOM_OBJECT.get(roomDO);

  const response = await roomStub.fetch(new Request('http://internal/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'send_message',
      payload: {
        type: args.type,
        body: args.body,
        reply_to: args.reply_to || null,
        client_request_id: args.client_request_id || null,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: Message; error?: string };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to send message');
  }

  return result.data;
}

async function callGetHistory(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { room_id: string; cursor?: number; limit?: number }
): Promise<{ messages: Message[]; next_cursor: number | null }> {
  const roomKey = `${tenantId}|${args.room_id}`;
  const roomDO = env.ROOM_OBJECT.idFromName(roomKey);
  const roomStub = env.ROOM_OBJECT.get(roomDO);

  const response = await roomStub.fetch(new Request('http://internal/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'get_history',
      payload: {
        cursor: args.cursor || null,
        limit: args.limit || 50,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: HistoryResult };
  return result.data || { messages: [], next_cursor: null };
}

async function callCreateDocument(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { workspace_id: string; title: string; content: string }
): Promise<Document> {
  const workspaceKey = `${tenantId}|${args.workspace_id}`;
  const workspaceDO = env.WORKSPACE_OBJECT.idFromName(workspaceKey);
  const workspaceStub = env.WORKSPACE_OBJECT.get(workspaceDO);

  // Ensure workspace exists (auto-create if not)
  await workspaceStub.fetch(new Request('http://internal/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'init',
      payload: {
        workspace_id: args.workspace_id,
        tenant_id: tenantId,
        name: args.workspace_id.replace('w:', ''),
        creator_id: identity.user_id,
      },
      identity,
      request_id: requestId,
    }),
  }));

  // Create document
  const response = await workspaceStub.fetch(new Request('http://internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'create_document',
      payload: {
        workspace_id: args.workspace_id,
        title: args.title,
        content: args.content,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: Document; error?: string };
  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to create document');
  }

  return result.data;
}

async function callGetDocument(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { workspace_id: string; document_id: string }
): Promise<Document | null> {
  const workspaceKey = `${tenantId}|${args.workspace_id}`;
  const workspaceDO = env.WORKSPACE_OBJECT.idFromName(workspaceKey);
  const workspaceStub = env.WORKSPACE_OBJECT.get(workspaceDO);

  const response = await workspaceStub.fetch(new Request('http://internal/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'get_document',
      payload: {
        document_id: args.document_id,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: Document };
  return result.data || null;
}

async function callSearchDocuments(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { workspace_id: string; query: string; limit?: number }
): Promise<Document[]> {
  const workspaceKey = `${tenantId}|${args.workspace_id}`;
  const workspaceDO = env.WORKSPACE_OBJECT.idFromName(workspaceKey);
  const workspaceStub = env.WORKSPACE_OBJECT.get(workspaceDO);

  const response = await workspaceStub.fetch(new Request('http://internal/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'search_documents',
      payload: {
        workspace_id: args.workspace_id,
        query: args.query,
        limit: args.limit || 20,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: Document[] };
  return result.data || [];
}

async function callLLMComplete(
  env: Env,
  identity: Identity,
  tenantId: string,
  requestId: string,
  args: { workspace_id: string; prompt: string; model?: string; max_tokens?: number }
): Promise<{ completion: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const workspaceKey = `${tenantId}|${args.workspace_id}`;
  const workspaceDO = env.WORKSPACE_OBJECT.idFromName(workspaceKey);
  const workspaceStub = env.WORKSPACE_OBJECT.get(workspaceDO);

  // Ensure workspace exists
  await workspaceStub.fetch(new Request('http://internal/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'init',
      payload: {
        workspace_id: args.workspace_id,
        tenant_id: tenantId,
        name: args.workspace_id.replace('w:', ''),
        creator_id: identity.user_id,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const response = await workspaceStub.fetch(new Request('http://internal/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'llm_complete',
      payload: {
        prompt: args.prompt,
        model: args.model || 'gpt-4',
        max_tokens: args.max_tokens || 1000,
      },
      identity,
      request_id: requestId,
    }),
  }));

  const result = await response.json() as { success: boolean; data?: { completion: string; usage: { prompt_tokens: number; completion_tokens: number } } };
  return result.data || { completion: '', usage: { prompt_tokens: 0, completion_tokens: 0 } };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handles POST /mcp request (JSON-RPC).
 */
export async function handleMCPPost(
  request: Request,
  env: Env,
  ctx: IdentityContext
): Promise<Response> {
  try {
    // Validate Origin
    validateOrigin(request, env);

    // Parse JSON-RPC request
    const mcpRequest = await request.json() as MCPRequest;

    // Validate JSON-RPC structure
    if (mcpRequest.jsonrpc !== '2.0') {
      return mcpErrorResponse(mcpRequest.id || null, {
        code: MCPErrorCode.INVALID_REQUEST,
        message: 'Invalid JSON-RPC version',
      });
    }

    // Route to handler based on method
    let response: MCPResponse;

    switch (mcpRequest.method) {
      case 'initialize':
        response = handleInitialize(mcpRequest.id);
        break;

      case 'tools/list':
        response = handleToolsList(mcpRequest.id);
        break;

      case 'tools/call':
        response = await handleToolsCall(
          mcpRequest.id,
          mcpRequest.params as MCPToolCallParams,
          env,
          ctx
        );
        break;

      default:
        response = {
          jsonrpc: '2.0',
          id: mcpRequest.id,
          error: {
            code: MCPErrorCode.METHOD_NOT_FOUND,
            message: `Method not found: ${mcpRequest.method}`,
          },
        };
    }

    return mcpResponse(response.id, response.result || response.error);
  } catch (error) {
    if (error instanceof UBLError) {
      return mcpErrorResponse(null, error);
    }

    return mcpErrorResponse(null, {
      code: MCPErrorCode.INTERNAL_ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Handles GET /mcp request (Streamable HTTP - keepalive only in MVP-1).
 */
export async function handleMCPGet(
  request: Request,
  env: Env,
  ctx: IdentityContext
): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'session_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create keepalive SSE stream
  const keepaliveInterval = parseInt(env.KEEPALIVE_INTERVAL_MS || '15000', 10);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial event
  const now = new Date().toISOString();
  const initEvent = `event: server.notice\ndata: ${JSON.stringify({ session_id: sessionId, connected_at: now })}\n\n`;
  writer.write(encoder.encode(initEvent)).catch(() => {});

  // Set up keepalive
  const timer = setInterval(() => {
    const keepalive = formatSSEKeepalive();
    writer.write(encoder.encode(keepalive)).catch(() => {
      clearInterval(timer);
      writer.close().catch(() => {});
    });
  }, keepaliveInterval);

  // Clean up on abort
  request.signal?.addEventListener('abort', () => {
    clearInterval(timer);
    writer.close().catch(() => {});
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Request-Id': ctx.request_id,
      'Access-Control-Allow-Origin': '*',
    },
  });
}
