---
phase: 01-foundation
reviewed: 2026-05-25T00:00:00Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - .editorconfig
  - .github/workflows/ci.yml
  - .gitignore
  - .husky/pre-commit
  - .lintstagedrc.json
  - .npmrc
  - .nvmrc
  - .prettierignore
  - .prettierrc.json
  - CLAUDE.md
  - CONTRIBUTING.md
  - docs/architecture.svg
  - eslint.config.mjs
  - LICENSE
  - package.json
  - packages/mcp-server/package.json
  - packages/mcp-server/src/index.ts
  - packages/mcp-server/tsconfig.json
  - packages/mcp-server/wrangler.jsonc
  - packages/triage-worker/package.json
  - packages/triage-worker/src/index.ts
  - packages/triage-worker/tsconfig.json
  - packages/triage-worker/wrangler.jsonc
  - packages/workspace-do/package.json
  - packages/workspace-do/src/index.ts
  - packages/workspace-do/tsconfig.json
  - README.md
  - scripts/lint-wrangler.mjs
  - scripts/smoke-install.sh
  - scripts/smoke-wrangler-dev.sh
  - shared/schema/package.json
  - shared/schema/src/index.ts
  - shared/schema/src/system-types.ts
  - shared/schema/tsconfig.json
  - shared/types/package.json
  - shared/types/src/index.ts
  - shared/types/tsconfig.json
  - tests/fixtures/bad-wrangler.jsonc
  - tests/fixtures/good-wrangler.jsonc
  - tsconfig.base.json
  - tsconfig.json
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-25
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

The Phase 1 foundation scaffold is genuinely solid: strict-mode TypeScript, a flat ESLint config with type-aware rules, FND-08's `lint-wrangler.mjs` correctly blocks the `new_classes` regression, the v0.1 type surface in `@engram/types` matches the CLAUDE.md contract, and the SYSTEM_TYPES array matches the 7 system types verbatim. I exercised the wrangler linter against both fixtures and the production glob, and behavior is correct on all three paths (good=exit 0, bad=exit 1, missing-file=exit 1).

That said, there are real issues that should be addressed before Phase 2 builds on this substrate. The single Critical is a hard dependency resolution risk in `mcp-server`: `@modelcontextprotocol/sdk` is imported directly but is only present as a *transitive* dependency of `agents`. Any change to `agents`' dependency tree (a patch release dropping or re-versioning the SDK, npm hoisting changes, or a future `npm install --strict-peer-deps`) silently breaks the Worker. The Warnings cluster around three themes: CI/script fragility (experimental `node:fs/promises` glob, GNU `timeout` not on macOS, fragile sleep-then-curl), documentation drift (README claims port 8788 for triage but nothing configures it), and configuration duplication (lint-staged config exists in both `package.json` and `.lintstagedrc.json`).

No security issues were found. No hardcoded secrets, no shell injection in scripts, no unsafe deserialization in `lint-wrangler.mjs`.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `@modelcontextprotocol/sdk` is imported directly but declared only transitively

**File:** `packages/mcp-server/package.json:11-16` and `packages/mcp-server/src/index.ts:4`
**Issue:** `src/index.ts` imports from `@modelcontextprotocol/sdk/server/mcp.js`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
```
but `packages/mcp-server/package.json` lists only `agents`, `@engram/types`, `@engram/schema`, `@engram/workspace-do` as dependencies. `npm ls @modelcontextprotocol/sdk` confirms the SDK resolves via `agents@0.13.2 → @modelcontextprotocol/sdk@1.29.0` — a transitive dep. This works today only because npm v7+ hoists, but:
1. Any patch release of `agents` that drops, narrows, or re-versions the SDK silently breaks the import (deep-import paths are not part of `agents`' public API).
2. `npm install --strict-peer-deps` and pnpm install (no hoisting) would break it immediately.
3. Phase 3 will register tools against `McpServer` — taking a hard dep on a transitive package is the worst possible time to discover this regression.

**Fix:** Declare the SDK as an explicit dependency in `packages/mcp-server/package.json`:
```json
"dependencies": {
  "agents": "^0.13.2",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@engram/types": "*",
  "@engram/schema": "*",
  "@engram/workspace-do": "*"
}
```
Pin the major version to whatever `agents` carries today so they stay in lockstep until `agents` re-exports `McpServer` itself (which is the cleaner long-term answer — open an upstream issue).

## Warnings

### WR-01: `node:fs/promises` glob is experimental in Node 22 and prints a runtime warning

**File:** `scripts/lint-wrangler.mjs:16`
**Issue:** `import { glob } from "node:fs/promises"` is an **experimental** API in Node 22 (the version pinned in `.nvmrc`). Every CI run prints:
```
(node:NNNN) ExperimentalWarning: glob is an experimental feature and might change at any time
```
This pollutes CI logs, weakens "green CI = clean" as a signal, and the API surface is not API-stable until Node 24+. If a future Node patch tightens experimental gating, the FND-08 lint script breaks silently.

**Fix:** Either suppress the warning explicitly or use a stable alternative. Two options:
```js
// Option A: suppress just the glob warning
process.removeAllListeners("warning"); // crude
// or NODE_NO_WARNINGS=1 in CI step (loses signal for other warnings)

// Option B: use a stable glob — `fast-glob` is small, sync-capable, no warning
import fg from "fast-glob";
const files = await fg("packages/*/wrangler.jsonc");
```
Option B is preferred — adds one devDep but removes a real CI-noise / future-break vector.

### WR-02: `scripts/smoke-wrangler-dev.sh` requires GNU `timeout`, which is absent on macOS by default

**File:** `scripts/smoke-wrangler-dev.sh:29`
**Issue:** `timeout 15 npx wrangler dev …` uses GNU coreutils' `timeout` command. macOS does not ship it — developers running `bash scripts/smoke-wrangler-dev.sh` locally will get `timeout: command not found` unless they have `brew install coreutils` and `gtimeout`-aliased it. CI on `ubuntu-latest` works, but the script is documented as runnable locally (smoke-* prefix), and `CONTRIBUTING.md` does not call out a brew dep. Silent local failure for first-time contributors on macOS.

**Fix:** Replace with a portable timeout-and-kill pattern, or detect and use `gtimeout` if present:
```bash
# Portable: trap-based kill in background
(npx wrangler dev --config "${CONFIG}" --port 8787) &
WRANGLER_PID=$!
trap 'kill $WRANGLER_PID 2>/dev/null || true' EXIT
sleep 8
# ... curl check ...
```
Or guard with: `if ! command -v timeout >/dev/null; then alias timeout=gtimeout; fi`.

### WR-03: Fragile fixed 8-second sleep before HTTP probe in smoke test

**File:** `scripts/smoke-wrangler-dev.sh:33`
**Issue:** `sleep 8` then a single `curl -sf` is brittle. On a cold-cache CI runner or slower network, wrangler dev may not be ready in 8 s — yielding a false-negative CI failure that everyone treats as flaky and re-runs (eroding the signal). On a fast runner, 8 s is wasted CI minutes per worker per push.

**Fix:** Poll until ready or timeout:
```bash
DEADLINE=$((SECONDS + 30))
until curl -sf http://localhost:8787 >/dev/null 2>&1; do
  if [[ $SECONDS -ge $DEADLINE ]]; then
    echo "[smoke:wrangler-dev] FAIL — timed out after 30s waiting for Worker."
    RESULT=1
    break
  fi
  sleep 1
done
[[ $SECONDS -lt $DEADLINE ]] && RESULT=0
```

### WR-04: README documents port 8788 for triage worker but no config sets it

**File:** `README.md:127` (cross-reference: `packages/triage-worker/wrangler.jsonc`, `packages/triage-worker/package.json:7`)
**Issue:** README says:
```
npm run dev:triage    # engram-triage-worker on http://localhost:8788
```
But `packages/triage-worker/wrangler.jsonc` declares no `dev.port`, and `package.json` runs plain `wrangler dev` — which defaults to **8787**. Running `npm run dev:mcp` and `npm run dev:triage` in parallel will conflict on 8787, and the documented URL `localhost:8788` returns connection-refused. First-time contributor will hit confusion.

**Fix:** Either update the README to match reality (drop port claim, or both 8787) or configure the triage worker to actually bind 8788. The latter aligns with the README and is one-line in `wrangler.jsonc`:
```jsonc
{
  "name": "engram-triage-worker",
  // ...
  "dev": { "port": 8788 },
}
```

### WR-05: `lint-staged` config is declared in two places (drift risk)

**File:** `package.json:39-50` and `.lintstagedrc.json`
**Issue:** lint-staged is configured at both `package.json#lint-staged` (lines 39-50) and `.lintstagedrc.json`. Both define rules for the same file patterns. Per lint-staged docs, the dedicated config file wins, so the `package.json` block is dead config — but a future maintainer editing one and not the other will create silent drift. Today the two are identical; the bug surface opens the first time someone changes only one.

**Fix:** Pick one canonical location. Recommendation: keep `.lintstagedrc.json` (modern convention, format-checked by Prettier) and delete the `lint-staged` key from `package.json` lines 39-50.

### WR-06: `EngramMcp` is declared in `new_sqlite_classes` but is never persisted in Phase 1

**File:** `packages/mcp-server/wrangler.jsonc:19-24`
**Issue:** The v1 migration declares:
```jsonc
"new_sqlite_classes": ["EngramMcp", "WorkspaceDO"]
```
This is correct in shape (FND-08 lint passes), but `EngramMcp` in `src/index.ts` is currently a stub — `server = new McpServer(...)` and `async init() { /* no-op */ }`. Once Phase 1 deploys (even just `wrangler dev`), the migration `v1` is *committed* at the local persistence layer. Phase 3 will probably want to delete `EngramMcp` from `new_sqlite_classes` if it turns out `McpAgent`'s persistence is handled differently — but DO migrations are append-only. Removing a class from `new_sqlite_classes` requires `deleted_classes` in a later migration tag. This is a soft-locked decision being made under stub conditions.

**Fix:** Either (a) defer the migration to Phase 3 when `EngramMcp`'s persistence semantics are real, by leaving the `migrations` array empty in Phase 1 — the binding still resolves at `wrangler dev`, but no migration commits; or (b) document explicitly in `01-CONTEXT.md` and `CLAUDE.md §Key Decisions Log` that `v1` is locked-in and Phase 3 cannot remove `EngramMcp` from SQLite-backed DOs without a `v2` migration with `deleted_classes`. The current state is neither — it's a silent commitment.

### WR-07: `lint-wrangler.mjs` silently ignores fixture files outside `packages/`

**File:** `scripts/lint-wrangler.mjs:36`
**Issue:** The full-scan glob is `packages/*/wrangler.jsonc` — it does NOT cover `tests/fixtures/*.jsonc`. This is intentional (the fixtures are deliberately excluded so CI doesn't fail on the bad one), but it also means the negative test (`bad-wrangler.jsonc` must fail) is not automated by `npm run lint:wrangler`. A regression where the linter stops detecting `new_classes` will not be caught by CI — only by someone manually running `node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc` and verifying exit code 1.

**Fix:** Add an explicit CI step that asserts the negative fixture fails:
```yaml
- name: Lint wrangler (negative fixture assertion)
  run: |
    if node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc; then
      echo "FND-08 regression: bad fixture did not trigger lint failure"
      exit 1
    fi
- name: Lint wrangler (positive fixture assertion)
  run: node scripts/lint-wrangler.mjs tests/fixtures/good-wrangler.jsonc
```

## Info

### IN-01: `lint-wrangler.mjs` catches `err` typed as `unknown` and reads `.message` without guard

**File:** `scripts/lint-wrangler.mjs:54`
**Issue:**
```js
} catch (err) {
  console.error(`[lint:wrangler] ${file} — could not read file: ${err.message}`);
```
In a `.mjs` file under TypeScript's ESLint type-checked rules, `err` is `unknown`. Accessing `.message` is unsafe — if a non-Error throws (e.g., `throw "broke"`), this becomes `undefined` interpolated as `"undefined"`. The eslint config does `disableTypeChecked` for `scripts/**/*.mjs` so the rule doesn't fire, but the underlying fragility persists.

**Fix:**
```js
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[lint:wrangler] ${file} — could not read file: ${msg}`);
```

### IN-02: README has stale TODO at the top of the file

**File:** `README.md:1`
**Issue:** First line of README is `<!-- TODO: confirm owner after first push -->`. Portfolio-quality README has a TODO marker in the rendered output (HTML comments still show as raw text in some renderers and grep noise).

**Fix:** Delete the line or move to an internal-only doc. The repo already has a confirmed owner (`russellkmoore` in the badge URL on line 4).

### IN-03: `WorkspaceDO` is declared in `mcp-server/wrangler.jsonc` migrations but lives in a separate package

**File:** `packages/mcp-server/wrangler.jsonc:22` (cross-reference: `packages/workspace-do/src/index.ts`)
**Issue:** The migration says `"new_sqlite_classes": ["EngramMcp", "WorkspaceDO"]` and the worker re-exports it via `export { WorkspaceDO } from "@engram/workspace-do"`. This works because wrangler bundles the re-export into the entry script. Worth a one-line comment in `wrangler.jsonc` near the migration noting that the class is sourced from `@engram/workspace-do` so future readers don't grep `packages/mcp-server/src` looking for the class definition.

**Fix:** Add a comment line next to the migration entry:
```jsonc
"migrations": [
  {
    "tag": "v1",
    // WorkspaceDO is re-exported from @engram/workspace-do — see src/index.ts:30
    "new_sqlite_classes": ["EngramMcp", "WorkspaceDO"],
  },
],
```

### IN-04: `MemoryEvent.context?` typed as `Record<string, unknown>` instead of CLAUDE.md's `object`

**File:** `shared/types/src/index.ts:39`
**Issue:** CLAUDE.md `MemoryEvent` spec says `context?: object`. The implementation uses `Record<string, unknown>` and documents the rationale (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` strictness). This is the *correct* call — `object` in TS includes functions, arrays, and any non-primitive, while `Record<string, unknown>` is the actual intent. The deviation is intentional and well-documented. Mentioned here only so it doesn't surface as an "unaligned with CLAUDE.md" finding in a future review pass.

**Fix:** No action — consider adding a one-line note in CLAUDE.md §MemoryEvent that the impl uses `Record<string, unknown>` and why.

### IN-05: `smoke-install.sh` uses `ls -d` and `xargs -I {} basename {}` instead of bash builtins

**File:** `scripts/smoke-install.sh:30`
**Issue:** Lines 29-32 use `ls` parsing, which `shellcheck` (SC2012) flags as fragile. The script works because `@engram/*` names are well-behaved (no spaces, no newlines), but the pattern is non-idiomatic for portfolio-quality bash:
```bash
if ls -d node_modules/@engram/* >/dev/null 2>&1; then
  ENGRAM_PKGS=$(ls -d node_modules/@engram/* | xargs -I {} basename {})
  echo "${ENGRAM_PKGS}" | while IFS= read -r pkg; do echo "  @engram/${pkg}"; done
```

**Fix:** Use globbing and bash arrays:
```bash
shopt -s nullglob
pkgs=(node_modules/@engram/*/)
if (( ${#pkgs[@]} > 0 )); then
  echo "[smoke:install] PASS — @engram/* symlinks found:"
  for pkg in "${pkgs[@]}"; do echo "  @engram/$(basename "$pkg")"; done
  exit 0
fi
```

### IN-06: `CONTRIBUTING.md` is 11 lines — barely a stub

**File:** `CONTRIBUTING.md`
**Issue:** For an open-source project targeting v1.0 public launch, `CONTRIBUTING.md` containing only the GSD plugin install instructions is insufficient. No discussion of commit message style, branching, PR review expectations, code-of-conduct link, or how to run the test suite. Acceptable as a v0.1 stub but worth tracking as future work.

**Fix:** No action for Phase 1 — flag as a v0.4 / pre-launch task. Add a minimum sections checklist: Setup, Development workflow (`/gsd:` commands), Testing, PR conventions, Code of Conduct link.

---

_Reviewed: 2026-05-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
