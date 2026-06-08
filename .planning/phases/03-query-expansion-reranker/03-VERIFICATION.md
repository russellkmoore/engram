---
phase: 03-query-expansion-reranker
verified: 2026-06-08T11:00:00Z
status: human_needed
score: 8/12 truths verified by automated means; 4 eval-gated truths authored + pending live-creds run
overrides_applied: 0
human_verification:
  - test: "Run EXP-07 reranker ablation eval under Cloudflare credentials"
    expected: |
      cd packages/mcp-server && npm run test:eval -- reranker-ablation
      Logged output: [EXP-07-RESULT] f1_on=… f1_off=… delta=… gate_passed=…
      Budget: 60 queries × 3 calls = 180 ≤ MAX_AI_CALLS=200 (standalone session only — not alongside EXP-08)
      If gate_passed=true (delta ≥ 0.03): update changelog row, set bge_reranker_active=true.
      If gate_passed=false (delta < 0.03): set HYBRID_WEIGHTS.rerank=0.0 in shared/ai-config/src/index.ts, update changelog.
    why_human: "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID unavailable in authoring session; bge-reranker requires live Workers AI binding. Eval file is authored, type-checks, and follows the pre-resolve-once + pure-math-sweep pattern from recall-ranking.eval.test.ts."

  - test: "Run EXP-08/09/12 query-expansion-recall eval under Cloudflare credentials"
    expected: |
      cd packages/mcp-server && npm run test:eval -- query-expansion-recall
      Logged output:
        [EXP-08] recall@5(Scout=…)=… recall@5(3.2-3b=…)=… promotable=… (gate: 3.2-3b ≥ Scout − 5pp)
        [EXP-12] entityPreservation=… (gate >=0.8, n=20)
        [EXP-09] antiHyDE failures: 0 / 20 queries
      MUST run in its own session, separate from EXP-07 (A4: MAX_AI_CALLS=200 combined budget would be exceeded).
      entityPreservation corpus-averaged rate must exceed 0.80.
      antiHyDE check must produce 0 failures.
    why_human: "Live Workers AI + Vectorize bindings required. Eval file is authored (21.3K), type-checks, implements namedEntities/entityPreservationRate/antiHydeCheck as specified."

  - test: "Run EXP-11 recall-latency eval under Cloudflare credentials"
    expected: |
      cd packages/mcp-server && npm run test:eval -- recall-latency
      Logged output: [EXP-11] Results: n=20 queries, p50=…ms (budget ≤1800ms), p99=…ms (budget ≤3000ms), fanOutRate=…%
      p50 assertion ≤ 1800ms and p99 assertion ≤ 3000ms must both pass.
      If over budget: raise ADAPTIVE_TOP1_THRESHOLD 0.65 → 0.70 in tools.ts (QE-5 lever) — do NOT remove expansion.
      Confirm production latency via Analytics Engine 'recall' latency blob on deployed Worker.
    why_human: "Live Workers AI + Vectorize bindings required; DO RPC layer excluded from eval timing (requires live DO stub). Percentile method mirrors CON-07 eval-budget-summary.mjs --conflict-pipeline-p99."
---

# Phase 3: Query Expansion + Reranker Verification Report

**Phase Goal:** Activate the multi-query expansion + RRF merge + bge-reranker rerank path in `recall()`. The largest single user-facing latency change in v0.2.
**Verified:** 2026-06-08T11:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | EXP-01: `expandQuery` returns `[original, p1, p2]` with original at [0], zod-gated, degrades to single query on malformed output | VERIFIED | `query-expansion.ts` exports `expandQuery`; `.length(2)` hard cap on schema; 5 unit tests covering anchor + gate degrade + string unwrap — 14/14 query-expansion tests pass |
| 2 | EXP-02: `keepVariantsAboveGate` drops paraphrases below 0.85 cosine silently, always keeps variant[0] | VERIFIED | `keepVariantsAboveGate` in `query-expansion.ts`; gate=0.85 default; 4 tests covering keep/drop/original-survival/mixed — all pass |
| 3 | EXP-03: `recall()` issues single-query Vectorize pass first; multi-query fan-out fires ONLY when `top1_cosine < 0.65` | VERIFIED | `ADAPTIVE_TOP1_THRESHOLD = 0.65` at tools.ts:577; conditional `if (top1 < ADAPTIVE_TOP1_THRESHOLD)` at :582; 4 handler-branch unit tests including T1 (skips fan-out when top1≥0.65) and T2 (fires when top1<0.65) |
| 4 | EXP-04: `reciprocalRankFusion(lists, k=60)` is a pure transform that reproduces Elasticsearch k=1 and k=60 reference vectors exactly | VERIFIED | `rrf.ts` (82 lines, no env/await/IO); 4 tests: Elasticsearch k=1 fixture (doc3=0.8333 winner), k=60 tiebreak (insertion order), single-list passthrough, purity (inputs unchanged) — all pass |
| 5 | EXP-05: `RERANKER_MODEL = "@cf/baai/bge-reranker-base"` exported from `@engram/ai-config`; `HYBRID_WEIGHTS.rerank` exists and is UNCHANGED from Phase 2 | VERIFIED | `shared/ai-config/src/index.ts`:74 exports `RERANKER_MODEL`; HYBRID_WEIGHTS.rerank=0.6 at :177 (Phase 2 D-34 value, byte-identical to Phase 2 sweep winner); ai-config test asserts both |
| 6 | EXP-06: bge-reranker invoked via `safeRun(env, RERANKER_MODEL, {query, contexts})`; response `id` is INTEGER INDEX into contexts[]; scores sigmoid-normalized; 429/error falls back to raw cosine; empty contexts filtered | VERIFIED | tools.ts:678 `safeRun(env, RERANKER_MODEL, {...})`; :654 `function sigmoid(x) { return 1/(1+Math.exp(-x)); }`; :686 `const cand = rankedCandidates[r.id]` (index mapping); :703 `rerankScores.get(m.id) ?? m.score` (raw-cosine fallback); :667-670 empty-content filter; 4 unit tests covering index-alignment, sigmoid values, reranker throw fallback, Pitfall-6 empty filter — all pass |
| 7 | EXP-07: reranker ablation eval authored with precision@3/F1@3 gate; `RERANKER_IMPROVEMENT_MIN=0.03`; changelog row appended | VERIFIED (authored; live run pending) | `reranker-ablation.eval.test.ts` exists (21.7K); `computeF1`, `RERANKER_IMPROVEMENT_MIN=0.03`, `RERANKER_MODEL`, `QueryResolution`, `Math.exp` all present; `docs/hybrid-rank-changelog.md` has second row with D-EXP07 rationale ("gate is precision@3/F1@3 NOT precision@5 because corpus labels expected_top_3_block_ids"); `bge_reranker_active` = "pending live run"; TypeScript compiles |
| 8 | EXP-08/09/12: query-expansion-recall eval authored with A/B recall@5 + anti-HyDE + entity-preservation assertions | VERIFIED (authored; live run pending) | `query-expansion-recall.eval.test.ts` exists (21.3K); `EXPANSION_CHALLENGER_MODEL` present in ai-config :87; `entityPreservationRate`/`namedEntities`/`antiHydeCheck` implemented; A/B both models invoked; 5pp promotion gate logged; entity regex `/[A-Z][a-zA-Z0-9.&-]+/` present; TypeScript compiles |
| 9 | EXP-09 (prompt): `EXPANSION_SYSTEM_PROMPT` explicitly forbids hypothetical-document generation and mandates verbatim named-entity preservation | VERIFIED | `query-expansion.ts` EXPANSION_SYSTEM_PROMPT contains anti-HyDE rule and named-entity preservation rule; unit Test 4 asserts the string contains these rules and passes |
| 10 | EXP-10: persistent expansion 429 falls back to v0.1 single-query path with `meta.gaps` note "query expansion unavailable" | VERIFIED | tools.ts:581 `expansionUnavailable = false`; :606 `expansionUnavailable = true` in catch; :837-838 `envelope.meta.gaps = [...envelope.meta.gaps, META_GAPS.queryExpansionUnavailable]` AFTER `buildRecallResponse`; `META_GAPS.queryExpansionUnavailable = "query expansion unavailable"` in envelope.ts; unit Test 3 asserts this path |
| 11 | EXP-11: recall-latency eval authored with p50 ≤ 1800ms / p99 ≤ 3000ms assertions; CON-07 percentile method; QE-5 lever documented | VERIFIED (authored; live run pending) | `recall-latency.eval.test.ts` exists (14.6K); `P50_BUDGET_MS=1800` at :90, `P99_BUDGET_MS=3000` at :93; `computePercentile` mirrors eval-budget-summary.mjs; QE-5 threshold lever documented; TypeScript compiles |
| 12 | EXP-12: entity-preservation >80% eval assertion authored; namedEntities capitalized-token heuristic implemented | VERIFIED (authored; live run pending) | `entityPreservationRate`/`namedEntities` in `query-expansion-recall.eval.test.ts`; regex `/\b[A-Z][a-zA-Z0-9.&-]+\b/g` present; corpus-averaged >0.80 assertion present |

**Score:** 12/12 truths verified (8 by fully automated unit tests; 4 eval-gated truths authored + type-checked, pending live-credentials run)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/mcp-server/src/rrf.ts` | reciprocalRankFusion pure transform | VERIFIED | 82-line pure transform; exports `reciprocalRankFusion`; no env/await/IO |
| `packages/mcp-server/src/__tests__/rrf.test.ts` | 4 reference-vector unit tests | VERIFIED | 4 tests all pass (Elasticsearch k=1, k=60 default, single-list, purity) |
| `packages/mcp-server/src/query-expansion.ts` | expandQuery + keepVariantsAboveGate + zod gate + anti-HyDE prompt | VERIFIED | 9.7K; exports expandQuery, keepVariantsAboveGate, ExpansionOutput, EXPANSION_SYSTEM_PROMPT, EXPANSION_JSON_SCHEMA |
| `packages/mcp-server/src/__tests__/query-expansion.test.ts` | 14 unit tests (mocked, creds-free) | VERIFIED | 14 tests all pass |
| `packages/mcp-server/src/tools.ts` | recall() with adaptive routing + RRF + reranker + EXP-10 fallback | VERIFIED | ADAPTIVE_TOP1_THRESHOLD=0.65; expandQuery/keepVariantsAboveGate wired; reciprocalRankFusion wired; safeRun(RERANKER_MODEL) wired; sigmoid normalization; ?? m.score fallback; expansionUnavailable meta.gaps append |
| `packages/mcp-server/src/__tests__/recall.test.ts` | 12 handler-branch unit tests | VERIFIED | 12 tests all pass (adaptive gate, RRF, EXP-10, workspace isolation, index-alignment, sigmoid, reranker fallback, Pitfall-6) |
| `packages/mcp-server/src/hybrid-rank.ts` | doc-comment updated, formula byte-identical | VERIFIED | Formula lines 119-123 unchanged; only doc-comment notes sigmoid-normalized bge-reranker score |
| `shared/ai-config/src/index.ts` | RERANKER_MODEL + EXPANSION_CHALLENGER_MODEL constants | VERIFIED | :74 RERANKER_MODEL; :87 EXPANSION_CHALLENGER_MODEL; HYBRID_WEIGHTS.rerank=0.6 (unchanged) |
| `shared/ai-config/src/__tests__/ai-config.test.ts` | constant-presence tests | VERIFIED | 3 tests: RERANKER_MODEL value, HYBRID_WEIGHTS.rerank is number, EMBEDDING_MODEL unchanged — all pass |
| `packages/mcp-server/src/__tests__/evals/reranker-ablation.eval.test.ts` | EXP-07 ablation eval (authored, type-checked) | VERIFIED (pending live run) | 21.7K; computeF1 + RERANKER_MODEL + QueryResolution + RERANKER_IMPROVEMENT_MIN=0.03 present; TypeScript compiles |
| `packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts` | EXP-08/09/12 A/B + anti-HyDE + entity-preservation eval (authored, type-checked) | VERIFIED (pending live run) | 21.3K; EXPANSION_CHALLENGER_MODEL A/B; entityPreservationRate; antiHydeCheck; TypeScript compiles |
| `packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts` | EXP-11 p50/p99 latency eval (authored, type-checked) | VERIFIED (pending live run) | 14.6K; P50_BUDGET_MS=1800; P99_BUDGET_MS=3000; computePercentile mirrors CON-07; TypeScript compiles |
| `docs/hybrid-rank-changelog.md` | Second row appended with D-EXP07 rationale + bge_reranker_active | VERIFIED | Row 2 appended; D-EXP07 metric substitution ("gate is precision@3/F1@3 NOT precision@5") documented; bge_reranker_active="pending live run"; prior row byte-unchanged |
| `packages/mcp-server/src/envelope.ts` | META_GAPS.queryExpansionUnavailable constant | VERIFIED | `queryExpansionUnavailable: "query expansion unavailable"` in META_GAPS; snapshot updated |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tools.ts` | `expandQuery + keepVariantsAboveGate` (query-expansion.ts) | import + call inside top1 < 0.65 branch | WIRED | tools.ts:95 import; :585 `expandQuery(env, queryForEmbed)` call |
| `tools.ts` | `reciprocalRankFusion` (rrf.ts) | import + call to merge fan-out lists | WIRED | tools.ts:96 import; :603 `reciprocalRankFusion(lists).map(...)` call |
| `tools.ts` | `safeRun(env, RERANKER_MODEL, {query, contexts})` | reranker call between RRF and hybridRank | WIRED | tools.ts:678; sigmoid at :653-655; index-alignment at :686 |
| `tools.ts` | `vectorizeQuery(env, props.workspace_id, ...)` | all fan-out queries use workspace_id from props | WIRED | tools.ts:569 (single pass) and :595 (fan-out) both use `props.workspace_id`; zero occurrences of `vectorizeQuery(env, args.` |
| `tools.ts` | `META_GAPS.queryExpansionUnavailable` (envelope.ts) | EXP-10 gap note appended AFTER buildRecallResponse | WIRED | tools.ts:837-838 `envelope.meta.gaps = [...envelope.meta.gaps, META_GAPS.queryExpansionUnavailable]` |
| `shared/ai-config/src/index.ts` | `RERANKER_MODEL = "@cf/baai/bge-reranker-base"` | as const export | WIRED | :74; imported in tools.ts:89 |
| `shared/ai-config/src/index.ts` | `EXPANSION_CHALLENGER_MODEL = "@cf/meta/llama-3.2-3b-instruct"` | eval-only constant | WIRED | :87; imported in query-expansion-recall.eval.test.ts:41 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `recall()` in tools.ts | `mergedMatches` (fan-out) | `reciprocalRankFusion(lists)` where `lists` come from parallel `vectorizeQuery` calls | Yes — flows through RRF merge to MIN_COSINE_THRESHOLD filter → hydrate → reranker → hybridRank | FLOWING |
| `recall()` in tools.ts | `rerankScores` Map | `safeRun(env, RERANKER_MODEL, {query, contexts})` response | Yes — sigmoid-normalized logit scores; fallback to `?? m.score` on empty/error | FLOWING |
| `envelope.meta.gaps` | `queryExpansionUnavailable` | `expansionUnavailable` flag set in catch block | Yes — only appended on actual 429/error; defended by unit test T3 | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| RRF pure transform: 4 tests | `cd packages/mcp-server && npx vitest run rrf` | 4 passed | PASS |
| expandQuery + keepVariantsAboveGate: 14 tests | `cd packages/mcp-server && npx vitest run query-expansion` | 14 passed | PASS |
| recall() adaptive routing + reranker + fallback: 12 tests | `cd packages/mcp-server && npx vitest run recall` | 12 passed (within 30-test total) | PASS |
| ai-config constants: 3 tests | `cd shared/ai-config && npx vitest run ai-config` | 3 passed | PASS |
| Full unit suite (18 files) | `cd packages/mcp-server && npm test` | 157 passed, 2 skipped, 0 failed | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for this phase. Behavioral spot-checks above serve as the executable verification.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXP-01 | 03-02 | expandQuery returns [original, p1, p2], original at [0], zod-gated | SATISFIED | Unit tests pass; anchor + gate degrade verified |
| EXP-02 | 03-02 | keepVariantsAboveGate drops paraphrases < 0.85 cosine silently | SATISFIED | Unit tests pass; 0.85 default confirmed in source |
| EXP-03 | 03-03 | Adaptive routing: fan-out only when top1_cosine < 0.65 | SATISFIED | Unit tests pass; ADAPTIVE_TOP1_THRESHOLD=0.65 in tools.ts |
| EXP-04 | 03-01 | reciprocalRankFusion pure transform, reference vectors | SATISFIED | 4 unit tests pass; pure transform confirmed (no env/await) |
| EXP-05 | 03-01 | RERANKER_MODEL constant; HYBRID_WEIGHTS.rerank exists unchanged | SATISFIED | Constant verified in ai-config; HYBRID_WEIGHTS.rerank=0.6 unchanged |
| EXP-06 | 03-03 | bge-reranker between RRF and hybridRank; index-alignment; sigmoid; fallback | SATISFIED | Source verified; 4 unit tests pass including index-alignment, sigmoid, fallback, empty-filter |
| EXP-07 | 03-04 | Ablation eval: reranker beats cosine by ≥3% F1@3, else HYBRID_WEIGHTS.rerank=0.0 | NEEDS HUMAN | Eval file authored + type-checks; D-EXP07 metric in changelog; live run deferred to nightly CI |
| EXP-08 | 03-05 | Scout vs llama-3.2-3b recall@5 A/B; EXPANSION_CHALLENGER_MODEL eval-only | NEEDS HUMAN | Eval file authored + type-checks; EXPANSION_CHALLENGER_MODEL in ai-config; live run deferred |
| EXP-09 | 03-02 (prompt) / 03-05 (behavioral) | HyDE not implemented; anti-HyDE rule in prompt + behavioral eval assertion | SATISFIED (prompt) / NEEDS HUMAN (behavioral) | EXPANSION_SYSTEM_PROMPT string-tested in unit tests; behavioral eval authored + type-checks, live run deferred |
| EXP-10 | 03-03 | 429 fallback to single-query + meta.gaps "query expansion unavailable" | SATISFIED | Unit test T3 passes; expansionUnavailable flag + META_GAPS.queryExpansionUnavailable wired |
| EXP-11 | 03-05 | Recall p50 ≤ 1.8s, p99 ≤ 3s with expansion ON | NEEDS HUMAN | Latency eval authored + type-checks; P50_BUDGET_MS=1800, P99_BUDGET_MS=3000 asserted; live run deferred |
| EXP-12 | 03-05 | >80% named-entity preservation in ≥1 variant | NEEDS HUMAN | Entity-preservation eval authored + type-checks; namedEntities + entityPreservationRate + >0.80 assertion present; live run deferred |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/mcp-server/src/tools.ts` | 169 | `TODO: derive from env.ENVIRONMENT if Phase 7 adds staging/dev split.` | Info | Pre-existing Phase 2 doc comment on `ANALYTICS_ENV_TAG`; references future Phase 7 work; not in Phase 3 code paths; no formal issue reference but not a Phase 3 artifact |

No TBD, FIXME, or XXX markers found in any Phase 3 modified files (rrf.ts, query-expansion.ts, hybrid-rank.ts, shared/ai-config/src/index.ts, tools.ts Phase 3 additions, envelope.ts, eval files).

---

### Human Verification Required

#### 1. EXP-07 Reranker Ablation Live Run

**Test:** Run `cd packages/mcp-server && npm run test:eval -- reranker-ablation` in a standalone vitest session (not alongside EXP-08) under Cloudflare credentials.
**Expected:**
- Logged: `[EXP-07-RESULT] f1_on=… f1_off=… delta=… gate_passed=…`
- Budget stays under MAX_AI_CALLS=200 (60 queries × 3 calls = 180)
- If `gate_passed=true` (delta ≥ 0.03): update changelog row, set `bge_reranker_active=true`
- If `gate_passed=false` (delta < 0.03): set `HYBRID_WEIGHTS.rerank = 0.0` in `shared/ai-config/src/index.ts`, update changelog row
**Why human:** Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` for live Workers AI (bge-reranker) + Vectorize bindings; unavailable in authoring session.

#### 2. EXP-08/09/12 Query-Expansion-Recall Eval Live Run

**Test:** Run `cd packages/mcp-server && npm run test:eval -- query-expansion-recall` in its own standalone session (separate from EXP-07 per A4 budget constraint).
**Expected:**
- `[EXP-08]` recall@5(Scout) and recall@5(3.2-3b) logged; promotable verdict logged
- `[EXP-12]` entityPreservation corpus-averaged rate > 0.80
- `[EXP-09]` antiHyDE failures = 0 (no Scout variant flagged as HyDE/fabrication)
- No MAX_AI_CALLS overrun (EVAL_QUERY_CAP=20 keeps calls ≤200)
**Why human:** Live Workers AI + Vectorize bindings required for expansion model calls and Vectorize fan-out.

#### 3. EXP-11 Recall Latency Live Run

**Test:** Run `cd packages/mcp-server && npm run test:eval -- recall-latency` under Cloudflare credentials.
**Expected:**
- `[EXP-11] Results: n=20 queries, p50=…ms (budget ≤1800ms), p99=…ms (budget ≤3000ms), fanOutRate=…%`
- Both p50 ≤ 1800ms and p99 ≤ 3000ms assertions pass
- If either fails: raise `ADAPTIVE_TOP1_THRESHOLD` 0.65 → 0.70 in tools.ts (QE-5 lever), re-run — do NOT remove expansion
- Optionally confirm production latency via Analytics Engine `recall` latency blob on deployed Worker
**Why human:** Live Workers AI + Vectorize bindings required; DO RPC excluded from eval timing (requires live DO stub). Production confirmation is manual.

---

### Gaps Summary

No blocking gaps. All 12 EXP requirements are either fully implemented and unit-tested (EXP-01 through EXP-06, EXP-09 prompt portion, EXP-10) or fully authored in eval files that type-check with the live run explicitly deferred to a creds-gated CI session (EXP-07, EXP-08, EXP-09 behavioral, EXP-11, EXP-12). The deferral is the planned, documented condition per the `autonomous: false` + `user_setup` contract in plans 03-04 and 03-05.

The full unit test suite confirms zero regressions: 18 test files, 157 passed, 2 skipped (pre-existing skips). The hybridRank formula at tools.ts lines 119-123 is byte-identical to the Phase 2 D-34 sweep winner — only the doc-comment was updated. Workspace isolation is maintained on all fan-out Vectorize queries (`props.workspace_id`, never `args`).

---

_Verified: 2026-06-08T11:00:00Z_
_Verifier: Claude (gsd-verifier)_
