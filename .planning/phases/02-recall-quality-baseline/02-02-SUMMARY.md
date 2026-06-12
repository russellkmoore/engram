---
phase: "02"
plan: "02"
subsystem: shared-config, mcp-server
tags: [rnk, refactor, shared-config, hybrid-rank, vectorize-utils]
dependency_graph:
  requires: ["02-01"]
  provides: ["02-03"]
  affects: ["packages/mcp-server", "shared/ai-config"]
tech_stack:
  added: []
  patterns:
    - "HYBRID_WEIGHTS moved to @engram/ai-config (single source of truth per ENG-25)"
    - "hybridRank() accepts optional weights parameter for sweep-driven evaluation"
    - "vectorizeQuery import split: read path via @engram/vectorize-utils, write path via ./vectorize-helper.js"
key_files:
  created: []
  modified:
    - shared/ai-config/src/index.ts
    - packages/mcp-server/src/hybrid-rank.ts
    - packages/mcp-server/src/__tests__/hybrid-rank.test.ts
    - packages/mcp-server/src/tools.ts
    - packages/mcp-server/src/vectorize-helper.ts
    - packages/mcp-server/src/__tests__/vectorize-helper.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "D-05: HYBRID_WEIGHTS.cosine renamed to HYBRID_WEIGHTS.rerank — cross-phase contract with Phase 3 EXP-06 bge-reranker swap"
  - "D-06: Audit comment placeholder installed in shared/ai-config/src/index.ts — sweep date YYYY-MM-DD and scores X.XX, to be filled by Plan 02-03"
  - "D-07: hybridRank() parameterized on optional weights: HybridWeights = HYBRID_WEIGHTS; formula uses weights.* not HYBRID_WEIGHTS.* directly"
  - "D-09: tools.ts recall handler imports vectorizeQuery from @engram/vectorize-utils; vectorize-helper.ts retains only upsert/delete"
  - "Re-export pattern: hybrid-rank.ts re-exports HYBRID_WEIGHTS from @engram/ai-config for backwards compat with existing import paths"
metrics:
  duration: "~7 minutes"
  completed_date: "2026-06-05"
  tasks_completed: 3
  files_modified: 7
---

# Phase 02 Plan 02: Shared-Config Refactor + Recall-Path Import Swap Summary

HYBRID_WEIGHTS migrated to @engram/ai-config with D-05 rerank key rename + D-06 audit-comment placeholder; hybridRank() parameterized on optional weights for the Plan 02-03 625-config sweep; tools.ts recall handler now imports vectorizeQuery from @engram/vectorize-utils per D-09.

## What Was Built

### Task 1+2: HYBRID_WEIGHTS migration to @engram/ai-config (D-05, D-06, D-07)

**`shared/ai-config/src/index.ts`** gains two new exports:

```typescript
export const HYBRID_WEIGHTS = {
  rerank: 1.0,        // D-05 rename from `cosine`; placeholder pre-tuning value
  recency: 0.15,
  type_match: 0.2,
  scope_match: 0.15,
} as const;

export type HybridWeights = typeof HYBRID_WEIGHTS;
```

The D-06 audit comment (byte-frozen cross-phase contract) is installed above the literal:

```
// v0.2 Phase 2: `rerank` weight values tuned against RAW COSINE (`match.score` from Vectorize).
// bge-reranker invocation lands in Phase 3 (EXP-06). Until then, `HYBRID_WEIGHTS.rerank * match.score`
// means "raw-cosine weighted by the tuned rerank weight." Do NOT read `HYBRID_WEIGHTS.rerank` as
// "reranker active" in v0.2.
// Corpus: .planning/evals/recall-corpus.json (100 entries, qwen3-embedding-0.6b, sweep date YYYY-MM-DD)
// Scores: F1=X.XX, MRR=X.XX, top1=X.XX
// Re-tune at v0.3 when corpus grows.
```

Plan 02-03 replaces `YYYY-MM-DD`, `X.XX` placeholders with real sweep results.

**`packages/mcp-server/src/hybrid-rank.ts`**:
- Local `HYBRID_WEIGHTS` declaration removed; imports from `@engram/ai-config`
- Re-exports `HYBRID_WEIGHTS` for backwards compat with `import { HYBRID_WEIGHTS } from "../hybrid-rank.js"` test paths
- Local variable `const cosine = match.score` renamed to `const rerank = match.score` per D-07
- `hybridRank()` signature gains 5th param `weights: HybridWeights = HYBRID_WEIGHTS`
- Formula updated to use `weights.rerank`, `weights.recency`, `weights.type_match`, `weights.scope_match`

**`packages/mcp-server/src/__tests__/hybrid-rank.test.ts`**:
- Weight-lock assertion updated: `{ rerank: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15 }`
- New test added: "uses caller-supplied weights when the 5th argument is provided" — calls `hybridRank(..., { rerank: 0.5, recency: 0.5, type_match: 0.0, scope_match: 0.0 })` and verifies scores match expected math (`0.5 * 0.8 + 0.5 * 1.0 = 0.9` for recent block)

### Task 3: vectorizeQuery import swap to @engram/vectorize-utils (D-09)

**`packages/mcp-server/src/tools.ts`**:
- Import split: `vectorizeQuery` now from `@engram/vectorize-utils`; `vectorizeUpsert` + `vectorizeDelete` remain from `./vectorize-helper.js`

**`packages/mcp-server/src/vectorize-helper.ts`**:
- `vectorizeQuery` function removed (moved to `@engram/vectorize-utils` in Plan 02-01)
- `VECTORIZE_TOPK_DEFAULT` constant removed (was only used by `vectorizeQuery`)
- `assertNamespace` + `NAMESPACE_MAX_BYTES` retained (still used by `vectorizeUpsert` + `vectorizeDelete`)
- File header JSDoc updated to document the split

**`packages/mcp-server/src/__tests__/vectorize-helper.test.ts`**:
- `vectorizeQuery` import updated to `@engram/vectorize-utils`
- `vectorizeUpsert` + `vectorizeDelete` imports unchanged from `./vectorize-helper.js`
- All 4 test assertions pass

## Test Results

- `npm test -- --project=workerd --run`: **12 test files passed, 125 tests passed, 2 skipped**
- `npm test -- --project=lint-node --run`: **1 test file passed, 1 test passed**
- `tsc --noEmit`: **zero errors**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @engram/vectorize-utils not symlinked in node_modules**
- **Found during:** Task 3 (first test run after import swap)
- **Issue:** `@engram/vectorize-utils` was declared in `packages/mcp-server/package.json` dependencies but not symlinked in `node_modules/@engram/` — Plan 02-01 created the package but `npm install` had not been run to link it.
- **Fix:** Ran `npm install` at repo root to re-link all workspace packages. The symlink `node_modules/@engram/vectorize-utils -> ../../shared/vectorize-utils` was created.
- **Files modified:** None (npm workspaces linking is transparent)
- **Commit:** n/a (no source change — install side effect)

### Notes on Task 1+2 consolidation

Tasks 1 and 2 were executed atomically in a single commit because the `weights: HybridWeights = HYBRID_WEIGHTS` parameter addition was implemented in the same edit as the D-05/D-07 renames. This is a deviation from the "one task = one commit" pattern but reduces the risk of intermediate state where the formula references both `HYBRID_WEIGHTS.*` and `weights.*`. The commit message documents both tasks clearly.

## CF-Code-Assist Routing

All three code-producing tasks routed to Claude (Q1=Y for all — cross-file synthesis step was the discriminator):
- Task 1+2: byte-frozen D-06 audit comment + 3-file consistent rerank rename
- Task 3: AI-02 isolation invariant must hold across the import boundary

## Known Stubs

- `HYBRID_WEIGHTS.rerank: 1.0` — placeholder value matching v0.1 production defaults. Plan 02-03 commits tuned values from the 625-config sweep.
- D-06 audit comment placeholders: `YYYY-MM-DD`, `F1=X.XX`, `MRR=X.XX`, `top1=X.XX` — Plan 02-03 fills these in with real sweep results.

These stubs are intentional and documented. They do not prevent Plan 02-02's goal (enabling the sweep). Plan 02-03 is the designated filler.

## Threat Flags

No new threat surface introduced. The import swap (D-09) preserves the existing AI-02 workspace isolation guarantee — `vectorizeQuery` in `@engram/vectorize-utils` has the same `assertNamespace` 64-byte guard and `workspaceId` mandatory positional argument as the original. The `lint-no-direct-vectorize.test.ts` gate continues to pass.

## Self-Check

- [x] `shared/ai-config/src/index.ts` exports `HYBRID_WEIGHTS` with `rerank` key and D-06 audit comment
- [x] `shared/ai-config/src/index.ts` exports `HybridWeights` type
- [x] `packages/mcp-server/src/hybrid-rank.ts` imports from `@engram/ai-config`, has `weights` 5th param, uses `weights.rerank` in formula
- [x] `packages/mcp-server/src/tools.ts` imports `vectorizeQuery` from `@engram/vectorize-utils`
- [x] `packages/mcp-server/src/vectorize-helper.ts` has no `vectorizeQuery` export
- [x] All tests pass: workerd (125), lint-node (1)
- [x] Commits exist: 36cc328, 6917ec5
