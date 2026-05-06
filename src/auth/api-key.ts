/**
 * API key minting + verification.
 *
 * Storage model (v1):
 *   - We store SHA-256 hashes of API keys inside Clerk org `publicMetadata.apiKeys`
 *     (or user `publicMetadata.apiKeys` for personal keys).
 *   - The raw key (`sk_live_<32 hex>`) is shown to the operator exactly once at mint
 *     time. Only the hash is persisted.
 *   - Verification iterates org/user lists looking for a matching hash.
 *
 * TODO(v2): Replace the org/user iteration with a Redis-backed
 *   `hash -> { orgId, userId, scopes, plan }` lookup. The current implementation
 *   is correct but O(N) over all orgs/users — fine for boot-strapping, not for
 *   prod traffic.
 */

import { createHash, randomBytes } from 'node:crypto';
import { clerkClient, defaultScopesFor, isClerkConfigured } from './clerk.ts';
import { AuthError } from './types.ts';
import type { AuthPrincipal, Plan, Scope, StoredApiKey } from './types.ts';

const API_KEY_PREFIX = 'sk_live_';
const API_KEY_BYTES = 16; // 16 bytes -> 32 hex chars
const ITERATION_PAGE_SIZE = 100;

/** sha256 hex of the raw api key. Used as both lookup key and `clientHash`. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export interface ParsedAuthHeader {
  type: 'bearer' | 'unknown';
  token?: string;
}

/**
 * Parse an `Authorization` header. Only `Bearer <token>` is supported; anything
 * else (including missing) returns `{ type: 'unknown' }`.
 */
export function parseAuthorizationHeader(header: string | undefined): ParsedAuthHeader {
  if (!header) return { type: 'unknown' };
  const trimmed = header.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { type: 'unknown' };
  const scheme = trimmed.slice(0, space).toLowerCase();
  const token = trimmed.slice(space + 1).trim();
  if (scheme === 'bearer' && token.length > 0) {
    return { type: 'bearer', token };
  }
  return { type: 'unknown' };
}

function isExpired(stored: StoredApiKey, now = Date.now()): boolean {
  if (!stored.expiresAt) return false;
  const ts = Date.parse(stored.expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now;
}

function principalFromStored(
  stored: StoredApiKey,
  ctx: { orgId?: string; userId?: string },
): AuthPrincipal {
  const principal: AuthPrincipal = {
    clientHash: stored.hash,
    scopes: stored.scopes,
    plan: stored.plan,
    source: 'api_key',
  };
  if (ctx.orgId !== undefined) principal.orgId = ctx.orgId;
  if (ctx.userId !== undefined) principal.userId = ctx.userId;
  return principal;
}

function readStoredKeys(metadata: unknown): StoredApiKey[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const apiKeys = (metadata as { apiKeys?: unknown }).apiKeys;
  if (!Array.isArray(apiKeys)) return [];
  // Best-effort filter; we don't zod-validate hot path.
  return apiKeys.filter(
    (k): k is StoredApiKey =>
      !!k &&
      typeof k === 'object' &&
      typeof (k as StoredApiKey).hash === 'string' &&
      Array.isArray((k as StoredApiKey).scopes) &&
      typeof (k as StoredApiKey).plan === 'string',
  );
}

/**
 * Look up an API key by iterating Clerk orgs and users (paginated).
 * Returns null on no-match, no Clerk configured, expired key, or any error.
 *
 * TODO(v2): swap for a Redis-backed reverse-index keyed on hash.
 */
export async function verifyApiKey(rawKey: string): Promise<AuthPrincipal | null> {
  if (!rawKey) return null;
  if (!isClerkConfigured()) return null;
  const hash = hashApiKey(rawKey);

  const client = clerkClient();

  // 1) Search orgs.
  try {
    let offset = 0;
    while (true) {
      const page = await client.organizations.getOrganizationList({
        limit: ITERATION_PAGE_SIZE,
        offset,
      });
      const orgs = page.data ?? [];
      for (const org of orgs) {
        const stored = readStoredKeys(org.publicMetadata).find((k) => k.hash === hash);
        if (stored && !isExpired(stored)) {
          return principalFromStored(stored, { orgId: org.id });
        }
      }
      if (orgs.length < ITERATION_PAGE_SIZE) break;
      offset += ITERATION_PAGE_SIZE;
    }
  } catch {
    // Swallow and try users; verification failures must not leak.
  }

  // 2) Search users.
  try {
    let offset = 0;
    while (true) {
      const page = await client.users.getUserList({
        limit: ITERATION_PAGE_SIZE,
        offset,
      });
      const users = page.data ?? [];
      for (const user of users) {
        const stored = readStoredKeys(user.publicMetadata).find((k) => k.hash === hash);
        if (stored && !isExpired(stored)) {
          return principalFromStored(stored, { userId: user.id });
        }
      }
      if (users.length < ITERATION_PAGE_SIZE) break;
      offset += ITERATION_PAGE_SIZE;
    }
  } catch {
    return null;
  }

  return null;
}

export interface MintApiKeyOpts {
  orgId: string;
  userId: string;
  scopes?: Scope[];
  plan: Plan;
  label?: string;
  /** Optional ISO-8601 expiry; omit for never-expiring. */
  expiresAt?: string;
}

export interface MintApiKeyResult {
  /** Raw key — show to operator ONCE; never persisted. */
  key: string;
  /** sha256 hex of the key. Persisted in Clerk metadata + used as `clientHash`. */
  hash: string;
}

/**
 * Generate a new API key, hash it, append to the org's `publicMetadata.apiKeys`,
 * and return the raw key + hash. The raw key is the only time we surface plain text.
 */
export async function mintApiKey(opts: MintApiKeyOpts): Promise<MintApiKeyResult> {
  if (!isClerkConfigured()) {
    throw new AuthError('clerk_not_configured', 'Clerk is not configured', 500);
  }
  const rawKey = generateRawKey();
  const hash = hashApiKey(rawKey);

  const scopes = opts.scopes ?? defaultScopesFor(opts.plan);
  const stored: StoredApiKey = {
    hash,
    scopes,
    plan: opts.plan,
    createdAt: new Date().toISOString(),
  };
  if (opts.label !== undefined) stored.label = opts.label;
  if (opts.expiresAt !== undefined) stored.expiresAt = opts.expiresAt;

  const client = clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: opts.orgId });
  const existing = readStoredKeys(org.publicMetadata);
  const next = [...existing, stored];

  await client.organizations.updateOrganizationMetadata(opts.orgId, {
    publicMetadata: {
      ...((org.publicMetadata as Record<string, unknown>) ?? {}),
      apiKeys: next,
    } as never,
  });

  return { key: rawKey, hash };
}

/** Generate a raw API key. Exposed for tests. */
export function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(API_KEY_BYTES).toString('hex');
}

export const API_KEY_INTERNALS = {
  API_KEY_PREFIX,
  API_KEY_BYTES,
} as const;
