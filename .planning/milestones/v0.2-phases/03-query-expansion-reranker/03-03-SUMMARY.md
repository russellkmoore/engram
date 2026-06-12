---
phase: 03
plan: "03-03"
subsystem: mcp-server
tags: [recall, query-expansion, rrf, bge-reranker, adaptive-routing, exp-03, exp-06, exp-10]
requires:
  - "03-01"  # reciprocalRankFusion + RERANKER_MODEL
  - "03-02"  # expandQuery + keepVariantsAboveGate
provides:
  - "03-04"  # eval harness (needs live recall() path to exercise)
  - "03-05"  # behavioral eval (exercises recall() adaptive gate + reranker)
affects:
  - "packages/mcp-server/src/tools.ts"
  - "packages/mcp-server/src/hybrid-rank.ts"
  - "packages/mcp-server/src/envelope.ts"
tech_stack:
  added:
    - "@cf/baai/bge-reranker-base — bge-reranker via safeRun (EXP-06, workerd#5998 bypass)"
  patterns:
    - "Adaptive routing gate (top1_cosine < ADAPTIVE_TOP1_THRESHOLD=0.65)"
    - "RRF fan-out with Promise.all parallel variant queries"
    - "Index-aligned reranker context mapping (r.id = INTEGER index into contexts[])"
    - "Sigmoid normalization of reranker logit scores before hybridRank"
    - "EXP-10 expansionUnavailable flag + META_GAPS append after buildRecallResponse"
key_files:
  modified:
    - packages/mcp-server/src/tools.ts
    - packages/mcp-server/src/hybrid-rank.ts
    - packages/mcp-server/src/envelope.ts
    - packages/mcp-server/src/__tests__/__snapshots__/envelope.test.ts.snap
  created:
    - packages/mcp-server/src/__tests__/recall.test.ts
decisions:
  - "D-EXP-03: ADAPTIVE_TOP1_THRESHOLD=0.65 — single-query Vectorize pass first; fan-out only when top1 < 0.65"
  - "D-EXP-06: safeRun(env, RERANKER_MODEL, {query, contexts}) bypasses workerd#5998; r.id is INTEGER INDEX into contexts[] not a block id"
  - "D-EXP-10: expansionUnavailable flag set in catch; META_GAPS.queryExpansionUnavailable appended AFTER buildRecallResponse so it survives trimToBudget"
  - "D-PITFALL6: blockTextMap pre-computes content/summary; empty-content candidates excluded from contexts[], keep raw cosine via ?? m.score"
  - "D-HYBRID-FORMULA: hybridRank formula (lines 113-117) BYTE-IDENTICAL to Phase 2 D-34 sweep winner — only what feeds rerank component changed"
  - "D-TDD-COMBINED: RED+GREEN combined into single feat() commit — ESLint lint-staged blocks test-only commits importing unresolved modules (same pattern as 03-01, 03-02)"
metrics:
  duration: "~45 minutes"
  completed_date: "2026-06-08"
  tasks_completed: 2
  files_changed: 5
  lines_added: 686
  lines_removed: 4
---

# Phase 3 Plan 03-03: recall() Integration Hub Summary

**One-liner:** Wired adaptive routing (EXP-03), RRF fan-out (EXP-04), bge-reranker with index-alignment + sigmoid normalization (EXP-06), and persistent 429 fallback with meta.gaps (EXP-10) into the recall() handler; 12 handler-branch unit tests cover all branches.

## Objective

Integrate the Phase 3 components built in Wave 1 (03-01: RRF + RERANKER_MODEL, 03-02: expandQuery + keepVariantsAboveGate) into the live `recall()` handler in `tools.ts`. This plan is the integration hub — all EXP requirements that touch the main recall path converge here.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| T1 | recall() adaptive routing + RRF + reranker + EXP-10 + tests (RED+GREEN combined) | `134848b` | tools.ts, envelope.ts, hybrid-rank.ts, recall.test.ts, snapshot |

## What Was Built

### EXP-03: Adaptive Routing Gate

After the single-query Vectorize pass, `recall()` checks `top1_cosine = result.matches[0]?.score ?? 0`. If `top1 >= ADAPTIVE_TOP1_THRESHOLD (0.65)`, the single-query result is used directly — no expansion cost. If `top1 < 0.65`, the multi-query fan-out fires.

```
ADAPTIVE_TOP1_THRESHOLD = 0.65
single-query pass → check top1 → [≥ 0.65] use result → ...
                                → [< 0.65]  expandQuery → keepVariantsAboveGate(0.85)
                                              → Promise.all(embed + vectorize per variant)
                                              → reciprocalRankFusion merge
```

### EXP-04: RRF Fan-Out

When fan-out fires, surviving variants are embedded and queried in parallel via `Promise.all`. All per-variant `vectorizeQuery` calls use `props.workspace_id` (never `args`) enforcing T-03-05 workspace isolation. `reciprocalRankFusion(lists).map(x => x.item)` produces `mergedMatches`.

### EXP-06: bge-Reranker (index-aligned, sigmoid-normalized)

Between hydrating blocks from SQLite and calling `hybridRank`:

1. `blockTextMap` pre-builds `id → text` from `content ?? summary ?? ""` for all hydrated blocks
2. `rankedCandidates` filters to non-empty-text candidates (Pitfall 6 guard — T-03-07)
3. `contexts = rankedCandidates.map(m => ({ text: blockTextMap.get(m.id) ?? "" }))`
4. `safeRun(env, RERANKER_MODEL, { query: args.query, contexts })` — bypasses workerd#5998
5. `rerankScores.set(cand.id, sigmoid(r.score))` — `r.id` is the INTEGER index into `contexts[]`, `rankedCandidates[r.id]` maps back to the memory id. Sigmoid `1/(1+e^-x)` normalizes logit to [0,1].
6. `rerankedMatches = filteredMatches.map(m => ({ ...m, score: rerankScores.get(m.id) ?? m.score }))` — candidates without reranker scores (excluded from contexts or orphaned) keep their raw Vectorize cosine.

On reranker throw (429/error): `rerankScores` stays empty → all matches keep raw cosine → `hybridRank` proceeds normally.

### EXP-10: Persistent 429 Fallback

The entire fan-out block (`expandQuery` → `keepVariantsAboveGate` → `Promise.all` → `reciprocalRankFusion`) is wrapped in try/catch. On ANY throw (including RateLimitError re-thrown by `expandQuery`):

- `expansionUnavailable = true`
- `mergedMatches = result.matches` (fall back to single-query result)

After `buildRecallResponse`, the flag is checked:
```typescript
if (expansionUnavailable) {
  envelope.meta.gaps = [...envelope.meta.gaps, META_GAPS.queryExpansionUnavailable];
}
```

Appending AFTER `buildRecallResponse` ensures the gap note survives `trimToBudget` (D-10 byte-frozen position).

### hybrid-rank.ts: Doc-Comment Only

The rerank component comment was updated to document that `match.score` now carries the sigmoid-normalized bge-reranker output (or raw cosine on fallback). The formula at lines 113-117 is byte-identical to the Phase 2 D-34 sweep winner — UNCHANGED.

### envelope.ts: META_GAPS Extension

`queryExpansionUnavailable: "query expansion unavailable"` added to `META_GAPS` constant. Snapshot updated accordingly. The string is byte-frozen per D-10.

### recall.test.ts: 12 Handler-Branch Unit Tests

**EXP-03 block (4 tests):**
- T1: `expandQuery` NOT called when `top1 >= 0.65` (single safeRun call for embed only)
- T2: `expandQuery` called + RRF merges lists when `top1 < 0.65`
- T3 (EXP-10): `expandQuery` throws → `meta.gaps` contains "query expansion unavailable"; RRF not called
- T4: All fan-out `vectorizeQuery` calls verified to use `props.workspace_id`

**EXP-06 block (4 tests + 4 from rrf.test.ts):**
- T1: reranker response `{id: 2, score: 5.0}` → index 2 candidate wins (index-alignment pinned)
- T2: sigmoid normalization — logit 5.0 → ≈0.9933, logit 0.0 → 0.5, logit -2.0 → ≈0.1192
- T3: reranker throws → recall doesn't crash; matches keep raw cosine (fallback)
- T4 (Pitfall 6): null content + null summary candidate excluded from contexts; only 1 context sent; excluded candidate keeps raw cosine

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint accumulator pattern — `let x | null` pattern rejected**
- **Found during:** Task 1 (second commit attempt)
- **Issue:** `capturedMatchArg ?? []` flagged as "unnecessary conditional" — TypeScript sees left side as always `null | undefined`, making the `??` branch unreachable. ESLint also blocks `capturedMatchArg!.` non-null assertions.
- **Fix:** Changed from `let capturedArg: T | null = null` + post-call access to accumulator array `const captured: T[] = []` with `push(...)` inside mock implementation body.
- **Files modified:** `recall.test.ts`
- **Commit:** `134848b` (combined with implementation)

**2. [Rule 1 - Bug] ESLint `@typescript-eslint/no-explicit-any` on `fakeEnv`**
- **Found during:** Task 1 (first commit attempt)
- **Issue:** `fakeEnv = { ... } as any` needed `eslint-disable` comment; leftover after refactor it became an unused disable.
- **Fix:** Removed unused disable directives; used `Array.from<number>` typed generics to avoid `any` inference.
- **Files modified:** `recall.test.ts`
- **Commit:** `134848b` (combined with implementation)

**3. [Rule 1 - Bug] `BlockWithText` type alias rejected — interface required**
- **Found during:** Task 1 (first commit attempt)
- **Issue:** `@typescript-eslint/consistent-type-definitions` requires `interface` over `type` for object shapes.
- **Fix:** Changed `type BlockWithText = { ... }` → `interface BlockWithText { ... }`.
- **Files modified:** `tools.ts`
- **Commit:** `134848b`

**4. [TDD Pattern] RED + GREEN combined into single feat() commit**
- **Reason:** ESLint lint-staged blocks test-only commits that import unresolved modules. The test file imports from `query-expansion.ts`, `rrf.ts`, and `envelope.ts` constants being modified — all pass after the GREEN implementation.
- **Precedent:** Same pattern used in 03-01 and 03-02.
- **Impact:** None — all 12 tests pass and are committed.

### Snapshot Test (Expected Update)

`envelope.test.ts.snap` updated to include the new `queryExpansionUnavailable` key in alphabetical position. This was an expected update per the plan (adding `META_GAPS.queryExpansionUnavailable`), not a surprise.

## Verification

All tests pass:

```
cd packages/mcp-server && npx vitest run recall
✓ __tests__/rrf.test.ts (4)
✓ __tests__/recall.test.ts (12)
```

Full suite:
```
cd packages/mcp-server && npm test
18 test files | 157 passed | 2 skipped
```

Acceptance criteria grep checks (all pass):
- `0.65` threshold in tools.ts
- `reciprocalRankFusion` called
- `expandQuery` called
- `vectorizeQuery(env, props.workspace_id` (≥2 occurrences)
- `safeRun(env, RERANKER_MODEL` (≥1)
- `Math.exp(-` for sigmoid (≥1)
- `?? m.score` fallback (≥1)
- `hybridRank` formula at lines 113-117 UNCHANGED (diff shows doc-comment changes only)

## Known Stubs

None. All implemented paths are wired to live logic. The bge-reranker is invoked through `safeRun` which uses the actual `env.AI.run` binding. The EXP-10 fallback is a real code path (catch block), not a placeholder.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. The reranker call goes through `safeRun` which already has the workerd#5998 guard. `workspace_id` always sourced from `props` (validated JWT) per T-03-05.

## Self-Check

- [x] `packages/mcp-server/src/__tests__/recall.test.ts` — FOUND (554 lines)
- [x] `packages/mcp-server/src/tools.ts` — FOUND (modified)
- [x] `packages/mcp-server/src/envelope.ts` — FOUND (modified)
- [x] `packages/mcp-server/src/hybrid-rank.ts` — FOUND (doc-comment updated, formula UNCHANGED)
- [x] `packages/mcp-server/src/__tests__/__snapshots__/envelope.test.ts.snap` — FOUND (updated)
- [x] Commit `134848b` — FOUND
- [x] All 157 tests pass, 0 failures
