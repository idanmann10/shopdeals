/**
 * Auth types: `AuthPrincipal`, `Scope`, `Plan`, `StoredApiKey`, `AuthError`.
 *
 * Scope strings are stable identifiers persisted in Clerk org/user
 * `publicMetadata.apiKeys[].scopes` and checked by `requireScope`.
 */

export type Scope = 'deals:read' | 'deals:contribute' | 'prices:read' | 'admin';

export type Plan = 'free' | 'starter' | 'pro' | 'enterprise';

export type AuthSource = 'api_key' | 'oauth' | 'anonymous';

export interface AuthPrincipal {
  /** sha256 hex of the api key, or `'anonymous'` for unauthenticated callers. */
  clientHash: string;
  orgId?: string;
  userId?: string;
  scopes: Scope[];
  plan: Plan;
  source: AuthSource;
}

/**
 * Persisted form of an API key inside Clerk org/user `publicMetadata.apiKeys`.
 * Only the hash is stored — the raw key is shown to the operator exactly once.
 */
export interface StoredApiKey {
  hash: string;
  scopes: Scope[];
  plan: Plan;
  label?: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Specific error class so callers can branch on `err.code` instead of string-matching.
 */
export class AuthError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}
