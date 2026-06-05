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
 * - Plan 02-04: constructor body + STO-09 hibernation integration.
 * - Plan 02-05: typed query helpers (insert/get/lexical search/delete/list/
 *   inbox/conflicts) as methods on this class + the `./types.ts` module.
 * - Plan 02-06: `assertOwnsWorkspace(workspaceId)` defense-in-depth helper
 *   PLUS the `import { McpError, ErrorCode } from
 *   "@modelcontextprotocol/sdk/types.js"` at the top of this file and the
 *   guard call wired as the first executable line of every public method.
 *
 * @module @engram/workspace-do
 */
import { DurableObject } from "cloudflare:workers";

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { EMBEDDING_MODEL } from "@engram/ai-config";

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
  stampEmbedding as stampEmbeddingQuery,
  getBlocksByIds as getBlocksByIdsQuery,
  updateBlockEnrichment as updateBlockEnrichmentQuery,
  moveToInbox as moveToInboxQuery,
  moveToColdStorage as moveToColdStorageQuery,
  markIngestFailed as markIngestFailedQuery,
  countStaleEmbeddings as countStaleEmbeddingsQuery,
  deleteStaleEmbeddings as deleteStaleEmbeddingsQuery,
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

  /**
   * STO-07 defense-in-depth: every public method on `WorkspaceDO` MUST call
   * this as its first executable line. Throws `McpError(InvalidRequest =
   * -32600)` when the args' claimed `workspace_id` does not match this DO's
   * bound `id.name`.
   *
   * Cloudflare DurableObjectId guarantees (per Cloudflare Id API docs, summarized
   * in 02-PATTERNS.md §C and 02-RESEARCH.md §C):
   *   - `env.WORKSPACE.idFromName(name).name === name`         → MCP-server path (Phase 3)
   *   - `env.WORKSPACE.idFromString(hex).name === undefined`   → raw-hex attack path
   *   - `env.WORKSPACE.newUniqueId().name === undefined`       → newly-allocated path
   *
   * Either of the latter two causes the check to throw (undefined !== any
   * provided workspace_id string). A JWT-derived workspace_id that doesn't
   * match the legitimate DO also throws. This is the data-plane backstop
   * that complements the Worker-layer JWT check in Phase 3 (MT-1 mitigation
   * pair with Phase 4's TOL-07 penetration test).
   *
   * Uses `this.ctx.id.name` (NOT `this.state.id.name`) — both are equivalent
   * on the modern DurableObject base class (PATTERNS.md §C), but `ctx`
   * matches the Phase 1 convention already adopted.
   *
   * @param workspaceId the claimed workspace id from the request args
   * @throws McpError(ErrorCode.InvalidRequest) on mismatch — Phase 3 tool
   *   handlers must surface this directly to the client.
   */
  private assertOwnsWorkspace(workspaceId: string): void {
    if (this.ctx.id.name !== workspaceId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Workspace mismatch: DO bound to '${this.ctx.id.name ?? "<unnamed>"}' but request claims '${workspaceId}'`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // STO-06 typed query helpers (Plan 02-05) exposed as instance methods.
  //
  // Every method takes its first arg as an object whose first field is
  // `workspace_id: string`. The uniform shape is the contract Plan 02-06
  // wired through: every method's first executable line is the
  // `assertOwnsWorkspace` guard call (defined above) — Plan 02-05 left a
  // single-line slot per method for Plan 02-06 to fill.
  //
  // Method bodies delegate to the corresponding `./queries.js` function
  // (renamed on import to avoid shadowing). The methods themselves do not
  // touch SQL directly — keeping the data-plane logic in `queries.ts` and
  // the authorization/orchestration logic here.
  // -------------------------------------------------------------------------

  insertBlock(args: { workspace_id: string; block: Memory }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    insertBlockQuery(this.ctx.storage.sql, args.block);
  }

  getBlock(args: { workspace_id: string; id: string }): Memory {
    this.assertOwnsWorkspace(args.workspace_id);
    return getBlockQuery(this.ctx.storage.sql, args.id);
  }

  // prettier-ignore
  lexicalSearchBlocks(args: { workspace_id: string; query: string; limit?: number }): LexicalSearchHit[] {
    this.assertOwnsWorkspace(args.workspace_id);
    return lexicalSearchBlocksQuery(this.ctx.storage.sql, args.query, args.limit);
  }

  deleteBlock(args: { workspace_id: string; id: string; cascade?: boolean }): {
    blocks_deleted: number;
    relations_deleted: number;
  } {
    this.assertOwnsWorkspace(args.workspace_id);
    return deleteBlockQuery(this.ctx.storage.sql, args.id, args.cascade ?? true);
  }

  listMemoryTypes(args: { workspace_id: string }): MemoryType[] {
    this.assertOwnsWorkspace(args.workspace_id);
    return listMemoryTypesQuery(this.ctx.storage.sql);
  }

  createInboxEntry(args: { workspace_id: string; entry: InboxEntry }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    createInboxEntryQuery(this.ctx.storage.sql, args.entry);
  }

  // prettier-ignore -- keep `args: { workspace_id: string` on the signature line so Plan 06's grep verifier matches all 7 methods uniformly.
  listConflicts(args: { workspace_id: string; resolved?: boolean; limit?: number }): Conflict[] {
    this.assertOwnsWorkspace(args.workspace_id);
    // Build opts conditionally so we only pass defined keys — strict
    // exactOptionalPropertyTypes forbids `{ key: undefined }` literals.
    const opts: { resolved?: boolean; limit?: number } = {};
    if (args.resolved !== undefined) opts.resolved = args.resolved;
    if (args.limit !== undefined) opts.limit = args.limit;
    return listConflictsQuery(this.ctx.storage.sql, opts);
  }

  // -------------------------------------------------------------------------
  // Phase 5 (Plan 05-01) RPC methods — AI pipeline integration
  //
  // Each calls assertOwnsWorkspace as the FIRST EXECUTABLE LINE (STO-07 /
  // T-05-01-STO07). Delegates to the corresponding typed helper in queries.ts.
  // -------------------------------------------------------------------------

  /**
   * Records `embedding_model` + `embedding_version` on a block after Vectorize
   * upsert completes. The block must exist; throws NotFoundError on miss.
   *
   * @requirement AI-03
   */
  stampEmbedding(args: {
    workspace_id: string;
    block_id: string;
    embedding_model: string;
    embedding_version: number;
  }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    stampEmbeddingQuery(this.ctx.storage.sql, {
      block_id: args.block_id,
      embedding_model: args.embedding_model,
      embedding_version: args.embedding_version,
    });
  }

  /**
   * Returns the `Memory[]` for the given ids, EXCLUDING cold-storage rows
   * (`cold_storage = 0` filter). Returns `[]` when `ids` is empty.
   *
   * @requirement AI-04
   */
  getBlocksByIds(args: { workspace_id: string; ids: string[] }): Memory[] {
    this.assertOwnsWorkspace(args.workspace_id);
    return getBlocksByIdsQuery(this.ctx.storage.sql, args.ids);
  }

  /**
   * Overwrites `properties`, `summary`, `confidence`, and (ENG-8) optionally
   * `type` on an existing block with AI-enriched values from the Triage Worker.
   * Throws NotFoundError on miss.
   *
   * ENG-8: `type` is optional and applied via COALESCE in the underlying SQL
   * — user-asserted `type` at remember() time wins; classifier fills nulls.
   *
   * @requirement AI-05
   */
  updateBlockEnrichment(args: {
    workspace_id: string;
    block_id: string;
    properties: Record<string, unknown>;
    summary: string;
    confidence: number;
    /** ENG-8: classifier's resolved memory type. COALESCE'd into blocks.type. */
    type?: string;
  }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    updateBlockEnrichmentQuery(this.ctx.storage.sql, {
      block_id: args.block_id,
      properties: args.properties,
      summary: args.summary,
      confidence: args.confidence,
      ...(args.type !== undefined && { type: args.type }),
    });
  }

  /**
   * Stages a low-confidence block (memorability 0.4–0.8) in the inbox table
   * for human review. Delegates to createInboxEntry helper.
   *
   * @requirement AI-06
   */
  moveToInbox(args: {
    workspace_id: string;
    block_id: string;
    entry: {
      content: string;
      proposed_type: string;
      proposed_properties: Record<string, unknown>;
      memorability_score: number;
      source: string;
    };
  }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    moveToInboxQuery(this.ctx.storage.sql, { block_id: args.block_id, entry: args.entry });
  }

  /**
   * Routes a low-memorability block (< 0.4) to cold-storage by setting
   * `cold_storage = 1`. CARDINAL-SIN CLAUSE: cold-storage is NOT discard —
   * the block remains in SQLite, excluded from default recall + Vectorize.
   * v0.2's `include_cold` flag will surface these rows.
   * Throws NotFoundError if the block does not exist.
   *
   * @requirement AI-06 (D-07 cold-storage routing)
   */
  moveToColdStorage(args: {
    workspace_id: string;
    block_id: string;
    properties?: Record<string, unknown>;
    summary?: string;
    confidence?: number;
    memorability: number;
  }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    // Build opts conditionally so only defined keys are passed — strict
    // exactOptionalPropertyTypes forbids `{ key: undefined }` literals (same
    // pattern as listConflicts above). Phase 6 06-03 Rule 3 fix: the prior
    // shape (`properties: args.properties, ...`) tripped TS2379 under strict
    // exactOptionalPropertyTypes because Record<string, unknown> | undefined
    // is not assignable to the helper's optional `properties?: Record<string,
    // unknown>` parameter.
    const opts: {
      block_id: string;
      properties?: Record<string, unknown>;
      summary?: string;
      confidence?: number;
      memorability: number;
    } = { block_id: args.block_id, memorability: args.memorability };
    if (args.properties !== undefined) opts.properties = args.properties;
    if (args.summary !== undefined) opts.summary = args.summary;
    if (args.confidence !== undefined) opts.confidence = args.confidence;
    moveToColdStorageQuery(this.ctx.storage.sql, opts);
  }

  /**
   * Marks a block as permanently failed enrichment (PIP-05). Called by the
   * Triage Worker after retry budget exhausts — Zod parse fail attempts >= 2,
   * non-retryable Workers AI errors, or DO-RPC failure after Queue retry
   * budget. Writes `ingest_status = 'failed'` and overwrites properties with
   * `{error: reason, failed_at: <ms>}` for observability surfaced by the v0.2
   * inbox UI "broken memories" view. Throws NotFoundError if the block does
   * not exist (the Triage Worker catches this and falls through to
   * `message.ack()` so the Queue does not infinite-retry — see Phase 6
   * CONTEXT.md §"Claude's Discretion → Idempotency on duplicate Queue delivery").
   *
   * STO-07: assertOwnsWorkspace is the FIRST EXECUTABLE LINE — the Triage
   * Worker passes `event.workspace_id` from the Queue message body, which
   * was populated by the mcp-server producer from `props.workspace_id`
   * (defense-in-depth pair with the JWT validation at the Worker layer).
   *
   * @requirement PIP-05 / D-03
   */
  markIngestFailed(args: { workspace_id: string; block_id: string; reason: string }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    markIngestFailedQuery(this.ctx.storage.sql, {
      block_id: args.block_id,
      reason: args.reason,
    });
  }

  // admin-only: not registered as an MCP tool (PRE-01)
  /**
   * `assertAllBlocksAtV2` returns a count of blocks whose embedding stamp
   * predates the ENG-25 qwen3 cutover (NULL stamp OR embedding_version < 2
   * OR embedding_model != EMBEDDING_MODEL). A non-zero count means the
   * workspace has rows whose Vectorize vectors live in a different embedding
   * space than the current index — silent recall corruption.
   *
   * This is the user-facing variant — requires the caller to supply the
   * workspace_id, which is asserted against `ctx.id.name`. Useful when the
   * caller already knows which workspace it's checking.
   *
   * Admin enumeration callers (audit script via the Worker admin endpoint)
   * use {@link auditEmbeddingsByDoId} instead, because Cloudflare's DO
   * Namespace List API only exposes internal hex IDs — not workspace names.
   *
   * STO-07: assertOwnsWorkspace is the FIRST EXECUTABLE LINE (same discipline
   * as markIngestFailed at lines above and every other public method on this
   * class). Defense-in-depth pair with T-01-01 threat register.
   *
   * @requirement PRE-01 (v0.2)
   */
  assertAllBlocksAtV2(args: { workspace_id: string }): {
    workspace_id: string;
    count_stale: number;
  } {
    this.assertOwnsWorkspace(args.workspace_id);
    const count = countStaleEmbeddingsQuery(this.ctx.storage.sql, EMBEDDING_MODEL);
    return { workspace_id: args.workspace_id, count_stale: count };
  }

  // admin-only: not registered as an MCP tool (PRE-01)
  /**
   * Admin-enumeration variant of the PRE-01 embedding-version audit. Returns
   * the same `count_stale` signal as {@link assertAllBlocksAtV2}, but with
   * no `assertOwnsWorkspace` guard because the caller (the cross-workspace
   * audit script via the Worker admin endpoint) only has the internal hex
   * DO id from Cloudflare's `GET /accounts/{acct}/workers/durable_objects/
   * namespaces/{ns}/objects` API. That API never returns the original
   * `idFromName()` argument — there is no way to recover the workspace_id
   * from the hex, so an `assertOwnsWorkspace` check is impossible by design.
   *
   * Auth model: the admin endpoint that fronts this RPC is gated by the
   * `ENGRAM_ADMIN_AUDIT_TOKEN` Workers secret (CWE-208 constant-time check),
   * and the namespace enumeration that feeds it requires a
   * `CLOUDFLARE_API_TOKEN`. The defense-in-depth here is at the Worker
   * layer, not the DO layer.
   *
   * `ctx.id.name` is best-effort: it is populated when the DO was originally
   * accessed via `idFromName(workspace_id)` and stayed warm; it is `null`
   * when reconstructed from a hex string via `idFromString(hex)` cold.
   * Either way, `ctx.id.toString()` is the stable identifier and is what the
   * audit script logs and aggregates over.
   *
   * @requirement PRE-01 (v0.2)
   */
  auditEmbeddingsByDoId(): {
    do_id: string;
    workspace_name: string | null;
    count_stale: number;
  } {
    const count = countStaleEmbeddingsQuery(this.ctx.storage.sql, EMBEDDING_MODEL);
    return {
      do_id: this.ctx.id.toString(),
      workspace_name: this.ctx.id.name ?? null,
      count_stale: count,
    };
  }

  // admin-only one-shot remediation: not registered as an MCP tool (PRE-01)
  /**
   * Delete every block whose embedding stamp predates the v0.2 qwen3 cutover.
   * Same three-arm NULL-trap as {@link auditEmbeddingsByDoId} — anything that
   * `count_stale` would have counted is what `deleted` removes.
   *
   * Companion to {@link auditEmbeddingsByDoId} for the enumeration path.
   * No `assertOwnsWorkspace` for the same reason: the caller (an admin
   * sweep over hex DO ids from the namespace list API) cannot know the
   * original workspace_id. The auth boundary is the admin token + namespace
   * ID at the Worker layer.
   *
   * This is intentionally destructive — deleted rows are gone. Use case is
   * one-time cleanup of pre-v0.2 stale data flagged by the PRE-01 audit
   * gate. Going forward, the gate itself prevents new stale data from
   * accumulating; this method is the remediation tool for what was already
   * there at the time the gate was wired up.
   *
   * Vectorize vectors for the deleted blocks are NOT removed by this RPC
   * (recall already JOINs against `blocks`, so orphan vectors can't surface
   * to a client). A future GC pass can sweep them.
   *
   * @requirement PRE-01 (v0.2)
   */
  deleteStaleEmbeddingsAdmin(): {
    do_id: string;
    workspace_name: string | null;
    deleted: number;
  } {
    const deleted = deleteStaleEmbeddingsQuery(this.ctx.storage.sql, EMBEDDING_MODEL);
    return {
      do_id: this.ctx.id.toString(),
      workspace_name: this.ctx.id.name ?? null,
      deleted,
    };
  }
}
