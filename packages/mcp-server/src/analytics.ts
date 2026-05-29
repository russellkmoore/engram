/**
 * `analytics` — Workers Analytics Engine write helper (non-blocking).
 *
 * Cross-phase contract:
 * - **Phase 5 AI-04/AI-05/AI-07:** every AI/Vectorize call site emits one datapoint
 *   matching the AI-SPEC.md §7 schema. The function is non-blocking — if the binding
 *   is undefined (dev mode, tests without remote binding) or if writeDataPoint throws
 *   (rare), the function NO-OPS silently. Failure to write a datapoint must NOT
 *   degrade the hot-path operation being instrumented.
 *
 * Design notes (locked):
 * - The 4 blobs / 4 doubles / 1 index slots match the AI-SPEC.md §7 schema VERBATIM
 *   — changing the slot meaning breaks the analytics-queries.sql canonical queries.
 * - sha256(workspace_id).slice(0, 16) for the workspace dimension — privacy +
 *   Section 1b regulatory forward-compat. Raw workspace_id NEVER logged.
 *
 * Threat model:
 * - **T-05-07-PROP (Denial of Service):** writeAnalytics wraps writeDataPoint in
 *   try/catch; on throw it console.warn's but never re-throws. env.ANALYTICS ===
 *   undefined → no-op silently (dev mode, tests).
 * - **T-05-07-PII (Information Disclosure):** workspaceTag uses sha256(workspace_id)
 *   .slice(0, 16) — raw IDs never appear in blobs[2].
 *
 * @module @engram/mcp-server/analytics
 */
import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Type aliases — match AI-SPEC.md §7 schema slot counts exactly
// ---------------------------------------------------------------------------

/** blobs[0..3]: worker, op-kind, workspace-tag, outcome */
export type AnalyticsBlobs = readonly [string, string, string, string];
/** doubles[0..3]: latency-ms, input-length, retry-count, success-false-flag */
export type AnalyticsDoubles = readonly [number, number, number, number];
/** indexes[0]: environment tag */
export type AnalyticsIndexes = readonly [string];

export interface AnalyticsDataPoint {
  blobs: AnalyticsBlobs;
  doubles: AnalyticsDoubles;
  indexes: AnalyticsIndexes;
}

// ---------------------------------------------------------------------------
// workspaceTag — sha256-prefix privacy helper
// ---------------------------------------------------------------------------

/**
 * Computes the AI-SPEC.md §7 sha256-prefix workspace tag (first 16 hex chars).
 * Uses the Web Crypto API available on workerd — no Node crypto module needed.
 *
 * @param workspaceId - Raw workspace ID (NEVER logged; only the hash prefix is written).
 * @returns First 16 hex characters of sha256(workspaceId).
 */
export async function workspaceTag(workspaceId: string): Promise<string> {
  const data = new TextEncoder().encode(workspaceId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// writeAnalytics — non-blocking fire-and-forget write
// ---------------------------------------------------------------------------

/**
 * Non-blocking analytics write. Safe to fire-and-forget; never throws.
 *
 * - If `env.ANALYTICS` is undefined (dev mode, vitest without remote binding): no-op.
 * - If `writeDataPoint` throws (rare, e.g. binding misconfiguration): console.warn + swallow.
 * - Per AI-SPEC.md §7 non-blocking constraint: failure to write MUST NOT degrade the
 *   hot-path operation this call is instrumenting.
 *
 * @param env - Env shape; only `ANALYTICS` is accessed.
 * @param datapoint - Fully typed AI-SPEC.md §7 datapoint.
 */
export function writeAnalytics(
  env: { ANALYTICS?: AnalyticsEngineDataset },
  datapoint: AnalyticsDataPoint,
): void {
  if (env.ANALYTICS === undefined) return; // dev / tests — no-op silently
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [...datapoint.blobs],
      doubles: [...datapoint.doubles],
      indexes: [...datapoint.indexes],
    });
  } catch (err) {
    // Per AI-SPEC.md §7 non-blocking constraint — never propagate.
    console.warn("analytics:write-failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
