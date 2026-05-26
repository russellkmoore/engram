# Phase 3: MCP Server Scaffold — Research

**Researched:** 2026-05-25
**Domain:** Cloudflare Workers MCP server (`agents/mcp` McpAgent) + `@cloudflare/workers-oauth-provider` OAuth 2.1 Authorization Server, co-deployed in a single Worker. Streamable HTTP transport at `/mcp` with JWT-derived `props.{workspace_id, user_id}` routing to `WorkspaceDO` via `getAgentByName`.
**Confidence:** HIGH for SDK and library APIs (verified against installed `node_modules/`); MEDIUM for `mcp-remote` flow (community-maintained, behavior verified via README); MEDIUM for `props` re-validation across token refresh (no authoritative doc found — see Open Question 4).

## Summary

Phase 3 is a structural / wiring phase. **No business logic ships** — every tool handler throws `McpError(ErrorCode.MethodNotFound, ...)` with a phase-pinned message until Phase 4 fills bodies. But the structural decisions Phase 3 lands are load-bearing for the next 4 phases: the `EngramMcp extends McpAgent<Env, unknown, Props>` shape, the v2 wrangler migration declaring `EngramMcp` as a new SQLite-backed DO, the OAuthProvider configuration that mounts at the Worker root, the KV-backed identity map, and the zod input schemas live in `schemas.ts`. Getting these right is more about precision than research depth; getting them wrong creates rewrite debt that compounds.

Three findings are particularly load-bearing:

1. **`registerTool(name, config, cb)` auto-validates the zod schema before invoking the handler.** Verified against `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`: the `ToolCallback` type is `(args: ShapeOutput<Args>, extra) => ...` — `ShapeOutput<Args>` is the parsed/validated zod output. Stub handlers therefore receive already-validated args and **do not need to call `schema.parse(args)` manually**. This shapes D-05 — the stub body is literally `throw new McpError(ErrorCode.MethodNotFound, '...')`, no other code. Affects Phase 4 too: handlers there will operate on validated input and only need to add business logic.

2. **`getAgentByName(namespace, name)` returns `Promise<DurableObjectStub<T>>` — must `await`.** Verified against `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts`. The current `CLAUDE.md` snippet `"getAgentByName(env.WORKSPACE, this.props.workspace_id).<method>(...)"` is technically wrong (missing await on the stub resolution); the canonical form is `const stub = await getAgentByName(env.WORKSPACE, this.props.workspace_id); return stub.<method>(args);`. Phase 3's stubs throw before this call, but the import + signature + the awaited-stub helper should be Phase-4-ready so Phase 4 only fills bodies.

3. **OAuthProvider is the ENTIRE default export of the Worker.** The `OAuthProvider` instance has its own `fetch` and dispatches to `apiHandler` (the `McpAgent.serve("/mcp")` return) for authenticated routes and to `defaultHandler` for everything else (`/authorize`, `/health`, `/`, root). There is no second `export default { fetch }` — Phase 3 swaps the Phase 1 stub's `export default { fetch() }` for `export default new OAuthProvider({...})`. The `defaultHandler` is itself a standard Workers `ExportedHandler` object — that's where `/health` and `/` land.

**Primary recommendation:** Build Phase 3 as **6 files (4 new + 2 modified)**: `src/index.ts` (default export = OAuthProvider, hosts `EngramMcp` class, re-exports `WorkspaceDO`), `src/schemas.ts` (5 zod schemas), `src/tools.ts` (`registerTools(server)` registers all 5 stubs), `src/oauth.ts` (`defaultHandler` with `/authorize` + `/health` + `/`, calls `env.OAUTH_PROVIDER.completeAuthorization` with KV-derived props), `src/error-mapping.ts` (`mapToMcpError` for Phase 4 reuse). Modified: `wrangler.jsonc` (add v2 migration entry + `OAUTH_KV` + `ENGRAM_IDENTITIES` KV bindings + `COOKIE_ENCRYPTION_KEY` secret), `package.json` (add `@cloudflare/workers-oauth-provider@^0.7.0` + `zod@^4`). MCP Inspector smoke test against `wrangler dev`; vitest covers the auth-bypass dev mode, the props plumbing, and the zod-schema-shape contract.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth 2.1 Authorization Server (authorize/token/jwks/register) | API / Worker (root export) | KV (`OAUTH_KV`) | Cloudflare-provided library is the AS; KV stores the encrypted grant/token state |
| `/.well-known/oauth-protected-resource` | API / Worker (root export) | — | RFC 9728 advertises the AS to MCP clients; library emits this automatically when the AS endpoints are configured |
| MCP transport endpoint `/mcp` | API / Worker → `McpAgent` session DO (`EngramMcp`) | — | `agents/mcp` library owns this; each MCP session is one `EngramMcp` DO instance, hibernates between calls |
| JWT extraction → `this.props.{workspace_id, user_id}` | OAuthProvider runtime | — | Provider validates tokens and populates `ctx.props` for the `apiHandler`; never code we write |
| Tool registration (5 v0.1 verbs) | `EngramMcp.init()` inside session DO | `src/tools.ts` | `init()` runs once per DO cold-start; tools registered with zod schemas via `server.registerTool(...)` |
| Tool handler routing to per-workspace data | `EngramMcp` tool handler → `getAgentByName(env.WORKSPACE, this.props.workspace_id)` | `WorkspaceDO` | Tool handler reads `this.props.workspace_id` (NEVER tool input); awaits the workspace stub; calls one of the 7 typed methods |
| Identity map (sub → workspace_id, user_id) | Cloudflare KV (`ENGRAM_IDENTITIES`) | OAuth `/authorize` hook | KV read happens during `/authorize` (per-auth, not per-tool-call); props are JWT-encoded thereafter |
| Public health/info routes (`/health`, `/`) | `defaultHandler.fetch` (standard Worker handler) | — | These bypass the OAuth middleware because they're served before the API route match |
| MCP error transport (`McpError` JSON-RPC envelope) | `@modelcontextprotocol/sdk` | — | SDK serializes thrown `McpError`s as JSON-RPC error responses; no custom envelope needed |
| Schema validation of tool input | `McpServer.registerTool` (auto-runs zod `.parse`) | `src/schemas.ts` | SDK calls zod on incoming args before the handler; handlers receive `ShapeOutput<Args>` already-typed |

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** OAuth Resource Server pattern (MCP spec compliant). Worker validates JWTs; `/.well-known/oauth-protected-resource` advertises the AS.
- **D-02:** `@cloudflare/workers-oauth-provider` is the Authorization Server, co-deployed in the same Worker. Ships `/authorize`, `/token`, `/jwks`, `/register`, `/.well-known/oauth-protected-resource` out of the box.
- **D-03:** Full OAuth dance via `mcp-remote` for first-token issuance. Russell adds `mcp-remote https://engram-mcp.workers.dev/mcp` to Claude Desktop config; first call opens browser. **Updates DEP-02** from "JWT issued via script" → "documented OAuth flow via `mcp-remote` + Claude Desktop config snippet".
- **D-04:** Dynamic props from Cloudflare KV. Namespace `ENGRAM_IDENTITIES` maps OAuth subject (`sub` claim) → `{ workspace_id: string, user_id: string }`. v0.1 bootstrap script writes one entry for Russell.
- **D-05:** Stub handlers throw `new McpError(ErrorCode.MethodNotFound, '<tool> not implemented in Phase 3 — ships in Phase 4 (TOL-0N)')`. All 5 tools registered with real names + zod schemas.
- **D-06:** Zod input schemas live in `packages/mcp-server/src/schemas.ts`. No build-step generation. TS-source / no-build posture honored.
- **D-07:** OAuth AS endpoints co-located with MCP. Single Worker hosts `/mcp` + `/authorize` + `/token` + `/jwks` + `/register` + `/.well-known/oauth-protected-resource`.
- **D-08:** Additional public routes: `/health` (uptime + `{ status: 'ok', version, commit, timestamp }`, no auth) AND `/` (root project info JSON, no auth). `/debug/*` deferred.
- **D-09:** Phase 3 adds `{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }` to `packages/mcp-server/wrangler.jsonc › migrations[]`. Acceptance: `npm run lint:wrangler` exits 0 + `wrangler deploy --dry-run` accepts the migration + the JSDoc comment in Phase 1's wrangler.jsonc lines documenting "deferred to v2" is updated/removed.

### Claude's Discretion

- **Error mapping convention** (Phase 4 will reference): WorkspaceDO's `McpError(-32600 InvalidRequest)` passes through unchanged. `NotFoundError` → `McpError(ErrorCode.InvalidParams, ...)` (`-32602`) at the tool boundary. Any other `Error` → `McpError(ErrorCode.InternalError, ...)` (`-32603`) with sanitized message. Centralize in `packages/mcp-server/src/error-mapping.ts`.
- **Consent UI for v0.1:** Auto-approve for Russell's known OAuth subject (bootstrap-written into `ENGRAM_IDENTITIES`). v0.1 bias = "zero UI surface".
- **MCP Inspector smoke test (MCP-09):** Manual verification in DEP-05 README is sufficient for v0.1. CI integration deferred to v0.2.
- **Worker `Env` interface shape:** Must include `WORKSPACE: DurableObjectNamespace<WorkspaceDO>`, `MCP_OBJECT: DurableObjectNamespace<EngramMcp>`, `ENGRAM_IDENTITIES: KVNamespace`, plus library-required bindings (`OAUTH_KV` KV, encryption secret). Use `wrangler types` to populate `worker-configuration.d.ts`.
- **Token expiry:** Library defaults (~1h access + ~30d refresh per RFC defaults). Don't tune until UX issue surfaces.

### Deferred Ideas (OUT OF SCOPE)

- `/debug/*` endpoints — v0.2 with proper auth scoping.
- Real consent UI — v0.2 when Devon needs to grant access.
- Token revocation flow — defer to v0.2.
- CI integration of MCP Inspector smoke — manual in DEP-05 for v0.1.
- OAuth scopes / fine-grained tool authorization — v0.3+ when team workspaces need read-only members.
- Build-step zod generation (`zod-to-ts` / `ts-to-zod`) — premature.
- Separate `engram-auth` Worker — D-07 explicit rejection.
- Phase 4+ work: TOL-01..05 (real tool bodies), TOL-06 (`EngramResponse` envelope wiring), TOL-07 (cross-workspace penetration test).
- AI-* requirements (Vectorize, Workers AI calls) — Phase 5.
- Triage Worker integration — Phase 6.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | `packages/mcp-server/` uses `agents/mcp` `McpAgent` (^0.13.2), not raw SDK HTTP transport | Standard Stack pins `agents@^0.13.2`; Pattern 1 shows `import { McpAgent } from "agents/mcp"`; ServeOptions and Hibernation sections explain why raw transports break workerd |
| MCP-02 | Worker exports `EngramMcp extends McpAgent` served at `/mcp` via `McpAgent.serve("/mcp")` | Verified signature against installed `node_modules/agents/dist/.../McpAgent` class; Pattern 2 shows the canonical `serve("/mcp", { binding: "MCP_OBJECT" })` call inside OAuthProvider `apiHandler` |
| MCP-03 | wrangler.jsonc declares BOTH DO classes under `new_sqlite_classes` (`EngramMcp` + `WorkspaceDO`) | Pattern 6 shows the v2 migration entry; D-09 ratifies the exact JSON shape; `scripts/lint-wrangler.mjs` validation flow documented |
| MCP-04 | JWT validation middleware extracts `workspace_id` + `user_id` into `this.props` | Pattern 3 shows the `defaultHandler.fetch('/authorize')` calling `env.OAUTH_PROVIDER.completeAuthorization({ props: { workspace_id, user_id } })` after KV lookup; Common Pitfall 2 covers the props-flow chain |
| MCP-05 | Tool handlers route to `WorkspaceDO` via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` | Pattern 5 shows the canonical (awaited!) stub resolution + the args-passing rule (`args.workspace_id: this.props.workspace_id`, NEVER from tool input) |
| MCP-06 | All five v0.1 tools registered with zod input schemas | Pattern 4 shows the `registerTool(name, { inputSchema }, cb)` shape; schemas.ts file is the single source per D-06; all 5 schemas listed in Code Examples |
| MCP-09 | MCP Inspector connects to local `wrangler dev` and lists all 5 tools | Pattern 7 + Pitfall 5 cover the auth-bypass dev shortcut needed for the smoke test; Validation Architecture documents the smoke as a manual sampling-rate-of-1 check |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `agents` (`/mcp` subpath) | `^0.13.2` [VERIFIED: npm registry, published 2026-05-21] | `McpAgent` base class — session DO, hibernation, props plumbing, transport mounting | Cloudflare's official MCP agent SDK; the alternative (raw `@modelcontextprotocol/sdk` HTTP transports) imports `node:http` and breaks under workerd. Phase 1 already pinned `^0.13.2` in `packages/mcp-server/package.json` |
| `@modelcontextprotocol/sdk` | `^1.29.0` [VERIFIED: npm registry] | `McpServer`, `McpError`, `ErrorCode` enum, JSON-RPC framing | Official MCP TypeScript SDK; required dependency of `agents`; provides the error code constants and the tool registration API |
| `@cloudflare/workers-oauth-provider` | `^0.7.0` [VERIFIED: npm registry, published 2026-05-21] | OAuth 2.1 Authorization Server (RFC 6749 + RFC 7591 dynamic registration + RFC 9728 protected resource metadata + PKCE) | Cloudflare-maintained; emits all 5 standard endpoints automatically; integrates with `McpAgent.serve()` via `apiHandler` config option |
| `zod` | `^4.0.0` [VERIFIED: npm registry, current 4.4.3] | Tool input schema definition + automatic validation | MCP SDK uses zod internally via Standard Schema interface; the SDK's `registerTool` callback receives already-`.parse()`-validated args |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `mcp-remote` | `^0.1.38` [VERIFIED: npm registry — runs via `npx` only, not a Worker dep] | Local proxy for Claude Desktop to talk to a remote OAuth-authenticated MCP server | Documented in DEP-05 README only — not installed in the project; Russell invokes via `npx mcp-remote` from Claude Desktop config |
| `@modelcontextprotocol/inspector` | `^0.1.0` [VERIFIED: npm registry — runs via `npx` only] | MCP Inspector UI for the MCP-09 smoke test | Documented in DEP-05 README as the manual verification step; not a project dep |
| `jose` | indirect | JWT validation primitives | Not directly used — `workers-oauth-provider` handles JWT signing/validation internally. Only add as a direct dep if Phase 4+ needs custom JWT inspection |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `McpAgent` (stateful) from `agents/mcp` | `createMcpHandler()` (stateless) from same package | `createMcpHandler` is simpler and does not require Durable Objects, but loses per-session state (hibernation, future state persistence). CONTEXT.md D-02 already commits to two-DO topology; staying with `McpAgent` matches the architectural decision and preserves the option for Phase 4+ to persist session state if needed |
| `McpAgent.serve("/mcp")` (Streamable HTTP, default) | `McpAgent.serveSSE("/mcp")` (legacy SSE) | SSE is **deprecated** per the MCP spec (March 2025) in favor of Streamable HTTP. `mcp-remote` supports both via the `http-first` default — tries HTTP, falls back to SSE on 404. Use `serve()` only |
| `@cloudflare/workers-oauth-provider` | External OAuth provider (Auth0, WorkOS, Stytch) | Cost (managed providers ~$25-100/mo); deploy complexity (two services); external dependency for v0.1 single-user. D-02 explicitly rejects external providers |
| Hand-rolled `/.well-known/oauth-protected-resource` | Library-emitted (RFC 9728 compliant) | Library emits this automatically when `authorizeEndpoint` and `tokenEndpoint` are configured; hand-rolling is ~50 lines of avoidable JSON-shape boilerplate |

**Installation:**

```bash
npm install --workspace @engram/mcp-server @cloudflare/workers-oauth-provider@^0.7.0 zod@^4
```

`agents@^0.13.2` and `@modelcontextprotocol/sdk@^1.29.0` are already declared in `packages/mcp-server/package.json` (Phase 1 stub).

**Version verification (run during planning):**

```bash
npm view agents version          # → 0.13.2 (2026-05-21)
npm view @cloudflare/workers-oauth-provider version  # → 0.7.0 (2026-05-21)
npm view @modelcontextprotocol/sdk version           # → 1.29.0
npm view zod version              # → 4.4.3 (use ^4.0.0)
npm view mcp-remote version       # → 0.1.38
npm view @modelcontextprotocol/inspector version     # → 0.21.2
```

All six versions confirmed against the live npm registry on 2026-05-25.

## Package Legitimacy Audit

slopcheck (v0.6.1) ran on all 6 packages. All received `[OK]` verdict. Cross-ecosystem verification via `npm view` confirms all packages exist on the correct ecosystem (npm).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `agents` | npm | 281 releases, latest 2026-05-21 | high (Cloudflare-published) | github.com/cloudflare/agents | [OK] | Approved (already in package.json) |
| `@cloudflare/workers-oauth-provider` | npm | 20 releases, latest 2026-05-21 | high (Cloudflare-published) | github.com/cloudflare/workers-oauth-provider | [OK] | Approved — add to deps |
| `@modelcontextprotocol/sdk` | npm | many releases, latest 1.29.0 | very high | github.com/modelcontextprotocol/typescript-sdk | [OK] | Approved (already in package.json) |
| `zod` | npm | mature library, current 4.4.3 | very high | github.com/colinhacks/zod | [OK] | Approved — add to deps (peer of MCP SDK) |
| `mcp-remote` | npm | 0.1.38 (active development) | medium-high (popular for Claude Desktop) | github.com/geelen/mcp-remote | [OK] | Approved (documented in README only; not installed) |
| `@modelcontextprotocol/inspector` | npm | 0.21.2 | high | github.com/modelcontextprotocol/inspector | [OK] | Approved (`npx`-invoked, not installed) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Postinstall script check (Node.js phase):** Not run on the recommended deps because none of them are project-novel (all 4 production deps are Cloudflare- or MCP-official, with millions of downloads and active GitHub repositories). Phase 4+ will add `gpt-tokenizer` for MCP-08 token budget assertions; that check is deferred to Phase 4's research.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Claude Desktop                                       │
│                                                                              │
│   claude_desktop_config.json:                                                │
│   { "mcpServers": { "engram":                                                │
│     { "command": "npx",                                                      │
│       "args": ["mcp-remote", "https://engram-mcp.workers.dev/mcp"] } } }     │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               mcp-remote (npx, local proxy)                                  │
│                                                                              │
│   - On first call: opens browser to /authorize (port 3334 callback)          │
│   - Streamable HTTP transport (http-first; falls back to SSE on 404)         │
│   - Caches JWT in ~/.mcp-auth/                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │  HTTPS (Bearer JWT after first auth)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  engram-mcp-server Worker (single Cloudflare Worker, one deploy)             │
│                                                                              │
│  default export = new OAuthProvider({                                        │
│    apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }),           │
│    defaultHandler: <fetch handler below>,                                    │
│    authorizeEndpoint: "/authorize", tokenEndpoint: "/token",                 │
│    clientRegistrationEndpoint: "/register",                                  │
│  })                                                                          │
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  OAuthProvider routes            │  │  defaultHandler.fetch()          │ │
│  │  (library handles automatically) │  │  (everything else)               │ │
│  │                                  │  │                                  │ │
│  │  /token        → token exchange  │  │  /authorize  → consent + KV      │ │
│  │  /jwks         → public keys     │  │              lookup + props      │ │
│  │  /register     → RFC 7591 DCR    │  │              + completeAuth()    │ │
│  │  /.well-known/oauth-protected-   │  │  /health     → JSON status       │ │
│  │     resource → RFC 9728 metadata │  │  /           → project info      │ │
│  │  /mcp         → apiHandler →     │  │  *           → 404               │ │
│  │                 EngramMcp.serve  │  │                                  │ │
│  └──────────────────────────────────┘  └──────────────────────────────────┘ │
│                       │                              │                       │
│                       │ (only after JWT valid)       │ (KV lookup once       │
│                       │                              │  per /authorize)      │
│                       ▼                              ▼                       │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  EngramMcp (Durable Object,      │  │  ENGRAM_IDENTITIES (KV)          │ │
│  │  one instance per MCP session,   │  │  key: oauth `sub` claim          │ │
│  │  hibernates)                     │  │  value: { workspace_id,          │ │
│  │                                  │  │           user_id }              │ │
│  │  this.props = { workspace_id,    │  └──────────────────────────────────┘ │
│  │                 user_id }        │                                       │
│  │  init():                         │  ┌──────────────────────────────────┐ │
│  │    registerTools(this.server)    │  │  OAUTH_KV (KV)                   │ │
│  │      // 5 stubs, all throw       │  │  library-owned;                  │ │
│  │      // McpError(MethodNotFound) │  │  stores grants + tokens          │ │
│  │                                  │  │  (encrypted)                     │ │
│  │  Tool handler shape (Phase 4):   │  └──────────────────────────────────┘ │
│  │    1. validate via zod (auto)    │                                       │
│  │    2. stub = await               │                                       │
│  │       getAgentByName(            │                                       │
│  │         env.WORKSPACE,           │                                       │
│  │         this.props.workspace_id) │                                       │
│  │    3. result = await             │                                       │
│  │       stub.<method>({            │                                       │
│  │         workspace_id:            │                                       │
│  │           this.props.workspace_id│                                       │
│  │         ...args })               │                                       │
│  │    4. wrap in EngramResponse<T>  │                                       │
│  └──────────────────────────────────┘                                       │
│                       │                                                      │
│                       │ (Phase 4+: stub.<method> calls)                      │
│                       ▼                                                      │
│  ┌──────────────────────────────────┐                                       │
│  │  WorkspaceDO (Durable Object,    │                                       │
│  │  one per workspace, durable,     │                                       │
│  │  SQLite-backed)                  │                                       │
│  │                                  │                                       │
│  │  assertOwnsWorkspace fires first │                                       │
│  │  on every public method          │                                       │
│  │  (Phase 2 invariant)             │                                       │
│  └──────────────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/mcp-server/
├── src/
│   ├── index.ts            # MODIFY: default export = OAuthProvider; declares EngramMcp class; re-exports WorkspaceDO
│   ├── schemas.ts          # NEW: 5 zod input schemas (RememberInputSchema, RecallInputSchema, SearchInputSchema, ForgetInputSchema, IngestInputSchema)
│   ├── tools.ts            # NEW: registerTools(server) registers all 5 tools as stubs throwing McpError(MethodNotFound)
│   ├── oauth.ts            # NEW: defaultHandler with fetch() handling /authorize, /health, /
│   ├── error-mapping.ts    # NEW: mapToMcpError(err: unknown): McpError (used by Phase 4)
│   └── __tests__/          # NEW: vitest tests for what's testable WITHOUT a real OAuth dance
│       ├── tools.test.ts          # zod schema shape assertions, defense-in-depth contract (workspace_id NOT in any schema)
│       ├── stub-handlers.test.ts  # all 5 stubs throw McpError(MethodNotFound) with phase-pinned messages
│       └── oauth.test.ts          # KV-lookup contract: oauth.ts pulls props from ENGRAM_IDENTITIES correctly
├── wrangler.jsonc          # MODIFY: add v2 migration entry; add OAUTH_KV + ENGRAM_IDENTITIES KV bindings; add COOKIE_ENCRYPTION_KEY secret declaration
├── wrangler.test.jsonc     # NEW: mirrors workspace-do/wrangler.test.jsonc — test-pool config; lint glob skips it
├── vitest.config.ts        # NEW: vitest config mirroring workspace-do's; @cloudflare/vitest-pool-workers
├── package.json            # MODIFY: add @cloudflare/workers-oauth-provider, zod; add test scripts
└── worker-configuration.d.ts  # REGEN: wrangler types after adding new bindings
```

### Pattern 1: `EngramMcp extends McpAgent` skeleton

**What:** The session-level Durable Object that owns one MCP client connection. `McpAgent` handles hibernation, transport, and props plumbing; we override `server`, `init()`, and rely on `this.props` being populated by the OAuthProvider.
**When to use:** Every MCP Worker that needs per-session state. Phase 4 may extend this with tool-handler bodies; Phase 3 only registers stubs.
**Example:**

```typescript
// packages/mcp-server/src/index.ts
// Source: VERIFIED against node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./tools.js";

// EngramProps: shape of this.props after OAuth completes.
// Set by oauth.ts → env.OAUTH_PROVIDER.completeAuthorization({ props: { workspace_id, user_id } }).
export interface EngramProps extends Record<string, unknown> {
  workspace_id: string;
  user_id: string;
}

export class EngramMcp extends McpAgent<Env, unknown, EngramProps> {
  // Required abstract member. `agents/mcp` allows MaybePromise<McpServer | Server> here.
  server = new McpServer({
    name: "engram-mcp-server",
    version: "0.1.0",
  });

  async init(): Promise<void> {
    registerTools(this.server, () => this.props, this.env);
  }
}

// Re-export WorkspaceDO so wrangler can bind the WORKSPACE namespace from this script.
export { WorkspaceDO } from "@engram/workspace-do";
```

### Pattern 2: OAuthProvider wraps the Worker (default export)

**What:** The `OAuthProvider` instance IS the Worker's `default export`. It dispatches: `apiHandler` for `/mcp` (after JWT validation), `defaultHandler` for everything else.
**When to use:** Phase 3 — single Worker hosts both AS and MCP (D-07).
**Example:**

```typescript
// packages/mcp-server/src/index.ts (continued)
// Source: VERIFIED against node_modules/@cloudflare/workers-oauth-provider/.../OAuthProvider
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { defaultHandler } from "./oauth.js";

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }),
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // Library emits /.well-known/oauth-protected-resource automatically.
  // Library emits /.well-known/oauth-authorization-server automatically (RFC 8414).
  // Library emits /jwks via tokenEndpoint metadata.
  // Defaults: accessTokenTTL=3600s, refreshTokenTTL=2592000s (30d).
});
```

### Pattern 3: `defaultHandler` with `/authorize` + `/health` + `/`

**What:** Standard Workers `ExportedHandler`. Handles the consent UI step of the OAuth flow (resolves the `sub` claim to props via KV) and serves the two public routes.
**When to use:** The `/authorize` flow MUST call `env.OAUTH_PROVIDER.parseAuthRequest` + `lookupClient` + `completeAuthorization({ props })`. The props passed here are what eventually populate `this.props` on the `EngramMcp` instance.
**Example:**

```typescript
// packages/mcp-server/src/oauth.ts
// Source: VERIFIED against workers-oauth-provider README defaultHandler example
import type { ExportedHandler } from "@cloudflare/workers-types";

// Env interface — wrangler types regenerates worker-configuration.d.ts with this shape
// after the new bindings land in wrangler.jsonc. OAUTH_PROVIDER is library-injected
// during request dispatch (it's the same instance constructed at default export).
interface Env {
  WORKSPACE: DurableObjectNamespace; // typed <WorkspaceDO> by wrangler types
  MCP_OBJECT: DurableObjectNamespace; // typed <EngramMcp> by wrangler types
  ENGRAM_IDENTITIES: KVNamespace;
  OAUTH_KV: KVNamespace; // library-owned, used by OAuthProvider internally
  OAUTH_PROVIDER: OAuthHelpers; // library-injected at runtime
  COOKIE_ENCRYPTION_KEY: string; // wrangler secret
}

interface IdentityRecord {
  workspace_id: string;
  user_id: string;
}

export const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    // ---- Public routes (D-08) ----------------------------------------------
    if (url.pathname === "/") {
      return Response.json({
        name: "engram-mcp-server",
        version: "0.1.0",
        mcp: "/mcp",
        oauth: "/.well-known/oauth-protected-resource",
        docs: "https://github.com/<org>/engram",
      });
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        version: "0.1.0",
        commit: "<commit-sha>", // injected via wrangler vars at deploy or read at build
        timestamp: Date.now(),
      });
    }

    // ---- OAuth authorize flow (D-04 KV lookup + completeAuthorization) -----
    if (url.pathname === "/authorize") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);

      // v0.1: single-user auto-approve. The `sub` claim is the OAuth subject
      // — for v0.1 it's a fixed value we bootstrap in KV. v0.2 will replace this
      // block with a real login + consent UI.
      const sub = oauthReqInfo.clientId; // v0.1 simplification — see Open Question 3
      const raw = await env.ENGRAM_IDENTITIES.get(sub);
      if (raw === null) {
        return new Response(
          `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.`,
          { status: 403 },
        );
      }
      const identity = JSON.parse(raw) as IdentityRecord;

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: identity.user_id,
        metadata: { label: "engram-v0.1" },
        scope: ["mcp:tools"],
        props: {
          workspace_id: identity.workspace_id,
          user_id: identity.user_id,
        },
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

### Pattern 4: Tool registration with zod schema (auto-validated)

**What:** `server.registerTool(name, { inputSchema }, cb)` is the current API. The SDK auto-runs `inputSchema.parse(args)` BEFORE invoking the callback — meaning handlers receive `ShapeOutput<Args>` (typed, validated), and Phase 3's stubs do not need to call `schema.parse` manually.
**When to use:** All 5 v0.1 tools register identically. Stub handler body is exactly one line: `throw new McpError(ErrorCode.MethodNotFound, ...)`.
**Example:**

```typescript
// packages/mcp-server/src/tools.ts
// Source: VERIFIED against node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts
//         (ToolCallback type signature confirms args are pre-validated ShapeOutput<Args>)
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  RememberInputSchema,
  RecallInputSchema,
  SearchInputSchema,
  ForgetInputSchema,
  IngestInputSchema,
} from "./schemas.js";
import type { EngramProps } from "./index.js";

// Note: `getProps` is a function (not the value) because props can be re-bound
// across token refreshes. See Open Question 4.
export function registerTools(
  server: McpServer,
  getProps: () => EngramProps | undefined,
  _env: Env,
): void {
  // remember(content, type?, project?, tags?, source?, expires?)
  server.registerTool(
    "remember",
    {
      description:
        "Store a memory in the user's workspace. Returns the stored memory with classified type, extracted fields, and detected conflicts.",
      inputSchema: RememberInputSchema.shape,
    },
    async (_args, _extra) => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "remember not implemented in Phase 3 — ships in Phase 4 (TOL-01)",
      );
    },
  );

  // recall(query, types?, project?, scope?, limit?, since?, until?)
  server.registerTool(
    "recall",
    {
      description: "Semantic search of memories with synthesis and related context.",
      inputSchema: RecallInputSchema.shape,
    },
    async () => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "recall not implemented in Phase 3 — ships in Phase 4 (TOL-02)",
      );
    },
  );

  // search(query, filters)
  server.registerTool(
    "search",
    {
      description: "Structured filter-based search of memories.",
      inputSchema: SearchInputSchema.shape,
    },
    async () => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "search not implemented in Phase 3 — ships in Phase 4 (TOL-03)",
      );
    },
  );

  // forget(id, cascade?)
  server.registerTool(
    "forget",
    {
      description: "Delete a memory and optionally its related memories.",
      inputSchema: ForgetInputSchema.shape,
    },
    async () => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "forget not implemented in Phase 3 — ships in Phase 4 (TOL-04)",
      );
    },
  );

  // ingest(source, type?, project?, priority?, threshold?)
  server.registerTool(
    "ingest",
    {
      description: "Queue an external content source for async enrichment.",
      inputSchema: IngestInputSchema.shape,
    },
    async () => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "ingest not implemented in Phase 3 — ships in Phase 4 (TOL-05)",
      );
    },
  );

  // Reference getProps so a future Phase 4 implementation has the callable
  // available; suppresses unused-var lint until then.
  void getProps;
}
```

### Pattern 5: Phase-4-ready tool handler shape (NOT executed by Phase 3 stubs)

**What:** This is the body Phase 4 will substitute into the stubs. Phase 3 leaves the stubs throwing, but the IMPORTS and helpers are wired so Phase 4 only needs to swap each handler body. The defense-in-depth contract (MCP-05) is encoded here: `args.workspace_id: this.props.workspace_id`, NEVER from tool input.
**When to use:** Documented in tools.ts as a comment block above the stub registrations. Phase 4 plans literally diff against this shape.
**Example:**

```typescript
// Documented above the stubs in tools.ts.
// Source: VERIFIED against node_modules/agents/dist/.../getAgentByName signature
//         (returns Promise<DurableObjectStub<T>> — MUST be awaited)
//
// Phase-4-ready handler shape for `remember` (others mirror this):
//
//   async (args, _extra) => {
//     const props = getProps();
//     if (props === undefined) {
//       throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context");
//     }
//     try {
//       const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
//       stub.insertBlock({
//         workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args
//         block: { ...derived from args... },
//       });
//       return { content: [{ type: "text", text: "..." }] };
//     } catch (err) {
//       throw mapToMcpError(err);  // src/error-mapping.ts
//     }
//   }
```

### Pattern 6: `wrangler.jsonc` v2 migration (D-09)

**What:** Append the v2 migration entry. `migrations` is append-only — never modify v1, never remove `WorkspaceDO`. The Phase 1 JSDoc comment ("deferred to v2") MUST be updated/removed per D-09 acceptance.
**When to use:** Single edit in Phase 3. `scripts/lint-wrangler.mjs` validates the new array passes through unchanged (it only forbids the `new_classes` key — `new_sqlite_classes` is the required form).
**Example:**

```jsonc
// packages/mcp-server/wrangler.jsonc — final state after Phase 3
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-mcp-server",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "EngramMcp" },
      { "name": "WORKSPACE", "class_name": "WorkspaceDO" },
    ],
  },
  "kv_namespaces": [
    { "binding": "OAUTH_KV", "id": "<id-from-wrangler-kv-namespace-create>" },
    { "binding": "ENGRAM_IDENTITIES", "id": "<id-from-wrangler-kv-namespace-create>" },
  ],
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["WorkspaceDO"],
    },
    {
      "tag": "v2",
      // Phase 3 adds EngramMcp as a SQLite-backed session DO managed by McpAgent.
      // Phase 1's "deferred to v2" comment on the v1 entry has been removed.
      "new_sqlite_classes": ["EngramMcp"],
    },
  ],
}
```

Note: `COOKIE_ENCRYPTION_KEY` is NOT declared in `wrangler.jsonc` — it's a `wrangler secret put` (documented in DEP-05). Including secret-shaped placeholders in committed JSONC is a leak vector; the OAuth provider reads it from `env.COOKIE_ENCRYPTION_KEY` at runtime.

### Pattern 7: MCP Inspector smoke test (MCP-09)

**What:** Manual verification step. Run inspector locally, point it at `wrangler dev`, complete the auth flow inline, click "List tools".
**When to use:** End of Phase 3 — Russell runs this once and screenshots/notes the 5 tool names appear.
**Example:**

```bash
# Terminal 1 — local Worker
cd packages/mcp-server
npm run dev  # wrangler dev on http://localhost:8787

# Terminal 2 — Inspector
npx @modelcontextprotocol/inspector
# → Opens http://localhost:5173/?MCP_PROXY_AUTH_TOKEN=...
# → Enter URL: http://localhost:8787/mcp
# → Click Connect
# → "Open Auth settings" → "Quick OAuth Flow" → completes against local /authorize
# → Click "List tools" → MUST show: remember, recall, search, forget, ingest
# → Click any tool → Returns McpError(-32601 MethodNotFound) with phase-pinned message
```

For the smoke to work end-to-end during local dev, the `ENGRAM_IDENTITIES` KV must have at least one entry. Two options:

1. **Bootstrap entry locally:** `npx wrangler kv key put --binding ENGRAM_IDENTITIES --local <sub> '{"workspace_id":"dev-ws","user_id":"dev-user"}'`
2. **`--remote` against the real KV** if the bootstrap entry is already there for production.

See Common Pitfall 5 for the chicken-and-egg around OAuth + Inspector.

### Anti-Patterns to Avoid

- **Hand-rolling Streamable HTTP transport.** The raw `@modelcontextprotocol/sdk/server/streamableHttp.js` transport imports `node:http` (deprecated in `agents/mcp`, see `node_modules/agents/dist/mcp/index.d.ts` `@deprecated` notes on `SSEEdgeClientTransport` / `StreamableHTTPEdgeClientTransport`). The `agents/mcp` `McpAgent.serve()` wraps a workerd-compatible transport internally. Never use raw SDK transports.

- **Passing tool input's `workspace_id` to WorkspaceDO methods.** The defense-in-depth contract (Phase 2 STO-07) fires `McpError(InvalidRequest)` when `ctx.id.name !== args.workspace_id`. The Worker layer MUST pass `this.props.workspace_id` from the JWT — never let user input override it. The zod schemas in `schemas.ts` MUST NOT include a `workspace_id` field — this is structurally enforced at the schema layer so a Phase 4 mistake fails to typecheck.

- **Returning ad-hoc `{ error: "..." }` envelopes from tool handlers.** Claude reads tool failures as data; an ad-hoc envelope creates "fake success with error text" semantics. MCP-07 requires `McpError` throws for every failure path. Phase 3 stubs already do this; Phase 4 handlers must too via `mapToMcpError`.

- **Including secrets in `wrangler.jsonc`.** `COOKIE_ENCRYPTION_KEY` is set via `wrangler secret put COOKIE_ENCRYPTION_KEY` and read from `env.*` at runtime. Never commit secret values to JSONC.

- **Calling `getAgentByName` without `await`.** It returns `Promise<DurableObjectStub<T>>`. The current `CLAUDE.md` example snippet drops the await — that's incorrect. The Phase 4-ready helper in `tools.ts` documents the awaited form so plan templates copy the right shape.

- **Forgetting to register a tool's description.** Phase 4 MCP-08 requires tool descriptions <1.5KB. Phase 3 should add the description at registration time even though the stubs throw — Phase 4 reuses the same `registerTool(name, config, cb)` call, just swaps the body.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth 2.1 Authorization Server (authorize/token/jwks/register endpoints) | Custom JWT signing + endpoint handlers | `@cloudflare/workers-oauth-provider` | RFC compliance (RFC 6749, 7591, 7636, 8414, 9728) is non-trivial; library handles PKCE, refresh tokens, JWKS rotation, dynamic client registration. ~2000 LOC of avoidable boilerplate |
| `/.well-known/oauth-protected-resource` JSON | Hand-written JSON response | OAuthProvider emits automatically | RFC 9728 mandates exact field shape (`resource`, `authorization_servers`, `scopes_supported`); library generates from the constructor config |
| MCP Streamable HTTP transport | Raw `WebStandardStreamableHTTPServerTransport` | `McpAgent.serve("/mcp")` | Transport is hibernation-aware in `McpAgent`; raw SDK transport breaks on workerd because of `node:http` dependency |
| JWT validation middleware | Custom `jose`-based validator | OAuthProvider does this before dispatching to `apiHandler` | Provider validates the bearer token, rejects malformed/expired tokens with proper 401 + WWW-Authenticate, and only invokes `apiHandler` after success |
| MCP error envelope serialization | Custom JSON-RPC error response | `throw new McpError(code, message)` | The SDK's tool dispatcher catches `McpError` and emits the correct JSON-RPC error response per spec |
| Zod schema runtime validation in tool handlers | `schema.parse(args)` inside handlers | `registerTool({ inputSchema }, cb)` | The SDK auto-validates; handler signature is typed `(args: ShapeOutput<Args>, extra)` |
| KV-backed identity lookup retry/cache | Custom KV cache with stale-while-revalidate | One KV `get` per `/authorize` call | KV reads are ~10ms on cache hit; auth flow is per-grant (rare), not per-request. Premature optimization for v0.1 |

**Key insight:** Phase 3 is structurally a "wire library outputs together" phase. The two libraries (`agents/mcp`, `@cloudflare/workers-oauth-provider`) are designed to interoperate — `apiHandler: McpAgent.serve(...)` IS the canonical integration pattern documented by Cloudflare. Any departure (custom transport, custom OAuth, custom KV layer) is rework debt that conflicts with the v0.2+ migration paths Cloudflare publishes.

## Common Pitfalls

### Pitfall 1: `getAgentByName` returns a Promise — must await

**What goes wrong:** Calling `getAgentByName(env.WORKSPACE, props.workspace_id).insertBlock(...)` without awaiting produces `[object Promise].insertBlock is not a function` at runtime — and TS may not catch it depending on how the binding is typed.
**Why it happens:** The current `CLAUDE.md` example and Phase 2 SUMMARY both elide the await for brevity. Phase 3 must NOT copy that shape; the helper in `tools.ts` should be wrapped in a util function that awaits.
**How to avoid:** Add a helper `async function getWorkspaceStub(env: Env, workspaceId: string)` returning `Promise<DurableObjectStub<WorkspaceDO>>` and document it in the Phase-4-ready comment block.
**Warning signs:** TS error `Property 'insertBlock' does not exist on type 'Promise<DurableObjectStub<WorkspaceDO>>'` when Phase 4 plans first write a handler body.

### Pitfall 2: props flow chain is fragile — one missed step and `this.props` is undefined

**What goes wrong:** Tool handler sees `this.props === undefined` and the `getAgentByName` call fails with "Cannot read 'workspace_id' of undefined".
**Why it happens:** Props flow is a 4-step chain:
1. `defaultHandler.fetch('/authorize')` reads `oauthReqInfo` via `env.OAUTH_PROVIDER.parseAuthRequest`
2. KV lookup yields `{ workspace_id, user_id }`
3. `env.OAUTH_PROVIDER.completeAuthorization({ props: { workspace_id, user_id } })` is called
4. On subsequent `/mcp` calls, library validates JWT and injects `ctx.props` — `McpAgent` exposes this as `this.props`
   Any step missed = props undefined. Especially common: forgetting step 3's `props:` field.
**How to avoid:** Add an `if (this.props === undefined) throw new McpError(InvalidRequest, ...)` guard at the top of the Phase 4 handler shape. For Phase 3 stubs, this guard is unnecessary (they throw MethodNotFound before reading props).
**Warning signs:** MCP Inspector says "tool listed but invocation throws 'Cannot read workspace_id of undefined'" — this is the props chain failure, not a tool body issue.

### Pitfall 3: Two DOs in one Worker = both must appear in migrations

**What goes wrong:** Wrangler deploy fails with "DO class 'EngramMcp' not declared in any migration" if v2 migration entry is missed.
**Why it happens:** D-09 explicit: Phase 1's v1 entry intentionally deferred EngramMcp to v2. Phase 3 must add it; the lint script (`scripts/lint-wrangler.mjs`) checks that `new_classes` is never used but does NOT verify a class is present in any migration — that's a wrangler runtime concern.
**How to avoid:** D-09 acceptance criteria: `npm run lint:wrangler` exits 0 AND `wrangler deploy --dry-run` accepts the v2 migration. The plan should add both gates.
**Warning signs:** `wrangler deploy --dry-run` returns an error mentioning `class_name` resolution; `wrangler dev` starts fine (less strict) — the gap means deploy is the canary.

### Pitfall 4: `apiRoute` and `defaultHandler` are mutually exclusive on `/mcp`

**What goes wrong:** A test of `/health` via the `OAuthProvider` works but `/mcp` is unauthenticated (or vice versa) because the route precedence is misunderstood.
**Why it happens:** `OAuthProvider` matches `apiRoute` (here `/mcp`) FIRST and routes those to `apiHandler` AFTER JWT validation. Everything else falls through to `defaultHandler`. There's no overlap — `/mcp` will never hit `defaultHandler`, and `/health` will never hit `apiHandler`.
**How to avoid:** Set `apiRoute: "/mcp"` (exact match per the library), not a wildcard. The well-known endpoints (`/token`, `/jwks`, `/.well-known/...`) are library-owned — neither `apiHandler` nor `defaultHandler` sees them.
**Warning signs:** Curl-ing `/health` returns "401 Unauthorized" — that means `apiRoute` is matching too greedily (e.g., set to `/` instead of `/mcp`).

### Pitfall 5: MCP Inspector + OAuth = chicken-and-egg locally

**What goes wrong:** `npx @modelcontextprotocol/inspector` against `wrangler dev`'s `/mcp` requires a valid JWT, but there's no easy way to get one without first walking the OAuth dance.
**Why it happens:** The OAuth dance requires a client to call `/authorize` with a `client_id` (RFC 7591 dynamic registration auto-registers). Inspector handles this via "Quick OAuth Flow", but it requires `ENGRAM_IDENTITIES` KV to have an entry for the OAuth subject Inspector uses.
**How to avoid (v0.1 workaround):** Two paths:
- **Path A (recommended):** Run `wrangler dev --remote` so KV reads hit production KV that already has the bootstrapped entry. Inspector's Quick OAuth Flow completes against the local `/authorize` which reads from real KV.
- **Path B (offline):** Pre-cache a JWT via `mcp-remote` once, then point Inspector at the cached endpoint. Brittle, do not document this in DEP-05.
**Warning signs:** Inspector hangs at "Connecting…" or shows "401" — KV entry missing for the dynamic-client `sub` claim.

### Pitfall 6: `agents` SDK is pre-1.0 (0.13.2) — minor versions may break

**What goes wrong:** Bumping `agents` from 0.13 → 0.14 silently changes the `McpAgent` props/serve API; Worker starts but tool invocations fail.
**Why it happens:** Confirmed via npm registry: `agents` has had 281 releases. Recent minors (0.10 → 0.11 → 0.12 → 0.13) introduced features (chat-sdk, sub-agents, Hyperdrive sessions) but also reverted MCP routing changes between 0.12 and 0.13 (release notes reference "Reverted HTTP server-to-client MCP routing change").
**How to avoid:** Pin exact version in `package.json` (`"agents": "0.13.2"` — not `^0.13.2`). Add an MCP Inspector smoke test on every `agents` bump. Track Cloudflare's changelog before any minor upgrade.
**Warning signs:** MCP Inspector tool listing changes shape or tool invocation errors with new error codes after a routine `npm update`.

### Pitfall 7: zod v4 vs v3 ambiguity for MCP SDK

**What goes wrong:** Tool registration TypeError because zod is the wrong major version for the SDK's expected Standard Schema interface.
**Why it happens:** Per WebSearch finding, `@modelcontextprotocol/sdk` uses zod v4 internally via Standard Schema but maintains backwards compatibility with zod v3.25+. Phase 3's `package.json` should declare `zod@^4.0.0` to align with the SDK's preferred version.
**How to avoid:** Install `zod@^4`. If a downstream package transitively depends on zod v3, npm workspaces will hoist correctly because both versions are SemVer-compatible at the type level via Standard Schema.
**Warning signs:** TS error `Type 'ZodObject<{...}, ...>' is not assignable to type 'ZodRawShapeCompat'` — usually means zod is v3 when v4 is expected.

### Pitfall 8: `EngramMcp` SQLite-backed DO declaration is irreversible

**What goes wrong:** Mistakenly using `new_classes` instead of `new_sqlite_classes` for `EngramMcp` in the v2 migration entry; later attempts to migrate to SQLite-backed are blocked by Cloudflare.
**Why it happens:** Cloudflare workers-sdk issue #9909 documents that KV-backed DOs cannot be retroactively converted to SQLite-backed.
**How to avoid:** Phase 1's `scripts/lint-wrangler.mjs` already enforces this — the lint runs on Phase 3's modified wrangler.jsonc and rejects `new_classes`. Plan must include the lint as a gate.
**Warning signs:** `npm run lint:wrangler` exits 1 with `migration[1] (tag: v2) declares new_classes=...` — fix immediately, don't deploy.

## Runtime State Inventory

> N/A — Phase 3 is a greenfield wiring phase (no rename / refactor / migration). All net-new code; the only modification is the wrangler.jsonc migration entry which is purely additive.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 3 introduces new data flows but creates no migrations of existing data | None |
| Live service config | Two new KV namespaces (`OAUTH_KV`, `ENGRAM_IDENTITIES`) — must be created via `wrangler kv namespace create` before deploy; one bootstrap entry written to `ENGRAM_IDENTITIES` | New KV setup script: `npm run kv:bootstrap` (documented in DEP-05) |
| OS-registered state | None — Cloudflare-only deploy | None |
| Secrets/env vars | One new secret: `COOKIE_ENCRYPTION_KEY` — must be set via `wrangler secret put` | Add to DEP-05 setup docs |
| Build artifacts | None — TS-source / no-build posture (D-07 from Phase 1) preserved | None |

**Phase 1 v1 wrangler.jsonc JSDoc:** The Phase 1 stub's JSDoc comment (lines 22-26 of `packages/mcp-server/wrangler.jsonc`) explicitly defers EngramMcp to v2 and references "REVIEW-FIX WR-06". Phase 3's D-09 acceptance requires this comment block be updated or removed — recommend removing entirely and adding a one-line `// v2 added EngramMcp (Phase 3)` next to the new migration entry.

## Code Examples

### Example 1: Zod schemas mirror canonical `MemoryEvent` / `Memory` shapes

```typescript
// packages/mcp-server/src/schemas.ts
// Source: D-06 — single source of truth for tool input shapes.
//         The zod schemas mirror @engram/types shapes where possible.
//
// CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
// NONE of these schemas declares a `workspace_id` field. The workspace
// is derived from the JWT's `this.props.workspace_id` at the handler level,
// NEVER from tool input. A future contributor adding `workspace_id` to any
// schema below is breaking the defense-in-depth invariant.

import { z } from "zod";

// remember(content, type?, project?, tags?, source?, expires?)
export const RememberInputSchema = z.object({
  content: z.string().min(1),
  type: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  expires: z.string().datetime().optional(),
});
export type RememberInput = z.infer<typeof RememberInputSchema>;

// recall(query, types?, project?, scope?, limit?, since?, until?)
export const RecallInputSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  project: z.string().optional(),
  scope: z.enum(["personal", "project", "org"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});
export type RecallInput = z.infer<typeof RecallInputSchema>;

// search(query, filters)
export const SearchInputSchema = z.object({
  query: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

// forget(id, cascade?)
export const ForgetInputSchema = z.object({
  id: z.string().min(1),
  cascade: z.boolean().optional(),
});
export type ForgetInput = z.infer<typeof ForgetInputSchema>;

// ingest(source, type?, project?, priority?, threshold?)
export const IngestInputSchema = z.object({
  source: z.string().min(1),
  type: z.string().optional(),
  project: z.string().optional(),
  priority: z.enum(["fast", "deep"]).optional(),
  threshold: z.number().min(0).max(1).optional(),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;
```

### Example 2: Error mapping helper (centralizes Phase 4 reuse)

```typescript
// packages/mcp-server/src/error-mapping.ts
// Source: CONTEXT.md Claude's Discretion — centralized error convention.
// Phase 4 tool handlers import mapToMcpError; Phase 3 ships the helper so the
// shape is settled.
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { NotFoundError } from "@engram/workspace-do";

export function mapToMcpError(err: unknown): McpError {
  // Pass through McpError unchanged (e.g., assertOwnsWorkspace's
  // McpError(InvalidRequest) from Phase 2 STO-07).
  if (err instanceof McpError) {
    return err;
  }

  // NotFoundError → InvalidParams (-32602): "the id you supplied doesn't exist"
  if (err instanceof NotFoundError) {
    return new McpError(ErrorCode.InvalidParams, err.message);
  }

  // Anything else → InternalError (-32603) with sanitized message.
  // Never leak stack traces, DB internals, or env values.
  const message = err instanceof Error ? err.message : "Internal error";
  return new McpError(ErrorCode.InternalError, sanitize(message));
}

function sanitize(message: string): string {
  // Strip patterns that could leak secrets or internal paths.
  // v0.1 conservative pass; tune if Phase 4 surfaces specific leak vectors.
  return message
    .replace(/\/Users\/[^\s]+/g, "<path>")
    .replace(/[a-f0-9]{32,}/g, "<hex>")
    .slice(0, 500);
}
```

### Example 3: Bootstrap script for ENGRAM_IDENTITIES KV (documented in DEP-05)

```bash
# scripts/kv-bootstrap.sh (or npm run kv:bootstrap)
# Source: D-04 — single-user v0.1 identity mapping.
#
# Prereq: KV namespaces already created via:
#   wrangler kv namespace create OAUTH_KV
#   wrangler kv namespace create ENGRAM_IDENTITIES
# IDs from those commands are pasted into wrangler.jsonc.
#
# Russell's OAuth subject (the `sub` claim mcp-remote sends after dynamic
# client registration completes) needs one KV entry mapping sub → workspace.

WORKSPACE_ID="rmoore-personal"
USER_ID="rmoore"
# `sub` value is determined by mcp-remote's first-call dynamic registration;
# document the discovery procedure in DEP-05 (run /authorize once, observe
# the sub claim, then put the entry, then retry).
SUB="<copy-from-first-authorize-attempt>"

npx wrangler kv key put \
  --binding ENGRAM_IDENTITIES \
  --remote \
  "$SUB" \
  "$(printf '{"workspace_id":"%s","user_id":"%s"}' "$WORKSPACE_ID" "$USER_ID")"
```

### Example 4: Claude Desktop config snippet (documented in DEP-05)

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://engram-mcp.<your-subdomain>.workers.dev/mcp"
      ]
    }
  }
}
```

For local dev against `wrangler dev`:

```json
{
  "mcpServers": {
    "engram-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8787/mcp"]
    }
  }
}
```

First connection opens a browser to `/authorize` (port 3334 callback); subsequent connections use cached JWT in `~/.mcp-auth/`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MCP SSE transport (`/sse`) | MCP Streamable HTTP (`/mcp`) | March 2025 (MCP spec revision) | `mcp-remote` supports both (http-first fallback); `McpAgent.serve()` is HTTP, `serveSSE()` is deprecated. Always use `serve()` for new code |
| Single-class DO migrations (`new_classes`) | SQLite-backed DOs (`new_sqlite_classes`) | Cloudflare 2024-2025 rollout | Phase 1's FND-08 lint enforces; once a class is declared with `new_classes`, conversion to SQLite-backed is **impossible** per Cloudflare workers-sdk #9909 |
| Raw `@modelcontextprotocol/sdk` HTTP transport | `agents/mcp` `McpAgent` wrapper | `agents@0.10+` (2025) | Raw SDK imports `node:http` which breaks workerd. `McpAgent` provides hibernation, DO session lifecycle, and props integration with OAuth provider |
| Hand-rolled `/.well-known/oauth-protected-resource` | RFC 9728 metadata emitted by `@cloudflare/workers-oauth-provider` | RFC 9728 published 2024 | Library generates the response from `authorizeEndpoint` + `tokenEndpoint` config — never hand-roll JSON shape |
| `McpServer.tool(name, schema, cb)` (multi-overload) | `McpServer.registerTool(name, config, cb)` (single signature) | MCP SDK 1.x deprecation | All `.tool()` overloads marked `@deprecated` in `node_modules/@modelcontextprotocol/sdk/dist/.../mcp.d.ts`. Use `registerTool` for new code |

**Deprecated/outdated:**

- **SSE transport for MCP:** Use Streamable HTTP. `serveSSE()` is for legacy client compat only.
- **`tool()` API on `McpServer`:** Use `registerTool()`. All overloads of `tool()` are marked `@deprecated`.
- **`SSEEdgeClientTransport` / `StreamableHTTPEdgeClientTransport` from `agents/mcp`:** Both marked `@deprecated` in the package's `.d.ts`; use SDK's transports if needed (but `McpAgent.serve` already handles transport internally).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `props` survive across MCP sessions when JWT is still valid; no per-tool-call JWT re-validation | Pitfall 6 / Open Question 4 | Tool calls after refresh might see stale props; remedy is to detect and call `await this.updateProps(props)` (an `updateProps` method IS exposed per d.ts — VERIFIED — but the trigger semantics aren't documented). If this assumption is wrong, Phase 4 needs a per-tool-call props check |
| A2 | `mcp-remote` handles token refresh transparently and `props` are re-injected on the next `/mcp` request | Pitfall 6 | If refresh doesn't re-inject props, a long-running Claude conversation would fail mid-session |
| A3 | `OAuthProvider`'s `apiRoute: "/mcp"` matches exactly that path (not a prefix) | Pattern 2 / Pitfall 4 | If it's a prefix match, `/mcp/anything` could leak unauthenticated. Verify with `wrangler dev` + curl before claiming "no overlap with defaultHandler" |
| A4 | The `sub` claim for `mcp-remote`'s dynamic-registered client is stable across token refreshes (not regenerated) | Example 3 / Pitfall 5 | If the `sub` changes on refresh, the KV bootstrap entry becomes stale and `/authorize` fails. Mitigation: KV bootstrap script writes after first observed `sub` |
| A5 | `wrangler types` regenerates `worker-configuration.d.ts` correctly after adding `kv_namespaces` and DO bindings | Pattern 6 | If types don't regen cleanly, vitest/typecheck would fail. Mitigation: documented in Phase 2 SUMMARY as a one-time worktree bootstrap step |
| A6 | `@cloudflare/workers-oauth-provider@0.7.0` is API-stable enough for v0.1 (pre-1.0 library) | Standard Stack | A 0.8 release with breaking changes could force a Phase 3 rewrite. Mitigation: pin exact version `0.7.0` in package.json (not `^0.7.0`) |
| A7 | `wrangler kv namespace create OAUTH_KV` returns an ID that can be pasted into wrangler.jsonc — no other library setup required | Pattern 6 / Example 3 | If the provider expects pre-seeded keys, bootstrap script needs more steps |

## Open Questions

1. **`OAuthProvider.apiRoute`: exact match or prefix match?**
   - What we know: README example sets `apiRoute: "/mcp"` and `apiHandler: MyMCP.serve("/mcp")` — symmetric paths.
   - What's unclear: Library source not deeply inspected; behavior under `/mcp/foo` undocumented.
   - Recommendation: Add a `wrangler dev` curl probe to the plan's verification steps — `curl http://localhost:8787/mcp/leaked` should return 404 or 401, never the apiHandler's response without auth.

2. **`/jwks` endpoint: emitted automatically?**
   - What we know: Library emits `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` automatically. README references `jwksUri` in metadata but doesn't explicitly say `/jwks` is a library-served route.
   - What's unclear: Is `jwksUri` in the AS metadata document a pointer to a library-served route, or do we need to mount our own?
   - Recommendation: Test during Wave 0 — curl the AS metadata, follow the `jwks_uri`, confirm it returns valid JWK Set JSON.

3. **`sub` claim source for v0.1 single-user auto-approve.**
   - What we know: D-04 says "OAuth subject (`sub` claim) → `{ workspace_id, user_id }`". The `sub` for an OAuth flow is set by the AS during authorization — in this case, our own library.
   - What's unclear: For `mcp-remote`'s dynamic-registered client, what value does `sub` take? Is it the dynamic `client_id`? A library default?
   - Recommendation: Wave 0 task — run the OAuth dance once manually, observe the `sub` value, document it in DEP-05.

4. **Props refresh: does `mcp-remote`'s token refresh re-trigger `/authorize` and re-inject props?**
   - What we know: `tokenExchangeCallback` is an OAuthProvider option that fires on refresh — `accessTokenProps` / `newProps` can be updated.
   - What's unclear: Without setting `tokenExchangeCallback`, do props persist verbatim across refresh? Or do they need to be re-fetched from KV on every refresh?
   - Recommendation: v0.1 — don't set `tokenExchangeCallback` (default: props persist). If Phase 4 observes stale props after refresh, add the callback to re-read KV.

5. **`EngramMcp` SQLite usage — do we need it?**
   - What we know: `McpAgent.sql` is exposed (per `node_modules/agents/dist/.../McpAgent` property list). The v2 migration declares `EngramMcp` SQLite-backed.
   - What's unclear: Phase 3's `EngramMcp` doesn't actually use `this.sql` — it's a thin session shell. Is SQLite-backed declaration still right, or should it be... non-SQLite-backed?
   - Recommendation: Declare SQLite-backed regardless. Phase 1's FND-08 lint requires `new_sqlite_classes`. Future phases may use `this.sql` for per-session caching (e.g., recall query expansion); the irreversibility of `new_classes` means we MUST start SQLite-backed.

6. **`mcp-remote` first-call `sub` discovery.**
   - What we know: First call opens browser to `/authorize`; library generates dynamic client; bootstrap KV entry needed.
   - What's unclear: The flow is "open browser → fail with 403 because KV entry doesn't exist → observe `sub` from logs → write KV → retry". This is painful for Russell's first-time setup.
   - Recommendation: DEP-05 documents this as a 2-step bootstrap: "First call will fail with 'Unknown OAuth subject'. Copy the subject from the error message, run `npm run kv:bootstrap -- --sub <value>`, retry." Or: v0.1 hard-codes a known `sub` in the bootstrap script if mcp-remote's dynamic client_id is deterministic for a given local install.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `npm` (workspace root) | Adding new deps | ✓ | 11.15.0 | — |
| `node` (workspace root) | Running scripts | ✓ | 22.14.0 | — |
| `wrangler` | `wrangler dev`, `wrangler kv namespace create`, `wrangler secret put`, `wrangler deploy --dry-run` | ✓ | Phase 1 installed | — |
| Cloudflare account + paid Workers plan | KV namespaces, DOs, deploy | ✓ (per project decisions) | — | — |
| `npx mcp-remote` | First-time JWT issuance from Claude Desktop | ✓ (npx-invoked, no install) | 0.1.38 [VERIFIED] | — |
| `npx @modelcontextprotocol/inspector` | MCP-09 smoke test | ✓ (npx-invoked, no install) | 0.21.2 [VERIFIED] | — |
| `slopcheck` | Package legitimacy check | ✓ | 0.6.1 [VERIFIED installed] | If absent: mark all packages [ASSUMED] |
| `@cloudflare/vitest-pool-workers` | Vitest tests | ✓ (already a devDep of `@engram/workspace-do`) | 0.16.9 | — |
| `gpt-tokenizer` (Phase 4 dep for MCP-08) | Out of scope for Phase 3 | — | — | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 with `@cloudflare/vitest-pool-workers@0.16.9` (matches Phase 2) |
| Config file | `packages/mcp-server/vitest.config.ts` (NEW — mirrors `packages/workspace-do/vitest.config.ts` structure) |
| Quick run command | `npm test --workspace @engram/mcp-server -- --run` |
| Full suite command | `npm test --workspaces -- --run` (runs workspace-do tests too, satisfying defense-in-depth full suite) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | `agents/mcp` McpAgent imported (not raw SDK transport) | unit (file-grep) | `grep -q 'from "agents/mcp"' packages/mcp-server/src/index.ts && ! grep -q '@modelcontextprotocol/sdk/server/streamableHttp' packages/mcp-server/src/index.ts` | Wave 0 |
| MCP-02 | `EngramMcp.serve("/mcp")` mounted via OAuthProvider apiHandler | unit (file-grep) | `grep -q 'EngramMcp.serve("/mcp"' packages/mcp-server/src/index.ts` | Wave 0 |
| MCP-03 | Both DO classes in `new_sqlite_classes` across v1 + v2 | lint + unit | `npm run lint:wrangler` AND a vitest assertion that parses wrangler.jsonc and confirms `migrations[0].new_sqlite_classes` contains `WorkspaceDO` and `migrations[1].new_sqlite_classes` contains `EngramMcp` | Wave 0 |
| MCP-04 | JWT validation populates `this.props` | integration (workerd pool) | Mock OAuthProvider's apiHandler entry: call `/mcp` with valid bearer (via env.OAUTH_PROVIDER stub) and assert `this.props.workspace_id === "test-ws"`; call with invalid bearer and assert 401 | Wave 0 |
| MCP-05 | Tool handlers route via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` | unit (file-grep + structural) | `grep -q 'getAgentByName' packages/mcp-server/src/tools.ts` AND assert NONE of the 5 zod schemas declares a `workspace_id` field (defense-in-depth contract) | Wave 0 |
| MCP-06 | All 5 tools registered with zod schemas | unit (workerd pool) | Instantiate `EngramMcp`, call `init()`, assert `server.listTools()` returns exactly `[remember, recall, search, forget, ingest]` with each having an `inputSchema` | Wave 0 |
| MCP-09 | MCP Inspector connects + lists 5 tools | manual smoke | `npx @modelcontextprotocol/inspector` against `wrangler dev`; visual check of tool list; documented screenshot in DEP-05 | manual |

### Defense-in-Depth Verification (carry-over from STO-07 contract)

| Behavior | Test Type | Approach |
|----------|-----------|----------|
| No zod schema declares `workspace_id` | unit (structural assertion) | Iterate all 5 schemas, assert `Object.keys(schema.shape).indexOf('workspace_id') === -1` |
| Tool handlers, when implemented, pass `props.workspace_id` to WorkspaceDO calls | contract (Phase-4-ready comment + grep) | Phase 3: comment block documenting the contract; grep for `args.workspace_id: this.props.workspace_id` returns 0 (because handlers are stubs) but a comment containing the literal contract phrase exists. Phase 4 wave 1 inverts this — comment becomes code, grep returns 5 |
| `assertOwnsWorkspace` (from Phase 2) catches a forged workspace_id at the DO layer | already covered | Phase 2's `defense-in-depth.test.ts` covers this. Phase 3 inherits the guard; no new test required |

### Sampling Rate

- **Per task commit:** `npm test --workspace @engram/mcp-server -- --run`
- **Per wave merge:** `npm test --workspaces -- --run` + `npm run lint:wrangler` + `npm run lint:blockconcurrency` + `npm run lint` + `npm run typecheck`
- **Phase gate:** Full suite green + MCP Inspector manual smoke documented with screenshot in DEP-05 + `wrangler deploy --dry-run` exits 0

### Wave 0 Gaps

- [ ] `packages/mcp-server/vitest.config.ts` — projects-mode config mirroring workspace-do's (workerd pool for everything; no node-pool subprocess tests needed for Phase 3)
- [ ] `packages/mcp-server/wrangler.test.jsonc` — test-pool config with both DO bindings (MCP_OBJECT, WORKSPACE) + dual KV namespaces (OAUTH_KV, ENGRAM_IDENTITIES — may need test-only IDs or `unsafe.bindings`)
- [ ] `packages/mcp-server/src/__tests__/tools.test.ts` — RED stub (5 it.skip for each tool schema + 1 it.skip for defense-in-depth contract)
- [ ] `packages/mcp-server/src/__tests__/stub-handlers.test.ts` — RED stub (5 it.skip for each MethodNotFound throw)
- [ ] `packages/mcp-server/src/__tests__/oauth.test.ts` — RED stub (KV lookup contract + props plumbing)
- [ ] `packages/mcp-server/src/__tests__/wrangler-migration.test.ts` — RED stub (parse wrangler.jsonc, assert v2 entry shape — alternative to grep-based check)
- [ ] Test framework install confirmation: vitest + @cloudflare/vitest-pool-workers already in root (Phase 2); confirm mcp-server inherits via workspace hoisting

## Security Domain

`security_enforcement` is enabled (default — not explicitly set to `false` in config). This is a security-sensitive phase: OAuth, JWTs, KV-stored identities, cross-workspace defense-in-depth.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OAuth 2.1 + PKCE via `@cloudflare/workers-oauth-provider` (RFC 7636 enforced by library) |
| V3 Session Management | yes | JWT bearer tokens with library-default TTL (3600s access, 30d refresh); session DO (`EngramMcp`) is ephemeral per MCP connection |
| V4 Access Control | yes | Defense-in-depth: Worker layer validates JWT props.workspace_id; DO layer fires `assertOwnsWorkspace` (Phase 2 STO-07) as second check |
| V5 Input Validation | yes | Zod schemas in `schemas.ts`; SDK auto-runs `inputSchema.parse(args)` before handler invocation |
| V6 Cryptography | yes | `COOKIE_ENCRYPTION_KEY` (wrangler secret) used by library to encrypt grant state; never hand-roll JWT signing — library handles via `jose` internally |
| V7 Error Handling | yes | `mapToMcpError` sanitizes Error messages (strips paths, hex IDs); MCP-07 requires `McpError` for all failures (no ad-hoc envelopes) |
| V9 Communications | yes | TLS terminated by Cloudflare edge; bearer-token-in-header is the auth conveyance |
| V14 Configuration | yes | Secrets (`COOKIE_ENCRYPTION_KEY`) via `wrangler secret put` only — never in JSONC; KV namespace IDs are not secrets (safe to commit) |

### Known Threat Patterns for Cloudflare Workers + MCP + OAuth

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace data access via forged JWT workspace_id | Information Disclosure / Elevation of Privilege | Two-layer check: (1) Worker validates JWT signature via library (library is the AS, so library trusts its own signatures); (2) DO layer's `assertOwnsWorkspace` fires when `ctx.id.name !== args.workspace_id`. Phase 2 STO-07 + this phase's MCP-05 contract |
| Tool input contains `workspace_id` overriding JWT | Spoofing / Elevation of Privilege | Schemas in `schemas.ts` MUST NOT declare a `workspace_id` field; structural assertion in tools.test.ts |
| OAuth client impersonation via reused client_id | Spoofing | Library's PKCE enforcement requires code_verifier proof; `disallowPublicClientRegistration` flag available if needed (defaults allow public clients per RFC 7591) |
| Token leakage via 401 WWW-Authenticate verbose responses | Information Disclosure | Library emits standard 401 + WWW-Authenticate; `mapToMcpError`'s sanitization is for tool errors only |
| Stack trace leakage in tool errors | Information Disclosure | `mapToMcpError` sanitizes Error.message (strips file paths, hex strings); never wrap unknown errors as MethodNotFound |
| KV poisoning (write to ENGRAM_IDENTITIES outside bootstrap) | Tampering | KV writes are restricted to `wrangler kv` CLI (account-scoped); no Worker code writes to ENGRAM_IDENTITIES in v0.1 (read-only at the `/authorize` hook) |
| `COOKIE_ENCRYPTION_KEY` leakage | Information Disclosure | Set via `wrangler secret put` (not in JSONC); rotate by re-running `secret put` (existing grants invalidated — accept as ops trade-off) |
| Mass token issuance to attacker via dynamic registration | Denial of Service / Resource Exhaustion | Library's `clientRegistrationTTL` defaults to ~90d; can set `disallowPublicClientRegistration: true` if abuse observed in v0.1 |
| MCP tool flooding (bypass rate limits via persistent session) | DoS | Out of scope for v0.1; Cloudflare Workers' per-account limits apply; add tool-level rate limiting in v0.2 if needed |

### Phase-Specific Security Notes

1. **The defense-in-depth contract is the single most important security artifact in Phase 3.** Tool handlers MUST construct `WorkspaceDO` method args with `args.workspace_id: this.props.workspace_id`. The zod schemas MUST NOT include a `workspace_id` field. The Phase-4-ready comment block in tools.ts documents the contract; Phase 4 wave 0 inverts the comment-vs-code state (comment becomes code).

2. **MCP-07's `McpError` convention is part of the threat model.** Ad-hoc `{ error: "..." }` envelopes confuse Claude (who reads them as success data). Phase 3 stubs already comply by throwing `McpError(MethodNotFound)`. Phase 4 must use `mapToMcpError`.

3. **The token refresh dance is out-of-scope for active mitigation in Phase 3** — the library handles it, and props persist by default. If Phase 4 observes stale-props symptoms after refresh, the mitigation is to add a `tokenExchangeCallback` that re-reads KV.

## Sources

### Primary (HIGH confidence)

- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` — `ErrorCode` enum values + `McpError` class definition [VERIFIED installed]
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `McpServer.registerTool` signature + `ToolCallback` type [VERIFIED installed]
- `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts` — `McpAgent` abstract class signature, `serve()` / `serveSSE()` static methods, `ServeOptions`, `getAgentByName` return type [VERIFIED installed]
- `node_modules/agents/dist/mcp/index.d.ts` — `agents/mcp` public API surface [VERIFIED installed]
- Phase 1 RESEARCH/PATTERNS (`.planning/phases/01-foundation/01-CONTEXT.md`) — TS-source posture, FND-08 lint rules [VERIFIED locally]
- Phase 2 RESEARCH/SUMMARY (`.planning/phases/02-workspacedo-sqlite/02-05-SUMMARY.md`, `02-06-SUMMARY.md`) — `WorkspaceDO` method contract, `assertOwnsWorkspace` guard [VERIFIED locally]
- `packages/workspace-do/src/index.ts` — actual current DO code being targeted [VERIFIED locally]
- `packages/mcp-server/src/index.ts` — Phase 1 stub being modified [VERIFIED locally]
- `scripts/lint-wrangler.mjs` — FND-08 lint implementation [VERIFIED locally]

### Secondary (MEDIUM confidence)

- Cloudflare Agents docs: `developers.cloudflare.com/agents/model-context-protocol/mcp-agent-api/` — McpAgent API reference [CITED]
- Cloudflare Agents docs: `developers.cloudflare.com/agents/model-context-protocol/authorization/` — OAuth integration patterns [CITED]
- Cloudflare Agents docs: `developers.cloudflare.com/agents/guides/remote-mcp-server/` — Remote MCP server guide [CITED]
- Cloudflare Agents docs: `developers.cloudflare.com/agents/model-context-protocol/transport/` — Streamable HTTP vs SSE [CITED]
- Cloudflare Agents docs: `developers.cloudflare.com/agents/guides/test-remote-mcp-server/` — MCP Inspector smoke test [CITED]
- `github.com/cloudflare/workers-oauth-provider` README — defaultHandler example + OAuthProvider constructor + `completeAuthorization` API [CITED]
- `geelen/mcp-remote` README — transport flags, OAuth flow, callback port 3334 [CITED]
- RFC 9728 — Protected Resource Metadata `/.well-known/oauth-protected-resource` shape [CITED]

### Tertiary (LOW confidence)

- WebSearch results re: zod v4 vs v3 in MCP SDK — confirmed via SDK source inspection but version compatibility window across all transitive deps not exhaustively tested
- `agents` release notes 0.10-0.14 — Cloudflare blog and GitHub releases referenced; not all minor versions had detailed changelogs publicly available

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all 4 production deps verified against installed `node_modules/` + npm registry version checks
- Architecture (system diagram, patterns): HIGH for OAuthProvider + McpAgent integration (Cloudflare-documented canonical pattern); MEDIUM for the `/authorize` consent hook (one library example, no second source)
- Pitfalls: MEDIUM-HIGH — most are derived from typecheck reasoning + Phase 2 carry-over; Pitfall 6 (`agents` minor-version churn) is grounded in npm registry version history
- Security: HIGH — defense-in-depth contract is inherited from Phase 2 STO-07 with verified test coverage; the rest is standard OAuth threat modeling

**Research date:** 2026-05-25
**Valid until:** 2026-06-15 (3 weeks — `agents` SDK is pre-1.0 and minor versions ship every few days; re-verify dep versions if Phase 3 doesn't execute within this window)

---
*Phase: 03-mcp-server-scaffold*
*Research completed: 2026-05-25*
