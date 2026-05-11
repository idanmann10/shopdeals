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
});
