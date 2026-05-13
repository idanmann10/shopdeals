# Monetization

shopdeals is **free, open, and rate-limited**. No API key, no signup, no per-call fees — for users or for agents. Revenue comes entirely from **affiliate commissions** on the buy links the MCP server hands back.

This is a deliberate product choice. The value an agent gives the user is *"you saved money when you bought."* Charging per call would collapse that — so the MCP itself stays free and the click-through monetizes.

## How revenue actually works

| Source | What earns | Where it's wired |
| --- | --- | --- |
| **Amazon Associates** | Commission on any Amazon purchase that started from a link we returned. | `src/lib/affiliate.ts` — when `AMAZON_ASSOCIATES_TAG` is set, every `amazon.*` URL gets `?tag=<our-tag>` appended on the way out of `find_best_deal` / `get_deal` / `find_products` / `redeem_link`. |
| **Skimlinks** (universal) | Commission on any non-Amazon purchase, routed through whatever network has the merchant. | Same module. When `SKIMLINKS_PUBLISHER_ID` is set, every non-Amazon merchant URL gets wrapped through `go.skimresources.com/?id=<pubid>&url=<merchant>`. Community/social hosts are excluded. |
| **CouponAPI's per-publisher `affiliate_link`** | Commission already baked into the coupon's redirect URL. | `src/sources/couponapi.ts` — pulls the `affiliate_link` field; no client-side wrap needed. Your CouponAPI account is the publisher. |
| **Awin / Impact tracked URLs** | Already monetized — the adapters carry `urlTracking` / `LandingPageUrl` from those networks. | `src/sources/awin.ts`, `src/sources/impact.ts` |

**Net effect**: every link we hand an agent earns money when someone buys, as soon as the env vars are filled in. Zero per-user setup.

## Self-host setup checklist (3 free signups, ~15 min)

1. **Amazon Associates** — `affiliate-program.amazon.com`. Drop the `tag=` value into env `AMAZON_ASSOCIATES_TAG`.
2. **Skimlinks** — `skimlinks.com`. Free signup, takes a small cut on each commission in exchange for handling every merchant under one account. Drop publisher id into `SKIMLINKS_PUBLISHER_ID`.
3. **CouponAPI 7-day trial** — `couponapi.org`. No card needed. Drop `COUPONAPI_KEY` into env and the ingest cron picks it up on the next tick.

After all three: every link is monetized, the deal catalog jumps from ~30 (Slickdeals only) to potentially 100k+ (CouponAPI), and `find_products` (SerpApi) gives live coverage for anything we don't have cached.

## Why we don't monetize the MCP itself

- **No per-request paid tier.** Once an agent has the MCP URL, the value is "you save money when you buy." Charging per request collapses that. The MCP stays free; monetize the click-through.
- **No paywalled affiliate codes.** Same reason. The server must "just work" the second the agent has the URL.
- **No login required.** Adds friction for zero revenue lift.
- **Rate limit, not paywall.** 60 calls/min per client is enough headroom for any honest agent flow, and stops one looping agent from torching the shared SerpApi budget. If you need more, self-host with your own keys.

## What we preserve

- **Existing creator attribution.** We never overwrite an upstream `?tag=` on Amazon links. Skimlinks routes only through merchant URLs (never community ones). Honey lost its biggest distribution partners stripping attribution; we won't.
- **Honesty in ranking.** `find_best_deal` ranks by *price the user will actually pay*, not by commission rate. We never promote a worse deal because it pays better.

## Conversion math (rough)

- Skimlinks publisher avg commission across categories: ~3-5% net to us.
- Amazon Associates: 1-10% by category, ~4% blended.

If an agent surfaces a deal that converts at a 5% rate on an $80 cart, expected revenue per click is ~$0.15-$0.32. At 1k clicks/day across the user base, that's ~$50-100/day net — which translates to ~5-10k active agent sessions per day. In striking distance once we land in the official MCP marketplace listings.

The unit economics are good. **Acquisition is the gating factor**, not monetization model.
