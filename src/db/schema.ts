import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------- Enums ----------

export const dealKind = pgEnum('deal_kind', ['code', 'automatic', 'cashback', 'sale', 'bogo']);

export const discountType = pgEnum('discount_type', [
  'pct_off',
  'amt_off',
  'free_shipping',
  'gift',
  'tiered',
  'unknown',
]);

export const segment = pgEnum('segment', [
  'general',
  'new_customer',
  'student',
  'military',
  'email_signup',
  'first_app_purchase',
]);

export const verificationDifficulty = pgEnum('verification_difficulty', [
  'easy',
  'medium',
  'hard',
]);

export const sourceNetwork = pgEnum('source_network', [
  'fmtc',
  'awin',
  'impact',
  'cj',
  'rakuten',
  'skimlinks',
  'partnerize',
  'slickdeals',
  'manual',
  'telemetry',
]);

// ---------- Tables ----------

export const merchants = pgTable(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 256 }).notNull(),
    domains: text('domains').array().notNull().default(sql`ARRAY[]::text[]`),
    categories: text('categories').array().notNull().default(sql`ARRAY[]::text[]`),
    countries: varchar('countries', { length: 2 }).array().notNull().default(sql`ARRAY[]::varchar[]`),
    affiliateNetworks: jsonb('affiliate_networks').$type<
      Array<{ network: string; advertiserId: string; programStatus?: string }>
    >().notNull().default(sql`'[]'::jsonb`),
    cashbackRateBps: integer('cashback_rate_bps'),
    attributionSource: varchar('attribution_source', { length: 64 }),
    verificationDifficulty: verificationDifficulty('verification_difficulty').default('medium').notNull(),
    logoUrl: text('logo_url'),
    homepageUrl: text('homepage_url'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex('merchants_slug_unique').on(t.slug),
    domainsIdx: index('merchants_domains_idx').using('gin', t.domains),
    categoriesIdx: index('merchants_categories_idx').using('gin', t.categories),
  })
);

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    kind: dealKind('kind').notNull(),
    code: varchar('code', { length: 128 }),
    title: varchar('title', { length: 512 }).notNull(),
    description: text('description'),
    discountType: discountType('discount_type').notNull().default('unknown'),
    discountValueBps: integer('discount_value_bps'),
    discountValueCents: integer('discount_value_cents'),
    cartMinCents: integer('cart_min_cents'),
    skuScope: jsonb('sku_scope').$type<{
      includeSkus?: string[];
      excludeSkus?: string[];
      categories?: string[];
      brandFilter?: string[];
    }>(),
    geoScope: varchar('geo_scope', { length: 2 }).array().notNull().default(sql`ARRAY[]::varchar[]`),
    segment: segment('segment').notNull().default('general'),
    stackRules: jsonb('stack_rules').$type<{
      stackableWith?: string[];
      exclusiveGroups?: string[];
      maxStack?: number;
    }>(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deeplink: text('deeplink'),
    attributionSource: varchar('attribution_source', { length: 64 }),
    sourceNetwork: sourceNetwork('source_network').notNull(),
    sourceId: varchar('source_id', { length: 256 }).notNull(),
    sourceMeta: jsonb('source_meta').$type<Record<string, unknown>>(),
    dedupGroupId: uuid('dedup_group_id'),
    embeddingDigest: varchar('embedding_digest', { length: 64 }),
    lastSeenWorkingAt: timestamp('last_seen_working_at', { withTimezone: true }),
    successRate: real('success_rate'),
    successSampleCount: integer('success_sample_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    merchantIdx: index('deals_merchant_idx').on(t.merchantId),
    activeMerchantIdx: index('deals_active_merchant_idx').on(t.isActive, t.merchantId),
    sourceUnique: uniqueIndex('deals_source_unique').on(t.sourceNetwork, t.sourceId),
    expiresIdx: index('deals_expires_idx').on(t.expiresAt),
    dedupGroupIdx: index('deals_dedup_group_idx').on(t.dedupGroupId),
    geoIdx: index('deals_geo_idx').using('gin', t.geoScope),
  })
);

export const telemetry = pgTable(
  'telemetry',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    reportedAt: timestamp('reported_at', { withTimezone: true }).defaultNow().notNull(),
    worked: boolean('worked').notNull(),
    effectiveDiscountCents: integer('effective_discount_cents'),
    cartTotalCents: integer('cart_total_cents'),
    countryCode: varchar('country_code', { length: 2 }),
    clientHash: varchar('client_hash', { length: 64 }).notNull(),
    notes: text('notes'),
  },
  (t) => ({
    dealReportedIdx: index('telemetry_deal_reported_idx').on(t.dealId, t.reportedAt),
    clientIdx: index('telemetry_client_idx').on(t.clientHash, t.reportedAt),
  })
);

export const prices = pgTable(
  'prices',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    asin: varchar('asin', { length: 16 }),
    productUrl: text('product_url'),
    productKey: varchar('product_key', { length: 256 }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    availability: varchar('availability', { length: 32 }),
    source: varchar('source', { length: 32 }).notNull(),
  },
  (t) => ({
    productObservedIdx: index('prices_product_observed_idx').on(t.productKey, t.observedAt),
    asinIdx: index('prices_asin_idx').on(t.asin),
  })
);

export const apiUsage = pgTable(
  'api_usage',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    clientHash: varchar('client_hash', { length: 64 }).notNull(),
    orgId: varchar('org_id', { length: 64 }),
    userId: varchar('user_id', { length: 64 }),
    tool: varchar('tool', { length: 64 }).notNull(),
    units: integer('units').notNull().default(1),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    stripeReported: boolean('stripe_reported').notNull().default(false),
  },
  (t) => ({
    clientOccurredIdx: index('api_usage_client_occurred_idx').on(t.clientHash, t.occurredAt),
    unreportedIdx: index('api_usage_unreported_idx').on(t.stripeReported, t.occurredAt),
  })
);

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceNetwork: sourceNetwork('source_network').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: varchar('status', { length: 32 }).notNull().default('running'),
    dealsUpserted: integer('deals_upserted').notNull().default(0),
    merchantsUpserted: integer('merchants_upserted').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (t) => ({
    sourceStartedIdx: index('ingest_runs_source_started_idx').on(t.sourceNetwork, t.startedAt),
  })
);

export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 320 }).notNull(),
    source: varchar('source', { length: 64 }),
    referrer: text('referrer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailUnique: uniqueIndex('waitlist_email_unique').on(t.email),
  })
);

// ---------- Types ----------

export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Telemetry = typeof telemetry.$inferSelect;
export type NewTelemetry = typeof telemetry.$inferInsert;
export type Price = typeof prices.$inferSelect;
export type NewPrice = typeof prices.$inferInsert;
export type ApiUsage = typeof apiUsage.$inferSelect;
export type NewApiUsage = typeof apiUsage.$inferInsert;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type NewWaitlistEntry = typeof waitlist.$inferInsert;

// Composite primary key not used; left here for future dedup_pairs etc.
export const _exports = { primaryKey };
