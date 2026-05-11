import type { Db } from '../db/client.ts';
import type { KeepaClient } from '../sources/keepa.ts';

/**
 * Per-request execution context for an MCP tool handler.
 *
 * Populated by the transport layer's `resolveContext` hook (typically the auth
 * middleware) and threaded through to every tool. Tools must never reach for
 * a global `db()` — they read from `ctx.db`.
 *
 * `keepa` is optional because `get_price_history` is the only tool that uses
 * it. When omitted, the tool falls back to its own default-constructed
 * client (which is a no-op when `KEEPA_API_KEY` is unset).
 */
export interface McpContext {
  db: Db;
  clientHash: string;
  orgId?: string;
  scopes: string[];
  keepa?: KeepaClient;
}
