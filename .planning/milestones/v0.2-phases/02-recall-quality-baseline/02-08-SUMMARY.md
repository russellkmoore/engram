---
phase: 02-recall-quality-baseline
plan: "08"
subsystem: mcp-server
tags:
  - con
  - mcp-server
  - recall
  - envelope
  - conflicts
dependency_graph:
  requires:
    - 02-05  # listInboxConflictsForMemoryIds RPC + InboxConflictRow (CON-05 read path)
    - 02-03  # hybridRank and tools.ts stable after RNK workstream
  provides:
    - recall() populates context.conflicts[] via listInboxConflictsForMemoryIds (CON-05)
    - CON-08 architectural grep gate in CI
  affects:
    - packages/mcp-server/src/tools.ts
    - packages/mcp-server/src/envelope.ts
    - packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts
    - packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts
    - packages/mcp-server/vitest.config.ts
tech_stack:
  added: []
  patterns:
    - CON-05 READ-time severity bucketing (diffDays > 180 → "low"; else "high")
    - Proxy-wrapper spy on DO stub for malformed-JSON resilience testing
    - Conditional-spread for exactOptionalPropertyTypes-compatible optional envelope fields
    - Lint-node grep gate mirroring lint-no-direct-vectorize shape
key_files:
  created:
    - packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts
    - packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts
  modified:
    - packages/mcp-server/src/tools.ts
    - packages/mcp-server/src/envelope.ts
    - packages/mcp-server/vitest.config.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "backward-compat for buildRecallResponse: when input.conflicts is undefined (pre-CON-05 callers), default to conflicts:[] (D-08 contract preserved). Only omit the field when caller explicitly passes empty []"
  - "DO stub Proxy pattern for malformed-JSON test: intercept wsNs.get() via vi.spyOn + Proxy to override only listInboxConflictsForMemoryIds; all other DO methods delegate to real stub. No _unsafe_insertRawInbox, no NODE_ENV gate"
  - "lint-node exclusion for no-proactive-notifications.test.ts: mirrors lint-no-direct-vectorize exclusion from workerd pool; __tests__/ excluded from walk to avoid false positives from documentation comments"
metrics:
  duration: "~11 minutes"
  completed: "2026-06-08"
  tasks_completed: 3
  files_modified: 6
---

# Phase 2 Plan 08: Recall Conflicts Envelope Wiring (CON-05) Summary

One-liner: CON-05 recall envelope conflict surfacing — `listInboxConflictsForMemoryIds` RPC wired after `hybridRank`, with READ-time severity bucketing, `vi.spyOn` malformed-JSON resilience test, and CON-08 architectural grep gate.

## What Was Built

### Task 1 — Wire context.conflicts[] into recall() handler (CON-05, CON-06)

Commit `d828b0d`

**Recall handler insertion location (`packages/mcp-server/src/tools.ts` lines ~607–661):**

CON-05 step inserted immediately after `const ranked = hybridRank(...)` (line 597), before the synthesis opt-in block:

1. Extract `recallIds = ranked.map(r => r.id)`.
2. Call `stub.listInboxConflictsForMemoryIds({ workspace_id: props.workspace_id, ids: recallIds })` — reuses the existing stub variable, no second acquisition.
3. Per-row: `JSON.parse(row.proposed_properties)` → `InboxConflictProperties`.
4. Severity at READ TIME: `diffDays = Math.abs(memA_age - memB_age) / (1000 * 60 * 60 * 24)` → `severity = diffDays > 180 ? "low" : "high"`. "medium" never produced in v0.2.
5. Fallback: if `memory_a_id` or `memory_b_id` not in `ranked`, use `row.created_at` for the missing side.
6. JSON.parse failure: `console.warn("recall:CON-05:inbox-conflict-parse-failed", {...})` + row skipped.
7. RPC failure: `console.warn("recall:CON-05:rpc-failed", {...})` + `conflicts = []` + recall succeeds.

**InboxConflictRow → Conflict mapping table:**

| Conflict field | Source |
|---|---|
| `id` | `row.id` (format: `conflict-<UUID>`) |
| `memory_a_id` | `JSON.parse(row.proposed_properties).memory_a_id` |
| `memory_b_id` | `JSON.parse(row.proposed_properties).memory_b_id` |
| `description` | `JSON.parse(row.proposed_properties).description` |
| `severity` | Derived: `diffDays > 180 → "low"`, else `"high"` (CON-06 + CD-5) |
| `detected_at` | `row.created_at` |
| `resolved_at` | `null` always (v0.2; resolution is v0.3 `conflict()` tool) |

**Severity bucketing rule:**
- Threshold: 180 days
- `> 180 days` between `memory_a.created_at` and `memory_b.created_at` → `"low"`
- `≤ 180 days` → `"high"`
- `"medium"` is NEVER produced in v0.2

**`buildRecallResponse` signature extension (`packages/mcp-server/src/envelope.ts`):**
- Added optional `conflicts?: Conflict[]` parameter.
- Conditional-spread: when `undefined` → `conflicts: []` (D-08 backward compat); when non-empty → `conflicts: input.conflicts`; when explicitly empty `[]` → field OMITTED (T-02-08-05).
- All 125 pre-existing workerd tests pass; token-budget test D-10 invariant preserved.

**CON-08 pull-only / passive invariant:** Conflicts surfaced in envelope ONLY because the caller invoked `recall()`. Zero push/notification/webhook primitives introduced.

### Task 2 — Integration test for CON-05 SQL-join wiring

Commit `f354fb6`

Created `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` (new `integration/` subdirectory).

**4 test cases + results:**

1. **"recall returns context.conflicts when inbox contains contradiction rows linking ranked memories (severity=high)"** — PASSED. Seeds two memories with same `created_at`, inserts one conflict row via real `insertConflictAsInbox` RPC, calls `recall()`, asserts `context.conflicts` array has exactly 1 `Conflict` with `severity="high"`, correct IDs, null `resolved_at`, `conflict-` prefixed id.

2. **"severity=low when memory age diff > 180 days"** — PASSED. Seeds memories 200 days apart, inserts conflict row, asserts `conflicts[0].severity === "low"`.

3. **"envelope.context.conflicts is undefined when no inbox conflicts touch the ranked set"** — PASSED. Seeds memories with NO inbox rows, recalls, asserts `context.conflicts` key is ABSENT (`hasOwnProperty` false).

4. **"malformed inbox row does not crash recall — well-formed row surfaces, malformed row is dropped"** — PASSED. Uses `vi.spyOn(wsNs3, "get")` + `new Proxy(realStub, ...)` to intercept `listInboxConflictsForMemoryIds` and return a mixed batch (one well-formed row + one row with `"{not-valid-json"` as `proposed_properties`). Asserts: recall succeeds, `context.conflicts` has exactly 1 entry (well-formed), `console.warn` called once with `"recall:CON-05:inbox-conflict-parse-failed"`.

**Production DO surface area unchanged:**
- No `_unsafe_insertRawInbox` method on `WorkspaceDO` — confirmed: `grep -r '_unsafe_insertRawInbox' packages/workspace-do/` returns zero results.
- No `NODE_ENV` gate in production code or integration test logic.

### Task 3 — CON-08 architectural grep gate

Commit `5be1baa`

Created `packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts`:
- Walks `packages/mcp-server/src/` (excluding `__tests__/`)
- Strips block comments (`/* ... */`) and single-line `//` comment lines before grepping
- Forbidden tokens list: `EMAIL`, `MAILGUN`, `SENDGRID`, `WEBHOOK`, `PUSH_NOTIFICATION`, `NOTIFY_USER`, `SLACK`, `TWILIO`
- Asserts zero matches
- Registered in `lint-node` vitest project (not `workerd` — needs `node:fs`)
- Excluded from `workerd` project to avoid double-run

Test passes green (no forbidden tokens in current production source).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] token-budget.test.ts regression from buildRecallResponse change**
- **Found during:** Task 1 verification (first workerd test run)
- **Issue:** The D-10 invariant test at `token-budget.test.ts:168` asserted `context.conflicts` must always be present on a `buildRecallResponse` envelope. Initial implementation omitted the field entirely when `input.conflicts` was `undefined` (for pre-CON-05 callers). This broke the existing test.
- **Fix:** Three-way conditional: `undefined` → `conflicts: []` (D-08 backward compat for pre-CON-05 callers), non-empty array → set the field, empty array → omit the field (T-02-08-05). This preserves the D-08 contract for all existing callers while enabling the CON-05 omit-when-empty behavior.
- **Files modified:** `packages/mcp-server/src/envelope.ts`
- **Commit:** `d828b0d`

**2. [Rule 1 - Bug] ESLint errors blocked integration test commit**
- **Found during:** Task 2 commit attempt
- **Issues:** 5 ESLint errors: `@typescript-eslint/no-unsafe-member-access` on three `.WORKSPACE` property accesses on `any`-typed env; `@typescript-eslint/no-unused-vars` on `_args` parameter in Proxy getter; `@typescript-eslint/no-unsafe-member-access` on Proxy `(target as any)[prop]`.
- **Fix:** Renamed each `(env as any).WORKSPACE` access to use a named `const e = env as any` intermediate with explicit `eslint-disable-next-line` comments; renamed `_args` to `()` (parameterless arrow); added `@typescript-eslint/no-unsafe-member-access` to the Proxy fallback disable comment.
- **Files modified:** `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts`
- **Commit:** `f354fb6`

## Threat Model Coverage

| Threat ID | Mitigation | Location |
|-----------|-----------|---------|
| T-02-08-01 | `try/catch` around RPC call + per-row `JSON.parse`; recall still returns on any error | `tools.ts:609,629-648` |
| T-02-08-02 | Fallback to `row.created_at` for missing memory age is by design (RESEARCH §"Pattern 6") | `tools.ts:629-631` |
| T-02-08-03 | CON-08 grep gate in `lint-node` CI tier catches future violations | `no-proactive-notifications.test.ts` |
| T-02-08-04 | `assertOwnsWorkspace` first line of DO RPC method (Plan 02-05); DO namespace routing | `workspace-do/src/index.ts:248` |
| T-02-08-05 | Conditional-spread omits `conflicts` field when empty; D-08 preserved via `undefined` default | `envelope.ts:229-242` |
| T-02-08-06 | `_unsafe_insertRawInbox` never introduced; malformed-JSON test uses `vi.spyOn` + Proxy | `recall-conflicts.test.ts` |

## Known Stubs

None. All wiring is fully implemented. `context.conflicts` is populated from real inbox rows when present.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes at trust boundaries. The CON-05 step is an additional read from the existing `inbox` table inside the already-authenticated DO scope.

## Self-Check: PASSED

- `listInboxConflictsForMemoryIds` in `packages/mcp-server/src/tools.ts`: FOUND (line 618)
- `InboxConflictProperties` in `packages/mcp-server/src/tools.ts`: FOUND
- `CON-05` comment in `packages/mcp-server/src/tools.ts`: FOUND
- `diffDays > 180` in `packages/mcp-server/src/tools.ts`: FOUND
- `severity` in `packages/mcp-server/src/tools.ts`: FOUND
- `buildRecallResponse` `conflicts?` param in `packages/mcp-server/src/envelope.ts`: FOUND
- `recall-conflicts.test.ts` in `packages/mcp-server/src/__tests__/integration/`: FOUND
- `no-proactive-notifications.test.ts` in `packages/mcp-server/src/__tests__/`: FOUND
- `_unsafe_insertRawInbox` in `packages/workspace-do/`: NOT FOUND (correct)
- `NODE_ENV` in integration test logic: NOT FOUND (only in JSDoc comment)
- `tsc --noEmit`: CLEAN
- workerd tests: 13 files, 129 passed, 2 skipped
- lint-node tests: 2 files, 2 passed
- Commit `d828b0d` (Task 1): FOUND
- Commit `f354fb6` (Task 2): FOUND
- Commit `5be1baa` (Task 3): FOUND
