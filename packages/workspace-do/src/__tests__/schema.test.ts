/**
 * STO-02 / STO-03 / STO-04 test stubs — schema migrations + introspection.
 *
 * RED scaffold for Plans 02-01 (migration runner) and 02-02 (schema).
 * All `it.skip` placeholders fill in when the implementation plans land. The
 * suite is wired up now so each task's `<verify>` block can reference a real
 * `vitest run schema.test.ts` command from the start.
 *
 * @module @engram/workspace-do/__tests__/schema
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: these imports will resolve once the implementation plans land.
// For now we keep them as references in comments so the test file structure
// matches PATTERNS.md §11 exactly — the cold-start cost of Task 3 is just the
// describe/it scaffolding; the body of each `it` is filled in by 02-01/02-02.
//
//   import { runInDurableObject } from "cloudflare:test";
//   import { env } from "cloudflare:workers";
//   import { WorkspaceDO } from "../index.js";

describe("schema migrations (STO-02 / STO-03 / STO-04)", () => {
  // STO-02 — _schema_migrations table tracks applied migrations.
  it.skip("creates _schema_migrations table on cold start (STO-02 — Plan 02-01)", () => {
    // expect(runInDurableObject ...): SELECT name FROM sqlite_master
    //   WHERE type='table' AND name='_schema_migrations' returns one row.
    expect.fail("not yet implemented — Plan 02-01");
  });

  // STO-03 — all 7 tables present.
  it.skip("creates all 7 application tables on cold start (STO-03 — Plan 02-02)", () => {
    // PRAGMA table_info(blocks|relations|tags|members|memory_types|inbox|conflicts)
    // returns column lists matching CLAUDE.md §"SQLite Schema (inside WorkspaceDO)".
    expect.fail("not yet implemented — Plan 02-02");
  });

  // STO-04 — blocks table includes embedding_model + embedding_version columns
  // from v1 so the Phase 5 Vectorize model lock-in mitigation is in place from
  // day one (rather than added later as a migration).
  it.skip("blocks has embedding_model + embedding_version columns (STO-04 — Plan 02-02)", () => {
    // PRAGMA table_info(blocks) includes a row with name='embedding_model' type='TEXT'
    // and a row with name='embedding_version' type='INTEGER'.
    expect.fail("not yet implemented — Plan 02-02");
  });
});
