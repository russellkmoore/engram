# Phase 2: WorkspaceDO + SQLite - Research

**Researched:** 2026-05-25
**Domain:** Cloudflare Durable Objects + SQLite, `@cloudflare/vitest-pool-workers`, idempotent schema migrations, Node grep-lint scripts
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Query helper API shape**

- **D-01:** Helpers return **typed objects synchronously**, importing types from `@engram/types` where applicable (`Memory`, `Conflict`, etc.) or defining query-specific shapes (`MemoryType`, `InboxEntry`) in `packages/workspace-do/src/types.ts`. Sync matches the underlying `storage.sql.exec()` API; no fake `await`s. Tools in Phase 3 wrap with their own async surface where MCP requires it.
- **D-02:** Single-row reads (`getBlock(id)`, `getMemoryType(id)`) **throw** on miss using a `NotFoundError` class exported from `@engram/workspace-do`. List reads return `[]` on no matches. No `Result<T, E>` envelope — JS-idiomatic try/catch wins for now; revisit if exception cost becomes measurable in profiling (unlikely at v0.1 scale).
- **D-03:** JSON columns (`blocks.properties`, `memory_types.fields`, `relations.properties`, `inbox.proposed_properties`) are **parsed at the helper boundary**. `JSON.parse` on read; `JSON.stringify` on write. Callers receive fully-typed objects (e.g., `Memory.properties: Record<string, unknown>`). **No runtime schema validation (zod) at this layer in Phase 2** — defer to Phase 4 when MCP tool inputs need it. Phase 2 trusts internal writes; Phase 4 will add zod at the tool-input boundary.

**Index strategy (v1 migration)**

- **D-04:** v1 migration ships **aggressive indexing** — every column expected to filter on lands in the initial migration. Specifically:
  - PRIMARY KEYs (free): `blocks.id`, `memory_types.id`, `inbox.id`, `conflicts.id`, composite `(from_id, to_id, relationship)` on `relations`
  - Cascade-delete support: `relations.from_id`, `relations.to_id`
  - Tag lookup: `tags.block_id`
  - Sort/filter: `inbox.created_at`, `conflicts.resolved_at`
  - Phase 4 query patterns: `blocks.scope`, `blocks.project_id`, `blocks.type`, `blocks.created_at`
  - Phase 5 Vectorize lookup: `blocks.embedding_id`
- **D-05:** Indexes are declared in the **same v1 migration as table creation** (single SQL block executed in `blockConcurrencyWhile()`). No additive index migrations expected in v0.1.

**EngramMcp v2 migration scope**

- **D-06:** Phase 2 **does NOT touch `packages/mcp-server/wrangler.jsonc`**. The Worker-level Cloudflare migrations array remains `[{ tag: "v1", new_sqlite_classes: ["WorkspaceDO"] }]`. The v2 migration that adds `EngramMcp` to `new_sqlite_classes` lands in **Phase 3** alongside the EngramMcp session-DO body.
- **D-07:** Phase 3's `discuss-phase` and `plan-phase` MUST add an explicit success criterion enforcing the v2 migration.
- **D-08:** The per-DO `_schema_migrations` table built in Phase 2 is **conceptually separate** from the Worker-level `wrangler.jsonc › migrations[]` array.

**STO-10 enforcement mechanism**

- **D-09:** STO-10's "grep-based lint rule (or test)" = **`scripts/lint-blockconcurrency.mjs`** — mirrors the FND-08 `scripts/lint-wrangler.mjs` pattern. Dual-mode (no-arg glob over `packages/workspace-do/src/**/*.ts` for CI; positional file list for pre-commit / lint-staged). Wired as `npm run lint:blockconcurrency` + dedicated CI step + lint-staged rule.
- **D-10:** Forbidden tokens inside `blockConcurrencyWhile(async () => { ... })` blocks: `env.`, `fetch(`, `await this.ai`, `await ctx.storage.transaction(`, `await import(`, `await this.env`. Allowed: synchronous `storage.sql.exec(...)`, synchronous JS, `console.log`. Exit codes match FND-08 (0=clean, 1=violation, 2=no-files canary).
- **D-11:** CI step ordering: `lint:blockconcurrency` runs **after `lint`** and **before `lint:wrangler`** in `.github/workflows/ci.yml`.

### Claude's Discretion

- `_schema_migrations` table column shape — default: `(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`.
- Vitest file organization within `packages/workspace-do/` — default: `src/__tests__/` colocated with source, one test file per concern (`schema.test.ts`, `seeding.test.ts`, `helpers.test.ts`, `hibernation.test.ts`, `defense-in-depth.test.ts`, `blockconcurrency-lint.test.ts`).
- Shared vitest fixtures — default: `src/__tests__/fixtures/` with a `makeWorkspace()` builder.
- TypeScript types for query results — default: re-export domain shapes from `@engram/types` where they match; define query-specific shapes in `packages/workspace-do/src/types.ts`.
- `NotFoundError` class shape — default: `class NotFoundError extends Error` with `resource: string` and `id: string`.
- Exact regex for `blockConcurrencyWhile` block extraction — default: balance-counted brace match. Consider `ts-morph` if regex complexity grows.

### Deferred Ideas (OUT OF SCOPE)

- Runtime schema validation (zod) at the helper boundary — Phase 4.
- Per-helper performance profiling / query-plan analysis — defer to Phase 5/6 if hot paths surface.
- The v2 migration body itself (adding `EngramMcp` to `new_sqlite_classes`) — Phase 3.
- Additive index migrations (v3+) — Phase 2 ships aggressive v1 indexing explicitly to defer this.
- `EngramMcp`'s own SQLite schema — Phase 3 entirely.
- Vitest reporter / coverage tooling — Default vitest output for v0.1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STO-01 | `WorkspaceDO` lives in `packages/workspace-do/` and is declared in `mcp-server`'s `wrangler.jsonc` under `new_sqlite_classes` | Already complete from Phase 1 — `packages/workspace-do/src/index.ts` stub + `mcp-server/wrangler.jsonc` v1 entry. Phase 2 leaves wrangler.jsonc untouched per D-06; verification = inspecting existing file + assertion in `wrangler.test.ts` (or reusing FND-08's lint output). |
| STO-02 | Constructor runs schema migration idempotently via `_schema_migrations` table inside `blockConcurrencyWhile()` with no network I/O | "Implementation Approach §1 (Migration Runner)" defines a hand-rolled `_schema_migrations` table; `blockConcurrencyWhile` semantics covered in "Key APIs §A". |
| STO-03 | SQLite schema creates all 7 tables per CLAUDE.md spec | "File-by-File Sketch §migrations/v1_initial_schema.ts" — DDL per CLAUDE.md §"SQLite Schema". |
| STO-04 | `blocks` includes `embedding_model TEXT` and `embedding_version INTEGER` from v1 | DDL extension noted in "Implementation Approach §2 (v1 Migration Body)". |
| STO-05 | `memory_types` seeded with 7 system types via `INSERT OR IGNORE` (idempotent) | `SYSTEM_TYPES` already exists in `shared/schema/src/system-types.ts`; pattern: synchronous loop calling `sql.exec("INSERT OR IGNORE INTO memory_types (...) VALUES (?, ?, ?, ?, ?)", ...)` per CLAUDE.md §"Memory Types". |
| STO-06 | 7 typed query helpers: insert block, get block by id, lexical search (LIKE), delete + cascade, list memory types, create inbox, list conflicts | "File-by-File Sketch §queries.ts"; cursor API documented in "Key APIs §B". |
| STO-07 | Every method verifies `this.state.id.name === args.workspace_id` and throws `McpError(-32600 InvalidRequest)` on mismatch | "Key APIs §C (defense-in-depth)" — confirmed that `idFromName(...)` populates `id.name`; `idFromString(...)` leaves it `undefined`. SDK exports `McpError` + `ErrorCode.InvalidRequest = -32600` (verified locally in `node_modules`). |
| STO-08 | Vitest suite under `@cloudflare/vitest-pool-workers` covers schema migration, seeding, every helper | "Validation Architecture" + "Key APIs §D" with verified Cloudflare fixture patterns. |
| STO-09 | Hibernation-replay safety: re-instantiating after simulated hibernation does not re-run migrations or duplicate seed data | "Implementation Approach §3 (Hibernation Test Recipe)" — `runInDurableObject` from `cloudflare:test`. |
| STO-10 | Grep-based lint flags forbidden tokens inside `blockConcurrencyWhile()` blocks; fails CI on regression | "File-by-File Sketch §scripts/lint-blockconcurrency.mjs"; "Validation Architecture §STO-10". |
</phase_requirements>

## Summary

Phase 2 builds a SQLite-backed `WorkspaceDO` whose constructor establishes the seven-table schema, indexes, and seven seed `memory_types` records — all idempotently, all synchronously — through a hand-rolled `_schema_migrations` table executed once per cold start inside `ctx.blockConcurrencyWhile()`. The implementation is *constrained* (not optional) by Cloudflare's documented Rules of Durable Objects: `PRAGMA user_version` is unsupported, hibernation re-runs the constructor, and `blockConcurrencyWhile` blocks ALL request delivery (so any I/O inside it is a throughput cliff and a 30-second-eviction risk).

The official `@cloudflare/vitest-pool-workers` runtime supports the exact test we need (`runInDurableObject` from `cloudflare:test`) — the Cloudflare-maintained fixture under `cloudflare/workers-sdk` at `fixtures/vitest-pool-workers-examples/durable-objects/` is the reference for both `vitest.config.ts` shape (uses `cloudflareTest({ wrangler: { configPath } })`) and DO testing patterns. Tests run inside the real workerd runtime, not an emulation, so SQLite semantics match production exactly.

STO-07's defense-in-depth check is provable, not vibes: Cloudflare's docs explicitly state that `idFromName(name).name === name` but `idFromString(hex).name === undefined`. Throwing on `state.id.name !== args.workspace_id` therefore correctly fails any request that resolved the DO via a raw hex ID rather than the JWT-derived workspace name. The MCP SDK exports `McpError` and `ErrorCode.InvalidRequest = -32600` — confirmed by reading `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` locally.

**Primary recommendation:** Hand-roll a minimal `_schema_migrations` *table* migration runner (matches STO-02's letter, ~40 LOC) rather than adopt `durable-utils` (which uses a KV-style `__sql_migrations_lastID` key — not a table — and would technically violate STO-02). Wrap migration execution synchronously inside `ctx.blockConcurrencyWhile(async () => { ... })` — Cloudflare's own seat-booking tutorial models exactly this idempotent-bootstrap pattern. For the STO-10 lint, mirror FND-08 byte-for-byte: same `fast-glob` + dual-mode + exit codes, just swap `jsonc-parser` for a balance-counted regex that extracts `blockConcurrencyWhile(async () => { ... })` blocks.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-workspace SQLite schema bootstrap | DurableObject constructor (workspace-do) | — | Constructor is the only place Cloudflare guarantees runs before any request reaches a handler; `blockConcurrencyWhile` is the only mechanism to delay request delivery during bootstrap. |
| Schema-as-data system memory type seeding | DurableObject constructor (workspace-do) | `@engram/schema` (source) | Seeds *into* SQLite; data source is the immutable `SYSTEM_TYPES` const in `@engram/schema`. |
| Typed query helpers (insert/get/search/delete) | DurableObject instance methods (workspace-do) | `@engram/types` (return shapes) | Synchronous SQL execution maps 1:1 to instance methods; types come from the shared types package. |
| Defense-in-depth workspace_id verification | DurableObject method preamble (workspace-do) | `@modelcontextprotocol/sdk` (`McpError` ctor) | Belongs at the DO method boundary — every method must verify, not the caller. |
| `blockConcurrencyWhile` I/O lint | Build-time Node script (CI + lint-staged) | — | Static analysis at commit time + CI; not runtime. Mirrors FND-08 pattern. |
| Hibernation-replay safety test | `@cloudflare/vitest-pool-workers` (test tier) | `cloudflare:test` (`runInDurableObject`) | Tests run in real workerd; replay simulated by allocating a fresh DO stub and observing migration table row counts. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cloudflare:workers` (DurableObject, blockConcurrencyWhile) | runtime | DO base class + concurrency primitive | Built into workerd; no external dep. [CITED: developers.cloudflare.com/durable-objects/api/state/] |
| `@cloudflare/workers-types` | ^4.20260525.1 (already pinned) | DO/SqlStorage/SqlStorageCursor types | Already in `devDependencies` from Phase 1; type-only import. |
| `@cloudflare/vitest-pool-workers` | ^0.16.9 | Vitest pool that runs tests inside workerd with real DO + SQLite bindings | The only officially-supported testing pool for DOs. Required by STO-08's locked decision. [VERIFIED: npm registry — published by Cloudflare] |
| `vitest` | ^4.1.7 | Test runner | Required peer of `@cloudflare/vitest-pool-workers`. [VERIFIED: npm registry — slopcheck flagged as SUS (typosquat-near "vite") but this is a false-positive: vitest is the canonical Vite-native test runner with ~10M weekly downloads, maintained by the vite-ecosystem authors.] |
| `@modelcontextprotocol/sdk` | ^1.29.0 (already pinned in mcp-server) | `McpError` class + `ErrorCode` enum for STO-07 throws | Already a direct dep of `@engram/mcp-server` from REVIEW-FIX CR-01. Phase 2's `WorkspaceDO` imports `McpError` + `ErrorCode` from it. [VERIFIED: locally — `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` exports `class McpError` and `enum ErrorCode { InvalidRequest = -32600, ... }`] |
| `fast-glob` | ^3.3.3 (already pinned) | Glob expansion for `scripts/lint-blockconcurrency.mjs` no-arg mode | Already in `devDependencies` from Phase 1's `lint-wrangler.mjs`. Reuse, don't add new. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none — Phase 2 adds NO new runtime deps) | — | — | Aggressive constraint per "Do it RIGHT, not FAST" — every added dep is a maintenance surface. The only additions are devDeps (`@cloudflare/vitest-pool-workers`, `vitest`). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `_schema_migrations` table | `durable-utils@0.3.5` SQLSchemaMigrations | **Rejected.** `durable-utils` uses a KV key (`__sql_migrations_lastID`) — NOT a table. STO-02 explicitly requires a table (paired with the "not `PRAGMA user_version`" exclusion). Adopting `durable-utils` would technically violate the requirement and add a dep for ~30 LOC of logic. [CITED: github.com/lambrospetrou/durable-utils/blob/main/src/sql-migrations.ts] |
| Hand-rolled balance-counted regex for STO-10 lint | `ts-morph@28.0.0` AST parser | **Rejected for v0.1.** Regex is 20-40 LOC, zero new deps, mirrors FND-08 exactly. `ts-morph` would add ~30MB of TypeScript-compiler tooling for a script that scans ~5 source files. Revisit only if the regex starts producing false positives in real code; defer the AST upgrade to v0.2 if at all. |
| `JSON.parse`/`JSON.stringify` for JSON columns | SQLite `json_extract()` / `json_set()` in queries | **Keep both options open but default to JS-side parse for Phase 2 (per D-03).** json_extract lets you filter inside SQL (faster for big tables, but workspace DOs are per-user and small). Phase 4 may push some filters into SQL if hot paths emerge. |
| `@cloudflare/vitest-pool-workers` real-DO testing | Mocking the DO with vitest mocks | **Rejected — would invalidate STO-08/09.** The whole point is exercising real SQLite + real `blockConcurrencyWhile` semantics; mocks would let bugs through that production would catch. |

**Installation:**
```bash
npm install --save-dev --workspace @engram/workspace-do \
  @cloudflare/vitest-pool-workers@^0.16.9 \
  vitest@^4.1.7
```

**Version verification (performed 2026-05-25):**
- `@cloudflare/vitest-pool-workers` → 0.16.9 (published 2026-05, Cloudflare scope) — confirmed via `npm view`.
- `vitest` → 4.1.7 — confirmed via `npm view`.
- `@modelcontextprotocol/sdk` → 1.29.0 already installed; `McpError`/`ErrorCode` exports verified by `grep` on the local `.d.ts`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@cloudflare/vitest-pool-workers` | npm | ~2 yrs | ~150k/wk | github.com/cloudflare/workers-sdk | [OK] | Approved (devDep) |
| `vitest` | npm | ~4 yrs | ~10M/wk | github.com/vitest-dev/vitest | [SUS] — false positive | Approved (devDep) — see footnote |
| `fast-glob` | npm | ~7 yrs | ~80M/wk | github.com/mrmlnc/fast-glob | [OK] | Already installed (Phase 1) |
| `@modelcontextprotocol/sdk` | npm | ~1.5 yrs | ~1M/wk | github.com/modelcontextprotocol/typescript-sdk | [OK] | Already installed (mcp-server) |
| `@cloudflare/workers-types` | npm | ~5 yrs | ~3M/wk | github.com/cloudflare/workerd | [OK] | Already installed (Phase 1) |
| `durable-utils` | npm | ~1.5 yrs (2024-10) | (low) | github.com/lambrospetrou/durable-utils | [OK] (informally — slopcheck-checked) | **NOT recommended for Phase 2.** Considered but rejected because its migration tracking uses a KV key, not a `_schema_migrations` table, which would violate STO-02's letter. |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `vitest` — slopcheck pattern matched it as "suspiciously close to `vite`", but vitest is the canonical Vite-native test runner (vite + jest portmanteau). It's the only test framework the locked decision (D-13 from Phase 1's CONTEXT inheritance + STO-08) actually permits. **Disposition:** approved despite SUS — the planner does NOT need a `checkpoint:human-verify` task because (a) the package is in the `vitest-dev` GitHub org with ~10M weekly downloads, (b) it is the required peer of the also-approved `@cloudflare/vitest-pool-workers`. Document this rationale in PLAN.md so future audits don't re-litigate.

## Implementation Approach

### §1 — Migration Runner Design (STO-02)

Hand-roll a minimal runner. ~40 LOC total. Lives in `packages/workspace-do/src/migrations.ts`.

**Migration registry shape** (Phase 2 ships exactly one entry):

```typescript
// packages/workspace-do/src/migrations.ts
export type Migration = {
  version: number;       // monotonically increasing; 1 for v0.1
  name: string;          // human-readable for debugging — e.g. "v1_initial_schema"
  sql: string;           // full DDL — multi-statement allowed; semicolon-separated
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema", sql: V1_SQL },
];
```

**Runner contract** (synchronous; called *inside* `blockConcurrencyWhile`):

1. Run `CREATE TABLE IF NOT EXISTS _schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)` first — this is itself idempotent and creates the tracking table on cold start.
2. Read existing applied versions: `SELECT version FROM _schema_migrations`. Use `.toArray()` to collect.
3. For each migration in `MIGRATIONS`, if its version is NOT in the applied set, execute its `sql` and then `INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, ?)` with `Date.now()`.
4. Done. The whole thing is sync (no `await`s on storage; `sql.exec` is sync per Cloudflare's API).

**Why hand-rolled, not `durable-utils`:**
- `durable-utils@0.3.5` stores its tracking in a single KV-style key, not a table. STO-02 explicitly requires a table. Adopting `durable-utils` is technically non-compliant with the requirement's letter.
- Hand-rolled is ~40 LOC of well-tested code (covered by `schema.test.ts` + `hibernation.test.ts`); the dependency surface saved is more valuable than the LOC saved.

### §2 — v1 Migration Body (STO-03, STO-04, D-04, D-05)

Live in `packages/workspace-do/src/migrations/v1_initial_schema.sql` (or as a string const in `migrations.ts` — choose the planner's preference).

Schema is verbatim from CLAUDE.md §"SQLite Schema (inside WorkspaceDO)" with two STO-04 additions on `blocks`:

```sql
CREATE TABLE IF NOT EXISTS blocks (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  content      TEXT,
  summary      TEXT,
  properties   TEXT,                   -- JSON, parsed at helper boundary (D-03)
  embedding_id TEXT,
  embedding_model    TEXT,             -- STO-04: stamped by remember() in Phase 5
  embedding_version  INTEGER,          -- STO-04
  scope        TEXT NOT NULL DEFAULT 'personal',
  project_id   TEXT,
  source       TEXT,
  confidence   REAL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_scope         ON blocks(scope);
CREATE INDEX IF NOT EXISTS idx_blocks_project_id    ON blocks(project_id);
CREATE INDEX IF NOT EXISTS idx_blocks_type          ON blocks(type);
CREATE INDEX IF NOT EXISTS idx_blocks_created_at    ON blocks(created_at);
CREATE INDEX IF NOT EXISTS idx_blocks_embedding_id  ON blocks(embedding_id);

CREATE TABLE IF NOT EXISTS relations (
  from_id      TEXT NOT NULL,
  to_id        TEXT NOT NULL,
  relationship TEXT NOT NULL,
  properties   TEXT,                   -- JSON
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, relationship)
);
CREATE INDEX IF NOT EXISTS idx_relations_from_id ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to_id   ON relations(to_id);

CREATE TABLE IF NOT EXISTS tags (
  block_id TEXT NOT NULL,
  tag      TEXT NOT NULL,
  source   TEXT NOT NULL                -- 'user' | 'ai'
);
CREATE INDEX IF NOT EXISTS idx_tags_block_id ON tags(block_id);

CREATE TABLE IF NOT EXISTS members (
  user_id    TEXT PRIMARY KEY,
  role       TEXT NOT NULL,             -- 'owner' | 'editor' | 'viewer'
  invited_by TEXT,
  joined_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_types (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  fields       TEXT NOT NULL,           -- JSON (D-03)
  workspace_id TEXT,                    -- NULL = system default
  source       TEXT NOT NULL            -- 'system' | 'user' | 'community'
);

CREATE TABLE IF NOT EXISTS inbox (
  id                  TEXT PRIMARY KEY,
  content             TEXT,
  proposed_type       TEXT,
  proposed_properties TEXT,             -- JSON
  memorability_score  REAL,
  source              TEXT,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox(created_at);

CREATE TABLE IF NOT EXISTS conflicts (
  id          TEXT PRIMARY KEY,
  memory_a_id TEXT NOT NULL,
  memory_b_id TEXT NOT NULL,
  description TEXT,
  severity    TEXT NOT NULL,            -- 'low' | 'medium' | 'high'
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolved_at ON conflicts(resolved_at);
```

**Seeding (STO-05)** lives *outside* the migration body and runs after migrations apply — separate concern, separate test. Pattern:

```typescript
import { SYSTEM_TYPES } from "@engram/schema";
// inside the constructor, after migrations.runAll(state.storage.sql)
for (const t of SYSTEM_TYPES) {
  state.storage.sql.exec(
    "INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source) VALUES (?, ?, ?, NULL, 'system')",
    t.id, t.name, JSON.stringify(t.fields),
  );
}
```

`INSERT OR IGNORE` is idempotent on the PRIMARY KEY (`id`) collision — running seeding 100 times still produces exactly 7 rows. This is the canonical pattern from CLAUDE.md and is itself the test assertion for STO-05 + STO-09.

### §3 — Hibernation Test Recipe (STO-09)

The mental model: hibernation = the DO instance is evicted from memory, but SQLite storage persists. A new request constructs a fresh instance, the constructor runs again, and `_schema_migrations` already contains version=1 so `runAll()` is a no-op.

In `@cloudflare/vitest-pool-workers`, "simulating hibernation" is just *getting a stub a second time and observing that the constructor's idempotency holds*. The pool's `runInDurableObject` gives direct access to the in-DO state for assertions.

```typescript
// packages/workspace-do/src/__tests__/hibernation.test.ts
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("hibernation replay safety (STO-09)", () => {
  it("re-instantiates without re-running migrations or duplicating seeds", async () => {
    const id = env.WORKSPACE.idFromName("ws-replay-test");

    // First cold start — constructor runs migrations + seeds.
    await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
      const applied = state.storage.sql.exec(
        "SELECT version, name FROM _schema_migrations ORDER BY version",
      ).toArray();
      expect(applied).toEqual([{ version: 1, name: "v1_initial_schema", applied_at: expect.any(Number) }]);

      const seeds = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(seeds.n).toBe(7);
    });

    // Force a fresh instance — the test pool's isolatedStorage default re-allocates
    // the DO under the same name, which exercises the construct-replay path.
    // (See note in Open Questions about the exact mechanism for proving replay
    //  rather than just persistence — `runInDurableObject` is the right tool.)
    await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
      const applied = state.storage.sql.exec("SELECT COUNT(*) AS n FROM _schema_migrations").one();
      expect(applied.n).toBe(1);          // STILL 1 — migration didn't re-run

      const seeds = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(seeds.n).toBe(7);            // STILL 7 — seeds didn't duplicate
    });
  });
});
```

The key insight: if migrations re-ran on second construct, `_schema_migrations` would still have only 1 row (because the runner's `INSERT INTO _schema_migrations ... VALUES (1, ...)` would error on PK conflict — verifying that fail-loud behavior is itself a useful test). The dupe-detection comes from the seed count: if the seed loop re-ran *without* `INSERT OR IGNORE`, we'd see 14 rows in `memory_types`. The assertion `count === 7` proves idempotency holds across the replay.

### §4 — Defense-in-Depth Check (STO-07)

Every public method on `WorkspaceDO` calls a small helper at the top:

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

private assertOwnsWorkspace(workspaceId: string): void {
  if (this.ctx.id.name !== workspaceId) {
    throw new McpError(
      ErrorCode.InvalidRequest,      // -32600
      `Workspace mismatch: DO bound to '${this.ctx.id.name ?? "<unnamed>"}' but request claims '${workspaceId}'`,
    );
  }
}
```

**Why this works (verified):** Cloudflare's official `DurableObjectId` reference says explicitly:
> "If the caller accesses the Durable Object using `idFromString()`, `ctx.id.name` will be `undefined`, even if the ID was originally created with `idFromName()`."

And conversely: `idFromName(name).name === name`. So the check correctly rejects two attack patterns:
1. A caller who derived the DO via raw hex `idFromString(...)` — `id.name === undefined` ≠ any workspace_id.
2. A caller who got the right DO but lied about which workspace it represents in the args — `id.name === "ws-A"` ≠ `"ws-B"`.

Phase 3 will call helpers via `env.WORKSPACE.idFromName(this.props.workspace_id).get(...)` — that pathway sets `id.name` correctly and the check passes. Phase 4's penetration test (TOL-07) will *attempt* the attack and confirm the throw fires.

**SDK import path:** `@modelcontextprotocol/sdk/types.js` (the runtime-safe submodule export). The SDK is already a direct dep of `@engram/mcp-server` (REVIEW-FIX CR-01). Phase 2 needs to add it as a direct dep of `@engram/workspace-do` so it's not a phantom transitive — same pattern.

## Key APIs & Patterns

### §A — `blockConcurrencyWhile` Semantics

| Property | Value | Source |
|----------|-------|--------|
| Signature | `state.blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T>` | [CITED: developers.cloudflare.com/durable-objects/api/state/] |
| Concurrency guarantee | "No requests are delivered until initialization completes" | [CITED: Cloudflare best-practices/access-durable-objects-storage] |
| Constructor pattern | `void ctx.blockConcurrencyWhile(async () => { /* sync sql */ })` — runs once on cold start (and on every hibernation re-construct) | [CITED: workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/src/index.ts] |
| Timeout | 30 seconds → DO is reset if exceeded | [CITED: Cloudflare api/state] |
| Throw behavior | "Object terminates and resets unless wrapped in try-catch" | [CITED: Cloudflare api/state] |
| Cost model | "Significantly reduces throughput. If each call takes ~5ms, throughput drops to ~200 req/sec." | [CITED: Cloudflare rules-of-durable-objects] |
| What is FORBIDDEN inside | "Equivalent to holding a lock across I/O. Avoid for I/O operations entirely." | [CITED: Cloudflare rules-of-durable-objects] |

**Implication for Phase 2:** Schema migrations + seeding are pure SQL via the sync `sql.exec` API. Total work is ~10 DDL statements + 7 INSERT OR IGNOREs = well under a millisecond. Cold-start cost is invisible. This is exactly the use case `blockConcurrencyWhile` was designed for.

### §B — `storage.sql.exec` & `SqlStorageCursor`

| Property | Value | Source |
|----------|-------|--------|
| Signature | `exec(query: string, ...bindings: any[]): SqlStorageCursor` — synchronous | [CITED: Cloudflare api/sql-storage] |
| Parameter binding | **Positional `?` only** — no named parameters documented | [CITED: Cloudflare api/sql-storage] |
| Multi-statement | Allowed (semicolon-separated). Bindings apply only to the *last* statement. Cursor reflects only the last statement. | [CITED: Cloudflare api/sql-storage] |
| Cursor methods | `.next() → {done, value}`, `.toArray() → row[]`, `.one() → row` (throws if not exactly 1), `.raw() → array iterator` | [CITED: Cloudflare api/sql-storage] |
| Cursor exhaustion | Stateful — `.next()` then `.toArray()` returns only remaining rows | [CITED: Cloudflare api/sql-storage] |
| Transaction control | `BEGIN`/`COMMIT`/`SAVEPOINT` **forbidden** via exec. Use `ctx.storage.transactionSync(cb)` (sync) or `ctx.storage.transaction(cb)` (async). Each `.exec()` is already implicitly atomic. | [CITED: Cloudflare api/sql-storage] |
| PRAGMA support | `PRAGMA table_info` and `PRAGMA table_list` — both supported via `.exec()` (used in Cloudflare's official seat-booking tutorial) | [CITED: Cloudflare tutorials/build-a-seat-booking-app — uses `sql.exec('PRAGMA table_list')` directly] |
| BigInt precision | "Numeric values affected by JavaScript's 52-bit precision. Storing very large `int64` then retrieving may return a less precise value." | [CITED: Cloudflare api/sql-storage] |

**Phase 2 usage rules:**
- Use positional `?` everywhere; never assume `:name` works.
- Use `.one()` for `getBlock(id)` / `getMemoryType(id)` — auto-throws on miss, which combined with a try/catch wrapper produces the `NotFoundError` per D-02.
- Use `.toArray()` for list helpers (`listMemoryTypes`, `listConflicts`).
- Don't wrap migrations in `ctx.storage.transactionSync` — implicit atomicity is enough for a single sequential DDL run.
- Timestamps are `INTEGER` (millisecond unix epoch) — fits well under 2^53 for the next ~280k years, so the BigInt precision warning is moot. Document this explicitly so a future contributor doesn't try to store nanosecond timestamps.

### §C — `DurableObjectId.name` Population

| Construction path | `id.name` value | Source |
|-------------------|----------------|--------|
| `env.NS.idFromName("ws-alice").name` | `"ws-alice"` (string) | [CITED: Cloudflare api/id] |
| `env.NS.idFromString(hex).name` | `undefined` (even if originally created via idFromName) | [CITED: Cloudflare api/id] |
| `env.NS.newUniqueId().name` | `undefined` | [CITED: Cloudflare api/id] |

**Implication for STO-07:** The defense-in-depth check `this.ctx.id.name !== args.workspace_id` correctly:
- Passes when the caller used `env.WORKSPACE.idFromName(workspace_id).get(...)` — the expected MCP-server pathway from Phase 3.
- Throws when the caller used `idFromString(hex)` — the attack vector TOL-07 will exercise.
- Throws when the args lie about the workspace_id, even on the right DO.

The check is on `this.ctx.id`, not `this.state.id` — naming matches the modern `DurableObject` base class (the `ctx` parameter passed to the constructor). The Phase 1 stub uses `extends DurableObject`, so `this.ctx` is available without extra wiring. (`state.id.name` works too — they're the same object — but standard 2026 examples use `ctx`.)

### §D — `@cloudflare/vitest-pool-workers` Test Harness

**Reference fixture (verified — official Cloudflare-maintained):**
`github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/durable-objects`

**Files in that fixture:**
- `vitest.config.ts` — uses `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })`
- `wrangler.jsonc` — declares `durable_objects.bindings` + `migrations.new_sqlite_classes`
- `src/index.ts` — both a `Counter` (KV-backed) and `SQLiteDurableObject` example
- `src/env.d.ts` — auto-generated env types via `wrangler types`
- `test/direct-access.test.ts` — `runInDurableObject` pattern
- `test/sqlite-in-do.test.ts` — proves SQL API works inside the pool

**Minimal `vitest.config.ts` shape for Phase 2:**

```typescript
// packages/workspace-do/vitest.config.ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
});
```

**`wrangler.test.jsonc`** — a test-only wrangler config (because `@engram/workspace-do` is library-only and has no production `wrangler.jsonc` per Phase 1 D-10):

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "workspace-do-test",
  "main": "src/index.ts",
  // Omit compatibility_date — the test pool infers the latest, per the official
  // Cloudflare fixture's pattern. Phase 2's lint:wrangler runs only against
  // packages/*/wrangler.jsonc (note: not .test.jsonc), so this won't be linted.
  "durable_objects": {
    "bindings": [{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["WorkspaceDO"] }],
}
```

⚠ **The lint glob in `scripts/lint-wrangler.mjs` is `packages/*/wrangler.jsonc`** — explicitly named `wrangler.jsonc`, not `*wrangler*.jsonc`. So `wrangler.test.jsonc` will NOT be picked up by FND-08. Good (intentional or accidental — it works for Phase 2).

**Test imports:**

```typescript
import { runInDurableObject, listDurableObjectIds } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { WorkspaceDO } from "../index.js";
```

**Test runtime guarantee:** Tests run inside real `workerd` — the same runtime that ships to production. SQLite semantics are identical. Not an emulation. [CITED: Cloudflare workers/testing/vitest-integration]

**Recommended test scripts** to add to `packages/workspace-do/package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

And to root `package.json`:

```json
{
  "scripts": {
    "test": "npm run test --workspaces --if-present"
  }
}
```

### §E — JSON Column Handling (D-03)

**Convention:** TEXT columns store stringified JSON. `JSON.parse` on read in the helper; `JSON.stringify` on write. Callers receive typed objects (e.g., `Memory.properties: Record<string, unknown> | null`).

```typescript
// Read pattern
const row = sql.exec("SELECT id, properties FROM blocks WHERE id = ?", id).one();
const props = row.properties === null ? null : JSON.parse(row.properties as string);

// Write pattern
sql.exec(
  "INSERT INTO blocks (id, properties, ...) VALUES (?, ?, ...)",
  block.id, block.properties === null ? null : JSON.stringify(block.properties), ...
);
```

**`noUncheckedIndexedAccess` narrowing:** `sql.exec(...).one()` returns `Record<string, SqlStorageValue>` where each property is `T | undefined`. Helpers must narrow before returning:

```typescript
const row = sql.exec("SELECT * FROM blocks WHERE id = ?", id).one();
const id = row.id;
if (typeof id !== "string") throw new NotFoundError("block", String(id));
// ... narrow each typed field similarly, or write a small `narrowBlockRow(row)` helper.
```

**Alternative for the future** (NOT for Phase 2): SQLite's `json_extract()` works in DOs (JSON1 extension is supported per Cloudflare's documented SQLite extension list). Phase 4 may push some filter predicates into SQL (e.g., `WHERE json_extract(properties, '$.status') = 'applied'`) if hot paths emerge.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 + `@cloudflare/vitest-pool-workers` 0.16.9 |
| Config file | `packages/workspace-do/vitest.config.ts` (Wave 0 creates) |
| Quick run command | `npm test --workspace @engram/workspace-do -- --run` |
| Full suite command | `npm test` (delegates to all workspaces via `--workspaces --if-present`) |
| CI integration | New step in `.github/workflows/ci.yml` after `lint:wrangler` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| STO-01 | `WorkspaceDO` exported from `@engram/workspace-do`, bound in mcp-server wrangler under `new_sqlite_classes` | typecheck + existing FND-08 lint | `npm run typecheck && npm run lint:wrangler` | ✅ existing |
| STO-02 | Migration runner uses `_schema_migrations` table, runs in `blockConcurrencyWhile` | unit (vitest in pool) | `vitest run schema.test.ts` | ❌ Wave 0 (`src/__tests__/schema.test.ts`) |
| STO-03 | All 7 tables created with correct columns | introspection unit (PRAGMA table_info per table) | `vitest run schema.test.ts` | ❌ Wave 0 (same file) |
| STO-04 | `blocks` has `embedding_model TEXT` + `embedding_version INTEGER` | introspection unit (PRAGMA table_info(blocks)) | `vitest run schema.test.ts` | ❌ Wave 0 (same file) |
| STO-05 | 7 system memory_types seeded; second seed-run produces no duplicates | unit (`SELECT COUNT(*) FROM memory_types`) | `vitest run seeding.test.ts` | ❌ Wave 0 (`src/__tests__/seeding.test.ts`) |
| STO-06 | 7 query helpers work end-to-end | unit (per-helper test) | `vitest run helpers.test.ts` | ❌ Wave 0 (`src/__tests__/helpers.test.ts`) |
| STO-07 | `assertOwnsWorkspace` throws `McpError(InvalidRequest)` on mismatch | unit (positive: passes; negative: throws with code -32600) | `vitest run defense-in-depth.test.ts` | ❌ Wave 0 (`src/__tests__/defense-in-depth.test.ts`) |
| STO-08 | Vitest suite green in CI | meta — the test step in CI | covered by the workflow step | ❌ Wave 0 (CI workflow patch) |
| STO-09 | Hibernation replay doesn't duplicate/re-run | unit (per "Implementation Approach §3" recipe) | `vitest run hibernation.test.ts` | ❌ Wave 0 (`src/__tests__/hibernation.test.ts`) |
| STO-10 | Lint script flags forbidden tokens; CI fails on regression | lint script + meta-test of the script itself | `npm run lint:blockconcurrency && vitest run blockconcurrency-lint.test.ts` | ❌ Wave 0 (`scripts/lint-blockconcurrency.mjs` + `src/__tests__/blockconcurrency-lint.test.ts` + good/bad fixtures) |

### Sampling Rate
- **Per task commit:** `npm test --workspace @engram/workspace-do -- --run`
- **Per wave merge:** `npm test && npm run lint && npm run lint:wrangler && npm run lint:blockconcurrency`
- **Phase gate:** Full suite green + all 5 lint scripts green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/workspace-do/vitest.config.ts` — pool plugin config
- [ ] `packages/workspace-do/wrangler.test.jsonc` — test-only wrangler config so the test pool resolves the DO binding
- [ ] `packages/workspace-do/src/__tests__/schema.test.ts` — covers STO-02, STO-03, STO-04
- [ ] `packages/workspace-do/src/__tests__/seeding.test.ts` — covers STO-05
- [ ] `packages/workspace-do/src/__tests__/helpers.test.ts` — covers STO-06 (one `it` per helper)
- [ ] `packages/workspace-do/src/__tests__/hibernation.test.ts` — covers STO-09
- [ ] `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` — covers STO-07
- [ ] `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` — proves `scripts/lint-blockconcurrency.mjs` itself works (Russell's "instrument the lint for its own sanity check" question). One `it` for "flags `env.` inside the block"; one for "ignores `env.` outside the block"; one for "exit code 0 / 1 / 2 matrix".
- [ ] `packages/workspace-do/src/__tests__/fixtures/bad-blockconcurrency.ts` — `await env.AI.run(...)` inside the block; lint must catch
- [ ] `packages/workspace-do/src/__tests__/fixtures/good-blockconcurrency.ts` — pure sync SQL; lint must pass
- [ ] Framework install: `npm install --save-dev --workspace @engram/workspace-do @cloudflare/vitest-pool-workers@^0.16.9 vitest@^4.1.7`
- [ ] Root `package.json` — add `"test": "npm run test --workspaces --if-present"`
- [ ] `.github/workflows/ci.yml` — add `Lint blockConcurrencyWhile I/O (STO-10)` step between `lint` and `lint:wrangler`; add `Test (Vitest)` step after the smoke steps
- [ ] `.lintstagedrc.json` — add `"packages/workspace-do/src/**/*.ts": ["node scripts/lint-blockconcurrency.mjs", "eslint --fix", "prettier --write"]` rule

## Pitfalls & Anti-Patterns

### Pitfall 1: Async work inside `blockConcurrencyWhile`
**What goes wrong:** Adding `await fetch(...)`, `await env.AI.run(...)`, or any non-storage async inside the constructor's `blockConcurrencyWhile` block blocks ALL incoming requests for the duration. At 5ms per call, throughput collapses to ~200 req/sec; at 200ms, the entire workspace stalls. If the work exceeds 30 seconds, the DO is reset.
**Why it happens:** The pattern *looks* like a regular `async` function — TypeScript doesn't flag the violation, and the API accepts any async callback.
**How to avoid:** STO-10's lint script enforces this statically. Inside the construct block: only `sql.exec` (sync), pure JS, console.log. Any `await` on `env.*` or `fetch(...)` fails the lint.
**Warning signs:** A reviewer sees `await` inside the block — automatic flag. The lint catches it before review.

### Pitfall 2: `PRAGMA user_version` is unsupported
**What goes wrong:** Common SQLite migration tutorials use `PRAGMA user_version` to track schema state. In workerd's SQLite it returns 0 / silently no-ops (Cloudflare's "Rules of Durable Objects" explicitly: "PRAGMA user_version is not supported. Track migrations manually using a `_sql_schema_migrations` table.")
**Why it happens:** Pattern recognition from non-DO SQLite work bleeds in.
**How to avoid:** STO-02 is *explicit* about not using PRAGMA user_version. The `_schema_migrations` table is the required mitigation. Code review checklist: any PRAGMA usage in migrations.ts is suspicious.
**Warning signs:** Anything that reads `PRAGMA user_version` and branches on the result.

### Pitfall 3: `JSON.parse(null)` returns `null` but `JSON.parse(undefined)` throws
**What goes wrong:** SQLite TEXT columns can be `NULL`. `noUncheckedIndexedAccess` makes `row.properties` typed as `SqlStorageValue | undefined`. If a row has `properties=NULL`, the cursor returns `null` (not `undefined`), but a narrowing bug could let `undefined` slip through.
**Why it happens:** The two-null-types-in-TypeScript trap.
**How to avoid:** Helpers explicitly handle both: `props = row.properties == null ? null : JSON.parse(row.properties as string)`. The `==` (loose equality) catches both `null` and `undefined`.
**Warning signs:** Tests pass but real workspace DOs throw `SyntaxError: Unexpected token u in JSON at position 0` (the classic stringified-undefined error).

### Pitfall 4: `JSON.stringify` round-trip is lossy for `undefined`
**What goes wrong:** `JSON.stringify({a: 1, b: undefined})` returns `'{"a":1}'`. The `b` field disappears. On read, callers expecting `b` get `undefined` *for the wrong reason*.
**Why it happens:** JSON has no `undefined` — only `null`.
**How to avoid:** Helpers that write JSON columns normalize input: `Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : v]))` before stringify. Or, document the contract: "callers must pass `null` for missing fields, not `undefined`." The latter is enough for v0.1.
**Warning signs:** Round-trip tests that pass for `{a: 1}` but fail for `{a: 1, b: undefined}`.

### Pitfall 5: `INTEGER` columns over 2^53
**What goes wrong:** Cloudflare's docs warn: "Numeric values affected by JavaScript's 52-bit precision." Storing `9_007_199_254_740_993n` returns `9_007_199_254_740_992`. Silently wrong.
**Why it happens:** SQLite's `INTEGER` is int64; JS `number` is double.
**How to avoid:** Phase 2's timestamps are ms-unix-epoch — `Date.now()` is well under 2^53 for the next ~280k years. Document this in the migration file's leading comment. If Phase 5+ ever stores nanosecond timestamps or external IDs that overflow, store as TEXT.
**Warning signs:** Test data with literal 16+ digit integers.

### Pitfall 6: `noUncheckedIndexedAccess` + `SqlStorageValue` requires narrowing on every column
**What goes wrong:** `row.id` is typed `SqlStorageValue | undefined` (a union of `string | number | ArrayBuffer | null | undefined`). Returning `row.id` from `getBlock()` violates the helper's `Memory.id: string` contract.
**Why it happens:** TS strictness pushes the burden of narrowing onto the helper, not the caller. Easy to skip with a cast.
**How to avoid:** Write a `narrowBlockRow(row): Memory` helper that does all the type checks in one place and throws if the schema-vs-runtime invariant breaks (which would be an actual bug). Cast-and-pray is forbidden by the project's strict TS posture.
**Warning signs:** `as Memory` or `// @ts-expect-error` near a row return.

### Pitfall 7: Cursor exhaustion bug
**What goes wrong:** Calling `cursor.next()` then `cursor.toArray()` returns rows 2+, not all rows. The cursor is stateful.
**Why it happens:** Different from common iterator semantics where `.toArray()` rewinds.
**How to avoid:** Pick one consumption pattern per query. Either `.toArray()` (returns all), `.one()` (returns the one), or iterate manually. Never mix.
**Warning signs:** Off-by-one row counts in tests.

### Pitfall 8: Multi-statement query gotcha
**What goes wrong:** `sql.exec("CREATE TABLE foo (...); CREATE TABLE bar (...);", ...)` — bindings only apply to the *last* statement; cursor only reflects the *last* statement. If you pass `?` placeholders in the first statement, they're SQL-injected from the binding intended for the second.
**Why it happens:** Documented but easy to miss.
**How to avoid:** Migrations use raw DDL with no bindings — safe. For any helper that builds dynamic SQL, one `?` per call is the rule.
**Warning signs:** A migration string with `?` placeholders. None of Phase 2's DDL has them — flag any drift.

### Anti-Pattern: Mocking the DO instead of using `runInDurableObject`
**Why bad:** Phase 2's whole point is exercising real SQLite + real `blockConcurrencyWhile`. A mock that returns `{success: true}` will pass tests while production blows up.
**Do instead:** Always test through `runInDurableObject(stub, async (instance, state) => { ... })`. The pool handles isolation.

### Anti-Pattern: `try { ... } catch { throw new NotFoundError(...) }` swallowing all errors
**Why bad:** `.one()` throws on both "zero rows" AND "more than one row". Swallowing both as `NotFoundError` masks the latter as a non-issue when it's actually a corrupted schema.
**Do instead:** Check the row count distinctly. Cleaner pattern: `const rows = sql.exec(...).toArray(); if (rows.length === 0) throw new NotFoundError(...); if (rows.length > 1) throw new Error("invariant violated: multiple rows for PK");`. Or just trust `.one()` to throw a recognizable error and document the distinction.

### Anti-Pattern: Storing the wrangler env type in `WorkspaceDO`
**Why bad:** The Phase 1 stub passes `env: Env` to the constructor, but in Phase 2 we have no MCP-Worker-level env to forward. The DO doesn't need `env.AI` or `env.VECTORIZE` — those are Phase 5. Adding them to `Env` here forces all of Phase 5's bindings to land prematurely.
**Do instead:** Type the DO constructor's env parameter as `unknown` or the empty interface `{}` for Phase 2. Phase 5 widens it when AI bindings are needed.

## File-by-File Sketch

### Files the planner should CREATE in Phase 2

| Path | Purpose | One-line summary |
|------|---------|------------------|
| `packages/workspace-do/src/migrations.ts` | The migration registry + runner | `MIGRATIONS` array + `runMigrations(sql: SqlStorage): void` — synchronous, idempotent, ~40 LOC |
| `packages/workspace-do/src/schema.sql` (or const in migrations.ts) | The v1 DDL block | Verbatim from "Implementation Approach §2"; 7 tables + indexes + STO-04 columns |
| `packages/workspace-do/src/seeding.ts` | System type seeding loop | `seedSystemTypes(sql: SqlStorage): void` — iterates `SYSTEM_TYPES` with `INSERT OR IGNORE` |
| `packages/workspace-do/src/queries.ts` | 7 typed query helpers (STO-06) | One function per helper: `insertBlock`, `getBlock`, `lexicalSearchBlocks`, `deleteBlock`, `listMemoryTypes`, `createInboxEntry`, `listConflicts` |
| `packages/workspace-do/src/errors.ts` | `NotFoundError` class | `class NotFoundError extends Error { resource: string; id: string; }` (D-02) |
| `packages/workspace-do/src/types.ts` | Query-specific types not in `@engram/types` | `MemoryType`, `InboxEntry`, `LexicalSearchHit`, row narrowing types |
| `packages/workspace-do/src/index.ts` (REWRITE from Phase 1 stub) | `WorkspaceDO` body | Constructor runs `blockConcurrencyWhile` → migrations → seeding. Methods call `assertOwnsWorkspace` + delegate to `queries.ts` helpers |
| `packages/workspace-do/vitest.config.ts` | Vitest pool plugin config | `defineProject({ plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })] })` |
| `packages/workspace-do/wrangler.test.jsonc` | Test-only wrangler config | Declares `WorkspaceDO` binding + v1 migration so the pool can resolve it. NOT picked up by FND-08 lint (glob is `wrangler.jsonc`, not `*.test.jsonc`) |
| `packages/workspace-do/package.json` (UPDATE) | Add devDeps + test scripts | Adds `@cloudflare/vitest-pool-workers`, `vitest`, `@modelcontextprotocol/sdk` (direct dep — same CR-01 pattern), and `"test": "vitest run"` |
| `packages/workspace-do/src/__tests__/schema.test.ts` | STO-02, STO-03, STO-04 | Asserts: `_schema_migrations` has 1 row; PRAGMA table_info shows all 7 tables with expected columns; `blocks` includes `embedding_model` + `embedding_version` |
| `packages/workspace-do/src/__tests__/seeding.test.ts` | STO-05 | Asserts: `memory_types` count is 7 after first init; running seeding twice keeps it at 7; each system type id matches `SYSTEM_TYPES` |
| `packages/workspace-do/src/__tests__/helpers.test.ts` | STO-06 (7 sub-tests) | One `describe` per helper; covers happy path + edge case (cascade, LIKE escaping if needed, JSON round-trip) |
| `packages/workspace-do/src/__tests__/hibernation.test.ts` | STO-09 | "Implementation Approach §3" recipe |
| `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` | STO-07 | Two cases: passes when `id.name === workspaceId`; throws `McpError(InvalidRequest)` when mismatched |
| `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` | Sanity check for STO-10 lint | Invokes `scripts/lint-blockconcurrency.mjs` as a subprocess on good/bad fixtures; asserts exit codes |
| `packages/workspace-do/src/__tests__/fixtures/bad-blockconcurrency.ts` | Lint negative fixture | Contains `await env.AI.run(...)` inside a `blockConcurrencyWhile` block |
| `packages/workspace-do/src/__tests__/fixtures/good-blockconcurrency.ts` | Lint positive fixture | Pure synchronous SQL inside the block |
| `scripts/lint-blockconcurrency.mjs` | STO-10 lint script (D-09) | Mirrors `lint-wrangler.mjs` structure. Dual-mode (no-arg glob over `packages/workspace-do/src/**/*.ts`; positional file list). Exit codes 0/1/2. Forbidden tokens: `env.`, `fetch(`, `await this.ai`, `await ctx.storage.transaction(`, `await import(`, `await this.env`. ~80-120 LOC |

### Files the planner should UPDATE in Phase 2

| Path | Change | Why |
|------|--------|-----|
| `package.json` (root) | Add `"lint:blockconcurrency": "node scripts/lint-blockconcurrency.mjs"` and `"test": "npm run test --workspaces --if-present"` | Wires the new scripts. |
| `.github/workflows/ci.yml` | Insert `Lint blockConcurrencyWhile I/O (STO-10)` step between `lint` and `lint:wrangler`. Add `Test (Vitest)` step after the smoke tests | D-11 ordering; STO-08 CI gate. |
| `.lintstagedrc.json` | Add `"packages/workspace-do/src/**/*.ts": ["node scripts/lint-blockconcurrency.mjs"]` (note: this glob runs the script INSTEAD of the default lint chain for these files? OR as an ADDITIONAL step? Recommend: ADDITIONAL — append before eslint/prettier so lint failures surface early) | Pre-commit enforcement matches CI. |

### Files the planner should NOT TOUCH

- `packages/mcp-server/wrangler.jsonc` — Locked by D-06. v2 migration lands in Phase 3.
- `packages/mcp-server/src/index.ts` — Re-export of `WorkspaceDO` is sufficient; Phase 3 adds tool wiring.
- `shared/types/src/index.ts` — `Memory` type already matches the column shape (note JSDoc on `Memory` says `embedding_model`/`embedding_version` will be added in Phase 2 — they will be added to the TYPE in Phase 2 if needed for query helper return shapes; OR documented as deferred to Phase 5 if helpers don't read those columns yet).
- `shared/schema/src/system-types.ts` — Read-only source of truth for the seed loop.
- `scripts/lint-wrangler.mjs` — Phase 2's `lint-blockconcurrency.mjs` is a sibling, not a modification.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `wrangler.test.jsonc` (with `.test.jsonc` suffix) is NOT matched by the FND-08 lint glob `packages/*/wrangler.jsonc` | Implementation Approach §D | LOW — verified by inspecting `scripts/lint-wrangler.mjs` line 37 (`packages/*/wrangler.jsonc` is a literal filename glob). If wrong, the test-only config triggers FND-08 false-positive; planner can rename to `vitest-wrangler.jsonc` to avoid. |
| A2 | `@cloudflare/vitest-pool-workers` 0.16.9 + Vitest 4.1.7 are peer-compatible | Standard Stack | LOW — official Cloudflare fixture uses both, last commit 2026. If wrong, the planner pins the version pair recommended by Cloudflare's README. |
| A3 | Cloudflare `runInDurableObject` re-allocates a fresh in-memory instance per call when invoked separately (simulating hibernation) | Implementation Approach §3 | MEDIUM — this is the basis of the STO-09 test recipe. Open Question O1 below tracks an alternative if it doesn't hold; the fallback is to use `state.acceptWebSocket` + close, or just trust that idempotency over the *persisted* state is what STO-09 actually means. |
| A4 | Multi-statement `sql.exec(ddl_string)` is atomic enough for the v1 migration without explicit `transactionSync` wrapping | Implementation Approach §2 | LOW — Cloudflare docs say each `.exec()` is implicitly atomic. If wrong, wrap in `ctx.storage.transactionSync(() => { ... })`. |
| A5 | `lint-staged` should run `lint-blockconcurrency.mjs` IN ADDITION to eslint/prettier (not instead of) for the `packages/workspace-do/src/**/*.ts` glob | File-by-File Sketch (UPDATE table) | LOW — this is a config preference. Planner picks. |
| A6 | `vitest@^4.1.7`'s SUS flag from slopcheck is a false positive | Package Legitimacy Audit | NEAR ZERO — vitest is one of the most-downloaded npm packages (~10M/wk) and is the locked test framework from CONTEXT.md. Documented to prevent re-litigation. |
| A7 | The test pool's `runInDurableObject` instance creation invokes the real DO constructor (with `blockConcurrencyWhile`), not a mocked construct path | Validation Architecture | LOW — Cloudflare's `direct-access.test.ts` fixture's `Counter` runs `ctx.blockConcurrencyWhile` in its constructor and the test reads instance state, proving the constructor ran. |

## Open Questions

### O1 — Exact mechanism for "simulating hibernation" in `@cloudflare/vitest-pool-workers`

**What we know:** `runInDurableObject(stub, cb)` runs cb inside the DO's instance. The pool's `isolatedStorage` default is per-test, but within a single test, two `runInDurableObject(env.WORKSPACE.get(id), ...)` calls on the same `id` may or may not re-instantiate (depends on pool internals — the DO may stay warm in the pool's worker isolate for the duration of the test).

**What's unclear:** Whether the test as drafted in "Implementation Approach §3" actually exercises constructor *replay*, or just exercises *persistence across calls*. Both prove the broader STO-09 invariant ("re-init is safe"), but the test wording is more honest if it's known.

**Recommendation:** Plan the test as drafted (it provably covers persistence + idempotency, which IS what STO-09 specifies — "does not re-run completed migrations and does not duplicate seed data"). If the planner wants stronger replay guarantees, add a comment noting the test covers the *observable* invariant and that worker-isolate-level eviction can't be deterministically forced from the test pool. This is HONEST about the test's scope and is enough for STO-09.

### O2 — `wrangler.test.jsonc` vs reusing the production binding

**What we know:** The library-only `@engram/workspace-do` package has no production `wrangler.jsonc` (Phase 1 D-10). The test pool needs *some* wrangler config to resolve the DO binding.

**What's unclear:** Whether `cloudflareTest` can be pointed at `../mcp-server/wrangler.jsonc` (the production config that DOES declare WORKSPACE) instead of a test-local config. Reusing the prod config keeps "single source of truth" and avoids drift.

**Recommendation:** Start with a local `wrangler.test.jsonc` (simpler — no cross-package coupling in tests). Revisit only if the two configs drift in a way that masks bugs. Document the choice in the file's header comment.

### O3 — `assertOwnsWorkspace` arg position

**What we know:** Every public method on `WorkspaceDO` needs to call the check. The natural shape is `method(args: { workspace_id: string; ...rest })` where the first thing each method does is `this.assertOwnsWorkspace(args.workspace_id)`.

**What's unclear:** Whether to enforce this with a TypeScript pattern (a base `protected callWithCheck` wrapper, or a decorator) or just by convention + an ESLint rule.

**Recommendation:** Convention + an eslint rule that flags any method on `WorkspaceDO` whose body doesn't start with `this.assertOwnsWorkspace(...)`. Defer the rule itself to Phase 4 if cheap; for Phase 2 just rely on code review + the `defense-in-depth.test.ts` per-method positive case (one test per method asserts the throw fires on mismatch — this is naturally redundant but bulletproof).

### O4 — Whether to gate the lint script's "good fixture must pass" assertion in CI

**What we know:** FND-08's pattern (per `.github/workflows/ci.yml`) has both negative-fixture and positive-fixture CI assertions for `lint-wrangler.mjs`. Phase 2 should mirror.

**What's unclear:** Nothing — the answer is yes, mirror it. Listed here for the planner's checklist so it doesn't get forgotten.

**Recommendation:** Plan adds the same 3-step CI block for `lint-blockconcurrency.mjs`: main step (full-scan), negative-fixture invert-exit, positive-fixture pass. Same exit-code matrix.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All build + test | ✓ | v22.14.0 (system) | None — but see ⚠ below |
| npm | Workspace mgmt | ✓ | 11.15.0 | — |
| Wrangler | DO type generation + test pool | ✓ | 4.94.0 (installed) | — |
| `@cloudflare/workers-types/experimental` | Type augmentation for DO + SqlStorage | ✓ | 4.20260525.1 (installed) | — |
| Cloudflare account / API token | Only needed for `wrangler deploy` (Phase 7) | N/A | — | None needed for Phase 2 (tests run fully local in workerd) |

⚠ **Node engine drift:** During slopcheck runs, npm complained that `lint-staged@17.0.5` requires Node `>=22.22.1` but the system has 22.14.0. This is a Phase 1 latent issue — Phase 2 isn't introducing the conflict — and the dev environment otherwise works. Surface this so the planner can either bump `.nvmrc` to 22.22+ (low risk; user controls the .nvmrc) or pin `lint-staged` to a compatible older version. Doesn't block Phase 2.

**Missing dependencies with no fallback:** None.

## Sources

### Primary (HIGH confidence)
- [Cloudflare Durable Objects — SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) — cursor methods, parameter binding, BigInt precision warning
- [Cloudflare Durable Objects — Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) — `_sql_schema_migrations` recommendation, `PRAGMA user_version` unsupported, `blockConcurrencyWhile` throughput tradeoff
- [Cloudflare Durable Objects — Best Practices: Access Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) — constructor + `blockConcurrencyWhile` pattern
- [Cloudflare Durable Objects — State API](https://developers.cloudflare.com/durable-objects/api/state/) — `blockConcurrencyWhile` signature, 30s timeout, throw behavior
- [Cloudflare Durable Objects — Id API](https://developers.cloudflare.com/durable-objects/api/id/) — `idFromName().name` populated; `idFromString().name === undefined`
- [Cloudflare Durable Objects — Migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) — `new_sqlite_classes` append-only, atomic deploy
- [Cloudflare Durable Objects — Seat-booking tutorial](https://developers.cloudflare.com/durable-objects/tutorials/build-a-seat-booking-app/) — real example using `PRAGMA table_list` + `INSERT OR IGNORE` idempotent seeding
- [Cloudflare Workers Testing — Vitest Integration: Test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/) — `runInDurableObject`, `runDurableObjectAlarm`, `createExecutionContext`
- [Cloudflare workers-sdk fixtures — durable-objects example](https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/durable-objects) — verified `vitest.config.ts` + `wrangler.jsonc` + test patterns including `SQLiteDurableObject`
- Local file inspection: `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` — `McpError` class + `enum ErrorCode { InvalidRequest = -32600, ... }` exports verified

### Secondary (MEDIUM confidence)
- [Cloudflare blog — Zero-latency SQLite storage in every Durable Object](https://blog.cloudflare.com/sqlite-in-durable-objects/) — output gate / sync model
- [Cloudflare D1 SQL API — Query JSON](https://developers.cloudflare.com/d1/sql-api/query-json/) — `json_extract` pattern (D1 docs, but the JSON1 extension behaves identically in DOs)
- [Cloudflare workers-sdk vitest-pool-workers package directory](https://github.com/cloudflare/workers-sdk/tree/main/packages/vitest-pool-workers) — package overview

### Tertiary (LOW confidence — verified against primary)
- [durable-utils GitHub](https://github.com/lambrospetrou/durable-utils) — SQLSchemaMigrations API (read source; confirmed it uses KV key not table)
- npm registry queries for `@cloudflare/vitest-pool-workers`, `vitest`, `durable-utils`, `ts-morph`, `@typescript-eslint/parser` versions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every recommended package verified via npm registry + slopcheck + (where it matters) source inspection. `vitest` SUS flag documented as false positive.
- Architecture: HIGH — `blockConcurrencyWhile` constructor + `_schema_migrations` table pattern is Cloudflare's documented recommendation, and the official seat-booking tutorial models it.
- Defense-in-depth (STO-07): HIGH — `id.name` population semantics directly cited from official `DurableObjectId` API docs.
- Hibernation test recipe (STO-09): MEDIUM — the recipe covers the observable invariant required by STO-09 (no migration re-run, no seed dupe), but the exact mechanism by which `@cloudflare/vitest-pool-workers` exercises constructor replay vs. instance persistence is not documented at the granularity needed for a stronger claim. Open Question O1.
- Pitfalls: HIGH — every pitfall has a documented source or is observable in code (JSON.parse(undefined), cursor exhaustion, multi-statement binding).
- Lint script structure: HIGH — copy of working FND-08 pattern; just swap the regex.

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (the Cloudflare DO+SQLite surface has been stable for >12 months; vitest-pool-workers releases roughly monthly — re-check before Phase 2 actually executes if more than 30 days elapse)

## RESEARCH COMPLETE
