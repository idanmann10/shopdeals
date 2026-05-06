/**
 * Unit tests for the canonical upsert pipeline. We construct a fake Drizzle
 * `Db` that records the high-level operations performed (transactions,
 * inserts targeting which tables, and the row counts) and assert the
 * pipeline calls them in the expected shape.
 *
 * We avoid Testcontainers / a real Postgres — that's the integration tier.
 */
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.ts';
import { ingestRuns, merchants, deals } from '../../src/db/schema.ts';
import type { RawDealInput, SourceAdapter } from '../../src/sources/common.ts';
import { upsertDeals } from '../../src/sources/upsert.ts';

interface CallLog {
  insertedTables: string[];
  selectedTables: string[];
  updatedTables: string[];
  txCount: number;
  // Capture the values arrays passed to each insert keyed by table name.
  insertValues: Record<string, unknown[][]>;
  // Track conflict targets used by onConflictDoUpdate.
  conflictTargets: Record<string, unknown[]>;
}

/**
 * Build a stand-in for a Drizzle `Db` rich enough to satisfy `upsertDeals`.
 * Each table's identity is checked via reference equality against the real
 * schema imports, so we can label the calls in the log.
 */
function makeFakeDb(): { db: Db; calls: CallLog } {
  const calls: CallLog = {
    insertedTables: [],
    selectedTables: [],
    updatedTables: [],
    txCount: 0,
    insertValues: {},
    conflictTargets: {},
  };

  const tableLabel = (t: unknown): string => {
    if (t === ingestRuns) return 'ingest_runs';
    if (t === merchants) return 'merchants';
    if (t === deals) return 'deals';
    return 'unknown';
  };

  // Track auto-incrementing merchant ids by slug so deal upserts get a real id.
  const merchantIdBySlug = new Map<string, string>();
  let nextId = 1;
  const idFor = (slug: string): string => {
    let id = merchantIdBySlug.get(slug);
    if (!id) {
      id = `merchant-${nextId++}`;
      merchantIdBySlug.set(slug, id);
    }
    return id;
  };

  const buildInsertChain = (table: unknown) => {
    const label = tableLabel(table);
    return {
      values: (vals: unknown) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        calls.insertValues[label] = (calls.insertValues[label] ?? []).concat([arr]);
        const chain: Record<string, unknown> = {};
        chain['onConflictDoUpdate'] = (cfg: { target: unknown }) => {
          calls.conflictTargets[label] = ([] as unknown[]).concat(cfg.target as never);
          return {
            returning: (_proj?: unknown) => {
              if (label === 'merchants') {
                return Promise.resolve(
                  arr.map((v) => {
                    const slug = (v as { slug: string }).slug;
                    return { id: idFor(slug), slug };
                  })
                );
              }
              if (label === 'deals') {
                return Promise.resolve(arr.map((_v, i) => ({ id: `deal-${i + 1}` })));
              }
              return Promise.resolve(arr);
            },
          };
        };
        chain['returning'] = (_proj?: unknown) => {
          if (label === 'ingest_runs') {
            calls.insertedTables.push(label);
            return Promise.resolve([{ id: 'run-1' }]);
          }
          calls.insertedTables.push(label);
          return Promise.resolve(arr);
        };
        // For onConflictDoUpdate path, mark inserted on the returning hop.
        const orig = chain['onConflictDoUpdate'] as (cfg: {
          target: unknown;
        }) => { returning: (p?: unknown) => Promise<unknown[]> };
        chain['onConflictDoUpdate'] = (cfg: { target: unknown }) => {
          calls.insertedTables.push(label);
          return orig(cfg);
        };
        return chain;
      },
    };
  };

  const buildUpdateChain = (table: unknown) => {
    const label = tableLabel(table);
    return {
      set: (_v: unknown) => ({
        where: async (_w: unknown) => {
          calls.updatedTables.push(label);
        },
      }),
    };
  };

  const buildSelectChain = () => {
    return {
      from: (table: unknown) => {
        calls.selectedTables.push(tableLabel(table));
        return {
          where: async (_w: unknown) => [],
        };
      },
    };
  };

  const txDb: Record<string, unknown> = {
    insert: (t: unknown) => buildInsertChain(t),
    select: (_proj?: unknown) => buildSelectChain(),
    update: (t: unknown) => buildUpdateChain(t),
  };

  const fakeDb: Record<string, unknown> = {
    insert: (t: unknown) => buildInsertChain(t),
    update: (t: unknown) => buildUpdateChain(t),
    select: (_proj?: unknown) => buildSelectChain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.txCount += 1;
      return fn(txDb);
    },
  };

  return { db: fakeDb as unknown as Db, calls };
}

const sampleDeals: RawDealInput[] = [
  {
    sourceNetwork: 'fmtc',
    sourceId: 'a-1',
    merchant: { slug: 'acme', displayName: 'Acme' },
    kind: 'code',
    code: 'A20',
    title: '20% off',
    discountType: 'pct_off',
    discountValueBps: 2000,
  },
  {
    sourceNetwork: 'fmtc',
    sourceId: 'a-2',
    merchant: { slug: 'beta', displayName: 'Beta' },
    kind: 'sale',
    title: 'Free shipping',
    discountType: 'free_shipping',
  },
];

function makeAdapter(items: RawDealInput[]): SourceAdapter {
  return {
    network: 'fmtc',
    isConfigured: () => true,
    fetch: async function* () {
      for (const i of items) yield i;
    },
  };
}

describe('upsertDeals', () => {
  it('runs end-to-end against a fake Drizzle db and counts upserts', async () => {
    const { db, calls } = makeFakeDb();
    const adapter = makeAdapter(sampleDeals);

    const result = await upsertDeals(adapter, { db, batchSize: 200 });

    expect(result.dealsUpserted).toBe(2);
    expect(result.merchantsUpserted).toBe(2);

    // ingest_runs: one open + one finalize update.
    expect(calls.insertedTables).toContain('ingest_runs');
    expect(calls.insertedTables).toContain('merchants');
    expect(calls.insertedTables).toContain('deals');
    expect(calls.updatedTables).toContain('ingest_runs');

    // We expect exactly one batch transaction.
    expect(calls.txCount).toBe(1);

    // Conflict targets should reference the right unique constraints.
    expect(calls.conflictTargets['merchants']).toBeDefined();
    expect(calls.conflictTargets['deals']).toBeDefined();
    // deals conflict target must be a 2-element array (sourceNetwork, sourceId).
    expect(Array.isArray(calls.conflictTargets['deals'])).toBe(true);
    expect((calls.conflictTargets['deals'] as unknown[]).length).toBe(2);
  });

  it('flushes a final partial batch', async () => {
    const { db, calls } = makeFakeDb();
    const adapter = makeAdapter(sampleDeals);

    // batchSize=1 forces two transactions.
    const result = await upsertDeals(adapter, { db, batchSize: 1 });

    expect(result.dealsUpserted).toBe(2);
    expect(calls.txCount).toBe(2);
  });

  it('marks the run failed when the iterable throws', async () => {
    const { db, calls } = makeFakeDb();
    const bad: SourceAdapter = {
      network: 'fmtc',
      isConfigured: () => true,
      fetch: async function* () {
        yield sampleDeals[0]!;
        throw new Error('boom');
      },
    };

    await expect(upsertDeals(bad, { db, batchSize: 200 })).rejects.toThrow(/boom/);
    // ingest_runs should be updated with a failed status.
    expect(calls.updatedTables).toContain('ingest_runs');
  });
});
