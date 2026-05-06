# Snap-AI

> An open-source MCP server that gives AI agents real, working coupon codes — pulled from merchant-verified affiliate-network feeds, not scraped.

[![CI](https://github.com/idanmann10/snap-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/idanmann10/snap-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## Why this exists (TL;DR)

In January 2026, Honey was kicked off Impact and Rakuten after a string of attribution-stripping incidents, and independent audits put their public code success rate around 33%. The largest consumer coupon tool on the planet effectively collapsed overnight.

At the same time:

- Zero deal-specific MCP servers exist for AI agents — Claude, ChatGPT, and Cursor have no clean way to surface working promo codes.
- Affiliate networks (FMTC, Awin, Impact, CJ, Rakuten) already publish merchant-verified coupon APIs. Nobody had aggregated them for agents.
- Telemetry from real checkouts is the only honest way to score whether a code actually works.

Snap-AI is the layer that fills that gap: a single MCP endpoint that returns codes the merchants themselves uploaded, with an `attributionSource` on every deal so the upstream publisher gets credit.

## One-click install

The hosted server lives at `https://mcp.snap-ai.dev/mcp`. You can self-host instead — see [Quickstart](#quickstart).

### Claude Desktop

Add to `~/.claude/mcp.json` (macOS / Linux) or `%APPDATA%\Claude\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "snap-ai": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.snap-ai.dev/mcp"]
    }
  }
}
```

The same JSON works in `claude_desktop_config.json`.

### Claude.ai (web)

Open Settings → Connectors → Add custom MCP server → paste:

```
https://mcp.snap-ai.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "snap-ai": {
      "url": "https://mcp.snap-ai.dev/mcp"
    }
  }
}
```

### Continue

Add to `~/.continue/config.json` under `experimental.modelContextProtocolServers`:

```json
{
  "transport": { "type": "streamable-http", "url": "https://mcp.snap-ai.dev/mcp" }
}
```

## The 5 tools

| Tool                  | What it does                                                       | Example input                                                       |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `find_deals`          | Search active deals by merchant, domain, or category               | `{ "merchant": "nike", "country": "US" }`                           |
| `get_deal`            | Fetch a single deal by id, including stack rules and attribution   | `{ "dealId": "9b1c…" }`                                             |
| `list_merchants`      | Browse merchants with at least one active deal                     | `{ "category": "apparel", "country": "US" }`                        |
| `get_price_history`   | Return price observations for an ASIN or product URL (Keepa-backed) | `{ "asin": "B0CHX1W1XY", "days": 90 }`                              |
| `report_code_result`  | Telemetry: tell the server whether a code worked at checkout       | `{ "dealId": "9b1c…", "worked": true, "effectiveDiscountCents": 1500 }` |

## Quickstart

Requires Node 22+, npm, and a Postgres 16 database (Neon free tier is fine).

```bash
git clone https://github.com/idanmann10/snap-ai.git
cd snap-ai
cp .env.example .env          # fill in DATABASE_URL at minimum
npm install
npm run db:migrate            # applies the Drizzle schema
npm run ingest                # one-shot pull from any source whose keys you set
npm run dev                   # MCP server on http://localhost:3000/mcp
```

Then point your agent at `http://localhost:3000/mcp` using whichever client config above.

The required env vars are documented in [`.env.example`](./.env.example): `DATABASE_URL`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the three `STRIPE_PRICE_*` tiers, and per-source keys (`FMTC_API_KEY`, `AWIN_API_TOKEN`, `AWIN_PUBLISHER_ID`, `IMPACT_ACCOUNT_SID`, `IMPACT_AUTH_TOKEN`, `KEEPA_API_KEY`, `VOYAGE_API_KEY`).

## Architecture

```
Affiliate APIs (FMTC, Awin, Impact, Keepa)
      |  cron every 15 min
      v
Postgres (Neon) + Drizzle
      |
      v
MCP server (Hono + @modelcontextprotocol/sdk)
      |
      v
Claude / ChatGPT / Cursor agents
```

Tables are defined in [`src/db/schema.ts`](./src/db/schema.ts): `merchants`, `deals`, `telemetry`, `prices`, `api_usage`, `ingest_runs`. Every deal carries `sourceNetwork`, `sourceId`, and `attributionSource`, plus optional `stackRules`, `geoScope`, and `segment`.

## Data sources

| Source | License / cost          | Coverage                       | Refresh cadence              |
| ------ | ----------------------- | ------------------------------ | ---------------------------- |
| FMTC   | $195 / month            | 23 affiliate networks aggregated | 90-day code retest           |
| Awin   | £5 one-time signup      | Heavy EU + UK merchant base    | Near-real-time pull          |
| Impact | Per-advertiser approval | Premium DTC brands             | Webhook + 15-min poll        |
| Keepa  | Paid (token quota)      | Amazon price history per ASIN  | On-demand via `get_price_history` |

Adapters live under `src/sources/`; see [CONTRIBUTING.md](./CONTRIBUTING.md) for the `SourceAdapter` pattern.

## Trust and attribution

Snap-AI never overwrites affiliate cookies, never injects its own deeplink in place of an upstream creator's, and never strips an existing referral. Every deal returned from the MCP includes an `attributionSource` field — this is the upstream network or publisher that earned the credit, and downstream agents are expected to honour it.

The Honey collapse made it concrete what "agentic shopping" looks like when attribution is treated as optional. We're building on the opposite assumption: the publisher who surfaced the code gets paid, full stop. If you spot a deal where the attribution looks wrong, open an issue with the deal id and we'll fix it.

## Pricing (hosted version)

| Tier    | Monthly tool calls | Price          |
| ------- | ------------------ | -------------- |
| Free    | 1,000              | $0             |
| Starter | 25,000             | $19 / month    |
| Pro     | 250,000            | $99 / month    |

Manage your subscription via the Stripe portal at <https://mcp.snap-ai.dev/billing>.

Self-host for free. Everything in this repo runs on a single Fly machine plus a Neon free-tier database.

## Roadmap

**v2**

- Telemetry-driven verification (success rate per geo / cart size, exposed via `find_deals`).
- Semantic dedup using Voyage AI embeddings + pgvector to collapse duplicate codes across networks.
- More source adapters: CJ, Rakuten, Skimlinks, Partnerize.

**v3**

- Active checkout verification (headless validation in a sandboxed browser).
- x402 micropayments for per-call billing without OAuth.
- ACP feed export so agents can subscribe instead of poll.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, the `SourceAdapter` pattern for adding a new network, and the test-fixture conventions.

## License

[MIT](./LICENSE) — copyright 2026 Snap-AI contributors.
