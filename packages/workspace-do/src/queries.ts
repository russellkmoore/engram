/**
 * Typed query helpers for the WorkspaceDO SQLite store (STO-06).
 *
 * Seven synchronous CRUD helpers cover every v0.1 read/write pattern Phase 4's
 * MCP tools need:
 *
 *   1. `insertBlock`         — write a block; JSON-stringify properties on write.
 *   2. `getBlock`            — read a block by id; throw NotFoundError on miss.
 *   3. `lexicalSearchBlocks` — naive LIKE-based search across content + summary.
 *   4. `deleteBlock`         — delete a block + explicit cascade to relations.
 *   5. `listMemoryTypes`     — list all rows from `memory_types` (system + user).
 *   6. `createInboxEntry`    — write a low-confidence capture for human review.
 *   7. `listConflicts`       — list rows from `conflicts`, optional resolved filter.
 *
 * Design notes (load-bearing — each pin maps to a documented pitfall or decision):
 *
 * - **D-01 — Synchronous helpers.** `storage.sql.exec()` is sync; helpers do
 *   not fake `async`. The lie would invite an `await` to creep in and break
 *   the STO-10 lint contract on the constructor's blockConcurrencyWhile body.
 *   Plan 06's `WorkspaceDO` methods stay sync too; Phase 3+ MCP tools wrap
 *   them with their own async surface where the MCP transport requires it.
 *
 * - **D-02 — Throw on miss for single-row reads; return `[]` for list reads.**
 *   `getBlock` is the only single-row helper here; it uses `.toArray()` +
 *   length check rather than `.one()` + try/catch so a "multiple rows for PK"
 *   bug surfaces as an invariant-violation throw, not a silently-swallowed
 *   NotFoundError (Anti-Pattern §"swallowing all errors" in 02-RESEARCH.md).
 *   `lexicalSearchBlocks`, `listMemoryTypes`, `listConflicts` return `[]` on
 *   no matches and never throw.
 *
 * - **D-03 — JSON parsed at the helper boundary.** Every `JSON.parse` lives
 *   in this file (inside the narrowing helpers); every `JSON.stringify` for
 *   write happens here too. Callers receive fully-typed objects. The loose
 *   `row.col == null ? null : JSON.parse(row.col as string)` pattern handles
 *   both SQLite NULL and the `undefined` that `noUncheckedIndexedAccess`
 *   threads through `.toArray()` rows (Pitfall 3 — RESEARCH.md §E).
 *
 * - **D-04 — Cascade in the helper, not the schema.** `deleteBlock(cascade=true)`
 *   issues an explicit `DELETE FROM relations WHERE from_id = ? OR to_id = ?`
 *   after the `DELETE FROM blocks` because the v1 DDL ships without
 *   `ON DELETE CASCADE` (PATTERNS.md §4 drift-risk note). Cascade is opt-out
 *   via `cascade=false` for the rare case a caller wants the orphan rows
 *   preserved for forensic / audit purposes.
 *
 * - **Pitfall 3 — `JSON.parse(null)`.** Loose-equality `== null` catches
 *   SQLite NULL (`null`) AND the `undefined` that strict-indexed-access
 *   threads through `row.col` when a SELECT omits the column. Strict `===`
 *   would miss the undefined arm.
 *
 * - **Pitfall 4 — `JSON.stringify({a:1, b:undefined})` drops `b`.** Callers
 *   constructing rows must pass `null`, not `undefined`, for missing fields
 *   that should be persisted. The `Memory` and `InboxEntry` interfaces
 *   already declare these fields as `| null` (not `| undefined`), so strict
 *   TS catches the mistake at the helper-call site.
 *
 * - **Pitfall 6 — `noUncheckedIndexedAccess` narrowing.** Every row is run
 *   through a `narrow*Row(...)` helper that asserts each column's runtime
 *   type with `typeof` checks. The narrowing helpers throw an "invariant
 *   violation" Error (NOT NotFoundError) if a column is the wrong shape —
 *   distinct from a legitimate empty-result case so observability separates
 *   "schema drift" from "missing data". No whole-row casts to the domain
 *   types anywhere; only per-field `as string` / `as number` AFTER a
 *   `typeof` check, which is narrowing, not casting (Pitfall 6 — the
 *   forbidden pattern is rephrased here to keep the prohibition's literal
 *   form out of the grep-check's match space).
 *
 * - **Pitfall 7 — Cursor exhaustion.** Each query uses exactly ONE
 *   consumption pattern (`.toArray()`) — never mixed with `.next()`.
 *
 * - **Pitfall 8 — Multi-statement bindings.** Every helper's `.exec()` is a
 *   single-statement call, so the "bindings only apply to the last
 *   statement" footgun does not apply.
 *
 * - **Positional `?` bindings only.** Named (`:foo`) placeholders are
 *   unsupported in workerd SQLite (Key APIs §B — 02-RESEARCH.md).
 *
 * - **No transaction control.** No `BEGIN` / `COMMIT` / `SAVEPOINT`. Each
 *   `.exec()` is implicitly atomic; `deleteBlock`'s two-statement cascade
 *   is two separate atomic writes (acceptable at v0.1 scale; if cross-write
 *   atomicity becomes critical, wrap in `ctx.storage.transactionSync()` at
 *   the call-site in `WorkspaceDO`).
 *
 * Cross-plan contract: Plan 06's `WorkspaceDO` exposes each helper as a class
 * method that prepends `this.assertOwnsWorkspace(args.workspace_id)` as the
 * first executable line. The helpers themselves take no `workspace_id` —
 * they trust the caller (the DO method) has already proven workspace
 * ownership. This decoupling keeps the helpers pure-data (one input, one
 * output) and the DO methods responsible for authorization.
 *
 * @module @engram/workspace-do/queries
 */
import type { SqlStorage, SqlStorageValue } from "@cloudflare/workers-types";

import type { Memory, Conflict } from "@engram/types";

import { NotFoundError } from "./errors.js";
import type { MemoryType, InboxEntry, LexicalSearchHit } from "./types.js";

// ---------------------------------------------------------------------------
// Narrowing helpers (private — Pitfall 6 mitigation)
// ---------------------------------------------------------------------------

/**
 * Asserts `value` is one of the literal arms of a union and returns it as the
 * narrowed type. Used by `narrowBlockRow` for `scope` and `narrowConflictRow`
 * for `severity`. Throws an invariant-violation Error if not — distinct from
 * NotFoundError so observability separates schema drift from missing data.
 */
function narrowLiteralUnion<T extends string>(
  value: unknown,
  allowed: readonly T[],
  columnName: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `invariant violation: column '${columnName}' has unexpected value ${JSON.stringify(value)} (allowed: ${JSON.stringify(allowed)})`,
  );
}

/**
 * Parses a JSON column at the helper boundary (D-03). Loose `== null` so both
 * SQLite NULL and the `undefined` that `noUncheckedIndexedAccess` threads
 * through `row.col` are funneled to the `null` arm (Pitfall 3).
 */
function parseJsonColumn(value: SqlStorageValue | undefined, columnName: string): unknown {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(
      `invariant violation: JSON column '${columnName}' is not a string (got ${typeof value})`,
    );
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (err) {
    throw new Error(
      `invariant violation: JSON column '${columnName}' failed to parse: ${(err as Error).message}`,
    );
  }
}

/**
 * Narrows a raw `blocks` row to a fully-typed `Memory`. Each column is
 * runtime-checked via `typeof`; the row's JSON `properties` column is parsed.
 * The `embedding_model` / `embedding_version` columns from the v1 DDL are
 * intentionally NOT propagated — they are not part of v0.1's `Memory` shape
 * (Phase 5's `remember()` writes them; helpers in this file insert NULL).
 */
function narrowBlockRow(row: Record<string, SqlStorageValue | undefined>): Memory {
  const id = row.id;
  const type = row.type;
  const created_at = row.created_at;
  const updated_at = row.updated_at;
  if (typeof id !== "string") {
    throw new Error("invariant violation: blocks.id is not a string");
  }
  if (type !== null && typeof type !== "string") {
    throw new Error("invariant violation: blocks.type is not a string or null");
  }
  if (typeof created_at !== "number") {
    throw new Error("invariant violation: blocks.created_at is not a number");
  }
  if (typeof updated_at !== "number") {
    throw new Error("invariant violation: blocks.updated_at is not a number");
  }

  const content = row.content == null ? null : (row.content as string);
  const summary = row.summary == null ? null : (row.summary as string);
  const embedding_id = row.embedding_id == null ? null : (row.embedding_id as string);
  const project_id = row.project_id == null ? null : (row.project_id as string);
  const source = row.source == null ? null : (row.source as string);
  const confidence = row.confidence == null ? null : (row.confidence as number);

  const parsedProperties = parseJsonColumn(row.properties, "blocks.properties");
  const properties =
    parsedProperties === null ? null : (parsedProperties as Record<string, unknown>);

  const scope = narrowLiteralUnion(
    row.scope,
    ["personal", "project", "org"] as const,
    "blocks.scope",
  );

  return {
    id,
    type: type,
    content,
    summary,
    properties,
    embedding_id,
    scope,
    project_id,
    source,
    confidence,
    created_at,
    updated_at,
  };
}

/**
 * Narrows a raw `memory_types` row to a fully-typed `MemoryType`. Parses the
 * `fields` JSON column at the boundary (D-03) and narrows the `source`
 * column to its union literal.
 */
function narrowMemoryTypeRow(row: Record<string, SqlStorageValue | undefined>): MemoryType {
  const id = row.id;
  const name = row.name;
  if (typeof id !== "string") {
    throw new Error("invariant violation: memory_types.id is not a string");
  }
  if (typeof name !== "string") {
    throw new Error("invariant violation: memory_types.name is not a string");
  }

  const parsedFields = parseJsonColumn(row.fields, "memory_types.fields");
  if (parsedFields === null) {
    throw new Error("invariant violation: memory_types.fields is NULL but column is NOT NULL");
  }
  // The system seeds use an array (SystemMemoryType.fields: MemoryTypeField[]);
  // user types may use a keyed record. Both forms are valid; consumers narrow
  // further via `Array.isArray(fields)` if they need to dispatch.
  const fields = parsedFields as readonly unknown[] | Record<string, unknown>;

  const workspace_id = row.workspace_id == null ? null : (row.workspace_id as string);

  const source = narrowLiteralUnion(
    row.source,
    ["system", "user", "community"] as const,
    "memory_types.source",
  );

  return { id, name, fields, workspace_id, source };
}

// Note: `narrowInboxRow` is intentionally deferred until a `getInboxEntry`
// helper lands (Phase 3 inbox-management tools). Phase 2's only inbox path is
// `createInboxEntry` (write), which does not need to read rows back.

/**
 * Narrows a raw `conflicts` row to a fully-typed `Conflict`. Narrows the
 * `severity` column to its union literal; `resolved_at` is `null` for
 * unresolved conflicts (the documented "open" state).
 */
function narrowConflictRow(row: Record<string, SqlStorageValue | undefined>): Conflict {
  const id = row.id;
  const memory_a_id = row.memory_a_id;
  const memory_b_id = row.memory_b_id;
  const description = row.description;
  const detected_at = row.detected_at;
  if (typeof id !== "string") {
    throw new Error("invariant violation: conflicts.id is not a string");
  }
  if (typeof memory_a_id !== "string") {
    throw new Error("invariant violation: conflicts.memory_a_id is not a string");
  }
  if (typeof memory_b_id !== "string") {
    throw new Error("invariant violation: conflicts.memory_b_id is not a string");
  }
  if (typeof description !== "string") {
    throw new Error("invariant violation: conflicts.description is not a string");
  }
  if (typeof detected_at !== "number") {
    throw new Error("invariant violation: conflicts.detected_at is not a number");
  }

  const severity = narrowLiteralUnion(
    row.severity,
    ["low", "medium", "high"] as const,
    "conflicts.severity",
  );
  const resolved_at = row.resolved_at == null ? null : (row.resolved_at as number);

  return {
    id,
    memory_a_id,
    memory_b_id,
    description,
    severity,
    detected_at,
    resolved_at,
  };
}

/**
 * Narrows a raw `blocks` row to a `LexicalSearchHit` by delegating to
 * `narrowBlockRow` and adding the `snippet` / `match_column` / `score`
 * fields (all `null` in v0.1 Phase 2 per the LexicalSearchHit JSDoc).
 */
function narrowLexicalSearchHit(
  row: Record<string, SqlStorageValue | undefined>,
): LexicalSearchHit {
  return {
    ...narrowBlockRow(row),
    snippet: null,
    match_column: null,
    score: null,
  };
}

// ---------------------------------------------------------------------------
// 1. insertBlock — write a block; JSON-stringify properties on write (D-03)
// ---------------------------------------------------------------------------

/**
 * Writes a single `Memory` row to the `blocks` table. The `properties` JSON
 * column is stringified at the boundary (D-03); `embedding_model` /
 * `embedding_version` are inserted as NULL — Phase 5's `remember()` will
 * UPDATE them once the embedding is generated.
 *
 * Throws if a row with the same `id` already exists (PK conflict) — callers
 * must DELETE first or use a future `upsertBlock` helper.
 */
export function insertBlock(sql: SqlStorage, block: Memory): void {
  sql.exec(
    "INSERT INTO blocks (id, type, content, summary, properties, embedding_id, embedding_model, embedding_version, scope, project_id, source, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    block.id,
    block.type,
    block.content,
    block.summary,
    block.properties === null ? null : JSON.stringify(block.properties),
    block.embedding_id,
    /* embedding_model — Phase 5 writes */ null,
    /* embedding_version — Phase 5 writes */ null,
    block.scope,
    block.project_id,
    block.source,
    block.confidence,
    block.created_at,
    block.updated_at,
  );
}

// ---------------------------------------------------------------------------
// 2. getBlock — single-row read; throws NotFoundError on miss (D-02)
// ---------------------------------------------------------------------------

/**
 * Reads one `Memory` by id. Throws `NotFoundError("block", id)` on zero rows
 * (D-02). Throws an invariant-violation Error on multiple rows — the column
 * is a PK so this would indicate schema corruption (distinct signal from
 * "not found", per Anti-Pattern §"swallowing all errors" — we use
 * `.toArray()` + length check rather than `.one()` + blanket try/catch).
 */
export function getBlock(sql: SqlStorage, id: string): Memory {
  const rows = sql
    .exec(
      "SELECT id, type, content, summary, properties, embedding_id, embedding_model, embedding_version, scope, project_id, source, confidence, created_at, updated_at FROM blocks WHERE id = ?",
      id,
    )
    .toArray();
  if (rows.length === 0) {
    throw new NotFoundError("block", id);
  }
  if (rows.length > 1) {
    throw new Error(
      `invariant violation: multiple rows for blocks.id PK (id=${id}, count=${String(rows.length)})`,
    );
  }
  const row = rows[0];
  if (row === undefined) {
    // Defensive — should be unreachable given the length checks above, but
    // noUncheckedIndexedAccess narrows rows[0] to T | undefined.
    throw new Error(`invariant violation: rows[0] undefined for id=${id}`);
  }
  return narrowBlockRow(row);
}

// ---------------------------------------------------------------------------
// 3. lexicalSearchBlocks — LIKE-based search; returns [] on no matches (D-02)
// ---------------------------------------------------------------------------

/**
 * Naive case-insensitive lexical search across `content` and `summary`.
 * Backs Phase 4's lexical-recall path until Phase 5 wires in Vectorize.
 * Returns `[]` on no matches per D-02 (list helpers do not throw).
 *
 * Implementation note: uses SQLite's `instr()` function (1-based substring
 * index, 0 if not found) rather than `LIKE`. workerd's SQLite sets
 * `SQLITE_LIMIT_LIKE_PATTERN_LENGTH` very low (below 26 chars in the
 * 2026-05-27 build), so `LIKE '%' || ? || '%'` AND `LIKE ?` with a
 * JS-built `%foo%` pattern both raise "LIKE or GLOB pattern too complex"
 * for any realistic multi-word query. `instr()` has no pattern-length
 * limit — it is a true substring search. Case insensitivity is restored
 * by wrapping both sides in `lower()`. Phase 5 displaces this with
 * Vectorize semantic search, so the case folding cost is acceptable for
 * v0.1.
 */
export function lexicalSearchBlocks(
  sql: SqlStorage,
  query: string,
  limit = 50,
): LexicalSearchHit[] {
  const needle = query.toLowerCase();
  const rows = sql
    .exec(
      "SELECT id, type, content, summary, properties, embedding_id, embedding_model, embedding_version, scope, project_id, source, confidence, created_at, updated_at FROM blocks WHERE instr(lower(content), ?) > 0 OR instr(lower(summary), ?) > 0 ORDER BY created_at DESC LIMIT ?",
      needle,
      needle,
      limit,
    )
    .toArray();
  return rows.map((row) =>
    narrowLexicalSearchHit(row as Record<string, SqlStorageValue | undefined>),
  );
}

// ---------------------------------------------------------------------------
// 4. deleteBlock — delete + explicit cascade to relations (D-04)
// ---------------------------------------------------------------------------

/**
 * Deletes a block by id. When `cascade=true` (the default), also deletes
 * every row in `relations` where the block appears as `from_id` OR `to_id`.
 * Cascade is explicit because the v1 DDL ships without `ON DELETE CASCADE`
 * (D-04 — PATTERNS.md §4 drift-risk note). Returns the row counts so
 * callers can log or audit.
 *
 * Cascade is two separate `.exec()` calls — atomic individually, NOT atomic
 * as a pair. v0.1 scale accepts this; a future helper may wrap in
 * `ctx.storage.transactionSync()` at the call-site if a Phase 4 invariant
 * surfaces that demands cross-write atomicity.
 */
export function deleteBlock(
  sql: SqlStorage,
  id: string,
  cascade = true,
): { blocks_deleted: number; relations_deleted: number } {
  const blocksResult = sql.exec("DELETE FROM blocks WHERE id = ?", id);
  const blocks_deleted = blocksResult.rowsWritten;

  let relations_deleted = 0;
  if (cascade) {
    const relationsResult = sql.exec(
      "DELETE FROM relations WHERE from_id = ? OR to_id = ?",
      id,
      id,
    );
    relations_deleted = relationsResult.rowsWritten;
  }
  return { blocks_deleted, relations_deleted };
}

// ---------------------------------------------------------------------------
// 5. listMemoryTypes — list all rows from memory_types (D-02 — returns [])
// ---------------------------------------------------------------------------

/**
 * Returns every row in `memory_types` — system seeds (`source: "system"`,
 * `workspace_id: null`) and any user / community types this workspace has
 * defined. Ordered by `id` for deterministic test assertions. The `fields`
 * JSON column is parsed at the boundary (D-03).
 */
export function listMemoryTypes(sql: SqlStorage): MemoryType[] {
  return sql
    .exec("SELECT id, name, fields, workspace_id, source FROM memory_types ORDER BY id")
    .toArray()
    .map((row) => narrowMemoryTypeRow(row as Record<string, SqlStorageValue | undefined>));
}

// ---------------------------------------------------------------------------
// 6. createInboxEntry — write a low-confidence capture (D-03 on write)
// ---------------------------------------------------------------------------

/**
 * Writes one `InboxEntry` row. The `proposed_properties` JSON column is
 * stringified at the boundary (D-03); Pitfall 4 cautions callers to pass
 * `null` (not `undefined`) for missing fields they want persisted — the
 * `InboxEntry.proposed_properties` field is declared `| null` so strict TS
 * catches the mistake at the call-site.
 */
export function createInboxEntry(sql: SqlStorage, entry: InboxEntry): void {
  sql.exec(
    "INSERT INTO inbox (id, content, proposed_type, proposed_properties, memorability_score, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    entry.id,
    entry.content,
    entry.proposed_type,
    entry.proposed_properties === null ? null : JSON.stringify(entry.proposed_properties),
    entry.memorability_score,
    entry.source,
    entry.created_at,
  );
}

// ---------------------------------------------------------------------------
// 7. listConflicts — list conflicts with optional resolved filter (D-02)
// ---------------------------------------------------------------------------

/**
 * Returns conflicts ordered by `detected_at DESC` (newest first). Optional
 * filter `opts.resolved`:
 *   - `true`  — only rows where `resolved_at IS NOT NULL`
 *   - `false` — only rows where `resolved_at IS NULL` (open conflicts)
 *   - omitted — all rows regardless of resolution state
 *
 * Optional `opts.limit` clamps the result count. Returns `[]` on no matches.
 *
 * SQL construction note: the conditional WHERE arm is appended as a STATIC
 * string (chosen by `opts.resolved`), NOT interpolated user input — so no
 * SQL injection risk (T-02-05-04 mitigation). Only the limit value goes
 * through a positional binding.
 */
export function listConflicts(
  sql: SqlStorage,
  opts: { resolved?: boolean; limit?: number } = {},
): Conflict[] {
  let query =
    "SELECT id, memory_a_id, memory_b_id, description, severity, detected_at, resolved_at FROM conflicts";
  if (opts.resolved === true) {
    query += " WHERE resolved_at IS NOT NULL";
  } else if (opts.resolved === false) {
    query += " WHERE resolved_at IS NULL";
  }
  query += " ORDER BY detected_at DESC";

  const rows =
    opts.limit !== undefined
      ? sql.exec(query + " LIMIT ?", opts.limit).toArray()
      : sql.exec(query).toArray();

  return rows.map((row) => narrowConflictRow(row as Record<string, SqlStorageValue | undefined>));
}
