---
phase: 03-mcp-server-scaffold
plan: 06
task: 2
artifact: smoke-test-record
requirement: MCP-09
status: resolved
resolved_at: 2026-05-26
---

# MCP Inspector Smoke Test — Plan 03-06 Task 2 (RESOLVED)

## Status

**RESOLVED — smoke completed 2026-05-26.** The live MCP Inspector smoke was performed
against `wrangler dev` (pure local mode) on 2026-05-26 after an earlier same-day deferral
during `/gsd:execute-phase 3`. All 7 acceptance criteria passed. See `## Smoke Run` below
for outcome detail and `Deviations` for two documentation/script defects that fold into the
CR-01 follow-up.

## Procedure (followed — minor deviations noted below in ## Smoke Run)

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
- **Mode:** `wrangler dev` (pure local mode — see Deviation 1)
- **Observed OAuth `sub`:** `rJkmmoWYMRb5fW6Q` (resolves RESEARCH Open Question 3 — `mcp-remote`'s dynamic-registered Inspector client uses a short opaque token, not a JWT-shaped value)
- **OAuth dance:** completed (after local KV bootstrap; see Deviation 2)
- **Tools listed:** 5 (`remember`, `recall`, `search`, `forget`, `ingest`) — exact count, exact names
- **Per-tool error shape (all verified by clicking each tool in Inspector):**
  - `remember` → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-01)`
  - `recall`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-02)`
  - `search`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-03)`
  - `forget`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-04)`
  - `ingest`   → ✓ `-32601 MethodNotFound`, msg contains `Phase 4 (TOL-05)`
- **Deviations from README procedure** (both fold into CR-01 fix queue):
  1. **README's `wrangler dev --remote` recommendation breaks Inspector smoke.** The OAuth Protected Resource Metadata endpoint (RFC 9728 `/.well-known/oauth-protected-resource`) returns the edge hostname as the `resource` field when running `--remote` (because the Worker sees `request.url` as the Cloudflare edge URL `https://engram-mcp-server.russellkmoore.workers.dev/mcp`, not `http://localhost:8787/mcp`). MCP Inspector rejects with `Failed to start OAuth flow: Protected resource ... does not match expected http://localhost:8787/mcp (or origin)`. Switched to pure local `wrangler dev` (no `--remote`) — the OAuth metadata then advertises `http://localhost:8787` as resource, matching Inspector's connect URL. README needs the `--remote` recommendation removed from the smoke section and replaced with pure-local + local KV bootstrap.
  2. **`scripts/kv-bootstrap.mjs` lacks a `--local` flag.** Forwarding `--local` to the script errors with `unknown argument: --local` because the script only knows the remote-write path (`npx wrangler kv key put ... --remote`). For the local-mode smoke we had to bypass the script and call wrangler directly: `npx wrangler kv key put --binding=ENGRAM_IDENTITIES --local '<sub>' '<json>'` from `packages/mcp-server/`. The script should accept `--local` and propagate it to its subprocess invocation.


## Cross-references

- Plan: [`03-06-PLAN.md`](./03-06-PLAN.md)
- README (smoke procedure source of truth): [`packages/mcp-server/README.md`](../../../packages/mcp-server/README.md)
- Bootstrap script: [`scripts/kv-bootstrap.mjs`](../../../scripts/kv-bootstrap.mjs)
- Acceptance criterion: REQUIREMENTS.md MCP-09 (MCP Inspector connects + lists 5 tools)
- Research notes: 03-RESEARCH.md §"Pattern 7" (two-terminal workflow), Open Question 3 (sub
  value), Open Question 6 (Pitfall 5 chicken-and-egg)

## Effect on Phase 03 closure

Phase 03 (`mcp-server-scaffold`) is **fully closed as of 2026-05-26** — MCP-09 RESOLVED,
all 7 acceptance criteria GREEN against a real workerd instance. Structural gates already
passed at end-of-execute (build, lint, typecheck, 48/48 mcp-server tests, no Phase 2
regression); this smoke closes the runtime-behavior gate.

The two README/script defects surfaced by the smoke (Deviation 1 + Deviation 2 above) are
queued for the CR-01 follow-up via `/gsd:code-review 3 --fix` and do not block `/gsd:ship`
— they are documentation and script ergonomics improvements, not correctness defects in the
shipped Worker.
