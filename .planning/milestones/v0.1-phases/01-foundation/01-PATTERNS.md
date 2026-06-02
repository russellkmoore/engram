# Phase 1: Foundation - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 33 new + 2 modified + 1 retired-or-shimmed = 36 file decisions
**Analogs found:** 36 / 36 (all via RESEARCH.md verbatim patterns or external authoritative sources; **zero internal analogs exist — this is the patterns-establishing phase**)

---

## Phase 1 Special Note

The repo is **pre-scaffold**. No prior `packages/*`, `shared/*`, `wrangler.jsonc`, `eslint.config.mjs`, `tsconfig.*`, `package.json`, `LICENSE`, or `.github/` exist on disk. The only pre-existing source-of-truth files are:

| Pre-existing file | Treatment in P1 |
|-------------------|-----------------|
| `CLAUDE.md` (17.4K) | **MODIFY** per FND-07 (Pattern 11 edit map — 6 line-anchored swaps + 3 additive paragraphs) |
| `CONTRIBUTING.md` (318B, 12 lines) | **DO NOT TOUCH** per D-16 |
| `scripts/setup-dev.sh` (4 lines, just `echo` statements for GSD install) | **RETIRE OR SHIM** — see file decision §scripts/setup-dev.sh below |

For every other file in this phase, the "analog" is one of:
1. A **verbatim-copy Pattern (1-11) in `01-RESEARCH.md`** — these were sourced from Cloudflare official docs, ESLint docs, Microsoft jsonc-parser docs, Apache.org canonical license text, etc.
2. An **external authoritative source** (the planner should fetch verbatim — e.g., apache.org/licenses/LICENSE-2.0.txt, the `cloudflare/agentic-inbox` reference repo).

**Implication for planner:** Do NOT search the codebase for "how do we do X here?" — there is no "here" yet. The PATTERN reference column below is the source-of-truth. Copy verbatim from `01-RESEARCH.md §Pattern N` (or the cited external source); do not paraphrase or re-invent.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` (root) | Workspace orchestration / dependency manifest | config | RESEARCH §Pattern 5 (verbatim) | exact-template |
| `tsconfig.base.json` (root) | TS compiler-options base | config | RESEARCH §Pattern 6 (verbatim) | exact-template |
| `tsconfig.json` (root) | TS project-references entry | config | RESEARCH §Pattern 6 (verbatim — references block) | exact-template |
| `eslint.config.mjs` (root) | ESLint flat config (single, root-only per D-04) | lint config | RESEARCH §Pattern 7 (verbatim) | exact-template |
| `.prettierrc.json` | Prettier config | format config | Prettier docs defaults (D-01) | external-stdlib |
| `.prettierignore` | Prettier ignore | format config | Prettier docs defaults | external-stdlib |
| `.lintstagedrc.json` | lint-staged config | pre-commit config | RESEARCH §Pattern 9 (verbatim) | exact-template |
| `.husky/pre-commit` | Husky v9 hook | pre-commit hook | RESEARCH §Pattern 9 (verbatim — body: `npx --no-install lint-staged`) | exact-template |
| `.editorconfig` | Editor whitespace conventions | repo config | EditorConfig docs standard defaults (D-disc) | external-stdlib |
| `.gitignore` | Git ignore | repo config | Standard Node + Wrangler additions (`node_modules`, `.dev.vars`, `.wrangler/`, `dist/`, `worker-configuration.d.ts` — see RESEARCH §Runtime State Inventory + §Security Domain) | external-stdlib + project-specific |
| `.nvmrc` | Node version pin | repo config | RESEARCH §Standard Stack (Node 22 LTS; A7) | external-stdlib |
| `.npmrc` | npm settings | repo config | RESEARCH §Recommended Project Structure (`save-exact=false`, `engine-strict=true`) | external-stdlib |
| `LICENSE` (root) | Apache-2.0 license + v1.0 confirmation header | docs | RESEARCH §Don't Hand-Roll (apache.org canonical text) + Assumption A3 (exact header wording) | external-authoritative |
| `README.md` (root) | Portfolio-quality project README | docs | D-13/14/15 spec (sections enumerated) + RESEARCH §Architecture Patterns (Mermaid diagram source) | spec-derived |
| `docs/architecture.svg` | Polished hero/social-share architecture diagram | docs / static asset | RESEARCH §System Architecture Diagram (Mermaid source-of-truth → render to SVG) | spec-derived |
| `CLAUDE.md` **(MODIFY)** | Architecture spec | docs | RESEARCH §Pattern 11 (verbatim edit map — 6 line-anchored swaps + 3 additive paragraphs) | exact-template |
| `.github/workflows/ci.yml` | GitHub Actions CI workflow | CI config | RESEARCH §Pattern 10 (verbatim) | exact-template |
| `scripts/lint-wrangler.mjs` | FND-08 wrangler.jsonc lint script (jsonc-parser-based) | script | RESEARCH §Pattern 8 (verbatim, ~40 LOC) | exact-template |
| `scripts/setup-dev.sh` **(MODIFY or DELETE)** | Dev bootstrap helper | script | RESEARCH §Open Questions Q1 + Assumption A4 — recommendation: retire (fold into `npm run setup`); existing 4-line shim has no logic to preserve | spec-derived |
| `scripts/smoke-install.sh` | Fresh-clone install smoke (FND-01 verification) | script | RESEARCH §Validation Architecture (Phase Requirements → Test Map, FND-01 row) | spec-derived |
| `scripts/smoke-wrangler-dev.sh` | `wrangler dev` boot smoke for each Worker (FND-03 verification) | script | RESEARCH §Validation Architecture (FND-03 row — `timeout 15 npx wrangler dev … && curl -sf … && kill`) | spec-derived |
| `tests/fixtures/good-wrangler.jsonc` | Positive fixture for FND-08 lint test | test fixture | RESEARCH §Pattern 1 (mirrors mcp-server wrangler.jsonc) | exact-template |
| `tests/fixtures/bad-wrangler.jsonc` | Negative fixture for FND-08 lint test (uses `new_classes`) | test fixture | RESEARCH §Validation Architecture Wave 0 Gaps (`new_classes: ["WorkspaceDO"]`) | spec-derived |
| `packages/mcp-server/wrangler.jsonc` | Worker config — two-DO topology (`EngramMcp` + `WorkspaceDO`) | Worker config | RESEARCH §Pattern 1 (verbatim) | exact-template |
| `packages/mcp-server/src/index.ts` | No-op Worker handler + `EngramMcp` placeholder + `WorkspaceDO` re-export | Worker entrypoint | RESEARCH §Pattern 3 (verbatim mcp-server block) | exact-template |
| `packages/mcp-server/tsconfig.json` | Per-package TS config | config | RESEARCH §Pattern 6 (verbatim mcp-server block) | exact-template |
| `packages/mcp-server/package.json` | Workspace package manifest | config | RESEARCH §Pattern 5 (verbatim per-package block — `agents`, `@engram/*` deps with `"*"`) | exact-template |
| `packages/mcp-server/worker-configuration.d.ts` | `wrangler types`-generated env types | generated config | RESEARCH §Standard Stack (`wrangler types` codegen — runs via `npm run types:gen` per Pattern 5) | tool-generated |
| `packages/triage-worker/wrangler.jsonc` | Worker config — minimal (no DO bindings; Queue lands in P6) | Worker config | RESEARCH §Pattern 2 (verbatim) | exact-template |
| `packages/triage-worker/src/index.ts` | No-op Worker handler | Worker entrypoint | RESEARCH §Pattern 3 (verbatim triage-worker block) | exact-template |
| `packages/triage-worker/tsconfig.json` | Per-package TS config | config | RESEARCH §Pattern 6 (mirror mcp-server pattern, narrow `types` if no DO) | exact-template |
| `packages/triage-worker/package.json` | Workspace package manifest | config | RESEARCH §Pattern 5 (mirror mcp-server per-package block, drop `agents` + `@engram/workspace-do` deps) | exact-template |
| `packages/triage-worker/worker-configuration.d.ts` | `wrangler types`-generated env types | generated config | RESEARCH §Standard Stack | tool-generated |
| `packages/workspace-do/src/index.ts` | Library-only stub: `export class WorkspaceDO { /* phase 2 */ }` | library | RESEARCH §Open Questions Q3 (recommendation: minimal stub) + D-10 | spec-derived |
| `packages/workspace-do/tsconfig.json` | Per-package TS config (library-only — no `worker-configuration.d.ts`) | config | RESEARCH §Pattern 6 (mirror shared/types pattern — library shape) | exact-template |
| `packages/workspace-do/package.json` | Library-only workspace package manifest (no `dev`/`deploy` scripts, no `agents` dep) | config | RESEARCH §Pattern 4 (mirror `@engram/types` shape — TS-source `exports` field) | exact-template |
| `shared/types/src/index.ts` | Exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` (FND-04) | shared module | CLAUDE.md §MemoryEvent + §EngramResponse (type definitions verbatim) | spec-derived |
| `shared/types/tsconfig.json` | Per-package TS config | config | RESEARCH §Pattern 6 (verbatim shared/types block) | exact-template |
| `shared/types/package.json` | Shared package manifest with TS-source `exports` | config | RESEARCH §Pattern 4 (verbatim) | exact-template |
| `shared/schema/src/index.ts` | Barrel re-export of `system-types` | shared module | RESEARCH §Recommended Project Structure | spec-derived |
| `shared/schema/src/system-types.ts` | 7 system memory types with field metadata (FND-05) | shared module / data | CLAUDE.md §"System types to seed" (verbatim type list + field schemas) | spec-derived |
| `shared/schema/tsconfig.json` | Per-package TS config | config | RESEARCH §Pattern 6 (mirror shared/types) | exact-template |
| `shared/schema/package.json` | Shared package manifest with TS-source `exports` | config | RESEARCH §Pattern 4 (mirror shared/types) | exact-template |

**Match quality legend:**
- `exact-template` — RESEARCH.md has a verbatim code block; copy character-for-character.
- `external-authoritative` — fetch from a single canonical external source (apache.org, etc.).
- `external-stdlib` — well-known defaults; minor project-specific tweaks documented in cell.
- `spec-derived` — assembled from spec/decision text (CLAUDE.md system types, D-13 README sections, validation script descriptions); no verbatim block exists but the shape is fully specified.
- `tool-generated` — produced by `wrangler types`; planner schedules the codegen step, not the content.

---

## Pattern Assignments

### `package.json` (root)

**Analog:** RESEARCH.md §Pattern 5 (root block) — verbatim
**Key constraints from RESEARCH:**
- `"workspaces": ["packages/*", "shared/*"]` (RESEARCH §Pattern 5)
- `"engines": { "node": ">=22", "npm": ">=10" }` (matches `.nvmrc` per A7)
- Scripts: `prepare` (husky), `lint`, `lint:wrangler`, `format`, `format:check`, `typecheck` (`tsc -b --noEmit`), `types:gen` (`npm run types:gen --workspaces --if-present` — see Pitfall 6 for `--if-present` rationale), `dev:mcp`, `dev:triage`, `setup`
- `lint-staged` block in root `package.json` per Pattern 5
- devDependencies pinned to exact versions in RESEARCH §Standard Stack (wrangler@^4.94.0, eslint@^9, typescript-eslint@^8, husky@^9, lint-staged@^17, jsonc-parser@^3, @cloudflare/workers-types@^4.20260525.1, prettier@^3, globals@^16, @eslint/js@^9, typescript@^5)
- **Anti-pattern:** do NOT call `husky install` in `prepare` — use bare `husky` (Pitfall §Husky v9; State of the Art row)

**Risk:** wrong dep version pins → install failures or peer-dep mismatch. Planner must run `npm view <pkg> version` at install time and match to RESEARCH §Standard Stack table.

---

### `tsconfig.base.json` (root)

**Analog:** RESEARCH.md §Pattern 6 (root block) — verbatim
**Key constraints:**
- `"moduleResolution": "bundler"` is **load-bearing** — `node` mode breaks the `exports` field TS-source pattern (Pitfall 4)
- `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"verbatimModuleSyntax": true`, `"isolatedModules": true`
- `"types": ["@cloudflare/workers-types/experimental"]` — `/experimental` is the entrypoint that tracks the latest compat date

---

### `tsconfig.json` (root)

**Analog:** RESEARCH.md §Pattern 6 (root references block) — verbatim
**Key constraints:**
- `"files": []` (empty) + `"references"` array pointing at all 5 packages (`shared/types`, `shared/schema`, `packages/workspace-do`, `packages/mcp-server`, `packages/triage-worker`)
- Enables `tsc -b --noEmit` as the root typecheck command
- **Note:** D-11 says no Turborepo; project references are TypeScript's native build graph (still allowed, just not a separate orchestrator tool)

---

### `eslint.config.mjs` (root)

**Analog:** RESEARCH.md §Pattern 7 — verbatim
**Key constraints:**
- Flat config (ESLint v9 era); legacy `.eslintrc.json` is forbidden per Anti-Patterns + State of the Art
- Imports: `js`, `tseslint`, `globals` (all in root devDeps per Pattern 5)
- `tseslint.configs.strictTypeChecked` + `tseslint.configs.stylisticTypeChecked` — this is the **fallback baseline** locked by D-02 (researcher confirmed no official Cloudflare ESLint preset exists in 2026 via npm 404; see RESEARCH §Summary item 1)
- Globals: `globals.browser` + `globals.serviceworker` (exposes Workers globals like `fetch`, `Request`, `Response`, `caches`)
- `parserOptions.projectService: true` + `tsconfigRootDir: import.meta.dirname`
- Custom rules: `no-floating-promises`, `no-misused-promises`, `consistent-type-imports` (all `"error"`)
- Ignores: `node_modules`, `dist`, `.wrangler`, `worker-configuration.d.ts` (generated file)
- **Anti-pattern:** per-package `eslint.config.mjs` (RESEARCH §Anti-Patterns) — single root config only

---

### `.prettierrc.json` + `.prettierignore`

**Analog:** Prettier default config + project-specific ignores
**Source:** Prettier docs (D-01 locks Prettier; no specific style choices made — use defaults). `.prettierignore` mirrors `.gitignore` essentials (`node_modules`, `dist`, `.wrangler`, `worker-configuration.d.ts`).
**Note:** Planner picks the small style choices (semis, single-vs-double quotes) at Claude's discretion (D-disc); document the choice in the file but no spec-binding constraints.

---

### `.lintstagedrc.json` + `.husky/pre-commit`

**Analog:** RESEARCH.md §Pattern 9 — verbatim
**Key constraints:**
- Pre-commit body is exactly: `npx --no-install lint-staged` (Pitfall 5: do NOT source `husky.sh`)
- lint-staged config covers 3 glob groups:
  1. `*.{ts,mts,cts,js,mjs,cjs}` → `["eslint --fix", "prettier --write"]`
  2. `*.{json,jsonc,md,yaml,yml}` → `["prettier --write"]`
  3. `**/wrangler.jsonc` → `["node scripts/lint-wrangler.mjs"]` — wires FND-08 to pre-commit
- `chmod +x .husky/pre-commit` is part of setup
- **Anti-pattern:** `husky install` in `prepare` (deprecated, silently no-ops in v9)

---

### `.editorconfig`, `.gitignore`, `.nvmrc`, `.npmrc`

**Analog:** Standard 2026 Node/Wrangler defaults; D-disc gives Claude latitude
**Project-specific requirements:**
- `.gitignore` MUST include from first commit (RESEARCH §Runtime State Inventory + §Security Domain): `node_modules/`, `.dev.vars`, `.dev.vars.*`, `.wrangler/`, `dist/`, `worker-configuration.d.ts` (generated, per-package)
- `.nvmrc` = `22` (A7; matches `engines.node: ">=22"` in root package.json)
- `.npmrc`: `save-exact=false` (allow caret ranges), `engine-strict=true` (block install on wrong Node)
- `.editorconfig`: standard 2-space indent, LF line endings, final newline true

---

### `LICENSE` (root)

**Analog:** apache.org canonical text + RESEARCH §Assumption A3 header wording
**Procedure:**
1. Fetch verbatim Apache-2.0 text from **https://www.apache.org/licenses/LICENSE-2.0.txt** (cited in RESEARCH §Sources + §Don't Hand-Roll — single canonical source, SPDX-compatible)
2. Prepend the v1.0 confirmation header per A3: *"NOTICE: Engram is licensed under Apache License 2.0. This license selection is provisional and subject to final confirmation at the v1.0 milestone."*
3. FND-06 acceptance: `head -5 LICENSE | grep -q "subject to final confirmation at v1.0" && grep -q "Apache License" LICENSE` (per RESEARCH §Validation Architecture)

**Risk:** RESEARCH §Architecture Patterns flags this as **Irreversible Decision C8** (Apache-2.0 placeholder). Header wording can be edited later; the choice to ship Apache-2.0 at v0.1 is locked.

---

### `README.md` (root)

**Analog:** D-13/14/15 section spec; Mermaid block per RESEARCH §System Architecture Diagram
**Required sections (per D-13):**
1. Elevator pitch
2. "Why Engram" paragraph
3. Architecture diagram (Mermaid fenced block — the source-of-truth per D-14)
4. Tech stack table
5. Status section
6. Install / dev quickstart
7. Link to CLAUDE.md for architectural depth

**Required badges (per D-15, three only):** Apache-2.0 license, GitHub Actions CI status, `package.json` version. **No** npm-publish/coverage/deploy badges (broken badges look worse than missing).

**Mermaid block:** copy from RESEARCH §System Architecture Diagram (the `flowchart LR` block — high-level repo/workspaces/cf-runtime overview). GitHub renders Mermaid natively, diffs in PRs (cited in RESEARCH §Don't Hand-Roll).

**Tone:** portfolio-quality at v0.1 (D-13 rationale: v0.1 hits GitHub before the v0.4 demo; README does the credibility work).

---

### `docs/architecture.svg`

**Analog:** Render Mermaid source from README §Architecture Diagram to a polished SVG
**Source:** RESEARCH §System Architecture Diagram (Mermaid `flowchart LR` block)
**D-14 procedure:** Mermaid block in README is the live source of truth; SVG in `docs/architecture.svg` is the polished hero/social-share image. Update flow: Mermaid first (per-PR), SVG regenerated when architecture shifts materially.
**Tooling:** Mermaid CLI (`@mermaid-js/mermaid-cli`) or VS Code's built-in Mermaid export. Planner picks (D-disc).

---

### `CLAUDE.md` **(MODIFY)**

**Analog:** RESEARCH.md §Pattern 11 — verbatim edit map (the only pre-existing file modified in P1)
**Six line-anchored swaps** (verified against current CLAUDE.md read; line numbers locked at 2026-05-25):

| Line | Action |
|------|--------|
| 57 | Remove `ingest-worker` entry; replace block with v0.1 package list + one-liner explaining `ingest-worker` was folded into `triage-worker` for v0.1 |
| 71 | Delete `wrangler.toml # Root Cloudflare config`; replace with comment: `# No root wrangler config — each Worker package owns its own wrangler.jsonc.` |
| 254 | Change `search(query, filters, format?)` → `search(query, filters)`; delete `// Returns: memories[], count, export_url? …` → `// Returns: memories[], count`; add note that `export(query, format, filters?)` is a separate v0.3 tool |
| 401 | `wrangler.toml` (under mcp-server) → `wrangler.jsonc` |
| 408 | `wrangler.toml` (under workspace-do) → **delete entire line** (D-10: workspace-do is library-only) |
| 415 | Delete `wrangler.toml # root config, DO bindings` entirely |

**Three additive paragraphs:**
1. New subsection "Session DO vs Workspace DO" after "Durable Object Per Workspace" — explains two-DO topology (`EngramMcp` + `WorkspaceDO` under single `migrations[0].new_sqlite_classes`)
2. Annotation that `agents/mcp` `McpAgent` is used (NOT raw `@modelcontextprotocol/sdk` HTTP transports — `node:http` won't run on `workerd`)
3. In Milestones / v0.1 section, `ingest-worker` deferred-to-v0.4 explanation

**Risk:** **HIGHEST-PRIORITY DOC INTEGRITY ITEM.** RESEARCH §Pitfall 8 + §Runtime State Inventory + §Security Domain (V14) all flag CLAUDE.md staleness as the doc-drift hazard that propagates `wrangler.toml`, `ingest-worker`, and `format?` into Phases 2–7. Plan-checker should fail any P1 plan that doesn't include explicit FND-07 tasks. Verification step: `! grep -nE "wrangler\.toml|ingest-worker[^]|format\?\)" CLAUDE.md` (per RESEARCH §Validation Architecture FND-07 row).

**Constraint:** Do NOT touch `CONTRIBUTING.md` (D-16); do NOT touch any other CLAUDE.md sections beyond those listed above.

---

### `.github/workflows/ci.yml`

**Analog:** RESEARCH.md §Pattern 10 — verbatim
**Key constraints:**
- `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc` + `cache: npm` (cited in RESEARCH §Don't Hand-Roll)
- Steps in order: `npm ci` → `npm run types:gen` → `npm run typecheck` → `npm run lint` → `npm run format:check` → `npm run lint:wrangler`
- `npm run types:gen` MUST run before `typecheck` (otherwise `worker-configuration.d.ts` doesn't exist and `tsc` fails on missing `Env` — see Pitfall 7)
- Triggers: `push` to main + `pull_request` to main (D-03: durable gate on PRs)

**Risk:** Husky pre-commit can be bypassed with `--no-verify`; CI is the durable gate. RESEARCH §Security Domain explicitly calls this out as the mitigation for the `--no-verify` threat.

---

### `scripts/lint-wrangler.mjs`

**Analog:** RESEARCH.md §Pattern 8 — verbatim (~40 LOC)
**Key constraints:**
- Uses `jsonc-parser` (Microsoft's official VS Code parser) — NOT `JSON.parse + regex` or `jq` (Pitfall: jq can't parse comments)
- Globs `packages/*/wrangler.jsonc` (note: not `**/wrangler.jsonc` — workspace-do is library-only per D-10 and has no wrangler.jsonc)
- Forbids any migration with `new_classes` (non-empty array) → exit 1
- Allows `new_sqlite_classes` (the SQLite-backed migration kind)
- Exit codes: 0 = clean, 1 = violation, 2 = no files found (canary against accidental rename)

**Risk:** **Irreversible Decision DO-1** (RESEARCH §State of the Art). `new_classes` quietly creates KV-backed DOs that **cannot** be retroactively converted to SQLite-backed (Cloudflare workers-sdk issue #9909). This lint script is the architectural integrity control that prevents the regression.

**Location decision (RESEARCH §Open Questions Q4):** `scripts/lint-wrangler.mjs` (flat file). Promote to `scripts/lint/` only if future phases add more lint scripts.

---

### `scripts/setup-dev.sh` **(EXISTING — MODIFY OR DELETE)**

**Analog:** RESEARCH §Open Questions Q1 + Assumption A4
**Existing content** (4 lines, all `echo` statements telling user to install GSD plugin):
```sh
echo "Install GSD plugin in Claude Code before proceeding:"
echo "  /plugin marketplace add jnuyens/gsd-plugin"
echo "  /plugin install gsd@gsd-plugin"
echo "  /reload-plugins"
```
**Recommendation:** Retire (delete) the standalone bash file. Its 4 lines of `echo` content already live in `CONTRIBUTING.md` (kept as-is per D-16) and the root `package.json` `setup` script (per RESEARCH §Pattern 5: `"setup": "npm install && npm run types:gen"`). Have `npm run setup` print the same GSD install reminder before running `npm install`.

**Alternative:** Keep as a thin shim that just invokes `npm run setup` (preserves discoverability for non-Claude-Code users). Planner picks; A4 flags this for explicit decision.

**Constraint:** Do NOT duplicate logic between `setup-dev.sh` and `npm run setup`. Pick one source-of-truth.

---

### `scripts/smoke-install.sh`

**Analog:** RESEARCH §Validation Architecture (FND-01 row)
**Shape:** `rm -rf node_modules && npm install && ls -d node_modules/@engram/*`
**Purpose:** Verify a fresh clone bootstraps to a working workspace tree (FND-01 acceptance). Run in CI on fresh checkout.

---

### `scripts/smoke-wrangler-dev.sh`

**Analog:** RESEARCH §Validation Architecture (FND-03 row)
**Shape:** `timeout 15 npx wrangler dev --config packages/mcp-server/wrangler.jsonc --port 8787 & sleep 8 && curl -sf http://localhost:8787 && kill %1` (parameterized per Worker package)
**Purpose:** Verify each Worker (`mcp-server`, `triage-worker`) boots under `wrangler dev` and answers a GET 200. FND-03 acceptance. Run locally in pre-commit (manual) and CI (automated).

---

### `tests/fixtures/good-wrangler.jsonc`

**Analog:** RESEARCH §Pattern 1 — verbatim mcp-server `wrangler.jsonc` (the two-DO good case)
**Purpose:** Positive fixture for FND-08 lint script tests. Running `node scripts/lint-wrangler.mjs` against this file (or with this file included in the glob) MUST exit 0.

---

### `tests/fixtures/bad-wrangler.jsonc`

**Analog:** RESEARCH §Validation Architecture Wave 0 Gaps — `new_classes: ["WorkspaceDO"]` (the regression we're preventing)
**Shape:** Copy `tests/fixtures/good-wrangler.jsonc` and change `new_sqlite_classes` → `new_classes`.
**Purpose:** Negative fixture for FND-08 lint script tests. Running `node scripts/lint-wrangler.mjs -- tests/fixtures/bad-wrangler.jsonc` MUST exit 1 with a violation message.

**Risk:** The fixture must NOT be picked up by the production lint glob (`packages/*/wrangler.jsonc`) — it lives under `tests/fixtures/` precisely so the production lint passes while the fixture-driven test exercises the failure path.

---

### `packages/mcp-server/wrangler.jsonc`

**Analog:** RESEARCH.md §Pattern 1 — verbatim
**Key constraints:**
- `compatibility_date: "2026-05-22"` (FND-02 acceptance)
- `compatibility_flags: ["nodejs_compat"]` — NOT `["nodejs_compat", "nodejs_compat_v2"]` (Pitfall 3; v2 auto-enabled by compat date ≥ 2024-09-23)
- TWO durable_objects.bindings: `MCP_OBJECT → EngramMcp` and `WORKSPACE → WorkspaceDO`
- ONE migrations entry with both classes: `new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`
- `$schema: "../../node_modules/wrangler/config-schema.json"` (IDE schema validation)
- `observability.enabled: true`
- NO `script_name` on the DO bindings (Pitfall 2: both classes ship in same Worker)
- NO `nodejs_compat_v2` in flags array

**Risk:** **Irreversible Decision DO-1.** `new_sqlite_classes` is non-reversible. The cloudflare/agentic-inbox repo (cited in RESEARCH §Sources Secondary) is the real-world reference for this two-DO pattern.

---

### `packages/mcp-server/src/index.ts`

**Analog:** RESEARCH.md §Pattern 3 (mcp-server block) — verbatim
**Key constraints:**
- Imports `McpAgent` from `agents/mcp` (NOT `@modelcontextprotocol/sdk` — Anti-Pattern; `node:http` won't run on workerd)
- Declares `export class EngramMcp extends McpAgent {}` — empty body in P1 (Phase 3 fills it; A5 confirms empty body is acceptable for `wrangler dev` binding resolution)
- Re-exports `WorkspaceDO` from `@engram/workspace-do` so Wrangler can resolve the binding class from this script
- Default export: `{ async fetch(_req) { return Response.json({ ok: true, worker: "engram-mcp-server", phase: 1 }); } }`
- FND-03 acceptance: this is the no-op that `wrangler dev` boots and `curl localhost:8787` returns 200 against

---

### `packages/mcp-server/tsconfig.json`

**Analog:** RESEARCH.md §Pattern 6 (mcp-server block) — verbatim
**Key constraints:**
- `"extends": "../../tsconfig.base.json"`
- `"types": ["@cloudflare/workers-types/experimental", "./worker-configuration.d.ts"]` — adds the wrangler-generated env types
- `"include": ["src/**/*.ts", "worker-configuration.d.ts"]`

---

### `packages/mcp-server/package.json`

**Analog:** RESEARCH.md §Pattern 5 (per-package mcp-server block) — verbatim
**Key constraints:**
- Name: `@engram/mcp-server` (D-06: uniform `@engram/*` scope)
- `"type": "module"`, `"private": true`, `"version": "0.1.0"`
- Scripts: `dev` (`wrangler dev`), `deploy` (`wrangler deploy`), `types:gen` (`wrangler types`)
- Dependencies: `agents: "^0.13.2"`, `@engram/types: "*"`, `@engram/schema: "*"`, `@engram/workspace-do: "*"` (Anti-Pattern: do NOT use semver constraints for workspace-internal deps; `"*"` resolves via symlink)

---

### `packages/mcp-server/worker-configuration.d.ts`

**Analog:** RESEARCH §Standard Stack — `wrangler types`-generated; NOT hand-written
**Generation procedure:** `cd packages/mcp-server && npx wrangler types` (driven by `npm run types:gen --workspaces --if-present` at root)
**Constraint:** This file is in `.gitignore` (RESEARCH §Runtime State Inventory: "build artifacts"); CI regenerates it before typecheck (RESEARCH §Pattern 10 CI step ordering).
**Anti-Pattern (Pitfall 7):** Do NOT hand-write `interface Env { ... }`; it drifts from `wrangler.jsonc`.

---

### `packages/triage-worker/wrangler.jsonc`

**Analog:** RESEARCH.md §Pattern 2 — verbatim
**Key constraints:**
- Minimal config: name, main, compatibility_date, compatibility_flags, observability
- NO `durable_objects` block (no DO bindings — Queues land in P6)
- NO `migrations` block (nothing to migrate; lint-wrangler.mjs allows files without migrations)
- Same `compatibility_date: "2026-05-22"` and `compatibility_flags: ["nodejs_compat"]` as mcp-server

---

### `packages/triage-worker/src/index.ts`

**Analog:** RESEARCH.md §Pattern 3 (triage-worker block) — verbatim
**Shape:** `export default { async fetch(_req) { return Response.json({ ok: true, worker: "engram-triage-worker", phase: 1 }); } };`

---

### `packages/triage-worker/tsconfig.json`

**Analog:** RESEARCH.md §Pattern 6 (mirror mcp-server block, narrow `types` — same generated `worker-configuration.d.ts` path)
**Variation:** Same shape as mcp-server tsconfig; no special exclusions.

---

### `packages/triage-worker/package.json`

**Analog:** RESEARCH.md §Pattern 5 (mirror mcp-server per-package block)
**Variations from mcp-server:**
- Name: `@engram/triage-worker`
- Dependencies: drop `agents` (no MCP), drop `@engram/workspace-do` (no DO bindings); keep `@engram/types` (needs `MemoryEvent` for future Queue consumer) and `@engram/schema`
- Same scripts: `dev`, `deploy`, `types:gen`

---

### `packages/triage-worker/worker-configuration.d.ts`

**Analog:** Same as mcp-server — generated by `wrangler types`. `.gitignore`d; CI regenerates.

---

### `packages/workspace-do/src/index.ts`

**Analog:** RESEARCH §Open Questions Q3 (recommendation: minimal stub) + D-10
**Shape:** `export class WorkspaceDO { /* phase 2 — SQLite schema + queries land here */ }`
**Constraint:** Empty stub is intentional — D-10 says workspace-do is library-only, and Phase 2 fills the body. The class MUST exist so mcp-server's `wrangler.jsonc` binding (`{ "name": "WORKSPACE", "class_name": "WorkspaceDO" }`) resolves at `wrangler dev` time (Q3 rationale: without the class, Wrangler errors "class not found").

---

### `packages/workspace-do/tsconfig.json`

**Analog:** RESEARCH.md §Pattern 6 (mirror shared/types library shape, NOT mcp-server Worker shape)
**Key constraint:** No `worker-configuration.d.ts` reference (library-only; no wrangler.jsonc → no generated env types). `"extends": "../../tsconfig.base.json"`, `"include": ["src/**/*.ts"]`.

---

### `packages/workspace-do/package.json`

**Analog:** RESEARCH.md §Pattern 4 (mirror `@engram/types` library shape)
**Key constraints:**
- Name: `@engram/workspace-do`
- `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }` — TS-source per D-07
- NO `dev`/`deploy` scripts (library-only; no Worker)
- NO `agents` dep
- `"files": ["src"]`

---

### `shared/types/src/index.ts`

**Analog:** CLAUDE.md (post-FND-07 amended) — verbatim type definitions
**FND-04 acceptance:** MUST export `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict`. Spec sources:
- `MemoryEvent` — CLAUDE.md L199-208 (verbatim)
- `EngramResponse<T>` — CLAUDE.md L292-310 (verbatim) — note: depends on `Memory`, `Entity`, `Event`, `Conflict` types being defined in the same module
- `Memory`, `Entity`, `Conflict` — CLAUDE.md doesn't define these as TS types explicitly; planner infers from `blocks` table schema (CLAUDE.md L106-119) for `Memory` and from context-envelope shape (L294-298) for `Entity`/`Conflict`. Conservative shapes:
  - `Memory`: mirror the `blocks` SQLite columns
  - `Entity`: `{ id: string; type: string; name: string; properties?: Record<string, unknown>; }` (minimal; expanded in P2/P5 when entity extraction lands)
  - `Conflict`: mirror the `conflicts` SQLite table (CLAUDE.md L168-176)
- **Test:** RESEARCH §Validation Architecture FND-04 row: consumer file in mcp-server imports all 5; `npm run typecheck` passes

---

### `shared/types/tsconfig.json`

**Analog:** RESEARCH.md §Pattern 6 (verbatim shared/types block)
**Shape:** `"extends": "../../tsconfig.base.json"`, `"include": ["src/**/*.ts"]`

---

### `shared/types/package.json`

**Analog:** RESEARCH.md §Pattern 4 — verbatim
**Key constraints:**
- Name: `@engram/types`
- `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }` — Pattern 4 critical note: `moduleResolution: "bundler"` in tsconfig.base.json is what makes this work (Pitfall 4)
- `"files": ["src"]`, `"type": "module"`, `"private": true`

---

### `shared/schema/src/index.ts`

**Analog:** Barrel re-export per RESEARCH §Recommended Project Structure
**Shape:** `export * from "./system-types";` (and any future schema exports)

---

### `shared/schema/src/system-types.ts`

**Analog:** CLAUDE.md §"System types to seed" (L182-190) + §"Field types supported" (L192) — verbatim
**FND-05 acceptance:** MUST export 7 system memory types with field definitions:
1. `job_application` — company, role, status, applied_date, salary_range, source, url, contact
2. `contact` — name, email, company, role, relationship, notes
3. `company` — name, industry, size, url, notes
4. `project` — name, status, owner, deadline, description
5. `research_note` — title, topic, source_url, summary, tags
6. `decision_log` — decision, rationale, owner, date, project
7. `meeting_note` — date, attendees, decisions, action_items, project

**Field types supported (per CLAUDE.md L192):** text, number, date, url, select, multi_select, boolean, relation, range. These must be represented as a TS union or string-literal enum.

**Shape:** Export `SYSTEM_TYPES` as a typed const array (one entry per type, each with `id`, `name`, `fields` matching the `memory_types` SQLite shape at CLAUDE.md L147-153).
**Test:** RESEARCH §Validation Architecture FND-05 row: `node -e "import('./shared/schema/src/system-types.js').then(m => console.assert(m.SYSTEM_TYPES.length === 7))"` — NOTE: this validation command uses `.js` extension but D-07 says we export `.ts` source; planner should validate via `tsc --noEmit` + a Node 22+ `--experimental-strip-types` invocation or via a vitest test added later. The runtime check shape is the intent; the exact incantation is for the planner to refine.

---

### `shared/schema/tsconfig.json` + `shared/schema/package.json`

**Analog:** Mirror `shared/types/tsconfig.json` and `shared/types/package.json` exactly, swapping the name to `@engram/schema`.

---

## Shared Patterns

These cross-cutting patterns apply to **multiple** files in Phase 1. Each lists the source pattern and the files that consume it.

### Pattern S1: Workspace package shape (TS-source via `exports`)

**Source:** RESEARCH §Pattern 4 (verbatim)
**Applies to:** `shared/types/package.json`, `shared/schema/package.json`, `packages/workspace-do/package.json` (library-only packages with no `dev`/`deploy` scripts)
**Excerpt (verbatim from Pattern 4):**
```jsonc
{
  "name": "@engram/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "files": ["src"]
}
```
**Cross-cutting constraint:** `moduleResolution: "bundler"` in `tsconfig.base.json` is load-bearing for this pattern. Without it, the `exports` field with extensionless TS imports fails (Pitfall 4).

---

### Pattern S2: Worker package shape (with `wrangler dev` + `wrangler types`)

**Source:** RESEARCH §Pattern 5 (per-package mcp-server block)
**Applies to:** `packages/mcp-server/package.json`, `packages/triage-worker/package.json`
**Excerpt (verbatim from Pattern 5):**
```jsonc
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
    "@engram/types": "*",
    "@engram/schema": "*",
    "@engram/workspace-do": "*"
  }
}
```
**Cross-cutting constraint:** Internal workspace deps use `"*"` (npm-workspaces resolves via symlink); external deps use `^` ranges pinned to RESEARCH §Standard Stack versions.

---

### Pattern S3: Per-package `tsconfig.json` extending base

**Source:** RESEARCH §Pattern 6
**Applies to:** all 5 package `tsconfig.json` files
**Shape:** `"extends": "../../tsconfig.base.json"` + per-package `"include"` + (for Workers only) `"types"` array adding the generated `worker-configuration.d.ts`

---

### Pattern S4: No-op Worker handler shape (FND-03 smoke target)

**Source:** RESEARCH §Pattern 3
**Applies to:** `packages/mcp-server/src/index.ts`, `packages/triage-worker/src/index.ts`
**Shape:** `export default { async fetch(_req: Request): Promise<Response> { return Response.json({ ok: true, worker: "<name>", phase: 1 }); } };`
**Per-package variation:** mcp-server additionally declares `export class EngramMcp extends McpAgent {}` and re-exports `WorkspaceDO` from `@engram/workspace-do`.

---

### Pattern S5: Wrangler config conventions

**Source:** RESEARCH §Pattern 1 (two-DO) + §Pattern 2 (minimal)
**Applies to:** `packages/mcp-server/wrangler.jsonc`, `packages/triage-worker/wrangler.jsonc`
**Shared invariants across both:**
- `"$schema": "../../node_modules/wrangler/config-schema.json"`
- `"compatibility_date": "2026-05-22"`
- `"compatibility_flags": ["nodejs_compat"]` — **NEVER** add `nodejs_compat_v2`
- `"observability": { "enabled": true }`
- `main: "src/index.ts"`
- Name follows `engram-{name}-worker` convention (CLAUDE.md §Naming Conventions, intact after FND-07)
**Worker-specific variation:** mcp-server adds `durable_objects.bindings` + `migrations[0].new_sqlite_classes`; triage-worker omits both.

---

### Pattern S6: Lint integration triad (ESLint + Prettier + FND-08)

**Source:** RESEARCH §Pattern 7 (ESLint) + §Pattern 8 (FND-08) + §Pattern 9 (lint-staged) + §Pattern 10 (CI)
**Applies to:** every file change in the repo (pre-commit) and every CI run
**Three lint dimensions, all wired to BOTH pre-commit AND CI per D-03:**
1. **TS/JS lint** — ESLint flat config, `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked` baseline
2. **Format** — Prettier, all file types
3. **wrangler.jsonc shape** — `scripts/lint-wrangler.mjs` (FND-08), jsonc-parser-based, prevents `new_classes` regression

---

## No Analog Found

**None.** Every file in this phase maps to either:
- A verbatim-copy RESEARCH.md pattern (Pattern 1-11)
- An external authoritative source (apache.org, RESEARCH §Standard Stack docs)
- A spec-derived shape (CLAUDE.md system types, D-13 README sections, validation script descriptions)

**Important context for planner:** The absence of internal analogs is by design. **Phase 1 IS the analog** for Phases 2–7. Every wrangler.jsonc shape, package.json pattern, tsconfig structure, and CI workflow established here will be the "closest analog" for downstream phases. Get them right.

---

## Risk Surface (P1-specific irreversible decisions)

| Risk | Source | Mitigation in PATTERNS |
|------|--------|------------------------|
| `new_classes` instead of `new_sqlite_classes` in any wrangler.jsonc → KV-backed DO that cannot be converted to SQLite-backed | RESEARCH §State of the Art (Irreversible DO-1); CLAUDE.md context | FND-08 lint script (Pattern 8) blocks pre-commit + CI; tests/fixtures/bad-wrangler.jsonc proves the rule works |
| CLAUDE.md left stale → Phase 2-7 agents re-introduce `wrangler.toml`, `ingest-worker`, `format?` | RESEARCH §Pitfall 8 + §Runtime State Inventory + §Security Domain V14 | Pattern 11 verbatim edit map; FND-07 is a hard gate; phase verification greps CLAUDE.md for stale tokens |
| Apache-2.0 license placeholder shipped without v1.0 confirmation header → ambiguous IP signal pre-launch | RESEARCH §Architecture Patterns (Irreversible C8); Assumption A3 | LICENSE header text from A3 (verbatim); FND-06 verification greps for "subject to final confirmation at v1.0" |
| `nodejs_compat_v2` accidentally added to compatibility_flags → noisy config, ages badly | RESEARCH §Pitfall 3 | Pattern 1 + Pattern 2 verbatim do NOT include v2; lint:wrangler could add a check (not in P1 scope; flag for P2) |
| `moduleResolution: "node"` in tsconfig.base.json → `exports` field TS-source imports break | RESEARCH §Pitfall 4 | Pattern 6 verbatim sets `bundler`; verified by the FND-04 typecheck (mcp-server importing from @engram/types) |
| `husky install` in `prepare` script → silently no-ops in v9 | RESEARCH §Pitfall 5 + Anti-Patterns | Pattern 5 verbatim uses bare `husky`; Pattern 9 uses `npx --no-install lint-staged` body |
| Workspace-internal dep declared with semver instead of `"*"` → dedup chaos | RESEARCH §Anti-Patterns | Pattern 5 verbatim per-package block uses `"*"` for `@engram/*` deps |
| Per-package `eslint.config.mjs` → rule drift across packages | RESEARCH §Anti-Patterns | Single root `eslint.config.mjs` (Pattern 7); no per-package overrides |

---

## Metadata

**Analog search scope:** None (pre-scaffold repo; no internal analogs to search for)
**Files scanned:** 5 (CLAUDE.md, CONTRIBUTING.md, scripts/setup-dev.sh, 01-CONTEXT.md, 01-RESEARCH.md)
**External authoritative sources cited:** 15 (per RESEARCH §Sources — Cloudflare docs, ESLint docs, typescript-eslint docs, Microsoft jsonc-parser, Apache.org, husky/lint-staged docs, GitHub actions/setup-node, cloudflare/agentic-inbox, cloudflare/workers-sdk issues)
**Pattern extraction date:** 2026-05-25
**Linked phase:** 01-foundation (Phase 1)
**Downstream consumers:** `gsd-planner` (consumes this PATTERNS.md to build per-file PLAN.md actions)
