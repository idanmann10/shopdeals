/**
 * Unit tests for the FMTC v3 adapter. We mock `fetch` to return the static
 * fixture in `test/fixtures/fmtc-page-1.json`, then drive the adapter and
 * assert the normalized records and the request shape.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FmtcAdapter, mapFmtcCoupon, type FmtcCoupon } from '../../src/sources/fmtc.ts';
import type { RawDealInput } from '../../src/sources/common.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'fixtures', 'fmtc-page-1.json');

interface FmtcFixture {
  data: FmtcCoupon[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

async function loadFixture(): Promise<FmtcFixture> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as FmtcFixture;
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
    const body = pages.shift() ?? { data: [], meta: { current_page: 99, last_page: 99 } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: fakeFetch as unknown as typeof fetch, calls };
}

describe('FmtcAdapter', () => {
  it('is not configured without an API key', () => {
    const a = new FmtcAdapter({ apiKey: '' });
    expect(a.isConfigured()).toBe(false);
  });

  it('is configured with an API key', () => {
    const { impl } = makeFakeFetch([]);
    const a = new FmtcAdapter({ apiKey: 'k', fetchImpl: impl });
    expect(a.isConfigured()).toBe(true);
  });

  it('uses the v3 base URL with snake_case query params and bearer header', async () => {
    const fixture = await loadFixture();
    const { impl, calls } = makeFakeFetch([fixture]);
    const adapter = new FmtcAdapter({
      apiKey: 'test-key',
      pageSize: 200,
      fetchImpl: impl,
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toContain('https://s3.fmtc.co/api/v3/coupons');
    expect(call.url).toContain('api_key=test-key');
    expect(call.url).toContain('page=1');
    expect(call.url).toContain('page_size=200');
    expect(call.url).not.toContain('per_page=');

    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['Accept']).toBe('application/json');

    // last_page=1 in the fixture means we should stop after one request.
    expect(out).toHaveLength(3);
  });

  it('yields normalized RawDealInputs from a fixture', async () => {
    const fixture = await loadFixture();
    const { impl } = makeFakeFetch([fixture]);
    const adapter = new FmtcAdapter({
      apiKey: 'test-key',
      pageSize: 200,
      fetchImpl: impl,
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
    // Verification timestamps surface through sourceMeta.
    expect(acme?.sourceMeta?.['codeVerifiedAt']).toBe('2026-05-04T12:00:00Z');
    expect(acme?.sourceMeta?.['linkVerifiedAt']).toBe('2026-05-04T12:00:00Z');
    expect(acme?.sourceMeta?.['couponCodeOnPage']).toBe(true);

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

  it('mapFmtcCoupon returns null when advertiser_name is missing', () => {
    expect(
      mapFmtcCoupon({
        id: 'x',
        advertiser_name: '',
      } as FmtcCoupon)
    ).toBeNull();
  });
});
