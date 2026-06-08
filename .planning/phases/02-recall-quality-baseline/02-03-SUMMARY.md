---
phase: 02-recall-quality-baseline
plan: "03"
subsystem: mcp-server, shared-config
tags: [rnk, eval, sweep, hybrid-rank, blocker]
dependency_graph:
  requires: ["02-03a"]
  provides: []
  affects: [shared/ai-config, packages/mcp-server/src/__tests__/evals, docs]
tech_stack:
  added: []
  patterns:
    - "Sweep test now threads expected_args per-entry into hybridRank() (D-26)"
    - "Variance precondition asserts distinct created_at > 1 AND distinct scope > 1 post-pre-resolution"
    - "Anti-reward-hack tunability assertion: distinct train.f1 > 1 across 625 configs"
key_files:
  created: []
  modified:
    - packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
key_decisions:
  - "STOPPED per plan's STOP procedure: sweep winner F1=0.3429 < 0.8254 RNK-06 gate — weights NOT committed"
  - "Tunability (HR-2) confirmed: 7 distinct F1 values across 625 configs, variance precondition passed"
  - "D-15 dual-corpus gate not reached (RNK-06 failed first)"
requirements-completed: []
duration: ~11 hours (including reseed ~6min, sweep ~85s)
completed: "2026-06-08"
---

# Phase 02 Plan 03: 625-Config Hybrid-Rank Sweep Summary

**Sweep ran, proved tunable (HR-2 closed), but best F1=0.3429 across all 625 configs — far below the 0.8254 RNK-06 gate. HYBRID_WEIGHTS not updated; blocker raised for human decision on D-15 gate calibration.**

## Performance

- **Duration:** ~11 hours (02-03a reseed session ~6min, sweep session ~85s, analysis + summary)
- **Started:** 2026-06-08T00:05:44Z (sweep run)
- **Completed:** 2026-06-08 (this summary)
- **Tasks completed:** 1 of 2 (Task 1 committed; Task 2 STOPPED at gate)
- **Files modified:** 2

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire expected_args + tunability assertion into sweep test | fd8f2f8 | recall-ranking.eval.test.ts, 02-CF-CODE-ASSIST-USAGE.md |
| 2 | Run sweep + commit tuned weights + seed changelog | STOPPED | — |

## Sweep Results

### Pre-run verification

- **Reseed session (02-03a pending):** COMPLETED — `seed-eval-fixtures.eval.test.ts` ran for ~6 minutes; 120 ef-* blocks re-upserted into Vectorize `engram-memories/eval-fixtures` with new deterministic `created_at` (exp-decay 0-90d) + `scope` {personal/project} metadata from `seed-prep.ts`.
- **Eval session standalone:** YES — sweep ran as its own `npm test -- --project=eval recall-ranking.eval.test.ts --run` session, separate from reseed and from 02-04 (CON workstream).

### Gate results

| Gate | Result | Value | Threshold |
|------|--------|-------|-----------|
| Variance precondition (D-24) | **PASS** | distinct created_at=106, distinct scope=2 | >1 each |
| Tunability / HR-2 closure | **PASS** | distinct F1=7 (min=0.3143, max=0.3429) | >1 |
| Budget discipline (D-19) | **PASS** | 200 AI calls (100 queries × 2 calls each) | ≤200 |
| Sweep completeness (D-01) | **PASS** | 625 configs evaluated | =625 |
| D-04 train→validate gap | **PASS** | gap=−0.0349 (validate > train) | <0.10 |
| RNK-04 sensitivity | **PASS** | top1_flip_rate=0.0125 (1.25%) | <0.30 AND >0 |
| **RNK-06 baseline regression** | **FAIL** | winner F1=0.3429 | ≥0.8254 |
| D-15 dual-corpus (27-entry) | NOT REACHED | — | ≥0.8254 |

### Winner (at gate failure)

```
cfg={"rerank":0.6,"recency":0.05,"type_match":0.1,"scope_match":0.05}
f1_train=0.3429  f1_validate=0.3778  mrr_train=N/A  top1_train=N/A
sensitivity_top1_flip_rate=0.0125
```

This winner was NOT committed to HYBRID_WEIGHTS per the STOP procedure.

### F1 spread across 625 configs

```
[RNK] f1 spread: min=0.3143 max=0.3429 distinct=7
```

7 distinct F1 values confirm the eval is genuinely tunable (HR-2 closed). The spread is narrow but real — different weight configs produce measurably different F1. The problem is the ABSOLUTE F1 ceiling, not tunability.

## Blocker Analysis: Why F1 is 0.34 vs Expected 0.8254

### Root cause hypothesis

The 0.8254 baseline F1 was measured by `recall-f1.eval.test.ts` which uses the **full production pipeline**:
1. `remember()` ingests corpus queries into a live WorkspaceDO (SQLite) + Vectorize
2. `recall()` queries that same workspace, with properly-formed documents whose vectors are optimized for the query text
3. F1 measured against `expected_top_3_block_ids` from the same session's ingested IDs

The `recall-ranking.eval.test.ts` sweep tests a **fundamentally different architecture**:
1. 120 pre-seeded `ef-*` blocks in a static Vectorize namespace
2. Corpus queries designed to match those blocks based on content similarity
3. `hybridRank()` applied to whatever Vectorize returns from those static embeddings

**The structural mismatch:** Even after the 02-03a reachability relabeling (which confirmed expected blocks ARE in qwen3 top-50), the best F1 the sweep achieves is 0.3429. This suggests that:
- Only ~1 of 3 expected blocks appears in the filtered top-25 results per query
- The relabeled `expected_top_3_block_ids` may include blocks ranked 26-50 in cosine space (reachable in top-50, but filtered out by `slice(0, 25)`)
- Or the `MIN_COSINE_THRESHOLD=0.6` filter is too aggressive for the eval-fixtures namespace

### Evidence for filter cutoff

The sweep fetches `topK = 25 * VECTORIZE_OVERFETCH_FACTOR = 50`, then:
1. Filters: `m.score >= MIN_COSINE_THRESHOLD (0.6)` — eliminates blocks below 0.6 cosine
2. Slices: `.slice(0, 25)` — keeps top 25 after threshold

The relabeling script verified blocks are in qwen3 top-50 WITHOUT a cosine threshold. If an expected block is at rank 30 with cosine=0.57, it:
- Passes the top-50 reachability check
- Is ELIMINATED by `MIN_COSINE_THRESHOLD=0.6`
- Never appears in sweep results

**This explains why F1=0.34 is consistent across configs** — the threshold/slice is the binding constraint, not the weights.

### Decision required (per CONTEXT.md D-15 STOP procedure)

The plan explicitly states: "if any gate fails, STOP, raise a blocker, do NOT commit." The following decision is needed:

**Option A: Accept F1=0.34 as the realistic sweep ceiling and lower the RNK-06 gate threshold to 0.35 or higher.**
- Pro: Honest — the sweep F1 measures reranking quality given what Vectorize returns
- Con: Breaks the D-15 "apples-to-apples" comparison with the 0.8254 production baseline
- Impact: HYBRID_WEIGHTS would be tuned against a lower bar

**Option B: Remove the `MIN_COSINE_THRESHOLD` filter from the sweep (let all top-50 through).**
- Pro: More results available for reranking; likely higher F1 ceiling
- Con: Changes the eval to test a different thing than production (which uses the threshold)
- Impact: Sweep F1 would be higher but wouldn't reflect production behavior

**Option C: Rebuild the sweep to use the full production pipeline (WorkspaceDO + remember/recall).**
- Pro: Directly measures production behavior; F1 would be comparable to 0.8254 baseline
- Con: Budget: 100 queries × remember+recall = ~600 AI calls, far above MAX_AI_CALLS=200
- Impact: Requires raising or restructuring the eval budget ceiling (breaks PRE-02 contract)

**Option D: Restructure eval-fixtures to use the same remember/recall pipeline as recall-f1.eval.test.ts.**
- Pro: Unifies the two eval approaches
- Con: Loses the pure-reranking isolation benefit; two eval sessions merge into one
- Impact: Major rework of both eval tests

**Option E: Accept that the sweep F1 ceiling is a corpus-quality issue and invest in a higher-quality eval-fixtures corpus (better content-to-query alignment).**
- Pro: Addresses root cause
- Con: Requires significant corpus curation work (new sprint)
- Impact: Blocks the entire RNK workstream until corpus is improved

**Recommended (Claude's assessment):** Option A or B, with the following reasoning: The D-15 gate's absolute F1 ≥ 0.8254 threshold was calibrated against the production recall pipeline, not the sweep-only pipeline. The CONTEXT.md D-15 says "the planner must surface this as a decision point" — this is exactly that surface. The most pragmatic path may be to lower the RNK-06 sweep gate to a realistic ceiling (e.g., 0.50 given the new eval design), accept that the sweep tunes RELATIVE weight effectiveness (not absolute F1), and keep the production pipeline eval (recall-f1.eval.test.ts) as the absolute F1 regression check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint error: unnecessary null check on non-nullable type**
- **Found during:** Task 1 commit (pre-commit hook)
- **Issue:** `e.expected_args !== null` was flagged as an unnecessary condition — the TypeScript type for `expected_args` is `{ ... } | undefined`, never `null`
- **Fix:** Removed `&& e.expected_args !== null` from the filter predicate (keep only `!== undefined`)
- **Files modified:** `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts`

### Planned Actions NOT Taken (STOP Procedure)

**Task 2 (run sweep + commit weights):** STOPPED at RNK-06 gate.
- Reseed session ran (precondition met)
- Sweep ran to completion (625 configs)
- Tunability confirmed (7 distinct F1 values, HR-2 blocker closed)
- RNK-06 gate FAILED: winner F1=0.3429 < 0.8254 threshold
- HYBRID_WEIGHTS NOT updated (still holds Plan 02-02 placeholder values)
- docs/hybrid-rank-changelog.md NOT created
- audit comment placeholders NOT filled in

Per plan STOP procedure: "STOP, raise a blocker citing the specific gate. Do NOT commit. Re-plan via /gsd:plan-phase 2 --replan-section weight-sweep as needed."

## CF-Code-Assist Routing

| Task | Artifact | Route | Checklist | Reason |
|------|----------|-------|-----------|--------|
| 02-03-T1 | recall-ranking.eval.test.ts (expected_args wiring + tunability assertion) | claude | Y/N/N | Cross-file type awareness needed; <50 LOC surgical edits |
| 02-03-T2 | audit-comment fill + changelog seed | claude | NOT EXECUTED (sweep gated) | — |

## Known Stubs

- `HYBRID_WEIGHTS` in `shared/ai-config/src/index.ts` still holds Plan 02-02 placeholder values (`rerank: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15`) — awaiting human decision on gate calibration before committing tuned values.
- D-06 audit comment placeholders (`YYYY-MM-DD`, `F1=X.XX`) remain unfilled.
- `docs/hybrid-rank-changelog.md` does not yet exist.

## Next Steps (requires human decision)

1. Choose a decision from the options above (A–E)
2. For Option A or B: update PLAN.md RNK-06 threshold and re-run via `/gsd:execute-phase 2 --plan 02-03`
3. For other options: re-plan via `/gsd:plan-phase 2 --replan-section weight-sweep`
4. Confirm on the Linear RNK sub-issue which option was chosen

## Eval Session Discipline

Per RESEARCH Pitfall 3, sessions ran separately:
1. **Pre-eval reseed session** (this plan): `seed-eval-fixtures.eval.test.ts` applied new `seed-prep.ts` deterministic metadata to 120 ef-* Vectorize vectors (~6 min, 120 AI calls)
2. **Sweep session** (this plan): `recall-ranking.eval.test.ts` 625-config sweep (~85s, 200 AI calls for pre-resolution of 100 queries)
3. **CON workstream (Plan 02-04):** NOT run — separate session as required

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | FOUND |
| `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` | FOUND |
| Commit fd8f2f8 (Task 1) | FOUND |
| Sweep log at /tmp/recall-ranking-sweep.log | FOUND |
| HYBRID_WEIGHTS NOT updated (correct per STOP procedure) | VERIFIED |
| docs/hybrid-rank-changelog.md NOT created (correct per STOP procedure) | VERIFIED |
