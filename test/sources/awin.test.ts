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
  pagination: { total: number; currentPage: number; pageSize: number };
}

async function loadFixture(): Promise<AwinFixture> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as AwinFixture;
}

function makeFakeFetch(pages: Array<unknown>): typeof fetch {
  const fakeFetch = vi.fn(async (_url: unknown, _init?: unknown) => {
    const body = pages.shift() ?? { data: [], pagination: { total: 0, currentPage: 1, pageSize: 100 } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return fakeFetch as unknown as typeof fetch;
}

describe('AwinAdapter', () => {
  it('requires both token and publisher id to be configured', () => {
    expect(new AwinAdapter({ apiToken: '', publisherId: '' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: 'x', publisherId: '' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: '', publisherId: '1' }).isConfigured()).toBe(false);
    expect(new AwinAdapter({ apiToken: 'x', publisherId: '1' }).isConfigured()).toBe(true);
  });

  it('yields normalized RawDealInputs from a fixture', async () => {
    const fixture = await loadFixture();
    const empty = { data: [], pagination: { total: 0, currentPage: 2, pageSize: 100 } };
    const adapter = new AwinAdapter({
      apiToken: 'test-token',
      publisherId: '1234',
      pageSize: 100,
      fetchImpl: makeFakeFetch([fixture, empty]),
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

  it('mapAwinPromotion returns null when advertiser name missing', () => {
    expect(
      mapAwinPromotion({
        promotionId: 'x',
        advertiser: { name: '' },
      } as AwinPromotion)
    ).toBeNull();
  });
});
