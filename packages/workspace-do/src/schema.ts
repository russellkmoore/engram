/**
 * v1 initial schema DDL for the WorkspaceDO SQLite store.
 *
 * Consumed by `./migrations.ts` as `MIGRATIONS[0].sql` and executed inside
 * the WorkspaceDO constructor's `blockConcurrencyWhile` via the synchronous
 * `runMigrations(ctx.storage.sql)` call. Plan 02-01 stubbed this constant to
 * `""` so its runner would typecheck; this Plan 02-02 overwrite replaces the
 * stub with the real DDL block.
 *
 * Design notes:
 * - All 7 tables and their column shapes are verbatim from CLAUDE.md
 *   §"SQLite Schema (inside WorkspaceDO)" — do not reorder columns, rename
 *   them, or change their types here without a corresponding CLAUDE.md
 *   update. Plan 02-04's `schema.test.ts` PRAGMA-introspects against this
 *   exact shape; silent drift would break the introspection assertions.
 * - Two STO-04 additions on `blocks`: `embedding_model TEXT` and
 *   `embedding_version INTEGER` — present from v1 so the Phase 5 Vectorize
 *   model lock-in mitigation is in place from day one (rather than added
 *   later via an ALTER TABLE migration against a populated `blocks` table).
 * - Indexes are declared in the SAME migration as table creation (D-05).
 *   No additive index migrations expected in v0.1. The aggressive v1
 *   indexing set (D-04) covers all expected v0.1 query patterns: relations
 *   from_id/to_id (cascade-delete support in Plan 02-05's helper), tags
 *   block_id (tag lookup), inbox/conflicts ordering, blocks scope/project_id
 *   /type/created_at (Phase 4 query patterns), blocks embedding_id (Phase 5
 *   Vectorize lookup). PRIMARY KEYs are "free" — they get an implicit
 *   B-tree index from SQLite without a separate index-creation statement.
 * - All timestamps are ms-unix-epoch (`INTEGER`). Safe under 2^53 for ~280k
 *   years (Pitfall 5 — BigInt precision warning is moot). Document this so
 *   a future contributor doesn't try to store nanosecond timestamps.
 * - No `ON DELETE CASCADE` anywhere. D-04 specifies indexes explicitly;
 *   cascade is the helper's responsibility — Plan 02-05's `deleteBlock`
 *   issues an explicit `DELETE FROM relations WHERE from_id = ? OR to_id = ?`
 *   after the `DELETE FROM blocks` to keep the cascade in TypeScript where
 *   it is testable and observable.
 * - No `BEGIN`/`COMMIT`/`SAVEPOINT`. Each `sql.exec()` call is implicitly
 *   atomic per Cloudflare's `api/sql-storage` rules; transaction control
 *   statements are forbidden through that entrypoint.
 * - No `?` placeholders in the DDL string. Cloudflare's multi-statement
 *   binding rule (Pitfall 8) is that bindings apply only to the *last*
 *   statement of a multi-statement `exec()` call — so a binding inside any
 *   non-last statement would silently misbehave. The v1 DDL is bind-free
 *   by construction; the single tracking-row INSERT in `migrations.ts` is
 *   the only place positional `?` bindings appear.
 * - All table-creation and index-creation statements use `IF NOT EXISTS`.
 *   This makes re-executing `V1_SQL` against the same SQLite store a safe
 *   no-op, even if the `_schema_migrations` tracker somehow lies — a
 *   defense-in-depth layer for the runner's idempotency.
 *
 * Cross-plan contract:
 * - Plan 02-01 (migrations.ts) imports this constant verbatim — overwriting
 *   this file's V1_SQL value is the entire mechanism by which Plan 02-02
 *   "wires in" the schema.
 * - Plan 02-03 (seeding.ts) writes `INSERT OR IGNORE INTO memory_types`
 *   against the `memory_types` table this DDL creates.
 * - Plan 02-04 (constructor wiring + schema.test.ts) runs the migration
 *   end-to-end and PRAGMA-introspects every table defined here.
 * - Plan 02-05 (queries.ts) writes typed helpers against every table
 *   defined here, parsing the JSON columns (`blocks.properties`,
 *   `memory_types.fields`, `relations.properties`, `inbox.proposed_properties`)
 *   at the helper boundary per D-03.
 *
 * @module @engram/workspace-do/schema
 */

export const V1_SQL = `
  CREATE TABLE IF NOT EXISTS blocks (
    id                TEXT PRIMARY KEY,
    type              TEXT NOT NULL,
    content           TEXT,
    summary           TEXT,
    properties        TEXT,
    embedding_id      TEXT,
    embedding_model   TEXT,
    embedding_version INTEGER,
    scope             TEXT NOT NULL DEFAULT 'personal',
    project_id        TEXT,
    source            TEXT,
    confidence        REAL,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_blocks_scope         ON blocks(scope);
  CREATE INDEX IF NOT EXISTS idx_blocks_project_id    ON blocks(project_id);
  CREATE INDEX IF NOT EXISTS idx_blocks_type          ON blocks(type);
  CREATE INDEX IF NOT EXISTS idx_blocks_created_at    ON blocks(created_at);
  CREATE INDEX IF NOT EXISTS idx_blocks_embedding_id  ON blocks(embedding_id);

  CREATE TABLE IF NOT EXISTS relations (
    from_id      TEXT NOT NULL,
    to_id        TEXT NOT NULL,
    relationship TEXT NOT NULL,
    properties   TEXT,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id, relationship)
  );
  CREATE INDEX IF NOT EXISTS idx_relations_from_id ON relations(from_id);
  CREATE INDEX IF NOT EXISTS idx_relations_to_id   ON relations(to_id);

  CREATE TABLE IF NOT EXISTS tags (
    block_id TEXT NOT NULL,
    tag      TEXT NOT NULL,
    source   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tags_block_id ON tags(block_id);

  CREATE TABLE IF NOT EXISTS members (
    user_id    TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    invited_by TEXT,
    joined_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_types (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    fields       TEXT NOT NULL,
    workspace_id TEXT,
    source       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inbox (
    id                  TEXT PRIMARY KEY,
    content             TEXT,
    proposed_type       TEXT,
    proposed_properties TEXT,
    memorability_score  REAL,
    source              TEXT,
    created_at          INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox(created_at);

  CREATE TABLE IF NOT EXISTS conflicts (
    id          TEXT PRIMARY KEY,
    memory_a_id TEXT NOT NULL,
    memory_b_id TEXT NOT NULL,
    description TEXT,
    severity    TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_conflicts_resolved_at ON conflicts(resolved_at);
` as const;
