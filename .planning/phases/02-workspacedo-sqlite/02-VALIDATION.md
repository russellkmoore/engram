---
phase: 2
slug: workspacedo-sqlite
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `02-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 + `@cloudflare/vitest-pool-workers` 0.16.9 |
| **Config file** | `packages/workspace-do/vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `npm test --workspace @engram/workspace-do -- --run` |
| **Full suite command** | `npm test` (delegates via `--workspaces --if-present`) |
| **Estimated runtime** | ~5 seconds (in-pool DO tests; SQLite is in-memory per test) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace @engram/workspace-do -- --run`
- **After every plan wave:** Run `npm test && npm run lint && npm run lint:wrangler && npm run lint:blockconcurrency`
- **Before `/gsd:verify-work`:** Full suite + all 5 lint scripts must be green
- **Max feedback latency:** 10 seconds (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-W0-01 | wave-0 | 0 | STO-08 | — | N/A | install | `npm install --save-dev --workspace @engram/workspace-do @cloudflare/vitest-pool-workers@^0.16.9 vitest@^4.1.7` | ❌ W0 | ⬜ pending |
| 2-W0-02 | wave-0 | 0 | STO-08 | — | N/A | config | `npm test --workspace @engram/workspace-do -- --run` (smoke) | ❌ W0 (`vitest.config.ts`, `wrangler.test.jsonc`) | ⬜ pending |
| 2-01-01 | 01-migration-runner | 1 | STO-02 | — | N/A | unit | `vitest run schema.test.ts` | ❌ W0 (`src/__tests__/schema.test.ts`) | ⬜ pending |
| 2-01-02 | 01-migration-runner | 1 | STO-02, STO-09 | — | N/A | unit | `vitest run hibernation.test.ts` | ❌ W0 (`src/__tests__/hibernation.test.ts`) | ⬜ pending |
| 2-02-01 | 02-schema | 1 | STO-03 | — | N/A | unit (PRAGMA per table) | `vitest run schema.test.ts` | ❌ W0 (same file as 2-01-01) | ⬜ pending |
| 2-02-02 | 02-schema | 1 | STO-04 | — | N/A | unit (PRAGMA table_info(blocks)) | `vitest run schema.test.ts` | ❌ W0 (same file) | ⬜ pending |
| 2-03-01 | 03-seeding | 1 | STO-05 | — | N/A | unit (`COUNT(*) FROM memory_types` + INSERT OR IGNORE round-trip) | `vitest run seeding.test.ts` | ❌ W0 (`src/__tests__/seeding.test.ts`) | ⬜ pending |
| 2-04-01..07 | 04-query-helpers | 2 | STO-06 | — | N/A | unit (one `it` per helper) | `vitest run helpers.test.ts` | ❌ W0 (`src/__tests__/helpers.test.ts`) | ⬜ pending |
| 2-05-01 | 05-defense-in-depth | 2 | STO-07 | MT-1 / STO-07 | `assertOwnsWorkspace` throws `McpError(-32600 InvalidRequest)` on `id.name !== args.workspace_id` (covers both `idFromString` and lying args) | unit (positive + negative) | `vitest run defense-in-depth.test.ts` | ❌ W0 (`src/__tests__/defense-in-depth.test.ts`) | ⬜ pending |
| 2-06-01 | 06-lint-blockconcurrency | 2 | STO-10 | DO-3 / STO-10 | Forbidden tokens (`env.`, `fetch(`, `await this.ai`, etc.) inside `blockConcurrencyWhile(async () => {})` blocks fail CI with exit code 1 | lint script + self-test | `npm run lint:blockconcurrency && vitest run blockconcurrency-lint.test.ts` | ❌ W0 (`scripts/lint-blockconcurrency.mjs` + `src/__tests__/blockconcurrency-lint.test.ts` + good/bad fixtures) | ⬜ pending |
| 2-07-01 | 07-ci-and-lintstaged | 3 | STO-08, STO-10 | — | CI fails when any lint script or test fails | meta — CI workflow run | covered by `.github/workflows/ci.yml` | ❌ W0 (CI patch + lint-staged patch) | ⬜ pending |
| 2-INFRA | (binding) | 0 | STO-01 | DO-1 / STO-01 | `WorkspaceDO` declared in `new_sqlite_classes` (verified by existing FND-08 lint) | typecheck + existing lint | `npm run typecheck && npm run lint:wrangler` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/workspace-do/vitest.config.ts` — `cloudflareTest({ wrangler: { configPath: "wrangler.test.jsonc" } })`
- [ ] `packages/workspace-do/wrangler.test.jsonc` — test-only wrangler config declaring `WorkspaceDO` under `durable_objects.bindings` + `migrations[0].new_sqlite_classes`
- [ ] `packages/workspace-do/src/__tests__/schema.test.ts` — stubs for STO-02 / STO-03 / STO-04
- [ ] `packages/workspace-do/src/__tests__/seeding.test.ts` — stub for STO-05
- [ ] `packages/workspace-do/src/__tests__/helpers.test.ts` — stubs for STO-06 (one `it` per helper)
- [ ] `packages/workspace-do/src/__tests__/hibernation.test.ts` — stub for STO-09
- [ ] `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` — stub for STO-07
- [ ] `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` — self-test for `scripts/lint-blockconcurrency.mjs` (STO-10's own sanity check)
- [ ] `packages/workspace-do/__fixtures__/bad-blockconcurrency.ts` — has `await env.AI.run(...)` inside the block; lint MUST catch. *(Lives OUTSIDE `src/` to keep the STO-10 production glob from self-matching — PATTERNS.md §17 drift mitigation.)*
- [ ] `packages/workspace-do/__fixtures__/good-blockconcurrency.ts` — pure sync `sql.exec` only; lint MUST pass. *(Outside `src/` for the same reason.)*
- [ ] Framework install: `npm install --save-dev --workspace @engram/workspace-do @cloudflare/vitest-pool-workers@^0.16.9 vitest@^4.1.7`
- [ ] Root `package.json` — add `"test": "npm run test --workspaces --if-present"`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | — | All phase behaviors have automated verification via vitest-pool-workers + lint scripts. | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (vitest config + 6 test files + 2 fixtures + framework install + root `test` script)
- [ ] No watch-mode flags (always `-- --run` for CI determinism)
- [ ] Feedback latency < 10s (quick run)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
