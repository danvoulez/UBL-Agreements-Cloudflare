/**
 * UBL MVP-1 Whoami Handler
 * GET /api/whoami - Returns identity and tenant information
 */

import type { Env, Identity, IdentityContext, WhoamiResponse } from '../types';
import { jsonResponse } from '../utils/response';

/**
 * Handles GET /api/whoami request.
 * Returns the authenticated user's identity and tenant information.
 */
export async function handleWhoami(
  env: Env,
  ctx: IdentityContext
): Promise<Response> {
  const { identity, tenant_id, role, request_id } = ctx;

  // Ensure tenant exists and get role
  const tenantDO = env.TENANT_OBJECT.idFromName(tenant_id);
  const tenantStub = env.TENANT_OBJECT.get(tenantDO);

  const response = await tenantStub.fetch(new Request('http://internal/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ensure_tenant_and_member',
      payload: { tenant_id },
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: { tenant: unknown; role: string };
    error?: string;
  };

  if (!result.success || !result.data) {
    throw new Error(result.error || 'Failed to ensure tenant');
  }

  const whoamiResponse: Omit<WhoamiResponse, 'request_id' | 'server_time'> = {
    identity,
    tenant_id,
    role: result.data.role as 'owner' | 'admin' | 'member',
  };

  return jsonResponse(whoamiResponse, request_id);
}
