/**
 * UBL MVP-1 Error Handling Module
 * Defines error types and utilities for consistent error handling.
 */

import type { APIError, MCPError } from '../types';

/**
 * Error codes for API responses.
 */
export const ErrorCode = {
  // Authentication errors (401)
  UNAUTHORIZED: 'unauthorized',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'token_expired',

  // Authorization errors (403)
  FORBIDDEN: 'forbidden',
  NOT_A_MEMBER: 'not_a_member',
  INSUFFICIENT_PERMISSIONS: 'insufficient_permissions',
  ORIGIN_NOT_ALLOWED: 'origin_not_allowed',

  // Not found errors (404)
  NOT_FOUND: 'not_found',
  TENANT_NOT_FOUND: 'tenant_not_found',
  ROOM_NOT_FOUND: 'room_not_found',
  MESSAGE_NOT_FOUND: 'message_not_found',
  RECEIPT_NOT_FOUND: 'receipt_not_found',
  WORKSPACE_NOT_FOUND: 'workspace_not_found',
  DOCUMENT_NOT_FOUND: 'document_not_found',

  // Validation errors (400)
  BAD_REQUEST: 'bad_request',
  VALIDATION_ERROR: 'validation_error',
  INVALID_INPUT: 'invalid_input',
  MESSAGE_TOO_LARGE: 'message_too_large',
  INVALID_ROOM_ID: 'invalid_room_id',

  // Conflict errors (409)
  CONFLICT: 'conflict',
  DUPLICATE_REQUEST: 'duplicate_request',
  ROOM_EXISTS: 'room_exists',

  // Rate limiting errors (429)
  RATE_LIMITED: 'rate_limited',

  // Server errors (500)
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * MCP error codes per JSON-RPC 2.0 spec.
 */
export const MCPErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom error codes (must be >= -32000)
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  RATE_LIMITED: -32029,
} as const;

/**
 * HTTP status code mapping for error codes.
 */
const errorStatusMap: Record<ErrorCodeType, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INVALID_TOKEN]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_A_MEMBER]: 403,
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCode.ORIGIN_NOT_ALLOWED]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.TENANT_NOT_FOUND]: 404,
  [ErrorCode.ROOM_NOT_FOUND]: 404,
  [ErrorCode.MESSAGE_NOT_FOUND]: 404,
  [ErrorCode.RECEIPT_NOT_FOUND]: 404,
  [ErrorCode.WORKSPACE_NOT_FOUND]: 404,
  [ErrorCode.DOCUMENT_NOT_FOUND]: 404,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.MESSAGE_TOO_LARGE]: 400,
  [ErrorCode.INVALID_ROOM_ID]: 400,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.DUPLICATE_REQUEST]: 409,
  [ErrorCode.ROOM_EXISTS]: 409,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

/**
 * Custom error class for UBL API errors.
 */
export class UBLError extends Error {
  readonly code: ErrorCodeType;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeType, message: string, details?: unknown) {
    super(message);
    this.name = 'UBLError';
    this.code = code;
    this.status = errorStatusMap[code] || 500;
    this.details = details;
  }

  /**
   * Converts to API error format.
   */
  toAPIError(): APIError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }

  /**
   * Converts to MCP error format.
   */
  toMCPError(): MCPError {
    let mcpCode: number;

    switch (this.code) {
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.INVALID_TOKEN:
      case ErrorCode.TOKEN_EXPIRED:
        mcpCode = MCPErrorCode.UNAUTHORIZED;
        break;
      case ErrorCode.FORBIDDEN:
      case ErrorCode.NOT_A_MEMBER:
      case ErrorCode.INSUFFICIENT_PERMISSIONS:
      case ErrorCode.ORIGIN_NOT_ALLOWED:
        mcpCode = MCPErrorCode.FORBIDDEN;
        break;
      case ErrorCode.NOT_FOUND:
      case ErrorCode.TENANT_NOT_FOUND:
      case ErrorCode.ROOM_NOT_FOUND:
      case ErrorCode.MESSAGE_NOT_FOUND:
      case ErrorCode.RECEIPT_NOT_FOUND:
      case ErrorCode.WORKSPACE_NOT_FOUND:
      case ErrorCode.DOCUMENT_NOT_FOUND:
        mcpCode = MCPErrorCode.NOT_FOUND;
        break;
      case ErrorCode.BAD_REQUEST:
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_INPUT:
      case ErrorCode.MESSAGE_TOO_LARGE:
      case ErrorCode.INVALID_ROOM_ID:
        mcpCode = MCPErrorCode.INVALID_PARAMS;
        break;
      case ErrorCode.RATE_LIMITED:
        mcpCode = MCPErrorCode.RATE_LIMITED;
        break;
      default:
        mcpCode = MCPErrorCode.INTERNAL_ERROR;
    }

    return {
      code: mcpCode,
      message: this.message,
      data: {
        code: this.code,
        details: this.details,
      },
    };
  }
}

/**
 * Creates an unauthorized error.
 */
export function unauthorizedError(message = 'Authentication required'): UBLError {
  return new UBLError(ErrorCode.UNAUTHORIZED, message);
}

/**
 * Creates a forbidden error.
 */
export function forbiddenError(message = 'Access denied'): UBLError {
  return new UBLError(ErrorCode.FORBIDDEN, message);
}

/**
 * Creates a not a member error.
 */
export function notAMemberError(roomId: string): UBLError {
  return new UBLError(
    ErrorCode.NOT_A_MEMBER,
    `You are not a member of room ${roomId}`,
    { room_id: roomId }
  );
}

/**
 * Creates a not found error.
 */
export function notFoundError(resource: string, id?: string): UBLError {
  const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
  return new UBLError(ErrorCode.NOT_FOUND, message, { resource, id });
}

/**
 * Creates a validation error.
 */
export function validationError(message: string, details?: unknown): UBLError {
  return new UBLError(ErrorCode.VALIDATION_ERROR, message, details);
}

/**
 * Creates a message too large error.
 */
export function messageTooLargeError(size: number, maxSize: number): UBLError {
  return new UBLError(
    ErrorCode.MESSAGE_TOO_LARGE,
    `Message size ${size} exceeds maximum ${maxSize}`,
    { size, max_size: maxSize }
  );
}

/**
 * Creates an origin not allowed error.
 */
export function originNotAllowedError(origin: string): UBLError {
  return new UBLError(
    ErrorCode.ORIGIN_NOT_ALLOWED,
    `Origin not allowed: ${origin}`,
    { origin }
  );
}

/**
 * Creates an internal error.
 */
export function internalError(message = 'Internal server error'): UBLError {
  return new UBLError(ErrorCode.INTERNAL_ERROR, message);
}

/**
 * Wraps an unknown error into a UBLError.
 */
export function wrapError(error: unknown): UBLError {
  if (error instanceof UBLError) {
    return error;
  }

  if (error instanceof Error) {
    return new UBLError(ErrorCode.INTERNAL_ERROR, error.message);
  }

  return new UBLError(ErrorCode.INTERNAL_ERROR, String(error));
}

/**
 * Creates a JSON response for an error.
 */
export function errorResponse(
  error: UBLError,
  requestId: string
): Response {
  const serverTime = new Date().toISOString();

  return new Response(
    JSON.stringify({
      error: error.toAPIError(),
      request_id: requestId,
      server_time: serverTime,
    }),
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
    }
  );
}

/**
 * Creates an MCP error response.
 */
export function mcpErrorResponse(
  id: number | string | null,
  error: UBLError | MCPError
): Response {
  const mcpError = error instanceof UBLError ? error.toMCPError() : error;

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: mcpError,
    }),
    {
      status: 200, // MCP errors still return 200
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
