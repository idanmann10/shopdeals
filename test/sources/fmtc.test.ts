/**
 * Unit tests for the FMTC adapter. We mock `fetch` to return the static
 * fixture in `test/fixtures/fmtc-page-1.json`, then drive the adapter and
 * assert the normalized records.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FmtcAdapter, mapFmtcCoupon, type FmtcCoupon } from '../../src/sources/fmtc.ts';
import type { RawDealInput } from '../../src/sources/common.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'fixtures', 'fmtc-page-1.json');

async function loadFixture(): Promise<{ coupons: FmtcCoupon[] }> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as { coupons: FmtcCoupon[] };
}

function makeFakeFetch(pages: Array<unknown>): typeof fetch {
  const fakeFetch = vi.fn(async (_url: unknown) => {
    const body = pages.shift() ?? { coupons: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return fakeFetch as unknown as typeof fetch;
}

describe('FmtcAdapter', () => {
  it('is not configured without an API key', () => {
    const a = new FmtcAdapter({ apiKey: '' });
    expect(a.isConfigured()).toBe(false);
  });

  it('is configured with an API key', () => {
    const a = new FmtcAdapter({ apiKey: 'k', fetchImpl: makeFakeFetch([]) });
    expect(a.isConfigured()).toBe(true);
  });

  it('yields normalized RawDealInputs from a fixture', async () => {
    const fixture = await loadFixture();
    const adapter = new FmtcAdapter({
      apiKey: 'test-key',
      perPage: 200,
      fetchImpl: makeFakeFetch([fixture, { coupons: [] }]),
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(out).toHaveLength(3);
    for (const item of out) expect(item.sourceNetwork).toBe('fmtc');

    const acme = out.find((d) => d.sourceId === 'fmtc-1001');
    expect(acme).toBeDefined();
    expect(acme?.kind).toBe('code');
    expect(acme?.code).toBe('SAVE20');
    expect(acme?.discountType).toBe('pct_off');
    expect(acme?.discountValueBps).toBe(2000);
    expect(acme?.merchant.slug).toBe('acme-outdoor-supply');
    expect(acme?.geoScope).toEqual(['US', 'CA']);
    expect(acme?.deeplink).toBe('https://track.example/click?id=1001');

    const bookworm = out.find((d) => d.sourceId === 'fmtc-1002');
    expect(bookworm).toBeDefined();
    expect(bookworm?.kind).toBe('sale');
    expect(bookworm?.code).toBeUndefined();
    expect(bookworm?.discountType).toBe('free_shipping');

    const vintage = out.find((d) => d.sourceId === 'fmtc-1003');
    expect(vintage).toBeDefined();
    expect(vintage?.kind).toBe('code');
    expect(vintage?.discountType).toBe('amt_off');
    expect(vintage?.discountValueCents).toBe(1000);
    // expired in the past relative to test fixture; expiresAt still mapped
    expect(vintage?.expiresAt).toBeInstanceOf(Date);
  });

  it('returns nothing when not configured', async () => {
    const adapter = new FmtcAdapter({ apiKey: '' });
    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);
    expect(out).toEqual([]);
  });

  it('mapFmtcCoupon returns null when advertiserName is missing', () => {
    expect(
      mapFmtcCoupon({
        id: 'x',
        advertiserName: '',
      } as FmtcCoupon)
    ).toBeNull();
  });
});
