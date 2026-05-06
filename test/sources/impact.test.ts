/**
 * Unit tests for the Impact.com adapter. The fake fetch routes the flat
 * PromoCodes endpoint to two sequential fixture pages and asserts the
 * adapter follows `@nextpageuri` for pagination.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ImpactAdapter,
  mapImpactPromoCode,
  type ImpactPromoCode,
} from '../../src/sources/impact.ts';
import type { RawDealInput } from '../../src/sources/common.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = resolve(here, '..', 'fixtures');

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(fixDir, name), 'utf8'));
}

interface RouteState {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
}

async function makeFakeFetch(): Promise<{ impl: typeof fetch; state: RouteState }> {
  const page1 = await readFixture('impact-promocodes-page-1.json');
  const page2 = await readFixture('impact-promocodes-page-2.json');
  const state: RouteState = { calls: [] };

  const fakeFetch = vi.fn(async (url: unknown, init?: unknown) => {
    const u = String(url);
    state.calls.push({ url: u, init: init as RequestInit | undefined });

    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    const auth = (headers as Record<string, string>)['Authorization'] ?? '';
    if (!auth.startsWith('Basic ')) {
      return new Response('forbidden', { status: 401 });
    }

    if (/PromoCodes\?Page=1/.test(u)) {
      return new Response(JSON.stringify(page1), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (/PromoCodes\?Page=2/.test(u)) {
      return new Response(JSON.stringify(page2), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });

  return { impl: fakeFetch as unknown as typeof fetch, state };
}

describe('ImpactAdapter', () => {
  it('requires sid and token to be configured', () => {
    expect(new ImpactAdapter({ accountSid: '', authToken: '' }).isConfigured()).toBe(false);
    expect(new ImpactAdapter({ accountSid: 'sid', authToken: '' }).isConfigured()).toBe(false);
    expect(new ImpactAdapter({ accountSid: '', authToken: 'tok' }).isConfigured()).toBe(false);
    expect(new ImpactAdapter({ accountSid: 'sid', authToken: 'tok' }).isConfigured()).toBe(true);
  });

  it('hits the flat /PromoCodes endpoint, follows @nextpageuri, and yields all records', async () => {
    const { impl, state } = await makeFakeFetch();
    const adapter = new ImpactAdapter({
      accountSid: 'IRAX-test',
      authToken: 'secret',
      pageSize: 200,
      fetchImpl: impl,
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(out).toHaveLength(3);
    for (const item of out) expect(item.sourceNetwork).toBe('impact');

    // Two HTTP calls: initial page + @nextpageuri.
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]!.url).toBe(
      'https://api.impact.com/Mediapartners/IRAX-test/PromoCodes?Page=1&PageSize=200'
    );
    expect(state.calls[1]!.url).toBe(
      'https://api.impact.com/Mediapartners/IRAX-test/PromoCodes?Page=2&PageSize=200'
    );
    // Flat endpoint — no per-campaign nesting.
    for (const c of state.calls) {
      expect(c.url).not.toMatch(/\/Campaigns\/\d+\/PromoCodes/);
    }
    // Auth header is HTTP Basic.
    const headers0 = (state.calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers0['Authorization']).toMatch(/^Basic /);
    expect(headers0['Accept']).toBe('application/json');

    const tea25 = out.find((d) => d.code === 'TEA25');
    expect(tea25).toBeDefined();
    expect(tea25?.kind).toBe('code');
    expect(tea25?.discountType).toBe('pct_off');
    expect(tea25?.discountValueBps).toBe(2500);
    expect(tea25?.merchant.slug).toBe('greenleaf-tea-co');
    expect(tea25?.deeplink).toBe('https://impact.example/track?p=tea25');
    expect(tea25?.geoScope).toEqual(['US', 'CA']);

    const freeship = out.find((d) => d.code === 'FREESHIP');
    expect(freeship?.discountType).toBe('free_shipping');

    const petpix = out.find((d) => d.code === 'PETPIX10');
    expect(petpix?.discountType).toBe('amt_off');
    expect(petpix?.discountValueCents).toBe(1000);
    expect(petpix?.merchant.slug).toBe('pixelpet-photography');
    expect(petpix?.geoScope).toEqual(['US']);
  });

  it('retries once after a 429 with Retry-After', async () => {
    let calls = 0;
    const successBody = {
      PromoCodes: [
        {
          Id: 'pc-1',
          Code: 'OK10',
          Description: 'Save 10%',
          AdvertiserName: 'OK Co',
          CampaignId: 1,
        },
      ],
    };
    const fakeFetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '0' },
        });
      }
      return new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ImpactAdapter({
      accountSid: 'sid',
      authToken: 'tok',
      pageSize: 200,
      fetchImpl: fakeFetch,
    });
    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);
    expect(out).toHaveLength(1);
    expect(out[0]!.code).toBe('OK10');
    expect(calls).toBe(2);
  });

  it('aborts the page after a second 429 rather than spinning', async () => {
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls += 1;
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }) as unknown as typeof fetch;

    const adapter = new ImpactAdapter({
      accountSid: 'sid',
      authToken: 'tok',
      pageSize: 200,
      fetchImpl: fakeFetch,
    });
    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);
    expect(out).toHaveLength(0);
    // exactly one initial attempt + one retry, then bail.
    expect(calls).toBe(2);
  });

  it('mapImpactPromoCode falls back to campaign+code source id when Id absent', () => {
    const mapped = mapImpactPromoCode({
      Code: 'X1',
      Description: '5% off',
      AdvertiserName: 'A Co',
      CampaignId: 1,
    } as ImpactPromoCode);
    expect(mapped).not.toBeNull();
    expect(mapped?.sourceId).toBe('1:X1');
  });
});
