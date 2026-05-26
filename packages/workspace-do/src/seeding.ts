/**
 * System memory type seeding for the WorkspaceDO storage layer.
 *
 * Implements STO-05: every new workspace gets the 7 canonical system memory
 * types (CLAUDE.md §"Memory Types (Schema-as-Data)" — `job_application`,
 * `contact`, `company`, `project`, `research_note`, `decision_log`,
 * `meeting_note`) written to its `memory_types` table on first init via
 * `INSERT OR IGNORE`. The clause's PK-collision semantic is the idempotency
 * guarantee: running the loop N times on the same SQLite store still
 * produces exactly 7 rows (no duplicates) — which is the STO-09
 * hibernation-replay invariant that Plan 02-04's `seeding.test.ts` will
 * assert with a double-init test case.
 *
 * Design notes:
 * - **Synchronous.** Matches `runMigrations(sql)` from Plan 02-01 — both are
 *   called inside `ctx.blockConcurrencyWhile(async () => { ... })` from the
 *   WorkspaceDO constructor in Plan 02-04. `storage.sql.exec()` is sync per
 *   Cloudflare `api/sql-storage`, so declaring this `async` would be a lie
 *   that opens the door for an `await` to creep in later — which is
 *   precisely what STO-10 forbids inside the constructor block.
 * - **JSON at the helper boundary (D-03).** The `fields` column is `TEXT NOT
 *   NULL` per Plan 02-02's V1_SQL DDL; we `JSON.stringify` on write and
 *   future read helpers in Plan 02-05 will `JSON.parse` on read. No runtime
 *   schema validation (zod) here — D-03 defers validation to Phase 4's MCP
 *   tool-input boundary. `SYSTEM_TYPES` is `as const satisfies readonly
 *   SystemMemoryType[]`, so TS rejects `undefined` field values at definition
 *   time and `JSON.stringify`'s "silently drops undefined" pitfall
 *   (`02-RESEARCH.md` Pitfall 4) cannot bite for system seeds.
 * - **`workspace_id = NULL` and `source = 'system'` are hard-coded SQL
 *   literals, not bindings.** They are the discriminants distinguishing
 *   system-seeded types from user-defined / community-installed types
 *   (CLAUDE.md §"SQLite Schema" — `memory_types` table comment). User
 *   types in Phase 3+ will write `source = 'user'` or `'community'`. This
 *   file ONLY ever writes `source = 'system'`; the cross-source discriminant
 *   spoofing threat (T-02-03-02) is mitigated at the seed-site by hard-coding
 *   the literal rather than binding it.
 * - **Positional `?` bindings only.** Cloudflare `api/sql-storage` Key APIs
 *   §B — named parameters (`:name`) are unsupported in workerd's SQLite.
 *   Each INSERT here is a single-statement `.exec()`, so the multi-statement
 *   binding pitfall (`02-RESEARCH.md` Pitfall 8 — bindings only apply to the
 *   last statement) does not apply.
 * - **No additional seed entries for non-system memory types.** This file is
 *   ONLY for the 7 canonical system types. User-defined types are Phase 3+
 *   territory and arrive through MCP tool calls, not this loop
 *   (`02-PATTERNS.md` §5 drift risk).
 *
 * Wiring: called once from the WorkspaceDO constructor inside
 * `ctx.blockConcurrencyWhile(async () => { runMigrations(ctx.storage.sql);
 * seedSystemTypes(ctx.storage.sql); })`. Plan 02-04 owns that integration;
 * this plan provides the seed-loop contract.
 *
 * @module @engram/workspace-do/seeding
 */
import type { SqlStorage } from "@cloudflare/workers-types";

import { SYSTEM_TYPES } from "@engram/schema";

export function seedSystemTypes(sql: SqlStorage): void {
  // Sync function — called inside blockConcurrencyWhile from WorkspaceDO constructor. INSERT OR IGNORE provides idempotency on PK collision (id), so this loop is safe to re-run on hibernation replay (STO-09).
  for (const t of SYSTEM_TYPES) {
    sql.exec(
      "INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source) VALUES (?, ?, ?, NULL, 'system')",
      t.id,
      t.name,
      JSON.stringify(t.fields),
    );
  }
}
