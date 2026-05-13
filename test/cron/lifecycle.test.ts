/**
 * Lifecycle tests use a Drizzle-shaped mock that records the WHERE clause
 * each UPDATE is built with, and returns canned id arrays from
 * `.returning()`. We don't run against real Postgres here — the SQL
 * generation is what we want to lock in, not row-level behavior.
 */
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAILING_MIN_SAMPLES,
  DEFAULT_FAILING_THRESHOLD,
  DEFAULT_STALE_GRACE_HOURS,
  markExpiredDeals,
  markFailingDeals,
  markStaleDeals,
  runLifecyclePass,
} from '../../src/cron/lifecycle.ts';
import type { Db } from '../../src/db/client.ts';

interface CapturedUpdate {
  setArg: unknown;
  whereSql: string;
  whereParams: unknown[];
}

function makeRecordingDb(
  returningQueueByCall: Array<Array<{ id: string }>>,
): { db: Db; captured: CapturedUpdate[] } {
  const captured: CapturedUpdate[] = [];
  let updateCall = 0;

  const buildUpdateChain = (): unknown => {
    const current = updateCall++;
    const expected = returningQueueByCall[current] ?? [];
    const state: CapturedUpdate = { setArg: undefined, whereSql: '', whereParams: [] };
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn((arg: unknown) => {
      state.setArg = arg;
      return chain;
    });
    chain['where'] = vi.fn((arg: unknown) => {
      // Drizzle's `sql\`...\`` token tree has cycles (tables reference their
      // columns, which reference the table). `util.inspect` walks cycles
      // safely and gives us a string we can grep for parameters and table
      // fragments.
      state.whereSql = inspect(arg, { depth: 10, breakLength: Infinity });
      return chain;
    });
    chain['returning'] = vi.fn(async () => {
      captured.push(state);
      return expected;
    });
    return chain;
  };

  const db = {
    update: vi.fn(() => buildUpdateChain()),
  } as unknown as Db;

  return { db, captured };
}

describe('markExpiredDeals', () => {
  it('runs a single UPDATE and returns the row count', async () => {
    const { db, captured } = makeRecordingDb([[{ id: 'a' }, { id: 'b' }]]);
    const n = await markExpiredDeals(db);
    expect(n).toBe(2);
    expect(captured).toHaveLength(1);
    // sanity: the set clause flips is_active off and bumps updatedAt
    expect(captured[0]!.setArg).toMatchObject({ isActive: false });
  });
});

describe('markStaleDeals', () => {
  it('passes the grace-hours value into the SQL', async () => {
    const { db, captured } = makeRecordingDb([[{ id: 'x' }]]);
    const n = await markStaleDeals(db, 12);
    expect(n).toBe(1);
    expect(captured).toHaveLength(1);
    // The grace value lives in the WHERE clause as a parameter — we just
    // serialize the SQL token tree and grep for the literal. Drizzle stores
    // numeric params in `params` arrays inside the chunks.
    expect(captured[0]!.whereSql).toContain('12');
    // And the source-network exemption must appear.
    expect(captured[0]!.whereSql).toContain('telemetry');
    expect(captured[0]!.whereSql).toContain('manual');
  });

  it('clamps negative grace hours to zero', async () => {
    const { db, captured } = makeRecordingDb([[]]);
    await markStaleDeals(db, -5);
    expect(captured[0]!.whereSql).toContain('0');
  });
});

describe('markFailingDeals', () => {
  it('uses the provided threshold and minSamples', async () => {
    const { db, captured } = makeRecordingDb([[{ id: 'z' }]]);
    const n = await markFailingDeals(db, { threshold: 0.3, minSamples: 7 });
    expect(n).toBe(1);
    expect(captured[0]!.whereSql).toContain('0.3');
    expect(captured[0]!.whereSql).toContain('7');
  });

  it('clamps threshold to [0,1] and minSamples to >=1', async () => {
    const { db, captured } = makeRecordingDb([[], []]);
    await markFailingDeals(db, { threshold: 2.5, minSamples: 0 });
    expect(captured[0]!.whereSql).toContain('1');
    // minSamples clamped to 1, so the param array should not contain a 0.
    await markFailingDeals(db, { threshold: -0.5, minSamples: 4 });
    expect(captured[1]!.whereSql).toContain('0');
  });
});

describe('runLifecyclePass', () => {
  it('runs all three passes and aggregates counts', async () => {
    const { db, captured } = makeRecordingDb([
      [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], // expired pass returns 3
      [{ id: 's1' }], // stale pass returns 1
      [{ id: 'f1' }, { id: 'f2' }], // failing pass returns 2
    ]);
    const result = await runLifecyclePass(db);
    expect(result).toEqual({ expired: 3, stale: 1, failing: 2 });
    expect(captured).toHaveLength(3);
  });

  it('threads explicit option overrides into the SQL', async () => {
    const { db, captured } = makeRecordingDb([[], [], []]);
    await runLifecyclePass(db, {
      staleGraceHours: 24,
      failingThreshold: 0.15,
      failingMinSamples: 10,
    });
    expect(captured[1]!.whereSql).toContain('24');
    expect(captured[2]!.whereSql).toContain('0.15');
    expect(captured[2]!.whereSql).toContain('10');
  });

  it('defaults match exported constants', async () => {
    const { db, captured } = makeRecordingDb([[], [], []]);
    await runLifecyclePass(db);
    expect(captured[1]!.whereSql).toContain(String(DEFAULT_STALE_GRACE_HOURS));
    expect(captured[2]!.whereSql).toContain(String(DEFAULT_FAILING_THRESHOLD));
    expect(captured[2]!.whereSql).toContain(String(DEFAULT_FAILING_MIN_SAMPLES));
  });
});
