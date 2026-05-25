/**
 * System memory type definitions for Engram — the seed data that Phase 2's
 * `WorkspaceDO` migration will `INSERT OR IGNORE` into the `memory_types` table.
 *
 * Design notes:
 * - Memory types are schema-as-data (NOT TypeScript classes). These records are
 *   stored in the `memory_types` SQLite table and queried at runtime.
 * - The 7 system types and their field lists are verbatim from CLAUDE.md
 *   §"Memory Types (Schema-as-Data)" — do not add or remove types here without
 *   a corresponding CLAUDE.md update.
 * - `required` flags below are v0.1 conservative defaults: the bare-minimum fields
 *   without which a record of that type makes no semantic sense. They may be
 *   relaxed or tightened in Phase 2 (STO-05) when the seed migration is consumed
 *   and validated against real data.
 * - `options` arrays for `select` / `multi_select` fields represent v0.1 defaults.
 *   They are populated into `memory_types.fields` JSON and can be extended at
 *   runtime by users without a code change.
 *
 * @module @engram/schema/system-types
 */

// ---------------------------------------------------------------------------
// FieldType — union of all supported field types (CLAUDE.md §"Memory Types")
// ---------------------------------------------------------------------------

/**
 * The set of typed field kinds a memory type field can have.
 * Verbatim from CLAUDE.md §"Field types supported".
 */
export type FieldType =
  | "text"
  | "number"
  | "date"
  | "url"
  | "select"
  | "multi_select"
  | "boolean"
  | "relation"
  | "range";

// ---------------------------------------------------------------------------
// FieldDefinition — metadata for a single field in a memory type
// ---------------------------------------------------------------------------

/**
 * Describes one field in a memory type's schema.
 * Stored as an element of the `fields` JSON column in `memory_types`.
 */
export interface FieldDefinition {
  /** Machine-readable field identifier (snake_case). */
  name: string;
  /** The kind of data this field holds. */
  type: FieldType;
  /**
   * Whether this field must be present for a record of this type to be valid.
   * Defaults to `false` (optional) when not specified.
   */
  required?: boolean;
  /**
   * Allowed values for `select` and `multi_select` fields.
   * Empty array means "any value" — options are populated at runtime.
   * Ignored for all other field types.
   */
  options?: readonly string[];
}

// ---------------------------------------------------------------------------
// SystemMemoryType — a single memory type record (mirrors memory_types table)
// ---------------------------------------------------------------------------

/**
 * A system memory type record as it appears in the `memory_types` SQLite table.
 * Mirrors the table shape from CLAUDE.md §"SQLite Schema" (`id`, `name`, `fields`).
 * The `workspace_id` and `source` columns default to `null` and `"system"` in the
 * migration — they are not part of this definition type.
 */
export interface SystemMemoryType {
  /** Unique memory type identifier (snake_case, matches CLAUDE.md spec). */
  id: string;
  /** Human-readable display name of this memory type. */
  name: string;
  /**
   * Ordered list of field definitions for this type.
   * Stored as JSON in `memory_types.fields`.
   */
  fields: readonly FieldDefinition[];
}

// ---------------------------------------------------------------------------
// SYSTEM_TYPES — the 7 v0.1 system memory types
// ---------------------------------------------------------------------------

/**
 * The canonical array of system memory types seeded into every new workspace.
 *
 * All 7 types and their field lists are verbatim from CLAUDE.md §"System types
 * to seed". Phase 2's `WorkspaceDO` migration calls:
 *   `INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source)`
 * using this array as the source of truth.
 *
 * Using `as const satisfies readonly SystemMemoryType[]` to:
 *   1. Preserve literal types on `id`, `type`, and `options` values (for exhaustive
 *      switch / narrowing in future phases).
 *   2. Validate at compile time that every entry conforms to `SystemMemoryType`.
 */
export const SYSTEM_TYPES = [
  // -------------------------------------------------------------------------
  // job_application
  // -------------------------------------------------------------------------
  {
    id: "job_application",
    name: "Job Application",
    fields: [
      { name: "company", type: "text", required: true },
      { name: "role", type: "text", required: true },
      {
        name: "status",
        type: "select",
        required: false,
        options: [
          "applied",
          "interviewing",
          "offered",
          "rejected",
          "accepted",
          "withdrawn",
        ] as const,
      },
      { name: "applied_date", type: "date", required: false },
      { name: "salary_range", type: "range", required: false },
      { name: "source", type: "text", required: false },
      { name: "url", type: "url", required: false },
      { name: "contact", type: "relation", required: false },
    ],
  },

  // -------------------------------------------------------------------------
  // contact
  // -------------------------------------------------------------------------
  {
    id: "contact",
    name: "Contact",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "email", type: "text", required: false },
      { name: "company", type: "relation", required: false },
      { name: "role", type: "text", required: false },
      { name: "relationship", type: "text", required: false },
      { name: "notes", type: "text", required: false },
    ],
  },

  // -------------------------------------------------------------------------
  // company
  // -------------------------------------------------------------------------
  {
    id: "company",
    name: "Company",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "industry", type: "text", required: false },
      { name: "size", type: "text", required: false },
      { name: "url", type: "url", required: false },
      { name: "notes", type: "text", required: false },
    ],
  },

  // -------------------------------------------------------------------------
  // project
  // -------------------------------------------------------------------------
  {
    id: "project",
    name: "Project",
    fields: [
      { name: "name", type: "text", required: true },
      {
        name: "status",
        type: "select",
        required: false,
        options: ["active", "paused", "done", "abandoned"] as const,
      },
      { name: "owner", type: "relation", required: false },
      { name: "deadline", type: "date", required: false },
      { name: "description", type: "text", required: false },
    ],
  },

  // -------------------------------------------------------------------------
  // research_note
  // -------------------------------------------------------------------------
  {
    id: "research_note",
    name: "Research Note",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "topic", type: "text", required: false },
      { name: "source_url", type: "url", required: false },
      { name: "summary", type: "text", required: false },
      {
        name: "tags",
        type: "multi_select",
        required: false,
        // Options are intentionally empty — populated at runtime by the user.
        options: [] as const,
      },
    ],
  },

  // -------------------------------------------------------------------------
  // decision_log
  // -------------------------------------------------------------------------
  {
    id: "decision_log",
    name: "Decision Log",
    fields: [
      { name: "decision", type: "text", required: true },
      { name: "rationale", type: "text", required: false },
      { name: "owner", type: "relation", required: false },
      { name: "date", type: "date", required: false },
      { name: "project", type: "relation", required: false },
    ],
  },

  // -------------------------------------------------------------------------
  // meeting_note
  // -------------------------------------------------------------------------
  {
    id: "meeting_note",
    name: "Meeting Note",
    fields: [
      { name: "date", type: "date", required: true },
      {
        name: "attendees",
        type: "multi_select",
        required: false,
        // Options are intentionally empty — attendees are resolved from contacts at runtime.
        options: [] as const,
      },
      { name: "decisions", type: "text", required: false },
      { name: "action_items", type: "text", required: false },
      { name: "project", type: "relation", required: false },
    ],
  },
] as const satisfies readonly SystemMemoryType[];
