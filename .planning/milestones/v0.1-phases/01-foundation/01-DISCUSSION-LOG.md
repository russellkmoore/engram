# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 01-foundation
**Mode:** discuss (default, interactive)
**Areas discussed:** Lint/format toolchain, Shared module import strategy, Worker package scaffolding scope, README & repo presentation polish

---

## Lint/format toolchain

### Q1: Which lint + format toolchain for the monorepo?

| Option | Description | Selected |
|--------|-------------|----------|
| Biome | Single Rust-based tool, lint + format in one. ~10x faster than ESLint, near-zero config. Tradeoff: smaller plugin ecosystem, no Markdown lint, newer. | |
| ESLint + Prettier | Two tools, slower but the ecosystem default. Cloudflare templates ship with these. Strong TS plugin ecosystem. Tradeoff: more config surface. | ✓ |
| Biome + Prettier (mixed) | Biome for JS/TS, Prettier for MD/YAML/JSON. Tradeoff: two formatters, two configs. | |

**User's choice:** ESLint + Prettier

### Q2: ESLint rule baseline — how strict should it be from day 1?

| Option | Description | Selected |
|--------|-------------|----------|
| typescript-eslint strict | `tseslint.configs.strict` + `stylisticTypeChecked`. Catches real bugs, modern TS idioms. | |
| Recommended only | `tseslint.configs.recommended` baseline. Lower friction at start. | |
| Cloudflare workers preset | Use `@cloudflare/eslint-config-worker` if it fits. Optimized for Workers patterns. | ✓ |

**User's choice:** Cloudflare workers preset
**Notes:** Researcher must verify the package is current/maintained in 2026; fall back to `typescript-eslint` strict aligned to Workers patterns if not.

### Q3: Where should lint + format run?

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-commit + CI | Husky + lint-staged on staged files at commit time; CI runs full check on PR. | ✓ |
| CI only | No git hooks. Fast `git commit`, feedback at PR time. | |
| Pre-commit only | No CI lint step. Risky if hooks are bypassed. | |

**User's choice:** Pre-commit + CI

### Q4: Pre-commit hook tooling?

| Option | Description | Selected |
|--------|-------------|----------|
| Husky + lint-staged | Industry default. Tons of examples online. | |
| Lefthook | Go binary, parallel, faster on large stages. Less ubiquitous. | |
| You decide | Either is fine — Claude discretion. | ✓ |

**User's choice:** You decide (Claude discretion)
**Notes:** Default to Husky + lint-staged for portfolio-repo ubiquity.

---

## Shared module import strategy

### Q1: How should Worker packages import from `shared/types/` and `shared/schema/`?

| Option | Description | Selected |
|--------|-------------|----------|
| Workspace packages (@engram/*) | Real npm-workspace packages. Imports like `from '@engram/types'`. Clean, refactor-safe. | ✓ |
| TS path aliases | Single root tsconfig with `paths`. Imports like `from '~shared/types'`. Lighter setup. | |
| Mixed: workspace pkgs for types/schema, relative for utils | Hybrid. Tradeoff: inconsistency. | |

**User's choice:** Workspace packages (@engram/*)

### Q2: Should ALL workspace packages use the `@engram/*` scope, or only the shared ones?

| Option | Description | Selected |
|--------|-------------|----------|
| All packages scoped | `@engram/mcp-server`, `@engram/workspace-do`, `@engram/types`, `@engram/schema`. Uniform. | ✓ |
| Workers unscoped, shared scoped | `mcp-server`, `workspace-do` but `@engram/types`, `@engram/schema`. Tradeoff: inconsistent. | |
| All unscoped | Simplest. Tradeoff: less clean if anything ever publishes. | |

**User's choice:** All packages scoped

### Q3: How should `@engram/types` and `@engram/schema` be consumed by Worker packages — as TS source, or as a built artifact?

| Option | Description | Selected |
|--------|-------------|----------|
| TS source, no build step | Shared packages export `.ts` directly. Wrangler/esbuild bundles. Zero build orchestration. | ✓ |
| tsc-built (.js + .d.ts) artifacts | Shared packages emit `dist/`. Workers depend on built JS. Traditional. | |
| Project references with composite | TS project references + `composite: true`. Tradeoff: brittle config. | |

**User's choice:** TS source, no build step

---

## Worker package scaffolding scope

### Q1: Which Worker/package directories should P1 scaffold?

| Option | Description | Selected |
|--------|-------------|----------|
| All v0.1 packages now | mcp-server, workspace-do, triage-worker, types, schema. FND-08 lint covers all wranglers from day 1. | ✓ |
| Critical-path only | mcp-server, workspace-do, types, schema now; defer triage-worker to P5. | |
| Mcp-server only + shared | Just mcp-server (WorkspaceDO inlined). Contradicts CLAUDE.md layout. | |

**User's choice:** All v0.1 packages now

### Q2: Should `workspace-do` have its own wrangler.jsonc?

| Option | Description | Selected |
|--------|-------------|----------|
| No — library package only | TS library package; WorkspaceDO class imported and bound from mcp-server's wrangler. Matches MCP-03 two-DO topology. | ✓ |
| Yes — for `wrangler dev` isolation | Standalone Worker config for isolated dev. Tradeoff: contradicts two-DO topology. | |
| Yes — minimal stub for FND-08 lint coverage | Tiny config just so the lint rule has a target. Tradeoff: tail wagging the dog. | |

**User's choice:** No — library package only

### Q3: Monorepo task orchestration — plain npm scripts, or a layer on top?

| Option | Description | Selected |
|--------|-------------|----------|
| Plain npm workspaces scripts | `npm run lint -ws`, `npm run test -ws`. Zero extra deps. | ✓ |
| Turborepo | Task pipelines + remote caching. Tradeoff: another dep + config. | |
| Nx | Heavier orchestration. Tradeoff: significant config surface. | |

**User's choice:** Plain npm workspaces scripts

### Q4: CI provider for the lint/typecheck/test pipeline?

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions | Repo is on GitHub. Standard `.github/workflows/ci.yml`. | |
| Cloudflare Workers Builds | Native to CF, integrates with Wrangler deploys. Less mature for general CI. | |
| You decide | Pick whatever is least friction. | ✓ |

**User's choice:** You decide (Claude discretion)
**Notes:** Default to GitHub Actions.

---

## README & repo presentation polish

### Q1: How polished should the README be at v0.1 ship time?

| Option | Description | Selected |
|--------|-------------|----------|
| Portfolio-quality at v0.1 | Elevator pitch, "why Engram" paragraph, architecture diagram, tech stack, status, install/dev, link to CLAUDE.md. No demo GIF yet. | ✓ |
| Minimal now, polish at v0.4 | Dev setup + 1-paragraph what-it-is + link to CLAUDE.md. Defer real polish. | |
| Two-tier | Pretty top section, "under construction" notice below. Looks unfinished. | |

**User's choice:** Portfolio-quality at v0.1

### Q2: Architecture diagram — what format?

| Option | Description | Selected |
|--------|-------------|----------|
| Mermaid in README | GitHub renders natively. Source-controlled, easy to update. | |
| Static SVG/PNG | Hand-crafted in Excalidraw. More polished. Drifts from reality. | |
| Both — Mermaid in README, polished SVG in docs/ | Mermaid as live source of truth, SVG for hero/social share. | ✓ |

**User's choice:** Both — Mermaid in README, polished SVG in docs/

### Q3: CONTRIBUTING.md state at v0.1?

| Option | Description | Selected |
|--------|-------------|----------|
| Honest "pre-v1.0" note | Short note that contributions open at v1.0; expect slow response now. | |
| Full contributing guide now | Style, branch naming, PR template, CoC. Premature. | |
| Keep current minimal | Leave as-is (GSD setup steps only). | ✓ |

**User's choice:** Keep current minimal

### Q4: Status badges and front-matter at the top of README?

| Option | Description | Selected |
|--------|-------------|----------|
| License + CI + version | Three badges. Cheap credibility. | ✓ |
| Comprehensive set | License + CI + version + npm + CF deploy + coverage. Noisy at v0.1. | |
| No badges | Clean text-only. Looks less "real project". | |

**User's choice:** License + CI + version

---

## Claude's Discretion

- Pre-commit hook tooling — defaulting to Husky + lint-staged.
- TypeScript config layout — defaulting to `tsconfig.base.json` at root + per-package `tsconfig.json` extending it (`module: bundler`, strict, ES2022).
- CI provider — defaulting to GitHub Actions.
- README copy phrasing and section order beyond the structural items listed.
- No-op handler shape for each scaffolded Worker.
- `.gitignore`, `.editorconfig`, Node version pin (`.nvmrc`/`engines`), `.npmrc` defaults.
- FND-08 lint rule implementation language (node script vs bash + jq vs eslint plugin).

## Deferred Ideas

None — discussion stayed within phase scope. Items already deferred by REQUIREMENTS.md / ROADMAP.md and not re-litigated here: `ingest-worker` package (v0.4), full CONTRIBUTING.md (v1.0), npm publish (v1.0), code-coverage badges (post-v0.1).

---

*Discussion completed: 2026-05-25*
