# Phase 2: WorkspaceDO + SQLite — Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 17 CREATE + 4 MODIFY = 21 file decisions
**Analogs found:** 21 / 21
- **In-repo analogs (high-leverage):** 14 — every config/script/test-harness file has a Phase 1 sibling that should be mirrored byte-for-byte where possible.
- **In-repo + external supplement:** 5 — the DO body, migration runner, seeding loop, query helpers, and `wrangler.test.jsonc` start from in-repo Phase 1 stubs but the *body* of each is structurally novel and follows the Cloudflare fixture patterns documented in `02-RESEARCH.md §Key APIs`.
- **External only (no in-repo analog yet):** 2 — Vitest test files. Phase 1 shipped zero `*.test.ts` files; the planner must follow the verbatim Cloudflare-maintained `vitest-pool-workers-examples/durable-objects` fixture cited in `02-RESEARCH.md §D`.

---

## Phase 2 Special Note

Phase 1 was the patterns-establishing phase. Phase 2 is **mostly mirroring Phase 1** — the toolchain (eslint, prettier, husky, lint-staged, jsonc lint), the script style (`scripts/lint-*.mjs`), the CI layout (`.github/workflows/ci.yml`), the package layout (TS-source `exports` field, no `dist/`), and the wrangler conventions are all already established. The planner should preferentially **copy in-repo patterns** rather than re-derive from RESEARCH.md.

The five places where Phase 1 has **no analog**:

| Novelty | What to follow instead |
|---------|-----------------------|
| The `WorkspaceDO` class body (constructor + methods) | `02-RESEARCH.md §A,B,C,E` + Cloudflare `seat-booking` tutorial pattern |
| The hand-rolled `_schema_migrations` runner | `02-RESEARCH.md §1 (Migration Runner Design)` — the registry shape is 100% prescribed |
| The seed loop (`INSERT OR IGNORE`) | CLAUDE.md §"Memory Types" + `02-RESEARCH.md §2` |
| Any Vitest test file | Cloudflare-maintained `workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/` (cited verbatim in `02-RESEARCH.md §D`) |
| `wrangler.test.jsonc` (library-only test config) | `02-RESEARCH.md §D` — minimal shape provided |

Everything else (the lint script, the CI step block, the package.json scripts, the lint-staged glob, the fixture file structure) is a **direct mirror** of an existing Phase 1 file.

---

## File Classification

### CREATE (17 files)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/workspace-do/src/index.ts` (REWRITE from stub) | DurableObject class body | request-response (RPC) | `packages/mcp-server/src/index.ts` (sibling Worker entry) + Cloudflare seat-booking fixture | partial — class scaffold mirrors Phase 1 stub; method bodies novel |
| `packages/workspace-do/src/migrations.ts` | migration runner | batch (cold-start, sync SQL) | `02-RESEARCH.md §1` (no in-repo analog) | external prescribed |
| `packages/workspace-do/src/schema.ts` | DDL string constants | data/config | `shared/schema/src/system-types.ts` (sibling data-as-constants module) | role-match |
| `packages/workspace-do/src/seeding.ts` | system-type seed loop | batch (sync iteration) | CLAUDE.md §"Memory Types" + `02-RESEARCH.md §2` | external prescribed |
| `packages/workspace-do/src/queries.ts` | typed query helpers | CRUD (sync SQL) | `02-RESEARCH.md §B,E` + `shared/types/src/index.ts` (return-shape source) | external + role-match |
| `packages/workspace-do/src/errors.ts` | `NotFoundError` class | exception type | `shared/types/src/index.ts` (sibling type/class module style) | role-match (new pattern, but JS-idiomatic) |
| `packages/workspace-do/src/types.ts` | query-specific types | type defs | `shared/types/src/index.ts` (verbatim convention: barrel-style JSDoc, `interface` over `type` for objects) | exact-template |
| `packages/workspace-do/vitest.config.ts` | Vitest pool config | test infra | No in-repo analog — Cloudflare fixture `vitest-pool-workers-examples/durable-objects/vitest.config.ts` | external verbatim |
| `packages/workspace-do/wrangler.test.jsonc` | test-only wrangler config | test infra | `packages/triage-worker/wrangler.jsonc` (minimal sibling wrangler) + `packages/mcp-server/wrangler.jsonc` (DO binding) | partial-mix |
| `packages/workspace-do/src/__tests__/schema.test.ts` | STO-02/03/04 schema test | test (introspection) | No in-repo analog — Cloudflare fixture `direct-access.test.ts` | external verbatim |
| `packages/workspace-do/src/__tests__/seeding.test.ts` | STO-05 idempotency test | test | Same — external Cloudflare fixture | external verbatim |
| `packages/workspace-do/src/__tests__/helpers.test.ts` | STO-06 per-helper test | test (CRUD) | Same — external Cloudflare fixture | external verbatim |
| `packages/workspace-do/src/__tests__/hibernation.test.ts` | STO-09 replay test | test | `02-RESEARCH.md §3` (recipe is verbatim) | external verbatim |
| `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` | STO-07 positive+negative | test | `02-RESEARCH.md §4` + Cloudflare `id.name` API docs | external verbatim |
| `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` | STO-10 sanity check | test (subprocess) | `02-RESEARCH.md §STO-10` + Node `child_process.spawnSync` | partial — subprocess shape is novel |
| `packages/workspace-do/src/__tests__/fixtures/bad-blockconcurrency.ts` | negative lint fixture | data fixture | `tests/fixtures/bad-wrangler.jsonc` (sibling FND-08 fixture) | exact-template |
| `packages/workspace-do/src/__tests__/fixtures/good-blockconcurrency.ts` | positive lint fixture | data fixture | `tests/fixtures/good-wrangler.jsonc` (sibling FND-08 fixture) | exact-template |
| `scripts/lint-blockconcurrency.mjs` | STO-10 lint script | build-time check | `scripts/lint-wrangler.mjs` (FND-08, ~92 LOC, dual-mode, exit-code matrix) | **exact-template** — copy structure byte-for-byte |

### MODIFY (4 files)

| Modified File | Change | Closest Analog (existing form) |
|---------------|--------|--------------------------------|
| `packages/workspace-do/package.json` | Add devDeps + test scripts + dependency on `@modelcontextprotocol/sdk` | `packages/mcp-server/package.json` (already declares `@modelcontextprotocol/sdk` as a direct dep — see REVIEW-FIX CR-01) |
| `package.json` (root) | Add `"test"` + `"lint:blockconcurrency"` scripts | Existing root `package.json` scripts block — mirror the `lint:wrangler` and `types:gen` patterns |
| `.github/workflows/ci.yml` | Insert lint step + add Vitest step | Existing `Lint wrangler.jsonc (FND-08)` + fixture-assertion steps |
| `.lintstagedrc.json` | Add per-glob rule for `packages/workspace-do/src/**/*.ts` | Existing `**/wrangler.jsonc` rule already chains the `lint-wrangler.mjs` script |

---

## Pattern Assignments

### 1. `scripts/lint-blockconcurrency.mjs` (build-time lint, exact-template)

**Analog:** `scripts/lint-wrangler.mjs` — copy the file structure byte-for-byte and swap the validation core.

**Header pattern** (`scripts/lint-wrangler.mjs:1-13`):
```javascript
// scripts/lint-wrangler.mjs
// Source: github.com/microsoft/node-jsonc-parser — Microsoft's official JSONC parser.
// Verifies every wrangler.jsonc found in packages/*/ does NOT declare any
// Durable Object class under `new_classes` in its migrations.
//
// FND-08: Cloudflare workers-sdk issue #9909 — KV-backed DOs declared via `new_classes`
// CANNOT be retroactively converted to SQLite-backed. This lint script is the durable
// defense that prevents that irreversible regression from ever reaching production.
//
// Usage: node scripts/lint-wrangler.mjs [file...]
//   - No args: globs packages/*/wrangler.jsonc (production full-scan mode used by CI).
//   - With args: lints exactly the given files (lint-staged per-file mode, fixture invocations).
// Exit codes: 0 clean | 1 violation | 2 no files matched (full-scan canary only).
```

**Dual-mode arg dispatch** (`scripts/lint-wrangler.mjs:22-49`):
```javascript
const positionalArgs = process.argv.slice(2);
const files = [];

if (positionalArgs.length > 0) {
  // Positional-arg mode: lint exactly the given files (lint-staged per-file, fixture invocations).
  for (const file of positionalArgs) {
    files.push(file);
  }
} else {
  // No-arg full-scan mode: glob packages/*/wrangler.jsonc (production CI scan).
  // Exit 2 if no files found — canary against accidental packages/ rename.
  const matched = await fg("packages/*/wrangler.jsonc");
  for (const file of matched) {
    files.push(file);
  }
  if (files.length === 0) {
    console.error("[lint:wrangler] No wrangler.jsonc files found — did packages/ get renamed? " +
      "(glob: packages/*/wrangler.jsonc)");
    process.exit(2);
  }
}
```

**Failure tallying + exit** (`scripts/lint-wrangler.mjs:51-92`):
```javascript
let violations = 0;
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (err) {
    console.error(`[lint:wrangler] ${file} — could not read file: ${err.message}`);
    violations++; continue;
  }
  // ... per-file validation core ...
  if (/* violation detected */) {
    console.error(`[lint:wrangler] ${file} ${describe()}`);
    violations++;
  }
}
if (violations > 0) {
  console.error(`\n[lint:wrangler] FAIL — ${violations} violation(s) found.`);
  process.exit(1);
}
console.log(`[lint:wrangler] OK — checked ${files.length} file(s).`);
```

**Convention to honor:**
1. **Same banner / usage / exit-code documentation block** — keep the comment header verbatim in structure, swap the FND-08 reference for STO-10 and the `new_classes` text for the forbidden-tokens summary.
2. **Same dual-mode dispatch** — positional args win; no-args triggers full-scan via `fast-glob`; full-scan with zero matches exits 2 (canary).
3. **Same tag prefix `[lint:blockconcurrency]`** on every stdout/stderr line so CI logs grep cleanly.
4. **No new deps** — `fast-glob` is already in root devDependencies (`package.json:30`). Use a balance-counted regex for `blockConcurrencyWhile(async () => { ... })` block extraction (per D-09); do NOT introduce `ts-morph`.

**Forbidden-token set (D-10 — locked):** `env.`, `fetch(`, `await this.ai`, `await ctx.storage.transaction(`, `await import(`, `await this.env`.

**Drift risk:** Easy to forget the exit-code 2 canary in full-scan mode, or to swap to `jsonc-parser` (this script does not parse JSONC — it parses TS source). Also easy to over-engineer with `ts-morph` — D-09 explicitly rejects it for v0.1.

---

### 2. `packages/workspace-do/src/index.ts` (DurableObject class body)

**Analogs:**
- **Existing stub** (`packages/workspace-do/src/index.ts:1-15`) — keep the file header comment voice and the `import { DurableObject } from "cloudflare:workers"` line.
- **Sibling Worker entry** (`packages/mcp-server/src/index.ts:17-30`) — same TS-source ESM module style; class extends framework base + constructor pattern.
- **Constructor pattern** prescribed by `02-RESEARCH.md §A` (`blockConcurrencyWhile`) + §1 (migrations) + §2 (seeding) + §4 (assert helper).

**Existing stub to evolve from** (`packages/workspace-do/src/index.ts:1-15`):
```typescript
// Phase 1 stub: this class is declared so packages/mcp-server/wrangler.jsonc's
// binding `{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }` resolves at
// `wrangler dev` time. Phase 2 fills the body (SQLite schema + queries + system
// type seeding).
import { DurableObject } from "cloudflare:workers";

export class WorkspaceDO extends DurableObject {
  // Phase 2: SQLite schema migration, system-type seeding, typed query helpers.
}
```

**Sibling Worker class pattern to mirror** (`packages/mcp-server/src/index.ts:17-30`):
```typescript
export class EngramMcp extends McpAgent {
  server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" });
  async init(): Promise<void> { /* no-op in Phase 1 */ }
}
// Re-export the DO class from @engram/workspace-do so wrangler can bind it from this script.
export { WorkspaceDO } from "@engram/workspace-do";
```

**Phase 2 constructor shape (synthesized from `02-RESEARCH.md §1, §2, §A`):**
```typescript
import { DurableObject } from "cloudflare:workers";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { runMigrations } from "./migrations.js";
import { seedSystemTypes } from "./seeding.js";

export class WorkspaceDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // Sync work only inside blockConcurrencyWhile — no env.*, no fetch, no AI calls.
    // STO-10 lint enforces this statically.
    void ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql);
      seedSystemTypes(ctx.storage.sql);
    });
  }

  private assertOwnsWorkspace(workspaceId: string): void {
    if (this.ctx.id.name !== workspaceId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Workspace mismatch: DO bound to '${this.ctx.id.name ?? "<unnamed>"}' but request claims '${workspaceId}'`,
      );
    }
  }

  // Methods (Phase 2 STO-06 helpers) — each starts with this.assertOwnsWorkspace(args.workspace_id).
}
```

**Convention to honor:**
1. Keep the file-header comment voice from the existing stub (file's purpose, why-it-exists). Update to reflect Phase 2 reality.
2. `import { DurableObject } from "cloudflare:workers"` — already imported; don't change to `agents` or `ctx.storage` pattern.
3. `assertOwnsWorkspace` is **the first call inside every public method** (O3 — convention + the per-method positive case in `defense-in-depth.test.ts`).
4. Method bodies delegate to `queries.ts` helpers and parse JSON at the helper boundary (D-03).
5. Env type: **`unknown`** (anti-pattern §"Storing the wrangler env type"). Do NOT pull in `env.AI` / `env.VECTORIZE` types — Phase 5's job.
6. Constructor wraps **only sync work** inside `blockConcurrencyWhile`. The lint script will fail any drift.

**Drift risk:**
- Most likely failure: someone adds `await env.AI.run(...)` to the constructor for "Phase 5 prep" — the STO-10 lint script catches it, but reviewers should also flag.
- Second-most-likely: forgetting to call `assertOwnsWorkspace` on a new method (caught by the `defense-in-depth.test.ts` positive case **only if the test author remembers to add a case per method** — list every method explicitly in the test).

---

### 3. `packages/workspace-do/src/migrations.ts` (migration runner)

**Analog:** No in-repo analog. Follows `02-RESEARCH.md §1 (Migration Runner Design)` verbatim.

**Prescribed shape** (`02-RESEARCH.md §1`):
```typescript
// packages/workspace-do/src/migrations.ts
export type Migration = {
  version: number;     // monotonically increasing; 1 for v0.1
  name: string;        // human-readable — e.g. "v1_initial_schema"
  sql: string;         // full DDL; multi-statement allowed; semicolon-separated
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema", sql: V1_SQL },
];

export function runMigrations(sql: SqlStorage): void {
  // 1. Create _schema_migrations (idempotent).
  sql.exec(`CREATE TABLE IF NOT EXISTS _schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  // 2. Read applied versions.
  const applied = new Set(
    sql.exec("SELECT version FROM _schema_migrations").toArray().map((r) => r.version as number),
  );

  // 3. Apply missing migrations.
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    sql.exec(m.sql);
    sql.exec(
      "INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      m.version, m.name, Date.now(),
    );
  }
}
```

**Convention to honor:**
1. **Synchronous** — `runMigrations(sql)`. Do NOT mark it `async` or `await` anything inside. The cursor + `.toArray()` are sync.
2. **`_schema_migrations` is a table, not `PRAGMA user_version`** — STO-02 is explicit (Pitfall 2).
3. Migration `sql` may be multi-statement (`;`-separated). Bindings only apply to the *last* statement (Pitfall 8) — for the v1 DDL block, no `?` placeholders appear, which is safe.
4. `.toArray()` exhausts the cursor; **never mix** `.next()` + `.toArray()` (Pitfall 7).
5. The migration registry is `readonly Migration[]` — Phase 2 ships exactly one entry. Additive `v2`, `v3` migrations are deferred (Deferred Ideas in CONTEXT.md).

**Drift risk:** Someone adds `BEGIN/COMMIT` inside `sql.exec()` — forbidden (Key APIs §B). Each `.exec()` is implicitly atomic. Or someone uses `:named` placeholders — only positional `?` is supported.

---

### 4. `packages/workspace-do/src/schema.ts` (DDL string constants)

**Analog:** `shared/schema/src/system-types.ts` — sibling "data-as-module" file with rich JSDoc header explaining the source of truth, treating constants as the *immutable* schema.

**Header pattern to mirror** (`shared/schema/src/system-types.ts:1-21`):
```typescript
/**
 * System memory type definitions for Engram — the seed data that Phase 2's
 * `WorkspaceDO` migration will `INSERT OR IGNORE` into the `memory_types` table.
 *
 * Design notes:
 * - Memory types are schema-as-data (NOT TypeScript classes). These records are
 *   stored in the `memory_types` SQLite table and queried at runtime.
 * - The 7 system types and their field lists are verbatim from CLAUDE.md
 *   §"Memory Types (Schema-as-Data)" — do not add or remove types here without
 *   a corresponding CLAUDE.md update.
 * ...
 * @module @engram/schema/system-types
 */
```

**Phase 2 application** (synthesized — DDL body is verbatim from `02-RESEARCH.md §2`):
```typescript
/**
 * v1 initial schema DDL for the WorkspaceDO SQLite store.
 *
 * Design notes:
 * - All 7 tables and their column shapes are verbatim from CLAUDE.md §"SQLite
 *   Schema (inside WorkspaceDO)". Two STO-04 additions on `blocks`:
 *   `embedding_model TEXT` and `embedding_version INTEGER` — present from v1
 *   so the Phase 5 Vectorize-model lock-in mitigation is in place from day one.
 * - Indexes are declared in the SAME migration as table creation (D-05).
 *   No additive index migrations expected in v0.1.
 * - All timestamps are ms-unix-epoch (INTEGER). Safe under 2^53 for ~280k years
 *   (Pitfall 5 — BigInt precision warning is moot).
 *
 * @module @engram/workspace-do/schema
 */
export const V1_SQL = `
  CREATE TABLE IF NOT EXISTS blocks ( /* ... 14 columns ... */ );
  CREATE INDEX IF NOT EXISTS idx_blocks_scope ON blocks(scope);
  /* ... rest of 7 tables + their indexes ... */
` as const;
```

**Convention to honor:**
1. JSDoc header with `@module` tag, design-notes bullet list, and explicit "verbatim from CLAUDE.md" citation — mirrors `system-types.ts:1-21`.
2. `as const` on the string — preserves literal type, lets TS prove no mutation.
3. The DDL body is **verbatim** from `02-RESEARCH.md §2`. The planner should NOT rephrase column names, types, or index ordering — the test file (`schema.test.ts`) PRAGMA-introspects against this exact shape.

**Drift risk:** Reordering or renaming columns silently because "it reads better" — the introspection tests pin the order. Also: forgetting the two STO-04 columns (`embedding_model`, `embedding_version`) on `blocks` — they're the *whole point* of STO-04.

---

### 5. `packages/workspace-do/src/seeding.ts` (system-type seed loop)

**Analog:** No exact in-repo analog, but the loop reads `SYSTEM_TYPES` from `@engram/schema`:

**Source-of-truth import pattern** (`packages/mcp-server/src/index.ts:11-12`):
```typescript
// FND-05 consumer smoke: importing SYSTEM_TYPES via @engram/schema proves the
// schema package is consumable from a Worker context.
import { SYSTEM_TYPES } from "@engram/schema";
```

**Loop shape** (prescribed by `02-RESEARCH.md §2`):
```typescript
import { SYSTEM_TYPES } from "@engram/schema";

export function seedSystemTypes(sql: SqlStorage): void {
  for (const t of SYSTEM_TYPES) {
    sql.exec(
      "INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source) VALUES (?, ?, ?, NULL, 'system')",
      t.id, t.name, JSON.stringify(t.fields),
    );
  }
}
```

**Convention to honor:**
1. **`INSERT OR IGNORE`** — idempotency hinges on it (STO-05). Running the loop 100 times still produces exactly 7 rows.
2. **`JSON.stringify(t.fields)`** — the `fields` column is TEXT/JSON per D-03; helpers parse on read.
3. `workspace_id` is hard-coded `NULL` and `source` is hard-coded `'system'` — these are the discriminants for "system seed vs user-defined" (CLAUDE.md §"SQLite Schema" / `memory_types` table).
4. **Synchronous** — matches the migrations runner. Called immediately after `runMigrations` inside the same `blockConcurrencyWhile` block.
5. **Re-uses `@engram/schema` symlink** that already resolves (FND-05 smoke proved this).

**Drift risk:** Someone adds an `INSERT` for a non-system type (e.g., a Phase 4 user-defined type) here — the seed loop is for **system** types only. Also: forgetting `JSON.stringify` and passing the raw array — TS will catch it as a type error in strict mode, but only if `sql.exec` parameter types are correctly typed (they default to `any`).

---

### 6. `packages/workspace-do/src/queries.ts` (typed query helpers — STO-06)

**Analogs:**
- **Return-shape source:** `shared/types/src/index.ts` — re-use `Memory`, `Conflict`. Query-specific types (`InboxEntry`, `MemoryType`, `LexicalSearchHit`) live in `packages/workspace-do/src/types.ts`.
- **Cursor + JSON-column handling:** `02-RESEARCH.md §B, §E`.

**Existing return-shape contract** (`shared/types/src/index.ts:59-95`):
```typescript
export interface Memory {
  id: string;
  type: string;
  content: string | null;
  summary: string | null;
  properties: Record<string, unknown> | null;
  embedding_id: string | null;
  scope: "personal" | "project" | "org";
  project_id: string | null;
  source: string | null;
  confidence: number | null;
  created_at: number;
  updated_at: number;
}
```

**Read pattern** (prescribed by `02-RESEARCH.md §E`):
```typescript
// Read pattern — getBlock(id)
const row = sql.exec("SELECT id, properties, ... FROM blocks WHERE id = ?", id).one();
const props = row.properties == null ? null : JSON.parse(row.properties as string);
// ... narrow each typed field (noUncheckedIndexedAccess requires it) ...
```

**Write pattern** (prescribed by `02-RESEARCH.md §E`):
```typescript
// Write pattern — insertBlock(block)
sql.exec(
  "INSERT INTO blocks (id, type, content, properties, ...) VALUES (?, ?, ?, ?, ...)",
  block.id, block.type, block.content,
  block.properties === null ? null : JSON.stringify(block.properties),
  /* ... */
);
```

**Convention to honor:**
1. **Synchronous helpers** (D-01) — return typed objects, no fake `await`s.
2. **Throw on miss** (D-02) — use `.one()` for single-row reads; wrap to convert SDK throw to `NotFoundError` from `./errors.js`. Use `.toArray()` for list reads.
3. **JSON parse/stringify at the helper boundary** (D-03). `== null` (loose) catches both NULL-from-SQLite and undefined-from-`noUncheckedIndexedAccess` (Pitfall 3).
4. **Narrow every column** before return (Pitfall 6). Strongly consider a `narrowBlockRow(row): Memory` helper to centralize the type-checks.
5. **Positional `?` placeholders only**, never `:named` (Key APIs §B).
6. **One consumption pattern per query** — never mix `.next()` + `.toArray()` (Pitfall 7).
7. **Cascade-delete in `deleteBlock`** — explicit `DELETE FROM relations WHERE from_id = ? OR to_id = ?` after the `blocks` delete (STO-06: "delete block + cascading relations"). SQLite `ON DELETE CASCADE` is NOT in the v1 DDL (D-04 indexes are explicit; let the helper handle it).

**Drift risk:**
- Using `as Memory` casts to silence `noUncheckedIndexedAccess` errors — forbidden by the project's strict-TS posture (Pitfall 6).
- Catching all errors from `.one()` as `NotFoundError` — masks "multiple rows for PK" as a non-issue (Anti-Pattern). Use `.toArray()` + explicit row-count check instead, OR document that `.one()` errors are distinct.
- Forgetting cascade on `deleteBlock` — leaves orphan `relations` rows.

---

### 7. `packages/workspace-do/src/errors.ts` (`NotFoundError` class)

**Analog:** No in-repo class analog yet (no errors are thrown by name in Phase 1). Follow standard JS `extends Error` pattern + the D-02 discriminant shape:

**Prescribed shape** (CONTEXT.md "Claude's Discretion"):
```typescript
/**
 * Thrown by single-row helpers (getBlock, getMemoryType) when no row matches.
 * Phase 3 wraps to McpError(-32602 InvalidParams) at the tool boundary.
 *
 * @module @engram/workspace-do/errors
 */
export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}
```

**Convention to honor:**
1. Two discriminants (`resource: string`, `id: string`) — lets Phase 3 wrap to MCP error codes by inspection.
2. `this.name = "NotFoundError"` — required for `instanceof`-style narrowing across realms.
3. Exported from the package barrel (`index.ts`) so Phase 3 can `import { NotFoundError } from "@engram/workspace-do"`.

**Drift risk:** Adding `cause: unknown` field "for future use" — out of scope; revisit when Phase 3 needs it.

---

### 8. `packages/workspace-do/src/types.ts` (query-specific types)

**Analog:** `shared/types/src/index.ts` — same file structure (header → ASCII section dividers → JSDoc per interface).

**Section-divider pattern to mirror** (`shared/types/src/index.ts:12-14, 46-48, 97-99`):
```typescript
// ---------------------------------------------------------------------------
// MemoryEvent — Universal Intake Primitive
// ---------------------------------------------------------------------------

/**
 * Every intake path — MCP tool call, scheduled connector, webhook — produces
 * a `MemoryEvent`. The triage worker consumes all of them identically.
 * ...
 */
export interface MemoryEvent { /* ... */ }
```

**Phase 2 application:**
```typescript
/**
 * Query-result and helper-input types specific to @engram/workspace-do.
 * Shapes that match the canonical domain types are re-exported from @engram/types
 * (Memory, Conflict). Anything NOT in @engram/types lives here.
 *
 * @module @engram/workspace-do/types
 */

// ---------------------------------------------------------------------------
// MemoryType — row shape for the `memory_types` SQLite table
// ---------------------------------------------------------------------------
export interface MemoryType { /* ... */ }

// ---------------------------------------------------------------------------
// InboxEntry — row shape for the `inbox` SQLite table
// ---------------------------------------------------------------------------
export interface InboxEntry { /* ... */ }

// ---------------------------------------------------------------------------
// LexicalSearchHit — shape returned by lexicalSearchBlocks (Memory + snippet)
// ---------------------------------------------------------------------------
export interface LexicalSearchHit { /* ... */ }
```

**Convention to honor:**
1. **`interface` over `type` for object shapes** — matches `shared/types/src/index.ts` (every domain type there is `interface`).
2. **JSDoc per field**, not just at the top — `shared/types` has per-field JSDoc. Phase 2 should too.
3. **ASCII section dividers** — `// ---...` between exported types.
4. Re-export from `packages/workspace-do/src/index.ts` so consumers can `import { InboxEntry } from "@engram/workspace-do"`.

**Drift risk:** Using `type` aliases for record shapes instead of `interface` — small style violation; Phase 1 chose `interface` consistently.

---

### 9. `packages/workspace-do/vitest.config.ts` (test pool config)

**Analog:** **No in-repo analog** — Phase 1 shipped zero Vitest configs. Follow Cloudflare-maintained reference verbatim (`02-RESEARCH.md §D`):

**Prescribed shape:**
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

**Convention to honor:**
1. `configPath: "./wrangler.test.jsonc"` — distinct from any production `wrangler.jsonc`. The FND-08 lint glob (`packages/*/wrangler.jsonc`, literal filename) will NOT pick up `.test.jsonc` files — verified per A1.
2. Use `defineProject` (not `defineConfig`) — workspace-friendly variant per Cloudflare fixture.
3. Single-file config — no `vitest.workspace.ts` for now (workspace-do is the only package with tests in Phase 2).

**Drift risk:** Pointing `configPath` at `../mcp-server/wrangler.jsonc` "to reduce duplication" — discussed and explicitly deferred (O2). The local config is the simpler choice.

---

### 10. `packages/workspace-do/wrangler.test.jsonc` (test-only wrangler config)

**Analogs:**
- **Minimal sibling wrangler:** `packages/triage-worker/wrangler.jsonc` (12 lines, simplest format in the repo).
- **DO-binding section:** `packages/mcp-server/wrangler.jsonc:13-28`.

**Triage minimal pattern** (`packages/triage-worker/wrangler.jsonc:1-11`):
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-triage-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "dev": { "port": 8788 },
}
```

**DO binding pattern** (`packages/mcp-server/wrangler.jsonc:13-29`):
```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "EngramMcp" },
      { "name": "WORKSPACE", "class_name": "WorkspaceDO" },
    ],
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["WorkspaceDO"],
    },
  ],
```

**Phase 2 application** (synthesized — per `02-RESEARCH.md §D`):
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "workspace-do-test",
  "main": "src/index.ts",
  // Omit compatibility_date — the test pool infers the latest, per the official
  // Cloudflare fixture's pattern. The FND-08 lint glob only matches
  // packages/*/wrangler.jsonc (literal), so this .test.jsonc file is NOT linted.
  "durable_objects": {
    "bindings": [{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["WorkspaceDO"] }],
}
```

**Convention to honor:**
1. **`$schema` path** uses `../../node_modules/wrangler/config-schema.json` — verbatim from both sibling configs.
2. **`new_sqlite_classes`** (NOT `new_classes`) — FND-08 is permanent project policy.
3. **Header comment** explains why the file exists (test pool resolution) and *especially* why it won't be lint-picked-up.
4. **Single DO binding** — Phase 2 doesn't need `MCP_OBJECT`. Tests only exercise WorkspaceDO.

**Drift risk:**
- Renaming the file to plain `wrangler.jsonc` — FND-08 lint will pick it up and complain about the lack of `compatibility_date`, OR worse, declare a parallel production config the team forgets exists.
- Adding `"compatibility_date"` — the Cloudflare fixture omits it intentionally so the pool uses latest. Including it freezes the test runtime to a specific date that may drift from production.

---

### 11. Test files — `packages/workspace-do/src/__tests__/*.test.ts`

**Analog:** **No in-repo analog.** Cloudflare-maintained fixture `workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/` is the verbatim reference. Specific recipes are in `02-RESEARCH.md §3 (hibernation)` and §4 (defense-in-depth).

**Prescribed imports** (`02-RESEARCH.md §D`):
```typescript
import { runInDurableObject, listDurableObjectIds } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { WorkspaceDO } from "../index.js";
```

**STO-09 hibernation test recipe** (verbatim from `02-RESEARCH.md §3`):
```typescript
describe("hibernation replay safety (STO-09)", () => {
  it("re-instantiates without re-running migrations or duplicating seeds", async () => {
    const id = env.WORKSPACE.idFromName("ws-replay-test");

    // First cold start.
    await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
      const applied = state.storage.sql.exec(
        "SELECT version, name FROM _schema_migrations ORDER BY version",
      ).toArray();
      expect(applied).toEqual([{ version: 1, name: "v1_initial_schema", applied_at: expect.any(Number) }]);

      const seeds = state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one();
      expect(seeds.n).toBe(7);
    });

    // Second access — same ID, same data.
    await runInDurableObject(env.WORKSPACE.get(id), async (_inst, state) => {
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM _schema_migrations").one().n).toBe(1);
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM memory_types").one().n).toBe(7);
    });
  });
});
```

**STO-07 defense-in-depth test recipe** (synthesized from `02-RESEARCH.md §4`):
```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe("assertOwnsWorkspace (STO-07)", () => {
  it("passes when ctx.id.name matches workspace_id", async () => {
    const id = env.WORKSPACE.idFromName("ws-alice");
    await runInDurableObject(env.WORKSPACE.get(id), async (instance) => {
      expect(() => instance.listMemoryTypes({ workspace_id: "ws-alice" })).not.toThrow();
    });
  });

  it("throws McpError(InvalidRequest) on workspace mismatch", async () => {
    const id = env.WORKSPACE.idFromName("ws-alice");
    await runInDurableObject(env.WORKSPACE.get(id), async (instance) => {
      try {
        instance.listMemoryTypes({ workspace_id: "ws-bob" });
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(McpError);
        expect((err as McpError).code).toBe(ErrorCode.InvalidRequest); // -32600
      }
    });
  });
});
```

**Convention to honor:**
1. `runInDurableObject(stub, (instance, state) => {...})` — NEVER mock the DO (Anti-Pattern §"Mocking the DO").
2. Read state.storage.sql for introspection assertions. Use `.toArray()` / `.one()` per the cursor rules.
3. Each test file scopes a single STO requirement (per CONTEXT.md "Claude's Discretion" → file organization).
4. Import the SDK from `@modelcontextprotocol/sdk/types.js` — the runtime-safe submodule export per `02-RESEARCH.md §4`. Phase 2's `package.json` change adds this dep directly to workspace-do (same pattern as REVIEW-FIX CR-01).

**Drift risk:**
- Mocking `runInDurableObject` to "make tests faster" — invalidates STO-08/09. Real workerd runtime is the whole point.
- Reading `state.storage.list()` or `state.storage.get()` — those are the KV API. SQLite uses `state.storage.sql.exec(...)`.

---

### 12. Lint fixtures — `packages/workspace-do/src/__tests__/fixtures/{bad,good}-blockconcurrency.ts`

**Analog:** `tests/fixtures/bad-wrangler.jsonc` + `tests/fixtures/good-wrangler.jsonc` — sibling fixtures for FND-08.

**Header pattern to mirror** (`tests/fixtures/bad-wrangler.jsonc:1-6`):
```
// tests/fixtures/bad-wrangler.jsonc
// NEGATIVE lint fixture — declares new_classes instead of new_sqlite_classes.
// This is the exact regression FND-08 prevents (DO-1: KV-backed DOs cannot be
// retroactively converted to SQLite-backed — Cloudflare workers-sdk #9909).
// The FND-08 lint script MUST exit 1 against this file.
// This file is intentionally outside packages/ so the production glob does not pick it up.
```

**Phase 2 application — bad fixture:**
```typescript
// packages/workspace-do/src/__tests__/fixtures/bad-blockconcurrency.ts
// NEGATIVE lint fixture — calls `await env.AI.run(...)` inside a blockConcurrencyWhile block.
// This is the exact regression STO-10 prevents (any I/O inside the constructor's
// blockConcurrencyWhile block blocks ALL requests and may trigger a 30s reset).
// The STO-10 lint script MUST exit 1 against this file.
import { DurableObject } from "cloudflare:workers";
export class BadDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      // VIOLATION: env.* + await is forbidden inside the bootstrap block.
      await (env as { AI: { run: (m: string) => Promise<unknown> } }).AI.run("@cf/baai/bge-base-en-v1.5");
    });
  }
}
```

**Phase 2 application — good fixture:**
```typescript
// packages/workspace-do/src/__tests__/fixtures/good-blockconcurrency.ts
// POSITIVE lint fixture — pure synchronous sql.exec() inside the block.
// The STO-10 lint script MUST exit 0 against this file.
import { DurableObject } from "cloudflare:workers";
export class GoodDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS noop (id TEXT PRIMARY KEY)");
    });
  }
}
```

**Convention to honor:**
1. **Comment header explains WHY the file exists** — mirrors the bad-wrangler header voice exactly (NEGATIVE/POSITIVE label + the requirement ID + "MUST exit 1/0").
2. **Self-contained** — each fixture is a complete, parseable TS file that exercises exactly one violation (bad) or exactly one allowed pattern (good).
3. **Located OUTSIDE the production lint glob's reach.** The STO-10 production scan is `packages/workspace-do/src/**/*.ts` — so fixtures live in `packages/workspace-do/src/__tests__/fixtures/`. ⚠ **This is a potential collision**: the production glob WILL match `src/__tests__/fixtures/*.ts`. Planner must add an exclusion to the lint script's no-arg full-scan glob (e.g., `'packages/workspace-do/src/**/*.ts', '!packages/workspace-do/src/__tests__/**'`) OR move fixtures to `packages/workspace-do/__fixtures__/` outside `src/`.

**Drift risk:**
- **HIGH** — the FND-08 fixtures live in `tests/fixtures/` (outside `packages/`) precisely because the production glob is `packages/*/wrangler.jsonc`. Phase 2's STO-10 production glob is `packages/workspace-do/src/**/*.ts`, which DOES reach into the fixtures dir. The plan MUST either (a) add a `!` exclusion to the fast-glob call OR (b) relocate fixtures outside `src/`. Recommend (b) — `packages/workspace-do/__fixtures__/` — simpler and unambiguous.
- Forgetting the "MUST exit 1/0" assertion in the header — the fixtures are useless documentation without the explicit expectation.

---

### 13. `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` (sanity check)

**Analog:** No in-repo analog. Pattern is a subprocess invocation of the lint script — `node:child_process.spawnSync`. The shape:

```typescript
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const SCRIPT = "scripts/lint-blockconcurrency.mjs";

describe("scripts/lint-blockconcurrency.mjs (STO-10 self-test)", () => {
  it("exits 0 on the good fixture", () => {
    const r = spawnSync("node", [SCRIPT, "packages/workspace-do/__fixtures__/good-blockconcurrency.ts"]);
    expect(r.status).toBe(0);
  });

  it("exits 1 on the bad fixture", () => {
    const r = spawnSync("node", [SCRIPT, "packages/workspace-do/__fixtures__/bad-blockconcurrency.ts"]);
    expect(r.status).toBe(1);
  });

  it("exits 2 in no-arg mode if the glob matches nothing (canary)", () => {
    // This is the hardest case to assert in-test — may require a temp-directory
    // shim. Defer to the CI workflow's negative-fixture step if vitest can't
    // exercise it cleanly.
  });
});
```

**Convention to honor:**
1. Subprocess the script — proves the *script itself* works, not just an in-process equivalent.
2. Mirror FND-08's CI assertion style (negative + positive fixture).
3. The exit-code-2 canary test is hard from inside vitest. The CI workflow already exercises full-scan mode (which would exit 2 if `packages/workspace-do/src/**/*.ts` ever returns empty), so deferring the in-test assertion is fine.

**Drift risk:** The script invocation runs from the repo root (cwd). Inside vitest-pool-workers, the cwd may not be the repo root. Use `spawnSync("node", [SCRIPT], { cwd: process.env.GITHUB_WORKSPACE ?? "." })` or compute the repo root from `import.meta.url`.

---

### 14. `packages/workspace-do/package.json` (MODIFY — add devDeps + test scripts)

**Analog:** `packages/mcp-server/package.json` — sibling that already declares a direct `@modelcontextprotocol/sdk` dep + `scripts` block.

**Current state** (`packages/workspace-do/package.json:1-16`):
```json
{
  "name": "@engram/workspace-do",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "files": ["src"]
}
```

**Sibling reference** (`packages/mcp-server/package.json:1-19`):
```json
{
  "name": "@engram/mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types:gen": "wrangler types"
  },
  "dependencies": {
    "agents": "^0.13.2",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@engram/types": "*",
    "@engram/schema": "*",
    "@engram/workspace-do": "*"
  }
}
```

**Phase 2 target additions** (synthesized — per CONTEXT.md "Established Patterns" + `02-RESEARCH.md §D`):
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@engram/types": "*",
    "@engram/schema": "*",
    "@modelcontextprotocol/sdk": "^1.29.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.16.9",
    "vitest": "^4.1.7"
  }
}
```

**Convention to honor:**
1. **Direct `@modelcontextprotocol/sdk` dep**, not phantom-transitive (REVIEW-FIX CR-01 pattern — `mcp-server` already does this).
2. **Add `@engram/types` and `@engram/schema` as direct deps** (workspace-do consumes both via the seed loop + return-shape imports). Currently they resolve as phantom transitives — Phase 2 fixes this.
3. **`scripts.test` is `vitest run`** — not `vitest`, because the root `test` script delegates with `--workspaces --if-present` and bare `vitest` would hang in watch mode.
4. Preserve the `exports` block, `files: ["src"]`, and `type: "module"` — Phase 1 TS-source exports pattern (D-07).
5. Pin versions as MAJOR-loose (`^`) — matches root `package.json` style.

**Drift risk:**
- Adding `vitest` as a root devDep instead of per-package — the test pool plugin is per-package and needs the pool's matching peer.
- Dropping the `exports` block when adding the new scripts — keep the entire existing structure.

---

### 15. `package.json` (root MODIFY — add `test` + `lint:blockconcurrency`)

**Analog:** Existing scripts block (`package.json:14-25`).

**Existing pattern to mirror** (`package.json:14-25`):
```json
"scripts": {
  "prepare": "husky",
  "lint": "eslint .",
  "lint:wrangler": "node scripts/lint-wrangler.mjs",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc -b --noEmit",
  "types:gen": "npm run types:gen --workspaces --if-present",
  "dev:mcp": "npm run dev --workspace @engram/mcp-server",
  "dev:triage": "npm run dev --workspace @engram/triage-worker",
  "setup": "..."
}
```

**Phase 2 additions:**
```json
"scripts": {
  "lint:blockconcurrency": "node scripts/lint-blockconcurrency.mjs",
  "test": "npm run test --workspaces --if-present"
}
```

**Convention to honor:**
1. **`lint:blockconcurrency`** sits adjacent to `lint:wrangler` (same `lint:` family naming).
2. **`test` uses `--workspaces --if-present`** — exact mirror of the existing `types:gen` pattern, so individual packages opt in by defining their own `test` script.
3. No version-bump trigger or test pre-hooks — keep the root scripts thin.

**Drift risk:** Adding `pretest` or `posttest` hooks that re-run lint — the CI workflow handles ordering, scripts stay composable.

---

### 16. `.github/workflows/ci.yml` (MODIFY — add lint step + Vitest step)

**Analog:** Existing FND-08 step block (`.github/workflows/ci.yml:36-52`).

**Existing FND-08 step block** (`.github/workflows/ci.yml:36-52`):
```yaml
- name: Lint wrangler.jsonc (FND-08)
  run: npm run lint:wrangler

# FND-08 negative-fixture assertion: the bad fixture MUST trigger a
# lint failure. If this step succeeds (lint exits 0 on bad fixture),
# the linter has regressed and is no longer catching `new_classes`.
- name: Lint wrangler.jsonc — negative fixture must fail (FND-08)
  run: |
    if node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc; then
      echo "FND-08 regression: bad fixture did not trigger lint failure"
      exit 1
    fi
    echo "FND-08 negative fixture correctly failed."

# FND-08 positive-fixture assertion: the good fixture must pass cleanly.
- name: Lint wrangler.jsonc — positive fixture must pass (FND-08)
  run: node scripts/lint-wrangler.mjs tests/fixtures/good-wrangler.jsonc
```

**Phase 2 application — insert between `lint` and `lint:wrangler` (D-11):**
```yaml
- name: Lint blockConcurrencyWhile I/O (STO-10)
  run: npm run lint:blockconcurrency

# STO-10 negative-fixture assertion (mirrors FND-08 pattern):
- name: Lint blockConcurrencyWhile — negative fixture must fail (STO-10)
  run: |
    if node scripts/lint-blockconcurrency.mjs packages/workspace-do/__fixtures__/bad-blockconcurrency.ts; then
      echo "STO-10 regression: bad fixture did not trigger lint failure"
      exit 1
    fi
    echo "STO-10 negative fixture correctly failed."

# STO-10 positive-fixture assertion:
- name: Lint blockConcurrencyWhile — positive fixture must pass (STO-10)
  run: node scripts/lint-blockconcurrency.mjs packages/workspace-do/__fixtures__/good-blockconcurrency.ts
```

**Phase 2 additional step — after smoke tests, before `smoke-install`:**
```yaml
- name: Test (Vitest)
  run: npm test
```

**Convention to honor:**
1. **Three-step block** for the lint (main + negative-fixture + positive-fixture) — exact mirror of FND-08 (O4 confirms).
2. **D-11 ordering** — lint:blockconcurrency runs AFTER `Lint (ESLint)` and BEFORE `Lint wrangler.jsonc (FND-08)`.
3. **Vitest step** comes AFTER the smoke tests so a broken `wrangler dev` boot doesn't mask a failing test (broken-import scenarios show up cleaner if smoke passes first).
4. Same step-naming voice ("Lint blockConcurrencyWhile I/O (STO-10)", "must fail", "must pass").

**Drift risk:**
- Forgetting the negative-fixture step — the lint can silently regress and tests still pass.
- Reordering Vitest before smoke — Vitest needs npm install first (already covered by the existing `Install dependencies` step), but a broken WorkspaceDO import is easier to diagnose from a wrangler-dev smoke failure.

---

### 17. `.lintstagedrc.json` (MODIFY — add lint-staged rule for the new lint)

**Analog:** Existing `**/wrangler.jsonc` rule.

**Existing pattern** (`.lintstagedrc.json:1-5`):
```json
{
  "*.{ts,mts,cts,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{json,jsonc,md,yaml,yml}": ["prettier --write"],
  "**/wrangler.jsonc": ["node scripts/lint-wrangler.mjs"]
}
```

**Phase 2 application:**
```json
{
  "*.{ts,mts,cts,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{json,jsonc,md,yaml,yml}": ["prettier --write"],
  "**/wrangler.jsonc": ["node scripts/lint-wrangler.mjs"],
  "packages/workspace-do/src/**/*.ts": ["node scripts/lint-blockconcurrency.mjs"]
}
```

**Convention to honor:**
1. **Per-glob script in addition to the default ts toolchain** (A5 — chosen default). The general `*.ts` rule still runs `eslint --fix` + `prettier --write`; lint-staged runs both globs' matchers in parallel when a file matches multiple.
2. **Scope is `packages/workspace-do/src/**/*.ts`** — narrower than the production full-scan glob; lint-staged only sees staged files in this dir.
3. **Same `node scripts/...mjs` shape** as the FND-08 entry — uniformity makes it obvious what's a lint command vs an in-place formatter.

**Drift risk:**
- Globbing all `packages/**/*.ts` — over-scopes, runs the lint on files where `blockConcurrencyWhile` is irrelevant (e.g., mcp-server tool handlers in Phase 3+).
- Forgetting that the fixture files would ALSO match this glob if they live under `src/__tests__/fixtures/` — another reason to relocate fixtures to `packages/workspace-do/__fixtures__/` (see drift risk on §12 above).

---

## Shared Patterns

These conventions apply across multiple Phase 2 files and should be applied consistently.

### Shared Pattern A — Cloudflare SQL cursor API

**Source:** `02-RESEARCH.md §B`. **Apply to:** `migrations.ts`, `seeding.ts`, `queries.ts`, every `*.test.ts` that introspects state.

**Rules** (in priority order):
1. `sql.exec(query, ...positional_args)` — synchronous; only positional `?`, no `:named`.
2. `.one()` throws on zero rows AND on multiple rows. Use for single-row helpers (`getBlock`, `getMemoryType`). The throw becomes a `NotFoundError` via try/catch wrap.
3. `.toArray()` exhausts the cursor; returns `[]` on no matches. Use for list helpers.
4. **Never mix `.next()` and `.toArray()`** — cursor is stateful (Pitfall 7).
5. **Multi-statement query bindings only apply to the LAST statement** (Pitfall 8). Migrations have no `?` so this doesn't bite, but flag any drift.
6. Each `.exec()` is implicitly atomic — no `BEGIN`/`COMMIT`. Use `ctx.storage.transactionSync()` only if combining multiple `.exec()` calls atomically (Phase 2 doesn't need it).

### Shared Pattern B — JSON column handling at the helper boundary (D-03)

**Source:** `02-RESEARCH.md §E` + Pitfall 3-4. **Apply to:** every helper in `queries.ts` that reads or writes a TEXT/JSON column.

**Rules:**
1. **Read:** `row.col == null ? null : JSON.parse(row.col as string)` — loose-equality (`==`) catches both `NULL` from SQLite and `undefined` from `noUncheckedIndexedAccess` (Pitfall 3).
2. **Write:** `value === null ? null : JSON.stringify(value)`. Strict-equality (`===`) here because the helper input is typed and undefined would be a bug.
3. **JSON columns enumerated:** `blocks.properties`, `memory_types.fields`, `relations.properties`, `inbox.proposed_properties`.
4. **No runtime schema validation (zod) here** — D-03 defers it to Phase 4's MCP tool-input boundary.
5. **Round-trip caveat:** `JSON.stringify({a:1, b:undefined})` drops the `b` (Pitfall 4). Document this in the helper JSDoc.

### Shared Pattern C — `noUncheckedIndexedAccess` narrowing

**Source:** Strict-TS posture (`tsconfig.base.json:9`) + Pitfall 6. **Apply to:** every helper that returns a typed object built from a SQL row.

**Rules:**
1. `sql.exec(...).one()` returns `Record<string, SqlStorageValue>` where each property is `T | undefined`.
2. **Never** `as Memory` to silence the error — write a `narrowBlockRow(row): Memory` helper that throws on shape violations.
3. The narrowing helper's throw is an **invariant violation** (the schema is correct, the row is wrong — bug). Distinct from `NotFoundError` (legitimate empty result).
4. Apply consistent narrowing per table — `narrowBlockRow`, `narrowMemoryTypeRow`, etc., colocated in `queries.ts` or a `narrowing.ts` sibling.

### Shared Pattern D — Defense-in-depth `assertOwnsWorkspace` (STO-07)

**Source:** `02-RESEARCH.md §C, §4` + CLAUDE.md §"Session DO vs Workspace DO". **Apply to:** every public method on `WorkspaceDO`.

**Rules:**
1. **First call in every public method** — `this.assertOwnsWorkspace(args.workspace_id)`.
2. The throw uses `McpError(ErrorCode.InvalidRequest, ...)` — the JSON-RPC `-32600` code per MCP spec.
3. `this.ctx.id.name` (NOT `this.state.id.name`, though they're equivalent) — matches modern `DurableObject` base-class examples.
4. Defense-in-depth test (`defense-in-depth.test.ts`) has a positive case PER METHOD — a missing method = unverified guard.

### Shared Pattern E — File-header JSDoc

**Source:** `shared/types/src/index.ts:1-10`, `shared/schema/src/system-types.ts:1-21`. **Apply to:** every new `.ts` file under `packages/workspace-do/src/`.

**Rules:**
1. Top-of-file JSDoc with `@module` tag — e.g., `@module @engram/workspace-do/queries`.
2. Brief explanation of the file's purpose + key design notes as a bullet list.
3. Cite the CLAUDE.md section or requirement ID it implements (e.g., "Implements STO-06: typed query helpers").
4. **No file-level emoji or marketing copy** — terse, technical, why-it-exists.

### Shared Pattern F — Tag prefixes on stdout/stderr in scripts

**Source:** `scripts/lint-wrangler.mjs` — every log line starts with `[lint:wrangler]`.

**Apply to:** `scripts/lint-blockconcurrency.mjs` — every line starts with `[lint:blockconcurrency]`. Makes CI logs grep-able and reduces ambiguity when scripts run in parallel.

---

## No Analog Found

Files where the in-repo codebase has no prior pattern and the planner MUST follow `02-RESEARCH.md` or the cited external source verbatim:

| File | Why no analog | Reference to follow |
|------|---------------|---------------------|
| `packages/workspace-do/src/migrations.ts` | Phase 1 had no DOs with bodies | `02-RESEARCH.md §1` |
| `packages/workspace-do/vitest.config.ts` | Phase 1 had no tests | `02-RESEARCH.md §D` + Cloudflare fixture `vitest-pool-workers-examples/durable-objects/vitest.config.ts` |
| Every `*.test.ts` under `__tests__/` | Phase 1 had no tests | `02-RESEARCH.md §D, §3, §4` + Cloudflare fixture |
| `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` | First subprocess-style sanity test | Node `child_process.spawnSync` docs + FND-08's CI fixture-assertion style |

---

## Cross-Phase Drift Surface

Two areas where Phase 2 decisions ripple into Phase 3+:

| Decision | Phase 3+ implication |
|----------|----------------------|
| `assertOwnsWorkspace` lives on the DO | Phase 3's tool handlers MUST pass `workspace_id` from `this.props.workspace_id` (JWT-derived) — never trust caller input. TOL-07 will pen-test this. |
| `NotFoundError` is the wire shape | Phase 3 catches it at the tool boundary and re-throws as `McpError(-32602 InvalidParams)`. The planner for Phase 3 must register this mapping explicitly. |
| `@modelcontextprotocol/sdk` added as direct dep of `@engram/workspace-do` | Sets precedent: every package that throws `McpError` adds the SDK directly. Phase 3's `triage-worker` will follow if/when it throws structured errors. |
| `wrangler.test.jsonc` declares its own v1 migration | If/when Phase 3 adds `EngramMcp` to `new_sqlite_classes`, the test config must follow (or stay scoped to WorkspaceDO-only tests). |

---

## Metadata

**Analog search scope:**
- `packages/mcp-server/` — full
- `packages/triage-worker/` — full
- `packages/workspace-do/` — full (Phase 1 stub)
- `shared/types/`, `shared/schema/` — full
- `scripts/` — full
- `tests/fixtures/` — full
- `.github/workflows/`, `.lintstagedrc.json`, `.husky/`, root `package.json`, `tsconfig.base.json` — full

**Files scanned:** 21 in-repo sources read (all via `Read` tool, no re-reads).

**External references cited:**
- Cloudflare `workers-sdk/fixtures/vitest-pool-workers-examples/durable-objects/` — per `02-RESEARCH.md §D`
- Cloudflare `developers.cloudflare.com/durable-objects/api/{state,id,sqlite-storage-api}/` — per `02-RESEARCH.md §A,B,C`
- `@modelcontextprotocol/sdk/types.js` exports — verified locally per `02-RESEARCH.md §4`

**Pattern extraction date:** 2026-05-25

## PATTERN MAPPING COMPLETE
