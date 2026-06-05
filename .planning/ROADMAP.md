# Roadmap: Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Updated:** 2026-06-02 (v0.2 milestone started)

> Per-milestone archives live in `.planning/milestones/`. This file is the rolling project view PLUS the detailed roadmap for the currently in-flight milestone (v0.2).

## Milestones

- ✅ **v0.1 MCP Foundation** — Phases 1-7 (shipped 2026-05-30) — see [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- 🚧 **v0.2 Intelligence Layer** — Phases 1-5 (in flight; target 2026-06-21)
- 📋 **v0.3 Workspaces + Memory Types** — target 2026-07-12 (planned)
- 📋 **v0.4 Connectors + Alerts** — target 2026-08-02 (planned)
- 📋 **v1.0 Public Launch** — target 2026-09-01 (planned)

## Phases

<!-- markdownlint-disable MD033 -- collapsible <details> required for GitHub render of completed milestones -->
<details>
<summary>✅ v0.1 MCP Foundation (Phases 1-7) — SHIPPED 2026-05-30</summary>

- [x] **Phase 1: Foundation** — completed 2026-05-25 (6/6 plans)
- [x] **Phase 2: WorkspaceDO + SQLite** — completed 2026-05-26 (9/9 plans)
- [x] **Phase 3: MCP Server Scaffold** — completed 2026-05-26 (6/6 plans)
- [x] **Phase 4: Core Tools + Envelope** — completed 2026-05-27 (7/7 plans)
- [x] **Phase 5: AI Integration** — completed 2026-05-28 (7/7 plans)
- [x] **Phase 6: Async Pipeline** — completed 2026-05-29 (5/5 plans)
- [x] **Phase 7: Deploy + Acceptance** — completed 2026-05-30 (4/4 plans)

Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)

</details>
<!-- markdownlint-enable MD033 -->

### 🚧 v0.2 Intelligence Layer (In Flight)

**Linear Milestone:** v0.2 — Intelligence Layer (target 2026-06-21)
**Granularity:** standard (horizontal layers)
**Mode:** standard
**Coverage:** 44 requirements / 44 mapped to phases / 0 unmapped
**Source-of-truth research synthesis:** [research/v0.2-SUMMARY.md](research/v0.2-SUMMARY.md)
**Phase numbering reset to Phase 1.** v0.1's phases 1–7 are archived under `milestones/v0.1-phases/`.

> v0.2 adds 4 net-new capabilities on top of v0.1's foundation. Phases are dependency-ordered: Foundation (Wave 0 prerequisites) → Recall Quality Baseline (hybrid-rank + conflict-wiring, parallel-trackable) → Query Expansion + Reranker → Synthesis Activation Eval → Integration Kitchen Sink.

- [x] **Phase 1: Foundation (Wave 0)** — Re-embed audit, tiered test strategy, eval-corpus expansion (27 → 100+), integration-matrix doc, CF-code-assist routing scaffolding (completed 2026-06-04)
- [ ] **Phase 2: Recall Quality Baseline** — Hybrid-rank weight tuning + conflict-detection wiring (parallel-trackable: different workers, no shared files)
- [ ] **Phase 3: Query Expansion + Reranker** — Multi-query + RRF + bge-reranker integration in `recall()` with adaptive routing
- [ ] **Phase 4: Synthesis Activation Eval** — Promote scaffolded `verbosity=synthesis|both` path with LLM-judge faithfulness gate; default stays `chunks`
- [ ] **Phase 5: Integration Kitchen Sink** — Cross-feature integration tests + envelope budget audit + extended cross-workspace pentest

#### Phase 1: Foundation (Wave 0)

**Goal:** Pre-flight checks pass and the eval corpus is large enough to make every downstream gate statistically meaningful. No feature code ships in this phase — it sets the testing discipline and unblocks Phase 2.

**Depends on:** v0.1 shipped (already in production as of 2026-05-30)

**Requirements:** PRE-01, PRE-02, PRE-03, PRE-04, PRE-05

**Success Criteria:**

1. Migration audit: `SELECT COUNT(*) FROM blocks WHERE embedding_version < 2 OR embedding_model != '@cf/qwen/qwen3-embedding-0.6b'` returns 0 across every workspace; the assertion runs as a CI step that fails on regression (PRE-01).
2. Tiered vitest configuration: `unit` / `integration` / `eval` tiers exist; `integration` and `eval` expose CF API token + account ID; `eval` enforces `MAX_AI_CALLS ≤ 200` per run with a daily neuron-consumption summary (PRE-02).
3. `.planning/evals/recall-corpus.json` contains ≥100 labeled `query → expected_top_3_block_ids` pairs with a documented 70/30 train/validate split. Source queries drawn from v0.1 production recall logs + ingested Notion/Drive snippets (PRE-03).
4. `.planning/research/v0.2-INTEGRATION-MATRIX.md` enumerates the cross-feature combinations that must have end-to-end coverage by milestone close (PRE-04).
5. `.planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md` scaffolded with 3-question-checklist columns; every code-producing task in v0.2 appends a row (PRE-05).

**Risk Notes:**

- **PRE-01 is a catastrophic gate.** The 768d→1024d embedding switch in ENG-25 is silently destructive if any v1-stamped rows survive. PR check must reject any non-zero count. (PITFALLS INT-1.)
- **Corpus expansion (PRE-03) is the single biggest de-risk lever** for the entire milestone. Phase 2/3/4 eval gates rest on this. Russell's manual labeling time (~3–4 hours) is the critical path — schedule explicitly, not as "best effort."
- **Eval cost (PRE-02) compounds across the milestone.** With 4 features each adding eval suites, the `MAX_AI_CALLS=200` budget guard is the only thing standing between disciplined testing and CI bill-shock. (PITFALLS INT-2.)

**Linear:** Maps to milestone "v0.2 — Intelligence Layer" — one ENG issue at phase start per CLAUDE.md Linear sync rule.

#### Phase 2: Recall Quality Baseline

**Goal:** Stabilize hybrid-rank weights against the expanded corpus AND wire ENG-16's conflict detection into the live triage flow. Two work streams that can run in parallel because they touch different Workers (mcp-server vs triage-worker) with no shared files.

**Depends on:** Phase 1 (needs the expanded corpus from PRE-03 + tiered tests from PRE-02)

**Requirements:** RNK-01, RNK-02, RNK-03, RNK-04, RNK-05, RNK-06, RNK-07, CON-01, CON-02, CON-03, CON-04, CON-05, CON-06, CON-07, CON-08

**Success Criteria:**

1. Hybrid-rank weight sweep ran a coarse grid search over 4 weights × 5 values (625 configs), produced a Pareto front by F1 + MRR + top-1 accuracy, and the winning weights were re-scored on the held-out validate split with train→validate F1 gap < 10pp (RNK-01..04).
2. Winning `HYBRID_WEIGHTS` values are committed to `shared/ai-config/src/index.ts` with an audit comment naming corpus filename, sweep date, and F1/MRR/top-1 scores (RNK-05).
3. F1 against the labeled corpus is ≥ v0.1 baseline; MRR ≥ v0.1 baseline. `docs/hybrid-rank-changelog.md` records the v0.2 changes and the small-N caveat (RNK-06, RNK-07).
4. ENG-16's 50-pair eval re-runs against current memorability rubric BEFORE wiring goes live; precision ≥ 0.85 and recall ≥ 0.90, else the prompt re-opens (CON-01).
5. `packages/triage-worker/src/conflict-pipeline.ts` exists; cosine prefilter top-3 same-type same-workspace neighbors at ≥0.7 cosine; bounded parallel `detectConflict()` calls; per-write conflict-call budget = 3 (CON-02, CON-07).
6. `conflictPipeline(...)` is invoked via `ctx.waitUntil(...)` in the `store-normal` branch of `packages/triage-worker/src/index.ts` AFTER `updateBlockEnrichment` — never blocks the ingest-response path (CON-03).
7. Contradictions are written to the `inbox` table with `proposed_type="conflict"` and `proposed_properties = {memory_a_id, memory_b_id, category, ai_confidence, description}`. The `conflicts` table remains UNUSED in v0.2 (CON-04).
8. `EngramResponse.context.conflicts[]` in `recall()` is populated via SQL join surfacing any inbox-pending `proposed_type="conflict"` rows whose `memory_a_id` or `memory_b_id` matches a returned memory. No new MCP tool added (CON-05).
9. Dupe guard at cosine ≥ 0.92 skips scoring; `created_at` diff > 180 days defaults to `severity="low"` (CON-06).
10. No proactive notifications, anywhere, ever — pull-only inbox + envelope surfacing (CON-08).

**Risk Notes:**

- **PITFALLS HR-1 + HR-4 (small-N overfit).** Train/validate split is mandatory; rejecting any tune with > 10pp gap is the only defense against marketing a result as a finding.
- **PITFALLS HR-2 reward hacking.** Scoring by F1 alone is dangerous; the Pareto front by F1+MRR+top-1 is the explicit mitigation (RNK-02). Don't drop MRR even if it makes the chart noisier.
- **PITFALLS CD-1 trust erosion.** No notifications is a hard architectural lock. Any "we could just ping the user when a conflict appears" suggestion during execution is OUT of scope. The inbox-only surface is the catastrophic adoption gate.
- **PITFALLS CD-2 prompt drift.** Re-running ENG-16's 50-pair eval BEFORE wiring goes live (CON-01) catches the case where SYSTEM_PROMPT changes since ENG-25 silently invalidated the original precision/recall numbers.
- **Parallel-track risk.** RNK and CON plans can run in parallel but the final commit ordering matters: land RNK first because Phase 3's RRF merge fuses against `hybridRank`'s output. Tuning weights AFTER RRF lands entangles variables (PITFALLS HR-6).

**Linear:** Maps to milestone "v0.2 — Intelligence Layer" — one ENG issue per phase; sub-issues for the RNK and CON plans if scope warrants.

**Plans:** 2/9 plans executed

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — RNK Wave 0: shared/vectorize-utils package + sync-eval-corpus.mjs + vendored corpus fixture + cf-routing tracker scaffold

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — RNK refactor: move HYBRID_WEIGHTS to @engram/ai-config with D-05 rename + D-06 audit-comment placeholder; parameterize hybridRank on weights; tools.ts import swap (D-09)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-03-PLAN.md — RNK sweep: 625-config recall-ranking eval + Pareto + sensitivity + D-15 dual-corpus gate; commit tuned weights + complete D-06 audit comment + seed hybrid-rank-changelog.md

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 02-04-PLAN.md — CON-01 prerequisite gate: unskip conflict-precision eval + assert P≥0.85, R≥0.90; D-18 STOP procedure on failure

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 02-05-PLAN.md — CON workspace-do queries: insertConflictAsInbox + listInboxConflictsForMemoryIds + RPC methods + InboxConflictProperties contract type

**Wave 6** *(blocked on Wave 5 completion)*

- [ ] 02-06-PLAN.md — CON conflict-pipeline orchestrator: prefilter → dupe-skip → parallel detect → inbox write → analytics + CON-08 architectural lock

**Wave 7** *(blocked on Wave 6 completion)*

- [ ] 02-07-PLAN.md — CON triage-worker wiring: ctx.waitUntil(conflictPipeline(...)) in store-normal branch after updateBlockEnrichment; embedding reuse

**Wave 8** *(blocked on Wave 7 completion)*

- [ ] 02-08-PLAN.md — CON recall envelope: context.conflicts[] SQL-join wiring with severity bucketing + lint-node grep gate for notification primitives

**Wave 9** *(blocked on Wave 8 completion)*

- [ ] 02-09-PLAN.md — CON observability: eval-budget-summary.mjs --conflict-pipeline-p99 mode for CON-07 4s p99 budget verification

#### Phase 3: Query Expansion + Reranker

**Goal:** Activate the multi-query expansion + RRF merge + bge-reranker rerank path in `recall()`. The largest single user-facing latency change in v0.2.

**Depends on:** Phase 2 (RNK weights must be stable before RRF is layered on; CON-05 envelope extension lands in the same `recall()` handler being modified)

**Requirements:** EXP-01, EXP-02, EXP-03, EXP-04, EXP-05, EXP-06, EXP-07, EXP-08, EXP-09, EXP-10, EXP-11, EXP-12

**Success Criteria:**

1. `packages/mcp-server/src/query-expansion.ts` exports `expandQuery(env, originalQuery): Promise<string[]>`; the prompt is zod-gated; the result is always `[original, paraphrase1, paraphrase2]` with original at variant[0] (EXP-01).
2. Variant similarity gate: each paraphrase is kept only if `cosine(original, paraphrase) ≥ 0.85`; failing variants are silently dropped (EXP-02).
3. Adaptive routing: `recall()` issues a single-query pass first; the multi-query fan-out only fires if `top1_cosine < 0.65` (EXP-03).
4. `packages/mcp-server/src/rrf.ts` exports `reciprocalRankFusion(lists, k=60)` — pure transform, unit-tested against reference vectors from Elasticsearch / AI21 docs (EXP-04).
5. `shared/ai-config/src/index.ts` gains `RERANKER_MODEL = "@cf/baai/bge-reranker-base"`; `HYBRID_WEIGHTS.cosine` is renamed `HYBRID_WEIGHTS.rerank` (EXP-05).
6. bge-reranker is invoked between RRF merge and `hybridRank`; reranker-score replaces raw cosine in the rank formula; reranker failure falls back to raw cosine via the v0.1 `safeRun` discipline (EXP-06).
7. Plan-internal weight sweep validates reranker contribution against the expanded corpus; if the reranker doesn't beat raw cosine by ≥ 3% precision@5, ship with `HYBRID_WEIGHTS.rerank = 0.0` and document in `docs/hybrid-rank-changelog.md` (EXP-07).
8. `QUERY_EXPANSION_MODEL` stays aliased to Scout; `query-expansion-recall.eval.test.ts` A/B tests `@cf/meta/llama-3.2-3b-instruct` vs Scout. Promotion to 3.2-3b is a follow-on PR if recall@5 stays within 5pp of Scout (EXP-08).
9. HyDE is explicitly NOT implemented; the variant prompt forbids hypothetical-doc generation; eval includes an anti-HyDE assertion (EXP-09).
10. 429 retry envelope wraps the rewriter call; persistent failure falls back to v0.1 single-query path with `meta.gaps` note "query expansion unavailable" (EXP-10).
11. Recall p50 with expansion ON ≤ 1.8s; p99 ≤ 3s (EXP-11).
12. Entity preservation: > 80% of named entities present in the original query are present in at least one variant (EXP-12).

**Risk Notes:**

- **PITFALLS QE-1 cost runaway.** Adaptive routing (EXP-03) + variant cap at 3 (EXP-01) + similarity gate (EXP-02) are the layered defenses. Removing any one collapses the cost model.
- **PITFALLS QE-2 drift.** The 0.85 similarity gate + the original-as-variant[0] anchor are non-negotiable. Without them, the rewriter can produce variants that semantically wander.
- **PITFALLS QE-3 HyDE.** All 4 research files converged on "no HyDE". The eval has an explicit anti-HyDE assertion (EXP-09) to catch any future prompt regression.
- **PITFALLS QE-5 latency stacking.** Recall p50 ≤ 1.8s with expansion is tight given the +600-900ms cost. If the ablation shows we're over budget, fall back is adaptive routing's threshold tightening (raise 0.65 → 0.70), not abandoning the feature.
- **Reranker corpus-size risk.** STACK ↔ FEATURES disagreement on bge-reranker resolves via the weight ablation (EXP-07). Either it earns its 3pp on the corpus or its weight is zeroed — the constant lands in `ai-config` regardless.

**Linear:** Maps to milestone "v0.2 — Intelligence Layer".

#### Phase 4: Synthesis Activation Eval

**Goal:** Promote the scaffolded `verbosity=synthesis|both` branch from "implemented but unvalidated" to "shipped with eval gate." Default verbosity stays `"chunks"` — flipping to `"both"` is explicitly v0.3 territory.

**Depends on:** Phase 3 (synthesis quality depends on recall coverage — without expansion + reranker, synthesis operates on thinner inputs)

**Requirements:** SYN-01, SYN-02, SYN-03, SYN-04, SYN-05, SYN-06, SYN-07, SYN-08, SYN-09, SYN-10

**Success Criteria:**

1. `synthesis-fidelity.eval.test.ts` (promptfoo + LLM-judge) scores synthesis outputs across the expanded corpus from PRE-03 augmented with `expected_synthesis` ground-truth captions (SYN-01).
2. LLM-judge faithfulness pass rate ≥ 90%; zero hallucinated entities (SYN-02).
3. Citation density ≥ 1 `[memory_id]` marker per 80 chars of synthesis output; post-process drops any sentence without an inline citation (SYN-03).
4. Synthesis output p50 ≤ 5s, p99 ≤ 8s when invoked via `recall(verbosity="synthesis")` or `recall(verbosity="both")` (SYN-04).
5. Pre-flight token-count assertion: serialized retrieved-memory context ≤ 6K tokens before synthesis call; over-budget retrievals truncated by recency-descending order with a `meta.gaps` note (SYN-05).
6. Cosine-aware hedging: synthesis prompt includes a "low-confidence input" instruction whenever `min(cosine across retrieved memories) < 0.7`; output opens with explicit hedging (SYN-6).
7. Single-memory synthesis rejected at the handler; `recall()` returns the chunk directly with `meta.gaps = ["synthesis skipped: only one source"]` (SYN-07).
8. `verbosity` default in `recall()` stays `"chunks"`; flipping to `"both"` is OUT of scope (SYN-08).
9. Analytics blob extension: synthesized recalls record `blobs[1]="synthesis"`, `doubles[0]=latency_ms`, `doubles[1]=token_count` for the v0.3 default-flip discussion (SYN-09).
10. `SYNTHESIS_MODEL` stays aliased to Scout; byte-frozen `SYNTHESIS_SYSTEM_PROMPT` per ENG-22 contract (SYN-10).

**Risk Notes:**

- **PITFALLS SY-1 + SY-2 (hallucination + missing citations) are catastrophic trust killers.** Russell will catch fabricated facts within weeks of v0.2 ship and lose trust in his own tool. The LLM-judge faithfulness gate + citation density floor (SYN-02, SYN-03) are non-negotiable. Pass rates below 90% block the phase, not just the eval.
- **PITFALLS SY-3 context overrun.** Without the 6K pre-flight assertion (SYN-05), a recall returning 25 long memories can quietly truncate Scout's input and produce garbage. Assertion must throw, not log.
- **PITFALLS SY-6 latency.** 5s p50 / 8s p99 is the user-experience contract. If the eval shows we're over, the response is prompt tuning + reducing top-K, not removing the gate.
- **D-7 resolution (verbosity default stays `chunks`).** This is a hard architectural lock for v0.2. Russell may revisit at v0.3 when SYN-09 analytics provide adoption data.
- **Byte-frozen prompt (SYN-10).** Any synthesis prompt change requires re-running this full eval set. Document in the plan: prompt edits cost the cycles, not just the keystrokes.

**Linear:** Maps to milestone "v0.2 — Intelligence Layer".

#### Phase 5: Integration Kitchen Sink

**Goal:** Verify all 4 v0.2 features compose cleanly under the v0.1 envelope contract. Last gate before milestone close.

**Depends on:** Phases 2, 3, 4

**Requirements:** INT-01, INT-02, INT-03, INT-04, INT-05

**Success Criteria:**

1. `v02-kitchen-sink.test.ts` integration suite asserts the worst-case envelope (`recall(verbosity="synthesis")` against a fixture with 10 conflicts + 50 entities) serializes ≤ 8K tokens (INT-01).
2. Existing `envelope.test.ts` passes against the v0.2 envelope shape; new `context.conflicts[]` content and optional `result.synthesis` string introduce no breaking changes to the v0.1 contract (INT-02).
3. Cross-workspace pentest extended to cover expanded-query Vectorize calls, reranker calls, synthesis calls, and conflict-pipeline writes — all reject foreign-workspace JWTs (INT-03).
4. The integration-matrix doc from PRE-04 resolves to zero untested cross-feature combinations (INT-04).
5. End-to-end smoke: fresh `wrangler dev` boot of both Workers + a Claude conversation that exercises `remember → recall(verbosity="synthesis") → conflict-surfacing-in-recall` passes against deployed staging (INT-05).

**Risk Notes:**

- **PITFALLS INT-4 envelope-budget.** The v0.1 8K-token envelope budget was set when only `chunks` existed. Adding `result.synthesis` + `context.conflicts[]` in the same response is the case that can blow the budget. The kitchen-sink fixture explicitly tests the upper bound.
- **PITFALLS INT-6 cross-feature combinations.** The integration matrix is the discipline; "I tested each feature in isolation" doesn't guarantee they compose. Reranker output × conflict-surfacing × synthesis × adaptive-routing-not-firing is the kind of combination only the matrix catches.
- **Cross-workspace pentest debt.** v0.1's TOL-07 covered the v0.1 surface; every new code path in v0.2 needs the same treatment or v0.4 multi-tenant rollout will surface the gap dangerously late.

**Linear:** Maps to milestone "v0.2 — Intelligence Layer".

#### v0.2 Build-Order Graph

```text
Phase 1 (Foundation)
       │
       ▼
Phase 2 (Recall Quality Baseline)
   ├── Hybrid-Rank Tuning (mcp-server)      ──┐
   └── Conflict-Detection Wiring (triage)   ──┴── must merge before Phase 3
       │
       ▼
Phase 3 (Query Expansion + Reranker)
       │
       ▼
Phase 4 (Synthesis Activation Eval)
       │
       ▼
Phase 5 (Integration Kitchen Sink)
       │
       ▼
   v0.2 Done
```

#### v0.2 Milestone-Level Risk Notes

- **Single biggest de-risk lever:** Phase 1's PRE-03 corpus expansion (27 → 100+). Every downstream eval gate becomes statistically meaningful only after this lands. Russell's manual labeling time is the critical path.
- **Hardest reversibility hazard:** The bge-reranker constant (EXP-05) and the `HYBRID_WEIGHTS.cosine → rerank` rename. Roll-back requires a one-line `HYBRID_WEIGHTS.rerank = 0.0` + a follow-on PR, not a schema migration.
- **Hardest engineering risk:** Recall p50 ≤ 1.8s with expansion ON. The +600-900ms expansion cost is structural; the only knobs are the adaptive-routing threshold and the variant cap. If the eval shows we're over, raise the 0.65 cosine threshold first.
- **Hardest UX risk:** Synthesis hallucination. Trust loss is irreversible; the LLM-judge + citation gates are the structural defenses.
- **Vendor lock-in risk:** None new. v0.2 introduces zero new npm dependencies and zero Vectorize index changes.

### 📋 v0.3 Workspaces + Memory Types (Planned)

Target ship: 2026-07-12. Anticipated focus:

- UserDO/TeamDO/ProjectDO hierarchy
- Cross-layer recall fan-out (ENG-17 — SEED-001 design work)
- Member management
- `reflect` / `relate` / `forget(cascade)` / `export` / `conflict` MCP tools (completes the 9-tool surface)
- User-defined memory types
- bge-reranker enabling decision if v0.2 ablation said `rerank=0`
- Hybrid-rank re-tune against the larger v0.3 corpus
- Synthesis `verbosity` default flip discussion using v0.2 analytics

### 📋 v0.4 Connectors + Alerts (Planned)

Target ship: 2026-08-02. Anticipated focus:

- Slack + Drive connectors (server-side fetch + publish to `engram-ingest` Queue)
- `ingest-worker` package returns as connector orchestration layer
- `ingest()` MCP tool body fills in (URL-fetch path)
- Daily digest
- Inbox UI (read + write surface for v0.2's conflict suggestions and memorability inbox)
- Killer demo: same answer from Slack + from Claude, both backed by layered store
- Connector cost + throughput model (ENG-18 — SEED-002 prerequisite)

### 📋 v1.0 Public Launch (Planned)

Target ship: 2026-09-01. Managed hosting, Stripe billing, OAuth, admin UI, connector registry, OSS launch. `engram-conflicts` Queue if multi-tenant volume justifies separating async stages.

## Progress

| Milestone | Phases | Status | Shipped |
| --------- | ------ | ------------ | ----------- |
| v0.1 MCP Foundation | 1-7 (44 plans) | ✅ Shipped | 2026-05-30 |
| v0.2 Intelligence Layer | 1-5 (TBD plans) | 🚧 In flight | — |
| v0.3 Workspaces + Memory Types | TBD | 📋 Planned | — |
| v0.4 Connectors + Alerts | TBD | 📋 Planned | — |
| v1.0 Public Launch | TBD | 📋 Planned | — |

## Linear Sync Convention

Per CLAUDE.md "Linear Workflow" — one ENG issue per phase, auto-synced at `/gsd:plan-phase` start (→ Todo) and `/gsd:execute-phase` start (→ In Progress). All v0.2 issues map to the existing Linear milestone "v0.2 — Intelligence Layer".

Between `/gsd:plan-phase` and `/gsd:execute-phase`, Claude creates per-plan Linear issues (one issue per plan, sub-issues per atomic chunk if scope warrants). Lightweight, judged per-plan, no skill needed — per the post-v0.1 workflow tweak captured in STATE.md decision 6.

---

_Per-milestone roadmaps with full phase details for completed milestones live in `.planning/milestones/`._
_v0.2 roadmap created 2026-06-02 by `/gsd:new-milestone`. Source-of-truth research synthesis: [research/v0.2-SUMMARY.md](research/v0.2-SUMMARY.md). Requirements: [REQUIREMENTS.md](REQUIREMENTS.md)._
