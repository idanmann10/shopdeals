/**
 * Keepa product-history client.
 *
 * Unlike the deal SourceAdapters, Keepa is fetched on-demand from the
 * `get_price_history` MCP tool — there's no nightly cron, because price
 * history is per-ASIN and the Keepa token quota is paid. The flow is:
 *
 *   1. Tool handler reads `prices` for the requested ASIN.
 *   2. If the latest observation is older than `STALENESS_MS` (or none
 *      exists), the handler asks this client for fresh history, then
 *      persists each `KeepaPricePoint` into `prices` with `source='keepa'`.
 *   3. Tool returns the up-to-date DB view.
 *
 * Endpoint: `GET https://api.keepa.com/product`
 * Required params: `key`, `domain` (1 = amazon.com), `asin`. `history=1` is
 * the default; we pass it explicitly. `days=N` is honored when supplied — it
 * caps the returned history window server-side.
 *
 * Time encoding: Keepa expresses timestamps as "Keepa minutes" — minutes
 * since 2011-01-01T00:00:00Z. The 1970->2011 offset is 21,564,000 minutes.
 *
 * Price encoding: prices are in the smallest currency unit of the requested
 * domain (cents for domains 1/5/11, pence for domain 2, etc). A value of -1
 * means "no offer / out of stock" at that timestamp and is dropped.
 *
 * CSV channels: Keepa returns `csv` as an array indexed by price type:
 *   csv[0] AMAZON      — Amazon as seller (the "Amazon price")
 *   csv[1] NEW         — lowest marketplace new offer
 *   csv[18] BUY_BOX    — buy box price (includes shipping)
 *
 * We surface AMAZON when present; fall back to NEW otherwise. BUY_BOX has a
 * different encoding (triples: ts, price, shipping) and is not yet decoded.
 */
import { z } from 'zod';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';

// 2011-01-01T00:00:00Z, in minutes since 1970-01-01.
export const KEEPA_EPOCH_MINUTES = 21_564_000;

/** Default freshness window: 24h. Tool handler decides whether to refetch. */
export const KEEPA_DEFAULT_STALENESS_MS = 24 * 60 * 60 * 1000;

/** Maximum domain set we accept. 1 = US, 2 = UK, 3 = DE, 4 = FR, etc. */
const KNOWN_DOMAINS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const DOMAIN_CURRENCY: Record<number, string> = {
  1: 'USD',
  2: 'GBP',
  3: 'EUR',
  4: 'EUR',
  5: 'JPY',
  6: 'CAD',
  7: 'CNY',
  8: 'EUR',
  9: 'INR',
  10: 'EUR',
  11: 'MXN',
};

export interface KeepaPricePoint {
  /** ISO-8601, derived from the Keepa-minutes timestamp. */
  observedAt: string;
  priceCents: number;
  /** 'in_stock' when value > 0, 'oos' when Keepa reported -1. */
  availability: 'in_stock' | 'oos';
  /** Channel the observation came from (currently AMAZON or NEW). */
  channel: 'amazon' | 'new';
}

export interface KeepaFetchOptions {
  /** Amazon ASIN, 10 chars. */
  asin: string;
  /** Keepa domain id; defaults to 1 (amazon.com). */
  domain?: number;
  /** Optional history window in days. When supplied, passed to Keepa's `days` param. */
  days?: number;
}

export interface KeepaFetchResult {
  asin: string;
  domain: number;
  currency: string;
  points: KeepaPricePoint[];
  /** Echoed from Keepa response — useful for cost monitoring. */
  tokensLeft?: number;
  tokensConsumed?: number;
}

const KeepaProductSchema = z
  .object({
    asin: z.string(),
    csv: z.array(z.array(z.number()).nullable()).nullable().optional(),
  })
  .passthrough();

const KeepaResponseSchema = z
  .object({
    products: z.array(KeepaProductSchema),
    tokensLeft: z.number().optional(),
    tokensConsumed: z.number().optional(),
    error: z
      .object({
        type: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export interface KeepaClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Inject a fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Request timeout. Keepa is occasionally slow on cold ASINs. */
  timeoutMs?: number;
}

/**
 * Thin client around Keepa's `/product` endpoint. Stateless aside from
 * config; safe to share a single instance across requests.
 */
export class KeepaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: KeepaClientOptions = {}) {
    const e = (() => {
      try {
        return env();
      } catch {
        return undefined;
      }
    })();
    this.apiKey = opts.apiKey ?? e?.KEEPA_API_KEY ?? '';
    this.baseUrl = (opts.baseUrl ?? 'https://api.keepa.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async fetchPriceHistory(opts: KeepaFetchOptions): Promise<KeepaFetchResult> {
    if (!this.isConfigured()) {
      throw new Error('Keepa client is not configured (KEEPA_API_KEY missing)');
    }
    const asin = opts.asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      throw new Error(`invalid ASIN: ${opts.asin}`);
    }
    const domain = opts.domain ?? 1;
    if (!KNOWN_DOMAINS.has(domain)) {
      throw new Error(`unsupported Keepa domain: ${domain}`);
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      domain: String(domain),
      asin,
      history: '1',
      // Keepa exposes the JSON schema via `code=1` but the default is already
      // JSON; we omit it for compatibility with older keys.
    });
    if (opts.days !== undefined) {
      params.set('days', String(Math.max(1, Math.min(3650, Math.floor(opts.days)))));
    }

    const url = `${this.baseUrl}/product?${params.toString()}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let bodyText: string;
    let status: number;
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      status = res.status;
      bodyText = await res.text();
    } finally {
      clearTimeout(t);
    }

    if (status < 200 || status >= 300) {
      // Keepa returns 400 with a JSON `error` block for bad keys / out of
      // tokens. Surface the message so callers can log it.
      let snippet = bodyText.slice(0, 200);
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.error?.message) snippet = String(parsed.error.message);
      } catch {
        /* keep raw snippet */
      }
      throw new Error(`Keepa HTTP ${status} for asin=${asin}: ${snippet}`);
    }

    let parsed: z.infer<typeof KeepaResponseSchema>;
    try {
      parsed = KeepaResponseSchema.parse(JSON.parse(bodyText));
    } catch (err) {
      throw new Error(
        `Keepa: unexpected response shape: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (parsed.error?.message) {
      throw new Error(`Keepa error: ${parsed.error.message}`);
    }

    const product = parsed.products[0];
    if (!product) {
      log.warn({ asin, domain }, 'Keepa: response contained no products');
      return {
        asin,
        domain,
        currency: DOMAIN_CURRENCY[domain] ?? 'USD',
        points: [],
        ...(parsed.tokensLeft !== undefined ? { tokensLeft: parsed.tokensLeft } : {}),
        ...(parsed.tokensConsumed !== undefined ? { tokensConsumed: parsed.tokensConsumed } : {}),
      };
    }

    const csv = product.csv ?? [];
    const amazonSeries = decodeCsvChannel(csv[0] ?? null, 'amazon');
    const newSeries = amazonSeries.length === 0 ? decodeCsvChannel(csv[1] ?? null, 'new') : [];

    const merged = mergeChannels(amazonSeries, newSeries);

    return {
      asin,
      domain,
      currency: DOMAIN_CURRENCY[domain] ?? 'USD',
      points: merged,
      ...(parsed.tokensLeft !== undefined ? { tokensLeft: parsed.tokensLeft } : {}),
      ...(parsed.tokensConsumed !== undefined ? { tokensConsumed: parsed.tokensConsumed } : {}),
    };
  }
}

/**
 * Decode one Keepa csv channel — a flat array alternating
 * [keepaMinutes, price, keepaMinutes, price, ...].
 * Drops malformed (odd-length) tails and silently skips non-finite entries.
 */
export function decodeCsvChannel(
  channel: number[] | null,
  label: 'amazon' | 'new',
): KeepaPricePoint[] {
  if (!channel || channel.length < 2) return [];
  const out: KeepaPricePoint[] = [];
  for (let i = 0; i + 1 < channel.length; i += 2) {
    const minutes = channel[i];
    const price = channel[i + 1];
    if (!Number.isFinite(minutes) || !Number.isFinite(price)) continue;
    const epochMs = (Number(minutes) + KEEPA_EPOCH_MINUTES) * 60_000;
    if (!Number.isFinite(epochMs) || epochMs <= 0) continue;
    const observedAt = new Date(epochMs).toISOString();
    if (price === -1) {
      out.push({ observedAt, priceCents: 0, availability: 'oos', channel: label });
    } else if (Number(price) > 0) {
      out.push({
        observedAt,
        priceCents: Math.round(Number(price)),
        availability: 'in_stock',
        channel: label,
      });
    }
  }
  return out;
}

/**
 * Merge AMAZON + NEW channels into a single chronologically ordered series,
 * preferring AMAZON when both channels report a price at the same minute.
 */
function mergeChannels(
  amazon: KeepaPricePoint[],
  marketplace: KeepaPricePoint[],
): KeepaPricePoint[] {
  if (amazon.length === 0) return [...marketplace].sort(byObservedAt);
  if (marketplace.length === 0) return [...amazon].sort(byObservedAt);
  const seenTs = new Set(amazon.map((p) => p.observedAt));
  const out = [...amazon, ...marketplace.filter((p) => !seenTs.has(p.observedAt))];
  return out.sort(byObservedAt);
}

function byObservedAt(a: KeepaPricePoint, b: KeepaPricePoint): number {
  return a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
}
