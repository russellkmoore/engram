/**
 * RED stub — `packages/mcp-server/src/schemas.ts` (zod input schemas).
 *
 * Wave 0 contract: this file declares 6 `it.skip` cases that document the
 * test surface Wave 1 will turn GREEN. Vitest collects skipped tests without
 * importing the (as-yet-nonexistent) `../schemas.js` module, so the test
 * collection step never fails on a missing import.
 *
 * Wave 1 plan (03-02 — schemas + error-mapping) will:
 *   1. Create `packages/mcp-server/src/schemas.ts` exporting the 5 zod
 *      schemas + `z.infer` type aliases (RESEARCH §Example 1 verbatim shape).
 *   2. Replace each `it.skip(...)` below with `it(...)` + real body that
 *      imports `RememberInputSchema` etc. from `../schemas.js`, asserts
 *      `Object.keys(schema.shape).indexOf('workspace_id') === -1`, and
 *      asserts `schema.parse(validInput).success === true`.
 *
 * CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
 * NONE of the 5 schemas may declare a `workspace_id` field. The workspace
 * is derived from the JWT's `this.props.workspace_id` at the handler layer,
 * NEVER from tool input. A future contributor adding `workspace_id` to any
 * schema below is breaking the defense-in-depth invariant — case 6 below
 * (`barrel re-export shape`) is also where Wave 1 lands the structural
 * assertion that fires on regression.
 *
 * @module @engram/mcp-server/__tests__/schemas
 */
import { describe, it } from "vitest";

describe("schemas (Wave 1 RED — 03-02 GREEN)", () => {
  // Case 1: remember tool input schema
  // Wave 1 asserts: Object.keys(RememberInputSchema.shape).indexOf('workspace_id') === -1
  //                 AND RememberInputSchema.parse({ content: "..." }).success === true
  it.skip("RememberInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    // Wave 1 imports `RememberInputSchema` from `../schemas.js` and runs the structural assertion.
  });

  // Case 2: recall tool input schema
  it.skip("RecallInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    // Wave 1 imports `RecallInputSchema` from `../schemas.js`.
  });

  // Case 3: search tool input schema
  it.skip("SearchInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    // Wave 1 imports `SearchInputSchema` from `../schemas.js`.
  });

  // Case 4: forget tool input schema
  it.skip("ForgetInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    // Wave 1 imports `ForgetInputSchema` from `../schemas.js`.
  });

  // Case 5: ingest tool input schema
  it.skip("IngestInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    // Wave 1 imports `IngestInputSchema` from `../schemas.js`.
  });

  // Case 6: barrel re-export shape — defense-in-depth contract lock-in
  // Wave 1 asserts: the module exports exactly 5 schemas + 5 z.infer<typeof X> type aliases
  //                 AND none of the 5 schemas has a `workspace_id` key in its .shape
  it.skip("barrel re-export: 5 schemas + 5 z.infer type aliases, NO `workspace_id` field across the set", () => {
    // Wave 1 iterates [Remember, Recall, Search, Forget, Ingest]InputSchema and asserts the
    // defense-in-depth invariant (MCP-05 / STO-07) for the full set.
  });
});
