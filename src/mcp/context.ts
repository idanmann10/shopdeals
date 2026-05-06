import type { Db } from '../db/client.ts';

/**
 * Per-request execution context for an MCP tool handler.
 *
 * Populated by the transport layer's `resolveContext` hook (typically the auth
 * middleware) and threaded through to every tool. Tools must never reach for
 * a global `db()` — they read from `ctx.db`.
 */
export interface McpContext {
  db: Db;
  clientHash: string;
  orgId?: string;
  scopes: string[];
}
