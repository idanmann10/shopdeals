import { z } from 'zod';
import { and, arrayOverlaps, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { discountSummary, eligibilitySummary } from '../format.ts';
import { decodeCursor, encodeCursor } from '../cursor.ts';

export const name = 'find_deals';

export const description =
  'Search active merchant-verified deals. Filter by merchant slug, free-text query, country, category, and minimum cart total. Returns paginated results ordered most-recently-ingested first.';

export const inputSchema = z.object({
  merchant: z.string().optional(),
  query: z.string().optional(),
  country: z.string().length(2).optional(),
  category: z.string().optional(),
  cartTotalCents: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
});

export type FindDealsInput = z.infer<typeof inputSchema>;

export interface FindDealsResultItem {
  id: string;
  merchantSlug: string;
  merchantName: string;
  kind: string;
  code?: string;
  title: string;
  description?: string;
  discountSummary: string;
  eligibilitySummary: string;
  deeplink?: string;
  attributionSource?: string;
  lastSeenWorkingAt?: string;
  successRate?: number;
  expiresAt?: string;
}

export interface FindDealsResult extends Record<string, unknown> {
  deals: FindDealsResultItem[];
  nextCursor?: string;
}

interface CursorPayload extends Record<string, unknown> {
  ingestedAt: string;
  id: string;
}

export async function handler(
  input: FindDealsInput,
  ctx: McpContext,
): Promise<FindDealsResult> {
  const conditions = [
    eq(deals.isActive, true),
    or(isNull(deals.expiresAt), gt(deals.expiresAt, sql`now()`)),
  ];

  if (input.merchant) {
    conditions.push(eq(merchants.slug, input.merchant));
  }

  if (input.country) {
    // Match deals scoped to this country OR global (empty geoScope).
    const country = input.country.toUpperCase();
    conditions.push(
      or(
        sql`cardinality(${deals.geoScope}) = 0`,
        arrayOverlaps(deals.geoScope, [country]),
      )!,
    );
  }

  if (input.category) {
    conditions.push(arrayOverlaps(merchants.categories, [input.category]));
  }

  if (input.cartTotalCents != null) {
    conditions.push(
      or(isNull(deals.cartMinCents), lte(deals.cartMinCents, input.cartTotalCents))!,
    );
  }

  if (input.query) {
    // TODO: replace with embeddings-based similarity once ingestion populates
    // `deals.embedding_digest` / a vector column. For v1 we ILIKE both fields.
    const needle = `%${input.query}%`;
    conditions.push(
      or(sql`${deals.title} ILIKE ${needle}`, sql`${deals.description} ILIKE ${needle}`)!,
    );
  }

  // Keyset pagination on (ingestedAt desc, id desc).
  const cursor = decodeCursor<CursorPayload>(input.cursor);
  if (cursor) {
    const cursorTs = new Date(cursor.ingestedAt);
    conditions.push(
      or(
        lt(deals.ingestedAt, cursorTs),
        and(eq(deals.ingestedAt, cursorTs), lt(deals.id, cursor.id)),
      )!,
    );
  }

  const rows = await ctx.db
    .select({
      id: deals.id,
      merchantSlug: merchants.slug,
      merchantName: merchants.displayName,
      kind: deals.kind,
      code: deals.code,
      title: deals.title,
      description: deals.description,
      discountType: deals.discountType,
      discountValueBps: deals.discountValueBps,
      discountValueCents: deals.discountValueCents,
      cartMinCents: deals.cartMinCents,
      segment: deals.segment,
      geoScope: deals.geoScope,
      deeplink: deals.deeplink,
      attributionSource: deals.attributionSource,
      lastSeenWorkingAt: deals.lastSeenWorkingAt,
      successRate: deals.successRate,
      expiresAt: deals.expiresAt,
      ingestedAt: deals.ingestedAt,
    })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(and(...conditions))
    // NOTE: ordering is `(ingestedAt, id) DESC` only — this matches the keyset
    // cursor payload exactly so pagination is deterministic. We previously
    // primary-ordered by `successRate DESC NULLS LAST` but the cursor never
    // carried `successRate`, so consecutive pages could skip or duplicate
    // rows. For v1 we accept reverse-chronological ordering; quality ranking
    // (e.g. success-rate weighting or a Haiku rerank) belongs in a follow-up
    // pipeline stage that consumes this deterministic page list.
    .orderBy(desc(deals.ingestedAt), desc(deals.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  const items: FindDealsResultItem[] = page.map((r) => {
    const item: FindDealsResultItem = {
      id: r.id,
      merchantSlug: r.merchantSlug,
      merchantName: r.merchantName,
      kind: r.kind,
      title: r.title,
      discountSummary: discountSummary({
        discountType: r.discountType,
        discountValueBps: r.discountValueBps,
        discountValueCents: r.discountValueCents,
      }),
      eligibilitySummary: eligibilitySummary({
        cartMinCents: r.cartMinCents,
        segment: r.segment,
        geoScope: r.geoScope,
      }),
    };
    if (r.code != null) item.code = r.code;
    if (r.description != null) item.description = r.description;
    if (r.deeplink != null) item.deeplink = r.deeplink;
    if (r.attributionSource != null) item.attributionSource = r.attributionSource;
    if (r.lastSeenWorkingAt != null) item.lastSeenWorkingAt = r.lastSeenWorkingAt.toISOString();
    if (r.successRate != null) item.successRate = r.successRate;
    if (r.expiresAt != null) item.expiresAt = r.expiresAt.toISOString();
    return item;
  });

  const result: FindDealsResult = { deals: items };
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      result.nextCursor = encodeCursor({
        ingestedAt: last.ingestedAt.toISOString(),
        id: last.id,
      } satisfies CursorPayload);
    }
  }
  return result;
}
