/**
 * Conflict detection — v0.2 prep (ENG-16).
 *
 * Standalone callable that asks the classifier model to judge whether two
 * memories CONTRADICT each other, describe a BENIGN_UPDATE of the same fact,
 * or are UNRELATED. The eval harness in
 * `__tests__/evals/conflict-precision.eval.test.ts` feeds labeled pairs
 * through this function and scores precision against the ground truth.
 *
 * Why this is a separate file (not folded into `extract.ts`):
 * - `extractAndScore` runs in the Queue consumer hot path and is bound to
 *   that lifecycle (retry/ack, 429 handling, analytics events).
 * - `detectConflict` is a pure inference call with no side effects — it is
 *   safe to call from anywhere (eval harness, future per-write triage flow,
 *   future batch-scan job).
 *
 * Scope of THIS module (per ENG-16):
 * - The standalone callable + the prompt + the schema.
 *
 * Out of scope (deferred to v0.2 feature implementation, after validation):
 * - Vector-similarity prefilter that picks candidate pairs.
 * - Wiring into the queue flow (per-write scanning vs nightly batch).
 * - Writing detected conflicts into the SQLite `conflicts` table.
 * - 429 retry policy (eval harness skips on cost gate; transient failures
 *   are visible in the precision report rather than silently retried).
 *
 * @module @engram/triage-worker/conflict-detection
 */
import { z } from "zod";
import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";

import { CLASSIFIER_MODEL } from "./ai-helper.js";

// ---------------------------------------------------------------------------
// ConflictOutput — the LLM's structured response
// ---------------------------------------------------------------------------

/**
 * Three-way classification of the relationship between two memories.
 *
 * - `contradiction` — A and B describe the SAME entity/fact but cannot both
 *   be true. One refutes or reverses the other.
 * - `benign_update` — A and B describe the SAME entity, with B superseding A
 *   as a forward-in-time change (promotion, status progression). Both true
 *   at different times; NOT a contradiction.
 * - `unrelated`     — A and B describe different entities/topics with no
 *   factual overlap.
 *
 * The `is_conflict` boolean derives mechanically from `category`:
 * `is_conflict === (category === "contradiction")`. Schema-level invariant
 * checked at the Zod gate via `.refine`.
 */
export const CONFLICT_CATEGORIES = ["contradiction", "benign_update", "unrelated"] as const;

export const ConflictOutput = z
  .object({
    is_conflict: z.boolean(),
    category: z.enum(CONFLICT_CATEGORIES),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(10).max(300),
  })
  .refine((v) => v.is_conflict === (v.category === "contradiction"), {
    message: "is_conflict must be true iff category === 'contradiction'",
  });

export type ConflictOutput = z.infer<typeof ConflictOutput>;

// ---------------------------------------------------------------------------
// CONFLICT_JSON_SCHEMA — derived from ConflictOutput for LLM response_format
// ---------------------------------------------------------------------------

/**
 * JSON Schema for Workers AI `response_format.json_schema`. Same ENG-21 gotcha
 * applies: must use Zod v4's native `z.toJSONSchema()` — the third-party
 * `zod-to-json-schema@3.x` silently returns `{}` against zod@4 schemas.
 *
 * The `.refine()` constraint above is NOT representable in JSON Schema; the
 * Zod gate at the runtime boundary enforces it after the model responds.
 */
export const CONFLICT_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(ConflictOutput);
  void $schema;
  // ENG-25: same Workers AI JSON Mode keyword-sanitization as TRIAGE_JSON_SCHEMA.
  return sanitizeJsonSchemaForWorkersAI(schema);
})();

// ---------------------------------------------------------------------------
// CONFLICT_DETECTION_PROMPT — system prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for `detectConflict`. Treated as a baseline; once the eval
 * harness in conflict-precision.eval.test.ts is run against real labeled
 * pairs, this prompt becomes byte-frozen the same way `prompts.ts`
 * SYSTEM_PROMPT is — paraphrasing invalidates the precision baseline.
 *
 * Token budget target: ≤450 tokens, leaving room for both memory bodies in
 * the user message under the classifier's 128K context.
 */
export const CONFLICT_DETECTION_PROMPT = `You are Engram's conflict detector. Given two memories, classify the relationship between them and output bare JSON matching the provided schema.

CATEGORIES (pick exactly one):
- contradiction: A and B describe the SAME entity or fact but CANNOT BOTH BE TRUE. One refutes, reverses, or invalidates the other. Examples: "Hired Alice as CTO on 2026-03-15" vs "Alice left the company on 2026-04-01" (cannot currently be CTO AND no longer at the company). "Project Atlas deadline is 2026-09-30" vs "Project Atlas was cancelled in Q2" (cannot have an active deadline AND be cancelled).
- benign_update: A and B describe the SAME entity, with B superseding A as a forward-in-time change — promotion, status progression, role change. Both true at different points in time. NOT a contradiction. Examples: "Alice is Senior Engineer at Acme" vs "Alice was promoted to CTO at Acme on 2026-03-15" (sequential roles, both happened). "Project Atlas owner is Bob" vs "Project Atlas owner transferred to Carol on 2026-04-10" (ownership transferred forward).
- unrelated: A and B describe DIFFERENT entities, people, or topics with no factual overlap. Examples: "Lunch with Dave Friday" vs "Shipped GraphQL N+1 fix" (different people, different topics).

OUTPUT RULES:
- is_conflict: MUST be true if and only if category="contradiction". For benign_update and unrelated, is_conflict MUST be false.
- confidence: 0-1, how certain you are about the category.
- reason: 1 sentence (10-300 chars). For contradiction, name the specific fact in tension. For benign_update, name the field that was updated. For unrelated, name why they don't overlap.

Output bare JSON only. No markdown fences. No prose outside the JSON object.`;

// ---------------------------------------------------------------------------
// detectConflict — the inference call
// ---------------------------------------------------------------------------

/**
 * Calls the classifier with two memories and returns the parsed
 * `ConflictOutput` from the Zod gate, or `null` if the call threw or the
 * response failed to parse.
 *
 * Returning `null` instead of throwing keeps the eval harness loop clean —
 * each pair contributes either a classification or a tracked failure, and
 * the precision report surfaces the failure count rather than aborting the
 * sweep on the first transient error.
 *
 * No retry, no analytics, no queue-message side effects. This is a leaf-level
 * inference call. The v0.2 feature implementation will wrap it with whatever
 * orchestration shape (per-write or batched) the ENG-16 precision validation
 * decides on.
 *
 * @param env - Structural env with an AI binding (partial mock for testing).
 * @param memoryA - First memory body.
 * @param memoryB - Second memory body.
 * @returns Parsed `ConflictOutput` on success, `null` on any failure path.
 */
export async function detectConflict(
  env: { AI: Ai },
  memoryA: string,
  memoryB: string,
): Promise<ConflictOutput | null> {
  const userMessage = `MEMORY A:\n${memoryA}\n\nMEMORY B:\n${memoryB}`;

  let aiResp: unknown;
  try {
    aiResp = await env.AI.run(
      CLASSIFIER_MODEL as Parameters<Ai["run"]>[0],
      {
        messages: [
          { role: "system", content: CONFLICT_DETECTION_PROMPT },
          { role: "user", content: userMessage },
        ],
        // ENG-25: Workers AI JSON Mode via OpenAI-compatible response_format.
        // CONFLICT_JSON_SCHEMA is pre-sanitized (see schemas.ts for rationale).
        response_format: { type: "json_schema", json_schema: CONFLICT_JSON_SCHEMA },
        temperature: 0.1,
        max_tokens: 512,
      } as Parameters<Ai["run"]>[1],
    );
  } catch (err) {
    console.warn("conflict-detection:ai-threw", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // Workers AI chat responses wrap the JSON in a `response` field.
  const candidate = (aiResp as { response?: unknown }).response ?? aiResp;
  const parsed = ConflictOutput.safeParse(candidate);
  if (!parsed.success) {
    console.warn("conflict-detection:zod-parse-failed", {
      firstIssue: parsed.error.issues[0],
      sample: JSON.stringify(candidate).slice(0, 300),
    });
    return null;
  }
  return parsed.data;
}
