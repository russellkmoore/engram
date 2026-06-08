/**
 * @engram/ai-config — single source of truth for AI model selection.
 *
 * Both Workers (`@engram/mcp-server`, `@engram/triage-worker`) import their
 * model constants from here. Tests assert against these named constants
 * rather than hardcoding literal model IDs.
 *
 * Swapping a model is a one-line edit in THIS file — no other source code or
 * test needs to change.
 *
 * ## Multi-model architecture
 *
 * v0.1 uses ONE generalist model for ingestion + future synthesis + future
 * query expansion + future vision. The role-named constants (SYNTHESIS_MODEL,
 * QUERY_EXPANSION_MODEL, VISION_MODEL) all alias `INGESTION_CLASSIFIER_MODEL`
 * today. When v0.2/v0.4 work specializes these, only this file changes — the
 * import sites already use the role-named identifier.
 *
 * ## Why these models (ENG-25)
 *
 * Original Phase 5 selection (llama-3.1-8b-instruct + bge-base-en-v1.5) was
 * deprecated by Cloudflare on 2026-05-30. The replacements below were chosen
 * for:
 * - **llama-4-scout-17b-16e-instruct**: 17B activated with 16 experts =
 *   quality at moderate cost. Natively multimodal — same model handles v0.4
 *   PDF/image ingestion via connectors. Russell has prod experience with it
 *   for tool calling.
 * - **qwen3-embedding-0.6b**: 1024 dims, 4096 input tokens. The 4096-token
 *   window directly fixes the 1800-char content truncation flagged in spike
 *   SEED-001 (`.planning/spikes/003-embedding-sensibility/`). 8x larger
 *   context than bge-base-en's 512.
 *
 * @module @engram/ai-config
 */

// ---------------------------------------------------------------------------
// Workers AI model IDs (Cloudflare native catalog)
// ---------------------------------------------------------------------------

/**
 * Classifier model used by the Triage Worker for entity extraction,
 * memory-type classification, memorability scoring, and summarization.
 *
 * Cross-phase contracts:
 * - **AI-05**: passed to `env.AI.run()` with `response_format.json_schema`.
 *   The Zod gate at the runtime boundary is the post-call enforcement.
 * - **AI-06**: drives memorability scoring bands (>0.8 / 0.4–0.8 / <0.4).
 *   The SYSTEM_PROMPT memorability rubric is calibrated to this model's
 *   output distribution; swapping the model invalidates the AI-06 baseline.
 */
export const INGESTION_CLASSIFIER_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct" as const;

/**
 * Embedding model used by both mcp-server (recall path) and triage-worker
 * (ingest path). LOCKED to a specific Vectorize index — the index dimensions
 * MUST match `EMBEDDING_DIMS` below.
 *
 * Cross-phase contracts:
 * - **AI-03**: identical in mcp-server + triage-worker so write/read use the
 *   same embedding space (AI-SPEC.md §1 Critical Failure Mode #2).
 */
export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b" as const;

/**
 * Cross-encoder reranking model consumed via `safeRun` in Phase 3 EXP-06.
 * Replaces raw Vectorize cosine as the `rerank` input to `hybridRank()`;
 * invoked between RRF merge and `hybridRank` in the `recall()` handler.
 *
 * Called through `safeRun(env, RERANKER_MODEL, body)` to sidestep workerd#5998
 * (generated `Ai_Cf_Baai_Bge_Reranker_Base_Input` type omits `query`).
 * Raw logit scores are sigmoid-normalized → [0,1] before entering the
 * tuned `HYBRID_WEIGHTS.rerank` weight (Phase 2 D-05 rename, EXP-06).
 */
export const RERANKER_MODEL = "@cf/baai/bge-reranker-base" as const;

/**
 * Vector dimensions produced by `EMBEDDING_MODEL`. The Vectorize index named
 * `VECTORIZE_INDEX_NAME` was created with these dimensions — swapping the
 * embedding model requires re-creating the index.
 *
 * qwen3-embedding-0.6b: 1024 dims (vs the prior bge-base-en-v1.5 at 768).
 */
export const EMBEDDING_DIMS = 1024 as const;

/**
 * Maximum input tokens the embedding model accepts before truncation. Engram
 * caps content at this length before embedding to avoid silent loss in long
 * memories.
 *
 * qwen3-embedding-0.6b: 4096 tokens (vs the prior bge-base-en-v1.5 at 512).
 * The 8x larger window directly addresses the 1800-char truncation issue
 * flagged in spike SEED-001.
 */
export const EMBEDDING_CONTEXT_WINDOW = 4096 as const;

/**
 * Vectorize index name (both Workers bind to this index via wrangler.jsonc).
 * MUST match the `index_name` in the `vectorize` binding declaration of both
 * `packages/mcp-server/wrangler.jsonc` and `packages/triage-worker/wrangler.jsonc`.
 *
 * Per ENG-25 (2026-06-02): the index was deleted + recreated in place with
 * 1024 dims / cosine metric to match the qwen3-embedding-0.6b swap. No name
 * change because the only embeddings at the time were test runs (no
 * migration baggage).
 */
export const VECTORIZE_INDEX_NAME = "engram-memories" as const;

/**
 * Cosine-similarity threshold used by `recall()` to filter low-relevance
 * Vectorize matches before hydrate + hybrid-rank.
 *
 * Why this exists (ENG-25): Vectorize's `topK` returns the BEST K matches but
 * doesn't filter on absolute relevance. With qwen3-embedding-0.6b's tighter
 * clustering, every query's top-K all clear a minimal relevance bar, so the
 * default `topK=25` returns 25 results regardless of how good the matches
 * actually are. The threshold drops matches below this score so recall returns
 * only the genuinely-relevant ones.
 *
 * Tuned 2026-06-02 against the reference + real corpus. See ENG-25 PR
 * description for the sweep results.
 *
 * If you swap the embedding model, you MUST retune this — different models
 * have different distance distributions.
 */
// D-34 (2026-06-08): tuned from 0.6 → 0.45 via 2500-config sweep (Plan 02-03).
// The D-34 sweep added MIN_COSINE_THRESHOLD as a 4th swept dimension [0.45,0.50,0.55,0.60].
// Winner config selected threshold=0.45: F1=0.4476 vs cosine-only baseline F1=0.3381
// (improvement_delta=0.1095, gate ≥0.02). Threshold ships to production recall() alongside
// HYBRID_WEIGHTS — they tuned together and must move together.
// If you swap the embedding model, you MUST retune this — different models
// have different distance distributions.
export const MIN_COSINE_THRESHOLD = 0.45;

/**
 * Over-fetch multiplier for `recall()` Vectorize queries. We fetch
 * `topK * VECTORIZE_OVERFETCH_FACTOR` from Vectorize, then apply
 * MIN_COSINE_THRESHOLD, then cap at topK. This gives the threshold gate
 * something to filter from when the most-relevant matches don't fill topK.
 */
export const VECTORIZE_OVERFETCH_FACTOR = 2;

/**
 * Hybrid-rank component weights — single source of truth for both Workers.
 *
 * // v0.2 Phase 2: `rerank` weight values tuned against RAW COSINE (`match.score` from Vectorize).
 * // bge-reranker invocation lands in Phase 3 (EXP-06). Until then, `HYBRID_WEIGHTS.rerank * match.score`
 * // means "raw-cosine weighted by the tuned rerank weight." Do NOT read `HYBRID_WEIGHTS.rerank` as
 * // "reranker active" in v0.2.
 * // Corpus: .planning/evals/recall-corpus.json (100 entries, qwen3-embedding-0.6b, sweep date 2026-06-08)
 * // Scores: F1=0.45, MRR=0.85, top1=0.77
 * // Sensitivity (top1_flip_rate over +/-0.05 perturbations of 4 axes x all train queries): 2.7% (RNK-04 gate < 30%)
 * // D-34 recalibration: RNK-06 gate recalibrated from absolute 0.8254 to "beat cosine-only baseline by >=0.02".
 * // Cosine-only baseline F1=0.3381; winner F1=0.4476; improvement_delta=0.1095 (gate passed).
 * // MIN_COSINE_THRESHOLD swept as 4th dimension [0.45,0.50,0.55,0.60]; winner threshold=0.45 (see below).
 * // D-15 dual-corpus: skipped (budget 200 calls exhausted by main 100-entry sweep; same as prior run).
 * // Re-tune at v0.3 when corpus grows.
 *
 * Weights live in `@engram/ai-config` (single source of truth per ENG-25).
 * v0.2 Phase 2 renamed `cosine` → `rerank` per D-05; bge-reranker invocation
 * lands Phase 3 (EXP-06). Plan 02-03 commits tuned values here (D-34 revised
 * sweep: 2500 configs = 625 weight configs × 4 MIN_COSINE_THRESHOLD values).
 */
export const HYBRID_WEIGHTS = {
  rerank: 0.6, // D-05 rename from `cosine`; tuned 2026-06-08 via 2500-config D-34 sweep (Plan 02-03)
  recency: 0.05,
  type_match: 0.1,
  scope_match: 0.05,
} as const;

/**
 * Type for `HYBRID_WEIGHTS` — used by `hybridRank()` optional `weights` parameter.
 * Defined as a structural shape (not `typeof HYBRID_WEIGHTS`) so the Plan 02-03
 * 625-config sweep can pass arbitrary `number` weights without the readonly literal
 * types narrowing the parameter to the exact placeholder values.
 */
export interface HybridWeights {
  rerank: number;
  recency: number;
  type_match: number;
  scope_match: number;
}

// ---------------------------------------------------------------------------
// Role-named aliases (v0.2 / v0.4 will specialize these; today they all
// alias INGESTION_CLASSIFIER_MODEL — Scout handles all four roles)
// ---------------------------------------------------------------------------

/**
 * Model used by `recall()` for `verbosity: "synthesis"` / `verbosity: "both"`
 * to aggregate retrieved memories into a coherent summary.
 *
 * v0.1 alias: same model as INGESTION_CLASSIFIER_MODEL. When v0.2 ships
 * reflect() and recall() synthesis paths, this may specialize to a frontier
 * model (e.g., kimi-k2.6 for cross-memory synthesis with 256K context).
 */
export const SYNTHESIS_MODEL = INGESTION_CLASSIFIER_MODEL;

/**
 * Model used by `recall()` for query expansion — turn one user query into
 * 3-4 semantic variants before the Vectorize search (AI-SPEC.md §"Query
 * expansion: MCP Server (CF AI before Vectorize)").
 *
 * v0.1 alias: same model as INGESTION_CLASSIFIER_MODEL. v0.2 may specialize
 * to a smaller/faster model since query rewriting is a lightweight task.
 */
export const QUERY_EXPANSION_MODEL = INGESTION_CLASSIFIER_MODEL;

/**
 * Model used for image/PDF ingestion when v0.4 connectors (Drive, Slack
 * attachments) need to extract content from non-text sources.
 *
 * v0.1 alias: same model as INGESTION_CLASSIFIER_MODEL — llama-4-scout is
 * natively multimodal. v0.4 may specialize to a dedicated vision model if
 * cost/quality tradeoffs justify it.
 */
export const VISION_MODEL = INGESTION_CLASSIFIER_MODEL;

// ---------------------------------------------------------------------------
// Workers AI JSON-mode schema sanitizer
// ---------------------------------------------------------------------------

/**
 * Strip JSON Schema keywords that Workers AI's JSON Mode validator rejects
 * with error 3030 ("Internal Server Error") on llama-4-scout (and likely
 * other models with strict subset support).
 *
 * Concretely: `z.toJSONSchema()` emits `propertyNames: { type: "string" }`
 * for `z.record(z.string(), ...)` — that keyword is not part of the JSON
 * Mode subset Workers AI accepts. Removing it makes the schema accepted.
 *
 * Idempotent and tolerant of arbitrary nesting depth. Mutates and returns
 * a deep clone of the input — does NOT mutate the caller's schema.
 *
 * If a future model rejects other keywords (e.g., `additionalProperties:
 * false` or `minLength`), add them to the `BANNED` set below.
 */
const BANNED_KEYWORDS = new Set(["propertyNames"]);

function stripBanned(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripBanned);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (BANNED_KEYWORDS.has(key)) continue;
    out[key] = stripBanned(value);
  }
  return out;
}

export function sanitizeJsonSchemaForWorkersAI<T>(schema: T): T {
  return stripBanned(schema) as T;
}
