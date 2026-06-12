/**
 * Query-result and helper-input types specific to `@engram/workspace-do`.
 *
 * Shapes that match the canonical Engram domain types (`Memory`, `Conflict`)
 * are re-exported from `@engram/types` and used directly by Plan 02-05's
 * helpers. Anything NOT in `@engram/types` — row shapes for the per-DO tables
 * `memory_types` and `inbox`, plus the `LexicalSearchHit` extension Memory
 * acquires when returned by `lexicalSearchBlocks` — lives here.
 *
 * Design notes:
 * - **`interface` over `type`** for every object shape — mirrors the
 *   `shared/types/src/index.ts` convention (every domain shape there is an
 *   `interface`) and the project's `@typescript-eslint/consistent-type-definitions`
 *   ESLint rule. PATTERNS.md §8 explicitly prescribes this.
 * - **Per-field JSDoc** on every field — also mirrors `shared/types`. The
 *   JSDoc captures the SQLite column it maps to, the nullability source
 *   (SQLite `NULL` vs. domain "absent"), and any parsing semantics (JSON
 *   columns arrive here already parsed per D-03).
 * - **JSON-column fields are typed as parsed values** (`Record<string,
 *   unknown>` / `unknown[]`), NOT as `string`. Per D-03 (CONTEXT.md), JSON
 *   parsing happens at the helper boundary in `./queries.ts` — consumers of
 *   these interfaces never see the raw JSON text. The `Pitfall 3` loose
 *   `== null` check inside `./queries.ts` is what converts SQLite NULL +
 *   `noUncheckedIndexedAccess` undefined into the `| null` arm of these
 *   types.
 * - **`verbatimModuleSyntax`-compliant import** of `Memory` from
 *   `@engram/types` via `import type` — the import is purely structural
 *   (extends), not runtime, so the type-only import is required by the
 *   project's strict TS posture.
 * - **Field names match the SQLite column names exactly** (lowercase
 *   snake_case for SQL-mirrored types). Plan 02-05's queries.ts uses these
 *   names as the row-introspection keys, so any rename would silently break
 *   the narrowing helpers.
 *
 * @module @engram/workspace-do/types
 */
import type { Memory } from "@engram/types";

// ---------------------------------------------------------------------------
// MemoryType — row shape for the `memory_types` SQLite table
// ---------------------------------------------------------------------------

/**
 * One row from the `memory_types` SQLite table — either a system-seeded type
 * (`source: "system"`, `workspace_id: null`) or a workspace-scoped user /
 * community type (`source: "user" | "community"`, `workspace_id: <ws-id>`).
 *
 * The 7 system types are seeded by `./seeding.ts` from `@engram/schema`'s
 * `SYSTEM_TYPES` constant per CLAUDE.md §"Memory Types (Schema-as-Data)".
 * User and community types are written by Phase 3+ MCP tools, not by this
 * package.
 */
export interface MemoryType {
  /**
   * Stable identifier for the memory type — e.g., `"job_application"`.
   * Used as both the primary key in the `memory_types` table and as the
   * value of `blocks.type` for every block instance of this type.
   */
  id: string;
  /**
   * Human-readable display name — e.g., `"Job Application"`. Used by
   * MCP clients when rendering a type picker; not interpreted by Engram.
   */
  name: string;
  /**
   * Field definitions for instances of this memory type. Parsed from the
   * `fields` TEXT/JSON column at the helper boundary (D-03). Shape is
   * either a positional `unknown[]` (the system-types convention — an
   * array of `MemoryTypeField` records from `@engram/schema`) or a keyed
   * `Record<string, unknown>` for user-defined types that may use a
   * keyed object instead of an ordered list. Phase 4 may add runtime
   * validation; Phase 2 trusts the storage layer.
   */
  fields: readonly unknown[] | Record<string, unknown>;
  /**
   * Owning workspace id when `source` is `"user"` or `"community"`. Always
   * `null` for system-seeded types — the seed loop writes the literal
   * `NULL` per CLAUDE.md §"SQLite Schema" `memory_types.workspace_id`
   * column comment ("null = system default").
   */
  workspace_id: string | null;
  /**
   * Discriminant identifying the origin of this memory type record.
   *
   * Values:
   * - `"system"` — seeded at workspace creation from `SYSTEM_TYPES`. The
   *   7 canonical types from CLAUDE.md §"Memory Types (Schema-as-Data)".
   * - `"user"` — created at runtime by an MCP tool call. Always paired
   *   with a non-null `workspace_id`.
   * - `"community"` — installed from the R2 type registry (post-v1.0).
   *   Also paired with a non-null `workspace_id`.
   *
   * Threat-model note: the seed loop hard-codes `'system'` as a SQL
   * literal (not a binding) so the cross-source-spoofing threat
   * (T-02-03-02) is mitigated at the seed-site.
   */
  source: "system" | "user" | "community";
}

// ---------------------------------------------------------------------------
// InboxEntry — row shape for the `inbox` SQLite table
// ---------------------------------------------------------------------------

/**
 * One row from the `inbox` SQLite table — a low-confidence capture pending
 * human review per CLAUDE.md §"Ingest Pipeline" (memorability score 0.4-0.8
 * routes here instead of auto-storing to `blocks`).
 *
 * Nullability mirrors the v1 DDL (`packages/workspace-do/src/schema.ts`)
 * exactly: `id` and `created_at` are NOT NULL; every other column allows
 * SQLite `NULL`. The `proposed_properties` field is parsed from JSON at
 * the helper boundary (D-03 + Pitfall 3).
 */
export interface InboxEntry {
  /** UUID primary key. */
  id: string;
  /** Raw content of the captured event, or `null` if the source was meta-only. */
  content: string | null;
  /**
   * CF AI's proposed memory type id (e.g., `"job_application"`), or `null`
   * if classification failed or was inconclusive.
   */
  proposed_type: string | null;
  /**
   * CF AI's proposed typed fields for the proposed memory type. Parsed from
   * the `proposed_properties` TEXT/JSON column at the helper boundary
   * (D-03). `null` when no properties were extracted (e.g., the proposed
   * type has no fields, or extraction failed).
   */
  proposed_properties: Record<string, unknown> | null;
  /**
   * CF AI's memorability score in `[0, 1]`. Triage routes scores in
   * `[0.4, 0.8]` here; below 0.4 is discarded and above 0.8 is auto-stored
   * to `blocks`. `null` if scoring was skipped (manual ingest).
   */
  memorability_score: number | null;
  /**
   * Origin of the capture — e.g., `"mcp:claude"`, `"connector:slack"`.
   * `null` when source information is unavailable (rare; mostly for
   * locally-injected debug entries).
   */
  source: string | null;
  /** Unix epoch timestamp (ms) when this inbox entry was created. */
  created_at: number;
}

// ---------------------------------------------------------------------------
// InboxConflictRow — raw SQL-row shape for conflict-inbox entries (CON-04/CON-05)
// ---------------------------------------------------------------------------

/**
 * One row from the `inbox` SQLite table where `proposed_type === "conflict"`.
 *
 * Returned by `listInboxConflictsForMemoryIds` before any JSON parsing.
 * The caller (Plan 02-08 recall handler) is responsible for parsing
 * `proposed_properties` as `InboxConflictProperties` from `@engram/types`.
 *
 * This is a raw SQL-row shape — NOT the `Conflict` envelope type from
 * `@engram/types`. The mapping from `InboxConflictRow` to `Conflict` happens
 * in the recall handler (Plan 02-08), not here.
 *
 * Design note: `proposed_properties` is typed as `string` (not
 * `Record<string,unknown>`) here because the caller's JSON parsing is
 * intentional — the helper returns the raw serialized value so the recall
 * handler can parse it once and map it with the full `InboxConflictProperties`
 * type contract (RESEARCH §Pitfall 5 mitigation).
 */
export interface InboxConflictRow {
  /** Primary key: `conflict-<UUID>` format. */
  id: string;
  /**
   * Raw content — equals `description` from the `InboxConflictProperties`
   * at write time. Stored in `inbox.content`.
   */
  content: string;
  /**
   * Always `"conflict"` for rows returned by this helper. The SQL WHERE
   * clause filters to this value so callers don't need to re-check.
   */
  proposed_type: "conflict";
  /**
   * JSON-stringified `InboxConflictProperties`. Caller must `JSON.parse` to
   * access the 5-field shape. Kept as a string here per D-03 inversion:
   * parsing at the CALLER boundary (recall handler in Plan 02-08) rather
   * than here keeps the helper pure and lets the recall handler apply the
   * `InboxConflictProperties` contract explicitly.
   */
  proposed_properties: string;
  /**
   * CF AI's confidence in the contradiction (0–1). Stored in
   * `memorability_score` per the column repurposing for CON-04 conflict rows.
   */
  memorability_score: number;
  /**
   * Origin of the conflict write — always `"triage:conflict-pipeline"` for
   * rows written by `insertConflictAsInbox`.
   */
  source: string;
  /** Unix epoch timestamp (ms) when this inbox entry was created. */
  created_at: number;
}

// ---------------------------------------------------------------------------
// LexicalSearchHit — shape returned by lexicalSearchBlocks (Memory + snippet)
// ---------------------------------------------------------------------------

/**
 * One result from `lexicalSearchBlocks(query)` — a full `Memory` row plus an
 * optional snippet excerpt from the column the match was found in. v0.1
 * Phase 2 always returns `snippet: null`; Phase 4's lexical-search tool may
 * populate it with a windowed substring around the match position.
 *
 * Extends `Memory` so consumers can treat hits as memories everywhere a
 * `Memory` is accepted — the snippet is additive context, not a separate
 * lookup.
 */
export interface LexicalSearchHit extends Memory {
  /**
   * First ~200 chars of `content` (or `summary` if matched there) around
   * the match position. `null` in v0.1 Phase 2 — populated by Phase 4 if
   * snippet rendering ships then.
   */
  snippet: string | null;
  /**
   * Which column the LIKE pattern matched. `null` in v0.1 Phase 2 — Phase 4
   * may populate to disambiguate when content and summary both match.
   * Useful for tools that want to highlight the match source.
   */
  match_column: "content" | "summary" | null;
  /**
   * Lexical relevance score in `[0, 1]`, or `null` if scoring is not
   * implemented. v0.1 Phase 2 always returns `null` (the LIKE backing is
   * unranked beyond `ORDER BY created_at DESC`). Phase 4 may introduce a
   * BM25-style score; Phase 5 displaces lexical entirely with Vectorize
   * cosine scores, so this field is intentionally namespace-scoped to
   * lexical and will not collide with the semantic-recall envelope.
   */
  score: number | null;
}
