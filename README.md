<p align="center">
  <a href="https://shopdeals.sh">
    <img alt="shopdeals — the MCP server for shopping" src="https://raw.githubusercontent.com/idanmann10/shopdeals/main/.github/assets/banner.svg" width="720" />
  </a>
</p>

<h1 align="center">shopdeals</h1>

<p align="center">
  <em>The MCP server for shopping. Free, open, rate-limited, no API key.</em>
</p>

<p align="center">
  <a href="https://github.com/idanmann10/shopdeals/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/idanmann10/shopdeals/ci.yml?branch=main&label=build&style=flat-square" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square" alt="License: MIT" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-1.x-7c5dfa?style=flat-square" alt="MCP 1.x" /></a>
  <a href="https://mcp.shopdeals.sh/mcp"><img src="https://img.shields.io/badge/hosted-mcp.shopdeals.sh-f26b3a?style=flat-square" alt="Hosted endpoint" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A522-339933?style=flat-square" alt="Node 22+" /></a>
</p>

<p align="center">
  <a href="https://twitter.com/intent/follow?screen_name=idanmann10"><img src="https://img.shields.io/badge/follow-%40idanmann10-1da1f2?style=flat-square&logo=x" alt="Follow @idanmann10" /></a>
  <a href="https://github.com/idanmann10/shopdeals/stargazers"><img src="https://img.shields.io/github/stars/idanmann10/shopdeals?style=flat-square&label=stars&color=f5c518" alt="GitHub stars" /></a>
</p>

<p align="center">
  <strong>shopdeals</strong> gives AI agents shopping superpowers. One MCP endpoint lets Claude, ChatGPT, or Cursor compare live seller prices, watch products until they hit a target price, and apply coupon codes that actually work at checkout.
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start →</strong></a>
  &nbsp;·&nbsp;
  <a href="#tools">Tools</a>
  &nbsp;·&nbsp;
  <a href="#self-hosting">Self-host</a>
  &nbsp;·&nbsp;
  <a href="https://shopdeals.sh">Website</a>
</p>

> Drop **`https://mcp.shopdeals.sh/mcp`** into any MCP client. No signup, no API key. 60 calls/minute per client, free forever.

---

## Quick start

The hosted server lives at **`https://mcp.shopdeals.sh/mcp`**. Pick your client:

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

That's it. Restart your client and ask *"find me the best deal on..."* — the agent picks the tool.

---

## Tools

Ten MCP tools, all spec-compliant. Inputs are Zod-validated, outputs are structured JSON. Full input schemas in [`src/mcp/tools/`](./src/mcp/tools/).

### Shopping

- **`find_best_deal`** — compare live seller prices for a query, attach matching coupons, flag Amazon price lows via Keepa, return the ranked best buy plus alternatives.
- **`find_products`** — live Google Shopping search via SerpApi. Returns each seller's direct buy link, price, and any coupon we hold.
- **`get_price_history`** — 30-day / 90-day / all-time price history for any Amazon ASIN or product URL (Keepa-backed).

### Coupons & deals

- **`find_deals`** — search the merchant-verified coupon catalog by merchant, query, country, or category.
- **`get_deal`** — fetch a single deal by id with full discount spec, stack rules, and attribution.
- **`get_code_for_url`** — given any merchant URL (Amazon, Best Buy, etc.), return the best active coupon codes for that merchant.
- **`report_code_result`** — agent reports whether a code worked at checkout. Updates the rolling 30-day success rate.

### Merchants & links

- **`list_merchants`** — browse merchants with at least one active deal. Filter by category, country, or name substring.
- **`redeem_link`** — wrap any merchant URL with affiliate tracking so a buy converts to commission. Preserves existing referral cookies.

### Watches

- **`watch_price`** — persist a price watch. Returns a watch id; we notify the user when the product hits a target price.

---

## Example conversation

Paste this prompt into Claude / ChatGPT / Cursor with shopdeals connected:

> Find me the best deal on Sony WH-1000XM5 headphones. Stay under $300 if you
> can, and double-check that any coupon you find actually works at checkout.

The agent picks the tools — typically `find_best_deal` to compare sellers,
then `get_code_for_url` to verify the winning coupon.

```
You:     Find me the best deal on Sony WH-1000XM5 headphones. Stay under
         $300 if you can, and double-check that any coupon you find actually
         works at checkout.

Claude:  → tools/call find_best_deal { query: "Sony WH-1000XM5", alternatives: 3 }
         (412 ms · 3 sellers · 49 merchants checked)

         Best Buy   $349.99
         Amazon     $399 → $323.00  code SAVE25 → effective $298.00  ★
         Target     $329.99

         → tools/call get_code_for_url {
             url: "https://www.amazon.com/dp/B09XS7JWHH", limit: 3
           }
         (128 ms · SAVE25 92% success rate over 421 agent reports / 30d)

         The best deal is Amazon at $298.00 after SAVE25 — $51 below Best
         Buy and comfortably under your $300 cap. The coupon is verified
         working at checkout (92% success rate). Ships free with Prime.
```

Two tool calls. `find_best_deal` returns a structured `{ best, alternatives,
appliedCoupons }`; `get_code_for_url` returns the live success rate so the
agent can vouch for the code before recommending it.

---

## Self-hosting

shopdeals runs anywhere Node 22 and a Postgres 16 connection string can. The repo ships with a `Dockerfile`, a `railway.json`, and a `fly.toml`.

### Locally

```bash
git clone https://github.com/idanmann10/shopdeals.git
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

### Required environment

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres 16 connection string (Neon's free tier is fine). |
| `SERPAPI_KEY` | Live Google Shopping for `find_best_deal` / `find_products`. |
| `KEEPA_API_KEY` | Amazon price history for `get_price_history`. |
| `COUPONAPI_KEY` | Coupon catalog (free 7-day trial at couponapi.org). |
| `AMAZON_ASSOCIATES_TAG` | Affiliate tag appended to amazon.* links on the way out. |
| `SKIMLINKS_PUBLISHER_ID` | Universal affiliate for non-Amazon merchants. |

Every key is optional — adapters whose keys are missing are silently skipped at ingest time. The Slickdeals adapter is free and runs unconditionally. Full env surface in [`src/lib/env.ts`](./src/lib/env.ts) and [`.env.example`](./.env.example).

---

## Architecture

```
  MCP client (Claude / ChatGPT / Cursor)
            │  JSON-RPC over Streamable HTTP
            ▼
  Hono server  ──►  auth ──►  rate limit (60/min)  ──►  McpContext
            │                                                │
            │                                                ▼
            │                                tool handler (Drizzle / Keepa /
            │                                SerpApi / CouponAPI / affiliate)
            ▼
  Postgres (Neon)  ◄── ingest cron (every 15 min)
```

- **Server**: Hono + `@modelcontextprotocol/sdk`, Streamable HTTP transport.
- **Storage**: Postgres via Drizzle ORM. Schema in [`src/db/schema.ts`](./src/db/schema.ts).
- **External APIs**: SerpApi, Keepa, CouponAPI, Awin, Impact, FMTC. Each wrapped in [`src/lib/`](./src/lib/) or [`src/sources/`](./src/sources/) with rate limiting and an in-memory LRU.
- **Affiliate rewriter**: [`src/lib/affiliate.ts`](./src/lib/affiliate.ts) — Amazon Associates + Skimlinks, never overwrites existing referral cookies.

Deeper dive: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Rate limits

The hosted endpoint is **free** and **rate-limited at 60 calls per minute per client**. No API key, no account, no per-call fees. The limit exists to keep one looping agent from torching the shared SerpApi / Keepa budget.

When you hit the ceiling you get a clean JSON-RPC `429` with a `Retry-After` header — well-behaved clients back off automatically.

Need more headroom? **Self-host.** All the rate limits are configurable, and your own SerpApi / Keepa keys mean the only ceiling is your wallet.

---

## Contributing

PRs welcome. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md) — short, covers the branch flow, the conventional-commit style, and the rules for adding a new affiliate-network adapter.

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Be excellent to each other. We follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).

---

## License

[MIT](./LICENSE) — copyright 2026 idanmann10.

## Acknowledgements

Built on the shoulders of [Model Context Protocol](https://modelcontextprotocol.io), [Hono](https://hono.dev), [Drizzle ORM](https://orm.drizzle.team), and the public-API generosity of [Keepa](https://keepa.com), [SerpApi](https://serpapi.com), and [CouponAPI](https://couponapi.org).

---

<p align="center">
  <strong>Ready to give your agent a shopping cart?</strong>
</p>

<p align="center">
  <a href="https://shopdeals.sh#install"><img src="https://img.shields.io/badge/Get%20started%20free%20%E2%86%92-f26b3a?style=for-the-badge&logoColor=white" alt="Get started free" /></a>
</p>

<p align="center">
  <a href="https://star-history.com/#idanmann10/shopdeals&Date">
    <img src="https://api.star-history.com/svg?repos=idanmann10/shopdeals&type=Date" alt="Star History" width="520" />
  </a>
</p>

<p align="center">
  <sub>Copyright © 2026 <a href="https://github.com/idanmann10">idanmann10</a>. Released under the MIT License.</sub>
</p>
