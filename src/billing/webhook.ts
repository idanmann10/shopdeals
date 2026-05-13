/**
 * No-op shim left behind after Stripe was removed (shopdeals is now a free,
 * open, rate-limited public MCP server — see `docs/MONETIZATION.md`).
 *
 * `src/server.ts` still imports `registerStripeWebhook`; rather than touch
 * `server.ts` from this cleanup PR, we keep the export but register no route.
 * The whole `src/billing/` directory should be deleted once the import in
 * `src/server.ts` is removed in a follow-up.
 */

import type { Hono } from 'hono';

export function registerStripeWebhook(_app: Hono): void {
  // intentionally no-op — Stripe billing has been removed.
}
