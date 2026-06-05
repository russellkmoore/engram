/**
 * Tests for `hybrid-rank.ts` (AI-04 Vectorize + recency formula).
 *
 * Requirements covered:
 * - AI-04: recall hybrid ranking formula combining Vectorize cosine score,
 *   recency, type_match, and scope_match per AI-SPEC.md §4 starting weights.
 * - D-05 (Phase 2): `HYBRID_WEIGHTS.rerank` key (renamed from `cosine`).
 * - D-07 (Phase 2): optional `weights` parameter for 625-config sweep in Plan 02-03.
 *
 * Test patterns:
 * - Mirrors `envelope.test.ts` lines 64–146 (pure-function describe structure,
 *   no DO or binding mocks needed — all inputs are plain JS objects).
 *
 * @module @engram/mcp-server/__tests__/hybrid-rank
 */

import { describe, it, expect } from "vitest";

import { hybridRank, HYBRID_WEIGHTS } from "../hybrid-rank.js";

// Minimal Memory shape for testing — only the fields hybridRank reads.
interface RankableMemory {
  id: string;
  type: string | null;
  scope: "personal" | "project" | "org";
  created_at: number;
}

describe("hybridRank (AI-04 formula)", () => {
  it("weights are at Phase 2 D-05 values with rerank key (renamed from cosine)", () => {
    expect(HYBRID_WEIGHTS).toEqual({
      rerank: 1.0,
      recency: 0.15,
      type_match: 0.2,
      scope_match: 0.15,
    });
  });

  it("recent block scores higher than older block at same cosine similarity", () => {
    const now = Date.now();
    const recent: RankableMemory = {
      id: "r1",
      type: "contact",
      scope: "personal",
      created_at: now,
    };
    const old: RankableMemory = {
      id: "r2",
      type: "contact",
      scope: "personal",
      created_at: now - 90 * 24 * 60 * 60 * 1000,
    };
    const vectorMatches = [
      { id: "r1", score: 0.9 },
      { id: "r2", score: 0.9 },
    ];
    const ranked = hybridRank(vectorMatches, [recent, old] as never[], {});
    expect(ranked[0]?.id).toBe("r1");
  });

  it("type_match boost applies when args.types contains block.type", () => {
    const now = Date.now();
    const typed: RankableMemory = {
      id: "typed",
      type: "contact",
      scope: "personal",
      created_at: now,
    };
    const untyped: RankableMemory = {
      id: "untyped",
      type: "research_note",
      scope: "personal",
      created_at: now,
    };
    const vectorMatches = [
      { id: "typed", score: 0.7 },
      { id: "untyped", score: 0.75 },
    ];
    // types filter includes "contact" — typed block should win despite lower cosine.
    const ranked = hybridRank(vectorMatches, [typed, untyped] as never[], { types: ["contact"] });
    expect(ranked[0]?.id).toBe("typed");
  });

  it("scope_match boost applies when args.scope === block.scope", () => {
    const now = Date.now();
    const scoped: RankableMemory = {
      id: "scoped",
      type: "contact",
      scope: "project",
      created_at: now,
    };
    const other: RankableMemory = {
      id: "other",
      type: "contact",
      scope: "personal",
      created_at: now,
    };
    const vectorMatches = [
      { id: "scoped", score: 0.7 },
      { id: "other", score: 0.75 },
    ];
    const ranked = hybridRank(vectorMatches, [scoped, other] as never[], { scope: "project" });
    expect(ranked[0]?.id).toBe("scoped");
  });

  it("output is monotonically ordered by combined score (no ties — all inputs differ)", () => {
    const now = Date.now();
    const blocks: RankableMemory[] = [
      { id: "a", type: "contact", scope: "personal", created_at: now - 1000 },
      { id: "b", type: "contact", scope: "personal", created_at: now - 2000 },
      { id: "c", type: "contact", scope: "personal", created_at: now - 3000 },
    ];
    const vectorMatches = [
      { id: "a", score: 0.9 },
      { id: "b", score: 0.85 },
      { id: "c", score: 0.8 },
    ];
    // ENG-22: hybridRank's blocks parameter is typed LexicalSearchHit[] but the
    // test fixture builds RankableMemory[] (a leaner shape sufficient for the
    // ranking algorithm). Cast to `never[]` to match the existing pattern at
    // line ~113 of this file — algorithm correctness is what's under test.
    const ranked = hybridRank(vectorMatches, blocks as never[], {});
    const scores = ranked.map((r) => (r as { _score?: number })._score ?? 0);
    for (let i = 1; i < scores.length; i++) {
      // ENG-22: noUncheckedIndexedAccess types these as number|undefined; the
      // `?? 0` above guarantees runtime non-null, and `?? 0` here satisfies
      // TS without tripping the no-non-null-assertion ESLint rule.
      expect(scores[i] ?? 0).toBeLessThanOrEqual(scores[i - 1] ?? 0);
    }
  });

  it("uses caller-supplied weights when the 5th argument is provided (D-07 parameterization)", () => {
    // Fixture: two blocks at the same cosine similarity but different recency.
    // With default weights (rerank=1.0, recency=0.15): recent block wins.
    // With custom weights (rerank=0.5, recency=0.5, type_match=0, scope_match=0):
    //   score = 0.5 * cosine + 0.5 * recency
    // We can verify that the score is computed using the supplied weights,
    // not the HYBRID_WEIGHTS defaults, by passing equal cosine scores and
    // different recency, then checking that the score differences match.
    const now = Date.now();
    const recent: RankableMemory = {
      id: "recent",
      type: "contact",
      scope: "personal",
      created_at: now, // recency ≈ 1.0
    };
    const old: RankableMemory = {
      id: "old",
      type: "contact",
      scope: "personal",
      created_at: now - 30 * 24 * 60 * 60 * 1000, // recency ≈ 0.368 (30-day half-life)
    };

    const customWeights = { rerank: 0.5, recency: 0.5, type_match: 0.0, scope_match: 0.0 };
    const vectorMatches = [
      { id: "recent", score: 0.8 },
      { id: "old", score: 0.8 },
    ];

    const ranked = hybridRank(vectorMatches, [recent, old] as never[], {}, now, customWeights);
    // With equal cosine: recent should still rank first because recency > 0.
    expect(ranked[0]?.id).toBe("recent");

    // Verify the score uses the custom weight: score = 0.5 * 0.8 + 0.5 * recency
    // recent: 0.5 * 0.8 + 0.5 * exp(0) = 0.4 + 0.5 = 0.9
    // old: 0.5 * 0.8 + 0.5 * exp(-1) ≈ 0.4 + 0.5 * 0.3679 ≈ 0.4 + 0.1839 = 0.5839
    const recentScore = (ranked[0] as { _score?: number })._score ?? 0;
    const oldScore = (ranked[1] as { _score?: number })._score ?? 0;
    expect(recentScore).toBeCloseTo(0.9, 4);
    expect(oldScore).toBeCloseTo(0.5 * 0.8 + 0.5 * Math.exp(-1), 4);
    // Confirm weights.type_match / scope_match are truly zero — scores use only rerank + recency
    expect(recentScore + oldScore).toBeCloseTo(
      0.5 * 0.8 + 0.5 * 1.0 + 0.5 * 0.8 + 0.5 * Math.exp(-1),
      4,
    );
  });
});
