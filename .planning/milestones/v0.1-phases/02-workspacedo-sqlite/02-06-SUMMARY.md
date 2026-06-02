---
phase: 02-workspacedo-sqlite
plan: 06
subsystem: workspace-do
tags: [defense-in-depth, sto-07, mcp-error, workspace-isolation, durableobjectid, id-from-name, id-from-string, runtime-guard, mt-1]

# Dependency graph
requires:
  - phase: 02-workspacedo-sqlite
    plan: 00
    provides: "@modelcontextprotocol/sdk@^1.29.0 direct dep on @engram/workspace-do (added in Plan 00 Task 1), plus the defense-in-depth.test.ts RED scaffold (2 it.skip blocks: positive + negative shape-lock contracts)"
  - phase: 02-workspacedo-sqlite
    plan: 04
    provides: "WorkspaceDO class scaffold with constructor body + ctx.id.name accessor; Plan 06 inserts the assertOwnsWorkspace method below the constructor without touching it"
  - phase: 02-workspacedo-sqlite
    plan: 05
    provides: "7 public methods on WorkspaceDO each with a uniform `args: { workspace_id: string; ...rest }` signature and a `// TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);` marker as the literal first line of every method body. helpers.test.ts already uses matching `workspace_id` / `idFromName` pairs so wiring the guard does not break it."

provides:
  - "packages/workspace-do/src/index.ts — private `assertOwnsWorkspace(workspaceId: string): void` method on WorkspaceDO that throws `new McpError(ErrorCode.InvalidRequest, ...)` when `this.ctx.id.name !== workspaceId`. Wired as the literal first executable line of all 7 public methods (insertBlock, getBlock, lexicalSearchBlocks, deleteBlock, listMemoryTypes, createInboxEntry, listConflicts) — every TODO marker Plan 05 left has been replaced with the actual guard call."
  - "packages/workspace-do/src/__tests__/defense-in-depth.test.ts — 9 GREEN tests: 7 positive cases (one per public method, asserting no throw when `args.workspace_id === idFromName(name)`) + 2 negative cases (canonical mismatch asserts McpError + ErrorCode.InvalidRequest shape-lock; sibling message-shape lock-in asserts the message names both actual and claimed ids and contains the literal 'Workspace mismatch' prefix)."
  - "Behavior verification of STO-07 + MT-1 invariant at the data plane: every public method on WorkspaceDO enforces the workspace_id check BEFORE any sql.exec runs. Cross-workspace SQLite reads/writes via a mismatched args.workspace_id are now impossible at the DO boundary, regardless of what the caller does at the Worker layer."

affects:
  - 02-08-validation (full-suite vitest run now includes 9 defense-in-depth GREEN tests in addition to Plan 05's 7 helpers tests — validation phase will confirm the running total of 25 passing / 1 skipped on the workspace-do package)
  - 03-mcp-server-scaffold (Phase 3 MCP tool handlers MUST pass `this.props.workspace_id` — the JWT-derived id from the McpAgent session — to every WorkspaceDO method's `args.workspace_id`. Never pass caller-provided input directly. A mismatch surfaces as McpError(InvalidRequest -32600), which Phase 3 MCP-07 will pass through to the client unmodified. This is the cross-phase drift surface — see Drift Surface section below.)
  - 03-mcp-server-scaffold (Phase 3 will obtain the WorkspaceDO stub via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` — which internally calls `idFromName(this.props.workspace_id)`. That binding guarantees `ctx.id.name === this.props.workspace_id` on the DO, so the guard passes for the legitimate MCP-server pathway.)
  - 04-validation (Phase 4's TOL-07 penetration test will exercise the idFromString attack vector from the Worker layer with a clean isolate — the second attack vector this guard handles that is not exercised in-pool here. See Attack Vector Coverage section below.)
  - "Every future Phase 2+ public method added to WorkspaceDO: convention is `private assertOwnsWorkspace(args.workspace_id)` as the literal first line, and a per-method positive test case in defense-in-depth.test.ts. CONTEXT.md Open Question O3 — this is the v0.1 mitigation against contributor drift (Phase 4 may add an ESLint rule)."

# Tech tracking
tech-stack:
  added: [] # No new deps. @modelcontextprotocol/sdk was added by Plan 00 Task 1 — Plan 06 wires the existing dep into index.ts for the first time.
  patterns:
    - "First-line guard convention: every public method on WorkspaceDO calls `this.assertOwnsWorkspace(args.workspace_id)` as the literal first executable line — before any query helper, before any sql.exec, before any state mutation. The verification is a single `grep -c 'this.assertOwnsWorkspace(args.workspace_id)' packages/workspace-do/src/index.ts` returning the public-method count (currently 7)."
    - "McpError + SDK ErrorCode reuse over custom error types: all workspace_id failures throw `new McpError(ErrorCode.InvalidRequest, message)` from `@modelcontextprotocol/sdk/types.js`. The SDK constant is the source of truth — the literal `-32600` is never hardcoded. Phase 3 (MCP-07) extends this to all tool failures so the error shape is consistent across the data plane and the protocol layer."
    - "ctx.id.name over state.id.name: the guard uses `this.ctx.id.name` (NOT `this.state.id.name`) — both are equivalent on the modern DurableObject base class (PATTERNS.md §C), but `ctx` matches the Phase 1 convention already adopted and matches the constructor's `ctx.storage.sql` accessor."
    - "Submodule SDK import path: `import { McpError, ErrorCode } from \"@modelcontextprotocol/sdk/types.js\"` — the `/types.js` submodule is the runtime-safe ESM export. A bare `@modelcontextprotocol/sdk` import would pull in HTTP transports that depend on `node:http` and break under workerd. Verified against the SDK's package.json exports field in 02-RESEARCH.md §4."
    - "Per-method positive case as drift defense (Open Question O3): defense-in-depth.test.ts has one positive `it(...)` block per public method. A future contributor adding a public method without the guard will have no positive case for it — the absence flags the omission at review time. This is the v0.1 mitigation; Phase 4 may add an ESLint rule (`engram-codestyle/workspace-do-guard-first-line`) for compiler-enforced coverage."
    - "Message-shape lock-in via sibling negative test: the McpError message format (`Workspace mismatch: DO bound to 'X' but request claims 'Y'`) is locked in by a dedicated `it(...)` block that asserts the literal 'Workspace mismatch' prefix + both id values appear in the message. A future refactor that drops either id name from the message breaks CI immediately — important because Phase 3 tool handlers will surface this message verbatim to MCP clients (debuggability matters more than terseness here)."
    - "Sync method invocation in tests: `expect(() => { ws.method(args); }).not.toThrow()` for positive cases and try/catch + `expect.fail()` for negative cases — the methods are synchronous per D-01, so `.rejects.toThrow()` would silently swallow the test (a Promise never settles for a non-Promise value). The eslint rule `@typescript-eslint/no-confusing-void-expression` requires explicit braces around void-returning arrows in the positive form (`() => { ws.insertBlock(...); }` not `() => ws.insertBlock(...)`)."

key-files:
  created: []
  modified:
    - "packages/workspace-do/src/index.ts (added private assertOwnsWorkspace method with full JSDoc; wired the guard as the first line of all 7 public methods; added McpError + ErrorCode import from @modelcontextprotocol/sdk/types.js; updated file-header Plan boundaries comment to reflect Plan 06 landing here)"
    - "packages/workspace-do/src/__tests__/defense-in-depth.test.ts (RED stub → 9 GREEN tests: 7 positive per-method + 2 negative; added Memory + InboxEntry fixtures; added asWorkspaceDO type-coercion shim mirroring helpers.test.ts; included an in-file ATTACK-VECTOR NOTE block documenting why the idFromString-rehydration vector cannot be exercised from a single in-pool test and is deferred to Phase 4 TOL-07)"

key-decisions:
  - "Did NOT ship the 9th 'idFromString round-trip throws' test described in the plan's optional bonus. The plan explicitly anticipated this: 'If the test pool's harness does not allow idFromString from a toString() round-trip cleanly, defer this to a code comment + Phase 4's TOL-07 penetration test from the Worker layer.' A standalone probe in this worktree confirmed `env.WORKSPACE.idFromString(env.WORKSPACE.idFromName('ws-alice').toString()).name === undefined` at runtime — so the guard correctly handles the case in production. But once a named DO is instantiated within a workerd test run, subsequent `env.WORKSPACE.get(rehydratedId).fetch(...)` calls route to the same single DO instance (workerd's 'one instance per underlying id' rule), so the cached instance retains `ctx.id.name === 'ws-alice'` and the guard does NOT throw. The attack vector IS reachable in production (a hostile request to a Worker with a fresh isolate gets a newly-constructed DO with `id.name === undefined`) — Phase 4 TOL-07 exercises it from the Worker layer with a clean isolate, which is the right scope. Replaced the 9th test with a message-shape lock-in sibling negative case that asserts the full McpError message format, locking in the contract Phase 3 will surface to MCP clients."
  - "Used `(caught as McpError).message` toContain assertions instead of a regex match for the error message shape. Rationale: the SDK's McpError constructor prefixes the message with 'MCP error -32600: ' (verified at runtime via `node --input-type=module -e \"import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; console.log(new McpError(ErrorCode.InvalidRequest, 'test').message)\"` → 'MCP error -32600: test'). A regex would couple the test to that prefix and break if the SDK ever changes the format; `toContain` checks for the substrings that matter ('Workspace mismatch', 'ws-actual', 'ws-claimed') and is robust to SDK formatting changes."
  - "Updated the file-header comment about Plan 02-06 to past-tense (Plan 06 lives in this file now, not in a future plan). Updated the section comment above the 7 methods from 'TODO Plan 06 markers are the explicit insertion points' to 'Plan 02-06 wired through: every method's first executable line is the assertOwnsWorkspace guard call'. These touch-ups (1) remove stale doc references, (2) ensure `grep -c 'TODO Plan 06'` returns 0 (acceptance criterion), and (3) bring the `grep -c 'this.assertOwnsWorkspace(args.workspace_id)'` count from 8 (7 code calls + 1 comment occurrence) down to the required exact 7."
  - "Used `expect(() => { stmt; }).not.toThrow()` with explicit braces for the two void-returning methods (insertBlock, createInboxEntry) per `@typescript-eslint/no-confusing-void-expression`. The shorter shorthand `() => ws.insertBlock(...)` is forbidden by the rule because it implicitly returns the `void` value of the call, making the arrow's return type ambiguous. Prettier then reformatted the lexicalSearchBlocks and listConflicts cases (also void-returning at runtime, but typed as returning a value) to single-line form. Both forms are lint-clean."

patterns-established:
  - "Guard-first-line convention: `this.assertOwnsWorkspace(args.workspace_id)` is the literal first executable line of every public method on WorkspaceDO. The convention is grep-verifiable, and a future contributor who forgets it will not have a per-method positive test case in defense-in-depth.test.ts — that's the v0.1 drift mitigation (Phase 4 may add an ESLint rule)."
  - "Per-method positive test cases as redundant-but-bulletproof coverage: the guard is uniform across all 7 methods (they all call `this.assertOwnsWorkspace(args.workspace_id)`), but each method gets its own positive case in defense-in-depth.test.ts. This is intentional drift defense — if a future method is added without the guard, the test for it will throw McpError(InvalidRequest) on a matching workspace_id (because the guard isn't there), failing the positive case immediately."
  - "McpError(ErrorCode.InvalidRequest, ...) for workspace_id failures: the SDK constant is the source of truth; the literal -32600 is never hardcoded in production code. Phase 3 (MCP-07) extends this to all tool failures so the error shape is consistent end-to-end."
  - "Test message-shape lock-in: when a thrown error's message is part of the public contract (Phase 3 tool handlers will surface it to MCP clients), add a dedicated `it(...)` block that asserts the message contains all required substrings (prefix, actual id, claimed id). This is a separate test from the canonical shape-lock (instance + .code), so a future refactor that drops the message contract fails CI without breaking the canonical assertion."

requirements-completed: [STO-07]

# Metrics
duration: ~16m
completed: 2026-05-25
---

# Phase 2 Plan 06: assertOwnsWorkspace Guard + Defense-in-Depth Tests Summary

**`WorkspaceDO` now enforces workspace ownership at every method call: a private `assertOwnsWorkspace(workspaceId)` throws `McpError(InvalidRequest = -32600)` when `this.ctx.id.name !== workspaceId`, wired as the literal first executable line of all 7 public methods. 9 GREEN tests cover the invariant — one positive case per public method (drift defense per Open Question O3) + 2 negative cases that lock in the McpError shape and the message format Phase 3 will surface to MCP clients. STO-07 + MT-1 verified at the data plane; the idFromString raw-hex attack vector is documented as deferred to Phase 4 TOL-07 from the Worker layer (workerd's test pool caches the named DO instance, making the in-pool reproduction unreachable from a single test).**

## Performance

- **Duration:** ~16m
- **Started:** 2026-05-26T01:22:22Z
- **Completed:** 2026-05-26T01:39:17Z
- **Tasks:** 2
- **Files modified:** 2
- **Commits:** 3 (1 feat for guard wiring, 1 test for the 9 GREEN cases, 1 docs for JSDoc header cleanup)

## Accomplishments
- `private assertOwnsWorkspace(workspaceId: string): void` method added to `WorkspaceDO` with full JSDoc citing the three Cloudflare DurableObjectId construction paths (idFromName / idFromString / newUniqueId) and the corresponding `id.name` semantics.
- `import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js"` added to `packages/workspace-do/src/index.ts` — the runtime-safe ESM submodule path, not a bare SDK import.
- All 7 public methods on `WorkspaceDO` (insertBlock, getBlock, lexicalSearchBlocks, deleteBlock, listMemoryTypes, createInboxEntry, listConflicts) now call `this.assertOwnsWorkspace(args.workspace_id)` as their literal first executable line — every `// TODO Plan 06` marker Plan 05 left has been replaced.
- `defense-in-depth.test.ts` filled with 9 GREEN tests: 7 positive cases (one per public method) + 1 canonical negative (McpError + InvalidRequest shape-lock) + 1 message-shape sibling negative (locks in the "Workspace mismatch: DO bound to 'X' but request claims 'Y'" format).
- Cross-phase drift surface documented in this SUMMARY's `affects` block: Phase 3 tool handlers MUST pass `this.props.workspace_id` (JWT-derived from the McpAgent session) to every WorkspaceDO method — never caller-provided input.
- Attack-vector coverage gap documented: the idFromString-rehydration path is correctly handled by the guard (verified via a standalone runtime probe in this worktree) but cannot be exercised from a single in-pool test because workerd caches the already-named DO instance. Phase 4 TOL-07 exercises it from the Worker layer with a clean isolate.
- Full Phase 2 vitest suite: 25 passing, 1 skipped (the skip is the deferred CI canary in blockconcurrency-lint.test.ts, unchanged from before this plan). `npm run typecheck`, `npm run lint`, and `npm run lint:blockconcurrency` all exit 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add assertOwnsWorkspace + wire to all 7 public methods** — `e675fd2` (feat)
2. **Task 2: Fill defense-in-depth.test.ts with 9 GREEN STO-07 cases** — `e248d42` (test)
3. **Task 2 doc cleanup: correct JSDoc header to match shipped test count** — `a9745a0` (docs)

(Task 2 was a single `test:` commit for the test file fill, followed by a small `docs:` commit to align the JSDoc header with the as-shipped test layout. No `refactor:` step was needed.)

## Files Created/Modified

**Modified:**
- `packages/workspace-do/src/index.ts` (+52 / -21 LOC) — added `assertOwnsWorkspace` private method with JSDoc; replaced 7 `// TODO Plan 06` markers with the actual guard call; added the SDK import; updated file-header `Plan boundaries` comment and the section comment above the 7 methods to past-tense.
- `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` (+257 / -48 LOC; net replacement of the RED stub) — 9 GREEN tests with Memory + InboxEntry fixtures, the `asWorkspaceDO` type-coercion shim, and an in-file ATTACK-VECTOR NOTE block documenting the deferred idFromString case.

**Created:** none.

## Decisions Made

See `key-decisions` in frontmatter. Summary:

1. **Did not ship the optional 9th `idFromString` test.** The plan anticipated this — workerd's test pool caches the named DO instance, making the in-pool reproduction of `id.name === undefined` unreachable from a single test. Replaced with a message-shape lock-in sibling negative case that adds value (locks the contract Phase 3 surfaces to clients).
2. **Used `toContain` instead of regex for message-shape assertions.** Robust to SDK formatting changes (e.g., the `MCP error -32600: ` prefix the SDK constructor adds).
3. **Updated file-header and section comments to past-tense.** Necessary to make `grep -c 'TODO Plan 06'` return 0 and `grep -c 'this.assertOwnsWorkspace(args.workspace_id)'` return exactly 7 (the count was 8 before the comment cleanup because the section comment quoted the guard call literally).
4. **Used explicit-brace `() => { stmt; }` form for void-returning expect-not-to-throw cases.** Required by `@typescript-eslint/no-confusing-void-expression`. Prettier reformatted the value-returning cases (lexicalSearchBlocks, listConflicts) back to single-line form because they don't trigger the rule; both forms are lint-clean.

## Deviations from Plan

**None — plan executed substantially as written, with one anticipated deferral.**

The plan's Task 2 description explicitly anticipated that the 9th `idFromString` round-trip test might not be reproducible in the workerd test pool and offered a documented fallback: "If the test pool's harness does not allow `idFromString` from a `toString()` round-trip cleanly, defer this to a code comment + Phase 4's TOL-07 penetration test from the Worker layer." I confirmed the unreachability via a standalone in-worktree probe (the named DO instance is cached across stubs to the same underlying id), removed the failing test, and added an ATTACK-VECTOR NOTE block in the test file documenting the gap and the Phase 4 coverage path. This is the planned deferral, not a deviation.

The lint fix-up (adding explicit braces around two void-returning arrow callbacks for `@typescript-eslint/no-confusing-void-expression`) was a Rule 3 auto-fix — the test file lint clean before that fix would have blocked the commit. Documented inline (no rule violation since this was the immediate path to GREEN lint, not a fix to pre-existing code).

## Issues Encountered

1. **First grep returned 8 instead of 7 for `this.assertOwnsWorkspace(args.workspace_id)`.** Root cause: the section comment above the 7 methods (Plan 05's authoring) contained a literal quote of the guard call in past-future tense ("Plan 06's guard wiring will prepend `this.assertOwnsWorkspace(args.workspace_id)`..."). Resolution: updated the comment to past tense — guard call is now wired, and no literal text in any comment references the precise grep string. Recount → 7. Same touch resolved `grep -c 'TODO Plan 06'` going from 1 (in the same comment block) to 0.

2. **Initial 9th test failed: "expected undefined to be an instance of McpError".** Root cause: workerd's `env.WORKSPACE.get(stub)` always routes to the same single DO instance keyed by the underlying hex id, regardless of how the id was constructed. Once `env.WORKSPACE.idFromName("ws-alice")` instantiates the DO, subsequent `env.WORKSPACE.get(env.WORKSPACE.idFromString(samehex))` calls return a stub that hits the already-constructed instance with `ctx.id.name === "ws-alice"` (not undefined). A standalone in-worktree probe confirmed that `idFromString(idFromName(x).toString()).name === undefined` at the id-API level, but the routing semantics make the attack reproducible only from a fresh isolate (Worker layer, not in-pool DO test). Resolution: documented as the planned-deferral case described above; replaced the test with a message-shape sibling negative.

3. **ESLint `@typescript-eslint/no-confusing-void-expression` fired on two arrow-shorthand callbacks.** Root cause: `insertBlock` and `createInboxEntry` return `void`, so `expect(() => ws.insertBlock(...)).not.toThrow()` ambiguously returns void from the arrow. Resolution: added explicit braces (`() => { ws.insertBlock(...); }`) per the rule's auto-fix suggestion. Both fixes preserved by prettier on commit.

## Threat Flags

None — the guard wiring closes a known threat surface (T-02-06-01 information disclosure via cross-workspace SQLite read) at the data plane. No new threat surface is introduced.

## Self-Check: PASSED

Verified each claim against the worktree state:

- **`packages/workspace-do/src/index.ts` exists** — confirmed.
- **`packages/workspace-do/src/__tests__/defense-in-depth.test.ts` exists** — confirmed.
- **Commit `e675fd2` (feat: assertOwnsWorkspace guard wiring) exists in branch history** — confirmed via `git log --oneline -5`.
- **Commit `e248d42` (test: 9 GREEN cases) exists** — confirmed.
- **Commit `a9745a0` (docs: JSDoc cleanup) exists** — confirmed.
- **`grep -c 'this.assertOwnsWorkspace(args.workspace_id)' packages/workspace-do/src/index.ts` returns 7** — confirmed.
- **`grep -c 'private assertOwnsWorkspace' packages/workspace-do/src/index.ts` returns 1** — confirmed.
- **`grep -c 'TODO Plan 06' packages/workspace-do/src/index.ts` returns 0** — confirmed.
- **`@modelcontextprotocol/sdk/types.js` literal substring present in `packages/workspace-do/src/index.ts`** — confirmed.
- **`McpError, ErrorCode` literal substring present in `packages/workspace-do/src/index.ts`** — confirmed.
- **`this.ctx.id.name` used (not `this.state.id.name`)** — confirmed in the assertion method body.
- **`npm run typecheck` exits 0** — confirmed.
- **`npm run lint` exits 0** — confirmed.
- **`npm run lint:blockconcurrency` exits 0** — confirmed (16 files checked, all clean — the guard call does not appear inside `blockConcurrencyWhile` because it is the first line of every method body, not part of the constructor's bootstrap block).
- **`npm test --workspace @engram/workspace-do -- --run` exits 0** — confirmed: 25 passed | 1 skipped (the skip is the deferred CI canary in blockconcurrency-lint, unchanged from before this plan).
- **9 defense-in-depth tests pass** — confirmed (7 positive per-method + 2 negative).
- **Helpers.test.ts still passes after guard wiring** — confirmed: all 7 helpers tests GREEN; no fixture updates needed because every test's `args.workspace_id` already matched its `idFromName` value (per Plan 05's forward-compatible contract).
- **McpError + ErrorCode shape verified at runtime** — `node --input-type=module -e "import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'; console.log(ErrorCode.InvalidRequest)"` outputs `-32600`.

## Cross-Phase Drift Surface (Important — Phase 3 readers)

**Phase 3 MCP tool handlers MUST pass `this.props.workspace_id` (the JWT-derived workspace id from the `McpAgent` session) as `args.workspace_id` to every WorkspaceDO method call.** Never pass caller-provided input directly to `args.workspace_id`.

The legitimate Phase 3 call pattern is:

```typescript
// Inside a Phase 3 MCP tool handler (EngramMcp.serve() session context):
const workspace_id = this.props.workspace_id; // JWT-derived, validated at the Worker layer
const stub = await getAgentByName(env.WORKSPACE, workspace_id);
//                                              ↑ binds the DO via idFromName, so ctx.id.name === workspace_id
const result = await stub.listMemoryTypes({ workspace_id });
//                                          ↑ guard passes because ctx.id.name === args.workspace_id
```

If a Phase 3 tool handler ever does this:

```typescript
// WRONG — caller-controlled value flows into args.workspace_id:
const result = await stub.listMemoryTypes({ workspace_id: request.params.workspace_id });
```

…then a hostile client can pass a workspace_id that doesn't match the JWT-bound DO. The guard will throw `McpError(InvalidRequest -32600)` — the data-plane backstop catches the bug — but the right behavior is for Phase 3 to never construct that args object in the first place. The guard is defense-in-depth, not the primary access-control mechanism.

## Attack Vector Coverage

This plan covers the two STO-07 attack vectors at the data plane:

| Vector | How it works | Phase 2 coverage | Phase 4 coverage |
|--------|--------------|------------------|------------------|
| Mismatched workspace_id arg | Caller resolves DO via legitimate `idFromName("ws-A")` but passes `args.workspace_id = "ws-B"`. Guard throws on mismatch. | 7 positive per-method tests + 2 negative tests (canonical shape + message format) in `defense-in-depth.test.ts`. **Fully tested in-pool.** | TOL-07 exercises end-to-end from the MCP tool surface to confirm Phase 3's wiring never produces the wrong args. |
| Raw-hex DO rehydration (`idFromString`) | Caller obtains DO via `env.WORKSPACE.idFromString(rawHex)` to bypass the JWT-derived name binding. `ctx.id.name === undefined` because the name is metadata on the DurableObjectId object, not encoded in the hex. Guard throws because `undefined !== any provided workspace_id`. | **Documented but not exercised in-pool** — workerd's test pool caches the named DO instance, so a subsequent `env.WORKSPACE.get(rehydratedId)` call routes to the already-named instance and the guard does NOT throw (the cached instance still has `ctx.id.name === "ws-alice"`). A standalone in-worktree probe confirmed `idFromString(idFromName(x).toString()).name === undefined` at the id-API level, so the guard handles the case correctly when reachable. | **Phase 4 TOL-07** exercises this from the Worker layer with a clean isolate, where a fresh `idFromString(hex)` call constructs a new DO with `id.name === undefined` and the guard throws as expected. This is the right scope for the assertion — the in-pool DO test can't synthesize a fresh isolate per test. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- STO-07 + MT-1 invariant complete at the data plane.
- All 7 WorkspaceDO public methods are now safe to expose to the Worker layer via RPC (the guard fires on the first executable line, before any sql.exec).
- Phase 3 MCP-07 will surface the `McpError(InvalidRequest -32600)` to MCP clients verbatim — the error shape and code are stable from this plan onward.
- Phase 3 should obtain the WorkspaceDO stub via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` (which internally calls `idFromName(this.props.workspace_id)`), so the guard passes for the legitimate MCP-server pathway. The plan-level test in defense-in-depth.test.ts confirms `ctx.id.name === args.workspace_id` is the success condition.
- Plan 02-07 (validation phase) inherits: 25 passing tests / 1 skipped / 0 failures in the workspace-do package; STO-07 marked complete in the phase requirements checklist.

---
*Phase: 02-workspacedo-sqlite*
*Plan: 06*
*Completed: 2026-05-26*
