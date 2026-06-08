/**
 * @engram/types — shared TypeScript types for the Engram monorepo.
 *
 * All five v0.1 types are exported from this barrel. Downstream Workers
 * (`@engram/mcp-server`, `@engram/triage-worker`) import from `@engram/types`
 * and receive these definitions at build time via esbuild/Wrangler — no
 * separate `tsc` build step is required (D-07: TS-source exports pattern).
 *
 * @module @engram/types
 */

// ---------------------------------------------------------------------------
// MemoryEvent — Universal Intake Primitive
// ---------------------------------------------------------------------------

/**
 * Every intake path — MCP tool call, scheduled connector, webhook — produces
 * a `MemoryEvent`. The triage worker consumes all of them identically.
 *
 * Shape is verbatim from CLAUDE.md §"MemoryEvent (Universal Intake Primitive)".
 * `context?` is typed as `Record<string, unknown>` rather than the raw `object`
 * from the spec because `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`
 * make `Record<string, unknown>` the strict-mode-safe equivalent that satisfies
 * the ESLint `consistent-type-imports` rule and avoids unsafe member access.
 */
export interface MemoryEvent {
  /** Unique identifier for this event (UUID or nanoid). */
  id: string;
  /**
   * Origin of the event.
   * Examples: `"mcp:claude"` | `"connector:slack"` | `"scheduler:drive"`
   */
  source: string;
  /** Raw content provided by the source. */
  content: string;
  /** Optional user intent hint (set when the user explicitly names a type). */
  hint?: string;
  /** Source-specific metadata (connector context, session data, etc.). */
  context?: Record<string, unknown>;
  /** The workspace this event belongs to (resolved from JWT at intake). */
  workspace_id: string;
  /** Unix epoch timestamp (ms) at event creation. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Memory — persisted block (mirrors the `blocks` SQLite table)
// ---------------------------------------------------------------------------

/**
 * A persisted memory record — the universal block primitive inside a workspace.
 * Shape mirrors the `blocks` SQLite table in `WorkspaceDO` as defined in
 * CLAUDE.md §"SQLite Schema".
 *
 * Note: `embedding_model` and `embedding_version` columns are added by Phase 2's
 * STO-04 migration and are intentionally absent from this v0.1 type. Phase 2
 * will widen the type when those columns land.
 */
export interface Memory {
  /** UUID primary key. */
  id: string;
  /**
   * Memory type ID — references a row in the `memory_types` table, or `null`
   * when no type was provided at ingest time and AI classification has not yet
   * run. Phase 5 replaces `null` with the CF AI–inferred type after
   * classification. Honest-stub contract D-06: the stored value must equal the
   * `classified_type` echoed in the `remember()` response envelope.
   */
  type: string | null;
  /** Raw original content as provided at ingest time. */
  content: string | null;
  /** CF AI–generated summary of the content. */
  summary: string | null;
  /** Typed fields as defined by the memory type's field schema (JSON column). */
  properties: Record<string, unknown> | null;
  /** Reference to the Vectorize vector entry for this block. */
  embedding_id: string | null;
  /**
   * Visibility scope of this memory.
   * - `"personal"` — visible only to the owning user
   * - `"project"` — visible within the project workspace
   * - `"org"` — visible across the organisation workspace
   */
  scope: "personal" | "project" | "org";
  /** Project ID if `scope` is `"project"`, otherwise null. */
  project_id: string | null;
  /**
   * Source of this memory.
   * Examples: `"mcp:claude"` | `"connector:slack"` | `"connector:drive"`
   */
  source: string | null;
  /**
   * CF AI classification confidence score (0–1).
   * High values indicate the type was inferred with high certainty.
   */
  confidence: number | null;
  /** Unix epoch timestamp (ms) when this block was created. */
  created_at: number;
  /** Unix epoch timestamp (ms) when this block was last modified. */
  updated_at: number;
  /**
   * Phase 5 D-07: blocks with memorability <0.4 are routed to cold-storage
   * by the Triage Worker. Cold blocks are excluded from default `recall()`
   * results and are NOT indexed in Vectorize. This is optional because v0.1
   * callers on the hot path (insertBlock, getBlock) do not need to set it;
   * the `blocks.cold_storage` SQLite column defaults to 0 (not cold).
   *
   * When `true`, the block is demoted to cold-storage. Use `moveToColdStorage()`
   * to set this — never set it directly. The `getBlocksByIds()` helper
   * excludes cold-storage rows by default (`AND cold_storage = 0`).
   *
   * v0.2 milestone: `include_cold: true` flag on `recall()` will surface them.
   */
  cold_storage?: boolean;
}

// ---------------------------------------------------------------------------
// Entity — extracted knowledge graph node
// ---------------------------------------------------------------------------

/**
 * A named entity extracted from memory content by CF Workers AI.
 *
 * This is a minimal v0.1 shape — the full entity model (aliases, confidence,
 * cross-workspace resolution) lands in Phase 2/Phase 5 when entity extraction
 * and Vectorize similarity are wired in.
 */
export interface Entity {
  /** UUID primary key. */
  id: string;
  /**
   * Entity category.
   * Examples: `"person"` | `"company"` | `"project"` | `"concept"`
   */
  type: string;
  /** Canonical display name of the entity. */
  name: string;
  /** Additional entity attributes captured at extraction time. */
  properties?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TimelineEvent — ordered event entry in a chronological context slice
// ---------------------------------------------------------------------------

/**
 * A single entry in a chronologically ordered timeline returned by `reflect()`.
 *
 * Renamed from CLAUDE.md's literal `Event` to avoid a DOM `Event` collision —
 * Cloudflare Workers exposes DOM globals including the `Event` constructor, so
 * using `Event` as a type name in Workers contexts would shadow the global and
 * trigger `no-shadow` / ambiguous-type errors.
 */
export interface TimelineEvent {
  /** UUID or memory ID this timeline entry refers to. */
  id: string;
  /** Human-readable description of what happened at this point in time. */
  description: string;
  /** Unix epoch timestamp (ms) of this event. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Conflict — detected contradiction between two memories
// ---------------------------------------------------------------------------

/**
 * A detected conflict between two memory records, staged for human resolution.
 * Shape mirrors the `conflicts` SQLite table in `WorkspaceDO` as defined in
 * CLAUDE.md §"SQLite Schema".
 */
export interface Conflict {
  /** UUID primary key. */
  id: string;
  /** ID of the first memory involved in the conflict. */
  memory_a_id: string;
  /** ID of the second memory involved in the conflict. */
  memory_b_id: string;
  /** Human-readable description of the contradiction detected by CF AI. */
  description: string;
  /**
   * Severity of the conflict.
   * - `"low"` — minor inconsistency, may be intentional
   * - `"medium"` — notable contradiction that likely needs review
   * - `"high"` — critical contradiction (e.g., contradictory job offer status)
   */
  severity: "low" | "medium" | "high";
  /** Unix epoch timestamp (ms) when this conflict was detected. */
  detected_at: number;
  /** Unix epoch timestamp (ms) when this conflict was resolved, or null. */
  resolved_at: number | null;
}

// ---------------------------------------------------------------------------
// InboxConflictProperties — shape stored in inbox.proposed_properties for conflict rows
// ---------------------------------------------------------------------------

/**
 * Shape of `inbox.proposed_properties` when `proposed_type === "conflict"`.
 *
 * Written by `insertConflictAsInbox` (CON-04 in
 * `packages/triage-worker/src/conflict-pipeline.ts`).
 * Read by `listInboxConflictsForMemoryIds` + the recall handler's CON-05
 * SQL-join in `packages/mcp-server/src/tools.ts buildRecallResponse(...)`.
 *
 * The shared type eliminates the read-side/write-side drift risk
 * (RESEARCH §Pitfall 5). Stored serialized as JSON; the caller
 * `JSON.stringify`s on write and `JSON.parse`s on read.
 *
 * `category` is hard-locked to `"contradiction"` because CON-04 only writes
 * contradictions to inbox — benign_update and unrelated verdicts are dropped
 * silently by the caller before this helper is invoked.
 */
export interface InboxConflictProperties {
  /** ID of the first memory involved in the conflict. */
  memory_a_id: string;
  /** ID of the second memory involved in the conflict. */
  memory_b_id: string;
  /**
   * Hard-locked to `"contradiction"` — only contradiction verdicts reach the
   * inbox writer. benign_update and unrelated are filtered by the caller.
   */
  category: "contradiction";
  /** CF AI's confidence in the contradiction (0–1). Stored in `memorability_score`. */
  ai_confidence: number;
  /** Human-readable description of the contradiction. Stored in `content`. */
  description: string;
}

// ---------------------------------------------------------------------------
// EngramResponse<T> — Universal Response Envelope
// ---------------------------------------------------------------------------

/**
 * Universal response envelope returned by every MCP tool.
 *
 * Shape is verbatim from CLAUDE.md §"Universal Response Envelope". Every
 * response pre-packages context (related memories, extracted entities,
 * detected conflicts) and metadata (confidence, coverage, known gaps) so
 * Claude receives minimum tokens for maximum utility — per the core design
 * principle: "Engram should return insights, not data."
 *
 * `context.timeline` uses `TimelineEvent[]` instead of the CLAUDE.md literal
 * `Event[]` — see `TimelineEvent` JSDoc for rationale.
 */
export interface EngramResponse<T> {
  /** The primary result of the MCP tool call. */
  result: T;
  /** Pre-fetched adjacent context to reduce round-trips. */
  context: {
    /** Related memories fetched and ranked by Vectorize before return. */
    related: Memory[];
    /** Entities extracted from `result` content at ingest time (not at query time). */
    entities: Entity[];
    /**
     * Chronologically ordered timeline, present when the result has temporal
     * structure (e.g., `reflect()` responses).
     */
    timeline?: TimelineEvent[];
    /**
     * Pre-detected conflicts among the memories in `related` (if any).
     * Populated by the triage worker — Claude does not need to scan for them.
     */
    conflicts?: Conflict[];
  };
  /** Quality and completeness signals for the calling model. */
  meta: {
    /**
     * Engram's confidence in the result accuracy (0–1), or `null` when no AI
     * scoring has run for this result (v0.1 honest-stub posture — D-04).
     * Phase 5 populates with real Vectorize-derived numbers.
     */
    confidence: number | null;
    /**
     * Completeness signal (0–1), or `null` when AI coverage estimation has not
     * yet been wired (v0.1 honest-stub). Phase 5 / v0.2 populates.
     */
    coverage: number | null;
    /** Unix epoch timestamp (ms) of the most recently updated memory in the result. */
    last_updated: number;
    /**
     * Known knowledge gaps detected by Engram — things it probably should know
     * but doesn't. Claude may surface these as follow-up questions.
     */
    gaps: string[];
  };
  /** Optional suggested next actions and related queries for the calling model. */
  suggestions?: {
    /** Suggested follow-up actions for Claude to take or propose to the user. */
    actions: string[];
    /** Related queries worth exploring to fill context gaps. */
    queries: string[];
  };
}
