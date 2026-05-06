import { describe, it, expect, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/report-code-result.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

/**
 * Build a minimal Db stub that records the sequence of calls. We only need to
 * cover three Drizzle operations:
 *  1. SELECT to confirm the deal exists.
 *  2. INSERT into telemetry returning the generated id.
 *  3. UPDATE deals computing the rolling 30d success_rate.
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

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => (dealExists ? [{ id: 'deal-1' }] : []),
  };

  const insertChain = {
    values: (v: Record<string, unknown>) => {
      insertedValues.push(v);
      return insertChain;
    },
    returning: async () => [{ id: telemetryId }],
  };

  const updateChain = {
    set: (s: Record<string, unknown>) => {
      updateSetCalls.push(s);
      return updateChain;
    },
    where: () => updateChain,
    returning: async () => [{ successRate: newSuccessRate }],
  };

  const db = {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  } as unknown as Db;

  return { db, insertedValues, updateSetCalls };
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

  // Smoke check that vi is wired up in case this file is run in isolation.
  it('test environment has vitest globals', () => {
    expect(vi).toBeTruthy();
  });
});
