/**
 * Reusable Drizzle SQL predicates for the deals catalog.
 *
 * `dealIsActive()` is the canonical "deal is currently visible to agents"
 * predicate: row is flagged active AND either has no expiry or expires in
 * the future. Used by every read-side tool that surfaces deals.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { deals } from './schema.ts';

export function dealIsActive(): SQL<unknown> {
  // Combine the `is_active=true` flag with the expiry guard. Returning a
  // single SQL fragment lets callers spread it into their own `and(...)`
  // chains alongside per-query filters.
  return and(
    eq(deals.isActive, true),
    or(isNull(deals.expiresAt), gt(deals.expiresAt, new Date())),
  )!;
}
