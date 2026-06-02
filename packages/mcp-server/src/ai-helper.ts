/**
 * `EMBEDDING_MODEL` / `CLASSIFIER_MODEL` constants + dual-path 429 detection +
 * `safeRun` wrapper for `env.AI.run` calls in the MCP server.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-03:** `EMBEDDING_MODEL` is the single source of truth for the
 *   embedding model used in `remember()` (write path). Plan 05-03 imports it.
 * - **Phase 5 AI-04:** `EMBEDDING_MODEL` is the single source of truth for the
 *   embedding model used in `recall()` (query path). Cross-file identity check
 *   (same string literal as triage-worker/src/ai-helper.ts) is verified by
 *   Plan 05-04's cross-file equality test (AI-SPEC.md §5 dimension #2).
 * - **Phase 5 AI-05:** `CLASSIFIER_MODEL` is the classifier model used in the
 *   Triage Worker's extraction + memorability scoring call.
 * - **Phase 5 AI-07:** `detectRateLimit` + `isRateLimitError` + `safeRun` are
 *   the single source of truth for 429 retry policy. Plan 05-04's Triage Worker
 *   consumer imports these to translate `RateLimitError` to
 *   `message.retry({delaySeconds: 30})` instead of throwing.
 *
 * Design notes (locked):
 * - Model IDs are `as const` literals so downstream imports get the exact string
 *   type (enabling snapshot tests and cross-file identity assertions at the type
 *   layer — AI-SPEC.md §5 dimension #2 identity-check gate).
 * - Dual-path detection is required because Workers AI 429 has TWO observable
 *   forms: (a) the binding returns `{success: false, errors: [{code: 7501}]}`
 *   WITHOUT throwing (AI-SPEC.md §3 Pitfall 1), and (b) an `AiError` IS thrown
 *   on some invocation paths (RESEARCH Open Question 1; codes 3036/3040 possible).
 *   Both paths must be handled or the Triage Worker silently drops entire batches
 *   on 429 (Critical Failure Mode #4 per AI-SPEC.md §1).
 * - No default export — matches the repo-wide convention.
 *
 * Threat model:
 * - **T-05-02-429 (Denial of Service):** Workers AI 429 not detected → batch fail.
 *   Mitigated by dual-path detection. `safeRun` throws `RateLimitError` (origin-
 *   tagged) in either case so the caller's single catch branch handles both.
 * - **T-05-02-DRIFT (Tampering):** `EMBEDDING_MODEL` constant drifts between
 *   mcp-server and triage-worker. Mitigated by `as const` literal type +
 *   cross-file equality test in Plan 05-04.
 *
 * @module @engram/mcp-server/ai-helper
 */

// ---------------------------------------------------------------------------
// Model-ID re-exports from @engram/ai-config (ENG-25)
// ---------------------------------------------------------------------------
//
// As of ENG-25, model IDs live in `shared/ai-config/src/index.ts`. Both Workers
// (and all tests) import the same constants from `@engram/ai-config` — no more
// byte-identical-cross-file invariant to maintain. To swap a model, edit ONE
// line in `shared/ai-config/src/index.ts`.
//
// Re-exporting here so existing `import { EMBEDDING_MODEL, CLASSIFIER_MODEL }
// from "./ai-helper.js"` callsites continue to work without churn. New code
// should import from `@engram/ai-config` directly.

export {
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
  EMBEDDING_CONTEXT_WINDOW,
  VECTORIZE_INDEX_NAME,
  INGESTION_CLASSIFIER_MODEL,
  SYNTHESIS_MODEL,
  QUERY_EXPANSION_MODEL,
  VISION_MODEL,
} from "@engram/ai-config";

// Backward-compat alias: existing callsites still reference CLASSIFIER_MODEL.
// New code should use INGESTION_CLASSIFIER_MODEL directly.
import { INGESTION_CLASSIFIER_MODEL } from "@engram/ai-config";
export const CLASSIFIER_MODEL = INGESTION_CLASSIFIER_MODEL;

/**
 * Embedding version stamp written to `blocks.embedding_version` (STO-04) on
 * every `remember()` call. Increment when Cloudflare announces a weight rotation
 * to gate a re-embed migration (AI-SPEC.md §3 Pitfall 8 escape hatch).
 *
 * Bumped to 2 in ENG-25 (embedding model swap from bge-base-en-v1.5 → qwen3-
 * embedding-0.6b). Any blocks with embedding_version=1 reference vectors in
 * the deprecated 768-dim `engram-memories` index and are NOT queryable from
 * the new 1024-dim `engram-memories-v2` index.
 */
export const EMBEDDING_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// AiBindingResponse — envelope shape for env.AI.run responses
// ---------------------------------------------------------------------------

/**
 * Envelope shape of an `env.AI.run(...)` response. Workers AI returns different
 * shapes per model, but the error envelope is shared across all models:
 *   `{ result: null, success: false, errors: [{ code: N, message: "..." }] }`
 *
 * For embedding model responses the shape is `{ shape: [N, D], data: number[][] }`.
 * For chat/classifier responses the shape is `{ response: string | object }`.
 *
 * This interface covers both the success shapes and the error envelope so
 * `detectRateLimit` can work with the full response type.
 */
export interface AiBindingResponse {
  /** Embedding result dimensions, e.g. [1, 768]. Present on embedding responses. */
  shape?: number[];
  /** Embedding vectors, e.g. `[[0.1, 0.2, ...]]`. Present on embedding responses. */
  data?: number[][];
  /** Classifier/chat response. Present on chat model responses. */
  response?: string | object;
  /** Error envelope sentinel: false indicates a non-2xx upstream response. */
  success?: boolean;
  /** Error envelope details. Present when success === false. */
  errors?: { code: number; message: string }[];
  /** Catch-all for other response fields. */
  result?: unknown;
}

// ---------------------------------------------------------------------------
// Dual-path 429 detection
// ---------------------------------------------------------------------------

/**
 * Detects a rate-limit response on the **binding-level envelope path**.
 *
 * Workers AI does NOT throw on 429 — it returns the binding envelope
 * `{ success: false, errors: [{ code: 7501, message: "..." }] }`. This is
 * AI-SPEC.md §3 Pitfall 1. Without this check, a 429 is silently treated as
 * a successful empty response and the caller continues with broken data.
 *
 * Returns true when:
 * - `resp.success === false` AND `resp.errors` is non-empty, AND
 * - some error has code 7501 / 3036 / 3040 OR message matches /429|rate|too many|capacity/i
 *
 * Returns false on null/undefined input, on success:true, on empty errors[].
 *
 * @see AI-SPEC.md §3 Pitfall 1
 * @see RESEARCH Open Question 1 (envelope-return vs throw — both paths covered)
 */
export function detectRateLimit(resp: AiBindingResponse | undefined | null): boolean {
  if (resp == null) return false;
  if (resp.success !== false) return false;
  const errors = resp.errors ?? [];
  if (errors.length === 0) return false;
  return errors.some(
    (e) =>
      e.code === 7501 ||
      e.code === 3036 ||
      e.code === 3040 ||
      /429|rate|too\s*many|capacity/i.test(e.message),
  );
}

/**
 * Detects a rate-limit on the **thrown-error path**.
 *
 * On some invocation paths Cloudflare throws an `AiError` or
 * `InferenceUpstreamError` with HTTP 429 in the message or error codes
 * 3036 ("Account limited") / 3040 ("Out of capacity") per RESEARCH
 * Open Question 1 + Assumption A1.
 *
 * Returns true when:
 * - `err.status === 429`, OR
 * - `err.name` matches /AiError|InferenceUpstreamError/i AND message matches
 *   /429|rate|too many|capacity/i, OR
 * - generic error message matches /429|rate|too many|capacity|3036|3040/i
 *
 * @see RESEARCH Open Question 1
 * @see Assumption A1 (codes 7501 / 3036 / 3040 all possible)
 */
export function isRateLimitError(err: unknown): boolean {
  if (err == null) return false;
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  return /429|rate.?limit|too.?many|capacity|3036|3040/i.test(message);
}

// ---------------------------------------------------------------------------
// RateLimitError — origin-tagged error class
// ---------------------------------------------------------------------------

/**
 * Thrown by `safeRun` on either 429 detection path. The `origin` tag lets the
 * Triage Worker consumer distinguish AI 429 from generic AI failures so it can
 * call `message.retry({delaySeconds: 30})` (AI-07) instead of re-throwing.
 *
 * @example
 *   try {
 *     const resp = await safeRun(env, EMBEDDING_MODEL, { text: [content] });
 *   } catch (err) {
 *     if (err instanceof RateLimitError) {
 *       message.retry({ delaySeconds: 30 });
 *       return;
 *     }
 *     throw err; // non-429 AI failure — let it propagate
 *   }
 */
export class RateLimitError extends Error {
  readonly isRateLimit = true as const;
  readonly origin: "binding-envelope" | "thrown";

  constructor(origin: "binding-envelope" | "thrown", message?: string) {
    super(message ?? `Workers AI rate limit (${origin})`);
    this.name = "RateLimitError";
    this.origin = origin;
  }
}

// ---------------------------------------------------------------------------
// safeRun — env.AI.run wrapper with dual-path 429 detection
// ---------------------------------------------------------------------------

/**
 * Wraps `env.AI.run(model, body)` with dual-path 429 detection.
 *
 * On success: returns the raw binding response (caller unwraps fields such as
 * `data[0]` for embeddings — do NOT strip shape information here per AI-SPEC.md
 * §3 Pitfall 3).
 *
 * On 429 (either path): throws `RateLimitError` with origin tag so the caller's
 * single catch branch handles both detection paths identically.
 *
 * On non-429 AI failure: re-throws the original error so error-mapping upstream
 * can produce the correct MCP error code (AI-SPEC.md §3 + error-mapping.ts).
 *
 * @param env - Structural env binding; only AI is required for partial mocks.
 * @param model - Model ID (use EMBEDDING_MODEL or CLASSIFIER_MODEL constants).
 * @param body - Request body for env.AI.run. Shape depends on the model.
 */
export async function safeRun(
  env: { AI: Ai },
  model: string,
  body: Record<string, unknown>,
): Promise<AiBindingResponse> {
  let resp: AiBindingResponse;
  try {
    resp = await env.AI.run(model, body);
  } catch (err) {
    if (isRateLimitError(err)) {
      throw new RateLimitError("thrown");
    }
    throw err;
  }
  if (detectRateLimit(resp)) {
    throw new RateLimitError(
      "binding-envelope",
      `Workers AI 429: ${JSON.stringify(resp.errors ?? [])}`,
    );
  }
  return resp;
}
