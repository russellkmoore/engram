# Phase 3: MCP Server Scaffold - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The `mcp-server` Worker becomes a real `EngramMcp extends McpAgent` that authenticates clients via OAuth (JWT → `this.props.{workspace_id, user_id}`), exposes the 5 v0.1 tools (`remember`, `recall`, `search`, `forget`, `ingest`) as **registered-but-empty** handlers at `/mcp`, and routes every tool call to the correct `WorkspaceDO` via `getAgentByName(env.WORKSPACE, this.props.workspace_id)`. Phase 3 ships the scaffold; Phase 4 fills the tool bodies (TOL-01..05). Vectorize wiring, Workers AI calls, and Triage Worker integration are out of scope (Phase 5+).

</domain>

<decisions>
## Implementation Decisions

### Auth strategy

- **D-01:** **OAuth Resource Server pattern** (MCP spec compliant). Worker validates JWTs against a JWKS endpoint; `/.well-known/oauth-protected-resource` advertises the Authorization Server's location. Matches what Claude Desktop's `mcp-remote` bridge expects. No retrofit needed when Devon/BMC joins in v0.2.
- **D-02:** **`@cloudflare/workers-oauth-provider` is the Authorization Server**, co-deployed in the same Worker. Library ships `/authorize`, `/token`, `/jwks`, `/register`, and `/.well-known/oauth-protected-resource` endpoints out of the box. Single dep, no external provider, no monthly cost, fully MCP-native.
- **D-03:** **Full OAuth dance via `mcp-remote` for first-token issuance.** Russell adds `mcp-remote https://engram-mcp.workers.dev/mcp` to Claude Desktop config; on first call, `mcp-remote` opens a browser to `/authorize`, user clicks an auto-approve consent UI (v0.1 single-user shortcut — real consent UI lands in v0.2 when Devon needs to grant access), token cached locally, transparent thereafter. **Updates DEP-02** from "JWT issued via script or doc" → "documented OAuth flow via `mcp-remote` + Claude Desktop config snippet".
- **D-04:** **Dynamic props from Cloudflare KV.** Namespace `ENGRAM_IDENTITIES` maps OAuth subject (`sub` claim) → `{ workspace_id: string, user_id: string }`. The OAuth provider's `authorize` hook reads from KV and populates the JWT props. v0.1 bootstrap script writes a single entry for Russell's OAuth subject. v0.2+ adds entries (or a UI) without changing any auth code — only KV data. Trade-off accepted: extra binding + 1 KV read per /authorize call (not per /mcp call — props are JWT-encoded after first auth).

### Tool stub shape

- **D-05:** **Stub handlers throw `new McpError(ErrorCode.MethodNotFound, '<tool> not implemented in Phase 3 — ships in Phase 4 (TOL-0N)')`.** All 5 tools registered with real names + zod schemas; calling any returns a structured, debuggable `-32601 MethodNotFound` error. Phase 4 swaps each handler body; the registration + schema + signature stay. Honors MCP-07 ("never invent ad-hoc `{error:...}` envelopes"). MCP Inspector (MCP-09) lists all 5 tools by name; clicking any returns the phase-noted MethodNotFound.
- **D-06:** **Zod input schemas live in `packages/mcp-server/src/schemas.ts`.** Each schema (`RememberInputSchema`, `RecallInputSchema`, `SearchInputSchema`, `ForgetInputSchema`, `IngestInputSchema`) is a `z.object()` mirroring `@engram/types` canonical shapes where possible. Single source of truth across registration + Phase 4 handler bodies. No build-step type generation (`zod-to-ts` / `ts-to-zod`) — Phase 1 D-07 locks TS-source / no-build-step posture.

### Worker route surface

- **D-07:** **OAuth Authorization Server endpoints co-located with MCP.** Single `engram-mcp-server` Worker hosts `/mcp` + `/authorize` + `/token` + `/jwks` + `/register` + `/.well-known/oauth-protected-resource`. Single deploy, single domain (`engram-mcp.workers.dev`), single `wrangler.jsonc`. No cross-Worker JWKS fetch. The MCP `McpAgent.serve("/mcp")` is one branch in the Worker's router; the OAuth provider mounts the rest.
- **D-08:** **Additional public routes:** `/health` (uptime + `{ status: 'ok', version, commit, timestamp }`, no auth) AND `/` (root project info JSON — `{ name, mcp: '/mcp', oauth: '/.well-known/oauth-protected-resource', docs: '...' }`, no auth). `/debug/*` endpoints deferred — too easy to ship a leak.

### v2 wrangler.jsonc migration (resolves Phase 2 D-07 forward-note)

- **D-09:** Phase 3 adds **`{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }`** to `packages/mcp-server/wrangler.jsonc › migrations[]`. Acceptance: `npm run lint:wrangler` exits 0 + `wrangler deploy --dry-run` confirms the migration would apply cleanly + the JSDoc comment in Phase 1's `wrangler.jsonc` (lines documenting "deferred to v2") is updated/removed.

### Claude's Discretion

- **Error mapping convention** (Phase 4 will reference): WorkspaceDO's `McpError(-32600 InvalidRequest)` from `assertOwnsWorkspace` passes through unchanged. WorkspaceDO's `NotFoundError` → `McpError(ErrorCode.InvalidParams, ...)` (`-32602`) at the tool boundary. Any other thrown `Error` → `McpError(ErrorCode.InternalError, ...)` (`-32603`) with sanitized message (no stack traces, no DB internals, no env values). Centralize in `packages/mcp-server/src/error-mapping.ts` or a wrapper function so all 5 tool handlers stay uniform.
- **Consent UI for v0.1**: Auto-approve for Russell's known OAuth subject (the one bootstrap-written into `ENGRAM_IDENTITIES`). A 1-page "Authorize Claude for Engram?" template can ship now or land in v0.2 — Phase 3's bias should be "v0.1 has zero UI surface".
- **MCP Inspector smoke test (MCP-09)**: Manual verification step documented in DEP-05 README is sufficient for v0.1. CI integration (`mcp-inspector --cli` against background `wrangler dev`) can land in v0.2 only if regressions appear.
- **Worker `Env` interface shape**: Phase 2 typed the DO constructor's env as `unknown`. Phase 3's `Env` interface (consumed by the Worker's `fetch` handler + by `McpAgent`) must include: `WORKSPACE: DurableObjectNamespace<WorkspaceDO>`, `MCP_OBJECT: DurableObjectNamespace<EngramMcp>`, `ENGRAM_IDENTITIES: KVNamespace`, plus whatever bindings `@cloudflare/workers-oauth-provider` requires (likely a KV for client/session state, an encryption secret). Use `wrangler types` regeneration to populate `worker-configuration.d.ts`.
- **Token expiry**: Reasonable defaults from `@cloudflare/workers-oauth-provider` (typically ~1h access + refresh). Don't tune until a real UX issue surfaces. mcp-remote handles refresh transparently.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP architecture (Engram-specific)

- `CLAUDE.md` §"Session DO vs Workspace DO" — Two-DO topology. Confirms the `EngramMcp` (session, ephemeral) + `WorkspaceDO` (durable, per-workspace) split. Both classes declared together in `wrangler.jsonc › migrations[].new_sqlite_classes`.
- `CLAUDE.md` §"MCP Tool Surface" — 9-tool surface map. v0.1 implements only 5 (`remember`, `recall`, `search`, `forget`, `ingest`). Tool descriptions and input shapes are spec.
- `CLAUDE.md` §"Universal Response Envelope" — `EngramResponse<T>` shape every tool's eventual return must conform to (TOL-06). Phase 3 schemas should accommodate this even though handlers are stubs.
- `CLAUDE.md` §"Auth Pattern" — JWT-per-workspace, stateless Worker layer, DO trusts workspace_id from Worker.

### Requirements + roadmap

- `.planning/REQUIREMENTS.md` §"MCP Server (MCP)" — MCP-01 through MCP-09 (acceptance criteria for each). Phase 3 owns MCP-01..06 + MCP-09 per ROADMAP. MCP-07 (McpError convention) and MCP-08 (response size budget) are referenced by D-05's error-mapping decision but their full coverage is Phase 4 (when real responses exist).
- `.planning/REQUIREMENTS.md` §"Deploy + Acceptance (DEP)" — DEP-02 (JWT issuance flow) wording updated by D-03 above. DEP-05 (setup README) gets an OAuth-flow section.
- `.planning/ROADMAP.md` §"Phase 3: MCP Server Scaffold" — 5 success criteria + 3 risk notes. The `agents` SDK pre-1.0 risk note (0.13.2 pin) means the MCP Inspector smoke is the canary.

### Phase 2 carry-forward (must read — Phase 3 depends on these)

- `.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md` §D-06 — Phase 2 did NOT modify `packages/mcp-server/wrangler.jsonc`. D-07 above resolves the forward-note.
- `.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md` §D-07 (informational) — explicitly tells Phase 3 to add the v2 migration entry; D-09 above honors this.
- `.planning/phases/02-workspacedo-sqlite/02-VERIFICATION.md` §STO-07 / MT-1 — defense-in-depth contract Phase 3 inherits. Tool handlers MUST pass `args.workspace_id: this.props.workspace_id` (JWT-derived); never accept caller-supplied workspace_id from tool input.
- `.planning/phases/02-workspacedo-sqlite/02-05-SUMMARY.md` — the 7 WorkspaceDO method signatures (all take `args: { workspace_id: string; ... }`) that Phase 3 tool handlers route to.
- `.planning/phases/02-workspacedo-sqlite/02-06-SUMMARY.md` — `assertOwnsWorkspace` guard semantics: fires when `this.ctx.id.name !== workspaceId`, throws `McpError(ErrorCode.InvalidRequest)`. Phase 3 tool handlers must respect the contract.

### Phase 1 toolchain (must read)

- `.planning/phases/01-foundation/01-CONTEXT.md` §D-07 — TS-source `exports` (no build step). D-06 above (schemas.ts) honors this. No `tsc` build, no `dist/`, no `zod-to-ts` pipeline.
- `.planning/phases/01-foundation/01-CONTEXT.md` §FND-08 — `lint:wrangler` enforces `new_sqlite_classes` correctness. D-09 above must pass this lint.
- `scripts/lint-wrangler.mjs` — FND-08 lint script; the v2 migration entry passes through it (good fixture: `wrangler.jsonc` after D-09 lands).
- `packages/mcp-server/wrangler.jsonc` — current Phase 1 stub; Phase 3 adds the v2 entry per D-09 and updates the deferred-to-Phase-3 JSDoc.

### External docs

- `@cloudflare/workers-oauth-provider` README + API reference — primary library; verify the `authorize` hook signature and how to set `props` from KV.
- `agents/mcp` `McpAgent` reference — confirm `this.props` typing, the `init()` lifecycle, and how tool registration works.
- `@modelcontextprotocol/sdk/types.js` — `McpError`, `ErrorCode.MethodNotFound`, `ErrorCode.InvalidParams`, `ErrorCode.InvalidRequest`, `ErrorCode.InternalError` constants.
- `jose` package (peer of `@cloudflare/workers-oauth-provider`) — JWT validation primitives if any custom validation is needed.
- MCP OAuth spec (2025-03-26 revision) — Resource Server pattern, `/.well-known/oauth-protected-resource` shape.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/mcp-server/src/index.ts` (Phase 1 stub) — already imports `McpAgent` from `agents/mcp` and `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. Already exports `EngramMcp extends McpAgent` skeleton with `server = new McpServer(...)` and no-op `init()`. Already re-exports `WorkspaceDO` from `@engram/workspace-do` so wrangler can bind it. Phase 3 replaces the body, keeps the structure.
- `packages/mcp-server/package.json` — `agents@^0.13.2`, `@modelcontextprotocol/sdk@^1.29.0`, `@engram/types@*`, `@engram/schema@*`, `@engram/workspace-do@*` already declared as deps. Phase 3 adds `@cloudflare/workers-oauth-provider` (latest), `zod` (peer of MCP SDK; check if already transitively present).
- `packages/mcp-server/wrangler.jsonc` — both DO bindings (`MCP_OBJECT` → `EngramMcp`, `WORKSPACE` → `WorkspaceDO`) already declared. Only the `migrations[].new_sqlite_classes` array needs the v2 entry per D-09.
- `@engram/workspace-do` exports the 7 typed query helpers as instance methods on `WorkspaceDO`. Phase 3 tool handlers call these via `getAgentByName(env.WORKSPACE, this.props.workspace_id).<method>({ workspace_id: this.props.workspace_id, ... })`. (When invoked from Phase 4; Phase 3 stubs throw before this call.)
- `@engram/types` canonical shapes (`Memory`, `MemoryEvent`, `Entity`, `EngramResponse<T>`, `Conflict`, `TimelineEvent`) — schema source for D-06's zod definitions.

### Established Patterns

- **TS-source / no build step** (Phase 1 D-07) — `packages/mcp-server/src/schemas.ts` and any new `.ts` file uses verbatim TypeScript with `verbatimModuleSyntax`. No build, no `dist/`.
- **Per-Worker `wrangler.jsonc`** (Phase 1 D-03) — Phase 3 stays in `packages/mcp-server/wrangler.jsonc`. No root wrangler config.
- **Strict TypeScript** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Zod schemas should infer types compatible with these flags.
- **DO method signature uniformity** (Phase 2 D-01 + Plan 02-05 contract) — every `WorkspaceDO` public method takes `args: { workspace_id: string; ... }`. Phase 3 tool handlers MUST construct args with `args.workspace_id: this.props.workspace_id`.
- **`assertOwnsWorkspace` guard** (Phase 2 STO-07) — fires on every WorkspaceDO method as the first line. Phase 3 tool handlers don't need to re-check workspace ownership; trust the DO. Just pass the right workspace_id.
- **Lint scripts mirror FND-08 pattern** (Phase 2 D-09) — if Phase 3 needs a new lint (e.g., for the OAuth metadata shape), follow `scripts/lint-wrangler.mjs` / `scripts/lint-blockconcurrency.mjs` structure: dual-mode, exit-code matrix 0/1/2, `[lint:NAME]` tag prefix, no new deps.

### Integration Points

- **`packages/mcp-server/src/index.ts`** — Phase 3 grows this from the Phase 1 stub. The `EngramMcp` class body gets the tool registrations + `init()` body. The default export becomes the route table that mounts: `McpAgent.serve("/mcp")` + OAuth provider routes + `/health` + `/`.
- **`packages/mcp-server/src/schemas.ts`** (NEW) — 5 zod input schemas exported individually + a single barrel re-export.
- **`packages/mcp-server/src/tools.ts`** (NEW, recommended) — 5 tool registrations grouped in one file, each throwing `McpError(MethodNotFound)`. `init()` in `EngramMcp` imports and calls a `registerTools(server)` function.
- **`packages/mcp-server/src/oauth.ts`** (NEW) — `@cloudflare/workers-oauth-provider` wiring + the `authorize` hook that reads `ENGRAM_IDENTITIES` KV and populates `props`. Exports the OAuth provider instance for the router to mount.
- **`packages/mcp-server/src/error-mapping.ts`** (NEW, optional but recommended for consistency) — single `mapToMcpError(err: unknown): McpError` function. Phase 4 imports it from every handler.
- **`packages/mcp-server/wrangler.jsonc`** — add the v2 migration entry per D-09. Add KV binding for `ENGRAM_IDENTITIES`. Add whatever bindings `@cloudflare/workers-oauth-provider` requires (likely a KV for OAuth state + encryption secret).
- **Cloudflare KV: `ENGRAM_IDENTITIES`** (NEW namespace) — bootstrap script writes Russell's mapping. `wrangler kv:namespace create ENGRAM_IDENTITIES` documented in DEP-05.
- **Cloudflare KV: OAuth provider state** (NEW namespace, name per library convention) — for OAuth session storage. Created in the same setup script.
- **`packages/mcp-server/worker-configuration.d.ts`** — regenerated by `wrangler types` after adding new bindings. Test infra (vitest pool) for Phase 3, if any, must read the updated `Env` shape.
- **DEP-05 README** — gets an "OAuth flow + mcp-remote setup" section. Documents the `npm run kv:bootstrap` script for `ENGRAM_IDENTITIES`. Documents the MCP Inspector smoke test.

</code_context>

<specifics>
## Specific Ideas

- The single-Worker hosting model (D-07) means `engram-mcp-server` is a one-stop deploy: `wrangler deploy` ships everything (MCP, OAuth AS, /health). No need for a separate `auth-worker` package in v0.1.
- The KV-backed identity map (D-04) is the right v0.1 compromise — schema doesn't change for v0.2/0.3, just KV entries get added. When Devon onboards, it's a `kv put` not a code change.
- The `MethodNotFound` stub error message MUST include the phase reference (e.g., "remember not implemented in Phase 3 — ships in Phase 4 (TOL-01)") so a developer triaging an Inspector error knows exactly where to look.
- Russell's first-token flow via `mcp-remote` makes for a clean DEP-03 acceptance test: Russell asks Claude to "remember a job posting", Claude calls `remember()`, the auth dance completes once, token is cached, next conversation works seamlessly. (Phase 4 makes the tool body real; Phase 3 just proves the auth + routing scaffolding.)

</specifics>

<deferred>
## Deferred Ideas

- **`/debug/*` endpoints** (e.g., `/debug/whoami`) — useful for development but too easy to ship a leak. Add in v0.2 with proper auth scoping if needed.
- **Real consent UI** — v0.1 auto-approves Russell's OAuth subject. v0.2 builds a proper "Authorize Claude for Engram?" page when Devon needs to grant access. The library supports this hook; we just don't implement the UI yet.
- **Token revocation flow** — defer to v0.2 unless mcp-remote requires it for the standard refresh cycle (it doesn't in current versions).
- **CI integration of MCP Inspector smoke** — manual verification in DEP-05 README is the v0.1 path. CI step (`mcp-inspector --cli` against background `wrangler dev`) lands in v0.2 only if regressions appear.
- **OAuth scopes / fine-grained tool authorization** — v0.1 is "if you have a valid JWT for workspace X, you can call all 5 tools". Per-tool scoping is a v0.3+ concern when team workspaces have read-only members.
- **Build-step zod generation** (`zod-to-ts` / `ts-to-zod`) — premature for v0.1; D-06 keeps hand-written schemas in `schemas.ts`.
- **Separate `engram-auth` Worker** — D-07 explicitly rejected; revisit only if auth load profile demands isolation.
- **Phase 4+ work**: TOL-01..05 (actual tool handler bodies), TOL-06 (EngramResponse envelope wiring), TOL-07 (cross-workspace penetration test — defense-in-depth verified once tools have real bodies), TOL-08 (Russell's job-search agent integration).
- **AI-* requirements** (Vectorize index creation, Workers AI calls, entity extraction) — Phase 5 territory entirely.
- **Triage Worker integration** — Phase 6 territory.

### Reviewed Todos (not folded)

None — `gsd-sdk query todo.match-phase 3` returned 0 matches.

</deferred>

---

*Phase: 03-mcp-server-scaffold*
*Context gathered: 2026-05-25*
