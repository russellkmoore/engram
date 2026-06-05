# Phase 2: Recall Quality Baseline - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Stabilize hybrid-rank weights against the 100-entry labeled corpus from PRE-03 AND wire ENG-16's `detectConflict()` scaffold into the live triage flow. Two parallel-trackable workstreams: **(A) Hybrid-rank tuning** (`packages/mcp-server` + `shared/ai-config`) and **(B) Conflict-detection wiring** (`packages/triage-worker` + `packages/mcp-server`'s `recall()` envelope). RNK must land before CON in commit order — Phase 3's RRF merge fuses against `hybridRank` output and tuning weights post-RRF entangles variables (PITFALLS HR-6).

**Out of phase boundary:** RRF / multi-query expansion (Phase 3), bge-reranker model invocation (Phase 3 EXP-06 — but the constant name lands here), synthesis evals (Phase 4), kitchen-sink composition (Phase 5), `conflict()` MCP tool (v0.3), inbox UI (v0.4), proactive notifications (forbidden architecturally).

</domain>

<decisions>
## Implementation Decisions

### Grid search axis + value choice (RNK-01..04)

- **D-01:** Sweep all 4 weights × 5 values = 625 configs, symmetric around current defaults so the v0.1 weights sit at the center (index 2) of each axis. Concrete grid:
  - `cosine ∈ {0.6, 0.8, 1.0, 1.2, 1.5}` (current default: 1.0)
  - `recency ∈ {0.05, 0.10, 0.15, 0.20, 0.30}` (current default: 0.15)
  - `type_match ∈ {0.10, 0.15, 0.20, 0.25, 0.35}` (current default: 0.20)
  - `scope_match ∈ {0.05, 0.10, 0.15, 0.20, 0.30}` (current default: 0.15)
- **D-02:** RNK-04 sensitivity analysis (±0.05) maps directly onto adjacent grid neighbors — no separate sensitivity sweep needed; the gating check reuses sweep output.
- **D-03:** Selection rule (already locked by RNK-02): Top-3 configs by F1 are re-scored by MRR + top-1 accuracy on the train split; the Pareto front decides the winner. F1-only selection is forbidden (PITFALLS HR-2 reward-hacking).
- **D-04:** Convergence gate (already locked by RNK-03): train→validate F1 gap **< 10 percentage points strict** (e.g., 0.85 train / 0.76 validate = 9pp = pass; 0.85 / 0.75 = 10pp = fail). Decision in the boundary case is REJECT — small validate split (30 entries) means boundary configs are statistically indistinguishable from overfits.

### Hybrid-rank weight key naming (cross-phase contract with EXP-05)

- **D-05:** Phase 2 renames `HYBRID_WEIGHTS.cosine` → `HYBRID_WEIGHTS.rerank` **NOW**. Tuned values land under `rerank` in `shared/ai-config/src/index.ts`. Phase 3 EXP-06 will swap the score *source* from raw cosine (`match.score`) to bge-reranker output without further structural change to `HYBRID_WEIGHTS`.
- **D-06:** **MANDATORY AUDIT COMMENT** in `shared/ai-config/src/index.ts` next to the `HYBRID_WEIGHTS` literal — must spell out the cross-phase footgun verbatim:
  > // v0.2 Phase 2: `rerank` weight values tuned against RAW COSINE (`match.score` from Vectorize).
  > // bge-reranker invocation lands in Phase 3 (EXP-06). Until then, `HYBRID_WEIGHTS.rerank * match.score`
  > // means "raw-cosine weighted by the tuned rerank weight." Do NOT read `HYBRID_WEIGHTS.rerank` as
  > // "reranker active" in v0.2.
  > // Corpus: .planning/evals/recall-corpus.json (100 entries, qwen3-embedding-0.6b, sweep date YYYY-MM-DD)
  > // Scores: F1=X.XX, MRR=X.XX, top1=X.XX
  > // Re-tune at v0.3 when corpus grows.
- **D-07:** `packages/mcp-server/src/hybrid-rank.ts` formula stays structurally identical (`score = w_rerank·s + w_recency·r + w_type·t + w_scope·sc`), only the local variable / weight key reference renames. The literal `match.score` (Vectorize cosine output) is what feeds `w_rerank` in v0.2.

### Conflict-pipeline neighbor query strategy (CON-02)

- **D-08:** New shared package `shared/vectorize-utils/` (follows the existing `shared/types`, `shared/ai-config` pattern). Exports BOTH:
  - `vectorizeNeighbors(env, workspaceId, vector, opts: { topK, type?, scope?, threshold })` — for the conflict prefilter (top-K=3 same-type same-workspace at ≥0.7 cosine per CON-02)
  - `vectorizeQuery(env, workspaceId, queryEmbedding, opts: { topK, types?, scope? })` — extracted verbatim from the existing helper currently inside `packages/mcp-server/src/` (recall-path entry point with OVERFETCH multiplier + MIN_COSINE_THRESHOLD filter)
- **D-09:** Phase 2 RNK workstream owns the extraction + recall-path import swap (mcp-server `tools.ts` recall handler imports from `shared/vectorize-utils` instead of local helper). This is the only structural change to the recall path in Phase 2 — weight tuning is values-only otherwise.
- **D-10:** Both helpers return Vectorize matches in identical shape; no schema differences across the two callers. Filter union: `{ workspace_id }` is mandatory (cross-workspace isolation lock), `{ type, scope }` are optional and stack as `$in` filters.

### Eval corpus single-source-of-truth (RNK-01, RNK-06)

- **D-11:** `.planning/evals/recall-corpus.json` (100 entries, 70/30 train/validate, qwen3-embedding-0.6b stamped) is the **authoritative editing surface** — humans label there.
- **D-12:** Phase 2 vendors a copy into `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` (package-local for vitest discipline — no cross-tree relative paths). Top-of-file comment marks it as auto-synced.
- **D-13:** New `scripts/sync-eval-corpus.mjs` (monorepo-root) copies `.planning/evals/recall-corpus.json` → `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json`. Wire into a `pretest:eval` npm script in the mcp-server package so the sync runs before eval-tier execution.
- **D-14:** Existing `packages/mcp-server/src/__tests__/evals/fixtures/{real-corpus.json, reference-corpus.json}` (27 + 20 entries) **stay in place**. Existing `recall-f1.eval.test.ts` continues running against them — it becomes the **RNK-06 baseline-comparison check** ("did v0.2 weights regress against v0.1's 27-entry F1 = 0.8254?"). New `recall-ranking.eval.test.ts` runs the 625-config sweep against the 100-entry corpus.
- **D-15:** RNK-06 gate is satisfied by BOTH (a) sweep-winner F1 on 100-entry corpus ≥ 0.8254 AND (b) sweep-winner weights re-scored on the 27-entry corpus ≥ 0.8254. If (a) passes but (b) regresses, that's the small-N caveat in action — the planner must surface this as a decision point, not auto-merge.

### Cross-workstream landing order

- **D-16:** RNK plans land in main BEFORE CON plans land. Reason: Phase 3 RRF merge (EXP-04) fuses against `hybridRank` output; tuning weights AFTER RRF lands entangles variables (PITFALLS HR-6). Operational implication for the planner: RNK is plans 02-01..02-N, CON is plans 02-(N+1)..02-M, and the wave structure must respect this order. Parallel work in branches is fine; merge-to-main is serialized.
- **D-17:** Two Linear sub-issues under the Phase 2 ENG issue, one per workstream (RNK + CON). Scope warrants it per ROADMAP's parallel-track note.

### CON-01 prompt re-eval failure procedure

- **D-18:** CON-01 says "if precision <0.85 OR recall <0.90, planning re-opens the prompt." Operational definition for execution: if the 30-pair `conflict-precision.eval.test.ts` returns below either threshold, the executor STOPS, logs a `gsd-add-blocker`-style blocker on the Linear sub-issue, and `/clear`-then-`/gsd:plan-phase 2 --replan-section conflict-prompt`. The executor MUST NOT silently retune the prompt — that path leads to PITFALLS CD-2 drift.

### Phase 2 cf-code-assist routing tracker

- **D-19:** Follow the Phase 1 PRE-05 pattern: create `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` (scaffolded with the same 3-question-checklist columns as Phase 1). Every code-producing task in Phase 2 appends one row. Specific Phase 2 task shapes that should default to cf-code-assist:
  - `scripts/sync-eval-corpus.mjs` (`generateCode` — 5-line file-copy with header comment)
  - `recall-ranking.eval.test.ts` sweep test scaffold (`scaffoldTests` — 625-iteration grid loop, F1/MRR/top-1 metric helpers, train/validate split assertion)
  - `shared/vectorize-utils/src/index.ts` extraction + `package.json` + `tsconfig.json` (`generateCode` once the contracts are pinned — D-08, D-10)
  - `docs/hybrid-rank-changelog.md` initial row (`generateDocs` from sweep results + audit comment text)
  - `packages/workspace-do/src/queries.ts` new `insertConflictAsInbox` helper (`generateCode` — straight SQL insert against the inbox table; signature pinned by CON-04)
  Tasks that stay with Claude: HYBRID_WEIGHTS audit comment authoring (D-06 byte-frozen contract), `conflict-pipeline.ts` orchestrator (cross-file SYNTHESIS step — touches workspace-do RPC + Vectorize + inbox + telemetry), the `recall()` envelope `context.conflicts[]` SQL-join wiring (CON-05 — touches handler + buildRecallResponse + Conflict type).

### Conflict-pipeline observability (CON-07 4s p99 budget)

- **D-20:** Conflict-pipeline emits an Analytics Engine `writeDataPoint` per scan with `blobs[0]="conflict-pipeline"`, `blobs[1]=<verdict: contradiction|benign_update|unrelated|skipped-dupe>`, `doubles[0]=latency_ms`, `doubles[1]=neighbors_examined`. ANALYTICS binding already exists on the triage-worker (currently a stub for type-safety per Phase 1 scout). Phase 2 activates it for conflict-scan telemetry. The 4s p99 budget is verified via GraphQL nightly summary in `scripts/eval-budget-summary.mjs` (extend the existing PRE-02 script).

### Hybrid-rank changelog seeding (RNK-07)

- **D-21:** New file `docs/hybrid-rank-changelog.md` lands with header + one row for the v0.2 sweep. Per-row fields: `date`, `corpus_filename`, `corpus_size`, `corpus_split`, `embedding_model`, `weights {rerank, recency, type_match, scope_match}`, `F1_train`, `F1_validate`, `MRR_train`, `top1_train`, `sensitivity_pass_rate`, `notes`. Reserved future-row column: `bge_reranker_active` (boolean — Phase 3 sets to true).

### Claude's Discretion

- Sweep test parallelization strategy (sequential vs `Promise.all` chunks — bounded by MAX_AI_CALLS=200 budget which the sweep MUST NOT exceed; the corpus already has 100 entries × ~3 embedding lookups per config is the real bound, not the 625 configs)
- Exact data structure for the Pareto-front result (TS interface details, JSON serialization)
- `recall-ranking.eval.test.ts` test naming + describe block structure
- `vectorizeNeighbors` internal implementation (loop over Vectorize results + cosine threshold filter, or use Vectorize's native `topK` + filter syntax — whichever resolves cleaner with the existing binding shape)
- Local variable rename inside `hybrid-rank.ts` (e.g., `cosineScore` → `rerankScore`) to match D-05's key rename
- Conflict-pipeline source-file organization (one file with three named functions vs three files — orchestrator + neighbor-fetch + inbox-write — whichever passes review cleanest)

</decisions>

<specifics>
## Specific Ideas

- **Audit comment as load-bearing artifact.** D-06's audit comment is the documentation safety net for the `rerank` key naming footgun. Treat it as part of the contract, not a code comment afterthought. Any future reader of `shared/ai-config/src/index.ts` should understand the cross-phase state from that comment alone.
- **Keep the 27-entry baseline alive.** D-14's posture — keep `real-corpus.json` running as the regression check — is deliberately conservative. The 27 entries were Russell's manual labels from v0.1 production logs; they're the closest thing to a known-good baseline. Losing them = losing the apples-to-apples F1 compare against v0.1.
- **No notifications, anywhere, ever (CON-08).** Any reviewer comment of the form "we could just ping the user when a conflict appears" is OUT of scope and OUT of architectural alignment. The inbox-only surface is the catastrophic adoption gate per PITFALLS CD-1. Capture in `<deferred>` if it comes up.
- **30-pair eval, not 50-pair.** ROADMAP §"Phase 2 Success Criteria #4" says "50-pair eval" but REQUIREMENTS CON-01 and the live fixture (`packages/triage-worker/src/__tests__/evals/fixtures/conflict-pairs.json` `_meta.target_size = 30`, `current_size = 30`) say 30. **Use 30.** The ROADMAP wording is stale; the fixture is authoritative.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + acceptance criteria (locked requirements)

- `.planning/REQUIREMENTS.md` §"Hybrid-Rank Tuning (RNK)" lines 25–33 — RNK-01..07 acceptance criteria
- `.planning/REQUIREMENTS.md` §"Conflict-Detection Wiring (CON)" lines 35–44 — CON-01..08 acceptance criteria
- `.planning/ROADMAP.md` §"Phase 2: Recall Quality Baseline" lines 76–105 — phase goal, success criteria, risk notes, parallel-track ordering

### v0.2 research synthesis (the WHY behind each lock)

- `.planning/research/v0.2-SUMMARY.md` — source-of-truth synthesis across the four v0.2 research streams
- `.planning/research/v0.2-PITFALLS.md` — HR-1..6 (hybrid-rank), CD-1..5 (conflict-detection), INT-1..6 (integration) mitigation rationale referenced by every Phase 2 risk note
- `.planning/research/v0.2-STACK.md` — bge-reranker decision context (relevant for D-05 `rerank` key rename rationale)
- `.planning/research/v0.2-INTEGRATION-MATRIX.md` — RNK×CON Phase 2 closure row + downstream RNK×EXP / RNK×CON×EXP×SYN composition rows

### Existing code (Phase 2 modifies / extends)

- `packages/mcp-server/src/hybrid-rank.ts` — current `hybridRank` function + formula (`score = cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15`, 30-day half-life). Phase 2 renames the local cosine variable + ai-config key reference per D-05/D-07.
- `shared/ai-config/src/index.ts` lines 44–49 — current `HYBRID_WEIGHTS`. Phase 2 commits tuned values here per D-05/D-06.
- `packages/mcp-server/src/tools.ts` ~line 596 — `hybridRank` invocation in `recall()`. Phase 2 updates the Vectorize-helper import to `shared/vectorize-utils` per D-09.
- `packages/mcp-server/src/tools.ts` `buildRecallResponse(...)` — extension point for CON-05 `context.conflicts[]` SQL-join wiring.
- `packages/triage-worker/src/index.ts` lines 214–242 — `store-normal` branch, the insertion point for `ctx.waitUntil(conflictPipeline(...))` after `updateBlockEnrichment` per CON-03.
- `packages/triage-worker/src/conflict-detection.ts` lines 100–112 — `CONFLICT_DETECTION_PROMPT` (the prompt CON-01 re-evals before wiring). DO NOT modify without CON-01 re-run.
- `packages/triage-worker/src/conflict-detection.ts` `detectConflict()` signature — what `conflict-pipeline.ts` invokes per CON-02.
- `packages/workspace-do/src/queries.ts` `listConflicts` (lines 511–530) — read-side existing pattern. Phase 2 adds an `insertConflictAsInbox(sql, { memory_a_id, memory_b_id, category, ai_confidence, description })` helper writing to the `inbox` table per CON-04.
- `packages/workspace-do/src/schema.ts` `inbox` table definition — column shape `proposed_type="conflict"` writes target.
- `shared/types/src/index.ts` lines 172–192 (`Conflict` type), lines 210–258 (`EngramResponse<T>`, including the `context.conflicts?: Conflict[]` field already declared). Phase 2 populates the field, doesn't redefine the type.

### Eval infrastructure (Phase 1 carry-forward)

- `.planning/evals/recall-corpus.json` — 100-entry labeled corpus, 70/30 train/validate split, qwen3-embedding-0.6b stamped. **Authoritative editing surface** per D-11.
- `packages/mcp-server/src/__tests__/evals/fixtures/real-corpus.json` (27 entries) — v0.1 baseline reference per D-14, retained for RNK-06 regression check.
- `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` (20 entries) — synthetic seed, retained alongside real-corpus.
- `packages/mcp-server/vitest.config.ts` — `eval` tier config with `hasEvalCreds` gate + `MAX_AI_CALLS=200` budget + `eval-budget.setup.ts` enforcement. Phase 2 sweep runs in this tier.
- `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` — budget enforcement primitive. Sweep test must respect this.
- `scripts/eval-budget-summary.mjs` — GraphQL nightly summary script. Extend for CON-07 4s-p99 budget verification per D-20.
- `packages/triage-worker/src/__tests__/evals/fixtures/conflict-pairs.json` — 30-pair conflict eval fixture (NOT 50; ROADMAP wording is stale per `<specifics>`). `_meta.target_size = 30`, currently READY.
- `packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts` — the CON-01 re-eval test. Currently `.skip`ed; Phase 2 unskips and runs once locally.

### Phase 1 (Foundation) artifacts (decisions Phase 2 inherits)

- `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` — Phase 1 routing tracker pattern Phase 2 follows per D-19
- `.planning/phases/01-foundation-wave-0/01-VERIFICATION.md` — confirms PRE-01..05 completion (no re-litigation in Phase 2)
- `.planning/phases/01-foundation-wave-0/01-PATTERNS.md` — codebase patterns Phase 2 should match (verified during Phase 1 mapping)

### Architectural baselines

- `CLAUDE.md` — repository architectural baseline ("What Goes Where" routing rules, MCP tool surface contract, MemoryEvent universal-primitive contract)
- `.planning/PROJECT.md` — project north star + key-decisions log (D-7 verbosity default = `chunks` is locked here, relevant for the "don't accidentally promote synthesis in this phase" guardrail)
- `.claude/skills/spike-findings-engram/SKILL.md` — spike-003 ranking-strategy finding ("hybrid ranking is REQUIRED, not optional" per bge-base-en-v1.5 cross-bucket cosine 0.8251 > intra-bucket 0.6472)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`packages/mcp-server/src/hybrid-rank.ts`** — pure functional rank engine, immutable spreads, O(1) lookup map. Phase 2 keeps the function shape and only swaps the weight-key reference per D-05/D-07.
- **`packages/triage-worker/src/conflict-detection.ts`** — `detectConflict()` already returns a `ConflictOutput | null` with categories `["contradiction", "benign_update", "unrelated"]` + confidence + reason via Workers AI JSON Mode. Phase 2 wraps it, doesn't reimplement it.
- **`packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts`** — MAX_AI_CALLS=200 budget primitive. The 625-config sweep MUST plan around this — embeddings are cached, but any AI calls (e.g., re-scoring with a different prompt) count.
- **`scripts/eval-budget-summary.mjs`** (Phase 1 PRE-02) — GraphQL nightly summary reporter. Extend for CON-07 4s-p99 budget verification per D-20.
- **`packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts`** — already exists with the 30-pair fixture wired, currently `.skip`ed. CON-01 just unskips + runs.
- **Vectorize metadata-filter pattern** — existing `vectorizeQuery` (mcp-server `tools.ts` ~line 564) already passes `filter: { type: { $in: types } }`. Phase 2 extends the pattern with `workspace_id` (mandatory cross-workspace isolation) + optional `scope` to the new `vectorizeNeighbors` helper per D-08.

### Established Patterns

- **shared/<name>/src/index.ts pattern** — existing `shared/types`, `shared/ai-config`, `shared/schema`. New `shared/vectorize-utils` follows the same package.json + tsconfig + index.ts shape per D-08. No build-order surprises; npm workspaces resolves automatically.
- **`ctx.waitUntil()` for fire-and-forget** — mcp-server `remember()` already uses `ctx.waitUntil()` for queue sends (tools.ts ~lines 453–474). Phase 2 CON-03 mirrors this pattern in `packages/triage-worker/src/index.ts` for the conflict scan. Pattern is established, just not yet used in the triage worker.
- **eval-tier `hasEvalCreds` gate** — Phase 1 PRE-02 idiom. New `recall-ranking.eval.test.ts` follows it identically (conditional inclusion when `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are set).
- **Analytics Engine stub-to-active** — triage-worker's `ANALYTICS` binding is currently a stub for type-safety. Activating it for conflict-pipeline telemetry per D-20 is purely additive — no binding change in `wrangler.jsonc` needed.
- **Audit-comment-as-contract** — `shared/ai-config/src/index.ts` already has audit-comment idiom near the model-ID constants (ENG-25 dated comment). D-06's `HYBRID_WEIGHTS` audit comment follows the same convention.
- **Workspace isolation lock** — every Vectorize query, every DO RPC, every conflict-pipeline neighbor fetch goes through `workspace_id` as the mandatory filter. PITFALLS INT-3 cross-workspace leak is the catastrophic v0.4 multi-tenant risk; Phase 2 must not introduce a code path that omits this filter (D-10 makes it mandatory in the new helper).

### Integration Points

- **`recall()` handler in `packages/mcp-server/src/tools.ts`** — modified by both workstreams. RNK swaps Vectorize-helper import (D-09). CON adds the `context.conflicts[]` SQL-join (CON-05). Merge-order discipline matters: RNK lands first per D-16.
- **`store-normal` branch in `packages/triage-worker/src/index.ts`** lines 214–242 — single insertion point for `ctx.waitUntil(conflictPipeline(...))` after `updateBlockEnrichment` per CON-03. Surgical insertion, no surrounding refactor.
- **`shared/ai-config/src/index.ts` `HYBRID_WEIGHTS` literal** — the RNK end-state commit landing site. D-06's audit comment is part of the commit.
- **WorkspaceDO RPC surface** — `insertConflictAsInbox(...)` is a new RPC method on `WorkspaceDO`. Both workers call it (triage via the cross-Worker `WORKSPACE` binding; mcp-server's `recall()` only reads, not writes). The cross-Worker RPC pattern is established in Phase 1 (the `WORKSPACE` binding with `script_name: engram-mcp-server` on the triage-worker side is already wired).
- **Linear sub-issues** — two sub-issues under the Phase 2 ENG issue per D-17. The planner's first task per workstream is creating the sub-issue and linking it.

</code_context>

<deferred>
## Deferred Ideas

- **Conflict notifications / digest emails / Slack pings** — explicitly forbidden in v0.2 per CON-08 + PITFALLS CD-1. Captured in v0.4 (`Connectors + Alerts` milestone). Any reviewer suggesting "we could just ping" must be redirected to v0.4 backlog.
- **`conflict()` MCP tool** — v0.3 work. The `conflicts` table remains UNUSED in v0.2 per CON-04 — it's reserved for the v0.3 dedicated tool.
- **bge-reranker actual invocation** — Phase 3 EXP-06 ships the score-source swap from raw cosine to reranker output. Phase 2 ships the `rerank` key name + the constant `RERANKER_MODEL = "@cf/baai/bge-reranker-base"` lands in Phase 3 EXP-05.
- **Multi-query expansion + RRF** — Phase 3 EXP-01..04.
- **Synthesis path activation** — Phase 4 (SYN-01..10). Phase 2 must NOT promote `verbosity=both` as default — D-7 in PROJECT.md is the lock.
- **v0.3 re-tune of HYBRID_WEIGHTS** — RNK-05 audit comment includes the "re-tune at v0.3 if corpus grows" follow-up note. Captured as a v0.3 backlog item.
- **Inbox UI** — v0.4. Conflicts surfaced in `recall()` envelope are the v0.2 surface (CON-05); no UI ships.
- **Verbosity-default flip discussion** — uses Phase 4 SYN-09 analytics; v0.3 work.

</deferred>

---

*Phase: 02-recall-quality-baseline*
*Context gathered: 2026-06-05*
