---
phase: 02-workspacedo-sqlite
plan: 01
subsystem: workspace-do
tags: [cloudflare, durable-objects, sqlite, migrations, error-types]

# Dependency graph
requires:
  - phase: 02-workspacedo-sqlite
    plan: 00
    provides: "Vitest test infrastructure (schema.test.ts STO-02 stub the runner satisfies once Plan 02-04 wires it), packages/workspace-do/package.json devDeps + direct deps"
provides:
  - "packages/workspace-do/src/migrations.ts — Migration type + readonly MIGRATIONS registry (one v1 entry) + synchronous runMigrations(sql: SqlStorage): void using a _schema_migrations table for tracking (STO-02 substrate)"
  - "packages/workspace-do/src/errors.ts — NotFoundError class with readonly (resource, id) discriminants per D-02; ready for Plan 02-05 single-row helpers to throw"
  - "packages/workspace-do/src/schema.ts — STUB (V1_SQL = '') so migrations.ts typechecks; Plan 02-02 MUST overwrite with the real 7-table DDL block"
affects: [02-02-schema (consumes V1_SQL contract — must overwrite stub), 02-04-constructor-wiring (calls runMigrations inside blockConcurrencyWhile), 02-05-query-helpers (throws NotFoundError on single-row misses)]

# Tech tracking
tech-stack:
  added: []  # No new deps; SqlStorage type comes from @cloudflare/workers-types already pinned in Phase 1
  patterns:
    - "Hand-rolled migration runner over a tracking table (NOT PRAGMA user_version, NOT durable-utils) — Cloudflare's documented Pitfall 2 mitigation for workerd SQLite"
    - "Synchronous schema bootstrap suitable for blockConcurrencyWhile — pure sql.exec, no await, no env.*, no fetch (STO-10 lint will enforce once Plan 02-07 lands the script)"
    - "Two-discriminant domain error class (resource, id) with this.name pinned for cross-realm instanceof safety — enables Phase 3 boundary re-throw to McpError(-32602 InvalidParams) by pattern-matching on (resource, id) rather than string-parsing message"

key-files:
  created:
    - "packages/workspace-do/src/errors.ts"
    - "packages/workspace-do/src/migrations.ts"
    - "packages/workspace-do/src/schema.ts (STUB — Plan 02-02 overwrites)"
  modified: []

key-decisions:
  - "Migration declared as `interface Migration` not `type Migration`. The plan's <interfaces> block prescribed `type`, but the project ESLint rule @typescript-eslint/consistent-type-definitions blocks `type` for object shapes (and PATTERNS.md §8 explicitly prescribes `interface` for object shapes matching shared/types convention). The exported symbol is identical at the type level — `Migration` is the same type regardless of keyword — so the functional acceptance criterion is met while honoring the project's locked lint posture."
  - "Created a minimal schema.ts stub (V1_SQL = '') so migrations.ts can typecheck before Plan 02-02 lands. The plan's success criteria explicitly authorized this: 'prefer a stub `export const V1_SQL = '' in schema.ts` if that's the only way to keep typecheck green, but coordinate by leaving a note in your SUMMARY.md so Plan 02 knows to overwrite the stub.' Plan 02-02 MUST overwrite this stub; the stub's file-header JSDoc says so unambiguously."
  - "Kept educational JSDoc references to `PRAGMA user_version` and `await` inside migrations.ts comments. Both terms appear ONLY in comments that AFFIRM the prohibition (NOT code paths). The plan's `<deep_work_rules>`-flagged acceptance criterion strips comments before counting, so the strict criterion is met; the literal success criterion's `git grep` returns 1 in migrations.ts and 1 in the pre-existing Wave 0 hibernation.test.ts. See Deviations below."

requirements-completed: []  # STO-02 substrate is in place but the requirement is end-to-end (test executes against the wired-in constructor), satisfied by Plan 02-04. This plan provides the building block.

# Metrics
duration: 4m 8s (active commit time; pre-execution context loading not included)
completed: 2026-05-26
---

# Phase 2 Plan 01: Migration Runner + NotFoundError Summary

**Hand-rolled synchronous `_schema_migrations` runner (`migrations.ts`) and two-discriminant `NotFoundError` (`errors.ts`) landed as Phase 2's foundation; Plan 02-02 will overwrite the temporary `schema.ts` stub with the real V1 DDL when it runs.**

## Performance

- **Duration:** 4m 8s (active commit time)
- **Tasks:** 2
- **Files created:** 3 (errors.ts, migrations.ts, schema.ts stub)
- **Files modified:** 0

## Accomplishments

- `packages/workspace-do/src/errors.ts` — `NotFoundError extends Error` with two readonly discriminants (`resource: string`, `id: string`) per D-02 (CONTEXT.md "Claude's Discretion"). `this.name = "NotFoundError"` set explicitly after `super(...)` so `instanceof`-style narrowing and structured-clone serialization survive cross-realm boundaries. JSDoc header includes the `@module @engram/workspace-do/errors` tag and an explicit forward-link explaining that Phase 3 will wrap to `McpError(-32602 InvalidParams)` at the MCP tool boundary — captures the cross-phase contract so future maintainers don't lose the rationale. No `cause` field, no static factory methods (PATTERNS.md §7 drift-risk callouts honored).
- `packages/workspace-do/src/migrations.ts` — synchronous `runMigrations(sql: SqlStorage): void` implementing STO-02 substrate per PATTERNS.md §3 verbatim. Step 1 idempotently bootstraps `_schema_migrations` (column shape per "Claude's Discretion": `version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL`). Step 2 reads the applied set via `sql.exec("SELECT version FROM _schema_migrations").toArray()` (never `.next()` + `.toArray()` — Pitfall 7). Step 3 loops the registry, skipping already-applied versions, otherwise running the migration sql then stamping a tracking row with `Date.now()` via positional `?` bindings (Pitfall 8). `Migration` interface (not type — see Decisions) + `readonly Migration[]` registry with exactly one entry `{ version: 1, name: "v1_initial_schema", sql: V1_SQL }`. No `PRAGMA user_version`, no `BEGIN`/`COMMIT`/`SAVEPOINT`, no `durable-utils`, no `async`, no `await`.
- `packages/workspace-do/src/schema.ts` — STUB (`V1_SQL: string = ""`) so migrations.ts typechecks now. Plan 02-02 (Wave 2) MUST overwrite this file with the real 7-table DDL block per 02-RESEARCH.md §2 (CLAUDE.md "SQLite Schema" verbatim + the two STO-04 columns `embedding_model TEXT` + `embedding_version INTEGER` on `blocks` + aggressive v1 indexing per D-04 / D-05). The stub's file-header JSDoc says so explicitly; the eslint-disable comment on the export line documents the intent of the `: string` type annotation surviving the overwrite as a no-op (Plan 02-02 can remove or keep the explicit type — the contract is the symbol name + the runtime value, not the annotation).
- All four lints + typecheck green at HEAD: `npm run lint` (ESLint exit 0), `npm run lint:wrangler` (FND-08 still OK on 2 files — `.test.jsonc` correctly excluded), `npm run typecheck` (exit 0), `npm test` (`Test Files 6 skipped (6) / Tests 18 skipped (18)` — exact Wave 0 baseline, no regression).
- Pre-commit hooks (eslint + prettier + the wrangler/blockconcurrency staged-file checks) succeeded on both Task 1 and Task 2 commits — no `--no-verify` used.

## Task Commits

1. **Task 1: errors.ts (NotFoundError)** — `86f4d0a` (feat) — 1 file, 37 insertions
2. **Task 2: migrations.ts (runner) + schema.ts (stub)** — `9687b9a` (feat) — 2 files, 104 insertions

## Files Created/Modified

- **`packages/workspace-do/src/errors.ts`** (NEW, 37 lines) — `NotFoundError` class. Two `public readonly` discriminants; `super(`${resource} not found: ${id}`)` for the message; `this.name = "NotFoundError"` explicit. Header JSDoc enumerates the D-02 lock-in + the Phase-3 forward contract + the three locked drift-risk no-fields (no `cause`, no static factories, name pinned).
- **`packages/workspace-do/src/migrations.ts`** (NEW, ~85 lines) — Migration runner. Top-of-file `import type { SqlStorage } from "@cloudflare/workers-types"` (verbatimModuleSyntax-compatible). `import { V1_SQL } from "./schema.js"` (depends on Plan 02-02's overwrite). Exports: `interface Migration { version, name, sql }`, `const MIGRATIONS: readonly Migration[]`, `function runMigrations(sql: SqlStorage): void`. Function body has an inline `// Sync function — called inside blockConcurrencyWhile...` warning comment at the top per the plan's `<action>` directive. Per-step inline comments cite the relevant pitfalls (Pitfall 7 on cursor mixing; Pitfall 8 on positional bindings).
- **`packages/workspace-do/src/schema.ts`** (NEW STUB, ~20 lines) — `V1_SQL: string = ""` placeholder. Header JSDoc is explicit and load-bearing: "Plan 02-02 MUST overwrite this file". No other exports. One `eslint-disable-next-line @typescript-eslint/no-inferrable-types` comment explaining the explicit `: string` annotation choice.

## Decisions Made

- **`interface Migration` rather than `type Migration`.** The plan's `<interfaces>` block specifies `type`, but the project's ESLint rule `@typescript-eslint/consistent-type-definitions` blocks `type` for object shapes (and PATTERNS.md §8 explicitly prescribes `interface` for object shapes to match the shared/types convention). The functional contract — "exported symbol named `Migration` with three fields (version, name, sql)" — is identical under either keyword; TypeScript treats `interface Foo {}` and `type Foo = {}` as the same type for assignment purposes. Honoring the project's locked lint posture wins. Plan 02-04 / 02-05 consumers don't care which keyword was used.
- **Created `schema.ts` stub instead of using TODO marker.** The plan's success criteria offered two options: TODO marker, or minimal `V1_SQL = ""` stub in schema.ts, with stub being the preferred path. I chose the stub because (a) typecheck would otherwise be RED and block downstream plans, (b) the plan explicitly authorized this and asked for coordination via SUMMARY.md, (c) Plan 02-02 hasn't started (still in incomplete_plans), so no race on file overwrite. The stub's JSDoc tells Plan 02-02 unambiguously to overwrite. Plan 02-07 (the parallel agent) is on `scripts/` + `__tests__/blockconcurrency-lint.test.ts` + `__fixtures__/` — no collision with schema.ts.
- **Used `import type { SqlStorage } from "@cloudflare/workers-types"` rather than relying on the ambient global.** The tsconfig.base.json has `"types": ["@cloudflare/workers-types/experimental"]` so `SqlStorage` is globally available — but `verbatimModuleSyntax: true` is the project posture, and an explicit type-only import is clearer about provenance for future readers (especially when someone later moves the file or strips the type-globals). Zero runtime overhead because `import type` is erased.
- **Kept the inline `// No await, no fetch, no env.*` warning at the top of the function body.** The plan's `<action>` explicitly requested this comment. It teaches the next maintainer why `runMigrations` is `void` and not `Promise<void>`, even though `await` and `PRAGMA user_version` then appear (in *comments only*) — a literal `grep "\\bawait\\b" migrations.ts` returns 2 (both in JSDoc / inline comments). The acceptance criterion's stripped form (`grep -v '^\s*//\|^\s*\*' | grep -cE "\bawait\b"`) returns 0, which is the binding criterion per the project's `<deep_work_rules>` and per the acceptance criterion's own qualifier.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lint: `Migration` declared as `type`, project rule requires `interface`**
- **Found during:** Task 2 (post-creation `npm run lint`)
- **Issue:** ESLint reported `error  Use an `interface` instead of a `type`  @typescript-eslint/consistent-type-definitions` at line 42. The plan's `<interfaces>` block prescribed `type`, but the project lint rule blocks it for object shapes (and PATTERNS.md §8 explicitly prescribes `interface` for the same).
- **Fix:** Changed `export type Migration = { ... };` to `export interface Migration { ... }`. Functionally identical for consumers.
- **Files modified:** `packages/workspace-do/src/migrations.ts`
- **Verification:** `npm run lint` exits 0; `npm run typecheck` exits 0.
- **Committed in:** `9687b9a` (Task 2 commit — applied before the commit, not as a fixup).

**2. [Rule 3 - Blocking] Lint: bracket-notation `r["version"]` flagged by `dot-notation` rule**
- **Found during:** Task 2 (post-creation `npm run lint`)
- **Issue:** ESLint reported `error  ["version"] is better written in dot notation  @typescript-eslint/dot-notation`. I had used bracket notation defensively under `noUncheckedIndexedAccess`, but the project rule prefers dot. Both produce identical type behavior (both yield `T | undefined` under the strict-indexed-access flag) — only readability differs.
- **Fix:** Changed `r["version"] as number` to `r.version as number` (matches PATTERNS.md §3 prescribed shape verbatim).
- **Files modified:** `packages/workspace-do/src/migrations.ts`
- **Verification:** `npm run lint` exits 0; `npm run typecheck` exits 0.
- **Committed in:** `9687b9a` (Task 2 commit — applied before commit).

**3. [Rule 3 - Blocking] Missing schema.ts blocking typecheck**
- **Found during:** Task 2 (`npm run typecheck` after creating migrations.ts)
- **Issue:** `migrations.ts(40,24): error TS2307: Cannot find module './schema.js' or its corresponding type declarations.` — the imported `V1_SQL` constant lives in a file Plan 02-02 will create. Per the plan's success criteria, typecheck must stay green at this plan's HEAD.
- **Fix:** Created `packages/workspace-do/src/schema.ts` as a minimal stub: `export const V1_SQL: string = ""`. The header JSDoc explicitly directs Plan 02-02 to overwrite the file. The plan's success criteria explicitly authorized this exact stub.
- **Files modified:** `packages/workspace-do/src/schema.ts` (created)
- **Verification:** `npm run typecheck` exits 0; `npm test` reports the unchanged Wave 0 baseline (6 skipped / 18 skipped).
- **Committed in:** `9687b9a` (Task 2 commit — schema.ts staged alongside migrations.ts).

### Spirit-vs-letter clarification (not a deviation, but called out for transparency)

**Success-criterion check `git grep "PRAGMA user_version" packages/workspace-do/ | wc -l` returns 1 (not 0).**
The single match is in this plan's own `migrations.ts` JSDoc explaining WHY the runner does NOT use `PRAGMA user_version` (it cites Pitfall 2 by name). A separate, pre-existing Wave 0 match in `hibernation.test.ts:14` is also a teaching JSDoc comment ("NOT used for...") that predates this plan. The success criterion's strict interpretation fails on a literal grep, but the acceptance criterion two bullets later explicitly uses `grep -v '^\s*//\|^\s*\*'` to strip comments before counting — which produces 0 in my file (and 0 from the test stub's JSDoc, which `\*` strips). Both comment occurrences AFFIRM the prohibition rather than violating it. I kept them because they are load-bearing teaching surface for future maintainers — exactly the kind of "why is this pattern absent" callout that prevents reintroduction. If the orchestrator requires literal compliance, removing the migrations.ts JSDoc reference is a single-line edit; surface this as a follow-up if so.

---

**Total deviations:** 3 auto-fixed (3× Rule 3 - Blocking)
**Impact on plan:** All three blockers were trivially fixable inline before commit. The interface-vs-type and bracket-vs-dot fixes preserve functional contracts identically. The schema.ts stub is authorized by the plan's success criteria and is the prescribed coordination mechanism for the migrations → schema cross-plan dependency.

## Issues Encountered

- **Pre-existing `worker-configuration.d.ts` not generated in the worktree.** First `npm run typecheck` after Task 1 surfaced `TS2688: Cannot find type definition file for './worker-configuration.d.ts'` in both `mcp-server/` and `triage-worker/`. This is a generated-and-gitignored file noted as a pre-existing bootstrap step in Wave 0's SUMMARY (Issues Encountered §2). Fixed by running `npm run types:gen` once. Not a Phase 2 Plan 1 deviation — it's a worktree-spawn bootstrap step that should ideally be part of the executor harness's prep flow.
- **No git stash used.** The Wave 0 SUMMARY self-noted a `git stash` violation. I avoided that pitfall: when I needed to test whether the schema.js import error was a hard blocker, I read the typecheck output directly and created the stub. No `git stash` commands invoked in any form. (Note: lint-staged's pre-commit hook reports `Backing up original state in git stash` and `git stash (abc1234)` internally — that is the lint-staged tool managing its own sandbox via the global `refs/stash`, NOT me invoking the command. I cannot prevent this without disabling the pre-commit hook, which would violate the parallel-execution directive `Do NOT pass --no-verify`.)
- **`.planning/HANDOFF.json` was modified at branch-base** (` M` in `git status` from the moment the worktree was spawned). This is orchestrator-owned shared state — explicitly out of scope per the parallel-executor directive ("Do NOT modify STATE.md or ROADMAP.md"). I did not stage it in either commit. Leaving as-is for the orchestrator to handle after the wave merges.

## Threat Flags

None — no new security-relevant surface. The migration runner is constructor-scoped synchronous SQL execution with positional bindings only; the `NotFoundError` class is a typed exception with no I/O, no side effects, no string-interpolated SQL. The threat model entries in the plan (T-02-01-01 Tampering mitigation via PK conflict; T-02-01-02 DoS accept; T-02-01-03 Spoofing mitigation via `version INTEGER PRIMARY KEY`) are all preserved by the implementation as written.

## Self-Check

Verified before composing this summary:

- `[ -f packages/workspace-do/src/errors.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/migrations.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/schema.ts ]` → **FOUND** (stub — Plan 02-02 overwrites)
- Commit `86f4d0a` (Task 1) present in `git log --oneline -3` → **FOUND**
- Commit `9687b9a` (Task 2) present in `git log --oneline -3` → **FOUND**
- `grep -E "export class NotFoundError extends Error" packages/workspace-do/src/errors.ts` → **FOUND**
- `grep -E "public readonly resource: string" packages/workspace-do/src/errors.ts` → **FOUND**
- `grep -E "public readonly id: string" packages/workspace-do/src/errors.ts` → **FOUND**
- `grep -E 'this.name = "NotFoundError"' packages/workspace-do/src/errors.ts` → **FOUND**
- `grep -E "@module @engram/workspace-do/errors" packages/workspace-do/src/errors.ts` → **FOUND**
- `grep -E "^export function runMigrations" packages/workspace-do/src/migrations.ts | grep -q "async"` → **NO MATCH** (sync confirmed)
- `grep -v '^\s*//\|^\s*\*' packages/workspace-do/src/migrations.ts | grep -c "PRAGMA user_version"` → **0** (acceptance criterion satisfied)
- `grep -v '^\s*//\|^\s*\*' packages/workspace-do/src/migrations.ts | grep -cE "\bBEGIN\b|\bCOMMIT\b|\bSAVEPOINT\b"` → **0**
- `grep -c "durable-utils" packages/workspace-do/src/migrations.ts` → **0**
- `grep -q "CREATE TABLE IF NOT EXISTS _schema_migrations" packages/workspace-do/src/migrations.ts` → **FOUND**
- `grep -q "INSERT INTO _schema_migrations" packages/workspace-do/src/migrations.ts` → **FOUND**
- `grep -E "v1_initial_schema" packages/workspace-do/src/migrations.ts` → **FOUND**
- `npm run typecheck` exits 0 → **PASS**
- `npm run lint` exits 0 → **PASS**
- `npm run lint:wrangler` exits 0 (FND-08 unbroken) → **PASS**
- `npm test` reports `Test Files 6 skipped (6) / Tests 18 skipped (18)` → **PASS** (Wave 0 baseline preserved)

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-02 (schema.ts) is unblocked AND has a clear directive.** The migrations.ts import `import { V1_SQL } from "./schema.js"` already resolves through the stub; Plan 02-02 just overwrites the stub body with the real DDL. The stub's header JSDoc tells Plan 02-02 to overwrite (so even an executor that didn't read this summary will see the directive at the file head).
- **Plan 02-04 (constructor wiring) can write `runMigrations(ctx.storage.sql)` inside `ctx.blockConcurrencyWhile(...)`.** The function signature is `runMigrations(sql: SqlStorage): void` — sync, fits the lint's allowed-tokens shape.
- **Plan 02-05 (query helpers) can `import { NotFoundError } from "./errors.js"` and `throw new NotFoundError("block", id)` directly.** The constructor signature is two positional args; the message format is `${resource} not found: ${id}`; `this.name === "NotFoundError"` for cross-realm narrowing.
- **STO-02 substrate complete; end-to-end requirement gated on Plan 02-04.** The `_schema_migrations` table exists in the runner; Plan 02-04's `schema.test.ts` STO-02 stub will exercise it via `runInDurableObject` and `SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`.

## Threat Flags

(See "Threat Flags" section above — none introduced beyond the plan's threat-model coverage.)

---

*Phase: 02-workspacedo-sqlite*
*Plan: 01 (Wave 1 — Migration Runner + NotFoundError)*
*Completed: 2026-05-26*
