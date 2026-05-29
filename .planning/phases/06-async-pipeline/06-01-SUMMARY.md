---
phase: 06-async-pipeline
plan: 01
subsystem: workspace-do, planning-docs
tags: [migration, schema, ddl, documentation, tdd, foundation, wave-1]
requires:
  - V2_SQL (Phase 5 D-07 cold-storage migration must be in place — V3 ALTERs the v2 blocks shape)
  - _schema_migrations runner (Phase 2 STO-02) — forward-only application + version tracking
provides:
  - V3_SQL exported constant (packages/workspace-do/src/schema.ts) — ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending' + CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status
  - MIGRATIONS v3 entry (packages/workspace-do/src/migrations.ts) — { version 3, name "v3_ingest_status", sql V3_SQL }
  - blocks.ingest_status column at runtime (post-migration) — three values pending | enriched | failed (D-03 lifecycle)
  - idx_blocks_ingest_status supporting index for v0.2 inbox-UI "broken memories" query + v0.2 stuck-pending sweep
  - ROADMAP SC4 + REQUIREMENTS PIP-04 amended to honestly reflect Phase 6 v0.1 scope (entity extraction + summarization + memorability scoring only; conflict detection deferred to v0.2)
  - Pending todo annotated with v0.2 validation-gate handoff
affects:
  - Phase 6 plan 06-03 (queries.ts) — gains a target column for `ingest_status = 'enriched'` writes in updateBlockEnrichment / moveToInbox / moveToColdStorage; gains target for markIngestFailed helper
  - Phase 6 plan 06-05 (integration tests) — can assert pending → enriched and pending → failed lifecycle transitions end-to-end
  - v0.2 inbox-UI surface — gains a queryable failure surface via the new column
  - All Phase 6 downstream waves can now assume blocks.ingest_status exists at runtime
tech-stack:
  added: []
  patterns:
    - Forward-only schema migration via _schema_migrations runner (Phase 2 STO-02 / Phase 5 D-07 carry-forward)
    - SQLite ALTER TABLE ADD COLUMN NOT idempotent at SQL layer — version check is the idempotency guarantee
    - SQLite quotes string-literal defaults in PRAGMA table_info output (test asserts "'pending'" not "pending")
    - TDD RED → GREEN split commits (test(...) followed by feat(...))
key-files:
  created: []
  modified:
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md
    - packages/workspace-do/src/schema.ts
    - packages/workspace-do/src/migrations.ts
    - packages/workspace-do/src/__tests__/schema.test.ts
    - packages/workspace-do/src/__tests__/hibernation.test.ts
decisions:
  - D-03 implementation pattern locked — V3_SQL mirrors V2_SQL's tagged-template `as const` shape exactly, with a Phase 6 D-03 doc-block citation
  - W1 wording fix applied — "against existing memories in the workspace" modifier dropped entirely from PIP-04 (not re-attached to "memorability scoring")
  - hibernation.test.ts row-count bumped 2 → 3 as a direct in-scope consequence of v3 migration (Rule 3 fix)
metrics:
  duration: ~15 minutes
  completed: 2026-05-29
  tasks_completed: 2
  files_created: 0
  files_modified: 6
  commits: 3
---

# Phase 6 Plan 01: Doc Touch-ups + V3 ingest_status Migration Summary

**One-liner:** Wave 1 foundation — scope-deferral doc touch-ups (D-01) plus the V3 SQLite migration that adds `blocks.ingest_status TEXT NOT NULL DEFAULT 'pending'` (D-03) with supporting index, enabling per-block enrichment-state tracking that all downstream Phase 6 plans depend on.

## What Was Done

### Task 1 — Doc touch-ups (commit `a000d9a`)

Three minimal-surface edits implementing D-01:

1. **`.planning/ROADMAP.md`** — SC4 of Phase 6 success criteria amended. The over-promised "and conflict detection against existing memories in the workspace" clause (and its modifier) is removed; replaced with a parenthetical italic deferral note pointing at Phase 6 CONTEXT.md D-01.

   Before: "entity extraction, summarization, memorability scoring, **and conflict detection against existing memories in the workspace**; writes results back…"
   After: "entity extraction, summarization, and memorability scoring; writes results back… _Conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01._"

2. **`.planning/REQUIREMENTS.md`** — PIP-04 line amended with the same scope-honest wording. The W1 modifier "against existing memories in the workspace" is stripped (not re-attached to memorability scoring, which is a per-block AI judgment, not a comparative operation).

3. **`.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md`** — appended a blockquote paragraph noting the 50-sample validation harness gate moves to v0.2. The harness design itself stays valid as written; v0.2 owns the execution. File stays in `pending/`.

### Task 2 — V3 migration (RED commit `1cc0541`, GREEN commit `7de1469`)

TDD RED → GREEN cycle:

**RED** — extended `packages/workspace-do/src/__tests__/schema.test.ts`:
- `_schema_migrations table (STO-02)` describe: row-count expectation 2 → 3 with v3_ingest_status assertions (version, name, applied_at).
- New describe block `blocks ingest_status column (D-03 / v3)` — two tests: PRAGMA table_info(blocks) asserts TEXT NOT NULL DEFAULT 'pending' (SQLite quotes string defaults — assertion matches the `"'pending'"` form); sqlite_master query asserts `idx_blocks_ingest_status` index exists.
- Confirmed 3 failures pre-implementation: row count 2 ≠ 3, ingest_status column undefined, index not found.

**GREEN** — three coordinated edits:
- `packages/workspace-do/src/schema.ts` — appended V3_SQL constant with multi-paragraph doc-block (Phase 6 D-03 citation, design notes covering forward-only runner idempotency, ALTER TABLE non-idempotency at SQL layer, DEFAULT 'pending' rationale, INDEX rationale, no DLQ queue rationale, cross-plan contract identifying 06-01 as appender / 06-03 as updater / 06-03 as failed-state writer).
- `packages/workspace-do/src/migrations.ts` — amended import to pull V3_SQL; appended `{ version: 3, name: "v3_ingest_status", sql: V3_SQL }` to MIGRATIONS array with inline comment matching v2 style. Runner body unchanged (the for-loop applies any not-yet-applied entry automatically).
- `packages/workspace-do/src/__tests__/hibernation.test.ts` (STO-09) — bumped row-count assertions 2 → 3 with v3 row check; updated the comment about what would fail (the v3 ALTER TABLE ADD COLUMN re-run would throw "duplicate column name: ingest_status", so the count check still proves the migration runner is idempotent on hibernation replay).

V3_SQL value matches D-03 exactly:
```sql
ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status ON blocks(ingest_status);
```

## Verification

All grep checks from `<verify>` block pass:
- ROADMAP positive: "Conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01" — PASS
- REQUIREMENTS positive: "conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01" — PASS
- Todo positive: "Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01" — PASS
- ROADMAP negative 1: "memorability scoring, and conflict detection against existing memories" — absent (PASS)
- REQUIREMENTS negative 1: "memorability scoring, conflict detection against existing memories" — absent (PASS)
- **W1 negative (ROADMAP):** "memorability scoring against existing memories" — absent (PASS)
- **W1 negative (REQUIREMENTS):** "memorability scoring against existing memories" — absent (PASS)
- Both files positive: "entity extraction, summarization, and memorability scoring" — PASS
- `export const V3_SQL` in schema.ts — PASS
- `ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending'` in schema.ts — PASS
- `idx_blocks_ingest_status` in schema.ts — PASS
- `v3_ingest_status` in migrations.ts — PASS
- `V3_SQL` imported in migrations.ts — PASS

**Test run output (`npx vitest run src/__tests__/schema.test.ts --reporter=verbose`):**
```
✓ _schema_migrations table (STO-02) > contains rows for v1_initial_schema, v2_cold_storage, v3_ingest_status after first init
✓ table presence (STO-03) > creates all 7 expected user tables
✓ blocks cold_storage column (D-07 / v2) > includes cold_storage INTEGER DEFAULT 0 added by v2 migration
✓ blocks ingest_status column (D-03 / v3) > includes ingest_status TEXT NOT NULL DEFAULT 'pending' added by v3 migration
✓ blocks ingest_status column (D-03 / v3) > creates idx_blocks_ingest_status supporting index on blocks
✓ blocks embedding columns (STO-04) > includes embedding_model TEXT and embedding_version INTEGER from v1

Test Files  1 passed (1)
     Tests  6 passed (6)
```

**Full workspace-do test suite (`npx vitest run`):**
```
Test Files  6 passed (6)
     Tests  29 passed | 1 skipped (30)
   Duration  1.32s
```

No regressions in any of the 6 workspace-do test files (lint, hibernation, seeding, helpers, schema, defense-in-depth). The 1 skipped test is pre-existing (not introduced by this plan).

## Doc-edit minimal-surface confirmation

Each doc edit touched exactly the lines specified in the plan and no others:
- ROADMAP.md: 1 line changed (SC4 of §"Phase 6: Async Pipeline" §"Success Criteria"). No other Phase 6 ROADMAP lines modified; the §"Risk Notes" block, plan count, and traceability remain untouched.
- REQUIREMENTS.md: 1 line changed (PIP-04 bullet under §"Pipeline (PIP)"). The Traceability table at the bottom stays as-is (PIP-04 still maps to Phase 6).
- Pending todo: appended 1 blockquote paragraph at the file end; existing YAML frontmatter, sections, and existing content all preserved.

## W1 wording correctness

The plan-checker iteration 1 W1 finding is correctly fixed:
- The modifier "against existing memories in the workspace" was attached to "conflict detection" — when we removed the conflict-detection clause, the modifier was also removed (not re-attached to "memorability scoring").
- "memorability scoring against existing memories" appears in NEITHER ROADMAP nor REQUIREMENTS (confirmed by negative grep assertions).
- The replacement wording reads grammatically: "entity extraction, summarization, and memorability scoring" — a clean three-item list with the Oxford comma; memorability scoring is correctly framed as a per-block AI judgment (not a comparative operation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] hibernation.test.ts row count assertion**
- **Found during:** Task 2 GREEN verification (full workspace-do test suite)
- **Issue:** `packages/workspace-do/src/__tests__/hibernation.test.ts` (STO-09 hibernation-replay safety) asserted exactly 2 rows in `_schema_migrations` after first init AND after replay. Adding the v3 migration changes the expected count to 3.
- **Fix:** Bumped both row-count assertions from 2 → 3; added v3 row assertion in the first cold-start block (mirrors v1/v2 assertions); updated the comment about what would fail on hibernation replay (v3 ALTER TABLE ADD COLUMN re-run would throw "duplicate column name: ingest_status").
- **Files modified:** packages/workspace-do/src/__tests__/hibernation.test.ts
- **Scope justification:** This is a direct in-task consequence of adding the v3 migration — exactly the kind of cross-cutting test-side adjustment the plan's `_schema_migrations row count` expectation contract implies. Fixing inline rather than deferring keeps the workspace-do test suite GREEN end-to-end at commit boundary, which is the integrity baseline downstream Phase 6 plans (06-03, 06-05) depend on.
- **Commit:** 7de1469 (folded into the GREEN commit)

No other deviations. Phase 6 Wave 1 executed exactly as the iteration-2 plan specified.

## Known Stubs

None. All Phase 6 v0.1 doc deferrals (conflict detection → v0.2; stuck-pending Cron → v0.2; inbox UI → v0.2; DLQ queue → v0.2) are intentional and documented in Phase 6 CONTEXT.md §"Deferred Ideas" + the amended ROADMAP/REQUIREMENTS lines. The plan honestly delivers what the amended docs now claim.

## Self-Check: PASSED

Files created/modified verified:
- `.planning/ROADMAP.md` — FOUND, modified (verified by grep checks)
- `.planning/REQUIREMENTS.md` — FOUND, modified (verified by grep checks)
- `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md` — FOUND, modified
- `packages/workspace-do/src/schema.ts` — FOUND, V3_SQL exported
- `packages/workspace-do/src/migrations.ts` — FOUND, v3 entry present
- `packages/workspace-do/src/__tests__/schema.test.ts` — FOUND, 3 GREEN describes for STO-02 / D-07 v2 / D-03 v3 (+ unchanged STO-03 / STO-04)
- `packages/workspace-do/src/__tests__/hibernation.test.ts` — FOUND, STO-09 GREEN with 3-row assertion

Commits verified in git log:
- `a000d9a` docs(06-01): defer conflict detection to v0.2 in PIP-04 (D-01)
- `1cc0541` test(06-01): add failing RED test for v3 ingest_status migration
- `7de1469` feat(06-01): add v3 ingest_status migration (D-03 / PIP-06)

All commits present on `worktree-agent-aa55d95a5a21eee3e`. Wave 1 foundation is complete; downstream Phase 6 plans (06-02, 06-03, 06-04, 06-05) can proceed.
