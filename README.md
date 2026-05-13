<h1 align="center">
  <picture>
    <img alt="shopdeals" src="https://raw.githubusercontent.com/idanmann10/Snap-AI/main/.github/assets/mark.svg" width="80" height="80" />
  </picture>
  <br />
  shopdeals
</h1>

<p align="center">
  <em>The MCP server for shopping.</em>
</p>

<p align="center">
  <a href="https://github.com/idanmann10/Snap-AI/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/idanmann10/Snap-AI/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-1.x-7c5dfa.svg" alt="MCP 1.x" /></a>
  <a href="https://mcp.shopdeals.sh/mcp"><img src="https://img.shields.io/badge/hosted-mcp.shopdeals.sh-f26b3a.svg" alt="Hosted endpoint" /></a>
  <a href="https://www.npmjs.com/package/shopdeals"><img src="https://img.shields.io/badge/node-%E2%89%A522-339933.svg" alt="Node 22+" /></a>
</p>

<p align="center">
  <strong>shopdeals</strong> gives AI agents shopping superpowers. One MCP endpoint lets Claude,
  ChatGPT, or Cursor compare live seller prices across the web, watch a product
  until it hits a target price, and apply coupon codes that actually work at
  checkout — all with affiliate attribution preserved so the right publisher
  gets paid.
</p>

---

## Quick start

The hosted server lives at **`https://mcp.shopdeals.sh/mcp`**. Drop it into your client:

### Claude Desktop

Add to `~/.claude/mcp.json` (macOS / Linux) or `%APPDATA%\Claude\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "shopdeals": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.shopdeals.sh/mcp"]
    }
  }
}
```

### ChatGPT (Plus / Pro custom connector)

Settings → **Connectors** → **Add custom MCP server** → paste:

```
https://mcp.shopdeals.sh/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shopdeals": {
      "url": "https://mcp.shopdeals.sh/mcp"
    }
  }
}
```

> For self-hosting, see [Self-hosting](#self-hosting) below.

## What your agent gets

Ten tools, all spec-compliant MCP. Inputs are typed (Zod-validated), outputs are structured JSON.

| Tool | What it does |
| --- | --- |
| `find_best_deal` | Compare live seller prices for a query, attach matching coupons, flag Amazon price lows via Keepa, return the ranked best buy plus alternatives. |
| `find_deals` | Search the merchant-verified coupon catalog by merchant, query, country, or category. |
| `find_products` | Live Google Shopping search via SerpApi. Returns each seller's direct buy link, price, and any coupon we hold. |
| `get_code_for_url` | Given any merchant URL (Amazon, Best Buy, etc.), return the best active coupon codes for that merchant. |
| `get_deal` | Fetch a single deal by id with full discount spec, stack rules, and attribution. |
| `get_price_history` | 30-day / 90-day / all-time price history for any Amazon ASIN or product URL (Keepa-backed). |
| `list_merchants` | Browse merchants with at least one active deal. Filter by category, country, or name substring. |
| `redeem_link` | Wrap any merchant URL with affiliate tracking so a buy converts to commission. Also hints whether codes exist. |
| `report_code_result` | Telemetry: agent reports whether a code worked at checkout. Updates rolling 30-day success rate. |
| `watch_price` | Persist a price watch — notify the user when the product hits a target price. Returns a watch id. |

Full input schemas are in [`src/mcp/tools/`](./src/mcp/tools/).

## Example conversation

```
User:    Find me the best deal on AirPods Pro 2.

Claude:  → tools/call find_best_deal { query: "AirPods Pro 2", alternatives: 2 }

         Best: Amazon — $189.00 (was $249, -24%)
           https://amazon.com/dp/B0D1XD1ZV3?tag=shopdeals-20
           Price hit a 90-day low yesterday.

         Also:
           Best Buy   $199.99   code MEMORIAL20 → $179.99
           Walmart    $204.00
```

That's one tool call. The agent gets a structured object with `best`, `alternatives`, `priceHistory`, and `appliedCoupons` — it formats the answer.

## Self-hosting

shopdeals runs anywhere Node 22 and a Postgres 16 connection string can. The repo ships with a `Dockerfile`, a `railway.json`, and a `fly.toml` covering the common deploys.

### Locally

```bash
git clone https://github.com/idanmann10/Snap-AI.git shopdeals
cd shopdeals
cp .env.example .env          # at minimum, set DATABASE_URL
npm install
npm run db:migrate
npm run dev                   # MCP server on http://localhost:3000/mcp
```

### Docker

```bash
docker build -t shopdeals .
docker run --rm -p 3000:3000 --env-file .env shopdeals npm run start:prod
```

### Railway

`railway.json` is wired for one-click deploy of the MCP service. A second service running `npm run ingest:prod` on a `*/15 * * * *` schedule keeps the deal catalog fresh — see [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full walkthrough.

### Fly.io

```bash
fly launch --copy-config --no-deploy   # reads fly.toml
fly secrets set DATABASE_URL=postgres://...
fly deploy
```

### Required environment variables

| Var | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres 16 connection string (Neon's free tier is fine). |
| `SERPAPI_KEY` | Live Google Shopping for `find_best_deal` / `find_products`. |
| `KEEPA_API_KEY` | Amazon price history for `get_price_history`. |
| `COUPONAPI_KEY` | Coupon catalog (free 7-day trial at couponapi.org). |
| `AMAZON_ASSOCIATES_TAG` | Affiliate tag appended to amazon.* links on the way out. |
| `SKIMLINKS_PUBLISHER_ID` | Universal affiliate for non-Amazon merchants. |

Every key is optional — adapters whose keys are missing are silently skipped at ingest time. The Slickdeals adapter is free and runs unconditionally. The full env surface is in [`src/lib/env.ts`](./src/lib/env.ts) and [`.env.example`](./.env.example).

## Architecture

```
  MCP client (Claude / ChatGPT / Cursor)
            │  JSON-RPC over Streamable HTTP
            ▼
  Hono server  ──►  auth middleware  ──►  per-request McpContext
            │                                     │
            │                                     ▼
            │                          tool handler (Drizzle / Keepa /
            │                          SerpApi / CouponAPI / affiliate)
            ▼
  Postgres (Neon)  ◄── ingest cron (Railway service, every 15 min)
```

- **Server**: Hono + `@modelcontextprotocol/sdk`, Streamable HTTP transport.
- **Storage**: Postgres via Drizzle ORM. Schema in [`src/db/schema.ts`](./src/db/schema.ts).
- **External APIs**: SerpApi, Keepa, CouponAPI, Awin, Impact, FMTC. Each wrapped in [`src/lib/`](./src/lib/) or [`src/sources/`](./src/sources/) with rate limiting and an in-memory LRU.
- **Affiliate rewriter**: [`src/lib/affiliate.ts`](./src/lib/affiliate.ts) — Amazon Associates + Skimlinks, never overwrites existing referral cookies.

Deeper dive: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Contributing

PRs welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) — short, covers the branch flow, the conventional-commit style, and the rules for adding a new affiliate-network adapter.

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Be excellent to each other. We follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) — copyright 2026 idanmann10.

---

<p align="center">
  <a href="https://star-history.com/#idanmann10/Snap-AI&Date">
    <img src="https://api.star-history.com/svg?repos=idanmann10/Snap-AI&type=Date" alt="Star History Chart" width="540" />
  </a>
</p>
