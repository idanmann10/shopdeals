# Deployment

Railway auto-deploys `main` via the Dockerfile + `railway.json` in this repo.
The default service runs the MCP server. To keep the deal database fresh you
need a **second** Railway service in the same project that runs the ingest
cron on a schedule.

## One-time setup

### 1. Web service (already configured)

This is what `railway.json` describes — it runs `npm run start:prod`, which:
1. Applies pending Drizzle migrations.
2. Runs the seed (idempotent).
3. Starts the Hono server on the port Railway provides.

Set the required env vars on this service:

| Var                          | Required | Notes                                              |
| ---------------------------- | -------- | -------------------------------------------------- |
| `DATABASE_URL`               | yes      | Neon / Railway-Postgres connection string          |
| `CLERK_SECRET_KEY`           | optional | Needed if you want authenticated requests          |
| `STRIPE_SECRET_KEY`          | optional | Not used while we're free; safe to leave unset     |
| `KEEPA_API_KEY`              | optional | Enables `get_price_history` Amazon refresh         |
| `AWIN_API_TOKEN`             | optional | Paid coupon feed; £5 one-time signup               |
| `AWIN_PUBLISHER_ID`          | optional | Required together with `AWIN_API_TOKEN`            |
| `IMPACT_ACCOUNT_SID`         | optional | Paid coupon feed                                   |
| `IMPACT_AUTH_TOKEN`          | optional | Required together with `IMPACT_ACCOUNT_SID`        |
| `FMTC_API_KEY`               | optional | $195/mo. Skip unless you really want 23-network coverage |

The Slickdeals adapter is **free** and requires no env config — it just runs.

### 2. Ingest cron service (one-time, Railway UI)

In the Railway project that contains the web service:

1. Click **+ New** → **GitHub Repo** → pick the same `idanmann10/shopdeals`
   repo. Railway will use the same Dockerfile.
2. Open the new service's **Settings**:
   - **Service name**: `shopdeals-ingest`
   - **Start command**: `npm run ingest:prod`
   - **Cron schedule**: `*/15 * * * *` (every 15 minutes)
   - **Restart policy**: `Never` (Railway treats cron services as one-shots)
3. Under **Variables**, click **Add reference** → copy `DATABASE_URL` and any
   affiliate API keys from the web service. The cron only needs the DB URL
   and whatever source-adapter keys you have.
4. **Deploy**. The first run should appear in the service logs within 15 min.

### 3. Verify

Tail the cron service logs after the first scheduled run:

```
adapter ingest finished network=slickdeals dealsUpserted=87 merchantsUpserted=42 durationMs=1840
lifecycle sweep complete expired=3 stale=0 failing=0
```

Then hit the web service:

```bash
curl https://your-app.up.railway.app/healthz
# {"ok":true}

curl -X POST https://your-app.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_deals","arguments":{"limit":5}}}'
```

You should get back the freshly-ingested deals.

## Run an ingest manually

If you want to backfill or test, kick off the same script from your laptop:

```bash
DATABASE_URL=postgres://... npm run ingest -- slickdeals    # one adapter
DATABASE_URL=postgres://... npm run ingest                  # all configured adapters
```

The lifecycle sweep runs at the end of every ingest, so a manual run also
expires/marks-stale deals.

## What's NOT auto-managed yet

- **Plan tier enforcement.** `STRIPE_PRICE_*` env vars are accepted, but the
  usage middleware doesn't yet gate requests based on plan. Free for all.
- **API key issuance.** Keys must be minted via the Clerk dashboard until the
  signup flow ships.
- **Domain.** `mcp.shopdeals.sh` is referenced in the README but DNS isn't
  managed from this repo — point the CNAME at the Railway service yourself.

See [README.md](./README.md) for the user-facing setup snippets (Claude
Desktop, Cursor, Continue).
