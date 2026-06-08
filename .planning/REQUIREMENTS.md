# Requirements: Engram

**Defined:** 2026-06-02
**Milestone in scope:** v0.2 — Intelligence Layer (target 2026-06-21)
**Core Value (from PROJECT.md):** Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.

> **Scope framing:** "v0.2" in this document refers to the four net-new intelligence-layer features that build on v0.1's shipped foundation. v0.1 (MCP Foundation) is archived under `.planning/milestones/v0.1-REQUIREMENTS.md`. Each later milestone (v0.3, v0.4, v1.0) gets its own `/gsd:new-milestone` scoping pass when it begins.
>
> **Source of truth for technical reconciliation:** `.planning/research/v0.2-SUMMARY.md` (synthesis of 4 parallel research files).

## v0.2 Requirements (Engram v0.2 — Intelligence Layer)

Russell's calls at milestone start:
- **Expand the eval corpus from 27 → 100+ labeled query/expected-rank pairs** as the first Wave 0 task. Every downstream eval gate depends on this.
- **Surface conflicts via `EngramResponse.context.conflicts[]`** in `recall()` — extend the existing envelope; no new MCP tool; no inbox UI work.

### Prerequisites (PRE) — Wave 0 foundation

- [x] **PRE-01**: Migration audit confirms `SELECT COUNT(*) FROM blocks WHERE embedding_version < 2 OR embedding_model != '@cf/qwen/qwen3-embedding-0.6b'` returns 0 across every workspace. Audit script is idempotent and runnable as a CI assertion (PITFALLS INT-1 catastrophic gate).
- [x] **PRE-02**: Tiered vitest configuration with `unit` / `integration` / `eval` tiers. `integration` and `eval` tiers expose `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. `eval` tier guards `MAX_AI_CALLS ≤ 200` per run and emits a daily neuron-consumption summary (PITFALLS INT-2).
- [x] **PRE-03**: Eval corpus expanded from 27 → ≥100 labeled pairs in `.planning/evals/recall-corpus.json`. Source queries drawn from v0.1 production recall logs + Russell's existing Notion/Drive snippets ingested into Engram. Labeled `query → expected_top_3_block_ids` with a 70/30 train/validate split documented at the top of the file.
- [x] **PRE-04**: `.planning/research/v0.2-INTEGRATION-MATRIX.md` enumerates the cross-feature combinations that must have end-to-end coverage by milestone close (recall(expansion+rerank+synthesis) × conflict-flag × cosine-threshold edge cases). Committed in Plan 01 (PITFALLS INT-5).
- [x] **PRE-05**: `.planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md` scaffolded with the 3-question checklist columns per CLAUDE.md AI Model Routing. Every v0.2 code-producing task appends a row.

### Hybrid-Rank Tuning (RNK) — Feature #1

- [x] **RNK-01**: `recall-ranking.eval.test.ts` runs a coarse grid search over `{cosine|rerank, recency, type_match, scope_match}` weights, 5 values each (625 configs), against the labeled corpus from PRE-03.
- [x] **RNK-02**: Top-3 configs by F1 are re-scored by **MRR** and **top-1 accuracy** to surface a Pareto front (PITFALLS HR-2 reward-hacking mitigation).
- [x] **RNK-03**: Winning weight set passes the held-out 30% validate split with **train→validate F1 gap < 10 percentage points** (PITFALLS HR-4 overfit gate).
- [x] **RNK-04**: Sensitivity analysis: swapping any single weight by ±0.05 from the winner changes the top-3 rank order in <30% of queries (PITFALLS HR-3 weight stability gate).
- [x] **RNK-05**: Selected weights are written to `shared/ai-config/src/index.ts` `HYBRID_WEIGHTS` with an audit comment naming the corpus filename, sweep date, F1/MRR/top-1 scores, and a "re-tune at v0.3 if corpus grows" follow-up note.
- [ ] **RNK-06**: F1 against the labeled corpus is **≥ v0.1 baseline** (currently 0.83 on the 27-entry corpus); MRR is **≥ v0.1 baseline**. Regression is blocking.
- [x] **RNK-07**: `docs/hybrid-rank-changelog.md` (new file) records the v0.2 weight changes and the small-N caveat. Future weight changes append rows.

### Conflict-Detection Wiring (CON) — Feature #2

- [x] **CON-01**: ENG-16's `detectConflict()` 30-pair eval is re-run against current memorability rubric BEFORE wiring goes live; precision must hold ≥ 0.85 and recall ≥ 0.90 or planning re-opens the prompt (PITFALLS CD-2).
- [ ] **CON-02**: New helper `packages/triage-worker/src/conflict-pipeline.ts` orchestrates: cosine prefilter over top-K=3 same-type same-workspace neighbors at ≥0.7 cosine → bounded-parallel `detectConflict()` calls → inbox writes for contradictions only.
- [ ] **CON-03**: Conflict scan is invoked via `ctx.waitUntil(conflictPipeline(...))` from the `store-normal` branch in `packages/triage-worker/src/index.ts` AFTER `updateBlockEnrichment`. Never blocks the ingest-response path (PITFALLS CD-3).
- [ ] **CON-04**: Contradictions are written to the `inbox` table with `proposed_type="conflict"` and `proposed_properties = {memory_a_id, memory_b_id, category, ai_confidence, description}`. The `conflicts` table remains UNUSED in v0.2 (reserved for v0.3 `conflict()` MCP tool).
- [ ] **CON-05**: `EngramResponse.context.conflicts[]` in `recall()` is populated by a SQL join surfacing any inbox-pending `proposed_type="conflict"` rows whose `memory_a_id` or `memory_b_id` matches a returned memory. Read-only envelope extension; no new MCP tool.
- [ ] **CON-06**: Duplicate guard: cosine(memory_a, memory_b) ≥ 0.92 is skipped (not a conflict — too similar); `created_at` diff > 180 days defaults to `severity="low"` (PITFALLS CD-4 + CD-5).
- [ ] **CON-07**: Per-write conflict-call budget = 3 (top-K cap). Latency budget for the async branch: < 4s p99 (NOT on the response critical path — `remember()` still returns at v0.1's ~430ms p50).
- [ ] **CON-08**: No proactive notifications. The conflict surfacing pathway is strictly pull-based (inbox writes + envelope serialization). PITFALLS CD-1 catastrophic adoption gate.

### Query Expansion + Reranker (EXP) — Feature #3

- [ ] **EXP-01**: New `packages/mcp-server/src/query-expansion.ts` exports `expandQuery(env, originalQuery): Promise<string[]>` — calls `QUERY_EXPANSION_MODEL` with a zod-gated prompt that returns 2 paraphrases. Result is always `[original, paraphrase1, paraphrase2]` — original is variant[0] (PITFALLS QE-7 anchor).
- [ ] **EXP-02**: Variant similarity gate: each paraphrase passes only if cosine(original, paraphrase) ≥ 0.85; failing variants are dropped silently (PITFALLS QE-2 drift mitigation).
- [ ] **EXP-03**: Adaptive routing: `recall()` issues a single-query pass first; only fans out to N-query path if `top1_cosine < 0.65` (PITFALLS QE-1 cost + QE-5 latency).
- [ ] **EXP-04**: New `packages/mcp-server/src/rrf.ts` exports `reciprocalRankFusion(lists, k=60)` — pure transform, fully unit-tested with reference vectors from Elasticsearch / AI21 documentation.
- [ ] **EXP-05**: `shared/ai-config/src/index.ts` gains `RERANKER_MODEL = "@cf/baai/bge-reranker-base"` and `HYBRID_WEIGHTS.cosine` is renamed `HYBRID_WEIGHTS.rerank` to reflect the new source of the score component.
- [ ] **EXP-06**: bge-reranker is invoked between RRF merge and `hybridRank`; reranker-score replaces raw cosine in the rank formula. Reranker failure (429, error) falls back to raw cosine — `match.score` defensive default per v0.1 `safeRun` discipline.
- [ ] **EXP-07**: bge-reranker contribution is gated by Plan 02's weight sweep — if the reranker doesn't beat raw cosine by ≥ 3% precision@5 on the labeled corpus, ship with `HYBRID_WEIGHTS.rerank = 0.0` (effectively disabled) and document the rationale in `docs/hybrid-rank-changelog.md`. The constant lands regardless.
- [ ] **EXP-08**: `QUERY_EXPANSION_MODEL` stays aliased to `INGESTION_CLASSIFIER_MODEL` (Scout) by default in v0.2. `query-expansion-recall.eval.test.ts` A/B tests `@cf/meta/llama-3.2-3b-instruct` vs Scout. Promotion to 3.2-3b is a one-line follow-on PR if 3.2-3b recall@5 ≥ Scout recall@5 - 5pp (D-2 resolution).
- [ ] **EXP-09**: HyDE is explicitly NOT implemented. The variant prompt forbids hypothetical-doc generation; eval includes an anti-HyDE assertion (PITFALLS QE-3).
- [ ] **EXP-10**: 429 retry envelope wraps the rewriter call; on persistent failure, recall falls back to the v0.1 single-query path with a `meta.gaps` note "query expansion unavailable" (PITFALLS QE-7).
- [ ] **EXP-11**: Recall p50 with expansion ON ≤ 1.8s; p99 ≤ 3s (PITFALLS QE-5 latency budget).
- [ ] **EXP-12**: Entity preservation: > 80% of named entities present in the original query are present in at least one variant (PITFALLS QE-2 drift quantification).

### Synthesis Activation Eval (SYN) — Feature #4

- [ ] **SYN-01**: `synthesis-fidelity.eval.test.ts` (promptfoo + LLM-judge model) scores synthesis outputs across the expanded corpus from PRE-03 augmented with `expected_synthesis` ground-truth captions.
- [ ] **SYN-02**: LLM-judge faithfulness pass rate ≥ 90% on the eval corpus; zero hallucinated entities (PITFALLS SY-1 + SY-2 catastrophic gates).
- [ ] **SYN-03**: Citation density ≥ 1 `[memory_id]` marker per 80 chars of synthesis output; post-process drops any sentence without an inline citation (PITFALLS SY-2 grounding lock).
- [ ] **SYN-04**: Synthesis output p50 ≤ 5s, p99 ≤ 8s when invoked via `recall(verbosity="synthesis")` or `recall(verbosity="both")` (PITFALLS SY-6 latency budget).
- [ ] **SYN-05**: Pre-flight token-count assertion: serialized retrieved-memory context ≤ 6K tokens before synthesis call; over-budget retrievals are truncated by recency-descending order with a `meta.gaps` note (PITFALLS SY-3).
- [ ] **SYN-06**: Cosine-aware hedging: synthesis prompt includes a "low-confidence input" instruction whenever `min(cosine across retrieved memories) < 0.7`. Output then opens with explicit hedging language (PITFALLS SY-4).
- [ ] **SYN-07**: Single-memory synthesis is rejected at the handler — `recall()` returns the chunk directly with `meta.gaps = ["synthesis skipped: only one source"]` (PITFALLS SY-5).
- [ ] **SYN-08**: `verbosity` default in `recall()` stays `"chunks"`. Flipping to `"both"` is explicitly OUT of v0.2 scope (D-7 resolution).
- [ ] **SYN-09**: Analytics blob extension: `analyticsEngine.writeDataPoint` for synthesized recalls records `blobs[1]="synthesis"`, `doubles[0]=latency_ms`, `doubles[1]=token_count`. Used for v0.3 default-flip decision.
- [ ] **SYN-10**: `SYNTHESIS_MODEL` stays aliased to `INGESTION_CLASSIFIER_MODEL` (Scout). Byte-frozen `SYNTHESIS_SYSTEM_PROMPT` per ENG-22 contract; any prompt change requires re-running this eval set.

### Integration / Kitchen Sink (INT) — Wave 4

- [ ] **INT-01**: `v02-kitchen-sink.test.ts` integration suite asserts the worst-case envelope (`recall(verbosity="synthesis")` against a fixture with 10 conflicts + 50 entities) serializes ≤ 8K tokens (PITFALLS INT-6).
- [ ] **INT-02**: Existing `envelope.test.ts` still passes against the v0.2 envelope shape (new `context.conflicts[]` content, optional `result.synthesis` string) — no breaking changes to the v0.1 contract (PITFALLS INT-4).
- [ ] **INT-03**: Cross-workspace pentest from v0.1 (TOL-07) is extended to cover the new code paths: expanded-query Vectorize calls, reranker calls, synthesis calls, conflict-pipeline writes — all reject foreign-workspace JWTs.
- [ ] **INT-04**: Integration matrix from PRE-04 resolves to zero untested cross-feature combinations by milestone close.
- [ ] **INT-05**: End-to-end smoke: a fresh `wrangler dev` boot of both Workers + a Claude conversation that exercises `remember → recall(verbosity="synthesis") → conflict-surfacing-in-recall` passes against deployed staging.

## Out of Scope (v0.2)

- New Worker classes (no `ingest-worker` reintroduction; that's v0.4)
- New MCP tools (the 5 v0.1 tools stay the surface; `reflect()`, `relate()`, `forget(cascade)`, `export()`, `conflict()` are v0.3)
- New memory types (schema-as-data stays at the 7 seeded types)
- Multi-tier DO hierarchy (UserDO + TeamDO + ProjectDO is v0.3 per SEED-001)
- Inbox UI — read or write (v0.4 work)
- HyDE query expansion (explicitly rejected by all 4 research files)
- Map-reduce or refine synthesis (stuff pattern stays; map-reduce is v0.3 `reflect()`)
- Auto-alerting / notifications on detected conflicts (catastrophic adoption gate — pull-only)
- Vectorize index changes (the qwen3 1024-dim cosine index is locked)
- Embedding model swaps
- `verbosity` default flip from `"chunks"` to `"both"` (v0.3 discussion once dogfooding data lands)
- Streaming MCP tool responses (the MCP `CallToolResult` shape is non-streamable per ARCHITECTURE verdict)
- A separate `engram-conflicts` Queue (per-write `ctx.waitUntil` is the v0.2 / v0.3 pattern; queue orchestration enters scope at v0.4+ when connector volume justifies it)

## Later Milestones

Captured here so the v0.2 scope discipline doesn't keep absorbing them. Each gets its own `/gsd:new-milestone` pass.

### v0.3 — Workspaces + Memory Types (target 2026-07-12)

- Multi-tier DO hierarchy (UserDO + TeamDO + ProjectDO)
- Cross-layer recall fan-out per SEED-001 (ENG-17)
- `reflect()`, `relate()`, `forget(cascade)`, `export()`, `conflict()` MCP tools — completes the 9-tool surface
- User-defined memory types via the existing schema-as-data design
- bge-reranker enabling decision if v0.2 ablation said weight=0
- Hybrid-rank re-tune against the larger v0.3 corpus
- Synthesis `verbosity` default flip discussion

### v0.4 — Connectors + Alerts (target 2026-08-02)

- Slack + Drive connectors via the `EngramConnector` interface
- Reintroduction of `ingest-worker` for connector orchestration
- Inbox UI (read + write surface for conflict suggestions, memorability inbox)
- Daily digest emails
- Connector cost + throughput model per SEED-002 (ENG-18)

### v1.0 — Public Launch (target 2026-09-01)

- Managed hosting + billing
- OSS launch (LICENSE confirmation deferred from v0.1)
- `engram-conflicts` Queue if multi-tenant volume justifies separating async stages
- Public docs site

---

*v0.2 requirements defined 2026-06-02 by `/gsd:new-milestone`. Source-of-truth research synthesis: `.planning/research/v0.2-SUMMARY.md`.*
