/**
 * RED stub — `packages/mcp-server/src/tools.ts` (5 v0.1 tool stubs).
 *
 * Wave 0 contract: this file declares 7 `it.skip` cases that document the
 * test surface Wave 2 will turn GREEN. Vitest collects skipped tests without
 * importing the (as-yet-nonexistent) `../tools.js` module.
 *
 * Wave 2 plan (03-03 — tool stubs) will:
 *   1. Create `packages/mcp-server/src/tools.ts` exporting
 *      `registerTools(server, getProps, env)` that calls
 *      `server.registerTool(name, { inputSchema }, cb)` 5 times — each
 *      callback throws `McpError(ErrorCode.MethodNotFound)` with a message
 *      pinned to "Phase 3" + "Phase 4 (TOL-0N)" (D-05).
 *   2. Replace each `it.skip(...)` below with `it(...)` + real body using
 *      the canonical `try/catch + instanceof McpError + .code === ...` shape
 *      mirrored from `packages/workspace-do/src/__tests__/defense-in-depth.test.ts:180-197`.
 *
 * The Phase-pinned message contract (D-05) is asserted in every per-tool case:
 *   - error.message contains "Phase 3"
 *   - error.message contains "Phase 4 (TOL-01)" (etc. per tool)
 *
 * This is the canonical "assert McpError thrown" pattern in this repo —
 * `MethodNotFound` swapped in for Phase 2's `InvalidRequest`.
 *
 * Defense-in-depth contract (T-03-DD-RT, inherited from Phase 2 STO-07):
 * Case 7 (`no tool callback reads args.workspace_id`) is the structural
 * guard that fires on regression — if a future contributor passes
 * `args.workspace_id` from caller input instead of `this.props.workspace_id`
 * from the JWT, this case fails. Wave 2 implements this as a grep-style
 * source-code assertion (the production grep is documented in T-03-DD-RT).
 *
 * @module @engram/mcp-server/__tests__/tools
 */
import { describe, it } from "vitest";

describe("tools (Wave 2 RED — 03-03 GREEN)", () => {
  // Cases 1-5: each of the 5 v0.1 tools throws McpError(MethodNotFound)
  // with a message pinned to the Phase 3 → Phase 4 (TOL-0N) contract.
  // Pattern source: `defense-in-depth.test.ts:180-197` (try/catch +
  // instanceof McpError + .code === ErrorCode.MethodNotFound + message
  // .toContain("Phase 3") + .toContain("Phase 4 (TOL-01)") shape).

  it.skip("remember throws McpError(MethodNotFound) with 'Phase 3 — ships in Phase 4 (TOL-01)' message", () => {
    // Wave 2 imports `registerTools` from `../tools.js`, invokes the registered `remember`
    // callback, and asserts the thrown McpError matches the contract.
  });

  it.skip("recall throws McpError(MethodNotFound) with 'Phase 3 — ships in Phase 4 (TOL-02)' message", () => {
    // Wave 2 mirrors the `remember` case for `recall`.
  });

  it.skip("search throws McpError(MethodNotFound) with 'Phase 3 — ships in Phase 4 (TOL-03)' message", () => {
    // Wave 2 mirrors the `remember` case for `search`.
  });

  it.skip("forget throws McpError(MethodNotFound) with 'Phase 3 — ships in Phase 4 (TOL-04)' message", () => {
    // Wave 2 mirrors the `remember` case for `forget`.
  });

  it.skip("ingest throws McpError(MethodNotFound) with 'Phase 3 — ships in Phase 4 (TOL-05)' message", () => {
    // Wave 2 mirrors the `remember` case for `ingest`.
  });

  // Case 6: tool count assertion — registerTools must register exactly 5 tools
  // by name (remember, recall, search, forget, ingest). Closes the surface.
  it.skip("registerTools registers exactly 5 tools by name: remember, recall, search, forget, ingest", () => {
    // Wave 2 imports `registerTools`, calls it against a fresh `new McpServer(...)`, and asserts
    // `server.listTools()` returns the 5 expected names (sorted comparison).
  });

  // Case 7: defense-in-depth — no callback reads `args.workspace_id` (T-03-DD-RT)
  // Wave 2 lands this as a source-code grep assertion: every tool callback in
  // `tools.ts` references `this.props.workspace_id` (or `getProps().workspace_id`),
  // NEVER `args.workspace_id`. This is the structural lock-in on STO-07 inheritance.
  it.skip("no tool callback reads args.workspace_id (T-03-DD-RT defense-in-depth)", () => {
    // Wave 2 reads `../tools.ts` source via fs and asserts `args.workspace_id` does NOT appear.
  });
});
