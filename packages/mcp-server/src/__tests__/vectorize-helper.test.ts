/**
 * Tests for `vectorize-helper.ts` (AI-02 namespace enforcement) +
 * `@engram/vectorize-utils` (D-09 import-swap — `vectorizeQuery` now lives in shared).
 *
 * Requirements covered:
 * - AI-02: every Vectorize call enforces namespace = workspace_id.
 *   A missing or wrong namespace leaks cross-workspace vectors — the helper
 *   makes it a compile error to forget the arg.
 *
 * Phase 2 D-09 note: `vectorizeQuery` was moved to `@engram/vectorize-utils`
 * in Plan 02-02. The `vectorizeQuery` tests below now import from the shared
 * package to cover the extracted code. `vectorizeUpsert` and `vectorizeDelete`
 * remain in `vectorize-helper.ts` and import from there.
 *
 * Test patterns:
 * - Inline mock object via `as unknown as VectorizeIndex` cast (matches the
 *   `env as Env` cast in tools-integration.test.ts:68).
 * - `describe(req-id + behavior)` titles so verifier greps map to AI-02.
 *
 * @module @engram/mcp-server/__tests__/vectorize-helper
 */
/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect } from "vitest";

import { vectorizeQuery } from "@engram/vectorize-utils";
import { vectorizeUpsert, vectorizeDelete } from "../vectorize-helper.js";

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
    // ENG-22: the namespace check runs before any binding call, so the mock
    // never gets hit — but the type still needs to satisfy VectorizeIndex.
    // Cast via unknown since {} doesn't structurally match the new (longer)
    // VectorizeIndex interface from wrangler-generated types.
    expect(() =>
      vectorizeQuery({ VECTORIZE: {} as unknown as VectorizeIndex }, big, [], {
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
    //
    // ENG-22: vectorizeUpsert's vectors arg type is `Omit<VectorizeVector, "namespace">`,
    // explicitly disallowing the `namespace` field at the type level (that's
    // the whole point — the helper owns namespace stamping). The "WRONG"
    // namespace below is INTENTIONAL test behavior: we want to prove the
    // helper overrides any caller-supplied value. Cast `as never[]` to
    // bypass the compile-time refusal — runtime is what's under test.
    await vectorizeUpsert(mockEnv, "ws-ns-test", [
      { id: "v1", values: [0.1, 0.2] },
      { id: "v2", values: [0.3, 0.4], namespace: "WRONG-SHOULD-BE-OVERWRITTEN" },
    ] as never[]);
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
