---
phase: 02-workspacedo-sqlite
plan: 03
subsystem: workspace-do
tags: [cloudflare, durable-objects, sqlite, seeding, system-types, idempotency, STO-05]

# Dependency graph
requires:
  - phase: 02-workspacedo-sqlite
    plan: 00
    provides: "Vitest test infrastructure — seeding.test.ts RED stubs continue to skip (STO-05 GREEN turn-on lands in Plan 02-04 once the constructor wires runMigrations + seedSystemTypes inside blockConcurrencyWhile)."
  - phase: 02-workspacedo-sqlite
    plan: 01
    provides: "runMigrations(sql: SqlStorage): void synchronous-helper pattern — seedSystemTypes mirrors the signature exactly so both call into the same blockConcurrencyWhile block in Plan 04."
  - phase: 02-workspacedo-sqlite
    plan: 02
    provides: "V1_SQL DDL ships the memory_types table (id PK, name NOT NULL, fields TEXT-as-JSON NOT NULL, workspace_id, source NOT NULL) — column order matches the INSERT statement's positional bindings byte-for-byte."
provides:
  - "packages/workspace-do/src/seeding.ts — `export function seedSystemTypes(sql: SqlStorage): void`. Iterates SYSTEM_TYPES from @engram/schema and writes each as `INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source) VALUES (?, ?, ?, NULL, 'system')` — synchronous, no env.*, no fetch, no async work. Idempotent on PK collision (id): re-running yields exactly 7 rows."
affects:
  - 02-04-constructor-wiring (calls seedSystemTypes(ctx.storage.sql) immediately after runMigrations inside blockConcurrencyWhile; turns seeding.test.ts STO-05 RED stubs GREEN)
  - 02-04-hibernation-test (STO-09 hibernation-replay test asserts SELECT COUNT(*) FROM memory_types stays at 7 after double-init — this file's INSERT OR IGNORE is the mechanism)
  - 02-05-query-helpers (listMemoryTypes will JSON.parse on read against the same fields column that JSON.stringify wrote — round-trip contract per D-03)
  - Phase 3 MCP tool boundary (user-defined memory types arrive with source='user' or 'community' — this file's hard-coded source='system' literal is the discriminant that distinguishes the two)

# Tech tracking
tech-stack:
  added: []  # Zero new deps. Pure-data seed loop consuming SYSTEM_TYPES from the already-installed @engram/schema workspace symlink.
  patterns:
    - "Sync helper signature matching runMigrations from Plan 02-01 — both run inside the same blockConcurrencyWhile block, both return void, both forbid async/await (STO-10 lint enforces statically; passes 12 files clean post-add)"
    - "INSERT OR IGNORE for PK-collision idempotency — re-running the loop N times on the same SQLite store still produces exactly 7 rows. The clause is the entire mechanism behind STO-05's 'idempotent' requirement and STO-09's hibernation-replay invariant"
    - "JSON.stringify on the helper boundary (D-03) — fields column is TEXT-as-JSON per Plan 02-02's V1_SQL DDL; future read helpers in Plan 02-05 will JSON.parse on the symmetric read side"
    - "Hard-coded NULL and 'system' SQL literals (not bindings) — these are discriminants distinguishing system seeds from user/community types per CLAUDE.md §SQLite Schema. Binding them would invite the spoofing threat T-02-03-02; hard-coding at the seed site mitigates it by construction"
    - "Positional ? placeholders only (Key APIs §B) — named parameters (:name) are unsupported in workerd's SQLite. Single-statement .exec() per loop iteration sidesteps the multi-statement binding pitfall (Pitfall 8)"

key-files:
  created:
    - "packages/workspace-do/src/seeding.ts (68 lines: 53-line JSDoc header documenting the 5 explicit design decisions + wiring contract, followed by the export function and a 7-iteration for-loop calling sql.exec with 3 positional bindings and 2 hard-coded SQL literals)"
  modified: []

key-decisions:
  - "Kept the inline blockConcurrencyWhile/idempotency comment as a single long line at line 59 inside the function body. Plan's <action> directive specified the EXACT comment text verbatim ('Sync function — called inside blockConcurrencyWhile from WorkspaceDO constructor. INSERT OR IGNORE provides idempotency on PK collision (id), so this loop is safe to re-run on hibernation replay (STO-09).'). Prettier did not break the line on commit (the line is part of the function body, not the JSDoc header, so the print-width rule applied differently — verified post-commit by re-reading the file). Future maintainers grepping for STO-09 or 'INSERT OR IGNORE provides idempotency' will find the contract at the call site."
  - "Imported SqlStorage as a type-only import (`import type { SqlStorage }`) — matches Plan 01's migrations.ts pattern and complies with strict-TS verbatimModuleSyntax. Runtime never instantiates SqlStorage; it's only a parameter type."
  - "Imports ordering: type-only first, then runtime. Matches Plan 01 / Plan 02 sibling files; prettier's import-order plugin reordered nothing on commit. Both imports are at the top-level, single blank line between them."
  - "Used `for (const t of SYSTEM_TYPES)` rather than `SYSTEM_TYPES.forEach(t => ...)`. The plan's <action> directive prescribed the `for...of` form. The for...of variant is also lint-cleaner under no-array-callback-return / no-async-promise-executor rules (which don't fire here either way, but the for...of form is the prescribed source-of-truth from 02-RESEARCH.md §2 and 02-PATTERNS.md §5)."
  - "Did NOT add zod validation of t.fields before JSON.stringify. D-03 explicitly defers runtime schema validation to Phase 4's MCP tool-input boundary. SYSTEM_TYPES is `as const satisfies readonly SystemMemoryType[]` so TS rejects any undefined field at definition time — Pitfall 4 (JSON.stringify silently drops undefined) cannot bite for system seeds. User-defined types in Phase 3+ will need zod at the MCP tool boundary; that's not this file's job."

requirements-completed: [STO-05]  # STO-05 substrate is in place — seeding.ts exists, exports the correct synchronous shape, and uses INSERT OR IGNORE for idempotency. Plan 02-04 wires the constructor call and turns the seeding.test.ts RED stubs (currently skipped) GREEN, completing the end-to-end requirement at runtime.

# Metrics
duration: ~5m (active commit time including baseline-bootstrap of worker-configuration.d.ts; pre-execution context loading not included)
completed: 2026-05-25
---

# Phase 2 Plan 03: System-Type Seeding Summary

**`packages/workspace-do/src/seeding.ts` now exports `seedSystemTypes(sql: SqlStorage): void` — a synchronous loop over the 7 canonical SYSTEM_TYPES from `@engram/schema` that issues `INSERT OR IGNORE INTO memory_types (id, name, fields, workspace_id, source) VALUES (?, ?, ?, NULL, 'system')` per iteration. `INSERT OR IGNORE` is the PK-collision idempotency mechanism (STO-05 + STO-09); re-running the loop yields exactly 7 rows.**

## Performance

- **Duration:** ~5m (active commit time)
- **Tasks:** 1 (single-task plan)
- **Files created:** 1 (`packages/workspace-do/src/seeding.ts`)
- **Files modified:** 0

## Accomplishments

- **`packages/workspace-do/src/seeding.ts` created (68 lines).** File structure:
  - 53-line JSDoc header (`@module @engram/workspace-do/seeding`) documenting:
    1. The STO-05 requirement, the 7 canonical system memory type IDs (verbatim from CLAUDE.md §"Memory Types (Schema-as-Data)"), and the PK-collision idempotency invariant.
    2. **Synchronous** — matches `runMigrations` from Plan 02-01; both run inside the same `blockConcurrencyWhile` block in Plan 02-04. STO-10 lint forbids async/await/env.*/fetch inside that block.
    3. **JSON at the helper boundary (D-03)** — `JSON.stringify(t.fields)` on write; Plan 02-05's read helpers will `JSON.parse` on the symmetric read side. `SYSTEM_TYPES` is `as const satisfies readonly SystemMemoryType[]`, so Pitfall 4 (JSON.stringify silently drops undefined) cannot bite.
    4. **`workspace_id = NULL` and `source = 'system'`** are hard-coded SQL literals (NOT bindings) — discriminants distinguishing system seeds from user/community types per CLAUDE.md §"SQLite Schema". Mitigates threat T-02-03-02 (spoofing) by construction.
    5. **Positional `?` bindings only** (Key APIs §B). Single-statement `.exec()` per loop iteration sidesteps Pitfall 8.
    6. **No non-system seed inserts** (PATTERNS §5 drift risk). User-defined types arrive through MCP tool calls in Phase 3+, not this loop.
  - 1 imports block: `import type { SqlStorage } from "@cloudflare/workers-types"` + `import { SYSTEM_TYPES } from "@engram/schema"` (workspace package name — NOT a relative path; reuses the Phase 1 FND-05 symlink-resolution smoke).
  - 1 exported function (`seedSystemTypes(sql: SqlStorage): void`) with an inline comment at the top of the function body citing the blockConcurrencyWhile constraint and the STO-09 hibernation-replay rationale.
  - 1 `for (const t of SYSTEM_TYPES)` loop body containing exactly 1 `sql.exec(...)` call with 3 positional bindings (`t.id`, `t.name`, `JSON.stringify(t.fields)`) and 2 hard-coded literals in the SQL (`NULL`, `'system'`).
- **Invariants the file establishes:**
  - **Idempotency on PK collision.** `INSERT OR IGNORE` is the SQLite-level guarantee: re-running the loop N times on the same store still produces exactly 7 rows. Plan 02-04's `seeding.test.ts` will assert this with a double-init test (which is currently skipped at `expect.fail("not yet implemented — Plan 02-03")`).
  - **Source discriminant integrity.** Every row this file writes has `workspace_id IS NULL` AND `source = 'system'`. Plan 02-05's read helpers can filter on these literals to distinguish system seeds from user-defined types without a separate boolean column.
  - **JSON round-trip preservation.** `JSON.parse(JSON.stringify(t.fields))` on any SystemMemoryType in the SYSTEM_TYPES array returns the same structure (no undefined values, no functions, no circular refs — TS rejects them all at SYSTEM_TYPES definition time). Plan 02-05's `listMemoryTypes` will JSON.parse on read and get back the same FieldDefinition[] shape.
  - **Synchronous-only surface area.** No async/await/env.*/fetch tokens anywhere in the file (verified by grep + the STO-10 lint scan). The file is safe to call inside the constructor's `blockConcurrencyWhile` block without violating Pitfall 1.
- **All gates green at HEAD `9e1f5c2`:**
  - `npm run typecheck` exits 0 (the imports resolve cleanly; SYSTEM_TYPES's `as const` literal type is consumed implicitly through the for...of loop).
  - `npm test --workspace @engram/workspace-do -- --run` reports `Test Files 1 passed | 5 skipped (6) / Tests 3 passed | 16 skipped (19)` — the STO-05 RED stubs in `seeding.test.ts` still skip (they fill in once Plan 04 wires `seedSystemTypes` into the constructor; the introspection assertions will then run against the 7 rows this file writes).
  - `npm run lint` (ESLint) exits 0.
  - `npm run lint:blockconcurrency` (STO-10) exits 0; checked 12 files (was 11 before this plan — seeding.ts added to the scan).
- **Pre-commit hooks succeeded** on the single commit. lint-staged ran ESLint (`--fix`) + Prettier on `seeding.ts` with no changes that broke the inline blockConcurrencyWhile comment (verified by re-reading the file post-commit — line 59 survived prettier intact as a single long line inside the function body, not split). No `--no-verify` used.

## Task Commits

1. **Task 1: seeding.ts (system-type seed loop)** — `9e1f5c2` (feat) — 1 file created, 68 insertions

## Files Created/Modified

- **`packages/workspace-do/src/seeding.ts`** (CREATED — 68 lines)
  - File-header JSDoc (lines 1-53): purpose statement, 5 explicit design-notes bullets (synchronous, JSON-at-boundary, hard-coded literals, positional bindings, no non-system entries), wiring contract, `@module @engram/workspace-do/seeding` tag.
  - Imports (lines 54-56): `SqlStorage` type-only + `SYSTEM_TYPES` runtime.
  - Exported function `seedSystemTypes(sql: SqlStorage): void` (lines 58-68) — body is a `for...of` over SYSTEM_TYPES calling `sql.exec` once per iteration with the prescribed INSERT OR IGNORE shape.

## Decisions Made

- **Single-line inline comment inside the function body** (line 59) survived prettier's print-width pass. Prettier's behavior on a 200-char comment line inside a function body is "leave it alone" (no JSDoc reflow rules apply to single-line `//` comments). The verbatim comment text from the plan's `<action>` directive was preserved byte-for-byte. Future maintainers grepping for `STO-09` or `INSERT OR IGNORE provides idempotency` will find the contract at the call site.
- **Type-only import for `SqlStorage`.** Matches Plan 01's `migrations.ts` precedent and complies with strict-TS `verbatimModuleSyntax`. Runtime never instantiates the type; it's purely a parameter annotation.
- **`for (const t of SYSTEM_TYPES)` loop form.** Prescribed by the plan's `<action>` directive and by `02-RESEARCH.md §2`. The for...of form is also lint-friendlier (no arrow-fn callback rules fire). The `as const satisfies readonly SystemMemoryType[]` upstream type on SYSTEM_TYPES means `t` is correctly narrowed as `SystemMemoryType` inside the loop body.
- **No runtime schema validation of `t.fields`.** D-03 explicitly defers zod to Phase 4's MCP tool-input boundary. The SYSTEM_TYPES upstream type already validates the shape at compile time. Adding zod here would (a) duplicate the compile-time check, (b) add a phantom-transitive dep on zod that workspace-do doesn't declare, and (c) violate the deferral decision.
- **Reused the `worker-configuration.d.ts` bootstrap step from Plans 01/02.** Same one-time worktree-spawn issue. Same one-line fix: `npm run types:gen` once. Same suggestion: this should ideally be part of the executor harness's prep flow rather than recurring on every fresh worktree spawn.
- **Did NOT modify `packages/workspace-do/package.json`.** All required deps (`@engram/schema`, `@cloudflare/workers-types`) were already declared by Plan 00. Verified by reading the package.json upfront — no edit needed.

## Deviations from Plan

None of the Rule 1-4 deviation classes triggered. The plan's `<action>` directives, `<acceptance_criteria>` block, and verification gates were satisfied as-written.

## Issues Encountered

- **`worker-configuration.d.ts` not generated in the worktree.** First `npm run typecheck` after worktree spawn surfaced `TS2688: Cannot find type definition file for './worker-configuration.d.ts'` in both `mcp-server/` and `triage-worker/`. Same one-time bootstrap issue documented in Plan 01's and Plan 02's SUMMARYs. Fixed by running `npm run types:gen` once. Same suggestion as prior plans: this should ideally be part of the executor harness's prep flow.
- **`.planning/HANDOFF.json` was modified at branch-base** (` M` in `git status` from the moment the worktree was spawned). Orchestrator-owned shared state per the `<parallel_execution>` directive ("Do NOT modify STATE.md or ROADMAP.md"). I did not stage it. Leaving as-is for the orchestrator to handle after the wave merges.
- **No `git stash` invoked.** I did not invoke `git stash` in any form during this plan. lint-staged's pre-commit hook reports `Backing up original state in git stash (789435b)` internally — that is lint-staged managing its own sandbox via the global `refs/stash`. The project CLAUDE.md `<destructive_git_prohibition>` rule targets *my* invocations; I cannot suppress lint-staged's behavior without `--no-verify`, which is also forbidden.

## Threat Flags

None — no new security-relevant surface introduced beyond the plan's threat-model coverage. The threat-model entries in the plan are all preserved by the implementation as written:

- **T-02-03-01 (Tampering — `memory_types` system rows):** *Mitigated by `INSERT OR IGNORE`.* PK conflict is a no-op, not a throw. Plan 02-04's hibernation-replay test will verify the count stays at 7 after double-init.
- **T-02-03-02 (Spoofing — user adds a row with `source='system'` post-seed):** *Mitigated at the seed site.* This file ONLY writes `source = 'system'` from a hard-coded SQL literal (not a binding). User-defined types in Phase 3+ will write `source = 'user'` or `'community'` through MCP tool calls; cross-source-discriminant validation lands at the Phase 4 tool boundary per D-03.
- **T-02-03-03 (Tampering — `t.fields` JSON serialization corruption):** *Accepted.* SYSTEM_TYPES is `as const satisfies readonly SystemMemoryType[]`, which rejects `undefined` field values at definition time — so `JSON.stringify`'s "silently drops undefined" pitfall (`02-RESEARCH.md` Pitfall 4) cannot bite. `JSON.parse` on the read side is the canonical inverse per D-03.

## Self-Check

Verified before composing this summary:

- `[ -f packages/workspace-do/src/seeding.ts ]` → **FOUND**
- Commit `9e1f5c2` (Task 1) present in `git log --oneline -3` → **FOUND**
- `grep -c "INSERT OR IGNORE INTO memory_types" packages/workspace-do/src/seeding.ts` → **2** (1 in JSDoc reference + 1 in the actual SQL string) ✓
- `grep -c "SYSTEM_TYPES" packages/workspace-do/src/seeding.ts` → **3+** (1 in JSDoc + 1 in import + 1 in for...of loop) ✓
- `grep -c "JSON.stringify(t.fields)" packages/workspace-do/src/seeding.ts` → **1** (the binding) ✓
- `grep -q "export function seedSystemTypes" packages/workspace-do/src/seeding.ts` → **FOUND** ✓
- `grep -q "from \"@engram/schema\"" packages/workspace-do/src/seeding.ts` → **FOUND** (workspace package name, not relative path) ✓
- `grep -q "VALUES (?, ?, ?, NULL, 'system')" packages/workspace-do/src/seeding.ts` → **FOUND** (hard-coded NULL + 'system' SQL literals) ✓
- `grep -v '^\s*//\|^\s*\*' packages/workspace-do/src/seeding.ts | grep -cE "\basync\b|\bawait\b"` → **0** (synchronous only — STO-10 invariant) ✓
- `grep -cE "env\.|fetch\(|await this\.ai" packages/workspace-do/src/seeding.ts` → **0** ✓
- File header JSDoc contains `@module @engram/workspace-do/seeding` → **FOUND**
- File header JSDoc cites `STO-05` and `D-03` → **both FOUND**
- Actual `sql.exec` count in code (excluding comments): **1** — no drift from system-only seeds ✓
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` (deletions in last commit) → **empty** ✓
- `npm run typecheck` exits 0 → **PASS**
- `npm test --workspace @engram/workspace-do -- --run` reports `Test Files 1 passed | 5 skipped (6) / Tests 3 passed | 16 skipped (19)` → **PASS** (baseline preserved; STO-05 RED stubs still skip pending Plan 04 wire-in)
- `npm run lint` (ESLint) exits 0 → **PASS**
- `npm run lint:blockconcurrency` exits 0 (`OK — checked 12 file(s)` — up from 11; seeding.ts added) → **PASS**

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-04 (constructor wiring + seeding.test.ts GREEN) is unblocked.** The constructor body in `packages/workspace-do/src/index.ts` will add:
  ```typescript
  void ctx.blockConcurrencyWhile(async () => {
    runMigrations(ctx.storage.sql);
    seedSystemTypes(ctx.storage.sql);
  });
  ```
  After that wire-in, the two skipped tests in `seeding.test.ts` will fill in:
  - "seeds 7 system memory types on first init" → `SELECT COUNT(*) AS n FROM memory_types WHERE source='system'` returns `{ n: 7 }`.
  - "double-init produces 7 types, not 14" → invoke `seedSystemTypes(sql)` twice via `runInDurableObject`; assert the count remains 7. This is the STO-05 idempotency proof.
- **Plan 02-04 hibernation-replay test (STO-09) is unblocked.** The hibernation.test.ts STO-09 case asserts `SELECT COUNT(*) FROM memory_types` stays at 7 after the DO is re-instantiated. The INSERT OR IGNORE in this file is the underlying mechanism — `_schema_migrations` PK guarantees migrations don't re-run, and `memory_types` PK (id) plus the IGNORE clause guarantees seeds don't duplicate.
- **Plan 02-05 (queries.ts → listMemoryTypes) is unblocked.** The read-side symmetry contract is in place: this file's `JSON.stringify(t.fields)` on write means `listMemoryTypes` can `JSON.parse(row.fields as string)` on read and round-trip back to the FieldDefinition[] shape. Filter predicates on `source='system'` will distinguish system seeds from any future user-defined types.

---

*Phase: 02-workspacedo-sqlite*
*Plan: 03 (Wave 3 — system-type seeding)*
*Completed: 2026-05-25*
