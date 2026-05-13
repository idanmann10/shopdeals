/**
 * HTTP-level tests for the landing page and the waitlist endpoint. Boots a
 * real Hono app, swaps the env + DB modules for in-memory fakes, and drives
 * requests with `app.request(...)`. No MSW / real Postgres.
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

// Capture the rows the waitlist route asks us to insert so the assertions can
// look at them. `returning()` resolves to whatever the test queues up next —
// `[]` for the "already on list" path, `[{id}]` for the "new signup" path.
const waitlistInserts: unknown[] = [];
let nextReturning: Array<{ id: string }> = [{ id: 'fake-id' }];

vi.mock('../../src/db/client.ts', () => {
  const insertChain = {
    values: vi.fn((vals: unknown) => {
      waitlistInserts.push(vals);
      return insertChain;
    }),
    onConflictDoNothing: vi.fn(() => insertChain),
    returning: vi.fn(async () => nextReturning),
  };
  return {
    db: () => ({
      insert: vi.fn(() => insertChain),
      // The landing stats query uses `execute` directly. Return zeros so
      // the `/` route renders the placeholder strip without hitting a real DB.
      execute: vi.fn(async () => ({
        rows: [{ deal_count: 0, merchant_count: 0, last_ingest_hours_ago: null }],
      })),
    }),
    closeDb: vi.fn(async () => undefined),
    pool: vi.fn(),
    schema: {},
  };
});

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

describe('POST /api/waitlist', () => {
  it('records a new signup and returns alreadyOnList=false', async () => {
    waitlistInserts.length = 0;
    nextReturning = [{ id: 'new-id' }];
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'New@Example.com',
        source: 'landing',
        referrer: 'https://twitter.com/foo',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; alreadyOnList: boolean };
    expect(body).toEqual({ ok: true, alreadyOnList: false });
    expect(waitlistInserts).toHaveLength(1);
    const inserted = waitlistInserts[0] as Record<string, string>;
    // Email is lowercased by the zod transform.
    expect(inserted['email']).toBe('new@example.com');
    expect(inserted['source']).toBe('landing');
    expect(inserted['referrer']).toBe('https://twitter.com/foo');
  });

  it('reports alreadyOnList=true when the conflict clause skips the insert', async () => {
    waitlistInserts.length = 0;
    nextReturning = [];
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dup@example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; alreadyOnList: boolean };
    expect(body).toEqual({ ok: true, alreadyOnList: true });
  });

  it('rejects invalid email with 400', async () => {
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });

  it('rejects malformed JSON with 400', async () => {
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});
