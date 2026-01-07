/**
 * UBL MVP-1 Response Utilities
 * Helpers for creating consistent API responses.
 */

import type {
  APIResponse,
  MCPResponse,
  MCPContent,
  MCPToolCallResult,
} from '../types';

/**
 * CORS headers for API responses.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id, CF-Access-JWT-Assertion',
  'Access-Control-Max-Age': '86400',
};

/**
 * Creates a successful JSON response.
 *
 * @param data - The response data
 * @param requestId - The request ID
 * @param status - HTTP status code (default 200)
 * @returns Response object
 */
export function jsonResponse<T>(
  data: T,
  requestId: string,
  status = 200
): Response {
  const serverTime = new Date().toISOString();

  return new Response(
    JSON.stringify({
      ...data,
      request_id: requestId,
      server_time: serverTime,
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        ...corsHeaders,
      },
    }
  );
}

/**
 * Creates a successful MCP response.
 *
 * @param id - The JSON-RPC request ID
 * @param result - The result data
 * @returns Response object
 */
export function mcpResponse(
  id: number | string | null,
  result: unknown
): Response {
  const response: MCPResponse = {
    jsonrpc: '2.0',
    id,
    result,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Creates an MCP tool call result with JSON content.
 *
 * @param data - The JSON data
 * @returns MCPToolCallResult object
 */
export function mcpToolResult(data: unknown): MCPToolCallResult {
  const content: MCPContent[] = [
    {
      type: 'json',
      json: data,
    },
  ];

  return { content };
}

/**
 * Creates an MCP tool call result with text content.
 *
 * @param text - The text content
 * @returns MCPToolCallResult object
 */
export function mcpTextResult(text: string): MCPToolCallResult {
  const content: MCPContent[] = [
    {
      type: 'text',
      text,
    },
  ];

  return { content };
}

/**
 * Creates a CORS preflight response.
 *
 * @returns Response object for OPTIONS requests
 */
export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Creates an SSE stream response.
 *
 * @param stream - The readable stream
 * @param requestId - The request ID
 * @returns Response object with SSE headers
 */
export function sseResponse(
  stream: ReadableStream,
  requestId: string
): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Request-Id': requestId,
      ...corsHeaders,
    },
  });
}

/**
 * Formats an SSE event.
 *
 * @param id - Event ID (for reconnection)
 * @param event - Event type
 * @param data - Event data (will be JSON stringified)
 * @returns Formatted SSE event string
 */
export function formatSSEEvent(
  id: number | string,
  event: string,
  data: unknown
): string {
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  return `id: ${id}\nevent: ${event}\ndata: ${dataStr}\n\n`;
}

/**
 * Formats an SSE keepalive comment.
 *
 * @returns Keepalive comment string
 */
export function formatSSEKeepalive(): string {
  return ':keepalive\n\n';
}

/**
 * Creates a redirect response.
 *
 * @param url - The URL to redirect to
 * @param status - HTTP status code (default 302)
 * @returns Response object
 */
export function redirectResponse(url: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url,
      ...corsHeaders,
    },
  });
}

/**
 * Creates a 204 No Content response.
 *
 * @returns Response object
 */
export function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Creates a 201 Created response.
 *
 * @param data - The response data
 * @param requestId - The request ID
 * @param location - Optional Location header
 * @returns Response object
 */
export function createdResponse<T>(
  data: T,
  requestId: string,
  location?: string
): Response {
  const serverTime = new Date().toISOString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
    ...corsHeaders,
  };

  if (location) {
    headers['Location'] = location;
  }

  return new Response(
    JSON.stringify({
      ...data,
      request_id: requestId,
      server_time: serverTime,
    }),
    {
      status: 201,
      headers,
    }
  );
}
