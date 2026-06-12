---
phase: 02-recall-quality-baseline
plan: "07"
subsystem: triage-worker
tags:
  - con
  - triage-worker
  - waitUntil
  - integration
dependency_graph:
  requires:
    - 02-06  # conflictPipeline orchestrator (Path A — internal embed)
  provides:
    - CON-03 wiring: ctx.waitUntil(conflictPipeline) in store-normal branch
  affects:
    - packages/triage-worker  # index.ts + queue-integration.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
tech_stack:
  added: []
  patterns:
    - ctx.waitUntil fire-and-forget pattern (mirrors mcp-server INGEST_QUEUE.send precedent)
    - vi.mock + vi.mocked for module-level spy on imported orchestrator
    - buildCtx() minimal ExecutionContext mock (waitUntil + passThroughOnException as vi.fn)
key_files:
  created: []
  modified:
    - packages/triage-worker/src/index.ts
    - packages/triage-worker/src/__tests__/queue-integration.test.ts
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "ctx: ExecutionContext added as third param to queue() handler (was absent — only batch + env were declared). This is the minimal delta required; Cloudflare Queues runtime passes it regardless."
  - "event.scope removed: MemoryEvent has no scope field; newBlock.scope is hardcoded to 'personal' (correct v0.1 default — all queue events originate from personal workspace context)."
  - "eslint-disable-next-line @typescript-eslint/unbound-method required on ctx.waitUntil assignments in tests (the vi.fn stub is structurally a bound method but ESLint cannot infer that)."
metrics:
  duration: "~20 minutes"
  completed: "2026-06-08"
  tasks_completed: 1
  files_modified: 3
---

# Phase 2 Plan 07: conflictPipeline ctx.waitUntil Wiring Summary

One-liner: CON-03 surgical insertion of `ctx.waitUntil(conflictPipeline(env, newBlock))` in the store-normal queue-consumer branch, with 3-case integration test asserting fire-and-forget wiring and negative path isolation.

## What Was Built

### Task 1 — `index.ts` wiring + `queue-integration.test.ts` CON-03 tests

Commit `8f01be3`

**Insertion site:** `packages/triage-worker/src/index.ts` lines 243–255 (inside the `store-normal` switch case, immediately after `await updateBlockEnrichment(...)`, before `break`).

**Three changes to `index.ts`:**

1. Import added at line 39:
   ```typescript
   import { conflictPipeline } from "./conflict-pipeline.js";
   ```

2. `ctx: ExecutionContext` added as third parameter to `queue()` handler (was `(batch, env)`, now `(batch, env, ctx)`). The Cloudflare Queues runtime always passes all three args; the prior signature silently discarded `ctx`.

3. `ctx.waitUntil(...)` insertion in `store-normal` case:
   ```typescript
   ctx.waitUntil(
     conflictPipeline(env, {
       id: event.id,
       workspace_id: event.workspace_id,
       type: parsed.classified_type,
       scope: "personal",
       content: event.content,
       created_at: Date.now(),
     }),
   );
   ```

**6-field newBlock shape (NO `embedding` field):**

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `event.id` | MemoryEvent UUID |
| `workspace_id` | `event.workspace_id` | from producer |
| `type` | `parsed.classified_type` | CF AI classifier output |
| `scope` | `"personal"` | v0.1 default; MemoryEvent has no scope field |
| `content` | `event.content` | raw content for embed-on-entry in conflictPipeline |
| `created_at` | `Date.now()` | consumer write time |

`embedding` is intentionally absent — conflictPipeline (Plan 02-06 Path A) computes it internally as the first step inside its try{} block.

**Ordering guarantee:** The `ctx.waitUntil(...)` call is placed AFTER `await updateBlockEnrichment(...)` resolves. The block exists in SQLite before the conflict scan starts — no race window on the neighbor hydration step inside conflictPipeline.

**Fire-and-forget guarantee:** `ctx.waitUntil(...)` is NOT awaited. The queue consumer continues to analytics + `message.ack()` immediately. conflictPipeline runs within the Worker's extended lifetime.

**`extract.ts` unchanged:** Confirmed via `git diff packages/triage-worker/src/extract.ts` (zero output). Plan 02-06 Revision log dropped the embedding-exposure task; this plan adds zero calls to `extract.ts`.

**Three new CON-03 integration tests in `queue-integration.test.ts`:**

1. `"CON-03: store-normal MemoryEvent fires conflictPipeline via ctx.waitUntil exactly once with 6-field newBlock (no embedding field)"` — asserts:
   - `ctx.waitUntil` called once
   - `conflictPipeline` called once
   - First call `env` arg is the ambient `env` binding
   - Second call `newBlock` arg matches all 6 fields; `embedding` field absent
2. `"CON-03: store-inbox MemoryEvent does NOT trigger conflictPipeline (only store-normal wires the scan)"` — memorability 0.6 → inbox branch; asserts zero calls
3. `"CON-03: cold-storage MemoryEvent does NOT trigger conflictPipeline"` — memorability 0.2 → cold branch; asserts zero calls

**Module-level mock:** `vi.mock("../conflict-pipeline.js", ...)` hoisted to module top so all 26 tests in this file use the mocked orchestrator (the real orchestrator requires live AI + Vectorize bindings). Pre-existing tests are unaffected because the mock resolves immediately.

**All test results:**

- 3 test files, 26 tests — all pass
- queue-integration.test.ts: 12 tests (9 existing + 3 new CON-03)
- conflict-pipeline.test.ts: 9 tests (unchanged)
- extract.test.ts / schemas: 5 tests (unchanged)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ctx` was absent from the queue handler signature**
- **Found during:** Implementation
- **Issue:** The queue handler was declared `async queue(batch, env)` — only two args. `ctx: ExecutionContext` is the third arg provided by the Cloudflare Queues runtime; it was simply never declared. `ctx.waitUntil` would have been a runtime NameError.
- **Fix:** Added `ctx: ExecutionContext` as the third parameter. Also threaded a `buildCtx()` mock `ExecutionContext` to all 10 existing `handler.queue(...)` call sites in queue-integration.test.ts to satisfy the now-required third arg (TypeScript caught this immediately via `Expected 3 arguments, but got 2`).
- **Files modified:** `packages/triage-worker/src/index.ts`, `packages/triage-worker/src/__tests__/queue-integration.test.ts`
- **Commit:** `8f01be3`

**2. [Rule 1 - Bug] `event.scope` does not exist on `MemoryEvent`**
- **Found during:** Implementation (caught by `tsc --noEmit`)
- **Issue:** The plan spec showed `scope: event.scope ?? "personal"` but `MemoryEvent` has no `scope` field (it has `workspace_id`, `content`, `source`, `timestamp`, `hint?`, `context?` — no `scope`). TypeScript error TS2339.
- **Fix:** Replaced with `scope: "personal"` directly. This is the correct v0.1 default — all MCP-originated MemoryEvents are personal-scoped.
- **Files modified:** `packages/triage-worker/src/index.ts`
- **Commit:** `8f01be3`

**3. [Rule 1 - Bug] ESLint `@typescript-eslint/unbound-method` on `ctx.waitUntil` spy extractions**
- **Found during:** Pre-commit hook (lint-staged eslint --fix)
- **Issue:** `expect(ctx.waitUntil as ReturnType<typeof vi.fn>)` triggers `unbound-method` because ESLint can't infer the vi.fn stub is already bound.
- **Fix:** Extracted to named variables (`waitUntilSpy`, `waitUntilInbox`, `waitUntilCold`) with `eslint-disable-next-line` comments — the idiomatic workaround for vi.fn stubs.
- **Files modified:** `packages/triage-worker/src/__tests__/queue-integration.test.ts`
- **Commit:** `8f01be3` (applied during pre-commit fix cycle, same commit)

## Threat Model Coverage

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-02-07-01 | conflictPipeline try/catch/finally never re-throws (Plan 02-06); test asserts mock resolves | COVERED |
| T-02-07-02 | Insertion after `await updateBlockEnrichment(...)` — block committed before scan | COVERED |
| T-02-07-03 | extract.ts has no EMBEDDING_MODEL call (confirmed); single embed in conflictPipeline | COVERED |
| T-02-07-04 | Only store-normal case wires the call; CON-03 negative tests assert inbox/cold = 0 calls | COVERED |

## Known Stubs

None. The wiring is complete. `conflictPipeline` (Plan 02-06) is fully implemented.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes. The only change is adding `ctx` to the queue handler signature (which the runtime already provides) and one fire-and-forget call in the store-normal branch.

## Self-Check: PASSED

- `ctx.waitUntil(conflictPipeline(env, {...}))` exists in store-normal case: CONFIRMED (index.ts:246)
- Import `conflictPipeline` from `./conflict-pipeline.js`: CONFIRMED (index.ts:39)
- `ctx: ExecutionContext` in queue() signature: CONFIRMED (index.ts:83)
- No `embedding` field in newBlock: CONFIRMED (`grep embedding index.ts` matches zero newBlock-related lines)
- Other cases (inbox, cold-storage) have NO conflictPipeline call: CONFIRMED
- `extract.ts` unchanged: CONFIRMED (`git diff packages/triage-worker/src/extract.ts` = empty)
- 26 triage-worker tests pass: CONFIRMED
- `tsc --noEmit` clean: CONFIRMED
- Commit `8f01be3` exists: CONFIRMED
