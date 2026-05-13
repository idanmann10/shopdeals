/**
 * HTTP-level tests for the landing page. Boots a real Hono app, swaps the env
 * and DB modules for in-memory fakes, and drives requests with `app.request(...)`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/env.ts', () => ({
  env: () => ({
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://localhost/test',
    MCP_PUBLIC_URL: 'http://localhost:3000',
    MCP_OAUTH_ISSUER: 'http://localhost:3000',
    FMTC_BASE_URL: 'https://account.fmtc.co/cp/api',
  }),
  resetEnvCache: () => undefined,
}));

vi.mock('../../src/db/client.ts', () => ({
  db: () => ({
    // The landing stats query uses `execute` directly. Return zeros so
    // the `/` route renders the placeholder strip without hitting a real DB.
    execute: vi.fn(async () => ({
      rows: [{ deal_count: 0, merchant_count: 0, last_ingest_hours_ago: null }],
    })),
  }),
  closeDb: vi.fn(async () => undefined),
  pool: vi.fn(),
  schema: {},
}));

// The auth middleware imports verifyApiKey; we don't exercise auth here but
// the import graph still drags it in.
import type * as ApiKeyModule from '../../src/auth/api-key.ts';
vi.mock('../../src/auth/api-key.ts', async () => {
  const actual = await vi.importActual<typeof ApiKeyModule>('../../src/auth/api-key.ts');
  return { ...actual, verifyApiKey: vi.fn() };
});

import { buildApp } from '../../src/server.ts';

describe('landing page', () => {
  it('serves HTML at /', async () => {
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('shopdeals');
    // Three install cards must all render — these are the primary CTAs.
    expect(body).toContain('Add to Claude');
    expect(body).toContain('Add to ChatGPT');
    expect(body).toContain('Add to Cursor');
    // Install CTAs must point at the production MCP endpoint.
    expect(body).toContain('https://mcp.shopdeals.sh/mcp');
    // The reusable brand-mark SVG symbol must be defined exactly once.
    expect(body).toContain('id="sd-mark"');
  });

  it('keeps /api as the machine-readable discovery endpoint', async () => {
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/api');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name?: string; mcp?: string };
    expect(body.name).toBe('shopdeals');
    expect(body.mcp).toBe('/mcp');
  });
});
