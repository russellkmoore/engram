---
phase: 02-recall-quality-baseline
plan: "06"
subsystem: triage-worker
tags:
  - con
  - orchestrator
  - triage-worker
  - analytics
dependency_graph:
  requires:
    - 02-01  # vectorizeNeighbors helper
    - 02-05  # insertConflictAsInbox RPC + InboxConflictProperties type
  provides:
    - conflictPipeline orchestrator (CON-02 wiring unblocked)
    - D-20 analytics emit pattern for conflict pipeline
  affects:
    - packages/triage-worker  # 2 new files (orchestrator + tests)
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
tech_stack:
  added: []
  patterns:
    - Vite ?raw import for workerd-safe source-grep test (no node:fs in workerd)
    - try/catch/finally with swallowed errors for ctx.waitUntil safety (RESEARCH Pitfall 6)
    - Internal embed-on-entry pattern (Path A — no embedding field on newBlock)
    - Cross-Worker type-cast stub pattern for DurableObjectNamespace RPCs
    - Promise.all over bounded ≤3 array as structural concurrency cap (CON-07)
key_files:
  created:
    - packages/triage-worker/src/conflict-pipeline.ts
    - packages/triage-worker/src/__tests__/conflict-pipeline.test.ts
  modified:
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "Path A (internal embed) confirmed: extract.ts queue path uses CLASSIFIER_MODEL only; no EMBEDDING_MODEL call exists upstream. Computing embed internally avoids cross-plan circular contract with Plan 02-07."
  - "CON-08 grep test uses Vite ?raw import instead of node:fs readFileSync — workerd does not implement node:fs; ?raw is the canonical Cloudflare-pool-safe alternative (established by mcp-server/index.test.ts)."
  - "Verdict hierarchy: error > contradiction > benign_update > unrelated > skipped-dupe; error and skipped-dupe are early-return branches set before the try/catch exits."
metrics:
  duration: "~25 minutes"
  completed: "2026-06-08"
  tasks_completed: 2
  files_modified: 3
---

# Phase 2 Plan 06: conflictPipeline Orchestrator Summary

One-liner: CON-02 orchestrator wiring embed → cosine-prefilter → dupe-skip → parallel-detect → inbox-write → D-20 analytics into a single fire-and-forget routine.

## What Was Built

### Task 1 — `conflict-pipeline.ts` orchestrator

Commit `317c5c9`

**Exported symbol:** `conflictPipeline(env, newBlock): Promise<void>`

**Constants (top of file):**
```typescript
const ANALYTICS_ENV_TAG = "engram-prod" as const;
const CONFLICT_COSINE_FLOOR = 0.7;        // CON-02 prefilter threshold
const CONFLICT_DUPE_CEILING = 0.92;       // CON-06 (PITFALLS CD-4)
const CONFLICT_PER_WRITE_BUDGET = 3;      // CON-07 structural concurrency cap
```

**5 verdict branches:**

| Verdict | Condition | Inbox write? | Analytics error_flag |
|---------|-----------|-------------|---------------------|
| `unrelated` | `neighbors.length === 0` after prefilter | No | 0 |
| `skipped-dupe` | All neighbors ≥ 0.92 cosine (CON-06) | No | 0 |
| `contradiction` | ≥1 `detectConflict` returns `category="contradiction"` | Yes (once per contradiction) | 0 |
| `benign_update` | Neighbors found, none are contradictions | No | 0 |
| `error` | Any exception in try{} block | No | 1 |

**Internal embed step (Path A — line 109 of final file):**
`env.AI.run(EMBEDDING_MODEL, { text: [newBlock.content] })` is the FIRST call inside `try {}`. The vector is consumed only by `vectorizeNeighbors` immediately after; never stored or returned.

**D-20 analytics schema (byte-frozen 4-blob / 4-double / 1-index per AI-SPEC.md §7):**

| Slot | Value |
|------|-------|
| `blobs[0]` | `"conflict-pipeline"` |
| `blobs[1]` | `<verdict>` (one of 5 values above) |
| `blobs[2]` | `<wsTag>` (sha256-prefix of workspace_id) |
| `blobs[3]` | `"ok"` or `"failed"` |
| `doubles[0]` | `latency_ms` (Date.now() - start) |
| `doubles[1]` | `neighbors_examined` (set after vectorizeNeighbors; 0 on embed error) |
| `doubles[2]` | `0` (reserved) |
| `doubles[3]` | `error_flag` (1 if verdict="error", else 0) |
| `indexes[0]` | `"engram-prod"` |

**CON-08 architectural lock:** No email/webhook/push/slack primitives. Zero grep matches on notification-related identifiers in executable code (verified by CON-08 test).

**File size:** 224 lines (min_lines=90 satisfied).

### Task 2 — `conflict-pipeline.test.ts` unit tests

Commit `ba215e5`

**9 test cases:**

1. `embed call fires exactly once per pipeline invocation (embed-on-entry)` — asserts `AI.run` called once with `EMBEDDING_MODEL` + `{ text: [newBlock.content] }`
2. `no neighbors above threshold → verdict=unrelated, no inbox writes (CON-02)` — `vectorizeNeighbors` returns `[]`; asserts no `detectConflict`, no inbox write, analytics `blobs[1]="unrelated"`, `doubles[1]=0`
3. `all neighbors above dupe ceiling (cosine ≥ 0.92) → verdict=skipped-dupe (CON-06)` — 3 matches at 0.93-0.95; asserts no `detectConflict`, analytics `blobs[1]="skipped-dupe"`, `doubles[1]=3`
4. `contradiction detected → inbox write with exact CON-04 shape; verdict=contradiction` — asserts `insertConflictAsInbox` called once with `{ workspace_id, memory_a_id, memory_b_id, category:"contradiction", ai_confidence:0.88, description }`
5. `only benign updates from detectConflict → verdict=benign_update, no inbox writes` — `category="benign_update"` from detect; asserts no inbox write
6. `bounded-parallel ≤3 detectConflict calls per write (CON-07)` — 3 neighbors; asserts exactly 3 `detectConflict` calls
7. `embed AI call throws → verdict=error; analytics still emitted; no re-throw` — `AI.run` throws; asserts no Vectorize call, analytics `blobs[1]="error"`, `doubles[3]=1`, no re-throw
8. `Vectorize throws → caught locally; verdict=error; analytics still emitted (Pitfall 6)` — `vectorizeNeighbors` throws; analytics `blobs[1]="error"`, no re-throw
9. `CON-08: source has no notification primitives` — uses Vite `?raw` import to read `conflict-pipeline.ts` source; strips comments; asserts no `sendEmail`, `sendWebhook`, `pushNotification`, `notifyUser`, `slackNotif` etc. in executable code

**CON-08 grep regex used:**
```
/\b(sendEmail|sendWebhook|pushNotif(?:ication)?|notifyUser|slackNotif|slackMessage|postToSlack)\b/i
```
Plus a broader check: `/\b(?:email|webhook)_\w+\b/i`

**File size:** 393 lines (min_lines=110 satisfied).

**All 23 triage-worker workerd tests pass** (3 test files: extract, schemas, conflict-pipeline).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CON-08 grep test — node:fs unavailable in workerd**
- **Found during:** Task 2 implementation
- **Issue:** The plan specified `readFileSync(...)` for the CON-08 grep test, but workerd does not implement `node:fs`. The test would error with "no such file or directory" at the workerd virtual filesystem layer (confirmed by initial test run).
- **Fix:** Replaced `import { readFileSync } from "node:fs"` + `readFileSync(...)` with Vite's `?raw` import pattern: `import conflictPipelineSourceRaw from "../conflict-pipeline.ts?raw"`. This inlines the source file as a string at bundle time — the canonical Cloudflare-pool-safe approach established by `packages/mcp-server/src/__tests__/index.test.ts`.
- **Files modified:** `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts`
- **Commit:** `ba215e5`

## Threat Model Coverage

All threat register entries from the plan's STRIDE model are addressed:

| Threat ID | Mitigation | Location |
|-----------|-----------|---------|
| T-02-06-01 | `vectorizeNeighbors(env, newBlock.workspace_id, ...)` — workspace_id is non-optional positional; `assertNamespace` fires synchronously | `conflict-pipeline.ts:124` |
| T-02-06-02 | `try/catch/finally` swallows all errors; `console.error` logs; `verdict="error"` in analytics; never re-throws | `conflict-pipeline.ts:195-207` |
| T-02-06-03 | `detectConflict` returns null on AI failure (never throws); null `out` → `out?.category !== "contradiction"` → no inbox write; verdict still computed | `conflict-pipeline.ts:181` |
| T-02-06-04 | `workspaceTag(newBlock.workspace_id)` SHA-256 prefix in `blobs[2]`; raw workspace_id never written | `conflict-pipeline.ts:100` |
| T-02-06-05 | `vectorizeNeighbors` topK=3 is the structural cap; `Promise.all` over ≤3 elements | `conflict-pipeline.ts:124,163` |
| T-02-06-06 | CON-08 grep test asserts no notification primitives in executable code | `conflict-pipeline.test.ts:358-379` |
| T-02-06-07 | Severity NOT computed here; inbox row stores raw fields; severity derived at read time in Plan 02-08 | `conflict-pipeline.ts:183` (comment) |
| T-02-06-08 | `CONFLICT_DETECTION_PROMPT` byte-frozen (ENG-16); Zod `.refine()` post-validation in `detectConflict`; `conflict-pipeline.ts` does not modify `conflict-detection.ts` | `conflict-detection.ts` (untouched) |
| T-02-06-09 | 429 / embed throw flows to `verdict="error"` in catch; analytics row captures it; parent block already persisted; no retry loop | `conflict-pipeline.ts:195-200` |

## Known Stubs

None. The orchestrator is fully implemented. `detectConflict` is intentionally untouched per CON-01 (byte-frozen after Plan 02-04 validation at precision=0.938/recall=1.000).

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond the plan's declared scope. The cross-Worker RPC binding (`env.WORKSPACE`) is the same v0.1 binding used throughout the triage-worker.

## Self-Check: PASSED

- `conflict-pipeline.ts` exists: FOUND at `packages/triage-worker/src/conflict-pipeline.ts`
- `conflict-pipeline.test.ts` exists: FOUND at `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts`
- `CONFLICT_COSINE_FLOOR = 0.7`: CONFIRMED
- `CONFLICT_DUPE_CEILING = 0.92`: CONFIRMED
- `CONFLICT_PER_WRITE_BUDGET = 3`: CONFIRMED
- `conflictPipeline` exported: CONFIRMED
- `newBlock.embedding` absent: CONFIRMED (grep returns zero matches)
- CON-08 grep: CONFIRMED (zero notification primitives in executable code)
- 9 tests pass: CONFIRMED (all 23 triage-worker workerd tests pass)
- `tsc --noEmit` at repo root: CLEAN
- Commit `317c5c9` (Task 1): FOUND
- Commit `ba215e5` (Task 2): FOUND
- `detect-conflict.ts` unchanged: CONFIRMED (git status clean)
