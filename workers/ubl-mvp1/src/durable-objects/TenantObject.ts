/**
 * UBL MVP-1 TenantObject Durable Object
 *
 * Manages tenant state including:
 * - Tenant configuration and settings
 * - Member management (roles, email, join date)
 * - Room directory
 *
 * Storage keys:
 * - tenant: JSON blob (Tenant record)
 * - rooms: JSON blob (array of room summaries)
 *
 * Per Blueprint:
 * - Auto-create tenant on first request
 * - Auto-add first user as owner
 * - Create TenantLicense Agreement on creation
 * - Auto-create r:general room
 */

import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  Identity,
  Tenant,
  TenantRole,
  TenantType,
  TenantMember,
  TenantDefaults,
  RoomSummary,
  DORequest,
  DOResponse,
} from '../types';
import {
  generateRoomId,
  generateRequestId,
} from '../utils/hash';
import {
  createTenantLicenseAgreement,
  createRoomGovernanceAgreement,
  storeAgreement,
} from '../utils/agreements';

/**
 * Default tenant settings.
 */
const DEFAULT_TENANT_DEFAULTS: TenantDefaults = {
  room_mode: 'internal',
  retention_days: 30,
  max_message_bytes: 8000,
};

/**
 * Default room name.
 */
const DEFAULT_ROOM_NAME = 'general';

export class TenantObject extends DurableObject<Env> {
  private tenant: Tenant | null = null;
  private rooms: RoomSummary[] = [];
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initializes the DO by loading state from storage.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    const [tenant, rooms] = await Promise.all([
      this.ctx.storage.get<Tenant>('tenant'),
      this.ctx.storage.get<RoomSummary[]>('rooms'),
    ]);

    this.tenant = tenant || null;
    this.rooms = rooms || [];
    this.initialized = true;
  }

  /**
   * Saves tenant to storage.
   */
  private async saveTenant(): Promise<void> {
    if (this.tenant) {
      await this.ctx.storage.put('tenant', this.tenant);
    }
  }

  /**
   * Saves rooms to storage.
   */
  private async saveRooms(): Promise<void> {
    await this.ctx.storage.put('rooms', this.rooms);
  }

  /**
   * Creates a new tenant with the given identity as owner.
   */
  private async createTenant(
    tenantId: string,
    identity: Identity,
    tenantType: TenantType = 'customer'
  ): Promise<Tenant> {
    const now = new Date().toISOString();

    const tenant: Tenant = {
      tenant_id: tenantId,
      type: tenantType,
      created_at: now,
      members: {
        [identity.user_id]: {
          role: 'owner',
          email: identity.email,
          joined_at: now,
        },
      },
      defaults: { ...DEFAULT_TENANT_DEFAULTS },
    };

    this.tenant = tenant;
    await this.saveTenant();

    // Store TenantLicense Agreement in D1
    const agreement = createTenantLicenseAgreement(tenantId, identity.user_id);
    try {
      await storeAgreement(this.env.D1_LEDGER, agreement);
    } catch (error) {
      console.error('Failed to store tenant agreement:', error);
      // Continue even if agreement storage fails
    }

    return tenant;
  }

  /**
   * Adds a member to the tenant.
   */
  private async addMember(
    userId: string,
    email: string,
    role: TenantRole = 'member'
  ): Promise<void> {
    if (!this.tenant) {
      throw new Error('Tenant not initialized');
    }

    if (this.tenant.members[userId]) {
      return; // Already a member
    }

    const now = new Date().toISOString();
    this.tenant.members[userId] = {
      role,
      email,
      joined_at: now,
    };

    await this.saveTenant();
  }

  /**
   * Gets a member's info.
   */
  private getMember(userId: string): TenantMember | null {
    if (!this.tenant) return null;
    return this.tenant.members[userId] || null;
  }

  /**
   * Creates the default r:general room.
   */
  private async createDefaultRoom(tenantId: string, identity: Identity): Promise<RoomSummary> {
    const roomId = generateRoomId(DEFAULT_ROOM_NAME);
    const now = new Date().toISOString();

    const roomSummary: RoomSummary = {
      room_id: roomId,
      name: DEFAULT_ROOM_NAME,
      mode: 'internal',
      created_at: now,
    };

    this.rooms.push(roomSummary);
    await this.saveRooms();

    // Store RoomGovernance Agreement in D1
    const agreement = createRoomGovernanceAgreement(roomId, tenantId, identity.user_id);
    try {
      await storeAgreement(this.env.D1_LEDGER, agreement);
    } catch (error) {
      console.error('Failed to store room agreement:', error);
    }

    // Initialize the RoomObject
    const roomKey = `${tenantId}|${roomId}`;
    const roomDO = this.env.ROOM_OBJECT.idFromName(roomKey);
    const roomStub = this.env.ROOM_OBJECT.get(roomDO);

    try {
      await roomStub.fetch(new Request('http://internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'init',
          payload: {
            tenant_id: tenantId,
            room_id: roomId,
            name: DEFAULT_ROOM_NAME,
            mode: 'internal',
            creator_id: identity.user_id,
          },
          identity,
          request_id: generateRequestId(),
        }),
      }));
    } catch (error) {
      console.error('Failed to initialize room:', error);
    }

    return roomSummary;
  }

  /**
   * Ensures tenant exists and identity is a member.
   * Auto-creates tenant and adds member if needed (frictionless MVP-1).
   */
  async ensureTenantAndMember(
    tenantId: string,
    identity: Identity
  ): Promise<{ tenant: Tenant; role: TenantRole }> {
    await this.initialize();

    // Auto-create tenant if it doesn't exist
    if (!this.tenant) {
      const tenantType: TenantType = tenantId === 't:ubl_core' ? 'platform' : 'customer';
      await this.createTenant(tenantId, identity, tenantType);
      await this.createDefaultRoom(tenantId, identity);
    }

    // Auto-add member if not already a member (frictionless MVP-1)
    let member = this.getMember(identity.user_id);
    if (!member) {
      await this.addMember(identity.user_id, identity.email, 'member');
      member = this.getMember(identity.user_id);
    }

    if (!member || !this.tenant) {
      throw new Error('Failed to ensure tenant and member');
    }

    return {
      tenant: this.tenant,
      role: member.role,
    };
  }

  /**
   * Lists all rooms in the tenant.
   */
  async listRooms(): Promise<RoomSummary[]> {
    await this.initialize();
    return [...this.rooms];
  }

  /**
   * Creates a new room.
   */
  async createRoom(
    tenantId: string,
    name: string,
    identity: Identity
  ): Promise<RoomSummary> {
    await this.initialize();

    if (!this.tenant) {
      throw new Error('Tenant not initialized');
    }

    const roomId = generateRoomId(name);
    const now = new Date().toISOString();

    // Check if room already exists
    const existing = this.rooms.find(r => r.room_id === roomId);
    if (existing) {
      return existing;
    }

    const roomSummary: RoomSummary = {
      room_id: roomId,
      name,
      mode: 'internal',
      created_at: now,
    };

    this.rooms.push(roomSummary);
    await this.saveRooms();

    // Store RoomGovernance Agreement in D1
    const agreement = createRoomGovernanceAgreement(roomId, tenantId, identity.user_id);
    try {
      await storeAgreement(this.env.D1_LEDGER, agreement);
    } catch (error) {
      console.error('Failed to store room agreement:', error);
    }

    // Initialize the RoomObject
    const roomKey = `${tenantId}|${roomId}`;
    const roomDO = this.env.ROOM_OBJECT.idFromName(roomKey);
    const roomStub = this.env.ROOM_OBJECT.get(roomDO);

    try {
      await roomStub.fetch(new Request('http://internal/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'init',
          payload: {
            tenant_id: tenantId,
            room_id: roomId,
            name,
            mode: 'internal',
            creator_id: identity.user_id,
          },
          identity,
          request_id: generateRequestId(),
        }),
      }));
    } catch (error) {
      console.error('Failed to initialize room:', error);
    }

    return roomSummary;
  }

  /**
   * Gets room by ID.
   */
  async getRoom(roomId: string): Promise<RoomSummary | null> {
    await this.initialize();
    return this.rooms.find(r => r.room_id === roomId) || null;
  }

  /**
   * Gets tenant info.
   */
  async getTenant(): Promise<Tenant | null> {
    await this.initialize();
    return this.tenant;
  }

  /**
   * HTTP request handler for the Durable Object.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Handle internal requests
      if (request.method === 'POST') {
        const body = await request.json() as DORequest;
        const { type, payload, identity, request_id } = body;

        switch (type) {
          case 'ensure_tenant_and_member': {
            const { tenant_id } = payload as { tenant_id: string };
            const result = await this.ensureTenantAndMember(tenant_id, identity);
            return new Response(JSON.stringify({ success: true, data: result }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'list_rooms': {
            const rooms = await this.listRooms();
            return new Response(JSON.stringify({ success: true, data: rooms }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'create_room': {
            const { tenant_id, name } = payload as { tenant_id: string; name: string };
            const room = await this.createRoom(tenant_id, name, identity);
            return new Response(JSON.stringify({ success: true, data: room }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_room': {
            const { room_id } = payload as { room_id: string };
            const room = await this.getRoom(room_id);
            return new Response(JSON.stringify({ success: true, data: room }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          case 'get_tenant': {
            const tenant = await this.getTenant();
            return new Response(JSON.stringify({ success: true, data: tenant }), {
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
      console.error('TenantObject error:', error);
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
