/**
 * Slickdeals adapter tests. We mock `fetch` against a small XML fixture that
 * exercises every title-shape the heuristic merchant extractor cares about,
 * plus one "no merchant" row to confirm we drop it cleanly.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SlickdealsAdapter,
  extractMerchantFromTitle,
  mapSlickdealsItem,
  parseRssItems,
} from '../../src/sources/slickdeals.ts';
import type { RawDealInput } from '../../src/sources/common.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'fixtures', 'slickdeals-frontpage.xml');

async function loadFixture(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

function makeFetch(body: string, status = 200): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit | undefined });
    return new Response(body, { status, headers: { 'content-type': 'application/rss+xml' } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('SlickdealsAdapter', () => {
  it('is always configured (public RSS, no key)', () => {
    expect(new SlickdealsAdapter().isConfigured()).toBe(true);
  });

  it('sends a friendly User-Agent to the feed URL', async () => {
    const xml = await loadFixture();
    const { impl, calls } = makeFetch(xml);
    const adapter = new SlickdealsAdapter({ fetchImpl: impl });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(calls).toHaveLength(1);
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Snap-AI/);
    expect(calls[0]!.url).toContain('slickdeals.net');
  });

  it('parses + maps real-shaped items, dropping ones without a merchant', async () => {
    const xml = await loadFixture();
    const { impl } = makeFetch(xml);
    const adapter = new SlickdealsAdapter({ fetchImpl: impl });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    // 5 items in the fixture; 1 has no extractable merchant -> 4 yielded.
    expect(out).toHaveLength(4);
    for (const d of out) {
      expect(d.sourceNetwork).toBe('slickdeals');
      expect(d.kind).toBe('sale');
      expect(d.attributionSource).toBe('slickdeals');
      expect(d.deeplink).toMatch(/slickdeals\.net\/f\//);
      // Coupon code field must never be set — Slickdeals isn't a code feed.
      expect(d.code).toBeUndefined();
    }

    const bestBuy = out.find((d) => d.sourceId === 'slickdeals-12345');
    expect(bestBuy?.merchant.displayName).toBe('Best Buy');
    expect(bestBuy?.merchant.slug).toBe('best-buy');
    expect(bestBuy?.title).toMatch(/Sony WH-1000XM5/);
    // Description has HTML stripped + entities decoded.
    expect(bestBuy?.description).toContain('add to cart');
    expect(bestBuy?.description).not.toContain('<a href');
    expect(bestBuy?.description).toContain('&'); // &amp; -> &

    const rei = out.find((d) => d.sourceId === 'slickdeals-22222');
    expect(rei?.merchant.displayName).toBe('REI');
    expect(rei?.discountType).toBe('pct_off');
    expect(rei?.discountValueBps).toBe(3000); // 30%

    const costco = out.find((d) => d.sourceId === 'slickdeals-33333');
    expect(costco?.merchant.displayName).toBe('Costco');

    const amazon = out.find((d) => d.sourceId === 'slickdeals-55555');
    expect(amazon?.merchant.displayName).toBe('Amazon');
    // The "$14.99 from Amazon" pattern must trim Amazon out of the cleaned title.
    expect(amazon?.title).not.toMatch(/Amazon$/);
  });

  it('logs and returns nothing when the feed errors', async () => {
    const { impl } = makeFetch('upstream blew up', 503);
    const adapter = new SlickdealsAdapter({ fetchImpl: impl });
    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);
    expect(out).toEqual([]);
  });

  it('respects maxItems', async () => {
    const xml = await loadFixture();
    const { impl } = makeFetch(xml);
    const adapter = new SlickdealsAdapter({ fetchImpl: impl, maxItems: 2 });
    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);
    expect(out).toHaveLength(2);
  });
});

describe('parseRssItems', () => {
  it('extracts every item even when fields are out of order', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>A</title><link>https://x/1</link><guid>1</guid></item>
      <item><guid>2</guid><title>B</title><link>https://x/2</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('A');
    expect(items[1]!.title).toBe('B');
  });

  it('returns an empty array on garbage input', () => {
    expect(parseRssItems('not xml at all')).toEqual([]);
  });
});

describe('extractMerchantFromTitle', () => {
  it('handles bracket-prefix titles', () => {
    expect(extractMerchantFromTitle('[Best Buy] Sony headphones $279')).toEqual({
      merchant: 'Best Buy',
      cleanTitle: 'Sony headphones $279',
    });
  });

  it('handles "at Merchant" suffix titles', () => {
    expect(extractMerchantFromTitle('Patagonia jacket 30% off at REI')).toEqual({
      merchant: 'REI',
      cleanTitle: 'Patagonia jacket 30% off',
    });
  });

  it('handles "from Merchant" with .com suffix', () => {
    expect(extractMerchantFromTitle('Charger $14.99 from Amazon.com')).toEqual({
      merchant: 'Amazon',
      cleanTitle: 'Charger $14.99',
    });
  });

  it('returns null when no merchant pattern matches', () => {
    expect(extractMerchantFromTitle('A vague deal with no merchant')).toBeNull();
  });

  it('rejects bracket prefixes that are too short to be a real merchant', () => {
    expect(extractMerchantFromTitle('[a] short')).toBeNull();
  });
});

describe('mapSlickdealsItem', () => {
  it('returns null when title is missing or trivial', () => {
    expect(mapSlickdealsItem({})).toBeNull();
    expect(mapSlickdealsItem({ title: 'tiny' })).toBeNull();
  });

  it('returns null when no merchant can be inferred', () => {
    expect(
      mapSlickdealsItem({
        title: 'Some deal nobody attributed',
        link: 'https://slickdeals.net/f/x',
        guid: 'x',
      }),
    ).toBeNull();
  });

  it('returns null when both guid and link are missing', () => {
    expect(
      mapSlickdealsItem({
        title: '[Costco] Apple AirPods $189',
      }),
    ).toBeNull();
  });
});
