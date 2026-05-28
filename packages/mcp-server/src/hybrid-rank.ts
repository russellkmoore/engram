/**
 * `hybridRank` — pure functional hybrid ranking transform for `recall()`.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-04:** the hybrid ranking formula is the mandatory re-rank step
 *   after Vectorize returns cosine matches. Spike 003 proved `bge-base-en-v1.5`
 *   encodes domain not memory type — hybrid ranking is REQUIRED, not optional.
 *   Starting weights from AI-SPEC.md §4; tuning lands in Plan 05-06 against the
 *   real-corpus samples.
 *
 * Design notes (locked):
 * - Pure transform — no env, no IO, no mutation. Mirrors `envelope.ts:357–387`
 *   immutability discipline: every returned object is a NEW spread, never a
 *   mutation of the input.
 * - `HYBRID_WEIGHTS` is exported (not file-local) so Plan 05-06's weight-tuning
 *   task can re-export tuned values with a dated audit comment, and so
 *   `hybrid-rank.test.ts` can assert exact weight values.
 * - Orphan-tolerant: Vectorize matches whose SQLite hydration row is absent are
 *   silently dropped with `console.warn` (failure mode #3 partial — vector exists
 *   but SQLite row was deleted, or race window on remember+stampEmbedding). The
 *   downstream caller (Plan 05-05 recall handler) hydrates from `getBlocksByIds`
 *   which already excludes cold-storage rows.
 * - No default export — matches the repo-wide convention.
 *
 * Spike provenance (spike-findings-engram/references/phase-5-ranking-strategy.md §3):
 * - 30-day half-life recency decay: `recency = exp(-ageHours / (24 * 30))`
 * - type_match and scope_match are binary (1 or 0) as starting heuristic; Plan
 *   05-06's tuning task may make these continuous if the real-corpus data warrants.
 *
 * @module @engram/mcp-server/hybrid-rank
 */
import type { VectorizeMatches } from "@cloudflare/workers-types";
import type { LexicalSearchHit } from "@engram/workspace-do";
import type { RecallInput } from "./schemas.js";

/**
 * Starting hybrid ranking weights per AI-SPEC.md §4.
 *
 * LOCKED as starting values — do not edit inline. Plan 05-06's weight-tuning
 * task commits tuned values here with a dated audit comment (e.g.,
 * `// tuned 2026-06-15 against real-corpus N=20`).
 *
 * Formula: `score = cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15`
 */
export const HYBRID_WEIGHTS = {
  cosine: 1.0,
  recency: 0.15,
  type_match: 0.2,
  scope_match: 0.15,
} as const;

/** Internal representation including the computed combined score. */
type RankedHit = LexicalSearchHit & { _score: number };

/**
 * Re-ranks Vectorize cosine matches using the AI-04 hybrid formula.
 *
 * The function:
 * 1. Builds an O(1) lookup map from `blocks` by `id`.
 * 2. For each Vectorize `match`, computes the combined score and produces a
 *    new object `{ ...block, score: 1, _score: combinedScore }` (immutable
 *    spread — never mutates input).
 * 3. Drops orphan matches (Vectorize match with no SQLite hydration row) with
 *    a console.warn (failure mode #3 partial — not a fatal error).
 * 4. Returns the ranked array sorted descending by combined score (stable sort).
 *
 * @param matches - Vectorize matches from `env.VECTORIZE.query(...)`. Each has
 *   at minimum `{ id: string, score: number }`.
 * @param blocks - SQLite-hydrated blocks from `getBlocksByIds(ids)`. Used for
 *   recency + type_match + scope_match components.
 * @param args - RecallInput from the MCP tool call. Provides optional `types`
 *   and `scope` filters used for the match-boost components.
 * @param now - Current timestamp in milliseconds (Date.now()). Passed explicitly
 *   so tests can produce deterministic scores without clock manipulation.
 * @returns Blocks reordered by combined score (descending). Each returned object
 *   has a `_score` property containing the combined score for debugging/testing.
 */
export function hybridRank(
  matches: VectorizeMatches["matches"],
  blocks: LexicalSearchHit[],
  args: Partial<RecallInput>,
  now: number = Date.now(),
): LexicalSearchHit[] {
  // Build O(1) lookup: id → block row.
  const blockMap = new Map<string, LexicalSearchHit>(blocks.map((b) => [b.id, b]));

  const ranked: RankedHit[] = [];

  for (const match of matches) {
    const block = blockMap.get(match.id);
    if (block === undefined) {
      // Orphan vector — vector exists in Vectorize but no SQLite row.
      // Drop with warning; do NOT throw (failure mode #3 partial tolerance).
      console.warn("hybrid-rank:orphan-vector", { id: match.id });
      continue;
    }

    // ---- Component: cosine (already normalized to [0..1] by Vectorize) ----
    const cosine = match.score;

    // ---- Component: recency (30-day half-life decay) ----
    // spike-findings phase-5-ranking-strategy.md §3:
    //   recency = exp(-ageHours / (24 * 30))
    // A block created `now` has recency = 1.0; after 30 days ≈ 0.368;
    // after 90 days ≈ 0.050.
    const ageHours = Math.max(0, (now - block.created_at) / 3_600_000);
    const recency = Math.exp(-ageHours / (24 * 30));

    // ---- Component: type_match (binary boost when filter active) ----
    const type_match =
      args.types !== undefined && args.types.length > 0 && block.type !== null
        ? args.types.includes(block.type)
          ? 1
          : 0
        : 0;

    // ---- Component: scope_match (binary boost when filter active) ----
    const scope_match = args.scope !== undefined ? (args.scope === block.scope ? 1 : 0) : 0;

    // ---- Combined score ----
    const _score =
      HYBRID_WEIGHTS.cosine * cosine +
      HYBRID_WEIGHTS.recency * recency +
      HYBRID_WEIGHTS.type_match * type_match +
      HYBRID_WEIGHTS.scope_match * scope_match;

    // Spread into a new object (immutability discipline — mirrors envelope.ts:357–387).
    ranked.push({ ...block, _score });
  }

  // Stable descending sort by combined score.
  // Using [...arr].sort(...) avoids in-place mutation of `ranked` itself.
  return [...ranked].sort((a, b) => b._score - a._score);
}
