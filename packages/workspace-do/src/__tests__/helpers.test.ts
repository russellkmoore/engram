/**
 * STO-06 test stubs — typed query helpers (one `it` per helper).
 *
 * RED scaffold for Plan 02-04 (query helpers). Seven distinct cases — exactly
 * one per helper. Plan 02-04 fills in each body; the count is verified by the
 * Wave-0 acceptance criteria (helpers.test.ts must contain exactly 7 `it`s).
 *
 * Helper list (locked from STO-06 + D-01/D-02/D-03):
 *   1. insertBlock(block)         — write path, JSON-stringify properties.
 *   2. getBlock(id)               — single-row read, throws NotFoundError on miss.
 *   3. lexicalSearchBlocks(query) — LIKE-based search returning LexicalSearchHit[].
 *   4. deleteBlock(id)            — cascade delete to relations table.
 *   5. listMemoryTypes()          — list helper returning MemoryType[].
 *   6. createInboxEntry(entry)    — write path for low-confidence captures.
 *   7. listConflicts()            — list helper returning Conflict[].
 *
 * @module @engram/workspace-do/__tests__/helpers
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: implementation imports resolved in Plan 02-04.
//   import { runInDurableObject } from "cloudflare:test";
//   import { env } from "cloudflare:workers";
//   import { WorkspaceDO } from "../index.js";
//   import { NotFoundError } from "../errors.js";

describe("query helpers (STO-06)", () => {
  it.skip("insertBlock writes a block + round-trips JSON properties (STO-06 — Plan 02-04)", () => {
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("getBlock(id) returns the typed Memory shape (STO-06 — Plan 02-04)", () => {
    // Also: getBlock(missing_id) throws `NotFoundError` (resource='block', id=missing_id).
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("lexicalSearchBlocks(query) returns LexicalSearchHit[] ranked by recency (STO-06 — Plan 02-04)", () => {
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("deleteBlock(id) cascades to relations.from_id and relations.to_id (STO-06 — Plan 02-04)", () => {
    // Insert block + 2 relations referencing it; deleteBlock removes the block
    // AND both relations. COUNT(*) FROM relations WHERE from_id=? OR to_id=? = 0.
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("listMemoryTypes() returns 7 system types post-seed (STO-06 — Plan 02-04)", () => {
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("createInboxEntry(entry) writes a low-confidence capture (STO-06 — Plan 02-04)", () => {
    expect.fail("not yet implemented — Plan 02-04");
  });

  it.skip("listConflicts() returns Conflict[] sorted by detected_at (STO-06 — Plan 02-04)", () => {
    expect.fail("not yet implemented — Plan 02-04");
  });
});
