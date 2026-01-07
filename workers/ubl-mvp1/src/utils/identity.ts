/**
 * UBL MVP-1 Identity Module
 * Handles identity normalization and tenant resolution from Cloudflare Access.
 *
 * Identity resolution (from Blueprint):
 * - User ID: "u:<stable-sub>" from Access JWT
 * - Tenant ID: "t:<email_domain>" deterministic from email domain
 * - Platform users: "t:ubl_core" for platform operations
 */

import type { Identity, IdentityContext, TenantRole } from '../types';
import { generateTenantId, generateUserId, generateRequestId } from './hash';

/**
 * Platform tenant ID for UBL core operations.
 */
export const PLATFORM_TENANT_ID = 't:ubl_core';

/**
 * Platform email domains that map to the platform tenant.
 */
const PLATFORM_DOMAINS = ['ubl.agency', 'voulezvous.tv'];

/**
 * Access JWT claims structure from Cloudflare Access.
 */
interface AccessJWTClaims {
  sub: string;           // Stable subject identifier
  email: string;         // User email
  iss: string;           // Issuer (your Access team domain)
  iat: number;           // Issued at timestamp
  exp: number;           // Expiration timestamp
  type?: string;         // Optional: "app" for service tokens
  common_name?: string;  // Optional: for service tokens
  country?: string;      // Optional: country from IP
  custom?: {             // Optional: custom SAML/OIDC claims
    groups?: string[];
  };
}

/**
 * Extracts email domain from an email address.
 *
 * @param email - The email address
 * @returns The domain part of the email
 */
export function extractEmailDomain(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[1]) {
    throw new Error(`Invalid email address: ${email}`);
  }
  return parts[1].toLowerCase();
}

/**
 * Determines if an email domain belongs to the platform tenant.
 *
 * @param emailDomain - The email domain to check
 * @returns true if this is a platform domain
 */
export function isPlatformDomain(emailDomain: string): boolean {
  return PLATFORM_DOMAINS.includes(emailDomain.toLowerCase());
}

/**
 * Resolves tenant ID from an email domain.
 * Platform domains map to PLATFORM_TENANT_ID, others to "t:<domain>".
 *
 * @param emailDomain - The email domain
 * @returns The tenant ID
 */
export function resolveTenantId(emailDomain: string): string {
  if (isPlatformDomain(emailDomain)) {
    return PLATFORM_TENANT_ID;
  }
  return generateTenantId(emailDomain);
}

/**
 * Normalizes identity from Cloudflare Access JWT claims.
 *
 * @param claims - The JWT claims from Access
 * @returns Normalized Identity object
 */
export function normalizeIdentity(claims: AccessJWTClaims): Identity {
  const emailDomain = extractEmailDomain(claims.email);
  const isService = claims.type === 'app';

  return {
    user_id: generateUserId(claims.sub),
    email: claims.email.toLowerCase(),
    email_domain: emailDomain,
    groups: claims.custom?.groups || [],
    is_service: isService,
  };
}

/**
 * Creates a full identity context including tenant resolution.
 *
 * @param claims - The JWT claims from Access
 * @param requestId - Optional request ID (generated if not provided)
 * @returns Full IdentityContext object
 */
export function createIdentityContext(
  claims: AccessJWTClaims,
  requestId?: string
): Omit<IdentityContext, 'role'> & { role: TenantRole | null } {
  const identity = normalizeIdentity(claims);
  const tenant_id = resolveTenantId(identity.email_domain);

  return {
    identity,
    tenant_id,
    role: null, // Role is determined after tenant lookup
    request_id: requestId || generateRequestId(),
  };
}

/**
 * Parses the CF-Access-JWT-Assertion header to extract claims.
 * In production, this should verify the JWT signature against the Access public key.
 *
 * @param jwtAssertion - The JWT assertion from CF-Access-JWT-Assertion header
 * @returns Parsed JWT claims
 */
export function parseAccessJWT(jwtAssertion: string): AccessJWTClaims {
  // Split JWT into parts
  const parts = jwtAssertion.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  // Decode the payload (second part)
  const payloadPart = parts[1];
  if (!payloadPart) {
    throw new Error('Invalid JWT: missing payload');
  }

  try {
    // Base64url decode
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(paddedBase64);
    const claims = JSON.parse(decoded) as AccessJWTClaims;

    // Validate required fields
    if (!claims.sub || !claims.email) {
      throw new Error('Invalid JWT: missing required claims');
    }

    return claims;
  } catch (error) {
    throw new Error(`Failed to parse JWT: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Extracts identity from request headers.
 * Uses CF-Access-JWT-Assertion for authenticated requests.
 *
 * @param request - The incoming request
 * @returns IdentityContext or null if not authenticated
 */
export function extractIdentityFromRequest(
  request: Request
): Omit<IdentityContext, 'role'> & { role: TenantRole | null } | null {
  // Check for Access JWT assertion
  const jwtAssertion = request.headers.get('CF-Access-JWT-Assertion');

  if (!jwtAssertion) {
    return null;
  }

  try {
    const claims = parseAccessJWT(jwtAssertion);
    const requestId = request.headers.get('X-Request-Id') || generateRequestId();
    return createIdentityContext(claims, requestId);
  } catch (error) {
    console.error('Failed to extract identity:', error);
    return null;
  }
}

/**
 * Creates a development/testing identity.
 * Only for use in development environments.
 *
 * @param email - The email to use for the identity
 * @returns IdentityContext for development
 */
export function createDevIdentity(
  email: string = 'dev@example.com'
): Omit<IdentityContext, 'role'> & { role: TenantRole | null } {
  const emailDomain = extractEmailDomain(email);

  const identity: Identity = {
    user_id: generateUserId(`dev-${email}`),
    email: email.toLowerCase(),
    email_domain: emailDomain,
    groups: [],
    is_service: false,
  };

  return {
    identity,
    tenant_id: resolveTenantId(emailDomain),
    role: null,
    request_id: generateRequestId(),
  };
}

/**
 * Creates a service identity for bots/automation.
 *
 * @param serviceName - The name of the service
 * @param tenantId - The tenant this service operates in
 * @returns Identity for the service
 */
export function createServiceIdentity(
  serviceName: string,
  tenantId: string
): Identity {
  return {
    user_id: `u:svc-${serviceName}`,
    email: `${serviceName}@service.internal`,
    email_domain: 'service.internal',
    groups: ['service'],
    is_service: true,
  };
}
