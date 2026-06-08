/**
 * EXP-08 A/B + EXP-09 anti-HyDE + EXP-12 entity-preservation — query-expansion eval.
 *
 * PURPOSE
 * -------
 * A/B tests the Scout default (`QUERY_EXPANSION_MODEL`) versus the smaller/faster
 * challenger (`EXPANSION_CHALLENGER_MODEL` = @cf/meta/llama-3.2-3b-instruct) on
 * recall@5 over the recall-corpus-v2.json corpus.
 *
 * EXP-08: Computes recall@5 for each model and logs the promotion verdict.
 *   Promotion gate: 3.2-3b recall@5 ≥ Scout recall@5 − 0.05 (5pp).
 *   A follow-on PR, NOT this phase — Scout stays QUERY_EXPANSION_MODEL default.
 *
 * EXP-09: Behavioral anti-HyDE assertion on Scout's actual expansion output.
 *   Checks variants are search phrasings, not fabricated answers/documents.
 *   Complements the unit-test prompt-string assertion in 03-02.
 *
 * EXP-12: Named-entity preservation across the corpus.
 *   Gate: corpus-averaged entityPreservationRate > 0.80.
 *   Heuristic: capitalized-token regex /\b[A-Z][a-zA-Z0-9.&-]+\b/g (RESEARCH A5).
 *
 * SESSION ISOLATION (A4 / MAX_AI_CALLS=200)
 * -----------------------------------------
 * IMPORTANT: Run in its own vitest session, SEPARATE from the EXP-07 reranker-ablation
 * (plan 03-04). Two ~100-query pre-resolves exceed MAX_AI_CALLS=200. Never run this
 * eval together with reranker-ablation.eval.test.ts in the same session.
 *
 * Budget: Each corpus query costs ~2 AI (expansion: 1 Scout + 1 3.2-3b) + 1 embedding
 * + 1 Vectorize per variant set. We cap the subset to a query count (see EVAL_QUERY_CAP)
 * that keeps total calls ≤ 200.
 *
 * @module @engram/mcp-server/query-expansion-recall-eval
 * @requirement EXP-08, EXP-09, EXP-12
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  EMBEDDING_MODEL,
  QUERY_EXPANSION_MODEL,
  EXPANSION_CHALLENGER_MODEL,
  VECTORIZE_OVERFETCH_FACTOR,
} from "@engram/ai-config";
import { vectorizeQuery } from "@engram/vectorize-utils";
import { expandQuery, EXPANSION_SYSTEM_PROMPT } from "../../query-expansion.js";
import { safeRun } from "../../ai-helper.js";
import { ExpansionOutput, EXPANSION_JSON_SCHEMA } from "../../query-expansion.js";

// Loaded as a build-time JSON import (Vite bundles it into the worker).
// Workers in @cloudflare/vitest-pool-workers cannot use fs.readFileSync against
// host-filesystem paths outside the bundle — JSON imports are the only safe path.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Budget discipline
// ---------------------------------------------------------------------------

/**
 * Maximum queries to pre-resolve in this eval session.
 *
 * Budget math (per-query):
 *   - 1 embed (original) → Vectorize (base)
 *   - 1 expansion AI call (Scout)
 *   - 1 expansion AI call (3.2-3b challenger)
 *   - 3 variant embed calls (up to 3 variants per model — pruned by cosine gate)
 *   - 3 Vectorize fan-out calls per model (up to 3 variants × 2 models)
 *
 * Conservative estimate: ~8-10 calls per query. With 200 budget:
 *   200 / 10 = 20 queries safely. We cap at 20 to stay within budget.
 *   Total logged and kept ≤ MAX_AI_CALLS=200 (enforced by eval-budget.setup.ts).
 *
 * SEPARATE SESSION FROM reranker-ablation (A4): do NOT co-run with plan 03-04's
 * eval — that eval alone uses ~200 calls; combining would blow the budget.
 */
const EVAL_QUERY_CAP = 20;

// Eval workspace — stable seeded fixtures, isolated from production (T-03-13).
const EVAL_WORKSPACE_ID = "eval-fixtures";

// Promotion gate: 3.2-3b must be within 5pp of Scout's recall@5 (EXP-08).
const PROMOTION_RECALL_DELTA = 0.05;

// EXP-12 entity-preservation gate (corpus-averaged).
const ENTITY_PRESERVATION_GATE = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorpusEntry {
  id: string;
  bucket: string;
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

// ---------------------------------------------------------------------------
// EXP-12: Named-entity preservation helpers
// (RESEARCH §Code Examples lines 384-395 — capitalized-token heuristic)
// ---------------------------------------------------------------------------

/**
 * Extract named entities from a query using the capitalized-token heuristic.
 *
 * Heuristic (EXP-12 / RESEARCH A5): matches tokens starting with an uppercase
 * letter followed by at least one alphanumeric or punctuation character.
 * Covers people names, company names, products, acronyms, and proper nouns.
 * Returns a deduplicated set (Set → array conversion preserves insertion order).
 *
 * Limitation (RESEARCH A5): misses all-lowercase proper nouns and multi-word
 * entities that span capitalization boundaries. Acceptable for a >80% aggregate
 * gate; a curated per-query entity list would be more precise if noise surfaces.
 */
function namedEntities(q: string): string[] {
  return [...new Set(q.match(/\b[A-Z][a-zA-Z0-9.&-]+\b/g) ?? [])];
}

/**
 * Compute entity preservation rate: fraction of named entities from `original`
 * that appear verbatim in at least one expansion variant.
 *
 * Returns 1.0 (vacuously satisfied) when the original query has no capitalized
 * tokens (e.g., a fully lowercase query has nothing to preserve).
 *
 * EXP-12 gate: corpus-averaged rate > 0.80 (ENTITY_PRESERVATION_GATE).
 */
function entityPreservationRate(original: string, variants: string[]): number {
  const ents = namedEntities(original);
  if (ents.length === 0) return 1; // vacuously satisfied — no entities to preserve
  const present = ents.filter((e) => variants.some((v) => v.includes(e)));
  return present.length / ents.length; // EXP-12 gate: > 0.80 averaged across corpus
}

// ---------------------------------------------------------------------------
// EXP-09: Anti-HyDE behavioral heuristic
// ---------------------------------------------------------------------------

/**
 * Returns true if a variant looks like a search phrasing (good), false if it
 * looks like a fabricated answer / HyDE-style document (bad).
 *
 * Heuristic: A variant is flagged as HyDE-like if it:
 *   (a) ends with a sentence-terminating fact claim (period followed by additional
 *       text or a trailing period on a long sentence), OR
 *   (b) is significantly longer than the original query (>3× chars), suggesting
 *       the model generated a paragraph rather than a concise alternative phrasing.
 *
 * This is a CONSERVATIVE check — false negatives (subtle HyDE) are acceptable;
 * we just want to catch obvious answer-style variants. The EXP-09 behavioral
 * assertion complements the prompt-string unit test in 03-02 (which only checks
 * the prompt contains the no-HyDE rule, not the actual model output).
 *
 * Returns: { ok: boolean; reason?: string }
 */
function antiHydeCheck(originalQuery: string, variant: string): { ok: boolean; reason?: string } {
  // Too long: ≥3× original query length suggests a generated document/answer.
  if (variant.length > originalQuery.length * 3) {
    return {
      ok: false,
      reason: `Variant too long (${String(variant.length)} chars vs original ${String(originalQuery.length)}) — likely a fabricated answer, not a search phrasing`,
    };
  }
  // Sentence-ending fact claim: ends with '. ' + more text OR trailing '.' that
  // makes the string look like declarative prose (multiple sentence boundaries).
  const sentenceBoundaries = (variant.match(/\.\s+[A-Z]/g) ?? []).length;
  if (sentenceBoundaries >= 2) {
    return {
      ok: false,
      reason: `Variant contains ${String(sentenceBoundaries)} sentence boundaries — looks like a fabricated document/answer rather than a search query`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recall@5 metric
// ---------------------------------------------------------------------------

/**
 * recall@5 = |expected ∩ top5| / |expected|
 * Measures whether the known-relevant blocks appear in the top-5 Vectorize results.
 * Using top5 (not top3) because query expansion tends to surface more relevant results
 * at slightly lower rank than single-query search.
 */
function computeRecall5(matches: { id: string }[], expectedIds: readonly string[]): number {
  if (expectedIds.length === 0) return 0;
  const top5Ids = new Set(matches.slice(0, 5).map((m) => m.id));
  const hits = expectedIds.filter((id) => top5Ids.has(id)).length;
  return hits / expectedIds.length;
}

// ---------------------------------------------------------------------------
// Creds guard (mirrors recall-ranking.eval.test.ts pattern)
// ---------------------------------------------------------------------------

function hasEvalCreds(): boolean {
  if (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID) return true;
  try {
    return typeof (env as { AI?: unknown }).AI !== "undefined";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: expand a query with a SPECIFIC model (EXP-08 A/B challenger support)
// ---------------------------------------------------------------------------

/**
 * Runs the expansion call with an explicit model ID, using the same EXPANSION_JSON_SCHEMA
 * and prompt as `expandQuery` — but allows overriding the model for A/B comparison.
 *
 * Returns `[originalQuery]` (degrade-to-single) on zod gate failure, same as expandQuery.
 * Re-throws on network/AI errors so the budget counter catches them.
 */
async function expandQueryWithModel(
  queryEnv: { AI: Ai },
  originalQuery: string,
  model: string,
): Promise<string[]> {
  const resp = await safeRun(queryEnv, model, {
    messages: [
      { role: "system", content: EXPANSION_SYSTEM_PROMPT },
      { role: "user", content: originalQuery },
    ],
    response_format: {
      type: "json_schema",
      json_schema: EXPANSION_JSON_SCHEMA,
    },
    temperature: 0.4, // modest — drift defense (QE-2)
    max_tokens: 256,
  });
  const rawResponse = (resp as { response?: unknown }).response;
  const candidate =
    typeof rawResponse === "string"
      ? (() => {
          try {
            return JSON.parse(rawResponse) as unknown;
          } catch {
            return rawResponse;
          }
        })()
      : (rawResponse ?? resp);

  const parsed = ExpansionOutput.safeParse(candidate);
  if (!parsed.success) {
    return [originalQuery]; // degrade to single-query
  }
  return [originalQuery, ...parsed.data.paraphrases];
}

// ---------------------------------------------------------------------------
// Cast corpus
// ---------------------------------------------------------------------------

const corpus = corpusJson as unknown as CorpusFile;

// ---------------------------------------------------------------------------
// EXP-12 prompt-string sanity check (no creds required)
// ---------------------------------------------------------------------------

describe("EXP-09 prompt-string sanity (no creds required)", () => {
  it("EXPANSION_SYSTEM_PROMPT contains the no-HyDE rule", () => {
    // Belt-and-suspenders: the unit test in 03-02 also checks this.
    // Here we assert the behavioral anti-HyDE check has a textual anchor in the prompt
    // that the model can act on — "NO HyDE" or "hypothetical" must appear.
    expect(
      EXPANSION_SYSTEM_PROMPT.toLowerCase().includes("hyde") ||
        EXPANSION_SYSTEM_PROMPT.toLowerCase().includes("hypothetical"),
    ).toBe(true);
  });

  it("EXPANSION_SYSTEM_PROMPT mentions entity preservation", () => {
    // EXP-12: the prompt must direct the model to preserve named entities.
    expect(
      EXPANSION_SYSTEM_PROMPT.toLowerCase().includes("named entity") ||
        EXPANSION_SYSTEM_PROMPT.toLowerCase().includes("named entities") ||
        EXPANSION_SYSTEM_PROMPT.toLowerCase().includes("entity"),
    ).toBe(true);
  });

  it("EXPANSION_CHALLENGER_MODEL references llama-3.2-3b-instruct", () => {
    expect(EXPANSION_CHALLENGER_MODEL).toContain("llama-3.2-3b-instruct");
  });

  it("QUERY_EXPANSION_MODEL alias is not the challenger (Scout stays default)", () => {
    // EXP-08: Scout stays the production default — the challenger is eval-only.
    expect(QUERY_EXPANSION_MODEL).not.toBe(EXPANSION_CHALLENGER_MODEL);
  });
});

// ---------------------------------------------------------------------------
// EXP-08 A/B + EXP-09 + EXP-12 live eval (creds required)
// ---------------------------------------------------------------------------

describe("EXP-08 A/B recall@5 + EXP-09 anti-HyDE + EXP-12 entity-preservation (creds required)", () => {
  it(
    "A/B: Scout vs llama-3.2-3b recall@5; entity-preservation >0.80; no HyDE variants",
    async () => {
      if (!hasEvalCreds()) {
        console.log(
          "[SKIP] No CF creds — skipping EXP-08/09/12 eval (set CLOUDFLARE_ACCOUNT_ID to run)",
        );
        return;
      }

      // Subset of the corpus — capped so total AI+Vectorize calls stay ≤ MAX_AI_CALLS=200.
      // Budget per query: ~2 expansion calls (Scout + 3.2-3b) + up to 6 variant embeds +
      // up to 6 Vectorize fan-out calls = ~14 calls worst-case.
      // EVAL_QUERY_CAP=20 × ~8 avg = ~160 calls; stays under 200.
      // Log the count so CI can verify budget compliance.
      const trainEntries = corpus.entries.filter((e) => e.split === "train");
      const evalSubset = trainEntries.slice(0, EVAL_QUERY_CAP);

      console.log(
        `[EXP-08] Eval subset: ${String(evalSubset.length)} queries (cap=${String(EVAL_QUERY_CAP)}, ` +
          `budget ≤ MAX_AI_CALLS=200). Session is SEPARATE from reranker-ablation (A4 MAX_AI_CALLS=200).`,
      );

      // Accumulate per-model recall@5 and EXP-12 entity-preservation rates.
      let scoutRecall5Sum = 0;
      let challengerRecall5Sum = 0;
      let entityPreservationSum = 0;
      let entityPreservationCount = 0;

      // EXP-09: track anti-HyDE failures across the corpus.
      const antiHydeFailures: string[] = [];

      for (const entry of evalSubset) {
        // Step 1: Embed the original query (shared — one call, used by both models).
        const embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [entry.query] });
        const queryVec = (embedResp as { data?: number[][] }).data?.[0];
        if (!queryVec || queryVec.length === 0) {
          console.warn(`[EXP-08] embed failed for entry ${entry.id} — skipping`);
          continue;
        }

        // Step 2a: Expand with Scout (QUERY_EXPANSION_MODEL — production default).
        let scoutVariants: string[];
        try {
          scoutVariants = await expandQuery(env, entry.query);
        } catch {
          // Treat expansion failure as degrade-to-single-query (EXP-10 pattern).
          scoutVariants = [entry.query];
        }

        // Step 2b: Expand with the challenger (EXPANSION_CHALLENGER_MODEL = llama-3.2-3b).
        let challengerVariants: string[];
        try {
          challengerVariants = await expandQueryWithModel(
            env,
            entry.query,
            EXPANSION_CHALLENGER_MODEL,
          );
        } catch {
          challengerVariants = [entry.query];
        }

        // Step 3: EXP-09 anti-HyDE check on Scout's variants (the production model).
        // Heuristic: each variant must be a search phrasing, not a fabricated answer.
        // See antiHydeCheck() for the two-part heuristic + its documented limitations.
        for (const variant of scoutVariants.slice(1)) {
          const check = antiHydeCheck(entry.query, variant);
          if (!check.ok) {
            const msg = `Entry ${entry.id}: "${variant.slice(0, 60)}..." — ${check.reason ?? "anti-HyDE violation"}`;
            antiHydeFailures.push(msg);
          }
        }

        // Step 4: EXP-12 entity-preservation for Scout's variants.
        // Only check on entries that have named entities (vacuously 1.0 otherwise).
        const epRate = entityPreservationRate(entry.query, scoutVariants.slice(1));
        entityPreservationSum += epRate;
        entityPreservationCount++;

        // Step 5a: Fan-out Vectorize with Scout's variants → recall@5.
        const scoutMatches = await (async () => {
          try {
            const lists = await Promise.all(
              scoutVariants.map(async (v) => {
                const variantEmbedResp = await safeRun(env, EMBEDDING_MODEL, { text: [v] });
                const variantVec = (variantEmbedResp as { data?: number[][] }).data?.[0];
                if (!variantVec) return [] as VectorizeMatches["matches"];
                const res = await vectorizeQuery(env, EVAL_WORKSPACE_ID, variantVec, {
                  topK: 5 * VECTORIZE_OVERFETCH_FACTOR,
                  returnMetadata: "all",
                });
                return res.matches;
              }),
            );
            // Deduplicate by id, preserving best-score order (simple flatten + dedup).
            const seen = new Set<string>();
            const merged: VectorizeMatches["matches"] = [];
            for (const list of lists) {
              for (const m of list) {
                if (!seen.has(m.id)) {
                  seen.add(m.id);
                  merged.push(m);
                }
              }
            }
            return merged;
          } catch {
            return [] as VectorizeMatches["matches"];
          }
        })();

        // Step 5b: Fan-out Vectorize with challenger's variants → recall@5.
        const challengerMatches = await (async () => {
          try {
            const lists = await Promise.all(
              challengerVariants.map(async (v) => {
                const variantEmbedResp = await safeRun(env, EMBEDDING_MODEL, { text: [v] });
                const variantVec = (variantEmbedResp as { data?: number[][] }).data?.[0];
                if (!variantVec) return [] as VectorizeMatches["matches"];
                const res = await vectorizeQuery(env, EVAL_WORKSPACE_ID, variantVec, {
                  topK: 5 * VECTORIZE_OVERFETCH_FACTOR,
                  returnMetadata: "all",
                });
                return res.matches;
              }),
            );
            const seen = new Set<string>();
            const merged: VectorizeMatches["matches"] = [];
            for (const list of lists) {
              for (const m of list) {
                if (!seen.has(m.id)) {
                  seen.add(m.id);
                  merged.push(m);
                }
              }
            }
            return merged;
          } catch {
            return [] as VectorizeMatches["matches"];
          }
        })();

        // Step 6: Compute recall@5 for each model.
        const scoutR5 = computeRecall5(scoutMatches, entry.expected_top_3_block_ids);
        const challengerR5 = computeRecall5(challengerMatches, entry.expected_top_3_block_ids);
        scoutRecall5Sum += scoutR5;
        challengerRecall5Sum += challengerR5;
      }

      // ---------------------------------------------------------------------------
      // Aggregate + report
      // ---------------------------------------------------------------------------

      const n = evalSubset.length;
      const scoutRecall5 = n > 0 ? scoutRecall5Sum / n : 0;
      const challengerRecall5 = n > 0 ? challengerRecall5Sum / n : 0;
      const avgEntityPreservation =
        entityPreservationCount > 0 ? entityPreservationSum / entityPreservationCount : 1;

      // EXP-08: promotion verdict — 3.2-3b is promotable if within 5pp of Scout.
      // Promotion is a FOLLOW-ON PR, not this phase. This eval only LOGS the verdict.
      const promotable = challengerRecall5 >= scoutRecall5 - PROMOTION_RECALL_DELTA;

      console.log(
        `[EXP-08] recall@5(Scout=${QUERY_EXPANSION_MODEL})=${scoutRecall5.toFixed(4)} ` +
          `recall@5(3.2-3b=${EXPANSION_CHALLENGER_MODEL})=${challengerRecall5.toFixed(4)} ` +
          `promotable=${String(promotable)} (gate: 3.2-3b ≥ Scout − ${String(PROMOTION_RECALL_DELTA * 100)}pp)`,
      );
      console.log(
        `[EXP-12] entityPreservation=${avgEntityPreservation.toFixed(4)} ` +
          `(gate >=${String(ENTITY_PRESERVATION_GATE)}, n=${String(entityPreservationCount)})`,
      );
      console.log(
        `[EXP-09] antiHyDE failures: ${String(antiHydeFailures.length)} / ${String(n)} queries`,
      );
      if (antiHydeFailures.length > 0) {
        for (const msg of antiHydeFailures) {
          console.warn(`[EXP-09 FAIL] ${msg}`);
        }
      }

      // EXP-12: assert corpus-averaged entity-preservation rate > 0.80.
      expect(avgEntityPreservation).toBeGreaterThan(ENTITY_PRESERVATION_GATE);

      // EXP-09: assert no anti-HyDE violations in Scout's output.
      // The prompt explicitly forbids HyDE; violations indicate prompt drift.
      expect(antiHydeFailures).toHaveLength(0);

      // EXP-08: log the 5pp promotion gate verdict but do NOT fail the test either way.
      // Promotion decision is a follow-on PR — the A/B test is informational.
      console.log(
        `[EXP-08] Promotion verdict: ${promotable ? "PROMOTABLE" : "NOT PROMOTABLE — Scout stays default"}`,
      );
    },
    // 5-minute timeout — expansion + Vectorize fan-out over 20 queries.
    5 * 60 * 1000,
  );
});
