/**
 * UBL MVP-1 Rooms Handler
 * Handles room listing and creation
 */

import type {
  Env,
  Identity,
  IdentityContext,
  RoomSummary,
  ListRoomsResponse,
  CreateRoomResponse,
} from '../types';
import { jsonResponse, createdResponse } from '../utils/response';
import { validationError } from '../utils/errors';

/**
 * Handles GET /api/rooms request.
 * Lists all rooms the user has access to.
 */
export async function handleListRooms(
  env: Env,
  ctx: IdentityContext
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Ensure tenant exists
  const tenantDO = env.TENANT_OBJECT.idFromName(tenant_id);
  const tenantStub = env.TENANT_OBJECT.get(tenantDO);

  // First ensure tenant and member
  await tenantStub.fetch(new Request('http://internal/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ensure_tenant_and_member',
      payload: { tenant_id },
      identity,
      request_id,
    }),
  }));

  // Then list rooms
  const response = await tenantStub.fetch(new Request('http://internal/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'list_rooms',
      payload: {},
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: RoomSummary[];
    error?: string;
  };

  if (!result.success) {
    throw new Error(result.error || 'Failed to list rooms');
  }

  const listResponse: Omit<ListRoomsResponse, 'request_id' | 'server_time'> = {
    rooms: result.data || [],
  };

  return jsonResponse(listResponse, request_id);
}

/**
 * Handles POST /api/rooms request.
 * Creates a new room.
 */
export async function handleCreateRoom(
  env: Env,
  ctx: IdentityContext,
  body: { name?: string }
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Validate input
  if (!body.name || typeof body.name !== 'string') {
    throw validationError('Room name is required');
  }

  const name = body.name.trim();
  if (name.length < 1 || name.length > 128) {
    throw validationError('Room name must be between 1 and 128 characters');
  }

  // Ensure tenant exists
  const tenantDO = env.TENANT_OBJECT.idFromName(tenant_id);
  const tenantStub = env.TENANT_OBJECT.get(tenantDO);

  // First ensure tenant and member
  await tenantStub.fetch(new Request('http://internal/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ensure_tenant_and_member',
      payload: { tenant_id },
      identity,
      request_id,
    }),
  }));

  // Create room
  const response = await tenantStub.fetch(new Request('http://internal/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'create_room',
      payload: { tenant_id, name },
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: RoomSummary;
    error?: string;
  };

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to create room');
  }

  const createResponse: Omit<CreateRoomResponse, 'request_id' | 'server_time'> = {
    room_id: result.data.room_id,
  };

  return createdResponse(createResponse, request_id);
}
