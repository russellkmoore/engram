---
phase: 02-recall-quality-baseline
plan: "05"
subsystem: workspace-do
tags:
  - con
  - workspace-do
  - rpc
  - sql
  - types
dependency_graph:
  requires:
    - 02-04  # conflict-precision eval gate (CON-01 closed)
  provides:
    - insertConflictAsInbox helper (CON-04 write path unblocked)
    - listInboxConflictsForMemoryIds helper (CON-05 read path unblocked for 02-08)
  affects:
    - packages/workspace-do  # 3 new exports, 5 new tests
    - shared/types           # InboxConflictProperties contract type
tech_stack:
  added: []
  patterns:
    - DO-local SQLite INSERT OR IGNORE for at-least-once delivery safety
    - TS-side JSON filter after bounded SELECT (RESEARCH §Pattern 6 Option A)
    - Per-column typeof narrowing helper (Pitfall 6 pattern)
    - Explicit field-by-field payload construction to avoid unused-var lint
key_files:
  created: []
  modified:
    - shared/types/src/index.ts
    - packages/workspace-do/src/types.ts
    - packages/workspace-do/src/queries.ts
    - packages/workspace-do/src/index.ts
    - packages/workspace-do/src/__tests__/helpers.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "TS-side filter chosen over SQL json_extract() for listInboxConflictsForMemoryIds: workerd json_extract() availability uncertain per RESEARCH §A3; bounded SELECT (60d + LIMIT 100) keeps scan cost acceptable"
  - "InboxConflictRow.proposed_properties kept as raw string (not parsed): caller in Plan 02-08 parses with InboxConflictProperties type explicitly — avoids silent drift from premature parsing"
  - "insertConflictAsInbox RPC uses explicit field-by-field payload construction instead of destructuring spread: avoids @typescript-eslint/no-unused-vars on destructured _ws variable"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-08"
  tasks_completed: 2
  files_modified: 6
---

# Phase 2 Plan 05: WorkspaceDO Conflict-Inbox Primitives Summary

One-liner: CON-04 inbox writer + CON-05 inbox reader + DO RPC methods + round-trip tests unblocking Plans 02-06 and 02-08.

## What Was Built

### Task 1 — InboxConflictProperties contract type (shared/types)

Commit `7a1ccd3`

Added `InboxConflictProperties` to `shared/types/src/index.ts` immediately after the `Conflict` interface (line 193 area). The 5-field shape:

```typescript
export interface InboxConflictProperties {
  memory_a_id: string;
  memory_b_id: string;
  category: "contradiction";   // literal — only contradictions reach the inbox
  ai_confidence: number;
  description: string;
}
```

JSDoc cross-references both write-site (CON-04, `conflict-pipeline.ts`) and read-site (CON-05, `recall()` handler in `tools.ts buildRecallResponse`). This is the single-source-of-truth contract that eliminates the RESEARCH §Pitfall 5 read/write drift risk.

### Task 2 — InboxConflictRow, helpers, RPC methods, tests

Commit `6b5715e`

**`InboxConflictRow` in `packages/workspace-do/src/types.ts`:**
- Raw SQL-row shape returned by `listInboxConflictsForMemoryIds`
- `proposed_properties` kept as `string` (caller in Plan 02-08 parses it)
- Re-exported from `index.ts` barrel

**`insertConflictAsInbox(sql, args: InboxConflictProperties): void` in `queries.ts`:**
- `id = "conflict-" + crypto.randomUUID()`
- `content = args.description`
- `proposed_type = "conflict"` (SQL literal)
- `proposed_properties = JSON.stringify({memory_a_id, memory_b_id, category, ai_confidence, description})` — exact 5-field key order
- `memorability_score = args.ai_confidence`
- `source = "triage:conflict-pipeline"`
- `INSERT OR IGNORE` for at-least-once Queue delivery safety (mirrors `createInboxEntry`)

**`listInboxConflictsForMemoryIds(sql, args: { ids: string[] }): InboxConflictRow[]` in `queries.ts`:**
- Early return `[]` on empty `ids` (no SQL round-trip)
- `WHERE proposed_type = 'conflict' AND created_at > <now - 60d> ORDER BY created_at DESC LIMIT 100`
- TS-side filter: `JSON.parse(row.proposed_properties)` → check `memory_a_id`/`memory_b_id` ∈ `ids`
- `JSON.parse` failures: caught, `console.warn` with row id + error message, row silently skipped
- Private `narrowInboxConflictRow` helper with per-column `typeof` checks (Pitfall 6)

**`WorkspaceDO` RPC methods in `index.ts`:**

```typescript
insertConflictAsInbox(args: { workspace_id: string } & InboxConflictProperties): void
  // assertOwnsWorkspace(args.workspace_id) — first executable line (STO-07)
  // explicit field-by-field payload construction → insertConflictAsInboxQuery

listInboxConflictsForMemoryIds(args: { workspace_id: string; ids: string[] }): InboxConflictRow[]
  // assertOwnsWorkspace(args.workspace_id) — first executable line (STO-07)
  // delegates to listInboxConflictsForMemoryIdsQuery
```

**Round-trip tests in `helpers.test.ts` (5 new test cases):**

1. `round-trip: insert → list → parse → assert shape equals InboxConflictProperties` — verifies `parsed` deep-equals input props; checks `proposed_type`, `content`, `memorability_score`, `source`, `id` prefix
2. `listInboxConflictsForMemoryIds returns [] for non-matching ids` — Assertion 3
3. `listInboxConflictsForMemoryIds returns [] immediately on empty ids (early return)` — Assertion 4
4. `listInboxConflictsForMemoryIds multi-row filter: returns only row matching the queried id` — inserts 2 conflicts, searches by one id, asserts only 1 returned
5. `DO RPC: insertConflictAsInbox + listInboxConflictsForMemoryIds are exposed on WorkspaceDO` — exercises the full RPC path end-to-end

All 50 workspace-do tests pass (22 in helpers.test.ts, 28 across 5 other test files).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint blocked TDD RED commit — types not yet resolved**
- **Found during:** Task 2 RED phase commit attempt
- **Issue:** The test file imported `insertConflictAsInbox` and `listInboxConflictsForMemoryIds` before they existed, causing TypeScript/ESLint to report "Unsafe call of a type that could not be resolved" (43 errors). lint-staged blocked the commit.
- **Fix:** Implemented GREEN phase immediately and committed test + implementation together as a single atomic commit. The 5 new tests were confirmed to have been failing at runtime before the helpers existed (verified by running `npm test` before the implementation).
- **Files modified:** N/A (deviation in commit strategy, not file content)
- **Commit:** `6b5715e`

**2. [Rule 1 - Bug] ESLint no-non-null-assertion on test row access**
- **Found during:** Task 2 GREEN commit attempt
- **Issue:** Test used `results[0]!.proposed_properties` — `@typescript-eslint/no-non-null-assertion` is banned.
- **Fix:** Replaced with `const row = results[0]; if (row === undefined) throw new Error("...")` guard pattern (consistent with existing test conventions).
- **Files modified:** `packages/workspace-do/src/__tests__/helpers.test.ts`
- **Commit:** `6b5715e`

**3. [Rule 1 - Bug] ESLint no-unused-vars on destructured _ws**
- **Found during:** Task 2 GREEN commit attempt
- **Issue:** `const { workspace_id: _ws, ...payload } = args` — `_ws` reported as unused because `tseslint.configs.strictTypeChecked` doesn't have a custom `argsIgnorePattern` for `_`-prefixed destructured names.
- **Fix:** Replaced spread destructuring with explicit field-by-field payload construction: `insertConflictAsInboxQuery(this.ctx.storage.sql, { memory_a_id: args.memory_a_id, ... })`. More explicit and avoids the lint issue entirely.
- **Files modified:** `packages/workspace-do/src/index.ts`
- **Commit:** `6b5715e`

## Schema DDL Verification

`git status packages/workspace-do/src/schema.ts` — clean. No DDL was issued. The `inbox` table was not modified; both helpers operate against the existing v1 DDL schema.

## Threat Model Coverage

All 5 threats from the plan's STRIDE register are mitigated:

| Threat ID | Mitigation | Location |
|-----------|-----------|---------|
| T-02-05-01 | `assertOwnsWorkspace(args.workspace_id)` as first line of both RPC methods | `index.ts:230,248` |
| T-02-05-02 | `InboxConflictProperties` is the single type consumed by both helpers; round-trip test asserts shape equality | `shared/types/src/index.ts` + `helpers.test.ts` |
| T-02-05-03 | Read RPC runs inside the DO scope; no cross-DO query possible by construction | architecture |
| T-02-05-04 | `WHERE created_at > ?` (60d) + `LIMIT 100` hard-coded in SQL | `queries.ts:687,691` |
| T-02-05-05 | `try/catch` around `JSON.parse` + `console.warn` + row skipped | `queries.ts:697-704` |

## Known Stubs

None. All helpers are fully implemented with real SQL. No placeholder text, no hardcoded empty results.

## Self-Check: PASSED

- `InboxConflictProperties` in `shared/types/src/index.ts`: FOUND
- `InboxConflictRow` in `packages/workspace-do/src/types.ts`: FOUND
- `insertConflictAsInbox` in `packages/workspace-do/src/queries.ts`: FOUND
- `listInboxConflictsForMemoryIds` in `packages/workspace-do/src/queries.ts`: FOUND
- RPC `insertConflictAsInbox` in `packages/workspace-do/src/index.ts`: FOUND
- RPC `listInboxConflictsForMemoryIds` in `packages/workspace-do/src/index.ts`: FOUND
- Commit `7a1ccd3` (Task 1): FOUND
- Commit `6b5715e` (Task 2): FOUND
- `schema.ts` unchanged: CONFIRMED
- All 50 workspace-do tests pass: CONFIRMED
- `tsc --noEmit` at repo root: CLEAN
