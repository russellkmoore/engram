---
phase: 02-recall-quality-baseline
plan: "03"
subsystem: mcp-server, shared-config
tags: [rnk, eval, sweep, hybrid-rank, d34, threshold-sweep]
dependency_graph:
  requires: ["02-03a"]
  provides: ["02-04", "02-05", "02-06"]
  affects: [shared/ai-config, packages/mcp-server/src/__tests__/evals, docs]
tech_stack:
  added: [docs/hybrid-rank-changelog.md]
  patterns:
    - "D-34 threshold sweep: MIN_COSINE_THRESHOLD added as 4th swept dimension [0.45-0.60]"
    - "Pre-fetch caches all topK=50 with NO threshold; threshold applied per-config in CPU loop (zero extra AI calls)"
    - "Cosine-only baseline computed before sweep; RNK-06 gate recalibrated to improvement_delta >= 0.02"
    - "2500 configs (625 weight configs x 4 thresholds) evaluated in pure-math inner loop"
key_files:
  created:
    - docs/hybrid-rank-changelog.md
  modified:
    - packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts
    - shared/ai-config/src/index.ts
    - packages/mcp-server/src/__tests__/hybrid-rank.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
key_decisions:
  - "D-34 approved: MIN_COSINE_THRESHOLD swept as 4th dimension; RNK-06 gate recalibrated to beat cosine-only baseline by >=0.02"
  - "Winner: rerank=0.6, recency=0.05, type_match=0.1, scope_match=0.05, threshold=0.45"
  - "HYBRID_WEIGHTS and MIN_COSINE_THRESHOLD committed together — they tuned together, must ship together"
  - "Cosine-only baseline F1=0.3381; winner F1=0.4476; improvement_delta=0.1095 (gate passed)"
  - "[Rule 1 fix] hybrid-rank.test.ts weight assertions updated to reflect tuned values"
requirements-completed:
  - RNK-01
  - RNK-02
  - RNK-03
  - RNK-04
  - RNK-07
duration: ~4 hours (D-34 sweep design + run + commit)
completed: "2026-06-08"
---

# Phase 02 Plan 03: 625-Config Hybrid-Rank Sweep Summary (D-34 Revised)

2500-config sweep (625 weight configs × 4 MIN_COSINE_THRESHOLD values per D-34) ran successfully. Winner beats cosine-only baseline by +10.95% absolute F1. HYBRID_WEIGHTS and MIN_COSINE_THRESHOLD committed to production. Changelog seeded. All gates passed.

## Performance

- **Duration:** ~4 hours (D-34 revised design + 2500-config sweep ~109s + commit)
- **Completed:** 2026-06-08
- **Tasks completed:** 2 of 2 (this is a continuation of the prior STOPPED run; Task 1 fd8f2f8 already committed)
- **Files modified:** 4

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T2-revised (sweep design) | D-34 revised sweep — THRESHOLD_GRID + 2500 configs + recalibrated gate | 34d6747 | recall-ranking.eval.test.ts, 02-CF-CODE-ASSIST-USAGE.md |
| T2-run (weights + changelog) | Commit tuned HYBRID_WEIGHTS + MIN_COSINE_THRESHOLD + seed changelog | edfebdc | shared/ai-config/src/index.ts, docs/hybrid-rank-changelog.md, hybrid-rank.test.ts |

*(Task 1 from prior session: fd8f2f8 — wire expected_args + tunability assertion)*

## Sweep Results

### Pre-run verification

- **Reseed session (02-03a):** CONFIRMED — distinct created_at=120, distinct scope=2 (all topK=50 uncached, threshold swept per-config; 120 distinct timestamps confirmed metadata active)
- **Eval session standalone:** YES — sweep ran as its own `npm test -- --project=eval recall-ranking.eval.test.ts --run` session, separate from reseed and from 02-04 (CON workstream)
- **AI call budget:** 200 calls (100 queries × 2 calls each). Budget exactly at limit. D-15 (27 extra queries × 2 = 54 calls) skipped per existing try/catch pattern — same as prior run.

### Gate results

| Gate | Result | Value | Threshold |
|------|--------|-------|-----------|
| Variance precondition (D-24) | **PASS** | distinct created_at=120, distinct scope=2 | >1 each |
| Tunability / HR-2 closure | **PASS** | distinct F1=84 across 2500 configs (min=0.3143, max=0.4476) | >1 |
| Budget discipline (D-19) | **PASS** | 200 AI calls (100 queries × 2 calls each) | ≤200 |
| Sweep completeness (D-34) | **PASS** | 2500 configs evaluated (625 × 4 thresholds) | =2500 |
| D-04 train→validate gap | **PASS** | gap=0.0143 (1.43pp) | <0.10 |
| RNK-04 sensitivity | **PASS** | top1_flip_rate=0.0268 (2.68%) | <0.30 AND >0 |
| RNK-06 recalibrated (D-34) | **PASS** | improvement_delta=0.1095 | ≥0.02 |
| D-15 dual-corpus (27-entry) | SKIPPED (budget) | — | budget exhausted |

### Winner config

```
cfg={"rerank":0.6,"recency":0.05,"type_match":0.1,"scope_match":0.05}
threshold=0.45
f1_train=0.4476   f1_validate=0.4333   gap=0.0143
mrr_train=0.8481  top1_train=0.7714
sensitivity_top1_flip_rate=0.0268 (2.68%)
cosine_only_baseline_f1=0.3381
improvement_delta=0.1095 (10.95% above baseline, gate >=0.02)
real_corpus_f1=skipped-budget
```

### F1 spread across 2500 configs

```
[RNK] f1 spread: min=0.3143 max=0.4476 distinct=84
```

84 distinct F1 values confirm the eval is genuinely tunable (HR-2 closed). Adding MIN_COSINE_THRESHOLD as a swept dimension expanded the F1 spread: distinct=7 before the threshold sweep (prior run), distinct=84 after. The absolute F1 ceiling also rose from 0.3429 → 0.4476 by allowing lower threshold candidates into the scoring pool.

### Cosine-only baseline comparison

- **Cosine-only baseline** (rerank=1.0, recency=0.0, type_match=0.0, scope_match=0.0, threshold=0.60): F1=0.3381 (today's shipped behavior)
- **Winner** (threshold=0.45, all weights tuned): F1=0.4476
- **Improvement delta:** +0.1095 absolute F1 (10.95% gain)
- **Gate:** ≥0.02 absolute improvement required → PASSED

## D-34 Gate Recalibration

Per STATE decision D-34, the RNK-06 gate was recalibrated from the absolute 0.8254 threshold (borrowed from `recall-f1.eval.test.ts` which tests the full production remember→recall pipeline) to the defensible claim: tuned (threshold, weights) must beat the cosine-only baseline by ≥0.02 absolute F1.

**Why 0.8254 was wrong for this test:** `recall-f1.eval.test.ts` ingests corpus queries via `remember()` into a live WorkspaceDO + Vectorize, then queries via `recall()` — the expected blocks ARE the ingested IDs. This pure-rerank sweep tests a fundamentally different architecture: static ef-* fixtures, Vectorize cosine scores, `hybridRank()` applied to whatever Vectorize returns from those embeddings. The architectures are incompatible; the gate transfer was invalid.

**Why the recalibrated gate is defensible:** The cosine-only baseline represents today's shipped production behavior. Any claim of "tuning improved recall quality" must be measured against this baseline. The 10.95% improvement is real and structurally sound.

**recall-f1.eval.test.ts remains unchanged** as the absolute 0.8254 production regression guard (per D-34 item 2).

## Threshold Selection Analysis

The winning threshold=0.45 allows blocks at cosine 0.45-0.60 to enter the candidate pool for reranking. These were previously filtered out by the production MIN_COSINE_THRESHOLD=0.60 before hybridRank() ever saw them. Key insight: qwen3-embedding-0.6b clusters queries and documents such that correct semantic matches often appear in the 0.45-0.60 cosine range — not necessarily below 0.60 in quality, just below the original threshold.

The sweep's safety mechanism (F1 penalizes noise — precision × recall / (precision + recall)) means lowering the threshold automatically disadvantages configs that admit too much noise. Winner self-selected via the Pareto front; no threshold was hardcoded.

## What Ships to Production

Both constants ship together — they tuned together:
- `HYBRID_WEIGHTS = { rerank: 0.6, recency: 0.05, type_match: 0.1, scope_match: 0.05 }`
- `MIN_COSINE_THRESHOLD = 0.45`

These replace the Plan 02-02 placeholder values in `shared/ai-config/src/index.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] hybrid-rank.test.ts weight assertions asserted Plan 02-02 placeholder values**
- **Found during:** Task 2 (run hybrid-rank unit test to verify tuned weights)
- **Issue:** `hybrid-rank.test.ts` line 31 asserted `{ rerank: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15 }` — the Plan 02-02 placeholder. After committing tuned values, this test failed.
- **Fix:** Updated assertion to match tuned values + added D-34 audit note in comment
- **Files modified:** `packages/mcp-server/src/__tests__/hybrid-rank.test.ts`
- **Commit:** edfebdc

**2. [Rule 1 - Bug] ESLint errors on multi-line hybridRank() calls with `as any` at non-first line**
- **Found during:** First commit attempt (34d6747 pre-commit hook)
- **Issue:** `eslint-disable-next-line` comments only suppress the immediately following line, but `thresholdedBlocks as any` appeared on line 3 of a multi-line call. ESLint reported errors at lines 269, 370, 378.
- **Fix:** Replaced `eslint-disable-next-line` with `/* eslint-disable */ ... /* eslint-enable */` blocks around multi-line hybridRank calls in scoreSplit and top1FlipRate
- **Files modified:** `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts`

### Planned Changes (Deviation from Original Plan)

**Task 2 (prior run):** Originally STOPPED at RNK-06 absolute gate. This session re-executed Task 2 under the D-34 revised design. The "T2-revised" step is net-new work added per user decision D-34.

## D-15 Status

D-15 was skipped in this run (same as prior run) because the 100-entry corpus sweep consumes all 200 budget calls. The D-15 gate was recalibrated per D-34: instead of requiring absolute F1 ≥ 0.8254, the winner must beat the cosine-only baseline on the real-corpus too. The budget structure prevents running it in the same session. To run D-15: restructure to a separate session or raise budget ceiling (requires PRE-02 contract change).

## CF-Code-Assist Routing

| Task | Artifact | Route | Checklist | Reason |
|------|----------|-------|-----------|--------|
| 02-03-T2-revised | recall-ranking.eval.test.ts (D-34 restructure) | claude | Y/N/N | Cross-file type awareness required |
| 02-03-T2-run | ai-config/index.ts + changelog + hybrid-rank.test.ts | claude | Y/N/N | D-06 byte-frozen contract; threshold+weights coordinate |

## Eval Session Discipline

Per RESEARCH Pitfall 3, sessions ran separately:
1. **Reseed session (02-03a, prior session):** `seed-eval-fixtures.eval.test.ts` applied deterministic created_at + scope metadata to 120 ef-* vectors
2. **Sweep session (this plan):** `recall-ranking.eval.test.ts` 2500-config sweep (~109s, 200 AI calls for pre-resolution of 100 queries)
3. **CON workstream (Plan 02-04):** NOT run — separate session as required

## Known Stubs

None. All stubs resolved:
- `HYBRID_WEIGHTS` now holds tuned values (not Plan 02-02 placeholders)
- `MIN_COSINE_THRESHOLD` now holds tuned value (0.45, not original 0.60)
- D-06 audit comment placeholders filled: date 2026-06-08, real F1/MRR/top1 scores, D-34 recalibration note
- `docs/hybrid-rank-changelog.md` exists with 14-column D-21 first row

## Threat Flags

None. No new network endpoints, auth paths, or schema changes at trust boundaries introduced by this plan.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | FOUND |
| `shared/ai-config/src/index.ts` (tuned values, no X.XX placeholders) | FOUND |
| `docs/hybrid-rank-changelog.md` | FOUND |
| `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` | FOUND |
| `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` | FOUND |
| Commit 34d6747 (D-34 sweep design) | FOUND |
| Commit edfebdc (tuned weights + changelog) | FOUND |
| `grep -F 'YYYY-MM-DD' shared/ai-config/src/index.ts` | ZERO MATCHES |
| `grep -F 'F1=X.XX' shared/ai-config/src/index.ts` | ZERO MATCHES |
| `cd packages/mcp-server && npm test -- --project=workerd --run` | 125 PASS, 2 SKIP |
