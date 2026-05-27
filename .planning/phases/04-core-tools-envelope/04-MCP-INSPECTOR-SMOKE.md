---
phase: 04-core-tools-envelope
plan: 05
task: 2
artifact: smoke-test-record
requirement: TOL-08
status: deferred
---

# MCP Inspector Smoke Test — Plan 04-05 Task 2

## Status

**DEFERRED — awaiting Task 05-02 execution.** This artifact is the FIRST proof that the
`EngramResponse<T>` envelope (frozen by Plans 04-01 through 04-04) holds against a real MCP
client outside the vitest harness. The 4-call round-trip procedure below will be executed as
the human-verify checkpoint in Plan 04-05 Task 2.

Per `04-CONTEXT.md` "Claude's Discretion" — TOL-08 delineation: v0.1 ships a LOCAL smoke ONLY.
Full Russell-agent reconfig is **DEP-04 in Phase 7** — see `## Effect on Phase 04 closure`
below. This plan ships the local `wrangler dev` + MCP Inspector smoke as the acceptance proof.

When Task 05-02 (the human-verify checkpoint) executes this procedure, the runner will:
1. Edit the frontmatter: `status: deferred` → `status: resolved`
2. Add `resolved_at: YYYY-MM-DD` to the frontmatter
3. Replace the `## Smoke Run` placeholder body with the structured record from `### What to record after running`
4. Commit with message: `test(04-05): record MCP Inspector smoke outcome (resolves TOL-08)`

## Procedure (to be followed by Task 05-02)

### Pre-flight (one-time per Cloudflare account)

Refer to [`packages/mcp-server/README.md`](../../../packages/mcp-server/README.md)
§"Smoke Test: MCP Inspector" for the KV namespace creation and `COOKIE_ENCRYPTION_KEY` secret
steps. Quick reference:

```bash
# Check namespaces exist
npx wrangler kv namespace list
# Expect to see OAUTH_KV and ENGRAM_IDENTITIES

# Check secret is set
npx wrangler secret list --name engram-mcp-server
# Expect to see COOKIE_ENCRYPTION_KEY
```

If either is missing, run the pre-flight steps in `packages/mcp-server/README.md` §"Smoke
Test: MCP Inspector" before proceeding.

**Phase 3 deviations already in place (verify):**

- **Deviation 1 (Phase 3):** The `wrangler dev --remote` recommendation was removed. Use
  PURE LOCAL (`wrangler dev` without `--remote`). If `--remote` is used, the OAuth Protected
  Resource Metadata endpoint advertises the Cloudflare edge hostname instead of
  `http://localhost:8787`, causing the Inspector to reject with a resource-mismatch error.
- **Deviation 2 (Phase 3):** `scripts/kv-bootstrap.mjs` may lack a `--local` flag. If the
  script errors with `unknown argument: --local`, fall back to direct wrangler:
  ```bash
  # From packages/mcp-server/
  npx wrangler kv key put --binding=ENGRAM_IDENTITIES --local '<sub>' '{"workspace_id":"rmoore-personal","user_id":"rmoore"}'
  ```
  If either deviation is NOT yet fixed, surface them in `## Smoke Run` as Wave 4 findings.

### Smoke (two terminals)

**Terminal 1 — Boot the server:**

```bash
cd packages/mcp-server && npx wrangler dev
# PURE LOCAL — do NOT use --remote (Phase 3 Deviation 1)
# Wait for: Ready on http://localhost:8787
```

Sanity check (optional but recommended):

```bash
curl http://localhost:8787/
curl http://localhost:8787/health
# Both should return 200
```

**Terminal 2 — Launch Inspector:**

```bash
npx @modelcontextprotocol/inspector
# Inspector opens at http://localhost:5173/?MCP_PROXY_AUTH_TOKEN=...
```

In the Inspector UI:

1. Transport = **Streamable HTTP**
2. URL = `http://localhost:8787/mcp`
3. Click **Connect** → "Open Auth settings" → "Quick OAuth Flow"
4. On a 403 with body `Unknown OAuth subject: <sub>`, copy the `<sub>` value and run:
   ```bash
   # From repo root:
   npm run kv:bootstrap -- --local --sub <copied-sub> --workspace-id rmoore-personal --user-id rmoore
   # If the --local flag fails (Phase 3 Deviation 2 not yet fixed), use direct wrangler:
   # From packages/mcp-server/:
   # npx wrangler kv key put --binding=ENGRAM_IDENTITIES --local '<sub>' '{"workspace_id":"rmoore-personal","user_id":"rmoore"}'
   ```
5. Reconnect in Inspector.

### Round-trip calls to exercise

Execute these 4 calls in sequence. For each call, copy the input JSON into the Inspector's
tool-invocation field and capture the full response JSON in `## Smoke Run`.

---

**Call 1: `remember`**

Input JSON:
```json
{
  "content": "Phase 4 smoke test: applied to Acme Corp staff engineer role 2026-05-26",
  "type": "job_application",
  "source": "mcp:smoke"
}
```

Expected envelope assertions:
- `result.id` matches UUID pattern `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` — copy this UUID for Call 3.
- `result.classified_type === "job_application"` (D-06 pass-through — echoes `args.type`).
- `result.extracted_fields` deep-equals `{}` (D-06).
- `result.confidence === null` (D-06).
- `context.conflicts` is an array `[]` (D-08).
- `context.related` is an array `[]` (D-04).
- `context.entities` is an array `[]` (D-04).
- `meta.confidence === null` (D-06).
- `meta.coverage === null` (D-06).
- `meta.last_updated` is a positive number (epoch millis).
- `meta.gaps` contains BOTH of these strings verbatim:
  - `"AI classification lands in Phase 5. classified_type echoes args.type when supplied."`
  - `"Conflict detection lands in Phase 5 (semantic similarity via Vectorize)."`
- `"suggestions" in envelope` is `false` — the `suggestions` key is ABSENT (D-04).

---

**Call 2: `recall`**

Input JSON (use verbosity "both" — the default, explicitly set for verification):
```json
{
  "query": "Acme Corp staff engineer",
  "verbosity": "both"
}
```

Expected envelope assertions:
- `result.memories.length >= 1` — the block from Call 1 surfaces via lexical (LIKE) search.
- `result.synthesis === null` (D-07 — always null in v0.1 regardless of verbosity).
- `result.chunks` IS PRESENT (verbosity = "both" → chunks field included, not absent).
- Each element of `result.chunks` has shape `{ id: string, content_excerpt: string, score: null }` (D-07 — score is null, not a Vectorize cosine).
- `meta.gaps` contains: `"AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only."`
- `meta.last_updated` is a positive number close to `Date.now()`.
- `"suggestions" in envelope` is `false`.

---

**Call 3: `forget`**

Input JSON (replace `<UUID-from-Call-1>` with the actual `result.id` from Call 1):
```json
{
  "id": "<UUID-from-Call-1>",
  "cascade": true
}
```

Expected envelope assertions:
- `result.blocks_deleted >= 1` (the block written in Call 1 is deleted).
- `result.relations_deleted` is a number (likely `0` for this single-block test, no relations were created).
- `meta.gaps` is `[]` (empty array — `forget` is fully implemented in v0.1; no AI stubs to declare).
- `"suggestions" in envelope` is `false`.

---

**Call 4: `recall` (post-forget)**

Input JSON:
```json
{
  "query": "Acme Corp staff engineer"
}
```

Expected envelope assertions:
- `result.memories` is `[]` or contains zero matches — the block was deleted in Call 3, lexical search returns zero hits.
- `result.synthesis === null` (D-07).
- `meta.last_updated` is either `null` or `Date.now()` (empty-memories edge case per Plan 04-02 `buildRecallResponse` — `input.memories.length === 0 → Date.now()`).

### Acceptance criteria (12 checks)

- [ ] **AC-01:** OAuth dance completes after Quick OAuth Flow (no error in Inspector logs).
- [ ] **AC-02:** KV bootstrap succeeds (no persistent 403 after bootstrap).
- [ ] **AC-03:** Tools tab shows EXACTLY 5 tools: `remember`, `recall`, `search`, `forget`, `ingest`.
- [ ] **AC-04:** NO tool returns `McpError -32601 MethodNotFound` — Phase 3 stubs are retired by Plan 04-03.
- [ ] **AC-05:** Call 1 (`remember`) — `result.id` is a UUID matching the pattern above.
- [ ] **AC-06:** Call 1 — `meta.gaps` contains BOTH the AI-classification string AND the conflict-detection string verbatim.
- [ ] **AC-07:** Call 1 — `"suggestions" in envelope` is `false` (key absent, not undefined).
- [ ] **AC-08:** Call 2 (`recall` verbosity=both) — `result.memories.length >= 1` and `result.chunks` IS PRESENT.
- [ ] **AC-09:** Call 2 — `result.synthesis === null` and `meta.gaps` contains the AI-synthesis string verbatim.
- [ ] **AC-10:** Call 3 (`forget` cascade=true) — `result.blocks_deleted >= 1` and `meta.gaps === []`.
- [ ] **AC-11:** Call 4 (`recall` post-forget) — `result.memories` is empty (no stale hits from deleted block).
- [ ] **AC-12:** Inspector UI renders the full response JSON without truncation (if truncated, note as a Wave 4 finding — affects future smoke procedures).

### What to record after running

When the smoke completes, replace the `## Smoke Run` section body (below) with:

1. **Date** of the run (YYYY-MM-DD)
2. **Mode:** `wrangler dev` pure local (NOT `--remote`)
3. **Observed OAuth `sub` value** (the short opaque token from the 403 or the existing KV entry)
4. **Deviations from the Phase 3 fixes:** Did the `--local` flag work? Did direct wrangler fallback was needed?
5. **Pass / fail per AC** — tick the 12 acceptance criteria above. For any fail, paste the actual envelope JSON received and note which assertion failed.
6. **Full JSON of each response** (inline below the AC list, or attach screenshots — Inspector UI captures are acceptable):
   - Call 1 (`remember`) response
   - Call 2 (`recall` verbosity=both) response
   - Call 3 (`forget`) response
   - Call 4 (`recall` post-forget) response

**T-04-LEAK sanitization (REQUIRED before commit):**
Before committing the updated artifact, sanitize the recorded JSON and screenshots:
- Replace any `/Users/<actual-name>/` absolute paths with `/Users/<redacted>/`
- Confirm no real OAuth tokens, KV namespace IDs, or Cloudflare account IDs appear in the JSON body or screenshots
- The smoke uses synthetic content ("Acme Corp staff engineer role" — fictitious) precisely to keep the recorded artifact ship-safe
- If unsure whether a value is sensitive, redact it — err on the side of sanitization

## Smoke Run

_TBD — see Task 05-02 (the human-verify checkpoint in Plan 04-05). After the smoke runs,
replace this paragraph with the structured record per "What to record after running" above._

## Cross-references

- Plan: [`04-05-PLAN.md`](./04-05-PLAN.md)
- Phase 3 analog: [`03-MCP-INSPECTOR-SMOKE.md`](../../phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md)
- Live envelope source: [`packages/mcp-server/src/envelope.ts`](../../../packages/mcp-server/src/envelope.ts)
- Live handlers: [`packages/mcp-server/src/tools.ts`](../../../packages/mcp-server/src/tools.ts)
- Bootstrap script: [`scripts/kv-bootstrap.mjs`](../../../scripts/kv-bootstrap.mjs)
- Smoke procedure README: [`packages/mcp-server/README.md`](../../../packages/mcp-server/README.md)
- Acceptance criterion: REQUIREMENTS.md TOL-08

## Effect on Phase 04 closure

Phase 04 (`core-tools-envelope`) is closed when all three conditions are met:

1. **This smoke reaches `status: resolved`** — the Task 05-02 human-verify checkpoint has been
   executed and this artifact's frontmatter updated.
2. **All Wave 0/1/2/3 vitest assertions are GREEN** — Plans 04-01 through 04-04 delivered the
   tests; `npm run test --workspaces --if-present` exits 0 from repo root.
3. **`04-VALIDATION.md` is marked `nyquist_compliant: true`** — Task 05-05 performs this final
   update after the smoke passes.

**Important scope boundary:** This smoke validates that the `EngramResponse<T>` envelope shape
holds against a GENERIC MCP client (MCP Inspector). It does NOT validate that Russell's
production job-search agent is correctly wired to Engram. That is **DEP-04 in Phase 7** —
the full Russell-agent reconfig is explicitly deferred per `04-CONTEXT.md` "Claude's
Discretion" and `04-RESEARCH.md` §"Open Question 4".

Anyone reading this artifact in the future should understand the scope: TOL-08 = "the
envelope shape works against a real MCP client in local mode." Not "Russell's job-search
agent has been migrated to Engram." The Phase 7 DEP-04 plan will close that gap when Phase
7 executes.
