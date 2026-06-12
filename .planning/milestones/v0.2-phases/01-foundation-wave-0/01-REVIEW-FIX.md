---
phase: 01-foundation-wave-0
fixed_at: 2026-06-04T07:55:00Z
review_path: .planning/phases/01-foundation-wave-0/01-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-06-04T07:55:00Z
**Source review:** .planning/phases/01-foundation-wave-0/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (4 Critical + 5 Warning; 2 Info excluded by fix_scope)
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: Timing-side-channel token comparison in admin audit endpoint

**Files modified:** `packages/mcp-server/src/oauth.ts`
**Commit:** 5d25c66
**Applied fix:** Added `timingSafeStringEqual(a, b)` helper using WebCrypto HMAC-SHA-256 (Workers-compatible, no `node:crypto` dependency). Both the provided token and the trusted secret are HMAC-signed with the same key derived from the secret; the 32-byte MACs are XOR-compared in a constant-time loop. Length equality is checked first. Replaced `provided !== secret` guard with `provided === null || !(await timingSafeStringEqual(provided, secret))`.

Note: the reviewer's code snippet had a logic flaw (it signed `ka` twice and compared identical MACs). The committed implementation signs `ka` (provided) and `kb` (secret) separately with a key derived from `kb`, which correctly produces equal MACs only when `a === b`.

### CR-02: F1 eval test is permanently skipped — nightly CI job always passes vacuously

**Files modified:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts`
**Commit:** c32e97a
**Applied fix:** Removed `it.skip(...)`, replaced with `it(...)`. Updated the comment to explain that `hasEvalCreds()` inside the test body handles no-creds environments by returning early — making `it.skip` redundant and wrong.

### CR-03: `eval-suite` CI job has no `needs` dependency on `build` job

**Files modified:** `.github/workflows/ci.yml`
**Commit:** f8ffcd5
**Applied fix:** Added `needs: [build]` to the `eval-suite` job declaration, ensuring the eval suite only runs after typecheck and lint pass.

### CR-04: Unchecked `as` cast on `.one()` result in `countStaleEmbeddings`

**Files modified:** `packages/workspace-do/src/queries.ts`
**Commit:** 30d4b68
**Applied fix:** Replaced `.one() as { n: number }` with `.toArray()` + runtime narrowing: explicit `rows[0] === undefined` invariant guard + `typeof n !== "number"` type check. Both throw descriptive `Error` messages. Matches the narrowing discipline used throughout the rest of `queries.ts`.

### WR-01: Inconsistent empty-query guard between ingest and recall phases skews F1 metrics

**Files modified:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts`
**Commit:** b2e0746
**Applied fix:** Changed `if (!ex.query) continue` in the recall loop to `if (ex.query.trim().length === 0) continue` — matching the guard already used in the ingest loop. Prevents whitespace-only queries from being counted as false negatives.

### WR-02: F1 precision metric mixes per-result false positives with per-query hit/miss

**Files modified:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts`
**Commit:** 0203ffa
**Applied fix:** Replaced the per-result `falsePositives += memories.filter(...).length` accumulation with a per-query three-way branch: `isHit` → `truePositives++`; `!isHit && memories.length > 0` → `falsePositives++`; `!isHit && memories.length === 0` → `falseNegatives++`. All three counters now scale uniformly per query, producing standard binary precision@k.
**Status:** fixed: requires human verification (logic change to metric calculation)

### WR-03: `--workspace` CLI argument silently accepts empty string when trailing

**Files modified:** `scripts/audit/embedding-version-audit.ts`
**Commit:** 400e3d3
**Applied fix:** Replaced `workspaceOverride = args[++i] ?? ""` with an explicit guard: if the next arg is missing or empty, write `FATAL: --workspace requires a non-empty workspace_id argument` to stderr, call `usage(stderr)`, and `process.exit(2)`.

### WR-04: `--since` value in `eval-budget-summary.mjs` is not validated as ISO 8601

**Files modified:** `scripts/eval-budget-summary.mjs`
**Commit:** a5bdc13
**Applied fix:** Added `new Date(sinceOverride)` + `isNaN(parsed.getTime())` validation block immediately after the `showHelp` block. On invalid input: writes `FATAL: --since value '...' is not a valid ISO 8601 datetime.` to stderr, calls `usage(stderr)`, exits with code 2. Runs before env validation and before any network call.

### WR-05: `assertAllBlocksAtV2` test for STO-07 guard uses closure mutation — fragile in async harness

**Files modified:** `packages/workspace-do/src/__tests__/migration-audit.test.ts`
**Commit:** 8985f34
**Applied fix:** Changed the `runInDurableObject` callback to return the thrown error (or `null`) with explicit `: unknown` return type annotation. `thrownError` is now the awaited return value of `runInDurableObject` rather than a closure-mutated variable. Removed the `let thrownError: unknown = null` declaration.

---

_Fixed: 2026-06-04T07:55:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
