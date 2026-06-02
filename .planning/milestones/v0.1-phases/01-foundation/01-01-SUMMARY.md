---
phase: 01-foundation
plan: "01"
subsystem: monorepo-root
tags: [scaffolding, monorepo, eslint, prettier, husky, typescript, license]
dependency_graph:
  requires: []
  provides:
    - root-package-json
    - tsconfig-base
    - eslint-flat-config
    - husky-pre-commit
    - license-apache2
  affects:
    - all-packages (every Wave 1+ package extends tsconfig.base.json and runs root ESLint)
tech_stack:
  added:
    - typescript@^5 (compiler for tsc --noEmit)
    - typescript-eslint@^8 (strictTypeChecked + stylisticTypeChecked flat config)
    - eslint@^9 (flat config era)
    - "@eslint/js@^9"
    - globals@^16
    - prettier@^3
    - husky@^9
    - lint-staged@^17
    - wrangler@^4.94.0
    - "@cloudflare/workers-types@^4.20260525.1"
    - jsonc-parser@^3
  patterns:
    - npm workspaces monorepo (packages/*, shared/*)
    - ESLint flat config with projectService
    - Husky v9 pre-commit hook (bare husky in prepare)
    - tsconfig.base.json + per-package extends pattern
    - moduleResolution bundler (load-bearing for exports field resolution)
key_files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.base.json
    - tsconfig.json
    - eslint.config.mjs
    - .prettierrc.json
    - .prettierignore
    - .lintstagedrc.json
    - .husky/pre-commit
    - .gitignore
    - .editorconfig
    - .nvmrc
    - .npmrc
    - LICENSE
  modified: []
decisions:
  - "D-01: ESLint + Prettier (not Biome) — root eslint.config.mjs + .prettierrc.json"
  - "D-02: typescript-eslint strictTypeChecked + stylisticTypeChecked (no Cloudflare preset exists in 2026)"
  - "D-04: Husky v9 + lint-staged, bare husky in prepare script (Pitfall 5)"
  - "D-06: @engram/* scope — workspaces packages/* and shared/*"
  - "D-08: tsconfig.base.json with strict, moduleResolution bundler, ES2022, Workers types"
  - "D-11: plain npm workspace scripts (no Turborepo, no Nx)"
  - "FND-06: Apache-2.0 LICENSE with v1.0 provisional confirmation header"
metrics:
  duration_seconds: 374
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_created: 14
  files_modified: 0
---

# Phase 1 Plan 01: Root Monorepo Scaffold Summary

**One-liner:** npm workspace monorepo root with TypeScript bundler-resolution config, ESLint flat-config strict rules, Husky v9 pre-commit pipeline, and Apache-2.0 LICENSE with provisional v1.0 confirmation header.

## What Was Built

Established the foundational 14-file root scaffold that all 7 phases will inherit. Every package created in Wave 1 (`shared/`) and Wave 2 (`packages/`) extends `tsconfig.base.json` and is governed by the root `eslint.config.mjs`.

### Files Created

| File                 | Purpose                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`       | Root workspace manifest — @engram/\* scope, all 11 devDeps, scripts (lint, typecheck, lint:wrangler, prepare, setup), lint-staged config |
| `package-lock.json`  | Reproducible install lockfile (179 packages, 0 vulnerabilities)                                                                          |
| `tsconfig.base.json` | Shared strict TS compiler options — moduleResolution bundler (load-bearing for exports field), ES2022, Workers types                     |
| `tsconfig.json`      | Root project references entry for `tsc -b --noEmit` — 5 package references                                                               |
| `eslint.config.mjs`  | Single root flat ESLint config — typescript-eslint strictTypeChecked + stylisticTypeChecked + Workers globals                            |
| `.prettierrc.json`   | Prettier defaults — semi, trailingComma all, printWidth 100                                                                              |
| `.prettierignore`    | Mirrors .gitignore essentials — excludes worker-configuration.d.ts                                                                       |
| `.lintstagedrc.json` | Explicit lint-staged config (mirrors package.json block) — wrangler.jsonc glob                                                           |
| `.husky/pre-commit`  | Executable hook body: `npx --no-install lint-staged` (no husky.sh, Pitfall 5)                                                            |
| `.gitignore`         | Blocks node_modules, .dev.vars, .dev.vars.\*, .wrangler/, dist/, worker-configuration.d.ts                                               |
| `.editorconfig`      | space/2, LF, UTF-8, final newline, md trailing-whitespace exception                                                                      |
| `.nvmrc`             | Node 22 LTS (matches engines.node >=22)                                                                                                  |
| `.npmrc`             | save-exact=false, engine-strict=true                                                                                                     |
| `LICENSE`            | Apache-2.0 (from apache.org/licenses/LICENSE-2.0.txt) with v1.0 confirmation header                                                      |

## Verification Results

All plan acceptance criteria passed:

- `node -e "JSON.parse(..."` validates all root JSON files (package.json, tsconfig.base.json, tsconfig.json)
- `npx eslint --print-config eslint.config.mjs > /dev/null` exits 0
- `.husky/pre-commit` is executable with body exactly `npx --no-install lint-staged`
- LICENSE first 5 lines contain `subject to final confirmation at v1.0`
- `.gitignore` contains all required security entries
- `npm install` completed: 179 packages, 0 vulnerabilities

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESLint config file flagged by its own type-aware rules**

- **Found during:** Task 3 (first commit attempt via pre-commit hook)
- **Issue:** `projectService: true` caused ESLint to analyze `eslint.config.mjs` itself under `allowDefaultProject`, which then triggered `no-unsafe-member-access`, `no-unsafe-argument`, and `no-deprecated` errors from the untyped `@eslint/js` and `globals` imports.
- **Fix:** Changed `projectService: true` to `projectService: { allowDefaultProject: ["*.mjs", "*.cjs"] }` AND added a `files: ["*.mjs", "*.cjs"]` config entry using `tseslint.configs.disableTypeChecked` to disable type-aware rules for root config files. This is the recommended pattern per typescript-eslint docs for bootstrapping files.
- **Files modified:** `eslint.config.mjs`
- **Commit:** included in `1ec7312`

**2. [Rule 1 - Bug] LICENSE header used "at the v1.0" but acceptance criterion checks for "at v1.0"**

- **Found during:** Task 3 verification
- **Issue:** RESEARCH §A3 exact wording says "at the v1.0 milestone" but the plan's `grep -q "subject to final confirmation at v1.0"` check doesn't match because "at v1.0" is not a substring of "at the v1.0".
- **Fix:** Removed "the" from the header: "subject to final confirmation at v1.0." This aligns with the plan's verification command and the spirit of the requirement (FND-06).
- **Files modified:** `LICENSE`
- **Commit:** `1ec7312`

**3. [Note] lint-staged@17.0.5 engine warning on Node 22.14.0**

- **Issue:** `lint-staged@17.0.5` requires `node >=22.22.1` but environment has `v22.14.0`. The install emits `npm warn EBADENGINE` but succeeds (exit 0). lint-staged functions correctly at runtime — the engine constraint is conservative metadata, not a runtime incompatibility.
- **Action:** No code change. Documented as a warning. When the environment upgrades to Node 22.22.1+ (or when `lint-staged@^16` would be pinned), this resolves. The RESEARCH §Standard Stack specified `lint-staged@^17.0.5`.
- **Impact:** None on pre-commit functionality. The Husky pre-commit hook ran successfully in the Task 3 commit.

## Husky Activation Confirmation

`.husky/_/` directory exists and contains 17 hook scripts (Husky v9 init artifact created by `prepare` script running during `npm install`). The pre-commit hook ran successfully during the Task 3 commit, validating that lint-staged executes ESLint and Prettier on staged files.

## npm install Summary

- **Packages added:** 179
- **Audit:** 0 vulnerabilities
- **Warnings:** 1 engine warning (lint-staged@17 / Node 22.14.0 — non-blocking)
- **All devDeps from RESEARCH §Standard Stack** resolved to expected versions

## Threat Surface Scan

No new security surface introduced in this plan. All files are static configuration — no network endpoints, no auth paths, no file access patterns, no schema changes.

- `.dev.vars` and `.dev.vars.*` excluded from git from first commit (T-01-04 mitigation)
- `prepare` script uses bare `husky` not `husky install` (T-01-05 mitigation)
- All 11 devDeps verified in RESEARCH Package Legitimacy Audit — all `[OK]` (T-01-SC mitigation)

## Self-Check

Files created:

- [x] `package.json` — FOUND
- [x] `package-lock.json` — FOUND
- [x] `tsconfig.base.json` — FOUND
- [x] `tsconfig.json` — FOUND
- [x] `eslint.config.mjs` — FOUND
- [x] `.prettierrc.json` — FOUND
- [x] `.prettierignore` — FOUND
- [x] `.lintstagedrc.json` — FOUND
- [x] `.husky/pre-commit` — FOUND
- [x] `.gitignore` — FOUND
- [x] `.editorconfig` — FOUND
- [x] `.nvmrc` — FOUND
- [x] `.npmrc` — FOUND
- [x] `LICENSE` — FOUND

Commits:

- [x] `7200184` — chore(01-01): create root package.json
- [x] `33a78cd` — chore(01-01): create tsconfig.base.json + root tsconfig.json
- [x] `1ec7312` — chore(01-01): create ESLint, Prettier, Husky, dotfiles, and LICENSE
