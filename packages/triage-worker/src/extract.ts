/**
 * `extractAndScore` — Triage Worker queue-consumer body.
 *
 * Calls Workers AI with structured JSON output, then routes the result through
 * the Zod gate and the dual-path 429 retry policy.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-05:** entity extraction + classification via `@cf/meta/llama-3.1-8b-instruct`
 *   with `response_format.json_schema = TRIAGE_JSON_SCHEMA`. The model is constrained to
 *   return a `TriageOutput`-shaped JSON object. The Zod gate at the LLM boundary is the
 *   runtime enforcement of this contract (AI-SPEC.md §3 Pitfall 4: json_schema is "best effort").
 * - **Phase 5 AI-06:** `parsed.memorability` from this function is the score that
 *   `routeByMemorability` bands into store-normal / inbox / cold-storage in `index.ts`.
 * - **Phase 5 AI-07:** dual-path 429 detection:
 *   (1) thrown AiError → `message.retry({ delaySeconds: 30 })`
 *   (2) binding envelope `{ success: false, errors: [{code: 7501}] }` → same retry
 *   Both paths MUST trigger retry, NOT crash-the-batch (Critical Failure Mode #4).
 * - **Phase 6 PIP-01:** the Queue consumer binding wires this function as the
 *   batch processor. Phase 5 ships the body; Phase 6 wires the producer + binding.
 *
 * Design notes:
 * - `try { await env.AI.run(...) }` wraps ONLY the AI call — not the full pipeline.
 *   This differs from `tools.ts`'s outer-catch shape because 429 needs special handling
 *   (retry-only) separate from other errors (re-throw to Queue runtime).
 * - Zod parse failure retries ONCE (attempts < 2), then permanently acks + logs
 *   (PIP-05 DLQ-equivalent). Caps failure loop at 2 attempts per message.
 * - `console.warn` for transient (retry triggered); `console.error` for permanent
 *   (ack triggered). Plan 05-07 wires Workers Analytics Engine writeDataPoint hooks
 *   at these same log sites.
 *
 * @module @engram/triage-worker/extract
 */
import type { Ai } from "@cloudflare/workers-types";
import type { MemoryEvent } from "@engram/types";
import { TriageOutput, TRIAGE_JSON_SCHEMA } from "./schemas.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { CLASSIFIER_MODEL, detectRateLimit, isRateLimitError } from "./ai-helper.js";

// ---------------------------------------------------------------------------
// Message — queue message shape (subset of Cloudflare Queues Message<T>)
// ---------------------------------------------------------------------------

/**
 * Minimal queue message shape needed by `extractAndScore`. Mirrors the
 * Cloudflare Queues consumer `Message<T>` interface:
 * https://developers.cloudflare.com/queues/configuration/javascript-apis/#message
 */
export interface Message {
  /** Number of delivery attempts for this message (0-indexed; undefined on first delivery). */
  attempts?: number;
  /** Acknowledge the message — remove from queue, mark as processed. */
  ack: () => void;
  /** Retry the message after a delay. */
  retry: (opts: { delaySeconds: number }) => void;
  /** The message body. */
  body: MemoryEvent;
}

// ---------------------------------------------------------------------------
// extractAndScore — main export
// ---------------------------------------------------------------------------

/**
 * Calls the Workers AI classifier, parses the response through the Zod gate,
 * and returns the typed `TriageOutput` or `null` (when retry/ack was triggered).
 *
 * When this function returns `null`, the caller (index.ts queue loop) MUST NOT
 * call `message.ack()` — `extractAndScore` itself called `retry` or `ack` as
 * appropriate. Callers `continue` on null.
 *
 * @param env - Structural env with an AI binding (partial mock for testing).
 * @param event - The MemoryEvent being classified.
 * @param message - The Queues message handle (retry/ack/attempts accessors).
 * @returns `TriageOutput` on success; `null` when retry or ack was triggered.
 */
export async function extractAndScore(
  env: { AI: Ai },
  event: MemoryEvent,
  message: Message,
): Promise<TriageOutput | null> {
  // ---------------------------------------------------------------------------
  // Step 1: call Workers AI with structured JSON output
  // ---------------------------------------------------------------------------

  let aiResp: unknown;
  try {
    aiResp = await env.AI.run(
      CLASSIFIER_MODEL as Parameters<Ai["run"]>[0],
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: event.content },
        ],
        response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA },
        temperature: 0.2,
        max_tokens: 1024,
      } as Parameters<Ai["run"]>[1],
    );
  } catch (err) {
    // AI-07 dual-path #1: thrown AiError / InferenceUpstreamError on 429.
    // Do NOT crash the batch — retry only this message.
    if (isRateLimitError(err)) {
      console.warn("triage:ai-429-thrown", {
        id: event.id,
        attempts: message.attempts ?? 0,
      });
      message.retry({ delaySeconds: 30 });
      return null;
    }
    // Non-429 throw — let it bubble. Queue runtime's max_retries machinery applies.
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Step 2: AI-07 dual-path #2 — binding envelope 429
  // ---------------------------------------------------------------------------

  if (detectRateLimit(aiResp as Parameters<typeof detectRateLimit>[0])) {
    console.warn("triage:ai-429-envelope", {
      id: event.id,
      attempts: message.attempts ?? 0,
    });
    message.retry({ delaySeconds: 30 });
    return null;
  }

  // ---------------------------------------------------------------------------
  // Step 3: Zod gate at the LLM boundary
  // ---------------------------------------------------------------------------

  // Workers AI chat responses wrap the JSON in a `response` field.
  // If aiResp has a `response` property, unwrap it — otherwise use aiResp directly.
  // AI-SPEC.md §3 Pitfall 4: json_schema is "best effort"; the Zod gate is the
  // runtime enforcement.
  const candidate = (aiResp as { response?: unknown }).response ?? aiResp;
  const parsed = TriageOutput.safeParse(candidate);

  if (!parsed.success) {
    if (!message.attempts || message.attempts < 2) {
      // First failure — retry once at 5s. The model may have produced valid
      // JSON but not matched the schema exactly (field name typos, range
      // violations). One retry is worth the cost.
      console.warn("triage:zod-parse-failed-retrying", {
        id: event.id,
        attempts: message.attempts ?? 0,
        firstIssue: parsed.error.issues[0],
      });
      message.retry({ delaySeconds: 5 });
      return null;
    }

    // Second failure (attempts >= 2) — permanent failure. Ack + log.
    // PIP-05 DLQ-equivalent: the message is removed from the queue and logged
    // for offline analysis. Plan 05-07 wires Analytics Engine writeDataPoint here.
    console.error("triage:zod-parse-failed-permanent", {
      id: event.id,
      attempts: message.attempts,
      issueCount: parsed.error.issues.length,
      firstIssue: parsed.error.issues[0],
      sample: JSON.stringify(candidate).slice(0, 500),
    });
    message.ack();
    return null;
  }

  return parsed.data;
}
