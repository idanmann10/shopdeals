/**
 * Unit tests for the Awin adapter. Uses a static fixture and a stubbed fetch.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AwinAdapter, mapAwinPromotion, type AwinPromotion } from '../../src/sources/awin.ts';
import type { RawDealInput } from '../../src/sources/common.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'fixtures', 'awin-page-1.json');

interface AwinFixture {
  data: AwinPromotion[];
  pagination: { pageSize: number; total: number; cursor?: string };
}

async function loadFixture(): Promise<AwinFixture> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as AwinFixture;
}

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFakeFetch(pages: Array<unknown>): {
  impl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fakeFetch = vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit | undefined });
    const body = pages.shift() ?? { data: [], pagination: { pageSize: 200, total: 0 } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: fakeFetch as unknown as typeof fetch, calls };
}

describe('AwinAdapter', () => {
  it('requires both token and publisher id to be configured', () => {
    expect(new AwinAdapter({ apiToken: '', publisherId: '' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: 'x', publisherId: '' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: '', publisherId: '1' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: 'x', publisherId: '1' }).isConfigured()).toBe(true);
  });

  it('issues a POST to the singular /publisher/{id}/promotions endpoint with the correct body and headers', async () => {
    const fixture = await loadFixture();
    const { impl, calls } = makeFakeFetch([fixture]);
    const adapter = new AwinAdapter({
      apiToken: 'test-token',
      publisherId: '1234',
      pageSize: 200,
      regionCodes: ['US', 'GB'],
      fetchImpl: impl,
      delayBetweenPagesMs: 0,
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toContain('https://api.awin.com/publisher/1234/promotions');
    expect(call.url).not.toContain('/publishers/');
    expect(call.url).toContain('accessToken=test-token');

    expect(call.init?.method).toBe('POST');

    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    // Raw token, no `Bearer ` prefix.
    expect(headers['Authorization']).toBe('test-token');
    expect(headers['Authorization']).not.toMatch(/^Bearer /);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/json');

    const body = JSON.parse(String(call.init?.body)) as {
      filters: { membership: string; type: string; regionCodes: string[] };
      pagination: { pageSize: number; cursor?: string };
    };
    expect(body.filters.membership).toBe('joined');
    expect(body.filters.type).toBe('voucher');
    expect(body.filters.regionCodes).toEqual(['US', 'GB']);
    expect(body.pagination.pageSize).toBe(200);
    expect(body.pagination.cursor).toBeUndefined();

    expect(out).toHaveLength(2);
  });

  it('yields normalized RawDealInputs from a fixture', async () => {
    const fixture = await loadFixture();
    const { impl } = makeFakeFetch([fixture]);
    const adapter = new AwinAdapter({
      apiToken: 'test-token',
      publisherId: '1234',
      pageSize: 200,
      fetchImpl: impl,
      delayBetweenPagesMs: 0,
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(out).toHaveLength(2);
    for (const item of out) expect(item.sourceNetwork).toBe('awin');

    const northwind = out.find((d) => d.sourceId === '50001');
    expect(northwind).toBeDefined();
    expect(northwind?.kind).toBe('code');
    expect(northwind?.code).toBe('JACKET15');
    expect(northwind?.discountType).toBe('pct_off');
    expect(northwind?.discountValueBps).toBe(1500);
    expect(northwind?.merchant.slug).toBe('northwind-threads');
    expect(northwind?.geoScope).toEqual(['GB', 'IE']);
    expect(northwind?.deeplink).toBe('https://awin1.example/cread.php?p=50001');

    const solar = out.find((d) => d.sourceId === '50002');
    expect(solar).toBeDefined();
    expect(solar?.kind).toBe('code');
    expect(solar?.discountType).toBe('amt_off');
    expect(solar?.discountValueCents).toBe(5000);
    expect(solar?.geoScope).toEqual(['US']);
  });

  it('represents `regions.all=true` as ["*"]', () => {
    const mapped = mapAwinPromotion({
      promotionId: 99,
      advertiser: { id: 1, name: 'Global Co' },
      title: '10% off everything',
      voucher: { code: 'GLOBAL10' },
      regions: { all: true, list: [] },
    } as AwinPromotion);
    expect(mapped?.geoScope).toEqual(['*']);
  });

  it('mapAwinPromotion returns null when advertiser name missing', () => {
    expect(
      mapAwinPromotion({
        promotionId: 'x',
        advertiser: { name: '' },
      } as AwinPromotion)
    ).toBeNull();
  });
});
