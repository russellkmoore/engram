/**
 * RED stub — `packages/mcp-server/src/index.ts` (integration: OAuthProvider + EngramMcp).
 *
 * Wave 0 contract: this file declares 3 `it.skip` cases that document the
 * test surface Wave 3 (Plan 03-05 — index.ts integration) will turn GREEN.
 *
 * Wave 3 plan (03-05 — index.ts swap) will:
 *   1. Replace the Phase 1 `export default { fetch() }` block with
 *      `export default new OAuthProvider({ ... })` per RESEARCH §Pattern 2.
 *   2. Wire `EngramMcp.init()` to call `registerTools(this.server, () => this.props, this.env)`.
 *   3. Add the v2 migration entry + KV bindings to `wrangler.jsonc`.
 *   4. Replace each `it.skip(...)` below with `it(...)` + real body.
 *
 * Phase 3 Wave 0 publishes the `EngramProps` interface (see ../index.ts) but
 * does NOT swap the default export — that is Plan 05's job. These tests
 * remain RED until then.
 *
 * @module @engram/mcp-server/__tests__/index
 */
import { describe, it } from "vitest";

describe("index integration (Wave 3 RED — 03-05 GREEN)", () => {
  // Case 1: default export is an OAuthProvider instance
  // Wave 3 asserts: `import defaultExport from "../index.js"` returns an OAuthProvider
  //                 instance with the four expected endpoint paths bound — /authorize,
  //                 /token, /register, and the apiHandler routed to /mcp via MCP_OBJECT
  //                 (Pattern 2). The library-emitted /.well-known/* routes are not
  //                 asserted here (covered by RESEARCH §System Architecture Diagram).
  it.skip("default export is an OAuthProvider instance with /authorize, /token, /register, /mcp bindings", () => {
    // Wave 3 imports defaultExport from `../index.js`. The Phase 1 `export default { fetch() }`
    // block remains operational until Plan 05's swap; this case fires the moment Plan 05 ships.
  });

  // Case 2: EngramMcp.init() registers exactly 5 tools by name
  // Wave 3 asserts: an EngramMcp instance (constructed via runInDurableObject against
  //                 env.MCP_OBJECT) has called `registerTools(this.server, ..., this.env)`
  //                 during init(), and `this.server.listTools()` returns the 5 expected names.
  it.skip("EngramMcp.init() registers 5 tools — remember, recall, search, forget, ingest", () => {
    // Wave 3 uses the workerd-pool shell from `defense-in-depth.test.ts:101-107` against
    // env.MCP_OBJECT.idFromName(...) → runInDurableObject((instance) => { ... }).
  });

  // Case 3: wrangler.jsonc migrations include v1 (WorkspaceDO) and v2 (EngramMcp)
  // (D-09 — resolves Phase 2 D-07 forward-note)
  // Wave 3 asserts: reading the production wrangler.jsonc (NOT the test config) via fs
  //                 surfaces the two migration entries. This case is also covered by the
  //                 FND-08 lint script (`npm run lint:wrangler`), but having the assertion
  //                 in vitest gives Wave 3 a single GREEN signal for the full integration.
  it.skip("wrangler.jsonc migrations[] has v1 (WorkspaceDO) + v2 (EngramMcp) with new_sqlite_classes", () => {
    // Wave 3 reads `packages/mcp-server/wrangler.jsonc` via fs and asserts the migration shape.
    // OAuthProvider integration is the structural pin — this test gives Plan 05 a single
    // GREEN signal alongside the FND-08 lint.
  });
});
