---
phase: 01-foundation
fixed_at: 2026-05-25T20:08:00Z
review_path: .planning/phases/01-foundation/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-05-25
**Source review:** `.planning/phases/01-foundation/01-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 8 (1 Critical + 7 Warning; 6 Info deferred per scope)
- Fixed: 8
- Skipped: 0
- Status: `all_fixed`

All in-scope findings were fixed and committed atomically on
`gsd-reviewfix/01-23666`. The cleanup tail fast-forwards `main` to capture
these commits.

## Fixed Issues

### CR-01: `@modelcontextprotocol/sdk` imported directly but only transitively declared

**Files modified:** `packages/mcp-server/package.json`, `package-lock.json`
**Commit:** `1a7cd05`
**Applied fix:** Added `"@modelcontextprotocol/sdk": "^1.29.0"` to `packages/mcp-server/package.json#dependencies` (pinned to the version `agents@0.13.2` currently carries). Re-ran `npm install` to update `package-lock.json`. After: `npm ls @modelcontextprotocol/sdk` shows the SDK as an explicit (deduped) top-level dep of `@engram/mcp-server`, and `npm run typecheck` passes. The Worker is now robust against future `agents` patch releases that re-version or drop the SDK transitively, and against pnpm / `npm install --strict-peer-deps`.

### WR-01: `node:fs/promises` glob is experimental in Node 22 (CI warning)

**Files modified:** `scripts/lint-wrangler.mjs`, `package.json`, `package-lock.json`
**Commit:** `478bd6b`
**Applied fix:** Replaced `import { glob } from "node:fs/promises"` with `import fg from "fast-glob"` (Option B from the review — preferred over `process.removeAllListeners("warning")`). Added `fast-glob@^3.3.3` as a devDep. Lint behavior preserved on all three paths: full-scan (exit 0, 2 files), positive fixture (exit 0), negative fixture (exit 1). No more `(node:NNNN) ExperimentalWarning: glob is an experimental feature` in CI logs.

### WR-02: `scripts/smoke-wrangler-dev.sh` requires GNU `timeout` (absent on macOS)

**Files modified:** `scripts/smoke-wrangler-dev.sh`
**Commit:** `072b7af` (combined with WR-03 since both touch the same script)
**Applied fix:** Removed the `timeout 15 npx wrangler dev …` invocation and replaced with a trap-based kill of the background `WRANGLER_PID` in an `EXIT` trap. The script is now portable across stock macOS and Linux CI without `brew install coreutils`. Verified with `bash -n` (syntax) and a live smoke run against `packages/mcp-server/wrangler.jsonc` — Worker booted, responded `200`, and the script cleaned up the background process correctly.

### WR-03: Fragile fixed 8-second sleep before HTTP probe in smoke test

**Files modified:** `scripts/smoke-wrangler-dev.sh`
**Commit:** `072b7af` (combined with WR-02)
**Applied fix:** Replaced `sleep 8 && curl -sf …` with a poll loop bounded by a 30 s deadline:

```bash
DEADLINE=$((SECONDS + 30))
RESULT=1
while (( SECONDS < DEADLINE )); do
  if curl -sf "http://localhost:${PORT}" >/dev/null 2>&1; then RESULT=0; break; fi
  sleep 1
done
```

Fast runners exit as soon as wrangler is ready (~1-2 s); cold-cache runners get a real 30 s window. Also added an optional second CLI arg for the port (defaulting to `8787`) so future per-worker port configuration flows through cleanly — used immediately by the WR-04 commit to point the triage smoke at `8788`.

### WR-04: README documents port 8788 for triage-worker but no config sets it

**Files modified:** `packages/triage-worker/wrangler.jsonc`, `.github/workflows/ci.yml`
**Commit:** `31bdbc0`
**Applied fix:** Added `"dev": { "port": 8788 }` to `packages/triage-worker/wrangler.jsonc` so `npm run dev:triage` actually binds the documented port. Also updated the CI `Smoke - wrangler dev (triage-worker)` step to pass `8788` as the second arg to `scripts/smoke-wrangler-dev.sh` so the curl probe targets the correct port. `npm run dev:mcp` (default 8787) and `npm run dev:triage` (8788) can now run in parallel without colliding, matching what the README claims. FND-08 lint still passes on the updated `wrangler.jsonc`.

### WR-05: `lint-staged` config declared in two places (drift risk)

**Files modified:** `package.json`
**Commit:** `d91362b`
**Applied fix:** Removed the `lint-staged` key (lines 39-50) from `package.json`. `.lintstagedrc.json` is now the canonical single source of truth — modern convention, Prettier-formatted, and is the one lint-staged itself prefers when both exist. Verified `package.json` is still valid JSON after the edit, and `.lintstagedrc.json` content was preserved.

### WR-06: `EngramMcp` declared in v1 `new_sqlite_classes` while still a stub

**Files modified:** `packages/mcp-server/wrangler.jsonc`
**Commit:** `cc0fed2`
**Applied fix:** Removed `"EngramMcp"` from `migrations[0].new_sqlite_classes`, leaving only `"WorkspaceDO"` in v1. Added an inline `//` comment in the jsonc explaining (a) that `WorkspaceDO` is sourced from `@engram/workspace-do` via re-export (closes IN-03 incidentally) and (b) that `EngramMcp` is deferred to a v2 migration in Phase 3 because DO migrations are append-only and locking-in a SQLite backing-store decision under stub conditions removes the rollback path.

Verified the binding still resolves: `bash scripts/smoke-wrangler-dev.sh packages/mcp-server/wrangler.jsonc` boots cleanly with both `env.MCP_OBJECT (EngramMcp)` and `env.WORKSPACE (WorkspaceDO)` shown as Durable Object bindings in `local` mode, and the Worker responds `200` with the expected pong body (`{"ok":true,"worker":"engram-mcp-server","phase":1,"systemTypesCount":7}`). Phase 3 will add `{"tag":"v2","new_sqlite_classes":["EngramMcp"]}` once `McpAgent` persistence semantics are real.

### WR-07: `lint-wrangler.mjs` silently ignores fixture files (negative test not automated)

**Files modified:** `.github/workflows/ci.yml`
**Commit:** `3cf1e1b`
**Applied fix:** Added two CI steps after the existing `Lint wrangler.jsonc (FND-08)` step:

1. **Negative-fixture assertion:** runs `node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc` and inverts the exit code. If the linter regresses and stops catching `new_classes`, CI now fails with `FND-08 regression: bad fixture did not trigger lint failure`.
2. **Positive-fixture assertion:** runs `node scripts/lint-wrangler.mjs tests/fixtures/good-wrangler.jsonc` and expects exit 0.

YAML validated with Python's `yaml.safe_load`. This locks in FND-08's enforcement contract — Cloudflare workers-sdk #9909's irreversibility is now defended by CI on every push.

## Skipped Issues

None — all 8 in-scope findings were fixed.

## Out-of-Scope (Info) — Not Attempted

Per `fix_scope: critical_warning`, the 6 Info findings (IN-01 through IN-06) were not addressed in this iteration. Notes:

- **IN-03** was *incidentally* satisfied by the WR-06 fix — the new comment in `mcp-server/wrangler.jsonc` mentions that `WorkspaceDO` is sourced from `@engram/workspace-do`.
- **IN-01, IN-02, IN-05** are small mechanical fixes appropriate for a follow-up `--fix all` pass.
- **IN-04, IN-06** are deliberate non-actions per the reviewer's own recommendation (intentional deviation; pre-launch task respectively).

---

_Fixed: 2026-05-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
