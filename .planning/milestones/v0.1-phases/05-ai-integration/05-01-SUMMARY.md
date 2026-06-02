---
phase: 05-ai-integration
plan: "01"
subsystem: infrastructure
tags:
  - wave-0
  - migration
  - bindings
  - test-infra
  - rpc-methods
  - red-tests

dependency_graph:
  requires:
    - 02-workspacedo-sqlite (queries.ts, migrations.ts, schema.ts)
    - 04-core-tools-envelope (mcp-server test harness, schemas.ts)
  provides:
    - Phase 5 cf-code-assist routing tracker
    - AI + VECTORIZE + ANALYTICS bindings on mcp-server + triage-worker
    - triage-worker vitest harness
    - Schema v2 cold-storage migration
    - 5 new WorkspaceDO RPC methods
    - RecallInputSchema.verbosity default = "chunks"
    - RED test stubs for AI-02/03/04/05/06/07/08
  affects:
    - packages/workspace-do (migration, queries, types, tests)
    - packages/mcp-server (wrangler, schemas, tests)
    - packages/triage-worker (new vitest harness, wrangler, tests)
    - shared/types (Memory.cold_storage)

tech_stack:
  added: []
  patterns:
    - forward-only SQLite migration via _schema_migrations runner
    - assertOwnsWorkspace first-line guard on all new DO RPC methods
    - eslint-disable on RED test files (unresolvable imports yield error-typed values)
    - wrangler.test.jsonc WORKSPACE binding omitted to avoid miniflare cross-Worker startup failure

key_files:
  created:
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md
    - packages/triage-worker/vitest.config.ts
    - packages/triage-worker/wrangler.test.jsonc
    - packages/mcp-server/src/__tests__/vectorize-helper.test.ts
    - packages/mcp-server/src/__tests__/ai-helper.test.ts
    - packages/mcp-server/src/__tests__/hybrid-rank.test.ts
    - packages/triage-worker/src/__tests__/extract.test.ts
  modified:
    - packages/mcp-server/wrangler.jsonc
    - packages/mcp-server/wrangler.test.jsonc
    - packages/triage-worker/wrangler.jsonc
    - packages/triage-worker/package.json
    - packages/triage-worker/tsconfig.json
    - packages/workspace-do/src/schema.ts
    - packages/workspace-do/src/migrations.ts
    - packages/workspace-do/src/queries.ts
    - packages/workspace-do/src/index.ts
    - shared/types/src/index.ts
    - packages/mcp-server/src/schemas.ts
    - packages/mcp-server/src/__tests__/envelope.test.ts
    - packages/mcp-server/src/__tests__/tools-integration.test.ts
    - packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts
    - packages/workspace-do/src/__tests__/schema.test.ts
    - packages/workspace-do/src/__tests__/hibernation.test.ts
    - .planning/phases/05-ai-integration/05-AI-SPEC.md
    - .planning/phases/05-ai-integration/05-VALIDATION.md
    - .claude/skills/spike-findings-engram/SKILL.md
    - CLAUDE.md

decisions:
  - "WORKSPACE binding omitted from triage-worker wrangler.test.jsonc in Wave 0 — miniflare cannot resolve cross-Worker script_name references without the mcp-server registered; Wave 0 tests pass mockEnv directly and don't need it"
  - "Memory.cold_storage added to shared/types not workspace-do/src/types.ts — Memory is canonically defined in @engram/types; the plan referenced the wrong file"
  - "cold_storage test in schema.test.ts: dflt_value asserting '0' (string) not 0 (int) — SQLite PRAGMA table_info returns dflt_value as text"

metrics:
  duration: "~90 minutes (resumed from previous session)"
  completed: "2026-05-28"
  tasks_completed: 8
  tasks_total: 8
  files_modified: 22
---

# Phase 5 Plan 01: Wave 0 Infrastructure Setup Summary

Wave 0 infrastructure closed: routing tracker, AI/Vectorize bindings, triage-worker vitest harness, cold-storage migration, 5 DO RPC methods, verbosity default flip, RED test stubs, doc touch-ups.

## What Was Built

### Task 1: cf-code-assist Routing Tracker (commit 771942a)

Created `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` — the BLOCKING Phase 5 routing tracker required by CLAUDE.md before any code-producing task in Plans 05-02..05-07. Includes the 3-Question Checklist section, augmented table header with Q1/Q2/Q3 column, two seed rows, and the End-of-Phase Summary shell.

### Task 2: AI + VECTORIZE + ANALYTICS bindings (commit 89b4541)

Added `"ai"`, `"vectorize"`, and `"analytics_engine_datasets"` bindings to:
- `packages/mcp-server/wrangler.jsonc` — production
- `packages/mcp-server/wrangler.test.jsonc` — test
- `packages/triage-worker/wrangler.jsonc` — production + WORKSPACE cross-Worker DO binding (`script_name: "engram-mcp-server"`)
- `packages/triage-worker/wrangler.test.jsonc` — NEW file (`.test.jsonc` opts out of FND-08 lint)

FND-08 lint passes on both production configs.

### Task 3: triage-worker vitest harness (commit 8d30fb2)

Created `packages/triage-worker/vitest.config.ts` (mirrors mcp-server config). Added to `packages/triage-worker/package.json`: test scripts, `vitest@^4.1.7`, `@cloudflare/vitest-pool-workers@^0.16.9` (matching mcp-server version pins exactly), `zod@^4.4.3`. Updated `tsconfig.json` with vitest-pool-workers types. `npm test --workspace=packages/triage-worker` passes with no test files.

**Intentional gap:** `zod-to-json-schema` NOT installed — gated to Plan 05-04 Package Legitimacy Audit.

### Task 4: Schema migration v2 + Memory type extension (commit f42c422)

- `packages/workspace-do/src/schema.ts`: added `V2_SQL` constant with `ALTER TABLE blocks ADD COLUMN cold_storage INTEGER NOT NULL DEFAULT 0` + index
- `packages/workspace-do/src/migrations.ts`: updated import, appended `{ version: 2, name: "v2_cold_storage", sql: V2_SQL }` to MIGRATIONS array
- `shared/types/src/index.ts`: added `cold_storage?: boolean` to `Memory` interface (D-07)
- Fixed `schema.test.ts` and `hibernation.test.ts` to expect 2 migration rows (was hardcoded to 1)
- Added `cold_storage` PRAGMA column assertion to `schema.test.ts`
- All 27 workspace-do tests pass (1 skipped, unchanged)

### Task 5: 5 WorkspaceDO RPC methods (commit 22e1fe4)

Added to `packages/workspace-do/src/queries.ts`:
1. `stampEmbedding` — UPDATE blocks SET embedding_model/version (AI-03)
2. `getBlocksByIds` — batch read with `AND cold_storage = 0` filter (AI-04)
3. `updateBlockEnrichment` — UPDATE blocks SET properties/summary/confidence (AI-05)
4. `moveToInbox` — delegates to createInboxEntry (AI-06)
5. `moveToColdStorage` — UPDATE blocks SET cold_storage=1 with COALESCE for optional enrichment (D-07)

Added 5 corresponding DO RPC methods to `packages/workspace-do/src/index.ts`, each calling `this.assertOwnsWorkspace(args.workspace_id)` as the first executable line. Total assertOwnsWorkspace call sites: 12 (7 existing + 5 new). All 27 workspace-do tests pass.

### Task 6: RecallInputSchema.verbosity default flip (commit b0c2d1a)

Changed `.default("both")` to `.default("chunks")` in `packages/mcp-server/src/schemas.ts` with updated comment citing D-01. Enum shape unchanged: `["synthesis", "chunks", "both"]`.

**Known RED:** `schemas.test.ts` test asserting `verbosity === "both"` now fails. Per plan: Plan 05-05 owns this fix (not this plan). Flagged in deviations.

### Task 7: RED test stubs + existing-test extensions (commit 3fde6e2)

**4 NEW RED test files:**
- `packages/mcp-server/src/__tests__/vectorize-helper.test.ts` — 4 it() stubs for AI-02 namespace enforcement; fails module-not-found (Plan 05-02)
- `packages/mcp-server/src/__tests__/ai-helper.test.ts` — model-id constants + 429 dual-path (detectRateLimit + isRateLimitError); fails module-not-found (Plan 05-02)
- `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` — HYBRID_WEIGHTS lock + 4 ranking scenarios; fails module-not-found (Plan 05-02)
- `packages/triage-worker/src/__tests__/extract.test.ts` — 429 dual-path + Zod parse retry/ack paths; fails module-not-found (Plan 05-04)

**3 existing-test extensions:**
- `packages/mcp-server/src/__tests__/envelope.test.ts` — new describe block "D-01 default flip + D-02 discoverability triad"; 3 it() blocks RED until Plan 05-05
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` — AI-08 5s-sleep round-trip describe block; RED until Plan 05-03
- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — describe renamed "3 prongs required"; AI-02 Prong C added; RED until Plan 05-03

### Task 8: Doc touch-ups (commit 77f34ac)

- `05-AI-SPEC.md` §4: D-01 synthesis-skip note added below the LLM arrow
- `CLAUDE.md` Ingest Pipeline: `< 0.4 → discard` → `< 0.4 → cold-storage` (D-07)
- `spike-findings-engram/SKILL.md`: Phase 5 supersession annotation on verbosity-default line (D-05)
- `05-VALIDATION.md`: `wave_0_complete: true`, `nyquist_compliant: true`; all Wave 0 checklist items ticked; Wave 0 closed 2026-05-28

## cf-code-assist Routing Log Summary

| Task | Route | Reason |
|------|-------|--------|
| T1 (tracker) | claude | Doc creation |
| T2 (wrangler configs) | claude | Q1=Y — cross-file consistency invariants |
| T3 (triage vitest) | claude | Q1=Y — cross-package version pins |
| T4 (schema v2) | claude | Q1=Y — cross-package (schema/migrations/shared-types) |
| T5 (5 RPC methods) | cf-code-assist (unavailable) | Q1=N, Q2=Y, Q3=Y — Claude executed instead |
| T6 (verbosity flip) | claude | N/N/N — <10 lines, citation-heavy |
| T7a (4 new test files) | cf-code-assist (unavailable) | Q1=N, Q2=Y, Q3=Y — Claude executed instead |
| T7b (3 test extensions) | claude | Small-diff append, precise placement needed |
| T8 (doc touch-ups) | claude | Cross-doc citation requirements |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test count assertions broken by new migration**
- **Found during:** Task 4
- **Issue:** `schema.test.ts` and `hibernation.test.ts` hardcoded `toBe(1)` for migration row count. Adding v2_cold_storage made them fail.
- **Fix:** Updated both tests to expect 2 rows; added assertions for v2 row shape; added `cold_storage` PRAGMA column test
- **Files modified:** `packages/workspace-do/src/__tests__/schema.test.ts`, `packages/workspace-do/src/__tests__/hibernation.test.ts`
- **Commit:** f42c422

**2. [Rule 1 - Bug] Memory.cold_storage added to wrong file location**
- **Found during:** Task 4 (plan said `packages/workspace-do/src/types.ts` but `Memory` is canonically in `shared/types/src/index.ts`)
- **Fix:** Added `cold_storage?: boolean` to `shared/types/src/index.ts` instead — the canonical definition point
- **Files modified:** `shared/types/src/index.ts`
- **Commit:** f42c422

**3. [Rule 1 - Bug] triage-worker WORKSPACE binding crashed miniflare pool**
- **Found during:** Task 7
- **Issue:** `wrangler.test.jsonc` with `durable_objects.bindings[].script_name = "engram-mcp-server"` causes miniflare to fail at startup (no mcp-server registered in the test context). Blocked extract.test.ts from running.
- **Fix:** Removed the durable_objects binding from `wrangler.test.jsonc`. Wave 0 tests pass `mockEnv` directly and don't need `env.WORKSPACE`. Plan 05-04 will add it back when integration tests need a real DO.
- **Files modified:** `packages/triage-worker/wrangler.test.jsonc`
- **Commit:** 3fde6e2

### Expected RED Failures (by design)

These test failures are intentional Wave 0 RED state — flagged for successor plans to turn GREEN:

| Test | Expected GREEN in | Reason RED |
|------|-------------------|------------|
| `schemas.test.ts` — "default verbosity is 'both'" | Plan 05-05 | verbosity default flipped to "chunks" in Task 6 |
| `ai-helper.test.ts` | Plan 05-02 | `ai-helper.ts` doesn't exist yet |
| `hybrid-rank.test.ts` | Plan 05-02 | `hybrid-rank.ts` doesn't exist yet |
| `vectorize-helper.test.ts` | Plan 05-02 | `vectorize-helper.ts` doesn't exist yet |
| `extract.test.ts` | Plan 05-04 | `extract.ts` doesn't exist yet |
| `envelope.test.ts` D-01 describe | Plan 05-05 | `buildRecallResponse` doesn't accept synthesis param yet |
| `tools-integration.test.ts` AI-08 | Plan 05-03 | `remember()` doesn't embed yet |
| `cross-workspace-pentest.test.ts` Prong C | Plan 05-03 | no Vectorize upsert yet |

## Wave 0 Closed

All 8 Wave 0 Requirements in `05-VALIDATION.md` are satisfied. `wave_0_complete: true` and `nyquist_compliant: true` are set. Wave 1 (Plans 05-02/05-03) can proceed without infrastructure work.

## Stub Tracking

No stubs in production code that block the plan's goal. The 5 new DO RPC methods are fully wired with real SQL. The RED test stubs are intentional and documented above.

## Threat Flags

No new security-relevant surface not covered by the plan's threat model. All 5 new DO RPC methods call `assertOwnsWorkspace` as the first executable line (T-05-01-STO07 mitigation verified: 12 total call sites). `cold_storage = 0` filter in `getBlocksByIds` provides belt-and-suspenders cross-workspace isolation (T-05-01-CWVL second line of defense).

## Commits

| Hash | Task | Description |
|------|------|-------------|
| 771942a | T1 | Create Phase 5 cf-code-assist routing tracker |
| 89b4541 | T2 | Add AI + VECTORIZE + ANALYTICS bindings to wrangler configs |
| 8d30fb2 | T3 | Stand up triage-worker vitest harness + package deps |
| f42c422 | T4 | Add v2 cold-storage migration and Memory.cold_storage type |
| 22e1fe4 | T5 | Add 5 WorkspaceDO RPC methods for Phase 5 AI pipeline |
| b0c2d1a | T6 | Flip RecallInputSchema.verbosity default to "chunks" (D-01) |
| 3fde6e2 | T7 | RED test stubs for Phase 5 helpers + existing-test extensions |
| 77f34ac | T8 | Doc touch-ups — AI-SPEC, CLAUDE.md, SKILL.md, VALIDATION.md |

## Self-Check: PASSED

All files created/modified exist and commits are in git log.
