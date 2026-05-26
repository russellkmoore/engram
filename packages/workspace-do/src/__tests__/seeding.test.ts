/**
 * STO-05 — system memory type seeding via INSERT OR IGNORE (GREEN).
 *
 * Plan 02-04 fills in the Wave 0 RED stubs with two assertions:
 *
 * 1. Happy path: after the first cold-start construction,
 *    `SELECT COUNT(*) FROM memory_types` returns 7 (the canonical system
 *    type set from CLAUDE.md §"Memory Types (Schema-as-Data)") and the
 *    sorted IDs equal `[...SYSTEM_TYPES].map(t => t.id).sort()` — proving
 *    the seed loop wrote every system type exactly once.
 *
 * 2. Idempotency: two sequential `runInDurableObject(stub, ...)` calls on
 *    the SAME `idFromName(...)` value still produce 7 rows, not 14 — the
 *    `INSERT OR IGNORE` clause is what prevents PK-collision duplicates on
 *    the second construction (which Cloudflare's hibernation contract
 *    explicitly may trigger). This is also part of the STO-09
 *    hibernation-replay invariant; the dedicated `hibernation.test.ts`
 *    asserts the broader claim (migrations don't re-run AND seeds don't
 *    duplicate). This file's case keeps the seeding assertion local to
 *    the seeding test suite so STO-05 has a focused verification owner.
 *
 * Import convention (verified against
 * node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts):
 * `runInDurableObject` from `cloudflare:test`, `env` from `cloudflare:workers`
 * (the `env` re-export in `cloudflare:test` is `@deprecated`).
 *
 * Cursor conventions per 02-PATTERNS.md Shared Pattern A:
 * - `.one()` for COUNT queries (single-row result; throws on miss/multi —
 *   which would itself be a useful failure signal here).
 * - `.toArray()` for list reads. Never mix with `.next()` (Pitfall 7).
 *
 * @module @engram/workspace-do/__tests__/seeding
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

import { SYSTEM_TYPES } from "@engram/schema";

describe("system memory types seeding (STO-05)", () => {
  it("seeds exactly 7 system types after first init", async () => {
    const id = env.WORKSPACE.idFromName("ws-seed-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      const countRow = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(countRow.n).toBe(7);

      const ids = state.storage.sql
        .exec("SELECT id FROM memory_types ORDER BY id")
        .toArray()
        .map((r) => r.id as string);
      // Compare against the sorted SYSTEM_TYPES ID list. The SQL `ORDER BY id`
      // and the `.sort()` here both use lexicographic ordering, so the
      // comparison is order-independent.
      const expectedIds = [...SYSTEM_TYPES].map((t) => t.id).sort();
      expect(ids).toEqual(expectedIds);
    });
  });

  it("does not duplicate seeds on second construction (INSERT OR IGNORE idempotency)", async () => {
    const id = env.WORKSPACE.idFromName("ws-seed-idempotent");
    const stub = env.WORKSPACE.get(id);

    // First construction: assert count is 7 (the seed loop ran once).
    await runInDurableObject(stub, (_inst, state) => {
      const first = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(first.n).toBe(7);
    });

    // Second runInDurableObject call on the SAME stub. The DO instance may be
    // reused or re-instantiated by the pool; either way, the persisted SQLite
    // store is the same. If a re-instantiation occurs (the hibernation-replay
    // scenario), the constructor's seedSystemTypes loop re-runs with
    // INSERT OR IGNORE — and the PK collision on every `id` is what keeps
    // the count at 7 (not 14).
    await runInDurableObject(stub, (_inst, state) => {
      const second = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(second.n).toBe(7);
    });
  });
});
