/**
 * `@engram/vectorize-utils` — shared Vectorize wrappers used by mcp-server
 * (recall path) and triage-worker (conflict-pipeline path).
 *
 * Why this package exists (Phase 2 D-08 + D-10):
 * - `vectorizeQuery` was previously co-located with the mcp-server-only helpers
 *   (`vectorizeUpsert`, `vectorizeDelete`) in `packages/mcp-server/src/vectorize-helper.ts`.
 *   Phase 2 CON-02 introduces `vectorizeNeighbors` for the conflict pipeline; the
 *   triage-worker needs both `vectorizeQuery` (for ad-hoc namespaced reads) and
 *   `vectorizeNeighbors`, but does NOT need upsert/delete (writes happen in
 *   `vectorize-helper.ts`'s upsert path inside mcp-server's ingest tool).
 * - Extracting the read-side wrappers into a shared workspace package is the
 *   minimum-blast-radius split that keeps both Workers AI-02-safe (mandatory
 *   workspaceId positional argument) without duplicating the 64-byte namespace
 *   guard across packages.
 *
 * Source of extraction (D-08): `packages/mcp-server/src/vectorize-helper.ts:39-99`.
 * The `vectorizeQuery` body below is byte-for-byte identical to that range — see
 * Plan 02-01 acceptance criteria for the no-behavior-change guarantee. Plan 02-02
 * removes the original copy in `vectorize-helper.ts` once consumer imports are
 * swapped over (D-09 ordering).
 *
 * AI-02 cross-workspace isolation lock (RESEARCH §Pitfall 4):
 *   `workspaceId` is the second POSITIONAL argument on both exports. It MUST NOT
 *   be relegated to a key inside the `filter` options object — a missing
 *   positional becomes a TypeScript compile error, while a missing filter key
 *   would degrade to a silent cross-workspace query at runtime. The
 *   `assertNamespace` 64-byte guard fires SYNCHRONOUSLY before any binding call
 *   (Pitfall 9) so length violations surface as `expect(() => fn()).toThrow()`
 *   in tests rather than as silent Vectorize truncation.
 *
 * @module @engram/vectorize-utils
 */

import { VECTORIZE_OVERFETCH_FACTOR } from "@engram/ai-config";

/** Maximum namespace byte length enforced by Vectorize. */
const NAMESPACE_MAX_BYTES = 64;

/** Default topK per Phase 4 D-10 (overrides Vectorize's implicit default of 5). */
const VECTORIZE_TOPK_DEFAULT = 25;

/**
 * Validates that `workspaceId` is non-empty and fits within the 64-byte
 * Vectorize namespace limit. Throws synchronously before any binding call.
 */
function assertNamespace(workspaceId: string): void {
  if (!workspaceId) {
    throw new Error("Vectorize helper: workspaceId is required (failure mode #1 defense)");
  }
  const byteLength = new TextEncoder().encode(workspaceId).byteLength;
  if (byteLength > NAMESPACE_MAX_BYTES) {
    throw new Error(
      `Vectorize helper: namespace '${workspaceId}' exceeds 64-byte namespace cap (${String(byteLength)} bytes) — Pitfall 9 guard`,
    );
  }
}

/**
 * Query the Vectorize index within a specific workspace namespace.
 *
 * Enforces:
 * - `workspaceId` is non-optional positional arg (AI-02 compile-time defense).
 * - 64-byte namespace length guard (Pitfall 9).
 * - Default topK = 25 (Pitfall 7 defense; Phase 4 D-10 cap).
 * - Default returnMetadata = "all" so hybrid ranking receives full metadata.
 *   Note: returnMetadata="all" caps topK at 50 per Cloudflare docs (Pitfall 8);
 *   D-10's max(25) keeps us under this limit.
 *
 * @param env - Structural env binding; only VECTORIZE is required for partial mocks.
 * @param workspaceId - The workspace namespace for tenant isolation (AI-02).
 * @param vector - The query embedding (size = EMBEDDING_DIMS from @engram/ai-config).
 * @param opts - Query options. topK defaults to 25; returnMetadata defaults to "all".
 */
export function vectorizeQuery(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: {
    topK?: number;
    filter?: Record<string, unknown>;
    returnMetadata?: "none" | "indexed" | "all";
  },
): Promise<VectorizeMatches> {
  // assertNamespace throws SYNCHRONOUSLY before any async work begins.
  // This makes the namespace guard catchable by expect(() => fn()).toThrow()
  // in tests, and also prevents a rejected-promise from propagating silently.
  assertNamespace(workspaceId);
  const topK = opts.topK ?? VECTORIZE_TOPK_DEFAULT;
  const returnMetadata = opts.returnMetadata ?? "all";
  const queryOpts: Record<string, unknown> = { namespace: workspaceId, topK, returnMetadata };
  if (opts.filter !== undefined) {
    queryOpts.filter = opts.filter;
  }
  return env.VECTORIZE.query(vector, queryOpts);
}

/**
 * Options for `vectorizeNeighbors` — the type/scope filter stack used by the
 * conflict-pipeline neighbor lookup (CON-02).
 *
 * - `topK`: number of neighbors to RETURN after threshold filtering. The
 *   internal Vectorize fetch is `topK * VECTORIZE_OVERFETCH_FACTOR` so the
 *   client-side score floor has headroom to filter from.
 * - `type` / `scope`: optional Vectorize metadata filters. Both stack as
 *   implicit AND (Cloudflare Vectorize docs — multiple filter keys combine
 *   with AND semantics). `type` uses `$in` for forward compatibility with
 *   multi-type lookups; `scope` uses `$eq` (single value).
 * - `threshold`: client-side cosine score floor (CON-02). Vectorize has NO
 *   native score-floor parameter — verified against Context7's full Vectorize
 *   docs in RESEARCH §Pattern 4. Matches below the threshold are dropped on
 *   the client side BEFORE the `.slice(0, topK)` cap.
 */
export interface VectorizeNeighborsOpts {
  topK: number;
  type?: string;
  scope?: string;
  threshold: number;
}

/**
 * Find the top-K nearest neighbors of a query vector within a workspace,
 * optionally filtered by memory `type` and/or `scope`, with a client-side
 * cosine threshold gate.
 *
 * Implementation (RESEARCH §Pattern 4):
 *   1. Build the filter object — `{type: {$in: [type]}}` if type is set,
 *      AND `{scope: {$eq: scope}}` if scope is set. Both stack as AND.
 *   2. Over-fetch from Vectorize: `topK * VECTORIZE_OVERFETCH_FACTOR`. This
 *      mirrors the `recall()` over-fetch pattern at `tools.ts:556` so the
 *      threshold gate has something to filter from when the most-relevant
 *      matches don't fill `topK`.
 *   3. Client-side filter: drop matches with `score < threshold`.
 *   4. Slice to `topK`.
 *
 * AI-02 contract: `workspaceId` is mandatory positional (not a filter key)
 * for the same compile-time-defense reason as `vectorizeQuery`.
 *
 * @param env - Structural env binding; only VECTORIZE is required.
 * @param workspaceId - The workspace namespace (AI-02).
 * @param vector - The query embedding.
 * @param opts - Neighbor search options (see `VectorizeNeighborsOpts`).
 * @returns The filtered, sliced array of `VectorizeMatches["matches"]`.
 */
export function vectorizeNeighbors(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: VectorizeNeighborsOpts,
): Promise<VectorizeMatches["matches"]> {
  const filter: Record<string, unknown> = {};
  if (opts.type !== undefined) {
    filter.type = { $in: [opts.type] };
  }
  if (opts.scope !== undefined) {
    filter.scope = { $eq: opts.scope };
  }
  const fetchSize = opts.topK * VECTORIZE_OVERFETCH_FACTOR;
  return vectorizeQuery(env, workspaceId, vector, {
    topK: fetchSize,
    returnMetadata: "all",
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
  }).then((result) => result.matches.filter((m) => m.score >= opts.threshold).slice(0, opts.topK));
}
