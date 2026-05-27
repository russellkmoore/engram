---
phase: "04"
plan: "02"
subsystem: "mcp-server"
tags: ["envelope", "honest-stubs", "token-budget", "D-04", "D-06", "D-07", "D-08", "D-09", "D-10", "MCP-08", "TOL-06"]
dependency_graph:
  requires:
    - "04-01: result-types.ts (6 typed interfaces), gpt-tokenizer installed, EngramResponse.meta widened to number|null"
    - "04-01: envelope.test.ts + token-budget.test.ts RED scaffolds (the GREEN targets this plan satisfies)"
  provides:
    - "packages/mcp-server/src/envelope.ts: 8 named exports (5 build*Response builders + trimToBudget + wrapMcpContent + META_GAPS)"
    - "META_GAPS const: byte-frozen for MCP-08 fixture reproducibility (D-10 snapshot lock)"
    - "trimToBudget: D-10 post-trim algorithm + T-04-DOS mitigation operational"
    - "wrapMcpContent: MCP transport wrapper for Plan 03 handler bodies"
  affects:
    - "Plan 04-03: GREEN target for tools-integration.test.ts + tools.test.ts happy-path (handler bodies import from envelope.ts)"
    - "Phase 5: envelope shape locked — Phase 5 diff is body-changes only (populate synthesis, entities, conflicts, meta.confidence, meta.coverage)"
tech_stack:
  added: []
  patterns:
    - "Honest-stub posture (D-04): AI-requiring fields return null or [] — never templated heuristics"
    - "Conditional object spread for field-presence control (chunks absent when verbosity=synthesis)"
    - "trimToBudget immutability: spread + map on every step — no input mutation"
    - "File-local helpers (countTokens, dropMemoryField, dropLastMemory, hasMemoriesArray): NOT exported"
key_files:
  created:
    - "packages/mcp-server/src/envelope.ts — 487 lines, 8 named exports + 4 file-local helpers"
  modified:
    - ".planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md — added Plan 02 tracking row"
decisions:
  - "buildSearchResponse accepts optional count parameter to match test contract (test passes {memories:[], count:0}) but derives result.count from memories.length — single source of truth"
  - "buildForgetResponse makes id optional (test passes {blocks_deleted:0, relations_deleted:0} without id) — id available to handlers for logging but not required by builder"
  - "trimToBudget uses type alias WithMemories for hasMemoriesArray-guarded path — avoids complex conditional type in cast"
metrics:
  duration: "~45 minutes"
  completed_date: "2026-05-27"
  tasks_completed: 9
  tasks_total: 9
  files_changed: 3
  insertions: 509
  deletions: 0
---

# Phase 4 Plan 02: Envelope Builders + trimToBudget Summary

Phase 4 plan 02 ships `packages/mcp-server/src/envelope.ts` — the single source of truth for honest-stub `EngramResponse<T>` construction and the MCP-08 token-budget post-trim algorithm.

## One-liner

5 honest-stub EngramResponse builders (D-04/D-06/D-07/D-08) + trimToBudget D-10 priority-order algorithm + wrapMcpContent transport wrapper + META_GAPS byte-frozen const, turning 18 Plan 01 RED tests GREEN.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 02-01 | File header JSDoc + META_GAPS byte-frozen const + BUDGET + countTokens helper | `14abab8` | envelope.ts |
| 02-02 | `buildRememberResponse` — D-06 honest stub (extracted_fields: {}, confidence: null, suggestions absent) | `14abab8` | envelope.ts |
| 02-03 | `buildRecallResponse` — D-02 verbosity branches + D-07 synthesis: null always | `14abab8` | envelope.ts |
| 02-04 | `buildSearchResponse` — TOL-03 (no format? param, count derived from memories.length) | `14abab8` | envelope.ts |
| 02-05 | `buildForgetResponse` — TOL-04 + Pitfall 4 (echo truth, no throw on blocks_deleted: 0) | `14abab8` | envelope.ts |
| 02-06 | `buildIngestResponse` — D-05 (status: "accepted" literal, pure builder, no crypto.randomUUID) | `14abab8` | envelope.ts |
| 02-07 | `trimToBudget` — D-10 priority order (content → summary → trailing memories; meta + conflicts never dropped) | `14abab8` | envelope.ts |
| 02-08 | `wrapMcpContent` — Pitfall 7 MCP transport wrapper | `14abab8` | envelope.ts |
| 02-09 | Full suite verification gate — envelope.test.ts + token-budget.test.ts GREEN, Plan 01 GREEN tests still GREEN | `14abab8` | — |

## File: packages/mcp-server/src/envelope.ts

**487 lines. 8 named exports.**

### Export Inventory

| Export | Type | D-ref | v0.1 Stub Behavior |
|--------|------|-------|-------------------|
| `META_GAPS` | `const` (as const) | D-10 | Byte-frozen gap strings; snapshot-locked by Plan 01 envelope.test.ts |
| `buildRememberResponse` | function | D-06 | `extracted_fields: {}`, `confidence: null`, `context.conflicts: []`, `suggestions` absent |
| `buildRecallResponse` | function | D-07 + D-02 | `synthesis: null` always; `chunks` field present-or-absent based on verbosity |
| `buildSearchResponse` | function | TOL-03 | No `format?` param; `count` derived from `memories.length` |
| `buildForgetResponse` | function | TOL-04 | Echoes `blocks_deleted` + `relations_deleted` truth; no throw on 0 |
| `buildIngestResponse` | function | D-05 | `status: "accepted"` literal; pure (no `crypto.randomUUID`, no queue reference) |
| `trimToBudget` | function | D-10 | 3-step priority: drop content → summary → trailing memories; meta + conflicts never dropped |
| `wrapMcpContent` | function | Pitfall 7 | `{ content: [{ type: "text", text: JSON.stringify(envelope) }] }` |

### File-local Helpers (NOT exported)

| Helper | Purpose |
|--------|---------|
| `countTokens` | BPE token count via cl100k_base; ~5% over-count is intentional safety margin (D-09) |
| `hasMemoriesArray` | Type guard for trimToBudget — narrows envelope to memories-array variant |
| `dropMemoryField` | Immutable: returns new envelope with `content` or `summary` set to null on each memory |
| `dropLastMemory` | Immutable: returns new envelope with last element of memories removed |

### META_GAPS Canonical Strings (D-10 byte-frozen)

```
remember: [
  "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
  "Conflict detection lands in Phase 5 (semantic similarity via Vectorize)."
]
recall: [
  "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only."
]
search: ["Lexical (LIKE) backing — semantic search lands in Phase 5."]
forget: []
ingest: ["Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."]
```

All 5 strings match byte-for-byte with `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` §3. The Plan 01 `toMatchSnapshot()` lock in `envelope.test.ts` enforces this contract going forward.

### D-10 trimToBudget Algorithm

Priority order (per D-10):
1. Under budget (≤ 7,500 cl100k_base tokens) → return same reference (no copy)
2. Step 1: drop `result.memories[i].content` → `null` on all entries → re-check
3. Step 2: drop `result.memories[i].summary` → `null` on all entries → re-check
4. Step 3: pop trailing memories one-by-one until ≤ 7,500 or only 1 memory remains

Invariants (NEVER violated):
- `envelope.meta` is never dropped
- `envelope.context.conflicts` is never dropped (even when `[]`)
- `envelope.result.id` on remember envelopes is never dropped (remember has no `memories` array — algorithm never fires on it)

Immutability: spread + map on every step. Input envelope is never mutated.

## Test State After Plan 02

| File | State | Notes |
|------|-------|-------|
| `envelope.test.ts` | GREEN (13/13 pass) | TOL-06 satisfied — all builders, META_GAPS snapshot, suggestions-absent, verbosity branches |
| `token-budget.test.ts` (trim cases) | GREEN (4/4 pass) | MCP-08 worst-case trim + invariants + reference identity + never-drop-meta |
| `token-budget.test.ts` (description-size case) | RED | Depends on `tools.ts` registrations — Plan 03's GREEN target |
| `schemas.test.ts` | GREEN (24/24) | No regression from Plan 01 |
| `error-mapping.test.ts` | GREEN (10/10) | No regression from Plan 01 |
| `tools-integration.test.ts` | RED | Plan 03 GREEN target (handler bodies) |
| `cross-workspace-pentest.test.ts` | RED | Plan 03 GREEN target (Prong A handler-dependent) |
| `tools.test.ts` happy-path block | RED | Plan 03 GREEN target |

## Phase 5 Hand-off Contract

Fields Phase 5 will populate WITHOUT changing the builder signatures:

| Field | Builder | Phase 5 source |
|-------|---------|---------------|
| `result.synthesis` | `buildRecallResponse` | CF Workers AI synthesis after Vectorize search |
| `context.entities` | All builders | CF AI entity extraction at ingest time |
| `context.conflicts` | All builders | Triage Worker conflict detection after write |
| `context.related` | All builders | Vectorize similarity search (top-K neighbors) |
| `meta.confidence` | All builders | CF AI classification confidence |
| `meta.coverage` | All builders | CF AI coverage estimation |
| `result.extracted_fields` | `buildRememberResponse` | Triage Worker entity extraction |
| `result.classified_type` | `buildRememberResponse` | CF AI type inference |
| `chunks[i].score` | `buildRecallResponse` | Vectorize cosine similarity scores |

Phase 5 diff to this file: **zero lines** — Phase 5 changes the handler bodies in `tools.ts` (Plan 03 target), not the envelope builder signatures.

Phase 6 note: `buildIngestResponse` builder is also stable through Phase 6. Phase 6's diff to the ingest handler is exactly one line: `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` — the builder itself does not change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Compatibility] buildSearchResponse signature accepts optional count parameter**
- **Found during:** Task 02-04 implementation
- **Issue:** The Plan 02 acceptance criteria states "count is NOT a parameter" but the Plan 01 RED test calls `buildSearchResponse({ memories: [], count: 0 })` passing count. The test file is the authoritative contract.
- **Fix:** Made `count` an optional input parameter (`count?: number`) — `result.count` is still always derived from `memories.length` (single source of truth). The optional parameter is silently ignored in the result, satisfying both the test contract and the "count is derived" design goal.
- **Files modified:** `packages/mcp-server/src/envelope.ts`
- **Commit:** `14abab8`

**2. [Rule 1 - Compatibility] buildForgetResponse id parameter made optional**
- **Found during:** Task 02-05 implementation
- **Issue:** Plan spec said `input: { id: string; blocks_deleted: number; relations_deleted: number }` but the Plan 01 RED test calls `buildForgetResponse({ blocks_deleted: 0, relations_deleted: 0 })` without `id`.
- **Fix:** Made `id` optional (`id?: string`) — it is available for handlers that want to log it but not required by the builder contract. `ForgetResult` does not include `id` either way.
- **Files modified:** `packages/mcp-server/src/envelope.ts`
- **Commit:** `14abab8`

## CF-Code-Assist Routing Log

Plan 02's single code-producing task (envelope.ts) was routed to `claude` due to multi-file reasoning requirements across CONTEXT.md, spike-findings-engram, result-types.ts, PATTERNS.md, and both RED test files simultaneously. See `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` for the full table.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

`envelope.ts` is a pure function module — no `fetch()`, no Durable Object stubs, no Env bindings, no Queue references. `workspace_id` never appears in any envelope output (T-03-DD-RT invariant carried forward).

The T-04-DOS mitigation (`trimToBudget` enforcing ≤ 7,500 cl100k_base tokens) is now operational.

No threat flags to add.

## Known Stubs

The "stubs" in this file are **intentional honest stubs by design** (D-04 — honest-stubs posture). They are tracked here for completeness but are NOT blockers for this plan's goal:

| Stub | Location | Reason | Future plan |
|------|----------|--------|-------------|
| `result.synthesis: null` | `buildRecallResponse` | D-07 — no CF AI synthesis in v0.1 | Phase 5 / AI-04 |
| `context.entities: []` | All builders | D-04 — entity extraction lands in Phase 5 | Phase 5 / AI-05 |
| `context.related: []` | All builders | D-04 — Vectorize similarity lands in Phase 5 | Phase 5 |
| `context.conflicts: []` | All builders | D-08 — conflict detection lands in Phase 5 | Phase 5 / AI-02 |
| `meta.confidence: null` | All builders | D-04 — AI classification lands in Phase 5 | Phase 5 |
| `meta.coverage: null` | All builders | D-04 — AI coverage estimation lands in Phase 5 | Phase 5 |
| `result.extracted_fields: {}` | `buildRememberResponse` | D-06 — entity extraction lands in Phase 5 | Phase 5 / AI-05 |
| `result.classified_type: null` | `buildRememberResponse` | D-06 — type inference lands in Phase 5 | Phase 5 |
| `chunks[i].score: null` | `buildRecallResponse` | D-07 — Vectorize ranking lands in Phase 5 | Phase 5 |
| `result.status: "accepted"` | `buildIngestResponse` | D-05 — Queue pipeline lands in Phase 6 | Phase 6 / PIP-01 |

These stubs do NOT prevent the plan's goal (the GREEN tests verify each builder's v0.1 shape). META_GAPS surfaced to Claude explains each stub.

## Self-Check: PASSED

- `packages/mcp-server/src/envelope.ts` — FOUND (487 lines)
- `packages/mcp-server/src/__tests__/__snapshots__/envelope.test.ts.snap` — FOUND
- Commit `14abab8` — FOUND
- `envelope.test.ts` all 13 tests GREEN — CONFIRMED
- `token-budget.test.ts` 4 trim tests GREEN — CONFIRMED
- `schemas.test.ts` 24 tests GREEN — CONFIRMED (no regression)
- `error-mapping.test.ts` 10 tests GREEN — CONFIRMED (no regression)
