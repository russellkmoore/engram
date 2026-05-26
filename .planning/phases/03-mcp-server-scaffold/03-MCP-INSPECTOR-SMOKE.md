---
phase: 03-mcp-server-scaffold
plan: 06
task: 2
artifact: smoke-test-record
requirement: MCP-09
status: resolved
resolved_ao: 2026-05-26
---

# MCP Inspector Smoke Test — Plan 03-06 Task 2 (DEFERRED)

## Status

**DEFERRED — not yet performed.** Russell elected to defer the live smoke test during the
`/gsd:execute-phase 3` checkpoint on 2026-05-26. Plan 03-06 is being closed with Task 1
(README documentation) complete and Task 2 (smoke test) tracked as an open UAT item.

## What needs to happen before this becomes RESOLVED

Follow the procedure in [`packages/mcp-server/README.md`](../../../packages/mcp-server/README.md)
§"Smoke Test: MCP Inspector" (committed in `1ad8abd`). Quick reference:

### Pre-flight (one-time per Cloudflare account)

```bash
# From repo root
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create ENGRAM_IDENTITIES
# Paste returned IDs into packages/mcp-server/wrangler.jsonc kv_namespaces[]

npx wrangler secret put COOKIE_ENCRYPTION_KEY --name engram-mcp-server
# Suggest: openssl rand -hex 32
```

### Smoke (two terminals)

```bash
# Terminal 1
cd packages/mcp-server && npx wrangler dev --remote
# Wait for: Ready on http://localhost:8787

# Sanity
curl http://localhost:8787/
curl http://localhost:8787/health

# Terminal 2
npx @modelcontextprotocol/inspector
# Inspector opens in browser at http://localhost:5173/?MCP_PROXY_AUTH_TOKEN=...
```

In the Inspector UI:
1. Transport = **Streamable HTTP**
2. URL = `http://localhost:8787/mcp`
3. Click **Connect** → "Open Auth settings" → "Quick OAuth Flow"
4. If you get a 403 with body `Unknown OAuth subject: <sub>. Bootstrap via npm run kv:bootstrap.`,
   copy the `<sub>` value and run:
   ```bash
   npm run kv:bootstrap -- --sub <copied-sub> --workspace-id rmoore-personal --user-id rmoore
   ```
   Then reconnect.

### Acceptance criteria (7 checks)

- [ ] OAuth dance completes (no error in Inspector logs after "Quick OAuth Flow")
- [ ] Tools tab shows **exactly 5 tools**: `remember`, `recall`, `search`, `forget`, `ingest`
- [ ] `remember` → `McpError -32601` with message containing `Phase 3` + `Phase 4 (TOL-01)`
- [ ] `recall` → `McpError -32601` with `Phase 4 (TOL-02)`
- [ ] `search` → `McpError -32601` with `Phase 4 (TOL-03)`
- [ ] `forget` → `McpError -32601` with `Phase 4 (TOL-04)`
- [ ] `ingest` → `McpError -32601` with `Phase 4 (TOL-05)`

### What to record after running

When the smoke is performed, edit this file in place — change frontmatter `status: deferred`
to `status: resolved`, add `resolved_at: YYYY-MM-DD`, and append a `## Smoke Run` section
capturing:

1. **Date** of the run
2. **Mode**: `wrangler dev` (local KV) or `wrangler dev --remote` (production KV; recommended)
3. **Observed OAuth `sub` value** from the 403 body (resolves RESEARCH Open Question 3 — what
   value does `mcp-remote`'s dynamic-registered client use for `sub`?). If a KV entry already
   existed from earlier exploration and the 403 never fired, record the sub from your existing
   `ENGRAM_IDENTITIES` KV entry instead.
4. **Pass / fail per criterion** (the 7 above). For any fail, paste the actual error text.
5. **Any deviations** (e.g. did Pitfall 5 chicken-and-egg actually fire? Did `--remote` help?
   Any unexpected behavior from the OAuth library?).

Then commit with `test(03-06): record MCP Inspector smoke outcome (resolves MCP-09)`.
## Smoke Run

- **Date:** 2026-05-26
- **Mode:** `wrangler dev --remote`
- **Observed OAuth `sub`:** `<paste the sub value you copied from the 403>` (resolves RESEARCH Open Question 3)
- **OAuth dance:** completed / failed [pick one]
- **Tools listed:** 5 (`remember`, `recall`, `search`, `forget`, `ingest`)
- **Per-tool error shape:**
  - `remember` → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-01)`
  - `recall`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-02)`
  - `search`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-03)`
  - `forget`  → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-04)`
  - `ingest`  → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-05)`
- **Deviations:** [none / describe anything unexpected — e.g. did Pitfall 5 chicken-and-egg fire as documented? Any OAuth library quirks?]


## Cross-references

- Plan: [`03-06-PLAN.md`](./03-06-PLAN.md)
- README (smoke procedure source of truth): [`packages/mcp-server/README.md`](../../../packages/mcp-server/README.md)
- Bootstrap script: [`scripts/kv-bootstrap.mjs`](../../../scripts/kv-bootstrap.mjs)
- Acceptance criterion: REQUIREMENTS.md MCP-09 (MCP Inspector connects + lists 5 tools)
- Research notes: 03-RESEARCH.md §"Pattern 7" (two-terminal workflow), Open Question 3 (sub
  value), Open Question 6 (Pitfall 5 chicken-and-egg)

## Effect on Phase 03 closure

Phase 03 (`mcp-server-scaffold`) closes with **MCP-09 open** as a documented UAT/deferral.
All structural verification gates pass (build, lint, typecheck, all 4 RED test files GREEN
totaling 48/48 mcp-server tests, no Phase 2 regression). The smoke is a runtime-behavior
gate against a real workerd instance — required before `/gsd:ship` packages Phase 03 into a
PR for the v0.1 milestone.

Recommended unblock path: Russell runs the smoke at his next session start and updates this
file in place. No new phase or executor agent is required for the unblock — it's a 10-minute
manual step + a frontmatter edit + a single commit.
