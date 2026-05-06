/**
 * Stripe billing surface:
 *   - Singleton client (`stripe()`).
 *   - `reportPendingUsage()` drains unreported `apiUsage` rows, emits Stripe meter
 *     events grouped by org + meter name, then marks rows reported in a transaction.
 *   - `setupCustomerForOrg()` ensures a Stripe Customer exists for a Clerk org
 *     and stashes the id back in org `publicMetadata.stripeCustomerId`.
 *   - `createCheckoutSession()` builds the subscription checkout URL for a plan.
 */

import Stripe from 'stripe';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as getDb } from '../db/client.ts';
import { apiUsage } from '../db/schema.ts';
import { clerkClient, isClerkConfigured } from '../auth/clerk.ts';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';

let cachedStripe: Stripe | undefined;

/** Returns a singleton Stripe client. STRIPE_SECRET_KEY is read lazily. */
export function stripe(): Stripe {
  if (cachedStripe) return cachedStripe;
  cachedStripe = new Stripe(env().STRIPE_SECRET_KEY ?? '');
  return cachedStripe;
}

/** Test helper — drop the cached Stripe singleton. */
export function resetStripeCache(): void {
  cachedStripe = undefined;
}

/**
 * Tools -> meter `event_name`. Tools mapped to `null` are not metered (e.g.
 * telemetry reports that are free).
 */
export const TOOL_METER_EVENT: Record<string, string | null> = {
  find_deals: 'deal_query',
  get_deal: 'deal_query',
  list_merchants: 'deal_query',
  get_price_history: 'price_history',
  report_code_result: null,
};

const REPORT_BATCH_SIZE = 1000;

export interface ReportPendingUsageResult {
  /** number of rows marked `stripeReported = true` */
  reported: number;
}

/**
 * Drain unreported `apiUsage` rows in batches, group by (orgId, meter event),
 * emit one `meterEvents.create` per group, then mark all rows reported.
 *
 * Rows without an `orgId` or with units = 0 or with no meter mapping are
 * skipped (still marked reported so we don't reprocess).
 *
 * Idempotency: each meter event uses an `identifier` derived from the row ids
 * being aggregated, so retries within Stripe's 24h dedup window collapse.
 */
export async function reportPendingUsage(): Promise<ReportPendingUsageResult> {
  const database = getDb();

  let totalReported = 0;

  while (true) {
    const rows = await database
      .select()
      .from(apiUsage)
      .where(eq(apiUsage.stripeReported, false))
      .limit(REPORT_BATCH_SIZE);

    if (rows.length === 0) break;

    // Group by (orgId, eventName).
    const groups = new Map<
      string,
      { orgId: string; eventName: string; units: number; ids: bigint[] }
    >();
    const skippedIds: bigint[] = [];

    for (const row of rows) {
      const meter = TOOL_METER_EVENT[row.tool];
      if (!row.orgId || !meter || row.units <= 0) {
        skippedIds.push(row.id);
        continue;
      }
      const key = `${row.orgId}::${meter}`;
      const existing = groups.get(key);
      if (existing) {
        existing.units += row.units;
        existing.ids.push(row.id);
      } else {
        groups.set(key, {
          orgId: row.orgId,
          eventName: meter,
          units: row.units,
          ids: [row.id],
        });
      }
    }

    // Emit one meter event per group. Failures bubble; the rows aren't marked
    // reported so the next cron pass retries.
    const reportedIds: bigint[] = [...skippedIds];
    for (const group of groups.values()) {
      const customerId = await getStripeCustomerForOrg(group.orgId);
      if (!customerId) {
        // Org has no Stripe customer set up — skip but don't mark reported.
        log.warn(
          { orgId: group.orgId, eventName: group.eventName, units: group.units },
          'skipping meter event: org has no stripe customer',
        );
        continue;
      }

      const identifier = makeIdentifier(group.orgId, group.eventName, group.ids);
      try {
        await stripe().billing.meterEvents.create({
          event_name: group.eventName,
          identifier,
          payload: {
            stripe_customer_id: customerId,
            value: String(group.units),
          },
        });
        reportedIds.push(...group.ids);
      } catch (err) {
        log.error(
          { err, orgId: group.orgId, eventName: group.eventName, identifier },
          'meter event create failed',
        );
        // leave rows unreported for retry
      }
    }

    if (reportedIds.length > 0) {
      await database.transaction(async (tx) => {
        await tx
          .update(apiUsage)
          .set({ stripeReported: true })
          .where(and(eq(apiUsage.stripeReported, false), inArray(apiUsage.id, reportedIds)));
      });
      totalReported += reportedIds.length;
    }

    // If we processed fewer than the batch size and made no progress (e.g.
    // every group skipped due to missing customer), bail out to avoid an
    // infinite loop.
    if (reportedIds.length === 0) break;
    if (rows.length < REPORT_BATCH_SIZE) break;
  }

  return { reported: totalReported };
}

function makeIdentifier(orgId: string, eventName: string, ids: readonly bigint[]): string {
  const min = ids.reduce((a, b) => (b < a ? b : a), ids[0] ?? 0n);
  const max = ids.reduce((a, b) => (b > a ? b : a), ids[0] ?? 0n);
  return `${orgId}:${eventName}:${min}:${max}:${ids.length}`;
}

/**
 * Locate the Stripe customer id we previously stored on a Clerk org.
 * Returns null if Clerk isn't configured or the org has none.
 */
export async function getStripeCustomerForOrg(orgId: string): Promise<string | null> {
  if (!isClerkConfigured()) return null;
  try {
    const org = await clerkClient().organizations.getOrganization({ organizationId: orgId });
    const meta = org.publicMetadata as { stripeCustomerId?: unknown } | undefined;
    if (meta && typeof meta.stripeCustomerId === 'string') return meta.stripeCustomerId;
    return null;
  } catch {
    return null;
  }
}

export interface SetupCustomerResult {
  customerId: string;
}

/**
 * Idempotently create a Stripe Customer for the given Clerk org. If one is
 * already linked via `publicMetadata.stripeCustomerId`, return it unchanged.
 */
export async function setupCustomerForOrg(
  orgId: string,
  email: string,
): Promise<SetupCustomerResult> {
  if (!isClerkConfigured()) {
    throw new Error('Clerk is not configured');
  }
  const existing = await getStripeCustomerForOrg(orgId);
  if (existing) return { customerId: existing };

  const customer = await stripe().customers.create({
    email,
    metadata: { clerk_org_id: orgId },
  });

  const org = await clerkClient().organizations.getOrganization({ organizationId: orgId });
  await clerkClient().organizations.updateOrganizationMetadata(orgId, {
    publicMetadata: {
      ...((org.publicMetadata as Record<string, unknown>) ?? {}),
      stripeCustomerId: customer.id,
    } as never,
  });

  return { customerId: customer.id };
}

export interface CheckoutSessionResult {
  url: string;
}

/**
 * Build a Stripe Checkout URL upgrading an org to a paid plan. The org must
 * already have a Stripe customer (call `setupCustomerForOrg` first).
 */
export async function createCheckoutSession(
  orgId: string,
  plan: 'starter' | 'pro',
): Promise<CheckoutSessionResult> {
  const e = env();
  const priceId = plan === 'starter' ? e.STRIPE_PRICE_STARTER : e.STRIPE_PRICE_PRO;
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan "${plan}"`);
  }
  const customerId = await getStripeCustomerForOrg(orgId);
  if (!customerId) {
    throw new Error(`Org ${orgId} has no Stripe customer`);
  }
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${e.MCP_PUBLIC_URL}/billing/return?status=success`,
    cancel_url: `${e.MCP_PUBLIC_URL}/billing/return?status=cancel`,
    metadata: { clerk_org_id: orgId, plan },
  });
  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL');
  }
  return { url: session.url };
}

// re-export sql so callers in this module survive linters
void sql;
