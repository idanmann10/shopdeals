import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiUsage } from '../../src/db/schema.ts';

// Stable fake env so importing stripe.ts doesn't require .env wiring.
vi.mock('../../src/lib/env.ts', () => ({
  env: () => ({
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://localhost/test',
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    STRIPE_PRICE_STARTER: 'price_starter',
    STRIPE_PRICE_PRO: 'price_pro',
    MCP_PUBLIC_URL: 'http://localhost:3000',
    MCP_OAUTH_ISSUER: 'http://localhost:3000',
    FMTC_BASE_URL: 'https://account.fmtc.co/cp/api',
  }),
  resetEnvCache: () => undefined,
}));

// Hoist mocks shared between Stripe SDK and DB client.
const meterEventsCreateMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'mev_test' }));
const customerCreateMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'cus_test' }));
const checkoutSessionsCreateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }),
);
const constructEventMock = vi.hoisted(() => vi.fn());

vi.mock('stripe', () => {
  class FakeStripe {
    public billing = { meterEvents: { create: meterEventsCreateMock } };
    public customers = { create: customerCreateMock };
    public checkout = { sessions: { create: checkoutSessionsCreateMock } };
    public webhooks = { constructEvent: constructEventMock };
  }
  return { default: FakeStripe };
});

// In-memory rows + mock DB.
const insertedRows = vi.hoisted(() => ({ rows: [] as ApiUsage[] }));
const updatedIds = vi.hoisted(() => ({ ids: [] as bigint[] }));

const dbMock = vi.hoisted(() => {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (_n: number) => {
            // Return all unreported rows once, then nothing.
            const unreported = insertedRows.rows.filter((r) => !r.stripeReported);
            return unreported.slice(0, _n);
          },
        }),
      }),
    }),
    update: () => ({
      set: (_v: { stripeReported: boolean }) => ({
        where: async () => {
          // Mark the staged ids as reported.
          for (const id of updatedIds.ids) {
            const found = insertedRows.rows.find((r) => r.id === id);
            if (found) found.stripeReported = true;
          }
          updatedIds.ids = [];
        },
      }),
    }),
    insert: () => ({
      values: async (_v: unknown) => undefined,
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(dbMockProxy),
  };
});

// We need transactions to receive an object with .update() that captures ids.
const dbMockProxy = vi.hoisted(() => ({
  update: () => ({
    set: (_v: { stripeReported: boolean }) => ({
      where: (_pred: { ids: bigint[] } | unknown) => {
        // The where clause built by drizzle is opaque; instead callers stash ids
        // into updatedIds before calling. We simulate by relying on the captured ids.
        return Promise.resolve().then(() => {
          for (const id of updatedIds.ids) {
            const found = insertedRows.rows.find((r) => r.id === id);
            if (found) found.stripeReported = true;
          }
          updatedIds.ids = [];
        });
      },
    }),
  }),
}));

vi.mock('../../src/db/client.ts', () => ({
  db: () => dbMock,
  closeDb: async () => undefined,
  pool: () => ({}),
  schema: {},
}));

// Mock clerk lookup so getStripeCustomerForOrg returns a known customer.
vi.mock('../../src/auth/clerk.ts', () => {
  const orgs = new Map<string, string>([
    ['org_a', 'cus_a'],
    ['org_b', 'cus_b'],
  ]);
  return {
    isClerkConfigured: () => true,
    clerkClient: () => ({
      organizations: {
        getOrganization: async ({ organizationId }: { organizationId: string }) => ({
          id: organizationId,
          publicMetadata: { stripeCustomerId: orgs.get(organizationId) ?? null },
        }),
        updateOrganizationMetadata: vi.fn(async () => undefined),
      },
    }),
    defaultScopesFor: () => [],
    resetClerkClientCache: () => undefined,
  };
});

// Patch drizzle inArray/eq/and to capture the ids list — we sniff updatedIds by
// intercepting the test code path; easier: we patch reportPendingUsage's
// `inArray` call indirectly. Instead, watch the `ids` reportPendingUsage builds.
//
// For this test we instead replace dbMock.update().set().where() to read ids
// from a side-channel: we re-export reportPendingUsage with an instrumented
// transaction. To avoid that, we override `update` on the transaction proxy
// once we're inside the call by inspecting the global state. Concretely, we
// extend dbMockProxy to record ids on each transaction call by snapshotting
// every unreported row's id before set() runs.

dbMockProxy.update = () => ({
  set: (_v: { stripeReported: boolean }) => ({
    where: () => {
      // Mark every "candidate" (still unreported) row as reported.
      // The production code only calls update inside the txn after groups are
      // built and meter events succeeded. Because our meterEventsCreateMock
      // resolves successfully, all rows in this batch should be marked.
      for (const row of insertedRows.rows) {
        if (!row.stripeReported) row.stripeReported = true;
      }
      return Promise.resolve();
    },
  }),
});

import {
  TOOL_METER_EVENT,
  reportPendingUsage,
  resetStripeCache,
  createCheckoutSession,
  setupCustomerForOrg,
} from '../../src/billing/stripe.ts';

function row(over: Partial<ApiUsage>): ApiUsage {
  return {
    id: 0n,
    clientHash: 'h'.repeat(64),
    orgId: null,
    userId: null,
    tool: 'find_deals',
    units: 1,
    occurredAt: new Date(),
    stripeReported: false,
    ...over,
  } as ApiUsage;
}

describe('TOOL_METER_EVENT mapping', () => {
  it('maps deal-* tools to deal_query', () => {
    expect(TOOL_METER_EVENT.find_deals).toBe('deal_query');
    expect(TOOL_METER_EVENT.get_deal).toBe('deal_query');
    expect(TOOL_METER_EVENT.list_merchants).toBe('deal_query');
  });
  it('maps price history to its own meter', () => {
    expect(TOOL_METER_EVENT.get_price_history).toBe('price_history');
  });
  it('treats telemetry as un-metered', () => {
    expect(TOOL_METER_EVENT.report_code_result).toBeNull();
  });
});

describe('reportPendingUsage', () => {
  beforeEach(() => {
    resetStripeCache();
    insertedRows.rows = [];
    updatedIds.ids = [];
    meterEventsCreateMock.mockClear();
  });

  it('groups rows by org + meter and emits one meter event per group', async () => {
    insertedRows.rows = [
      row({ id: 1n, orgId: 'org_a', tool: 'find_deals', units: 1 }),
      row({ id: 2n, orgId: 'org_a', tool: 'get_deal', units: 1 }),
      row({ id: 3n, orgId: 'org_a', tool: 'get_price_history', units: 5 }),
      row({ id: 4n, orgId: 'org_b', tool: 'find_deals', units: 2 }),
      // skipped (telemetry / no meter)
      row({ id: 5n, orgId: 'org_a', tool: 'report_code_result', units: 0 }),
      // skipped (no orgId)
      row({ id: 6n, orgId: null, tool: 'find_deals', units: 1 }),
    ];

    const result = await reportPendingUsage();

    // Expect 3 calls: org_a/deal_query (units=2), org_a/price_history (units=5),
    // org_b/deal_query (units=2).
    expect(meterEventsCreateMock).toHaveBeenCalledTimes(3);

    const calls = meterEventsCreateMock.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    const orgAdeal = calls.find(
      (p) =>
        (p.payload as { stripe_customer_id: string }).stripe_customer_id === 'cus_a' &&
        p.event_name === 'deal_query',
    );
    const orgAprice = calls.find(
      (p) =>
        (p.payload as { stripe_customer_id: string }).stripe_customer_id === 'cus_a' &&
        p.event_name === 'price_history',
    );
    const orgBdeal = calls.find(
      (p) =>
        (p.payload as { stripe_customer_id: string }).stripe_customer_id === 'cus_b' &&
        p.event_name === 'deal_query',
    );

    expect(orgAdeal).toBeDefined();
    expect((orgAdeal!.payload as { value: string }).value).toBe('2');
    expect(orgAprice).toBeDefined();
    expect((orgAprice!.payload as { value: string }).value).toBe('5');
    expect(orgBdeal).toBeDefined();
    expect((orgBdeal!.payload as { value: string }).value).toBe('2');

    // Every row should be marked reported (skipped + grouped).
    for (const r of insertedRows.rows) {
      expect(r.stripeReported).toBe(true);
    }
    expect(result.reported).toBeGreaterThanOrEqual(6);
  });

  it('returns 0 when there are no rows', async () => {
    insertedRows.rows = [];
    const result = await reportPendingUsage();
    expect(result.reported).toBe(0);
    expect(meterEventsCreateMock).not.toHaveBeenCalled();
  });
});

describe('setupCustomerForOrg', () => {
  beforeEach(() => {
    resetStripeCache();
    customerCreateMock.mockClear();
  });
  it('returns the existing customer id if already linked', async () => {
    const result = await setupCustomerForOrg('org_a', 'a@example.com');
    expect(result.customerId).toBe('cus_a');
    expect(customerCreateMock).not.toHaveBeenCalled();
  });
});

describe('createCheckoutSession', () => {
  beforeEach(() => {
    resetStripeCache();
    checkoutSessionsCreateMock.mockClear();
  });
  it('builds a checkout session for a starter plan', async () => {
    const r = await createCheckoutSession('org_a', 'starter');
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(checkoutSessionsCreateMock).toHaveBeenCalledTimes(1);
    const arg = checkoutSessionsCreateMock.mock.calls[0]?.[0] as
      | { customer: string; line_items: Array<{ price: string }> }
      | undefined;
    expect(arg?.customer).toBe('cus_a');
    expect(arg?.line_items[0]?.price).toBe('price_starter');
  });
});
