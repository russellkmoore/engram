---
phase: 05-ai-integration
plan: "03"
subsystem: mcp-server
tags:
  - wave-2
  - ai-03
  - ai-08
  - vectorize
  - embeddings
  - remember
  - forget
  - lint-gate

dependency_graph:
  requires:
    - 05-01 (stampEmbedding DO RPC, RED test stubs for AI-08 + AI-02 Prong C)
    - 05-02 (safeRun + EMBEDDING_MODEL + EMBEDDING_VERSION from ai-helper.ts; vectorizeUpsert + vectorizeDelete from vectorize-helper.ts)
  provides:
    - remember() AI-03 sync embed + stamp + upsert on every remember() call
    - forget() AI-08 Vectorize-first delete cascade (ghost-recall prevention)
    - META_GAPS.truncationOver1800Chars frozen string + buildRememberResponse extraGaps
    - AI-02 lint gate (grep gate: no direct env.VECTORIZE.* outside vectorize-helper.ts)
    - env.AI + env.VECTORIZE test stubs for all mcp-server integration/unit tests
  affects:
    - packages/mcp-server/src/tools.ts (remember + forget handler bodies)
    - packages/mcp-server/src/envelope.ts (META_GAPS + buildRememberResponse signature)
    - packages/mcp-server/src/__tests__/ (test stubs + lint gate + multi-project config)
    - packages/mcp-server/vitest.config.ts (multi-project split)

tech_stack:
  added: []
  patterns:
    - safeRun(env, EMBEDDING_MODEL) inside handler body with eslint-disable for Env type gap
    - env.AI + env.VECTORIZE patched via (env as any) in beforeAll for local workerd tests
    - Vitest multi-project split (workerd pool + lint-node pool) mirrors workspace-do pattern
    - Block+line comment stripping (two-pass) before grep in lint gate to avoid false positives

key_files:
  created:
    - packages/mcp-server/src/__tests__/lint-no-direct-vectorize.test.ts
  modified:
    - packages/mcp-server/src/tools.ts
    - packages/mcp-server/src/envelope.ts
    - packages/mcp-server/src/__tests__/envelope.test.ts
    - packages/mcp-server/src/__tests__/tools-integration.test.ts
    - packages/mcp-server/src/__tests__/tools.test.ts
    - packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts
    - packages/mcp-server/src/__tests__/__snapshots__/envelope.test.ts.snap
    - packages/mcp-server/vitest.config.ts
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md

decisions:
  - "Task 3 (forget Vectorize-first delete) committed in same commit as Task 1 (remember embed+upsert) — both are in tools.ts and separating them would require two lint-staged passes on the same file; deviation from per-task commit discipline but both changes are documented"
  - "Prong C (AI-02 Vectorize namespace isolation) marked it.skip with nightly-CI gate — the beforeAll() stub makes env.VECTORIZE.upsert a no-op, which means a skipped-test run against the stub would trivially pass (not a valid isolation proof). Real Vectorize required."
  - "vitest.config.ts split to multi-project mode (workerd + lint-node) mirrors workspace-do pattern — lint-no-direct-vectorize.test.ts needs node:fs which workerd does not implement"
  - "env.AI + env.VECTORIZE patched via (env as any) in beforeAll — this is the cleanest approach for workerd integration tests since remote Cloudflare bindings don't work in local miniflare"
  - "Added file-level eslint-disable to lint-no-direct-vectorize.test.ts for unsafe-* rules — mcp-server tsconfig targets workerd so node:fs types resolve as error-typed under strict rules in the lint-node pool"

metrics:
  duration: "~2.5 hours"
  completed: "2026-05-28"
  tasks_completed: 4
  tasks_total: 4
  files_modified: 9
  files_created: 1
---

# Phase 5 Plan 03: Wave 2a — AI-03/AI-08 embed+upsert+delete wire-up Summary

**One-liner:** Wired synchronous embedding (AI-03) into `remember()` and Vectorize-first delete (AI-08) into `forget()` with truncation warn path and grep-gate enforcement of helper-only Vectorize access.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | remember() AI-03 embed + stamp + upsert + truncation warn | ac9e16b | tools.ts, tools-integration.test.ts, tools.test.ts |
| 2 | envelope.ts META_GAPS.truncationOver1800Chars + buildRememberResponse extraGaps | a3dc64b | envelope.ts, envelope.test.ts, envelope.test.ts.snap |
| 3 | forget() AI-08 Vectorize-first delete cascade | ac9e16b | tools.ts (same commit as Task 1 — deviation, see below) |
| 4 | AI-02 Prong C it.skip + lint-gate test + vitest multi-project config | 5d577a2 | cross-workspace-pentest.test.ts, lint-no-direct-vectorize.test.ts, vitest.config.ts |

## remember() Handler Diff Summary

Inserted between `await stub.insertBlock(...)` and `const envelope = buildRememberResponse(...)`:

1. **Truncation**: `TRUNCATE_THRESHOLD = 1800`. Content > 1800 chars is sliced for embedding only; full content already in SQLite. `truncated` boolean gates the extraGaps path.
2. **Embed**: `safeRun(env, EMBEDDING_MODEL, { text: [contentForEmbed] })` — dual-path 429 detection from ai-helper.ts. Asserts `vector.length === 768` (Pitfall 3 guard).
3. **Stamp**: `stub.stampEmbedding({ workspace_id, block_id, embedding_model, embedding_version })` — writes to SQLite embedding_model/embedding_version columns.
4. **Upsert**: `vectorizeUpsert(env, props.workspace_id, [{ id, values: vector, metadata }])` — namespace stamped to workspace_id by helper (AI-02 defense).
5. **extraGaps**: `buildRememberResponse({ ..., extraGaps: truncated ? [META_GAPS.truncationOver1800Chars] : [] })`.

SENTINEL-DD-RT-PHASE-03-TOOLS-TS: intact. `args.workspace_id` discipline: preserved (0 matches in production code lines).

## forget() Handler Diff Summary

Inserted BEFORE `await stub.deleteBlock(...)`:

```typescript
// === Phase 5 AI-08: Vectorize delete FIRST (per RESEARCH §Pattern 3a) ===
await vectorizeDelete(env, props.workspace_id, [args.id]);
```

**Ordering rationale (RESEARCH §Pattern 3a):** Vectorize FIRST prevents ghost-recall failure mode (T-05-03-GHOST). Partial-failure analysis:
- Vectorize fails → SQLite stays; user retries forget(). Vector still present; recall still works. Acceptable.
- SQLite fails after Vectorize → orphan SQLite row; harmless (vector gone, recall won't find it).
- Both succeed → round-trip recall returns 0 after eventual consistency window (~5s). AI-08 test asserts this.

## META_GAPS Additions + Snapshot Update

New key added to `META_GAPS` in envelope.ts:
```typescript
truncationOver1800Chars:
  "Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable.",
```

`buildRememberResponse` extended with `extraGaps?: string[]` — backward-compatible, optional parameter. Phase 4 call sites pass no `extraGaps` and are unaffected.

Snapshot update: additive only — existing 5 keys unchanged, `truncationOver1800Chars` appended.

## Lint Gate Test Results

`lint-no-direct-vectorize.test.ts` reports **0 offenders**. Tools.ts Tasks 1 + 3 use `vectorizeUpsert` / `vectorizeDelete` (not `env.VECTORIZE.*` directly) — conformant.

Comment-stripping implementation: two-pass — block comments (`/\*[\s\S]*?\*/`) stripped first, then single-line `//` comment lines filtered. This prevents false positives from JSDoc `@param` examples (hybrid-rank.ts had `env.VECTORIZE.query(...)` in a `/** */` block comment).

## AI-02 Prong C Status

**it.skip with nightly-CI flag.** Reason: the `beforeAll()` stub in cross-workspace-pentest.test.ts patches `env.VECTORIZE.upsert` to a no-op (required for Prong A/B which call `remember()`). Running Prong C with this stub would trivially return 0 matches — not a valid isolation proof. Prong C must run against REAL Vectorize. Russell verifies locally with `remote: true` binding. TODO in nightly-CI comment.

## AI-08 Round-Trip Status

**GREEN.** The `remember → forget → sleep(5s) → recall = 0` test in tools-integration.test.ts passes. Timeout fixed: 12s override (was timing out at 5s default because the sleep takes ~5s). Note: `recall()` still uses lexical SQLite search in v0.1, so the SQLite cascade from `forget()` already makes recall return 0 — the 5s sleep is insurance for the future Vectorize-backed recall path (Plan 05-05).

## Test Binding Stubs

All integration tests and unit tests that call `remember()` or `forget()` now need `env.AI` and `env.VECTORIZE` to be patched. Added `beforeAll()` stubs to:
- `tools-integration.test.ts` — `patchEnvBindings()` sets `env.AI.run` → 768-dim deterministic vector; `env.VECTORIZE.upsert/deleteByIds/query` → no-ops.
- `tools.test.ts` — same pattern.
- `cross-workspace-pentest.test.ts` — same pattern.

`afterEach()` in tools-integration clears mock call counts between tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tasks 1 and 3 committed in the same commit**
- **Found during:** Task 3 implementation
- **Issue:** Both Task 1 (remember) and Task 3 (forget) modify `packages/mcp-server/src/tools.ts`. Separating them would require two sequential lint-staged runs on the same file in the same git session; committing Task 1 first then amending for Task 3 would violate the "no amend" rule.
- **Fix:** Both handler changes committed in `ac9e16b`. Task 2 (envelope.ts) still committed separately as required.
- **Commit:** ac9e16b

**2. [Rule 2 - Missing Critical Functionality] Added env.AI + env.VECTORIZE stubs to 3 test files**
- **Found during:** Task 1 implementation
- **Issue:** remember() now calls `safeRun(env.AI, ...)` and `vectorizeUpsert(env.VECTORIZE, ...)`. Local miniflare throws "Binding VECTORIZE needs to be run remotely" when these are not mocked. ALL tests calling remember() would fail without stubs.
- **Fix:** Added `beforeAll()` stubs patching `env.AI` and `env.VECTORIZE` in tools-integration.test.ts, tools.test.ts, cross-workspace-pentest.test.ts.
- **Files modified:** tools-integration.test.ts, tools.test.ts, cross-workspace-pentest.test.ts
- **Commits:** ac9e16b (tools-integration, tools), 5d577a2 (cross-workspace-pentest)

**3. [Rule 2 - Missing Critical Functionality] Split vitest.config.ts to multi-project mode**
- **Found during:** Task 4 implementation
- **Issue:** lint-no-direct-vectorize.test.ts uses `node:fs` (`readFileSync`, `readdirSync`, `statSync`) which workerd does not implement. Running in the default single workerd pool causes "no such file or directory" error.
- **Fix:** Split vitest.config.ts to two projects: `workerd` (all tests except lint) + `lint-node` (Node pool for the grep gate). Mirrors the workspace-do package's pattern for blockconcurrency-lint.test.ts.
- **Files modified:** vitest.config.ts
- **Commit:** 5d577a2

**4. [Rule 1 - Bug] lint-no-direct-vectorize.test.ts false positive on hybrid-rank.ts JSDoc**
- **Found during:** Task 4 initial lint gate run
- **Issue:** Original comment-stripping only filtered `//` single-line comments, not `/** */` block comments. hybrid-rank.ts has `env.VECTORIZE.query(...)` in a `@param` JSDoc description, causing a false positive offender.
- **Fix:** Added two-pass comment stripping: (1) regex replace block comments `/\*[\s\S]*?\*/` → empty, (2) filter single-line `//` comment lines. 0 offenders after fix.
- **Commit:** 5d577a2

**5. [Rule 2 - Security] Added eslint-disable to lint-no-direct-vectorize.test.ts**
- **Found during:** Task 4 commit
- **Issue:** mcp-server tsconfig targets workerd; `node:fs` types resolve as "error typed" values under strict @typescript-eslint rules, producing 37 eslint errors in the lint-node pool file.
- **Fix:** File-level `eslint-disable` for `no-unsafe-*` rules with explicit rationale comment. Scoped to this one test file only.
- **Commit:** 5d577a2

## cf-code-assist Routing

All 4 tasks stayed on Claude. Routing log rows appended to `05-CF-CODE-ASSIST-USAGE.md`:

| Task | Route | Q1/Q2/Q3 | Reason |
|------|-------|----------|--------|
| 05-03-T1 | claude | Y/N/N | Cross-file synthesis: handler + envelope.ts extraGaps + stampEmbedding RPC + sentinel preservation |
| 05-03-T2 | claude | Y/N/N | Cross-file synthesis: byte-frozen string + test + snapshot coordination |
| 05-03-T3 | claude | Y/N/N | Ordering invariant (Vectorize-first) is load-bearing Open Question resolution |
| 05-03-T4 | claude | Y/N/Y | Multi-file: lint test + vitest config + pentest test + nightly-CI gate documentation |

This plan is correctly classified as contract-integration shape (not content-generation shape) — all 4 tasks stayed on Claude as expected.

## Hand-off to Plan 05-05 (recall Vectorize)

Plan 05-05 will consume:

**From this plan:**
- `META_GAPS.recall` (existing frozen string) — unchanged
- `vectorizeQuery` from vectorize-helper.ts (Plan 05-02) — ready
- `EMBEDDING_MODEL` from ai-helper.ts (Plan 05-02) — ready
- `safeRun` from ai-helper.ts (Plan 05-02) — ready
- Prong C `it.skip` in cross-workspace-pentest.test.ts — Plan 05-05 or 05-06 converts to real test after Vectorize-backed recall ships

**WorkspaceDO RPCs available (Plans 05-01 + 05-02):**
- `getBlocksByIds({ workspace_id, ids })` — for hydrating Vectorize match results
- `stampEmbedding(...)` — already used by remember() in this plan

**Integration test pattern for Plan 05-05:**
- Same `beforeAll()` stub pattern with MOCK_VECTOR = `new Array(768).fill(0.1)` — stub `env.VECTORIZE.query` to return controlled matches
- After Plan 05-05 ships, the AI-08 test's 5s sleep becomes meaningful for the Vectorize-backed recall path (currently recall is still lexical)

## Known Stubs

- `META_GAPS.recall[0]`: "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only." — intentional, resolved by Plan 05-05.
- `recall()` still uses `lexicalSearchBlocks` (SQLite) — Plan 05-05 wires Vectorize query.
- Prong C `it.skip` — Plan 05-06 nightly-CI gate resolves.

## Threat Flags

None — all implementation surfaces were already in the plan's threat model (T-05-03-CWVL, T-05-03-DRIFT, T-05-03-GHOST, T-05-03-LAT, T-05-03-TRUNC).

## Self-Check: PASSED

| Check | Result |
| ----- | ------ |
| `05-03-SUMMARY.md` exists | FOUND |
| `lint-no-direct-vectorize.test.ts` exists | FOUND |
| `cross-workspace-pentest.test.ts` exists | FOUND |
| `envelope.ts` exists | FOUND |
| `vitest.config.ts` exists | FOUND |
| Commit `ac9e16b` (Tasks 1+3) | FOUND |
| Commit `a3dc64b` (Task 2) | FOUND |
| Commit `5d577a2` (Task 4) | FOUND |
