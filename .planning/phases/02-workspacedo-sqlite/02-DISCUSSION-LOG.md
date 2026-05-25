# Phase 2: WorkspaceDO + SQLite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion path.

**Date:** 2026-05-25
**Phase:** 02-workspacedo-sqlite
**Mode:** discuss (default)
**Areas discussed:** Query helper API shape, Index strategy timing, EngramMcp v2 migration scope, STO-10 enforcement mechanism

## Domain Boundary

`WorkspaceDO` is a SQLite-backed Durable Object that owns the per-workspace schema, seeds system memory types idempotently, exposes typed query helpers for every v0.1 read/write pattern, and survives hibernation replay without duplication or migration re-runs.

Scope locked by STO-01..STO-10. Discussion clarified HOW to implement, not WHAT to add.

## Gray Areas Presented (4 total, all selected for discussion)

1. **Query helper API shape** — sync vs async, throw vs null, raw rows vs typed objects, JSON parse boundary
2. **Index strategy timing** — what indexes ship in v1 migration vs additive later
3. **EngramMcp v2 migration scope** — does Phase 2 or Phase 3 own the v2 entry in wrangler.jsonc
4. **STO-10 enforcement mechanism** — `scripts/lint-blockconcurrency.mjs` script vs vitest test

## Discussion

### GA-1: Query helper API shape

**Q1.1 — Return shape (sync, async, or Result envelope)?**

Options presented:
- A. Sync, typed objects, throw on miss (recommended) ← **selected**
- B. Async wrapper, typed objects, throw on miss
- C. Sync, typed objects, Result<T, E> envelope

User selection: **A**. Helpers will return typed objects from `@engram/types` (or package-local types for query-specific shapes) synchronously. Missing single-row reads throw a `NotFoundError`; list reads return `[]`. Matches `storage.sql.exec()`'s sync nature.

→ CONTEXT.md decisions D-01, D-02.

**Q1.2 — JSON column parse boundary (blocks.properties, memory_types.fields, etc.)?**

Options presented:
- A. Parse at helper boundary, validate with @engram/types (no zod) (recommended) ← **selected**
- B. Parse at helper boundary + zod schema check on read
- C. Return raw JSON strings; let callers parse

User selection: **A**. `JSON.parse` on read, `JSON.stringify` on write. No runtime schema check yet (zod deferred to Phase 4).

→ CONTEXT.md decision D-03.

### GA-2: Index strategy timing

**Q2.1 — How much to commit to upfront in v1 migration?**

Options presented:
- A. Minimum to make Phase 2 helpers correct + obvious future winners (recommended)
- B. Aggressive — index every column we expect to filter on ← **selected**
- C. Bare minimum — just what Phase 2 needs

User selection: **B**. v1 migration ships indexes for all expected query columns: `blocks.scope`, `blocks.project_id`, `blocks.type`, `blocks.embedding_id`, `blocks.created_at`, `relations.from_id`, `relations.to_id`, `tags.block_id`, `inbox.created_at`, `conflicts.resolved_at`. PRIMARY KEYs cover `blocks.id`, `memory_types.id`, etc.

Rationale: workspace DOs are per-user and small (write amplification is fine); adding indexes to a populated blocks table post-v0.4 with real users is genuinely painful. Worth absorbing the up-front cost now.

→ CONTEXT.md decisions D-04, D-05.

### GA-3: EngramMcp v2 migration scope

**Q3.1 — When does the Worker-level v2 migration (adding EngramMcp to new_sqlite_classes) land?**

Options presented:
- A. Phase 3 lands v2 — Phase 2 stays focused on WorkspaceDO internals (recommended) ← **selected**
- B. Phase 2 lands v2 as an empty pass-through
- C. Defer the question entirely to Phase 3's discuss-phase

User selection: **A**. Phase 2 does NOT touch `packages/mcp-server/wrangler.jsonc`. The v2 migration adding `EngramMcp` to `new_sqlite_classes` lands in Phase 3 alongside the EngramMcp session-DO body.

Risk callout: forgetting in Phase 3. Mitigation: Phase 2's CONTEXT.md (D-07) instructs Phase 3 to add a success criterion enforcing the v2 migration.

Clarification: the per-DO `_schema_migrations` table (Phase 2) and the Worker-level `wrangler.jsonc › migrations[]` array (Phase 3) are separate concepts at different layers — they don't need to be coordinated.

→ CONTEXT.md decisions D-06, D-07, D-08.

### GA-4: STO-10 enforcement mechanism

**Q4.1 — Script (like FND-08) or vitest test for the blockConcurrencyWhile I/O check?**

Options presented:
- A. Script + CI step (mirrors FND-08 pattern) (recommended) ← **selected**
- B. Vitest test in workspace-do test suite
- C. Both — script for CI gate + vitest for in-source documentation

User selection: **A**. `scripts/lint-blockconcurrency.mjs` mirrors the FND-08 `scripts/lint-wrangler.mjs` pattern. Dual-mode (no-arg glob + positional file list). Wired as `npm run lint:blockconcurrency` + CI step + lint-staged rule.

Forbidden tokens inside `blockConcurrencyWhile(async () => { ... })`: `env.`, `fetch(`, `await this.ai`, `await ctx.storage.transaction(`, `await import(`, `await this.env`. Allowed: synchronous `storage.sql.exec(...)`, sync JS, `console.log`. Exit codes match FND-08 (0=clean, 1=violation, 2=no-files canary).

→ CONTEXT.md decisions D-09, D-10, D-11.

## Deferred Ideas

- Runtime schema validation (zod) at the helper boundary — deferred to Phase 4 (tool input layer).
- Per-helper performance profiling / query-plan analysis — premature for v0.1.
- The v2 migration body itself — Phase 3.
- Additive index migrations (v3+) — defer entirely; aggressive v1 indexing addresses this.
- EngramMcp's own SQLite schema — Phase 3.
- Vitest reporter / coverage tooling — default vitest output for v0.1.

## Claude's Discretion (no question asked)

- `_schema_migrations` table column shape: default `(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`.
- Vitest file organization: `src/__tests__/` colocated, one file per concern.
- Shared vitest fixtures: `src/__tests__/fixtures/` with a `makeWorkspace()` builder.
- TypeScript types for query results: re-export from `@engram/types` where they match; package-local `src/types.ts` for query-specific shapes.
- `NotFoundError` class shape: extends `Error`, has `resource` + `id` discriminants.
- `blockConcurrencyWhile` regex extraction: balance-counted brace match; consider `ts-morph` if regex gets unwieldy.

## Cross-Reference

- No matching todos (`gsd-sdk query todo.match-phase 2` returned 0).
- No prior CONTEXT.md decisions overlapped (Phase 1 was config-only).
- WR-06 from Phase 1's REVIEW-FIX.md directly informs D-06.

---

*Phase: 02-workspacedo-sqlite*
*Discussion log written: 2026-05-25*
