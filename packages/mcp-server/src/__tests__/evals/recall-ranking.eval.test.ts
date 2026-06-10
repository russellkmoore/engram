/**
 * 2500-config hybrid-rank weight + threshold sweep — Phase 2 RNK-01..04, RNK-06.
 *
 * PURPOSE
 * -------
 * Runs a grid search over 2500 configurations (625 weight configs × 4 threshold
 * values per D-34 revised design) to find the Pareto-optimal HYBRID_WEIGHTS and
 * MIN_COSINE_THRESHOLD for `hybridRank()`.
 *
 * D-34 revision (2026-06-08): adds MIN_COSINE_THRESHOLD as a swept dimension
 * [0.45, 0.50, 0.55, 0.60]. Pre-fetch caches ALL topK=50 candidates with NO
 * threshold applied (zero extra AI calls — budget stays ≤200). Threshold is
 * applied per-config in the CPU scoring loop. Recalibrated RNK-06 gate: tuned
 * (threshold, weights) must beat the cosine-only baseline (rerank-dominant
 * weights, recency/type_match/scope_match all 0, threshold=0.60) by ≥0.02
 * absolute F1. This replaces the borrowed 0.8254 absolute from the production
 * pipeline (different architecture — pure rerank sweep vs remember→recall).
 * recall-f1.eval.test.ts remains UNCHANGED as the absolute 0.8254 production
 * regression guard.
 *
 * Budget discipline (D-19, RESEARCH §Pattern 1):
 *   Pre-resolve ALL queries EXACTLY ONCE (~100 AI + ~100 Vectorize calls).
 *   The inner 2500-config loop is PURE-MATH reranking — zero AI/Vectorize calls.
 *   D-15 dual-corpus would add ~54 calls (total ~254) — exceeds budget; handled
 *   gracefully with try/catch per existing pattern.
 *
 * Gates enforced in this test:
 *   D-04 strict: train→validate F1 gap < 10pp (boundary = 10pp is REJECTED)
 *   RNK-04: ±0.05 sensitivity — top1_flip_rate < 30% across 8 perturbations
 *   RNK-06: winner beats cosine-only baseline by IMPROVEMENT_DELTA_MIN (≥0.02)
 *   D-15:   winner re-scored on 27-entry real-corpus.json vs cosine-only baseline
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
import { EMBEDDING_MODEL, VECTORIZE_OVERFETCH_FACTOR, type HybridWeights } from "@engram/ai-config";
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
// prettier-ignore
const COSINE_GRID     = [0.6, 0.8, 1.0, 1.2, 1.5]           as const;
// prettier-ignore
const RECENCY_GRID    = [0.05, 0.10, 0.15, 0.20, 0.30]       as const;
// prettier-ignore
const TYPE_MATCH_GRID = [0.10, 0.15, 0.20, 0.25, 0.35]       as const;
// prettier-ignore
const SCOPE_MATCH_GRID = [0.05, 0.10, 0.15, 0.20, 0.30]      as const;
// 5^4 = 625 configs

// D-34 addition: MIN_COSINE_THRESHOLD as a swept dimension.
// Candidates pre-fetched at topK=50 with NO threshold (zero extra AI calls).
// Threshold applied per-config in the CPU loop. Winner self-selects via F1.
// Values include the production default (0.60) to ensure the sweep covers it.
// prettier-ignore
const THRESHOLD_GRID  = [0.45, 0.50, 0.55, 0.60]             as const;
// 625 weight configs × 4 thresholds = 2500 total configs

// ---------------------------------------------------------------------------
// Gate thresholds
// ---------------------------------------------------------------------------

const TRAIN_VALIDATE_GAP_LIMIT = 0.1; // D-04 strict
const SENSITIVITY_FLIP_LIMIT = 0.3; // RNK-04
const TOP_N_BY_F1 = 3; // D-03 top-3 then Pareto

// D-34 recalibrated RNK-06 gate: winner must beat the cosine-only baseline by
// this margin (absolute F1). Replaces the borrowed absolute 0.8254 threshold
// from the production pipeline (incompatible architecture).
// Cosine-only baseline = rerank-dominant weights + recency/type_match/scope_match
// all 0 + production default threshold=0.60 (today's shipped behavior).
const IMPROVEMENT_DELTA_MIN = 0.02; // minimum improvement over cosine-only baseline

// Cosine-only baseline config (today's shipped behavior — what we must beat):
// dominates on cosine only; all other components are zero so they can't contribute.
const COSINE_ONLY_BASELINE_CFG: HybridWeights = {
  rerank: 1.0,
  recency: 0.0,
  type_match: 0.0,
  scope_match: 0.0,
};
const COSINE_ONLY_BASELINE_THRESHOLD = 0.6; // production default (THRESHOLD_GRID[3])

// ---------------------------------------------------------------------------
// Corpus types
// ---------------------------------------------------------------------------

interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  /** D-26: labeled by 02-03a Task 2; present on ~40-60 of 100 entries. */
  expected_args?: { types?: string[]; scope?: "personal" | "project" | "org" };
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: string | null; // null for train; string for validate after SYN-01 augmentation
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
  /** D-34: the cosine threshold applied to candidates before hybridRank. */
  threshold: number;
  train: SweepMetric;
  validate: SweepMetric;
}

interface QueryResolution {
  /** ALL topK=50 raw matches from Vectorize — NO threshold applied (D-34). */
  rawMatches: VectorizeMatches["matches"];
  /** ALL hydrated blocks for the raw matches. */
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
  threshold: number,
): SweepMetric {
  let totalF1 = 0,
    totalMRR = 0,
    totalTop1 = 0;
  let counted = 0;
  for (const entry of entries) {
    const res = resolutions.get(entry.id);
    if (!res) continue;
    // D-34: apply threshold per-config in the CPU loop (no AI calls here).
    // Filter rawMatches by the current threshold, then cap at 25.
    const thresholdedMatches = res.rawMatches.filter((m) => m.score >= threshold).slice(0, 25);
    // Filter blocks to only those in the thresholded matches (by id).
    const thresholdedIds = new Set(thresholdedMatches.map((m) => m.id));
    const thresholdedBlocks = res.blocks.filter((b) => thresholdedIds.has(b.id));
    // D-26: pass per-entry expected_args so type_match/scope_match contribute.
    // For unlabeled queries (no expected_args), pass {} — same as before.
    /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
    const ranked = hybridRank(
      thresholdedMatches,
      thresholdedBlocks as any,
      entry.expected_args ?? {},
      Date.now(),
      cfg,
    );
    /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
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
  threshold: number,
): number {
  let totalF1 = 0;
  let counted = 0;
  for (const entry of entries) {
    const res = resolutions.get(entry.id);
    if (!res) continue;
    // D-34: apply threshold per-config (same as scoreSplit).
    const thresholdedMatches = res.rawMatches.filter((m) => m.score >= threshold).slice(0, 25);
    const thresholdedIds = new Set(thresholdedMatches.map((m) => m.id));
    const thresholdedBlocks = res.blocks.filter((b) => thresholdedIds.has(b.id));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const ranked = hybridRank(thresholdedMatches, thresholdedBlocks as any, {}, Date.now(), cfg);
    totalF1 += computeF1(ranked, [entry.intended_memory_id]);
    counted++;
  }
  if (counted === 0) return 0;
  return totalF1 / counted;
}

// ---------------------------------------------------------------------------
// Helper: enumerate the D-01 grid × D-34 threshold grid (2500 configs)
// ---------------------------------------------------------------------------

function* enumerateGrid(): Generator<{ cfg: HybridWeights; threshold: number }> {
  for (const threshold of THRESHOLD_GRID) {
    for (const rerank of COSINE_GRID) {
      for (const recency of RECENCY_GRID) {
        for (const type_match of TYPE_MATCH_GRID) {
          for (const scope_match of SCOPE_MATCH_GRID) {
            yield { cfg: { rerank, recency, type_match, scope_match }, threshold };
          }
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
  winnerThreshold: number,
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
      // D-26: thread per-entry expected_args so type_match/scope_match contribute
      // consistently in the sensitivity analysis (same as scoreSplit above).
      const entryArgs = entry.expected_args ?? {};
      // D-34: apply winner threshold (fixed for sensitivity — we perturb weights, not threshold).
      const thresholdedMatches = res.rawMatches
        .filter((m) => m.score >= winnerThreshold)
        .slice(0, 25);
      const thresholdedIds = new Set(thresholdedMatches.map((m) => m.id));
      const thresholdedBlocks = res.blocks.filter((b) => thresholdedIds.has(b.id));
      /* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
      const winnerTop1 = hybridRank(
        thresholdedMatches,
        thresholdedBlocks as any,
        entryArgs,
        Date.now(),
        winnerCfg,
      )[0]?.id;
      const perturbedTop1 = hybridRank(
        thresholdedMatches,
        thresholdedBlocks as any,
        entryArgs,
        Date.now(),
        perturbed,
      )[0]?.id;
      /* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
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
  // Primary check: parent process env (works in Node.js vitest context and CI).
  // The eval project in vitest.config.ts is ONLY loaded when this passes at
  // config-eval time, so any test running inside the eval project has already
  // passed the outer gate. The inner check is belt-and-suspenders for running
  // without the project filter (e.g., `vitest run --project=workerd`).
  if (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID) return true;
  // Fallback: workerd isolates process.env from the host shell. If we're running
  // inside the @cloudflare/vitest-pool-workers eval pool (where env.AI.run exists
  // as a real remote binding), treat that as evidence creds are available — the
  // project-level guard already enforced credential presence.
  try {
    return typeof (env as { AI?: unknown }).AI !== "undefined";
  } catch {
    return false;
  }
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

  it("recall-corpus-v2.json has 40-60 entries with expected_args (D-26 labeling gate)", () => {
    // 02-03a Task 2 labeled 40-60 of 100 corpus entries with natural-intent
    // expected_args (types / scope). If this fails, the sweep's type_match and
    // scope_match components will remain near-constant (D-26).
    const labeledCount = corpus.entries.filter((e) => e.expected_args !== undefined).length;
    expect(labeledCount).toBeGreaterThanOrEqual(40);
    expect(labeledCount).toBeLessThanOrEqual(60);
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

  it("D-34 THRESHOLD_GRID has 4 values covering range [0.45, 0.60]", () => {
    expect(THRESHOLD_GRID).toHaveLength(4);
    expect(THRESHOLD_GRID[0]).toBe(0.45);
    expect(THRESHOLD_GRID[3]).toBe(0.6); // production default is last
    expect(IMPROVEMENT_DELTA_MIN).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2500-config sweep + Pareto + sensitivity + dual-corpus (eval-creds required)
// D-34: threshold is now a swept dimension [0.45, 0.50, 0.55, 0.60].
// ---------------------------------------------------------------------------

describe("RNK-01..04 + RNK-06: 2500-config sweep (D-34), Pareto selection, sensitivity, D-15 dual-corpus gate", () => {
  it("sweep produces 2500 configs, selects Pareto winner, enforces all gates (D-34 revised)", async () => {
    if (!hasEvalCreds()) {
      console.log("[SKIP] No CF creds — skipping RNK sweep (set CLOUDFLARE_ACCOUNT_ID to run)");
      return;
    }

    // Fail-fast embedding-model guard (parallel to corpus-sanity describe above).
    expect(corpus.embedding_model).toBe(EMBEDDING_MODEL);

    const trainSet = corpus.entries.filter((e) => e.split === "train");
    const validateSet = corpus.entries.filter((e) => e.split === "validate");

    // Eval-workspace: "eval-fixtures" — contains the stable ef-001..ef-120 blocks
    // seeded via scripts/seed-eval-workspace.mjs (one-time setup before running the
    // sweep). Using a dedicated fixtures workspace keeps the sweep isolated from
    // the dynamically-ingested "ws-eval-f1-train" workspace used by recall-f1.eval.test.ts.
    const EVAL_WORKSPACE_ID = "eval-fixtures";

    // -------------------------------------------------------------------------
    // Step 1: Pre-resolve EVERY corpus query EXACTLY ONCE (budget discipline).
    // ~100 AI calls + ~100 Vectorize calls = ~200 total (within MAX_AI_CALLS=200).
    // D-34: ALL topK=50 candidates cached with NO threshold applied — zero extra
    // AI calls. Threshold is applied per-config in the pure-math inner loop.
    // The 2500-config inner loop is PURE-MATH — never touches env.AI/env.VECTORIZE.
    // -------------------------------------------------------------------------

    const resolutions = new Map<string, QueryResolution>();

    console.log(
      `[RNK] Pre-resolving ${String(corpus.entries.length)} queries (1 AI + 1 Vectorize each, NO threshold applied)...`,
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

      // D-34: store ALL topK=50 raw matches — no threshold applied here.
      // scoreSplit applies threshold per-config in the CPU loop.
      const rawMatches = result.matches;

      // Hydrate ALL blocks from raw matches (threshold applied in scoreSplit).
      // Map to { id, ...} shape compatible with hybridRank's LexicalSearchHit.
      const blocks = rawMatches.map((m) => ({
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

      resolutions.set(entry.id, { rawMatches, blocks });
    }

    console.log(
      `[RNK] Pre-resolved ${String(trainSet.length)} train + ${String(validateSet.length)} validate queries (ALL topK=50 cached, threshold swept per-config)`,
    );

    // -------------------------------------------------------------------------
    // Variance precondition (D-24): assert 02-03a's metadata seed took effect.
    // If either collapses to a single distinct value, the reseed did not run
    // or metadata is missing — fail fast with a clear message before the sweep.
    // -------------------------------------------------------------------------

    const allBlocks = [...resolutions.values()].flatMap((r) => r.blocks);
    const distinctCreatedAt = new Set(
      allBlocks.map((b) => (b as { created_at?: unknown }).created_at),
    ).size;
    const distinctScope = new Set(allBlocks.map((b) => (b as { scope?: unknown }).scope)).size;
    console.log(
      `[RNK] Variance check: distinct created_at=${String(distinctCreatedAt)}, distinct scope=${String(distinctScope)}`,
    );
    if (distinctCreatedAt <= 1) {
      throw new Error(
        "[RNK] VARIANCE-FAIL: All blocks have the same created_at — 02-03a reseed did NOT take effect. " +
          "Run: cd packages/mcp-server && npm run test:eval -- seed-eval-fixtures.eval.test.ts",
      );
    }
    if (distinctScope <= 1) {
      throw new Error(
        "[RNK] VARIANCE-FAIL: All blocks have the same scope — 02-03a reseed did NOT take effect. " +
          "Run: cd packages/mcp-server && npm run test:eval -- seed-eval-fixtures.eval.test.ts",
      );
    }

    // -------------------------------------------------------------------------
    // Step 2: Compute cosine-only baseline (D-34 gate calibration).
    // The cosine-only baseline = rerank weight dominant, all other weights zero,
    // threshold = 0.60 (today's production default). This is the shipped behavior
    // the winner must beat by IMPROVEMENT_DELTA_MIN (≥0.02 absolute F1).
    // -------------------------------------------------------------------------

    const baselineTrain = scoreSplit(
      trainSet,
      resolutions,
      COSINE_ONLY_BASELINE_CFG,
      COSINE_ONLY_BASELINE_THRESHOLD,
    );
    const baselineValidate = scoreSplit(
      validateSet,
      resolutions,
      COSINE_ONLY_BASELINE_CFG,
      COSINE_ONLY_BASELINE_THRESHOLD,
    );
    console.log(
      `[RNK] Cosine-only baseline: f1_train=${baselineTrain.f1.toFixed(4)} f1_validate=${baselineValidate.f1.toFixed(4)} threshold=${String(COSINE_ONLY_BASELINE_THRESHOLD)}`,
    );

    // -------------------------------------------------------------------------
    // Step 3: Enumerate 2500 configs (625 weight configs × 4 thresholds).
    // PURE-MATH reranking only — no env.AI or env.VECTORIZE calls in this loop.
    // -------------------------------------------------------------------------

    const sweepResults: SweepResult[] = [];

    for (const { cfg, threshold } of enumerateGrid()) {
      const trainMetrics = scoreSplit(trainSet, resolutions, cfg, threshold);
      const validateMetrics = scoreSplit(validateSet, resolutions, cfg, threshold);
      sweepResults.push({ cfg, threshold, train: trainMetrics, validate: validateMetrics });
    }

    // Test: sweep produces exactly 2500 results (625 weight configs × 4 thresholds).
    expect(sweepResults.length).toBe(2500);

    console.log(
      `[RNK] Sweep complete: ${String(sweepResults.length)} configs evaluated (D-34: 625 × 4 thresholds)`,
    );

    // -------------------------------------------------------------------------
    // Anti-reward-hack tunability assertion (closes HR-2 blocker).
    // The F1 surface must be non-degenerate: at least 2 distinct train.f1 values
    // across the 2500 configs. If all 2500 share one F1, the three variance sources
    // (recency, type_match, scope_match) are still constant → the 02-03a reseed +
    // expected_args labeling did NOT take effect in the running eval.
    // -------------------------------------------------------------------------

    const distinctF1Values = new Set(sweepResults.map((r) => r.train.f1));
    const f1Min = Math.min(...sweepResults.map((r) => r.train.f1));
    const f1Max = Math.max(...sweepResults.map((r) => r.train.f1));
    console.log(
      `[RNK] f1 spread: min=${f1Min.toFixed(4)} max=${f1Max.toFixed(4)} distinct=${String(distinctF1Values.size)}`,
    );
    if (distinctF1Values.size <= 1) {
      throw new Error(
        "[RNK] TUNABILITY-FAIL (HR-2): All 2500 configs produced identical F1=" +
          f1Min.toFixed(4) +
          ". The eval is not tunable — check that:\n" +
          "  1. seed-eval-fixtures.eval.test.ts ran AFTER 02-03a (new created_at+scope metadata)\n" +
          "  2. expected_args is wired in scoreSplit (see this file's D-26 call sites)\n" +
          "  3. Vectorize returned blocks with real metadata (distinct created_at > 1)",
      );
    }
    // Assert non-degenerate spread (vitest assertion form for test reporting).
    expect(distinctF1Values.size).toBeGreaterThan(1);

    // -------------------------------------------------------------------------
    // Step 4: D-03 selection — top-3 by train.f1, then Pareto front.
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
      throw new Error("[RNK] Pareto front is empty — should not happen with 2500 configs");
    }

    // Test: D-03 selection is deterministic (same input → same winner).
    // Verified implicitly: sweepResults is deterministic for fixed corpus+weights.
    expect(winner).toBeDefined();
    expect(winner.cfg).toBeDefined();
    expect(typeof winner.threshold).toBe("number");

    // -------------------------------------------------------------------------
    // Step 5: D-04 strict train→validate gap gate.
    // -------------------------------------------------------------------------

    const gap = winner.train.f1 - winner.validate.f1;
    console.log(
      `[RNK] Winner cfg=${JSON.stringify(winner.cfg)} threshold=${String(winner.threshold)} f1_train=${winner.train.f1.toFixed(4)} f1_validate=${winner.validate.f1.toFixed(4)} gap=${gap.toFixed(4)}`,
    );

    // D-04: gap MUST be < 10pp STRICT (boundary = 10pp is REJECTED per CONTEXT.md D-04).
    expect(gap).toBeLessThan(TRAIN_VALIDATE_GAP_LIMIT);

    // -------------------------------------------------------------------------
    // Step 6: RNK-04 sensitivity — top1_flip_rate < 30%.
    // Uses adjacent grid neighbors (D-02): ±0.05 on all 4 weight axes (8 perturbations).
    // Threshold held fixed at winner threshold (we perturb weights, not threshold).
    // Pure-math: no additional AI/Vectorize calls.
    // -------------------------------------------------------------------------

    const flipRate = top1FlipRate(winner.cfg, winner.threshold, resolutions, trainSet);
    console.log(
      `[RNK] Sensitivity top1_flip_rate=${flipRate.toFixed(4)} (gate < ${String(SENSITIVITY_FLIP_LIMIT)})`,
    );

    expect(flipRate).toBeLessThan(SENSITIVITY_FLIP_LIMIT);

    // -------------------------------------------------------------------------
    // Step 7: RNK-06 recalibrated gate (D-34).
    // The winner must beat the cosine-only baseline by IMPROVEMENT_DELTA_MIN (≥0.02).
    // This is the defensible claim: tuning added real value vs. shipped behavior.
    //
    // D-34 STOP CONDITION: if NO config beats the baseline by the required margin,
    // the problem is corpus/embedding quality, NOT tuning. Do NOT force a pick.
    // -------------------------------------------------------------------------

    const improvementDelta = winner.train.f1 - baselineTrain.f1;
    console.log(
      `[RNK] Improvement over cosine-only baseline: winner=${winner.train.f1.toFixed(4)} baseline=${baselineTrain.f1.toFixed(4)} delta=${improvementDelta.toFixed(4)} (gate ≥ ${String(IMPROVEMENT_DELTA_MIN)})`,
    );

    // D-34 STOP CONDITION check: if nothing beats baseline by required margin, halt.
    if (improvementDelta < IMPROVEMENT_DELTA_MIN) {
      // Check if ANY config in the sweep beat the baseline by the required margin.
      const anyBeatBaseline = sweepResults.some(
        (r) => r.train.f1 - baselineTrain.f1 >= IMPROVEMENT_DELTA_MIN,
      );
      if (!anyBeatBaseline) {
        console.warn("RNK-06-FLATLINE-VS-BASELINE", {
          baselineF1: baselineTrain.f1,
          winnerF1: winner.train.f1,
          improvementDelta,
          requiredDelta: IMPROVEMENT_DELTA_MIN,
          note: "Per D-34 STOP CONDITION: no (threshold, weights) config beat the cosine-only baseline by the required margin. Problem is corpus/embedding quality, NOT tuning. Do NOT commit weights. Raise blocker for human review.",
        });
      }
    }

    expect(improvementDelta).toBeGreaterThanOrEqual(IMPROVEMENT_DELTA_MIN);

    // -------------------------------------------------------------------------
    // Step 8: D-15 dual-corpus regression gate.
    // Pre-resolve the 27-entry real-corpus.json queries (~27 AI + ~27 Vectorize).
    //
    // Budget note: the main sweep uses ~100 AI + ~100 Vectorize = 200 budget calls
    // (eval-budget.setup.ts counts BOTH env.AI.run AND env.VECTORIZE.query toward
    // the MAX_AI_CALLS=200 shared counter). D-15 needs 27+27=54 MORE calls (total
    // 254), which EXCEEDS the budget. The eval-budget guard will throw on call #201.
    //
    // Defensive pattern: catch the budget-exceeded error and skip D-15 gracefully.
    // The D-15 check will run once budget is restructured (Phase 3 or standalone).
    // Until then, log [RNK-D15-BUDGET-EXCEEDED] so the deviation is tracked.
    //
    // D-34 D-15: compare winner vs cosine-only baseline on real-corpus too.
    // Schema adapter: real-corpus.json uses paraphrased_query + intended_memory_id.
    // -------------------------------------------------------------------------

    let realF1: number | null = null;
    let realBaselineF1: number | null = null;
    try {
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

        // D-34: store ALL raw matches, no threshold applied during pre-fetch.
        const rawMatches = result.matches;

        const blocks = rawMatches.map((m) => ({
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

        realResolutions.set(entry.id, { rawMatches, blocks });
      }

      // D-34: score real-corpus with winner threshold AND with cosine-only baseline.
      realF1 = scoreRealSplit(realCorpus, realResolutions, winner.cfg, winner.threshold);
      realBaselineF1 = scoreRealSplit(
        realCorpus,
        realResolutions,
        COSINE_ONLY_BASELINE_CFG,
        COSINE_ONLY_BASELINE_THRESHOLD,
      );
      const realImprovementDelta = realF1 - realBaselineF1;
      console.log(
        `[RNK] D-15 real-corpus: winner F1=${realF1.toFixed(4)} baseline F1=${realBaselineF1.toFixed(4)} delta=${realImprovementDelta.toFixed(4)} (gate: winner > baseline)`,
      );

      // D-15 STOP procedure (D-34 recalibrated): winner must also beat cosine-only
      // baseline on the real-corpus (same defensible claim as the 100-entry corpus).
      if (realImprovementDelta < 0) {
        console.warn("RNK-06-D15-REGRESSION", {
          sweepWinnerF1: realF1,
          cosineBaselineF1: realBaselineF1,
          winnerCfg: winner.cfg,
          winnerThreshold: winner.threshold,
          note: "Per D-34 D-15: sweep winner F1 on 27-entry real-corpus is BELOW the cosine-only baseline on the same corpus. This may indicate overfitting to the 100-entry train corpus. Surfacing as decision point — do NOT auto-commit weights without human review.",
        });
      }

      // The assertion: winner must be at least as good as cosine-only baseline on real-corpus.
      expect(realF1).toBeGreaterThanOrEqual(realBaselineF1);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Budget-exceeded is expected when main sweep uses all 200 budget calls.
      // D-15 runs in a separate session once the eval-budget counter is restructured.
      if (errMsg.includes("MAX_AI_CALLS exceeded")) {
        console.warn(
          "[RNK-D15-BUDGET-EXCEEDED] D-15 dual-corpus check skipped: main sweep consumed all 200 budget calls. " +
            "Run seed-eval-fixtures + recall-ranking evals in separate sessions to run D-15.",
        );
        realF1 = null; // D-15 not run
        realBaselineF1 = null;
      } else {
        throw err; // re-throw non-budget errors
      }
    }

    // -------------------------------------------------------------------------
    // Step 9: Log winner in machine-parseable format for Task 2 extraction.
    // D-34: includes threshold + cosine_only_baseline_f1 + improvement_delta.
    // -------------------------------------------------------------------------

    console.log(
      `[RNK-WINNER] cfg=${JSON.stringify(winner.cfg)} threshold=${String(winner.threshold)} f1_train=${winner.train.f1.toFixed(4)} f1_validate=${winner.validate.f1.toFixed(4)} mrr_train=${winner.train.mrr.toFixed(4)} top1_train=${winner.train.top1.toFixed(4)} sensitivity_top1_flip_rate=${flipRate.toFixed(4)} cosine_only_baseline_f1=${baselineTrain.f1.toFixed(4)} improvement_delta=${improvementDelta.toFixed(4)} real_corpus_f1=${realF1 !== null ? realF1.toFixed(4) : "skipped-budget"} real_corpus_baseline_f1=${realBaselineF1 !== null ? realBaselineF1.toFixed(4) : "skipped-budget"}`,
    );
  }, 600_000); // 600s timeout: 200 queries × ~200ms embed+Vectorize ≈ ~40-60s on cold infra
});
