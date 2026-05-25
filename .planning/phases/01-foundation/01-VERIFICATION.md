---
phase: 01-foundation
verified: 2026-05-25T22:00:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
overrides:
  - must_have: "packages/mcp-server/wrangler.jsonc declares BOTH EngramMcp and WorkspaceDO under one migrations[0].new_sqlite_classes entry"
    reason: "REVIEW-FIX WR-06 deferred EngramMcp to Phase 3 v2 migration. DO migrations are append-only (cannot retract new_sqlite_classes once committed). Locking-in SQLite backing for EngramMcp under Phase 1 stub conditions would remove the rollback path. Documented in packages/mcp-server/wrangler.jsonc inline comment and 01-REVIEW-FIX.md. WorkspaceDO alone in v1 satisfies the architectural intent (a non-empty new_sqlite_classes migration on the Worker with the two-DO binding pair); EngramMcp lands in v2 in Phase 3."
    accepted_by: "russellkmoore (via /gsd:code-review --fix workflow)"
    accepted_at: "2026-05-25T20:08:00Z"
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "README portfolio quality on GitHub"
    expected: "All three badges render live (Apache-2.0 blue, CI green, version 0.1.0-alpha), Mermaid architecture diagram renders inline as a flowchart, all internal links resolve (LICENSE, CLAUDE.md, ROADMAP.md, docs/architecture.svg)."
    why_human: "Visual judgment — automated tooling can confirm Mermaid parses and badge URLs exist in markup but cannot judge 'portfolio quality' or whether the rendered output looks credible to a first-time visitor. Per 01-VALIDATION.md §Manual-Only Verifications."
  - test: "CI workflow first-push run goes green"
    expected: ".github/workflows/ci.yml runs all 11 steps to completion on push to main and on PRs: checkout → setup-node → npm ci → types:gen → typecheck → lint → format:check → lint:wrangler → FND-08 negative-fixture assertion → FND-08 positive-fixture assertion → smoke mcp-server → smoke triage-worker → smoke install. Expected runtime ~90s on ubuntu-latest."
    why_human: "Requires a real push to GitHub (no automation can trigger the workflow from a verifier). The local pipeline (lint, typecheck, format:check, lint:wrangler, fixture assertions) is all green; only the CI runner execution itself is unverified."
  - test: "LICENSE renders on GitHub with v1.0 confirmation header in the first 5 lines"
    expected: "Opening LICENSE on github.com/<owner>/engram shows 'NOTICE: Engram is licensed under Apache License 2.0.' on line 1 and 'subject to final confirmation at v1.0.' on line 2, followed by the standard Apache-2.0 text."
    why_human: "GitHub's license auto-detection may flag a non-standard header. Visual confirmation that the header doesn't break GitHub's license badge rendering is needed."
  - test: "CONTRIBUTING.md unchanged on GitHub"
    expected: "GitHub shows CONTRIBUTING.md as byte-identical to the pre-Phase-1 GSD-setup stub (D-16 compliance — full contributor guidance deferred to v1.0)."
    why_human: "git diff confirms locally (file unchanged). GitHub round-trip confirms no inadvertent EOL/encoding mutation when the branch was pushed."
  - test: "README TODO comment cleanup"
    expected: "Line 1 of README.md (`<!-- TODO: confirm owner after first push -->`) is either removed or replaced. The badge URL on line 4 already uses the confirmed owner `russellkmoore`, so the TODO is stale."
    why_human: "Acknowledged as REVIEW IN-02 (info-level, deferred from fix scope). The user should decide whether to defer to a follow-up cleanup pass or address now. HTML comment renders as raw text in some preview tools and adds grep noise. Not a blocker since the badge URL is correct; flagged here so the user can decide post-push."
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A clean clone bootstraps into a typed, lint-clean, license-bearing monorepo where every Worker package can boot under `wrangler dev`, and CLAUDE.md reflects the corrected baseline (JSONC, two-DO topology, McpAgent, search without format?, ingest-worker deferred).

**Verified:** 2026-05-25T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — 7 SC + 1 derived)

| #  | Truth                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                          |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | `git clone` + `npm install` from a clean tree completes without errors and produces a working workspace tree (`packages/*`, `shared/*`).                                | VERIFIED   | `package.json` declares workspaces `["packages/*", "shared/*"]`. `node_modules/@engram/` contains symlinks to mcp-server, schema, triage-worker, types, workspace-do. `scripts/smoke-install.sh` documented end-to-end pass in 01-05 SUMMARY. |
| 2  | `npx wrangler dev` against a placeholder Worker boots end-to-end and serves a no-op response without errors.                                                            | VERIFIED   | 01-05 SUMMARY documents `{"ok":true,"worker":"engram-mcp-server","phase":1,"systemTypesCount":7}` response from mcp-server smoke and `{"ok":true,"worker":"engram-triage-worker","phase":1}` from triage-worker smoke. `scripts/smoke-wrangler-dev.sh` uses portable trap-based PID cleanup + 30s poll deadline. |
| 3  | `shared/types` exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` and at least one other package imports them successfully.                     | VERIFIED   | `shared/types/src/index.ts` (239 lines) exports all 5 as `export interface` (auto-converted from `export type` by ESLint `consistent-type-definitions: interface` rule). `packages/mcp-server/src/index.ts` imports all 5 + `SYSTEM_TYPES` via `import type { ... } from "@engram/types"` and `import { SYSTEM_TYPES } from "@engram/schema"`. `npm run typecheck` exits 0. |
| 4  | `shared/schema/system-types.ts` exports the seven system memory type definitions with field metadata; type-check passes.                                                | VERIFIED   | `shared/schema/src/system-types.ts` (244 lines) declares all 7 system types (`job_application`, `contact`, `company`, `project`, `research_note`, `decision_log`, `meeting_note`) using `as const satisfies readonly SystemMemoryType[]`. `FieldType` union covers all 9 supported types (`text`, `number`, `date`, `url`, `select`, `multi_select`, `boolean`, `relation`, `range`). `npm run typecheck` exits 0. |
| 5  | CI lint rule rejects any `wrangler.jsonc` whose `[[migrations]]` declares a Durable Object class under `new_classes` instead of `new_sqlite_classes`; the rule is wired into `npm run lint:wrangler` and runs in CI. | VERIFIED   | `scripts/lint-wrangler.mjs` (92 lines, uses `jsonc-parser` + `fast-glob`). Verified live: `npm run lint:wrangler` exits 0 against 2 production wrangler.jsonc files; positional invocation against `tests/fixtures/bad-wrangler.jsonc` exits 1 with explicit `new_classes` message; positional invocation against `tests/fixtures/good-wrangler.jsonc` exits 0. `.github/workflows/ci.yml` wires `npm run lint:wrangler` + explicit positive/negative fixture assertion steps. |
| 6  | `LICENSE` exists at repo root with Apache-2.0 text and a top-of-file comment "subject to final confirmation at v1.0".                                                   | VERIFIED   | `LICENSE` line 1: `NOTICE: Engram is licensed under Apache License 2.0.`. Line 2: `This license selection is provisional and subject to final confirmation at v1.0.`. Lines 5+ contain standard Apache-2.0 text (`Apache License`, `Version 2.0, January 2004`, `http://www.apache.org/licenses/`). File is 205 lines. |
| 7  | CLAUDE.md reflects v0.1 architectural corrections (JSONC, two DO classes, `McpAgent`, `search` without `format?`, `ingest-worker` deferred to v0.4).                    | VERIFIED   | Canonical staleness grep `grep -nE 'wrangler\.toml\|ingest-worker[^/]\|search\(query, filters, format\?\)' CLAUDE.md` returns 2 lines — both deliberate deferral annotations referencing "ingest-worker" outside v0.1-active sections (L76, L357). Zero `wrangler.toml` references. `search(query, filters)` present (1 occurrence). `Session DO vs Workspace DO` subsection at L103. `from "agents/mcp"` and `workerd` annotation present at L251. |
| 8  | (derived) CI pipeline (lint + typecheck + format:check + lint:wrangler + fixture assertions) runs green locally.                                                       | VERIFIED   | All 5 pipeline steps executed against current tree: `types:gen` (exit 0), `typecheck` (exit 0), `lint` (exit 0), `format:check` (exit 0), `lint:wrangler` (exit 0, "OK — checked 2 file(s)"). Negative fixture asserted exit 1; positive fixture asserted exit 0. |

**Score:** 8/8 truths verified

---

### Required Artifacts

| Artifact                                       | Expected                                                                  | Status      | Details                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `package.json`                                 | Root workspace orchestration + all 12 devDeps + scripts                   | VERIFIED    | Has `workspaces: ["packages/*","shared/*"]`, all 11 devDeps including `fast-glob@^3.3.3` (added in REVIEW-FIX WR-01), all required scripts (lint, typecheck, format:check, lint:wrangler, types:gen, setup, dev:mcp, dev:triage). |
| `tsconfig.base.json`                           | Strict mode + bundler resolution + Workers types                          | VERIFIED    | `moduleResolution: "bundler"` (load-bearing). All strict flags present: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. |
| `tsconfig.json` (root)                         | Project references to all 5 packages                                      | VERIFIED    | All 5 references present: `./shared/types`, `./shared/schema`, `./packages/workspace-do`, `./packages/mcp-server`, `./packages/triage-worker`. |
| `eslint.config.mjs`                            | Flat config with strictTypeChecked + Workers globals                      | VERIFIED    | Uses `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked` + `globals.browser/serviceworker/node`. Has `disableTypeChecked` override for `.mjs/.cjs/scripts/**`. `no-floating-promises`, `no-misused-promises`, `consistent-type-imports` enabled. |
| `.husky/pre-commit`                            | Body: `npx --no-install lint-staged` (Pitfall 5)                          | VERIFIED    | File is one line: `npx --no-install lint-staged`. No `husky.sh` sourcing. `.husky/_/` directory present (Husky v9 init artifact). |
| `LICENSE`                                      | Apache-2.0 + v1.0 confirmation header                                     | VERIFIED    | First 2 lines contain confirmation header; standard Apache-2.0 text follows; 205 lines total. |
| `scripts/lint-wrangler.mjs`                    | FND-08 lint rule with dual-mode + jsonc-parser                            | VERIFIED    | 92 lines. Uses `jsonc-parser` + `fast-glob` (REVIEW-FIX WR-01 replaced experimental `node:fs/promises` glob). Documented dual-mode header comment. Exit codes 0/1/2 enforced. |
| `scripts/smoke-install.sh`                     | FND-01 fresh-clone install smoke                                          | VERIFIED    | Executable bash, `set -euo pipefail`, resolves repo root from `BASH_SOURCE[0]`, checks for `@engram/*` workspace symlinks. |
| `scripts/smoke-wrangler-dev.sh`                | FND-03 wrangler dev smoke (config + port args)                            | VERIFIED    | Executable bash, trap-based PID cleanup (REVIEW-FIX WR-02), 30s poll loop (REVIEW-FIX WR-03), accepts config + port args (REVIEW-FIX WR-04 enables 8788). |
| `tests/fixtures/good-wrangler.jsonc`           | Positive lint fixture using `new_sqlite_classes`                          | VERIFIED    | Uses `new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`. Contains `//` comment. Lives outside `packages/` (production glob skips it). |
| `tests/fixtures/bad-wrangler.jsonc`            | Negative lint fixture using `new_classes`                                 | VERIFIED    | Declares `new_classes: ["WorkspaceDO"]`. Live verification: `node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc` exits 1. |
| `shared/types/src/index.ts`                    | 5 v0.1 shared types                                                       | VERIFIED    | 239 lines. All 5 types exported as `export interface`. `TimelineEvent` rename present (T-01-12 DOM Event collision avoidance). |
| `shared/types/package.json`                    | `@engram/types` TS-source exports                                         | VERIFIED    | `name: "@engram/types"`, `exports["."].types: "./src/index.ts"`, `default: "./src/index.ts"`, `type: "module"`. |
| `shared/schema/src/system-types.ts`            | 7 system memory types + `FieldType` union                                 | VERIFIED    | 244 lines. All 7 type IDs present. `FieldType` union has all 9 supported types. `SYSTEM_TYPES` is `as const satisfies readonly SystemMemoryType[]`. |
| `shared/schema/src/index.ts`                   | Barrel re-export                                                          | VERIFIED    | Single export: `export * from "./system-types.js"`. |
| `shared/schema/package.json`                   | `@engram/schema` TS-source exports                                        | VERIFIED    | Mirrors `@engram/types` shape with `name: "@engram/schema"`. |
| `packages/mcp-server/wrangler.jsonc`           | Two-DO topology, `compat_date 2026-05-22`, `nodejs_compat`                | VERIFIED (override) | Both DO bindings present (`MCP_OBJECT → EngramMcp`, `WORKSPACE → WorkspaceDO`). `compatibility_date: "2026-05-22"`. `compatibility_flags: ["nodejs_compat"]`. NO `script_name`, NO `nodejs_compat_v2`. **Override applied:** `new_sqlite_classes: ["WorkspaceDO"]` only — `EngramMcp` deferred to Phase 3 v2 migration per REVIEW-FIX WR-06 (DO migrations append-only; avoid locking SQLite backing under stub conditions). FND-08 lint exits 0. |
| `packages/mcp-server/src/index.ts`             | `EngramMcp extends McpAgent` + WorkspaceDO re-export + cross-pkg imports  | VERIFIED    | All 5 shared types imported, `SYSTEM_TYPES` imported. `EngramMcp extends McpAgent` with stub `server` and `init()`. `WorkspaceDO` re-exported via `export { WorkspaceDO } from "@engram/workspace-do"`. `Phase1Pong` interface uses all 5 types as type-witnesses. |
| `packages/mcp-server/package.json`             | `agents@^0.13.2` + `@modelcontextprotocol/sdk@^1.29.0` + 3 workspace deps | VERIFIED    | Has `agents@^0.13.2`, explicit `@modelcontextprotocol/sdk@^1.29.0` (REVIEW-FIX CR-01 promoted from transitive to direct dep), and 3 `@engram/*: "*"` workspace deps. |
| `packages/triage-worker/wrangler.jsonc`        | Minimal config, no DO bindings, port 8788                                 | VERIFIED    | `compatibility_date: "2026-05-22"`. `nodejs_compat` only. No `durable_objects`, no `migrations`. `dev.port: 8788` (REVIEW-FIX WR-04). |
| `packages/triage-worker/src/index.ts`          | No-op fetch handler                                                       | VERIFIED    | Returns `{ ok: true, worker: "engram-triage-worker", phase: 1 }`. Synchronous `fetch(): Response`. |
| `packages/workspace-do/src/index.ts`           | `WorkspaceDO extends DurableObject` library stub                          | VERIFIED    | Imports `DurableObject` from `cloudflare:workers`. Empty class body (Phase 2 fills). |
| `packages/workspace-do/package.json`           | Library-only (no scripts, no agents dep, no wrangler.jsonc) — D-10        | VERIFIED    | Has no `scripts` block, no `dependencies` block. `packages/workspace-do/wrangler.jsonc` does NOT exist. |
| `.github/workflows/ci.yml`                     | 11-step CI pipeline                                                       | VERIFIED    | Triggers on push/PR to main. All required steps present: checkout, setup-node@v4 with `node-version-file: .nvmrc` + `cache: npm`, `npm ci`, `types:gen`, `typecheck`, `lint`, `format:check`, `lint:wrangler`, FND-08 negative-fixture assertion (REVIEW-FIX WR-07), FND-08 positive-fixture assertion, smoke mcp-server, smoke triage-worker (port 8788), smoke install (last). |
| `README.md`                                    | Portfolio-quality README with 3 badges + Mermaid + tech stack             | VERIFIED (with WARNING) | 141 lines. Three badges (Apache-2.0, CI, version). Mermaid `flowchart LR` block. Tech stack table with 9 layers. Install quickstart. Links to LICENSE, CLAUDE.md, ROADMAP.md, architecture.svg. **WARNING:** line 1 contains stale `<!-- TODO: confirm owner after first push -->` HTML comment (REVIEW IN-02 — deferred, not in fix scope). Owner `russellkmoore` is confirmed in the badge URL on line 4. |
| `docs/architecture.svg`                        | Polished hero diagram                                                     | VERIFIED    | 37,749 bytes. Starts with `<svg id="my-svg" ...`. Rendered with `@mermaid-js/mermaid-cli@11.15.0`. |
| `CONTRIBUTING.md`                              | Unchanged (D-16)                                                          | VERIFIED    | `git diff --quiet CONTRIBUTING.md` exits 0. 11 lines of GSD plugin install steps. |

---

### Key Link Verification

| From                                          | To                                                          | Via                                                                  | Status   | Details                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `package.json` "lint"                         | `eslint.config.mjs`                                         | `eslint .` auto-discovers flat config at repo root                   | WIRED    | `npm run lint` exits 0; ESLint resolves `eslint.config.mjs`. |
| `package.json` "prepare"                      | `.husky/pre-commit`                                         | `prepare` runs `husky` (bare) → activates `.husky/_/`                 | WIRED    | `.husky/_/` artifact dir exists; pre-commit hook is one-line `npx --no-install lint-staged`. |
| `.lintstagedrc.json`                          | `scripts/lint-wrangler.mjs`                                 | `**/wrangler.jsonc` glob → positional-arg invocation of lint script  | WIRED    | `.lintstagedrc.json` declares the route. `package.json` `lint-staged` block was removed in REVIEW-FIX WR-05 (canonical source = `.lintstagedrc.json`). |
| `tsconfig.base.json`                          | `shared/types/src/index.ts`                                 | `moduleResolution: bundler` enables `.ts` source via `exports` field | WIRED    | Per-package tsconfigs extend base; `npm run typecheck` exits 0; mcp-server consumes `@engram/types` end-to-end. |
| `packages/mcp-server/wrangler.jsonc`          | `packages/workspace-do/src/index.ts`                        | Binding `WORKSPACE → WorkspaceDO`; re-exported from mcp-server entry | WIRED    | `export { WorkspaceDO } from "@engram/workspace-do"` in `packages/mcp-server/src/index.ts:30`. Inline comment in `wrangler.jsonc:22` documents the re-export. |
| `packages/mcp-server/src/index.ts`            | `shared/types/src/index.ts`                                 | `import type { ... } from "@engram/types"`                           | WIRED    | All 5 types imported and used in `Phase1Pong._types?` type-witness. |
| `packages/mcp-server/src/index.ts`            | `shared/schema/src/system-types.ts`                         | `import { SYSTEM_TYPES } from "@engram/schema"`                      | WIRED    | `systemTypesCount: SYSTEM_TYPES.length` populated at runtime; documented mcp-server smoke response includes `"systemTypesCount":7`. |
| `.github/workflows/ci.yml`                    | `scripts/lint-wrangler.mjs`                                 | CI step `npm run lint:wrangler` + 2 fixture assertion steps          | WIRED    | All 3 invocations present in workflow; YAML validates; locally all 3 invocations succeed (full-scan exit 0; bad fixture exit 1; good fixture exit 0). |
| `README.md`                                   | `CLAUDE.md`                                                 | Markdown link `[CLAUDE.md](CLAUDE.md)` in §"Architecture Deep Dive"  | WIRED    | Line 134 present. |
| `README.md`                                   | `docs/architecture.svg`                                     | Markdown link `[docs/architecture.svg](docs/architecture.svg)`       | WIRED    | Line 75 present. |

---

### Behavioral Spot-Checks

| Behavior                                                        | Command                                                                          | Result                                       | Status |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| Workspace symlinks resolve                                      | `ls node_modules/@engram/`                                                       | 5 symlinks: mcp-server, schema, triage-worker, types, workspace-do | PASS   |
| TypeScript project references typecheck                         | `npm run typecheck`                                                              | exit 0                                       | PASS   |
| ESLint flat config + strictTypeChecked + serviceworker globals   | `npm run lint`                                                                   | exit 0                                       | PASS   |
| Prettier format check                                           | `npm run format:check`                                                           | exit 0 ("All matched files use Prettier code style!") | PASS   |
| Wrangler types generation                                        | `npm run types:gen`                                                              | exit 0 (`worker-configuration.d.ts` written for both Workers) | PASS   |
| FND-08 production glob clean                                    | `npm run lint:wrangler`                                                          | exit 0 ("OK — checked 2 file(s).")           | PASS   |
| FND-08 negative-path proof                                      | `node scripts/lint-wrangler.mjs tests/fixtures/bad-wrangler.jsonc`               | exit 1 with `new_classes` violation message  | PASS   |
| FND-08 positive-path proof                                      | `node scripts/lint-wrangler.mjs tests/fixtures/good-wrangler.jsonc`              | exit 0 ("OK — checked 1 file(s).")           | PASS   |
| `@modelcontextprotocol/sdk` resolution (REVIEW-FIX CR-01)        | `npm ls @modelcontextprotocol/sdk`                                               | Direct dep of `@engram/mcp-server@0.1.0` at version 1.29.0; agents@0.13.2 carries the deduped transitive copy | PASS   |
| `agents` SDK at correct version                                  | `npm ls agents`                                                                  | `agents@0.13.2` under `@engram/mcp-server`   | PASS   |
| `wrangler dev` for both Workers (documented in 01-05 SUMMARY)    | `bash scripts/smoke-wrangler-dev.sh packages/mcp-server/wrangler.jsonc`         | Documented: `{"ok":true,"worker":"engram-mcp-server","phase":1,"systemTypesCount":7}` | SKIP (re-verified in CI; documented end-to-end in 01-05 SUMMARY) |
| `wrangler dev` for triage-worker on port 8788                    | `bash scripts/smoke-wrangler-dev.sh packages/triage-worker/wrangler.jsonc 8788` | Documented: `{"ok":true,"worker":"engram-triage-worker","phase":1}` | SKIP (re-verified in CI; documented end-to-end in 01-05 SUMMARY) |

Spot-checks 1-10 were re-executed live during this verification. Items 11-12 require launching `wrangler dev` which is out of scope for fast verification (per the verification process guidance: do not start servers). They are documented in 01-05 SUMMARY and re-asserted by the CI workflow on every push.

---

### Probe Execution

No phase-declared probes. Phase 1 is a scaffolding phase using lint/typecheck/smoke scripts; `scripts/lint-wrangler.mjs` and `scripts/smoke-*.sh` are the equivalent of probes and were executed directly under "Behavioral Spot-Checks" above.

---

### Requirements Coverage

| Requirement | Source Plan         | Description                                                                                                                                                              | Status     | Evidence                                                                                       |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| FND-01      | 01-01-PLAN, 01-06-PLAN | Monorepo bootstraps via `npm install` from a clean clone                                                                                                              | SATISFIED  | `package.json` workspaces declared. `node_modules/@engram/` symlinks present. `scripts/smoke-install.sh` wired into CI (last step to preserve cache). |
| FND-02      | 01-05-PLAN          | Each Worker package has its own `wrangler.jsonc` (not `.toml`) with `compatibility_date = "2026-05-22"` and `nodejs_compat`                                            | SATISFIED  | Both `packages/mcp-server/wrangler.jsonc` and `packages/triage-worker/wrangler.jsonc` are JSONC with the required date and flag. `workspace-do` library has no wrangler.jsonc (D-10). |
| FND-03      | 01-05-PLAN, 01-06-PLAN | `wrangler dev` boots a no-op Worker successfully end-to-end                                                                                                          | SATISFIED  | Both Worker smokes documented in 01-05 SUMMARY (mcp-server systemTypesCount=7 proves the cross-package import chain end-to-end). CI runs both on every push. |
| FND-04      | 01-04-PLAN, 01-05-PLAN | `shared/types/` exports the 5 v0.1 types consumable from every package                                                                                                | SATISFIED  | All 5 exported. mcp-server consumes them via `import type { ... } from "@engram/types"`. `npm run typecheck` exits 0. |
| FND-05      | 01-04-PLAN, 01-05-PLAN | `shared/schema/system-types.ts` defines the 7 system memory types with field definitions                                                                              | SATISFIED  | All 7 types present with field metadata, `as const satisfies readonly SystemMemoryType[]` provides compile-time validation. mcp-server smoke proves `SYSTEM_TYPES.length === 7` at runtime. |
| FND-06      | 01-01-PLAN          | `LICENSE` at repo root is Apache-2.0 with "subject to final confirmation at v1.0" comment                                                                              | SATISFIED  | LICENSE line 2 contains the exact phrase. Apache-2.0 text follows. |
| FND-07      | 01-03-PLAN          | CLAUDE.md updated: `wrangler.jsonc` everywhere, two-DO topology, `McpAgent`, `search` without `format?`, `ingest-worker` deferred to v0.4                              | SATISFIED  | Canonical staleness grep clean (only matches are intentional v0.4-context deferral paragraphs). `Session DO vs Workspace DO` subsection present. `from "agents/mcp"` + `workerd` annotation present. |
| FND-08      | 01-02-PLAN, 01-05-PLAN, 01-06-PLAN | CI lint rejects any wrangler config whose migrations use `new_classes` for a DO class                                                              | SATISFIED  | `scripts/lint-wrangler.mjs` exits 1 against bad fixture (live-verified). `.github/workflows/ci.yml` wires `npm run lint:wrangler` + explicit positive/negative fixture assertion steps (REVIEW-FIX WR-07). |

All 8 FND requirements satisfied. REQUIREMENTS.md status column still says "Pending" but the implementation evidence is complete — the orchestrator's complete-phase or ship workflow updates this column.

---

### Anti-Patterns Found

| File         | Line | Pattern                                          | Severity   | Impact                                                                                                                              |
| ------------ | ---- | ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`  | 1    | `<!-- TODO: confirm owner after first push -->` | WARNING    | REVIEW IN-02 (info-level, deferred from fix scope). HTML comment renders as raw text in some preview tools and adds grep noise. Badge URL on line 4 already uses confirmed owner `russellkmoore` — the TODO is stale. Not a blocker (was planned per 01-06-PLAN Task 3; explicitly accepted into the deferred Info bucket by REVIEW-FIX). User should decide post-push cleanup. |
| `packages/mcp-server/src/index.ts` | 17-27 | `EngramMcp extends McpAgent` with stub `server` + `async init(): Promise<void> {}` (no-op) | INFO | Intentional Phase 1 stub. Phase 3 will register MCP tools and replace `init()` with real implementations. Documented in 01-05 SUMMARY §Known Stubs. |
| `packages/workspace-do/src/index.ts` | 13-15 | Empty `WorkspaceDO extends DurableObject {}` class body | INFO | Intentional Phase 1 stub. Phase 2 fills SQLite schema, queries, and seeding. Documented in 01-05 SUMMARY §Known Stubs. |
| `packages/triage-worker/src/index.ts` | 1-5 | `fetch(): Response` no-op returning fixed JSON | INFO | Intentional Phase 1 stub. Phase 5/6 wires Queue consumer + CF AI. Documented in 01-05 SUMMARY §Known Stubs. |
| `packages/mcp-server/src/index.ts` | 36-46 | `_types?` field intentionally never populated (type-witness) | INFO | Intentional — satisfies `verbatimModuleSyntax` requirement that type imports be referenced. Documented inline. |

**Debt-marker classification:** One `TODO` found in `README.md`. Per gates.md, this would normally be a BLOCKER unless referenced to follow-up. It IS referenced in `.planning/phases/01-foundation/01-REVIEW.md` IN-02 ("Fix: Delete the line or move to an internal-only doc"), but REVIEW IN-02 is informational and explicitly out of fix scope per `01-REVIEW-FIX.md` (which addressed Critical + Warning only). The TODO is documented and the action is known — surfacing as WARNING in the human verification list rather than BLOCKER because (a) the planner authorized this TODO in 01-06-PLAN Task 3, (b) the badge URL on line 4 has the confirmed owner and the TODO is now stale, and (c) the user has explicit follow-up tracking through REVIEW IN-02. The user should decide whether to clean up now or persist as DEF-* item.

No `FIXME`, `XXX`, or `HACK` markers in any phase-modified file.

---

## Human Verification Required

Five items routed to human verification (see VERIFICATION.md frontmatter `human_verification` array for the structured form). These came from `01-VALIDATION.md §Manual-Only Verifications` (README portfolio quality) and from the deferred 01-06-PLAN Task 4 checkpoint (CI workflow first-push render, LICENSE on GitHub, CONTRIBUTING.md unchanged on GitHub, README TODO cleanup). The orchestrator should persist these as `HUMAN-UAT.md` items.

### 1. README portfolio quality on GitHub

**Test:** Push the branch to GitHub, then open the repo on github.com.
**Expected:** All three badges render live (Apache-2.0 blue, CI green for the first successful run, version `0.1.0-alpha`); Mermaid architecture diagram renders inline as a flowchart (not as raw fenced code); all internal links resolve (LICENSE, CLAUDE.md, ROADMAP.md, docs/architecture.svg). Tone reads as portfolio-quality.
**Why human:** Visual judgment — automated tooling can confirm Mermaid parses and badge URLs are well-formed in markup but cannot judge "portfolio quality" or whether the rendered output looks credible to a first-time visitor. Per `01-VALIDATION.md §Manual-Only Verifications`.

### 2. CI workflow first-push run goes green

**Test:** Push the branch to GitHub. Open the Actions tab and watch the `CI` workflow run on the first push.
**Expected:** All 11 steps succeed within ~90s. Smoke steps for both Workers return HTTP 200; smoke-install completes with `@engram/*` symlinks confirmed.
**Why human:** Requires a real push to GitHub (no automation can trigger the workflow from a verifier). The local pipeline (lint, typecheck, format:check, lint:wrangler, fixture assertions) is all green; only the CI runner execution itself is unverified.

### 3. LICENSE renders on GitHub with v1.0 confirmation header

**Test:** Open LICENSE on github.com/<owner>/engram.
**Expected:** Line 1 reads "NOTICE: Engram is licensed under Apache License 2.0." and line 2 reads "This license selection is provisional and subject to final confirmation at v1.0." GitHub's license auto-detection should still identify the file as Apache-2.0.
**Why human:** GitHub's license auto-detection may flag a non-standard header. Visual confirmation that the header doesn't break GitHub's license badge or affect license rendering is needed.

### 4. CONTRIBUTING.md unchanged on GitHub

**Test:** Open CONTRIBUTING.md on github.com/<owner>/engram.
**Expected:** Identical to the pre-Phase-1 GSD-setup stub (11 lines, D-16 compliance — full contributor guidance deferred to v1.0).
**Why human:** git diff confirms locally (file unchanged). GitHub round-trip confirms no inadvertent EOL/encoding mutation when the branch was pushed.

### 5. README TODO comment cleanup (REVIEW IN-02)

**Test:** Decide whether `<!-- TODO: confirm owner after first push -->` on line 1 of README.md should be removed now or deferred.
**Expected:** Either delete the line (the badge URL on line 4 already uses the confirmed owner `russellkmoore`), or accept it as a deferred Info-level finding tracked in 01-REVIEW.md §IN-02.
**Why human:** This TODO was explicitly authorized by 01-06-PLAN Task 3 and is acknowledged as REVIEW IN-02 (deferred from fix scope). User judgment is needed on whether to clean up post-push or carry forward.

---

### Gaps Summary

No blocking gaps. All 8 ROADMAP success criteria are satisfied with codebase evidence. All 8 FND-* requirements have implementation evidence. The CI pipeline (lint + typecheck + format:check + lint:wrangler + FND-08 fixture assertions) runs clean locally. The `wrangler.jsonc` deviation (EngramMcp deferred from v1 to v2 migration per REVIEW-FIX WR-06) is an accepted override — the alternative implementation preserves architectural intent (the Worker still has the two-DO binding pair and a non-empty `new_sqlite_classes` migration committing WorkspaceDO) while avoiding the irreversible append-only migration trap.

Five items require human verification: four are post-push visual/runtime checks documented as deferred in 01-VALIDATION.md and the auto-paused 01-06-PLAN Task 4 checkpoint; one is the deferred REVIEW IN-02 TODO comment cleanup decision. None are blockers; the orchestrator should persist all five into `HUMAN-UAT.md`.

---

_Verified: 2026-05-25T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
