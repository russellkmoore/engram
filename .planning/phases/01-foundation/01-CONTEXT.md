# Phase 1: Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

A clean clone of the repo bootstraps via `npm install` into a typed, lint-clean, license-bearing monorepo where every v0.1 Worker package (`@engram/mcp-server`, `@engram/triage-worker`) can boot under `wrangler dev`, shared TypeScript surfaces (`@engram/types`, `@engram/schema`) are consumable from every Worker, and CLAUDE.md reflects the corrected v0.1 architectural baseline (JSONC config, two-DO topology, `agents/mcp` `McpAgent`, `search` without `format?`, `ingest-worker` deferred to v0.4).

Phase 1 covers requirements **FND-01..FND-08**. It establishes scaffolding only — no business logic, no SQLite schema, no MCP tool wiring, no AI/Vectorize work, no Workers AI. Those land in Phases 2–7.

</domain>

<decisions>
## Implementation Decisions

### Lint/format toolchain
- **D-01:** Linter + formatter = **ESLint + Prettier** (not Biome). Cloudflare Workers conventions are the target audience and the ESLint ecosystem fits that history better.
- **D-02:** ESLint rule baseline = **Cloudflare Workers preset** if a current/maintained one exists in 2026; researcher must verify the package state. **Fallback:** `typescript-eslint` strict (`tseslint.configs.strict` + `stylisticTypeChecked`) tuned to match common Workers patterns.
- **D-03:** Lint + format runs in **pre-commit hooks AND CI**. Pre-commit catches issues at the cheapest moment; CI is the durable gate on PRs (so `--no-verify` can't ship unlinted code into a portfolio repo).
- **D-04:** Pre-commit hook manager — **Claude's discretion**. Default: **Husky + lint-staged** (ubiquity wins for a portfolio repo; contributors recognize it immediately).

### Shared module import strategy
- **D-05:** Shared code is exposed as **real npm-workspace packages** (not TS path aliases, not relative imports). Imports look like `import { Memory } from '@engram/types'`.
- **D-06:** **All workspace packages use the `@engram/*` scope** — `@engram/mcp-server`, `@engram/workspace-do`, `@engram/triage-worker`, `@engram/types`, `@engram/schema`. Uniform; mirrors any future npm publishing under that scope.
- **D-07:** Shared packages **export TypeScript source directly** (via the `"exports"` field pointing at `.ts` entrypoints). Wrangler/esbuild bundles the TS at Worker build time — there is **no separate `tsc` build step** for shared packages. Type-checking across the monorepo is handled via `tsc --noEmit` (project-wide or per-package).
- **D-08:** TypeScript config layout — **Claude's discretion**. Default: a root `tsconfig.base.json` with `strict: true`, `module: "bundler"`, `moduleResolution: "bundler"`, `target: "ES2022"`, `types: ["@cloudflare/workers-types/experimental"]`; per-package `tsconfig.json` extends the base and narrows `types`/`include` as needed.

### Worker package scaffolding scope
- **D-09:** Phase 1 scaffolds **all v0.1 packages** — `@engram/mcp-server`, `@engram/workspace-do`, `@engram/triage-worker`, `@engram/types`, `@engram/schema`. Even though `triage-worker` doesn't activate until P5/P6, scaffolding it now means FND-08's wrangler lint covers every config from day 1 and P5/P6 don't carry scaffolding friction.
- **D-10:** `@engram/workspace-do` is a **library-only package** — `package.json` + `tsconfig.json`, **no `wrangler.jsonc`**. It exports the `WorkspaceDO` class which `@engram/mcp-server` imports and binds. The DO is declared in `mcp-server`'s `wrangler.jsonc` under `new_sqlite_classes` alongside the `EngramMcp` session DO (matches the two-DO topology in MCP-03). FND-02's "each Worker package has its own wrangler.jsonc" applies only to deploying Workers (`mcp-server`, `triage-worker`).
- **D-11:** Monorepo task orchestration = **plain npm workspace scripts** (no Turborepo, no Nx). Shared packages have no build graph to cache; lint/test parallelization at this scale is fine via `--workspaces`. Revisit if v0.2+ build times become painful.
- **D-12:** CI provider — **Claude's discretion**. Default: **GitHub Actions** (`.github/workflows/ci.yml` running lint + typecheck + the FND-08 wrangler lint + vitest matrix per package). Repo is on GitHub; this is the path of least friction.

### README & repo presentation polish
- **D-13:** README is built to **portfolio quality at v0.1**, not deferred. v0.1 hits GitHub before the v0.4 killer demo; visitors land on the README first and that has to do the credibility work. Sections: elevator pitch, "why Engram" paragraph, architecture diagram, tech stack table, status section, install/dev quickstart, link to CLAUDE.md for architectural depth.
- **D-14:** Architecture diagram = **both formats**. Mermaid block in the README as the live source of truth (GitHub renders natively, diffs in PRs). A polished SVG in `docs/architecture.svg` for the hero/social-share image. Mermaid updates first; SVG is regenerated when the architecture shifts materially.
- **D-15:** Top-of-README badges = **license + CI + version** (three only). Apache-2.0 license badge, GitHub Actions CI status, `package.json` version. No npm-publish/coverage/deploy badges in v0.1 — broken badges look worse than missing badges on a portfolio repo.
- **D-16:** CONTRIBUTING.md stays **minimal as-is** (just the GSD setup steps it already contains). Full contributor guidance, code of conduct, PR templates, etc. wait until v1.0 when the OSS license is finalized and external contributions are actually invited.

### Claude's Discretion
- Pre-commit hook manager: default Husky + lint-staged.
- TypeScript config layout: tsconfig.base.json at root extended by per-package configs.
- CI provider: GitHub Actions.
- Exact wording/structure of README copy (elevator pitch phrasing, section order beyond what's listed in D-13).
- No-op handler shape (e.g., `return Response.json({ ok: true, worker: "<name>" })` vs. a healthcheck pattern).
- `.gitignore` patterns, `.editorconfig`, Node version pinning mechanism (`.nvmrc` / `engines` field / `volta`), and `.npmrc` settings — all standard 2026 defaults.
- FND-08 lint rule implementation language (node script, bash + jq, or eslint plugin) — pick whichever is simplest to keep green in CI.

</decisions>

<specifics>
## Specific Ideas

- The "two-DO topology" is a load-bearing pattern: `EngramMcp` (auto-managed session DO from `agents/mcp`) and `WorkspaceDO` (durable per-workspace SQLite store) live in the **same Worker deployment** but as **separate DO classes**, both declared under `new_sqlite_classes` in mcp-server's `wrangler.jsonc`. P1 sets up the file structure that makes this topology natural; P2 fills WorkspaceDO; P3 fills EngramMcp.
- "Do it RIGHT, not FAST" applies hard here: this is the phase where defaults solidify across 7 more phases. A wrong wrangler config baseline or missing CI lint here propagates into every later Worker.
- FND-07 is not a cleanup item — it is the explicit task of editing CLAUDE.md to reflect: `wrangler.jsonc` (not `.toml`) everywhere, two-DO topology (`EngramMcp` + `WorkspaceDO`), `agents/mcp` `McpAgent` adapter (not raw `@modelcontextprotocol/sdk` HTTP), `search` signature without `format?`, `ingest-worker` package deferred to v0.4. The current CLAUDE.md (~17K) predates the research corrections — agents downstream will read whichever wins last, so this must land cleanly.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project vision and locked decisions
- `.planning/PROJECT.md` — Vision, three-goal priority order (personal → portfolio → side-business), "Do it RIGHT, not FAST" operating principle, locked tech-stack constraints, Linear sync convention, milestone arc through v1.0.
- `.planning/REQUIREMENTS.md` §"Foundation (FND)" — FND-01..FND-08 acceptance criteria; the locked baseline for this phase. §"Traceability" pins each requirement to a phase.

### Phase scope and success criteria
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — Phase goal statement, dependency chain (none for P1), per-requirement mapping (FND-01..08), 7 explicit success criteria, risk notes calling out irreversible decisions DO-1 (`new_sqlite_classes`) and C8 (Apache-2.0 license placeholder).
- `.planning/ROADMAP.md` §"Phases NOT in v0.1" — anchors which packages (`ingest-worker`) are explicitly deferred so P1's scaffold list stays correct.

### Architecture spec being amended
- `CLAUDE.md` — Authoritative architecture spec for tech stack, repository structure, DO hierarchy, SQLite schema, MemoryEvent pipeline, MCP tool surface, naming conventions, and "what goes where" routing rules. **FND-07 will update this file** to reflect the corrections listed in D-13 / §Specifics. Treat it as the architectural baseline that everything else must align to.

### Linear / project tracking conventions
- `.planning/PROJECT.md` §"Project Tracking → Linear Sync Convention" — Phase = Issue mapping table. P1 will get a Linear issue in team `ENG` at `/gsd:plan-phase 1`, attached to milestone "v0.1 — MCP Foundation".
- `CLAUDE.md` §"Linear Workflow" — duplicate of the sync convention; both must remain consistent.

</canonical_refs>

<code_context>
## Existing Code Insights

The repo is **pre-scaffold** as of P1 entry. Tree at start of P1:

```
engram/
├── .planning/                      # GSD planning artifacts (this directory)
├── .git/
├── CLAUDE.md                       # ~17K architectural baseline (FND-07 amends)
├── CONTRIBUTING.md                 # ~10 lines, GSD setup only (D-16 keeps as-is)
└── scripts/
    └── setup-dev.sh                # 199B — pre-existing dev bootstrap helper
```

### Reusable Assets
- `scripts/setup-dev.sh` already exists; inspect before P1 work and either fold its contents into `npm run setup` (preferred for D-12 / D-09) or leave as a thin compatibility shim. Do not duplicate logic.
- `CONTRIBUTING.md` is already minimal — D-16 says keep as-is; P1 should NOT expand it.

### Established Patterns
- **None to inherit.** P1 is the patterns-establishing phase. Choices made here propagate to Phases 2–7:
  - `wrangler.jsonc` shape (compatibility_date, `nodejs_compat`, `new_sqlite_classes`) is templated by P1 and copied for every subsequent Worker.
  - `package.json` shape for `@engram/*` workspace packages — name, exports field pointing at TS source, `types` field — sets the bar for P2/P3/P5/P6 packages.
  - `tsconfig.base.json` + per-package `tsconfig.json` extension pattern (D-08) is reused by every Worker added later.
  - `.github/workflows/ci.yml` matrix is extended (not rewritten) when later phases add per-package vitest configs.

### Integration Points
- **mcp-server ↔ workspace-do:** mcp-server imports `WorkspaceDO` class from `@engram/workspace-do` and declares it in its `wrangler.jsonc` (D-10). P1 wires the imports and bindings; P2 fills the DO body.
- **mcp-server / triage-worker ↔ @engram/types, @engram/schema:** Workers import shared types via the `@engram/*` scope (D-05/D-06). P1 establishes the imports; P4/P5/P6 use them.
- **CI pipeline ↔ FND-08 wrangler lint:** the lint rule from FND-08 is wired into `npm run lint:wrangler` and the CI workflow (D-12). Every later phase that adds a Worker gets coverage automatically.
- **Linear ↔ GSD:** P1 will be the first phase to exercise the `/gsd:plan-phase → create ENG issue → /gsd:execute-phase → transition` flow against the existing `v0.1 — MCP Foundation` Linear milestone.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Items intentionally postponed (and already documented in REQUIREMENTS.md / ROADMAP.md) include `ingest-worker` package (v0.4), full CONTRIBUTING.md (v1.0), npm publish / package registry work (v1.0), and code-coverage instrumentation badges (post-v0.1).

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-05-25*
