/**
 * Shared types, interfaces, and helpers for source adapters.
 *
 * Source adapters are responsible for talking to a single affiliate-network
 * API (FMTC, Awin, Impact, etc.) and yielding `RawDealInput` records that the
 * canonical upsert pipeline can normalize and persist.
 */

/**
 * The canonical, network-agnostic shape of a single deal as produced by an
 * adapter. The upsert pipeline maps this to rows in `merchants` and `deals`.
 */
export interface RawDealInput {
  sourceNetwork:
    | 'fmtc'
    | 'awin'
    | 'impact'
    | 'cj'
    | 'rakuten'
    | 'skimlinks'
    | 'partnerize'
    | 'slickdeals'
    | 'manual'
    | 'telemetry';
  sourceId: string;
  merchant: {
    slug: string;
    displayName: string;
    domains?: string[];
    categories?: string[];
    countries?: string[];
    homepageUrl?: string;
  };
  kind: 'code' | 'automatic' | 'cashback' | 'sale' | 'bogo';
  code?: string;
  title: string;
  description?: string;
  discountType?: 'pct_off' | 'amt_off' | 'free_shipping' | 'gift' | 'tiered' | 'unknown';
  discountValueBps?: number;
  discountValueCents?: number;
  cartMinCents?: number;
  geoScope?: string[];
  segment?: 'general' | 'new_customer' | 'student' | 'military' | 'email_signup' | 'first_app_purchase';
  startsAt?: Date;
  expiresAt?: Date;
  deeplink?: string;
  attributionSource?: string;
  sourceMeta?: Record<string, unknown>;
}

export interface IngestResult {
  dealsUpserted: number;
  merchantsUpserted: number;
}

export interface SourceAdapter {
  network: RawDealInput['sourceNetwork'];
  isConfigured(): boolean;
  fetch(): AsyncIterable<RawDealInput>;
}

/**
 * Lowercase, hyphenate, and strip non-alphanumeric characters. Used to derive
 * stable `merchants.slug` values from advertiser display names.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

/** Lowercase, trim, and dedupe. Empty strings are removed. */
function dedupeLower(values: readonly string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const t = v.trim().toLowerCase();
    if (t.length > 0) seen.add(t);
  }
  return seen.size === 0 ? undefined : [...seen];
}

/** Two-letter country codes upper-cased and deduped. Anything not 2 letters is dropped. */
function normalizeCountries(values: readonly string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const t = v.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(t)) seen.add(t);
  }
  return seen.size === 0 ? undefined : [...seen];
}

/**
 * Normalize a merchant input so that the slug is derived from the display
 * name when not already provided, and arrays are trimmed/deduped/lowercased
 * (or upper-cased for country codes).
 */
export function normalizeMerchantInput(
  m: RawDealInput['merchant']
): RawDealInput['merchant'] {
  const displayName = m.displayName?.trim() ?? '';
  const slug = m.slug?.trim() ? slugify(m.slug) : slugify(displayName);
  const out: RawDealInput['merchant'] = {
    slug,
    displayName: displayName || slug,
  };
  const domains = dedupeLower(m.domains);
  if (domains) out.domains = domains;
  const categories = dedupeLower(m.categories);
  if (categories) out.categories = categories;
  const countries = normalizeCountries(m.countries);
  if (countries) out.countries = countries;
  if (m.homepageUrl && m.homepageUrl.trim().length > 0) {
    out.homepageUrl = m.homepageUrl.trim();
  }
  return out;
}

/**
 * Best-effort parser that extracts `discountType`, `discountValueBps`, and
 * `discountValueCents` from a coupon's title/description. Networks rarely
 * structure this consistently, so we use lightweight regexes.
 *
 * Returns an object with only the fields that could be inferred.
 */
export function parseDiscountFromText(text: string | undefined | null): {
  discountType?: RawDealInput['discountType'];
  discountValueBps?: number;
  discountValueCents?: number;
} {
  if (!text) return {};
  const lower = text.toLowerCase();

  if (/free\s+ship/.test(lower)) {
    return { discountType: 'free_shipping' };
  }

  // "20% off", "up to 50% off", "save 15%"
  const pct = lower.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (pct?.[1]) {
    const pctNum = Number(pct[1]);
    if (Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100) {
      return { discountType: 'pct_off', discountValueBps: Math.round(pctNum * 100) };
    }
  }

  // "$25 off", "save $10", "USD 5 off"
  const dollar = lower.match(/\$\s*(\d{1,5}(?:\.\d{1,2})?)/);
  if (dollar?.[1]) {
    const amt = Number(dollar[1]);
    if (Number.isFinite(amt) && amt > 0) {
      return { discountType: 'amt_off', discountValueCents: Math.round(amt * 100) };
    }
  }

  // BOGO mentions
  if (/\bbogo\b|buy\s+one\s+get\s+one/.test(lower)) {
    return { discountType: 'unknown' };
  }

  // Gift-with-purchase
  if (/free\s+gift|gift\s+with\s+purchase|gwp\b/.test(lower)) {
    return { discountType: 'gift' };
  }

  return {};
}

/**
 * Wrapper around `fetch` that enforces a default timeout via AbortController.
 * Throws on non-2xx responses with a helpful message including the URL and
 * status code.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} ${res.statusText} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** Sleep helper used by paginated fetchers to respect rate limits. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert an unknown date-ish value to a Date, or undefined when invalid. */
export function toDate(value: unknown): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
