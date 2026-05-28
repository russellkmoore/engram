/**
 * STO-02 / STO-03 / STO-04 — schema migrations + introspection (GREEN).
 *
 * Plan 02-04 fills in the Wave 0 RED stubs (it.skip + expect.fail) with real
 * assertions against the live `WorkspaceDO` running inside workerd via
 * `@cloudflare/vitest-pool-workers`. Each describe block scopes a single
 * STO requirement and uses a distinct `idFromName(...)` value so test
 * isolation is explicit (even though `isolatedStorage` is the pool default).
 *
 * Assertion sources:
 * - STO-02 — verbatim from 02-RESEARCH.md §1 (migration runner stamps a row
 *   into `_schema_migrations` with `{version: 1, name: "v1_initial_schema",
 *   applied_at: <number>}` after first cold start).
 * - STO-03 — 7 user tables from CLAUDE.md §"SQLite Schema (inside
 *   WorkspaceDO)": `blocks`, `relations`, `tags`, `members`, `memory_types`,
 *   `inbox`, `conflicts`. The `_schema_migrations` tracker and any `sqlite_*`
 *   meta tables are filtered out before counting (per 02-PATTERNS.md §11
 *   "ignore sqlite_* and _schema_migrations meta tables").
 * - STO-04 — `PRAGMA table_info(blocks)` introspects for `embedding_model`
 *   (TEXT) + `embedding_version` (INTEGER) columns from v1 so the Phase 5
 *   Vectorize model lock-in mitigation is in place from day one.
 *
 * Import convention (verified against
 * node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts):
 * - `runInDurableObject` comes from `cloudflare:test` (test-pool module).
 * - `env` comes from `cloudflare:workers` (the `env` re-export in
 *   `cloudflare:test` is `@deprecated` per the type definitions; the modern
 *   replacement is the runtime module).
 *
 * Cursor conventions per 02-PATTERNS.md Shared Pattern A:
 * - `.toArray()` for list reads. Never mix with `.next()` (Pitfall 7).
 * - Cast row column values via `as <type>` ONLY in test code (production
 *   helpers use narrowing helpers per Pitfall 6 — but introspection tests
 *   read raw `Record<string, SqlStorageValue>` and don't need to satisfy a
 *   strict domain contract).
 *
 * @module @engram/workspace-do/__tests__/schema
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

// EXPECTED_TABLES — the 7 user tables CLAUDE.md spec mandates. Sorted for
// deterministic comparison against the `sqlite_master`-derived list (also
// sorted before assertion).
const EXPECTED_TABLES = [
  "blocks",
  "conflicts",
  "inbox",
  "members",
  "memory_types",
  "relations",
  "tags",
] as const;

describe("_schema_migrations table (STO-02)", () => {
  it("contains rows for v1_initial_schema and v2_cold_storage after first init", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-migrations-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      const rows = state.storage.sql
        .exec("SELECT version, name, applied_at FROM _schema_migrations ORDER BY version")
        .toArray();
      // Phase 5 Plan 05-01 added v2_cold_storage — expect 2 rows.
      expect(rows.length).toBe(2);
      const v1 = rows[0];
      expect(v1).toBeDefined();
      expect(v1?.version).toBe(1);
      expect(v1?.name).toBe("v1_initial_schema");
      expect(typeof v1?.applied_at).toBe("number");
      const v2 = rows[1];
      expect(v2).toBeDefined();
      expect(v2?.version).toBe(2);
      expect(v2?.name).toBe("v2_cold_storage");
      expect(typeof v2?.applied_at).toBe("number");
    });
  });
});

describe("table presence (STO-03)", () => {
  it("creates all 7 expected user tables", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-tables-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      // sqlite_master is the canonical SQLite introspection table. We filter
      // out the `_schema_migrations` meta table (Phase 2 framework tracker)
      // and any `sqlite_*` internal tables (autoindex, sequence, etc.) before
      // comparing against the expected user-table set.
      const allNames = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((r) => r.name as string);
      const userTables = allNames
        .filter((n) => n !== "_schema_migrations" && !n.startsWith("sqlite_"))
        .sort();
      // Compare against the sorted EXPECTED_TABLES set — order-independent.
      expect(userTables).toEqual([...EXPECTED_TABLES]);
    });
  });
});

describe("blocks cold_storage column (D-07 / v2)", () => {
  it("includes cold_storage INTEGER DEFAULT 0 added by v2 migration", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-cold-storage-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      const cols = state.storage.sql
        .exec("PRAGMA table_info(blocks)")
        .toArray()
        .map((c) => ({
          name: c.name as string,
          type: c.type as string,
          notnull: c.notnull as number,
          dflt_value: c.dflt_value,
        }));

      const coldStorage = cols.find((c) => c.name === "cold_storage");
      expect(coldStorage).toBeDefined();
      expect(coldStorage?.type.toUpperCase()).toBe("INTEGER");
      // DEFAULT 0 — existing rows are non-cold by default.
      expect(coldStorage?.dflt_value).toBe("0");
    });
  });
});

describe("blocks embedding columns (STO-04)", () => {
  it("includes embedding_model TEXT and embedding_version INTEGER from v1", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-embedding-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      // PRAGMA table_info(<name>) is supported via .exec() per Cloudflare's
      // seat-booking tutorial (02-RESEARCH.md §B). Returns one row per
      // column: { cid, name, type, notnull, dflt_value, pk }.
      const cols = state.storage.sql
        .exec("PRAGMA table_info(blocks)")
        .toArray()
        .map((c) => ({ name: c.name as string, type: c.type as string }));

      const embeddingModel = cols.find((c) => c.name === "embedding_model");
      const embeddingVersion = cols.find((c) => c.name === "embedding_version");

      expect(embeddingModel).toBeDefined();
      // PRAGMA table_info reports the type token verbatim from the DDL.
      // Use case-insensitive comparison defensively: workerd's SQLite mirrors
      // the spec but version drift on type-affinity normalization is a
      // documented soft edge (02-RESEARCH.md §B "type tokens").
      expect(embeddingModel?.type.toUpperCase()).toBe("TEXT");

      expect(embeddingVersion).toBeDefined();
      expect(embeddingVersion?.type.toUpperCase()).toBe("INTEGER");
    });
  });
});
