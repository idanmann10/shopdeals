/**
 * Seed script for local + Railway/Fly demos when no real affiliate-network
 * credentials are configured. Inserts a small but realistic set of merchants
 * and deals so the MCP tools have something to return.
 *
 *   npm run seed
 *
 * Idempotent: re-running upserts the same rows by (slug) and (source_network, source_id).
 */

import { sql } from 'drizzle-orm';
import { closeDb, db } from './client.ts';
import { deals, merchants } from './schema.ts';
import { log } from '../lib/log.ts';

interface SeedDeal {
  merchantSlug: string;
  kind: 'code' | 'automatic' | 'cashback' | 'sale';
  code?: string;
  title: string;
  description: string;
  discountType: 'pct_off' | 'amt_off' | 'free_shipping';
  discountValueBps?: number;
  discountValueCents?: number;
  cartMinCents?: number;
  geoScope: string[];
  expiresAt?: Date;
  deeplink?: string;
}

interface SeedMerchant {
  slug: string;
  displayName: string;
  domains: string[];
  categories: string[];
  countries: string[];
  cashbackRateBps?: number;
  homepageUrl: string;
}

const MERCHANTS: SeedMerchant[] = [
  {
    slug: 'best-buy',
    displayName: 'Best Buy',
    domains: ['bestbuy.com'],
    categories: ['electronics'],
    countries: ['US'],
    cashbackRateBps: 100,
    homepageUrl: 'https://www.bestbuy.com',
  },
  {
    slug: 'dominos',
    displayName: "Domino's Pizza",
    domains: ['dominos.com'],
    categories: ['food', 'restaurants'],
    countries: ['US'],
    homepageUrl: 'https://www.dominos.com',
  },
  {
    slug: 'macys',
    displayName: "Macy's",
    domains: ['macys.com'],
    categories: ['apparel', 'home'],
    countries: ['US'],
    cashbackRateBps: 200,
    homepageUrl: 'https://www.macys.com',
  },
  {
    slug: 'rei',
    displayName: 'REI Co-op',
    domains: ['rei.com'],
    categories: ['outdoor', 'apparel'],
    countries: ['US'],
    cashbackRateBps: 150,
    homepageUrl: 'https://www.rei.com',
  },
  {
    slug: 'asos',
    displayName: 'ASOS',
    domains: ['asos.com'],
    categories: ['apparel'],
    countries: ['US', 'GB'],
    cashbackRateBps: 250,
    homepageUrl: 'https://www.asos.com',
  },
];

function days(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

const DEALS: SeedDeal[] = [
  {
    merchantSlug: 'best-buy',
    kind: 'code',
    code: 'SAVE20BB',
    title: '20% off open-box laptops',
    description: 'Stack with Best Buy Plus for an extra 5%. Excludes Apple.',
    discountType: 'pct_off',
    discountValueBps: 2000,
    cartMinCents: 50000,
    geoScope: ['US'],
    expiresAt: days(30),
    deeplink: 'https://www.bestbuy.com/site/clp/promotions',
  },
  {
    merchantSlug: 'best-buy',
    kind: 'sale',
    title: 'Memorial Day Sale: up to $500 off OLED TVs',
    description: 'No code needed. While supplies last.',
    discountType: 'amt_off',
    discountValueCents: 50000,
    geoScope: ['US'],
    expiresAt: days(7),
    deeplink: 'https://www.bestbuy.com/site/electronics/tvs',
  },
  {
    merchantSlug: 'dominos',
    kind: 'code',
    code: '5OFF20',
    title: '$5 off any order over $20',
    description: 'Carryout or delivery. One per customer.',
    discountType: 'amt_off',
    discountValueCents: 500,
    cartMinCents: 2000,
    geoScope: ['US'],
    expiresAt: days(14),
  },
  {
    merchantSlug: 'dominos',
    kind: 'code',
    code: 'BOGO50',
    title: 'Buy one large pizza, get one 50% off',
    description: 'Large or larger pizzas only. Cannot stack with other coupons.',
    discountType: 'pct_off',
    discountValueBps: 5000,
    geoScope: ['US'],
    expiresAt: days(60),
  },
  {
    merchantSlug: 'macys',
    kind: 'code',
    code: 'FRIENDS25',
    title: '25% off Friends & Family',
    description: 'Sitewide with a few brand exclusions. New customers stack with email signup.',
    discountType: 'pct_off',
    discountValueBps: 2500,
    cartMinCents: 7500,
    geoScope: ['US'],
    expiresAt: days(5),
    deeplink: 'https://www.macys.com/sale',
  },
  {
    merchantSlug: 'rei',
    kind: 'code',
    code: 'TRAIL15',
    title: '15% off one full-price item',
    description: 'REI members only. Single use.',
    discountType: 'pct_off',
    discountValueBps: 1500,
    geoScope: ['US'],
    expiresAt: days(45),
  },
  {
    merchantSlug: 'rei',
    kind: 'automatic',
    title: 'Free standard shipping over $50',
    description: 'Applied automatically at checkout.',
    discountType: 'free_shipping',
    cartMinCents: 5000,
    geoScope: ['US'],
  },
  {
    merchantSlug: 'asos',
    kind: 'code',
    code: 'NEW20ASOS',
    title: '20% off your first order',
    description: 'New customers only. Min spend $30.',
    discountType: 'pct_off',
    discountValueBps: 2000,
    cartMinCents: 3000,
    geoScope: ['US', 'GB'],
    expiresAt: days(90),
  },
  {
    merchantSlug: 'asos',
    kind: 'sale',
    title: 'Up to 70% off end-of-season',
    description: 'Marked-down prices, no code needed.',
    discountType: 'pct_off',
    discountValueBps: 7000,
    geoScope: ['US', 'GB'],
    expiresAt: days(21),
    deeplink: 'https://www.asos.com/sale',
  },
];

async function main() {
  log.info('Seeding demo merchants and deals...');

  const slugToId = new Map<string, string>();

  for (const m of MERCHANTS) {
    const inserted = await db()
      .insert(merchants)
      .values({
        slug: m.slug,
        displayName: m.displayName,
        domains: m.domains,
        categories: m.categories,
        countries: m.countries,
        homepageUrl: m.homepageUrl,
        ...(m.cashbackRateBps !== undefined ? { cashbackRateBps: m.cashbackRateBps } : {}),
        attributionSource: 'seed',
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: merchants.slug,
        set: {
          displayName: sql`excluded.display_name`,
          domains: sql`excluded.domains`,
          categories: sql`excluded.categories`,
          countries: sql`excluded.countries`,
          homepageUrl: sql`excluded.homepage_url`,
          cashbackRateBps: sql`excluded.cashback_rate_bps`,
          lastSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: merchants.id, slug: merchants.slug });

    const row = inserted[0];
    if (!row) throw new Error(`failed to upsert merchant ${m.slug}`);
    slugToId.set(row.slug, row.id);
  }

  let dealsUpserted = 0;
  for (let i = 0; i < DEALS.length; i += 1) {
    const d = DEALS[i];
    if (!d) continue;
    const merchantId = slugToId.get(d.merchantSlug);
    if (!merchantId) throw new Error(`unknown merchant ${d.merchantSlug}`);

    await db()
      .insert(deals)
      .values({
        merchantId,
        kind: d.kind,
        ...(d.code !== undefined ? { code: d.code } : {}),
        title: d.title,
        description: d.description,
        discountType: d.discountType,
        ...(d.discountValueBps !== undefined ? { discountValueBps: d.discountValueBps } : {}),
        ...(d.discountValueCents !== undefined ? { discountValueCents: d.discountValueCents } : {}),
        ...(d.cartMinCents !== undefined ? { cartMinCents: d.cartMinCents } : {}),
        geoScope: d.geoScope,
        segment: 'general',
        ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {}),
        ...(d.deeplink !== undefined ? { deeplink: d.deeplink } : {}),
        attributionSource: 'seed',
        sourceNetwork: 'manual',
        sourceId: `seed-${i}`,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [deals.sourceNetwork, deals.sourceId],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          expiresAt: sql`excluded.expires_at`,
          updatedAt: sql`now()`,
        },
      });
    dealsUpserted += 1;
  }

  log.info({ merchants: MERCHANTS.length, deals: dealsUpserted }, 'seed complete');
  await closeDb();
}

main().catch((err) => {
  log.error({ err }, 'seed failed');
  process.exit(1);
});
