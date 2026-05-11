/**
 * Slickdeals adapter tests. The fixture is built to mirror real Slickdeals
 * RSS shape: titles are product names (not "[Merchant] ..."), and the
 * merchant lives in `content:encoded` data-attributes (data-store-slug /
 * data-product-exitWebsite). Several fallback signal paths are also
 * exercised: a `Merchant has ...` description prefix, a `merchant.com`
 * URL in description text, and one row that has none of these (gets
 * dropped on purpose).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SlickdealsAdapter,
  extractMerchant,
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

  it('extracts merchant from data-store-slug, description, and URL signals', async () => {
    const xml = await loadFixture();
    const { impl } = makeFetch(xml);
    const adapter = new SlickdealsAdapter({ fetchImpl: impl });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    // 5 items in the fixture; 1 has no merchant signal -> 4 yielded.
    expect(out).toHaveLength(4);
    for (const d of out) {
      expect(d.sourceNetwork).toBe('slickdeals');
      expect(d.kind).toBe('sale');
      expect(d.attributionSource).toBe('slickdeals');
      expect(d.deeplink).toMatch(/slickdeals\.net\/f\//);
      // Slickdeals isn't a code feed.
      expect(d.code).toBeUndefined();
    }

    // 1. data-store-slug "amazon" -> "Amazon"
    const dawn = out.find((d) => d.sourceId === 'thread-11111');
    expect(dawn?.merchant.slug).toBe('amazon');
    expect(dawn?.merchant.displayName).toBe('Amazon');

    // 2. data-store-slug "the-home-depot" -> "The Home Depot"
    const ryobi = out.find((d) => d.sourceId === 'thread-22222');
    expect(ryobi?.merchant.slug).toBe('the-home-depot');
    expect(ryobi?.merchant.displayName).toBe('The Home Depot');

    // 3. Fallback: "REI has Patagonia..." text pattern -> "REI"
    const patagonia = out.find((d) => d.sourceId === 'thread-33333');
    expect(patagonia?.merchant.displayName).toBe('REI');
    expect(patagonia?.discountType).toBe('pct_off');
    expect(patagonia?.discountValueBps).toBe(3000);

    // 4. Fallback: URL hostname in content:encoded -> bestbuy
    const sony = out.find((d) => d.sourceId === 'thread-55555');
    expect(sony?.merchant.slug).toBe('bestbuy');
    expect(sony?.merchant.displayName).toBe('Best Buy');
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
  it('extracts every item including content:encoded fields', () => {
    const xml = `<?xml version="1.0"?><rss xmlns:content="x"><channel>
      <item>
        <title>A</title>
        <link>https://x/1</link>
        <content:encoded>html-body</content:encoded>
        <guid>1</guid>
      </item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('A');
    expect(items[0]!.contentEncoded).toBe('html-body');
  });

  it('returns an empty array on garbage input', () => {
    expect(parseRssItems('not xml at all')).toEqual([]);
  });
});

describe('extractMerchant', () => {
  it('prefers data-store-slug over description text', () => {
    const m = extractMerchant({
      contentEncoded: '<a data-store-slug="amazon" data-product-exitWebsite="amazon.com">x</a>',
      description: 'Walmart has the same thing.',
    });
    expect(m).toEqual({ slug: 'amazon', displayName: 'Amazon' });
  });

  it('falls back to data-product-exitWebsite when slug is missing', () => {
    const m = extractMerchant({
      contentEncoded: '<a data-product-exitWebsite="walmart.com">x</a>',
    });
    expect(m?.slug).toBe('walmart');
    expect(m?.displayName).toBe('Walmart');
  });

  it('falls back to "Merchant has ..." patterns in plaintext description', () => {
    const m = extractMerchant({ description: 'REI has these Patagonia sweaters cheap.' });
    expect(m).toEqual({ slug: 'rei', displayName: 'REI' });
  });

  it('handles "*Merchant* [merchant.com]" markdown patterns', () => {
    const m = extractMerchant({
      description: '*Costco* [costco.com] has AirPods Pro for $189.',
    });
    expect(m?.displayName).toBe('Costco');
  });

  it('falls back to URL hostname when no other signal is present', () => {
    const m = extractMerchant({
      description: 'Deal at https://www.newegg.com/p/12345 for $99.',
    });
    expect(m?.slug).toBe('newegg');
  });

  it('returns null when nothing recognizable is present', () => {
    expect(extractMerchant({ description: 'Some random sentence with no signals.' })).toBeNull();
    expect(extractMerchant({})).toBeNull();
  });

  it('ignores a slickdeals.net hostname as a merchant fallback', () => {
    const m = extractMerchant({
      description: 'Visit https://slickdeals.net/forum/12345 for details.',
    });
    expect(m).toBeNull();
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
        title: 'A perfectly long product name with no merchant signal',
        link: 'https://slickdeals.net/f/x',
        guid: 'x',
      }),
    ).toBeNull();
  });

  it('returns null when both guid and link are missing', () => {
    expect(
      mapSlickdealsItem({
        title: 'Long enough product title to pass the length guard',
        contentEncoded: '<a data-store-slug="amazon">x</a>',
      }),
    ).toBeNull();
  });
});
