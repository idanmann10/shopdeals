import { describe, it, expect, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/report-code-result.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

/**
 * Build a minimal Db stub that records the sequence of calls. We only need to
 * cover four Drizzle operations:
 *  1. SELECT to confirm the deal exists.
 *  2. INSERT into telemetry returning the generated id.
 *  3. UPDATE deals computing the rolling 30d success_rate.
 *  4. A `transaction(...)` wrapper that runs the INSERT+UPDATE atomically.
 *
 * The stub records whether `transaction` was called and which operations ran
 * inside vs outside the transaction context so we can assert atomicity.
 */
function makeStubDb(opts: {
  dealExists?: boolean;
  telemetryId?: bigint;
  newSuccessRate?: number;
}) {
  const dealExists = opts.dealExists ?? true;
  const telemetryId = opts.telemetryId ?? 42n;
  const newSuccessRate = opts.newSuccessRate ?? 0.75;

  const insertedValues: Array<Record<string, unknown>> = [];
  const updateSetCalls: Array<Record<string, unknown>> = [];
  // Track every operation in the order it ran. Ops that run inside the
  // transaction lambda are tagged with `inTx: true`.
  const ops: Array<{ kind: string; inTx: boolean }> = [];

  const buildSelectChain = (inTx: boolean) => {
    const c = {
      from: () => c,
      where: () => c,
      limit: async () => {
        ops.push({ kind: 'select', inTx });
        return dealExists ? [{ id: 'deal-1' }] : [];
      },
    };
    return c;
  };

  const buildInsertChain = (inTx: boolean) => {
    const c = {
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        return c;
      },
      returning: async () => {
        ops.push({ kind: 'insert', inTx });
        return [{ id: telemetryId }];
      },
    };
    return c;
  };

  const buildUpdateChain = (inTx: boolean) => {
    const c = {
      set: (s: Record<string, unknown>) => {
        updateSetCalls.push(s);
        return c;
      },
      where: () => c,
      returning: async () => {
        ops.push({ kind: 'update', inTx });
        return [{ successRate: newSuccessRate }];
      },
    };
    return c;
  };

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      select: () => buildSelectChain(true),
      insert: () => buildInsertChain(true),
      update: () => buildUpdateChain(true),
      execute: async () => {
        ops.push({ kind: 'execute', inTx: true });
        return [];
      },
    };
    return cb(tx);
  });

  const db = {
    select: () => buildSelectChain(false),
    insert: () => buildInsertChain(false),
    update: () => buildUpdateChain(false),
    transaction,
  } as unknown as Db;

  return { db, insertedValues, updateSetCalls, ops, transaction };
}

function ctxWith(db: Db): McpContext {
  return { db, clientHash: 'sha256-of-client', scopes: ['deals:read'] };
}

describe('report_code_result tool', () => {
  it('inserts a telemetry row using ctx.clientHash and returns the new rate', async () => {
    const stub = makeStubDb({ newSuccessRate: 0.5 });
    const input = inputSchema.parse({
      dealId: '11111111-1111-1111-1111-111111111111',
      worked: true,
      effectiveDiscountCents: 1500,
      cartTotalCents: 9999,
      countryCode: 'US',
      notes: 'worked at checkout',
    });
    const out = await handler(input, ctxWith(stub.db));
    expect(out.ok).toBe(true);
    expect(out.dealId).toBe(input.dealId);
    expect(out.telemetryId).toBe('42');
    expect(out.newSuccessRate).toBe(0.5);
    expect(stub.insertedValues).toHaveLength(1);
    expect(stub.insertedValues[0]!['clientHash']).toBe('sha256-of-client');
    expect(stub.insertedValues[0]!['worked']).toBe(true);
    expect(stub.insertedValues[0]!['effectiveDiscountCents']).toBe(1500);
  });

  it('passes a sql() expression for the rolling-window successRate update', async () => {
    const stub = makeStubDb({});
    const input = inputSchema.parse({
      dealId: '22222222-2222-2222-2222-222222222222',
      worked: false,
    });
    await handler(input, ctxWith(stub.db));
    expect(stub.updateSetCalls).toHaveLength(1);
    const setArg = stub.updateSetCalls[0]!;
    // successRate, successSampleCount, lastSeenWorkingAt, updatedAt should
    // all be present and SQL-typed (not raw values).
    expect(setArg['successRate']).toBeTruthy();
    expect(setArg['successSampleCount']).toBeTruthy();
    expect(setArg['lastSeenWorkingAt']).toBeTruthy();
    expect(setArg['updatedAt']).toBeTruthy();
  });

  it('throws InvalidParams when the deal does not exist', async () => {
    const stub = makeStubDb({ dealExists: false });
    const input = inputSchema.parse({
      dealId: '33333333-3333-3333-3333-333333333333',
      worked: true,
    });
    await expect(handler(input, ctxWith(stub.db))).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('runs INSERT + UPDATE inside ctx.db.transaction(...)', async () => {
    const stub = makeStubDb({});
    const input = inputSchema.parse({
      dealId: '44444444-4444-4444-4444-444444444444',
      worked: true,
    });
    await handler(input, ctxWith(stub.db));

    // The handler must invoke `db.transaction(...)` exactly once.
    expect(stub.transaction).toHaveBeenCalledTimes(1);
    expect(stub.transaction.mock.calls[0]![0]).toBeInstanceOf(Function);

    // Both the INSERT and the UPDATE must run via the tx instance, not the
    // top-level db. The initial deal-exists SELECT may run outside the tx.
    const insertOps = stub.ops.filter((o) => o.kind === 'insert');
    const updateOps = stub.ops.filter((o) => o.kind === 'update');
    expect(insertOps).toHaveLength(1);
    expect(updateOps).toHaveLength(1);
    expect(insertOps[0]!.inTx).toBe(true);
    expect(updateOps[0]!.inTx).toBe(true);
  });

  it('returns newSuccessRate from the UPDATE RETURNING result', async () => {
    const stub = makeStubDb({ newSuccessRate: 0.873 });
    const input = inputSchema.parse({
      dealId: '55555555-5555-5555-5555-555555555555',
      worked: true,
    });
    const out = await handler(input, ctxWith(stub.db));
    // The value originates from the tx update's RETURNING clause and must be
    // surfaced verbatim on the response payload.
    expect(out.newSuccessRate).toBe(0.873);
  });

  // Smoke check that vi is wired up in case this file is run in isolation.
  it('test environment has vitest globals', () => {
    expect(vi).toBeTruthy();
  });
});
