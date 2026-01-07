/**
 * UBL MVP-1 Worker Entry Point
 *
 * This is the main entry point for the UBL MVP-1 Worker.
 * It handles routing for:
 * - REST API endpoints (/api/*)
 * - SSE events (/api/events/*)
 * - MCP server (/mcp)
 * - PWA UI (/ui/*)
 *
 * All requests are authenticated via Cloudflare Access.
 */

import type { Env, IdentityContext, TenantRole } from './types';
import {
  extractIdentityFromRequest,
  createDevIdentity,
} from './utils/identity';
import { generateRequestId } from './utils/hash';
import {
  errorResponse,
  wrapError,
  unauthorizedError,
  notFoundError,
  UBLError,
} from './utils/errors';
import { corsPreflightResponse } from './utils/response';

// Import handlers
import {
  handleWhoami,
  handleListRooms,
  handleCreateRoom,
  handleSendMessage,
  handleGetHistory,
  handleRoomEvents,
  handleGetReceipt,
  handleMCPPost,
  handleMCPGet,
} from './handlers';

// Import Durable Object classes
export {
  TenantObject,
  RoomObject,
  LedgerShardObject,
  WorkspaceObject,
} from './durable-objects';

/**
 * Extracts identity context from request.
 * In development, creates a mock identity.
 * In production, requires Cloudflare Access JWT.
 */
async function getIdentityContext(
  request: Request,
  env: Env
): Promise<IdentityContext> {
  const requestId = request.headers.get('X-Request-Id') || generateRequestId();

  // Try to extract identity from Access JWT
  const identityResult = extractIdentityFromRequest(request);

  if (identityResult) {
    // Resolve role from tenant
    const tenantDO = env.TENANT_OBJECT.idFromName(identityResult.tenant_id);
    const tenantStub = env.TENANT_OBJECT.get(tenantDO);

    try {
      const response = await tenantStub.fetch(new Request('http://internal/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ensure_tenant_and_member',
          payload: { tenant_id: identityResult.tenant_id },
          identity: identityResult.identity,
          request_id: requestId,
        }),
      }));

      const result = await response.json() as {
        success: boolean;
        data?: { role: TenantRole };
      };

      return {
        identity: identityResult.identity,
        tenant_id: identityResult.tenant_id,
        role: result.data?.role || 'member',
        request_id: requestId,
      };
    } catch {
      return {
        identity: identityResult.identity,
        tenant_id: identityResult.tenant_id,
        role: 'member',
        request_id: requestId,
      };
    }
  }

  // Development mode: create mock identity
  if (env.ENVIRONMENT === 'development') {
    const devIdentity = createDevIdentity('dev@example.com');
    return {
      identity: devIdentity.identity,
      tenant_id: devIdentity.tenant_id,
      role: 'owner',
      request_id: requestId,
    };
  }

  // No identity available - unauthorized
  throw unauthorizedError('Authentication required');
}

/**
 * Main request handler.
 */
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return corsPreflightResponse();
  }

  // Generate request ID for tracing
  const requestId = request.headers.get('X-Request-Id') || generateRequestId();

  try {
    // ========================================================================
    // Health check endpoint (no auth required)
    // ========================================================================
    if (path === '/health' || path === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'ubl-mvp1',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ========================================================================
    // All other endpoints require authentication
    // ========================================================================
    const identityCtx = await getIdentityContext(request, env);

    // ========================================================================
    // REST API Routes
    // ========================================================================

    // GET /api/whoami
    if (path === '/api/whoami' && method === 'GET') {
      return handleWhoami(env, identityCtx);
    }

    // GET /api/rooms
    if (path === '/api/rooms' && method === 'GET') {
      return handleListRooms(env, identityCtx);
    }

    // POST /api/rooms
    if (path === '/api/rooms' && method === 'POST') {
      const body = await request.json() as { name?: string };
      return handleCreateRoom(env, identityCtx, body);
    }

    // GET /api/rooms/:roomId/history
    const historyMatch = path.match(/^\/api\/rooms\/([^/]+)\/history$/);
    if (historyMatch && method === 'GET') {
      const roomId = decodeURIComponent(historyMatch[1] || '');
      return handleGetHistory(env, identityCtx, roomId, url.searchParams);
    }

    // POST /api/rooms/:roomId/messages
    const messagesMatch = path.match(/^\/api\/rooms\/([^/]+)\/messages$/);
    if (messagesMatch && method === 'POST') {
      const roomId = decodeURIComponent(messagesMatch[1] || '');
      const body = await request.json() as { type?: string; body?: { text: string }; reply_to?: string; client_request_id?: string };
      return handleSendMessage(env, identityCtx, roomId, body);
    }

    // GET /api/events/rooms/:roomId (SSE)
    const eventsMatch = path.match(/^\/api\/events\/rooms\/([^/]+)$/);
    if (eventsMatch && method === 'GET') {
      const roomId = decodeURIComponent(eventsMatch[1] || '');
      return handleRoomEvents(env, identityCtx, roomId, url.searchParams);
    }

    // GET /api/receipts/:seq
    const receiptsMatch = path.match(/^\/api\/receipts\/(\d+)$/);
    if (receiptsMatch && method === 'GET') {
      const seq = receiptsMatch[1] || '';
      return handleGetReceipt(env, identityCtx, seq);
    }

    // ========================================================================
    // MCP Routes
    // ========================================================================

    // POST /mcp (JSON-RPC)
    if (path === '/mcp' && method === 'POST') {
      return handleMCPPost(request, env, identityCtx);
    }

    // GET /mcp (Streamable HTTP)
    if (path === '/mcp' && method === 'GET') {
      return handleMCPGet(request, env, identityCtx);
    }

    // ========================================================================
    // PWA UI Routes (placeholder for MVP-1)
    // ========================================================================

    if (path.startsWith('/ui/')) {
      // In production, this would serve static assets from R2 or KV
      // For MVP-1, return a placeholder
      return new Response(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>UBL Messenger</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container {
              text-align: center;
              padding: 2rem;
            }
            h1 { font-size: 2.5rem; margin-bottom: 1rem; }
            p { font-size: 1.2rem; opacity: 0.9; }
            a { color: white; text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>UBL Messenger</h1>
            <p>MVP-1 API is running</p>
            <p>Use <a href="/api/whoami">/api/whoami</a> to verify authentication</p>
            <p>Use <a href="/mcp">/mcp</a> for MCP tools</p>
          </div>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // ========================================================================
    // Not Found
    // ========================================================================
    throw notFoundError('Endpoint', path);

  } catch (error) {
    const wrappedError = wrapError(error);
    return errorResponse(wrappedError, requestId);
  }
}

/**
 * Worker export with fetch handler.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
