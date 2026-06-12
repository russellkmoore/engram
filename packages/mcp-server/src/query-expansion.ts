/**
 * `query-expansion.ts` — zod-gated query rewriter module (EXP-01, EXP-02, EXP-09).
 *
 * Exports:
 * - `ExpansionOutput` — zod schema (exactly 2 paraphrases, `.length(2)` hard cap)
 * - `EXPANSION_JSON_SCHEMA` — Workers AI `response_format.json_schema` derived via
 *   native `z.toJSONSchema` (NOT the third-party zod→json-schema converter — ENG-21) + sanitization
 * - `EXPANSION_SYSTEM_PROMPT` — anti-HyDE (EXP-09) + entity-preservation (EXP-12) rules
 * - `expandQuery(env, originalQuery)` — turns one query into `[original, p1, p2]`
 *   with the original anchored at variant[0] (QE-7: model can never drop the anchor)
 * - `keepVariantsAboveGate(env, queryVector, variants, gate)` — cosine similarity gate
 *   that drops paraphrases below 0.85 silently (EXP-02)
 *
 * Cross-phase contracts:
 * - **EXP-01**: `expandQuery` always returns `[originalQuery, ...paraphrases]`;
 *   the original is prepended in CODE, never requested from the model (QE-7).
 * - **EXP-02**: `keepVariantsAboveGate` enforces the 0.85 cosine gate; variant[0]
 *   (the original) is never embedded against itself or dropped.
 * - **EXP-09**: `EXPANSION_SYSTEM_PROMPT` explicitly forbids HyDE / hypothetical-
 *   document / fabricated-answer generation. Behavioral eval in plan 03-05.
 * - **EXP-10**: on a thrown error (incl. RateLimitError), re-throw so recall()'s
 *   catch can apply the single-query fallback + meta.gaps note. Do NOT swallow.
 *
 * @module @engram/mcp-server/query-expansion
 */

import { z } from "zod";
import { sanitizeJsonSchemaForWorkersAI, EMBEDDING_MODEL } from "@engram/ai-config";
import { safeRun, QUERY_EXPANSION_MODEL } from "./ai-helper.js";

// ---------------------------------------------------------------------------
// ExpansionOutput — zod schema (EXP-01 variant cap: exactly 2 paraphrases)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the LLM response. Exactly 2 paraphrases — the `.length(2)` is
 * the hard variant cap (EXP-01). The original query is prepended by the caller,
 * so the model receives a request for exactly 2 rewrites.
 */
export const ExpansionOutput = z.object({
  paraphrases: z.array(z.string().min(1).max(400)).length(2),
});

/** TypeScript type alias — same name as the Zod schema (z.infer pattern). */
export type ExpansionOutput = z.infer<typeof ExpansionOutput>;

// ---------------------------------------------------------------------------
// EXPANSION_JSON_SCHEMA — derived from ExpansionOutput for LLM response_format
// ---------------------------------------------------------------------------

/**
 * JSON schema derived from `ExpansionOutput` via zod v4's native `z.toJSONSchema`.
 *
 * THREE locked derivation steps (copied from triage-worker/src/schemas.ts:131-138):
 *   1. `z.toJSONSchema` — native zod@4 (NOT the third-party zod→json-schema@3.x converter — ENG-21)
 *   2. Destructure-strip `$schema` — saves request bytes
 *   3. `sanitizeJsonSchemaForWorkersAI` — strips `propertyNames` → avoids Scout error 3030
 */
export const EXPANSION_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(ExpansionOutput);
  void $schema;
  return sanitizeJsonSchemaForWorkersAI(schema);
})();

// ---------------------------------------------------------------------------
// EXPANSION_SYSTEM_PROMPT — anti-HyDE (EXP-09) + entity-preservation (EXP-12)
// ---------------------------------------------------------------------------

/**
 * System prompt for the query expansion call.
 *
 * Rules encoded (non-negotiable per EXP-09 + EXP-12):
 * 1. Anti-HyDE (EXP-09): each rewrite MUST be a real search query, NOT a
 *    hypothetical answer or fabricated document. Never invent facts (NO HyDE).
 * 2. Named-entity preservation (EXP-12): preserve every named entity (people,
 *    companies, products, dates) from the original query verbatim in BOTH rewrites.
 * 3. Vary phrasing / synonyms only — do not change the subject.
 */
export const EXPANSION_SYSTEM_PROMPT =
  "You rewrite a search query into 2 alternative phrasings that preserve the user's intent. " +
  "RULES: " +
  "(1) Each rewrite MUST be a real search query, NOT a hypothetical answer or fabricated " +
  "document — never invent facts (NO HyDE). " +
  "(2) Preserve every named entity (people, companies, products, dates) from the original " +
  "query verbatim in BOTH rewrites. " +
  "(3) Vary phrasing and synonyms only — do not change the subject. " +
  'Return JSON: { "paraphrases": ["...", "..."] }.';

// ---------------------------------------------------------------------------
// expandQuery — EXP-01: original anchored at variant[0]
// ---------------------------------------------------------------------------

/**
 * Turn one query into `[original, paraphrase1, paraphrase2]`.
 *
 * The original query is ALWAYS at index 0 (prepended in code, never requested
 * from the model — QE-7 anchor). On a zod parse failure, degrades gracefully
 * to `[originalQuery]` (single-query path). On a thrown error (incl. RateLimitError),
 * re-throws so recall()'s catch can apply the EXP-10 fallback + meta.gaps note.
 *
 * @param env - Environment bindings (AI binding required for safeRun).
 * @param originalQuery - The user's original search query.
 * @returns Promise resolving to `[original, p1, p2]` on success, or `[original]`
 *   on zod gate failure. Throws on network/AI errors.
 */
export async function expandQuery(env: { AI: Ai }, originalQuery: string): Promise<string[]> {
  const resp = await safeRun(env, QUERY_EXPANSION_MODEL, {
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

  // Workers AI chat responses wrap JSON in a `response` field.
  // Extract.ts:204-208: unwrap `response` then gate.
  const rawResponse = (resp as { response?: unknown }).response;
  const candidate =
    typeof rawResponse === "string"
      ? (() => {
          try {
            return JSON.parse(rawResponse) as unknown;
          } catch {
            return rawResponse; // let safeParse reject it
          }
        })()
      : (rawResponse ?? resp);

  const parsed = ExpansionOutput.safeParse(candidate);
  if (!parsed.success) {
    // Gate failure → degrade to single query (EXP-01 fallback)
    return [originalQuery];
  }

  // EXP-01: original is variant[0] — prepended here, never from the model.
  return [originalQuery, ...parsed.data.paraphrases];
}

// ---------------------------------------------------------------------------
// cosine — local pure helper
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two equal-length vectors.
 * Pure — no env, no IO.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// keepVariantsAboveGate — EXP-02: 0.85 cosine similarity gate
// ---------------------------------------------------------------------------

/**
 * Filter paraphrases by cosine similarity to the original query vector.
 *
 * - `variants[0]` is the original query — it is ALWAYS kept and never gate-checked
 *   (it is the anchor; comparing it to itself is vacuous — QE-7).
 * - For each subsequent paraphrase, embed via `safeRun(env, EMBEDDING_MODEL, ...)`
 *   and compute cosine against the supplied `queryVector` (already-computed original
 *   vector — do NOT re-embed the original).
 * - Paraphrases below `gate` (default 0.85) are dropped SILENTLY (no throw, no log
 *   noise — QE-2 defense against drift).
 * - Paraphrases are embedded in parallel via `Promise.all`.
 *
 * @param env - Environment bindings (AI binding required).
 * @param queryVector - Pre-computed embedding of the original query (reused; not
 *   re-embedded here so the caller controls when that round-trip happens).
 * @param variants - Array where variants[0] is the original query, subsequent
 *   elements are paraphrases to gate-check.
 * @param gate - Cosine similarity threshold (default 0.85 — EXP-02).
 * @returns Promise resolving to the filtered variants array (always includes
 *   variants[0]).
 */
export async function keepVariantsAboveGate(
  env: { AI: Ai },
  queryVector: number[],
  variants: string[],
  gate = 0.85,
): Promise<string[]> {
  if (variants.length <= 1) {
    // Only the original (or empty) — nothing to gate-check.
    return variants;
  }

  const paraphrases = variants.slice(1);

  // Embed paraphrases in parallel — do NOT re-embed variants[0].
  const embedResults = await Promise.all(
    paraphrases.map(async (paraphrase) => {
      try {
        const resp = await safeRun(env, EMBEDDING_MODEL, { text: [paraphrase] });
        const vec = (resp as { data?: number[][] }).data?.[0];
        if (!vec) return null;
        const sim = cosine(queryVector, vec);
        return sim >= gate ? paraphrase : null; // drop silently if below gate
      } catch {
        // EXP-02: embedding failure → drop silently (no crash)
        return null;
      }
    }),
  );

  const kept = embedResults.filter((p): p is string => p !== null);
  // variants[0] (the original) is ALWAYS first — never gated, never dropped.
  // We already checked variants.length > 1 above, so variants[0] is defined.
  const original = variants[0] ?? "";
  return [original, ...kept];
}
