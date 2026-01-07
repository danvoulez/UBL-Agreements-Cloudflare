/**
 * UBL MVP-1 Receipts Handler
 * Handles receipt lookup
 */

import type {
  Env,
  IdentityContext,
  Atom,
  GetReceiptResponse,
} from '../types';
import { jsonResponse } from '../utils/response';
import { validationError, notFoundError } from '../utils/errors';

/**
 * Handles GET /api/receipts/:seq request.
 * Gets atoms for a given sequence number.
 */
export async function handleGetReceipt(
  env: Env,
  ctx: IdentityContext,
  seq: string
): Promise<Response> {
  const { identity, tenant_id, request_id } = ctx;

  // Validate seq
  const seqNum = parseInt(seq, 10);
  if (isNaN(seqNum) || seqNum < 1) {
    throw validationError('Invalid sequence number');
  }

  // Get ledger stub
  const ledgerKey = `${tenant_id}|ledger|0`;
  const ledgerDO = env.LEDGER_SHARD_OBJECT.idFromName(ledgerKey);
  const ledgerStub = env.LEDGER_SHARD_OBJECT.get(ledgerDO);

  // Get atoms by seq
  const response = await ledgerStub.fetch(new Request('http://internal/getbyseq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'get_by_seq',
      payload: { seq: seqNum },
      identity,
      request_id,
    }),
  }));

  const result = await response.json() as {
    success: boolean;
    data?: Atom[];
    error?: string;
  };

  if (!result.success) {
    throw new Error(result.error || 'Failed to get receipt');
  }

  if (!result.data || result.data.length === 0) {
    throw notFoundError('Receipt', seq);
  }

  const receiptResponse: Omit<GetReceiptResponse, 'request_id' | 'server_time'> = {
    seq: seqNum,
    atoms: result.data,
  };

  return jsonResponse(receiptResponse, request_id);
}
