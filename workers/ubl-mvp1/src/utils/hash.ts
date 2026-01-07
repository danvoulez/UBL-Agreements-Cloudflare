/**
 * UBL MVP-1 Hashing Module
 * Implements SHA-256 hashing using Web Crypto API.
 *
 * Hash types (from Blueprint):
 * - body_hash: SHA256(canonical_json(message.body))
 * - cid: SHA256(canonical_json(atom_without_cid))
 * - head_hash: SHA256(prev_head_hash + ":" + cid)
 */

import { canonicalizeJSON, removeField } from './canon';
import type { Atom, ActionAtom, EffectAtom, MessageBody } from '../types';

/**
 * Genesis hash constant - the starting point of the hash chain.
 */
export const GENESIS_HASH = 'h:genesis';

/**
 * Prefix constants for hash types.
 */
export const HASH_PREFIX = {
  CID: 'c:',
  HEAD: 'h:',
  BODY: 'b:',
  REQUEST: 'req:',
} as const;

/**
 * Computes SHA-256 hash of a UTF-8 string using Web Crypto API.
 * Returns the hash as a hexadecimal string.
 *
 * @param data - The string to hash
 * @returns Promise resolving to hex-encoded SHA-256 hash
 */
export async function sha256(data: string): Promise<string> {
  // Encode string to UTF-8 bytes
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  // Compute SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Computes SHA-256 hash with a prefix.
 *
 * @param data - The string to hash
 * @param prefix - The prefix to add to the result
 * @returns Promise resolving to prefixed hex-encoded SHA-256 hash
 */
export async function sha256WithPrefix(data: string, prefix: string): Promise<string> {
  const hash = await sha256(data);
  return prefix + hash;
}

/**
 * Computes the body_hash for a message body.
 * body_hash = SHA256(canonical_json(message.body))
 *
 * @param body - The message body object
 * @returns Promise resolving to body hash string (prefixed with "b:")
 */
export async function computeBodyHash(body: MessageBody): Promise<string> {
  const canonical = canonicalizeJSON(body);
  return sha256WithPrefix(canonical, HASH_PREFIX.BODY);
}

/**
 * Computes the CID (Content Identifier) for a ledger atom.
 * cid = SHA256(canonical_json(atom_without_cid))
 *
 * The CID field itself is excluded from the hash computation.
 *
 * @param atom - The atom object (with or without cid field)
 * @returns Promise resolving to CID string (prefixed with "c:")
 */
export async function computeCID(atom: Omit<ActionAtom, 'cid'> | Omit<EffectAtom, 'cid'> | Atom): Promise<string> {
  // Remove the cid field if present
  const atomWithoutCid = 'cid' in atom ? removeField(atom as Atom, 'cid') : atom;

  // Canonicalize and hash
  const canonical = canonicalizeJSON(atomWithoutCid);
  return sha256WithPrefix(canonical, HASH_PREFIX.CID);
}

/**
 * Computes the head_hash for the hash chain.
 * head_hash = SHA256(prev_head_hash + ":" + cid)
 *
 * @param prevHash - The previous head hash (or GENESIS_HASH for the first atom)
 * @param cid - The CID of the current atom
 * @returns Promise resolving to head hash string (prefixed with "h:")
 */
export async function computeHeadHash(prevHash: string, cid: string): Promise<string> {
  const input = `${prevHash}:${cid}`;
  return sha256WithPrefix(input, HASH_PREFIX.HEAD);
}

/**
 * Returns the genesis hash - the starting point of the hash chain.
 *
 * @returns The genesis hash constant
 */
export function genesisHash(): string {
  return GENESIS_HASH;
}

/**
 * Generates a unique request ID.
 *
 * @returns Request ID string (prefixed with "req:")
 */
export function generateRequestId(): string {
  const uuid = crypto.randomUUID();
  return HASH_PREFIX.REQUEST + uuid;
}

/**
 * Generates a unique message ID.
 *
 * @returns Message ID string (prefixed with "m:")
 */
export function generateMessageId(): string {
  const uuid = crypto.randomUUID();
  return 'm:' + uuid;
}

/**
 * Generates a unique room ID from a name.
 *
 * @param name - The room name
 * @returns Room ID string (prefixed with "r:")
 */
export function generateRoomId(name: string): string {
  // Slugify the name: lowercase, replace spaces with dashes, remove special chars
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 50);

  return 'r:' + slug;
}

/**
 * Generates a tenant ID from an email domain.
 *
 * @param emailDomain - The email domain
 * @returns Tenant ID string (prefixed with "t:")
 */
export function generateTenantId(emailDomain: string): string {
  return 't:' + emailDomain.toLowerCase();
}

/**
 * Generates a user ID from a stable identifier (usually from Access JWT sub claim).
 *
 * @param stableSub - The stable subject identifier
 * @returns User ID string (prefixed with "u:")
 */
export function generateUserId(stableSub: string): string {
  return 'u:' + stableSub;
}

/**
 * Generates an agreement ID.
 *
 * @param type - The agreement type (tenant, room, workspace, etc.)
 * @param entityId - The entity ID this agreement governs
 * @returns Agreement ID string (prefixed with "a:")
 */
export function generateAgreementId(type: string, entityId: string): string {
  return `a:${type}:${entityId}`;
}

/**
 * Generates a workspace ID from a name.
 *
 * @param name - The workspace name
 * @returns Workspace ID string (prefixed with "w:")
 */
export function generateWorkspaceId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 50);

  return 'w:' + slug;
}

/**
 * Generates a document ID.
 *
 * @returns Document ID string (prefixed with "d:")
 */
export function generateDocumentId(): string {
  const uuid = crypto.randomUUID();
  return 'd:' + uuid;
}

/**
 * Generates a session ID for MCP sessions.
 *
 * @returns Session ID string (prefixed with "s:")
 */
export function generateSessionId(): string {
  const uuid = crypto.randomUUID();
  return 's:' + uuid;
}

/**
 * Verifies a hash chain by recomputing the head hash.
 *
 * @param prevHash - The previous head hash
 * @param cid - The CID of the current atom
 * @param expectedHeadHash - The expected head hash to verify against
 * @returns Promise resolving to true if verification passes
 */
export async function verifyHeadHash(
  prevHash: string,
  cid: string,
  expectedHeadHash: string
): Promise<boolean> {
  const computed = await computeHeadHash(prevHash, cid);
  return computed === expectedHeadHash;
}

/**
 * Verifies a CID by recomputing it from the atom.
 *
 * @param atom - The atom to verify
 * @returns Promise resolving to true if CID is valid
 */
export async function verifyCID(atom: Atom): Promise<boolean> {
  const computed = await computeCID(atom);
  return computed === atom.cid;
}

/**
 * Computes the content hash for a document.
 *
 * @param content - The document content
 * @returns Promise resolving to content hash string (prefixed with "b:")
 */
export async function computeContentHash(content: string): Promise<string> {
  return sha256WithPrefix(content, HASH_PREFIX.BODY);
}
