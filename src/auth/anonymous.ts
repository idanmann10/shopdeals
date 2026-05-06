/**
 * Anonymous principal used for unauthenticated requests.
 *
 * In development we accept anonymous on most routes (with `deals:read` only) so
 * local clients can poke at the server without minting keys. In production
 * anonymous access is restricted to a small allow-list of public routes.
 */

import type { AuthPrincipal } from './types.ts';

export const ANONYMOUS_CLIENT_HASH = 'anonymous';

const PUBLIC_ROUTE_PREFIXES = ['/healthz', '/v1/oauth/'];
const PUBLIC_ROUTE_EXACT = new Set(['/']);

export function anonymousPrincipal(): AuthPrincipal {
  return {
    clientHash: ANONYMOUS_CLIENT_HASH,
    scopes: ['deals:read'],
    plan: 'free',
    source: 'anonymous',
  };
}

/**
 * In production, anonymous is only allowed on public routes.
 * In non-production, anonymous is allowed everywhere (subject to opt-in via middleware).
 */
export function isAnonymousAllowed(path: string, nodeEnv: string): boolean {
  if (nodeEnv !== 'production') return true;
  if (PUBLIC_ROUTE_EXACT.has(path)) return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}
