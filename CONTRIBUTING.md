# Contributing to shopdeals

Thanks for your interest. shopdeals is an MCP server that gives AI agents
shopping superpowers — finding the best deal, watching prices, applying
coupons. Bug reports, source adapters, docs fixes, all welcome.

## Local setup

Requires Node 22+, npm, and a Postgres 16 instance (Neon's free tier works).

```bash
git clone https://github.com/idanmann10/shopdeals.git shopdeals
cd shopdeals
cp .env.example .env       # at minimum, set DATABASE_URL
npm install
npm run db:migrate
npm run dev                # MCP server on http://localhost:3000/mcp
```

Common scripts:

| Script              | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm test`          | Vitest, runs once                            |
| `npm run typecheck` | `tsc --noEmit`                               |
| `npm run lint`      | ESLint with `--max-warnings=0`               |
| `npm run format`    | Prettier write                               |

## Branch + PR flow

1. Branch off `main` — e.g. `feat/watch-price-email` or `fix/keepa-timeout`.
2. Open a PR against `main`. Keep diffs focused; one feature or one fix per PR.
3. CI must be green (`npm run typecheck`, `npm test`, `npm run lint`).
4. We squash-merge — your branch becomes one commit on `main`.

## Commit + PR title style

Conventional Commits. The squash-merge title is what lands on `main`, so make
it useful in `git log --oneline`.

```
feat: add watch_price email digest
fix(keepa): retry on transient 502
test(landing): assert MCP endpoint badge
docs: clarify Railway cron setup
refactor(affiliate): extract Skimlinks rewriter
chore: bump drizzle-kit to 0.28
```

Allowed prefixes: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`,
`perf`, `infra`, `ci`.

## Code style

- TypeScript strict, ESM only.
- Prettier + ESLint are the source of truth — both must pass.
- Prefer named exports and `import type { ... }` for type-only imports.
- No `any` without a justifying comment. `_`-prefixed names are fine for
  intentionally unused params.
- **No emoji in code, commits, or PR titles.** It's a house rule — keeps
  `git log` and grep clean.

## Tests

- Unit tests under `test/`, Vitest.
- Source-adapter tests stub HTTP via `globalThis.fetch` overrides. Fixtures
  live in `test/fixtures/` — capture real upstream payloads, never hand-write
  them.
- New adapters need at least a happy-path, an empty-feed, and a malformed-row
  fixture.

## Adding a new affiliate-network adapter

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#adding-a-source-adapter)
for the `SourceAdapter` contract and the wiring checklist.

## Reporting issues

Use [`.github/ISSUE_TEMPLATE/bug_report.md`](./.github/ISSUE_TEMPLATE/bug_report.md).
Include Node version, MCP client, the JSON-RPC request, and the response.

## License

By contributing you agree your contribution is MIT-licensed, same as the rest
of the project.
