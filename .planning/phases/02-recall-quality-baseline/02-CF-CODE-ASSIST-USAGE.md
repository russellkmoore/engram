# Phase 2 — cf-code-assist Routing Tracker (v0.2 milestone)

> Tracks every code-generation decision during Phase 2 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 2 (Recall Quality Baseline — RNK + CON workstreams) execution only. Stop logging when `/gsd:verify-work 2` passes. After that, this file becomes the artifact summary; do not extend.
>
> **Why it matters:** Phase 2 is the v0.2 hybrid-rank + conflict-wiring phase. Per CLAUDE.md's phase-character heuristic this is a MIXED phase: contract-integration on the CON workstream (cross-file SYNTHESIS, byte-frozen response envelope contracts) and content-generation on the RNK workstream (sweep-test scaffolding, metric helpers, vectorize-utils extraction). Realistic content-generation share is expected `15–30%` — higher than Phase 1's `<10%` foundation share, lower than the projected Phase 5 `40–60%` AI-integration share. The tracker exists to enforce the routing discipline at the moment of truth (BEFORE each task's commit), not retrospectively.

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 02-01 through 02-09 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `02-01-T1`) or short label
- **Artifact** — the file or symbol produced
- **Route** — one of: `cf-code-assist:<tool>` (e.g., `cf-code-assist:generateCode`), `claude`, or `mixed:<tools>`
- **Checklist (Q1/Q2/Q3)** — 3-character answer: e.g., `N/Y/Y`. Must be answered BEFORE committing the route, not after.
- **Reason** — one short sentence: why this route. If `claude`, name the routing-rule criterion that disqualified cf-code-assist (e.g., "multi-file reasoning", "needs Context7 lookup first", "<10 lines"). If `cf-code-assist:*`, name the context Claude gathered before the call.
- **Approx tokens saved** — rough estimate if cf-code-assist was used; "n/a" otherwise. Order-of-magnitude is fine.

If a task initially went to one route then bounced to another (e.g., cf-code-assist output failed review and Claude fixed it), record both attempts and mark the row `mixed`.

---

## 3-Question Checklist (mandatory per row)

Answer these three questions BEFORE committing the route decision, not after. The answers populate the Checklist column (Q1/Q2/Q3) in the routing log.

1. **Is the SYNTHESIS step itself cross-file?** (Not the reading — the actual generation step must it produce coordinated changes across multiple files with consistency invariants?) No → still routable to cf-code-assist.
2. **Is the diff >50 lines of mechanical code?** Yes → savings beat prep cost.
3. **Is there a stable template/spec/sentinel to anchor the generation on?** Yes → cf-code-assist can use it.

If the answers are **No / Yes / Yes** → try cf-code-assist first.
If Q1 is Yes → Keep with Claude (multi-file synthesis requires Claude).
If Q2 is No and Q3 is No → Keep with Claude (context-prep overhead exceeds savings).

---

## Phase 2 candidate task shapes (planning guidance, not pre-filled log rows)

The following task shapes are flagged as cf-code-assist defaults per CONTEXT.md D-19 + RESEARCH §"cf-code-assist Routing — Additional Candidate Task Shapes". The executor still answers the 3-question checklist at execution time — these are starting hypotheses, not auto-routes.

**From CONTEXT.md D-19 (5 candidates):**

1. `scripts/sync-eval-corpus.mjs` — small JS CLI, stable template (mirrors `eval-budget-summary.mjs:1-60`). Tool: `generateCode`.
2. Sweep-test scaffold for `recall-ranking.eval.test.ts` (RNK-02..04) — vitest eval body, stable corpus + harness. Tool: `scaffoldTests`.
3. `shared/vectorize-utils/` extraction (Plan 02-01) — `vectorizeQuery` is byte-frozen verbatim from `vectorize-helper.ts:39-99`, `vectorizeNeighbors` is small new function. Tool: `generateCode`.
4. `hybrid-rank-changelog.md` initial row (RNK-05) — doc scaffold. Tool: `generateDocs`.
5. `insertConflictAsInbox` helper (CON-04) — small CRUD helper, stable SQL pattern. Tool: `generateCode`.

**From RESEARCH §"cf-code-assist Routing — Additional Candidate Task Shapes" (3 additional):**

6. Pareto-front + metric helpers (paretoFront, computeF1, computeMRR, computeTop1) — ~40 LOC pure functions with stable specs. Tool: `generateCode`.
7. This `02-CF-CODE-ASSIST-USAGE.md` scaffold itself (mirrors Phase 1 template) — under 50 lines but pure template work. Tool: `generateDocs` (gray-zone — Phase 1 precedent was `claude` for the doc-on-doc routing).
8. `shared/vectorize-utils/package.json + tsconfig.json` (mirrors `shared/ai-config` verbatim) — under 15 lines combined; only routable as part of a batch with the `src/index.ts` to amortize context-prep cost. Tool: `generateCode`.

**Task shapes that LOOK routable but should stay with Claude** (per RESEARCH):

- D-06 audit comment authoring in `shared/ai-config/src/index.ts` — byte-frozen contract, single-character drift breaks Phase 3 EXP-06 reading-comprehension.
- `conflict-pipeline.ts` orchestrator — cross-file SYNTHESIS touching conflict-detection + vectorize-utils + WorkspaceDO RPC + Analytics Engine contracts at once.
- `recall()` envelope `context.conflicts[]` SQL-join wiring — cross-file SYNTHESIS across recall handler + buildRecallResponse + new WorkspaceDO read helper + Conflict type + InboxConflictProperties mapping.
- `hybrid-rank.ts` parameterization (taking `weights` param) — small diff (~5 LOC) but the public-API impact reasoning IS the work; cf-code-assist would amplify any default-value mistake.

---

## Routing Log

| Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved |
|------|----------|-------|----------------------|--------|---------------------|
| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |
| 02-01-T3 | `02-CF-CODE-ASSIST-USAGE.md` tracker file creation | claude | N/N/N | Doc creation, not code generation — tracker rules don't apply to itself (mirrors Phase 1 `01-04-T1` precedent). | n/a |
| 02-01-T1 | `shared/vectorize-utils/{package.json,tsconfig.json,src/index.ts}` | claude | Y/N/Y | Cross-file SYNTHESIS across 3 new files with a byte-frozen extraction invariant vs `vectorize-helper.ts:39-99` (Q1=Y); the `vectorizeNeighbors` body must encode the AI-02 positional-workspaceId contract + the no-native-score-floor Vectorize fact verified via Context7 — reasoning artifact, not mechanical. | n/a |
| 02-01-T2 | `scripts/sync-eval-corpus.mjs` + `packages/{mcp-server,triage-worker}/package.json` edits + vendored `recall-corpus-v2.json` | claude | N/N/Y | Sync script is ~100 lines mechanical with a stable template (eval-budget-summary.mjs + apply-split.mjs), but effective net-new generation is under 50 lines once boilerplate strips out (Q2=N); package.json edits are sub-15-line surgical adds. Per the CLAUDE.md diff-size heuristic, context-prep beats savings at this size — default to claude. | n/a |
| 02-02-T1+T2 | `shared/ai-config/src/index.ts` (HYBRID_WEIGHTS + D-06 audit comment + HybridWeights type), `packages/mcp-server/src/hybrid-rank.ts` (import swap + local var rename + weights param), `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` (key rename + new custom-weights test) | claude | Y/N/N | Cross-file synthesis: D-06 audit comment is a byte-frozen contract + the rerank key rename must be consistent across 3 files (ai-config declaration, hybrid-rank consumer, test assertions); Q2=N (~90 LOC across 3 files, not >50 net-new mechanical lines); Q3=N (no stable codegen template — authorial precision over D-06 comment text is the work). | n/a |
| 02-02-T3 | `packages/mcp-server/src/tools.ts` (vectorizeQuery import swap), `packages/mcp-server/src/vectorize-helper.ts` (vectorizeQuery removed), `packages/mcp-server/src/__tests__/vectorize-helper.test.ts` (import path update) | claude | Y/N/N | Cross-file coordinated changes: tools.ts import, vectorize-helper.ts removal, test update — must maintain AI-02 workspace isolation invariant across the import boundary; Q2=N (<15 lines changed); Q3=N (no stable template). | n/a |
| 02-03a-T1a | `packages/mcp-server/src/__tests__/evals/seed-prep.ts` (pure deterministic curve) | claude | N/N/Y | Q1=N (single-file pure functions); Q2=N (~60 LOC but not mechanical generation — TAU constant requires domain reasoning about D-23 shape); Q3=Y (D-23/D-25 spec is stable). Borderline but Q2 is edge-case; claude wins. | n/a |
| 02-03a-T1b | `packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts` (metadata field swap: constant scope+created_at → seed-prep.ts calls) | claude | N/N/Y | Q1=N (single-file); Q2=N (<30 lines changed); Q3=Y (sentinel-anchored swap — the hardcoded lines 86-88 are the explicit target). Small diff, context-prep overhead exceeds savings. | n/a |
| 02-03a-T2 | `.planning/evals/recall-corpus.json` (add expected_args to 46 of 100 entries) + vendored `recall-corpus-v2.json` sync | claude | N/N/N | Q1=N (JSON data edits, no code synthesis); Q2=N (<50 lines added — 46 expected_args objects, each ~1-2 lines); Q3=N (no stable code template — labeling requires semantic judgment about which queries have natural-intent type/scope filters, not a mechanical transform). All three checklist answers disqualify cf-code-assist; context-prep overhead far exceeds savings for semantic labeling work. | n/a |
| 02-03a-T3a | `scripts/relabel-eval-corpus.mjs` (qwen3-reachability relabel script, ~220 LOC) | claude | N/Y/Y | Q1=N (single file); Q2=Y (~220 LOC mechanical REST API: embed loop + Vectorize query loop + rank + replacement selection + audit-field write + real-corpus pre-check + CLI shape); Q3=Y (D-31 protocol is stable spec template + sync-eval-corpus.mjs is the CLI shape anchor). Eligible for cf-code-assist; routed to claude because MCP tool surface restricted in executor subagent (cf-code-assist unavailable). | n/a |
| 02-03a-T3b | Live run of `relabel-eval-corpus.mjs` against Cloudflare (21 corpus entries relabeled, 27 real-corpus entries relabeled) | claude | — | Runtime execution + result capture is claude work (cf-code-assist cannot see API results). | n/a |
| 02-03-T1 | `recall-ranking.eval.test.ts` — thread `expected_args` into `scoreSplit`/`top1FlipRate` call sites, add `CorpusEntry.expected_args?` type field, add variance precondition assertion, add tunability assertion (HR-2 closure), add 40-60 expected_args corpus-integrity check | claude | Y/N/N | Q1=Y: cross-file awareness needed — CorpusEntry type must align with corpus fixture schema and `RecallInput.scope` union type; Q2=N: ~40 LOC surgical edits to existing test, not net-new mechanical generation; Q3=N: no stable codegen template for targeted call-site wiring. | n/a |
| 02-03-T2 | `shared/ai-config/src/index.ts` audit comment fill-in + `docs/hybrid-rank-changelog.md` first row | NOT EXECUTED | — | STOP procedure invoked: sweep RNK-06 gate failed (F1=0.3429 < 0.8254). Neither file was modified. Pending human decision on gate calibration. | n/a |
| 02-03-T2-revised | `recall-ranking.eval.test.ts` — add THRESHOLD_GRID [0.45-0.60], restructure pre-fetch to cache all topK=50 (no threshold during fetch), add per-config threshold application in scoreSplit/scoreRealSplit/top1FlipRate, add cosine-only baseline computation, recalibrate RNK-06 gate to improvement_delta ≥ 0.02 per D-34, enumerate 2500 configs (625×4 thresholds) | claude | Y/N/N | Q1=Y: cross-file type awareness needed (QueryResolution shape change, HybridWeights no threshold field — threshold is separate); Q2=N: ~100 LOC surgical structural edits to existing test, not net-new mechanical generation; Q3=N: no stable codegen template for architectural restructuring of pre-fetch + per-config threshold logic. | n/a |
| 02-03-T2-run | `shared/ai-config/src/index.ts` audit comment fill + HYBRID_WEIGHTS tuned + MIN_COSINE_THRESHOLD tuned; `docs/hybrid-rank-changelog.md` first row; `hybrid-rank.test.ts` weight assertions updated | claude | Y/N/N | Q1=Y: D-06 byte-frozen contract + threshold/weights must move together as a coordinated production change; Q2=N: ~40 LOC total changes across 3 files; Q3=N: audit-comment authoring is the work (no stable template for the cross-phase footgun warning text). | n/a |
| 02-04-T1 | `conflict-precision.eval.test.ts` — unskip + add V02_SHIP_PRECISION_THRESHOLD/V02_SHIP_RECALL_THRESHOLD constants + update gate assertion + add [CON-01] log line | claude | N/N/N | Q1=N (single file, no cross-file synthesis); Q2=N (<15 lines changed — constants + toggle + log line); Q3=N (no stable codegen template for targeted assertion rewrites). All three answers disqualify cf-code-assist; direct edit is faster than context-prep. | n/a |
| 02-04-T2 | Eval run + Linear sub-issue update (verification step) | claude | N/N/N | Runtime execution + log interpretation is Claude work; cf-code-assist cannot see test output or Linear. | n/a |
| 02-05-T1 | `shared/types/src/index.ts` — `InboxConflictProperties` interface | claude | N/N/N | Q1=N (single-file); Q2=N (~15 lines, below 50-line savings threshold); Q3=Y (stable 5-field spec from PLAN.md); diff-size heuristic: context-prep overhead exceeds savings at <15 lines. | n/a |
| 02-05-T2a | `packages/workspace-do/src/types.ts` — `InboxConflictRow` interface | claude | N/N/N | Q1=N (single-file); Q2=N (~10 lines); Q3=Y (stable SQL-row schema spec); below 15-line threshold. | n/a |
| 02-05-T2b | `packages/workspace-do/src/queries.ts` — `insertConflictAsInbox` + `listInboxConflictsForMemoryIds` + `narrowInboxConflictRow` helpers | claude | N/Y/Y | Q1=N (single-file); Q2=Y (~90 lines: narrowing helper + two query helpers); Q3=Y (stable SQL schema + existing createInboxEntry/listConflicts anchor pattern); eligible for cf-code-assist, but tool surface unavailable in executor — claude. | n/a |
| 02-05-T2c | `packages/workspace-do/src/index.ts` — `insertConflictAsInbox` + `listInboxConflictsForMemoryIds` RPC methods | claude | N/N/N | Q1=N (single-file); Q2=N (~15 lines, 2 delegation methods); Q3=Y (existing DO RPC method pattern); below 15-line threshold. | n/a |
| 02-05-T2d | `packages/workspace-do/src/__tests__/helpers.test.ts` — 5 round-trip tests (CON-04/CON-05) | claude | N/N/Y | Q1=N (single-file test); Q2=N (~80 LOC but behavioral/intentional, not mechanical generation); Q3=Y (existing test fixture pattern); direct claude — test semantics require judgment. | n/a |
| 02-06-T1 | `packages/triage-worker/src/conflict-pipeline.ts` — full CON-02 orchestrator (embed → prefilter → dupe-skip → parallel detect → inbox write → analytics) | claude | Y/N/Y | Q1=Y: cross-file SYNTHESIS — generation step coordinates conflict-detection contract + vectorize-utils contract + WorkspaceDO RPC + Analytics Engine byte-frozen schema + ai-config EMBEDDING_MODEL simultaneously; all 5 contracts must be honored in a single consistent file. Per CLAUDE.md, multi-file SYNTHESIS stays with Claude. | n/a |
| 02-06-T2 | `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` — 8 unit test cases (embed-on-entry, 5 verdict branches, CON-07 budget cap, CON-08 grep) | claude | N/Y/Y | Q1=N (single-file test); Q2=Y (~150 LOC mock-heavy test scaffold); Q3=Y (extract.test.ts is the structural template + 8 named test cases + mock setup pattern all specified); eligible for cf-code-assist, but tool surface unavailable in executor — claude. | n/a |
| 02-08-T1 | `packages/mcp-server/src/tools.ts` — CON-05 conflict hydration step + `packages/mcp-server/src/envelope.ts` — `buildRecallResponse` signature + `conflicts` conditional-spread | claude | Y/N/N | Q1=Y: cross-file SYNTHESIS — generation step touches recall handler + buildRecallResponse signature + new WorkspaceDO RPC + Conflict type + InboxConflictProperties mapping; cross-file consistency invariants throughout. Multi-file SYNTHESIS stays with Claude. | n/a |

---

## End-of-Phase Summary

_TBD — populated at /gsd:verify-work 2 close._
