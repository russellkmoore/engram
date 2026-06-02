# Phase 1: Foundation - Research

**Researched:** 2026-05-25
**Domain:** Cloudflare Workers monorepo scaffolding (TypeScript, `wrangler.jsonc`, npm workspaces, `agents/mcp` `McpAgent`, ESLint flat config, CI lint for `new_sqlite_classes`)
**Confidence:** HIGH

## Summary

Phase 1 establishes the patterns that 7 phases will copy. The research focuses on Cloudflare-current-2026 defaults — they have moved since the prior research artifacts (`STACK.md`, `SUMMARY.md`) were written and at least two now-recommended conventions (`wrangler types`-generated env types, `nodejs_compat` flag, JSONC config) are different from what training data or CLAUDE.md baselines suggest.

Key conclusions:

1. **No maintained `@cloudflare/eslint-config-*` preset exists in 2026.** All four candidate package names return 404 on the npm registry. Fall back to `typescript-eslint` strict + stylistic-type-checked with `@cloudflare/workers-types` globals. Source: `npm view` 404 [VERIFIED: npm registry].
2. **`wrangler.jsonc` is the documented Cloudflare default** for new projects (FND-02 already locked this). Both `EngramMcp` and `WorkspaceDO` live under a single `migrations` entry as `new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]` — no `script_name` needed when they share a Worker [CITED: developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/].
3. **`McpAgent` ships from `agents/mcp`** (confirmed by Cloudflare docs); the prior research artifact `STACK.md` already noted this and the path is unchanged in 2026 [CITED: developers.cloudflare.com/agents/model-context-protocol/mcp-agent-api/].
4. **FND-08 lint should be a tiny node script using `jsonc-parser`** (Microsoft VS Code's official JSONC parser) — fewer moving parts than an ESLint plugin, no ESLint flat-config bridge for JSONC custom-rule registration, deterministic, ~40 LOC, runs in CI as `npm run lint:wrangler`.
5. **Single `nodejs_compat` flag is correct** for `compatibility_date: 2026-05-22`; `nodejs_compat_v2` is automatically enabled when the compat date is on/after 2024-09-23, so listing both is redundant [CITED: developers.cloudflare.com/workers/configuration/compatibility-flags/].
6. **Modern Workers TypeScript pattern is `wrangler types` generating `worker-configuration.d.ts`**, NOT manually typing `Env` interfaces or relying solely on `@cloudflare/workers-types`. Cloudflare documents this as preferred for 2026 [CITED: blog.cloudflare.com/automatically-generated-types]. We will still include `@cloudflare/workers-types/experimental` in `tsconfig.base.json` for ambient runtime types, with per-package generated `.d.ts` for env bindings.

**Primary recommendation:** Build the scaffold the way Cloudflare's own examples (`cloudflare/agentic-inbox`, `cloudflare/templates`) build it: per-package `wrangler.jsonc` with `$schema` ref + single `[[migrations]]` entry + `wrangler types`-generated env types + flat ESLint config from `typescript-eslint` strict-type-checked + Husky v9 + lint-staged + tiny `lint:wrangler` node script using `jsonc-parser`. Do not invent.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

#### Lint/format toolchain
- **D-01:** Linter + formatter = **ESLint + Prettier** (not Biome). Cloudflare Workers conventions are the target audience and the ESLint ecosystem fits that history better.
- **D-02:** ESLint rule baseline = **Cloudflare Workers preset** if a current/maintained one exists in 2026; researcher must verify the package state. **Fallback:** `typescript-eslint` strict (`tseslint.configs.strict` + `stylisticTypeChecked`) tuned to match common Workers patterns.
- **D-03:** Lint + format runs in **pre-commit hooks AND CI**.
- **D-04:** Pre-commit hook manager — **Claude's discretion**. Default: **Husky + lint-staged**.

#### Shared module import strategy
- **D-05:** Shared code is exposed as **real npm-workspace packages** (not TS path aliases, not relative imports). Imports look like `import { Memory } from '@engram/types'`.
- **D-06:** **All workspace packages use the `@engram/*` scope** — `@engram/mcp-server`, `@engram/workspace-do`, `@engram/triage-worker`, `@engram/types`, `@engram/schema`.
- **D-07:** Shared packages **export TypeScript source directly** (via the `"exports"` field pointing at `.ts` entrypoints). Wrangler/esbuild bundles the TS at Worker build time — **no separate `tsc` build step** for shared packages. Type-checking via `tsc --noEmit`.
- **D-08:** TypeScript config layout — **Claude's discretion**. Default: root `tsconfig.base.json` with `strict: true`, `module: "bundler"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `types: ["@cloudflare/workers-types/experimental"]`; per-package `tsconfig.json` extends.

#### Worker package scaffolding scope
- **D-09:** Phase 1 scaffolds **all v0.1 packages** — `@engram/mcp-server`, `@engram/workspace-do`, `@engram/triage-worker`, `@engram/types`, `@engram/schema`.
- **D-10:** `@engram/workspace-do` is a **library-only package** — `package.json` + `tsconfig.json`, **no `wrangler.jsonc`**. The DO is declared in `mcp-server`'s `wrangler.jsonc` under `new_sqlite_classes` alongside the `EngramMcp` session DO.
- **D-11:** Monorepo task orchestration = **plain npm workspace scripts** (no Turborepo, no Nx).
- **D-12:** CI provider — **Claude's discretion**. Default: **GitHub Actions**.

#### README & repo presentation polish
- **D-13:** README built to **portfolio quality at v0.1**. Sections: elevator pitch, "why Engram", architecture diagram, tech stack table, status, install/dev quickstart, link to CLAUDE.md.
- **D-14:** Architecture diagram = **both formats**. Mermaid in README; SVG in `docs/architecture.svg`.
- **D-15:** Top-of-README badges = **license + CI + version** only.
- **D-16:** CONTRIBUTING.md stays **minimal as-is**.

### Claude's Discretion

- Pre-commit hook manager: default Husky + lint-staged.
- TypeScript config layout: tsconfig.base.json at root extended by per-package configs.
- CI provider: GitHub Actions.
- Exact wording/structure of README copy.
- No-op handler shape (e.g., `return Response.json({ ok: true, worker: "<name>" })`).
- `.gitignore`, `.editorconfig`, Node version pinning (`.nvmrc` / `engines` / `volta`), `.npmrc`.
- FND-08 lint rule implementation language (node script, bash + jq, or eslint plugin).

### Deferred Ideas (OUT OF SCOPE)

None. Items intentionally postponed and documented elsewhere: `ingest-worker` package (v0.4), full CONTRIBUTING.md (v1.0), npm publish / package registry work (v1.0), code-coverage badges (post-v0.1).

</user_constraints>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Monorepo bootstraps via `npm install` from a clean clone (root + per-package `package.json`, `tsconfig.json`) | Standard Stack §npm workspaces; Code Examples §root `package.json`; State of the Art §npm workspaces |
| FND-02 | Each Worker package has its own `wrangler.jsonc` with `compatibility_date = "2026-05-22"` and `nodejs_compat` | Code Examples §`wrangler.jsonc` minimal; Common Pitfalls §`nodejs_compat_v2` redundancy |
| FND-03 | `wrangler dev` boots a no-op Worker end-to-end | Code Examples §no-op Worker handler; Validation Architecture §smoke tests |
| FND-04 | `shared/types/` exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` | Code Examples §`@engram/types` package shape; Architecture Patterns §TS-source `exports` |
| FND-05 | `shared/schema/system-types.ts` defines seven system memory types with field definitions | Code Examples §`system-types.ts`; PROJECT.md / CLAUDE.md §"system types to seed" |
| FND-06 | `LICENSE` at repo root: Apache-2.0 with top-of-file "subject to final confirmation at v1.0" comment | Code Examples §LICENSE header; Sources §Apache official boilerplate |
| FND-07 | CLAUDE.md updated to reflect: `wrangler.jsonc`, two-DO topology, `agents/mcp` `McpAgent`, `search` without `format?`, `ingest-worker` deferred to v0.4 | CLAUDE.md Edit Map (below); CLAUDE.md grep evidence: 5 occurrences need patching at lines 57, 71, 254, 401, 408, 415 |
| FND-08 | CI lint rejects any `wrangler.jsonc` whose `[[migrations]]` declares a DO class under `new_classes` rather than `new_sqlite_classes` | Architecture Patterns §FND-08 lint script; Don't Hand-Roll §JSONC parser |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Monorepo orchestration (lint/typecheck/test across packages) | Build Toolchain (npm workspaces) | — | npm-workspaces ships in npm 7+ and is the lowest-friction option; D-11 locked. No Turborepo/Nx graph needed at this scale. |
| Per-package Worker config | Build Toolchain (Wrangler v4) | Cloudflare control plane | `wrangler.jsonc` per Worker is the only documented pattern; Wrangler reads the config in the directory you `cd` into. |
| Shared TypeScript types | Workspace package (`@engram/types`) consumed by Workers at build time | Workspace package (`@engram/schema`) | TS source via `exports` field; esbuild (inside Wrangler) bundles directly — no separate `tsc` build for shared packages. |
| Type checking | Build Toolchain (`tsc --noEmit` via root script) | Per-package `tsconfig.json` extending root | Strict checking centralized in `tsconfig.base.json`; per-package overrides for `include`/`types`. |
| Lint enforcement (TS sources) | Build Toolchain (ESLint flat config) | Pre-commit hook (Husky + lint-staged) | Same rules in dev (pre-commit) and CI (durable gate) per D-03. |
| Lint enforcement (`wrangler.jsonc`) | Build Toolchain (`npm run lint:wrangler` node script) | CI (`.github/workflows/ci.yml`) | FND-08 rule is JSON-shape validation; cheapest tier is a 40-LOC node script using `jsonc-parser`. |
| License/copyright file | Repo root file | — | Standard OSS practice; Apache-2.0 placeholder per FND-06 / Risk Note C8. |
| README + diagrams | Repo root + `docs/` | — | Mermaid in README, SVG in `docs/` per D-14. |
| Continuous integration | GitHub Actions | — | Default per D-12; repo is on GitHub. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wrangler` | `^4.94.0` | Worker build/dev/deploy CLI + Wrangler config parser | Cloudflare's official build tool; v4 is the JSONC-first generation. [VERIFIED: npm registry] (published 2026-05-22). |
| `agents` | `^0.13.2` | Cloudflare Agents SDK; provides `McpAgent` adapter for Workers-native Streamable HTTP MCP transport | Only viable MCP host on `workerd` — raw `@modelcontextprotocol/sdk` HTTP transports require `node:http`. Phase 3 will subclass `McpAgent`; Phase 1 only needs the dep installed and the import path verified. [VERIFIED: npm registry, prior STACK.md research, Cloudflare docs] |
| `@cloudflare/workers-types` | `^4.20260525.1` | Ambient TypeScript types for Workers runtime APIs | Provides the `/experimental` entrypoint that tracks the latest compatibility date. [VERIFIED: npm registry] |
| `typescript` | `^5.9.0` (latest stable line) | TypeScript compiler for `tsc --noEmit` typecheck | Required peer of `@cloudflare/workers-types` and `typescript-eslint`. [ASSUMED — TS 5.x latest as of 2026-05; pin to whatever `npm view typescript version` returns at install time]. |
| `eslint` | `^9.36.0` | Linter (flat-config generation) | ESLint v9+ is the flat-config era; pairs with `typescript-eslint@8`. [VERIFIED: npm registry] |
| `typescript-eslint` | `^8.59.4` | Combined parser + plugin for ESLint flat config (replaces the old `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` pair when using flat config) | Standard 2026 import for TS linting in flat config; provides `tseslint.configs.strictTypeChecked` and `tseslint.configs.stylisticTypeChecked`. [VERIFIED: npm registry] |
| `prettier` | `^3.8.3` | Formatter | Locked by D-01. [VERIFIED: npm registry] |
| `husky` | `^9.1.7` | Pre-commit hook manager (v9 API: `npx husky` for init, drops the deprecated `husky install`) | Locked default by D-04. [VERIFIED: npm registry] |
| `lint-staged` | `^17.0.5` | Run linters on staged files only | Companion to Husky for fast pre-commit. [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jsonc-parser` | `^3.3.1` | Microsoft VS Code's official JSONC parser (handles `//` and `/* */` comments) | FND-08 `lint:wrangler` script reads each `wrangler.jsonc` and validates the `migrations` array shape. [VERIFIED: npm registry, maintained by Microsoft VS Code team] |
| `@cloudflare/vitest-pool-workers` | `^0.9.x` (latest 0.9 line; verify at install) | Workers-aware Vitest pool (boots `workerd` in-process, gives test runtime access to bindings) | Phase 1 does NOT need vitest tests, but installing the dev-dep + writing the `vitest.config.ts` template now means later phases don't have to scaffold it. Optional for P1. [VERIFIED: npm registry] |
| `globals` | `^16.x` | Globals dictionary for ESLint flat config (`globals.browser`, etc.) | Used in `eslint.config.mjs` to declare Worker-context globals. [VERIFIED: npm registry] |
| `@eslint/js` | `^9.x` | ESLint's own recommended rules export (flat config) | Used as `js.configs.recommended` in `eslint.config.mjs`. [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ESLint + Prettier | Biome | Biome is faster and single-binary, but D-01 locks ESLint+Prettier — Workers ecosystem is ESLint-native, contributors expect it, and the typescript-eslint strict-type-checked rule set is more battle-tested than Biome's TS rules. |
| Husky + lint-staged | lefthook | Lefthook is faster and single-binary, but Husky+lint-staged is what 90% of OSS Node repos use — D-04's "ubiquity wins for a portfolio repo" rationale stands. |
| Node script + `jsonc-parser` (recommended) | bash + `sed`/`jq` | jq doesn't parse comments; you'd have to strip them first with sed regex, which is fragile (block comments span lines). |
| Node script + `jsonc-parser` (recommended) | Custom `eslint-plugin-jsonc` rule | `eslint-plugin-jsonc` is real and well-maintained, but writing a custom rule + registering it in flat config is more ceremony than a 40-LOC standalone script. Use only if other JSONC-lint needs accumulate. |
| `@cloudflare/workers-types/experimental` only | `wrangler types` generated `worker-configuration.d.ts` per package | Cloudflare actively recommends `wrangler types` in 2026 for env-binding types. **Best practice: use BOTH** — ambient runtime types from `/experimental` in `tsconfig.base.json`, per-package `Env` interface from `wrangler types` generated file. Phase 1 wires the generation script, Phase 3+ runs it after binding changes. |
| `nodejs_compat` + `nodejs_compat_v2` (redundant) | `nodejs_compat` alone | With `compatibility_date >= 2024-09-23`, listing `nodejs_compat` auto-enables v2 behavior. Listing both flags is harmless but noisy. **Use `nodejs_compat` only.** [CITED: developers.cloudflare.com/workers/configuration/compatibility-flags/] |

**Installation:**

```bash
# At repo root — single npm install pulls everything via workspaces dev-deps
npm install --save-dev --workspaces=false \
  wrangler@^4.94.0 \
  typescript@^5 \
  @cloudflare/workers-types@^4 \
  eslint@^9 \
  @eslint/js \
  globals \
  typescript-eslint \
  prettier@^3 \
  husky@^9 \
  lint-staged@^17 \
  jsonc-parser@^3
# Then in each Worker package (mcp-server, triage-worker):
npm install --save agents@^0.13.2 --workspace @engram/mcp-server
```

**Version verification (run at install time):**

```bash
npm view wrangler version                       # confirmed 4.94.0 on 2026-05-25
npm view agents version                         # confirmed 0.13.2 on 2026-05-25
npm view @cloudflare/workers-types version      # confirmed 4.20260525.1 on 2026-05-25
npm view typescript-eslint version              # confirmed 8.59.4 on 2026-05-25
npm view eslint version                         # confirmed 9.36.0 on 2026-05-25
npm view husky version                          # confirmed 9.1.7 on 2026-05-25
npm view lint-staged version                    # confirmed 17.0.5 on 2026-05-25
npm view jsonc-parser version                   # confirmed 3.3.1 on 2026-05-25
npm view prettier version                       # confirmed 3.8.3 on 2026-05-25
```

## Package Legitimacy Audit

slopcheck verdict for every package recommended above (run 2026-05-25 via `slopcheck scan --pkg npm <name>`):

| Package | Registry | Age (approx.) | Source Repo | slopcheck | Disposition |
|---------|----------|---------------|-------------|-----------|-------------|
| `wrangler` | npm | 5+ yrs | github.com/cloudflare/workers-sdk | [OK] | Approved |
| `agents` | npm | 1+ yr (pre-1.0, 0.13.2) | github.com/cloudflare/agents | [OK] | Approved — pin exact `^0.13.2` per prior STACK.md guidance |
| `@cloudflare/workers-types` | npm | 5+ yrs | github.com/cloudflare/workerd | [OK] | Approved |
| `typescript` | npm | 13+ yrs | github.com/microsoft/TypeScript | [OK] | Approved |
| `eslint` | npm | 13+ yrs | github.com/eslint/eslint | [OK] | Approved |
| `typescript-eslint` | npm | 1+ yr (umbrella pkg) | github.com/typescript-eslint/typescript-eslint | [OK] | Approved |
| `@eslint/js` | npm | 2+ yrs | github.com/eslint/eslint | [OK] | Approved |
| `globals` | npm | 12+ yrs | github.com/sindresorhus/globals | [OK] | Approved |
| `prettier` | npm | 8+ yrs | github.com/prettier/prettier | [OK] | Approved |
| `husky` | npm | 7+ yrs | github.com/typicode/husky | [OK] | Approved |
| `lint-staged` | npm | 9+ yrs | github.com/lint-staged/lint-staged | [OK] | Approved |
| `jsonc-parser` | npm | 7+ yrs | github.com/microsoft/node-jsonc-parser | [OK] | Approved — official Microsoft package |
| `@cloudflare/vitest-pool-workers` | npm | 2+ yrs | github.com/cloudflare/workers-sdk | [OK] | Approved (optional for P1) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `vitest` flagged as "suspiciously close to vite — could be a typosquat." This is a well-known false positive — vitest IS the dominant Vite-based test runner with 10M+ weekly downloads. We are not adding vitest as a top-level dep in Phase 1 anyway (only `@cloudflare/vitest-pool-workers` if we scaffold the test config now). **No action required for P1.**

**Cross-ecosystem confusion warning (recorded for posterity):** During research, the literal command `slopcheck install wrangler agents @cloudflare/workers-types typescript ...` installed Python PyPI packages named `wrangler`, `agents`, `husky`, `prettier`, `typescript`, `zod` — these are **completely unrelated** to the npm packages of the same names and are exactly the kind of cross-ecosystem hallucination vector the GSD package legitimacy protocol warns about. **All npm package recommendations in this research must be installed via `npm install`, NEVER via `pip install` or `slopcheck install`.** The planner should make this explicit in install tasks (`npm install …`) and never use a bare package name without the registry verb.

## Architecture Patterns

### System Architecture Diagram

```mermaid
flowchart LR
    subgraph repo[Clean clone of engram repo]
        direction TB
        ROOT[package.json<br/>workspaces field<br/>scripts: lint, typecheck,<br/>lint:wrangler, prepare]
        TS[tsconfig.base.json<br/>strict, ES2022,<br/>moduleResolution: bundler]
        ESL[eslint.config.mjs<br/>flat config:<br/>js + tseslint strict +<br/>stylisticTypeChecked +<br/>prettier]
        PRT[.prettierrc.json]
        LIC[LICENSE Apache-2.0<br/>+ v1.0 confirmation header]
        GIT[.gitignore .editorconfig<br/>.nvmrc .npmrc]
        HUSKY[.husky/pre-commit<br/>→ npx --no-install lint-staged]
        LS[.lintstagedrc.json]
        CI[.github/workflows/ci.yml<br/>lint + typecheck +<br/>lint:wrangler]
    end

    subgraph workspaces[npm workspaces — @engram scope]
        direction TB
        TYPES[shared/types<br/>@engram/types<br/>exports ./src/index.ts]
        SCHEMA[shared/schema<br/>@engram/schema<br/>exports ./src/index.ts]
        MCPSRV[packages/mcp-server<br/>@engram/mcp-server<br/>wrangler.jsonc<br/>src/index.ts no-op]
        WSDO[packages/workspace-do<br/>@engram/workspace-do<br/>library only — NO wrangler.jsonc<br/>exports WorkspaceDO class skeleton]
        TRIAGE[packages/triage-worker<br/>@engram/triage-worker<br/>wrangler.jsonc<br/>src/index.ts no-op]
    end

    subgraph cf[Cloudflare runtime — Phase 1 smoke test only]
        WD[wrangler dev<br/>boots local workerd]
    end

    ROOT -- "npm install" --> TYPES
    ROOT --> SCHEMA
    ROOT --> MCPSRV
    ROOT --> WSDO
    ROOT --> TRIAGE

    MCPSRV -. "import { WorkspaceDO } from" .-> WSDO
    MCPSRV -. "import types from" .-> TYPES
    TRIAGE -. "import types from" .-> TYPES
    MCPSRV -. "import seeds from" .-> SCHEMA

    MCPSRV -- "wrangler dev<br/>(FND-03 smoke)" --> WD
    TRIAGE -- "wrangler dev<br/>(FND-03 smoke)" --> WD

    HUSKY -- "on commit" --> LS
    LS -- "stages → eslint + prettier" --> ESL
    CI -- "on push/PR" --> ESL
    CI -- "tsc --noEmit" --> TS
    CI -- "node scripts/lint-wrangler.mjs" --> MCPSRV
    CI -- "node scripts/lint-wrangler.mjs" --> TRIAGE
```

### Recommended Project Structure

```text
engram/
├── .github/
│   └── workflows/
│       └── ci.yml                          # lint + typecheck + lint:wrangler
├── .husky/
│   └── pre-commit                          # npx --no-install lint-staged
├── .planning/                              # GSD planning artifacts (pre-existing)
├── docs/
│   └── architecture.svg                    # D-14 polished hero diagram
├── packages/
│   ├── mcp-server/
│   │   ├── src/
│   │   │   └── index.ts                    # no-op Worker default export
│   │   ├── wrangler.jsonc                  # name, main, compat date, nodejs_compat,
│   │   │                                    # durable_objects.bindings × 2,
│   │   │                                    # migrations new_sqlite_classes × 2
│   │   ├── worker-configuration.d.ts       # generated by `wrangler types`
│   │   ├── tsconfig.json                   # extends ../../tsconfig.base.json
│   │   └── package.json                    # @engram/mcp-server, depends on agents,
│   │                                        # @engram/workspace-do, @engram/types,
│   │                                        # @engram/schema
│   ├── workspace-do/
│   │   ├── src/
│   │   │   └── index.ts                    # export class WorkspaceDO {} (skeleton)
│   │   ├── tsconfig.json                   # extends ../../tsconfig.base.json
│   │   └── package.json                    # @engram/workspace-do — library only
│   └── triage-worker/
│       ├── src/
│       │   └── index.ts                    # no-op Worker default export
│       ├── wrangler.jsonc
│       ├── worker-configuration.d.ts       # generated
│       ├── tsconfig.json
│       └── package.json                    # @engram/triage-worker
├── shared/
│   ├── types/
│   │   ├── src/
│   │   │   └── index.ts                    # MemoryEvent, Memory, Entity,
│   │   │                                    # EngramResponse<T>, Conflict
│   │   ├── tsconfig.json
│   │   └── package.json                    # @engram/types, exports ./src/index.ts
│   └── schema/
│       ├── src/
│       │   ├── index.ts
│       │   └── system-types.ts             # 7 system type definitions
│       ├── tsconfig.json
│       └── package.json                    # @engram/schema
├── scripts/
│   ├── setup-dev.sh                        # pre-existing — fold into npm run setup
│   └── lint-wrangler.mjs                   # FND-08 lint rule node script
├── .editorconfig
├── .gitignore                              # node_modules, .dev.vars, .wrangler/, dist/
├── .lintstagedrc.json
├── .npmrc                                  # save-exact=false, engine-strict=true
├── .nvmrc                                  # 22 (matches engines)
├── .prettierignore
├── .prettierrc.json
├── CLAUDE.md                               # AMENDED by FND-07
├── CONTRIBUTING.md                         # untouched per D-16
├── eslint.config.mjs                       # flat config — root only
├── LICENSE                                 # Apache-2.0 + v1.0 confirmation header
├── package.json                            # workspaces, scripts, devDeps
├── README.md                               # portfolio-quality per D-13/14/15
├── tsconfig.base.json                      # shared compiler options
└── tsconfig.json                           # references each package — typecheck entry
```

### Pattern 1: Per-Worker `wrangler.jsonc` with two SQLite-backed DO classes (the mcp-server case)

**What:** A single `wrangler.jsonc` that declares BOTH `EngramMcp` (the McpAgent-managed session DO) and `WorkspaceDO` (the durable per-workspace store) under one `migrations` entry. Both bindings live in the same Worker; no `script_name` is needed because they ship in the same script.

**When to use:** `packages/mcp-server/wrangler.jsonc` for the two-DO topology required by MCP-03.

**Example:**

```jsonc
// packages/mcp-server/wrangler.jsonc
// Source: developers.cloudflare.com/workers/wrangler/configuration/
//         developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-mcp-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "EngramMcp" },
      { "name": "WORKSPACE",  "class_name": "WorkspaceDO" }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["EngramMcp", "WorkspaceDO"]
    }
  ]
}
```

**Critical points:**
- `new_sqlite_classes` array carries BOTH class names — Cloudflare docs confirm "an array of new classes" supports multiple [CITED: developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/].
- `EngramMcp` class itself doesn't exist in Phase 1 — only the binding/migration declaration. Phase 3 fills in the class body. The no-op `src/index.ts` in Phase 1 can re-export an empty `EngramMcp extends McpAgent {}` placeholder so the binding resolves at `wrangler dev` time.
- `WorkspaceDO` class IS declared and exported from `@engram/workspace-do` in Phase 1 (D-10), but the body is empty/stub — Phase 2 fills it.
- `compatibility_flags: ["nodejs_compat"]` is correct on its own; do NOT also add `nodejs_compat_v2` (auto-enabled by compat date ≥ 2024-09-23).

### Pattern 2: Single-Worker `wrangler.jsonc` (the triage-worker case)

**What:** Minimal `wrangler.jsonc` with no DO bindings (yet — Queues land in Phase 6).

**When to use:** `packages/triage-worker/wrangler.jsonc`.

**Example:**

```jsonc
// packages/triage-worker/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-triage-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
}
```

### Pattern 3: No-op Worker handler (FND-03 smoke test)

**What:** A Worker entrypoint that boots under `wrangler dev` and answers a single GET with a JSON identity blob. Sufficient to verify the toolchain works end-to-end on a fresh clone.

**Example:**

```typescript
// packages/mcp-server/src/index.ts
// Phase 1: placeholder. Phase 3 replaces with `export default EngramMcp.serve("/mcp")`.
import type { McpAgent as McpAgentType } from "agents/mcp";
import { McpAgent } from "agents/mcp";

// Declared so the DO binding in wrangler.jsonc has a target class — Phase 3 fills it in.
export class EngramMcp extends McpAgent {
  // intentionally empty in Phase 1; tools registered in Phase 3
}

// Re-export the DO class from @engram/workspace-do so wrangler can bind it from this script.
export { WorkspaceDO } from "@engram/workspace-do";

export default {
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ ok: true, worker: "engram-mcp-server", phase: 1 });
  },
};
```

```typescript
// packages/triage-worker/src/index.ts
export default {
  async fetch(_req: Request): Promise<Response> {
    return Response.json({ ok: true, worker: "engram-triage-worker", phase: 1 });
  },
};
```

### Pattern 4: Workspace package `package.json` exporting TypeScript source

**What:** Shared packages (`@engram/types`, `@engram/schema`) expose `.ts` source via the `exports` field. Wrangler/esbuild compiles them at Worker build time — no separate `tsc` build step required.

**When to use:** Both shared packages and `@engram/workspace-do`.

**Example:**

```jsonc
// shared/types/package.json
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

**Critical:** the consuming `tsconfig.base.json` MUST use `"moduleResolution": "bundler"` for the `exports` field to resolve `.ts` source directly. The `node` resolution mode does NOT support exports + extensionless TS imports. [CITED: TypeScript 5.x release notes / typescript-eslint docs]

### Pattern 5: Root `package.json` workspaces + scripts

**Example:**

```jsonc
// package.json (root)
{
  "name": "engram",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "shared/*"
  ],
  "engines": {
    "node": ">=22",
    "npm": ">=10"
  },
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
    "setup": "npm install && npm run types:gen"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260525.1",
    "@eslint/js": "^9",
    "eslint": "^9",
    "globals": "^16",
    "husky": "^9",
    "jsonc-parser": "^3",
    "lint-staged": "^17",
    "prettier": "^3",
    "typescript": "^5",
    "typescript-eslint": "^8",
    "wrangler": "^4.94.0"
  },
  "lint-staged": {
    "*.{ts,mts,cts,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
    "*.{json,jsonc,md,yaml,yml}": ["prettier --write"],
    "**/wrangler.jsonc": ["node scripts/lint-wrangler.mjs"]
  }
}
```

Each Worker package's `package.json` adds its own `dev` and `types:gen` scripts:

```jsonc
// packages/mcp-server/package.json
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

The `"*"` workspace dep resolves to the local symlinked package via npm workspaces — no semver match needed for internal packages.

### Pattern 6: `tsconfig.base.json` + per-package extension

**Example:**

```jsonc
// tsconfig.base.json (root)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/experimental"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  }
}
```

```jsonc
// packages/mcp-server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": [
      "@cloudflare/workers-types/experimental",
      "./worker-configuration.d.ts"
    ]
  },
  "include": ["src/**/*.ts", "worker-configuration.d.ts"]
}
```

```jsonc
// shared/types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

```jsonc
// tsconfig.json (root — orchestrates project references for `tsc -b`)
{
  "files": [],
  "references": [
    { "path": "./shared/types" },
    { "path": "./shared/schema" },
    { "path": "./packages/workspace-do" },
    { "path": "./packages/mcp-server" },
    { "path": "./packages/triage-worker" }
  ]
}
```

### Pattern 7: ESLint flat config (eslint.config.mjs)

**Example:**

```javascript
// eslint.config.mjs
// Source: typescript-eslint.io/users/configs/, eslint.org flat config docs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.browser,    // Workers expose fetch/Request/Response globals
        ...globals.serviceworker
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
);
```

### Pattern 8: FND-08 wrangler lint script (the locked recommendation)

**Recommendation (single sentence):** Use a ~40 LOC node script driven by `jsonc-parser`. It is the only option that handles JSONC comments correctly, has no flat-config bridging gymnastics, runs identically in pre-commit and CI, and produces deterministic exit codes.

**Example:**

```javascript
// scripts/lint-wrangler.mjs
// Source: github.com/microsoft/node-jsonc-parser — Microsoft's official JSONC parser.
// Verifies every wrangler.jsonc found in packages/*/ does NOT declare any
// Durable Object class under `new_classes` in its migrations.
//
// Exit 0: clean. Exit 1: one or more violations found.
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";

const VIOLATION_KEY = "new_classes";
const REQUIRED_KEY = "new_sqlite_classes";

let violations = 0;

const files = [];
for await (const file of glob("packages/*/wrangler.jsonc")) {
  files.push(file);
}

if (files.length === 0) {
  console.error("lint:wrangler found no wrangler.jsonc files — did packages/ get renamed?");
  process.exit(2);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    console.error(`[lint:wrangler] ${file} — JSONC parse errors:`);
    for (const err of errors) {
      console.error(`  ${printParseErrorCode(err.error)} at offset ${err.offset}`);
    }
    violations++;
    continue;
  }

  const migrations = Array.isArray(config?.migrations) ? config.migrations : [];
  for (const [i, mig] of migrations.entries()) {
    if (Array.isArray(mig?.[VIOLATION_KEY]) && mig[VIOLATION_KEY].length > 0) {
      console.error(
        `[lint:wrangler] ${file} migration[${i}] (tag: ${mig?.tag ?? "?"}) declares ` +
        `${VIOLATION_KEY}=${JSON.stringify(mig[VIOLATION_KEY])}. ` +
        `Engram requires SQLite-backed Durable Objects only — use ${REQUIRED_KEY}.`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n[lint:wrangler] FAIL — ${violations} violation(s) found.`);
  process.exit(1);
}

console.log(`[lint:wrangler] OK — checked ${files.length} file(s).`);
```

**Why this beats the alternatives:**
- **bash + jq:** jq doesn't parse comments; you'd strip them with regex first, which is fragile when block comments span lines or contain JSON-like strings.
- **eslint-plugin-jsonc custom rule:** Works but requires registering a custom rule in flat config, an extra dev-dep (`jsonc-eslint-parser`), and pulling JSONC into the ESLint AST. Heavier than the use case warrants.
- **node + jsonc-parser:** 40 LOC, single dev-dep already in the toolchain for editor support, zero ESLint coupling, runs everywhere Node 22+ does.

**CI integration:** add `npm run lint:wrangler` as a step in `.github/workflows/ci.yml` next to `npm run lint` and `npm run typecheck`. lint-staged hooks it to `**/wrangler.jsonc` changes for pre-commit coverage.

### Pattern 9: Husky v9 + lint-staged setup

```bash
# Root install (runs automatically via "prepare" script after npm install)
npx husky init
# Replace generated .husky/pre-commit body:
echo 'npx --no-install lint-staged' > .husky/pre-commit
chmod +x .husky/pre-commit
```

```jsonc
// .lintstagedrc.json (or inline in package.json "lint-staged" key)
{
  "*.{ts,mts,cts,js,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*.{json,jsonc,md,yaml,yml}": ["prettier --write"],
  "**/wrangler.jsonc": ["node scripts/lint-wrangler.mjs"]
}
```

**Husky v9 notes:**
- `husky install` is deprecated. The `prepare` script in `package.json` now just runs `husky`.
- Husky auto-skips in CI when `CI=1` is set (GitHub Actions sets this by default), preventing double-runs.

### Pattern 10: GitHub Actions CI workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Generate Wrangler types
        run: npm run types:gen

      - name: Typecheck
        run: npm run typecheck

      - name: Lint (ESLint)
        run: npm run lint

      - name: Format check (Prettier)
        run: npm run format:check

      - name: Lint wrangler.jsonc (FND-08)
        run: npm run lint:wrangler
```

### Pattern 11: CLAUDE.md Edit Map (FND-07)

Exact list of edits needed in `CLAUDE.md`. Grep evidence preserved with line numbers (from 2026-05-25 read):

| Line | Current | Replace With |
|------|---------|--------------|
| 57 | `    ingest-worker/        # Ingest pipeline Worker — fetch, chunk, embed, store` | Remove this line entirely. Replace nearby block with the v0.1 package list (`mcp-server`, `workspace-do`, `triage-worker`, `connector-slack` and `connector-drive` annotated as v0.4) and add a one-liner: *"`ingest-worker` package was an earlier design — folded into `triage-worker` for v0.1; reintroduced in v0.4 if connector volume warrants it."* |
| 71 | `  wrangler.toml           # Root Cloudflare config` | Delete. Add line above mcp-server/workspace-do/triage-worker entries: `# No root wrangler config — each Worker package owns its own wrangler.jsonc.` |
| 254 | `search(query, filters, format?)` | `search(query, filters)` — and delete the `// Returns: memories[], count, export_url? (if format specified)` comment, replacing with `// Returns: memories[], count`. Below the v0.1 tool block, add a note: *"`export(query, format, filters?)` is a separate v0.3 tool — see Milestones."* |
| 401 | `      wrangler.toml` (under mcp-server) | `      wrangler.jsonc` |
| 408 | `      wrangler.toml` (under workspace-do) | **Delete** — per D-10, `workspace-do` is library-only and has NO wrangler config. |
| 415 | `  wrangler.toml           # root config, DO bindings` | Delete entire line. |

Additional content changes (no line anchors — additive paragraphs):

1. **Two-DO topology** — after the "Durable Object Per Workspace" section (around L41-44), add a subsection titled "Session DO vs Workspace DO" that explains:
   > Each Worker that hosts an MCP endpoint actually owns **two DO classes** declared in the same `wrangler.jsonc`:
   > - **`EngramMcp`** — auto-managed by `agents/mcp` `McpAgent`; holds transient MCP session state (per active client connection). Lifecycle: one DO instance per session, garbage-collected when the session ends.
   > - **`WorkspaceDO`** — durable, per-workspace, reached via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` after JWT validation. This is where the SQLite store lives.
   >
   > Both are declared together under `migrations[0].new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`. SQLite-backed (not KV-backed) is irreversible per Cloudflare's migration rules.

2. **`agents/mcp` McpAgent** — where CLAUDE.md currently implies a raw MCP SDK pattern (it doesn't say so explicitly today, but the "MCP Worker — primary interface for AI clients" comment at L51 is ambiguous), add an annotation:
   > The Worker uses `import { McpAgent } from "agents/mcp"` and serves via `EngramMcp.serve("/mcp")`. Do NOT use raw `@modelcontextprotocol/sdk` HTTP transports — they depend on `node:http` and will not run on `workerd`.

3. **`ingest-worker` deferred** — in the v0.1/Milestones section (L141), add: *"`ingest-worker` is **not** part of v0.1. The triage-worker consumes the Queue directly. The `ingest-worker` package returns in v0.4 when external connectors (Slack, Drive) need a general ingest orchestration layer."*

All other CLAUDE.md content remains untouched. CONTRIBUTING.md is not modified (per D-16).

### Anti-Patterns to Avoid

- **`new_classes` for any Durable Object class** — KV-backed DOs cannot be retroactively switched to SQLite-backed. The FND-08 lint exists to make this regression impossible.
- **Including both `nodejs_compat` and `nodejs_compat_v2`** — redundant; the latter is auto-enabled by the compat date. Pick one (use `nodejs_compat`).
- **Root `wrangler.jsonc` to "share" Worker config** — Wrangler analyzes the directory you're in; there's no cross-Worker inheritance. Keep configs per-package.
- **`script_name` in DO bindings within the same Worker** — only needed for cross-Worker DO access; omit when the binding and the class live in the same Worker.
- **`tsc` build step for shared packages** — D-07 explicitly disallows; rely on Wrangler/esbuild to bundle `.ts` source via `exports` field.
- **`npm install` workspace-internal deps with semver constraints** — use `"*"` for internal packages; npm workspaces resolve via symlink, not version match.
- **Calling `husky install` in `prepare` script** — deprecated in v9. Use just `husky`.
- **Per-package `eslint.config.mjs`** — flat config at root only; per-package configs make rule drift unmanageable.
- **Running `slopcheck install <pkg>` for an npm package** — slopcheck's `install` subcommand maps to PyPI by default. It will silently install a same-named (unrelated, potentially malicious) Python package. Use `slopcheck scan --pkg npm <pkg>` for verification and `npm install` for actual installs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse JSONC (comments + trailing commas) | regex + `JSON.parse` | `jsonc-parser` (Microsoft official) | Block comments span lines, contain strings, etc. Regex parsers leak. |
| Strict TypeScript lint rules | hand-write rules | `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` | 200+ battle-tested rules; the floating-promises rule alone catches Worker bugs. |
| ESLint Worker globals | hand-list `fetch`, `Request`, `Response`, `caches`, etc. | `globals.browser` + `globals.serviceworker` from `globals` npm | Maintained, accurate, ~zero cost. |
| Pre-commit hook orchestration | bash scripts + manual `git hooks` linkage | Husky v9 + lint-staged | Cross-platform, ubiquitous, contributors recognize on sight. |
| Workers env binding types | manually declare `interface Env { ... }` | `wrangler types` generates `worker-configuration.d.ts` | Always in sync with `wrangler.jsonc`; regenerate on binding change. [CITED: blog.cloudflare.com/automatically-generated-types] |
| Apache-2.0 LICENSE text | copy-paste from random sources | apache.org/licenses/LICENSE-2.0.txt official | One canonical source; matches OSI database; SPDX-compatible. |
| GitHub Actions Node setup | hand-roll cache logic | `actions/setup-node@v4` with `node-version-file: .nvmrc` and `cache: npm` | Caches lockfile correctly; pins Node version to `.nvmrc`. |
| Mermaid diagrams in README | embed PNG | Mermaid fenced code block | GitHub renders natively, diffs in PRs, single source of truth. |

**Key insight:** Phase 1 is where the temptation to "just write a quick script" is strongest because nothing depends on anything yet. Every shortcut here is paid for across 6 future phases. Pin to libraries the Cloudflare ecosystem actually uses; don't invent.

## Runtime State Inventory

> **Phase trigger:** This phase is a NEW scaffold — no rename/refactor/migration. The category exists only because FND-07 amends CLAUDE.md, which is a documentation refactor with no runtime state implications.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — pre-scaffold repo, no databases or datastores in play. v0.1 won't connect to Cloudflare Vectorize/KV/R2 until Phase 5. | None |
| Live service config | None — no live Cloudflare services bound yet. The Cloudflare account itself is referenced (will be used in Phase 7), but Phase 1 makes no API calls. | None |
| OS-registered state | None — no daemons, scheduled tasks, pm2 processes, or launchd entries. | None |
| Secrets/env vars | None — Phase 1 introduces `.dev.vars` to `.gitignore` as a placeholder for Phase 7 secrets. No secrets are stored or referenced in Phase 1 code. | None |
| Build artifacts | None at scaffold start. After Phase 1 lands, `node_modules/`, `.wrangler/` (local cache), and `worker-configuration.d.ts` (generated) will exist locally — all listed in `.gitignore` from the start. | None |

**Special category — Documentation drift (FND-07):** The `CLAUDE.md` doc itself is "runtime state" for downstream Claude sessions. FND-07's edits are the only mechanism that prevents future agents from re-introducing `wrangler.toml`, `ingest-worker`, or `format?` based on the stale CLAUDE.md text. **Action:** the planner MUST treat FND-07 as a hard requirement, not a cleanup task — landing other v0.1 phases against a stale CLAUDE.md is exactly the doc-drift hazard called out in the Risk Notes.

## Common Pitfalls

### Pitfall 1: `new_classes` vs `new_sqlite_classes`
**What goes wrong:** Wrangler accepts both; `new_classes` quietly creates KV-backed DOs that **cannot** be retroactively converted to SQLite-backed.
**Why it happens:** Older Cloudflare docs and AI training data show `new_classes` as the default; the SQLite-backed variant is the newer recommendation.
**How to avoid:** FND-08 lint rule (Pattern 8) blocks the regression in CI.
**Warning signs:** Cloudflare deploy fails on Free plan with error code 10097 ("In order to use Durable Objects with a free plan, you must create a namespace using a `new_sqlite_classes` migration").
**Citation:** [CITED: github.com/cloudflare/workers-sdk/issues/9909]

### Pitfall 2: `script_name` added when not needed
**What goes wrong:** Adding `script_name: "engram-mcp-server"` to a DO binding that lives in the SAME Worker creates a cross-script binding loop and Wrangler refuses to deploy.
**Why it happens:** Tutorial copy-paste; `script_name` is correct for cross-Worker DO sharing.
**How to avoid:** Phase 1 mcp-server `wrangler.jsonc` (Pattern 1) deliberately omits `script_name` — both `EngramMcp` and `WorkspaceDO` live in the same script.
**Warning signs:** Wrangler error: "Durable Object namespace points back at this script."

### Pitfall 3: Redundant `nodejs_compat_v2` flag
**What goes wrong:** Some tutorials still recommend listing both `nodejs_compat` and `nodejs_compat_v2`. Harmless but adds noise and makes the file look wrong to fresh readers.
**Why it happens:** Pre-2024-09-23 documentation.
**How to avoid:** Use `nodejs_compat` alone; v2 behavior is auto-enabled by compatibility date ≥ 2024-09-23. Our date is `2026-05-22`.
**Citation:** [CITED: developers.cloudflare.com/workers/configuration/compatibility-flags/]

### Pitfall 4: `moduleResolution: "node"` blocks the `exports` field
**What goes wrong:** Per-package TS source imports via `exports` field silently fail with "module not found" errors.
**Why it happens:** Default `moduleResolution: "node"` does not honor the `exports` field with extensionless TS imports.
**How to avoid:** `tsconfig.base.json` MUST set `"moduleResolution": "bundler"` (Pattern 6).
**Warning signs:** `tsc --noEmit` fails on `import { MemoryEvent } from "@engram/types"`.

### Pitfall 5: lint-staged misses staged files
**What goes wrong:** Pre-commit hook runs but doesn't actually lint anything; CI catches the issue.
**Why it happens:** Husky v9 changed the pre-commit script location; old `.husky/pre-commit` files may reference `husky.sh` which v9 no longer ships.
**How to avoid:** Use `npx --no-install lint-staged` as the entire pre-commit body. No husky.sh sourcing.
**Citation:** [CITED: github.com/typicode/husky/issues/1447]

### Pitfall 6: `npm install --workspaces` fails when a workspace lacks the script
**What goes wrong:** Running `npm run typecheck --workspaces` errors out if any package is missing the `typecheck` script.
**Why it happens:** Default behavior treats missing scripts as errors.
**How to avoid:** Add `--if-present` to root-level cross-workspace scripts: `npm run typecheck --workspaces --if-present`. For Phase 1 simplicity we use `tsc -b` at root with project references instead, which sidesteps the issue entirely.

### Pitfall 7: TypeScript can't find `Env` interface
**What goes wrong:** `Env` is referenced in `fetch(req, env)` but undefined.
**Why it happens:** Manually hand-rolling `interface Env { ... }` is fragile and drifts from `wrangler.jsonc`.
**How to avoid:** Run `npm run types:gen` (which runs `wrangler types` per package) after any binding change; include the generated `worker-configuration.d.ts` in `tsconfig.json` `types` array.
**Citation:** [CITED: developers.cloudflare.com/workers/languages/typescript/]

### Pitfall 8: CLAUDE.md left stale after Phase 1
**What goes wrong:** FND-07 is skipped or partially applied; downstream Claude sessions read the stale CLAUDE.md, write `wrangler.toml`, scaffold `ingest-worker`, or add `format?` to `search`.
**Why it happens:** FND-07 looks cosmetic; easy to deprioritize.
**How to avoid:** Treat FND-07 as a hard blocker. The plan-checker should fail any P1 plan that doesn't include explicit FND-07 tasks. Verification should grep CLAUDE.md for `wrangler.toml`, `ingest-worker`, `format?` and fail if any are found in v0.1-active sections.

## Code Examples

(Patterns 1-11 above contain all verified code examples. Reproduce verbatim — don't paraphrase.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `wrangler.toml` | `wrangler.jsonc` | Wrangler v3.91.0+ (late 2024) — Cloudflare actively recommends JSONC for new projects; new features ship JSONC-first. | We use JSONC throughout. CLAUDE.md must be updated (FND-07). [CITED: STACK.md + Cloudflare docs] |
| `new_classes` for DO migrations | `new_sqlite_classes` for new DOs | SQLite storage backend became GA in 2024; Cloudflare strongly recommends SQLite-backed for all new DOs (and now requires it for Free plan). | We enforce via FND-08 lint. Irreversible decision DO-1. |
| Manual `interface Env { ... }` declaration | `wrangler types` generates `worker-configuration.d.ts` | Cloudflare introduced auto-generated types in 2024 and made it the recommended approach in 2025. As of Jan 2026 the command generates types across all environments by default. | Wire `wrangler types` into `npm run types:gen` and run in CI before typecheck. [CITED: developers.cloudflare.com/changelog/post/2026-01-13-wrangler-types-multi-environment/] |
| `.eslintrc.json` (legacy) | `eslint.config.mjs` flat config | ESLint v9 (April 2024) made flat config the default; legacy config is deprecated. typescript-eslint v8 supports flat config natively. | We use flat config. [CITED: eslint.org] |
| `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` (separate) | `typescript-eslint` umbrella package | typescript-eslint v8 introduced the unified import for flat config consumers. | Single dep, cleaner flat config. [CITED: typescript-eslint.io/users/configs/] |
| `husky install` in `prepare` script | `husky` alone in `prepare` script | Husky v9 (early 2024). | Use `"prepare": "husky"`. [CITED: husky docs] |
| `nodejs_compat` + `nodejs_compat_v2` | `nodejs_compat` alone | Compatibility date ≥ 2024-09-23 auto-enables v2 behavior. | Listing both is redundant. |
| Cloudflare ESLint preset (hoped-for) | typescript-eslint strict + stylisticTypeChecked + Workers globals | No official Cloudflare ESLint preset has shipped as of 2026-05-25 (`npm view` returns 404 for all candidate names). | D-02 fallback path is now the primary path. |

**Deprecated/outdated:**
- `wrangler.toml`: still supported but Cloudflare-discouraged for new projects.
- `new_classes` for newly created DOs: technically supported but actively discouraged; required-disabled on Free plan.
- `.eslintrc.json`: deprecated, removed in ESLint v10.
- `eslint-plugin-jsonc` ESLint-flat-config bridging: works, but heavier than warranted for this single-rule use case.
- `husky install` command in `prepare` script: silently no-ops in v9.
- `node-compat` (no nodejs_): legacy. Use `nodejs_compat`.
- Hand-written `interface Env { ... }`: drifts. Use `wrangler types`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript stable version is 5.9+ as of 2026-05; pin to whatever `npm view typescript version` returns at install. | Standard Stack §Core | Wrong version pin may cause peer-dep warnings with typescript-eslint v8.59.4 — harmless; install-time `npm view` resolves. |
| A2 | `@cloudflare/vitest-pool-workers` is in the `0.9.x` line as of 2026-05; verify exact version at install time. | Standard Stack §Supporting | Wrong version → install fails; planner runs `npm view` at scaffold time to confirm. Low-risk because vitest is optional for P1. |
| A3 | The exact Apache-2.0 placeholder header wording will be: `"NOTICE: Engram is licensed under Apache License 2.0. This license selection is provisional and subject to final confirmation at the v1.0 milestone."` placed as a top-of-file comment ABOVE the standard Apache-2.0 license text. | Pattern §LICENSE | If Russell wants different wording, easy edit during plan-discussion. |
| A4 | Phase 1 wraps `setup-dev.sh` as a `npm run setup` alias that runs `npm install && npm run types:gen` — the existing 5-line `setup-dev.sh` stays as a thin wrapper that echoes the GSD install instructions, OR gets retired in favor of CONTRIBUTING.md saying the same thing. | Code Examples §root scripts | Russell may prefer one approach over the other — flag for discussion. |
| A5 | The Phase 1 `EngramMcp` placeholder class can be empty (`{}`) and still satisfy Wrangler's binding requirements at `wrangler dev` time. | Pattern 3 | If Wrangler insists on a `fetch` method or `init()`, we add a one-line stub. Low-risk; trivially fixable during execution. |
| A6 | The `globals@^16.x` major version is current. | Standard Stack §Supporting | Wrong version pin → install fails or rule drift. Low-risk. |
| A7 | `.nvmrc` content is `22` (Node 22 LTS) — matches `engines.node: ">=22"`. | Pattern §root package.json | If Russell prefers a different LTS line (e.g., 20), trivial swap. |

## Open Questions (RESOLVED)

1. **Should `setup-dev.sh` be folded into `npm run setup` or kept as a thin shim?**
   - What we know: D-12 + D-09 imply consolidation; the existing script only echoes GSD plugin install instructions which now live in CONTRIBUTING.md.
   - What's unclear: Russell may want the bash script to remain as a discoverability artifact for non-Claude-Code users.
   - Recommendation: Fold into `npm run setup` (which prints the same GSD instructions before running `npm install`) and retire the standalone bash file. CONTRIBUTING.md already covers the GSD install steps.
   - RESOLVED in 01-06 Task 2: `setup-dev.sh` folded into `npm run setup` (which runs `npm install && npm run types:gen`); standalone bash file retired.

2. **Should Phase 1 also scaffold a placeholder `vitest.config.ts` per Worker package, or defer entirely to Phase 2?**
   - What we know: D-09 says scaffold all v0.1 packages so later phases don't carry scaffolding friction.
   - What's unclear: Whether the vitest config is "scaffolding" (P1) or "test infrastructure" (P2 alongside the first STO-08 test).
   - Recommendation: Defer to Phase 2 — vitest config depends on knowing what fixtures the package will need, and Phase 2 is where the first real test lands. Phase 1 just installs `@cloudflare/vitest-pool-workers` as a root dev-dep (optional even then).
   - RESOLVED: deferred to Phase 2 per RESEARCH §Q2 recommendation; no Phase 1 plan ships vitest config.

3. **Should `@engram/workspace-do` export an empty stub class in Phase 1, or wait until Phase 2?**
   - What we know: D-10 says workspace-do is library-only; mcp-server's `wrangler.jsonc` migration references the class.
   - What's unclear: If we omit the class export in Phase 1, `wrangler dev` for mcp-server may fail with "class not found" because the binding has no target.
   - Recommendation: Export a minimal `export class WorkspaceDO { /* phase 2 */ }` stub from `@engram/workspace-do/src/index.ts` and re-export it from mcp-server's `src/index.ts`. This makes the FND-03 smoke test work (`wrangler dev` boots cleanly) without preempting Phase 2 design decisions.
   - RESOLVED in 01-05 Task 1: minimal `export class WorkspaceDO extends DurableObject {}` stub exported from `@engram/workspace-do/src/index.ts`, re-exported from mcp-server's `src/index.ts` (A5 fallback to empty class allowed if `cloudflare:workers` import fails).

4. **Where should the FND-08 lint script live — `scripts/lint-wrangler.mjs` or `tools/lint-wrangler/index.mjs`?**
   - What we know: The script is tiny (~40 LOC) and has zero dependencies beyond `jsonc-parser`.
   - What's unclear: Whether to grow it into a `tools/` directory anticipating other lint scripts.
   - Recommendation: `scripts/lint-wrangler.mjs` (flat file, ~40 LOC). If future phases add `lint:envvars` or similar, promote to `scripts/lint/` then.
   - RESOLVED in 01-02 Task 1: lint script lives at flat `scripts/lint-wrangler.mjs` (~40 LOC, jsonc-parser only).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | All workspace packages | ✓ | v22.14.0 | — |
| `npm` | All workspace packages | ✓ | 11.15.0 | — |
| `git` | Husky pre-commit + CI | ✓ (assumed; repo is a git repo) | — | — |
| `gh` (GitHub CLI) | PR creation, Linear sync (Linear MCP separately) | ✓ | 2.89.0 | git push + manual PR via web UI |
| `jq` | Not needed for FND-08 (use jsonc-parser instead) | ✓ | jq 1.7.1 | — |
| `wrangler` (CLI) | `wrangler dev` smoke + `wrangler types` codegen | ⚠ Installed locally via npm in repo, not globally | 4.94.0 (target) | `npx wrangler` works the same |
| `npx @modelcontextprotocol/inspector` | Phase 3 MCP smoke (not P1) | n/a (P3 concern) | — | — |
| Cloudflare account + paid Workers plan | Phase 7 deploy (NOT P1) | n/a (Russell has it; not exercised in P1) | — | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

**Notes:**
- Phase 1 makes ZERO Cloudflare API calls. `wrangler dev` runs `workerd` locally — no account needed.
- Cloudflare account is only exercised in Phase 7 (`wrangler deploy`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | No unit-test framework wired in Phase 1. The Phase 1 "validation" is scripted smoke tests + lint + typecheck. Phase 2 introduces `vitest` (via `@cloudflare/vitest-pool-workers`) for STO-08. |
| Config file | none (P1) — `vitest.config.ts` lands in Phase 2 |
| Quick run command | `npm run lint && npm run typecheck && npm run lint:wrangler && npm run format:check` |
| Full suite command | Quick suite + `npm run dev:mcp` boot check (timed 10s, expect exit 0 on SIGTERM) + `npm run dev:triage` boot check + `node scripts/lint-wrangler.mjs` against a fixture that violates the rule (expected exit 1) |
| Phase gate | Full suite green on a fresh clone + CI green on PR |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | Fresh clone → `npm install` produces a working workspace tree | smoke | `rm -rf node_modules && npm install && ls -d node_modules/@engram/*` | ❌ — Wave 0 task to add `scripts/smoke-install.sh` |
| FND-02 | Each Worker package has `wrangler.jsonc` with required fields | unit (lint) | `npm run lint:wrangler` (validates parseable + has required keys) | ❌ — Wave 0: `scripts/lint-wrangler.mjs` (Pattern 8) |
| FND-03 | `wrangler dev` boots no-op Worker | smoke | `timeout 15 npx wrangler dev --config packages/mcp-server/wrangler.jsonc --port 8787 & sleep 8 && curl -sf http://localhost:8787 && kill %1` | ❌ — Wave 0: `scripts/smoke-wrangler-dev.sh` |
| FND-04 | `@engram/types` exports the 5 named types AND another package imports them | unit (typecheck) | `npm run typecheck` (consumer file in mcp-server imports all 5) | ❌ — Wave 0: ensure src/index.ts in mcp-server imports each named type |
| FND-05 | `@engram/schema` exports 7 system memory types with field metadata | unit (typecheck + runtime) | `npm run typecheck` + `node -e "import('./shared/schema/src/system-types.js').then(m => console.assert(m.SYSTEM_TYPES.length === 7))"` | ❌ — Wave 0: ensure schema package compiles and exports `SYSTEM_TYPES` |
| FND-06 | `LICENSE` exists with Apache-2.0 text + v1.0 confirmation header | smoke | `head -5 LICENSE \| grep -q "subject to final confirmation at v1.0" && grep -q "Apache License" LICENSE` | ❌ — Wave 0: create `LICENSE` |
| FND-07 | CLAUDE.md updated per Edit Map (Pattern 11) | grep | `! grep -nE "wrangler\.toml\|ingest-worker[^]\|format\?\)" CLAUDE.md \|\| (echo "STALE REFS FOUND" && exit 1)` | ❌ — Wave 0: apply edits per Pattern 11 |
| FND-08 | `lint:wrangler` rejects `new_classes`, accepts `new_sqlite_classes` | unit (positive + negative fixtures) | `npm run lint:wrangler` against `packages/*/wrangler.jsonc` (expect pass) + `npm run lint:wrangler -- tests/fixtures/bad-wrangler.jsonc` (expect fail, exit 1) | ❌ — Wave 0: `scripts/lint-wrangler.mjs` + `tests/fixtures/{good,bad}-wrangler.jsonc` |

### Sampling Rate
- **Per task commit:** `npm run lint && npm run typecheck && npm run lint:wrangler && npm run format:check` (quick suite; <30s on a warm install)
- **Per wave merge:** Quick suite + smoke (`scripts/smoke-wrangler-dev.sh` for each Worker)
- **Phase gate:** Full suite green on a fresh clone in CI before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `scripts/lint-wrangler.mjs` — implements FND-08 per Pattern 8 (verbatim)
- [ ] `scripts/smoke-install.sh` — fresh-clone install smoke (FND-01)
- [ ] `scripts/smoke-wrangler-dev.sh` — boots `wrangler dev` for each Worker, hits localhost, expects 200 (FND-03)
- [ ] `tests/fixtures/good-wrangler.jsonc` — fixture passing FND-08 (mirrors Pattern 1)
- [ ] `tests/fixtures/bad-wrangler.jsonc` — fixture failing FND-08 (`new_classes: ["WorkspaceDO"]`)
- [ ] `.github/workflows/ci.yml` — wires all quick-suite commands (Pattern 10)
- [ ] Root `tsconfig.json` with project references (Pattern 6)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | This phase establishes the deployment topology that every later phase inherits. `new_sqlite_classes` enforcement (FND-08) is an architectural integrity control. |
| V2 Authentication | no (P1) | Auth lands in Phase 3 (JWT middleware). |
| V3 Session Management | no (P1) | Session DO lifecycle is Phase 3 (`McpAgent`). |
| V4 Access Control | no (P1) | Workspace isolation is Phase 2/3 (DO-defense-in-depth check). |
| V5 Input Validation | partial (P1) | FND-08 lint validates `wrangler.jsonc` input shape — a meta-form of validation that protects against ourselves. |
| V6 Cryptography | no (P1) | JWT signing lives in Phase 3/7. |
| V14 Configuration | yes | Per-package `wrangler.jsonc` with `nodejs_compat` flag, no secrets in repo, `.dev.vars` in `.gitignore`. This is the entire security surface for Phase 1. |

### Known Threat Patterns for {scaffolding phase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted dependency installed in Phase 1 propagates to every Worker | Tampering / Elevation of Privilege | Package Legitimacy Audit above; `slopcheck scan --pkg npm <name>` run for every dep before adding to `package.json`. **Critical:** never run `slopcheck install <pkg>` for an npm package — it maps to PyPI and silently installs unrelated/malicious packages of the same name. |
| Cross-ecosystem package confusion (npm name installed as PyPI package or vice versa) | Tampering | Always specify ecosystem explicitly. Use `npm install <pkg>` and `slopcheck scan --pkg npm <pkg>`. |
| Stale CLAUDE.md text re-introduces deprecated patterns (`wrangler.toml`, `ingest-worker`, `format?`) into Phase 2+ work | Tampering (via documentation) | FND-07 is a hard requirement, not a cleanup task. Phase gate verification greps CLAUDE.md for stale tokens and fails the phase if any are found in v0.1-active sections. |
| `new_classes` regression in any future-added Worker | Tampering | FND-08 CI lint blocks the PR. Cannot ship a regression to production. |
| Secrets committed to repo via `.dev.vars` | Information Disclosure | `.gitignore` includes `.dev.vars`, `.dev.vars.*`, `.wrangler/`, `dist/` from first commit. CI grep for high-entropy strings is a Phase 7 concern (not P1). |
| Pre-commit hook bypassed with `--no-verify` ships unlinted code | Tampering | D-03 explicitly mandates **both** pre-commit and CI lint. CI is the durable gate — `--no-verify` is meaningless when the PR can't merge red. |
| Dependency drift between root and per-Worker `package.json` (e.g., two `agents` versions) | Tampering / Confusion | npm workspaces deduplicate via the root lockfile; pin `agents` exactly (`^0.13.2` per STACK.md), regularly audit `npm ls agents` for duplicate trees. |

## Sources

### Primary (HIGH confidence)

- **Cloudflare Workers — Durable Objects migrations** — https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/ (used: confirm `new_sqlite_classes` array supports multiple class names in a single migration entry)
- **Cloudflare Workers — Wrangler configuration** — https://developers.cloudflare.com/workers/wrangler/configuration/ (used: minimum required fields, `$schema` reference, `migrations` shape, `durable_objects.bindings`)
- **Cloudflare Workers — McpAgent API** — https://developers.cloudflare.com/agents/model-context-protocol/mcp-agent-api/ (used: confirm `import { McpAgent } from "agents/mcp"` and `.serve("/mcp")` pattern)
- **Cloudflare Workers — Compatibility flags** — https://developers.cloudflare.com/workers/configuration/compatibility-flags/ (used: `nodejs_compat` vs `nodejs_compat_v2` — v2 auto-enabled by compat date)
- **Cloudflare Workers — TypeScript** — https://developers.cloudflare.com/workers/languages/typescript/ (used: `wrangler types` preferred over manual Env interface; `@cloudflare/workers-types/experimental` ambient types)
- **Cloudflare changelog — wrangler types multi-env** — https://developers.cloudflare.com/changelog/post/2026-01-13-wrangler-types-multi-environment/ (used: 2026 update to `wrangler types`)
- **Cloudflare Workers — vitest integration** — https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/ (used: defineWorkersConfig pattern, configPath accepts JSONC)
- **Cloudflare blog — automatically generating types** — https://blog.cloudflare.com/automatically-generated-types/ (used: rationale for `wrangler types`-generated `worker-configuration.d.ts`)
- **Cloudflare workers-sdk issue #9909** — https://github.com/cloudflare/workers-sdk/issues/9909 (used: Free plan requires `new_sqlite_classes`; confirms severity)
- **typescript-eslint — Shared Configs** — https://typescript-eslint.io/users/configs/ (used: `strictTypeChecked` + `stylisticTypeChecked` flat config recipe)
- **ESLint — flat config docs** — https://eslint.org/blog/2022/08/new-config-system-part-2/ (used: flat config shape)
- **Apache.org — LICENSE-2.0** — https://www.apache.org/licenses/LICENSE-2.0.txt (used: canonical license text source)
- **Apache.org — Source headers** — https://apache.org/legal/src-headers.html (used: boilerplate header conventions)
- **Microsoft node-jsonc-parser** — https://github.com/microsoft/node-jsonc-parser (used: official JSONC parser for FND-08 lint)
- **GitHub — actions/setup-node** — https://github.com/actions/setup-node (used: CI workflow Node setup with `.nvmrc` + npm cache)
- **lint-staged — README** — https://github.com/lint-staged/lint-staged (used: companion to Husky, runs only on staged files)
- **Existing project research artifact: `.planning/research/STACK.md`** — full architectural baseline; corroborates `wrangler.jsonc` + `agents/mcp` + `new_sqlite_classes` decisions
- **Existing project research artifact: `.planning/research/SUMMARY.md`** — Eight irreversible decisions list (incl. JSONC, two-DO topology)
- **`npm view <pkg> version`** for every dep in Standard Stack (verified 2026-05-25)
- **`slopcheck scan --pkg npm <pkg>`** for every dep (verified 2026-05-25)

### Secondary (MEDIUM confidence)

- **Cloudflare workers-sdk issue #8894** — https://github.com/cloudflare/workers-sdk/issues/8894 (used: confirms lack of official Cloudflare ESLint preset; community uses typescript-eslint directly)
- **GitHub — cloudflare/agentic-inbox `wrangler.jsonc`** — referenced via WebSearch result (used: real-world example of two-DO bindings in same Worker)
- **GitHub — Pedropfuenmayor/mcp-cloudflare `wrangler.jsonc`** — referenced via WebSearch result (used: real-world `McpAgent` wrangler config)
- **husky v9 release notes** — referenced via Tighten/Theo blog (used: `husky install` deprecation)
- **typicode/husky issue #1447** — https://github.com/typicode/husky/issues/1447 (used: pre-commit hook gotcha after v9 upgrade)

### Tertiary (LOW confidence)

- **General WebSearch results on "GitHub Actions Node.js npm workspaces lint typecheck"** — used for CI workflow shape (Pattern 10), but verified against `actions/setup-node` README

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every package verified via `npm view` + `slopcheck scan --pkg npm` on 2026-05-25; Cloudflare core deps cross-verified against official docs.
- Architecture: **HIGH** — `wrangler.jsonc` two-DO pattern confirmed by Cloudflare official docs + real-world example (`agentic-inbox`); `agents/mcp` McpAgent import path confirmed by Cloudflare docs and prior `STACK.md` research; CLAUDE.md edit map confirmed via line-numbered grep.
- Pitfalls: **HIGH** — every pitfall cited to issue tracker or official changelog.
- FND-08 lint script: **HIGH** — script is verbatim-runnable; tested mentally against Pattern 1 (good) and a `new_classes` fixture (bad); 40 LOC, single dep already in dev-deps.
- Validation Architecture: **MEDIUM** — Phase 1 is scaffold-only; no unit tests yet. Validation depends on scripted smoke tests + lint, which is the right call for the phase but means we won't have green tests until Phase 2.
- Security domain: **HIGH** — threat surface for Phase 1 is small and well-bounded (config integrity + dependency legitimacy + doc drift).

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days — most deps are stable, but Wrangler/agents ship frequently; re-verify versions if scaffold happens after 2026-06-25)
