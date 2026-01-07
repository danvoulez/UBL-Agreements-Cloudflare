/**
 * UBL MVP-1 Messages Handler
 * Handles message sending and history retrieval
 */

import type {
  Env,
  Identity,
  IdentityContext,
  Message,
  SendMessageInput,
  HistoryQuery,
  HistoryResult,
  SendMessageResponse,
  GetHistoryResponse,
} from '../types';
import { jsonResponse, createdResponse } from '../utils/response';
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
 * Gets the RoomObject stub for a room.
 */
function getRoomStub(env: Env, tenantId: string, roomId: string) {
  const roomKey = `${tenantId}|${roomId}`;
  const roomDO = env.ROOM_OBJECT.idFromName(roomKey);
  return env.ROOM_OBJECT.get(roomDO);
}

/**
 * Handles POST /api/rooms/:roomId/messages request.
 * Sends a message to a room.
 */
export async function handleSendMessage(
  env: Env,
  ctx: IdentityContext,
  roomId: string,
  body: Partial<SendMessageInput>
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Validate room ID
  validateRoomId(roomId);

  // Validate message input
  if (!body.type || !['text', 'system'].includes(body.type)) {
    throw validationError('Message type must be "text" or "system"');
  }

  if (!body.body || typeof body.body !== 'object' || typeof body.body.text !== 'string') {
    throw validationError('Message body with text is required');
  }

  const text = body.body.text;
  if (text.length < 1) {
    throw validationError('Message text cannot be empty');
  }

  const maxSize = parseInt(env.MAX_MESSAGE_BYTES || '8000', 10);
  if (text.length > maxSize) {
    throw validationError(`Message text exceeds maximum length of ${maxSize} characters`);
  }

  const input: SendMessageInput = {
    type: body.type,
    body: { text },
    reply_to: body.reply_to || null,
    client_request_id: body.client_request_id || null,
  };

  // Get room stub
  const roomStub = getRoomStub(env, tenant_id, roomId);

  // Send message
  const response = await roomStub.fetch(new Request('http://internal/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'send_message',
      payload: input,
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: Message;
    error?: string;
  };

  if (!result.success || !result.data) {
    if (result.error?.includes('not initialized')) {
      throw notFoundError('Room', roomId);
    }
    throw new Error(result.error || 'Failed to send message');
  }

  const sendResponse: Omit<SendMessageResponse, 'request_id' | 'server_time'> = {
    message: result.data,
  };

  return createdResponse(sendResponse, request_id);
}

/**
 * Handles GET /api/rooms/:roomId/history request.
 * Gets message history for a room.
 */
export async function handleGetHistory(
  env: Env,
  ctx: IdentityContext,
  roomId: string,
  query: URLSearchParams
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Validate room ID
  validateRoomId(roomId);

  // Parse query parameters
  const cursorParam = query.get('cursor');
  const limitParam = query.get('limit');

  const historyQuery: HistoryQuery = {
    cursor: cursorParam ? parseInt(cursorParam, 10) : null,
    limit: limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50,
  };

  // Get room stub
  const roomStub = getRoomStub(env, tenant_id, roomId);

  // Get history
  const response = await roomStub.fetch(new Request('http://internal/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'get_history',
      payload: historyQuery,
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: HistoryResult;
    error?: string;
  };

  if (!result.success || !result.data) {
    if (result.error?.includes('not initialized')) {
      throw notFoundError('Room', roomId);
    }
    throw new Error(result.error || 'Failed to get history');
  }

  const historyResponse: Omit<GetHistoryResponse, 'request_id' | 'server_time'> = {
    messages: result.data.messages,
    next_cursor: result.data.next_cursor,
  };

  return jsonResponse(historyResponse, request_id);
}
