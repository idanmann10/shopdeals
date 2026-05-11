/**
 * Affiliate-link rewriting layer.
 *
 * Sits between the DB row's `deeplink` and what we return to an agent. The
 * goal is simple: when an agent's user clicks the link and buys, we want
 * the commission to come back to us — not to whoever surfaced the deal
 * upstream.
 *
 * Today we only handle Amazon (free, instant signup via Amazon Associates).
 * The shape is set up so adding Skimlinks / Awin / Impact wrappers later
 * means one new function and one new env var per network — no changes
 * needed at the call sites.
 *
 * Design notes:
 *   - URL parsing is permissive. We never throw on a malformed deeplink; we
 *     just return the input untouched. A broken affiliate wrap is worse
 *     than no wrap at all (we'd send the user to a 404).
 *   - If a deeplink already has an affiliate tag, we don't overwrite it.
 *     That preserves Slickdeals' existing affiliate when we use their
 *     thread URLs, and avoids stomping a creator-attributed link.
 *   - The env reads happen at construction time, not per-call, so flipping
 *     env vars at runtime requires a restart. That's intentional — we don't
 *     want a partial deploy emitting half-tagged links.
 */

import { env } from './env.ts';

export interface AffiliateConfig {
  /** Amazon Associates tracking tag, e.g. `snapai-20`. */
  amazonAssociatesTag?: string;
}

export interface RewriteResult {
  /** The URL the agent should hand to the user. */
  url: string;
  /** Which affiliate program (if any) was applied. */
  applied?: 'amazon-associates' | 'noop';
}

const AMAZON_HOST_RE = /(?:^|\.)amazon\.(com|co\.uk|de|fr|it|es|ca|com\.mx|co\.jp|in|com\.au|com\.br|cn)$/i;

/**
 * Construct an affiliate rewriter from environment variables. Returns a
 * pre-bound `rewrite(url)` function. Callers should reuse a single instance
 * across requests; it's cheap to hold.
 */
export function createAffiliateRewriter(overrides: AffiliateConfig = {}): {
  rewrite: (url: string | undefined | null) => RewriteResult;
  config: AffiliateConfig;
} {
  const e = (() => {
    try {
      return env() as unknown as Record<string, string | undefined>;
    } catch {
      return undefined;
    }
  })();

  const resolvedTag = overrides.amazonAssociatesTag ?? e?.['AMAZON_ASSOCIATES_TAG'];
  const config: AffiliateConfig = resolvedTag ? { amazonAssociatesTag: resolvedTag } : {};

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

    // Only http(s) URLs are candidates for rewriting.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url };
    }

    const host = parsed.hostname.toLowerCase();

    if (AMAZON_HOST_RE.test(host) && config.amazonAssociatesTag) {
      // Don't stomp an existing tag — could be from an upstream creator's
      // attribution that we want to preserve.
      if (parsed.searchParams.has('tag')) return { url, applied: 'noop' };
      parsed.searchParams.set('tag', config.amazonAssociatesTag);
      return { url: parsed.toString(), applied: 'amazon-associates' };
    }

    return { url, applied: 'noop' };
  };

  return { rewrite, config };
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
