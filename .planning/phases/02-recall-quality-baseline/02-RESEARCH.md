# Phase 2: Recall Quality Baseline - Research

**Researched:** 2026-06-05
**Domain:** Hybrid-rank weight tuning (mcp-server) + conflict-detection wiring (triage-worker) on Cloudflare Workers (TypeScript, Workers AI, Vectorize, Durable Objects)
**Confidence:** HIGH for standard stack (existing codebase patterns); HIGH for Vectorize semantics (Context7 + official docs); HIGH for grid-sweep math; MEDIUM for `p-limit`/bounded-parallel choice on workerd (no current usage in repo — inferred shape); MEDIUM for `writeDataPoint` behavior under `waitUntil` (Cloudflare docs ambiguous about timing).

## Summary

Phase 2 is dependency-ordered execution of two parallel-trackable workstreams (RNK → CON in commit order) under a 16-decision CONTEXT.md lock. Most of the **what** is decided; this research targets the **how** of the seven gaps CONTEXT.md leaves open — grid-sweep test runtime, Pareto+sensitivity code structure, the new `shared/vectorize-utils` package shape, conflict-precision metric definition, bounded-parallel conflict orchestration, the `EngramResponse.context.conflicts[]` SQL-join wiring, cf-code-assist routing additions, and the Nyquist validation architecture.

Three findings drive the plan structure:
1. **Embedding caching is the only way the 625-config sweep fits the MAX_AI_CALLS=200 budget.** Weights only affect post-Vectorize re-ranking math, not embeddings or Vectorize calls. Compute corpus embeddings + Vectorize matches ONCE per query (~100 AI calls + 100 Vectorize calls), then iterate 625 configs as pure-math reranking in memory.
2. **Vectorize does NOT support a score floor at query time** (Context7 verified — `query()` accepts `topK`, `filter`, `returnValues`, `returnMetadata` but no `minScore`). The ≥0.7 cosine floor for `vectorizeNeighbors` MUST be client-side filtering after over-fetch — matches the v0.1 `MIN_COSINE_THRESHOLD=0.6` pattern in `tools.ts:574-576`.
3. **`writeDataPoint` is documented as non-blocking and sampled.** Calling it inside `ctx.waitUntil()` (the conflict-pipeline branch) is the established Engram pattern (Phase 5 AI-04) and won't pin the lifetime guarantee.

**Primary recommendation:** Plan as 9–11 plans: RNK is 5 plans (corpus-sync → vectorize-utils extraction → sweep test scaffold → run-sweep-and-commit-weights → changelog-and-baseline), CON is 5–6 plans (CON-01 gate → conflict-pipeline scaffold → triage-worker wiring → workspace-do insertConflictAsInbox helper + insertConflict surfacing in recall → analytics observability → integration matrix updates). RNK lands before CON in main commit order per D-16.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Grid-sweep eval (625 configs × 100 queries) | Test runtime (workerd via `vitest-pool-workers`, `eval` project) | — | Reuses Phase 1 PRE-02 eval-tier; runs against real CF bindings with MAX_AI_CALLS=200 guard. |
| Embedding + Vectorize calls during sweep | API/Backend (Workers AI + Vectorize bindings) | Test runtime cache (in-memory Map) | Embeddings depend on query string only; cache amortizes the 200-call budget. |
| Pure-math reranking (per config) | Test runtime (in-process JS) | — | No I/O, no AI — `hybridRank` formula application only. |
| `HYBRID_WEIGHTS` literal | Shared config package (`shared/ai-config`) | mcp-server (consumer) | Single source of truth for both Workers per ENG-25 convention. |
| `vectorizeNeighbors` / `vectorizeQuery` | Shared package (`shared/vectorize-utils`) | mcp-server (recall) + triage-worker (conflict prefilter) | Both Workers need the helper; extracting avoids cross-package dep. |
| Conflict orchestration (`conflict-pipeline.ts`) | triage-worker (Queue consumer hot path) | WorkspaceDO RPC (writes) + Vectorize (reads) | Runs in `ctx.waitUntil()` after `updateBlockEnrichment`. |
| `detectConflict()` inference | Workers AI binding | — | Pure inference call; no side effects (per ENG-16 contract). |
| `insertConflictAsInbox` RPC | WorkspaceDO (writes to `inbox` table) | triage-worker (caller via cross-Worker `WORKSPACE` binding) | DO owns SQLite; cross-Worker DO binding pattern from Phase 1. |
| `EngramResponse.context.conflicts[]` population | mcp-server `buildRecallResponse` (consumer) | WorkspaceDO new read helper (`listInboxConflictsForMemoryIds`) | Read-side SQL join on `inbox` table; recall envelope is read-only. |
| Observability (Analytics Engine) | triage-worker (write site) | `scripts/eval-budget-summary.mjs` (read side / GraphQL) | Existing `ANALYTICS` binding already declared in `wrangler.jsonc`. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

Copied verbatim from `.planning/phases/02-recall-quality-baseline/02-CONTEXT.md` `<decisions>` section. Planner MUST honor each:

- **D-01:** 5-value grid symmetric around v0.1 defaults; 625 configs total: `cosine ∈ {0.6, 0.8, 1.0, 1.2, 1.5}`, `recency ∈ {0.05, 0.10, 0.15, 0.20, 0.30}`, `type_match ∈ {0.10, 0.15, 0.20, 0.25, 0.35}`, `scope_match ∈ {0.05, 0.10, 0.15, 0.20, 0.30}`.
- **D-02:** RNK-04 sensitivity analysis reuses sweep output (adjacent grid neighbors = ±0.05 perturbations).
- **D-03:** Top-3 by F1 re-scored by MRR + top-1 accuracy on train split; Pareto front decides winner. F1-only selection forbidden.
- **D-04:** Convergence gate strict `< 10pp` (0.85 train / 0.76 validate = 9pp pass; 0.85 / 0.75 = 10pp fail). REJECT in boundary cases.
- **D-05:** Rename `HYBRID_WEIGHTS.cosine` → `HYBRID_WEIGHTS.rerank` NOW in Phase 2.
- **D-06:** MANDATORY audit comment in `shared/ai-config/src/index.ts` next to `HYBRID_WEIGHTS` (full verbatim text in CONTEXT.md).
- **D-07:** `packages/mcp-server/src/hybrid-rank.ts` formula stays structurally identical; only the weight-key reference renames. `match.score` (raw cosine) feeds `w_rerank` in v0.2.
- **D-08:** New shared package `shared/vectorize-utils/` exports BOTH `vectorizeNeighbors(...)` AND `vectorizeQuery(...)`.
- **D-09:** Phase 2 RNK workstream owns the extraction + recall-path import swap.
- **D-10:** Both helpers identical return shape; `{ workspace_id }` filter MANDATORY; `{ type, scope }` optional + `$in` stacked.
- **D-11:** `.planning/evals/recall-corpus.json` is the authoritative editing surface.
- **D-12:** Phase 2 vendors a copy into `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json`.
- **D-13:** New `scripts/sync-eval-corpus.mjs` copies authoritative → vendored; `pretest:eval` npm script wires it.
- **D-14:** Existing `real-corpus.json` (27 entries) + `reference-corpus.json` (20 entries) STAY. `recall-f1.eval.test.ts` becomes the RNK-06 baseline-regression check.
- **D-15:** RNK-06 gate satisfied by BOTH (a) sweep-winner F1 on 100-entry ≥ 0.8254 AND (b) sweep-winner weights re-scored on 27-entry ≥ 0.8254.
- **D-16:** RNK lands in main BEFORE CON. Merge-to-main serialized.
- **D-17:** Two Linear sub-issues under Phase 2 ENG issue (RNK + CON).
- **D-18:** CON-01 failure procedure = STOP + Linear blocker + `--replan-section conflict-prompt`.
- **D-19:** Phase 2 cf-code-assist routing tracker at `02-CF-CODE-ASSIST-USAGE.md` follows Phase 1 PRE-05 pattern.
- **D-20:** Conflict-pipeline observability via Analytics Engine `writeDataPoint`. Schema: `blobs[0]="conflict-pipeline"`, `blobs[1]=<verdict>`, `doubles[0]=latency_ms`, `doubles[1]=neighbors_examined`.
- **D-21:** `docs/hybrid-rank-changelog.md` row schema spelled out in CONTEXT.md.

### Claude's Discretion

Copied verbatim from CONTEXT.md `### Claude's Discretion`:

- Sweep test parallelization strategy (sequential vs `Promise.all` chunks — bounded by MAX_AI_CALLS=200 budget)
- Exact data structure for Pareto-front result (TS interface details, JSON serialization)
- `recall-ranking.eval.test.ts` test naming + describe block structure
- `vectorizeNeighbors` internal implementation (native `topK` + filter vs loop+filter — whichever resolves cleaner)
- Local variable rename inside `hybrid-rank.ts` (e.g., `cosineScore` → `rerankScore`)
- Conflict-pipeline source-file organization (one file with three named functions vs three files)

### Deferred Ideas (OUT OF SCOPE)

Copied verbatim from CONTEXT.md `<deferred>`:

- Conflict notifications / digest emails / Slack pings (v0.4 + PITFALLS CD-1 forbid)
- `conflict()` MCP tool (v0.3)
- bge-reranker actual invocation (Phase 3 EXP-06; the key NAME lands in Phase 2 only)
- Multi-query expansion + RRF (Phase 3)
- Synthesis path activation (Phase 4)
- v0.3 re-tune of HYBRID_WEIGHTS
- Inbox UI (v0.4)
- Verbosity-default flip (v0.3)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RNK-01 | `recall-ranking.eval.test.ts` grid search 625 configs against PRE-03 corpus | §Grid-Sweep Architecture (cache embeddings + Vectorize, iterate weights in-process) |
| RNK-02 | Top-3 by F1 re-scored by MRR + top-1 → Pareto front | §Pareto-Front Computation + §Metric Definitions |
| RNK-03 | Winner passes 30% validate with train→validate F1 gap < 10pp | §Train/Validate Split + D-04 strict-boundary rule |
| RNK-04 | ±0.05 sensitivity: rank-order change in <30% of queries | §Sensitivity Analysis — Kendall tau approach |
| RNK-05 | Tuned weights written to `shared/ai-config/src/index.ts` with audit comment | D-06 verbatim comment text |
| RNK-06 | F1 ≥ v0.1 baseline (0.8254 on 27-entry corpus); MRR ≥ baseline | §Baseline Regression Strategy + D-15 dual gate |
| RNK-07 | `docs/hybrid-rank-changelog.md` records v0.2 sweep + small-N caveat | §Changelog Row Schema (D-21 columns) |
| CON-01 | 30-pair eval precision ≥ 0.85 AND recall ≥ 0.90 before wiring | §Conflict-Precision Metric Definition + D-18 failure procedure |
| CON-02 | `conflict-pipeline.ts` orchestrates cosine-prefilter → parallel `detectConflict()` → inbox writes | §Bounded-Parallel Pattern + §Conflict-Pipeline Orchestration |
| CON-03 | `ctx.waitUntil(conflictPipeline(...))` in `store-normal` branch after `updateBlockEnrichment` | §Existing waitUntil Pattern (mcp-server `tools.ts:448-474`) |
| CON-04 | Inbox writes with `proposed_type="conflict"`, `proposed_properties = {memory_a_id, memory_b_id, category, ai_confidence, description}` | §insertConflictAsInbox RPC Shape |
| CON-05 | `EngramResponse.context.conflicts[]` SQL-join surfacing inbox conflicts | §Recall Envelope Wiring + §New Read Helper |
| CON-06 | Cosine ≥ 0.92 dupe skip; `created_at` diff > 180 days → `severity="low"` | §Cosine-Ceiling + §Time-Blind Conflict Mitigation (PITFALLS CD-4, CD-5) |
| CON-07 | Per-write budget = 3 conflict calls; p99 < 4s async | §Latency Budget Verification — GraphQL nightly summary |
| CON-08 | No proactive notifications anywhere | Architectural lock — confirmed via canonical refs |

## Standard Stack

### Core (already in repo — Phase 2 modifies / extends)

| Library / Module | Version | Purpose | Why Standard |
|---|---|---|---|
| `vitest` + `@cloudflare/vitest-pool-workers` | as per PRE-02 | Eval-tier test runtime, real CF bindings | Phase 1 PRE-02 locked the tiering pattern; eval project owns sweep |
| `zod` (v4) | as per ENG-25 | Conflict-output schema + JSON-mode response_format | Already in conflict-detection.ts; `z.toJSONSchema()` works around `propertyNames` gotcha via `sanitizeJsonSchemaForWorkersAI` |
| Workers AI binding (`env.AI.run`) | n/a — Cloudflare native | Embedding (`@cf/qwen/qwen3-embedding-0.6b`) + `detectConflict` (Llama 4 Scout) | Locked since ENG-25 |
| Vectorize binding (`env.VECTORIZE`) | n/a — Cloudflare native | Cosine neighbor search; no score floor (client-side filter required) | Index dims = 1024 (qwen3 locked) |
| Analytics Engine binding (`env.ANALYTICS`) | n/a — Cloudflare native | `writeDataPoint` for conflict-pipeline telemetry (D-20) | Triage-worker binding already declared in `wrangler.jsonc:27`; activation only |
| `@engram/ai-config` | workspace v0.1.0 | `HYBRID_WEIGHTS`, `MIN_COSINE_THRESHOLD`, `VECTORIZE_OVERFETCH_FACTOR` | Single source of truth (ENG-25) |
| `@engram/types` | workspace v0.1.0 | `Conflict`, `EngramResponse<T>`, `MemoryEvent` | Already declares `context.conflicts?: Conflict[]` (no shape change in Phase 2) |
| `@engram/workspace-do` | workspace v0.1.0 | DO RPC surface; new `insertConflictAsInbox` + new read helper for recall join | Existing `createInboxEntry` is the pattern (`queries.ts:480`) |

### New artifacts Phase 2 introduces (no external dependencies)

| Artifact | Location | Purpose |
|---|---|---|
| `shared/vectorize-utils/` package | new workspace top-level package | Exports `vectorizeNeighbors` + `vectorizeQuery` (extracted from mcp-server) |
| `scripts/sync-eval-corpus.mjs` | repo root | Copy `.planning/evals/recall-corpus.json` → `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` |
| `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` | vendored fixture | Sync target; top-of-file comment marks it auto-synced |
| `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | new eval test | 625-config sweep, Pareto front, sensitivity analysis |
| `packages/triage-worker/src/conflict-pipeline.ts` | new triage source | Orchestration: prefilter → parallel `detectConflict()` → inbox writes + analytics |
| `docs/hybrid-rank-changelog.md` | new doc | Append-only changelog (one row per tune) |
| `02-CF-CODE-ASSIST-USAGE.md` | new tracker | Phase 2 routing log (mirrors Phase 1 pattern) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| In-memory caching of embeddings + Vectorize matches for sweep | Vectorize-side cache | Vectorize has no caching API; would re-bill every Vectorize op. In-process cache is free and bounded by test process lifetime. |
| Hand-rolled Pareto front (~15 LOC TS helper) | npm `pareto-frontier` package | Slopcheck unavailable; package is small but adds dependency. Hand-rolled is 2D/3D over 3 metrics — trivial. Skip the dep. |
| `p-limit` (npm) for bounded-parallel `detectConflict()` calls | Hand-rolled chunked `Promise.all` | `p-limit` has zero runtime deps and works on workerd, BUT per CON-07 the per-write budget is 3 — `Promise.all` over an array of 3 is the natural shape. No concurrency limit needed *within* one ingest; the budget already caps it. **Skip `p-limit`.** |
| Native Vectorize score floor | Client-side `.filter(m => m.score >= 0.7)` | Vectorize has NO native score floor (Context7 confirmed). Client-side filter is the only option. Matches existing v0.1 pattern at `tools.ts:574-576`. |
| New Queue stage for conflict scanning | `ctx.waitUntil()` per-write | CONTEXT.md D-02 already locks `ctx.waitUntil` — no separate queue in v0.2 (queue introduces in v0.4 per "Out of Scope"). |
| Kendall tau (rank correlation) for sensitivity | Mean absolute rank shift / position-flip rate | Kendall tau is the canonical rank-stability metric for IR. Compute per-query, threshold at <30% queries with tau < 0.8 (or equivalent — pick threshold from sensitivity-analysis design below). |

**Installation:** No new npm packages introduced. All work uses existing dependencies.

**Version verification:** Not applicable — Phase 2 introduces zero new external packages per ROADMAP §"v0.2 Milestone-Level Risk Notes" ("Vendor lock-in risk: None new. v0.2 introduces zero new npm dependencies and zero Vectorize index changes.").

## Package Legitimacy Audit

Phase 2 installs **zero new external packages**. All work uses existing dependencies vetted in v0.1 + Phase 1.

| Package | Registry | Age | Disposition |
|---|---|---|---|
| (none — Phase 2 adds no new deps) | — | — | n/a |

The slopcheck protocol is N/A for this phase. No `npm install` step appears in the recommended plan structure.

## Architecture Patterns

### System Architecture Diagram

```text
                                                       ┌────────────────────────────────┐
                                                       │  .planning/evals/              │
                                                       │   recall-corpus.json           │
RNK Workstream (mcp-server + ai-config)                │   (100 entries, 70/30 split)   │
                                                       │   AUTHORITATIVE                │
                                                       └────────────────┬───────────────┘
                                                                        │
                                       scripts/sync-eval-corpus.mjs     │
                                       (npm pretest:eval)               │
                                                                        ▼
                                                       ┌────────────────────────────────┐
                                                       │  packages/mcp-server/src/      │
                                                       │   __tests__/evals/fixtures/    │
                                                       │   recall-corpus-v2.json        │
                                                       │   (auto-synced; comment'd)     │
                                                       └────────────────┬───────────────┘
                                                                        │
   ┌─────────────────────────────────────┐                              ▼
   │ shared/vectorize-utils/             │                ┌─────────────────────────────────┐
   │  - vectorizeQuery (extracted)       │ ◄──────────── │  recall-ranking.eval.test.ts    │
   │  - vectorizeNeighbors (NEW)         │   import       │  Step 1: embed each query once  │
   │  Both filter on workspace_id        │                │  Step 2: Vectorize once / query │
   │  Both stack {type,scope} as $in     │                │  Step 3: hydrate blocks once    │
   └─────────────────┬───────────────────┘                │  Step 4: 625-config sweep —     │
                     │                                    │           PURE-MATH reranking    │
                     │                                    │  Step 5: F1/MRR/top1 per config │
                     ▼                                    │  Step 6: Pareto-3 (F1/MRR/top1) │
   ┌─────────────────────────────────────┐                │  Step 7: ±0.05 sensitivity      │
   │ packages/mcp-server/src/tools.ts    │                │           (reuse grid neighbors)│
   │  recall() handler                   │                │  Step 8: train/validate gap     │
   │   imports vectorizeQuery from       │                │  Step 9: write winner →         │
   │   shared/vectorize-utils (D-09)     │                │           HYBRID_WEIGHTS +      │
   └─────────────────────────────────────┘                │           hybrid-rank-changelog │
                                                          └─────────────────────────────────┘

CON Workstream (triage-worker + workspace-do RPC + mcp-server recall envelope)

  ┌─────────────────────────────────────┐
  │ triage-worker queue consumer        │  store-normal branch (index.ts:214-242)
  │ extractAndScore → memorability       │
  │ → updateBlockEnrichment              │
  │ → ctx.waitUntil(conflictPipeline(…)) │  ── CON-03 surgical insertion
  └─────────────────┬───────────────────┘
                    │
                    ▼
  ┌─────────────────────────────────────┐
  │ conflict-pipeline.ts (NEW)           │
  │ ┌────────────────────────────────┐  │
  │ │ Step 1: cosine prefilter       │  │  vectorizeNeighbors(env, workspace_id,
  │ │  topK=3 same-type same-ws ≥0.7 │  │    new-block-vector,
  │ └────────────┬───────────────────┘  │    { topK:3, type, scope, threshold:0.7 })
  │              │                       │
  │ ┌────────────▼───────────────────┐  │
  │ │ Step 2: cosine-ceiling dedup   │  │  drop pairs where cosine ≥ 0.92
  │ │  (CON-06, PITFALLS CD-4)        │  │  (these are dupes, not conflicts)
  │ └────────────┬───────────────────┘  │
  │              │                       │
  │ ┌────────────▼───────────────────┐  │
  │ │ Step 3: Promise.all over ≤3    │  │  detectConflict(env, new-content, neighbor-content)
  │ │  parallel detectConflict() calls│  │  budget=3 per write (CON-07)
  │ └────────────┬───────────────────┘  │
  │              │                       │
  │ ┌────────────▼───────────────────┐  │
  │ │ Step 4: for category=          │  │  call WorkspaceDO RPC:
  │ │  "contradiction" → inbox write │  │    insertConflictAsInbox({memory_a_id,
  │ │  (CON-04 inbox shape)           │  │       memory_b_id, category,
  │ └────────────┬───────────────────┘  │       ai_confidence, description})
  │              │                       │  CON-06 severity: 180d → "low"
  │ ┌────────────▼───────────────────┐  │
  │ │ Step 5: writeAnalytics()       │  │  blobs[0]="conflict-pipeline"
  │ │  (D-20 telemetry)               │  │  blobs[1]=verdict
  │ └────────────────────────────────┘  │  doubles[0]=latency_ms
  └─────────────────┬───────────────────┘  doubles[1]=neighbors_examined
                    │
                    ▼ (writes flow to inbox table via WorkspaceDO RPC)
  ┌─────────────────────────────────────┐
  │ WorkspaceDO SQLite                  │
  │   inbox table                       │
  │   proposed_type="conflict"          │  ← CON-04
  │   proposed_properties={…}            │
  │   id = "conflict-" + nanoid()        │  (NOT a block id; new namespace)
  └─────────────────┬───────────────────┘
                    │
                    │ Read side: mcp-server recall() handler
                    ▼
  ┌─────────────────────────────────────┐
  │ buildRecallResponse(…)              │
  │  ┌──────────────────────────────┐   │
  │  │ NEW: SQL join inbox where    │   │  CON-05
  │  │  proposed_type='conflict'    │   │  new helper: listInboxConflictsForMemoryIds(
  │  │  AND (memory_a_id ∈ recall_ids│  │     sql, ids: string[]
  │  │       OR memory_b_id ∈ ids)  │   │  ) on WorkspaceDO
  │  └──────────────┬───────────────┘   │
  │                 │                    │
  │  envelope.context.conflicts = mapped │
  └─────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owner | Responsibility |
|---|---|---|
| `shared/vectorize-utils/src/index.ts` | new package | Export `vectorizeQuery`, `vectorizeNeighbors`. Mandatory `workspace_id` namespace; client-side cosine threshold filter for `vectorizeNeighbors`. |
| `packages/mcp-server/src/tools.ts` (recall) | mcp-server | Swap import from `./vectorize-helper.js` to `@engram/vectorize-utils`. Wire new conflicts-read helper into `buildRecallResponse`. |
| `packages/mcp-server/src/hybrid-rank.ts` | mcp-server | Variable rename only (`cosine` ref → `rerank` ref). Formula unchanged. |
| `shared/ai-config/src/index.ts` | shared-config | Rename `HYBRID_WEIGHTS.cosine` → `HYBRID_WEIGHTS.rerank`; commit tuned values; insert D-06 audit comment. |
| `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | mcp-server | 625-config sweep, Pareto front, sensitivity, train/validate split. |
| `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | mcp-server | UNCHANGED contract; becomes RNK-06 baseline check (D-14). |
| `packages/triage-worker/src/conflict-pipeline.ts` | triage-worker | Orchestrate prefilter, parallel detect, inbox writes, analytics. |
| `packages/triage-worker/src/index.ts` | triage-worker | Single-line `ctx.waitUntil(conflictPipeline(…))` after `updateBlockEnrichment`. |
| `packages/workspace-do/src/queries.ts` | workspace-do | Add `insertConflictAsInbox(sql, …)` (write); add `listInboxConflictsForMemoryIds(sql, ids)` (read). |
| `packages/workspace-do/src/index.ts` (DO class) | workspace-do | Expose RPC methods wrapping the two new query helpers. |
| `docs/hybrid-rank-changelog.md` | repo docs | First row schema per D-21. |
| `02-CF-CODE-ASSIST-USAGE.md` | tracker | Per-task routing decisions. |
| `scripts/eval-budget-summary.mjs` | scripts (extend) | Add conflict-pipeline p99 latency aggregator from D-20 analytics points. |

### Recommended Project Structure (changes only)

```text
engram/
├── shared/
│   └── vectorize-utils/             # NEW (D-08)
│       ├── package.json             # mirrors shared/ai-config/package.json shape
│       ├── tsconfig.json            # extends ../../tsconfig.base.json
│       └── src/
│           └── index.ts             # exports vectorizeQuery + vectorizeNeighbors
├── scripts/
│   ├── sync-eval-corpus.mjs         # NEW (D-13)
│   └── eval-budget-summary.mjs      # EXTEND for CON-07 p99 (D-20)
├── docs/
│   └── hybrid-rank-changelog.md     # NEW (D-21)
├── packages/
│   ├── mcp-server/
│   │   ├── package.json             # add "pretest:eval": "node ../../scripts/sync-eval-corpus.mjs" + add @engram/vectorize-utils dep
│   │   └── src/
│   │       ├── tools.ts             # MODIFY: import swap (D-09) + CON-05 envelope wiring
│   │       ├── hybrid-rank.ts       # MODIFY: var rename (D-07) — formula structurally identical
│   │       └── __tests__/evals/
│   │           ├── recall-f1.eval.test.ts        # UNCHANGED (now RNK-06 baseline check)
│   │           ├── recall-ranking.eval.test.ts   # NEW — 625-config sweep
│   │           └── fixtures/
│   │               └── recall-corpus-v2.json     # NEW — auto-synced
│   ├── triage-worker/
│   │   ├── package.json             # add @engram/vectorize-utils dep
│   │   └── src/
│   │       ├── index.ts             # MODIFY: ctx.waitUntil(conflictPipeline(…)) (CON-03)
│   │       ├── conflict-pipeline.ts # NEW (CON-02)
│   │       └── __tests__/evals/
│   │           └── conflict-precision.eval.test.ts  # UNSKIP + run (CON-01)
│   └── workspace-do/
│       └── src/
│           ├── queries.ts           # MODIFY: + insertConflictAsInbox + listInboxConflictsForMemoryIds
│           └── index.ts             # MODIFY: + RPC methods
└── shared/ai-config/
    └── src/
        └── index.ts                 # MODIFY: HYBRID_WEIGHTS.cosine → rerank + audit comment (D-06)
```

### Pattern 1: Grid-Sweep with Embedding Cache (RNK-01)

**What:** Decouple "AI/Vectorize calls per query" from "weight configs evaluated."

**When to use:** Any grid-search that varies *only* post-retrieval reranking math (here: 4 weights, 5 values each, 625 configs).

**Math:**
- Naïve cost: 625 configs × 100 queries × (1 embed + 1 Vectorize + ~25 hydrations) = 625 × 100 = 62,500 AI calls + 62,500 Vectorize calls. **Blows MAX_AI_CALLS=200 by 312×.**
- Cached cost: 100 queries × (1 embed + 1 Vectorize) = **200 calls total**, exactly at the budget cap. The 625 configs only re-run `hybridRank(matches, blocks, args)` in-process — pure math, zero billing.
- 200 calls assumes one Workers AI embed per query AND one Vectorize call per query. To stay safely under (allow some retries), Plan must **disable per-iteration eval-budget consumption** — confirmed via re-read of `eval-budget.setup.ts:88-110`, every `env.AI.run` AND every `env.VECTORIZE.query` increments the shared counter. The sweep test MUST call these exactly **once per query**, no exceptions.

**Reference shape (in-test pseudocode):**

```typescript
// Source: derived from packages/mcp-server/src/tools.ts:530-596 recall handler shape
// and packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:131-225

interface QueryFixture {
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
}

interface QueryResolution {
  embedding: number[];
  matches: VectorizeMatches["matches"];
  blocks: LexicalSearchHit[];
}

// Step 1: pre-resolve every query EXACTLY ONCE.
const resolutions = new Map<string, QueryResolution>();
for (const entry of corpus.entries) {
  const embed = await env.AI.run(EMBEDDING_MODEL, { text: [entry.query] });
  const queryVec = embed.data[0];
  const result = await vectorizeQuery(env, workspace_id, queryVec, {
    topK: 25 * VECTORIZE_OVERFETCH_FACTOR,
    returnMetadata: "all",
  });
  const filtered = result.matches.filter(m => m.score >= MIN_COSINE_THRESHOLD).slice(0, 25);
  const blocks = await stub.getBlocksByIds({ workspace_id, ids: filtered.map(m => m.id) });
  resolutions.set(entry.id, { embedding: queryVec, matches: filtered, blocks });
}
// ↑ ~100 AI calls + ~100 Vectorize calls. Within MAX_AI_CALLS=200 budget.

// Step 2: enumerate 625 configs (pure-math reranking).
const grid = enumerateGrid(); // 4 axes × 5 values = 625
const sweepResults: SweepResult[] = [];
for (const config of grid) {
  // Temporarily override weights — hybridRank reads HYBRID_WEIGHTS from module scope.
  // BLOCKER: HYBRID_WEIGHTS is `as const` — can't reassign. Two options:
  //   A. Refactor hybridRank to take weights as parameter (cleaner but contract change)
  //   B. Inline the formula in the sweep test (duplicates 5 lines, no contract impact)
  // RECOMMEND: Option A as a "Phase 2 Plan 02-X: parameterize hybridRank for sweep"
  //   prerequisite. It's a no-op change to production code paths (defaults preserved)
  //   and avoids formula duplication in the test.
  const perQuery: PerQueryMetric[] = [];
  for (const entry of corpus.entries) {
    const res = resolutions.get(entry.id)!;
    const ranked = hybridRankWithWeights(res.matches, res.blocks, args, now, config);
    const top1Hit = ranked[0]?.id && entry.expected_top_3_block_ids.includes(ranked[0].id);
    const top3Hits = ranked.slice(0, 3).filter(r => entry.expected_top_3_block_ids.includes(r.id));
    // F1, MRR, top1 computed from ranked vs expected
    perQuery.push({ entry, ranked, top1Hit, top3Hits, reciprocalRank: rrOf(ranked, entry) });
  }
  sweepResults.push(computeMetrics(config, perQuery));
}
// 625 × ~100 = 62,500 pure-math iterations. Negligible runtime.

// Step 3: Pareto top-3, sensitivity, train/validate split — all from sweepResults.
```

**Open question for plan:** parameterize `hybridRank` to take weights, or inline formula in sweep test? **Recommendation: parameterize**, with `HYBRID_WEIGHTS` as the default. Single source of truth, no formula duplication.

### Pattern 2: Pareto-Front Computation (RNK-02)

**What:** From the 625-row sweep result, select top-3 configs by F1, then among those find the Pareto front over (F1, MRR, top-1).

**Math (3D Pareto front, 3 candidates):**

```typescript
interface SweepResult {
  config: HybridWeights;
  f1_train: number;
  f1_validate: number;
  mrr_train: number;
  top1_train: number;
}

function paretoFront(candidates: SweepResult[]): SweepResult[] {
  return candidates.filter(c =>
    !candidates.some(other =>
      other !== c &&
      other.f1_train >= c.f1_train &&
      other.mrr_train >= c.mrr_train &&
      other.top1_train >= c.top1_train &&
      (other.f1_train > c.f1_train ||
       other.mrr_train > c.mrr_train ||
       other.top1_train > c.top1_train)
    )
  );
}

// Selection rule per D-03:
// 1. Sort all 625 by f1_train DESC, take top-3
// 2. Compute Pareto front over (f1, mrr, top1) from those 3
// 3. If Pareto front has 1 winner → winner.
// 4. If Pareto front has multiple (no dominator) → tiebreak by MRR.
//    (Document this tiebreak explicitly in the test code AND in the changelog row.)
```

For 3 candidates the Pareto check is trivially O(N²). No external dep needed.

### Pattern 3: Sensitivity Analysis Reusing Grid Neighbors (RNK-04, D-02)

**What:** For the winning config `W = {rerank: w_r, recency: w_re, type: w_t, scope: w_s}`, check whether perturbing each weight by ±0.05 changes the per-query top-3 rank order in <30% of queries.

**Why D-02 saves work:** the 5-value grid is symmetric, ±0.05 IS a grid neighbor for `recency`, `type_match`, `scope_match` (all 5-value-axes with 0.05 steps). For `cosine` the steps are 0.2 — so ±0.05 is NOT a grid neighbor for the cosine axis. **Decision required by planner**: do we sensitivity-analyze the `rerank` axis at ±0.05 anyway (re-running hybridRank with fresh weights — still pure-math, no AI cost), or accept that the `rerank` sensitivity check is implicit at ±0.2 (grid step)? **Recommendation: explicit ±0.05 even for `rerank`**, since the per-query rerank-stability is exactly what HR-3 is concerned about. ±0.05 explicit perturbation = 8 neighbor configs per winner (4 axes × 2 directions), each a pure-math re-run.

**Per-query rank-stability metric (Kendall tau on top-3):**

```typescript
// For each query: rank order under W = [id_1, id_2, id_3] (top-3 of full ranked list)
// Rank order under W' (perturbed): [id_1', id_2', id_3']
// Compute Kendall tau between the two ordered lists.
// "Rank order changed" = tau < 1.0 (any swap).
// Threshold: <30% of queries have tau < 1.0.
//
// Alternative simpler metric: position_flip_rate
//   = count(query where top1(W) !== top1(W')) / total queries
//   Plan can choose either; document the choice in the changelog row.
```

**Recommendation:** Start with `top1_flip_rate` (simpler, more interpretable). If the math doesn't tell a clear story, escalate to Kendall tau over top-3. Document the choice in `docs/hybrid-rank-changelog.md` under the `sensitivity_pass_rate` column.

### Pattern 4: `shared/vectorize-utils/` Package Shape (D-08)

**What:** New workspace package mirroring `shared/ai-config/` structure verbatim.

**Files (5):**

```text
shared/vectorize-utils/
├── package.json     # mirrors shared/ai-config/package.json
├── tsconfig.json    # mirrors shared/ai-config/tsconfig.json
└── src/
    └── index.ts     # exports both helpers
```

**`package.json` (verified shape — matches `shared/ai-config/package.json` verbatim):**

```json
{
  "name": "@engram/vectorize-utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "files": ["src"]
}
```

**`tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

**`src/index.ts` (sketched contracts — implementation details under Claude's Discretion per CONTEXT.md):**

```typescript
// vectorizeQuery — EXTRACTED VERBATIM from packages/mcp-server/src/vectorize-helper.ts
// lines 78-99. Preserves: assertNamespace 64-byte guard, topK default 25,
// returnMetadata default "all", filter pass-through. NO BEHAVIOR CHANGE.

export function vectorizeQuery(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: {
    topK?: number;
    filter?: Record<string, unknown>;
    returnMetadata?: "none" | "indexed" | "all";
  },
): Promise<VectorizeMatches> { /* unchanged from current vectorize-helper.ts */ }

// vectorizeNeighbors — NEW (CON-02 prefilter).
// Contract:
//   - workspaceId is MANDATORY (cross-workspace isolation per D-10).
//   - opts.type optional; when present, stacks {type: {$in: [...types]}}.
//   - opts.scope optional; when present, stacks {scope: {$eq: opts.scope}}.
//   - opts.threshold required (default 0.7 per CON-02). Client-side filter
//     after Vectorize returns (Vectorize has no native score floor —
//     Context7 verified).
//   - opts.topK = effective desired count AFTER threshold filter.
//   - Internal over-fetch: query for topK * VECTORIZE_OVERFETCH_FACTOR,
//     filter by threshold, slice to topK. Mirrors tools.ts:556-576 pattern.

export interface VectorizeNeighborsOpts {
  topK: number;
  type?: string;
  scope?: string;
  threshold: number;
}

export function vectorizeNeighbors(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: VectorizeNeighborsOpts,
): Promise<VectorizeMatches["matches"]> {
  // Source: tools.ts:556-576 pattern (over-fetch + threshold + slice).
  // Filter shape per Cloudflare Vectorize docs (Context7 verified):
  //   { type: { $in: [...] }, scope: { $eq: "..." } }
  // Multi-key filter is implicit AND.
  const filter: Record<string, unknown> = {};
  if (opts.type !== undefined) filter.type = { $in: [opts.type] };
  if (opts.scope !== undefined) filter.scope = { $eq: opts.scope };

  const fetchSize = opts.topK * VECTORIZE_OVERFETCH_FACTOR;
  const result = await vectorizeQuery(env, workspaceId, vector, {
    topK: fetchSize,
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
    returnMetadata: "all",
  });
  return result.matches
    .filter(m => m.score >= opts.threshold)
    .slice(0, opts.topK);
}
```

**Monorepo wiring (verified via repo audit):**
- Both `packages/mcp-server/package.json` and `packages/triage-worker/package.json` need to add `"@engram/vectorize-utils": "*"` to dependencies. npm workspaces auto-links.
- The existing `shared/ai-config` follows the exact same pattern — no build-order surprises.
- TypeScript path resolution: `tsconfig.base.json` already includes the shared/* glob (verified — both `shared/types` and `shared/ai-config` resolve without explicit `paths` entries).

**Vectorize filter syntax facts** [VERIFIED: Cloudflare Vectorize docs via Context7]:
- Operators: `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`.
- Multi-key object = implicit logical AND.
- Compact JSON filter must be < 2048 bytes (irrelevant at our scale).
- `topK` default = 5; we set explicitly.
- `returnMetadata: "all"` cap is `topK ≤ 50` per Phase 5 Plan 05-02 audit (Pitfall 8 noted in `vectorize-helper.ts:24-26`). Our `fetchSize = 3 * 2 = 6` is well under.

### Pattern 5: Conflict-Pipeline Bounded Parallelism (CON-02, CON-07)

**What:** Run up to 3 `detectConflict()` calls in parallel per write.

**Pattern:**

```typescript
// CON-07: per-write budget = 3 (top-K cap from CON-02 prefilter).
// "Bounded parallel" in workerd: Promise.all over an already-bounded array.
// No p-limit needed; the prefilter cap = the concurrency cap.
//
// Latency expectation per call: detectConflict invokes llama-4-scout via JSON-mode.
// Empirical estimate (no measurement in repo yet — flagged as MEDIUM confidence):
//   Workers AI Llama 4 Scout inference with 512-token output and short JSON
//   schemas typically completes in 800ms–2.5s p50, 3–5s p99. (Source: trained
//   estimate — confirm during execution by sampling the 30-pair eval timings.)
// With 3 parallel calls capped at p99 ≈ 5s, the async pipeline branch p99
// fits well within the CON-07 4s budget IF the calls truly run in parallel.

const calls = neighbors.map(neighbor =>
  detectConflict(env, newBlock.content, neighbor.content)
);
const verdicts = await Promise.all(calls);  // bounded by neighbors.length ≤ 3
```

**`ctx.waitUntil()` discipline** [VERIFIED via mcp-server `tools.ts:448-474` existing pattern]:
- The waitUntil callback returns void; failures are caught locally and logged via `console.error` + `writeAnalytics`. **Never re-throw inside waitUntil** — would mark the parent invocation as failed.
- Cloudflare guarantees waitUntil lifetime through Worker invocation lifecycle. `writeAnalytics → env.ANALYTICS.writeDataPoint` is non-blocking and per Cloudflare docs samples + buffers — does not block waitUntil completion. [CITED: per existing analytics-helper sibling pattern + `analytics.ts:85-101` non-throw discipline.]

### Pattern 6: `EngramResponse.context.conflicts[]` SQL-Join Wiring (CON-05)

**What:** Recall handler hydrates memory rows from SQLite, then needs to SQL-join the inbox table to find pending conflicts linking those memories.

**Mapping problem:** Conflicts are written to the `inbox` table per D-04 (CON-04) with `proposed_type='conflict'` and `proposed_properties = JSON.stringify({memory_a_id, memory_b_id, category, ai_confidence, description})`. The `Conflict` type from `@engram/types` expects `{id, memory_a_id, memory_b_id, description, severity, detected_at, resolved_at}`.

**Mapping rule** (Phase 2 must spell this out — it's the contract bridge between two phases of writes):

| `Conflict` field | Source in `inbox` row |
|---|---|
| `id` | `inbox.id` (e.g., `"conflict-" + nanoid()` per the insert helper) |
| `memory_a_id` | JSON-parsed from `inbox.proposed_properties.memory_a_id` |
| `memory_b_id` | JSON-parsed from `inbox.proposed_properties.memory_b_id` |
| `description` | JSON-parsed from `inbox.proposed_properties.description` |
| `severity` | Derived: `"high"` always (only `category="contradiction"` is inserted per CON-04 + CON-06 specifies severity-low override when ages > 180d) — see below |
| `detected_at` | `inbox.created_at` |
| `resolved_at` | `null` always for now (the v0.3 `conflict()` tool sets this; v0.2 doesn't expose resolution) |

**Severity computation (CON-06 + PITFALLS CD-5 time-blind):**

```typescript
function severityFor(
  conflictCreatedAt: number,
  memA: { created_at: number },
  memB: { created_at: number },
): "low" | "medium" | "high" {
  const diffDays = Math.abs(memA.created_at - memB.created_at) / (1000 * 60 * 60 * 24);
  if (diffDays > 180) return "low";   // CON-06 + CD-5 time-blind mitigation
  return "high";                      // default for contradictions
  // "medium" is reserved for v0.3 (not used in v0.2 inserts)
}
```

This computation happens at READ time inside the recall handler — the `inbox` row only stores the raw fields. The severity bucket is derived per request.

**New WorkspaceDO read helper signature:**

```typescript
// packages/workspace-do/src/queries.ts
export function listInboxConflictsForMemoryIds(
  sql: SqlStorage,
  ids: string[],
): InboxConflictRow[] {
  if (ids.length === 0) return [];
  // SQLite supports JSON1 functions (json_extract) — verify with workerd.
  // Alternative (safer): SELECT raw inbox rows, JSON.parse in TS.
  const placeholders = ids.map(() => "?").join(",");
  // Use LIKE on the JSON string for the proposed_properties match. This is
  // robust because we control the writer (CON-04 fixed shape) and SQLite's
  // json_extract may be excluded from the workerd SQLite build.
  // SAFER ALTERNATIVE: store memory_a_id and memory_b_id as separate columns
  // on the inbox row. NOT POSSIBLE in v0.2 — schema is locked (no v0.2 migrations
  // per ROADMAP). Use TS-side filtering after a broader SELECT:
  const rows = sql.exec(
    `SELECT id, content, proposed_type, proposed_properties, memorability_score, source, created_at
     FROM inbox
     WHERE proposed_type = 'conflict'
       AND created_at > ?  -- bound the scan to the last 60 days; conflicts age out
     ORDER BY created_at DESC
     LIMIT 100`,
    Date.now() - 60 * 24 * 3600 * 1000,
  ).toArray();
  // Filter in TS: parse proposed_properties JSON, check memory_a_id or
  // memory_b_id ∈ ids.
  return rows.filter(r => {
    const props = JSON.parse(r.proposed_properties as string);
    return ids.includes(props.memory_a_id) || ids.includes(props.memory_b_id);
  }) as InboxConflictRow[];
}
```

**SQL approach decision (Plan must resolve):**
- **Option A** — Plain `SELECT WHERE proposed_type = 'conflict'` then TS-side filter on parsed JSON. Simple, robust. Bounded by `LIMIT 100` + 60-day window. Cost: scans up to 100 inbox-conflict rows per recall.
- **Option B** — SQLite `json_extract(proposed_properties, '$.memory_a_id')` in the WHERE clause. More efficient but requires verifying workerd SQLite ships with JSON1 extension. (Reasonable bet — Cloudflare DOs SQLite is full build — but verify in execution.)

**Recommendation:** Ship Option A; revisit if recall p50 climbs measurably. The 100-row cap × 100-byte parse is trivial work compared to the AI/Vectorize calls already in the recall path.

**Read helper lives in `packages/workspace-do/src/queries.ts`** (NOT in mcp-server) — keeps SQL access centralized in the DO package per existing convention (`listConflicts` at queries.ts:511 is the model). Expose via WorkspaceDO RPC method, called from `recall()` via the `stub.listInboxConflictsForMemoryIds(...)` pattern already used for `getBlocksByIds`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Pareto-front over 3 metrics, 3 candidates | npm `pareto-frontier` | Hand-rolled 15-line filter | Trivial scale; adding a dep crosses the "zero new deps" v0.2 invariant |
| Bounded-parallel up to N=3 | `p-limit` or `promise-pool-executor` | `Promise.all(arr.slice(0, 3))` | Budget already caps at 3; concurrency limit is structural, not dynamic |
| Conflict-detection prompt + classifier | Custom prompt engineering | ENG-16's `CONFLICT_DETECTION_PROMPT` (byte-frozen per CON-01 gate) | Already validated at P=0.875, R=0.933. CON-01 only re-evaluates the same prompt against the same fixture — no rewrites |
| Vectorize cosine score floor | Server-side filter | Client-side `.filter(m => m.score >= threshold)` | Vectorize has no score-floor API. Confirmed via Context7 official docs |
| F1 / MRR / top-1 metric implementations | npm IR-metrics package | 5-line in-test helpers | Each is one trivial loop; matches existing `recall-f1.eval.test.ts:218-222` shape |
| Conflict-pipeline orchestration (queue+lifecycle) | Custom queue stage | `ctx.waitUntil()` per-write | Architectural lock per ROADMAP "Out of Scope (v0.2)" — no separate `engram-conflicts` Queue until v0.4 connector volume justifies |
| Audit comment / HYBRID_WEIGHTS literal | cf-code-assist generation | Claude authoring (byte-frozen contract per D-06) | The exact comment text is load-bearing — Phase 3 EXP-06 reads it to know which score-source is feeding the rerank weight |

**Key insight:** v0.2 Phase 2 is *almost entirely* a matter of correctly composing primitives that already exist in the repo (hybridRank function, detectConflict function, vectorizeQuery helper, createInboxEntry helper, ctx.waitUntil pattern, eval-tier vitest project). The hand-roll temptation is highest for IR metrics and Pareto computation, both of which are trivial.

## Runtime State Inventory

This phase is not a rename/refactor/migration phase. **Skipping Runtime State Inventory** per RESEARCH.md template guidance. The closest "live state" concern is:
- The `HYBRID_WEIGHTS` literal — but this is config compiled into Workers, not stored state. The change is a deploy, not a migration.
- Vectorize index dimensions — UNCHANGED in v0.2 (1024d locked).
- No new SQL migrations (v0.2 ROADMAP §"Out of Scope" explicitly excludes Vectorize index changes; CONTEXT.md confirms no schema changes).

**Nothing found in stored data / live service config / OS-registered state / secrets-env-vars / build-artifacts categories** — verified by reading CONTEXT.md `<canonical_refs>` (no migration files referenced) and the ROADMAP "v0.2 introduces zero new npm dependencies and zero Vectorize index changes" lock.

## Common Pitfalls

Phase-specific pitfalls are extensively catalogued in `.planning/research/v0.2-PITFALLS.md` (HR-1..6, CD-1..6, INT-1..6). Phase 2 inherits ALL of them; the planner MUST consult that file. Below are the Phase-2-execution-specific risks that emerge from the CONTEXT.md decisions themselves.

### Pitfall 1: `HYBRID_WEIGHTS as const` blocks the sweep test

**What goes wrong:** The 625-config sweep needs to call `hybridRank()` with each candidate weight set. Currently `HYBRID_WEIGHTS` is `as const` (immutable) and read from module scope by `hybridRank` — the function takes NO weights parameter.

**Why it happens:** The function shape was locked in Phase 5 with the assumption that weights are global config. Sweeping requires the function to accept weights as input.

**How to avoid:** Refactor `hybridRank` to accept a `weights: HybridWeights` parameter (default = `HYBRID_WEIGHTS`). Zero behavior change to production callers. The sweep test passes per-config weights. Document in Plan 02-X.

**Warning signs:** Sweep test tries to mutate `HYBRID_WEIGHTS` and gets a TS error; or sweep test inlines the formula and drifts from `hybrid-rank.ts`.

### Pitfall 2: Eval-budget counter accidentally consumed during sweep

**What goes wrong:** Plan calls `env.AI.run` or `env.VECTORIZE.query` inside the per-config inner loop (instead of once during pre-resolution). Counter goes from ~200 (expected) to 62,500 (catastrophic) and the budget guard throws.

**Why it happens:** Easy to write a sweep helper that "just calls recall()" per config and per query without realizing each `recall()` triggers an AI call + Vectorize call.

**How to avoid:** Pre-resolve ALL queries (embeddings + Vectorize matches + hydrated blocks) before entering the config loop. Stash in a `Map<query_id, QueryResolution>`. The config loop is then pure-math only — never touches `env.AI` or `env.VECTORIZE`.

**Warning signs:** Test fails with `[eval-budget] MAX_AI_CALLS exceeded`; OR the per-config iteration runtime exceeds 100ms (signal of an accidental binding call).

### Pitfall 3: CON-01 unskip without first verifying the budget

**What goes wrong:** Executor unskips `conflict-precision.eval.test.ts` and runs it without inspecting the current `MAX_AI_CALLS=200` budget. 30 pairs × 1 `detectConflict` call = 30 AI calls. Fits — but if conflict-precision is run in the same session as `recall-ranking` (~200 AI calls), the counter is shared and budget is blown.

**Why it happens:** Both eval tests live in the eval project per PRE-02; both share the same counter via `eval-budget.setup.ts:48` (`aiCallCount`). Running them together exceeds the cap.

**How to avoid:** Run sweep + conflict-precision in separate test invocations (separate `npx vitest run` calls). Document this in Plan 02-X. Optionally: the planner adds a "session reset" hook OR commits to running eval suites one-at-a-time in CI.

**Warning signs:** Test 1 (recall-ranking) passes; test 2 (conflict-precision) starts and immediately throws budget-exceeded.

### Pitfall 4: Vectorize `filter: { workspace_id: ... }` confusion vs namespace

**What goes wrong:** Plan adds `workspace_id` to the Vectorize filter object instead of the `namespace` parameter. Filter must match vector metadata; namespace is the partition. Vectors are upserted with `namespace = workspaceId` (per `vectorize-helper.ts:127`), not with `metadata.workspace_id` (verified via `tools.ts:448+` upsert site — only `type, scope, created_at` are in metadata).

**Why it happens:** D-10 says "`{ workspace_id }` is mandatory" — easy to read as a filter rather than a namespace.

**How to avoid:** The new `vectorizeNeighbors` helper takes `workspaceId` as a positional argument (passed to `vectorizeQuery` which sets `namespace: workspaceId`). It is NEVER added to the `filter` object. The mandatory-ness is enforced at the call signature (TS compile-time) by being non-optional positional.

**Warning signs:** Test failures of the form "no matches" (filter mismatch — vectors don't have `workspace_id` in metadata).

### Pitfall 5: `recall()` envelope `conflicts[]` mapping drift

**What goes wrong:** The `inbox` row stores `proposed_properties` as a JSON string. The recall handler parses it but slightly mismatches the shape — e.g., loses the `category` field, or types `severity` wrong.

**Why it happens:** The mapping is a "manual contract" between the write site (CON-04) and the read site (CON-05). Two different files, no compile-time link.

**How to avoid:** Define a single `InboxConflictProperties` interface in `@engram/types` (or co-located with `Conflict`). The write helper takes that exact type; the read helper returns that exact type. The handler converts to `Conflict` via a single mapping function — one place to read for correctness.

**Warning signs:** TS errors at the recall handler when mapping; OR runtime errors of "Cannot read properties of undefined (memory_a_id)".

### Pitfall 6: Conflict-pipeline emits analytics from outside `ctx.waitUntil`

**What goes wrong:** `writeAnalytics` is called after the await but the calling scope has already returned from the request handler. Without `waitUntil`, the analytics write is racing the worker invocation termination.

**Why it happens:** The conflict-pipeline IS the waitUntil callback per CON-03. As long as `writeAnalytics` is awaited (or fired before the pipeline function returns), it's fine. But if a developer extracts the analytics call out and tries to "fire it from the queue consumer," the lifetime is lost.

**How to avoid:** Keep `writeAnalytics` calls INSIDE the conflict-pipeline function body (which runs inside `ctx.waitUntil`). Don't optimize for "shared analytics emitter" patterns in this phase. The analytics write is a synchronous binding call per `triage-worker/src/analytics.ts:85-101` — it returns immediately and doesn't need awaiting beyond the binding call itself.

**Warning signs:** Conflict-pipeline analytics rows appear sporadically or not at all in the Cloudflare dashboard.

## Code Examples

### Embedding cache + sweep skeleton (RNK-01)

```typescript
// Source pattern: derived from packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts
// and packages/mcp-server/src/tools.ts:530-596 recall handler.

// Step 1: Pre-resolve. ~200 calls total (within MAX_AI_CALLS=200).
const resolutions = new Map<string, QueryResolution>();
for (const entry of corpus.entries) {
  const embed = await env.AI.run(EMBEDDING_MODEL, { text: [entry.query] });
  const queryVec = embed.data[0];
  if (queryVec?.length !== EMBEDDING_DIMS) throw new Error("dim mismatch");
  const result = await vectorizeQuery(env, workspace_id, queryVec, {
    topK: 25 * VECTORIZE_OVERFETCH_FACTOR,
    returnMetadata: "all",
  });
  const filtered = result.matches
    .filter(m => m.score >= MIN_COSINE_THRESHOLD)
    .slice(0, 25);
  const blocks = await stub.getBlocksByIds({
    workspace_id, ids: filtered.map(m => m.id),
  });
  resolutions.set(entry.id, { matches: filtered, blocks });
}

// Step 2: Pure-math 625-config sweep.
function* enumerateGrid() {
  const C = [0.6, 0.8, 1.0, 1.2, 1.5];
  const R = [0.05, 0.10, 0.15, 0.20, 0.30];
  const T = [0.10, 0.15, 0.20, 0.25, 0.35];
  const S = [0.05, 0.10, 0.15, 0.20, 0.30];
  for (const c of C) for (const r of R) for (const t of T) for (const s of S) {
    yield { rerank: c, recency: r, type_match: t, scope_match: s };
  }
}

const sweepResults: SweepResult[] = [];
const trainSet = corpus.entries.filter(e => e.split === "train");
const validateSet = corpus.entries.filter(e => e.split === "validate");

for (const cfg of enumerateGrid()) {
  const trainMetrics = scoreSplit(trainSet, resolutions, cfg);
  const validateMetrics = scoreSplit(validateSet, resolutions, cfg);
  sweepResults.push({ cfg, train: trainMetrics, validate: validateMetrics });
}

// Step 3: Selection per D-03 + D-04.
const top3ByF1 = [...sweepResults].sort((a, b) => b.train.f1 - a.train.f1).slice(0, 3);
const paretoWinners = paretoFront(top3ByF1.map(r => ({
  config: r.cfg, f1: r.train.f1, mrr: r.train.mrr, top1: r.train.top1,
})));
const winner = paretoWinners.length === 1
  ? paretoWinners[0]
  : paretoWinners.sort((a, b) => b.mrr - a.mrr)[0];  // tiebreak

// Step 4: D-04 convergence gate (STRICT < 10pp).
const winnerSweep = sweepResults.find(r => sameWeights(r.cfg, winner.config))!;
const gap = winnerSweep.train.f1 - winnerSweep.validate.f1;
expect(gap).toBeLessThan(0.10);  // strict per D-04 boundary

// Step 5: Sensitivity (RNK-04).
const sensitivityRate = computeSensitivityRate(winner.config, resolutions);
expect(sensitivityRate).toBeLessThan(0.30);

// Step 6: Baseline regression (RNK-06, D-15 dual gate).
expect(winnerSweep.train.f1).toBeGreaterThanOrEqual(0.8254);
// Plus: re-run hybridRank with winner weights against the 27-entry real-corpus
// via the EXISTING recall-f1.eval.test.ts assertion path (left UNCHANGED).
```

### Conflict-pipeline orchestrator (CON-02 + CON-03 + CON-06 + CON-07 + D-20)

```typescript
// Source pattern: derived from packages/triage-worker/src/index.ts:208-298
// + packages/triage-worker/src/conflict-detection.ts:138-179 + ENG-16 contract.

// packages/triage-worker/src/conflict-pipeline.ts
import { detectConflict } from "./conflict-detection.js";
import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { writeAnalytics, workspaceTag } from "./analytics.js";

const ANALYTICS_ENV_TAG = "engram-prod" as const;
const CONFLICT_COSINE_FLOOR = 0.7;       // CON-02
const CONFLICT_DUPE_CEILING = 0.92;      // CON-06 (PITFALLS CD-4)
const CONFLICT_PER_WRITE_BUDGET = 3;     // CON-07

export async function conflictPipeline(
  env: { AI: Ai; VECTORIZE: VectorizeIndex; WORKSPACE: DurableObjectNamespace;
        ANALYTICS?: AnalyticsEngineDataset },
  newBlock: { id: string; workspace_id: string; type: string; scope: string;
              content: string; embedding: number[]; created_at: number },
): Promise<void> {
  const start = Date.now();
  const wsTag = await workspaceTag(newBlock.workspace_id);
  let neighborsExamined = 0;
  let verdict: "contradiction" | "benign_update" | "unrelated" | "skipped-dupe" | "error" = "unrelated";

  try {
    // Step 1: cosine prefilter (CON-02). vectorizeNeighbors filters by
    // workspace_id (namespace), type ($in), and threshold ≥0.7 client-side.
    const neighbors = await vectorizeNeighbors(env, newBlock.workspace_id, newBlock.embedding, {
      topK: CONFLICT_PER_WRITE_BUDGET,
      type: newBlock.type,
      scope: newBlock.scope,
      threshold: CONFLICT_COSINE_FLOOR,
    });
    neighborsExamined = neighbors.length;

    if (neighbors.length === 0) {
      verdict = "unrelated";
      return;
    }

    // Step 2: cosine-ceiling dupe filter (CON-06 + CD-4).
    const candidates = neighbors.filter(n => n.score < CONFLICT_DUPE_CEILING);
    if (candidates.length === 0) {
      verdict = "skipped-dupe";
      return;
    }

    // Step 3: hydrate neighbor blocks (need .content for detectConflict).
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id));
    const neighborBlocks = await (stub as unknown as {
      getBlocksByIds: (args: { workspace_id: string; ids: string[] }) =>
        Promise<{ id: string; content: string; created_at: number }[]>;
    }).getBlocksByIds({ workspace_id: newBlock.workspace_id, ids: candidates.map(n => n.id) });

    // Step 4: bounded-parallel detectConflict (Promise.all over ≤3).
    const detections = await Promise.all(
      neighborBlocks.map(neighbor =>
        detectConflict(env, newBlock.content, neighbor.content)
          .then(out => ({ neighbor, out }))
      )
    );

    // Step 5: for category=contradiction, write to inbox.
    for (const { neighbor, out } of detections) {
      if (out?.category !== "contradiction") continue;

      // Determine severity per CON-06 + PITFALLS CD-5 time-blind mitigation.
      const ageDiffDays = Math.abs(newBlock.created_at - neighbor.created_at) / (1000 * 60 * 60 * 24);
      // NOTE: severity is COMPUTED AT READ TIME in the recall handler — the
      // inbox row stores raw fields only. This branch only logs the verdict.

      // Inbox write per CON-04 shape.
      await (stub as unknown as {
        insertConflictAsInbox: (args: {
          workspace_id: string;
          memory_a_id: string;
          memory_b_id: string;
          category: "contradiction";
          ai_confidence: number;
          description: string;
        }) => Promise<void>;
      }).insertConflictAsInbox({
        workspace_id: newBlock.workspace_id,
        memory_a_id: newBlock.id,
        memory_b_id: neighbor.id,
        category: "contradiction",
        ai_confidence: out.confidence,
        description: out.reason,
      });
    }

    const anyContradiction = detections.some(d => d.out?.category === "contradiction");
    verdict = anyContradiction ? "contradiction" : "benign_update";
  } catch (err) {
    console.error("conflict-pipeline:failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    verdict = "error";
  } finally {
    // Step 6: D-20 analytics — emit even on error so we can monitor failure rate.
    writeAnalytics(env, {
      blobs: ["conflict-pipeline", verdict, wsTag, "ok"],
      doubles: [Date.now() - start, neighborsExamined, 0, verdict === "error" ? 1 : 0],
      indexes: [ANALYTICS_ENV_TAG],
    });
  }
}
```

### `insertConflictAsInbox` helper (CON-04, `packages/workspace-do/src/queries.ts`)

```typescript
// Source pattern: queries.ts:480-490 createInboxEntry — same INSERT OR IGNORE
// safety for at-least-once delivery.

export function insertConflictAsInbox(
  sql: SqlStorage,
  args: {
    memory_a_id: string;
    memory_b_id: string;
    category: "contradiction";
    ai_confidence: number;
    description: string;
  },
): void {
  // ID convention: "conflict-" prefix mirrors the "inbox-" pattern at
  // queries.ts:680. Use crypto.randomUUID() for uniqueness so concurrent
  // conflict writes for the same memory pair don't collide.
  const id = `conflict-${crypto.randomUUID()}`;
  const proposedProperties = JSON.stringify({
    memory_a_id: args.memory_a_id,
    memory_b_id: args.memory_b_id,
    category: args.category,
    ai_confidence: args.ai_confidence,
    description: args.description,
  });
  sql.exec(
    `INSERT OR IGNORE INTO inbox
       (id, content, proposed_type, proposed_properties, memorability_score, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    args.description,         // content = the conflict description (queryable)
    "conflict",               // proposed_type — the CON-05 join key
    proposedProperties,
    args.ai_confidence,       // memorability_score reused for AI confidence
    "triage:conflict-pipeline",
    Date.now(),
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| F1-only weight tuning | Pareto front over (F1, MRR, top-1) | Phase 2 RNK-02 | PITFALLS HR-2 reward-hacking mitigation; surfaces rank-quality regressions hidden by F1 |
| Single-corpus weight tuning | Train/validate 70/30 split with strict <10pp gap | Phase 2 RNK-03 + D-04 | PITFALLS HR-1 / HR-4 small-N overfit defense |
| Hybrid-rank weight key = `cosine` | `rerank` (CONTEXT.md D-05) | Phase 2 (renames now; bge-reranker invocation in Phase 3) | Phase 3 EXP-06 can swap score source without contract change |
| Per-write conflict scan against ALL workspace memories | top-K=3 cosine-similar same-type neighbors | Phase 2 CON-02 + PITFALLS CD-3 | O(1) AI calls per write instead of O(N); triage worker stays under p99 budget |
| Conflict alerts as push notifications | Inbox-only pull surface (recall envelope) | Architectural lock per CON-08 + PITFALLS CD-1 | Adoption-critical: false-positive trust erosion is irreversible |
| Single-Worker direct `env.VECTORIZE.query` calls | `vectorize-helper.ts` (mcp-server) → `shared/vectorize-utils/` (both Workers) | Phase 2 D-08 | Cross-Worker reuse without cross-package dep; AI-02 cross-workspace isolation preserved |

**Deprecated/outdated:**
- The original Phase 5 plan to tune weights against 27-entry corpus only — superseded by D-11..15 (100-entry corpus + 27-entry retained as regression check)
- The notion of a separate `engram-conflicts` Queue — explicitly out of scope until v0.4 connector volume justifies (ROADMAP)
- ROADMAP §"Phase 2 Success Criteria #4" wording of "50-pair eval" — STALE; the live fixture and CON-01 say 30. CONTEXT.md `<specifics>` flags this explicitly.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Workers AI Llama 4 Scout `detectConflict()` latency p50 ≈ 800ms–2.5s, p99 ≈ 3–5s | Pattern 5 (Bounded Parallelism) | If actual p99 > 5s, parallel 3-call branch may exceed CON-07 4s budget. **Mitigation:** Plan must instrument the 30-pair eval run to log per-call latencies; if p99 > 4s, plan a fallback (reduce per-write budget to 2, or accept budget breach with explicit ROADMAP update). |
| A2 | `writeDataPoint` is non-blocking and does not pin `ctx.waitUntil` lifetime | Pitfall 6 + Pattern 5 | If `writeDataPoint` somehow blocks/awaits, conflict-pipeline analytics could leak into the next request. Existing Phase 5 AI-04 pattern (mcp-server `tools.ts:457`) already uses this pattern without issue — confidence is reasonable. |
| A3 | workerd SQLite has JSON1 extension available for `json_extract` | Pattern 6 Option B | If JSON1 unavailable, Option A (TS-side filter) is the fallback. Plan uses Option A as default to avoid runtime surprise. **No risk** — default chosen for robustness. |
| A4 | `p-limit` is NOT needed because per-write budget = 3 (structural cap) | Pattern 5 + Don't Hand-Roll table | If CONTEXT.md D-XX ever raises the per-write budget (e.g., to 10), the natural `Promise.all` shape may need revisiting. v0.2 lock is clear; future re-litigation only. |
| A5 | RNK-04 sensitivity metric = top-1 flip rate < 30% (rather than Kendall tau < 0.8) | Pattern 3 | These are different mathematical thresholds; the choice should be documented in the changelog. Plan should explicitly pick ONE in the test code AND in the audit comment. |

**Confirm with user before locking:** A1 (Workers AI latency), A5 (sensitivity metric choice). A2/A3/A4 are sufficiently de-risked by existing repo patterns.

## Open Questions

1. **Should `hybridRank` be refactored to accept weights as a parameter?**
   - What we know: the 625-config sweep MUST call `hybridRank` with per-config weights. Today the function reads `HYBRID_WEIGHTS` from module scope.
   - What's unclear: whether refactoring is a Plan 02-X prerequisite or whether the sweep can inline the formula.
   - Recommendation: refactor. `function hybridRank(matches, blocks, args, now, weights = HYBRID_WEIGHTS)`. Zero behavior change to production. Single source of truth for the formula. Avoids drift between test and prod.

2. **For RNK-04 sensitivity, is the metric top-1 flip rate or Kendall tau on top-3?**
   - What we know: PITFALLS HR-3 specifies "the rank-reorder rate" with a "<30% rank instability" threshold.
   - What's unclear: whether "rank-order" means top-1 changes or any top-3 swap.
   - Recommendation: `top1_flip_rate` (simpler, more interpretable, fewer math edge cases). Plan must document this choice in the audit comment AND `docs/hybrid-rank-changelog.md`.

3. **Does workerd SQLite ship with JSON1 extension?**
   - What we know: CF DOs SQLite is typically a "full" build; existing `queries.ts` does not use `json_extract` so we have no confirmation either way.
   - What's unclear: whether `json_extract(proposed_properties, '$.memory_a_id')` works at runtime.
   - Recommendation: ship Option A (TS-side filter) to sidestep. If recall p50 climbs, revisit.

4. **How is the `conflict-precision.eval.test.ts` hard gate enforced?**
   - What we know: the test currently has `it.skip`; CON-01 must unskip AND assert P≥0.85, R≥0.90. Current test only asserts the SUGGEST threshold (0.70) inside `it.skip`.
   - What's unclear: whether to (a) keep the existing test and add new assertions, or (b) rewrite the test for the SHIP threshold (0.85) per CON-01.
   - Recommendation: modify the existing test — set new `SHIP_PRECISION_THRESHOLD = 0.85` constant and add `SHIP_RECALL_THRESHOLD = 0.90`. Hard-assert both when `isFullCorpus`. The decision-gate constants at the top of the file are the right place to update.

5. **Single Linear ENG-issue with two sub-issues, or one ENG issue per workstream?**
   - What we know: D-17 says "Two Linear sub-issues under the Phase 2 ENG issue."
   - What's unclear: which sub-issue owns the `02-CF-CODE-ASSIST-USAGE.md` tracker file, or whether it lives on the parent.
   - Recommendation: tracker lives on the parent ENG issue (cross-workstream artifact). Sub-issues link to their respective plans. The planner creates the sub-issues during plan-creation, not during this research.

## Environment Availability

This phase has external dependencies on Cloudflare bindings (Workers AI, Vectorize, Analytics Engine, Durable Objects). All are existing v0.1 infrastructure — verified by Phase 1 completion.

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Workers AI binding (`env.AI`) | RNK sweep (embeddings) + CON-01 (detectConflict) | ✓ | n/a (Cloudflare native) | None — required |
| Vectorize binding (`env.VECTORIZE`) | RNK sweep + CON-02 prefilter | ✓ | 1024d cosine index | None — required |
| Analytics Engine binding (`env.ANALYTICS`) | D-20 conflict-pipeline telemetry | ✓ (binding declared in triage-worker wrangler.jsonc:27) | n/a | `writeAnalytics` no-ops if undefined — defensive design |
| Durable Object (cross-Worker `WORKSPACE`) | Conflict-pipeline RPC calls | ✓ | Phase 5 / Phase 6 already established | None — required |
| `wrangler` CLI + `wrangler login` | Eval tier runs against real bindings | ✓ (PRE-02 confirmed) | per repo | Skips eval-tier on missing creds (`hasEvalCreds()` gate) |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env | CI eval runs + nightly summary | Russell's CI secrets (PRE-01 setup) | n/a | Test prints `[SKIP]` and exits cleanly |
| Node 20+ (for `scripts/sync-eval-corpus.mjs`) | RNK plan (D-13) | ✓ | per repo `engines` (assumed) | None — script is trivial ESM |
| 100-entry `recall-corpus.json` from PRE-03 | RNK sweep authoritative source | ✓ | Phase 1 completion confirmed (STATE.md) | None — required |
| 30-pair `conflict-pairs.json` from ENG-16 | CON-01 re-eval | ✓ (`_meta.target_size = 30, current_size = 30, status = ready`) | n/a | None — required |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `env.ANALYTICS` no-ops in dev/test (existing defensive pattern). No execution impact.

## Validation Architecture

Phase 2 is verification-heavy: every requirement maps to an eval-tier or unit-tier assertion. This section satisfies the `nyquist_validation: true` config flag.

### Test Framework

| Property | Value |
|---|---|
| Framework | `vitest` + `@cloudflare/vitest-pool-workers` (Phase 1 PRE-02 locked) |
| Config file | `packages/mcp-server/vitest.config.ts` (multi-project: workerd / lint-node / eval) — `packages/triage-worker/vitest.config.ts` analog |
| Quick run command | `cd packages/mcp-server && npm test -- --project=workerd <test-pattern>` |
| Full eval suite | `cd packages/mcp-server && CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm test -- --project=eval` |
| Eval budget enforcement | `eval-budget.setup.ts` MAX_AI_CALLS=200 (immutable per PRE-02 contract) |
| Eval credential gate | `hasEvalCreds()` — eval project excluded entirely on missing creds |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| RNK-01 | 625-config sweep | eval | `npx vitest run -- recall-ranking.eval.test.ts --project=eval` | ❌ Plan 02-X creates |
| RNK-02 | Pareto front (F1, MRR, top-1) | eval (within RNK-01 test) | (same as RNK-01) | ❌ Plan 02-X creates |
| RNK-03 | Train→validate gap < 10pp | eval (within RNK-01) | (same as RNK-01) | ❌ Plan 02-X creates |
| RNK-04 | Sensitivity rank-flip rate < 30% | eval (within RNK-01) | (same as RNK-01) | ❌ Plan 02-X creates |
| RNK-05 | Audit comment written + weights committed | unit (grep test) | `npm test -- --project=workerd ai-config-audit.test.ts` | ❌ Plan 02-X may create grep test OR rely on `/gsd:verify-work` manual check |
| RNK-06 | F1 ≥ 0.8254 on both 100-entry AND 27-entry corpora (D-15 dual gate) | eval (RNK-01 inner check + existing `recall-f1.eval.test.ts`) | `npx vitest run -- recall-f1.eval.test.ts recall-ranking.eval.test.ts --project=eval` | ✅ recall-f1 exists; ❌ recall-ranking new |
| RNK-07 | `docs/hybrid-rank-changelog.md` first row | unit (file-exists + schema check) | `npm test -- --project=lint-node changelog-schema.test.ts` | ❌ Optional — could be a `/gsd:verify-work` manual check instead |
| CON-01 | 30-pair eval: P ≥ 0.85, R ≥ 0.90 | eval | `cd packages/triage-worker && npx vitest run -- conflict-precision.eval.test.ts --project=eval` | ✅ exists (skipped) — Plan unskips + raises thresholds |
| CON-02 | conflict-pipeline orchestration | integration | `npm test -- --project=workerd conflict-pipeline.test.ts` | ❌ Plan creates |
| CON-03 | `ctx.waitUntil(conflictPipeline(...))` insertion | integration | `npm test -- --project=workerd triage-store-normal.test.ts` (may need new test) | ❌ Verify with existing test extension OR new |
| CON-04 | Inbox write shape correct | unit (workspace-do queries test) | `cd packages/workspace-do && npm test -- queries.test.ts` | ✅ exists (extend) |
| CON-05 | Recall envelope `context.conflicts[]` populated by SQL join | integration | `cd packages/mcp-server && npm test -- --project=workerd recall-conflicts.test.ts` | ❌ Plan creates |
| CON-06 | Cosine ≥ 0.92 dupe skip; 180d → severity=low | unit (conflict-pipeline + severity helper tests) | (within CON-02 + CON-05 tests) | ❌ Plan creates |
| CON-07 | Per-write budget = 3; async p99 < 4s | eval (latency probe in conflict-precision) + nightly `scripts/eval-budget-summary.mjs --conflict-pipeline-p99` | (run eval; check GraphQL aggregate) | Partial — extend script |
| CON-08 | No proactive notifications | architectural (grep test for forbidden binding usage) | `npm test -- --project=lint-node no-proactive-notifications.test.ts` | ❌ Optional grep gate; or rely on PR review |

### Sampling Rate

- **Per task commit:** `npm test -- --project=workerd` (unit + integration; ~30s on the mcp-server package)
- **Per wave merge:** All workerd-tier + lint-node-tier tests in mcp-server, workspace-do, triage-worker (~2 min)
- **Phase gate:** Full eval-tier run (RNK-01 sweep + CON-01 precision) — expected to consume ~200 + ~30 = ~230 AI calls (slightly over MAX_AI_CALLS=200 cap). **Plan must run these as SEPARATE eval invocations** so the budget counter resets between them. Document this in Plan 02-X (RNK plan run separately from CON plan run).

### Wave 0 Gaps

- [ ] `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` — covers RNK-01..04, RNK-06 inner check (Plan 02-X creates)
- [ ] `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — synced from `.planning/evals/recall-corpus.json` via D-13 script (Plan 02-X creates)
- [ ] `packages/triage-worker/src/conflict-pipeline.ts` — covers CON-02 orchestration (Plan 02-X creates)
- [ ] `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` — unit + integration for CON-02..04, CON-06 (Plan 02-X creates)
- [ ] `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — covers CON-05 SQL-join wiring (Plan 02-X creates)
- [ ] Optional: `packages/mcp-server/src/__tests__/ai-config-audit.test.ts` — grep gate for D-06 audit comment text (Plan 02-X may create OR defer to `/gsd:verify-work`)
- [ ] No new framework install needed (vitest + workers-pool already configured in Phase 1)

## Security Domain

Phase 2 inherits all Phase 1 security postures. New code paths must extend them; no NEW security controls are introduced.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes | JWT per workspace at MCP Worker boundary — unchanged (Phase 1 lock). New helpers (`vectorizeNeighbors`, `insertConflictAsInbox`) enforce `workspace_id` at the type-signature boundary. |
| V3 Session Management | yes | `EngramMcp` DO holds MCP session state — unchanged. |
| V4 Access Control | yes | Cross-workspace isolation: `vectorizeNeighbors` mandatory `workspace_id` (D-10) prevents accidental cross-namespace queries. `insertConflictAsInbox` runs inside the WorkspaceDO which is already partitioned by workspace_id. |
| V5 Input Validation | yes | `zod` v4 for all AI-classifier responses. `ConflictOutput` schema unchanged (ENG-16 contract). Recall query strings already truncated at 1800 chars before embedding (existing v0.1 gate). |
| V6 Cryptography | no (in this phase) | No new crypto; existing `workspaceTag` SHA-256 prefix pattern reused for Analytics Engine privacy. |
| V7 Error Handling | yes | `detectConflict` returns `null` on AI error (existing contract). Conflict-pipeline `try/catch/finally` ensures analytics emitted even on error (verdict=error). `console.warn` for non-fatal logging — never re-throws inside `ctx.waitUntil`. |
| V8 Data Protection | yes | Conflict descriptions stored in `inbox` are bounded by `detectConflict`'s 300-char max (zod-enforced via `min(10).max(300)`). PITFALLS CD-6 leak risk mitigated by description format constraints already in the prompt. |
| V9 Communication | yes | Workers ↔ Workers AI ↔ Vectorize all use Cloudflare-internal mTLS (no new external endpoints in this phase). |

### Known Threat Patterns for Cloudflare Workers + Vectorize + DO + Workers AI

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Cross-workspace vector leak via missing `namespace` arg | Information Disclosure | `vectorizeNeighbors` makes `workspaceId` non-optional positional (compile-time defense — matches v0.1 `vectorize-helper.ts` pattern) |
| Cross-workspace inbox write via DO-routing bug | Information Disclosure | `insertConflictAsInbox` runs inside the WorkspaceDO obtained from `env.WORKSPACE.idFromName(workspace_id)` — DO partition is the workspace boundary |
| Prompt injection via `newBlock.content` flowing into `detectConflict` | Tampering | `CONFLICT_DETECTION_PROMPT` is byte-frozen (per ENG-16); zod `.refine()` post-validation gate catches model deviations |
| AI-generated description containing PII in inbox row | Information Disclosure | Inbox is per-workspace (single-tenant in v0.2); description is bounded at 300 chars; raw memory contents are NOT joined into the description (only AI-summarized `reason` field) |
| Unbounded eval cost runaway | Denial of Service | MAX_AI_CALLS=200 immutable in `eval-budget.setup.ts` per PRE-02 contract; sweep test must cache embeddings to stay under |
| Analytics Engine PII leak via raw workspace_id | Information Disclosure | `workspaceTag()` SHA-256 prefix pattern in `triage-worker/src/analytics.ts:60-68` is the established control — reused unchanged |
| `Promise.all` failure swallowing | Tampering (silent failure) | conflict-pipeline `Promise.all` returns `(out \| null)`-shaped tuples; null on AI error is the documented contract; analytics row captures the failure verdict |

### Phase-2-specific Threat Surface Changes

**Net new write paths:**
- `insertConflictAsInbox` RPC method on WorkspaceDO — write to `inbox` table.
  - Threat: malformed `proposed_properties` JSON written to a row that later breaks the recall-side JSON.parse.
  - Mitigation: the helper takes a typed-args struct, `JSON.stringify`s it once. Read-side parse is wrapped in try/catch with a console.warn fallback. New unit test: round-trip insert → list → parse → assert shape.

**Net new read paths:**
- `listInboxConflictsForMemoryIds` RPC method on WorkspaceDO — read from `inbox` filtered by `proposed_type='conflict'` AND memory-id membership.
  - Threat: query returns conflicts from another workspace (would require a DO routing bug, but defense-in-depth).
  - Mitigation: query runs INSIDE the WorkspaceDO scope; no cross-DO query is possible. Existing `listConflicts` at queries.ts:511 is the model.

**Net new external surface:** None. No new MCP tools (per ROADMAP v0.2 lock). No new HTTP endpoints. No new Queue stages.

## cf-code-assist Routing — Additional Candidate Task Shapes

CONTEXT.md D-19 already lists 5 task shapes that should default to cf-code-assist. Surfaced during research, here are 3 additional candidates for the `02-CF-CODE-ASSIST-USAGE.md` tracker scaffold:

| Task Shape | Tool | Q1/Q2/Q3 | Why |
|---|---|---|---|
| Pareto-front + metric helpers in `recall-ranking.eval.test.ts` (paretoFront, computeF1, computeMRR, computeTop1 — ~40 LOC pure functions) | `generateCode` | N/N/Y | Pure functions with stable specs; under the 50-LOC threshold individually but the bundle of 4 metrics is the win |
| `02-CF-CODE-ASSIST-USAGE.md` scaffold (rows 1–N table boilerplate, mirrors Phase 1 file) | `generateDocs` | N/N/Y | Doc scaffold from Phase 1 template; under 50 lines but pure template work |
| `vectorize-utils` package.json + tsconfig.json (mirrors shared/ai-config verbatim) | `generateCode` | N/N/Y | <15 lines combined; only routable as part of a batch with vectorize-utils/src/index.ts to amortize context-prep cost |

**Task shapes that LOOK routable but should stay with Claude:**

| Task Shape | Why Claude |
|---|---|
| D-06 audit comment authoring in `shared/ai-config/src/index.ts` | Byte-frozen contract; the comment text encodes Phase 2 → Phase 3 contract semantics. Single-character drift breaks Phase 3 EXP-06 reading-comprehension. |
| `conflict-pipeline.ts` orchestrator | Cross-file SYNTHESIS (Q1=Y) — touches conflict-detection contract + vectorize-utils contract + WorkspaceDO RPC contract + Analytics Engine schema all at once. Coordination invariants. |
| `recall()` envelope `context.conflicts[]` SQL-join wiring | Cross-file SYNTHESIS (Q1=Y) — touches recall handler + buildRecallResponse + new WorkspaceDO read helper + Conflict type + InboxConflictProperties mapping. |
| `hybrid-rank.ts` parameterization (taking `weights` param) | Public API contract change to a shipped function — needs careful default-value reasoning to preserve backward compat. Routable diff is small (~5 LOC) but the impact reasoning is the work. |

## Sources

### Primary (HIGH confidence)
- Context7 `/llmstxt/developers_cloudflare_vectorize_llms-full_txt` — Vectorize filter operators (`$in`, `$eq`), query options (`topK`, `returnMetadata`, `filter`), explicit absence of score-floor parameter
- `packages/mcp-server/src/hybrid-rank.ts` — current `hybridRank` shape + `HYBRID_WEIGHTS` literal (Phase 5 production code)
- `packages/mcp-server/src/vectorize-helper.ts` — existing `vectorizeQuery` to be extracted (lines 78-99)
- `packages/mcp-server/src/tools.ts:530-596` — recall handler pattern (over-fetch + threshold + slice + hydrate + hybridRank)
- `packages/triage-worker/src/conflict-detection.ts` — `detectConflict()` signature + `CONFLICT_DETECTION_PROMPT` (byte-frozen per ENG-16)
- `packages/triage-worker/src/index.ts:208-298` — `store-normal` branch (CON-03 insertion point)
- `packages/triage-worker/src/analytics.ts` — `writeAnalytics` non-blocking pattern
- `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` — MAX_AI_CALLS=200 counter discipline
- `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` — RNK-06 baseline-check test (D-14 retained)
- `packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts` — CON-01 re-eval test (currently `.skip`'d)
- `packages/workspace-do/src/queries.ts:480-490` — `createInboxEntry` pattern (model for `insertConflictAsInbox`)
- `packages/workspace-do/src/schema.ts:122-142` — `inbox` + `conflicts` table definitions
- `shared/types/src/index.ts:172-258` — `Conflict` type + `EngramResponse<T>` envelope (already includes `context.conflicts?: Conflict[]`)
- `.planning/research/v0.2-PITFALLS.md` HR-1..6 + CD-1..6 + INT-1..6
- `.planning/research/v0.2-INTEGRATION-MATRIX.md` (RNK × CON row, plan 02-04 covering)
- `.planning/phases/02-recall-quality-baseline/02-CONTEXT.md` (D-01..D-21 lock surface)
- `.planning/REQUIREMENTS.md` §RNK + §CON acceptance criteria
- `.planning/ROADMAP.md` §"Phase 2: Recall Quality Baseline"
- `.claude/skills/spike-findings-engram/SKILL.md` — spike-003 "hybrid ranking required not optional"
- `CLAUDE.md` — AI Model Routing, Tech Stack, MCP tool surface contract

### Secondary (MEDIUM confidence)
- Cloudflare Workers AI Llama 4 Scout inference latency (~800ms–5s p99) — trained estimate; flagged as A1 to confirm during execution
- `writeDataPoint` non-blocking behavior — verified by existing Phase 5 AI-04 usage but not explicitly documented for `ctx.waitUntil` interaction

### Tertiary (LOW confidence)
- workerd SQLite JSON1 extension availability — not verified; Plan defaults to Option A (TS-side filter) to sidestep

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all reused from existing repo (zero new deps)
- Architecture (sweep cache + bounded-parallel + envelope SQL-join): HIGH — direct extension of established patterns
- Pareto / sensitivity math: HIGH — trivial pure-math problems
- `vectorizeNeighbors` Vectorize semantics: HIGH — verified via Context7 + existing helper extraction
- Vectorize score floor (no native support): HIGH — verified via Context7
- `detectConflict()` latency assumption: MEDIUM — A1 flagged for execution-time validation
- `writeDataPoint` lifetime under `ctx.waitUntil`: MEDIUM — existing repo usage suggests safe but not documented explicitly
- Sensitivity metric (top1_flip_rate vs Kendall tau): MEDIUM — defensible choice but documented as A5 for confirmation
- workerd JSON1 availability: LOW — defaulted to TS-side filter (Option A) to sidestep

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (30-day window for stable Cloudflare infra + existing repo patterns; sooner if Workers AI Llama 4 Scout rotates to a new version or if Vectorize adds a score-floor parameter)
