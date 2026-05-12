/**
 * Tests for the SerpApi Google Shopping client. We mock fetch and assert:
 *  - URL is correctly built (query, country, api_key, engine)
 *  - response normalization (extracted_price → priceCents, source → merchantSlug)
 *  - graceful handling of empty/error responses
 */
import { describe, expect, it, vi } from 'vitest';
import { SerpApiClient } from '../../src/lib/serpapi.ts';

function makeFetch(body: unknown, status = 200): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit | undefined });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('SerpApiClient', () => {
  it('is not configured without an API key', () => {
    expect(new SerpApiClient({ apiKey: '' }).isConfigured()).toBe(false);
  });

  it('builds the expected URL', async () => {
    const { impl, calls } = makeFetch({ shopping_results: [] });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    await client.search({ query: 'airpods pro', country: 'us', limit: 5 });
    const url = calls[0]!.url;
    expect(url).toContain('engine=google_shopping');
    expect(url).toContain('q=airpods+pro');
    expect(url).toContain('gl=us');
    expect(url).toContain('api_key=k');
    expect(url).toContain('num=5');
  });

  it('normalizes shopping_results into our ShoppingResult shape', async () => {
    const { impl } = makeFetch({
      shopping_results: [
        {
          position: 1,
          title: 'Apple AirPods Pro (2nd Gen) USB-C',
          link: 'https://www.amazon.com/dp/B0D1XD1ZV3',
          source: 'amazon.com',
          price: '$189.00',
          extracted_price: 189,
          old_price: '$249.00',
          extracted_old_price: 249,
          rating: 4.7,
          reviews: 12345,
          thumbnail: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:foo',
          delivery: 'Free shipping',
        },
        {
          position: 2,
          title: 'AirPods Pro',
          link: 'https://www.bestbuy.com/site/airpods-pro/123',
          source: 'Best Buy',
          extracted_price: 199,
        },
      ],
    });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    const out = await client.search({ query: 'airpods' });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: 'Apple AirPods Pro (2nd Gen) USB-C',
      merchantName: 'Amazon',
      merchantSlug: 'amazon',
      priceCents: 18900,
      oldPriceCents: 24900,
      rating: 4.7,
      reviews: 12345,
    });
    expect(out[1]).toMatchObject({
      merchantName: 'Best Buy',
      merchantSlug: 'best-buy',
      priceCents: 19900,
    });
  });

  it('throws when SerpApi returns an error envelope', async () => {
    const { impl } = makeFetch({ error: 'Your account has run out of searches.' });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    await expect(client.search({ query: 'foo' })).rejects.toThrow(/run out of searches/);
  });

  it('throws on non-2xx HTTP', async () => {
    const { impl } = makeFetch({ error: 'bad' }, 401);
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    await expect(client.search({ query: 'foo' })).rejects.toThrow(/SerpApi HTTP 401/);
  });

  it('handles missing shopping_results gracefully', async () => {
    const { impl } = makeFetch({});
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    const out = await client.search({ query: 'foo' });
    expect(out).toEqual([]);
  });

  it('returns an empty array for an empty query', async () => {
    const client = new SerpApiClient({ apiKey: 'k' });
    expect(await client.search({ query: '   ' })).toEqual([]);
  });

  it('captures the immersive_product_page_token from shopping results', async () => {
    const { impl } = makeFetch({
      shopping_results: [{
        title: 'AirPods Pro',
        link: 'https://amazon.com/dp/B0X',
        source: 'amazon.com',
        immersive_product_page_token: 'tok_abc123',
      }],
    });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    const out = await client.search({ query: 'airpods' });
    expect(out[0]?.immersiveToken).toBe('tok_abc123');
  });
});

describe('SerpApiClient.productOffers', () => {
  it('returns normalized SellerOffers with real merchant URLs', async () => {
    const { impl, calls } = makeFetch({
      product_results: {
        title: 'AirPods Pro',
        stores: [
          {
            name: 'Best Buy',
            link: 'https://www.bestbuy.com/site/airpods/12345',
            title: 'Apple AirPods Pro 2nd Gen',
            price: '$159.99',
            extracted_price: 159.99,
            original_price: '$249.00',
            extracted_original_price: 249,
            shipping: '+ $16.49',
            shipping_extracted: 16.49,
            total: '$176.48',
            extracted_total: 176.48,
            discount: '35% off',
            details_and_offers: ['In stock online', 'Free returns'],
          },
          {
            name: 'eBay - seller123',
            link: 'https://www.ebay.com/itm/999',
            extracted_price: 200,
            shipping_extracted: 14.9,
            extracted_total: 214.9,
          },
        ],
      },
    });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    const out = await client.productOffers('tok_abc');

    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toContain('engine=google_immersive_product');
    expect(url).toContain('page_token=tok_abc');

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      merchantName: 'Best Buy',
      merchantSlug: 'best-buy',
      link: 'https://www.bestbuy.com/site/airpods/12345',
      priceCents: 15999,
      shippingCents: 1649,
      totalCents: 17648,
      originalPriceCents: 24900,
      discountLabel: '35% off',
    });
    expect(out[0]!.flags).toContain('In stock online');
    expect(out[0]!.flags).toContain('Free returns');
    expect(out[1]?.merchantName).toBe('EBay Seller123');
  });

  it('falls back to priceCents + shippingCents when total is missing', async () => {
    const { impl } = makeFetch({
      product_results: {
        stores: [{ name: 'Best Buy', link: 'https://www.bestbuy.com/x', extracted_price: 100, shipping_extracted: 9.99 }],
      },
    });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    const out = await client.productOffers('tok');
    expect(out[0]?.totalCents).toBe(10999);
  });

  it('returns an empty array when token is empty', async () => {
    const client = new SerpApiClient({ apiKey: 'k' });
    expect(await client.productOffers('')).toEqual([]);
  });

  it('throws on SerpApi error envelope', async () => {
    const { impl } = makeFetch({ error: 'The Google Product service is no longer offered by Google.' });
    const client = new SerpApiClient({ apiKey: 'k', fetchImpl: impl });
    await expect(client.productOffers('tok')).rejects.toThrow(/no longer/);
  });
});
