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
  return and(
    eq(deals.isActive, true),
    or(isNull(deals.expiresAt), gt(deals.expiresAt, new Date())),
  )!;
}
