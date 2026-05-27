/**
 * RED → GREEN (Plan 04-02) — `packages/mcp-server/src/envelope.ts` builders + META_GAPS.
 *
 * Wave 0 tests that will go GREEN when Plan 04-02 ships `envelope.ts`. Until
 * then every `import` below fails with "Cannot find module '../envelope.js'"
 * which is the expected RED failure mode (T-04-RED-MIRROR — no production secrets
 * are surfaced by a missing-module message).
 *
 * Cross-phase contract:
 * - **Phase 4 D-04 (honest stubs):** every builder returns a fully-shaped
 *   `EngramResponse<T>` with all envelope fields PRESENT (even if null/empty).
 *   TOL-06 is satisfied when every it() in the first describe block passes.
 * - **Phase 4 D-06 (remember stub):** `buildRememberResponse` returns
 *   `result.extracted_fields = {}`, `result.confidence = null`,
 *   `meta.confidence = null`, `meta.coverage = null`.
 * - **Phase 4 D-07 (recall stub):** `buildRecallResponse` returns
 *   `result.synthesis = null`; `result.chunks` present when verbosity is
 *   "chunks" or "both", absent when "synthesis".
 * - **Phase 4 D-08 (empty conflicts):** `context.conflicts = []` on every builder.
 * - **Phase 4 D-10 (META_GAPS frozen):** `META_GAPS` is byte-deterministic at v0.1;
 *   snapshot lock ensures MCP-08 token-budget tests can reproduce exact byte counts.
 *
 * Design notes (locked):
 * - No `runInDurableObject` — pure unit test over typed function outputs (no DO runtime).
 * - `buildRememberResponse`, `buildRecallResponse`, `buildSearchResponse`,
 *   `buildForgetResponse`, `buildIngestResponse` are the 5 builder exports from
 *   envelope.ts (Plan 04-02 deliverable).
 * - `META_GAPS` is a frozen const exported from envelope.ts.
 * - `trimToBudget` and `wrapMcpContent` are also exported (tested in token-budget.test.ts).
 * - `suggestions` field MUST be absent (not present-with-undefined) per D-04.
 *
 * Threat model:
 * - **T-04-RED-MIRROR (Information Disclosure):** RED failure message is
 *   "Cannot find module '../envelope.js'" — no DB internals, env values, or
 *   stack traces are surfaced. Acceptable per plan threat register disposition: accept.
 *
 * @module @engram/mcp-server/__tests__/envelope
 */
// packages/mcp-server/src/__tests__/envelope.test.ts
// Source: 04-CONTEXT.md D-04/D-06/D-07/D-08/D-10 + PATTERNS.md §envelope.test.ts.
//
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
// Rationale: envelope.ts does not exist yet (Plan 04-02 deliverable). TypeScript
// resolves all imports from ../envelope.js as `error`-typed, triggering no-unsafe-*
// rules. These tests are intentionally RED until Plan 04-02 ships. The disable
// comments are scoped to this file only and will be removed when envelope.ts exists.
import { describe, it, expect } from "vitest";

// These imports are RED until Plan 04-02 ships envelope.ts.
// Expected RED failure: "Cannot find module '../envelope.js'"
import {
  buildRememberResponse,
  buildRecallResponse,
  buildSearchResponse,
  buildForgetResponse,
  buildIngestResponse,
  META_GAPS,
} from "../envelope.js";

// ---------------------------------------------------------------------------
// envelope builders (TOL-06: every response has all envelope fields PRESENT)
// ---------------------------------------------------------------------------

describe("envelope builders (TOL-06: every response has all envelope fields PRESENT even if null/empty)", () => {
  it("buildRememberResponse returns EngramResponse with result + context + meta (D-06)", () => {
    const envelope = buildRememberResponse({ id: "abc", classified_type: null });
    // Structural: all top-level keys present
    expect(envelope).toHaveProperty("result");
    expect(envelope).toHaveProperty("context");
    expect(envelope).toHaveProperty("meta");
    // result fields (D-06 honest-stub)
    expect(envelope.result.id).toBe("abc");
    expect(envelope.result.classified_type).toBeNull();
    expect(envelope.result.extracted_fields).toEqual({});
    expect(envelope.result.confidence).toBeNull();
    // context (D-08 empty contract)
    expect(envelope.context.related).toEqual([]);
    expect(envelope.context.entities).toEqual([]);
    expect(envelope.context.conflicts).toEqual([]);
    // meta (D-06 honest-stub + Task 2 number|null widening)
    expect(envelope.meta.confidence).toBeNull();
    expect(envelope.meta.coverage).toBeNull();
    expect(typeof envelope.meta.last_updated).toBe("number");
    expect(isFinite(envelope.meta.last_updated)).toBe(true);
    expect(Array.isArray(envelope.meta.gaps)).toBe(true);
    expect(envelope.meta.gaps.length).toBeGreaterThan(0);
    expect(envelope.meta.gaps).toContain(META_GAPS.remember[0]);
  });

  it("buildRecallResponse(verbosity=synthesis) returns synthesis=null, chunks absent (D-07)", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "synthesis" });
    expect(envelope).toHaveProperty("result");
    expect(envelope).toHaveProperty("context");
    expect(envelope).toHaveProperty("meta");
    // result fields (D-07 honest-stub)
    expect(envelope.result.memories).toEqual([]);
    expect(envelope.result.synthesis).toBeNull();
    // verbosity="synthesis" → chunks ABSENT (not present-with-undefined)
    expect(Object.prototype.hasOwnProperty.call(envelope.result, "chunks")).toBe(false);
    // context (D-08)
    expect(envelope.context.related).toEqual([]);
    expect(envelope.context.entities).toEqual([]);
    // meta
    expect(envelope.meta.confidence).toBeNull();
    expect(envelope.meta.coverage).toBeNull();
  });

  it("buildRecallResponse(verbosity=both) surfaces result.chunks as an array (D-07)", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "both" });
    // verbosity="both" → chunks IS defined and is an array
    expect(Object.prototype.hasOwnProperty.call(envelope.result, "chunks")).toBe(true);
    expect(Array.isArray(envelope.result.chunks)).toBe(true);
  });

  it("buildRecallResponse(verbosity=chunks) surfaces result.chunks as an array (D-07)", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "chunks" });
    expect(Object.prototype.hasOwnProperty.call(envelope.result, "chunks")).toBe(true);
    expect(Array.isArray(envelope.result.chunks)).toBe(true);
  });

  it("buildSearchResponse returns result.count and result.memories", () => {
    const envelope = buildSearchResponse({ memories: [], count: 0 });
    expect(envelope).toHaveProperty("result");
    expect(envelope.result.count).toBe(0);
    expect(envelope.result.memories).toEqual([]);
    expect(envelope.context.related).toEqual([]);
    expect(envelope.context.entities).toEqual([]);
  });

  it("buildForgetResponse echoes blocks_deleted=0 (Pitfall 4: echo truth, do not throw on bogus id)", () => {
    const envelope = buildForgetResponse({ blocks_deleted: 0, relations_deleted: 0 });
    expect(envelope).toHaveProperty("result");
    expect(envelope.result.blocks_deleted).toBe(0);
    expect(envelope.result.relations_deleted).toBe(0);
    // forget has empty meta.gaps (no AI stubs to explain)
    expect(envelope.meta.gaps).toEqual(META_GAPS.forget);
  });

  it("buildIngestResponse returns status='accepted' and a job_id (D-05)", () => {
    const envelope = buildIngestResponse({ job_id: "uuid-here" });
    expect(envelope).toHaveProperty("result");
    expect(envelope.result.status).toBe("accepted");
    expect(envelope.result.job_id).toBe("uuid-here");
    expect(envelope.meta.gaps).toContain(META_GAPS.ingest[0]);
  });
});

// ---------------------------------------------------------------------------
// META_GAPS byte-determinism (D-10 paragraph 3 — fixture stability)
// ---------------------------------------------------------------------------

describe("META_GAPS byte-determinism (D-10 fixture stability)", () => {
  it("META_GAPS strings are frozen at v0.1 — snapshot lock for MCP-08 fixture reproducibility", () => {
    // This snapshot lock means changing any META_GAPS string will fail CI.
    // The MCP-08 token-budget tests depend on exact byte counts; changing
    // these strings would invalidate the budget worst-case fixtures.
    expect(META_GAPS).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// suggestions field omission (D-04 honest-stub — absent, NOT present-with-undefined)
// ---------------------------------------------------------------------------

describe("suggestions field omission (D-04 honest-stub)", () => {
  it("buildRememberResponse does NOT include 'suggestions' key in envelope", () => {
    const envelope = buildRememberResponse({ id: "abc", classified_type: null });
    expect(Object.keys(envelope)).not.toContain("suggestions");
  });

  it("buildRecallResponse does NOT include 'suggestions' key in envelope", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "synthesis" });
    expect(Object.keys(envelope)).not.toContain("suggestions");
  });

  it("buildSearchResponse does NOT include 'suggestions' key in envelope", () => {
    const envelope = buildSearchResponse({ memories: [], count: 0 });
    expect(Object.keys(envelope)).not.toContain("suggestions");
  });

  it("buildForgetResponse does NOT include 'suggestions' key in envelope", () => {
    const envelope = buildForgetResponse({ blocks_deleted: 0, relations_deleted: 0 });
    expect(Object.keys(envelope)).not.toContain("suggestions");
  });

  it("buildIngestResponse does NOT include 'suggestions' key in envelope", () => {
    const envelope = buildIngestResponse({ job_id: "some-uuid" });
    expect(Object.keys(envelope)).not.toContain("suggestions");
  });
});
