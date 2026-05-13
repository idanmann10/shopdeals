# Architecture

A one-page tour of how a request flows through shopdeals.

```
  MCP client (Claude / ChatGPT / Cursor)
            │  JSON-RPC over Streamable HTTP
            ▼
  ┌────────────────────────────────────────────────────┐
  │  HTTP layer (Hono)                                 │
  │    ├─ logger                                       │
  │    ├─ auth middleware       → AuthPrincipal        │
  │    ├─ usage middleware      → usage rows           │
  │    └─ global rate limit     → 60/min per client    │
  └────────────────────────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────────────────────────┐
  │  MCP transport (@modelcontextprotocol/sdk)         │
  │    Streamable HTTP, JSON-RPC framing, error codes  │
  └────────────────────────────────────────────────────┘
            │
            ▼
  ┌────────────────────────────────────────────────────┐
  │  Tool handler (one of ten in src/mcp/tools/)       │
  │    ├─ Zod input validation                         │
  │    ├─ McpContext (db, affiliate rewriter, sources) │
  │    └─ per-tool rate limit (SerpApi-budget guard)   │
  └────────────────────────────────────────────────────┘
            │                          │
            ▼                          ▼
  ┌────────────────────┐    ┌──────────────────────────┐
  │  Drizzle / Postgres │    │  External API wrappers   │
  │  deals · merchants  │    │  SerpApi · Keepa ·       │
  │  watches · usage    │    │  CouponAPI · Awin ·      │
  │                     │    │  Impact · FMTC           │
  └────────────────────┘    └──────────────────────────┘
                                       ▲
                                       │ every 15 min
                          ┌────────────┴───────────┐
                          │  ingest cron service   │
                          │  (Railway / fly cron)  │
                          └────────────────────────┘
```

## HTTP layer — `src/server.ts`

A small Hono app. Public routes (`/`, `/healthz`, `/api`, the Stripe webhook, the waitlist) are mounted before the auth gate; everything under `/mcp*` is authenticated and metered.

The `/mcp*` route gets a **token-bucket rate limit at 60 calls per minute per client** (`src/lib/rate-limit.ts`). When the bucket empties, the middleware returns a clean JSON-RPC `429` with a `Retry-After` header — no transport error, just back-off guidance the agent can use.

## MCP transport — `src/mcp/transport.ts`

Standard `@modelcontextprotocol/sdk` over Streamable HTTP. The transport hands each request a fresh `McpContext` resolved from the authenticated principal (db handle, affiliate rewriter, shared `SerpApiClient`, shared `KeepaClient`).

## Tool handlers — `src/mcp/tools/*`

Ten files, one per tool. Each:

1. Declares a Zod schema for inputs (this is what shows up in `tools/list`).
2. Consumes a token from the SerpApi or Keepa rate limiter if the tool hits a paid upstream.
3. Composes calls to the source wrappers + Drizzle queries.
4. Runs every outbound URL through the affiliate rewriter before returning it.

Tools never talk to upstream HTTP APIs directly — they call into the source-wrapper modules.

## External API wrappers — `src/sources/` and `src/lib/`

- `src/lib/serpapi.ts` — Google Shopping live search.
- `src/sources/keepa.ts` — Amazon ASIN price history.
- `src/sources/couponapi.ts` — coupon catalog feed.
- `src/sources/awin.ts`, `src/sources/impact.ts`, `src/sources/fmtc.ts` — affiliate-network coupon feeds.
- `src/sources/slickdeals.ts` — free public RSS, always on.

Each wrapper handles its own auth, exposes a typed interface, and uses an in-memory LRU + per-upstream rate limit. Adapters whose env keys are absent are silently skipped at ingest time so the server boots with zero config.

## Rate limit — `src/lib/rate-limit.ts`

A reusable token-bucket implementation. Two instances ship in the binary:

- `globalMcpRateLimiter` — 60 / minute / client, applied at the HTTP layer.
- `serpApiRateLimiter` — protects the paid SerpApi budget; applied inside the two tools that hit it.

In-memory for single-replica deploys. If we ever scale horizontally the same interface drops onto Redis.

## Database — `src/db/`

Postgres 16 via Drizzle ORM. Schema in `src/db/schema.ts`. Tables:

- `merchants`, `deals`, `deal_codes` — the deal catalog the ingest cron populates.
- `price_history` — denormalized snapshots from Keepa.
- `watches` — user-requested price watches (created by `watch_price`).
- `usage` — per-request metering rows, written by `usageMiddleware`.
- `waitlist` — landing-page signups.

The ingest cron (`npm run ingest:prod`, scheduled every 15 min) refreshes the catalog from every adapter whose key is configured. Idempotent — re-running the same window is a no-op.

## Affiliate rewriter — `src/lib/affiliate.ts`

The last hop. Every outbound URL passes through it. Amazon URLs get `?tag=<AMAZON_ASSOCIATES_TAG>` appended unless one is already present. Non-Amazon merchant URLs get wrapped through Skimlinks when `SKIMLINKS_PUBLISHER_ID` is set. Community / social hosts are explicitly excluded.

The rewriter is stateless and constructed once at boot — flipping an affiliate env var requires a restart, which is intentional (partial deploys must not emit half-tagged links).
