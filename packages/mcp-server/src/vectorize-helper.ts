/**
 * `vectorizeQuery` / `vectorizeUpsert` / `vectorizeDelete` —
 * mandatory-workspace-id wrappers around `env.VECTORIZE` (AI-02 defense-in-depth).
 *
 * Cross-phase contract:
 * - **Phase 5 AI-02:** the `workspaceId` arg is non-optional positional on every
 *   call — a forgotten arg becomes a TS compile error instead of a silent
 *   global-index query.
 * - **Phase 5 AI-03:** `vectorizeUpsert` stamps the `namespace` field to
 *   `workspaceId` on every vector regardless of caller intent. The
 *   embedding-stamp precondition (caller must have written `embedding_model` +
 *   `embedding_version` to the SQLite row before calling) is the caller's
 *   responsibility — NOT enforced here to avoid a SQL roundtrip. Verified by
 *   Plan 05-06's `embedding-consistency.test.ts`.
 *
 * Design notes (locked):
 * - 64-byte namespace length guard fires before any binding call (Pitfall 9).
 *   Uses `TextEncoder().encode().byteLength` for UTF-8 byte count, not
 *   character count — important for v0.3 multi-tenant workspace IDs.
 * - Direct `env.VECTORIZE.{query|upsert|deleteByIds}` outside this file is
 *   banned by a CI grep check (T-05-02-CWVL mitigation). Plan 05-03 ships
 *   the grep gate.
 * - Default topK = 25 (Phase 4 D-10 cap; guards against Pitfall 7 default of 5).
 * - `returnMetadata: "all"` is the default for vectorizeQuery so hybrid ranking
 *   receives full metadata. Pitfall 8 note: returnMetadata="all" caps topK at 50;
 *   D-10's max(25) keeps us under this limit.
 * - No default export — matches the repo-wide convention.
 *
 * Threat model:
 * - **T-05-02-CWVL (Information Disclosure):** cross-workspace vector leakage
 *   via direct env.VECTORIZE access is mitigated by this helper being the only
 *   sanctioned access path. A grep gate in Plan 05-03 enforces the ban.
 * - **T-05-02-NSCAP (Information Disclosure / DoS):** namespace > 64 bytes
 *   silently truncated by Vectorize. `assertNamespace` throws BEFORE the binding
 *   call to preempt the silent truncation.
 *
 * @module @engram/mcp-server/vectorize-helper
 */

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
 * Upsert vectors into the workspace namespace, stamping `namespace` on every
 * vector regardless of caller intent.
 *
 * The `namespace` field is deliberately OMITTED from the vectors arg type so
 * callers cannot supply a conflicting namespace — the helper always stamps
 * `workspaceId` (AI-02 defense-in-depth at the type layer).
 *
 * Note: the embedding-stamp precondition (caller must have called
 * `stampEmbedding` on the SQLite row before calling vectorizeUpsert) is NOT
 * enforced here to avoid a SQL roundtrip. It is the caller's responsibility
 * and is verified by Plan 05-06's `embedding-consistency.test.ts`.
 *
 * @param env - Structural env binding.
 * @param workspaceId - The workspace namespace (AI-02).
 * @param vectors - Vectors to upsert. The `namespace` field is intentionally
 *   excluded from the type — the helper stamps it unconditionally.
 */
export function vectorizeUpsert(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vectors: (Omit<VectorizeVector, "namespace"> & { metadata?: Record<string, unknown> })[],
): Promise<{ mutationId: string }> {
  assertNamespace(workspaceId);
  // Stamp namespace on every vector, overwriting any caller-supplied value.
  const stamped = vectors.map((v) => ({
    ...v,
    namespace: workspaceId,
  }));
  // ENG-22: Workers runtime types `VectorizeVectorMutation` now omits
  // `mutationId` from its interface (it's present at runtime but typed as
  // an empty/different shape). The double-cast via `unknown` is the standard
  // pattern when source/target don't sufficiently overlap per TS rules.
  return env.VECTORIZE.upsert(stamped) as unknown as Promise<{ mutationId: string }>;
}

/**
 * Delete vectors by ID from the workspace.
 *
 * Vectorize's `deleteByIds` is namespace-agnostic per the API — vectors carry
 * their own namespace from upsert time. This helper's role is the namespace-
 * length precondition + the empty-ids short-circuit (avoids a no-op binding
 * call on empty arrays).
 *
 * @param env - Structural env binding.
 * @param workspaceId - The workspace namespace for precondition validation.
 * @param ids - Block IDs to delete from the index.
 */
export function vectorizeDelete(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  ids: string[],
): Promise<{ mutationId: string }> {
  assertNamespace(workspaceId);
  if (ids.length === 0) {
    return Promise.resolve({ mutationId: "noop" });
  }
  return env.VECTORIZE.deleteByIds(ids) as unknown as Promise<{ mutationId: string }>;
}
