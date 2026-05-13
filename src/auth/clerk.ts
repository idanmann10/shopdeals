/**
 * Thin wrapper around `@clerk/backend` so the rest of the app can:
 *   - lazily instantiate a singleton `clerkClient()`
 *   - detect whether Clerk is configured at all (dev mode often isn't)
 *
 * If `CLERK_SECRET_KEY` is missing, `clerkClient()` returns a stub that throws on use.
 * Higher-level helpers (e.g. `verifyApiKey`) check `isClerkConfigured()` first and
 * gracefully fall through, so dev environments without Clerk still boot.
 */

import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { env } from '../lib/env.ts';
import type { Plan, Scope } from './types.ts';

let cached: ClerkClient | undefined;

export function isClerkConfigured(): boolean {
  return Boolean(env().CLERK_SECRET_KEY);
}

/**
 * Returns a singleton ClerkClient. If CLERK_SECRET_KEY is missing, returns a
 * `Proxy`-based stub that throws on any property access — callers should gate
 * with `isClerkConfigured()` first.
 */
export function clerkClient(): ClerkClient {
  if (cached) return cached;
  const secretKey = env().CLERK_SECRET_KEY ?? '';
  if (!secretKey) {
    cached = makeStubClerkClient();
    return cached;
  }
  cached = createClerkClient({ secretKey });
  return cached;
}

function makeStubClerkClient(): ClerkClient {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      // Allow `then` to be checked so the stub isn't accidentally awaited as a thenable.
      if (prop === 'then') return undefined;
      throw new Error(
        `Clerk is not configured (CLERK_SECRET_KEY missing); cannot access "${String(prop)}".`,
      );
    },
  };
  return new Proxy({}, handler) as unknown as ClerkClient;
}

/**
 * Default scopes auto-granted per plan tier. New API keys minted under a plan
 * inherit these unless the caller explicitly overrides via the `scopes` arg.
 */
export function defaultScopesFor(plan: Plan): Scope[] {
  switch (plan) {
    case 'free':
      return ['deals:read'];
    case 'starter':
      return ['deals:read', 'deals:contribute'];
    case 'pro':
      return ['deals:read', 'deals:contribute', 'prices:read'];
    case 'enterprise':
      return ['deals:read', 'deals:contribute', 'prices:read', 'admin'];
  }
}
