# Phase 05: Integration Kitchen Sink - Research

**Researched:** 2026-06-10
**Domain:** Verification engineering — cross-feature integration testing on a composed Cloudflare Workers / Durable Objects / Vectorize stack
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Matrix closure (INT-04)**
- D-01: Audit-first, then fill + scope. First plan step audits each of the 6 matrix rows against existing tests. Rows with real coverage → set `tested`. Genuine gaps → author focused integration test. Genuinely-redundant/non-existent rows → mark `out-of-scope` with a written, defensible reason.
- D-02: Bias toward testing over scoping-out. The `adaptive-routing × cosine-edge` row maps to real v0.2 code (EXP-03 `top1_cosine < 0.65` + EXP-10 429 retry). A row is `out-of-scope` only when the audit proves the path is genuinely absent or already covered elsewhere.
- D-03: Matrix status vocabulary is fixed — only `tested` / `pending` / `out-of-scope`, matched as literals. Every `tested` row MUST have a non-empty Test File cell that resolves to a file on disk.

**INT-01 envelope budget**
- D-04: Reuse the existing token-budget harness — `gpt-tokenizer/encoding/cl100k_base` + `trimToBudget`.
- D-05: Assert post-trim ≤ 7,500 cl100k tokens AND content preservation: synthesis + high-severity `context.conflicts[]` survive trim.
- D-06: Pre-trim blow-out is expected and acceptable; INT-01 does NOT assert pre-trim size.

**INT-03 cross-workspace pentest shape**
- D-07: Extend `cross-workspace-pentest.test.ts` in place (no fragmentation). Add 3 mcp-server paths as Prong-A-style cases.
- D-08: Mirror Prong C discipline — real-creds Vectorize-namespace assertions stay `it.skip` at PR-time.
- D-09: Do NOT duplicate Prong B per path.
- D-10: Conflict-pipeline write path gets its own isolation case in triage-worker (not mcp-server).
- D-11: Expanded-query fan-out: assert all query variants resolve against the same workspace-scoped Vectorize namespace.

**Phase boundary (out-of-boundary, locked)**
- Phase 999.2 (D-09 all-uncited synthesis floor) — backlog, NOT Phase 5
- Phase 999.3 (LLM-judge robustness) — backlog, NOT Phase 5
- `verbosity` default flip to `"both"` — v0.3 (D-7 lock)
- Any new MCP tool, feature, or behavior change

### Claude's Discretion
- INT-02 envelope backward-compat: existing `envelope.test.ts` + snapshot unchanged; add non-breaking shape assertions for `context.conflicts[]` (undefined→omit per CON-05 D-08) and optional `result.synthesis`. A snapshot update covering only genuinely-new optional fields is acceptable.
- INT-05 e2e smoke: split into (a) automated programmatic smoke — local `wrangler dev` + scripted `remember → recall(verbosity="synthesis") → conflict-surfacing`, CI-runnable — and (b) documented one-time manual run against deployed staging at milestone close (not a PR-blocking gate). Planner confirms staging reachability.
- Exact worst-case fixture construction (builder helper vs inline) and kitchen-sink suite location (default `src/__tests__/integration/`).

### Deferred Ideas (OUT OF SCOPE)
- Phase 999.2 — D-09 all-uncited synthesis floor
- Phase 999.3 — LLM-judge robustness
- `verbosity` default flip to `"both"` (v0.3)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INT-01 | `v02-kitchen-sink.test.ts` integration suite asserts worst-case envelope (10 conflicts + 50 entities + `verbosity="synthesis"`) serializes ≤ 8K tokens | Token-budget harness confirmed reusable; fixture shape documented in §INT-01 detail |
| INT-02 | Existing `envelope.test.ts` still passes against the v0.2 envelope shape — no breaking changes to the v0.1 contract | Snapshot contents audited; new optional fields documented in §INT-02 detail |
| INT-03 | Cross-workspace pentest extended to cover 4 new code paths: expanded-query fan-out, reranker, synthesis, conflict-pipeline writes | Exact call sites and prong patterns documented in §INT-03 detail |
| INT-04 | Integration matrix from PRE-04 resolves to zero `pending` rows | Matrix audit completed in §Matrix Audit — 0 ALREADY-TESTED, 6 GENUINE-GAP |
| INT-05 | End-to-end smoke: fresh `wrangler dev` boot of both Workers + `remember → recall(verbosity="synthesis") → conflict-surfacing-in-recall` | Staging reachability audit in §INT-05 detail; no staging target configured — automated + manual ritual split confirmed |
</phase_requirements>

---

## Summary

Phase 5 is a pure verification phase. All 4 v0.2 features (hybrid-rank, conflict-detection wiring, query-expansion + bge-reranker, synthesis activation) are implemented and individually tested in Phases 2–4. This phase proves they **compose** cleanly — specifically that the composed `recall()` pipeline from `tools.ts` (expand → RRF → reranker → hybridRank → conflict-surfacing → synthesis → trimToBudget) honors the v0.1 `EngramResponse<T>` contract under worst-case load.

**Matrix audit result (D-01 backbone):** All 6 matrix rows are **GENUINE-GAP**. No prior phase updated the matrix or created an integration test that satisfies any row's end-to-end coverage requirement. The audit finding is consistent with the matrix's design intent (it was created to track work that Phases 2–4 were supposed to close but explicitly deferred to Phase 5 for final integration confirmation). The `recall-conflicts.test.ts` file comes closest — it proves CON-05 wiring in isolation — but it does NOT exercise ranking (mock score 0.9 for all) or synthesis, so it does not satisfy RNK×CON or CON×SYN.

The phase's workload is therefore 6 focused integration tests + 2 security extensions + 1 envelope shape assertion update + 1 e2e smoke. The primary risk is false-positive coverage: tests that pass without actually exercising the composed code path (e.g., a synthesis test where synthesis returns null because the fixture doesn't provide enough memories to pass the SYN-07 guard).

**Primary recommendation:** Plan against the matrix as the governing checklist. Write tests that drive `recall()` in `tools.ts` end-to-end with fixtures designed to trip each pairing's specific failure mode. Do not mock `hybridRank`, `expandQuery`, or `generateSynthesis` in the kitchen-sink suite — partial mocking is what allowed these gaps to persist through Phases 2–4.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Feature composition under recall() | API / Backend (mcp-server tools.ts) | — | All 4 v0.2 features compose at the `recall()` handler call site in tools.ts |
| Token budget enforcement | API / Backend (envelope.ts trimToBudget) | — | trimToBudget is called at the return site of every tool handler |
| Cross-workspace isolation | API / Backend (props.workspace_id → DO routing) | Database/Storage (assertOwnsWorkspace) | Two-layer defense: routing and DO-level assertion |
| Conflict-pipeline workspace routing | Async pipeline (triage-worker) | Database/Storage (WorkspaceDO inbox table) | Separate Worker, must prove it routes writes by workspace_id |
| E2E smoke execution | Local CLI (wrangler dev) | — | No staging target configured; local boot is the automated path |

---

## D-01 Matrix Audit — Ground Truth

> This is the highest-value output of this research. Each of the 6 INTEGRATION-MATRIX rows was checked against actual test files on disk.

### Row 1: RNK × CON (ranking + conflict detection)

**Covering Plan hint:** 02-04

**Files checked:**
- `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — exercises `recall()` with conflict inbox rows; asserts `context.conflicts[]`. Uses Vectorize mock with score=0.9 for all hits. Calls `captureCallback("recall", workspace_id)` with `verbosity: "chunks"`.
- `packages/mcp-server/src/__tests__/recall.test.ts` — exercises EXP-03 adaptive routing, reranker logic, RRF; mocks `hybridRank` and does NOT seed conflict rows.
- `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` — unit tests hybridRank in isolation.

**Gap:** `recall-conflicts.test.ts` mocks all Vectorize hits at score=0.9 (above `MIN_COSINE_THRESHOLD`, all equal). `hybridRank` is called with real mock data but no test asserts that conflicts are NOT sorted away after reranking — specifically, that `context.conflicts[]` is populated even when the conflict-linked memories rank lower than non-conflicting ones. This is exactly the failure mode the matrix row describes ("ranking can sort conflicts away before `EngramResponse.context.conflicts[]` is populated").

**Classification: GENUINE-GAP** — need a test that seeds ranked memories with deliberate score variance and verifies conflicts survive hybridRank ordering.

**Suggested test file:** `packages/mcp-server/src/__tests__/integration/rnk-x-con.test.ts` or fold into `v02-kitchen-sink.test.ts`.

---

### Row 2: RNK × EXP (ranking + query expansion)

**Covering Plan hint:** 03-03

**Files checked:**
- `packages/mcp-server/src/__tests__/recall.test.ts` — "Test 2 (fire fan-out)" verifies `expandQuery` is called when top1 < 0.65, RRF merges lists, and `hybridRank` receives merged matches. However, `hybridRank` is mocked: `vi.mock("../hybrid-rank.js", () => ({ hybridRank: vi.fn() }))`.
- `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` — tests hybridRank with specific weight inputs but no multi-query candidate set.

**Gap:** `recall.test.ts` Test 2 proves fan-out fires and RRF merges, but mocks `hybridRank` so the weight behavior on the expanded candidate set is never exercised. The matrix row concern is "weights must still hold" on the broader candidate set — which requires an unmocked `hybridRank` call with a real RRF-merged input. No existing test does this.

**Classification: GENUINE-GAP** — need a test that drives fan-out (top1 < 0.65 mock) through RRF into a real (unmocked) hybridRank call and asserts the ranking output is deterministic/correct.

**Suggested test file:** `packages/mcp-server/src/__tests__/integration/rnk-x-exp.test.ts` or fold into kitchen-sink.

---

### Row 3: EXP × SYN (query expansion + synthesis)

**Covering Plan hint:** 04-03

**Files checked:**
- `packages/mcp-server/src/__tests__/recall.test.ts` — no synthesis assertions; `generateSynthesis` is not tested in this file at all.
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` — "verbosity='synthesis' returns synthesis-populated" at line 565; does NOT mock `expandQuery` and does not deliberately exercise the fan-out path.
- `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts`, `synthesis-preflight.test.ts` — unit tests for synthesis post-processing helpers; no recall-level composition.

**Gap:** No test drives: `top1_cosine < 0.65` (triggers fan-out) → RRF merge → ranked memories ≥ 2 → `generateSynthesis()` called → synthesis string returned in envelope. The synthesis tests in `tools-integration.test.ts` run on a single-query path and the mock AI always returns "Mock synthesis." — the synthesis pipeline is not tested in context of an expanded candidate set.

**Classification: GENUINE-GAP** — need a test that deliberately triggers adaptive routing AND synthesis in the same call.

---

### Row 4: CON × SYN (conflict detection + synthesis)

**Covering Plan hint:** 04-04

**Files checked:**
- `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — all 4 tests use `verbosity: "chunks"` (explicitly). No test uses `verbosity: "synthesis"` with inbox conflict rows present. Synthesis path is never exercised in this file.
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` — synthesis tests do NOT insert conflict rows.

**Gap:** There is zero coverage of the path where both conflicts are present in the context AND synthesis is requested. The matrix concern — synthesis must NOT collapse contradictory inputs into a falsely confident narrative — is entirely untested. There is no assertion that `context.conflicts[]` is populated AND `result.synthesis` is non-null in the same envelope response.

**Classification: GENUINE-GAP** — need a test that seeds conflict rows, calls `recall(verbosity="synthesis")`, and asserts both fields are populated simultaneously.

---

### Row 5: kitchen-sink (RNK + CON + EXP + SYN)

**Covering Plan hint:** 04-05

**Files checked:**
- No file matches the description. No test file drives all 4 features simultaneously with a 10-conflict + 50-entity + verbosity=synthesis fixture.
- `token-budget.test.ts` drives a 25-memory worst-case fixture through `trimToBudget`, but uses `buildRecallResponse` directly (no actual `recall()` invocation through `tools.ts`).

**Gap:** Complete gap. This is the `v02-kitchen-sink.test.ts` deliverable (INT-01).

**Classification: GENUINE-GAP** — primary INT-01 deliverable; no existing coverage.

---

### Row 6: adaptive-routing × cosine-edge (429-retry + Vectorize boundary)

**Covering Plan hint:** 05-04

**Files checked:**
- `packages/mcp-server/src/__tests__/recall.test.ts` — "Test 3 (EXP-10 fallback)" covers `expandQuery` throwing a `RateLimitError`, which triggers the fallback to single-query path. Score used: top1 = 0.40 (< 0.65), so adaptive gate fires.
- However, "Test 3" does NOT simultaneously exercise a cosine-edge scenario — the match scores used (0.8, 0.75, etc.) are well above `MIN_COSINE_THRESHOLD` (0.6 per `@engram/ai-config`). The "cosine-edge" case is `top1_cosine` near 0.65 (at the adaptive threshold boundary) AND retry logic firing simultaneously.
- No test covers: top1 near 0.65 (edge case triggering fan-out) + reranker or expansion 429 + the resulting fallback behavior + how `mergedMatches` is used with near-threshold cosine scores.

**Per D-02:** This maps to real code — `ADAPTIVE_TOP1_THRESHOLD = 0.65` is a live constant in `tools.ts`, `EXP-10` fallback catch is live code, and the "both go wrong at once" scenario is a genuine coverage gap.

**Classification: GENUINE-GAP** — need a test covering top1 near-threshold (e.g., 0.64) with expansion 429-retry firing, verifying fallback returns well-ranked single-query results.

---

**Matrix Audit Summary: 0 ALREADY-TESTED, 6 GENUINE-GAP, 0 OUT-OF-SCOPE**

---

## INT-01: Token Budget Harness Reuse

**Source file:** `packages/mcp-server/src/__tests__/token-budget.test.ts` [VERIFIED: read directly from disk]

### Import path for cl100k encoder

```typescript
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
```

This is the SPECIFIC import path (not the barrel `gpt-tokenizer`). The test comments note "Pitfall 6 — NOT the barrel default o200k_base". This is the encoding the planner must use. [VERIFIED: read from token-budget.test.ts line 44]

### `trimToBudget` import

```typescript
import { buildRecallResponse, buildRememberResponse, trimToBudget } from "../envelope.js";
```

`trimToBudget` takes an `EngramResponse<T>` (the envelope) and returns the same type. When under budget, it returns the SAME reference (no copy). When over budget, it sheds chunk bulk while preserving `meta` and `context.conflicts`. [VERIFIED: read from token-budget.test.ts + tools.ts]

### `buildWorstCaseMemories` helper signature

```typescript
function buildWorstCaseMemories() {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `blk-${String(i)}`,
    type: "research_note",
    content: "x".repeat(4_000),   // 4KB content
    summary: "y".repeat(1_000),   // 1KB summary
    properties: null,
    embedding_id: null,
    scope: "personal" as const,
    project_id: null,
    source: "mcp:test",
    confidence: 0.9,
    created_at: Date.now(),
    updated_at: Date.now(),
    snippet: null,
    match_column: null as "content" | "summary" | null,
    score: null,
  }));
}
```

This is the `LexicalSearchHit` shape (returned by `stub.getBlocksByIds`). The INT-01 fixture extends this to 10-conflict + 50-entity configuration. [VERIFIED: read from token-budget.test.ts lines 59–77]

### Existing ≤7,500 assertion shape

```typescript
// Pattern from token-budget.test.ts lines 113–131
const worstCaseMemories = buildWorstCaseMemories();
const envelope = buildRecallResponse({ memories: worstCaseMemories, verbosity: "synthesis" });
const trimmed = trimToBudget(envelope);
const tokenCount = encode(JSON.stringify(trimmed)).length;
expect(tokenCount).toBeLessThanOrEqual(7_500);
// D-10 invariant: meta + context.conflicts preserved
expect(trimmed).toHaveProperty("meta");
expect(trimmed.context).toHaveProperty("conflicts");
```

### INT-01 Fixture Requirements (D-04/D-05)

The INT-01 fixture must differ from the existing token-budget fixture in two critical ways:

1. **Conflict population:** pass `conflicts` to `buildRecallResponse({ ..., conflicts: conflictArray })`. The conflict array must contain at least one `severity: "high"` entry so the content-preservation assertion can specifically test that high-severity conflicts survive trim.

2. **Content preservation assertions (D-05 — the test's "teeth"):**
```typescript
// These are the assertions that make INT-01 non-trivial:
expect(trimmed.result.synthesis).not.toBeNull(); // synthesis survived trim
const survivingConflicts = trimmed.context.conflicts ?? [];
const highSeverity = survivingConflicts.filter((c) => c.severity === "high");
expect(highSeverity.length).toBeGreaterThan(0); // high-severity conflicts survived
```

3. **Fixture location:** Claude's Discretion — default to `src/__tests__/integration/` to match the existing `recall-conflicts.test.ts` precedent, as a new file `v02-kitchen-sink.test.ts`.

4. **`buildRecallResponse` `conflicts` parameter:** The v0.2 `buildRecallResponse` accepts a `conflicts` parameter (confirmed at `tools.ts` line 1046: `buildRecallResponse({ memories: ranked, verbosity: args.verbosity, synthesis, conflicts })`).

---

## INT-02: Envelope Contract

**Source files:** `packages/mcp-server/src/__tests__/envelope.test.ts`, `__snapshots__/envelope.test.ts.snap` [VERIFIED: read directly from disk]

### What the snapshot currently asserts

The snapshot is for `META_GAPS` byte-determinism only (D-10 fixture stability), at:

```
META_GAPS byte-determinism (D-10 fixture stability) > META_GAPS strings are frozen at v0.1 — snapshot lock for MCP-08 fixture reproducibility 1
```

It asserts exact string values for: `coldStorageDemotion`, `forget`, `ingest`, `queryExpansionUnavailable`, `recall`, `recallChunksOmittedSynthesis`, `recallQueryTruncated`, `remember`, `search`, `truncationOver1800Chars`. [VERIFIED: read from snap file]

### What needs new shape assertions (vs snapshot update)

The snapshot covers only `META_GAPS`. The remaining envelope contract tests in `envelope.test.ts` are `expect()` assertions (not snapshots). INT-02 requires new non-snapshot assertions:

1. **`context.conflicts[]` content** — verify the field is absent (not empty array) when no conflicts exist, present as an array of `Conflict` objects when conflicts exist. Current test at line 79 (`expect(envelope.context.conflicts).toEqual([])`) covers the v0.1 builder behavior (always `[]` from builder); needs a new assertion that the `recall()` handler OMITS the field entirely when `conflicts.length === 0` (CON-05 D-08 / T-02-08-05 already tested in `recall-conflicts.test.ts` but not from the builder perspective).

2. **Optional `result.synthesis` string** — the Phase 5 `buildRecallResponse` accepts a `synthesis` parameter. The current test at line 97 (`expect(envelope.result.synthesis).toBeNull()`) covers the null case. New assertion: `buildRecallResponse({ memories: [], verbosity: "synthesis", synthesis: "text" })` produces `result.synthesis === "text"`. **This assertion already exists** in `envelope.test.ts` lines 241–250 (the D-01 describe block). So this is already covered by the existing file.

3. **No snapshot update needed** — the `META_GAPS` snapshot covers byte-frozen strings only. Adding `recallChunksOmittedSynthesis` is already in the snapshot (confirmed at snap line 12). The snapshot MUST NOT change unless a META_GAPS string changes.

**INT-02 implementation verdict:** The existing `envelope.test.ts` file already has a describe block (lines 229–264) that tests D-01 verbosity behavior and synthesis population. The backward-compat proof (INT-02) is satisfied by running the existing file without changes + verifying it passes. The planner may add a short `context.conflicts` discipline assertion (field-omit when empty), but the bulk of INT-02 is "run `envelope.test.ts` and it passes."

---

## INT-03: Pentest Extension Points

**Source file:** `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` [VERIFIED: read directly from disk]

### Prong A `captureCallback` helper signature

```typescript
function captureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-pentest",
): (args: unknown, extra: unknown) => Promise<unknown>
```

The helper calls `registerTools(server, () => ({ workspace_id, user_id }), env, ...)` and captures the registered callback for `toolName` by scanning `spy.mock.calls`. Returns the callback directly so tests can call it with forged workspace IDs. [VERIFIED: read from cross-workspace-pentest.test.ts lines 125–161]

### Prong B `runInDurableObject` forge-arg pattern

```typescript
// Prong B pattern (lines 219–245):
const workspaceNs = (env as unknown as Record<string, unknown>).WORKSPACE as DurableObjectNamespace;
const stubA = workspaceNs.get(workspaceNs.idFromName("workspace_A"));
await runInDurableObject(stubA, (instance: unknown) => {
  const ws = asWorkspaceDO(instance);
  try {
    ws.lexicalSearchBlocks({
      workspace_id: "workspace_B", // FORGED
      query: "anything",
    });
  } catch (err) {
    caught = err;
  }
});
expect(caught).toBeInstanceOf(McpError);
expect((caught as McpError).code).toBe(ErrorCode.InvalidRequest);
```

Per D-09, this generic backstop MUST NOT be duplicated per new code path. [VERIFIED: read from cross-workspace-pentest.test.ts]

### Prong C `it.skip` real-creds gating

```typescript
// hasEvalCreds gate (vitest.config.ts line 38)
const hasEvalCreds = !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;

// In test file:
it.skip("AI-02 Prong C: vector upserted under workspace_A namespace NOT returned by query in workspace_B", async () => {
  // SKIPPED: requires real Cloudflare Vectorize binding (remote: true).
  // ...
}, 15_000);
```

The comment documents the exact condition: `it.skip` at PR-time; run nightly with `CLOUDFLARE_ACCOUNT_ID` + `wrangler login`. New Prong C additions for v0.2 paths must follow the same pattern. [VERIFIED: read from cross-workspace-pentest.test.ts lines 266–294]

### 3 new mcp-server paths to wrap as Prong-A cases (D-07/D-11)

These are the call sites in `packages/mcp-server/src/tools.ts` that must be covered:

**Path 1 — Expanded-query Vectorize fan-out (D-11):**
Location: `tools.ts` lines 795–809. The fan-out calls `vectorizeQuery(env, props.workspace_id, variantVec, ...)` for each variant. The workspace_id is always `props.workspace_id`. Prong A test: register recall with `workspace_A`, seed data, then call recall from `workspace_B` — fan-out variants (when top1 < 0.65) must query `workspace_B`'s namespace, never returning workspace_A data. D-11 asserts ALL variant fan-out queries use the same workspace-scoped namespace.

**Path 2 — Reranker call (`safeRun(env, RERANKER_MODEL, { query, contexts })`):**
Location: `tools.ts` lines 890–909. The reranker receives `args.query` (the raw user query string) and `contexts` (text from hydrated blocks). The workspace isolation proof: reranker receives only text from blocks that survived `filteredMatches` — i.e., blocks already filtered by `vectorizeQuery(env, props.workspace_id, ...)`. There is no additional Vectorize call in the reranker path. The Prong A test: seed workspace_A, call recall from workspace_B, assert reranker contexts contain zero workspace_A content (achieved because Vectorize returned zero hits for workspace_B namespace).

**Path 3 — Synthesis call (`generateSynthesis(env, ranked, args.query)`):**
Location: `tools.ts` lines 1006–1031. Same isolation argument as reranker: synthesis input is derived from `ranked` memories, which are already workspace-scoped. Prong A test: seed workspace_A, call `recall(verbosity="synthesis")` from workspace_B, assert `result.synthesis` is null or empty (no memories → SYN-07 guard fires, synthesis skipped).

### Triage-worker conflict-pipeline write path (D-10)

**File to extend:** Create a new test in `packages/triage-worker/src/__tests__/` — specifically a workspace isolation test for `conflictPipeline`.

**What the current tests cover:** `conflict-pipeline.test.ts` tests all verdict branches with mocked `vectorizeNeighbors` and `detectConflict`. The `WORKSPACE` stub uses `idFromName: vi.fn().mockReturnValue({ toString: () => "fake-do-id" })` — it does not assert WHICH workspace_id was passed to `idFromName`. There is no test asserting that `conflictPipeline` routes inbox writes to the correct workspace DO (by `newBlock.workspace_id`).

**What D-10 requires:** Assert that when `conflictPipeline` calls `env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id))` and `stub.insertConflictAsInbox({ workspace_id: newBlock.workspace_id, ... })`, the `workspace_id` arg matches `newBlock.workspace_id` — proving the write targets the correct workspace DO, not a hardcoded or forgeable ID.

**Implementation:** A spy on `WORKSPACE.idFromName` that captures the argument, then assert the captured value equals `newBlock.workspace_id`. This is a unit-level isolation test, not a full integration test (the existing `conflict-pipeline.test.ts` pattern is the right model).

---

## INT-05: Staging Reachability

**Finding: No staging environment is configured.** [VERIFIED: read both wrangler.jsonc files]

Both `packages/mcp-server/wrangler.jsonc` and `packages/triage-worker/wrangler.jsonc` have no `[env.staging]` section, no `environments` array, and no preview target. The wrangler configs have production bindings only (KV namespace IDs + Vectorize `engram-memories` + Queue `engram-ingest`).

**scripts/smoke-wrangler-dev.sh** exists and supports `binding-mode=local` (stubs remote bindings, CI-safe) and `binding-mode=remote` (real Cloudflare bindings via env vars). This is the existing e2e smoke infrastructure.

**INT-05 split (per CONTEXT.md Claude's Discretion):**

**(a) Automated local smoke — CI-runnable:**
- Use `smoke-wrangler-dev.sh` to boot mcp-server (`mode=http`, port 8787) and triage-worker (`mode=boot`, port 8788)
- Issue programmatic MCP requests: `remember → recall(verbosity="synthesis") → verify context.conflicts[]` 
- This can be an automated test script or a vitest test that spawns wrangler dev processes
- `binding-mode=local` for PR-time CI; `binding-mode=remote` for nightly CI (requires CF creds)

**(b) Manual staging ritual — documented, not PR-blocking:**
- No staging Cloudflare account or worker name is configured
- Manual ritual = deploy both workers to production (or a named preview) + run the smoke sequence manually
- The planner should create a documented checklist item in the verify-work protocol for milestone close
- This is not a gate for `/gsd:verify-work 5`; it is a milestone-close ritual only

---

## Vitest Project Tiering

**Source file:** `packages/mcp-server/vitest.config.ts` [VERIFIED: read directly from disk]

### Project names and pools

| Project Name | Pool | Include Pattern | Notes |
|---|---|---|---|
| `workerd` | `@cloudflare/vitest-pool-workers` (workerd) | `src/__tests__/**/*.test.ts` (excl. lint + eval) | Main test pool; has `cloudflare:workers` env, DO bindings |
| `lint-node` | Default Vitest Node pool | `lint-no-direct-vectorize.test.ts`, `no-proactive-notifications.test.ts` | node:fs available; no DO bindings |
| `eval` | `@cloudflare/vitest-pool-workers` (workerd) | `src/__tests__/**/*.eval.test.ts` | Gated on `hasEvalCreds`; `isolate: false`; `maxWorkers: 1`; creds required |

### Where new INT tests land

All Phase 5 INT tests (`v02-kitchen-sink.test.ts`, modifications to `cross-workspace-pentest.test.ts`, modifications to `envelope.test.ts`) land in the **`workerd` project**. They are `*.test.ts` files under `src/__tests__/` and match the workerd include glob. No changes to `vitest.config.ts` are needed.

The new triage-worker isolation test (D-10) lands in the **triage-worker `workerd` project** (same logic: `src/__tests__/**/*.test.ts`).

### Critical workerd affordances available to INT tests

- `env` from `cloudflare:workers` — provides real stub WORKSPACE DO namespace
- `runInDurableObject` from `cloudflare:test` — used in Prong B
- `vi.spyOn(McpServer.prototype, "registerTool")` — the `captureCallback` pattern
- gpt-tokenizer `cl100k_base` encoding — importable from workerd (confirmed by existing `token-budget.test.ts`)

---

## Architecture Patterns

### System Architecture Diagram

```
Test fixtures
    │
    ▼
captureCallback("recall", workspace_id)     [cross-workspace-pentest.ts / kitchen-sink]
    │
    ▼
tools.ts recall() handler
    │
    ├── embed query via safeRun(AI)
    │
    ├── vectorizeQuery(env, workspace_id, ...)  ← workspace isolation
    │       │
    │       ▼
    │   EXP-03 adaptive gate (top1 < 0.65?)
    │       │ YES: expandQuery → keepVariants → fan-out → reciprocalRankFusion
    │       │ NO: single-query path
    │       ▼
    │   filteredMatches (MIN_COSINE_THRESHOLD applied)
    │
    ├── safeRun(RERANKER_MODEL) [if RERANKER_ENABLED]
    │       └── EXP-06 fallback: raw cosine on 429/error
    │
    ├── hybridRank(rerankedMatches, blocks, args)
    │
    ├── listInboxConflictsForMemoryIds(workspace_id, ids)  ← CON-05
    │
    ├── generateSynthesis(env, ranked, query)  [if verbosity∈{synthesis,both}]
    │
    ├── buildRecallResponse({ memories, verbosity, synthesis, conflicts })
    │
    └── trimToBudget(envelope)  ← INT-01 boundary

                                       ↑
               Kitchen-sink test exercises ALL branches above in one call
```

### Recommended Project Structure for new files

```
packages/mcp-server/src/__tests__/
├── integration/
│   ├── recall-conflicts.test.ts     [EXISTING — CON-05]
│   └── v02-kitchen-sink.test.ts     [NEW — INT-01 + kitchen-sink row]
├── cross-workspace-pentest.test.ts  [EXTEND — add 3 Prong-A cases + 1 Prong-C skip]
└── envelope.test.ts                 [EXTEND — context.conflicts shape assertion]

packages/triage-worker/src/__tests__/
├── conflict-pipeline.test.ts        [EXISTING]
└── conflict-pipeline-isolation.test.ts  [NEW — D-10 workspace routing isolation]
```

### Anti-Patterns to Avoid

- **Mocking hybridRank in kitchen-sink tests:** The kitchen-sink row's value comes from exercising the real composed path. Mocking hybridRank in the kitchen-sink test makes it equivalent to the existing isolated unit tests. Use the real `hybridRank` function.
- **Using verbosity="chunks" for CON×SYN:** The entire CON×SYN row requires `verbosity="synthesis"`. Existing `recall-conflicts.test.ts` uses `verbosity: "chunks"` throughout — this is precisely why that file doesn't satisfy the row.
- **Trivially-small fixture for INT-01:** A fixture with 1-2 memories will pass `trimToBudget` with zero trimming — the content-preservation assertion would be vacuously true. The fixture MUST be large enough that `trimToBudget` actually trims (the existing `token-budget.test.ts` adversarial-proof test asserts pre-trim > 8,000 tokens).
- **Prong A with mocked Vectorize returning empty:** If the Vectorize mock returns zero hits, synthesis is skipped (SYN-07: ranked.length < 2). The workspace isolation proof for synthesis requires non-empty Vectorize results for the target workspace and empty for the foreign workspace.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer | `gpt-tokenizer/encoding/cl100k_base` `encode()` | Already in use; exact same encoding as production budget check |
| Fixture memories | Random data generators | Extend `buildWorstCaseMemories()` from `token-budget.test.ts` | Shape-correct for `LexicalSearchHit`; proven adversarial |
| DO access in tests | Custom DO stubs | `env.WORKSPACE` from `cloudflare:workers` + `runInDurableObject` | Real DO runtime via vitest-pool-workers |
| Tool callback capture | Custom MCP server mock | `captureCallback` pattern (`vi.spyOn(McpServer.prototype, "registerTool")`) | Already established in `recall-conflicts.test.ts` and `cross-workspace-pentest.test.ts` |
| Conflict row insertion | Direct SQLite manipulation | `stub.insertConflictAsInbox(...)` DO RPC | The established pattern from `recall-conflicts.test.ts` lines 229–243 |

---

## Common Pitfalls

### Pitfall 1: Trivially-true token budget assertion
**What goes wrong:** INT-01 fixture is too small → `trimToBudget` never actually trims → content-preservation assertion passes trivially without testing the trim logic.
**Why it happens:** The D-05 content-preservation requirement (synthesis + high-severity conflicts survive) is only meaningful when trimming actually occurs.
**How to avoid:** Include the adversarial-proof assertion from `token-budget.test.ts` lines 198–234: assert pre-trim token count exceeds 8,000 BEFORE asserting post-trim ≤ 7,500.
**Warning signs:** Test passes with fewer than 10 memories or with small content strings.

### Pitfall 2: SYN-07 guard silently kills synthesis assertions
**What goes wrong:** `ranked.length < 2` → synthesis skipped → `result.synthesis` is null → content-preservation assertion `expect(trimmed.result.synthesis).not.toBeNull()` fails.
**Why it happens:** The Vectorize mock must return ≥ 2 block IDs, AND those blocks must be present in the DO via `insertBlock` so `getBlocksByIds` returns them, AND the mock cosine scores must clear `MIN_COSINE_THRESHOLD` (0.6 per `@engram/ai-config`).
**How to avoid:** Seed ≥ 2 blocks via `stub.insertBlock(...)` before running the kitchen-sink test. Use the same stateful Vectorize mock pattern from `recall-conflicts.test.ts` (namespace → Set<id> tracking).

### Pitfall 3: Fan-out not firing in kitchen-sink
**What goes wrong:** Vectorize mock always returns top1_cosine ≥ 0.65 → adaptive gate does not fire → EXP path not tested.
**Why it happens:** The default stateful Vectorize mock returns `score: 0.9` for all matches (above the 0.65 threshold).
**How to avoid:** For rows requiring expansion (RNK×EXP, EXP×SYN, kitchen-sink), override the mock to return a first match with `score: 0.60` (below the `ADAPTIVE_TOP1_THRESHOLD = 0.65` literal in `tools.ts` line 781).

### Pitfall 4: gpt-tokenizer barrel import
**What goes wrong:** `import { encode } from "gpt-tokenizer"` imports `o200k_base` (the default); INT-01 token count diverges from what `trimToBudget` uses.
**Why it happens:** `gpt-tokenizer` has multiple encoding-specific entry points; the barrel default is not `cl100k_base`.
**How to avoid:** Always use `import { encode } from "gpt-tokenizer/encoding/cl100k_base"` (exactly as in `token-budget.test.ts` line 44).

### Pitfall 5: Prong A workspace isolation proof fails vacuously
**What goes wrong:** Workspace_B has no data → recall returns 0 memories regardless of isolation → test passes even if the implementation is broken.
**How to avoid:** After the isolation assertion (workspace_B call returns 0), add a "positive control" assertion: call recall from workspace_A and verify ≥ 1 memory is returned (confirms seeding worked, not that the test passed for wrong reasons). The existing `cross-workspace-pentest.test.ts` already does this at lines 203–207 — mirror this pattern.

### Pitfall 6: Conflict fixture misses high-severity case
**What goes wrong:** INT-01 creates conflicts with `created_at` > 180 days apart → all severities are "low" → high-severity content-preservation assertion fails.
**Why it happens:** Severity is computed at read time: `diffDays > 180 → "low"`.
**How to avoid:** For the high-severity assertion, use `created_at: Date.now()` for both `memory_a_id` and `memory_b_id` (same-day → diffDays = 0 → "high"). The pattern is established in `recall-conflicts.test.ts` lines 255–256.

---

## Runtime State Inventory

> Omitted — this is a greenfield test-authoring phase, not a rename/refactor/migration phase. No runtime state is renamed or migrated.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest + wrangler CLI | ✓ | (project standard) | — |
| npm workspaces | package installs | ✓ | (project standard) | — |
| `@cloudflare/vitest-pool-workers` | workerd test pool | ✓ | ^0.16.9 (package.json) | — |
| vitest | test runner | ✓ | ^4.1.7 (package.json) | — |
| gpt-tokenizer | INT-01 token counting | ✓ | (already in mcp-server deps — token-budget.test.ts uses it) | — |
| `wrangler dev` | INT-05 local smoke | ✓ | wrangler is in devDependencies; smoke-wrangler-dev.sh exists | — |
| Cloudflare API creds (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) | INT-05 `binding-mode=remote`, Prong C nightly | ✗ at PR-time | — | `it.skip` + `binding-mode=local` for PR CI |
| Deployed staging environment | INT-05 manual half | ✗ | — | Documented ritual; not a CI gate |

**Missing dependencies with no fallback:** None that block automated test execution.

**Missing dependencies with fallback:**
- Cloudflare API creds: all real-creds assertions use `it.skip` at PR-time (established pattern in `cross-workspace-pentest.test.ts` Prong C and vitest.config.ts `hasEvalCreds` gate).
- Deployed staging: INT-05 manual half is a milestone-close ritual, not a PR gate.

---

## Validation Architecture

> `workflow.nyquist_validation` is not explicitly `false` in `.planning/config.json` — section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.7 with `@cloudflare/vitest-pool-workers` 0.16.9 |
| Config file | `packages/mcp-server/vitest.config.ts` (multi-project) |
| Quick run command | `npm test --workspace=packages/mcp-server -- --project=workerd` |
| Full suite command | `npm test --workspaces --if-present` |
| Triage-worker tests | `npm test --workspace=packages/triage-worker -- --project=workerd` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INT-01 | Worst-case envelope (10 conflicts + 50 entities + verbosity=synthesis) ≤ 7,500 tokens AND synthesis + high-severity conflicts survive trim | integration | `npm test --workspace=packages/mcp-server -- --project=workerd --testPathPattern=v02-kitchen-sink` | ❌ Wave 0 |
| INT-02 | v0.1 envelope contract preserved; new optional fields (`context.conflicts[]`, `result.synthesis`) have correct shape | unit | `npm test --workspace=packages/mcp-server -- --project=workerd --testPathPattern=envelope` | ✅ (extend in place) |
| INT-03 | 3 mcp-server paths + 1 triage-worker path reject foreign-workspace data | security/integration | `npm test --workspace=packages/mcp-server -- --project=workerd --testPathPattern=cross-workspace-pentest` | ✅ (extend in place) |
| INT-03 (D-10) | Conflict-pipeline routes inbox writes to correct workspace DO | security/unit | `npm test --workspace=packages/triage-worker -- --project=workerd --testPathPattern=conflict-pipeline-isolation` | ❌ Wave 0 |
| INT-04 | v0.2-INTEGRATION-MATRIX.md has zero `pending` rows; each `tested` row points to a real file | gate/grep | `grep -c "pending" .planning/research/v0.2-INTEGRATION-MATRIX.md` | ✅ (file exists; rows all `pending`) |
| INT-05a | Local `wrangler dev` boot of both Workers + programmatic smoke | smoke/e2e | `bash scripts/smoke-wrangler-dev.sh packages/mcp-server/wrangler.jsonc 8787 http local` + `bash scripts/smoke-wrangler-dev.sh packages/triage-worker/wrangler.jsonc 8788 boot local` | ✅ (script exists) |
| INT-05b | Manual staging ritual | manual | — (documented checklist) | — |

### Integration Matrix Coverage Strategy

The validation architecture for a verification phase differs from a feature phase. The integration matrix defines 6 composition paths; the strategy that proves they are covered is:

1. **End-to-end path exercise:** Each matrix row's test MUST call `captureCallback("recall", workspace_id)` and invoke the actual `recall()` handler in `tools.ts` with a fixture designed to trip the specific failure mode. No mocking of `hybridRank`, `generateSynthesis`, or `expandQuery` in matrix tests.

2. **Adversarial fixture design:** Each test uses fixture inputs sized to exercise the real behavior:
   - RNK×CON: score variance between memories to verify conflicts survive sorting
   - EXP×SYN: top1 < 0.65 to trigger fan-out, then ≥ 2 ranked memories to enable synthesis
   - Adaptive-routing×cosine-edge: top1 near 0.64 AND reranker/expansion 429 simultaneously

3. **False-positive risks to guard against:**

   | Risk | Detection | Guard |
   |------|-----------|-------|
   | synthesis=null (SYN-07 fired) means content-preservation assertion vacuously passes | Check `result.synthesis` is non-null before asserting its content | `expect(trimmed.result.synthesis).not.toBeNull()` BEFORE content assertions |
   | Matrix row marked `tested` but test file doesn't exist | `/gsd:verify-work 5` grep gate: `test -f <Test File path>` | D-03 enforcement |
   | Build/types GREEN while live behavior differs | Full workerd pool run (not just TypeScript compile) | `npm test --project=workerd` in CI |
   | ≤8K post-trim check trivially true without content-preservation teeth | Adversarial-proof test (`trimToBudget` must actually trim) | `expect(beforeTokens).toBeGreaterThan(7_500)` before trim assertion |
   | Workspace isolation Prong A passes vacuously (no data seeded) | Positive control: assert legit workspace returns ≥1 memory | Mirror pattern from `cross-workspace-pentest.test.ts` lines 203–207 |

### Sampling Rate

- **Per task commit:** `npm test --workspace=packages/mcp-server -- --project=workerd`
- **Per wave merge:** `npm test --workspaces --if-present` (all packages)
- **Phase gate:** Full suite green before `/gsd:verify-work 5`; `grep -c "pending" .planning/research/v0.2-INTEGRATION-MATRIX.md` returns 0

### Wave 0 Gaps

- [ ] `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` — covers INT-01 + kitchen-sink matrix row
- [ ] `packages/triage-worker/src/__tests__/conflict-pipeline-isolation.test.ts` — covers INT-03 D-10 workspace routing

*(If no gaps: "None — existing test infrastructure covers all phase requirements" — but there are 2 gaps above.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Not in scope for this phase |
| V3 Session Management | no | Not in scope for this phase |
| V4 Access Control | **yes** | `props.workspace_id` → DO routing; `assertOwnsWorkspace`; INT-03 pentest |
| V5 Input Validation | yes (limited) | `RecallInputSchema` zod validation; already tested |
| V6 Cryptography | no | Not in scope for this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace data leak via expanded-query fan-out | Information Disclosure | `vectorizeQuery(env, props.workspace_id, ...)` — namespace locked to props, not args; D-11 assertion |
| Foreign workspace synthesis via forged recall | Information Disclosure | Synthesis input derived from workspace-scoped Vectorize results only; Prong A test |
| Conflict-pipeline write targeting wrong DO | Tampering | `conflictPipeline` routes by `newBlock.workspace_id`; D-10 isolation test |
| Trimming dropping security-relevant fields | Tampering | D-10 invariant: `trimToBudget` NEVER drops `meta` or `context.conflicts`; INT-01 content-preservation assertion |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 2–4 tested features in isolation | Phase 5 proves composed behavior | v0.2 milestone close | Catches cross-feature regressions invisible to isolated tests |
| `recall()` returned lexical hits only | `recall()` composes expand → RRF → rerank → hybridRank → conflicts → synthesis | Phase 2–4 | Single call site covers all 4 v0.2 features |
| `RERANKER_ENABLED = false` (live ablation result) | Reranker disabled; `HYBRID_WEIGHTS.rerank` = raw cosine fallback | Phase 3 live ablation 2026-06-08 | INT tests for reranker path must cover the DISABLED path (raw cosine fills the slot) |

**RERANKER_ENABLED is false.** Confirmed at `tools.ts` line 888 comment: "EXP-07 (live ablation 2026-06-08): the bge-reranker is decisively worse than raw cosine on the labeled corpus (F1@3 0.26 vs 0.46), so RERANKER_ENABLED ships false." INT-03 Prong A for the reranker path must prove isolation in the disabled-reranker context: the `rerankScores` map is never populated, so every `filteredMatch.score` is raw cosine (the `?? m.score` fallback). This does not change the workspace isolation proof — the relevant path is still `filteredMatches` which is already workspace-scoped.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gpt-tokenizer` with `cl100k_base` path is importable in workerd environment | INT-01 Harness Reuse | INT-01 would need a different encoder; LOW risk — already confirmed working by `token-budget.test.ts` which runs in the workerd pool |
| A2 | `buildRecallResponse` accepts a `conflicts` parameter in the v0.2 envelope | INT-01 | Kitchen-sink fixture cannot pass conflicts to builder; MEDIUM risk — confirmed by `tools.ts` line 1046 which passes `conflicts` to `buildRecallResponse` |
| A3 | `RERANKER_ENABLED` is a constant imported from `@engram/ai-config`, currently `false` | INT-03 reranker path | If changed to `true` before Phase 5 executes, the reranker Prong A test context changes; LOW risk — ablation result is documented |

**If this table is near-empty:** All claims above were verified by direct code reading. The risk of any assumption being wrong is LOW.

---

## Open Questions

1. **Should RNK×EXP, EXP×SYN, CON×SYN, and adaptive-routing tests be separate files or folded into `v02-kitchen-sink.test.ts`?**
   - What we know: CONTEXT.md (Claude's Discretion) defaults to `src/__tests__/integration/` and the `v02-kitchen-sink.test.ts` name.
   - What's unclear: Whether a single large file vs 4 separate focused files better satisfies the matrix's "each tested row has a named file" requirement.
   - Recommendation: Create `v02-kitchen-sink.test.ts` as the kitchen-sink test (INT-01 + kitchen-sink row), and use the same file for CON×SYN and EXP×SYN since they are sub-cases of the full kitchen-sink. RNK×CON and RNK×EXP can be separate `describe` blocks in the same file or separate files. Planner's call.

2. **Does the `captureCallback` pattern in kitchen-sink need to mock `safeRun` for synthesis, or does the AI mock already handle it?**
   - What we know: `recall-conflicts.test.ts` patches `env.AI` in `beforeAll` to return a mock vector. The `tools-integration.test.ts` at line 102 uses `return { data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] }` for embed calls AND `return { response: "Mock synthesis." }` for synthesis calls — a single mock handles both because `safeRun` dispatch is on the model name.
   - What's unclear: Whether the kitchen-sink test can reuse the same single-mock approach and still get a non-null synthesis string.
   - Recommendation: Mirror the `tools-integration.test.ts` approach — mock `env.AI.run` to return `{ response: "Mock synthesis." }` for synthesis calls (by distinguishing embed responses via the `data` key vs `response` key).

---

## Sources

### Primary (HIGH confidence)
- `packages/mcp-server/src/__tests__/token-budget.test.ts` — cl100k_base import, buildWorstCaseMemories, trimToBudget assertion shape, ≤7,500 pattern
- `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — captureCallback pattern, insertConflictAsInbox pattern, CON-05 coverage scope
- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — Prong A/B/C patterns, `runInDurableObject` forge-arg, `it.skip` real-creds gating
- `packages/mcp-server/src/__tests__/envelope.test.ts` + snapshot — v0.1 envelope contract assertions, META_GAPS contents
- `packages/mcp-server/src/tools.ts` — recall() composition chain, RERANKER_ENABLED=false, EXP-03 adaptive gate, CON-05 conflict hydration
- `packages/mcp-server/vitest.config.ts` — project names, pool assignments, hasEvalCreds gate
- `packages/triage-worker/src/conflict-pipeline.ts` — workspace_id routing pattern (idFromName call)
- `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` — existing coverage scope, makeWorkspaceStub pattern
- `.planning/research/v0.2-INTEGRATION-MATRIX.md` — matrix rows, status vocabulary, closure rule
- `.planning/REQUIREMENTS.md` lines 76–80 — INT-01..INT-05 verbatim requirements
- `packages/mcp-server/wrangler.jsonc` + `packages/triage-worker/wrangler.jsonc` — staging environment absence confirmed
- `scripts/smoke-wrangler-dev.sh` — INT-05 local smoke infrastructure

### Secondary (MEDIUM confidence)
- `.planning/phases/05-integration-kitchen-sink/05-CONTEXT.md` — locked decisions D-01..D-11, Phase boundary constraints
- `packages/mcp-server/src/__tests__/recall.test.ts` — EXP-03/EXP-10 coverage scope for matrix gap analysis

---

## Metadata

**Confidence breakdown:**
- Matrix audit: HIGH — based on direct code reading of all relevant test files and tools.ts
- Standard Stack: HIGH — existing harness verified; no new packages needed
- Architecture: HIGH — composition chain read directly from tools.ts
- Pitfalls: HIGH — derived from actual test patterns + gaps identified by direct audit
- INT-05 staging: HIGH — wrangler configs read directly; absence is certain

**Research date:** 2026-06-10
**Valid until:** 2026-06-24 (stable — no external dependencies; only valid if tools.ts recall() composition chain is not modified)
