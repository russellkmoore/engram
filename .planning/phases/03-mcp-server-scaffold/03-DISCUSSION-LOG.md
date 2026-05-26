# Phase 3: MCP Server Scaffold - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the conversation.

**Date:** 2026-05-25
**Phase:** 03-mcp-server-scaffold
**Mode:** discuss (standard)
**Areas selected:** JWT validation strategy, Tool stub shape, Worker route surface
**Areas deferred to Claude's Discretion:** Error mapping convention (sensible defaults locked in CONTEXT.md)

## Area 1: JWT validation strategy

### Q1: Which path does Phase 3 ship?

**Options presented:**
- OAuth Resource Server (Recommended) — MCP-spec compliant, matches `mcp-remote` expectations
- Symmetric HMAC (jose HS256 + JWT_SECRET env) — simplest viable, needs replacement at v0.2
- Cloudflare Access Service Token — CF-native, ties auth to Zero Trust forever

**User chose:** OAuth Resource Server

**Rationale:** Devon/BMC onboards in v0.2. Doing OAuth right now means no auth refactor when team workspaces land.

### Q2: Where do tokens come from — i.e. who's the Authorization Server?

**Options presented:**
- @cloudflare/workers-oauth-provider (Recommended) — Cloudflare's official library, co-deployed
- External IdP (Auth0 / Clerk / WorkOS) — managed UI, external dep, monthly cost above free tier
- Self-hosted issuer (separate Worker) — max control, build login UI from scratch
- Pre-signed long-lived JWTs (script + paste) — OAuth-spec correct but defers interactive flow

**User chose:** @cloudflare/workers-oauth-provider

**Rationale:** Purpose-built for MCP-on-Workers, no external dep, free, single deploy. Ships all OAuth AS endpoints (`/authorize`, `/token`, `/jwks`, `/register`, `/.well-known/oauth-protected-resource`) in one library.

### Q3: How does Russell get his first token?

**Options presented:**
- Full OAuth dance via mcp-remote (Recommended) — Russell's Claude Desktop opens a browser to /authorize on first call, transparent thereafter
- Script-issued long-lived token + paste — matches DEP-02 literally, swap to dance in v0.2
- Both — OAuth flow primary, script as escape hatch for tests

**User chose:** Full OAuth dance via mcp-remote

**Note:** Updates DEP-02 wording from "JWT issued via script or doc" to "documented OAuth flow via mcp-remote + Claude Desktop config snippet". The script escape hatch is deferred unless integration tests demand it.

### Q4: What goes into the JWT props (workspace_id, user_id)?

**Options presented:**
- Hardcoded for Russell, schema-ready for multi-user (Recommended)
- Dynamic from Cloudflare KV (ENGRAM_IDENTITIES namespace)
- Derived from email/sub claim

**User chose:** Dynamic from Cloudflare KV

**Trade-off acknowledged:** Extra binding + 1 KV read per /authorize call (not per /mcp — props are JWT-encoded after first auth). User prioritized "no code change for v0.2" over the slight setup overhead. Bootstrap script writes Russell's mapping.

## Area 2: Tool stub shape

### Q5: What do the 5 'empty' tool registrations actually do when called in Phase 3?

**Options presented:**
- Throw McpError(-32601 MethodNotFound) with phase note (Recommended)
- Return empty EngramResponse envelope (mock data)
- Route through to WorkspaceDO with empty args (real call, no data)
- Register name + zod schema only, no handler

**User chose:** Throw McpError(-32601 MethodNotFound) with phase note

**Rationale:** Fastest signal that "wiring works, bodies don't yet". MCP Inspector lists all 5 tools, calling any returns a structured debuggable error. Phase 4 swaps the body — registration + schema + signature stay. Honors MCP-07.

### Q6: Where do the zod input schemas live?

**Options presented:**
- schemas.ts re-exporting from @engram/types via z.object() (Recommended)
- Inline in each tool registration
- Generate at build time from @engram/types

**User chose:** schemas.ts re-exporting from @engram/types via z.object()

**Rationale:** Single source of truth across registration + Phase 4 handler bodies. No build step (honors Phase 1 D-07 TS-source posture).

## Area 3: Worker route surface

### Q7: Where do the OAuth Authorization Server endpoints live — same Worker as MCP, or split?

**Options presented:**
- Same Worker (Recommended) — single deploy, single domain, library's intended usage
- Separate engram-auth Worker — blast-radius isolation, doubles deploy story

**User chose:** Same Worker

**Rationale:** No cross-Worker JWKS fetch. McpAgent.serve('/mcp') is one branch in the router; OAuth provider mounts the rest. Single `wrangler.jsonc`, single deploy command in DEP-01.

### Q8: Beyond /mcp + OAuth endpoints, what else does the Worker expose?

**Options presented (multiSelect):**
- /health (uptime + version) (Recommended)
- / (root) returns project info JSON
- /debug endpoints (rate-limit info, props echo)

**User chose:** /health AND /

**Deferred:** /debug endpoints — "too easy to ship a leak". Revisit in v0.2 with proper auth scoping.

## Auto-locked decisions (not discussed)

### Error mapping convention

User skipped this area; standard MCP-spec defaults locked in CONTEXT.md §Claude's Discretion:
- WorkspaceDO's `McpError(-32600 InvalidRequest)` → passes through unchanged
- WorkspaceDO's `NotFoundError` → `McpError(ErrorCode.InvalidParams, ...)` (`-32602`)
- Generic `Error` → `McpError(ErrorCode.InternalError, ...)` (`-32603`) with sanitized message (no stack traces, no DB internals, no env values)

Centralize in `packages/mcp-server/src/error-mapping.ts` so all 5 tool handlers stay uniform.

### v2 wrangler.jsonc migration

No question needed — Phase 2 D-07 forward-noted this. Locked as D-09 in CONTEXT.md:
- Add `{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }` to migrations[]
- Acceptance: `npm run lint:wrangler` exits 0 + `wrangler deploy --dry-run` clean

## Deferred Ideas (captured for future phases)

- /debug/* endpoints (v0.2 with proper auth scoping)
- Real consent UI (v0.2 when Devon onboards)
- Token revocation flow (v0.2 if mcp-remote requires it)
- CI integration of MCP Inspector smoke (v0.2 only if regressions appear)
- OAuth scopes / fine-grained tool authorization (v0.3+)
- Build-step zod generation (premature)
- Separate engram-auth Worker (revisit only if auth load demands isolation)
- TOL-01..08 (Phase 4 territory)
- AI-* requirements (Phase 5 territory)
- Triage Worker integration (Phase 6 territory)
