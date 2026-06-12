---
phase: 04-synthesis-activation-eval
plan: "01"
subsystem: ai-config + mcp-server-tests
tags: [judge-model, eval-only, tdd-red, intl-segmenter, citation-postprocessing, preflight]
dependency_graph:
  requires: []
  provides:
    - JUDGE_MODEL constant in @engram/ai-config (D-04 / SYN-02)
    - synthesis-postprocess.test.ts behavior contracts (D-02/D-03/D-09/SYN-06)
    - synthesis-preflight.test.ts behavior contracts (SYN-05)
    - 04-CF-CODE-ASSIST-USAGE.md routing tracker (D-10)
  affects:
    - packages/mcp-server/src/__tests__/synthesis-fidelity.eval.test.ts (imports JUDGE_MODEL)
    - packages/mcp-server/src/tools.ts (Plan 04-03 must export the helpers these tests import)
tech_stack:
  added: []
  patterns:
    - PendingToolsExports interface cast pattern for RED-state TDD imports
    - Intl.Segmenter availability probe (passes in both Segmenter-available and fallback states)
key_files:
  created:
    - shared/ai-config/src/index.ts (modified — JUDGE_MODEL constant added after line 110)
    - .planning/phases/04-synthesis-activation-eval/04-CF-CODE-ASSIST-USAGE.md
    - packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts
    - packages/mcp-server/src/__tests__/synthesis-preflight.test.ts
  modified: []
decisions:
  - "PendingToolsExports interface cast (vs @ts-expect-error import): avoids ESLint no-unsafe-call while preserving correct TDD import contract; Plan 04-03 replaces with named exports"
  - "Intl.Segmenter probe: always-pass design (documents path active, never fails on missing API); confirmed AVAILABLE in current workerd build"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-10T03:50:33Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 4 Plan 01: Wave 0 Infrastructure — JUDGE_MODEL + Test Stubs Summary

Wave 0 blocking dependencies for synthesis hardening (Plan 04-03) and the eval gate (Plan 04-04): JUDGE_MODEL eval-only constant, cf-code-assist routing tracker scaffold, and unit test behavior contracts for all post-processing helpers.

## What Was Built

### Task 1: JUDGE_MODEL constant + 04-CF-CODE-ASSIST-USAGE.md

Added `JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const` to `shared/ai-config/src/index.ts` (after the `EXPANSION_CHALLENGER_MODEL` block, before `EMBEDDING_DIMS`). JSDoc encodes:
- EVAL-ONLY posture (do NOT call in production recall() path)
- D-04 rationale: larger model than Scout required (Scout-judging-Scout is self-lenient)
- Deprecation warning for `@cf/meta/llama-3.1-70b-instruct` (deprecated 2026-05-30)

Scaffolded `04-CF-CODE-ASSIST-USAGE.md` with the Phase 2 tracker template, substituting Phase 4 scope, D-10 candidate task shapes, and an initially seeded routing table (2 rows appended during this plan's execution).

**Commit:** `3f6eddf`

### Task 2: Unit test stubs (TDD RED state)

Created two test files establishing behavior contracts for helpers not yet exported from `tools.ts`:

**`synthesis-postprocess.test.ts`** (10 tests across 4 describe blocks):
- Intl.Segmenter availability probe — PASSES (documents which segmentation path is active)
- D-02 `mapPositionsToCitationIds`: 3 tests (basic replacement, case-insensitive, D-03 out-of-range)
- D-09 `dropUncitedSentences`: 4 tests (basic drop, hedge exception, gap-ack exception, D-03+D-09 integration)
- SYN-06 `applyHedgePrefix`: 2 tests (lowConfidence=true/false)

**`synthesis-preflight.test.ts`** (3 tests):
- SYN-05 throw: single oversized memory (6001*4+1 chars) must throw preflight error
- SYN-05 partial truncation: two memories, only first fits → returns [first], no throw
- SYN-05 meta.gaps boundary: contract documentation for the integration test in Plan 04-03

Both files use vi.mock hoisting pattern from `query-expansion.test.ts` analog. The `PendingToolsExports` interface cast pattern avoids ESLint `no-unsafe-call` errors while keeping correct TDD import contracts — Plan 04-03 replaces the cast with named exports.

**Commit:** `56b80bd`

## Test State

| File | Tests | Passing | Failing | Reason for failing |
|------|-------|---------|---------|-------------------|
| synthesis-postprocess.test.ts | 10 | 1 (Segmenter probe) | 9 | helpers not yet exported from tools.ts |
| synthesis-preflight.test.ts | 3 | 0 | 3 | trimRankedForSynthesis not yet exported from tools.ts |

RED state is the correct TDD posture for this plan. Plan 04-03 turns these GREEN by exporting the helpers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint unsafe-call errors on not-yet-exported function imports**
- **Found during:** Task 2 commit (husky pre-commit hook)
- **Issue:** `@ts-expect-error` import suppresses TypeScript but not ESLint's `no-unsafe-assignment` / `no-unsafe-call` rules (strict mode via `strictTypeChecked`)
- **Fix:** Replaced `@ts-expect-error` import with `PendingToolsExports` interface cast pattern: `toolsModule as unknown as PendingToolsExports` — typed at declaration, dot-notation access, no ESLint warnings
- **Files modified:** Both test files
- **Commit:** Included in `56b80bd`

## Known Stubs

None — no production code modified in this plan; test stubs are intentional RED-state artifacts (documented above).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The JUDGE_MODEL constant is `as const` (T-04-01-02 mitigated as planned). The tracker file contains no credentials (T-04-01-01 accepted).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| shared/ai-config/src/index.ts exists | FOUND |
| 04-CF-CODE-ASSIST-USAGE.md exists | FOUND |
| synthesis-postprocess.test.ts exists | FOUND |
| synthesis-preflight.test.ts exists | FOUND |
| 04-01-SUMMARY.md exists | FOUND |
| Commit 3f6eddf (Task 1) exists | FOUND |
| Commit 56b80bd (Task 2) exists | FOUND |
