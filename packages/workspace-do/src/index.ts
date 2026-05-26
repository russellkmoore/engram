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

import { runMigrations } from "./migrations.js";
import { seedSystemTypes } from "./seeding.js";

// Re-export the NotFoundError class from the package barrel so consumers can
// `import { WorkspaceDO, NotFoundError } from "@engram/workspace-do"` once
// Plan 02-05's typed query helpers (which throw it on single-row miss per
// D-02) land. The errors.ts module itself is created by Plan 02-05; this
// re-export is forward-staged here so the barrel surface is stable across
// the Plan 02-05 transition.
// NOTE (Plan 02-04): the `./errors.js` module does not yet exist; Plan 02-05
// will create it AND uncomment this re-export. Keeping it commented for now
// keeps the package barrel typecheck-clean.
// export { NotFoundError } from "./errors.js";

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
  // Plan 02-05 adds the typed query helpers as instance methods on this class
  // (insertBlock, getBlock, lexicalSearchBlocks, deleteBlock, listMemoryTypes,
  // createInboxEntry, listConflicts).
  // Plan 02-06 adds the `assertOwnsWorkspace(workspaceId)` defense-in-depth
  // helper that every public method calls first.
}
