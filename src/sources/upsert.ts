/**
 * Canonical upsert pipeline: consume a `SourceAdapter`'s async iterable and
 * persist each `RawDealInput` to Postgres via Drizzle.
 *
 * Strategy:
 *   1. Open an `ingest_runs` row in `running` state.
 *   2. Stream items in batches of `batchSize` (default 200).
 *   3. For each batch, in a single transaction:
 *      a. Upsert merchants by `slug` (unique index `merchants_slug_unique`).
 *      b. Resolve merchant ids and upsert deals targeting the
 *         (`source_network`, `source_id`) unique index `deals_source_unique`.
 *   4. On success, update the run to `completed` with counts. On failure,
 *      mark `failed` and rethrow.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db as dbFactory, type Db } from '../db/client.ts';
import { deals, ingestRuns, merchants } from '../db/schema.ts';
import type { NewDeal, NewMerchant } from '../db/schema.ts';
import { log } from '../lib/log.ts';
import {
  normalizeMerchantInput,
  type IngestResult,
  type RawDealInput,
  type SourceAdapter,
} from './common.ts';

const DEFAULT_BATCH_SIZE = 200;

export interface UpsertOptions {
  batchSize?: number;
  /**
   * Inject a database instance. Tests pass a fake; production omits it and
   * gets the real Drizzle client from `db/client.ts`.
   */
  db?: Db;
}

/**
 * Run a full ingest cycle for one adapter. Records start/finish in
 * `ingest_runs` and returns the final counts.
 */
export async function upsertDeals(
  adapter: SourceAdapter,
  opts: UpsertOptions = {}
): Promise<IngestResult> {
  const database = opts.db ?? dbFactory();
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);

  const [run] = await database
    .insert(ingestRuns)
    .values({ sourceNetwork: adapter.network, status: 'running' })
    .returning({ id: ingestRuns.id });

  const runId = run?.id;
  log.info({ network: adapter.network, runId }, 'ingest run started');

  const merchantsSeen = new Set<string>();
  let dealsUpserted = 0;
  let merchantsUpserted = 0;

  const buffer: RawDealInput[] = [];

  try {
    for await (const raw of adapter.fetch()) {
      buffer.push(raw);
      if (buffer.length >= batchSize) {
        const result = await flushBatch(database, buffer, merchantsSeen);
        dealsUpserted += result.dealsUpserted;
        merchantsUpserted += result.merchantsUpserted;
        buffer.length = 0;
        log.debug(
          { network: adapter.network, dealsUpserted, merchantsUpserted },
          'batch flushed'
        );
      }
    }

    if (buffer.length > 0) {
      const result = await flushBatch(database, buffer, merchantsSeen);
      dealsUpserted += result.dealsUpserted;
      merchantsUpserted += result.merchantsUpserted;
      buffer.length = 0;
    }

    if (runId) {
      await database
        .update(ingestRuns)
        .set({
          status: 'completed',
          finishedAt: new Date(),
          dealsUpserted,
          merchantsUpserted,
        })
        .where(eq(ingestRuns.id, runId));
    }

    log.info(
      { network: adapter.network, runId, dealsUpserted, merchantsUpserted },
      'ingest run completed'
    );

    return { dealsUpserted, merchantsUpserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ network: adapter.network, runId, err: message }, 'ingest run failed');
    if (runId) {
      await database
        .update(ingestRuns)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          dealsUpserted,
          merchantsUpserted,
          errorMessage: message.slice(0, 4000),
        })
        .where(eq(ingestRuns.id, runId))
        .catch(() => {
          /* swallow — primary error is more important */
        });
    }
    throw err;
  }
}

/**
 * Flush a single batch in a transaction. Tracks which merchant slugs we've
 * already counted so the caller's `merchantsUpserted` is per-distinct-slug
 * rather than per-row.
 */
async function flushBatch(
  database: Db,
  batch: RawDealInput[],
  merchantsSeen: Set<string>
): Promise<IngestResult> {
  if (batch.length === 0) return { dealsUpserted: 0, merchantsUpserted: 0 };

  // Pre-normalize merchants so we can dedupe by slug within the batch.
  const merchantBySlug = new Map<string, RawDealInput['merchant']>();
  const normalizedItems: Array<{ raw: RawDealInput; slug: string }> = [];
  for (const raw of batch) {
    const merchant = normalizeMerchantInput(raw.merchant);
    if (!merchant.slug) {
      log.warn({ sourceId: raw.sourceId, network: raw.sourceNetwork }, 'skipping deal with empty slug');
      continue;
    }
    merchantBySlug.set(merchant.slug, merchant);
    normalizedItems.push({ raw, slug: merchant.slug });
  }
  if (normalizedItems.length === 0) return { dealsUpserted: 0, merchantsUpserted: 0 };

  let batchMerchants = 0;
  let batchDeals = 0;

  await database.transaction(async (tx) => {
    // 1. Upsert merchants. We use ON CONFLICT (slug) DO UPDATE so we get back
    //    the row id whether we inserted or updated.
    const merchantValues: NewMerchant[] = [...merchantBySlug.values()].map((m) => ({
      slug: m.slug,
      displayName: m.displayName,
      domains: m.domains ?? [],
      categories: m.categories ?? [],
      countries: m.countries ?? [],
      affiliateNetworks: [],
      ...(m.homepageUrl ? { homepageUrl: m.homepageUrl } : {}),
      lastSyncedAt: new Date(),
    }));

    const inserted = await tx
      .insert(merchants)
      .values(merchantValues)
      .onConflictDoUpdate({
        target: merchants.slug,
        set: {
          displayName: sql`excluded.display_name`,
          // Coalesce domains/categories/countries: keep existing array, append
          // any new entries from `excluded`. Postgres' array_cat + uniq trick.
          domains: sql`(
            SELECT ARRAY(SELECT DISTINCT unnest(${merchants.domains} || excluded.domains))
          )`,
          categories: sql`(
            SELECT ARRAY(SELECT DISTINCT unnest(${merchants.categories} || excluded.categories))
          )`,
          countries: sql`(
            SELECT ARRAY(SELECT DISTINCT unnest(${merchants.countries} || excluded.countries))
          )`,
          homepageUrl: sql`COALESCE(excluded.homepage_url, ${merchants.homepageUrl})`,
          lastSyncedAt: sql`excluded.last_synced_at`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: merchants.id, slug: merchants.slug });

    // Count distinct merchant slugs we hadn't seen before in this run.
    for (const row of inserted) {
      if (!merchantsSeen.has(row.slug)) {
        merchantsSeen.add(row.slug);
        batchMerchants += 1;
      }
    }

    // Build a slug -> id map. `inserted` should cover all slugs in this
    // batch, but if a network duplicates rows we fall back to a SELECT to
    // backfill any missing.
    const idBySlug = new Map<string, string>();
    for (const row of inserted) idBySlug.set(row.slug, row.id);
    const missing = [...merchantBySlug.keys()].filter((s) => !idBySlug.has(s));
    if (missing.length > 0) {
      const rows = await tx
        .select({ id: merchants.id, slug: merchants.slug })
        .from(merchants)
        .where(inArray(merchants.slug, missing));
      for (const row of rows) idBySlug.set(row.slug, row.id);
    }

    // 2. Build the deal rows now that we have merchant ids.
    const dealValues: NewDeal[] = [];
    for (const item of normalizedItems) {
      const merchantId = idBySlug.get(item.slug);
      if (!merchantId) {
        log.warn({ slug: item.slug, sourceId: item.raw.sourceId }, 'no merchant id resolved');
        continue;
      }
      const raw = item.raw;
      dealValues.push({
        merchantId,
        kind: raw.kind,
        ...(raw.code !== undefined ? { code: raw.code } : {}),
        title: raw.title,
        ...(raw.description !== undefined ? { description: raw.description } : {}),
        discountType: raw.discountType ?? 'unknown',
        ...(raw.discountValueBps !== undefined ? { discountValueBps: raw.discountValueBps } : {}),
        ...(raw.discountValueCents !== undefined
          ? { discountValueCents: raw.discountValueCents }
          : {}),
        ...(raw.cartMinCents !== undefined ? { cartMinCents: raw.cartMinCents } : {}),
        geoScope: raw.geoScope ?? [],
        segment: raw.segment ?? 'general',
        ...(raw.startsAt ? { startsAt: raw.startsAt } : {}),
        ...(raw.expiresAt ? { expiresAt: raw.expiresAt } : {}),
        ...(raw.deeplink !== undefined ? { deeplink: raw.deeplink } : {}),
        ...(raw.attributionSource !== undefined
          ? { attributionSource: raw.attributionSource }
          : {}),
        sourceNetwork: raw.sourceNetwork,
        sourceId: raw.sourceId,
        ...(raw.sourceMeta !== undefined ? { sourceMeta: raw.sourceMeta } : {}),
        isActive: raw.expiresAt ? raw.expiresAt.getTime() > Date.now() : true,
      });
    }

    if (dealValues.length === 0) return;

    const upsertedDeals = await tx
      .insert(deals)
      .values(dealValues)
      .onConflictDoUpdate({
        target: [deals.sourceNetwork, deals.sourceId],
        set: {
          merchantId: sql`excluded.merchant_id`,
          kind: sql`excluded.kind`,
          code: sql`excluded.code`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          discountType: sql`excluded.discount_type`,
          discountValueBps: sql`excluded.discount_value_bps`,
          discountValueCents: sql`excluded.discount_value_cents`,
          cartMinCents: sql`excluded.cart_min_cents`,
          geoScope: sql`excluded.geo_scope`,
          segment: sql`excluded.segment`,
          startsAt: sql`excluded.starts_at`,
          expiresAt: sql`excluded.expires_at`,
          deeplink: sql`excluded.deeplink`,
          attributionSource: sql`excluded.attribution_source`,
          sourceMeta: sql`excluded.source_meta`,
          isActive: sql`excluded.is_active`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: deals.id });

    batchDeals = upsertedDeals.length;
  });

  return { dealsUpserted: batchDeals, merchantsUpserted: batchMerchants };
}
