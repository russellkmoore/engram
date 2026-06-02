# Phase 2: WorkspaceDO + SQLite - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

`WorkspaceDO` is a SQLite-backed Durable Object that owns the per-workspace schema, seeds system memory types idempotently, exposes typed query helpers for every v0.1 read/write pattern, and survives hibernation replay without duplication or migration re-runs.

Scope is locked by STO-01 through STO-10 (10 requirements with concrete acceptance criteria). The discussion below clarifies **HOW** the implementation surfaces — choices that downstream phases (3, 4, 5) will inherit. Worker-level concerns (the Cloudflare `wrangler.jsonc › migrations[]` array, the EngramMcp session-DO body, MCP tool wiring) are out of scope and live in Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Query helper API shape

- **D-01:** Helpers return **typed objects synchronously**, importing types from `@engram/types` where applicable (`Memory`, `Conflict`, etc.) or defining query-specific shapes (`MemoryType`, `InboxEntry`) in `packages/workspace-do/src/types.ts`. Sync matches the underlying `storage.sql.exec()` API; no fake `await`s. Tools in Phase 3 wrap with their own async surface where MCP requires it.
- **D-02:** Single-row reads (`getBlock(id)`, `getMemoryType(id)`) **throw** on miss using a `NotFoundError` class exported from `@engram/workspace-do`. List reads return `[]` on no matches. No `Result<T, E>` envelope — JS-idiomatic try/catch wins for now; revisit if exception cost becomes measurable in profiling (unlikely at v0.1 scale).
- **D-03:** JSON columns (`blocks.properties`, `memory_types.fields`, `relations.properties`, `tags.<n/a>`, `inbox.proposed_properties`) are **parsed at the helper boundary**. `JSON.parse` on read; `JSON.stringify` on write. Callers receive fully-typed objects (e.g., `Memory.properties: Record<string, unknown>`). **No runtime schema validation (zod) at this layer in Phase 2** — defer to Phase 4 when MCP tool inputs need it. Phase 2 trusts internal writes; Phase 4 will add zod at the tool-input boundary.

### Index strategy (v1 migration)

- **D-04:** v1 migration ships **aggressive indexing** — every column expected to filter on lands in the initial migration. Specifically:
  - PRIMARY KEYs (free): `blocks.id`, `memory_types.id`, `inbox.id`, `conflicts.id`, composite `(from_id, to_id, relationship)` on `relations`
  - Cascade-delete support: `relations.from_id`, `relations.to_id`
  - Tag lookup: `tags.block_id`
  - Sort/filter: `inbox.created_at`, `conflicts.resolved_at`
  - Phase 4 query patterns: `blocks.scope`, `blocks.project_id`, `blocks.type`, `blocks.created_at`
  - Phase 5 Vectorize lookup: `blocks.embedding_id`
- **D-05:** Indexes are declared in the **same v1 migration as table creation** (single SQL block executed in `blockConcurrencyWhile()`). No additive index migrations expected in v0.1. Rationale: workspace DOs are per-user, so write amplification is small; getting indexes wrong on a populated table later (post-v0.4 with real users) is far more painful than landing them aggressively now.

### EngramMcp v2 migration scope

- **D-06:** Phase 2 **does NOT touch `packages/mcp-server/wrangler.jsonc`**. The Worker-level Cloudflare migrations array remains `[{ tag: "v1", new_sqlite_classes: ["WorkspaceDO"] }]`. The v2 migration that adds `EngramMcp` to `new_sqlite_classes` lands in **Phase 3** alongside the EngramMcp session-DO body.
- **D-07** *[informational — Phase 3 forward-note, not a Phase 2 implementation decision]*: Phase 3's `discuss-phase` and `plan-phase` MUST add an explicit success criterion enforcing the v2 migration (e.g., "wrangler.jsonc migrations[] now contains a v2 entry adding EngramMcp; `npm run lint:wrangler` exits 0; deploy-dry-run confirms the migration would apply cleanly"). Phase 2's CONTEXT.md flags this so it isn't forgotten — see [[engram-linear-sync]] memory for the broader pattern.
- **D-08** *[informational — conceptual clarification, no implementation work needed in Phase 2]*: The per-DO `_schema_migrations` table built in Phase 2 is **conceptually separate** from the Worker-level `wrangler.jsonc › migrations[]` array. The former tracks SQLite schema (tables, columns, indexes) inside the DO; the latter tracks DO class additions/renames at the Cloudflare platform level. They don't need to be coordinated.

### STO-10 enforcement mechanism

- **D-09:** STO-10's "grep-based lint rule (or test)" implementation = **`scripts/lint-blockconcurrency.mjs`** — mirrors the FND-08 `scripts/lint-wrangler.mjs` pattern from Phase 1. Dual-mode (no-arg glob over `packages/workspace-do/src/**/*.ts` for CI; positional file list for pre-commit / lint-staged). Wired as `npm run lint:blockconcurrency` + a dedicated CI step + a lint-staged rule on `packages/workspace-do/src/**/*.ts`.
- **D-10:** Forbidden tokens inside `blockConcurrencyWhile(async () => { ... })` blocks (regex-bounded extraction): `env.`, `fetch(`, `await this.ai`, `await ctx.storage.transaction(`, `await import(`, `await this.env`. Allowed: synchronous `storage.sql.exec(...)`, synchronous JS, `console.log`. Exit codes match FND-08 (0=clean, 1=violation found, 2=no-files canary in no-arg full-scan mode).
- **D-11:** CI step ordering: `lint:blockconcurrency` runs **after `lint`** and **before `lint:wrangler`** in `.github/workflows/ci.yml` (alphabetic, low risk of contention). Pre-commit ordering follows lint-staged's default (parallel by glob match).

### Claude's Discretion

- `_schema_migrations` table column shape — default: `(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`. The `name` column captures the human-readable migration name (e.g., `"v1_initial_schema"`) for debugging.
- Vitest file organization within `packages/workspace-do/` — default: `src/__tests__/` colocated with source, one test file per concern (`schema.test.ts`, `seeding.test.ts`, `helpers.test.ts`, `hibernation.test.ts`, `defense-in-depth.test.ts`, `blockconcurrency-lint.test.ts` for the lint script's own sanity check).
- Shared vitest fixtures (workspace seeding helpers, fixture factories) — default: `src/__tests__/fixtures/` with a `makeWorkspace()` builder that returns a primed `WorkspaceDO` instance.
- TypeScript types for query results — default: re-export domain shapes from `@engram/types` where they match; define query-specific shapes (e.g., `LexicalSearchHit`, `InboxEntry`) in `packages/workspace-do/src/types.ts` and export them from the package barrel so Phase 3 tools can consume them.
- `NotFoundError` class shape — default: `class NotFoundError extends Error` with a `resource: string` and `id: string` discriminant for downstream error mapping (Phase 3 will wrap to `McpError(-32602 InvalidParams)` or similar).
- Exact regex for `blockConcurrencyWhile` block extraction in the STO-10 lint script — default: balance-counted brace match starting at `blockConcurrencyWhile(async () => {` and ending at the matching `}`. If TS parsing complexity outweighs grep simplicity, consider `ts-morph` (small dep, but acceptable for a build-time-only script).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architectural source-of-truth

- `CLAUDE.md` §"SQLite Schema (inside WorkspaceDO)" — Defines all 7 tables (`blocks`, `relations`, `tags`, `members`, `memory_types`, `inbox`, `conflicts`) and their column shapes. **This is the spec for STO-03.**
- `CLAUDE.md` §"Memory Types (Schema-as-Data)" — Defines the 7 system memory types (`job_application`, `contact`, `company`, `project`, `research_note`, `decision_log`, `meeting_note`) and supported field types. Source for STO-05 system-type seeding.
- `CLAUDE.md` §"Session DO vs Workspace DO" — Two-DO topology with `EngramMcp` (session) + `WorkspaceDO` (data). Reinforces D-06 — Phase 2 only builds WorkspaceDO; EngramMcp is Phase 3.

### Requirements

- `.planning/REQUIREMENTS.md` §"Storage (STO)" — STO-01 through STO-10. Concrete acceptance criteria for each.
- `.planning/ROADMAP.md` §"Phase 2: WorkspaceDO + SQLite" — Success criteria + risk notes (especially the irreversible-decision callouts for DO-1, DO-2, DO-3, AI-1, MT-1).

### Inputs from earlier phases

- `shared/types/src/index.ts` — `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict`, `TimelineEvent`. Helpers will return these typed shapes (D-01).
- `shared/schema/src/system-types.ts` — `SYSTEM_TYPES` const with the 7 system memory type definitions. Phase 2 seeds these via `INSERT OR IGNORE` per STO-05.
- `shared/schema/src/index.ts` — Field-type definitions (`FieldType` union, `MemoryTypeField` shape) the `memory_types.fields` JSON column conforms to.
- `packages/workspace-do/src/index.ts` — Current Phase 1 stub (`class WorkspaceDO extends DurableObject`). Phase 2 fills the body.
- `packages/mcp-server/wrangler.jsonc` — Worker-level config declaring WorkspaceDO under v1 `new_sqlite_classes`. **Phase 2 does NOT modify this file** (D-06).
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions D-01 through D-16 (locked toolchain, package layout, library-only workspace-do per D-10).
- `.planning/phases/01-foundation/01-REVIEW-FIX.md` — WR-06 documents the deferred v2 migration; D-06 above is the Phase 2 follow-up.

### Patterns to mirror

- `scripts/lint-wrangler.mjs` — FND-08 lint script. **D-09's `scripts/lint-blockconcurrency.mjs` mirrors this pattern** (dual-mode, exit codes, lint-staged + CI wiring).
- `.github/workflows/ci.yml` — Existing CI step ordering. D-11 inserts `lint:blockconcurrency` between `lint` and `lint:wrangler`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `@engram/types` — Already exports `Memory`, `Conflict`, `Entity`, `MemoryEvent`, `EngramResponse<T>`, `TimelineEvent`. Phase 2 helpers return these shapes directly where they match (D-01); query-specific shapes go in `packages/workspace-do/src/types.ts`.
- `@engram/schema` — `SYSTEM_TYPES` const + `FieldType` union + `MemoryTypeField` shape are ready to use for STO-05 seeding. The schema package already exports these via the TS-source `exports` field pattern (D-07 from Phase 1) — no build step needed.
- `scripts/lint-wrangler.mjs` — Reusable structure for the new `scripts/lint-blockconcurrency.mjs` (D-09). Uses `jsonc-parser` + `fast-glob`; the new script uses `fast-glob` only (no JSONC parsing needed).
- `@cloudflare/vitest-pool-workers` — Locked test framework (STO-08). Already configured at the workspace level in Phase 1; Phase 2 adds `vitest.config.ts` to `packages/workspace-do/`.
- `cloudflare:workers` runtime API — `DurableObject` base class (imported in the Phase 1 stub) + `storage.sql.exec(...)` (sync) + `blockConcurrencyWhile(async () => { ... })`.

### Established Patterns

- **TS-source `exports` field** (D-07 from Phase 1) — workspace-do continues this pattern. No `dist/` directory, no build step, type-source consumed directly by wrangler bundling.
- **Per-package vitest config** — Phase 1 didn't ship vitest, but the existing typecheck/lint/format pattern via npm workspaces (`npm run X --workspaces --if-present`) extends cleanly: add `npm run test` to the root package.json that delegates per-workspace.
- **`scripts/lint-*.mjs` pattern** — Dual-mode (no-arg glob, positional file list), exit-code matrix (0/1/2), wired into both lint-staged + a dedicated CI step. Phase 2 D-09 mirrors this exactly.
- **`@engram/*` workspace symlinks** — `node_modules/@engram/types`, `node_modules/@engram/schema`, `node_modules/@engram/workspace-do` already resolve. Phase 2 doesn't add new packages.
- **Strict TypeScript** (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) — Phase 2 helpers must satisfy these. In particular, `noUncheckedIndexedAccess` means SQL row indexing (`row[0]`) returns `T | undefined` — helpers must narrow before returning.

### Integration Points

- `packages/workspace-do/src/index.ts` — Phase 2 grows this from the empty Phase 1 stub. Constructor runs schema migrations idempotently via `blockConcurrencyWhile()`; methods become the typed query helpers.
- `packages/mcp-server/src/index.ts` — Currently re-exports `WorkspaceDO` from `@engram/workspace-do` so wrangler can resolve the binding. Phase 2 doesn't change this; Phase 3 adds tool wiring that calls into `env.WORKSPACE.get(...).fetch(...)` (via RPC) to invoke the query helpers.
- `packages/mcp-server/wrangler.jsonc` — Untouched by Phase 2 (D-06). Phase 3 adds the v2 migration entry.
- `.github/workflows/ci.yml` — Phase 2 adds a `Lint blockConcurrencyWhile I/O (STO-10)` step between `lint` and `lint:wrangler` (D-11). Also adds a vitest step running `npm run test --workspaces --if-present`.
- `.lintstagedrc.json` — Phase 2 adds a `packages/workspace-do/src/**/*.ts` rule that runs `node scripts/lint-blockconcurrency.mjs <files>`.

</code_context>

<specifics>
## Specific Ideas

- "Sync helpers, throw on miss" is JS-idiomatic and matches the underlying `storage.sql.exec()` API. Don't lie about async.
- Aggressive v1 indexing is the right call because workspace DOs are per-user and small — write amplification is a non-issue, and adding indexes to a populated `blocks` table post-v0.4 (when real users are active) is genuinely painful.
- Phase 2's `_schema_migrations` table is the **per-DO** SQLite migration tracker. The **Worker-level** `wrangler.jsonc › migrations[]` array is a separate concept and Phase 3's territory. Don't conflate the two.
- STO-10 lint script should feel like FND-08's: small Node script, dual-mode, mechanical regex check, CI step + lint-staged rule. Consistent with Phase 1's toolchain.

</specifics>

<deferred>
## Deferred Ideas

- **Runtime schema validation (zod) at the helper boundary** — discussed during GA-1 Q1.2. Deferred to Phase 4 (when MCP tool inputs need it). The boundary moves from "helper accepts validated input" to "tool boundary validates, helper trusts" — Phase 2's helpers will be called only by Phase 3+ tools that own input validation.
- **Per-helper performance profiling / query-plan analysis** — premature for v0.1. Revisit if Phase 5/6 surfaces hot paths.
- **The v2 migration body itself (adding EngramMcp to `new_sqlite_classes`)** — Phase 3's territory per D-06.
- **Additive index migrations (v3+)** — Phase 2 ships aggressive v1 indexing (D-05) explicitly to defer this. Revisit only if query patterns surface in Phase 4/5 that need a new index.
- **EngramMcp's own SQLite schema (session storage, JWT props cache, etc.)** — Phase 3's territory entirely. Phase 2's `_schema_migrations` framework is per-DO, so EngramMcp will have its own independent migration table.
- **Vitest reporter / coverage tooling** — Default vitest output for v0.1. Revisit if test count exceeds ~50 and signal/noise becomes an issue.

### Reviewed Todos (not folded)

(None — `gsd-sdk query todo.match-phase 2` returned 0 matches.)

</deferred>

---

*Phase: 02-workspacedo-sqlite*
*Context gathered: 2026-05-25*
