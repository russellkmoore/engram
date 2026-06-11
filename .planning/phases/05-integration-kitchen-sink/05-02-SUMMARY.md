---
phase: "05-integration-kitchen-sink"
plan: "02"
subsystem: "mcp-server"
tags: ["integration-test", "token-budget", "INT-01", "INT-04", "kitchen-sink"]
dependency_graph:
  requires:
    - "05-01"  # phase routing tracker + matrix audit
  provides:
    - "v02-kitchen-sink.test.ts"  # INT-01 worst-case envelope + 6 matrix row describe blocks
  affects:
    - "packages/mcp-server/src/__tests__/integration/"
tech_stack:
  added: []
  patterns:
    - "stateful namespace-aware Vectorize mock (per recall-conflicts.test.ts)"
    - "AI mock dispatch by body shape (text=embed, messages=synthesis/expansion)"
    - "kitchenSinkTop1Score override for adaptive gate testing"
    - "adversarial-proof pre-trim assertion (beforeTokens > 7_500)"
    - "D-05 content-preservation: synthesis + high-severity conflicts survive trimToBudget"
key_files:
  created:
    - "packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts"
  modified:
    - ".planning/phases/05-integration-kitchen-sink/05-CF-CODE-ASSIST-USAGE.md"
decisions:
  - "AI mock dispatches by body key (messages=chat, text=embed) — distinguishes synthesis/expansion from embed calls without needing model-string comparison (all models are the same string)"
  - "kitchenSinkTop1Score module-level variable for controlling adaptive gate trigger per-test; reset in afterEach"
  - "Routing row: claude (not cf-code-assist) — runtime-GREEN iteration required; fix cycle on relative import path needed"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-11"
  tasks_completed: 1
  files_created: 1
  files_modified: 1
---

# Phase 05 Plan 02: v02-kitchen-sink integration test Summary

**One-liner:** INT-01 worst-case envelope budget test (pre-trim adversarial proof + D-05 content-preservation) + all 6 v0.2-INTEGRATION-MATRIX row describe blocks in a single kitchen-sink test file, all 6 tests GREEN.

## What Was Built

`packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` — the INT-01 worst-case integration test and the umbrella for all 6 v0.2-INTEGRATION-MATRIX rows:

1. **RNK × CON** — Conflicts survive hybridRank even when conflict-linked memories have lower Vectorize scores. Proves the CON-05 conflict-surfacing path is not accidentally filtered by the ranking step.

2. **RNK × EXP** — Real hybridRank receives the RRF-merged candidate set when adaptive fan-out fires (top1 < 0.65). Asserts AI.run is called multiple times (embed + expansion) and result.memories is non-empty.

3. **EXP × SYN** — Synthesis is non-null after fan-out fires AND ≥ 2 blocks are seeded (satisfying the SYN-07 guard). Proves the fan-out → synthesis composition path.

4. **CON × SYN** — Both context.conflicts[] and result.synthesis are populated in the same envelope (verbosity=synthesis). Asserts the conflict has severity "high" (same-day created_at → diffDays=0).

5. **adaptive-routing × cosine-edge** — RateLimitError from expandQuery triggers EXP-10 single-query fallback. Asserts result.memories is non-empty AND meta.gaps contains "query expansion unavailable".

6. **INT-01 kitchen-sink** — Worst-case fixture: 25 memories × 4KB content + 1KB summary + 10 high-severity Conflict objects. Adversarial-proof (beforeTokens > 7,500), post-trim ≤ 7,500, synthesis + high-severity conflicts survive trim (D-05).

## Test Infrastructure

- **Stateful Vectorize mock** — `kitchenSinkVectorizeStore: Map<string, Set<string>>` tracks upserted IDs per namespace; query returns all IDs with score override for EXP paths.
- **AI mock dispatch** — distinguishes embed calls (`text` key) from synthesis/expansion calls (`messages` key); expansion returns valid JSON `{paraphrases: [...]}` so `expandQuery` parses successfully.
- **Score override** — `kitchenSinkTop1Score` module-level variable set per-test, reset in `afterEach`, controls adaptive gate trigger without patching `env.VECTORIZE.query` each time.
- **`kitchenSinkCaptureCallback` / `kitchenSinkParseEnvelope`** — localized copies of the patterns from `recall-conflicts.test.ts` per PATTERNS.md §Shared Patterns convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wrong relative import path for envelope.js**
- **Found during:** Task 1 initial test run
- **Issue:** `../envelope.js` resolves from `__tests__/integration/` to `__tests__/envelope.ts` (does not exist); correct path is `../../envelope.js` (up to `src/`)
- **Fix:** Changed import to `../../envelope.js`
- **Files modified:** `v02-kitchen-sink.test.ts`
- **Commit:** (same task commit — fix applied before committing)

**2. [Rule 1 - Bug] ESLint errors on commit: unused import, unsafe member access, misused promises**
- **Found during:** Task 1 pre-commit hook
- **Issue 1:** `InboxConflictRow` imported but unused (only needed in recall-conflicts.test.ts analog, not in kitchen-sink)
- **Issue 2:** `@typescript-eslint/no-unsafe-member-access` on `(env as any).AI?.run` without proper disable comment
- **Issue 3:** `@typescript-eslint/no-misused-promises` — `mockImplementation` callback typed as `Promise<unknown>` return triggers the rule; fixed by using `unknown` return type (the function returns Promises as `unknown` values)
- **Fix:** Removed `InboxConflictRow` from imports; added targeted eslint-disable comments; changed mockImplementation callback return type from `Promise<unknown>` to `unknown`
- **Files modified:** `v02-kitchen-sink.test.ts`
- **Commit:** included in same task commit after fixes

## Key Test Assertions (Done Criteria)

- `expect(beforeTokens).toBeGreaterThan(7_500)` — adversarial-proof assertion present
- `expect(trimmed.result.synthesis).not.toBeNull()` — D-05 content-preservation present
- `import { encode } from "gpt-tokenizer/encoding/cl100k_base"` — correct encoding import (not barrel)
- `hybridRank` NOT mocked anywhere in the file
- All 6 describe blocks present

## Routing Decision

See `.planning/phases/05-integration-kitchen-sink/05-CF-CODE-ASSIST-USAGE.md` row `05-02-T1 (actual)`.

Checklist: N/Y/Y (single file, >350 LOC, stable spec). Despite N/Y/Y suggesting cf-code-assist, routed to **claude** because: (1) the file requires runtime-GREEN iteration — a broken import path needed a fix cycle, and (2) cf-code-assist cannot observe runtime failures. The pre-classified estimate was correct on the checklist but underweighted the fix-iteration cost.

## Known Stubs

None — all assertions make real calls through the live `recall()` pipeline.

## Threat Flags

None new beyond what was identified in the plan's threat model (T-05-02-01 through T-05-02-03 — all mitigated by the D-05 content-preservation assertions and single-workspace fixture design).

## Self-Check: PASSED

- `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` — FOUND
- Commit `574751a` — FOUND
- All 6 describe blocks present — VERIFIED (grep confirms RNK×CON, RNK×EXP, EXP×SYN, CON×SYN, adaptive-routing×cosine-edge, INT-01 kitchen-sink)
- Adversarial-proof assertion — VERIFIED (line 552: `expect(beforeTokens).toBeGreaterThan(7_500)`)
- D-05 content-preservation assertion — VERIFIED (line 563: `expect(trimmed.result.synthesis).not.toBeNull()`)
- cl100k_base import — VERIFIED (line 44)
- 19/19 test files pass, 176 tests pass + 2 skipped — VERIFIED
