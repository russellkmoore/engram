---
phase: "04"
plan: "01"
subsystem: "mcp-server + shared/types"
tags: ["tdd", "red-tests", "schemas", "types", "envelope", "token-budget", "defense-in-depth"]
dependency_graph:
  requires:
    - "03-03: tools.ts MethodNotFound stubs (provides RED baseline)"
    - "03-01: WorkspaceDO.lexicalSearchBlocks (Prong B pentest target)"
  provides:
    - "envelope.ts: 5 builder signatures locked (Plan 04-02 input)"
    - "result-types.ts: 6 typed interfaces (Plan 04-02/03 input)"
    - "gpt-tokenizer@^3.4.0: available for token-budget enforcement"
    - "verbosity param: D-03 schema shape locked"
    - "limit ≤25: D-10 budget cap locked in schema"
  affects:
    - "Plan 04-02: GREEN target for envelope.test.ts + token-budget.test.ts"
    - "Plan 04-03: GREEN target for tools-integration.test.ts + cross-workspace-pentest.test.ts"
tech_stack:
  added:
    - "gpt-tokenizer@^3.4.0 — BPE cl100k_base encoder for MCP-08 budget enforcement (D-09)"
  patterns:
    - "captureCallback (S6) — spies on McpServer.prototype.registerTool to capture callbacks without JSON-RPC dispatch"
    - "?raw import — inlines tools.ts source at bundle time for workerd-safe structural assertions"
    - "eslint-disable block scoped to RED files importing not-yet-existing modules"
key_files:
  created:
    - "packages/mcp-server/src/result-types.ts — 6 typed result interfaces (RememberResult, RecallChunk, RecallResult, SearchResult, ForgetResult, IngestResult)"
    - "packages/mcp-server/src/__tests__/envelope.test.ts — 14 RED assertions for Plan 04-02 builders (TOL-06, D-04..D-10)"
    - "packages/mcp-server/src/__tests__/tools-integration.test.ts — TOL-01..05 round-trip RED tests (Plan 04-03 gate)"
    - "packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts — TOL-07 two-prong isolation proof (Plan 04-03 gate)"
    - "packages/mcp-server/src/__tests__/token-budget.test.ts — MCP-08 worst-case 25×4KB budget RED tests (Plan 04-02 gate)"
  modified:
    - "shared/types/src/index.ts — widen meta.confidence + meta.coverage to number|null (D-04 honest-stub)"
    - "packages/mcp-server/package.json — add gpt-tokenizer@^3.4.0 runtime dep"
    - "packages/mcp-server/src/schemas.ts — add verbosity (D-03), tighten limit ≤25 (D-10), fix z.iso.datetime()"
    - "packages/mcp-server/src/__tests__/schemas.test.ts — 8 new assertions for verbosity + limit ≤25"
    - "packages/mcp-server/src/__tests__/tools.test.ts — replace MethodNotFound happy-path stubs with RED envelope assertions"
    - "packages/mcp-server/src/__tests__/error-mapping.test.ts — 3 Phase 4 regression lock assertions (GREEN now)"
decisions:
  - "D-03: verbosity='synthesis'|'chunks'|'both', default 'both' (BORDERLINE spike gate — borderline case kept per 04-CONTEXT.md)"
  - "D-09: gpt-tokenizer@^3.4.0 (cl100k_base BPE) for MCP-08 budget enforcement — pure JS, workerd-safe, supply-chain gate approved"
  - "D-10: limit ≤25 replaces ≤100 in RecallInputSchema; SearchInputSchema gains limit field capped at 25"
  - "z.iso.datetime() replaces z.string().datetime() — zod v4 deprecation fix applied inline (Rule 1)"
metrics:
  duration: "~2 sessions (human-verify checkpoint after Task 1)"
  completed_date: "2026-05-27"
  tasks_completed: 5
  tasks_total: 5
  files_changed: 13
  insertions: 1159
  deletions: 54
---

# Phase 4 Plan 01: Foundation + RED Tests Summary

Phase 4 plan 01 establishes the typed contracts and RED test scaffolds for the envelope builders (Plan 04-02) and tool handler bodies (Plan 04-03). All 5 tasks complete with 4 individual commits on the worktree branch.

## One-liner

gpt-tokenizer installed, EngramResponse meta widened to `number|null`, RecallInputSchema gains `verbosity` + tightened `limit≤25`, 6 typed result interfaces created, and 4 new test files + 2 extended test files committed as intentional RED gates for Plans 04-02 and 04-03.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Supply-chain gate (T-04-SC) — gpt-tokenizer@^3.4.0 approved | checkpoint (human) | — |
| 2 | Install gpt-tokenizer + widen meta.confidence/coverage to `number\|null` | `9783071` | package.json, shared/types/src/index.ts |
| 3 | Schema diff: verbosity (D-03), limit ≤25 (D-10), z.iso.datetime() fix | `99119bb` | schemas.ts, schemas.test.ts |
| 4 | Create result-types.ts — 6 typed interfaces | `3eb1d98` | result-types.ts |
| 5 | RED test scaffolds — 4 new + 2 extended test files | `cdce6f5` | 7 test files + CF-CODE-ASSIST tracker |

## Test State After Plan 01

| File | State | Failure Mode |
|------|-------|--------------|
| `schemas.test.ts` | GREEN (24/24 pass) | — |
| `error-mapping.test.ts` | GREEN (10/10 pass) | — |
| `tools.test.ts` (registration + DD-RT) | GREEN (4/4 pass) | — |
| `tools.test.ts` (happy-path callbacks) | RED | McpError(MethodNotFound) — Phase 4 Plan 03 gate |
| `tools-integration.test.ts` | RED | McpError(MethodNotFound) — Phase 4 Plan 03 gate |
| `cross-workspace-pentest.test.ts` | RED | McpError(MethodNotFound) — Phase 4 Plan 03 gate |
| `envelope.test.ts` | RED | Cannot find module '../envelope.js' — Phase 4 Plan 02 gate |
| `token-budget.test.ts` | RED | Cannot find module '../envelope.js' — Phase 4 Plan 02 gate |

All RED failures surface the correct, non-leaking error messages per T-04-RED-MIRROR disposition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed zod v4 deprecation: z.string().datetime() → z.iso.datetime()**
- **Found during:** Task 3 (schema diff)
- **Issue:** Pre-existing ESLint errors on `expires`, `since`, `until` fields in schemas.ts — `z.string().datetime()` is deprecated in zod v4
- **Fix:** Changed to `z.iso.datetime()` on all 3 fields
- **Files modified:** `packages/mcp-server/src/schemas.ts`
- **Commit:** `99119bb`

**2. [Rule 3 - Blocking] Fixed ESLint errors preventing Task 5 commit (102 errors)**
- **Found during:** Task 5 commit attempt
- **Issue:** lint-staged rejected commit with 102 ESLint errors across 6 test files:
  - `no-unsafe-*` in envelope.test.ts and token-budget.test.ts (imports from non-existent `../envelope.js`)
  - `no-confusing-void-expression` in captureCallback helpers (3 files)
  - Unused `McpError/ErrorCode` imports in tools.test.ts
  - `restrict-template-expressions` for numbers in template literals (2 files)
  - `no-unnecessary-type-assertion` and `no-unnecessary-condition` patterns
- **Fix:**
  - Added `/* eslint-disable ... */` block in envelope.test.ts and token-budget.test.ts for `no-unsafe-*` (intentional RED imports)
  - Rewrote `captureCallback` helpers in all 3 files to use explicit `for` loops instead of `.find()` — eliminates `no-confusing-void-expression`
  - Removed unused imports from tools.test.ts
  - Fixed double-cast `as unknown as Env` → `as Env` (3 files)
  - Fixed `String(i)` and `String(byteLength)` in template literals
  - Added `import type` for WorkspaceDO in cross-workspace-pentest.test.ts
- **Files modified:** All 6 test files
- **Commit:** `cdce6f5`

**3. [Rule 2 - Security check] SearchInputSchema .safeParse test assertion fixed**
- **Found during:** Task 3 TDD GREEN phase
- **Issue:** Test expected `SearchInputSchema.safeParse({ format: "csv" }).success === false`, but zod strips unknown keys by default — format was silently ignored
- **Fix:** Changed test to verify `Object.keys(SearchInputSchema.shape)` does not contain `"format"` (structural assertion, not parse rejection)
- **Files modified:** `packages/mcp-server/src/__tests__/schemas.test.ts`
- **Commit:** `99119bb`

## CF-Code-Assist Routing Log

All 11 code-producing tasks in Plan 04-01 were routed to `claude` due to multi-file reasoning requirements, cross-cutting context needs, and TDD cycle management. See `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` for the full table with per-task rationale.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced. All changes are:
- Type widening in shared/types (structural, no runtime surface)
- Schema tightening (reduces attack surface)
- Test files only
- `result-types.ts` is TypeScript interface declarations (no runtime behavior)

No threat flags to add.

## Self-Check: PASSED

- `packages/mcp-server/src/result-types.ts` — FOUND
- `packages/mcp-server/src/__tests__/envelope.test.ts` — FOUND
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` — FOUND
- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — FOUND
- `packages/mcp-server/src/__tests__/token-budget.test.ts` — FOUND
- Commit `9783071` — FOUND
- Commit `99119bb` — FOUND
- Commit `3eb1d98` — FOUND
- Commit `cdce6f5` — FOUND
