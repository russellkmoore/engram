---
phase: 02-workspacedo-sqlite
plan: 08
subsystem: infra
tags: [ci, github-actions, lint-staged, husky, sto-08, sto-10, blockconcurrencywhile, vitest]

# Dependency graph
requires:
  - phase: 02-workspacedo-sqlite
    provides: "Plan 02-04/05/06 — GREEN vitest suite (25 passing + 1 documented it.skip canary). Plan 02-07 — scripts/lint-blockconcurrency.mjs (STO-10 lint with FND-08-style dual-mode dispatch + good/bad fixture canaries under packages/workspace-do/__fixtures__/)."
  - phase: 01-foundation
    provides: "Plan FND-08 — .github/workflows/ci.yml 3-step fixture-assertion pattern (main + inverted-bad + positive-good) used as the verbatim structural template for the new STO-10 block."
provides:
  - ".github/workflows/ci.yml — 3-step Lint blockConcurrencyWhile I/O (STO-10) block inserted BETWEEN Lint (ESLint)/Format check (Prettier) and Lint wrangler.jsonc (FND-08) per D-11 ordering; Test (Vitest) step appended AFTER Smoke - fresh install."
  - ".lintstagedrc.json — NEW additive glob `packages/workspace-do/src/**/*.ts` → `node scripts/lint-blockconcurrency.mjs`. Pre-existing rules (general .ts eslint/prettier chain, docs prettier rule, **/wrangler.jsonc lint-wrangler rule) untouched."
affects: [every future phase that adds code under packages/workspace-do/src/, every future phase that adds a vitest suite to a new workspace package]

# Tech tracking
tech-stack:
  added: []  # No new external dependencies — Phase 2 RESEARCH dep budget honored
  patterns:
    - "FND-08 3-step CI lint pattern reused verbatim: main `npm run lint:X` + inverted bad-fixture (`if node ... ; then echo regression; exit 1; fi`) + positive good-fixture pass."
    - "Additive lint-staged glob — a file matching BOTH the general `*.{ts,mts,cts,js,mjs,cjs}` rule AND the package-specific `packages/workspace-do/src/**/*.ts` rule runs both chains in parallel (lint-staged native behavior; A5)."
    - "D-11 CI step ordering: package-specific lints (blockconcurrency, wrangler) run AFTER repo-wide lints (eslint, prettier) so generic lint failures surface first; Vitest runs AFTER smoke tests so wrangler-dev boot failures are not masked by test failures."

key-files:
  created: []
  modified:
    - ".github/workflows/ci.yml (added 3 STO-10 lint steps between lines 35 and 55, plus 1 Test (Vitest) step at end)"
    - ".lintstagedrc.json (1 new top-level glob; 4 rules total)"

key-decisions:
  - "Reused FND-08's 3-step block verbatim — same inverted-bad pattern (`if node ... ; then exit 1; fi`), same per-fixture explicit invocation (positional-arg mode of the lint script), same comment wording style. Symmetry with FND-08 minimizes reviewer cognitive load and reuses an already-proven CI shape."
  - "D-11 ordering enforced: STO-10 block lands BETWEEN ESLint/Format and Lint wrangler.jsonc (FND-08), NOT before ESLint and NOT after smoke tests. The package-specific lints cluster keeps related failures adjacent in the CI log."
  - "Vitest step lands AFTER smoke tests (not before) so a wrangler-dev boot regression (FND-08 territory) surfaces before a test-level regression — a failing smoke step is a stronger signal than a failing assertion."
  - "Fixture paths use `packages/workspace-do/__fixtures__/` (NOT `src/__tests__/fixtures/`) per PATTERNS.md §17 drift mitigation. Plan 02-00 placed them outside `src/` precisely so the production full-scan glob would not pick them up; CI references must match."
  - "Lint-staged glob is additive (A5). Did NOT modify the existing `*.{ts,mts,cts,js,mjs,cjs}` general rule — a staged `packages/workspace-do/src/index.ts` triggers BOTH the eslint/prettier chain AND the blockconcurrency lint. This matches the existing `**/wrangler.jsonc` precedent (which is also additive on top of the general docs glob)."

patterns-established:
  - "When a phase introduces a new repo-level lint script with fixture-based canaries, wire it into `.github/workflows/ci.yml` using the FND-08 3-step pattern (main + inverted-bad + positive-good) AND add a corresponding additive lint-staged glob — both gates work together (pre-commit catches local violations; CI catches violations that bypass husky via --no-verify)."
  - "CI step ordering for a workspace-scoped phase: repo-wide lints (eslint, prettier) → package-specific lints (this phase's new lint block, then FND-08's wrangler block) → smoke tests → workspace tests. Failures bubble up in the order developers care about: cheapest/most-likely first, most-expensive last."

requirements-completed: [STO-08, STO-10]

# Metrics
duration: 6min
completed: 2026-05-25
---

# Phase 02 Plan 08: CI + lint-staged Wiring Summary

**Phase 2 lint script + vitest suite are now permanent CI/pre-commit gates: `.github/workflows/ci.yml` runs the FND-08-style 3-step STO-10 block between ESLint and lint:wrangler plus a Vitest step after smoke tests, and `.lintstagedrc.json` adds an additive `packages/workspace-do/src/**/*.ts` glob that runs the blockconcurrency lint on staged workspace files**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-25T18:43:00Z
- **Completed:** 2026-05-25T18:49:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **STO-10 gate is permanent.** `.github/workflows/ci.yml` runs `npm run lint:blockconcurrency` on every push/PR, plus two fixture-canary steps (inverted-bad + positive-good) that detect regressions in the lint script itself. If a future change makes the bad fixture stop failing, CI's `if node ...; then echo regression; exit 1; fi` block flips the exit code and turns the CI step red. Mirrors FND-08 line-for-line.
- **D-11 ordering enforced.** The new 3-step block sits BETWEEN `Lint (ESLint)`/`Format check (Prettier)` and `Lint wrangler.jsonc (FND-08)`. Package-specific lints cluster (blockconcurrency immediately followed by FND-08's wrangler block), which keeps related failures adjacent in the CI log.
- **STO-08 vitest gate ships.** New `Test (Vitest)` step appended AFTER `Smoke - fresh install` runs `npm test`, which dispatches to `npm run test --workspaces --if-present` and currently exercises 26 workspace-do tests (25 passing + 1 documented `it.skip` deferred-canary). Future workspaces that add a `"test"` script automatically join the gate; workspaces without one are silently skipped per `--if-present`.
- **Pre-commit defense additive.** `.lintstagedrc.json` adds `packages/workspace-do/src/**/*.ts` → `node scripts/lint-blockconcurrency.mjs` WITHOUT touching the pre-existing `*.{ts,mts,cts,js,mjs,cjs}` general rule. A staged workspace-do source file now runs both the eslint/prettier chain (from the general rule) AND the blockconcurrency lint (from the new rule) in parallel — lint-staged's native multi-match behavior. Verified working: the lint-staged dry run during this plan's own commit showed `[STARTED] packages/workspace-do/src/**/*.ts — 0 files`, confirming the glob is registered.
- **Symmetry with FND-08 preserved.** Both phases use the same 3-step CI block shape, the same fixture-location convention (canaries OUTSIDE the production scan glob), the same lint-staged additive pattern, and the same `[lint:X]` tag prefix on diagnostic output. Reviewers comparing the two phases' CI patches see identical structure.

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch .github/workflows/ci.yml (3 lint steps + Vitest step)** — `cd0e3a7` (ci)
2. **Task 2: Patch .lintstagedrc.json (workspace-do .ts glob)** — `3da760b` (chore)

_Note: this plan does NOT include a final metadata commit. STATE.md / ROADMAP.md updates are deferred to the orchestrator (parallel-executor convention)._

## Files Created/Modified

- `.github/workflows/ci.yml` — added 4 new steps (3 STO-10 lint + 1 Vitest)
- `.lintstagedrc.json` — added 1 new glob (additive, 4 rules total)

## Decisions Made

None beyond the plan — followed PLAN.md and PATTERNS.md §16/§17 verbatim. Key constraint reaffirmations are in the `key-decisions` frontmatter.

## Deviations from Plan

None — plan executed exactly as written.

The PLAN's referenced YAML snippets (lines 137-172) were transcribed verbatim into ci.yml at the exact insertion points specified (between `Format check (Prettier)` and `Lint wrangler.jsonc (FND-08)` for the STO-10 block, after `Smoke - fresh install` for the Vitest step). The `.lintstagedrc.json` diff matches PLAN.md lines 218-224 exactly.

## Issues Encountered

**Local typecheck appears to fail until `npm run types:gen` runs.** `npm run typecheck` exits 2 with `error TS2688: Cannot find type definition file for './worker-configuration.d.ts'`. This is NOT a regression introduced by this plan — `worker-configuration.d.ts` is a Wrangler-generated artifact (gitignored at `.gitignore:6`) that CI generates via the `Generate Wrangler types` step (ci.yml line 24-25) BEFORE typecheck. After running `npm run types:gen` locally, typecheck exits 0. CI is unaffected. Documented here so the next developer in this worktree knows to run `types:gen` after a fresh checkout; this is pre-existing repo behavior, not Plan 08 scope.

## Verification Snapshot

All Phase 2 phase-completion gates green locally:

| Gate | Command | Exit | Notes |
|---|---|---|---|
| ESLint | `npm run lint` | 0 | unchanged |
| Wrangler lint | `npm run lint:wrangler` | 0 | FND-08, unchanged |
| Blockconcurrency lint | `npm run lint:blockconcurrency` | 0 | STO-10, full-scan over 15 src files |
| Workspace-do tests | `npm test --workspace @engram/workspace-do -- --run` | 0 | 25 passed, 1 skipped (deferred CI canary), 26 total |
| Typecheck | `npm run typecheck` (after `npm run types:gen`) | 0 | matches CI sequence |
| CI inverted-bad simulation | `! node scripts/lint-blockconcurrency.mjs packages/workspace-do/__fixtures__/bad-blockconcurrency.ts` | 0 | inversion succeeds (lint exits 1, `!` flips to 0) |
| Good fixture | `node scripts/lint-blockconcurrency.mjs packages/workspace-do/__fixtures__/good-blockconcurrency.ts` | 0 | passes cleanly |
| YAML syntax | `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"` | 0 | parses cleanly |
| Lint-staged JSON | `node -e "JSON.parse(require('fs').readFileSync('.lintstagedrc.json','utf8'))"` | 0 | parses cleanly, 4 keys, new glob present |

CI step ordering (via `awk '/- name:/' .github/workflows/ci.yml`):

```
Setup Node
Install dependencies
Generate Wrangler types
Typecheck
Lint (ESLint)
Format check (Prettier)
Lint blockConcurrencyWhile I/O (STO-10)              ← NEW
Lint blockConcurrencyWhile — negative fixture (STO-10) ← NEW
Lint blockConcurrencyWhile — positive fixture (STO-10) ← NEW
Lint wrangler.jsonc (FND-08)
Lint wrangler.jsonc — negative fixture must fail (FND-08)
Lint wrangler.jsonc — positive fixture must pass (FND-08)
Smoke - wrangler dev (mcp-server)
Smoke - wrangler dev (triage-worker)
Smoke - fresh install
Test (Vitest)                                          ← NEW
```

D-11 ordering verified: STO-10 main lint at line 36 (between `Format check` at line 33 and `Lint wrangler.jsonc (FND-08)` at line 55). Vitest step at line 82 (after `Smoke - fresh install` at line 79).

## User Setup Required

None — no external service configuration. Pre-commit hook (`husky`) was already installed by the repo `prepare` script; the new lint-staged rule activates automatically on the next `git commit` in this repo.

## Next Phase Readiness

- **Phase 2 phase-completion gates all green.** `npm run lint && npm run lint:wrangler && npm run lint:blockconcurrency && npm test` exits 0 across the board. The PHASE-CHECKLIST.md (if Plan 02-09 produces one) can check the STO-08 and STO-10 boxes.
- **No blockers** for the phase-finalize plan (02-09) or for the next phase. The deferred CI canary (`it.skip` in `blockconcurrency-lint.test.ts` line 105 — "exits 2 in no-arg mode when the glob matches nothing") remains documented as deferred per Open Question O4; the no-arg full-scan CI step we just added exercises that code path naturally on every CI run.
- **CI now enforces** every Phase 2 invariant on push/PR. Future workspace-do contributions cannot bypass STO-10 via husky `--no-verify` (CI catches it) and cannot land a vitest regression without surfacing in `Test (Vitest)`.

---
*Phase: 02-workspacedo-sqlite*
*Plan: 08*
*Completed: 2026-05-25*

## Self-Check: PASSED

Verified:
- `.github/workflows/ci.yml` exists and contains the 4 new step names (`Lint blockConcurrencyWhile I/O (STO-10)`, `negative fixture must fail (STO-10)`, `positive fixture must pass (STO-10)`, `Test (Vitest)`).
- `.lintstagedrc.json` exists, parses cleanly, has 4 keys including `packages/workspace-do/src/**/*.ts`.
- Commit `cd0e3a7` (Task 1) exists in `git log`.
- Commit `3da760b` (Task 2) exists in `git log`.
