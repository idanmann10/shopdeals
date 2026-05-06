import { z } from 'zod';
import { and, arrayOverlaps, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { decodeCursor, encodeCursor } from '../cursor.ts';

export const name = 'list_merchants';

export const description =
  'List supported merchants with paging, optionally filtered by category, country, or display-name substring. Each merchant carries a hasActiveDeals flag.';

export const inputSchema = z.object({
  category: z.string().optional(),
  country: z.string().length(2).optional(),
  query: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type ListMerchantsInput = z.infer<typeof inputSchema>;

export interface ListMerchantsResultItem {
  id: string;
  slug: string;
  displayName: string;
  domains: string[];
  categories: string[];
  countries: string[];
  hasActiveDeals: boolean;
  logoUrl?: string;
  homepageUrl?: string;
}

export interface ListMerchantsResult extends Record<string, unknown> {
  merchants: ListMerchantsResultItem[];
  nextCursor?: string;
}

interface CursorPayload extends Record<string, unknown> {
  displayName: string;
  id: string;
}

export async function handler(
  input: ListMerchantsInput,
  ctx: McpContext,
): Promise<ListMerchantsResult> {
  const conditions = [] as Array<ReturnType<typeof eq>>;

  if (input.category) {
    conditions.push(arrayOverlaps(merchants.categories, [input.category]));
  }

  if (input.country) {
    conditions.push(arrayOverlaps(merchants.countries, [input.country.toUpperCase()]));
  }

  if (input.query) {
    const needle = `%${input.query}%`;
    conditions.push(sql`${merchants.displayName} ILIKE ${needle}` as unknown as ReturnType<typeof eq>);
  }

  const cursor = decodeCursor<CursorPayload>(input.cursor);
  if (cursor) {
    conditions.push(
      or(
        gt(merchants.displayName, cursor.displayName),
        and(eq(merchants.displayName, cursor.displayName), gt(merchants.id, cursor.id)),
      )! as unknown as ReturnType<typeof eq>,
    );
  }

  // Correlated EXISTS subquery for `hasActiveDeals`. Uses fully-qualified
  // Drizzle column references on both the inner table and the outer `merchants`
  // table — relying on a SQL alias here was producing always-false results
  // under certain Postgres configurations.
  const hasActiveDealsExpr = sql<boolean>`EXISTS (
    SELECT 1 FROM ${deals}
    WHERE ${deals.merchantId} = ${merchants.id}
      AND ${deals.isActive} = true
      AND (${deals.expiresAt} IS NULL OR ${deals.expiresAt} > now())
  )`;

  const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await ctx.db
    .select({
      id: merchants.id,
      slug: merchants.slug,
      displayName: merchants.displayName,
      domains: merchants.domains,
      categories: merchants.categories,
      countries: merchants.countries,
      logoUrl: merchants.logoUrl,
      homepageUrl: merchants.homepageUrl,
      hasActiveDeals: hasActiveDealsExpr,
    })
    .from(merchants)
    .where(whereExpr ?? sql`true`)
    .orderBy(asc(merchants.displayName), asc(merchants.id))
    .limit(input.limit + 1);

  // Suppress unused-import warning for `isNull` (kept for symmetry with other tools).
  void isNull;

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const items: ListMerchantsResultItem[] = page.map((r) => {
    const item: ListMerchantsResultItem = {
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      domains: r.domains,
      categories: r.categories,
      countries: r.countries,
      hasActiveDeals: Boolean(r.hasActiveDeals),
    };
    if (r.logoUrl != null) item.logoUrl = r.logoUrl;
    if (r.homepageUrl != null) item.homepageUrl = r.homepageUrl;
    return item;
  });

  const result: ListMerchantsResult = { merchants: items };
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      result.nextCursor = encodeCursor({
        displayName: last.displayName,
        id: last.id,
      } satisfies CursorPayload);
    }
  }
  return result;
}
