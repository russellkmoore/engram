# @engram/mcp-server

The MCP-facing Cloudflare Worker for Engram. It hosts the `EngramMcp` Durable Object
(a per-session `McpAgent` instance) wrapped by `@cloudflare/workers-oauth-provider`,
exposes the v0.1 tool surface at `/mcp`, and routes the OAuth dance (`/authorize`,
`/token`, `/jwks`, `/register`, `/.well-known/oauth-protected-resource`) so any
MCP-compatible client — Claude Desktop via `mcp-remote`, the MCP Inspector, or a
custom integration — can authenticate against your own Cloudflare account and call
the five v0.1 tools (`remember`, `recall`, `search`, `forget`, `ingest`).

In Phase 3 the tools are registered as stubs that throw a structured
`McpError(MethodNotFound)` with a phase-pinned message — the auth, routing, and
session scaffolding are real; the handler bodies land in Phase 4 (TOL-01..05).

---

## Phase Status

**Current milestone:** v0.1 — MCP Foundation (Linear target 2026-06-07,
[milestone tracking](../../.planning/ROADMAP.md)).

Phase 3 (MCP Server Scaffold) is complete except for the manual MCP Inspector
smoke (MCP-09) recorded alongside this README. Phase 4 fills the tool handler
bodies; this Worker's external surface (routes, OAuth flow, tool descriptions)
is stable from Phase 3 forward.

For the full requirement matrix see
[`.planning/REQUIREMENTS.md`](../../.planning/REQUIREMENTS.md) §"MCP Server (MCP)".

---

## Prerequisites

- A Cloudflare account (free tier is fine for `wrangler dev`; deploys require a
  paid Workers plan only if you enable additional bindings beyond KV + DO).
- Node 22+ and npm 10+ (the monorepo root pins these via `engines`).
- `wrangler` is provided by the workspace — no global install needed.
- `npx mcp-remote` and `npx @modelcontextprotocol/inspector` work over the
  network; no global install of those CLIs is required either.

Authenticate Wrangler against your Cloudflare account once:

```bash
npx wrangler login
```

---

## Local Development

From the repo root:

```bash
npm install
npm run dev:mcp         # or: npm run dev --workspace=@engram/mcp-server
```

`wrangler dev` boots the Worker locally on `http://localhost:8787`. Sanity-check
the public routes (no auth required for either):

```bash
curl http://localhost:8787/        # → 200 JSON: { name, mcp, oauth, docs }
curl http://localhost:8787/health  # → 200 JSON: { status: "ok", version, ... }
```

`/mcp` requires a valid JWT and will return `401 Unauthorized` until the OAuth
dance has produced a token — see [Smoke Test: MCP Inspector](#smoke-test-mcp-inspector).

---

## First-Time Setup (one-shot)

The three steps below are run **once** per Cloudflare account. After they are
complete the Worker can be deployed and used from any MCP client.

### Create KV namespaces

The OAuth provider needs two KV namespaces:

- **`OAUTH_KV`** — library-owned. Stores OAuth grants, refresh tokens, and the
  encrypted session state. The `@cloudflare/workers-oauth-provider` library
  reads and writes this binding directly.
- **`ENGRAM_IDENTITIES`** — Engram-owned. Maps an OAuth `sub` claim (the
  dynamically-registered MCP client id) to the `{ workspace_id, user_id }`
  Engram populates into the JWT props on `/authorize`.

Create both namespaces from a terminal:

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create ENGRAM_IDENTITIES
```

Each command prints a real namespace ID. Open
[`packages/mcp-server/wrangler.jsonc`](./wrangler.jsonc) and replace the two
`<id-from-wrangler-kv-namespace-create>` placeholders under `kv_namespaces[]`
with the IDs `wrangler` just printed. KV namespace IDs are **not** secrets;
they are safe to commit.

### No additional secrets required

`@cloudflare/workers-oauth-provider` v0.7.0 derives all encryption keys from
OAuth grant material stored in `OAUTH_KV` — no Worker secret is required at
deploy time. The Worker does NOT consume any `COOKIE_ENCRYPTION_KEY` or
analogous binding (verified against the library's `OAuthProviderOptions`
surface at `node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.d.ts`).
If a future library version introduces a secret binding, this section will
be updated alongside the wrangler change that actually consumes it.

### Bootstrap the identity record

`ENGRAM_IDENTITIES` is initially empty. The OAuth `/authorize` handler reads
this KV to populate `{ workspace_id, user_id }` into the JWT props. For a
brand-new install the bootstrap is a deliberate **2-step flow**:

1. **Trigger one failed `/authorize` attempt** so the dynamic client id is
   registered and you can observe its `sub`. Run the MCP Inspector
   procedure below (see [Smoke Test: MCP Inspector](#smoke-test-mcp-inspector)).
   The recommended smoke path is pure-local `wrangler dev` — see that
   section for the full two-terminal procedure.

2. **Read the 403 error body.** The response body looks like:

   ```text
   Unknown OAuth subject: <some-sub-value>. Bootstrap via npm run kv:bootstrap.
   ```

   Copy the `<some-sub-value>` (it is the OAuth subject claim that the
   dynamically-registered client uses; safe to log — it is not a secret).

3. **Write the identity into KV** by running, from the repo root.

   For the **local-mode smoke** (Inspector against `wrangler dev`):

   ```bash
   npm run kv:bootstrap -- --sub <observed-sub> \
     --workspace-id <your-workspace-id> \
     --user-id <your-user-id> \
     --local
   ```

   For a **deployed Worker** (or `wrangler dev --remote` against your
   production KV):

   ```bash
   npm run kv:bootstrap -- --sub <observed-sub> \
     --workspace-id <your-workspace-id> \
     --user-id <your-user-id>
   ```

   `--workspace-id` and `--user-id` are **required** — there are no
   developer-specific defaults. Use whatever identifier you want for your
   own workspace and user records; they become the `props.workspace_id`
   and `props.user_id` Engram populates into the JWT on every `/authorize`.

   The script wraps `npx wrangler kv key put --binding ENGRAM_IDENTITIES`,
   writes the identity JSON to a 0o600 temp file (instead of passing it on
   the command line where it would leak to `ps -ef`), and never echoes
   the value to stdout (T-03-KV-LEAK mitigation). See
   [`scripts/kv-bootstrap.mjs`](../../scripts/kv-bootstrap.mjs) for the
   CLI surface (`--dry-run` lets you preview without writing).

4. **Retry the OAuth flow.** The same client should now succeed and cache a
   JWT in `~/.mcp-auth/` (Claude Desktop / mcp-remote) or inside the
   Inspector session.

The 2-step pattern is intentional — it removes the need to ship an
auto-registration UI for v0.1, and it makes the failure mode loud and
self-documenting when an unknown sub appears.

---

## Claude Desktop Configuration

Claude Desktop reads `claude_desktop_config.json` to learn about MCP servers.
The file lives at:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### Production (deployed to your own subdomain)

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["mcp-remote", "https://engram-mcp.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

Replace `<your-subdomain>` with the Cloudflare account's
`workers.dev` subdomain (visible in the Cloudflare dashboard under
"Workers & Pages"). On first invocation `mcp-remote` opens a browser tab to
your Worker's `/authorize` endpoint and caches the resulting JWT in
`~/.mcp-auth/`.

### Local development (against `wrangler dev`)

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

Useful when iterating on tool implementations. Restart Claude Desktop after
editing the config file. Either entry can be enabled or disabled by removing
the corresponding key — Claude reads the file at startup.

---

## OAuth Flow (under the hood)

Simplified view of what happens on the first call from any client (full
diagram lives in
[`.planning/phases/03-mcp-server-scaffold/03-RESEARCH.md`](../../.planning/phases/03-mcp-server-scaffold/03-RESEARCH.md)
§System Architecture Diagram, lines 154–238):

```
Claude Desktop / Inspector
        │  (JSON-RPC over Streamable HTTP)
        ▼
mcp-remote (local proxy)         ── opens browser ──▶  /authorize
        │  (Bearer JWT once cached)                      │
        ▼                                                ▼
engram-mcp-server Worker                          OAuth defaultHandler
        │                                                │
        ├── /mcp  (apiHandler, JWT-validated)            ├── KV lookup
        │       └── EngramMcp.serve("/mcp",              │   (ENGRAM_IDENTITIES
        │                { binding: "MCP_OBJECT" })      │    by sub claim)
        │                                                │
        ├── /token, /jwks, /register, /.well-known/*     ├── completeAuthorization
        │   (library-owned, automatic)                   │    with { workspace_id,
        │                                                │           user_id } props
        ├── /, /health  (public, no auth)                ▼
        │                                          302 redirect → mcp-remote callback
        ▼                                                │
EngramMcp DO  (one per session, hibernates)       JWT minted, cached locally
        │                                                │
        └── tool calls go here ◀────────────────────────┘
```

Once a JWT is cached, every subsequent tool call is a single authenticated
JSON-RPC request to `/mcp` — no further KV reads, no further `/authorize`
roundtrips. The `EngramMcp` DO holds the session, calls into `WorkspaceDO`
on tool invocation (Phase 4+), and hibernates between calls.

---

## Smoke Test: MCP Inspector

The MCP Inspector is the canary for the entire Phase 3 surface — OAuth dance

- EngramMcp registration + stub MethodNotFound shape — against a live workerd
  runtime. Run this once after first-time setup; re-run after any change to
  `src/index.ts`, `src/oauth.ts`, `src/tools.ts`, or `wrangler.jsonc`.

### Two-terminal procedure

**Terminal 1 — boot the Worker locally** (from repo root):

```bash
npm run dev:mcp
```

Or, equivalently, from the package directory:

```bash
cd packages/mcp-server
npm run dev
```

`wrangler dev` prints `Ready on http://localhost:8787` (or similar). **Do
NOT use `--remote`** for the Inspector smoke — the OAuth Protected Resource
Metadata endpoint (RFC 9728) derives its `resource` field from
`request.url`, so under `--remote` the metadata advertises the
Cloudflare-edge hostname (`https://engram-mcp-server.<subdomain>.workers.dev/mcp`)
while MCP Inspector connects to `http://localhost:8787/mcp` — the
resource mismatch trips RFC 9728 §3.3 and the OAuth dance fails before
it ever reaches `/authorize`. See [Troubleshooting](#troubleshooting) for
the full explanation. The recorded smoke evidence is
[`.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md`](../../.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md)
§"Smoke Run" Deviation 1.

**Terminal 2 — boot the Inspector:**

```bash
npx @modelcontextprotocol/inspector
```

A browser tab opens at `http://localhost:5173/?MCP_PROXY_AUTH_TOKEN=...`.

**In the Inspector UI:**

1. Set Transport to **"Streamable HTTP"**.
2. Set URL to `http://localhost:8787/mcp`.
3. Click **Connect**.
4. When prompted for auth, click **"Open Auth settings" → "Quick OAuth
   Flow"**. The browser may redirect to `/authorize`.
5. If you see a 403 body `Unknown OAuth subject: <sub>. Bootstrap via
npm run kv:bootstrap.` — copy the `<sub>` value, run from the repo root:

   ```bash
   npm run kv:bootstrap -- --sub <copied-sub> \
     --workspace-id <your-workspace-id> \
     --user-id <your-user-id> \
     --local
   ```

   Then click Connect again. (The `--local` flag writes to
   `.wrangler/state/v3/kv/` — the storage backend `wrangler dev` reads
   without `--remote`.)

6. Once connected, click the **Tools** tab and the **"List tools"** action.
7. Pick any tool (e.g. `remember`) and run it with a sample payload.

### Acceptance checklist

- ✓ Inspector connects to `/mcp` after the OAuth dance completes.
- ✓ The Tools tab lists exactly **5 tools** by name:
  `remember`, `recall`, `search`, `forget`, `ingest`.
- ✓ Each tool's description renders (non-empty).
- ✓ Clicking any tool returns `McpError` code `-32601` (`MethodNotFound`)
  with a message containing the substring `Phase 3` and
  `Phase 4 (TOL-0N)` where `N` matches the tool (`TOL-01` for `remember`,
  `TOL-02` for `recall`, `TOL-03` for `search`, `TOL-04` for `forget`,
  `TOL-05` for `ingest`).

If any criterion fails, see [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### `wrangler deploy` fails with "class not declared in any migration"

The v2 migration entry for `EngramMcp` was likely dropped or renamed.
Open [`wrangler.jsonc`](./wrangler.jsonc) and confirm the `migrations[]`
array contains BOTH entries, using `new_sqlite_classes` (not `new_classes`):

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["WorkspaceDO"] },
  { "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }
]
```

Run `npm run lint:wrangler` from the repo root — it will fail loudly if the
shape regresses. SQLite-backed DOs are irreversible per
Cloudflare workers-sdk #9909, so never switch `new_sqlite_classes` to
`new_classes`.

### MCP Inspector fails with "Failed to start OAuth flow: Protected resource ... does not match expected `http://localhost:8787/mcp`"

The Worker is running under `wrangler dev --remote`, which routes
requests through the Cloudflare edge. The OAuth library advertises an
OAuth Protected Resource URL derived from `new URL(request.url).origin`
— under `--remote` that origin is the Cloudflare edge hostname
(`https://engram-mcp-server.<subdomain>.workers.dev`), not
`http://localhost:8787`. MCP Inspector enforces the RFC 9728 §3.3
resource-binding check against its own connect URL (the local proxy at
`localhost:8787`) and rejects the mismatch — by design.

**Fix:** Always use pure-local `wrangler dev` (no `--remote`) for the
Inspector smoke. The Worker reads the `ENGRAM_IDENTITIES` binding from
`.wrangler/state/v3/kv/` instead of the production namespace; bootstrap
the local-mode identity record via
`npm run kv:bootstrap -- --sub <sub> --workspace-id <id> --user-id <id> --local`.
See [Smoke Test: MCP Inspector](#smoke-test-mcp-inspector) for the full
two-terminal procedure.

### MCP Inspector hangs at "Connecting…" or shows 403 "Unknown OAuth subject"

The `ENGRAM_IDENTITIES` KV namespace (local-mode or remote, depending on
which `wrangler dev` mode you're in) has no entry for the Inspector's
dynamically-registered client id. Trigger one `/authorize` attempt to
surface the 403 body, copy the `sub` from the error, then run:

```bash
npm run kv:bootstrap -- --sub <copied-sub> \
  --workspace-id <your-workspace-id> \
  --user-id <your-user-id> \
  --local   # omit for production KV (--remote wrangler dev path)
```

Reconnect from the Inspector UI.

### `curl /health` works but `/mcp` returns 401

This is expected. `/` and `/health` are public routes (no JWT required) per
D-08; `/mcp` requires a Bearer JWT issued by the OAuth provider. Walk the
Claude Desktop or Inspector flow first to mint a token, or supply one
manually via the `Authorization: Bearer <your-token>` header.

### `npm install` fails with engine constraint complaints

`lint-staged@17` declares an engines field requiring `node >=22.22.1` while
the repo currently allows 22.14+. Pass `--engine-strict=false` to install:

```bash
npm install --engine-strict=false
```

This is a pre-existing condition tracked outside this README. The Worker
itself has no such constraint.

### Inspector shows "Stream closed" or "Transport error" mid-session

Confirm Terminal 1's `wrangler dev` is still running and the URL is
`http://localhost:8787/mcp` (not `:5173` — that's Inspector's own UI). If
`wrangler dev` reloaded due to a file change, reconnect from the Inspector
UI.

---

## Architecture Reference

- [`../../CLAUDE.md`](../../CLAUDE.md) §"Session DO vs Workspace DO" — the
  two-DO topology this Worker hosts (`EngramMcp` session DO +
  `WorkspaceDO` durable store, both declared together under
  `new_sqlite_classes`).
- [`../../.planning/REQUIREMENTS.md`](../../.planning/REQUIREMENTS.md)
  §"MCP Server (MCP)" — the MCP-01..09 requirement set this Worker
  satisfies.
- [`../../.planning/ROADMAP.md`](../../.planning/ROADMAP.md) §"Phase 3:
  MCP Server Scaffold" — the success criteria and risk notes Phase 3 is
  closing.
- [`../../.planning/phases/03-mcp-server-scaffold/03-CONTEXT.md`](../../.planning/phases/03-mcp-server-scaffold/03-CONTEXT.md) — Phase 3
  decisions (D-01..D-09) including the OAuth Resource Server pattern, the
  schema-as-data discipline, and the two-KV-namespace identity model.
- [`../../.planning/phases/03-mcp-server-scaffold/03-PATTERNS.md`](../../.planning/phases/03-mcp-server-scaffold/03-PATTERNS.md) — pattern
  map for every file in this package (in-repo analogs vs. external
  patterns).
- [`../../.planning/phases/03-mcp-server-scaffold/03-RESEARCH.md`](../../.planning/phases/03-mcp-server-scaffold/03-RESEARCH.md) — full
  research bundle, including the verified architecture diagram (§System
  Architecture Diagram) and pitfalls 1–6.
- [`../../.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md`](../../.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md) —
  recorded outcome of the smoke procedure above (created by Plan 03-06
  Task 2).
