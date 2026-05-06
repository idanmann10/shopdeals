/**
 * Unit tests for the Impact.com adapter. The fake fetch routes the campaigns
 * URL to one fixture and per-campaign promo-code URLs to others.
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
  campaignsCalls: number;
  promoCalls: Record<string, number>;
}

async function makeFakeFetch(): Promise<{ impl: typeof fetch; state: RouteState }> {
  const campaigns = await readFixture('impact-campaigns.json');
  const pc9001 = await readFixture('impact-promocodes-9001.json');
  const pc9002 = await readFixture('impact-promocodes-9002.json');

  const state: RouteState = { campaignsCalls: 0, promoCalls: {} };

  const fakeFetch = vi.fn(async (url: unknown, init?: unknown) => {
    const u = String(url);
    // Verify auth header is present and Basic.
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    const auth = (headers as Record<string, string>)['Authorization'] ?? '';
    if (!auth.startsWith('Basic ')) {
      return new Response('forbidden', { status: 401 });
    }

    if (u.endsWith('/Campaigns') || /\/Campaigns\?/.test(u)) {
      state.campaignsCalls += 1;
      // First call returns the fixture; subsequent calls return empty.
      if (state.campaignsCalls === 1) {
        return new Response(JSON.stringify(campaigns), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ Campaigns: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const m = u.match(/\/Campaigns\/(\d+)\/PromoCodes/);
    if (m) {
      const id = m[1] ?? '';
      state.promoCalls[id] = (state.promoCalls[id] ?? 0) + 1;
      if (id === '9001') {
        return new Response(JSON.stringify(pc9001), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (id === '9002') {
        return new Response(JSON.stringify(pc9002), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ PromoCodes: [] }), {
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

  it('yields normalized RawDealInputs from campaigns + promocodes fixtures', async () => {
    const { impl, state } = await makeFakeFetch();
    const adapter = new ImpactAdapter({
      accountSid: 'IRAX-test',
      authToken: 'secret',
      pageSize: 100,
      fetchImpl: impl,
    });

    const out: RawDealInput[] = [];
    for await (const item of adapter.fetch()) out.push(item);

    expect(out).toHaveLength(3);
    for (const item of out) expect(item.sourceNetwork).toBe('impact');

    expect(state.campaignsCalls).toBeGreaterThanOrEqual(1);
    expect(state.promoCalls['9001']).toBe(1);
    expect(state.promoCalls['9002']).toBe(1);

    const tea25 = out.find((d) => d.code === 'TEA25');
    expect(tea25).toBeDefined();
    expect(tea25?.kind).toBe('code');
    expect(tea25?.discountType).toBe('pct_off');
    expect(tea25?.discountValueBps).toBe(2500);
    expect(tea25?.merchant.slug).toBe('greenleaf-tea-co');
    expect(tea25?.deeplink).toBe('https://impact.example/track?p=tea25');

    const freeship = out.find((d) => d.code === 'FREESHIP');
    expect(freeship?.discountType).toBe('free_shipping');

    const petpix = out.find((d) => d.code === 'PETPIX10');
    expect(petpix?.discountType).toBe('amt_off');
    expect(petpix?.discountValueCents).toBe(1000);
    expect(petpix?.merchant.slug).toBe('pixelpet-photography');
  });

  it('mapImpactPromoCode falls back to campaign+code source id when Id absent', () => {
    const mapped = mapImpactPromoCode(
      {
        Code: 'X1',
        Description: '5% off',
        AdvertiserName: 'A Co',
        CampaignId: 1,
      } as ImpactPromoCode,
      { CampaignId: 1, AdvertiserName: 'A Co' }
    );
    expect(mapped).not.toBeNull();
    expect(mapped?.sourceId).toBe('1:X1');
  });
});
