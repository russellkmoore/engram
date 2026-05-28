/**
 * GREEN — `packages/mcp-server/src/schemas.ts` (zod input schemas).
 *
 * Wave 1 (Plan 03-02) turn-up: every Wave 0 pending stub is replaced by a
 * real `it(...)` body. The 5 per-schema cases assert the structural defense-in-depth
 * invariant (`Object.keys(schema.shape).indexOf('workspace_id') === -1`) AND
 * happy-path parsing; the aggregate case fires the same assertion across all
 * 5 schemas in one block (regression-proof for "what if someone adds a 6th
 * schema later").
 *
 * Layout: 3 describe blocks
 *   - defense-in-depth (T-03-DD-IN): per-schema structural check (5 cases)
 *     + aggregate cross-schema structural check (1 case) — 6 cases total
 *   - happy paths: each schema parses a minimal valid input (5 cases)
 *   - rejection paths: schemas reject obvious bad inputs (5 cases)
 *
 * Total: 16 assertions.
 *
 * CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
 * NONE of the 5 schemas may declare a `workspace_id` field. The workspace
 * is derived from the JWT's `this.props.workspace_id` at the handler layer,
 * NEVER from tool input. A regression that adds the field to any schema
 * fails this suite immediately.
 *
 * @module @engram/mcp-server/__tests__/schemas
 */
import { describe, it, expect } from "vitest";

import {
  RememberInputSchema,
  RecallInputSchema,
  SearchInputSchema,
  ForgetInputSchema,
  IngestInputSchema,
} from "../schemas.js";

describe("schemas defense-in-depth (T-03-DD-IN / MCP-05 / Phase 2 STO-07)", () => {
  // Case 1: remember tool input schema
  it("RememberInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    expect(Object.keys(RememberInputSchema.shape)).not.toContain("workspace_id");
    expect(RememberInputSchema.safeParse({ content: "hello" }).success).toBe(true);
  });

  // Case 2: recall tool input schema
  it("RecallInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    expect(Object.keys(RecallInputSchema.shape)).not.toContain("workspace_id");
    expect(RecallInputSchema.safeParse({ query: "x" }).success).toBe(true);
  });

  // Case 3: search tool input schema
  it("SearchInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    expect(Object.keys(SearchInputSchema.shape)).not.toContain("workspace_id");
    expect(SearchInputSchema.safeParse({ query: "x" }).success).toBe(true);
  });

  // Case 4: forget tool input schema
  it("ForgetInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    expect(Object.keys(ForgetInputSchema.shape)).not.toContain("workspace_id");
    expect(ForgetInputSchema.safeParse({ id: "abc" }).success).toBe(true);
  });

  // Case 5: ingest tool input schema
  it("IngestInputSchema has NO `workspace_id` field (defense-in-depth) and parses valid input", () => {
    expect(Object.keys(IngestInputSchema.shape)).not.toContain("workspace_id");
    expect(IngestInputSchema.safeParse({ source: "https://example.com" }).success).toBe(true);
  });

  // Case 6: aggregate cross-schema structural lock-in
  it("barrel re-export: NO `workspace_id` field across the full schema set", () => {
    const schemas = [
      { name: "RememberInputSchema", schema: RememberInputSchema },
      { name: "RecallInputSchema", schema: RecallInputSchema },
      { name: "SearchInputSchema", schema: SearchInputSchema },
      { name: "ForgetInputSchema", schema: ForgetInputSchema },
      { name: "IngestInputSchema", schema: IngestInputSchema },
    ] as const;
    expect(schemas).toHaveLength(5);
    for (const { schema } of schemas) {
      expect(Object.keys(schema.shape)).not.toContain("workspace_id");
    }
  });
});

describe("schemas happy paths", () => {
  it("RememberInputSchema parses minimal valid input", () => {
    expect(RememberInputSchema.safeParse({ content: "hello" }).success).toBe(true);
  });

  it("RecallInputSchema parses minimal valid input", () => {
    expect(RecallInputSchema.safeParse({ query: "x" }).success).toBe(true);
  });

  it("SearchInputSchema parses minimal valid input", () => {
    expect(SearchInputSchema.safeParse({ query: "x" }).success).toBe(true);
  });

  it("ForgetInputSchema parses minimal valid input", () => {
    expect(ForgetInputSchema.safeParse({ id: "abc" }).success).toBe(true);
  });

  it("IngestInputSchema parses minimal valid input", () => {
    expect(IngestInputSchema.safeParse({ source: "https://example.com" }).success).toBe(true);
  });
});

describe("schemas rejection paths", () => {
  it("RememberInputSchema rejects empty content (min(1))", () => {
    expect(RememberInputSchema.safeParse({ content: "" }).success).toBe(false);
  });

  it("RememberInputSchema rejects non-datetime expires", () => {
    expect(RememberInputSchema.safeParse({ content: "hello", expires: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("RecallInputSchema rejects non-enum scope", () => {
    expect(RecallInputSchema.safeParse({ query: "x", scope: "global" }).success).toBe(false);
  });

  it("RecallInputSchema rejects non-positive limit", () => {
    expect(RecallInputSchema.safeParse({ query: "x", limit: 0 }).success).toBe(false);
  });

  it("IngestInputSchema rejects threshold outside [0,1]", () => {
    expect(
      IngestInputSchema.safeParse({ source: "https://example.com", threshold: 2 }).success,
    ).toBe(false);
  });
});

describe("RecallInputSchema verbosity (D-03 + spike-findings-engram §1)", () => {
  it("Test 1: default verbosity is 'chunks' (Phase 5 D-01 flip — synthesis opt-in)", () => {
    // Phase 5 CONTEXT.md D-01: verbosity default changed from "both" to "chunks"
    // so synthesis is opt-in. Plan 05-01 shipped the schema change; Plan 05-05
    // fixes this test (deferred per 05-01-SUMMARY.md §Deferred Items).
    const result = RecallInputSchema.parse({ query: "x" });
    expect(result.verbosity).toBe("chunks");
  });

  it("Test 2: verbosity 'synthesis' passes through", () => {
    const result = RecallInputSchema.parse({ query: "x", verbosity: "synthesis" });
    expect(result.verbosity).toBe("synthesis");
  });

  it("Test 3: verbosity 'chunks' passes through", () => {
    const result = RecallInputSchema.parse({ query: "x", verbosity: "chunks" });
    expect(result.verbosity).toBe("chunks");
  });

  it("Test 4: verbosity 'summary' is rejected (only synthesis/chunks/both are valid)", () => {
    expect(RecallInputSchema.safeParse({ query: "x", verbosity: "summary" }).success).toBe(false);
  });
});

describe("Recall + Search limit ≤ 25 (D-10)", () => {
  it("Test 5: RecallInputSchema rejects limit > 25 (D-10 tightened from max(100))", () => {
    expect(RecallInputSchema.safeParse({ query: "x", limit: 26 }).success).toBe(false);
  });

  it("Test 6: RecallInputSchema accepts limit = 25 (boundary inclusive)", () => {
    expect(RecallInputSchema.safeParse({ query: "x", limit: 25 }).success).toBe(true);
  });

  it("Test 7: SearchInputSchema rejects limit > 25 (D-10 new limit field on Search)", () => {
    expect(SearchInputSchema.safeParse({ query: "x", limit: 26 }).success).toBe(false);
  });

  it("Test 8: SearchInputSchema accepts limit = 25 (boundary inclusive)", () => {
    expect(SearchInputSchema.safeParse({ query: "x", limit: 25 }).success).toBe(true);
  });
});
