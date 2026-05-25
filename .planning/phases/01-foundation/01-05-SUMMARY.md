---
phase: 01-foundation
plan: "05"
subsystem: worker-packages
tags:
  [
    worker-packages,
    wrangler,
    mcp-server,
    triage-worker,
    workspace-do,
    smoke-test,
    FND-02,
    FND-03,
    FND-08,
  ]
dependency_graph:
  requires:
    - root-package-json (01-01)
    - tsconfig-base (01-01)
    - eslint-flat-config (01-01)
    - engram-types-package (01-04)
    - engram-schema-package (01-04)
  provides:
    - engram-mcp-server-package
    - engram-triage-worker-package
    - engram-workspace-do-package
    - two-do-wrangler-config
    - fnd-08-positive-proof
    - fnd-03-smoke-verified
  affects:
    - packages/mcp-server (Phase 3 fills EngramMcp tools, Phase 3 replaces fetch handler)
    - packages/workspace-do (Phase 2 fills SQLite schema + queries)
    - packages/triage-worker (Phase 5/6 wires Queue bindings + CF AI)
tech_stack:
  added:
    - agents@0.13.2 (Cloudflare Agents SDK — McpAgent base class for mcp-server)
  patterns:
    - Pattern 1: two-DO topology in single wrangler.jsonc (EngramMcp + WorkspaceDO under new_sqlite_classes)
    - Pattern 2: minimal triage-worker wrangler.jsonc (no DO bindings)
    - Pattern 3: no-op Worker handler (FND-03 smoke)
    - Pattern 4: workspace package TS-source exports (D-07 consumer proof)
    - McpAgent abstract class implementation (stub server + init() for Phase 1)
key_files:
  created:
    - packages/workspace-do/package.json
    - packages/workspace-do/tsconfig.json
    - packages/workspace-do/src/index.ts
    - packages/mcp-server/wrangler.jsonc
    - packages/mcp-server/package.json
    - packages/mcp-server/tsconfig.json
    - packages/mcp-server/src/index.ts
    - packages/triage-worker/wrangler.jsonc
    - packages/triage-worker/package.json
    - packages/triage-worker/tsconfig.json
    - packages/triage-worker/src/index.ts
  modified:
    - .gitignore (added **/*.tsbuildinfo)
    - package-lock.json (agents@0.13.2 added)
decisions:
  - "D-10 enforced: @engram/workspace-do has no wrangler.jsonc; WorkspaceDO declared in mcp-server's wrangler.jsonc"
  - "DO-1 enforced: both mcp-server DO classes declared under new_sqlite_classes (not new_classes)"
  - "McpAgent abstract methods implemented as Phase 1 stubs: server = new McpServer({...}), async init() {}"
  - "fetch() handlers changed from async to sync (no await needed) to satisfy @typescript-eslint/require-await"
  - "DurableObject base import from cloudflare:workers used in WorkspaceDO (smoke confirmed it works)"
metrics:
  duration_seconds: 500
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_created: 11
  files_modified: 2
---

# Phase 1 Plan 05: Worker Packages Scaffold Summary

**One-liner:** Three Wave-3 packages scaffolded (@engram/mcp-server, @engram/triage-worker, @engram/workspace-do) with two-DO wrangler topology, cross-package type imports verified end-to-end, and FND-03 wrangler dev smoke tests passing with systemTypesCount=7.

## What Was Built

Completed the Wave-3 package scaffold, establishing the full 5-package v0.1 set alongside shared packages from Plan 04.

### Files Created

| File                                    | Purpose                                        | Key Contents                                                                          |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/workspace-do/package.json`    | Library-only package (D-10: no wrangler.jsonc) | `@engram/workspace-do`, TS-source exports field, no scripts                           |
| `packages/workspace-do/tsconfig.json`   | Per-package tsconfig                           | Extends `tsconfig.base.json`, library shape                                           |
| `packages/workspace-do/src/index.ts`    | WorkspaceDO class stub                         | `extends DurableObject` from `cloudflare:workers`; Phase 2 fills body                 |
| `packages/mcp-server/wrangler.jsonc`    | Two-DO Worker config (DO-1, FND-02)            | Both `EngramMcp` and `WorkspaceDO` under `new_sqlite_classes` in one migration entry  |
| `packages/mcp-server/package.json`      | mcp-server package manifest                    | `agents@^0.13.2`, `@engram/types/*`, `@engram/schema/*`, `@engram/workspace-do/*`     |
| `packages/mcp-server/tsconfig.json`     | mcp-server tsconfig                            | Extends base, includes `@cloudflare/workers-types/experimental` + generated env types |
| `packages/mcp-server/src/index.ts`      | Phase 1 placeholder Worker handler             | Imports 5 v0.1 types + SYSTEM_TYPES, stub EngramMcp + WorkspaceDO re-export           |
| `packages/triage-worker/wrangler.jsonc` | Minimal Worker config (no DO bindings)         | `compatibility_date 2026-05-22`, `nodejs_compat` only                                 |
| `packages/triage-worker/package.json`   | triage-worker package manifest                 | `@engram/types/*`, `@engram/schema/*` (no agents, no workspace-do)                    |
| `packages/triage-worker/tsconfig.json`  | triage-worker tsconfig                         | Mirrors mcp-server tsconfig shape                                                     |
| `packages/triage-worker/src/index.ts`   | Phase 1 no-op handler                          | Returns `{ ok, worker: "engram-triage-worker", phase: 1 }`                            |

### Two-DO Topology (Pattern 1)

`packages/mcp-server/wrangler.jsonc` declares both DO classes in a single migration entry:

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "MCP_OBJECT", "class_name": "EngramMcp" },
    { "name": "WORKSPACE",  "class_name": "WorkspaceDO" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["EngramMcp", "WorkspaceDO"] }
]
```

`wrangler types` confirmed the generated `worker-configuration.d.ts` includes both `MCP_OBJECT` and `WORKSPACE` bindings.

### FND-03 Smoke Test Results

**mcp-server smoke:**

```
Response: {"ok":true,"worker":"engram-mcp-server","phase":1,"systemTypesCount":7}
```

`systemTypesCount: 7` proves the full import chain `mcp-server → @engram/schema → system-types.ts` resolves correctly — FND-04 + FND-05 + D-07 in one shot.

**triage-worker smoke:**

```
Response: {"ok":true,"worker":"engram-triage-worker","phase":1}
```

Both Workers boot under `wrangler dev` within 8 seconds and return HTTP 200.

Note: macOS does not have GNU `timeout`; the smoke script's `timeout 15 npx wrangler dev` failed silently. The smokes were verified by running wrangler dev manually in background with `kill $PID` cleanup. The FND-03 end-to-end proof is identical — `curl http://localhost:8787` returns the expected JSON.

### FND-08 Verification

All three invocation modes verified:

| Invocation                                                                                                | Exit Code | Output                                                              |
| --------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `node scripts/lint-wrangler.mjs packages/mcp-server/wrangler.jsonc packages/triage-worker/wrangler.jsonc` | 0         | `OK — checked 2 file(s).`                                           |
| `node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc`                                        | 1         | `declares new_classes=["WorkspaceDO"]. ... use new_sqlite_classes.` |
| `npm run lint:wrangler` (no-arg, production mode)                                                         | 0         | `OK — checked 2 file(s).`                                           |

Cross-plan W-02 contract closed: Plan 02's dual-mode script is exercised by Plan 05 against both real Worker configs AND the bad fixture.

### agents Version Confirmation

```
npm ls agents
└─┬ @engram/mcp-server@0.1.0 -> ./packages/mcp-server
  └── agents@0.13.2
```

`agents@0.13.2` installed — within the `^0.13.2` constraint.

### Workspace Symlinks Confirmed

```
node_modules/@engram/
  mcp-server -> ../../packages/mcp-server
  schema     -> ../../shared/schema
  triage-worker -> ../../packages/triage-worker
  types      -> ../../shared/types
  workspace-do -> ../../packages/workspace-do
```

All 5 v0.1 packages accessible via `@engram/*` scope.

### worker-configuration.d.ts Gitignore Confirmation

Both `packages/mcp-server/worker-configuration.d.ts` and `packages/triage-worker/worker-configuration.d.ts` are excluded by `.gitignore` rule `**/worker-configuration.d.ts`. They do not appear in `git status`. Generated on demand via `wrangler types` or `npm run types:gen`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] McpAgent abstract methods require implementation**

- **Found during:** Task 2 (`npm run typecheck` after writing mcp-server/src/index.ts)
- **Issue:** `McpAgent` is declared as `abstract class` with two abstract members: `server: MaybePromise<McpServer | Server>` and `init(): Promise<void>`. The plan's `export class EngramMcp extends McpAgent {}` (empty body) fails with TS2654 "Non-abstract class is missing implementations."
- **Fix:** Added minimal stub implementations:
  - `server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" })` — creates a bare McpServer instance that satisfies the property type
  - `async init(): Promise<void> {}` — empty no-op satisfying the abstract method contract
  - Added `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"` (already installed transitively via `agents`)
- **Phase 3 note:** Both will be replaced with real tool registration when the MCP server is wired up.
- **Files modified:** `packages/mcp-server/src/index.ts`
- **Commit:** `805c55c`

**2. [Rule 1 - Bug] ESLint require-await and no-unused-vars on Worker handlers**

- **Found during:** Task 2 ESLint run
- **Issue:** `async fetch(_req: Request)` triggered two errors:
  - `@typescript-eslint/require-await`: async method with no await expression
  - `@typescript-eslint/no-unused-vars`: `_req` parameter unused
- **Fix:** Changed `async fetch(_req: Request): Promise<Response>` to `fetch(): Response` in both mcp-server and triage-worker. The Workers runtime accepts synchronous fetch handlers returning `Response` directly (not just `Promise<Response>`). The `_req` parameter was removed since neither no-op handler reads it.
- **Files modified:** `packages/mcp-server/src/index.ts`, `packages/triage-worker/src/index.ts`
- **Commit:** `805c55c` (mcp-server), `155d2d1` (triage-worker)

**3. [Rule 2 - Missing gitignore] TypeScript tsbuildinfo files not excluded**

- **Found during:** Task 3 `git status` check
- **Issue:** `tsc -b` project reference builds generate `*.tsbuildinfo` files in each package directory. These were appearing as untracked files but were absent from `.gitignore`.
- **Fix:** Added `**/*.tsbuildinfo` to `.gitignore`.
- **Files modified:** `.gitignore`
- **Commit:** `155d2d1`

**4. [Note] macOS `timeout` command not available**

- **Found during:** Task 3 FND-03 smoke (`bash scripts/smoke-wrangler-dev.sh`)
- **Issue:** `scripts/smoke-wrangler-dev.sh` uses `timeout 15 npx wrangler dev` but the macOS BSD tools don't include GNU `timeout`. The script silently failed to start wrangler.
- **Action:** Ran `wrangler dev ... &` manually with `sleep 8 && curl` + `kill $PID`. Both Workers responded correctly (HTTP 200 with expected JSON bodies). FND-03 is verified end-to-end.
- **Impact:** The smoke script works on Linux (CI). On macOS dev environments, `brew install coreutils` (for `gtimeout`) or a script fix (replacing `timeout` with a background sleep+kill pattern) would be needed. This is out of scope for Plan 05 (Plan 06 wires CI).
- **Deferred to:** `.planning/deferred-items.md` for Plan 06 consideration.

## Known Stubs

The following are intentional Phase 1 stubs — not production-ready, documented for verifier awareness:

| Stub                                                                      | File                                 | Reason                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `export class WorkspaceDO extends DurableObject {}`                       | `packages/workspace-do/src/index.ts` | Empty body; Phase 2 adds SQLite schema + queries + SYSTEM_TYPES seeding                      |
| `server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" })` | `packages/mcp-server/src/index.ts`   | Minimal McpServer instance; Phase 3 registers all MCP tools                                  |
| `async init(): Promise<void> {}`                                          | `packages/mcp-server/src/index.ts`   | No-op; Phase 3 populates tool registrations                                                  |
| `fetch(): Response { return Response.json({ok, worker, phase: 1}) }`      | both Workers                         | No-op handler; Phase 3 (mcp-server) and Phase 5/6 (triage-worker) replace with real handlers |

## Threat Surface Scan

No new security surface beyond the wrangler config architectural contract (T-01-16..T-01-22 in plan threat model). All mitigations applied:

| Threat                              | Mitigation Applied                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| T-01-16 new_classes regression      | `npm run lint:wrangler` exits 0; `new_sqlite_classes` confirmed in both Workers                |
| T-01-17 script_name on DO bindings  | `! grep -q 'script_name' packages/mcp-server/wrangler.jsonc` confirmed                         |
| T-01-18 nodejs_compat_v2 redundancy | Only `nodejs_compat` present in both wrangler.jsonc files                                      |
| T-01-19 agents wrong version        | `agents@0.13.2` confirmed; installed via `npm install` not pip                                 |
| T-01-SC agents legitimacy           | Pre-audited in RESEARCH (github.com/cloudflare/agents, [OK])                                   |
| T-01-20 wrong moduleResolution      | All tsconfigs extend `tsconfig.base.json` (bundler); `npm run typecheck` exits 0               |
| T-01-21 wrangler process leak       | Manual background `kill $PID` pattern used; confirmed cleanup                                  |
| T-01-22 DurableObject base import   | `import { DurableObject } from "cloudflare:workers"` boots without error in wrangler dev smoke |

## Self-Check

Files created:

- [x] `packages/workspace-do/package.json` — FOUND
- [x] `packages/workspace-do/tsconfig.json` — FOUND
- [x] `packages/workspace-do/src/index.ts` — FOUND
- [x] `packages/mcp-server/wrangler.jsonc` — FOUND
- [x] `packages/mcp-server/package.json` — FOUND
- [x] `packages/mcp-server/tsconfig.json` — FOUND
- [x] `packages/mcp-server/src/index.ts` — FOUND
- [x] `packages/triage-worker/wrangler.jsonc` — FOUND
- [x] `packages/triage-worker/package.json` — FOUND
- [x] `packages/triage-worker/tsconfig.json` — FOUND
- [x] `packages/triage-worker/src/index.ts` — FOUND

Commits:

- [x] `eec429d` — feat(01-05): scaffold @engram/workspace-do library stub (D-10)
- [x] `805c55c` — feat(01-05): scaffold @engram/mcp-server — two-DO wrangler.jsonc + shared-type imports (FND-02)
- [x] `155d2d1` — feat(01-05): scaffold @engram/triage-worker + gitignore tsbuildinfo (FND-02, FND-03, FND-08)
