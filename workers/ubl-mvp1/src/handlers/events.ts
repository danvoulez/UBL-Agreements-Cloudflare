/**
 * UBL MVP-1 Events Handler
 * Handles SSE streaming for room events
 */

import type { Env, Identity, IdentityContext } from '../types';
import { sseResponse, formatSSEEvent, formatSSEKeepalive } from '../utils/response';
import { validationError, notFoundError } from '../utils/errors';

/**
 * Validates a room ID format.
 */
function validateRoomId(roomId: string): void {
  if (!roomId || typeof roomId !== 'string') {
    throw validationError('Room ID is required');
  }
  if (!roomId.match(/^r:[A-Za-z0-9._-]{1,128}$/)) {
    throw validationError('Invalid room ID format');
  }
}

/**
 * Handles GET /api/events/rooms/:roomId request.
 * Establishes SSE connection for room events.
 */
export async function handleRoomEvents(
  env: Env,
  ctx: IdentityContext,
  roomId: string,
  query: URLSearchParams
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Validate room ID
  validateRoomId(roomId);

  // Parse query parameters
  const fromSeqParam = query.get('from_seq');
  const fromSeq = fromSeqParam ? parseInt(fromSeqParam, 10) : undefined;

  // Get room stub
  const roomKey = `${tenant_id}|${roomId}`;
  const roomDO = env.ROOM_OBJECT.idFromName(roomKey);
  const roomStub = env.ROOM_OBJECT.get(roomDO);

  // Check if room exists by getting config
  const configResponse = await roomStub.fetch(new Request('http://internal/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'get_config',
      payload: {},
      identity,
      request_id,
    }),
  }));

  const configResult = await configResponse.json() as {
    success: boolean;
    data?: unknown;
    error?: string;
  };

  if (!configResult.success || !configResult.data) {
    throw notFoundError('Room', roomId);
  }

  // Subscribe to SSE
  const sseUrl = new URL('http://internal/subscribe');
  if (fromSeq !== undefined) {
    sseUrl.searchParams.set('from_seq', String(fromSeq));
  }

  const sseResponse = await roomStub.fetch(new Request(sseUrl.toString(), {
    method: 'GET',
    headers: {
      'X-Identity': JSON.stringify(identity),
    },
  }));

  if (!sseResponse.ok || !sseResponse.body) {
    throw new Error('Failed to establish SSE connection');
  }

  // Return the SSE stream directly
  return new Response(sseResponse.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Request-Id': request_id,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id, CF-Access-JWT-Assertion',
    },
  });
}

/**
 * Creates a simple SSE stream for testing.
 */
export function createTestSSEStream(
  identity: Identity,
  roomId: string,
  tenantId: string
): ReadableStream {
  const keepaliveInterval = 15000;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial connection event
  const now = new Date().toISOString();
  const connectEvent = formatSSEEvent(0, 'connected', {
    event: 'connected',
    tenant_id: tenantId,
    room_id: roomId,
    ts: now,
    payload: {
      user_id: identity.user_id,
      connected_at: now,
    },
  });
  writer.write(encoder.encode(connectEvent)).catch(() => {});

  // Set up keepalive
  const timer = setInterval(() => {
    const keepalive = formatSSEKeepalive();
    writer.write(encoder.encode(keepalive)).catch(() => {
      clearInterval(timer);
      writer.close().catch(() => {});
    });
  }, keepaliveInterval);

  return readable;
}
