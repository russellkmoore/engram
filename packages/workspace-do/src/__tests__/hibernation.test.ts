/**
 * STO-09 — hibernation-replay safety (GREEN).
 *
 * Plan 02-04 fills in the Wave 0 RED stub with the verbatim two-call replay
 * recipe from 02-RESEARCH.md §3 (also documented in 02-PATTERNS.md §11):
 *
 *   1. First cold-start `runInDurableObject(stub, ...)` — assert
 *      `_schema_migrations` has exactly one row for v1_initial_schema and
 *      `memory_types` has 7 rows (the post-bootstrap shape from Plans
 *      02-01/02/03).
 *   2. Second `runInDurableObject(stub, ...)` on the SAME `idFromName(...)`
 *      value — assert BOTH counts are STILL `_schema_migrations: 1` (the
 *      migration runner did NOT re-apply v1_initial_schema) AND
 *      `memory_types: 7` (the seed loop's INSERT OR IGNORE did NOT
 *      duplicate any system types).
 *
 * **Honesty note** (per 02-RESEARCH.md Open Question O1): STO-09 specifies
 * "does not re-run completed migrations and does not duplicate seed data" —
 * the observable invariant. This test asserts that invariant directly.
 * `@cloudflare/vitest-pool-workers` internals MAY or MAY NOT deterministically
 * force a constructor replay between the two `runInDurableObject` calls (the
 * pool's instance-vs-isolate semantics are not part of its documented public
 * contract). Either way, the persistence + idempotency invariant holds and
 * is what STO-09 mandates. If a future workerd / pool release changes the
 * replay behavior (e.g., always re-instantiates, or never re-instantiates),
 * the assertion shape here still proves the user-visible guarantee.
 *
 * The test does NOT mock `WorkspaceDO` or `runInDurableObject` — per the
 * 02-RESEARCH.md Anti-Pattern §"Mocking the DO" rule, the whole point of
 * STO-08/09 is to exercise the real workerd runtime and real SQLite
 * semantics. Mocks would let a real bug through that production catches.
 *
 * Import convention (verified against
 * node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts):
 * `runInDurableObject` from `cloudflare:test`, `env` from `cloudflare:workers`
 * (the `env` re-export in `cloudflare:test` is `@deprecated`).
 *
 * Cursor conventions per 02-PATTERNS.md Shared Pattern A:
 * - `.toArray()` for the migrations list query. Never mix with `.next()`
 *   (Pitfall 7).
 * - `.one()` for COUNT queries (single-row result; throws on miss/multi —
 *   itself a useful failure signal here).
 *
 * @module @engram/workspace-do/__tests__/hibernation
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("hibernation replay safety (STO-09)", () => {
  it("re-instantiates without re-running migrations or duplicating seeds", async () => {
    const id = env.WORKSPACE.idFromName("ws-replay-test");
    const stub = env.WORKSPACE.get(id);

    // First cold start — the constructor's blockConcurrencyWhile bootstrap
    // runs migrations (writing a row into _schema_migrations) and seeds the
    // 7 system memory types. Assert the post-bootstrap shape directly.
    await runInDurableObject(stub, (_inst, state) => {
      const applied = state.storage.sql
        .exec("SELECT version, name, applied_at FROM _schema_migrations ORDER BY version")
        .toArray();
      expect(applied.length).toBe(1);
      const row = applied[0];
      expect(row).toBeDefined();
      expect(row?.version).toBe(1);
      expect(row?.name).toBe("v1_initial_schema");
      expect(typeof row?.applied_at).toBe("number");

      const seeds = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(seeds.n).toBe(7);
    });

    // Second runInDurableObject on the SAME id — simulates the hibernation-
    // replay scenario where Cloudflare evicts the DO instance from memory,
    // SQLite storage persists, and a fresh request constructs a new instance
    // against the same persisted store. The assertion: STILL 1 migration
    // row (the runner's applied-version check prevents re-apply) AND STILL
    // 7 memory types (INSERT OR IGNORE prevents PK-collision duplicates).
    // If migrations had re-run, the runner's INSERT into _schema_migrations
    // would have thrown on PK conflict (fail-loud — also a useful signal,
    // but caught here as count !== 1 OR a thrown error in the seed loop).
    // If seeds had duplicated, count would be 14 instead of 7.
    await runInDurableObject(stub, (_inst, state) => {
      const migrations = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM _schema_migrations")
        .one();
      expect(migrations.n).toBe(1);

      const seeds = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(seeds.n).toBe(7);
    });
  });
});
