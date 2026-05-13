/**
 * `buildApp(opts)` — constructs a fresh Hono application with all routes,
 * middleware, and the MCP transport wired up. The `src/index.ts` bootstrap
 * calls this with default options; tests construct their own with an
 * overridden `resolveContext`.
 */

import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import type { Context } from 'hono';

import { mountMcp } from './mcp/transport.ts';
import type { McpContext } from './mcp/context.ts';
import { authMiddleware } from './middleware/auth.ts';
import { usageMiddleware } from './middleware/usage.ts';
import { globalMcpRateLimiter } from './lib/rate-limit.ts';
import { db } from './db/client.ts';
import { log } from './lib/log.ts';
import { KeepaClient } from './sources/keepa.ts';
import { landingHtml } from './landing/page.ts';
import { loadLandingStats } from './landing/stats.ts';
import { createAffiliateRewriter } from './lib/affiliate.ts';
import { SerpApiClient } from './lib/serpapi.ts';
import type { AuthPrincipal } from './auth/types.ts';

export interface BuildAppOptions {
  /**
   * Override the per-request McpContext resolver. When omitted, the resolver
   * derives the context from the authenticated principal set by `authMiddleware`.
   */
  resolveContext?: (c: Context) => Promise<McpContext | Response>;

  /**
   * Permit unauthenticated requests as anonymous read-only principals. The route
   * allowlist in `isAnonymousAllowed` decides which paths anonymous can reach in
   * production (currently `/`, `/api`, `/healthz`, `/v1/oauth/*`, `/mcp*`); other
   * routes still return 401. Defaults to `true`.
   */
  allowAnonymous?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): Hono {
  const allowAnonymous = opts.allowAnonymous ?? true;

  const app = new Hono();

  app.use('*', honoLogger((msg) => log.info(msg)));

  // Public, unauthenticated endpoints.
  app.get('/healthz', (c) => c.json({ ok: true }));

  // HTML landing page lives at `/`. Machine-readable discovery moved to
  // `/api` so agents can still introspect without parsing HTML.
  // Stats query failure renders with `—` placeholders rather than 500.
  app.get('/', async (c) => {
    const stats = await loadLandingStats(db()).catch(() => ({}));
    return c.html(landingHtml(stats));
  });
  app.get('/api', (c) =>
    c.json({
      name: 'shopdeals',
      mcp: '/mcp',
      docs: 'https://github.com/idanmann10/shopdeals',
    }),
  );

  // Auth + usage metering apply to everything below.
  app.use('*', authMiddleware({ allowAnonymous }));
  app.use('*', usageMiddleware());

  // Global rate limit on /mcp* — guards against runaway loops and scraping
  // even before the request reaches the MCP protocol layer. Returns a clean
  // 429 with `Retry-After` so well-behaved clients back off. Anonymous traffic
  // (no API key — the documented free-tier path) is bucketed per source IP so
  // one looping client can't starve everyone else who's sharing the
  // `'anonymous'` clientHash.
  app.use('/mcp*', async (c: Context, next) => {
    const principal = c.get('principal') as AuthPrincipal;
    const key =
      principal.source === 'anonymous'
        ? `anon:${clientIp(c) ?? 'unknown'}`
        : principal.clientHash;
    const result = globalMcpRateLimiter.consume(key);
    if (!result.ok) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: `Rate limit exceeded — retry in ${result.retryAfterSec}s. The hosted shopdeals server allows 60 calls/min per client.`,
          },
          id: null,
        },
        429,
        { 'Retry-After': String(result.retryAfterSec) },
      );
    }
    await next();
  });

  mountMcp(app, {
    resolveContext:
      opts.resolveContext ?? (async (c: Context) => deriveMcpContext(c)),
  });

  return app;
}

// Shared singletons. Keepa is stateless aside from config; per-request
// construction would only thrash the env() cache. The affiliate rewriter
// holds the resolved env-derived tag set so a flip of AMAZON_ASSOCIATES_TAG
// (or future tags) requires a process restart — that's intentional, we
// don't want a partial deploy emitting half-tagged links.
const keepaClient = new KeepaClient();
const affiliateRewriter = createAffiliateRewriter();
const serpApiClient = new SerpApiClient();

function clientIp(c: Context): string | undefined {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    undefined
  );
}

async function deriveMcpContext(c: Context): Promise<McpContext> {
  // `principal` is guaranteed by `authMiddleware`: it either sets one or
  // returns 401 before this resolver runs.
  const principal = c.get('principal') as AuthPrincipal;
  return {
    db: db(),
    clientHash: principal.clientHash,
    ...(principal.orgId !== undefined ? { orgId: principal.orgId } : {}),
    scopes: principal.scopes,
    keepa: keepaClient,
    affiliate: affiliateRewriter,
    serpapi: serpApiClient,
  };
}
