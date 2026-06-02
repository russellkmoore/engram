---
phase: 06-async-pipeline
fixed_at: 2026-05-29T00:00:00Z
review_path: .planning/phases/06-async-pipeline/06-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 10
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-05-29T00:00:00Z
**Source review:** `.planning/phases/06-async-pipeline/06-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (CR-01, WR-03 — explicitly requested by scope override)
- Fixed: 2
- Skipped: 10 (all out-of-scope-for-this-run; deferred to v0.2 triage or separate fix sessions)

## Fixed Issues

### CR-01: Re-thrown non-429 AI error on `attempts < 2` poisons the entire batch

**Files modified:** `packages/triage-worker/src/index.ts`, `packages/triage-worker/src/__tests__/queue-integration.test.ts`
**Commit:** 6a2e20e
**Applied fix:** Wrapped `await workspaceTag(event.workspace_id)` and `await extractAndScore(...)` in a single unified per-message try/catch inside the `queue()` handler's `for...of` loop. The catch block:

- On `attempts < 2` (early-attempt branch): calls `message.retry({delaySeconds: 30})` and `continue`s to the next message, consuming exactly one retry slot.
- On `attempts >= 2` (last-attempt branch): calls `markIngestFailed` on the WorkspaceDO RPC stub (wrapped in its own inner try/catch so a secondary throw is logged and swallowed), then calls `message.ack()` and `continue`s.

Hoisted `attempts` and `isLastAttempt` to the top of the loop iteration so both the new wrapper AND the existing DO-RPC catch block below can branch on the same values. Removed the now-redundant declarations from the DO-RPC catch site. The reason-string prefix `"pre-route-throw:"` distinguishes wrapper-origin failures from the DO-RPC catch path's `"do-rpc-${decision}:"` prefix in `blocks.properties.error`.

Followed fix_guidance option (a) — unified wrapper covering BOTH `workspaceTag` (WR-03) and `extractAndScore` (CR-01) — rather than two separate wrappers. The redundant last-attempt-markIngestFailed logic at `extract.ts:144-176` is left in place (intentional defense-in-depth duplication; consolidating would balloon the change and the wrapper is functionally complete without it).

Mirror pattern: the new wrapper structurally matches the existing DO-RPC catch block at `index.ts:303-355` (same isLastAttempt branch, same inner try/catch around markIngestFailed, same console.error+continue semantics).

### WR-03: `await workspaceTag(event.workspace_id)` is unwrapped — failure crashes the entire batch

**Files modified:** `packages/triage-worker/src/index.ts`, `packages/triage-worker/src/__tests__/queue-integration.test.ts`
**Commit:** 6a2e20e (same atomic commit as CR-01 — same root cause + same fix)
**Applied fix:** Coverage of `workspaceTag` is achieved by hoisting its `await` inside the same try block that wraps `extractAndScore`. Any throw from `crypto.subtle.digest("SHA-256", ...)` (workerd shutdown mid-batch, transient runtime error, TextEncoder failure on an oddly-encoded workspace_id) is now caught by the wrapper and routed through the same retry/ack-on-last-attempt logic — bounding the failure to one retry slot at worst, never batch-wide redelivery.

## Regression test (added)

Added one `describe("CR-01 + WR-03 regression: per-message error envelope prevents batch poisoning")` block with two `it()` cases:

1. **Early-attempt re-throw (attempts=0)** — the canonical CR-01 scenario. Seeds 2 blocks; configures `env.AI.run` to resolve once (message 1) then reject once (message 2). Asserts message 1 acks normally (block → `enriched`), message 2 calls `message.retry({delaySeconds: 30})` exactly once (block stays `pending`), and `env.AI.run` was called exactly 2 times (no batch-wide redelivery). Without the wrapper this test fails because `handler.queue()` rejects and never returns. Also asserts the wrapper's `triage:pre-route-threw` console.error log fired with `{ id, attempts: 0, reason: ... }` shape.

2. **Last-attempt re-throw (attempts=2)** — proves the dual-path end-state contract. extract.ts's INTERNAL last-attempt handler at `extract.ts:144-176` fires first (its reason-prefix `ai-throw-non-429:` is asserted), but the SQLite end-state (`ingest_status='failed'`, properties contains `{error, failed_at}`) is identical to what the wrapper would have produced — proving the two catch sites converge on the same invariant.

All 9 tests pass (7 pre-existing + 2 new regression). Full triage-worker suite: 14 passed | 1 skipped.

## Skipped Issues

All other findings are out-of-scope for this run per the `<scope_override>` instruction. They are NOT broken, NOT triaged as won't-fix — just deferred to a separate fix session or to v0.2 triage. Each is documented with original-issue + skip-reason below.

### WR-01: `markIngestFailed` reason field is unsanitized and embeds upstream error strings into a SQLite-persisted JSON column

**File:** `packages/workspace-do/src/queries.ts:760-774`
**Reason:** out-of-scope-for-this-run
**Original issue:** The reason value flows from `extract.ts:159`, `extract.ts:264`, `index.ts:268` (and now `index.ts` wrapper at line ~173) into `blocks.properties.error` via `JSON.stringify`. No length cap, no control-character stripping. Risk is information disclosure when the v0.2 inbox UI renders the JSON. Recommended fix: cap reason at 500 chars + strip control characters at the `markIngestFailed` boundary.

### WR-02: Manual `attempts >= 2` last-attempt check drifts from `wrangler.jsonc max_retries=3` if either side changes

**File:** `packages/triage-worker/src/index.ts:140` + `packages/triage-worker/src/extract.ts:144, 210` (3 hard-coded `>= 2` checks; now 4 with the new wrapper at index.ts:98)
**Reason:** out-of-scope-for-this-run
**Original issue:** The constant `2` is unexplained at the call sites and not derived from the wrangler config. If max_retries changes to 5, the pre-emption logic fires 3 attempts too early. Recommended fix: extract `MAX_RETRIES` / `LAST_ATTEMPT_INDEX = MAX_RETRIES - 1` to a single-source-of-truth constant module that all 4 call sites import.

Note: the CR-01/WR-03 fix ADDED one more `attempts >= 2` site (in the new wrapper) — this compounds the WR-02 drift surface from 3 to 4 sites. When WR-02 is addressed, the wrapper's check at `index.ts:98` should also be migrated to the shared constant.

### WR-04: `markIngestFailed` overwrites `properties` — loses any prior enrichment context

**File:** `packages/workspace-do/src/queries.ts:760-774`
**Reason:** out-of-scope-for-this-run
**Original issue:** The UPDATE overwrites `properties` rather than COALESCE-merging. In Phase 6 this is unreachable (every call site is on the permanent-fail branch, not on a retry-after-success branch). The footgun surfaces in v0.2 when connector workers may legitimately retry enrichment after a partial success. Recommended fix: defer to v0.2 — store error payload in a separate `blocks.failure_info` column (v4 migration) rather than overwriting `properties`.

### WR-05: `properties` column lacks a per-call invariant check (no discriminated union for enriched vs failure metadata)

**File:** `packages/workspace-do/src/queries.ts:760-774` + downstream `Memory` type in `shared/types/src/index.ts`
**Reason:** out-of-scope-for-this-run
**Original issue:** A v0.2 consumer reading `block.properties.company` after a failed enrichment gets `undefined` instead of failing fast. Recommended fix: document the convention on `Memory.properties` JSDoc + add `ingest_status` field to `Memory` so v0.2 code can branch on `block.ingest_status === 'failed'` before reading properties.

### WR-06: `recall()` / `lexicalSearchBlocks` does not exclude `ingest_status='failed'` rows

**File:** `packages/workspace-do/src/queries.ts:389-406` (`lexicalSearchBlocks`) + `tools.ts:548` (`getBlocksByIds` invoked from `recall()`)
**Reason:** out-of-scope-for-this-run
**Original issue:** Failed blocks are surfaced by `search()` and `recall()` because neither `getBlocksByIds` nor `lexicalSearchBlocks` filters on `ingest_status != 'failed'`. Worse, the Vectorize upsert is on the SYNC path before queue dispatch, so failed blocks DO have vectors in Vectorize. Recommended fix: add `AND ingest_status != 'failed'` to both WHERE clauses (Option 2 from the reviewer's two options — cheaper than a Vectorize sweep job).

### IN-01: `setup-queue.sh` precheck uses `>/dev/null 2>&1` — silent failures hide auth issues

**File:** `scripts/setup-queue.sh:39`
**Reason:** out-of-scope-for-this-run
**Original issue:** Failed auth from `wrangler queues info` is swallowed, so users see only the secondary `wrangler queues create` error, not the original auth message. Recommended fix: echo a hint when entering the create branch, or stash stderr to a tempfile and surface it conditionally.

### IN-02: `tools.ts:257` uses `(env as any).WORKSPACE` cast — type widening loses safety until `wrangler types` runs

**File:** `packages/mcp-server/src/tools.ts:256-257, 415`
**Reason:** out-of-scope-for-this-run
**Original issue:** The `(env as any).WORKSPACE` and `(env as any).INGEST_QUEUE` casts hide drift if wrangler binding names change. Recommended fix: add a CI check that validates binding names post-`wrangler types`, or use a runtime assertion at module load. Also reclassify production-env missing-binding from `console.warn` to `console.error`.

### IN-03: `lexicalSearchBlocks` defaults limit=50 but `search()` MCP tool passes through `args.limit` without a clamp

**File:** `packages/workspace-do/src/queries.ts:389-406` + `packages/mcp-server/src/tools.ts:639-643`
**Reason:** out-of-scope-for-this-run (Phase 4 zod schema concern, not Phase 6)
**Original issue:** If `SearchInputSchema.limit` lacks a `.max(N)` bound, a malicious caller could request `limit: 1_000_000` and force the DO to materialize a million rows. Recommended fix: verify the schema clamp exists; if absent, add one in a follow-up.

### IN-04: `markIngestFailed` JSDoc says "fall through to ack()" — but the caller's behavior matters

**File:** `packages/workspace-do/src/queries.ts:749-754`
**Reason:** out-of-scope-for-this-run
**Original issue:** The JSDoc couples the helper to the Queue consumer's behavior; a future caller (Phase 7 admin tool) would inherit the contract obligation without knowing it. Recommended fix: reword the JSDoc to "throws NotFoundError; callers are responsible for graceful handling" — without coupling to the Queue specifically.

### IN-05: `extract.ts:96` default `wsTag = "test-ws"` masks production analytics dimension when called without wsTag

**File:** `packages/triage-worker/src/extract.ts:96`
**Reason:** out-of-scope-for-this-run
**Original issue:** If a future production caller (e.g., a connector worker) forgets to pass `wsTag`, all analytics events for that workspace get tagged `test-ws`, polluting production dashboards. Recommended fix: remove the default and make the parameter required, surfacing the omission as a TS error.

---

_Fixed: 2026-05-29T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
