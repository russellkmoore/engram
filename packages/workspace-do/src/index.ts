/**
 * `WorkspaceDO` — per-workspace Cloudflare Durable Object owning the SQLite
 * store for one Engram workspace. Re-exported from `packages/mcp-server/src/
 * index.ts` so the `{ name: "WORKSPACE", class_name: "WorkspaceDO" }` binding
 * in `packages/mcp-server/wrangler.jsonc` resolves at `wrangler dev` /
 * `wrangler deploy` time. The binding is declared under that wrangler's v1
 * `new_sqlite_classes` array — D-06 / FND-08 invariant: Phase 2 verifies this
 * but does NOT modify the wrangler config (the v2 migration adding
 * `EngramMcp` is Phase 3 territory).
 *
 * Phase 2 evolution: this file moves from the Phase 1 empty-body stub to a
 * concrete constructor that idempotently bootstraps the per-workspace SQLite
 * schema and seeds the 7 system memory types on every cold start (including
 * hibernation replays). The bootstrap runs inside
 * `ctx.blockConcurrencyWhile(async () => { ... })` so Cloudflare delays
 * request delivery until the schema is ready — the only safe place to do
 * "before the first handler runs" work per Cloudflare's documented Rules of
 * Durable Objects.
 *
 * Design notes:
 * - **`env: unknown`** (NOT a wrangler-typed env interface). PATTERNS.md §2 +
 *   02-RESEARCH.md Anti-Pattern §"Storing the wrangler env type" — pulling in
 *   `env.AI` / `env.VECTORIZE` types here would force the Phase 5 bindings
 *   to land prematurely. The DO uses NONE of `env.*` in its bootstrap; the
 *   `unknown` type makes any future attempt to do so a compile error and the
 *   STO-10 lint (scripts/lint-blockconcurrency.mjs) makes it a CI failure.
 *   The class is declared `extends DurableObject<unknown>` (NOT bare
 *   `extends DurableObject`): the base-class generic is
 *   `DurableObject<Env = Cloudflare.Env>`, so without the `<unknown>` the
 *   `super(ctx, env)` call fails strict TS with `TS2345: Argument of type
 *   'unknown' is not assignable to parameter of type 'Env'`. The `<unknown>`
 *   threads the intent (don't depend on the generated Cloudflare.Env type)
 *   through to the base class — same fix the Plan 00 fixtures applied
 *   (see 02-00-SUMMARY.md Deviation #3, where this exact issue surfaced
 *   with the same root cause).
 * - **Constructor wraps `blockConcurrencyWhile` in `void`** to discard the
 *   returned Promise. Cloudflare's documented seat-booking tutorial pattern:
 *   "fire-and-forget initialization" — the platform internally blocks request
 *   delivery on the in-flight callback, so the caller (the DO constructor)
 *   does not need to await it. Awaiting here would make the constructor
 *   itself async, which the `DurableObject` base class does not support.
 * - **Inside the `blockConcurrencyWhile` callback: synchronous work ONLY.**
 *   `runMigrations(sql)` and `seedSystemTypes(sql)` are both sync (Plan 02-01
 *   + 02-03 contracts). No `env.*` access, no `fetch(...)`, no
 *   `await this.ai`, no `await ctx.storage.transaction(...)`, no
 *   `await import(...)`. The STO-10 lint script catches any drift; the
 *   acceptance grep in this plan's `<verify>` block is the interim guard
 *   until Plan 07 wires the lint into pre-commit + CI for the full src/ tree.
 * - **Re-exports.** `NotFoundError` is re-exported from `./errors.js` so
 *   downstream callers can do `import { WorkspaceDO, NotFoundError } from
 *   "@engram/workspace-do"` once Plan 02-05's typed query helpers land. The
 *   `./types.js` barrel re-export is deferred to Plan 02-05 (creates it).
 *
 * Plan boundaries:
 * - This file (Plan 02-04): constructor body + STO-09 hibernation
 *   integration.
 * - Plan 02-05: typed query helpers (insert/get/lexical search/delete/list/
 *   inbox/conflicts) as methods on this class + the `./types.ts` module.
 * - Plan 02-06: `assertOwnsWorkspace(workspaceId)` defense-in-depth helper.
 *   The `import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/
 *   types.js"` lands then, not here.
 *
 * @module @engram/workspace-do
 */
import { DurableObject } from "cloudflare:workers";

import type { Memory, Conflict } from "@engram/types";

import { runMigrations } from "./migrations.js";
import { seedSystemTypes } from "./seeding.js";
import {
  insertBlock as insertBlockQuery,
  getBlock as getBlockQuery,
  lexicalSearchBlocks as lexicalSearchBlocksQuery,
  deleteBlock as deleteBlockQuery,
  listMemoryTypes as listMemoryTypesQuery,
  createInboxEntry as createInboxEntryQuery,
  listConflicts as listConflictsQuery,
} from "./queries.js";
import type { MemoryType, InboxEntry, LexicalSearchHit } from "./types.js";

// Plan 02-05 lands the typed query helpers (./queries.js + ./types.js +
// ./errors.js) and exposes them as instance methods on WorkspaceDO. The
// re-exports below give consumers a single barrel for the public surface:
// `import { WorkspaceDO, NotFoundError, type Memory, type Conflict,
// type MemoryType, type InboxEntry, type LexicalSearchHit } from
// "@engram/workspace-do"`.
export { NotFoundError } from "./errors.js";
export type { MemoryType, InboxEntry, LexicalSearchHit } from "./types.js";

export class WorkspaceDO extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // STO-02 + STO-05 + STO-09: schema migration + system-type seeding runs
    // idempotently on every cold start. The block is sync-only — STO-10 lint
    // (scripts/lint-blockconcurrency.mjs, Plan 07) statically prevents env.*,
    // fetch(), or await this.ai from being added here.
    /* eslint-disable @typescript-eslint/require-await -- The blockConcurrencyWhile
       contract REQUIRES an async callback (its type is `() => Promise<T>`), but
       this body is intentionally synchronous: `runMigrations` and
       `seedSystemTypes` are both sync (Plan 02-01 + 02-03 contracts), and STO-10
       forbids any `await` inside the bootstrap block. The disable spans only
       this single fire-and-forget call. */
    void ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql);
      seedSystemTypes(ctx.storage.sql);
    });
    /* eslint-enable @typescript-eslint/require-await */
  }

  // -------------------------------------------------------------------------
  // STO-06 typed query helpers (Plan 02-05) exposed as instance methods.
  //
  // Every method takes its first arg as an object whose first field is
  // `workspace_id: string`. The uniform shape is the contract Plan 02-06
  // depends on — its guard wiring will prepend
  // `this.assertOwnsWorkspace(args.workspace_id)` as the first executable
  // line of every method below. The `// TODO Plan 06` markers are the
  // explicit insertion points.
  //
  // Method bodies delegate to the corresponding `./queries.js` function
  // (renamed on import to avoid shadowing). The methods themselves do not
  // touch SQL directly — keeping the data-plane logic in `queries.ts` and
  // the authorization/orchestration logic here.
  // -------------------------------------------------------------------------

  insertBlock(args: { workspace_id: string; block: Memory }): void {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    insertBlockQuery(this.ctx.storage.sql, args.block);
  }

  getBlock(args: { workspace_id: string; id: string }): Memory {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    return getBlockQuery(this.ctx.storage.sql, args.id);
  }

  // prettier-ignore -- keep `args: { workspace_id: string` on the signature line so Plan 06's grep verifier matches all 7 methods uniformly.
  lexicalSearchBlocks(args: {
    workspace_id: string;
    query: string;
    limit?: number;
  }): LexicalSearchHit[] {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    return lexicalSearchBlocksQuery(this.ctx.storage.sql, args.query, args.limit);
  }

  deleteBlock(args: { workspace_id: string; id: string; cascade?: boolean }): {
    blocks_deleted: number;
    relations_deleted: number;
  } {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    return deleteBlockQuery(this.ctx.storage.sql, args.id, args.cascade ?? true);
  }

  listMemoryTypes(args: { workspace_id: string }): MemoryType[] {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    void args;
    return listMemoryTypesQuery(this.ctx.storage.sql);
  }

  createInboxEntry(args: { workspace_id: string; entry: InboxEntry }): void {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    createInboxEntryQuery(this.ctx.storage.sql, args.entry);
  }

  // prettier-ignore -- keep `args: { workspace_id: string` on the signature line so Plan 06's grep verifier matches all 7 methods uniformly.
  listConflicts(args: { workspace_id: string; resolved?: boolean; limit?: number }): Conflict[] {
    // TODO Plan 06: this.assertOwnsWorkspace(args.workspace_id);
    // Build opts conditionally so we only pass defined keys — strict
    // exactOptionalPropertyTypes forbids `{ key: undefined }` literals.
    const opts: { resolved?: boolean; limit?: number } = {};
    if (args.resolved !== undefined) opts.resolved = args.resolved;
    if (args.limit !== undefined) opts.limit = args.limit;
    return listConflictsQuery(this.ctx.storage.sql, opts);
  }

  // Plan 02-06 adds the `assertOwnsWorkspace(workspaceId)` defense-in-depth
  // helper. Each method above will prepend a call to it as the first
  // executable line.
}
