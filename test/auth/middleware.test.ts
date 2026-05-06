import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock env to a stable test config so we don't need real env vars.
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

// Hoist a stub so the auth middleware sees our mock.
const verifyApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/auth/api-key.ts', async () => {
  // `vi.importActual` returns the real module so we can spread its other
  // exports while overriding `verifyApiKey` with our spy.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual<typeof import('../../src/auth/api-key.ts')>(
    '../../src/auth/api-key.ts',
  );
  return {
    ...actual,
    verifyApiKey: verifyApiKeyMock,
  };
});

import { authMiddleware } from '../../src/middleware/auth.ts';
import { requireScope } from '../../src/middleware/scope.ts';
import type { AuthPrincipal } from '../../src/auth/types.ts';

function buildApp(opts?: { allowAnonymous?: boolean; scope?: 'admin' | 'deals:read' }) {
  const app = new Hono();
  app.use('*', authMiddleware(opts ? { allowAnonymous: opts.allowAnonymous ?? false } : {}));
  if (opts?.scope) {
    app.use('*', requireScope(opts.scope));
  }
  app.get('/protected', (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const principal = (c as any).get('principal') as AuthPrincipal | undefined;
    return c.json({ ok: true, hash: principal?.clientHash ?? null });
  });
  return app;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    verifyApiKeyMock.mockReset();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const app = buildApp();
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
    expect(verifyApiKeyMock).not.toHaveBeenCalled();
  });

  it('returns 401 when verifyApiKey returns null', async () => {
    verifyApiKeyMock.mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer sk_live_garbage' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_api_key');
    expect(verifyApiKeyMock).toHaveBeenCalledWith('sk_live_garbage');
  });

  it('returns 200 with a valid api key principal', async () => {
    const principal: AuthPrincipal = {
      clientHash: 'a'.repeat(64),
      orgId: 'org_test',
      userId: 'user_test',
      scopes: ['deals:read'],
      plan: 'starter',
      source: 'api_key',
    };
    verifyApiKeyMock.mockResolvedValueOnce(principal);
    const app = buildApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer sk_live_good' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hash: string };
    expect(body).toEqual({ ok: true, hash: 'a'.repeat(64) });
  });

  it('falls through anonymous in non-prod when allowAnonymous is set', async () => {
    const app = buildApp({ allowAnonymous: true });
    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hash: string };
    expect(body.hash).toBe('anonymous');
  });
});

describe('requireScope', () => {
  beforeEach(() => {
    verifyApiKeyMock.mockReset();
  });

  it('returns 403 when principal lacks the scope', async () => {
    const principal: AuthPrincipal = {
      clientHash: 'b'.repeat(64),
      scopes: ['deals:read'],
      plan: 'free',
      source: 'api_key',
    };
    verifyApiKeyMock.mockResolvedValueOnce(principal);
    const app = buildApp({ scope: 'admin' });
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer sk_live_lowscope' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required: string };
    expect(body).toEqual({ error: 'forbidden', required: 'admin' });
  });

  it('returns 200 when principal has the scope', async () => {
    const principal: AuthPrincipal = {
      clientHash: 'c'.repeat(64),
      scopes: ['deals:read'],
      plan: 'free',
      source: 'api_key',
    };
    verifyApiKeyMock.mockResolvedValueOnce(principal);
    const app = buildApp({ scope: 'deals:read' });
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer sk_live_okay' },
    });
    expect(res.status).toBe(200);
  });
});
