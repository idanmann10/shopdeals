# Monetization

shopdeals is free for users. Revenue comes from affiliate commissions today, with a few low-effort B2C levers we can add when traffic justifies them.

## What earns money right now

| Source | What earns | Where it's wired |
| --- | --- | --- |
| **Amazon Associates** | Commission on any Amazon purchase that started from an `amazon.com/dp/...` link we returned | `src/lib/affiliate.ts` — when `AMAZON_ASSOCIATES_TAG` is set, every amazon.* URL gets `?tag=<our-tag>` appended on the way out of `find_deals` / `get_deal` / `find_products`. |
| **Skimlinks** (universal) | Commission on any non-Amazon purchase, routed through whatever network has the merchant | Same module. When `SKIMLINKS_PUBLISHER_ID` is set, every non-Amazon merchant URL gets wrapped through `go.skimresources.com/?id=<pubid>&url=<merchant>`. Community/social hosts are excluded. |
| **CouponAPI's per-publisher affiliate_link** | Commission already baked into the coupon's redirect URL | `src/sources/couponapi.ts` — pulls `affiliate_link` field; no client-side wrap needed. Your CouponAPI account is the publisher. |
| **Awin / Impact tracked URLs** | Already monetized — the adapters carry `urlTracking` / `LandingPageUrl` from those networks. | `src/sources/awin.ts`, `src/sources/impact.ts` |

**Net effect**: every link we hand an agent earns money when someone buys, as soon as the env vars are filled in. Zero per-user setup.

## Setup checklist (3 free signups, ~15 min)

1. **Amazon Associates** — `affiliate-program.amazon.com`. Instant approval as long as your site has *some* content; we have a landing now, so this should sail through. Drop the `tag=` value into Railway env `AMAZON_ASSOCIATES_TAG`.
2. **Skimlinks** — `skimlinks.com`. Free signup, takes a small cut on each commission in exchange for handling every merchant under one account. Drop publisher id into `SKIMLINKS_PUBLISHER_ID`.
3. **CouponAPI 7-day trial** — `couponapi.org`. No card needed. Drop `COUPONAPI_KEY` into Railway env and the ingest cron picks it up on the next tick.

After all three: every link is monetized, the deal catalog jumps from ~30 (Slickdeals only) to potentially 100k+ (CouponAPI), and `find_products` (SerpApi) gives us live coverage for anything we don't have cached.

## B2C levers to add later (in order of expected ROI)

1. **Email "deals you missed"** — daily/weekly digest of price drops on items the user previously asked about. Every link is already affiliate-tagged → opens convert at much higher rates than cold searches. Build cost: low (waitlist table is in place, add a `user_watches` table and a daily worker).

2. **Browser extension companion** — show our affiliate-tagged checkout-applied codes in-browser at checkout time. The MCP server already returns them; the extension is a thin client. Honey-shaped product without the attribution drama because we explicitly preserve upstream attribution.

3. **Featured listings** — merchants pay to rank above the organic ordering in `find_deals`. Low-effort: add a `featured_until` column to deals, sort by it. Risk: hurts trust if not labeled clearly. Need a UI affordance.

4. **Pro tier** ($5/mo or so) — early access to deals (we hold them back 30 min before publishing to free), no-ad digest, custom watchlists, multi-account API keys for affiliates / influencers running their own AIs.

5. **White-label MCP** — let creators with audiences (TikTok deal accounts, newsletters) plug their own affiliate tag into a sub-instance of shopdeals and split commission. They bring traffic; we run the infra. Charge a % of their commission or a flat monthly platform fee.

6. **Display ads on the landing page** — last resort, lowest ROI, hurts brand. Skip unless / until traffic is much higher than monetization needs.

## What NOT to do

- **Per-request paid tier on the MCP itself.** Once an agent has the MCP URL, the value is "you save money when you buy." Charging per request collapses that. Keep the MCP free forever; monetize the click-through.
- **Lock affiliate codes behind login.** Same reason. The MCP must "just work" the second the agent has the URL.
- **Strip upstream creator attribution.** Honey lost its biggest distribution partners doing this. We preserve any existing `?tag=` param on Amazon links and route Skimlinks only through merchant URLs (never community ones).

## Conversion math (rough)

Skimlinks publisher avg commission across categories: ~3-5% net to us.
Amazon Associates: 1-10% by category, ~4% blended.

If an agent surfaces a deal that converts at a 5% rate and the cart is $80, expected revenue per click is ~$0.15 (Skimlinks) to $0.32 (Amazon Associates direct).

At 1k clicks/day across the user base, that's ~$50-100/day net. Reaching that means ~5-10k active agent sessions per day, which is in striking distance once we get into Claude / ChatGPT MCP directories.

The unit economics are good. The acquisition channel is the gating factor — Tier-1 lever there is "we appear in the official MCP marketplace listings as soon as those exist."
