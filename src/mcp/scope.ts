/**
 * Scope guard for MCP tool handlers.
 *
 * Tools throw an MCP `InvalidRequest` (-32600) when the resolved principal
 * lacks the required scope. `InvalidRequest` is the closest semantic fit in
 * the JSON-RPC error space the SDK exposes for an authenticated-but-
 * unauthorized request — `ConnectionClosed` (-32000) tears down the session
 * and `MethodNotFound` is wrong because the method exists.
 */
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from './context.ts';

export function requireScope(ctx: McpContext, scope: string): void {
  if (!ctx.scopes.includes(scope)) {
    throw new McpError(ErrorCode.InvalidRequest, `forbidden: ${scope} scope required`);
  }
}
