/**
 * Slickdeals adapter.
 *
 * Source: the public frontpage RSS feed at
 * `https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1`.
 * No API key required — Slickdeals has served this feed openly for years.
 *
 * Slickdeals is a community-curated deal site, NOT a coupon-code feed. Items
 * are price-drop alerts and sale links rather than promo codes, so every row
 * is upserted with `kind='sale'` and no `code` field. The `deeplink` is the
 * Slickdeals thread URL (not the raw merchant URL) — that keeps attribution
 * pointed at the community that surfaced the deal.
 *
 * Title parsing: Slickdeals titles tend to follow one of two shapes:
 *   "[Merchant] Item description $X off"
 *   "Item description at Merchant"
 *   "Item description from Merchant.com"
 * We extract the merchant heuristically and drop rows we can't attribute
 * cleanly — letting unparseable rows in would mean every find_deals query
 * for "Patagonia" returns "Sony WH-1000XM5" because both ended up under a
 * synthetic "slickdeals" bucket.
 *
 * The XML parser is hand-rolled: Slickdeals RSS is small and stable enough
 * that pulling in fast-xml-parser would be more dependency than it's worth.
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
    for (const item of items) {
      if (yielded >= this.maxItems) break;
      const mapped = mapSlickdealsItem(item);
      if (mapped) {
        yielded += 1;
        yield mapped;
      }
    }
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
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m?.[1]) return undefined;
  return decodeCdataAndEntities(m[1]).trim() || undefined;
}

function decodeCdataAndEntities(raw: string): string {
  // Unwrap a single surrounding CDATA section. RSS occasionally wraps the
  // entire field; nested CDATA within entity-encoded content is out of scope.
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
 * Heuristic merchant extraction from a Slickdeals title.
 *
 * Returns `null` when nothing recognizable matches — the caller drops those
 * items rather than coalescing them under a synthetic "slickdeals" merchant.
 */
export function extractMerchantFromTitle(
  title: string,
): { merchant: string; cleanTitle: string } | null {
  const trimmed = title.trim();

  // Pattern 1: "[Merchant] rest of title"
  const bracket = trimmed.match(/^\[([^\]]{2,40})\]\s*(.{4,})$/);
  if (bracket?.[1] && bracket[2]) {
    return { merchant: cleanMerchantName(bracket[1]), cleanTitle: bracket[2].trim() };
  }

  // Pattern 2: "... at Merchant" / "... via Merchant" / "... from Merchant"
  //            (with an optional .com suffix and trailing punctuation)
  const tail = trimmed.match(
    /^(.{4,}?)\s+(?:at|via|from|on)\s+([A-Z][\w &.'-]{1,30}?)(?:\.com)?[\s.,!]*$/i,
  );
  if (tail?.[1] && tail[2]) {
    return { merchant: cleanMerchantName(tail[2]), cleanTitle: tail[1].trim() };
  }

  return null;
}

function cleanMerchantName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\.com\b/i, '')
    .replace(/[.,!]+$/, '')
    .trim();
}

/**
 * Map a single parsed RSS item to a `RawDealInput`. Returns `null` when:
 *   - the title is missing or shorter than what we'd consider a real deal
 *   - the merchant can't be extracted
 *   - we have no stable identifier (`guid` or `link`)
 */
export function mapSlickdealsItem(item: SlickdealsRssItem): RawDealInput | null {
  const title = item.title?.trim();
  if (!title || title.length < 8) return null;

  const extracted = extractMerchantFromTitle(title);
  if (!extracted) return null;

  const { merchant, cleanTitle } = extracted;
  const sourceId = item.guid?.trim() || item.link?.trim();
  if (!sourceId) return null;

  const text = `${cleanTitle} ${item.description ?? ''}`.trim();
  const parsed = parseDiscountFromText(text);

  const pubDate = toDate(item.pubDate);

  const sourceMeta: Record<string, unknown> = {};
  if (item.category) sourceMeta['category'] = item.category;
  if (item.description) sourceMeta['rawDescription'] = item.description.slice(0, 2000);
  if (item.guid) sourceMeta['guid'] = item.guid;
  sourceMeta['rawTitle'] = title;

  const out: RawDealInput = {
    sourceNetwork: 'slickdeals',
    sourceId,
    merchant: {
      slug: slugify(merchant),
      displayName: merchant,
    },
    kind: 'sale',
    title: cleanTitle.slice(0, 512),
    discountType: parsed.discountType ?? 'unknown',
    attributionSource: 'slickdeals',
    sourceMeta,
  };

  if (item.description) {
    // Strip HTML tags from the description before persisting — Slickdeals
    // packs links and small inline markup that's not useful at the API
    // boundary.
    out.description = stripHtml(item.description).slice(0, 4000);
  }
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (item.link) out.deeplink = item.link;
  if (pubDate) out.startsAt = pubDate;
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}
