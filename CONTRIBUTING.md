# Contributing to Snap-AI

Thanks for your interest. Snap-AI is an open-source MCP server that surfaces
merchant-verified coupon codes from affiliate-network feeds. Contributions are
welcome — bug reports, source adapters, docs fixes, all of it.

## Local development

Requirements: Node 22+, npm, a Postgres 16 instance (Neon free tier works).

```bash
git clone https://github.com/idanmann10/snap-ai.git
cd snap-ai
cp .env.example .env       # fill in DATABASE_URL at minimum
npm install
npm run db:migrate
npm run ingest             # one-shot: pulls from any sources whose keys you set
npm run dev                # MCP server on http://localhost:3000
```

Other useful scripts:

| Script               | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm run typecheck`  | `tsc --noEmit`                               |
| `npm run lint`       | ESLint, must be clean (`--max-warnings=0`)   |
| `npm test`           | Vitest, runs once                            |
| `npm run test:watch` | Vitest in watch mode                         |
| `npm run build`      | Compile to `dist/` via `tsconfig.build.json` |
| `npm run mcp:smoke`  | Smoke-test the MCP server end-to-end         |
| `npm run db:studio`  | Drizzle Studio against your `DATABASE_URL`   |

## Code style

- TypeScript, strict mode, ESM only.
- Prettier (`.prettierrc.json`) and ESLint (`eslint.config.js`) are the
  source of truth — `npm run format` and `npm run lint` should both pass
  before you push.
- Prefer named exports. Prefer `import type { ... }` for type-only imports.
- No `any` unless you justify it in a comment. `_`-prefixed names are
  allowed for intentionally unused params.

## Tests

- Unit tests live in `test/` and use Vitest.
- Source-adapter tests use [MSW](https://mswjs.io/) to stub HTTP. Fixtures
  live under `test/fixtures/`. Snapshot real upstream payloads — never
  hand-write them.
- New adapters must include at least: a happy-path fixture, an empty-feed
  fixture, and a malformed-row fixture.

## Adding a new affiliate network (the `SourceAdapter` pattern)

Every upstream lives in `src/sources/<network>.ts` and implements the
`SourceAdapter` contract from `src/sources/common.ts`:

```ts
export interface SourceAdapter {
  readonly network: SourceNetwork;        // matches the pgEnum in src/db/schema.ts
  fetch(ctx: IngestContext): AsyncIterable<RawDeal>;
  normalize(raw: RawDeal): NormalizedDeal; // shape Drizzle expects
}
```

Steps to add `acmeNetwork`:

1. Add `'acme'` to the `sourceNetwork` pgEnum in `src/db/schema.ts` and
   generate a migration with `npm run db:generate`.
2. Create `src/sources/acme.ts` that exports a default `SourceAdapter`.
3. Wire it into `src/cron/ingest.ts` so it runs in the 15-min ingest loop.
4. Add the env vars (e.g. `ACME_API_KEY`) to `.env.example` and to the
   "Fly app secrets" comment in `.github/workflows/deploy.yml`.
5. Add fixtures + tests under `test/sources/acme.test.ts`.
6. Update the "Data sources" table in the README.

The `attributionSource` field on every deal is **required** — it must
identify the upstream network so downstream agents can credit the right
publisher (see the trust section in the README).

## Reporting issues

Please include:

- Node version (`node -v`)
- The MCP client you were using (Claude Desktop, Cursor, Continue, etc.)
- A minimal reproduction — the JSON-RPC request and the response you got
- Any relevant logs (`LOG_LEVEL=debug npm run dev`)

## Licensing

By contributing you agree your contribution is licensed under the MIT
license, the same license that covers the rest of the project.
