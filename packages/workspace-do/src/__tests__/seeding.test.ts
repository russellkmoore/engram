/**
 * STO-05 test stubs — system memory type seeding via INSERT OR IGNORE.
 *
 * RED scaffold for Plan 02-03 (seeding). Two cases — happy path (7 types after
 * single init) and idempotency (7 types after double init, not 14).
 *
 * @module @engram/workspace-do/__tests__/seeding
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: implementation imports resolved in Plan 02-03.
//   import { runInDurableObject } from "cloudflare:test";
//   import { env } from "cloudflare:workers";
//   import { WorkspaceDO } from "../index.js";

describe("system type seeding (STO-05)", () => {
  it.skip("seeds 7 system memory types on first init (STO-05 — Plan 02-03)", () => {
    // SELECT COUNT(*) AS n FROM memory_types WHERE source='system' returns { n: 7 }.
    // SELECT id FROM memory_types WHERE source='system' ORDER BY id returns the
    // 7 expected IDs verbatim from @engram/schema SYSTEM_TYPES.
    expect.fail("not yet implemented — Plan 02-03");
  });

  it.skip("double-init produces 7 types, not 14 (INSERT OR IGNORE idempotency — STO-05)", () => {
    // Invoke seedSystemTypes(sql) twice. SELECT COUNT(*) FROM memory_types
    // returns { n: 7 } after both invocations — the INSERT OR IGNORE clause
    // means re-running the seed loop is a no-op for existing PKs.
    expect.fail("not yet implemented — Plan 02-03");
  });
});
