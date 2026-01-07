/**
 * UBL MVP-1 Agreements Module
 * Implements Agreement tracking following the Agreement-First philosophy.
 *
 * Every action references an Agreement that authorizes it:
 * - TenantLicense Agreement: Authorizes tenant creation and ownership
 * - RoomGovernance Agreement: Authorizes room operations and membership
 * - WorkspaceAgreement: Authorizes workspace/document operations
 * - ToolAccess Agreement: Authorizes MCP tool usage
 */

import type {
  Agreement,
  AgreementType,
  Env,
  Identity
} from '../types';
import { generateAgreementId } from './hash';

/**
 * Creates a TenantLicense Agreement.
 * This Agreement establishes a tenant and grants owner role to the creator.
 *
 * @param tenantId - The tenant ID this agreement governs
 * @param creatorId - The user ID of the creator
 * @returns The created Agreement object
 */
export function createTenantLicenseAgreement(
  tenantId: string,
  creatorId: string
): Agreement {
  const now = new Date().toISOString();

  return {
    id: generateAgreementId('tenant', tenantId),
    type: 'tenant_license',
    tenant_id: tenantId,
    created_at: now,
    created_by: creatorId,
    metadata: {
      terms: 'UBL Platform Terms v1',
      capabilities: ['create_rooms', 'invite_members', 'manage_settings'],
      owner_user_id: creatorId,
    },
  };
}

/**
 * Creates a RoomGovernance Agreement.
 * This Agreement establishes room governance and initial membership.
 *
 * @param roomId - The room ID this agreement governs
 * @param tenantId - The tenant this room belongs to
 * @param creatorId - The user ID of the creator
 * @returns The created Agreement object
 */
export function createRoomGovernanceAgreement(
  roomId: string,
  tenantId: string,
  creatorId: string
): Agreement {
  const now = new Date().toISOString();

  return {
    id: generateAgreementId('room', roomId),
    type: 'room_governance',
    tenant_id: tenantId,
    created_at: now,
    created_by: creatorId,
    metadata: {
      room_id: roomId,
      mode: 'internal',
      capabilities: ['send_messages', 'read_history', 'invite_members'],
      initial_owner: creatorId,
    },
  };
}

/**
 * Creates a WorkspaceAgreement.
 * This Agreement establishes workspace governance for document operations.
 *
 * @param workspaceId - The workspace ID this agreement governs
 * @param tenantId - The tenant this workspace belongs to
 * @param creatorId - The user ID of the creator
 * @returns The created Agreement object
 */
export function createWorkspaceAgreement(
  workspaceId: string,
  tenantId: string,
  creatorId: string
): Agreement {
  const now = new Date().toISOString();

  return {
    id: generateAgreementId('workspace', workspaceId),
    type: 'workspace_agreement',
    tenant_id: tenantId,
    created_at: now,
    created_by: creatorId,
    metadata: {
      workspace_id: workspaceId,
      capabilities: ['create_documents', 'read_documents', 'search_documents', 'llm_complete'],
      initial_owner: creatorId,
    },
  };
}

/**
 * Creates a ToolAccess Agreement.
 * This Agreement authorizes MCP tool usage.
 *
 * @param toolName - The MCP tool name
 * @param tenantId - The tenant this agreement belongs to
 * @param userId - The user ID being granted access
 * @returns The created Agreement object
 */
export function createToolAccessAgreement(
  toolName: string,
  tenantId: string,
  userId: string
): Agreement {
  const now = new Date().toISOString();

  return {
    id: generateAgreementId('tool', `${tenantId}:${toolName}:${userId}`),
    type: 'tool_access',
    tenant_id: tenantId,
    created_at: now,
    created_by: userId,
    metadata: {
      tool_name: toolName,
      user_id: userId,
      granted_capabilities: [toolName],
    },
  };
}

/**
 * Stores an Agreement in D1 database.
 *
 * @param db - The D1 database instance
 * @param agreement - The Agreement to store
 */
export async function storeAgreement(
  db: D1Database,
  agreement: Agreement
): Promise<void> {
  const query = `
    INSERT INTO agreements (id, type, tenant_id, created_at, created_by, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      metadata = excluded.metadata
  `;

  await db.prepare(query).bind(
    agreement.id,
    agreement.type,
    agreement.tenant_id,
    agreement.created_at,
    agreement.created_by,
    JSON.stringify(agreement.metadata)
  ).run();
}

/**
 * Retrieves an Agreement by ID from D1 database.
 *
 * @param db - The D1 database instance
 * @param agreementId - The Agreement ID to retrieve
 * @returns The Agreement if found, null otherwise
 */
export async function getAgreement(
  db: D1Database,
  agreementId: string
): Promise<Agreement | null> {
  const query = `
    SELECT id, type, tenant_id, created_at, created_by, metadata
    FROM agreements
    WHERE id = ?
  `;

  const result = await db.prepare(query).bind(agreementId).first<{
    id: string;
    type: AgreementType;
    tenant_id: string;
    created_at: string;
    created_by: string;
    metadata: string;
  }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    type: result.type,
    tenant_id: result.tenant_id,
    created_at: result.created_at,
    created_by: result.created_by,
    metadata: JSON.parse(result.metadata),
  };
}

/**
 * Lists all Agreements for a tenant.
 *
 * @param db - The D1 database instance
 * @param tenantId - The tenant ID to list agreements for
 * @param type - Optional filter by agreement type
 * @returns Array of Agreements
 */
export async function listAgreements(
  db: D1Database,
  tenantId: string,
  type?: AgreementType
): Promise<Agreement[]> {
  let query = `
    SELECT id, type, tenant_id, created_at, created_by, metadata
    FROM agreements
    WHERE tenant_id = ?
  `;

  const params: string[] = [tenantId];

  if (type) {
    query += ` AND type = ?`;
    params.push(type);
  }

  query += ` ORDER BY created_at DESC`;

  const results = await db.prepare(query).bind(...params).all<{
    id: string;
    type: AgreementType;
    tenant_id: string;
    created_at: string;
    created_by: string;
    metadata: string;
  }>();

  return results.results.map(row => ({
    id: row.id,
    type: row.type,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    created_by: row.created_by,
    metadata: JSON.parse(row.metadata),
  }));
}

/**
 * Checks if a user has a specific capability under an Agreement.
 *
 * @param db - The D1 database instance
 * @param agreementId - The Agreement ID to check
 * @param userId - The user ID to check
 * @param capability - The capability to check for
 * @returns true if the user has the capability
 */
export async function hasCapability(
  db: D1Database,
  agreementId: string,
  userId: string,
  capability: string
): Promise<boolean> {
  const agreement = await getAgreement(db, agreementId);

  if (!agreement) {
    return false;
  }

  const metadata = agreement.metadata as { capabilities?: string[] };
  const capabilities = metadata.capabilities || [];

  return capabilities.includes(capability);
}

/**
 * Gets the Agreement ID for a room.
 *
 * @param roomId - The room ID
 * @returns The Agreement ID
 */
export function getRoomAgreementId(roomId: string): string {
  return generateAgreementId('room', roomId);
}

/**
 * Gets the Agreement ID for a tenant.
 *
 * @param tenantId - The tenant ID
 * @returns The Agreement ID
 */
export function getTenantAgreementId(tenantId: string): string {
  return generateAgreementId('tenant', tenantId);
}

/**
 * Gets the Agreement ID for a workspace.
 *
 * @param workspaceId - The workspace ID
 * @returns The Agreement ID
 */
export function getWorkspaceAgreementId(workspaceId: string): string {
  return generateAgreementId('workspace', workspaceId);
}

/**
 * Validates that an identity has access under an Agreement.
 * Throws an error if access is denied.
 *
 * @param db - The D1 database instance
 * @param agreementId - The Agreement ID to validate against
 * @param identity - The identity to validate
 * @param requiredCapability - The capability required for the operation
 * @throws Error if access is denied
 */
export async function validateAgreementAccess(
  db: D1Database,
  agreementId: string,
  identity: Identity,
  requiredCapability: string
): Promise<void> {
  const agreement = await getAgreement(db, agreementId);

  if (!agreement) {
    throw new Error(`Agreement not found: ${agreementId}`);
  }

  // For MVP-1, we do a simple capability check
  // In MVP-2+, this will be more sophisticated with role-based checks
  const metadata = agreement.metadata as { capabilities?: string[] };
  const capabilities = metadata.capabilities || [];

  if (!capabilities.includes(requiredCapability) && !capabilities.includes('*')) {
    throw new Error(`Access denied: ${requiredCapability} not granted by Agreement ${agreementId}`);
  }
}
