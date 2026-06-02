---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [lint, ci, scaffolding, smoke-tests, wrangler, jsonc-parser, durable-objects]

requires: []

provides:
  - "scripts/lint-wrangler.mjs: FND-08 jsonc-parser-based lint rule blocking new_classes DO declarations"
  - "scripts/smoke-install.sh: FND-01 fresh-clone install smoke verifying @engram/* workspace symlinks"
  - "scripts/smoke-wrangler-dev.sh: FND-03 wrangler dev boot smoke verifying HTTP 200 response"
  - "tests/fixtures/good-wrangler.jsonc: positive lint fixture with new_sqlite_classes"
  - "tests/fixtures/bad-wrangler.jsonc: negative lint fixture with new_classes (regression proof)"

affects:
  - 01-foundation/01-05 (lint script verifies production packages/*/wrangler.jsonc in Wave 2)
  - 01-foundation/01-06 (CI workflow wires npm run lint:wrangler step)
  - all future plans that create wrangler.jsonc files (protected by FND-08 rule)

tech-stack:
  added: [jsonc-parser]
  patterns:
    - "Dual-mode lint script: no args = production glob, with args = per-file positional mode"
    - "Exit-code canary: exit 2 when no files matched (catches accidental packages/ rename)"
    - "BASH_SOURCE[0]-based repo root resolution for CI-portable smoke scripts"

key-files:
  created:
    - scripts/lint-wrangler.mjs
    - scripts/smoke-install.sh
    - scripts/smoke-wrangler-dev.sh
    - tests/fixtures/good-wrangler.jsonc
    - tests/fixtures/bad-wrangler.jsonc
  modified: []

key-decisions:
  - "jsonc-parser over bash+jq: only option handling JSONC comments correctly, 40 LOC, runs identically in pre-commit and CI"
  - "tests/fixtures/ placement outside packages/: prevents production glob from picking up fixtures (spurious CI failures)"
  - "Exit-2 canary only in no-arg mode: positional-arg mode treats all errors as exit 1"

patterns-established:
  - "Pattern 8: FND-08 lint script dual-mode invocation (no-args glob vs positional-arg per-file)"
  - "Pattern: smoke scripts use BASH_SOURCE[0] to resolve repo root regardless of cwd"

requirements-completed: [FND-08]

duration: 3min
completed: 2026-05-25
---

# Phase 01 Plan 02: Lint + Smoke Scripts Summary

**FND-08 jsonc-parser lint script blocking new_classes DO regressions, plus two CI smoke scripts and positive/negative wrangler.jsonc test fixtures proving exit-code matrix end-to-end in Wave 1.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-25T18:46:54Z
- **Completed:** 2026-05-25T18:50:00Z
- **Tasks:** 3
- **Files created:** 5

## Accomplishments

- Delivered the FND-08 architectural integrity control: `scripts/lint-wrangler.mjs` uses jsonc-parser to reject any `wrangler.jsonc` declaring a Durable Object under `new_classes` (the irreversible KV-backed DO regression — Cloudflare workers-sdk #9909)
- Proved both exit paths end-to-end inside Wave 1 without requiring Wave 2 `packages/*/wrangler.jsonc` files: positional-arg invocation against good fixture exits 0, against bad fixture exits 1
- Created FND-01 and FND-03 smoke scripts (`smoke-install.sh`, `smoke-wrangler-dev.sh`) with strict mode and `BASH_SOURCE[0]`-based repo root resolution for CI portability

## Task Commits

1. **Task 1: Create scripts/lint-wrangler.mjs** - `5762475` (feat)
2. **Task 2: Create smoke scripts** - `6651973` (feat)
3. **Task 3: Create lint test fixtures and verify FND-08** - `bd4de87` (feat)

**Plan metadata:** (see final commit in completion message)

## Files Created/Modified

- `scripts/lint-wrangler.mjs` (89 lines) — FND-08 lint rule; dual-mode (no-arg glob vs positional); jsonc-parser JSONC comment handling; exit 0 clean / 1 violation / 2 no-arg empty glob canary
- `scripts/smoke-install.sh` (39 lines) — FND-01 fresh-clone install smoke; verifies `@engram/*` workspace symlinks exist post-install
- `scripts/smoke-wrangler-dev.sh` (49 lines) — FND-03 wrangler dev boot smoke; accepts config path arg (defaults to `packages/mcp-server/wrangler.jsonc`); 15s timeout; curl http://localhost:8787
- `tests/fixtures/good-wrangler.jsonc` (27 lines) — positive fixture; mirrors RESEARCH §Pattern 1 (mcp-server two-DO case); uses `new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`; includes JSONC comment to exercise parser
- `tests/fixtures/bad-wrangler.jsonc` (29 lines) — negative fixture; uses `new_classes: ["WorkspaceDO"]`; proves the lint rule triggers correctly

## Lint Script Verification Output

```
# No-arg full-scan (Wave 1 canary — no packages/*/wrangler.jsonc exist yet):
$ node scripts/lint-wrangler.mjs
[lint:wrangler] No wrangler.jsonc files found — did packages/ get renamed?
Exit code: 2  ✓ (canary behavior as designed)

# Good fixture (positive-path proof):
$ node scripts/lint-wrangler.mjs tests/fixtures/good-wrangler.jsonc
[lint:wrangler] OK — checked 1 file(s).
Exit code: 0  ✓

# Bad fixture (negative-path proof — FND-08 DO-1 protection):
$ node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc
[lint:wrangler] tests/fixtures/bad-wrangler.jsonc migration[0] (tag: v1) declares
new_classes=["WorkspaceDO"]. Engram requires SQLite-backed Durable Objects only — use new_sqlite_classes.
[lint:wrangler] FAIL — 1 violation(s) found.
Exit code: 1  ✓
```

## jsonc-parser Ad-Hoc Shape Check

Both fixtures parse with jsonc-parser without errors, and have the expected migration shapes:

- `good.migrations[0].new_sqlite_classes` is an array (correct): `true`
- `good.migrations[0].new_classes` is absent: `true`
- `bad.migrations[0].new_classes` is an array with length > 0: `true`

## Decisions Made

- Used `jsonc-parser` (Microsoft's official parser) over bash+jq: handles JSONC comments correctly, 40 LOC, runs identically in pre-commit and CI (per RESEARCH §Pattern 8)
- Test fixtures placed in `tests/fixtures/` (outside `packages/`): the production glob `packages/*/wrangler.jsonc` does not pick them up — prevents spurious CI failures
- Exit-2 canary applies only to no-arg full-scan mode: positional-arg mode treats all file access errors as exit 1 (no ambiguity when running against specific files)

## Deviations from Plan

None - plan executed exactly as written.

Note: `jsonc-parser` was temporarily installed via npm into the worktree (`node_modules/`) for Wave 1 verification of the lint script. This is untracked and will be superseded by the proper `package.json` + `devDependencies` from Plan 01-01 when all Wave 1 worktrees merge to main.

## Issues Encountered

`jsonc-parser` was not yet installed in the repo (Plan 01-01 in a parallel worktree owns `package.json`). Installed it temporarily via `npm install jsonc-parser --no-save` in the worktree for verification only. The `package.json` and `node_modules/` are left untracked (not committed) — they will be superseded by Plan 01-01's branch.

## Known Stubs

None — these are utility scripts, not data-driven UI components.

## Threat Flags

None — all STRIDE threats in the plan's threat register (T-01-06, T-01-07, T-01-08) are mitigated by the deliverables in this plan.

## Next Phase Readiness

- `scripts/lint-wrangler.mjs` is ready for Plan 05 (Wave 2) to run `npm run lint:wrangler` against real `packages/*/wrangler.jsonc` files in no-arg full-scan mode
- Plan 06 (Wave 3) can wire `npm run lint:wrangler` into CI and `lint-staged` using the patterns established here
- Smoke scripts are ready for Plan 06 to invoke after Worker packages exist in Wave 2+
- FND-08 integrity control is active: any future `wrangler.jsonc` with `new_classes` will trigger exit 1

---

## Self-Check: PASSED

All created files verified present:
- `scripts/lint-wrangler.mjs`: FOUND
- `scripts/smoke-install.sh`: FOUND
- `scripts/smoke-wrangler-dev.sh`: FOUND
- `tests/fixtures/good-wrangler.jsonc`: FOUND
- `tests/fixtures/bad-wrangler.jsonc`: FOUND

All task commits verified in git log:
- `5762475`: FOUND
- `6651973`: FOUND
- `bd4de87`: FOUND

---
*Phase: 01-foundation*
*Completed: 2026-05-25*
