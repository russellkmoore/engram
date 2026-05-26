---
phase: 03-mcp-server-scaffold
plan: 05
subsystem: mcp-server
tags: [mcp-server, oauth-provider, default-export, wrangler-migration, env-drift, wave-3, green-transition]

# Dependency graph
requires:
  - phase: 03-mcp-server-scaffold
    plan: 01
    provides: "EngramProps interface exported from packages/mcp-server/src/index.ts; vitest infra wired; index.test.ts RED stub with 3 it.skip cases ready for Wave 3 GREEN transition; scripts/kv-bootstrap.mjs available for Plan 06 docs."
  - phase: 03-mcp-server-scaffold
    plan: 02
    provides: "5 zod input schemas + mapToMcpError consumed transitively through tools.ts (no direct import in this plan, but the schemas drive the registerTool inputSchema calls registered during EngramMcp.init)."
  - phase: 03-mcp-server-scaffold
    plan: 03
    provides: "`registerTools(server, getProps, env)` exported from ./tools.ts — invoked from EngramMcp.init() in this plan. Sentinel-anchored T-03-DD-RT structural defense inherited unchanged."
  - phase: 03-mcp-server-scaffold
    plan: 04
    provides: "`defaultHandler: ExportedHandler<EngramOAuthEnv>` exported from ./oauth.ts — wired into the OAuthProvider constructor as the non-API fall-through. EngramOAuthEnv simplified in this plan after codegen regen folded KV bindings into Env."
provides:
  - "packages/mcp-server/src/index.ts default export is now `new OAuthProvider({...})` per RESEARCH §Pattern 2 — apiRoute '/mcp' + apiHandler EngramMcp.serve('/mcp', { binding: 'MCP_OBJECT' }) + defaultHandler + /authorize + /token + /register endpoints."
  - "EngramMcp.init() wires `registerTools(this.server, () => this.props, this.env)` with the lazy `() => this.props` getter for token-refresh stability (RESEARCH Pitfall 6)."
  - "packages/mcp-server/wrangler.jsonc migrations[] now declares BOTH WorkspaceDO (v1) AND EngramMcp (v2) under new_sqlite_classes — resolves Phase 2 D-07 forward-note (D-09 acceptance)."
  - "packages/mcp-server/wrangler.jsonc kv_namespaces declares OAUTH_KV + ENGRAM_IDENTITIES bindings (placeholder IDs, real IDs swapped at deploy time per Plan 06 README)."
  - "Regenerated `worker-configuration.d.ts` (gitignored — Phase 1 D-07) now types `OAUTH_KV: KVNamespace` and `ENGRAM_IDENTITIES: KVNamespace` directly on the global Env."
  - "T-03-ENV-DRIFT eliminated — both index.ts and oauth.ts contain zero `^interface Env` declarations. The oauth.ts EngramOAuthEnv augmentation is simplified to a single field (OAUTH_PROVIDER, the runtime helper that is NOT a wrangler binding)."
  - "packages/mcp-server/src/__tests__/index.test.ts is GREEN — 9 assertions across 4 describe blocks: module shape (3), EngramMcp.init registers 5 tools (1), wrangler.jsonc v2 migration shape (2), anti-patterns (3)."
  - "Full mcp-server test suite is GREEN: 48 passed / 0 skipped / 0 failed (was 39/3/0 before this plan)."
  - "wrangler deploy --dry-run succeeds with all 4 bindings recognized (RESEARCH Pitfall 3 canary cleared)."
affects: [03-06-deploy-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vite `?raw` query applied to `.jsonc` files — bundler inlines the JSONC text at build time; consumed via `jsonc-parser` for structural assertions inside workerd-pool tests. Mirror of the tools.test.ts pattern; extends the established workerd-safe-source-read idiom to non-`.ts` files."
    - "OAuthProvider default-export shape — `export default new OAuthProvider({ apiRoute, apiHandler, defaultHandler, authorizeEndpoint, tokenEndpoint, clientRegistrationEndpoint })`. The library auto-mounts /.well-known/* and /jwks; user code wires only the four explicit endpoints + apiHandler."
    - "Module-scoped Env augmentation reduced to single-field after codegen catches up — when wrangler.jsonc gains a new binding and `wrangler types` regenerates, simplify any local `extends Env` augmentation to ONLY the runtime-injected (non-binding) fields. The codegen owns every binding-derived field as the single source of truth (T-03-ENV-DRIFT mitigation)."
    - "Block-disable of `@typescript-eslint/require-await` for sync-body async methods that must keep the `async` keyword for SDK signature compatibility — paired `/* eslint-disable */` / `/* eslint-enable */` with rationale comment. Established by tools.ts in Plan 03-03; now applied to EngramMcp.init() in index.ts."

key-files:
  created:
    # None — all changes are modifications of existing files.
  modified:
    - "packages/mcp-server/src/index.ts (Phase 1 stub default export REPLACED with OAuthProvider; init() wired to registerTools; Phase 1 type-witness `Phase1Pong` + @engram/types imports + SYSTEM_TYPES import removed)"
    - "packages/mcp-server/wrangler.jsonc (v2 migration for EngramMcp added; kv_namespaces block added with OAUTH_KV + ENGRAM_IDENTITIES placeholders; Phase 1 'deferred to v2' JSDoc removed per D-09)"
    - "packages/mcp-server/src/oauth.ts (EngramOAuthEnv augmentation simplified to single OAUTH_PROVIDER field after codegen regen folded both KV bindings into global Env — T-03-ENV-DRIFT mitigation)"
    - "packages/mcp-server/src/__tests__/index.test.ts (3 it.skip stubs → 9 GREEN it() assertions across 4 describe blocks — MCP-01/02/03 unit-asserted)"
  regenerated:
    - "packages/mcp-server/worker-configuration.d.ts (via `npm run types:gen --workspace @engram/mcp-server` — gitignored per Phase 1 D-07; now types OAUTH_KV + ENGRAM_IDENTITIES alongside the existing MCP_OBJECT + WORKSPACE bindings)"

key-decisions:
  - "Kept the `async init()` keyword in EngramMcp.init() despite `registerTools` being synchronous. The McpAgent base class types `init(): Promise<void> | void`; Phase 4+ may add async setup (warm-loading user preferences from `this.env`). Block-disabling `@typescript-eslint/require-await` with a paired `/* eslint-disable */` / `/* eslint-enable */` and a rationale comment block is the established repo pattern (mirrors `tools.ts` from Plan 03-03 and `workspace-do/src/index.ts`). Avoids a Phase 4 churn-on-keyword."
  - "Simplified `EngramOAuthEnv` in oauth.ts from a 3-field augmentation (ENGRAM_IDENTITIES, OAUTH_KV, OAUTH_PROVIDER) to a 1-field augmentation (OAUTH_PROVIDER). After Task 2 added the KV bindings to wrangler.jsonc and Task 3 regenerated worker-configuration.d.ts, both KV bindings appear on the global Env directly. Keeping the 3-field augmentation would have created the exact silent-shape-drift risk T-03-ENV-DRIFT is supposed to prevent — two declarations of `OAUTH_KV: KVNamespace` (one local, one global) with the chance to drift in narrow type or marker fields under exactOptionalPropertyTypes. The single remaining field (OAUTH_PROVIDER) is library-injected at request-dispatch time and CANNOT live in wrangler.jsonc by design."
  - "Mentioned the OAuth cookie-encryption secret in the wrangler.jsonc comment WITHOUT using the literal binding-name token. The Task 2 verify command (`if (text.includes('COOKIE_ENCRYPTION_KEY')) throw ...`) treats any substring match as a T-03-COOKIE leak — including comments. The comment refers to 'the OAuth cookie-encryption secret' in prose and points to Plan 06 README for the literal binding name. This keeps the threat-model documentation intact without tripping the verify automation."
  - "Used Vite `?raw` import for BOTH `index.ts?raw` AND `wrangler.jsonc?raw`. The latter is a novel extension — Plan 03-03 only used `?raw` on `.ts` files. Vite's `?raw` query is content-type-agnostic; the bundler inlines bytes as a UTF-8 string regardless of extension. Combined with `jsonc-parser` (already a root devDep), this gives workerd-pool tests a node:fs-free path to assert on production wrangler.jsonc shape — the same pattern Plan 06's deploy docs may want to mirror for any JSONC validation tests."
  - "The 5-tool registration test constructs the EngramMcp instance via `runInDurableObject(env.MCP_OBJECT.get(env.MCP_OBJECT.idFromName(...)))`. This is the canonical workerd-pool shell from `defense-in-depth.test.ts:101-107` (workspace-do). McpAgent's DO infrastructure (websocket transport, etc.) is initialized by the pool; calling `instance.init()` directly bypasses transport setup and is enough to drive the spy. The plan's alternative of `new EngramMcp(mockCtx, mockEnv)` would have required mocking `cloudflare:workers` internals — runInDurableObject is cleaner."

patterns-established:
  - "Vite `?raw` query for non-`.ts` source-string assertions: extends the Plan 03-03 `import src from \"./path.ts?raw\"` pattern to `.jsonc` (and by extension any text file the bundler can serve as UTF-8). Combined with `jsonc-parser`, this is the workerd-pool-safe path to assert wrangler.jsonc / package.json / tsconfig.json shapes from tests — no `node:fs` runtime call needed."
  - "Two-pass Env type evolution: when a wrangler.jsonc edit ADDS new bindings, the immediate downstream cleanup is (1) regenerate `worker-configuration.d.ts` via `wrangler types`, (2) simplify or remove any local `extends Env` augmentations now that the codegen owns the canonical shape. The acceptance gate is `grep -c '^interface Env' <file>` returning 0 in every Worker source file — established as the T-03-ENV-DRIFT mitigation pattern in checker WARNING 1."

requirements-completed: [MCP-01, MCP-02, MCP-03]
# Notes:
# - MCP-01 (`agents/mcp` McpAgent host, no raw streamableHttp) — FULLY DELIVERED.
#   The default export is `new OAuthProvider({...})` wrapping `EngramMcp.serve("/mcp")`;
#   the anti-pattern check `index.ts source does NOT contain 'streamableHttp'` is
#   asserted GREEN in index.test.ts.
# - MCP-02 (`EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })`) — FULLY DELIVERED.
#   The apiHandler is the literal `EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })`
#   per RESEARCH §Pattern 2; structurally asserted GREEN in index.test.ts.
# - MCP-03 (wrangler.jsonc migrations[] declares BOTH WorkspaceDO + EngramMcp
#   under new_sqlite_classes) — FULLY DELIVERED. v1 + v2 migrations both
#   asserted GREEN in index.test.ts; wrangler deploy --dry-run exits 0 with
#   both DO classes recognized; FND-08 lint passes.

# Metrics
duration: 70m
completed: 2026-05-26
---

# Phase 3 Plan 05: Index.ts Integration (Wave 3) Summary

**Plan 03-05 is complete: the Phase 1 stub default export in `packages/mcp-server/src/index.ts` is REPLACED with `new OAuthProvider({...})` per RESEARCH §Pattern 2. `EngramMcp.init()` wires `registerTools(this.server, () => this.props, this.env)`. `packages/mcp-server/wrangler.jsonc` now declares BOTH `WorkspaceDO` (v1) and `EngramMcp` (v2) under `new_sqlite_classes` (D-09 resolution). `OAUTH_KV` and `ENGRAM_IDENTITIES` KV bindings are declared. `worker-configuration.d.ts` regenerated. `index.test.ts` flipped RED → GREEN with 9 assertions (MCP-01/02/03 unit-asserted). Full mcp-server suite: 48 passed / 0 skipped.**

## Outcome

- **`packages/mcp-server/src/index.ts`** default export is `new OAuthProvider({ apiRoute: "/mcp", apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }), defaultHandler, authorizeEndpoint: "/authorize", tokenEndpoint: "/token", clientRegistrationEndpoint: "/register" })`. This is the OAuth Resource Server pattern (D-01) co-deployed with the Authorization Server endpoints (D-07).
- **`EngramMcp.init()`** calls `registerTools(this.server, () => this.props, this.env)` — the `() => this.props` lazy getter captures `this.props` at invocation time so token-refresh rebinding (RESEARCH Pitfall 6) is reflected on the next tool call. The 5 tool registrations from Plan 03-03 now actually wire onto each `EngramMcp` instance's `server` at construction time.
- **`packages/mcp-server/wrangler.jsonc`** declares the v2 migration `{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }` (D-09 — resolves Phase 2 D-07 forward-note). The Phase 1 "deferred to v2" JSDoc is removed. The `kv_namespaces` block declares both `OAUTH_KV` and `ENGRAM_IDENTITIES` with placeholder IDs (Plan 06 README documents the `wrangler kv namespace create` swap step). The OAuth cookie-encryption secret is NOT declared here — it ships via `wrangler secret put` at deploy time (T-03-COOKIE).
- **`worker-configuration.d.ts`** regenerated by `wrangler types` — now contains `OAUTH_KV: KVNamespace`, `ENGRAM_IDENTITIES: KVNamespace`, `MCP_OBJECT: DurableObjectNamespace<EngramMcp>`, `WORKSPACE: DurableObjectNamespace<WorkspaceDO>` on the global Env.
- **T-03-ENV-DRIFT eliminated** — both `index.ts` and `oauth.ts` contain zero `^interface Env` declarations. The `EngramOAuthEnv` augmentation in `oauth.ts` simplified from 3 fields (ENGRAM_IDENTITIES, OAUTH_KV, OAUTH_PROVIDER) to 1 field (OAUTH_PROVIDER, library-injected non-binding) after the codegen took ownership of the binding-derived fields.
- **`index.test.ts`** is GREEN — 3 Wave 0 `it.skip` stubs replaced with 9 GREEN `it()` assertions across 4 describe blocks. MCP-01 (no streamableHttp anti-pattern), MCP-02 (EngramMcp.serve("/mcp") shape), MCP-03 (v1+v2 migrations with new_sqlite_classes) all structurally locked.

## Performance

- **Duration:** ~70 minutes (start of agent spawn including npm install + types regen to SUMMARY commit)
- **Started:** 2026-05-26T06:23Z (worktree branch creation)
- **Completed:** 2026-05-26T07:33Z (SUMMARY composition)
- **Tasks:** 4 (Task 1 index.ts swap, Task 2 wrangler.jsonc, Task 3 types regen + Env cleanup, Task 4 index.test.ts GREEN)
- **Files created:** 0
- **Files modified:** 4 (index.ts, wrangler.jsonc, oauth.ts, index.test.ts)
- **Files regenerated:** 1 (worker-configuration.d.ts — gitignored per Phase 1 D-07)
- **Commits:** 4 atomic per-task commits

## Task Commits

1. **Task 1:** `b44d3ee` — `feat(03-05): swap mcp-server index.ts default export to OAuthProvider`
2. **Task 2:** `1a66dc8` — `feat(03-05): add v2 migration + KV bindings to mcp-server wrangler.jsonc`
3. **Task 3:** `e465c5c` — `refactor(03-05): simplify oauth.ts EngramOAuthEnv to OAUTH_PROVIDER only`
4. **Task 4:** `369cb85` — `test(03-05): turn index.test.ts from RED to GREEN (9 assertions, MCP-01/02/03)`

## Files Changed

### Modified (4)

- **`packages/mcp-server/src/index.ts`** — 81 insertions, 86 deletions. Replaced Phase 1 stub default export (`export default { fetch() }`) with `new OAuthProvider({...})`. Removed the Phase 1 type-witness `Phase1Pong` interface, the `@engram/types` canonical-shape imports, and the `SYSTEM_TYPES` import — those served the FND-04/05 consumer-smoke contract and are now obsolete since `tools.ts` / `schemas.ts` ship the real surface. Preserved `export interface EngramProps` (Plan 03-01 cross-plan contract) and `export { WorkspaceDO } from "@engram/workspace-do"` (wrangler DO binding target). Added imports for `OAuthProvider`, `registerTools`, and `defaultHandler`. Wired `EngramMcp.init()` to call `registerTools(this.server, () => this.props, this.env)`. NO local `interface Env` — the canonical Env flows from `worker-configuration.d.ts`.

- **`packages/mcp-server/wrangler.jsonc`** — 13 insertions, 9 deletions. Added v2 migration `{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }` after the v1 WorkspaceDO entry (D-09). Added `kv_namespaces` block declaring `OAUTH_KV` and `ENGRAM_IDENTITIES` with placeholder IDs (Plan 06 README documents the swap). Removed the Phase 1 "deferred to v2" JSDoc comment block (D-09 acceptance criteria). The OAuth cookie-encryption secret is correctly absent (T-03-COOKIE — set via `wrangler secret put`).

- **`packages/mcp-server/src/oauth.ts`** — 19 insertions, 19 deletions. Simplified `EngramOAuthEnv` from a 3-field augmentation (ENGRAM_IDENTITIES, OAUTH_KV, OAUTH_PROVIDER) to a 1-field augmentation (OAUTH_PROVIDER). After Task 2 added the KV bindings to wrangler.jsonc and Task 3 regenerated `worker-configuration.d.ts`, both KV bindings appear on the global `Env` directly — keeping them in the local augmentation would have created the T-03-ENV-DRIFT silent-shape-drift risk. The remaining single field (`OAUTH_PROVIDER: OAuthHelpers`) is library-injected at request-dispatch time and CANNOT live in wrangler.jsonc by design. Top-of-file JSDoc updated to document the simplification.

- **`packages/mcp-server/src/__tests__/index.test.ts`** — 164 insertions, 46 deletions. Replaced 3 Wave 0 `it.skip` stubs with 9 GREEN `it()` assertions across 4 describe blocks:
  - `module shape (MCP-01 / MCP-02 — OAuthProvider default export)` — 3 tests: default export exposes `.fetch`; `EngramMcp` class exported; `WorkspaceDO` re-exported.
  - `EngramMcp.init registers 5 tools (MCP-06 integration)` — 1 test: spy on `McpServer.prototype.registerTool`, drive init() via `runInDurableObject(env.MCP_OBJECT.get(...))`, assert 5 tools registered by name.
  - `wrangler.jsonc v2 migration shape (MCP-03 / D-09)` — 2 tests: migrations array shape (v1 WorkspaceDO + v2 EngramMcp, both under `new_sqlite_classes`, neither with `new_classes`); `kv_namespaces` contains both `OAUTH_KV` and `ENGRAM_IDENTITIES`.
  - `anti-patterns (RESEARCH §Anti-Patterns)` — 3 tests: index.ts source does NOT contain `streamableHttp`; `defaultHandler` imported and passed to OAuthProvider; `apiRoute "/mcp"` + `EngramMcp.serve("/mcp")` + `binding: "MCP_OBJECT"` structurally pinned.

### Regenerated (1, gitignored)

- **`packages/mcp-server/worker-configuration.d.ts`** — regenerated via `npm run types:gen --workspace @engram/mcp-server` (which runs `wrangler types`). Now types all 4 bindings on the global `Env`: `OAUTH_KV: KVNamespace`, `ENGRAM_IDENTITIES: KVNamespace`, `MCP_OBJECT: DurableObjectNamespace<import("./src/index").EngramMcp>`, `WORKSPACE: DurableObjectNamespace<import("./src/index").WorkspaceDO>`. The file remains gitignored (Phase 1 D-07 — codegen artifact); the orchestrator's verify step will regenerate it locally before running any typecheck.

## Verification

All plan-level `<verification>` steps from PLAN.md pass:

### 1. Full mcp-server test suite GREEN

```
$ npm test --workspace=@engram/mcp-server -- --run
 Test Files  5 passed (5)
      Tests  48 passed (48)
```

48 passed, 0 skipped, 0 failed. The 3 Wave 0 RED stubs in `index.test.ts` are now 9 GREEN assertions. Combined with the earlier Wave 1/2 transitions (schemas: 16, error-mapping: 7, tools: 10, oauth: 6), the full Phase 3 test surface is GREEN.

### 2. Cross-workspace non-regression (workspace-do)

```
$ npm test --workspace=@engram/workspace-do -- --run
 Test Files  6 passed (6)
      Tests  25 passed | 1 skipped (26)
```

25 passed, 1 pre-existing skipped (the same baseline as before this plan). Zero regression in Phase 2's defense-in-depth + helper test surface.

### 3. TypeScript compiles cleanly

```
$ npx tsc -p packages/mcp-server/tsconfig.json --noEmit
EXIT 0 (no output)

$ npx tsc -p packages/workspace-do/tsconfig.json --noEmit
EXIT 0 (no output)
```

Both packages typecheck cleanly. The mcp-server typecheck is meaningful because:
- The OAuthProvider constructor accepts `EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })` without coercion (apiHandler signature matches).
- `McpAgent<Env, unknown, EngramProps>` resolves `Env` through the regenerated `worker-configuration.d.ts` (no local Env declaration).
- `defaultHandler` (typed `ExportedHandler<EngramOAuthEnv>`) is accepted as the OAuthProvider's `defaultHandler` because `EngramOAuthEnv extends Env`.

### 4. FND-08 wrangler lint passes

```
$ npm run lint:wrangler
[lint:wrangler] OK — checked 2 file(s).
```

The 2 files checked are `packages/mcp-server/wrangler.jsonc` (just modified) and `packages/workspace-do/wrangler.jsonc` (unmodified). Both use `new_sqlite_classes` exclusively — no `new_classes` anywhere. The new v2 migration entry passes by construction.

### 5. STO-10 blockconcurrency lint passes (no regression)

```
$ npm run lint:blockconcurrency
[lint:blockconcurrency] OK — checked 15 file(s).
```

The lint inspects DO classes for the blockConcurrencyWhile pattern — Phase 2 STO-10 contract. No regression from this plan (which touched index.ts but did not introduce any new DO method bodies).

### 6. Wrangler deploy dry-run validates migration + class declaration

```
$ cd packages/mcp-server && npx wrangler deploy --dry-run
 ⛅️ wrangler 4.94.0
───────────────────
Total Upload: 2317.74 KiB / gzip: 411.59 KiB
Your Worker has access to the following bindings:
Binding                                                             Resource
env.MCP_OBJECT (EngramMcp)                                          Durable Object
env.WORKSPACE (WorkspaceDO)                                         Durable Object
env.OAUTH_KV (<id-from-wrangler-kv-namespace-create>)               KV Namespace
env.ENGRAM_IDENTITIES (<id-from-wrangler-kv-namespace-create>)      KV Namespace

--dry-run: exiting now.
```

EXIT 0. All 4 bindings recognized — both DO classes (`EngramMcp` + `WorkspaceDO`) are declared in some migration (Pitfall 3 canary CLEARED); no `new_classes` warning (Pitfall 8 canary CLEARED). The KV namespace placeholder IDs are accepted by the dry-run (KV ID validation is deferred to the real deploy, per the plan's acceptance criteria fallback). If Russell runs `wrangler deploy` against the production account without first swapping the KV IDs, deploy will fail at the KV lookup step — that's the intentional gate documented in Plan 06 README.

### 7. T-03-ENV-DRIFT structural check (checker WARNING 1)

```
$ grep -c "^interface Env" packages/mcp-server/src/oauth.ts
0
$ grep -c "^interface Env" packages/mcp-server/src/index.ts
0
```

Both return 0. The canonical `Env` now comes EXCLUSIVELY from the regenerated `worker-configuration.d.ts`. No silent-shape-drift surface remains. The single remaining augmentation (`EngramOAuthEnv extends Env { OAUTH_PROVIDER: OAuthHelpers }` in oauth.ts) is named differently so it cannot shadow the global `Env` via declaration merging.

### 8. All 7 phase requirement IDs

- **MCP-01** ✓ — index.ts uses `agents/mcp` McpAgent (no streamableHttp anti-pattern). Asserted in `index.test.ts` "anti-patterns" describe block.
- **MCP-02** ✓ — `EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })` literal pinned in `index.ts` source AND structurally asserted in `index.test.ts`.
- **MCP-03** ✓ — `wrangler.jsonc migrations[]` declares BOTH `WorkspaceDO` (v1) and `EngramMcp` (v2) under `new_sqlite_classes`. Asserted GREEN in `index.test.ts` "wrangler.jsonc v2 migration shape" describe block.
- **MCP-04** ✓ (Plan 04) — `oauth.ts` /authorize populates props from `ENGRAM_IDENTITIES` KV; OAuthProvider validates JWT before apiHandler dispatch. Inherited from Plan 03-04; the wiring of `defaultHandler` into the OAuthProvider default export in this plan completes the surface.
- **MCP-05** ✓ (Plan 03) — `tools.ts` Phase-4-ready comment block + structural absence of `args.workspace_id`. Inherited from Plan 03-03; this plan does not touch tools.ts.
- **MCP-06** ✓ — 5 tools registered in EngramMcp.init via registerTools, each with a zod inputSchema (Plans 02, 03, this plan). Asserted GREEN in `index.test.ts` "EngramMcp.init registers 5 tools" describe block.
- **MCP-09** ☐ — deferred to Plan 06 manual smoke (MCP Inspector + Claude Desktop config). NOT in scope for this plan.

## Cross-Phase Contracts

### Full defense-in-depth chain now wired

This plan completes the structural defense-in-depth chain established by Waves 1+2 by wiring all four modules into the default export:

- **T-03-DD-IN (Tampering, schemas)** — INHERITED from Plan 02. Schemas in `schemas.ts` do NOT declare `workspace_id`. `tools.ts` consumes them via `.shape` for `registerTool({ inputSchema })`; this plan invokes that registration from `EngramMcp.init()`. The schema-layer defense is reachable from the production code path.
- **T-03-DD-RT (Tampering, tools)** — INHERITED from Plan 03. `tools.ts` production code does NOT reference `args.workspace_id` outside comment lines; the SENTINEL-DD-RT-PHASE-03-TOOLS-TS sentinel anchor proves the structural test reads live source. This plan invokes `registerTools(...)` from `EngramMcp.init()`; the tools.ts surface is reachable from the production code path.
- **T-03-PROPS (Spoofing, oauth)** — INHERITED from Plan 04. `oauth.ts /authorize` sources props EXCLUSIVELY from `await env.ENGRAM_IDENTITIES.get(sub)`. This plan wires `defaultHandler` into the OAuthProvider default export — making the `/authorize` route reachable for any MCP client doing OAuth.
- **T-03-JWT (Spoofing, OAuthProvider library)** — MITIGATED by library wiring (this plan). `OAuthProvider` validates the bearer JWT BEFORE dispatching to `apiHandler` (the `EngramMcp.serve("/mcp")` path). The library's validation is RFC 6749/9728 compliant per RESEARCH §Standard Stack. No custom validation code in this plan; `index.test.ts` asserts the default export exposes `.fetch` (structural proof that the library integration is wired).
- **T-03-ENV-DRIFT (Tampering, local Env declarations)** — ELIMINATED in this plan. `index.ts` has NO local Env declaration; `oauth.ts` reduces its module-scoped augmentation to a single non-binding field. Every binding-derived `Env` field flows from the regenerated `worker-configuration.d.ts` as the single source of truth (checker WARNING 1 mitigation).
- **T-03-MIGR (Tampering, wrangler.jsonc migrations)** — MITIGATED in this plan. The v2 entry uses `new_sqlite_classes` (NOT `new_classes`) per FND-08 lint. `EngramMcp` SQLite-backed is irreversible (Cloudflare workers-sdk #9909) — chosen per RESEARCH Open Question 5 to future-proof for McpAgent.sql usage. `wrangler deploy --dry-run` verified the shape.
- **T-03-COOKIE (Information Disclosure, COOKIE_ENCRYPTION_KEY)** — MITIGATED in this plan. The wrangler.jsonc contains NO literal `COOKIE_ENCRYPTION_KEY` token. The OAuth cookie-encryption secret is set via `wrangler secret put` at deploy time; Plan 06 README documents the one-line setup step.
- **T-03-KV-PLACEHOLDER (Information Disclosure, kv_namespaces.id)** — ACCEPTED in this plan. KV namespace IDs are placeholder strings (`<id-from-wrangler-kv-namespace-create>`) until Russell runs the create commands. The placeholder is safe to commit (not a secret); Plan 06 README documents the swap procedure.

### Plan 03-06 (deploy + DEP-05 README) — UNBLOCKED

Plan 06 will:
- Document the `wrangler kv namespace create OAUTH_KV` + `wrangler kv namespace create ENGRAM_IDENTITIES` setup steps (the IDs Russell pastes into wrangler.jsonc to replace the placeholders).
- Document `wrangler secret put COOKIE_ENCRYPTION_KEY` for the OAuth library's encryption requirement.
- Document the 2-step bootstrap flow: first `/authorize` call fails with 403 + `Unknown OAuth subject: <sub>` → Russell runs `npm run kv:bootstrap -- --sub <sub>` → retry succeeds.
- Document the MCP Inspector smoke test (MCP-09) — `npx @modelcontextprotocol/inspector` against `wrangler dev` for manual verification of the 5 tool registrations + the OAuthProvider routes.
- Document the Claude Desktop config snippet referencing `mcp-remote https://engram-mcp.workers.dev/mcp`.

After Plan 06 lands, Phase 3 is functionally complete and `wrangler deploy` would succeed if Russell pushed it.

## Threat Model Discharge

All applicable threats from the plan's `<threat_model>` block are mitigated:

- **T-03-JWT (Spoofing, OAuthProvider library):** Mitigated by library wiring. `index.test.ts` asserts the default export exposes `.fetch` — the OAuthProvider's RFC-compliant JWT validation runs before any request reaches `apiHandler` (the `EngramMcp.serve("/mcp")` path).
- **T-03-PROPS (Spoofing, EngramMcp.init → registerTools):** Inherited from Plan 03. The `() => this.props` lazy getter passed to `registerTools` is asserted in `index.ts` source AND the `EngramMcp.init` body. Token-refresh rebinding (RESEARCH Pitfall 6) reflects on the next tool call because the closure captures `this.props` lazily.
- **T-03-MIGR (Tampering, wrangler.jsonc migrations[]):** Mitigated. The v2 entry uses `new_sqlite_classes` per FND-08 lint. `wrangler deploy --dry-run` exits 0 with both DO classes (EngramMcp + WorkspaceDO) recognized.
- **T-03-DRYDEPLOY (Tampering / Configuration, wrangler.jsonc → deploy):** Mitigated. `wrangler deploy --dry-run --config packages/mcp-server/wrangler.jsonc` succeeds — no "class not declared in any migration" warning (Pitfall 3 canary), no `new_classes` warning (Pitfall 8 canary). Output verbatim in §Verification.6 above.
- **T-03-KV-PLACEHOLDER (Information Disclosure / Configuration, kv_namespaces.id):** Accepted (post-deploy task). KV namespace IDs are placeholders until `wrangler kv namespace create` runs. The placeholder is safe to commit per RESEARCH §Security Domain (KV namespace IDs are NOT secrets).
- **T-03-COOKIE (Information Disclosure, COOKIE_ENCRYPTION_KEY):** Mitigated. NOT declared in wrangler.jsonc; set via `wrangler secret put` per Plan 06 README. Verify-time grep against the literal token returns no matches.
- **T-03-ENV-DRIFT (Tampering / Configuration, local interface Env declarations):** Eliminated. `grep -c "^interface Env"` against BOTH `oauth.ts` and `index.ts` returns 0. The canonical `Env` flows from the regenerated `worker-configuration.d.ts`.
- **T-03-DD-IN, T-03-DD-RT, T-03-KV-LEAK, T-03-PARSE:** Inherited from Plans 02, 03, 04. This plan wires those defenses into the production code path (default export → apiHandler / defaultHandler dispatch) without modifying any of the defending modules.
- **T-03-SC (Tampering, npm hoisted node_modules):** Inherited from Plan 03-01. No new packages added in this plan.

## Threat Flags

None. The new and modified files do not introduce security-relevant surface beyond what the threat model already documents.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESLint `@typescript-eslint/require-await` rejects async EngramMcp.init() body that calls a sync function**
- **Found during:** Task 1 first commit attempt (pre-commit eslint hook)
- **Issue:** `EngramMcp.init()` is `async`, but its body calls `registerTools(...)` which is synchronous (each `server.registerTool` is sync). The strict-type-checked preset's `@typescript-eslint/require-await` rule fires because the function has no `await` expression. Removing `async` was NOT viable — `McpAgent.init()` is typed `init(): Promise<void> | void`, and Phase 4 may add async setup (warm-loading user preferences from `this.env`). Keeping `async` now means Phase 4 edits stay body-only.
- **Fix:** Block-disabled `@typescript-eslint/require-await` around the `init()` method body with paired `/* eslint-disable */` / `/* eslint-enable */` and a load-bearing rationale comment. Mirror of the established workspace-do pattern (`packages/workspace-do/src/index.ts:100`) and the Plan 03-03 tools.ts pattern.
- **Files modified:** `packages/mcp-server/src/index.ts`
- **Verification:** `npx eslint packages/mcp-server/src/index.ts` exit 0; `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exit 0.
- **Committed in:** `b44d3ee` (Task 1 — fix made before the commit was created)

**2. [Rule 3 - Blocking] Task 2 verify command treats COOKIE_ENCRYPTION_KEY literal in a JSDoc comment as a T-03-COOKIE leak**
- **Found during:** Task 2 acceptance verify
- **Issue:** The Task 2 acceptance verify uses `if (text.includes('COOKIE_ENCRYPTION_KEY')) throw new Error('COOKIE_ENCRYPTION_KEY leaked in JSONC (T-03-COOKIE violation)')`. The substring check matches ANY occurrence — including a JSDoc-style comment that explained where the secret would be set (`wrangler secret put COOKIE_ENCRYPTION_KEY`). The first draft of the comment block tripped the verify because it included the literal token. Functionally there's no secret leak (a comment naming a binding name is not the secret value), but the verify is structurally defensive and treats any mention as a violation.
- **Fix:** Rephrased the JSDoc comment in wrangler.jsonc to refer to "the OAuth cookie-encryption secret" in prose, and point readers to Plan 06 README for the literal binding name. The threat-model documentation intent is preserved (future contributors know secrets don't live in wrangler.jsonc) while the verify automation passes cleanly.
- **Files modified:** `packages/mcp-server/wrangler.jsonc`
- **Verification:** Task 2 acceptance verify exits 0; `grep -q "COOKIE_ENCRYPTION_KEY" packages/mcp-server/wrangler.jsonc` returns 1 (no matches).
- **Committed in:** `1a66dc8` (Task 2 — fix made before the commit was created)

**3. [Rule 3 - Blocking] node_modules empty + worker-configuration.d.ts missing in fresh worktree**
- **Found during:** Initial baseline (`ls node_modules/agents` returned empty)
- **Issue:** Fresh worktrees do not inherit `node_modules` or the gitignored `worker-configuration.d.ts` from the parent checkout. `npx tsc` would fail; `npm test` would fail to resolve dependencies. This is the same pre-existing condition documented by Plans 03-02, 03-03, and 03-04 retrospectives.
- **Fix:** Ran `npm install --engine-strict=false` (mirrors all prior Plan retrospectives — the engine-strict flag works around the pre-existing `lint-staged@17` engine constraint where the repo runs Node 22.14.0 but lint-staged requires 22.22.1+). Then ran `cd packages/mcp-server && npx wrangler types` to regenerate `worker-configuration.d.ts` (this also doubles as Task 3's regen step — the second regen after Task 2's wrangler.jsonc edit was the one that actually counted for acceptance).
- **Files modified:** None tracked (npm install affects only worktree-local node_modules; the regenerated `.d.ts` stays gitignored — same posture as every prior Phase 3 plan retrospective).
- **Verification:** All package imports resolve; `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0.
- **Committed in:** N/A — environment setup; the orchestrator's verify step will reproduce.

### Architectural Decisions Inline

**1. Simplified `EngramOAuthEnv` to a single-field augmentation (vs. removing it entirely).**

After Task 3 regenerated `worker-configuration.d.ts`, both `OAUTH_KV` and `ENGRAM_IDENTITIES` appear on the global `Env`. The plan's Task 3 `<action>` could have been read as "remove the augmentation entirely if all fields are now on Env". I kept the augmentation with just `OAUTH_PROVIDER: OAuthHelpers` because:

- `OAUTH_PROVIDER` is library-injected at request-dispatch time by `@cloudflare/workers-oauth-provider` — it's NOT a wrangler binding and CANNOT be declared in wrangler.jsonc by design.
- Therefore `OAUTH_PROVIDER` will NEVER appear on the codegen `Env`, regardless of future regen cycles.
- Removing the augmentation entirely would force every reference to `env.OAUTH_PROVIDER` in oauth.ts to either cast or fail to typecheck.
- The named augmentation (`EngramOAuthEnv` — not `Env`) avoids the shadow-merging trap from Plan 03-01's retrospective.

The intent of the plan's acceptance criteria (`grep -c "^interface Env" packages/mcp-server/src/oauth.ts` returns 0) is satisfied because the augmentation is named `EngramOAuthEnv`, not `Env`. The T-03-ENV-DRIFT mitigation is achieved (every binding-derived field has a single source of truth in the codegen).

**2. Used Vite `?raw` import for `wrangler.jsonc` (extending Plan 03-03's `.ts?raw` pattern to `.jsonc`).**

Plan 04's `<action>` for Task 4 hinted that node:fs might be tried first. I chose the `?raw` approach immediately because:
- Plan 03-03's retrospective documented that `node:fs` is NOT available in the workerd test pool.
- The same `?raw` trick that worked for `tools.ts?raw` is content-type-agnostic — Vite inlines bytes as UTF-8 strings regardless of extension.
- `jsonc-parser` is already a root devDep, so parsing the inlined string is one import away.

This extends the established workerd-pool-safe-source-read pattern to non-`.ts` files and is documented as a new pattern in this plan's `patterns-established` array.

### Deferred Issues

**Pre-existing: `lint-staged@17.0.5` engine constraint requires `node >=22.22.1`; repo runs 22.14.0.** Same condition flagged by every Phase 3 plan retrospective. Worked around with `npm install --engine-strict=false`. Not caused by this plan; out of scope.

**Sourcemap warnings during vitest runs.** The MCP SDK ships sourcemaps that point to non-existent source files (`Sourcemap for "...mcp.js" points to missing source files`). Not caused by this plan; cosmetic noise that doesn't affect any test outcome.

---

**Total deviations:** 3 auto-fixed (2 Rule 3 - Blocking, 1 Rule 3 - Blocking environment setup). 1 architectural decision inline. 0 Rule 4 (architectural-change) deviations. 2 Deferred pre-existing.

**Impact on plan:** All 3 auto-fixes are mechanical adjustments required for the strict typescript-eslint + lint-staged + node-version posture. None change the prescribed semantics, file layout, or contract surface. The plan's success criteria are fully met.

## Known Stubs

The 5 MCP tool callbacks in `tools.ts` ARE stubs (throwing `McpError(MethodNotFound)` with phase-pinned messages) — but they are INTENTIONAL stubs documented by D-05 and Plan 03-03's `<objective>`. Phase 4 (TOL-01..05) will swap each body for the real `getAgentByName` routing while preserving the registration shape. NOT introduced by this plan.

The KV namespace IDs in `wrangler.jsonc` are placeholder strings (`<id-from-wrangler-kv-namespace-create>`) until Russell runs `wrangler kv namespace create` at deploy time. The placeholder is SAFE TO COMMIT (KV namespace IDs are NOT secrets per RESEARCH §Security Domain); Plan 06 README documents the swap procedure. NOT a code stub — a deploy-time config gap by design (T-03-KV-PLACEHOLDER, accepted).

No other stubs introduced.

## Self-Check

Verified before composing this summary:

- `[ -f packages/mcp-server/src/index.ts ]` → **FOUND**
- `[ -f packages/mcp-server/wrangler.jsonc ]` → **FOUND**
- `[ -f packages/mcp-server/src/oauth.ts ]` → **FOUND**
- `[ -f packages/mcp-server/src/__tests__/index.test.ts ]` → **FOUND**
- `[ -f packages/mcp-server/worker-configuration.d.ts ]` → **FOUND** (gitignored, regenerated)
- `git log --oneline | grep -q "b44d3ee"` (Task 1) → **FOUND**
- `git log --oneline | grep -q "1a66dc8"` (Task 2) → **FOUND**
- `git log --oneline | grep -q "e465c5c"` (Task 3) → **FOUND**
- `git log --oneline | grep -q "369cb85"` (Task 4) → **FOUND**
- `npm test --workspace=@engram/mcp-server -- --run` exits 0 with 48 passed / 0 skipped / 0 failed → **PASS**
- `npm test --workspace=@engram/workspace-do -- --run` exits 0 with 25 passed / 1 pre-existing skipped → **PASS** (no Phase 2 regression)
- `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0 → **PASS**
- `npx tsc -p packages/workspace-do/tsconfig.json --noEmit` exits 0 → **PASS**
- `npm run lint:wrangler` exits 0 → **PASS** (FND-08)
- `npm run lint:blockconcurrency` exits 0 → **PASS** (STO-10 no regression)
- `npx wrangler deploy --dry-run --config packages/mcp-server/wrangler.jsonc` exits 0 with all 4 bindings recognized → **PASS** (Pitfall 3 canary CLEARED)
- `grep -q "import { OAuthProvider } from \"@cloudflare/workers-oauth-provider\"" packages/mcp-server/src/index.ts` → **PASS**
- `grep -q "export default new OAuthProvider" packages/mcp-server/src/index.ts` → **PASS**
- `grep -q "EngramMcp.serve(\"/mcp\"" packages/mcp-server/src/index.ts` → **PASS**
- `grep -q "binding: \"MCP_OBJECT\"" packages/mcp-server/src/index.ts` → **PASS**
- `grep -q "registerTools(this.server" packages/mcp-server/src/index.ts` → **PASS**
- `! grep -q "Phase1Pong" packages/mcp-server/src/index.ts` → **PASS** (Phase 1 type witness removed)
- `! grep -q "streamableHttp" packages/mcp-server/src/index.ts` → **PASS** (anti-pattern absent)
- `[ "$(grep -c '^interface Env' packages/mcp-server/src/index.ts)" = "0" ]` → **PASS** (T-03-ENV-DRIFT)
- `[ "$(grep -c '^interface Env' packages/mcp-server/src/oauth.ts)" = "0" ]` → **PASS** (T-03-ENV-DRIFT)
- `grep -q "ENGRAM_IDENTITIES" packages/mcp-server/worker-configuration.d.ts` → **PASS**
- `grep -q "OAUTH_KV" packages/mcp-server/worker-configuration.d.ts` → **PASS**
- `grep -E "it\.(skip|todo)\(" packages/mcp-server/src/__tests__/index.test.ts` returns no matches → **PASS**

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 03-06 (deploy + DEP-05 README) is UNBLOCKED.** All structural and integration work is done — Phase 3's only remaining gap is the manual smoke (MCP-09) + setup docs (DEP-05). Plan 06 will:
  - Create `packages/mcp-server/README.md` per the RESEARCH §Example 4 + §Pattern 7 content with the OAuth flow diagram, Claude Desktop config snippet, MCP Inspector smoke procedure, and the 2-step bootstrap flow (`wrangler kv namespace create` + `kv:bootstrap` + `wrangler secret put`).
  - Document the placeholder-ID-swap procedure for `OAUTH_KV` and `ENGRAM_IDENTITIES` in `packages/mcp-server/wrangler.jsonc`.
  - Execute the MCP Inspector smoke against `wrangler dev` to confirm the 5 tools list correctly and each returns the phase-pinned `MethodNotFound` (MCP-09).

- **Phase 4 (TOL-01..05) tool handler bodies — UNBLOCKED from Phase 3.** Each Phase 4 plan will diff a single callback body in `tools.ts` against the Phase-4-ready skeleton in the comment block. The defense-in-depth chain (T-03-DD-IN at schemas + T-03-DD-RT at tools + T-03-PROPS at oauth + T-03-JWT at OAuthProvider library) survives the Phase 3 → Phase 4 transition because it scopes only to non-comment code; the comment block (which documents the anti-pattern phrase) is excluded from the negative grep by design.

---

*Phase: 03-mcp-server-scaffold*
*Plan: 05 (Wave 3 — index.ts integration swap + GREEN transition)*
*Completed: 2026-05-26*
