/**
 * Unit tests for the Keepa product client. We mock `fetch` to return a static
 * fixture in `test/fixtures/keepa-product.json` and assert that:
 *   - the URL carries the expected query params (key, domain, asin, history)
 *   - the AMAZON channel (csv[0]) is preferred and -1 markers become 'oos'
 *   - the NEW channel (csv[1]) is used only when AMAZON is empty/missing
 *   - timestamps decode against the Keepa minute epoch (2011-01-01 UTC)
 *   - misconfigured / invalid input throws synchronously-ish
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  KEEPA_EPOCH_MINUTES,
  KeepaClient,
  decodeCsvChannel,
} from '../../src/sources/keepa.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'fixtures', 'keepa-product.json');

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as unknown;
}

function makeFetch(body: unknown, status = 200): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit | undefined });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function keepaMinutesToIso(min: number): string {
  return new Date((min + KEEPA_EPOCH_MINUTES) * 60_000).toISOString();
}

describe('KeepaClient', () => {
  it('is not configured without an API key', () => {
    const c = new KeepaClient({ apiKey: '' });
    expect(c.isConfigured()).toBe(false);
  });

  it('throws on invalid ASIN before issuing a request', async () => {
    const { impl, calls } = makeFetch({});
    const c = new KeepaClient({ apiKey: 'k', fetchImpl: impl });
    await expect(c.fetchPriceHistory({ asin: 'NOT-AN-ASIN' })).rejects.toThrow(/invalid ASIN/);
    expect(calls).toHaveLength(0);
  });

  it('builds the expected URL and decodes the AMAZON channel', async () => {
    const fixture = await loadFixture();
    const { impl, calls } = makeFetch(fixture);
    const client = new KeepaClient({ apiKey: 'test-key', fetchImpl: impl });

    const result = await client.fetchPriceHistory({ asin: 'b0example0', days: 30 });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toContain('https://api.keepa.com/product');
    expect(call.url).toContain('key=test-key');
    expect(call.url).toContain('domain=1');
    // ASIN is upper-cased before being sent.
    expect(call.url).toContain('asin=B0EXAMPLE0');
    expect(call.url).toContain('history=1');
    expect(call.url).toContain('days=30');

    expect(result.asin).toBe('B0EXAMPLE0');
    expect(result.domain).toBe(1);
    expect(result.currency).toBe('USD');
    expect(result.tokensLeft).toBe(1180);

    // Fixture csv[0]: 5 pairs, one of which is -1 (OOS). All 5 should
    // surface; the -1 becomes 'oos' with priceCents=0. AMAZON is the
    // preferred channel so csv[1] (NEW) is ignored.
    expect(result.points).toHaveLength(5);
    for (const p of result.points) expect(p.channel).toBe('amazon');

    const oos = result.points.find((p) => p.availability === 'oos');
    expect(oos).toBeDefined();
    expect(oos?.priceCents).toBe(0);

    const inStock = result.points.filter((p) => p.availability === 'in_stock');
    expect(inStock).toHaveLength(4);
    expect(inStock[0]?.priceCents).toBe(2499);
    expect(inStock.at(-1)?.priceCents).toBe(1899);

    // First point's timestamp decodes against the Keepa epoch.
    expect(result.points[0]?.observedAt).toBe(keepaMinutesToIso(7964640));
  });

  it('falls back to the NEW channel when AMAZON is empty', async () => {
    const fixture = (await loadFixture()) as {
      products: Array<{ asin: string; csv: Array<number[] | null> }>;
    };
    fixture.products[0]!.csv[0] = null;
    const { impl } = makeFetch(fixture);
    const client = new KeepaClient({ apiKey: 'k', fetchImpl: impl });

    const result = await client.fetchPriceHistory({ asin: 'B0EXAMPLE0' });

    expect(result.points).toHaveLength(3);
    for (const p of result.points) expect(p.channel).toBe('new');
    expect(result.points[0]?.priceCents).toBe(2599);
    expect(result.points.at(-1)?.priceCents).toBe(1999);
  });

  it('returns an empty series when both channels are missing', async () => {
    const { impl } = makeFetch({ products: [{ asin: 'B0EXAMPLE0', csv: [null, null] }] });
    const client = new KeepaClient({ apiKey: 'k', fetchImpl: impl });
    const result = await client.fetchPriceHistory({ asin: 'B0EXAMPLE0' });
    expect(result.points).toEqual([]);
  });

  it('surfaces a useful error on non-2xx responses', async () => {
    const { impl } = makeFetch({ error: { message: 'no tokens left' } }, 400);
    const client = new KeepaClient({ apiKey: 'k', fetchImpl: impl });
    await expect(client.fetchPriceHistory({ asin: 'B0EXAMPLE0' })).rejects.toThrow(
      /Keepa HTTP 400.*no tokens left/,
    );
  });

  it('rejects unsupported domains before hitting the network', async () => {
    const { impl, calls } = makeFetch({});
    const client = new KeepaClient({ apiKey: 'k', fetchImpl: impl });
    await expect(
      client.fetchPriceHistory({ asin: 'B0EXAMPLE0', domain: 99 }),
    ).rejects.toThrow(/unsupported Keepa domain/);
    expect(calls).toHaveLength(0);
  });
});

describe('decodeCsvChannel', () => {
  it('returns an empty array for null / undersized input', () => {
    expect(decodeCsvChannel(null, 'amazon')).toEqual([]);
    expect(decodeCsvChannel([1], 'amazon')).toEqual([]);
  });

  it('skips odd trailing entries rather than crashing', () => {
    const out = decodeCsvChannel([0, 1500, 60, 1400, 120], 'amazon');
    expect(out).toHaveLength(2);
    expect(out[0]?.priceCents).toBe(1500);
    expect(out[1]?.priceCents).toBe(1400);
  });

  it('marks -1 as oos with zero priceCents', () => {
    const out = decodeCsvChannel([10, -1, 20, 999], 'new');
    expect(out).toHaveLength(2);
    expect(out[0]?.availability).toBe('oos');
    expect(out[0]?.priceCents).toBe(0);
    expect(out[1]?.availability).toBe('in_stock');
  });
});
