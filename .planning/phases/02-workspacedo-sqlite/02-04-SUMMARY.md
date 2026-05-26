---
phase: 02-workspacedo-sqlite
plan: 04
subsystem: workspace-do
tags: [durable-objects, sqlite, blockconcurrencywhile, hibernation, vitest-pool-workers, migrations, seeding]

# Dependency graph
requires:
  - phase: 02-workspacedo-sqlite
    plan: 00
    provides: "vitest infra + RED stubs at src/__tests__/{schema,seeding,hibernation}.test.ts + wrangler.test.jsonc binding for the test pool"
  - phase: 02-workspacedo-sqlite
    plan: 01
    provides: "runMigrations(sql): void — synchronous migration runner that idempotently writes to _schema_migrations"
  - phase: 02-workspacedo-sqlite
    plan: 02
    provides: "V1_SQL DDL constant — 7 tables + indexes, including STO-04 embedding_model + embedding_version columns on blocks"
  - phase: 02-workspacedo-sqlite
    plan: 03
    provides: "seedSystemTypes(sql): void — synchronous INSERT OR IGNORE loop over SYSTEM_TYPES"
provides:
  - "WorkspaceDO class with working constructor that calls ctx.blockConcurrencyWhile(async () => { runMigrations(sql); seedSystemTypes(sql); }) — sync work only, env: unknown, void-discarded fire-and-forget"
  - "schema.test.ts GREEN — 3 tests proving STO-02 (_schema_migrations row shape), STO-03 (7 user tables via sqlite_master), STO-04 (embedding columns via PRAGMA table_info)"
  - "seeding.test.ts GREEN — 2 tests proving STO-05 (7-row count + sorted IDs match SYSTEM_TYPES + idempotency on second construction)"
  - "hibernation.test.ts GREEN — 1 test proving STO-09 (two-call runInDurableObject on same idFromName keeps migrations=1 and memory_types=7)"
  - "packages/workspace-do/tsconfig.json now declares @cloudflare/vitest-pool-workers/types so `cloudflare:test` module resolves at typecheck"
  - "packages/workspace-do/src/__tests__/__env.d.ts ambient-augments Cloudflare.Env with the WORKSPACE binding (scoped to the test directory)"
affects: [02-05-query-helpers, 02-06-defense-in-depth, 02-08-validation, 03-mcp-server-scaffold]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WorkspaceDO constructor wires migrations + seeding inside a single void-discarded blockConcurrencyWhile call (PATTERNS.md §2 — fire-and-forget initialization)"
    - "`extends DurableObject<unknown>` generic (not bare `extends DurableObject`) so `super(ctx, env: unknown)` typechecks against the base `DurableObject<Env = Cloudflare.Env>` signature — mirrors Plan 00 fixture fix"
    - "Scoped `@typescript-eslint/require-await` disable around the bootstrap call — the async callback contract is required by blockConcurrencyWhile's signature even though STO-10 forbids any await inside"
    - "Hand-written ambient `Cloudflare.Env` augmentation (src/__tests__/__env.d.ts) instead of `wrangler types` codegen — preserves the wrangler.test.jsonc design intent of omitting compatibility_date"
    - "Test-pool tsconfig types: add @cloudflare/vitest-pool-workers/types so `cloudflare:test` module resolves under the workspace-do tsconfig"
    - "Verbatim two-call runInDurableObject hibernation recipe (PATTERNS.md §11 / 02-RESEARCH.md §3) — no mocks, real workerd, observable invariant only (honesty note per Open Question O1)"

key-files:
  created:
    - "packages/workspace-do/src/__tests__/__env.d.ts (ambient Cloudflare.Env augmentation for test pool)"
  modified:
    - "packages/workspace-do/src/index.ts (Phase 1 stub → full WorkspaceDO constructor body)"
    - "packages/workspace-do/src/__tests__/schema.test.ts (RED → GREEN, STO-02/03/04)"
    - "packages/workspace-do/src/__tests__/seeding.test.ts (RED → GREEN, STO-05)"
    - "packages/workspace-do/src/__tests__/hibernation.test.ts (RED → GREEN, STO-09)"
    - "packages/workspace-do/tsconfig.json (added @cloudflare/vitest-pool-workers/types to compilerOptions.types)"

key-decisions:
  - "Used `extends DurableObject<unknown>` (not bare `DurableObject`) to thread the `unknown` env type through to the base-class generic — same fix Plan 00 applied to fixtures (see 02-00-SUMMARY.md Deviation #3). The PATTERNS.md §2 sketch showed the bare form, but strict TS requires the generic to make `super(ctx, env)` typecheck. Rule 1 - Bug auto-fix."
  - "Hand-wrote __env.d.ts ambient Cloudflare.Env augmentation instead of generating worker-configuration.d.ts via `wrangler types`. Rationale: `wrangler types` requires `compatibility_date` in wrangler.test.jsonc, but the design intent (Plan 00 header comment) is to OMIT compatibility_date so the test pool always picks up the latest workerd. Adding one would freeze the test runtime. The hand-written augmentation mirrors the wrangler-generated shape (`__BaseEnv_Env` pattern, `Cloudflare.Env extends`) exactly. Rule 3 - Blocking auto-fix."
  - "Added @cloudflare/vitest-pool-workers/types to packages/workspace-do/tsconfig.json `compilerOptions.types`. Without it, `import { runInDurableObject } from \"cloudflare:test\"` fails typecheck with `TS2307: Cannot find module 'cloudflare:test'`. Rule 3 - Blocking auto-fix."
  - "Used the deprecated-comment-confirmed canonical pool API pattern: `runInDurableObject` from `cloudflare:test`, `env` from `cloudflare:workers` (the `env` re-export in `cloudflare:test` is `@deprecated` per the .d.ts types). This is what the plan's interface block prescribed and matches the post-Cloudflare-deprecation public API."
  - "Wrapped the entire blockConcurrencyWhile call in a scoped `/* eslint-disable @typescript-eslint/require-await */` block. The callback contractually MUST be async (the API signature is `() => Promise<T>`), but STO-10 forbids any `await` inside the bootstrap body — the rule would fail every well-formed STO-compliant constructor without this disable. Same pattern as the Plan 00 good-blockconcurrency.ts fixture."
  - "Did NOT modify packages/mcp-server/wrangler.jsonc — D-06 invariant explicitly preserved. The Phase 1 v1 migration entry `new_sqlite_classes: [\"WorkspaceDO\"]` remains the sole entry; the v2 migration adding `EngramMcp` lands in Phase 3 per CONTEXT.md D-06."
  - "Did NOT uncomment the `export { NotFoundError } from \"./errors.js\"` re-export in index.ts. The `./errors.ts` module lands in Plan 02-05; commenting out the re-export keeps the package barrel typecheck-clean during the Plan 02-04 → 02-05 transition."

patterns-established:
  - "Per-package ambient Env augmentation pattern: when a library-only workspace package uses @cloudflare/vitest-pool-workers for testing, create `src/__tests__/__env.d.ts` to augment `Cloudflare.Env` with the test-pool bindings declared in `wrangler.test.jsonc`. Mirrors the `__node-shims.d.ts` co-located convention from Plan 00."
  - "DurableObject constructor with `env: unknown`: pair `extends DurableObject<unknown>` with `constructor(ctx, env: unknown)` so strict TS accepts the `super(ctx, env)` call — this is the canonical 'env-type-agnostic DO' shape going forward."
  - "blockConcurrencyWhile bootstrap with `void` discard + scoped require-await disable: the standard wrapper for any `void ctx.blockConcurrencyWhile(async () => { /* sync only */ })` pattern under strict ESLint configs."

requirements-completed: [STO-01, STO-02, STO-03, STO-04, STO-05, STO-09]

# Metrics
duration: 17m
completed: 2026-05-25
---

# Phase 2 Plan 04: WorkspaceDO Constructor + GREEN Tests Summary

**WorkspaceDO constructor now wires runMigrations + seedSystemTypes inside ctx.blockConcurrencyWhile, and the schema / seeding / hibernation test files are GREEN — 9 of the workspace-do suite's 19 tests now pass (the other 10 are Plan 05/06 territory + 1 deferred CI canary).**

## Performance

- **Duration:** ~17m
- **Started:** 2026-05-25T17:33Z (worktree branch creation)
- **Completed:** 2026-05-25T17:48Z (Task 3 commit)
- **Tasks:** 3
- **Files created:** 1 (`packages/workspace-do/src/__tests__/__env.d.ts`)
- **Files modified:** 4 (index.ts, schema.test.ts, seeding.test.ts, hibernation.test.ts, tsconfig.json — 5 if you count tsconfig.json which was already touched by Plan 00 but extended again here)

## Accomplishments

- **WorkspaceDO constructor wired (Task 1).** `packages/workspace-do/src/index.ts` evolved from the Phase 1 empty-body stub to the production constructor: `void ctx.blockConcurrencyWhile(async () => { runMigrations(ctx.storage.sql); seedSystemTypes(ctx.storage.sql); })`. Sync work only inside the block — the forbidden-token grep `env.|fetch(|await this.ai|await ctx.storage.transaction(|await import(|await this.env` returns 0 in non-comment lines. Class declared `extends DurableObject<unknown>` so `super(ctx, env: unknown)` typechecks against the base-class `DurableObject<Env = Cloudflare.Env>` signature.
- **schema.test.ts + seeding.test.ts GREEN (Task 2).** 5 tests now pass against live workerd via `@cloudflare/vitest-pool-workers`:
  - STO-02: `_schema_migrations` row count + `{version: 1, name: "v1_initial_schema", applied_at: <number>}` shape.
  - STO-03: 7 user tables present per `SELECT name FROM sqlite_master WHERE type='table'` (filtering `_schema_migrations` + `sqlite_*`).
  - STO-04: `PRAGMA table_info(blocks)` includes `embedding_model TEXT` + `embedding_version INTEGER` (case-insensitive type comparison).
  - STO-05 happy path: `SELECT COUNT(*) FROM memory_types` returns 7 + sorted IDs equal `SYSTEM_TYPES.map(t => t.id).sort()`.
  - STO-05 idempotency: two sequential `runInDurableObject` calls on same `idFromName` keep count at 7.
- **hibernation.test.ts GREEN (Task 3).** 1 test proves STO-09 — two `runInDurableObject` calls on the same `idFromName("ws-replay-test")` value, first call asserts `_schema_migrations.count == 1` AND `memory_types.count == 7`, second call asserts the SAME counts. Header documents the honesty note from Open Question O1 (the test asserts the observable user-visible invariant; vitest-pool-workers' instance-vs-isolate semantics are not part of its public contract).
- **STO-01 verified, not modified (D-06 invariant preserved).** `packages/mcp-server/wrangler.jsonc` still binds `{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }` and still has only the Phase 1 v1 migration entry with `new_sqlite_classes: ["WorkspaceDO"]`. `npm run lint:wrangler` exits 0 throughout.
- **STO-10 production scan still clean.** `npm run lint:blockconcurrency` reports `OK — checked 13 file(s)` (12 from Plan 00 + the new `__env.d.ts`). The new production constructor body in `src/index.ts` contains no forbidden tokens; the grep-based check the plan specifies in its `<verify>` block returns 0 violations.
- **Full workspace-do test suite breakdown:** 9 passing (3 schema + 2 seeding + 1 hibernation + 3 blockconcurrency-lint from Plan 00 — proven passing because Task 1 didn't break the production scan) and 10 skipped (7 helpers — Plan 02-05; 2 defense-in-depth — Plan 02-06; 1 blockconcurrency-lint exit-2 canary — Plan 02-08 CI fixture). 19 total = matches the Plan 00 RED-stub count, no tests lost or added beyond plan scope.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite WorkspaceDO body (constructor + blockConcurrencyWhile wiring)** — `147b4bc` (feat)
2. **Task 2: Fill in schema.test.ts + seeding.test.ts (STO-02/03/04/05 GREEN)** — `ef9571c` (test)
3. **Task 3: Fill in hibernation.test.ts (STO-09 GREEN)** — `fa5aa83` (test)

## Files Created/Modified

- `packages/workspace-do/src/index.ts` (REWRITE from stub) — WorkspaceDO class body. Imports: `DurableObject` from `cloudflare:workers`, `runMigrations` from `./migrations.js`, `seedSystemTypes` from `./seeding.js`. Class declared `extends DurableObject<unknown>`. Constructor signature: `constructor(ctx: DurableObjectState, env: unknown)`. Body: `super(ctx, env);` then `void ctx.blockConcurrencyWhile(async () => { runMigrations(ctx.storage.sql); seedSystemTypes(ctx.storage.sql); });` wrapped in a scoped `@typescript-eslint/require-await` disable block. Inline comment cites STO-02 + STO-05 + STO-09 + the STO-10 lint future enforcement. The `NotFoundError` re-export is commented out (Plan 02-05 creates `./errors.ts`); the typed query helpers + `assertOwnsWorkspace` are deferred to Plans 02-05/06 via explicit `// Plan 02-XX adds...` comments at the seams.
- `packages/workspace-do/src/__tests__/__env.d.ts` (CREATE) — Ambient declaration augmenting `Cloudflare.Env` with `WORKSPACE: DurableObjectNamespace<WorkspaceDO>`. Header comment explains in full why the hand-written augmentation is required (wrangler.test.jsonc intentionally omits `compatibility_date`, so `wrangler types` cannot run; the augmentation mirrors what the codegen would have produced from the test config). Scoped to `src/__tests__/` so production code under `src/` never sees it. Includes an `eslint-disable-next-line @typescript-eslint/no-empty-object-type` annotation on the augmentation pattern (the rule's false-positive on the canonical wrangler-types augmentation idiom).
- `packages/workspace-do/src/__tests__/schema.test.ts` (RED → GREEN) — Three describe blocks. (1) `_schema_migrations table (STO-02)` — one test asserting `length === 1`, `version === 1`, `name === "v1_initial_schema"`, `typeof applied_at === "number"`. (2) `table presence (STO-03)` — one test asserting the sorted user-table list (after filtering `_schema_migrations` + `sqlite_*`) equals the sorted EXPECTED_TABLES constant (7 entries). (3) `blocks embedding columns (STO-04)` — one test using `PRAGMA table_info(blocks)` to find rows with `name === "embedding_model"` (type TEXT) and `name === "embedding_version"` (type INTEGER), case-insensitive comparison defensively against workerd type-affinity normalization drift.
- `packages/workspace-do/src/__tests__/seeding.test.ts` (RED → GREEN) — One describe block, two tests. (1) Happy path — `SELECT COUNT(*) FROM memory_types` returns 7; sorted IDs equal `[...SYSTEM_TYPES].map(t => t.id).sort()`. (2) Idempotency — two sequential `runInDurableObject` calls on `idFromName("ws-seed-idempotent")` both assert count === 7. Imports SYSTEM_TYPES from `@engram/schema` (not redefined inline).
- `packages/workspace-do/src/__tests__/hibernation.test.ts` (RED → GREEN) — One describe block, one test. First `runInDurableObject` call: `SELECT version, name, applied_at FROM _schema_migrations ORDER BY version` → `.toArray()` → assert length 1 + version 1 + name "v1_initial_schema" + applied_at is a number; `SELECT COUNT(*) AS n FROM memory_types` → `.one()` → assert `n === 7`. Second `runInDurableObject` call on the SAME stub: `_schema_migrations` count still 1, `memory_types` count still 7. Header documents Open Question O1 honesty note about what the test proves (observable invariant) vs. what it cannot deterministically force (pool internal replay).
- `packages/workspace-do/tsconfig.json` (MODIFY) — Added `compilerOptions.types: ["@cloudflare/workers-types/experimental", "@cloudflare/vitest-pool-workers/types"]` to make `import { runInDurableObject } from "cloudflare:test"` resolve at typecheck. Without this, tsc fails with `TS2307: Cannot find module 'cloudflare:test'`.

## Decisions Made

- **`extends DurableObject<unknown>` (NOT bare `extends DurableObject`).** The PATTERNS.md §2 prescribed sketch had `export class WorkspaceDO extends DurableObject { constructor(ctx, env: unknown) { super(ctx, env); ...} }` — but the base class signature is `DurableObject<Env = Cloudflare.Env, Props = {}>`, so `super(ctx, env: unknown)` fails strict TS with `TS2345`. The `<unknown>` generic threads the env-type intent through to the base. Identical to Plan 00's Deviation #3 fix for fixtures. The constructor parameter type itself (`env: unknown`) remains as prescribed.
- **Hand-written `Cloudflare.Env` augmentation, not `wrangler types` codegen.** Generating `worker-configuration.d.ts` from `wrangler.test.jsonc` requires `compatibility_date` to be set in the wrangler config, but the design intent (Plan 00 header comment in `wrangler.test.jsonc`) is to OMIT `compatibility_date` so the test pool infers the latest. Adding a date would freeze the test runtime. The hand-written augmentation in `src/__tests__/__env.d.ts` mirrors the wrangler-generated shape exactly and stays scoped to the test directory.
- **Added `@cloudflare/vitest-pool-workers/types` to workspace-do tsconfig types.** Without it, `import { runInDurableObject } from "cloudflare:test"` fails with `TS2307: Cannot find module 'cloudflare:test'`. The package's `package.json` exports `./types` precisely for this consumer pattern.
- **Used `cloudflare:workers` for `env`, `cloudflare:test` for `runInDurableObject`.** The cloudflare-test.d.ts itself marks the `env` re-export in `cloudflare:test` as `@deprecated`, with the recommended replacement being `cloudflare:workers`. This is the canonical post-deprecation public API and matches the plan's prescribed interface verbatim.
- **Scoped `@typescript-eslint/require-await` disable around the bootstrap call.** The blockConcurrencyWhile signature is `<T>(cb: () => Promise<T>): Promise<T>` — it REQUIRES an async callback. But STO-10 forbids any `await` inside the bootstrap body (the rule's whole point). Without the disable, every STO-compliant constructor body would fail lint. Same pattern as the Plan 00 good-blockconcurrency.ts fixture; same disable comment style.
- **Kept the `NotFoundError` re-export commented out in index.ts.** The `./errors.ts` module lands in Plan 02-05 (per CONTEXT.md "Claude's Discretion" + PATTERNS.md §7). Adding the re-export now would fail with `Cannot find module './errors.js'`; commenting it with a forward-pointing note keeps the package barrel typecheck-clean across the Plan 02-04 → 02-05 transition.
- **Did NOT touch `packages/mcp-server/wrangler.jsonc`.** D-06 explicitly preserved. The Phase 1 v1 entry `{ tag: "v1", new_sqlite_classes: ["WorkspaceDO"] }` is unchanged; Phase 3 adds the v2 entry adding `EngramMcp` per the deferred-work pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `WorkspaceDO extends DurableObject` fails strict TS — needs `<unknown>` generic**
- **Found during:** Task 1 (initial typecheck)
- **Issue:** The PATTERNS.md §2 sketch `export class WorkspaceDO extends DurableObject { constructor(ctx, env: unknown) { super(ctx, env); } }` fails strict TypeScript: `TS2345: Argument of type 'unknown' is not assignable to parameter of type 'Env'`. The base class signature is `DurableObject<Env = Cloudflare.Env>`, so `super(ctx, env: unknown)` fails because `unknown` is not assignable to `Cloudflare.Env`.
- **Fix:** Changed class declaration to `extends DurableObject<unknown>`. The generic threads the `unknown` env type through to the base class so `super()` typechecks.
- **Files modified:** `packages/workspace-do/src/index.ts`
- **Verification:** `npm run typecheck` exits 0.
- **Committed in:** `147b4bc` (Task 1)
- **Same fix pattern:** Plan 00 fixed this identically for the lint fixtures — see 02-00-SUMMARY.md Deviation #3. The PATTERNS.md sketch predated that learning.

**2. [Rule 3 - Blocking] `cloudflare:test` module not found at typecheck**
- **Found during:** Task 2 (typecheck after writing schema.test.ts with real `import { runInDurableObject } from "cloudflare:test"`)
- **Issue:** Workspace-do's `tsconfig.json` set `compilerOptions.types: ["@cloudflare/workers-types/experimental"]` (inherited from `tsconfig.base.json`), which doesn't include `@cloudflare/vitest-pool-workers/types`. Tsc fails: `TS2307: Cannot find module 'cloudflare:test' or its corresponding type declarations.`
- **Fix:** Extended `packages/workspace-do/tsconfig.json` with an explicit `compilerOptions.types` override that includes both `@cloudflare/workers-types/experimental` AND `@cloudflare/vitest-pool-workers/types`. The package's `package.json` exports `./types` (= `types/cloudflare-test.d.ts`) precisely for this consumer pattern.
- **Files modified:** `packages/workspace-do/tsconfig.json`
- **Verification:** `npm run typecheck` exits 0 (the TS2307 error resolved).
- **Committed in:** `ef9571c` (Task 2)

**3. [Rule 3 - Blocking] `Cloudflare.Env` lacks `WORKSPACE` binding type — needs ambient augmentation**
- **Found during:** Task 2 (typecheck after #2 above was resolved)
- **Issue:** After fixing the `cloudflare:test` resolution, the next typecheck error surfaced: `TS2339: Property 'WORKSPACE' does not exist on type 'Env'`. The `Cloudflare.Env` interface declared in `@cloudflare/workers-types/experimental` is intentionally empty — meant to be augmented by `worker-configuration.d.ts` generated via `wrangler types`. `packages/workspace-do/` has no such codegen because (a) it's library-only (Phase 1 D-10), and (b) generating one from `wrangler.test.jsonc` requires `compatibility_date` to be set, which the wrangler.test.jsonc design intent EXPLICITLY OMITS (per Plan 00's header comment — "Including a date would freeze the test runtime to a specific version that may drift from production").
- **Fix:** Created `packages/workspace-do/src/__tests__/__env.d.ts` — hand-written ambient augmentation declaring `interface __WorkspaceDoTestEnv { WORKSPACE: DurableObjectNamespace<WorkspaceDO> }` and `namespace Cloudflare { interface Env extends __WorkspaceDoTestEnv {} }`. Mirrors the wrangler-generated shape exactly. Scoped to `src/__tests__/` so production code under `src/` never sees the augmentation. Includes a narrow `eslint-disable-next-line @typescript-eslint/no-empty-object-type` annotation on the `extends` line (canonical wrangler-types augmentation idiom that the rule false-positively flags).
- **Files modified:** Created `packages/workspace-do/src/__tests__/__env.d.ts`
- **Verification:** `npm run typecheck` exits 0; all 9 GREEN tests pass.
- **Committed in:** `ef9571c` (Task 2)

### No Architectural Deviations

No Rule 4 (architectural-change) deviations. All three auto-fixes were minimal and additive — the constructor body, test bodies, and tsconfig change are all expansions of the plan's prescribed shape, not departures from it.

---

**Total deviations:** 3 auto-fixed (1 Rule 1 - Bug, 2 Rule 3 - Blocking).
**Impact on plan:** All auto-fixes were required for typecheck + lint to pass; none affect the plan's success criteria. The deviations are infrastructure-level (TypeScript types, lint rule exceptions) and don't change the prescribed semantics (constructor wiring, test assertions, env: unknown convention).

## Issues Encountered

- **No CLAUDE.md rule violations.** Did not use `git stash` (worktree prohibition honored). All commits use HEREDOC style. No `git clean`, no force-push, no protected-branch ref-rewinding.
- **Pre-existing wrangler types regeneration step.** The success criteria reminded us to run `npm run types:gen` once before typechecking on a fresh worktree. Done at session start; the regen exits 0 and writes the latest `worker-configuration.d.ts` for the mcp-server and triage-worker (workspace-do has no `types:gen` script — by design per Phase 1 D-10).

## Threat Model Discharge

All applicable threats from the plan's `<threat_model>` block are mitigated:

- **T-02-04-01 (DoS, blockConcurrencyWhile I/O):** Mitigated. Constructor body is sync-only; the forbidden-token grep returns 0 violations in non-comment lines of index.ts. The STO-10 production lint (`npm run lint:blockconcurrency`) is GREEN with 13 files scanned (12 from Plan 00 + new `__env.d.ts`). The new constructor source is part of the scan and passes.
- **T-02-04-02 (Tampering, migration re-run):** Mitigated. `hibernation.test.ts` directly asserts `_schema_migrations.count == 1` after the second runInDurableObject call. The runner's PK constraint on `version` would throw on duplicate insert (fail-loud); the runner's `applied.has(m.version)` check is what prevents reaching that point. The GREEN test would FAIL on regression.
- **T-02-04-03 (Tampering, env type widening):** Mitigated. Constructor signature is `constructor(ctx: DurableObjectState, env: unknown)` — the literal `env: unknown` string grep returns 2 matches (signature + class generic). Adding `env.AI` types here would require widening the generic AND the parameter, both of which would surface in code review and the STO-10 lint.
- **T-02-04-04 (Spoofing, test isolation leak):** Accepted. vitest-pool-workers `isolatedStorage` default is per-test; each test uses a unique `idFromName` for additional defense in depth (`ws-schema-*-test`, `ws-seed-*`, `ws-replay-test`).
- **T-02-04-SC (Tampering, npm install re-validation):** Accepted. No new packages installed in this plan.

## Threat Flags

None. The new files do not introduce security-relevant surface beyond what the threat model already documents.

## Self-Check

Verified before composing this summary:

- `[ -f packages/workspace-do/src/index.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/__tests__/__env.d.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/__tests__/schema.test.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/__tests__/seeding.test.ts ]` → **FOUND**
- `[ -f packages/workspace-do/src/__tests__/hibernation.test.ts ]` → **FOUND**
- Commit `147b4bc` present in `git log` → **FOUND**
- Commit `ef9571c` present in `git log` → **FOUND**
- Commit `fa5aa83` present in `git log` → **FOUND**
- `npm run typecheck` exits 0 → **PASS**
- `npm run lint` exits 0 → **PASS**
- `npm run lint:wrangler` exits 0 (D-06 invariant — mcp-server wrangler.jsonc unchanged) → **PASS**
- `npm run lint:blockconcurrency` exits 0 (STO-10 production scan, 13 files) → **PASS**
- `cd packages/workspace-do && npx vitest run` reports `Test Files 4 passed | 2 skipped (6) / Tests 9 passed | 10 skipped (19)` → **PASS**
- `grep -v '^\s*//\|^\s*\*' packages/workspace-do/src/index.ts | grep -cE "env\.|fetch\(|await this\.ai|await ctx\.storage\.transaction\(|await import\(|await this\.env"` returns 0 → **PASS** (no forbidden tokens in production constructor)
- `grep "class_name.*WorkspaceDO" packages/mcp-server/wrangler.jsonc` returns the v1 binding line → **PASS** (STO-01 + D-06 invariant)
- `grep "new_sqlite_classes" packages/mcp-server/wrangler.jsonc` returns the v1 entry → **PASS** (STO-01 + D-06 invariant)

## Self-Check: PASSED

## Next Plan Readiness

- **Plan 02-05 (typed query helpers) is unblocked.** The WorkspaceDO constructor wires migrations + seeding; the SQLite store is ready for read/write helpers. The 7 `it.skip` stubs in `helpers.test.ts` are still skipped — Plan 02-05 fills them per CONTEXT.md D-01/02/03. The `NotFoundError` re-export in index.ts is commented out with a forward-pointing note; Plan 02-05 creates `./errors.ts` and uncomments the re-export at the same time it lands the helpers.
- **Plan 02-06 (defense-in-depth `assertOwnsWorkspace`) is unblocked.** The constructor + helpers will exist; Plan 02-06 adds the method to the class body and fills in the 2 `it.skip` stubs in `defense-in-depth.test.ts`. The McpError import from `@modelcontextprotocol/sdk/types.js` (which is already a direct dep of @engram/workspace-do per Plan 00's package.json work) is ready to be consumed.
- **Plan 02-07 (lint script wiring) status:** the script (`scripts/lint-blockconcurrency.mjs`) already exists from Plan 00; Plan 02-07's job is CI workflow + .lintstagedrc.json wiring. This plan's constructor body is a fresh real-world exercise of the lint — it passes cleanly (verified by `npm run lint:blockconcurrency` 13/13 files OK), giving 02-07 a solid GREEN baseline to ship against.
- **Plan 02-08 (validation) forward note:** the deferred blockconcurrency-lint exit-2 canary test is still `it.skip` per Plan 00 design; Plan 02-08's CI fixture-assertion step covers it. Nothing to do here.
- **Phase 3 forward note (D-06 / D-07):** when Phase 3's `discuss-phase` runs, it MUST add the success criterion enforcing the v2 wrangler migration entry adding `EngramMcp` to `new_sqlite_classes`. The test pool's `wrangler.test.jsonc` stays scoped to WorkspaceDO-only and does NOT need a parallel v2 entry; the production `packages/mcp-server/wrangler.jsonc` is where the v2 entry lands.

---

*Phase: 02-workspacedo-sqlite*
*Plan: 04 (Wave 2 — WorkspaceDO constructor + GREEN tests)*
*Completed: 2026-05-25*
