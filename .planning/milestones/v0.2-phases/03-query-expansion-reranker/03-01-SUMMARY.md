---
phase: 03-query-expansion-reranker
plan: "01"
subsystem: mcp-server, ai-config
tags: [rrf, reranker, pure-transform, constants, unit-tests, EXP-04, EXP-05]
dependency_graph:
  requires: []
  provides:
    - reciprocalRankFusion pure transform (EXP-04) — consumed by Wave 2 recall() fan-out
    - RERANKER_MODEL constant (EXP-05) — consumed by Wave 2/3 EXP-06 safeRun call
  affects:
    - packages/mcp-server/src/tools.ts (Wave 2 will import rrf.ts)
    - shared/ai-config/src/index.ts (RERANKER_MODEL added)
tech_stack:
  added: []
  patterns:
    - pure-transform (O(1) Map accumulation, no env/IO/mutation — mirrors hybrid-rank.ts)
    - TDD RED/GREEN with workerd vitest pool
    - as const model-ID constant export (mirrors EMBEDDING_MODEL form)
    - Node-pool vitest config for pure-constants package
key_files:
  created:
    - packages/mcp-server/src/rrf.ts
    - packages/mcp-server/src/__tests__/rrf.test.ts
    - shared/ai-config/src/__tests__/ai-config.test.ts
    - shared/ai-config/vitest.config.ts
  modified:
    - shared/ai-config/src/index.ts (RERANKER_MODEL added)
    - shared/ai-config/package.json (test script + vitest devDependency)
    - shared/ai-config/tsconfig.json (vitest.config.ts added to include)
decisions:
  - "RERANKER_MODEL placed in model-ID const block after EMBEDDING_MODEL — same as const form, doc-comment documents EXP-06/safeRun/sigmoid context"
  - "ai-config gets its own vitest.config.ts (Node pool) — no workerd pool needed for constants-only tests"
  - "tsconfig.json updated to include vitest.config.ts so ESLint project service resolves it"
metrics:
  duration: ~5 minutes
  completed: 2026-06-08
  tasks_completed: 2
  files_created: 4
  files_modified: 3
---

# Phase 3 Plan 1: RRF Pure Transform + RERANKER_MODEL Constant Summary

`reciprocalRankFusion(lists, k=60)` pure transform with Elasticsearch reference vectors + `RERANKER_MODEL = "@cf/baai/bge-reranker-base"` exported from `@engram/ai-config`.

## What Was Built

### Task 1 — reciprocalRankFusion (EXP-04)

`packages/mcp-server/src/rrf.ts` exports `reciprocalRankFusion<T extends { id: string }>(lists: T[][], k = 60)`. Key properties:

- **Pure transform**: no `env`, no `await`, no IO — mirrors `hybrid-rank.ts` purity discipline.
- **O(1) Map accumulation**: keyed by `item.id`, accumulates `1/(k+rank)` contributions across lists.
- **New array return**: `[...scores.entries()].map(...).sort(...)` — never sorts in place.
- **Insertion-order tiebreak**: JS Map iteration order makes first-seen id win on score ties.
- **Default k=60**: matches Elasticsearch/Cormack-Clarke-Büttcher recommendation.

`packages/mcp-server/src/__tests__/rrf.test.ts` has 4 tests, all green:

1. Elasticsearch k=1 fixture: 5-doc BM25+kNN example — doc3=0.8333 winner, correct ordering.
2. k=60 default: D1 (0.032522) > D3 (0.032267) > D2 (0.031754) — numerical order matches insertion order.
3. Single-list passthrough: exact scores 1/(61), 1/(62), 1/(63).
4. Purity: input arrays unchanged after call.

### Task 2 — RERANKER_MODEL constant (EXP-05)

Added to `shared/ai-config/src/index.ts` model-ID const block (after `EMBEDDING_MODEL`):

```typescript
export const RERANKER_MODEL = "@cf/baai/bge-reranker-base" as const;
```

Doc-comment explains: called via `safeRun` to dodge workerd#5998, logits sigmoid-normalized before `hybridRank`, Phase 3 EXP-06 consumption.

`HYBRID_WEIGHTS` block confirmed **unchanged** — `cosine → rerank` rename shipped in Phase 2 D-05, only `RERANKER_MODEL` is net-new (EXP-05 landmine avoided).

`shared/ai-config/src/__tests__/ai-config.test.ts` added with 3 tests:
- `RERANKER_MODEL === "@cf/baai/bge-reranker-base"`
- `HYBRID_WEIGHTS.rerank` is a number > 0
- `EMBEDDING_MODEL` unchanged

Also added `vitest.config.ts` (Node pool) + test script + `tsconfig.json` update.

## Verification

```
cd packages/mcp-server && npx vitest run rrf         → 4 passed
cd shared/ai-config && npx vitest run ai-config      → 3 passed
cd packages/mcp-server && npm test                   → 16 test files, 135 passed, 2 skipped (no regression)
grep -c "RERANKER_MODEL.*@cf/baai/bge-reranker-base" shared/ai-config/src/index.ts  → 1
grep "env\.\|await" packages/mcp-server/src/rrf.ts (excl comments)  → 0
git diff shared/ai-config/src/index.ts | grep HYBRID_WEIGHTS  → (empty — unchanged)
```

## Deviations from Plan

**1. [Rule 3 - Blocking] ai-config needed vitest config, package.json test script, and tsconfig update**
- **Found during:** Task 2
- **Issue:** `shared/ai-config` had no test infrastructure — no vitest config, no `test` script, no `__tests__` directory. ESLint pre-commit hook also rejected `vitest.config.ts` because it wasn't in the tsconfig include array.
- **Fix:** Added `vitest.config.ts` (Node pool, no workerd needed for constants), updated `package.json` with test script + vitest devDependency, updated `tsconfig.json` to include `vitest.config.ts`.
- **Files modified:** `shared/ai-config/vitest.config.ts`, `shared/ai-config/package.json`, `shared/ai-config/tsconfig.json`
- **Commit:** 553897c

**2. [Rule 3 - Blocking] TDD RED commit blocked by ESLint — rrf.ts needed before test could lint-stage**
- **Found during:** Task 1 TDD RED phase
- **Issue:** ESLint's `@typescript-eslint/no-unsafe-*` rules reject member access on an unresolved module. Staging `rrf.test.ts` alone (before `rrf.ts` exists) fails lint-staged because the import can't be resolved.
- **Fix:** Combined RED (test) + GREEN (implementation) into a single commit. Tests were confirmed RED (Cannot find module) first, then implementation written and confirmed GREEN before the combined commit.
- **Commit:** e8f83b5

## Threat Surface Scan

No new trust boundaries introduced. Both additions are pure compile-time artifacts:
- `rrf.ts`: pure transform, no network, no IO.
- `RERANKER_MODEL`: string constant, no runtime surface until Wave 2 wires it to `safeRun`.

## Known Stubs

None. Both deliverables are complete and self-contained. Wave 2 imports `reciprocalRankFusion` and `RERANKER_MODEL` from these stable, tested contracts.

## Self-Check: PASSED

- `packages/mcp-server/src/rrf.ts` — FOUND
- `packages/mcp-server/src/__tests__/rrf.test.ts` — FOUND
- `shared/ai-config/src/__tests__/ai-config.test.ts` — FOUND
- `shared/ai-config/vitest.config.ts` — FOUND
- commit e8f83b5 — FOUND (`feat(03-01): reciprocalRankFusion...`)
- commit 553897c — FOUND (`feat(03-01): RERANKER_MODEL...`)
