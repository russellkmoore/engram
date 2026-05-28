/**
 * Routes a parsed memorability score to one of 3 destinations.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-06:** memorability bands are PUBLIC CONTRACT per CLAUDE.md
 *   `## Ingest Pipeline`. Thresholds (0.8 and 0.4) are LOCKED — code can
 *   change the prompt, NOT the thresholds.
 * - **CONTEXT.md D-07 (cardinal-sin clause):** `<0.4` routes to `cold-storage`,
 *   NEVER `discard`. Russell's framing: "discard is the cardinal sin of a memory
 *   product." Cold blocks are excluded from default `recall()` results but stay
 *   in SQLite forever (v0.1). See `moveToColdStorage` DO RPC (Plan 05-01 Task 5).
 * - **Phase 5 AI-06 eval (Plan 05-06):** `routeByMemorability` is imported by the
 *   memorability-calibration eval that asserts a 60/30/10 ± 10pp distribution on
 *   the reference corpus. Do NOT change thresholds or return values without
 *   re-running the calibration eval.
 * - **T-05-04-DISCARD (threat register):** hard-discard of <0.4 blocks loses
 *   Russell's data. `cold-storage` is the mitigation.
 *
 * @module @engram/triage-worker/memorability
 */

// ---------------------------------------------------------------------------
// RouteDecision — the 3 destinations for a scored memory
// ---------------------------------------------------------------------------

/**
 * The 3 routing destinations produced by `routeByMemorability`.
 *
 * - `store-normal`  — memorability > 0.8 → `WorkspaceDO.updateBlockEnrichment`
 * - `inbox`         — memorability 0.4–0.8 → `WorkspaceDO.moveToInbox` (human review)
 * - `cold-storage`  — memorability < 0.4 → `WorkspaceDO.moveToColdStorage`
 *                     NOT "discard" — CONTEXT.md D-07 cardinal-sin clause.
 */
export type RouteDecision = "store-normal" | "inbox" | "cold-storage";

// ---------------------------------------------------------------------------
// routeByMemorability — pure predicate, no IO
// ---------------------------------------------------------------------------

/**
 * Maps a memorability score (0–1) to one of 3 routing decisions.
 *
 * Thresholds are LOCKED at 0.8 and 0.4 per AI-SPEC.md § memorability calibration.
 * The LLM's scoring rubric in `prompts.ts` matches these exact values.
 *
 * Boundary behavior:
 * - `score > 0.8` → `"store-normal"` (strict greater-than, NOT ≥0.8)
 * - `score >= 0.4` → `"inbox"` (covers the 0.4–0.8 band, including exactly 0.4 and 0.8)
 * - `score < 0.4` → `"cold-storage"` — NOT "discard" (CONTEXT.md D-07 cardinal-sin clause)
 *
 * @param score - Memorability score from TriageOutput.memorability (0.0–1.0)
 * @returns RouteDecision — one of "store-normal" | "inbox" | "cold-storage"
 */
export function routeByMemorability(score: number): RouteDecision {
  if (score > 0.8) return "store-normal";
  if (score >= 0.4) return "inbox";
  return "cold-storage"; // NOT "discard" — CONTEXT.md D-07 cardinal-sin clause.
}
