/**
 * `reciprocalRankFusion` — pure transform for merging multiple ranked result
 * lists into a single, scale-invariant ordering (EXP-04).
 *
 * Pure transform — no env, no IO, no mutation.
 *
 * ## Formula
 *
 * ```
 * score(d) = Σ_lists  1 / (k + rank_in_list(d))
 * ```
 *
 * - `rank` is 1-indexed (first item = rank 1).
 * - Only lists where `d` appears contribute to the sum.
 * - Default `k = 60` matches the Elasticsearch / Cormack-Clarke-Büttcher
 *   recommendation for stable, near-optimal fusion across most workloads.
 *
 * ## Why RRF (vs score-normalized merge)
 *
 * RRF is rank-based, so it is immune to score-scale differences across
 * retrievers (e.g., raw cosine from Vectorize vs. BM25 scores from a
 * lexical index). This makes it robust when the per-variant Vectorize
 * result lists have different score distributions.
 *
 * ## Cross-phase contract
 *
 * - **EXP-04**: this is the merge step in the Phase 3 adaptive routing
 *   fan-out (`recall()` in `tools.ts`).
 * - The function is called in `tools.ts` between the per-variant
 *   `vectorizeQuery` calls and the `safeRun(env, RERANKER_MODEL, ...)` call.
 * - The Map insertion-order property determines tiebreak behavior: when two
 *   documents produce identical RRF scores (rare at k=60), the one whose
 *   `id` was first encountered across the input lists ranks first.
 *
 * @module @engram/mcp-server/rrf
 */

/**
 * Merge multiple ranked lists via Reciprocal Rank Fusion.
 *
 * @param lists - Two or more ranked lists of items. Each item MUST have an
 *   `id: string` field. An item may appear in multiple lists; its scores are
 *   summed across all appearances.
 * @param k - RRF rank constant (default 60). The Elasticsearch default and the
 *   value recommended by Cormack, Clarke & Büttcher 2009. Tests may pass k=1
 *   to produce more distinguishable scores for fixture validation.
 * @returns A new array (inputs NOT mutated) of `{ id, rrfScore, item }` sorted
 *   descending by `rrfScore`. `item` is the original object reference from the
 *   first list in which this `id` was seen. Tiebreaks follow Map insertion order
 *   (first-seen id wins).
 */
export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  k = 60,
): { id: string; rrfScore: number; item: T }[] {
  // O(1) Map accumulation keyed by item.id — mirrors the hybrid-rank.ts
  // blockMap pattern (pure-transform discipline, no mutation of inputs).
  const scores = new Map<string, { rrfScore: number; item: T }>();

  for (const list of lists) {
    list.forEach((item, idx) => {
      const rank = idx + 1; // 1-indexed
      const contribution = 1 / (k + rank);
      const prev = scores.get(item.id);
      if (prev) {
        // Accumulate contributions from multiple lists.
        prev.rrfScore += contribution;
      } else {
        // First encounter: record item reference + contribution.
        scores.set(item.id, { rrfScore: contribution, item });
      }
    });
  }

  // Build a NEW array (never sort in-place) and sort descending by rrfScore.
  // Map iteration order is insertion order — when two entries have equal scores,
  // the first-inserted id sorts first (deterministic tiebreak, EXP-04).
  return [...scores.entries()]
    .map(([id, v]) => ({ id, rrfScore: v.rrfScore, item: v.item }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}
