/**
 * `buildApp(opts)` — constructs a fresh Hono application with all routes,
 * middleware, MCP transport, and Stripe webhook wired up. The `src/index.ts`
 * bootstrap calls this with default options; tests construct their own with
 * an overridden `resolveContext`.
 */

import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import type { Context, Next } from 'hono';

import { mountMcp } from './mcp/transport.ts';
import type { McpContext } from './mcp/context.ts';
import { authMiddleware } from './middleware/auth.ts';
import { usageMiddleware } from './middleware/usage.ts';
import { registerStripeWebhook } from './billing/webhook.ts';
import { db } from './db/client.ts';
import { env } from './lib/env.ts';
import { log } from './lib/log.ts';
import type { AuthPrincipal } from './auth/types.ts';

export interface BuildAppOptions {
  /**
   * Override the per-request McpContext resolver. When omitted, the resolver
   * derives the context from the authenticated principal set by `authMiddleware`.
   */
  resolveContext?: (c: Context) => Promise<McpContext | Response>;

  /**
   * Permit unauthenticated requests as anonymous read-only principals (only honored
   * in non-production). Defaults to `true` in development, `false` in production.
   */
  allowAnonymous?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Hono {
  const allowAnonymous = opts.allowAnonymous ?? env().NODE_ENV !== 'production';

  const app = new Hono();

  app.use('*', honoLogger((msg) => log.info(msg)));

  // Public, unauthenticated endpoints.
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/', (c) =>
    c.json({
      name: 'snap-ai',
      mcp: '/mcp',
      docs: 'https://github.com/idanmann10/snap-ai',
    }),
  );

  // Stripe webhook is mounted before the auth gate — it verifies signatures
  // itself and must accept unauthenticated POSTs from Stripe.
  registerStripeWebhook(app);

  // Auth + usage metering apply to everything below.
  app.use('*', authMiddleware({ allowAnonymous }));
  app.use('*', usageMiddleware());

  mountMcp(app, {
    resolveContext:
      opts.resolveContext ?? (async (c: Context) => deriveMcpContext(c)),
  });

  return app;
}

async function deriveMcpContext(c: Context): Promise<McpContext> {
  const principal = c.get('principal') as AuthPrincipal | undefined;
  return {
    db: db(),
    clientHash: principal?.clientHash ?? 'anonymous',
    ...(principal?.orgId !== undefined ? { orgId: principal.orgId } : {}),
    scopes: principal?.scopes ?? ['deals:read'],
  };
}

// Re-export `Next` so module consumers can type their own middleware without
// reaching into 'hono' directly.
export type { Next };
