---
name: Bug report
about: Something's broken or behaving unexpectedly.
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- A short, factual description of the bug. -->

## What you expected

<!-- What should have happened instead. -->

## Repro

Minimal reproduction — JSON-RPC request and response if possible:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "find_best_deal", "arguments": { "query": "airpods" } }
}
```

```json
// response
```

## Environment

- shopdeals version / commit:
- Node version (`node -v`):
- MCP client (Claude Desktop, ChatGPT, Cursor, raw curl):
- OS:
- Hosted endpoint or self-hosted:

## Logs

<!-- LOG_LEVEL=debug npm run dev and paste the relevant lines. -->

```
```
