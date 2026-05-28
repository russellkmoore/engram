/**
 * RED test stubs for `vectorize-helper.ts` (AI-02 namespace enforcement).
 *
 * These tests COMPILE but FAIL because `../vectorize-helper.js` does not
 * exist yet — Plan 05-02 (Wave 1) creates it. The import failure is the
 * expected RED state. Wave 1 flips these GREEN by shipping the helper.
 *
 * Requirements covered:
 * - AI-02: every Vectorize call enforces namespace = workspace_id.
 *   A missing or wrong namespace leaks cross-workspace vectors — the helper
 *   makes it a compile error to forget the arg.
 *
 * Test patterns:
 * - Inline mock object via `as unknown as VectorizeIndex` cast (matches the
 *   `env as Env` cast in tools-integration.test.ts:68).
 * - `describe(req-id + behavior)` titles so verifier greps map to AI-02.
 *
 * @module @engram/mcp-server/__tests__/vectorize-helper
 */
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
// Rationale: vectorize-helper.ts does not exist yet (Plan 05-02 deliverable). TypeScript
// resolves all imports from ../vectorize-helper.js as error-typed, triggering no-unsafe-*
// and require-await rules. Tests are intentionally RED until Plan 05-02 ships.
import { describe, it, expect } from "vitest";

import { vectorizeQuery, vectorizeUpsert, vectorizeDelete } from "../vectorize-helper.js";

describe("vectorize-helper (AI-02 namespace mandatory)", () => {
  it("vectorizeQuery sets namespace = workspace_id on every call", async () => {
    const calls: { vector: number[]; opts: Record<string, unknown> }[] = [];
    const mockEnv = {
      VECTORIZE: {
        query: async (vector: number[], opts: Record<string, unknown>) => {
          calls.push({ vector, opts });
          return { matches: [], count: 0 };
        },
      } as unknown as VectorizeIndex,
    };
    await vectorizeQuery(mockEnv, "ws-test-001", [0.1, 0.2, 0.3], { topK: 25 });
    expect(calls[0]?.opts.namespace).toBe("ws-test-001");
  });

  it("rejects namespace > 64 bytes", () => {
    const big = "x".repeat(65);
    expect(() =>
      vectorizeQuery({ VECTORIZE: {} }, big, [], {
        topK: 1,
      }),
    ).toThrow(/64-byte namespace/);
  });

  it("vectorizeUpsert stamps namespace on every vector regardless of caller intent", async () => {
    const upserted: { id: string; values: number[]; namespace?: string }[] = [];
    const mockEnv = {
      VECTORIZE: {
        upsert: async (vectors: { id: string; values: number[]; namespace?: string }[]) => {
          upserted.push(...vectors);
          return { count: vectors.length };
        },
      } as unknown as VectorizeIndex,
    };
    // Caller deliberately omits namespace — the helper must stamp it.
    await vectorizeUpsert(mockEnv, "ws-ns-test", [
      { id: "v1", values: [0.1, 0.2] },
      { id: "v2", values: [0.3, 0.4], namespace: "WRONG-SHOULD-BE-OVERWRITTEN" },
    ]);
    expect(upserted.every((v) => v.namespace === "ws-ns-test")).toBe(true);
  });

  it("vectorizeDelete passes ids through to the binding", async () => {
    const deleted: string[] = [];
    const mockEnv = {
      VECTORIZE: {
        deleteByIds: async (ids: string[]) => {
          deleted.push(...ids);
          return { count: ids.length };
        },
      } as unknown as VectorizeIndex,
    };
    await vectorizeDelete(mockEnv, "ws-del-test", ["id-a", "id-b"]);
    expect(deleted).toEqual(["id-a", "id-b"]);
  });
});
