---
phase: 03-query-expansion-reranker
plan: "05"
subsystem: eval
tags: [evals, query-expansion, a-b-testing, entity-preservation, anti-hyde, latency, EXP-08, EXP-09, EXP-11, EXP-12]
dependency_graph:
  requires: ["03-03"]
  provides: [EXP-08-eval, EXP-09-eval, EXP-11-eval, EXP-12-eval]
  affects: [packages/mcp-server/src/__tests__/evals, shared/ai-config/src/index.ts]
tech_stack:
  added: [EXPANSION_CHALLENGER_MODEL constant, query-expansion-recall.eval.test.ts, recall-latency.eval.test.ts]
  patterns: [pre-resolve-once eval harness, CON-07 percentile method, capitalized-token entity heuristic, anti-HyDE behavioral assertion]
key_files:
  created:
    - packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts
    - packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts
  modified:
    - shared/ai-config/src/index.ts
decisions:
  - "EXPANSION_CHALLENGER_MODEL is eval-only constant; Scout stays QUERY_EXPANSION_MODEL default until EXP-08 promotion gate clears in follow-on PR"
  - "EXP-09 heuristic: length >3× original OR ≥2 sentence boundaries = HyDE flag (conservative — catches obvious fabrication)"
  - "EXP-11 latency timed at AI+Vectorize layer (DO RPC excluded — requires live DO stub); production confirmation is manual Analytics Engine check"
  - "EXP-11 percentile method: sort ascending, index = ceil(p/100 * n) − 1 (matches CON-07 eval-budget-summary.mjs --*-p99 shape)"
metrics:
  duration: "~18 minutes"
  completed_date: "2026-06-08"
  tasks_completed: 2
  tasks_deferred: 1
  files_created: 2
  files_modified: 1
---

# Phase 03 Plan 05: Query-Expansion Eval Suite Summary

Query-expansion eval suite authored and type-checked: Scout-vs-llama-3.2-3b A/B recall@5 (EXP-08), anti-HyDE behavioral assertion (EXP-09), entity-preservation >80% metric (EXP-12), and p50/p99 latency gate (EXP-11). All four eval files pass `npx tsc --noEmit`; live runs deferred to nightly CI (no creds in this session).

## What Was Built

### Task 1: EXPANSION_CHALLENGER_MODEL + query-expansion-recall.eval.test.ts

**`shared/ai-config/src/index.ts`** — added `EXPANSION_CHALLENGER_MODEL = "@cf/meta/llama-3.2-3b-instruct" as const` as an eval-only constant (JSDoc marks it EVAL-ONLY; `QUERY_EXPANSION_MODEL` alias unchanged — Scout stays the production default).

**`packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts`** — authored:

- **EXP-08 A/B recall@5**: For each corpus query, expands with Scout (`QUERY_EXPANSION_MODEL`) and the challenger (`EXPANSION_CHALLENGER_MODEL`), fans out to Vectorize for each variant set, computes `recall@5 = |expected ∩ top5| / |expected|`, and logs the promotion verdict (`3.2-3b promotable iff recall@5(3.2-3b) ≥ recall@5(Scout) − 0.05`). Promotion is a follow-on PR only — the test does NOT fail either way on this verdict.
- **EXP-09 anti-HyDE assertion**: `antiHydeCheck()` flags Scout variants that are (a) >3× the original query length, or (b) contain ≥2 sentence-boundary patterns (declarative prose). Fails the test if any Scout variant is flagged. Documented as conservative — catches obvious fabrication without penalizing legitimate long-form queries.
- **EXP-12 entity-preservation**: `namedEntities()` extracts capitalized tokens via `/\b[A-Z][a-zA-Z0-9.&-]+\b/g` (RESEARCH A5 heuristic). `entityPreservationRate()` computes fraction of original entities present in ≥1 Scout variant. Asserts corpus-averaged rate > 0.80. Vacuously 1.0 for all-lowercase queries.
- **Budget discipline**: `EVAL_QUERY_CAP=20` (≤200 calls); comment notes session isolation from EXP-07 (A4 constraint).

Commit: `3ece563`

### Task 2: recall-latency.eval.test.ts

**`packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts`** — authored:

- **EXP-11 latency gate**: Times the AI+Vectorize pipeline (embed → adaptive gate → expansion fan-out/RRF → bge-reranker → hybridRank) for 20 corpus queries. The DO RPC layer (getBlocksByIds, listInboxConflictsForMemoryIds) is excluded — it requires a live DO stub unavailable in the eval pool. Reranker contexts are simulated with minimal proxy strings (measures call-overhead-dominated reranker latency).
- **Percentile method**: `computePercentile()` mirrors `scripts/eval-budget-summary.mjs --conflict-pipeline-p99` (CON-07): sort ascending, index = `ceil(p/100 * n) − 1`, clamped to valid range.
- **EXP-11 assertions**: `p50 ≤ 1800ms` AND `p99 ≤ 3000ms`.
- **Fan-out fire rate**: logged per run so the QE-5 lever can be calibrated.
- **QE-5 lever documentation**: Comment specifies "raise `ADAPTIVE_TOP1_THRESHOLD` 0.65 → 0.70 in tools.ts — do NOT remove expansion" as the over-budget remedy.
- **Production confirmation note**: header comment explains manual Analytics Engine inspection step (03-VALIDATION Manual-Only section).
- **Budget discipline**: `LATENCY_QUERY_CAP=20` (~8 calls/query × 20 = ~160 calls ≤ 200).

Commit: `633e3d7`

## Deferred / Pending Live Eval

The following evals are **AUTHORED and type-check clean** but have NOT been run against live Cloudflare credentials. Cloudflare credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) were not available in this session, per the plan's `user_setup` requirement and the execution constraint documented in `creds_environment_constraint`.

| Eval ID | File | Status | Run Command |
|---------|------|--------|-------------|
| EXP-08 (A/B recall@5) | `query-expansion-recall.eval.test.ts` | AUTHORED — pending live run | `cd packages/mcp-server && npm run test:eval -- query-expansion-recall` |
| EXP-09 (anti-HyDE) | `query-expansion-recall.eval.test.ts` | AUTHORED — pending live run | (same session as EXP-08) |
| EXP-12 (entity-preservation >80%) | `query-expansion-recall.eval.test.ts` | AUTHORED — pending live run | (same session as EXP-08) |
| EXP-11 (p50 ≤ 1.8s / p99 ≤ 3s) | `recall-latency.eval.test.ts` | AUTHORED — pending live run | `cd packages/mcp-server && npm run test:eval -- recall-latency` |

**Session isolation reminder (A4):** EXP-08 MUST run in a SEPARATE vitest session from EXP-07 (reranker-ablation — plan 03-04). The combined pre-resolve budget (~200 + ~160 calls) would exceed MAX_AI_CALLS=200.

**Expected logged output (EXP-08 run):**
```
[EXP-08] recall@5(Scout=...)=… recall@5(3.2-3b=...)=… promotable=… (gate: 3.2-3b ≥ Scout − 5pp)
[EXP-12] entityPreservation=… (gate >=0.8, n=20)
[EXP-09] antiHyDE failures: 0 / 20 queries
```

**Expected logged output (EXP-11 run):**
```
[EXP-11] Results: n=20 queries, p50=…ms (budget ≤1800ms), p99=…ms (budget ≤3000ms), fanOutRate=…%
```

## Verification Results

### TypeScript type check: PASSED
```
cd packages/mcp-server && npx tsc --noEmit
```
Exit 0 — zero errors.

### Structural assertions: PASSED
- `EXPANSION_CHALLENGER_MODEL` in `shared/ai-config/src/index.ts`: ✓ (1 match — `llama-3.2-3b-instruct`)
- `QUERY_EXPANSION_MODEL` alias unchanged: ✓ (still `INGESTION_CLASSIFIER_MODEL`)
- A/B both models present in eval: ✓ (14 references)
- 5pp promotion gate present: ✓ (5 matches for `0.05` / `5pp`)
- `namedEntities` + `entityPreservationRate` + regex: ✓ (7 matches)
- `1800` and `3000` in latency eval: ✓
- `p50` / `p99` in latency eval: ✓

### Full test suite (non-eval tiers): PASSED
```
cd packages/mcp-server && npm test
```
18 test files pass, 157 tests pass, 2 skipped (pre-existing skips — no regression).

## Deviations from Plan

None — plan executed exactly as written (subject to the creds-unavailable constraint, which is the expected, planned-for condition as documented in `creds_environment_constraint`).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The eval files operate within the existing `EVAL_WORKSPACE_ID = "eval-fixtures"` isolation boundary (T-03-13 mitigation). `EXPANSION_CHALLENGER_MODEL` is a source constant, not a deployed service config.

## Self-Check: PASSED

- `packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts`: FOUND
- `packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts`: FOUND
- `shared/ai-config/src/index.ts` (modified): FOUND
- Commit `3ece563`: FOUND (feat(03-05): EXP-08/09/12 query-expansion-recall eval + EXPANSION_CHALLENGER_MODEL)
- Commit `633e3d7`: FOUND (feat(03-05): EXP-11 recall latency eval — p50 ≤ 1800ms / p99 ≤ 3000ms)
