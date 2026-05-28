/**
 * Hand-rolled SQLite migration runner for the WorkspaceDO storage layer.
 *
 * Implements STO-02: the runner tracks applied schema versions in a
 * `_schema_migrations` *table* (column shape per `02-CONTEXT.md` "Claude's
 * Discretion": `version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at
 * INTEGER NOT NULL`). NOT via `PRAGMA user_version` — that pragma is
 * unsupported in workerd's SQLite (silently returns 0 / no-ops), and
 * branching on it would silently re-run every migration on every cold start.
 * See `02-RESEARCH.md` Pitfall 2.
 *
 * Design notes:
 * - Runner is SYNCHRONOUS. `storage.sql.exec()` is sync (per Cloudflare
 *   `api/sql-storage`), so the cursor + `.toArray()` chain is sync, and
 *   declaring this `async` would be a lie that opens the door for an
 *   `await` to creep in later — which is precisely what STO-10 forbids
 *   inside the constructor's `blockConcurrencyWhile` block.
 * - `_schema_migrations` is conceptually separate from the Worker-level
 *   `wrangler.jsonc › migrations[]` array per D-08. The former tracks
 *   per-DO SQLite schema; the latter tracks DO-class additions at the
 *   Cloudflare platform level.
 * - The migration registry is `readonly Migration[]`. v0.1 ships exactly one
 *   entry (`v1_initial_schema`); additive v2/v3 migrations are explicitly
 *   deferred per `02-CONTEXT.md` "Deferred Ideas".
 * - Each `sql.exec()` is implicitly atomic. NO `BEGIN`/`COMMIT`/`SAVEPOINT`
 *   here — they are forbidden via exec per Cloudflare `api/sql-storage`.
 *   Multi-statement bindings only apply to the last statement (`02-RESEARCH.md`
 *   Pitfall 8), which is safe for the v1 DDL block because it carries no
 *   `?` placeholders. The single tracking-row INSERT uses positional `?` only.
 *
 * Wiring: called once from the constructor of `WorkspaceDO` inside
 * `ctx.blockConcurrencyWhile(async () => { runMigrations(ctx.storage.sql); ... })`.
 * Plan 02-04 (constructor wiring) is responsible for that integration; Plan
 * 02-02 (schema) provides the `V1_SQL` constant this module imports.
 *
 * @module @engram/workspace-do/migrations
 */
import type { SqlStorage } from "@cloudflare/workers-types";

import { V1_SQL, V2_SQL } from "./schema.js";

export interface Migration {
  /** Monotonically increasing schema version. v0.1 ships exactly one: `1`. */
  version: number;
  /** Human-readable name for debugging and the `_schema_migrations.name` column. */
  name: string;
  /** Full DDL body; multi-statement allowed (semicolon-separated). */
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema", sql: V1_SQL },
  // Phase 5 D-07: cold-storage routing (NOT discard — cardinal-sin clause).
  // ALTER TABLE ADD COLUMN is NOT idempotent at SQL layer; the version check
  // in the _schema_migrations table is the idempotency guarantee.
  { version: 2, name: "v2_cold_storage", sql: V2_SQL },
];

export function runMigrations(sql: SqlStorage): void {
  // Sync function — called inside blockConcurrencyWhile from WorkspaceDO constructor.
  // No await, no fetch, no env.*; the STO-10 lint enforces this statically.

  // (1) Idempotent bootstrap of the tracking table itself.
  sql.exec(
    `CREATE TABLE IF NOT EXISTS _schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  );

  // (2) Read which versions are already applied. `.toArray()` exhausts the
  //     cursor in one shot — never mix with `.next()` (Pitfall 7).
  const appliedRows = sql.exec("SELECT version FROM _schema_migrations").toArray();
  const applied = new Set<number>(appliedRows.map((r) => r.version as number));

  // (3) Apply each not-yet-applied migration in registry order, then stamp
  //     its row into the tracking table. Positional `?` bindings only —
  //     named parameters are unsupported in workerd SQLite (Pitfall 8).
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    sql.exec(m.sql);
    sql.exec(
      "INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      m.version,
      m.name,
      Date.now(),
    );
  }
}
