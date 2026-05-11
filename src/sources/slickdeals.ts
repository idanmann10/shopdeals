/**
 * Slickdeals adapter.
 *
 * Source: the public frontpage RSS feed at
 * `https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1`.
 * No API key required — Slickdeals has served this feed openly for years.
 *
 * Items are price-drop / sale alerts, not coupon codes, so every row is
 * upserted with `kind='sale'` and no `code` field. The `deeplink` is the
 * Slickdeals thread URL (not the raw merchant URL) — that keeps attribution
 * pointed at the community that surfaced the deal.
 *
 * Merchant attribution (in priority order):
 *   1. `data-store-slug="amazon"` on a click-tracking anchor in the HTML
 *      body. This is Slickdeals' canonical merchant id — they tag every
 *      outbound link to a known retailer.
 *   2. `data-product-exitWebsite="amazon.com"` on the same anchor. Used
 *      when a slug isn't present but the destination domain is.
 *   3. "MERCHANT has ..." or "*MERCHANT* [merchant.com]" patterns in the
 *      plaintext description.
 *   4. First `https://www.MERCHANT.com/...` host found in the description.
 *
 * Rows where none of these resolve are dropped. Letting them through would
 * mean every `find_deals` query for one brand could return unrelated
 * community noise.
 *
 * The XML parser is hand-rolled — Slickdeals RSS is small and stable
 * enough that pulling in fast-xml-parser would be more dependency than
 * it's worth.
 */

import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';
import {
  parseDiscountFromText,
  slugify,
  toDate,
  type RawDealInput,
  type SourceAdapter,
} from './common.ts';

const DEFAULT_FEED_URL =
  'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1';

const USER_AGENT = 'Snap-AI/0.1 (+https://github.com/idanmann10/snap-ai)';

/**
 * Slugs Slickdeals uses on click-tracking anchors don't always map cleanly
 * back to a presentable display name. For the most common retailers we
 * pin the canonical capitalization; everything else falls through to
 * title-cased segments.
 */
const KNOWN_DISPLAY_NAMES: Record<string, string> = {
  amazon: 'Amazon',
  'the-home-depot': 'The Home Depot',
  walmart: 'Walmart',
  'best-buy': 'Best Buy',
  target: 'Target',
  costco: 'Costco',
  bestbuy: 'Best Buy',
  homedepot: 'The Home Depot',
  newegg: 'Newegg',
  rei: 'REI',
  macys: "Macy's",
  nordstrom: 'Nordstrom',
  ebay: 'eBay',
  apple: 'Apple',
  microsoft: 'Microsoft',
};

export interface SlickdealsAdapterOptions {
  feedUrl?: string;
  /** Inject a fetch impl for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional override; defaults to 30s. */
  timeoutMs?: number;
  /** Maximum items to yield per run. Defends against an oversized feed. */
  maxItems?: number;
}

export interface SlickdealsRssItem {
  title?: string;
  link?: string;
  description?: string;
  contentEncoded?: string;
  pubDate?: string;
  category?: string;
  guid?: string;
}

export class SlickdealsAdapter implements SourceAdapter {
  readonly network = 'slickdeals' as const;

  private readonly feedUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxItems: number;

  constructor(opts: SlickdealsAdapterOptions = {}) {
    const e = (() => {
      try {
        return env();
      } catch {
        return undefined as Record<string, string | undefined> | undefined;
      }
    })();
    this.feedUrl =
      opts.feedUrl ??
      (e as Record<string, string | undefined> | undefined)?.['SLICKDEALS_FEED_URL'] ??
      DEFAULT_FEED_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxItems = Math.max(1, opts.maxItems ?? 500);
  }

  /** Slickdeals RSS is free + public — the adapter is always configured. */
  isConfigured(): boolean {
    return true;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    let xml: string;
    try {
      xml = await this.fetchFeed();
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err), feedUrl: this.feedUrl },
        'slickdeals: feed fetch failed',
      );
      return;
    }

    const items = parseRssItems(xml);
    if (items.length === 0) {
      log.warn({ feedUrl: this.feedUrl, bytes: xml.length }, 'slickdeals: parsed zero items');
      return;
    }

    let yielded = 0;
    let dropped = 0;
    for (const item of items) {
      if (yielded >= this.maxItems) break;
      const mapped = mapSlickdealsItem(item);
      if (mapped) {
        yielded += 1;
        yield mapped;
      } else {
        dropped += 1;
      }
    }
    log.info(
      { yielded, dropped, total: items.length },
      'slickdeals: feed processed',
    );
  }

  private async fetchFeed(): Promise<string> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.feedUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} for ${this.feedUrl}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Extract `<item>...</item>` blocks from a raw RSS document. Handles CDATA
 * and the common entity escapes; gives up gracefully on malformed input.
 */
export function parseRssItems(xml: string): SlickdealsRssItem[] {
  const items: SlickdealsRssItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const body = m[1] ?? '';
    const item: SlickdealsRssItem = {};
    const title = extractTag(body, 'title');
    if (title) item.title = title;
    const link = extractTag(body, 'link');
    if (link) item.link = link;
    const description = extractTag(body, 'description');
    if (description) item.description = description;
    const contentEncoded = extractTag(body, 'content:encoded');
    if (contentEncoded) item.contentEncoded = contentEncoded;
    const pubDate = extractTag(body, 'pubDate');
    if (pubDate) item.pubDate = pubDate;
    const category = extractTag(body, 'category');
    if (category) item.category = category;
    const guid = extractTag(body, 'guid');
    if (guid) item.guid = guid;
    items.push(item);
  }
  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  // Tag names can contain `:` (e.g. `content:encoded`). Escape regex
  // metacharacters in the tag name before splicing it into the pattern.
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const m = xml.match(re);
  if (!m?.[1]) return undefined;
  return decodeCdataAndEntities(m[1]).trim() || undefined;
}

function decodeCdataAndEntities(raw: string): string {
  // Unwrap a single surrounding CDATA section.
  const cd = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  let s = cd ? (cd[1] ?? '') : raw;
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  return s;
}

/**
 * Pull a merchant attribution out of a Slickdeals item. Tries the most
 * reliable signals first (Slickdeals' own click-tracking data attributes)
 * before falling back to text-mining the description.
 *
 * Returns `null` when no merchant can be inferred.
 */
export function extractMerchant(
  item: SlickdealsRssItem,
): { slug: string; displayName: string } | null {
  const html = item.contentEncoded ?? '';
  const descText = item.description ? stripHtml(item.description) : '';

  // 1. data-store-slug — most reliable. Slickdeals tags every outbound
  //    link with the canonical merchant slug they use internally.
  const slugMatch = html.match(/data-store-slug=["']([a-z0-9-]+)["']/i);
  if (slugMatch?.[1] && slugMatch[1] !== 'slickdeals') {
    const slug = slugMatch[1].toLowerCase();
    return { slug, displayName: displayNameForSlug(slug) };
  }

  // 2. data-product-exitWebsite="merchant.com"
  const exitMatch = html.match(/data-product-exit[Ww]ebsite=["']([a-z0-9.-]+)["']/i);
  if (exitMatch?.[1]) {
    const host = exitMatch[1].toLowerCase().replace(/^www\./, '').replace(/\.[a-z.]+$/, '');
    if (host && host !== 'slickdeals' && host.length > 1) {
      return { slug: slugify(host), displayName: displayNameForSlug(host) };
    }
  }

  // 3. "Merchant has", "*Merchant*" or "Merchant [merchant.com]" patterns
  //    in the plaintext description.
  const hasMatch = descText.match(
    /^\s*\*?([A-Z][\w &.'-]{1,40}?)\*?\s+(?:has|sells|offers|is\s+selling|is\s+offering)\b/,
  );
  if (hasMatch?.[1]) {
    const name = hasMatch[1].trim();
    return { slug: slugify(name), displayName: name };
  }
  const linked = descText.match(
    /^\s*\*?([A-Z][\w &.'-]{1,40}?)\*?\s*\[\s*([a-z0-9.-]+)\.com\s*\]/i,
  );
  if (linked?.[1]) {
    const name = linked[1].trim();
    return { slug: slugify(name), displayName: name };
  }

  // 4. First URL hostname in description OR content-encoded HTML
  //    (excluding slickdeals.net itself).
  const searchSpace = `${descText} ${stripHtml(html)}`;
  const url = searchSpace.match(/https?:\/\/(?:www\.)?([a-z0-9-]+)\.com\b/i);
  if (url?.[1]) {
    const host = url[1].toLowerCase();
    if (host !== 'slickdeals' && host.length > 1) {
      return { slug: slugify(host), displayName: displayNameForSlug(host) };
    }
  }

  return null;
}

function displayNameForSlug(slug: string): string {
  const canon = KNOWN_DISPLAY_NAMES[slug.toLowerCase()];
  if (canon) return canon;
  // Title-case each segment so "the-home-depot" -> "The Home Depot".
  return slug
    .split(/[-_]/)
    .filter((p) => p.length > 0)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * Map a single parsed RSS item to a `RawDealInput`. Returns `null` when:
 *   - the title is missing / too short
 *   - no merchant can be extracted
 *   - we have no stable identifier (`guid` or `link`)
 */
export function mapSlickdealsItem(item: SlickdealsRssItem): RawDealInput | null {
  const title = item.title?.trim();
  if (!title || title.length < 8) return null;

  const merchant = extractMerchant(item);
  if (!merchant) return null;

  const sourceId = item.guid?.trim() || item.link?.trim();
  if (!sourceId) return null;

  const descText = item.description ? stripHtml(item.description) : '';
  const parsed = parseDiscountFromText(`${title} ${descText}`.trim());

  const pubDate = toDate(item.pubDate);

  const sourceMeta: Record<string, unknown> = { rawTitle: title };
  if (item.category) sourceMeta['category'] = item.category;
  if (descText) sourceMeta['descriptionText'] = descText.slice(0, 2000);
  if (item.guid) sourceMeta['guid'] = item.guid;

  const out: RawDealInput = {
    sourceNetwork: 'slickdeals',
    sourceId,
    merchant: {
      slug: merchant.slug,
      displayName: merchant.displayName,
    },
    kind: 'sale',
    title: title.slice(0, 512),
    discountType: parsed.discountType ?? 'unknown',
    attributionSource: 'slickdeals',
    sourceMeta,
  };

  if (descText) out.description = descText.slice(0, 4000);
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (item.link) out.deeplink = item.link;
  if (pubDate) out.startsAt = pubDate;
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
