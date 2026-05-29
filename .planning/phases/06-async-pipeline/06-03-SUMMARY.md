---
phase: 06-async-pipeline
plan: 03
subsystem: database
tags: [sqlite, durable-objects, ingest-status, idempotency, sto-07, pip-03, pip-05]

# Dependency graph
requires:
  - phase: 06-async-pipeline
    provides: "blocks.ingest_status column (V3 migration shipped in 06-01)"
  - phase: 05-ai-integration
    provides: "updateBlockEnrichment / moveToInbox / moveToColdStorage / stampEmbedding helpers + RPCs; createInboxEntry helper; assertOwnsWorkspace STO-07 gate; NotFoundError contract"
provides:
  - "updateBlockEnrichment / moveToColdStorage / moveToInbox UPDATEs atomically set ingest_status='enriched' (D-03)"
  - "createInboxEntry uses INSERT OR IGNORE on inbox.id PK (PIP-03 / IP-1 — at-least-once Queue delivery idempotency)"
  - "markIngestFailed query helper — writes ingest_status='failed' + overwrites properties with {error, failed_at}"
  - "WorkspaceDO.markIngestFailed RPC method — STO-07 gate at first executable line"
affects: [06-02 (parallel — no overlap), 06-04 (triage-worker permanent-failure path consumes this RPC), 06-05 (integration tests verify lifecycle end-to-end)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent SQLite INSERT via OR IGNORE clause (Pattern I — new in Phase 6)"
    - "Atomic status transition baked into existing enrichment UPDATEs (pending → enriched in one SET clause)"

key-files:
  created: []
  modified:
    - "packages/workspace-do/src/queries.ts — 3 UPDATEs amended + 1 INSERT amended + 1 new markIngestFailed helper"
    - "packages/workspace-do/src/index.ts — 1 new markIngestFailed RPC + Rule 3 fix to pre-existing moveToColdStorage TS2379"
    - "packages/workspace-do/src/__tests__/helpers.test.ts — 6 new GREEN tests (4 status transitions + 1 idempotency + 2 markIngestFailed)"
    - "packages/workspace-do/src/__tests__/defense-in-depth.test.ts — 2 new GREEN tests (markIngestFailed positive + STO-07 mismatch)"

key-decisions:
  - "ingest_status='enriched' literal embedded directly in the SET clause (no new positional binding) — preserves existing binding order in updateBlockEnrichment / moveToColdStorage and keeps the diff to one SQL string change per helper"
  - "moveToInbox change is two-part: createInboxEntry remains the single INSERT site (now OR IGNORE) AND moveToInbox adds an explicit follow-up block UPDATE — the inbox insert and the block status are written by two separate single-statement .exec() calls, both naturally idempotent under replay"
  - "markIngestFailed OVERWRITES properties with {error, failed_at} (no COALESCE merge) per D-03: at the failed state there is no useful enrichment to preserve and the error info is the only useful payload for v0.2 inbox UI"
  - "Rule 3 fix to pre-existing moveToColdStorage TS2379 — used conditional-key build pattern already established in listConflicts above; unblocks the plan's tsc --noEmit verification gate"

patterns-established:
  - "Pattern I (INSERT OR IGNORE for at-least-once consumer idempotency) — new in Phase 6; only INSERTs need OR IGNORE since UPDATEs are naturally idempotent"
  - "Status-transition convention: an enrichment helper that mutates a block's content also flips its lifecycle status atomically (no separate status UPDATE call)"

requirements-completed: [PIP-03, PIP-04, PIP-05, PIP-06]

# Metrics
duration: ~25min
completed: 2026-05-29
---

# Phase 6 Plan 03: Async Pipeline SQLite Surface Summary

**SQLite-side D-03 contract for Phase 6 ingest_status lifecycle: pending→enriched baked into 3 existing UPDATEs, INSERT OR IGNORE on inbox, new markIngestFailed helper + RPC with STO-07 gate.**

## Performance

- **Duration:** ~25 minutes
- **Started:** 2026-05-29T20:00:00Z (approx — worktree setup)
- **Completed:** 2026-05-29T20:25:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Three Phase 5 enrichment helpers (`updateBlockEnrichment`, `moveToColdStorage`, `moveToInbox`) now atomically flip `ingest_status` to `'enriched'` as part of the same UPDATE that writes the enrichment outputs — no separate transition step needed.
- `createInboxEntry` switched to `INSERT OR IGNORE INTO inbox` (single-word SQL change) — at-least-once Cloudflare Queue delivery can no longer fire a UNIQUE-constraint failure on the `inbox.id` PK (`inbox.id == block.id` per `moveToInbox` composition).
- New `markIngestFailed` query helper writes `ingest_status='failed'` AND overwrites `properties` with `{error: reason, failed_at: <ms>}` for the v0.2 inbox UI "broken memories" surface.
- New `WorkspaceDO.markIngestFailed` RPC method exposes the helper as the Triage Worker's permanent-failure entry point — `assertOwnsWorkspace` is the first executable line (STO-07 invariant verified by a new defense-in-depth test).
- All 37 tests pass (8 baseline helpers + 6 new helpers + 9 baseline defense-in-depth + 2 new defense-in-depth + 12 across other suites); `tsc --noEmit` exits 0 across the package.

## Task Commits

Each task was committed atomically:

1. **Task 1: queries.ts — amend 3 UPDATEs + INSERT OR IGNORE + new markIngestFailed helper** — `a0bccd8` (feat). Combined RED+GREEN because the lint-staged hook blocked the standalone RED commit on `@typescript-eslint/no-unsafe-call` for the unresolved `markIngestFailed` import. Implementation lands atomically with the tests.
2. **Task 2: WorkspaceDO.markIngestFailed RPC + STO-07 defense-in-depth test** — `9aa08f0` (feat). RED phase observed `ws.markIngestFailed is not a function` against both new tests; GREEN landed the renamed import + RPC body + Rule 3 fix to the pre-existing `moveToColdStorage` TS2379 error.

_Note: a separate final metadata commit will land this SUMMARY.md._

## Files Created/Modified

- `packages/workspace-do/src/queries.ts` — 3 SET-clause amendments (each adds `ingest_status = 'enriched'`) + 1 INSERT amendment (`INSERT OR IGNORE INTO inbox`) + 1 new exported `markIngestFailed` helper (section 13 in the file). Per-helper diff summary:
  - `updateBlockEnrichment` (lines 596–620 region) — SET clause appended; binding order unchanged.
  - `moveToColdStorage` (lines 675–725 region) — SET clause appended next to `cold_storage = 1`; orthogonality comment added.
  - `moveToInbox` (lines 631–670 region) — explicit follow-up block UPDATE after `createInboxEntry` call; NotFoundError on `rowsWritten === 0`.
  - `createInboxEntry` (lines 472–495 region) — `INSERT INTO inbox` → `INSERT OR IGNORE INTO inbox`; doc-block updated with PIP-03 / IP-1 rationale.
  - `markIngestFailed` (new, lines ~728–770) — single-statement UPDATE; throws `NotFoundError("block", id)` on miss.
- `packages/workspace-do/src/index.ts` — renamed import `markIngestFailed as markIngestFailedQuery` added to the import block; new `markIngestFailed` RPC method appended after `moveToColdStorage` with `assertOwnsWorkspace` as the first executable line; Rule 3 fix to pre-existing `moveToColdStorage` arg-shape that tripped TS2379 under strict `exactOptionalPropertyTypes`.
- `packages/workspace-do/src/__tests__/helpers.test.ts` — 6 new `it(...)` cases extending the existing `WorkspaceDO typed query helpers (STO-06)` describe + a new `markIngestFailed` sub-describe at the end. Test #4 (replay-twice idempotency) is the PIP-03 / IP-1 GREEN gate.
- `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` — 2 new `it(...)` cases (positive + STO-07 mismatch). The mismatch case asserts the `McpError` fires BEFORE any SQLite write, proving the auth gate is the first executable line.

## Decisions Made

See `key-decisions` in the frontmatter above for the full list. The two highest-impact decisions:

1. **Status transition baked into the existing UPDATE, not a separate call.** D-03 specifies atomicity; embedding `ingest_status = 'enriched'` directly in the SET clause (as a literal SQL string, not a positional binding) preserves the existing binding order in every helper and keeps the diff to one SQL string change per helper. The alternative — a second `sql.exec("UPDATE blocks SET ingest_status = 'enriched' WHERE id = ?", ...)` after each enrichment write — would have doubled the SQL round-trips and introduced a window where a partial failure could leave `properties` enriched but status still `'pending'`. Embedding the status in the same UPDATE is atomic by SQLite's per-statement guarantee.

2. **`moveToInbox` writes via two single-statement `.exec()` calls, not a multi-statement exec.** The first `.exec()` is `createInboxEntry`'s `INSERT OR IGNORE`; the second is the block UPDATE. Both are individually atomic; the pair is not. Per Pitfall 8 in `queries.ts` doc-block, multi-statement bindings are a workerd footgun, so the two-call shape is the correct pattern even though it accepts a brief window where the inbox row exists but the block status is still `'pending'`. The Triage Worker (06-04) is the only writer, and that window is observation-only (no concurrent reader can act on it at v0.1 single-user scale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing TS2379 error in `moveToColdStorage` RPC**

- **Found during:** Task 2 (verification gate `npx tsc --noEmit`).
- **Issue:** The Phase 5 `moveToColdStorage` RPC (added in commit `22e1fe4` Phase 5 plan 05-01) called the query helper with `properties: args.properties, summary: args.summary, confidence: args.confidence` — but each of those args is typed as `T | undefined` (optional input) while the helper's parameter is typed as `properties?: T` (optional key). Under strict `exactOptionalPropertyTypes: true`, `T | undefined` is NOT assignable to `T` even when the key itself is optional — TypeScript treats explicit `undefined` and missing-key as distinct.
- **Fix:** Used the conditional-key build pattern already established in `listConflicts` (lines 207–211 in the same file): construct an `opts` object with only the required keys, then conditionally add each optional key when the input is `!== undefined`. Same pattern preserves zero behavior change while satisfying strict TS.
- **Files modified:** `packages/workspace-do/src/index.ts` (lines 303–323 region — the `moveToColdStorage` RPC body).
- **Verification:** `npx tsc --noEmit` now exits 0; full vitest suite still GREEN (37 passed, 1 skipped — `moveToColdStorage`-based tests still pass).
- **Committed in:** `9aa08f0` (Task 2 commit). Documented in the commit message body.
- **Why this is in-scope:** The plan's `<verify>` block (item 2) requires `cd packages/workspace-do && npx tsc --noEmit` to exit 0. Without this fix the gate fails. Touching `index.ts` was already required by Task 2 (adding the `markIngestFailed` RPC method), so this fix was a one-region edit in the same file the task already required.

**2. [Process] RED commit could not stand alone — combined RED+GREEN for Task 1**

- **Found during:** Task 1 attempted RED commit (`git commit -m "test(06-03): ..."`).
- **Issue:** The repository's `lint-staged` hook runs `eslint --fix` on staged `.ts` files. The RED test file imports `markIngestFailed` from `../queries.js` — which doesn't exist yet at RED time — and ESLint emits `@typescript-eslint/no-unsafe-call` for the two call sites in the new tests. The hook fails the commit.
- **Fix:** Combined RED → GREEN into a single commit (`a0bccd8`). The RED phase was observed locally (`6 failed | 8 passed (14)`) before implementation; GREEN was verified before the commit (`14 passed (14)`). Commit message documents this.
- **Files modified:** No additional files. Same code that would have landed in two commits landed in one.
- **Verification:** Tests still drive the implementation — RED was observable on the same exact test file shape that ultimately landed GREEN.
- **Why this is acceptable:** TDD cadence per `<tdd_execution>` guidance allows combining when commit hooks block the RED phase. The intent (tests come first, observed-failing) was preserved; only the artifact-level separation was sacrificed.

### Out-of-Scope Pre-Existing Issues (Documented, Not Fixed)

Running `npm run lint` at the repository root surfaces 13 errors + 8 warnings across packages NOT touched by this plan (`mcp-server/src/ai-helper.ts`, `mcp-server/src/oauth.ts`, `triage-worker/src/__tests__/extract.test.ts`). Per the SCOPE BOUNDARY rule in the executor instructions (only fix issues DIRECTLY caused by the current task's changes), these are NOT fixed by this plan. They will be visible to subsequent waves of Phase 6 (06-02 owns mcp-server and 06-04 owns triage-worker) and may be in-scope there. The Rule 3 fix to `moveToColdStorage` IS in-scope here because (a) the plan's verification gate requires `tsc --noEmit` to pass for this package and (b) Task 2 was already modifying `index.ts`.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking) + 1 process note (RED+GREEN combined). No scope creep — both deviations are inside files this plan was already required to modify.
**Impact on plan:** All planned behavior shipped. The Rule 3 fix unblocked a verification gate that the planner did not anticipate would surface a pre-existing latent issue.

## Issues Encountered

- **Pre-existing TS2379 in `moveToColdStorage` RPC** (see Rule 3 deviation above). Investigation via `git stash + tsc + git stash pop` confirmed the error is from Phase 5 commit `22e1fe4`, not introduced by this plan's edits. Fixed in-scope.
- **lint-staged blocked the RED commit for Task 1** (see Process deviation above). Resolved by combining RED+GREEN into a single commit with both phases documented in the commit body.

## Threat Surface Scan

Reviewed all files touched in this plan against the `<threat_model>` in PLAN.md:

- T-06-03-WS-INJECT (Spoofing — mitigate via `assertOwnsWorkspace` first-line) — VERIFIED by Task 2 defense-in-depth test (mismatch fires McpError BEFORE any SQLite write).
- T-06-03-REASON-INJECT (Tampering — mitigate via `JSON.stringify` boundary) — VERIFIED by Task 1 markIngestFailed happy-path test (properties parses cleanly as `{error, failed_at}`).
- T-06-03-INBOX-FLOOD (DoS — mitigate via INSERT OR IGNORE) — VERIFIED by Task 1 replay-twice idempotency test (inbox row count stays at 1).
- T-06-03-ORTHO-VIOLATION (Tampering — accept by code convention) — VERIFIED by Task 1 moveToColdStorage test (cold_storage=1 + ingest_status='enriched' co-occur; never failed).
- T-06-03-NOTFOUND-MISS (Repudiation — accept) — VERIFIED by Task 1 markIngestFailed throw-on-miss test (NotFoundError surfaces to caller for 06-04 catch-and-ack).
- T-06-03-LOG-INJECT and T-06-03-SC — N/A to this plan (06-04 owns console.error / writeAnalytics call sites; no package installs).

No new security-relevant surface introduced beyond what the threat model anticipated. No threat flags to surface.

## Self-Check

**1. Files created/modified exist on disk:**

- `packages/workspace-do/src/queries.ts` — FOUND (verified `grep "markIngestFailed" → 2 matches`).
- `packages/workspace-do/src/index.ts` — FOUND (verified `grep "markIngestFailedQuery" → 2 matches`).
- `packages/workspace-do/src/__tests__/helpers.test.ts` — FOUND (14 tests GREEN).
- `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` — FOUND (11 tests GREEN).
- `.planning/phases/06-async-pipeline/06-03-SUMMARY.md` — created by this Write call.

**2. Commits exist on the worktree branch:**

- `a0bccd8` (Task 1) — FOUND in `git log --oneline -5`.
- `9aa08f0` (Task 2) — FOUND in `git log --oneline -5`.

**3. Verification gates from PLAN.md `<verification>` section:**

- (1) `npx vitest run` → 37 passed | 1 skipped, exits 0 — PASS.
- (2) `npx tsc --noEmit` → exits 0 — PASS (after Rule 3 fix).
- (3) `grep -c "ingest_status = 'enriched'" queries.ts` ≥ 3 → 3 — PASS.
- (4) `grep -c "ingest_status = 'failed'" queries.ts` ≥ 1 → 2 (UPDATE + docstring) — PASS.
- (5) `grep -q "INSERT OR IGNORE INTO inbox" queries.ts` → matches — PASS.
- (6) STO-07 first-executable-line: `grep -B1 "markIngestFailedQuery(this.ctx.storage.sql" index.ts | grep "assertOwnsWorkspace"` → matches — PASS.
- (7) Single-statement `.exec()` for `markIngestFailed` — confirmed in source (one `sql.exec(...)` call, one statement string, no semicolons inside).
- (8) `npm run lint` exits 0 → FAIL (pre-existing errors in other packages — out of scope; my own lint issues in defense-in-depth.test.ts were fixed before commit).

## Status: PASSED

All in-scope success criteria met. SUMMARY.md created and committed.

## Next Phase Readiness

- 06-02 (parallel Wave 2): no file overlap with this plan; runs to completion independently.
- 06-04 (Wave 3 — Triage Worker permanent-failure wiring): can now call `stub.markIngestFailed(...)` from `extract.ts` post-retry-budget catch AND from `index.ts` DO-RPC catch. Can also rely on `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage` to atomically flip `ingest_status` to `'enriched'` without a separate transition call.
- 06-05 (Wave 4 — integration tests): the replay-twice idempotency assertion at the HELPER level is GREEN here; the equivalent assertion at the QUEUE-CONSUMER level (replaying the same `MemoryEvent` twice through `triage-worker/src/index.ts queue(batch, env)`) is 06-05's territory and will exercise this plan's `INSERT OR IGNORE` + idempotent UPDATEs end-to-end.

---

*Phase: 06-async-pipeline*
*Completed: 2026-05-29*
