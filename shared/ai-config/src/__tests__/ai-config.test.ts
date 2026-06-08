/**
 * Tests for `@engram/ai-config` — model ID constants and tuning parameters.
 *
 * Requirements covered:
 * - EXP-05: `RERANKER_MODEL === "@cf/baai/bge-reranker-base"` is exported.
 * - D-05 (Phase 2): `HYBRID_WEIGHTS.rerank` key present (renamed from `cosine`).
 * - AI-03: `EMBEDDING_MODEL` unchanged (embedding space must stay consistent).
 *
 * Test patterns:
 * - Pure Node vitest — no workerd pool, no binding mocks needed.
 * - Mirrors the identity-assertion style from the retired
 *   `ai-helper-identity.test.ts` (ENG-25 cleanup).
 *
 * @module @engram/ai-config/__tests__/ai-config
 */

import { describe, it, expect } from "vitest";
import { RERANKER_MODEL, HYBRID_WEIGHTS, EMBEDDING_MODEL } from "../index.js";

describe("@engram/ai-config constants", () => {
  it("RERANKER_MODEL is the bge-reranker model ID (EXP-05)", () => {
    expect(RERANKER_MODEL).toBe("@cf/baai/bge-reranker-base");
  });

  it("HYBRID_WEIGHTS.rerank is a number (D-05 rename from cosine confirmed)", () => {
    expect(typeof HYBRID_WEIGHTS.rerank).toBe("number");
    // The rerank key must be positive — a zero or negative weight would make
    // the hybrid rank degenerate to pure recency/type/scope boosting.
    expect(HYBRID_WEIGHTS.rerank).toBeGreaterThan(0);
  });

  it("EMBEDDING_MODEL is unchanged (AI-03 cross-package embedding space lock)", () => {
    expect(EMBEDDING_MODEL).toBe("@cf/qwen/qwen3-embedding-0.6b");
  });
});
