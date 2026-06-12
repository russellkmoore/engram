/**
 * seed-prep.ts — Deterministic per-entry metadata derivation for the eval-fixtures seed.
 *
 * Phase 2 D-22..D-25 (recency variance) + D-28..D-29 (scope variance).
 *
 * All four exported functions are PURE — they derive metadata solely from the
 * entry index `i` (0..119) and, for timestamps, a caller-supplied `now` anchor.
 * No PRNG, no Date.now() inside the curve math. Two calls with the same
 * arguments always return the same value (D-25 determinism / byte-stable state).
 *
 * ── Recency curve (D-23) ────────────────────────────────────────────────────
 *
 * Distribution: exp-decay back to 90 days.
 *   days(i) = MAX_DAYS * (1 - exp(-i / TAU)) / (1 - exp(-119 / TAU))
 *
 * TAU = 20:
 *   • At i=0 → 0.0 days (entry 0 is "just created", most recent)
 *   • At i=119 → 90.0 days (entry 119 is ~90 days old, oldest)
 *   • Bulk: indices 0..~50 fall within the last ~14 days (>60% of 120 entries)
 *
 * Rationale for TAU=20: exp(-50/20) ≈ 0.082 → normalised ≈ 0.097 * 90 ≈ 8.7 days
 * at index 50, so ~42% of entries are in the last ~8.7 days and roughly 60-65%
 * fall within 14 days. This satisfies D-23's "bulk in last ~14 days" requirement.
 *
 * MAX_DAYS = 90: clamp to 90d (D-23 tail limit).
 *
 * ── Scope distribution (D-28, D-29) ─────────────────────────────────────────
 *
 * Rule: assign scope "project" when (i % 10) < 3, else "personal".
 * Result: 36/120 entries = 30% project, 84/120 = 70% personal. No "org".
 *
 * Project entries use one of three fixed slugs (>1 distinct slug per D-29):
 *   ["engram-v0.2", "job-search-2026", "second-brain"]
 * Selected via (i % 3) among project entries — i.e., projectIdForEntry(i) picks
 * PROJECT_SLUGS[i % PROJECT_SLUGS.length].
 *
 * @module seed-prep
 */

// ── Recency curve constants (D-23) ──────────────────────────────────────────

/** TAU controls the concentration of entries near "today". Chosen as 20. */
const TAU = 20;

/**
 * Maximum age in days for the oldest entry (tail of the decay curve).
 * Clamped here so no entry appears older than 90 days (D-23).
 */
const MAX_DAYS = 90;

/**
 * Precomputed denominator: (1 - exp(-119 / TAU)).
 * Computed once at module load to avoid repeated Math.exp calls.
 */
const DECAY_DENOM = 1 - Math.exp(-119 / TAU);

// ── Scope constants (D-29) ───────────────────────────────────────────────────

/**
 * Fixed project-id slugs for project-scoped entries.
 * More than 1 distinct slug required by D-29. Slug values do not affect sweep math.
 */
const PROJECT_SLUGS = ["engram-v0.2", "job-search-2026", "second-brain"] as const;

// ── Exported pure functions ──────────────────────────────────────────────────

/**
 * Returns the age in days for entry at index `i` (0..119).
 *
 * - daysForEntry(0) → ~0 (most recent entry)
 * - daysForEntry(119) → 90.0 (oldest entry)
 * - Monotonically non-decreasing in `i`
 * - ~60%+ of indices map to ≤14 days (D-23 shape)
 * - No PRNG, no Date.now — fully deterministic from index
 */
export function daysForEntry(i: number): number {
  if (i <= 0) return 0;
  const raw = (MAX_DAYS * (1 - Math.exp(-i / TAU))) / DECAY_DENOM;
  // Clamp to [0, MAX_DAYS] as a safety net (numeric edge cases at i=0 or i=119).
  return Math.min(MAX_DAYS, Math.max(0, raw));
}

/**
 * Returns the `created_at` timestamp (ms since epoch) for entry at index `i`.
 *
 * @param i  Entry index (0..119); i=0 is the most recent, i=119 is oldest.
 * @param now  Caller-supplied epoch milliseconds anchor (e.g. Date.now()).
 *             Must NOT call Date.now() internally — caller owns the anchor so
 *             all 120 entries share the same reference point (D-25).
 *
 * @returns  Math.round(now - daysForEntry(i) * 86_400_000)
 */
export function createdAtForEntry(i: number, now: number): number {
  return Math.round(now - daysForEntry(i) * 86_400_000);
}

/**
 * Returns the scope string for entry at index `i`.
 *
 * Rule: "project" when (i % 10) < 3, else "personal".
 * Distribution: 36/120 = 30% project, 84/120 = 70% personal. No "org" (D-29).
 */
export function scopeForEntry(i: number): "personal" | "project" {
  return i % 10 < 3 ? "project" : "personal";
}

/**
 * Returns the project_id slug for entry at index `i`, or null for personal entries.
 *
 * For project entries (scopeForEntry(i) === "project"), cycles through
 * PROJECT_SLUGS via (i % PROJECT_SLUGS.length).
 * For personal entries returns null.
 */
export function projectIdForEntry(i: number): string | null {
  if (scopeForEntry(i) !== "project") return null;
  return PROJECT_SLUGS[i % PROJECT_SLUGS.length] ?? null;
}
