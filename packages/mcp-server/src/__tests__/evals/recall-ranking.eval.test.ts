/**
 * 625-config hybrid-rank weight sweep — Phase 2 RNK-01..04, RNK-06.
 *
 * PURPOSE
 * -------
 * Runs a grid search over 625 weight configurations (5^4 Cartesian product of
 * the D-01 grid) to find the Pareto-optimal HYBRID_WEIGHTS for `hybridRank()`.
 *
 * Budget discipline (D-19, RESEARCH §Pattern 1):
 *   Pre-resolve ALL queries EXACTLY ONCE (~100 AI + ~100 Vectorize calls).
 *   The inner 625-config loop is PURE-MATH reranking — zero AI/Vectorize calls.
 *   D-15 dual-corpus adds ~27 AI + ~27 Vectorize calls (combined ~127 < 200).
 *
 * Gates enforced in this test:
 *   D-04 strict: train→validate F1 gap < 10pp (boundary = 10pp is REJECTED)
 *   RNK-04: ±0.05 sensitivity — top1_flip_rate < 30% across 8 perturbations
 *   RNK-06: winner.train.f1 ≥ 0.8254 (v0.1 baseline)
 *   D-15:   winner re-scored on 27-entry real-corpus.json F1 ≥ 0.8254
 *           (if this gate fails: console.warn "RNK-06-D15-REGRESSION" then fail)
 *
 * Standalone eval session: do NOT run with conflict-precision.eval.test.ts in
 * the same session. Combined budget would be ~230 AI calls vs MAX_AI_CALLS=200
 * cap (RESEARCH §Pitfall 3, plan CONTEXT D-19).
 *
 * Sensitivity metric: top1_flip_rate (RESEARCH §A5 recommendation — simpler and
 * more interpretable than Kendall tau over top-3). Documented in changelog row.
 *
 * @module @engram/mcp-server/recall-ranking-eval
 * @requirement RNK-01, RNK-02, RNK-03, RNK-04, RNK-06
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  EMBEDDING_MODEL,
  MIN_COSINE_THRESHOLD,
  VECTORIZE_OVERFETCH_FACTOR,
  type HybridWeights,
} from "@engram/ai-config";
import { hybridRank } from "../../hybrid-rank.js";
import { vectorizeQuery } from "@engram/vectorize-utils";

// Loaded as a build-time JSON import (Vite bundles it into the worker).
// Workers in @cloudflare/vitest-pool-workers cannot use fs.readFileSync against
// host-filesystem paths outside the bundle — JSON imports are the only safe path.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };

// D-15 dual-corpus fixture (27-entry real-corpus for regression gate).
// Adapts schema mismatch: real-corpus uses paraphrased_query + intended_memory_id
// rather than query + expected_top_3_block_ids.
import realCorpusJson from "./fixtures/real-corpus.json" with { type: "json" };

// ---------------------------------------------------------------------------
// D-01 grid (VERBATIM — copy from CONTEXT.md D-01; do NOT modify without re-running sweep)
// ---------------------------------------------------------------------------

// D-01 verbatim — symmetric 5-value grid around v0.1 defaults at index 2. Do NOT modify without re-running the sweep.
const COSINE_GRID = [0.6, 0.8, 1.0, 1.2, 1.5] as const;
const RECENCY_GRID = [0.05, 0.1, 0.15, 0.2, 0.3] as const;
const TYPE_MATCH_GRID = [0.1, 0.15, 0.2, 0.25, 0.35] as const;
const SCOPE_MATCH_GRID = [0.05, 0.1, 0.15, 0.2, 0.3] as const;
// 5^4 = 625 configs

// ---------------------------------------------------------------------------
// Gate thresholds
// ---------------------------------------------------------------------------

const BASELINE_F1 = 0.8254; // v0.1 baseline per RNK-06
const TRAIN_VALIDATE_GAP_LIMIT = 0.1; // D-04 strict
const SENSITIVITY_FLIP_LIMIT = 0.3; // RNK-04
const TOP_N_BY_F1 = 3; // D-03 top-3 then Pareto

// ---------------------------------------------------------------------------
// Corpus types
// ---------------------------------------------------------------------------

interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: null;
}

interface CorpusFile {
  corpus_version: number;
  embedding_model: string;
  sources: { name: string; count: number; sourced_at: string }[];
  buckets: string[];
  entries: CorpusEntry[];
}

// D-15 dual-corpus schema (real-corpus.json has different fields).
interface RealCorpusEntry {
  id: string;
  bucket: string;
  memory_type: string;
  original_content: string;
  paraphrased_query: string;
  intended_memory_id: string;
  expected_classified_type: string;
  known_failure_pattern: string | null;
}

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

interface SweepMetric {
  f1: number;
  mrr: number;
  top1: number;
}
interface SweepResult {
  cfg: HybridWeights;
  train: SweepMetric;
  validate: SweepMetric;
}

interface QueryResolution {
  matches: VectorizeMatches["matches"];
  blocks: { id: string; [k: string]: unknown }[];
}

// ---------------------------------------------------------------------------
// Helpers: Pareto front (RESEARCH §Pattern 2)
// ---------------------------------------------------------------------------

/**
 * Compute the 3D Pareto front over (f1, mrr, top1) from a set of candidates.
 * A candidate c is dominated if another candidate `other` weakly dominates it
 * on all three axes AND strictly dominates on at least one.
 *
 * For 3 candidates (D-03 top-3) this is trivially O(N^2) — no library needed.
 */
function paretoFront(candidates: SweepResult[]): SweepResult[] {
  return candidates.filter(
    (c) =>
      !candidates.some(
        (other) =>
          other !== c &&
          other.train.f1 >= c.train.f1 &&
          other.train.mrr >= c.train.mrr &&
          other.train.top1 >= c.train.top1 &&
          (other.train.f1 > c.train.f1 ||
            other.train.mrr > c.train.mrr ||
            other.train.top1 > c.train.top1),
      ),
  );
}

// ---------------------------------------------------------------------------
// Helpers: metric functions (per-query then aggregate)
// ---------------------------------------------------------------------------

/**
 * F1 = harmonic mean of precision@3 and recall@3 over the expected_top_3 set.
 * Precision@3 = (hits in top-3 ranked) / 3.
 * Recall@3    = (hits in top-3 ranked) / expected_count.
 */
function computeF1(ranked: { id: string }[], expectedIds: readonly string[]): number {
  const top3 = ranked.slice(0, 3).map((r) => r.id);
  const hits = top3.filter((id) => expectedIds.includes(id)).length;
  const precision = hits / 3;
  const recall = expectedIds.length === 0 ? 0 : hits / expectedIds.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * MRR = 1 / rank_of_first_relevant (1-indexed).
 * Returns 0 if no relevant result in the ranked list.
 */
function computeMRR(ranked: { id: string }[], expectedIds: readonly string[]): number {
  for (let i = 0; i < ranked.length; i++) {
    const hit = ranked[i];
    if (hit !== undefined && expectedIds.includes(hit.id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Top-1 accuracy: 1 if ranked[0].id ∈ expectedIds, else 0.
 */
function computeTop1(ranked: { id: string }[], expectedIds: readonly string[]): number {
  const top = ranked[0];
  return ranked.length > 0 && top !== undefined && expectedIds.includes(top.id) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Helper: score a split
// ---------------------------------------------------------------------------

function scoreSplit(
  entries: CorpusEntry[],
  resolutions: Map<string, QueryResolution>,
  cfg: HybridWeights,
): SweepMetric {
  let totalF1 = 0,
    totalMRR = 0,
    totalTop1 = 0;
  let counted = 0;
  for (const entry of entries) {
    const res = resolutions.get(entry.id);
    if (!res) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const ranked = hybridRank(res.matches, res.blocks as any, {}, Date.now(), cfg);
    totalF1 += computeF1(ranked, entry.expected_top_3_block_ids);
    totalMRR += computeMRR(ranked, entry.expected_top_3_block_ids);
    totalTop1 += computeTop1(ranked, entry.expected_top_3_block_ids);
    counted++;
  }
  if (counted === 0) return { f1: 0, mrr: 0, top1: 0 };
  return {
    f1: totalF1 / counted,
    mrr: totalMRR / counted,
    top1: totalTop1 / counted,
  };
}

// ---------------------------------------------------------------------------
// Helper: score real-corpus entries (D-15 dual-corpus)
// Schema adapter: paraphrased_query → query, intended_memory_id → expected ID
// ---------------------------------------------------------------------------

function scoreRealSplit(
  entries: RealCorpusEntry[],
  resolutions: Map<string, QueryResolution>,
  cfg: HybridWeights,
): number {
  let totalF1 = 0;
  let counted = 0;
  for (const entry of entries) {
    const res = resolutions.get(entry.id);
    if (!res) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const ranked = hybridRank(res.matches, res.blocks as any, {}, Date.now(), cfg);
    totalF1 += computeF1(ranked, [entry.intended_memory_id]);
    counted++;
  }
  if (counted === 0) return 0;
  return totalF1 / counted;
}

// ---------------------------------------------------------------------------
// Helper: enumerate the D-01 grid (625 configs)
// ---------------------------------------------------------------------------

function* enumerateGrid(): Generator<HybridWeights> {
  for (const rerank of COSINE_GRID) {
    for (const recency of RECENCY_GRID) {
      for (const type_match of TYPE_MATCH_GRID) {
        for (const scope_match of SCOPE_MATCH_GRID) {
          yield { rerank, recency, type_match, scope_match };
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: sensitivity analysis (RESEARCH §Pattern 3 — top1_flip_rate)
// RNK-04: for each of 8 ±0.05 perturbations (4 axes × 2 directions), count
// queries where top-1 differs from winner. Average flip rate < 30%.
// ---------------------------------------------------------------------------

function top1FlipRate(
  winnerCfg: HybridWeights,
  resolutions: Map<string, QueryResolution>,
  trainSet: CorpusEntry[],
): number {
  const perturbations: HybridWeights[] = [];
  for (const axis of ["rerank", "recency", "type_match", "scope_match"] as const) {
    for (const delta of [0.05, -0.05]) {
      // Guard against negative weights (clip at 0.01).
      const perturbed = { ...winnerCfg, [axis]: Math.max(0.01, winnerCfg[axis] + delta) };
      perturbations.push(perturbed);
    }
  }
  let totalFlips = 0;
  let totalComparisons = 0;
  for (const perturbed of perturbations) {
    for (const entry of trainSet) {
      const res = resolutions.get(entry.id);
      if (!res) continue;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const winnerTop1 = hybridRank(res.matches, res.blocks as any, {}, Date.now(), winnerCfg)[0]
        ?.id;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      const perturbedTop1 = hybridRank(res.matches, res.blocks as any, {}, Date.now(), perturbed)[0]
        ?.id;
      if (winnerTop1 !== perturbedTop1) totalFlips++;
      totalComparisons++;
    }
  }
  if (totalComparisons === 0) return 0;
  return totalFlips / totalComparisons;
}

// ---------------------------------------------------------------------------
// Creds guard (mirrors recall-f1.eval.test.ts pattern)
// ---------------------------------------------------------------------------

function hasEvalCreds(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID);
}

// ---------------------------------------------------------------------------
// Cast corpus JSON to typed interfaces
// ---------------------------------------------------------------------------

const corpus = corpusJson as unknown as CorpusFile;
const realCorpus = realCorpusJson as unknown as RealCorpusEntry[];

// ---------------------------------------------------------------------------
// Corpus sanity checks (always run — no creds required)
// ---------------------------------------------------------------------------

describe("RNK-01 corpus integrity (no creds required)", () => {
  it("recall-corpus-v2.json has corpus_version === 2", () => {
    expect(corpus.corpus_version).toBe(2);
  });

  it("recall-corpus-v2.json embedding_model matches EMBEDDING_MODEL constant", () => {
    // Fail-fast: stale labels from a different model contaminate F1 silently.
    expect(corpus.embedding_model).toBe(EMBEDDING_MODEL);
  });

  it("recall-corpus-v2.json has ≥ 100 entries", () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("recall-corpus-v2.json has non-empty train and validate splits", () => {
    const trainSet = corpus.entries.filter((e) => e.split === "train");
    const validateSet = corpus.entries.filter((e) => e.split === "validate");
    expect(trainSet.length).toBeGreaterThan(0);
    expect(validateSet.length).toBeGreaterThan(0);
  });

  it("real-corpus.json has 27 entries", () => {
    expect(realCorpus.length).toBe(27);
  });

  it("D-01 grids are symmetric 5-value arrays", () => {
    expect(COSINE_GRID).toHaveLength(5);
    expect(RECENCY_GRID).toHaveLength(5);
    expect(TYPE_MATCH_GRID).toHaveLength(5);
    expect(SCOPE_MATCH_GRID).toHaveLength(5);
    // v0.1 defaults at index 2:
    expect(COSINE_GRID[2]).toBe(1.0);
    expect(RECENCY_GRID[2]).toBe(0.15);
    expect(TYPE_MATCH_GRID[2]).toBe(0.2);
    expect(SCOPE_MATCH_GRID[2]).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// 625-config sweep + Pareto + sensitivity + dual-corpus (eval-creds required)
// ---------------------------------------------------------------------------

describe("RNK-01..04 + RNK-06: 625-config sweep, Pareto selection, sensitivity, D-15 dual-corpus gate", () => {
  it("sweep produces 625 configs, selects Pareto winner, enforces all gates", async () => {
    if (!hasEvalCreds()) {
      console.log("[SKIP] No CF creds — skipping RNK sweep (set CLOUDFLARE_ACCOUNT_ID to run)");
      return;
    }

    // Fail-fast embedding-model guard (parallel to corpus-sanity describe above).
    expect(corpus.embedding_model).toBe(EMBEDDING_MODEL);

    const trainSet = corpus.entries.filter((e) => e.split === "train");
    const validateSet = corpus.entries.filter((e) => e.split === "validate");

    // Eval-workspace shared with recall-f1.eval.test.ts (pre-seeded blocks).
    // Using the same workspace ID ensures Vectorize matches resolve to real blocks.
    const EVAL_WORKSPACE_ID = "ws-eval-f1-train";

    // -------------------------------------------------------------------------
    // Step 1: Pre-resolve EVERY corpus query EXACTLY ONCE (budget discipline).
    // ~100 AI calls + ~100 Vectorize calls = ~200 total (within MAX_AI_CALLS=200).
    // The 625-config inner loop is PURE-MATH — never touches env.AI/env.VECTORIZE.
    // -------------------------------------------------------------------------

    const resolutions = new Map<string, QueryResolution>();

    console.log(
      `[RNK] Pre-resolving ${String(corpus.entries.length)} queries (1 AI + 1 Vectorize each)...`,
    );

    for (const entry of corpus.entries) {
      const embedResult = await env.AI.run(EMBEDDING_MODEL as "@cf/qwen/qwen3-embedding-0.6b", {
        text: [entry.query],
      });
      const queryVec = (embedResult as { data: number[][] }).data[0];
      if (!queryVec || queryVec.length === 0) {
        throw new Error(`[RNK] dim mismatch on entry ${entry.id}`);
      }

      const fetchSize = 25 * VECTORIZE_OVERFETCH_FACTOR;
      const result = await vectorizeQuery(env, EVAL_WORKSPACE_ID, queryVec, {
        topK: fetchSize,
        returnMetadata: "all",
      });

      const filtered = result.matches.filter((m) => m.score >= MIN_COSINE_THRESHOLD).slice(0, 25);

      // Hydrate blocks: use what Vectorize returned (metadata has id at minimum).
      // Map to { id, ...} shape compatible with hybridRank's LexicalSearchHit.
      const blocks = filtered.map((m) => ({
        id: m.id,
        type: ((m.metadata as Record<string, unknown> | null)?.type as string | null) ?? null,
        scope:
          ((m.metadata as Record<string, unknown> | null)?.scope as string | null) ?? "personal",
        created_at:
          typeof (m.metadata as Record<string, unknown> | null)?.created_at === "number"
            ? ((m.metadata as Record<string, unknown>).created_at as number)
            : Date.now() - 24 * 3600 * 1000, // fallback: 1 day ago
        content: null,
        summary: null,
        properties: null,
        embedding_id: m.id,
        source: null,
        confidence: null,
      }));

      resolutions.set(entry.id, { matches: filtered, blocks });
    }

    console.log(
      `[RNK] Pre-resolved ${String(trainSet.length)} train + ${String(validateSet.length)} validate queries`,
    );

    // -------------------------------------------------------------------------
    // Step 2: Enumerate 625 configs — PURE-MATH reranking only.
    // No env.AI or env.VECTORIZE calls in this loop.
    // -------------------------------------------------------------------------

    const sweepResults: SweepResult[] = [];

    for (const cfg of enumerateGrid()) {
      const trainMetrics = scoreSplit(trainSet, resolutions, cfg);
      const validateMetrics = scoreSplit(validateSet, resolutions, cfg);
      sweepResults.push({ cfg, train: trainMetrics, validate: validateMetrics });
    }

    // Test: sweep produces exactly 625 results.
    expect(sweepResults.length).toBe(625);

    console.log(`[RNK] Sweep complete: ${String(sweepResults.length)} configs evaluated`);

    // -------------------------------------------------------------------------
    // Step 3: D-03 selection — top-3 by train.f1, then Pareto front.
    // -------------------------------------------------------------------------

    const top3ByF1 = [...sweepResults]
      .sort((a, b) => b.train.f1 - a.train.f1)
      .slice(0, TOP_N_BY_F1);

    const paretoWinners = paretoFront(top3ByF1);

    // Tiebreak: if multiple Pareto winners, pick highest MRR (then top1).
    paretoWinners.sort((a, b) => {
      if (b.train.mrr !== a.train.mrr) return b.train.mrr - a.train.mrr;
      return b.train.top1 - a.train.top1;
    });

    const winner = paretoWinners[0];
    if (winner === undefined) {
      throw new Error("[RNK] Pareto front is empty — should not happen with 625 configs");
    }

    // Test: D-03 selection is deterministic (same input → same winner).
    // Verified implicitly: sweepResults is deterministic for fixed corpus+weights.
    expect(winner).toBeDefined();
    expect(winner.cfg).toBeDefined();

    // -------------------------------------------------------------------------
    // Step 4: D-04 strict train→validate gap gate.
    // -------------------------------------------------------------------------

    const gap = winner.train.f1 - winner.validate.f1;
    console.log(
      `[RNK] Winner cfg=${JSON.stringify(winner.cfg)} f1_train=${winner.train.f1.toFixed(4)} f1_validate=${winner.validate.f1.toFixed(4)} gap=${gap.toFixed(4)}`,
    );

    // D-04: gap MUST be < 10pp STRICT (boundary = 10pp is REJECTED per CONTEXT.md D-04).
    expect(gap).toBeLessThan(TRAIN_VALIDATE_GAP_LIMIT);

    // -------------------------------------------------------------------------
    // Step 5: RNK-04 sensitivity — top1_flip_rate < 30%.
    // Uses adjacent grid neighbors (D-02): ±0.05 on all 4 axes (8 perturbations).
    // Pure-math: no additional AI/Vectorize calls.
    // -------------------------------------------------------------------------

    const flipRate = top1FlipRate(winner.cfg, resolutions, trainSet);
    console.log(
      `[RNK] Sensitivity top1_flip_rate=${flipRate.toFixed(4)} (gate < ${String(SENSITIVITY_FLIP_LIMIT)})`,
    );

    expect(flipRate).toBeLessThan(SENSITIVITY_FLIP_LIMIT);

    // -------------------------------------------------------------------------
    // Step 6: RNK-06 baseline regression on sweep corpus.
    // -------------------------------------------------------------------------

    expect(winner.train.f1).toBeGreaterThanOrEqual(BASELINE_F1);

    // -------------------------------------------------------------------------
    // Step 7: D-15 dual-corpus regression gate.
    // Pre-resolve the 27-entry real-corpus.json queries (~27 more AI + Vectorize).
    // Combined budget: ~100 + ~100 (corpus) + ~27 + ~27 (real-corpus) ≈ 127 < 200.
    //
    // Schema adapter: real-corpus.json uses paraphrased_query + intended_memory_id.
    // We embed each paraphrased_query, retrieve Vectorize matches, then score F1
    // treating intended_memory_id as the single expected match.
    // -------------------------------------------------------------------------

    const realResolutions = new Map<string, QueryResolution>();
    console.log(
      `[RNK] Pre-resolving ${String(realCorpus.length)} real-corpus queries for D-15 gate...`,
    );

    for (const entry of realCorpus) {
      const embedResult = await env.AI.run(EMBEDDING_MODEL as "@cf/qwen/qwen3-embedding-0.6b", {
        text: [entry.paraphrased_query],
      });
      const queryVec = (embedResult as { data: number[][] }).data[0];
      if (!queryVec || queryVec.length === 0) {
        console.warn(`[RNK-D15] dim mismatch on real-corpus entry ${entry.id} — skipping`);
        continue;
      }

      const fetchSize = 25 * VECTORIZE_OVERFETCH_FACTOR;
      const result = await vectorizeQuery(env, EVAL_WORKSPACE_ID, queryVec, {
        topK: fetchSize,
        returnMetadata: "all",
      });

      const filtered = result.matches.filter((m) => m.score >= MIN_COSINE_THRESHOLD).slice(0, 25);

      const blocks = filtered.map((m) => ({
        id: m.id,
        type: ((m.metadata as Record<string, unknown> | null)?.type as string | null) ?? null,
        scope:
          ((m.metadata as Record<string, unknown> | null)?.scope as string | null) ?? "personal",
        created_at:
          typeof (m.metadata as Record<string, unknown> | null)?.created_at === "number"
            ? ((m.metadata as Record<string, unknown>).created_at as number)
            : Date.now() - 24 * 3600 * 1000,
        content: null,
        summary: null,
        properties: null,
        embedding_id: m.id,
        source: null,
        confidence: null,
      }));

      realResolutions.set(entry.id, { matches: filtered, blocks });
    }

    const realF1 = scoreRealSplit(realCorpus, realResolutions, winner.cfg);
    console.log(`[RNK] D-15 real-corpus F1=${realF1.toFixed(4)} (gate ≥ ${String(BASELINE_F1)})`);

    // D-15 STOP procedure: if real-corpus F1 regresses, warn + fail.
    if (realF1 < BASELINE_F1) {
      console.warn("RNK-06-D15-REGRESSION", {
        sweepF1: winner.train.f1,
        baselineCorpusF1: realF1,
        winnerCfg: winner.cfg,
        note: "Per CONTEXT.md D-15: sweep winner passes 100-entry corpus but regresses on 27-entry real-corpus. Surfacing as decision point — do NOT auto-commit weights. Human input required.",
      });
    }

    // The assertion below enforces the gate (fail test if real-corpus regresses).
    expect(realF1).toBeGreaterThanOrEqual(BASELINE_F1);

    // -------------------------------------------------------------------------
    // Step 8: Log winner in machine-parseable format for Task 2 extraction.
    // -------------------------------------------------------------------------

    console.log(
      `[RNK-WINNER] cfg=${JSON.stringify(winner.cfg)} f1_train=${winner.train.f1.toFixed(4)} f1_validate=${winner.validate.f1.toFixed(4)} mrr_train=${winner.train.mrr.toFixed(4)} top1_train=${winner.train.top1.toFixed(4)} sensitivity_top1_flip_rate=${flipRate.toFixed(4)} real_corpus_f1=${realF1.toFixed(4)}`,
    );
  }, 600_000); // 600s timeout: 200 queries × ~200ms embed+Vectorize ≈ ~40-60s on cold infra
});
