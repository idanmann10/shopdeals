/**
 * Affiliate-rewriter tests. Verifies the layer is safe (never throws on
 * weird inputs, never overwrites existing tags) and that the Amazon
 * Associates path actually inserts the configured tag.
 */
import { describe, expect, it } from 'vitest';
import {
  createAffiliateRewriter,
  extractAmazonAsin,
} from '../../src/lib/affiliate.ts';

describe('createAffiliateRewriter', () => {
  it('no-op when no tags are configured', () => {
    const { rewrite } = createAffiliateRewriter({});
    const r = rewrite('https://www.amazon.com/dp/B0CHX1W1XY');
    expect(r.url).toBe('https://www.amazon.com/dp/B0CHX1W1XY');
    expect(r.applied).toBe('noop');
  });

  it('appends the configured tag to amazon.com URLs without one', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' });
    const r = rewrite('https://www.amazon.com/dp/B0CHX1W1XY');
    expect(r.applied).toBe('amazon-associates');
    expect(r.url).toContain('tag=snapai-20');
  });

  it('preserves an existing tag rather than overwriting it', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' });
    const r = rewrite('https://www.amazon.com/dp/B0CHX1W1XY?tag=creator-21');
    expect(r.url).toBe('https://www.amazon.com/dp/B0CHX1W1XY?tag=creator-21');
    expect(r.applied).toBe('noop');
  });

  it('handles regional Amazon TLDs', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-21' });
    for (const url of [
      'https://www.amazon.co.uk/dp/B0X',
      'https://www.amazon.de/dp/B0X',
      'https://amazon.ca/dp/B0X',
    ]) {
      const r = rewrite(url);
      expect(r.applied).toBe('amazon-associates');
      expect(r.url).toContain('tag=snapai-21');
    }
  });

  it('leaves non-amazon URLs alone', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' });
    const r = rewrite('https://www.homedepot.com/p/ryobi/12345');
    expect(r.url).toBe('https://www.homedepot.com/p/ryobi/12345');
    expect(r.applied).toBe('noop');
  });

  it('does not throw on malformed input', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' });
    expect(rewrite('').url).toBe('');
    expect(rewrite('not a url').url).toBe('not a url');
    expect(rewrite(undefined).url).toBe('');
    expect(rewrite(null).url).toBe('');
  });

  it('refuses non-http(s) protocols', () => {
    const { rewrite } = createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' });
    const r = rewrite('javascript:alert(1)');
    expect(r.url).toBe('javascript:alert(1)');
    expect(r.applied).toBeUndefined();
  });

  it('wraps non-Amazon merchant URLs through Skimlinks when configured', () => {
    const { rewrite } = createAffiliateRewriter({ skimlinksPublisherId: '123456' });
    const r = rewrite('https://www.bestbuy.com/site/airpods/123');
    expect(r.applied).toBe('skimlinks');
    expect(r.url).toMatch(/^https:\/\/go\.skimresources\.com\/\?id=123456&url=/);
    expect(decodeURIComponent(r.url.split('url=')[1] ?? '')).toBe(
      'https://www.bestbuy.com/site/airpods/123',
    );
  });

  it('prefers Amazon Associates over Skimlinks for amazon.com', () => {
    const { rewrite } = createAffiliateRewriter({
      amazonAssociatesTag: 'snapai-20',
      skimlinksPublisherId: '123456',
    });
    const r = rewrite('https://www.amazon.com/dp/B0X');
    expect(r.applied).toBe('amazon-associates');
    expect(r.url).toContain('tag=snapai-20');
    expect(r.url).not.toContain('skimresources');
  });

  it('does not Skimlinks-wrap community / social hosts', () => {
    const { rewrite } = createAffiliateRewriter({ skimlinksPublisherId: '123456' });
    for (const url of [
      'https://slickdeals.net/f/12345',
      'https://reddit.com/r/deals/comments/abc',
      'https://www.youtube.com/watch?v=foo',
      'https://x.com/someone/status/123',
    ]) {
      const r = rewrite(url);
      expect(r.applied).not.toBe('skimlinks');
      expect(r.url).toBe(url);
    }
  });

  it('Skimlinks-wraps even when Amazon tag is set, for non-Amazon hosts', () => {
    const { rewrite } = createAffiliateRewriter({
      amazonAssociatesTag: 'snapai-20',
      skimlinksPublisherId: '123456',
    });
    const r = rewrite('https://www.homedepot.com/p/ryobi/12345');
    expect(r.applied).toBe('skimlinks');
  });
});

describe('extractAmazonAsin', () => {
  it('finds an ASIN in /dp/ paths', () => {
    expect(extractAmazonAsin('https://www.amazon.com/dp/B0CHX1W1XY?ref=foo')).toBe('B0CHX1W1XY');
  });

  it('finds an ASIN in /gp/product/ paths', () => {
    expect(extractAmazonAsin('https://www.amazon.com/gp/product/B0EXAMPLE0')).toBe('B0EXAMPLE0');
  });

  it('returns undefined for non-Amazon hosts', () => {
    expect(extractAmazonAsin('https://www.bestbuy.com/dp/B0X')).toBeUndefined();
  });

  it('returns undefined for malformed URLs', () => {
    expect(extractAmazonAsin('not a url')).toBeUndefined();
  });
});
