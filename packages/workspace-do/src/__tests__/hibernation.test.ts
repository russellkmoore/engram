/**
 * STO-09 test stub — hibernation-replay safety.
 *
 * RED scaffold for Plan 02-01 (migration runner). The two-call replay pattern
 * is verbatim from 02-RESEARCH.md §3:
 *
 *   1. First cold start: runInDurableObject + assert `_schema_migrations` has
 *      exactly one row (`v1_initial_schema`) and `memory_types` has 7 rows.
 *   2. Second access (simulated post-hibernation re-instantiation): same DO ID,
 *      assert the row counts are still 1 and 7 — the constructor must NOT
 *      re-apply v1_initial_schema or re-INSERT the 7 system types.
 *
 * The whole point is to prove the per-DO `_schema_migrations` table (NOT
 * `PRAGMA user_version` — Pitfall 2) correctly gates migration re-runs after
 * Cloudflare's hibernation re-instantiates the DO class.
 *
 * @module @engram/workspace-do/__tests__/hibernation
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: implementation imports resolved in Plan 02-01.
//   import { runInDurableObject } from "cloudflare:test";
//   import { env } from "cloudflare:workers";
//   import { WorkspaceDO } from "../index.js";

describe("hibernation replay safety (STO-09)", () => {
  it.skip("re-instantiation does not re-run migrations or duplicate seed data (STO-09 — Plan 02-01)", () => {
    // const id = env.WORKSPACE.idFromName("ws-replay-test");
    //
    // // First cold start:
    // await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
    //   const applied = state.storage.sql.exec(
    //     "SELECT version, name FROM _schema_migrations ORDER BY version",
    //   ).toArray();
    //   expect(applied).toEqual([
    //     { version: 1, name: "v1_initial_schema", applied_at: expect.any(Number) },
    //   ]);
    //   const seeds = state.storage.sql
    //     .exec("SELECT COUNT(*) AS n FROM memory_types").one();
    //   expect(seeds.n).toBe(7);
    // });
    //
    // // Second access (same ID — simulates hibernation re-instantiation):
    // await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
    //   expect(state.storage.sql.exec(
    //     "SELECT COUNT(*) AS n FROM _schema_migrations",
    //   ).one().n).toBe(1);
    //   expect(state.storage.sql.exec(
    //     "SELECT COUNT(*) AS n FROM memory_types",
    //   ).one().n).toBe(7);
    // });
    expect.fail("not yet implemented — Plan 02-01");
  });
});
