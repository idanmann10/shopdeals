/**
 * Affiliate-link rewriting layer.
 *
 * Sits between the DB row's `deeplink` and what we return to an agent. The
 * goal is simple: when an agent's user clicks the link and buys, we want
 * the commission to come back to us — not to whoever surfaced the deal
 * upstream.
 *
 * Two backends today:
 *
 *   1. Amazon Associates (free, instant signup) — appends a `tag=` param
 *      to amazon.* URLs.
 *   2. Skimlinks (universal monetization, free signup) — wraps ANY
 *      non-Amazon merchant URL through `go.skimresources.com/?id=PUBID&url=...`,
 *      which routes the click through whichever affiliate network Skimlinks
 *      has the merchant in. One signup, thousands of merchants.
 *
 * Order: Amazon → Skimlinks → no-op. We do Amazon first because Associates
 * pays more than Skimlinks' cut would on the same click, and because the
 * Amazon path leaves the URL human-readable.
 *
 * Design notes:
 *   - URL parsing is permissive. We never throw on a malformed deeplink; we
 *     just return the input untouched.
 *   - If a deeplink already has an affiliate tag on Amazon, we don't
 *     overwrite it. That preserves creator-attributed links.
 *   - We never wrap a slickdeals.net or other community-aggregator URL
 *     through Skimlinks — those aren't merchant URLs.
 *   - The env reads happen at construction time, not per-call.
 */

import { env } from './env.ts';

export interface AffiliateConfig {
  /** Amazon Associates tracking tag, e.g. `snapai-20`. */
  amazonAssociatesTag?: string;
  /** Skimlinks publisher id (numeric, from your Skimlinks dashboard). */
  skimlinksPublisherId?: string;
}

export interface RewriteResult {
  /** The URL the agent should hand to the user. */
  url: string;
  /** Which affiliate program (if any) was applied. */
  applied?: 'amazon-associates' | 'skimlinks' | 'noop';
}

const AMAZON_HOST_RE = /(?:^|\.)amazon\.(com|co\.uk|de|fr|it|es|ca|com\.mx|co\.jp|in|com\.au|com\.br|cn)$/i;

/**
 * Hosts we never want to wrap through Skimlinks — they're community pages
 * or aggregators, not merchant checkouts.
 */
const SKIMLINKS_EXCLUDE = new Set([
  'slickdeals.net',
  'slickdealscdn.com',
  'reddit.com',
  'old.reddit.com',
  'r.reddit.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'instagram.com',
  // Google's own shopping / search redirector pages aren't merchants —
  // Skimlinks won't pay on them and the wrapped URL looks spammy. We
  // surface the google.com URL unchanged so the agent can still render a
  // working link; direct merchant URLs come from the SerpApi
  // `google_immersive_product` follow-up handled in src/lib/serpapi.ts.
  'google.com',
  'google.co.uk',
]);

export function createAffiliateRewriter(overrides: AffiliateConfig = {}): {
  rewrite: (url: string | undefined | null) => RewriteResult;
  config: AffiliateConfig;
} {
  const e = (() => {
    try {
      return env();
    } catch {
      return undefined;
    }
  })();

  const amazonTag = overrides.amazonAssociatesTag ?? e?.AMAZON_ASSOCIATES_TAG;
  const skimPub = overrides.skimlinksPublisherId ?? e?.SKIMLINKS_PUBLISHER_ID;

  const config: AffiliateConfig = {
    ...(amazonTag ? { amazonAssociatesTag: amazonTag } : {}),
    ...(skimPub ? { skimlinksPublisherId: skimPub } : {}),
  };

  const rewrite = (url: string | undefined | null): RewriteResult => {
    if (!url || typeof url !== 'string') return { url: url ?? '' };
    const trimmed = url.trim();
    if (trimmed.length === 0) return { url };

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { url };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url };
    }

    const host = parsed.hostname.toLowerCase();

    // 1. Amazon Associates path.
    if (AMAZON_HOST_RE.test(host) && config.amazonAssociatesTag) {
      if (parsed.searchParams.has('tag')) return { url, applied: 'noop' };
      parsed.searchParams.set('tag', config.amazonAssociatesTag);
      return { url: parsed.toString(), applied: 'amazon-associates' };
    }

    // 2. Skimlinks universal path. Wraps the URL through Skimlinks'
    //    redirector, which routes via whichever network they have the
    //    merchant in. Skip if the host is on our exclude list (community
    //    pages, social) or if it's already an Amazon URL (handled above
    //    or deliberately not wrapped because we have no tag).
    if (config.skimlinksPublisherId && !AMAZON_HOST_RE.test(host) && !isExcludedHost(host)) {
      const wrapped =
        `https://go.skimresources.com/?id=${encodeURIComponent(config.skimlinksPublisherId)}` +
        `&url=${encodeURIComponent(parsed.toString())}`;
      return { url: wrapped, applied: 'skimlinks' };
    }

    return { url, applied: 'noop' };
  };

  return { rewrite, config };
}

function isExcludedHost(host: string): boolean {
  if (SKIMLINKS_EXCLUDE.has(host)) return true;
  // Match subdomains too: `*.slickdeals.net`.
  for (const blocked of SKIMLINKS_EXCLUDE) {
    if (host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/**
 * Convenience: detect whether a URL is an Amazon product link with an
 * extractable ASIN. Used by the Slickdeals adapter to decide whether to
 * keep an outbound merchant URL vs. fall back to the community thread.
 */
export function extractAmazonAsin(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!AMAZON_HOST_RE.test(parsed.hostname)) return undefined;
  // `/dp/B0XXXXX...` or `/gp/product/B0XXXXX...`.
  const m = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return m?.[1]?.toUpperCase();
}
