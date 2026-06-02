# Phase 07 — Deferred Items

Out-of-scope discoveries logged during plan execution. Not fixed in this plan.

## Discovered during Plan 07-01

### 1. Pre-existing typecheck errors in `packages/triage-worker/`
- **Where:** `npm run typecheck` reports `error TS2688: Cannot find type definition file for './worker-configuration.d.ts'`.
- **Why deferred:** Plan 07-01 only modifies `package.json` `scripts` block + adds a `--help` banner line to `scripts/kv-bootstrap.mjs`. The TS2688 error is in the triage-worker package's tsconfig, unrelated to plan scope.
- **Suggested owner:** Phase 7 Plan 03 (deploy execution) — `npm run deploy` will run `predeploy` → `evals:ci` → `typecheck`. If the missing `worker-configuration.d.ts` is a Wrangler-generated file, `npm run types:gen` may resolve it; otherwise a separate gap-closure cycle.

### 2. Pre-existing ESLint errors in `packages/mcp-server/src/**`
- **Where:** `npm run lint` reports 34 problems (29 errors, 5 warnings) across:
  - `packages/mcp-server/src/ai-helper.ts`
  - `packages/mcp-server/src/oauth.ts`
  - `packages/mcp-server/src/tools.ts`
  - `packages/mcp-server/src/__tests__/*.ts` (multiple test files)
- **Sample:** `error @typescript-eslint/no-unsafe-argument` at `tools.ts:681:22`.
- **Why deferred:** None of these files are in Plan 07-01's scope. Plan 07-01 only touched root `package.json` `scripts` and `scripts/kv-bootstrap.mjs`.
- **Suggested owner:** A future cleanup pass or `npm run lint -- --fix` (the lint output noted "1 error and 5 warnings potentially fixable with the `--fix` option"). Not blocking Phase 7 deploy if the eval gate (vitest + promptfoo) does not gate on `lint`.
