---
phase: 03-mcp-server-scaffold
plan: 02
subsystem: mcp-server
tags: [mcp-server, zod-schemas, defense-in-depth, error-mapping, wave-1, green-transition]

# Dependency graph
requires:
  - phase: 03-mcp-server-scaffold
    plan: 01
    provides: "EngramProps interface published from packages/mcp-server/src/index.ts (Wave 0 cross-plan contract); zod@^4.0.0 + @modelcontextprotocol/sdk@^1.29.0 installed; vitest infra wired; schemas.test.ts RED stub with 6 it.skip cases (5 per-schema defense-in-depth + 1 aggregate barrel re-export)"
  - phase: 02-workspacedo-sqlite
    plan: 05
    provides: "NotFoundError class exported from @engram/workspace-do (single-row read miss signal); the message shape `${resource} not found: ${id}` consumed verbatim by mapToMcpError"
  - phase: 02-workspacedo-sqlite
    plan: 06
    provides: "assertOwnsWorkspace's McpError(-32600 InvalidRequest) — the pass-through case in mapToMcpError preserves this code unchanged across the tool boundary"
provides:
  - "packages/mcp-server/src/schemas.ts — 5 zod input schemas (Remember/Recall/Search/Forget/Ingest) + 5 z.infer<typeof X> type aliases; structurally enforces T-03-DD-IN (no workspace_id field)"
  - "packages/mcp-server/src/error-mapping.ts — mapToMcpError(err: unknown): McpError converter + file-local sanitize() helper; Phase 4 tool handlers import this for uniform exception → McpError conversion"
  - "packages/mcp-server/src/__tests__/schemas.test.ts — 16 GREEN assertions (3 describe blocks: defense-in-depth 6, happy paths 5, rejection paths 5); the Wave 0 it.skip stubs are fully replaced"
  - "packages/mcp-server/src/__tests__/error-mapping.test.ts — 7 GREEN assertions (dispatch 4 + sanitize 3); single-concern test file mirroring the Phase 2 per-module convention"
affects: [03-03-tool-stubs, 03-04-oauth, 03-05-index-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-written zod schemas as data-as-constants module (mirrors shared/schema/src/system-types.ts shape) — top-of-file JSDoc + the load-bearing `//` line-comment header that the structural grep relies on"
    - "Defense-in-depth contract encoded structurally — Object.keys(schema.shape) is the runtime guard, plus a `grep -v '^[[:space:]]*//'` source-level guard. Both fire on regression."
    - "Pass-through-first error converter — `if (err instanceof McpError) return err;` short-circuits the conversion so upstream WorkspaceDO codes (Phase 2 STO-07's -32600) reach the client unchanged"
    - "Single-concern test file convention — one test file per source file (error-mapping.test.ts is dedicated, not folded into schemas.test.ts) — matches Phase 2 packages/workspace-do/src/__tests__/ layout"

key-files:
  created:
    - "packages/mcp-server/src/schemas.ts"
    - "packages/mcp-server/src/error-mapping.ts"
    - "packages/mcp-server/src/__tests__/error-mapping.test.ts"
  modified:
    - "packages/mcp-server/src/__tests__/schemas.test.ts (Wave 0 → Wave 1 GREEN transition — 6 it.skip cases replaced + happy-path + rejection-path describe blocks added)"

key-decisions:
  - "Placed the load-bearing `workspace_id` contract phrase ONLY in the `//` line-comment header block (lines 41–48 of schemas.ts), NOT in the leading JSDoc block. The Wave 1 verify command (`grep -v '^[[:space:]]*//' schemas.ts | grep -c workspace_id`) strips `//` lines but NOT JSDoc lines that start with ` *`. Putting the phrase in JSDoc would have caused the structural check to falsely report contract violations. The JSDoc summary refers to 'the contract field name' instead — semantically equivalent without tripping the grep."
  - "Adjusted the truncation-cap test in error-mapping.test.ts to assert on the payload AFTER stripping the McpError SDK's `MCP error <code>: ` prefix. The McpError ctor prepends ~18 chars to the stored message string, so `output.message.length` is the sanitized 500 + the prefix length (~518). The T-03-LEAK contract is about bounding the caller-controlled portion, so the test extracts and measures that portion specifically."
  - "Did NOT export `sanitize` from error-mapping.ts. Plan called for it to be file-local, and the 3 sanitize cases assert behavior through `mapToMcpError(new Error(...))` (which calls sanitize internally) — sufficient coverage without expanding the public surface."

patterns-established:
  - "Two-layer comment for load-bearing contract phrases: leading JSDoc block describes the cross-phase intent in human prose (without the literal contract field name); a tightly-formatted `//` line-comment block directly below carries the field name + the regression-grep target. Future contributors editing the JSDoc don't break the structural check."
  - "Truncation assertions on McpError messages strip the SDK prefix before measuring — the McpError ctor prepends `MCP error <code>: ` and that prefix length is NOT under the converter's control."
  - "Per-module test file granularity for mcp-server matches workspace-do — schemas.ts has schemas.test.ts, error-mapping.ts has error-mapping.test.ts; do NOT fold cross-module assertions into a single suite."

requirements-completed: [MCP-06]
# Note: MCP-06 (5 tools registered with zod input schemas) was partially completed
# by Plan 03-01 (RED test surface in place). This plan ships the zod schemas
# themselves; the registerTools wiring lands in Plan 03-03 (Wave 2).

# Metrics
duration: 7m
completed: 2026-05-26
---

# Phase 3 Plan 02: Schemas + Error Mapping (Wave 1) Summary

**Wave 1 of Phase 3 is complete: 5 zod input schemas exported from `packages/mcp-server/src/schemas.ts` with the defense-in-depth structural invariant baked in, `mapToMcpError` + `sanitize` shipped from `packages/mcp-server/src/error-mapping.ts`, and `schemas.test.ts` flipped from RED (6 `it.skip`) to GREEN (16 real assertions) plus a new dedicated `error-mapping.test.ts` (7 assertions).**

## Outcome

- **23 new GREEN assertions** across two test files (16 in `schemas.test.ts`, 7 in `error-mapping.test.ts`). 0 `it.skip` / 0 `it.todo` in either file.
- **Defense-in-depth structurally enforced (T-03-DD-IN):** `Object.keys(schema.shape).indexOf('workspace_id') === -1` for all 5 schemas at runtime, AND `grep -v '^[[:space:]]*//' schemas.ts | grep -c workspace_id` returns 0 at the source level. Both layers fire on regression.
- **Error-mapping convention locked for Phase 4:** `mapToMcpError(err)` is the single converter Phase 4 tool handlers will wrap their `WorkspaceDO` calls in. Pass-through for `McpError`, `NotFoundError → InvalidParams (-32602)`, anything else → `InternalError (-32603)` with sanitized message.
- **T-03-LEAK mitigated:** `sanitize()` strips `/Users/...` filesystem paths, 32+ char hex strings, and caps the sanitized payload at 500 chars. All three scrubbers have dedicated test cases that fire on regression.

## Performance

- **Duration:** ~7 minutes
- **Started:** 2026-05-26T06:53:35Z (Task 1 file write)
- **Completed:** 2026-05-26T07:00:12Z (Task 3 commit)
- **Tasks:** 3 (all auto, tdd="true" — GREEN transition for Wave 0 RED stubs)
- **Files created:** 3 (`schemas.ts`, `error-mapping.ts`, `error-mapping.test.ts`)
- **Files modified:** 1 (`schemas.test.ts` — Wave 0 it.skip stubs replaced)
- **Commits:** 3 atomic per-task commits

## Task Commits

1. **Task 1: Create `packages/mcp-server/src/schemas.ts`** — `32f0082` (feat). 5 zod input schemas + 5 z.infer type aliases. CRITICAL DEFENSE-IN-DEPTH CONTRACT header. No schema declares workspace_id.
2. **Task 2: Create `packages/mcp-server/src/error-mapping.ts`** — `968e4d7` (feat). `mapToMcpError(err)` + file-local `sanitize(msg)`. NotFoundError → InvalidParams, anything else → InternalError sanitized.
3. **Task 3: Turn `schemas.test.ts` GREEN + add `error-mapping.test.ts`** — `959284b` (test). 23 assertions total across the two files; 0 `it.skip` remain.

## Files Created/Modified

### Created (3)

- **`packages/mcp-server/src/schemas.ts`** (90 lines) — 5 zod input schemas matching `@engram/types` canonical shapes where they overlap. Top-of-file JSDoc + the load-bearing `//` line-comment header (`CRITICAL DEFENSE-IN-DEPTH CONTRACT`) the structural grep targets. Body verbatim from `03-RESEARCH.md §Example 1` (lines 749–793).
- **`packages/mcp-server/src/error-mapping.ts`** (92 lines) — `mapToMcpError(err: unknown): McpError` exported; `sanitize(message: string): string` file-local. Body verbatim from `03-RESEARCH.md §Example 2` (lines 806–831). JSDoc style mirrors `packages/workspace-do/src/errors.ts` (single-purpose module with cross-phase contract pin).
- **`packages/mcp-server/src/__tests__/error-mapping.test.ts`** (96 lines) — 7 assertions across 2 describe blocks. Imports `McpError`, `ErrorCode`, `NotFoundError`, and `mapToMcpError`. Per-module file (not folded into `schemas.test.ts`) — matches Phase 2's one-source-one-test convention.

### Modified (1)

- **`packages/mcp-server/src/__tests__/schemas.test.ts`** (65 → 124 lines net) — Wave 0's 6 `it.skip` stubs replaced with 16 real `it(...)` assertions across 3 describe blocks (defense-in-depth 6, happy paths 5, rejection paths 5). Imports the 5 schemas from `../schemas.js`.

## Verification

All 4 verification steps from PLAN.md `<verification>` block pass:

1. **Full mcp-server test suite GREEN:**
   ```
   npm test --workspace=@engram/mcp-server -- --run
   Test Files  2 passed | 3 skipped (5)
        Tests  23 passed | 14 skipped (37)
   ```
   The 14 skipped tests are the Wave 2/3 RED stubs in `tools.test.ts` (7), `oauth.test.ts` (4), and `index.test.ts` (3). They are intentional — Plans 03-03/04/05 turn them GREEN.

2. **TypeScript compiles cleanly:**
   ```
   npx tsc -p packages/mcp-server/tsconfig.json --noEmit
   EXIT=0
   ```

3. **Structural defense-in-depth check (T-03-DD-IN):**
   ```
   grep -v '^[[:space:]]*//' packages/mcp-server/src/schemas.ts | grep -c workspace_id
   0
   ```
   The contract phrase appears ONLY in the `//`-comment header (which the grep strips). Zero matches in code or JSDoc.

4. **Phase 2 regression check (no cross-package breakage):**
   ```
   npm test --workspace=@engram/workspace-do -- --run
   Test Files  6 passed (6)
        Tests  25 passed | 1 skipped (26)
   ```
   workspace-do's 9+ defense-in-depth tests still GREEN; no regression from this plan's schema/error-mapping additions.

### Acceptance Criteria Per Task

**Task 1 (`schemas.ts`):**
- File exists ✓
- `import { z } from "zod"` ✓
- All 5 named schema exports (RememberInputSchema, RecallInputSchema, SearchInputSchema, ForgetInputSchema, IngestInputSchema) ✓
- All 5 z.infer type aliases ✓
- Header contains `CRITICAL DEFENSE-IN-DEPTH CONTRACT` ✓
- Non-comment `workspace_id` count = 0 ✓
- `npx tsc` exits 0 ✓
- Each schema has `.min(1)` on its primary required field ✓

**Task 2 (`error-mapping.ts`):**
- File exists ✓
- `export function mapToMcpError` ✓
- File-local `function sanitize` (NOT exported) ✓
- `import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js"` ✓
- `import { NotFoundError } from "@engram/workspace-do"` ✓
- `ErrorCode.InvalidParams` + `ErrorCode.InternalError` present ✓
- `slice(0, 500)` truncation ✓
- `/Users/[^\s]+/g` + `[a-f0-9]{32,}/g` regexes ✓
- `npx tsc` exits 0 ✓

**Task 3 (test files):**
- `schemas.test.ts` has NO `it.skip` / `it.todo` ✓
- All 5 schema names referenced ✓
- `not.toContain('workspace_id')` assertion present (T-03-DD-IN) ✓
- `error-mapping.test.ts` exists with `mapToMcpError`, `NotFoundError`, `ErrorCode.InvalidParams`, `ErrorCode.InternalError` + sanitize assertions (paths + hex) ✓
- 23 ≥ 11 assertions passing ✓
- 0 failed ✓

## Cross-Phase Contracts

### Pinned for Wave 2+ consumers

**Wave 2 (Plan 03-03 — tool stubs):** must import the 5 schemas from `./schemas.js`:

```typescript
import {
  RememberInputSchema, RecallInputSchema, SearchInputSchema,
  ForgetInputSchema, IngestInputSchema,
} from "./schemas.js";

server.registerTool("remember", {
  description: "...",
  inputSchema: RememberInputSchema.shape,   // ← .shape is the zod-to-MCP bridge
}, async (_args, _extra) => {
  throw new McpError(
    ErrorCode.MethodNotFound,
    "remember not implemented in Phase 3 — ships in Phase 4 (TOL-01)",
  );
});
```

The `.shape` property of each schema is the dictionary the `@modelcontextprotocol/sdk` `registerTool` API consumes for input validation. No code change in schemas.ts is needed when Plan 03-03 wires the tools — the schemas are ready as-is.

**Phase 4 (TOL-01..05) tool handlers:** must use the type aliases AND `mapToMcpError`:

```typescript
import type { RememberInput } from "./schemas.js";  // or `RememberInputSchema._output`
import { mapToMcpError } from "./error-mapping.js";

// Inside the tool callback:
async (args: RememberInput, _extra) => {
  try {
    const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
    // ... call stub.insertBlock({ workspace_id: props.workspace_id, ... })
  } catch (err) {
    throw mapToMcpError(err);   // ← uniform exception → McpError conversion
  }
}
```

The contract on `mapToMcpError`:
- `McpError` instances pass through unchanged (preserves Phase 2 STO-07's `-32600 InvalidRequest` semantics).
- `NotFoundError` → `McpError(-32602 InvalidParams)` with the discriminative `${resource} not found: ${id}` message.
- Everything else → `McpError(-32603 InternalError)` with sanitized message (no /Users/ paths, no 32+ char hex, ≤ 500 chars).

### T-03-DD-IN structurally enforced

Future-proofing: any contributor adding `workspace_id` to any of the 5 schemas breaks both:
- The runtime structural check: `Object.keys(schema.shape).indexOf('workspace_id') === -1` fails for the modified schema.
- The source-level grep: `grep -v '^[[:space:]]*//' schemas.ts | grep -c workspace_id` returns ≥ 1.

CI will fire on either layer the moment the regression lands.

## Threat Model Discharge

All threats from the plan's `<threat_model>` block are mitigated where this plan owns mitigation:

- **T-03-DD-IN (Tampering, schemas.ts):** Mitigated. Structural runtime check (`Object.keys(shape)` lacks `workspace_id`) + source-level grep both fire on regression. Schemas.test.ts case 6 (`barrel re-export: NO workspace_id field across the full schema set`) iterates all 5 schemas in one assertion block.
- **T-03-DD-RT (Tampering, deferred to Plan 03-03 tools.ts):** Inherited. This plan accepts the phase-level contract — Plan 03-03 owns the runtime grep that every tool callback reads `this.props.workspace_id` (never `args.workspace_id`).
- **T-03-LEAK (Information Disclosure, error-mapping.ts):** Mitigated. `sanitize()` runs three scrubbers in order: `/Users/[^\s]+/g` → `<path>`, `[a-f0-9]{32,}/g` → `<hex>`, `.slice(0, 500)`. Three dedicated test cases (path-strip, hex-strip, truncation-cap) cover each scrubber.
- **T-03-SC (Tampering, npm install audit):** Inherited from Plan 03-01. No new packages added in this plan — the dependencies (zod@^4.0.0, @modelcontextprotocol/sdk@^1.29.0, @engram/workspace-do workspace ref) were already installed in Wave 0.
- **T-03-JWT / T-03-PROPS / T-03-KV-LEAK:** Inherited (deferred to Plan 03-04 oauth.ts).

## Threat Flags

None. The new files introduce no security-relevant surface beyond what the threat model already documents.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `worker-configuration.d.ts` missing in worktree, blocks `npx tsc` typecheck**
- **Found during:** Task 1 verification (post-write `npx tsc -p packages/mcp-server/tsconfig.json --noEmit`)
- **Issue:** `error TS2688: Cannot find type definition file for './worker-configuration.d.ts'. The file is in the program because: Entry point of type library './worker-configuration.d.ts' specified in compilerOptions`. The `.gitignore` lists `**/worker-configuration.d.ts` (Phase 1 D-07 — codegen artifact). The Wave 0 SUMMARY confirms Plan 03-01 regenerated this file via `wrangler types` after upgrading the `EngramMcp` generic, but the worktree's per-agent branch was created from a base before the file existed in the working tree (worktrees do not carry gitignored files from the parent checkout).
- **Fix:** Ran `cd packages/mcp-server && npx wrangler types` to regenerate `worker-configuration.d.ts`. Output: `Types written to worker-configuration.d.ts` + cosmetic informational messages about Cloudflare type-source unification. Typecheck immediately passed.
- **Files modified:** None tracked (the regenerated `.d.ts` stays gitignored — same posture as Phase 2 / Plan 03-01).
- **Verification:** `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0 in this worktree from Task 1 onward.
- **Committed in:** N/A — no source change, just a worktree-local codegen regeneration that the orchestrator's verify step will reproduce.

**2. [Rule 1 - Bug] T-03-LEAK truncation test asserted against the wrong slice of the McpError message**
- **Found during:** Task 3 first test run
- **Issue:** The initial assertion was `expect(output.message.length).toBeLessThanOrEqual(500)`. Vitest reported `AssertionError: expected 518 to be less than or equal to 500`. Diagnosis: the `@modelcontextprotocol/sdk` `McpError` constructor prepends `MCP error <code>: ` (~18 characters) to the stored `.message` field. `sanitize()` correctly truncated the caller-supplied payload to 500 chars, but the McpError's exposed `.message` was prefix + payload = 518.
- **Fix:** Updated the test to strip the SDK's `MCP error <ErrorCode.InternalError>: ` prefix BEFORE measuring the length. The T-03-LEAK contract is about bounding the caller-controlled portion (which is what `sanitize` owns), so the test asserts on the unprefixed payload specifically. Added an inline comment to the test explaining the SDK prefix exemption.
- **Files modified:** `packages/mcp-server/src/__tests__/error-mapping.test.ts`
- **Verification:** Re-ran `npm test --workspace=@engram/mcp-server -- --run` — 23/23 passed.
- **Committed in:** `959284b` (Task 3 — fix was made before the commit was created).

**3. [Rule 1 - Bug] JSDoc block in schemas.ts inadvertently contained the literal `workspace_id` token**
- **Found during:** Task 1 acceptance check (post-write `grep -v '^[[:space:]]*//' schemas.ts | grep -c workspace_id`)
- **Issue:** The first draft of `schemas.ts` had two layers of documentation: a leading JSDoc block (`/** ... */`) AND the load-bearing `//` line-comment header. Both layers explicitly mentioned the `workspace_id` field name. The acceptance grep (`grep -v '^[[:space:]]*//'`) strips ONLY `//` line comments, not JSDoc block lines starting with ` * ` — so the JSDoc mentions caused the structural check to falsely report 3 contract-violation matches.
- **Fix:** Removed all `workspace_id` mentions from the JSDoc block. The JSDoc now refers to "the contract field name" in prose; the `//` line-comment block directly below retains the literal `workspace_id` mentions where they belong. The structural grep target is preserved (load-bearing for future contributors), and the structural check now correctly returns 0.
- **Files modified:** `packages/mcp-server/src/schemas.ts`
- **Verification:** `grep -v '^[[:space:]]*//' packages/mcp-server/src/schemas.ts | grep -c workspace_id` returns 0.
- **Committed in:** `32f0082` (Task 1 — fix was made before the commit was created).

### No Architectural Deviations

No Rule 4 (architectural-change) deviations. All three fixes are mechanical:
- Deviation 1 regenerates a gitignored codegen file — no source change.
- Deviation 2 adjusts a test assertion to measure the right slice of the output.
- Deviation 3 moves the load-bearing contract phrase from JSDoc into the comment header where the structural grep expects it.

### Deferred Issues

**Pre-existing: `npm test --workspaces` reports "Missing script: test" for `@engram/schema` and `@engram/types`.** Those workspaces are pure data/type packages with no test script defined (Phase 1 condition). Not in scope for this plan to fix — Phase 1 / future plan can add `"test": "exit 0"` placeholders if a CI gate requires it.

**Cosmetic: `wrangler types` emits a deprecation warning about `@cloudflare/workers-types`.** Out of scope — Phase 1 D-07 chose the workers-types posture, and unifying onto the new generated-runtime types would touch every package's tsconfig. Future plan / Phase 4 can address.

## Known Stubs

None introduced by this plan. The 14 still-skipped tests in `tools.test.ts`, `oauth.test.ts`, and `index.test.ts` are pre-existing Wave 0 RED stubs that Plans 03-03 / 03-04 / 03-05 will turn GREEN — they are documented in `03-01-SUMMARY.md` as intentional handoffs.

## Self-Check

Verified before composing this summary:

- `[ -f packages/mcp-server/src/schemas.ts ]` → **FOUND**
- `[ -f packages/mcp-server/src/error-mapping.ts ]` → **FOUND**
- `[ -f packages/mcp-server/src/__tests__/error-mapping.test.ts ]` → **FOUND**
- `git log --oneline | grep -q "32f0082"` (Task 1) → **FOUND**
- `git log --oneline | grep -q "968e4d7"` (Task 2) → **FOUND**
- `git log --oneline | grep -q "959284b"` (Task 3) → **FOUND**
- `npm test --workspace=@engram/mcp-server -- --run` exits 0 (23 passed, 0 failed) → **PASS**
- `npx tsc -p packages/mcp-server/tsconfig.json --noEmit` exits 0 → **PASS**
- `grep -v '^[[:space:]]*//' packages/mcp-server/src/schemas.ts | grep -c workspace_id` returns 0 → **PASS** (T-03-DD-IN structural check)
- `grep -E "it\\.skip|it\\.todo" packages/mcp-server/src/__tests__/schemas.test.ts` returns nothing → **PASS**
- `grep -E "it\\.skip|it\\.todo" packages/mcp-server/src/__tests__/error-mapping.test.ts` returns nothing → **PASS**
- `npm test --workspace=@engram/workspace-do -- --run` exits 0 (25 passed) → **PASS** (no Phase 2 regression)
- `grep -q "export function mapToMcpError" packages/mcp-server/src/error-mapping.ts` → **PASS**
- `! grep -q "export.*sanitize" packages/mcp-server/src/error-mapping.ts` → **PASS** (sanitize is file-local)

## Self-Check: PASSED

## Next Plans

Both Wave 2 plans can now proceed in parallel — they are independent and consume this plan's outputs:

- **Plan 03-03 (tool stubs — `tools.ts`):** consumes the 5 zod schemas from `schemas.ts` (via `RememberInputSchema.shape` etc. for `registerTool`'s `inputSchema` field) and the 7 RED stubs in `tools.test.ts`. Will create `packages/mcp-server/src/tools.ts` with 5 `registerTool` calls that throw `McpError(MethodNotFound)` with phase-pinned messages.
- **Plan 03-04 (oauth — `oauth.ts`):** consumes nothing from this plan directly, but the `mapToMcpError` helper is available if `oauth.ts` needs to map an exception across the trust boundary in the future. Wave 2 OAuth wiring will create `packages/mcp-server/src/oauth.ts` and turn the 4 RED stubs in `oauth.test.ts` GREEN.

Plan 03-05 (Wave 3 — `index.ts` integration swap) consumes the outputs of both Wave 2 plans plus this plan's `mapToMcpError` and `schemas.ts`. Plan 03-06 (deploy + README) is unaffected.

---

*Phase: 03-mcp-server-scaffold*
*Plan: 02 (Wave 1 — schemas + error-mapping + GREEN transition)*
*Completed: 2026-05-26*
