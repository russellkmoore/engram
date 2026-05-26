---
phase: 03-mcp-server-scaffold
reviewed: 2026-05-26T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - packages/mcp-server/package.json
  - packages/mcp-server/README.md
  - packages/mcp-server/src/__tests__/error-mapping.test.ts
  - packages/mcp-server/src/__tests__/index.test.ts
  - packages/mcp-server/src/__tests__/oauth.test.ts
  - packages/mcp-server/src/__tests__/schemas.test.ts
  - packages/mcp-server/src/__tests__/tools.test.ts
  - packages/mcp-server/src/error-mapping.ts
  - packages/mcp-server/src/index.ts
  - packages/mcp-server/src/oauth.ts
  - packages/mcp-server/src/schemas.ts
  - packages/mcp-server/src/tools.ts
  - packages/mcp-server/tsconfig.json
  - packages/mcp-server/vitest.config.ts
  - packages/mcp-server/wrangler.jsonc
  - packages/mcp-server/wrangler.test.jsonc
  - scripts/kv-bootstrap.mjs
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-26
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

The Phase 3 MCP server scaffold cleanly implements the OAuthProvider + McpAgent two-DO architecture (D-01 / D-09). The five v0.1 tool stubs are registered with the correct phase-pinned `MethodNotFound` messages, the defense-in-depth invariant (no `workspace_id` in any input schema; `props.workspace_id` derived only from `ENGRAM_IDENTITIES` KV) is enforced both structurally and via tests, and the error-mapping sanitizer covers the documented T-03-LEAK vectors. The wrangler migrations correctly use `new_sqlite_classes` for both DOs.

That said, this review surfaces one CRITICAL doc-drift issue (the README documents a `COOKIE_ENCRYPTION_KEY` secret that the OAuthProvider 0.7.0 library does not consume — this misleads first-time setup and creates a fake security artifact) plus several WARNING-level robustness gaps (no schema validation on the parsed KV identity record, identical placeholder IDs for two different KV namespaces, command-line process-table leakage in the bootstrap script, redundant unchecked `lookupClient` call, identity defaults hard-coded to a specific developer, and a minor type-comment drift).

The intentional stubs in `tools.ts` are correctly marked Phase-4-pending and are not flagged.

---

## Critical Issues

### CR-01: README documents a fabricated `COOKIE_ENCRYPTION_KEY` secret that the library never reads

**File:** `packages/mcp-server/README.md:100-117`
**Issue:**
The "Set the cookie encryption secret" section instructs the operator to:

```
npx wrangler secret put COOKIE_ENCRYPTION_KEY --name engram-mcp-server
```

…and claims `@cloudflare/workers-oauth-provider` "encrypts the OAuth grant-state cookie it writes during `/authorize`". Verified against `node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.{js,d.ts}` (v0.7.0):

- `grep -i "cookie\|COOKIE_ENCRYPTION_KEY"` returns **zero** matches in the library bundle.
- `OAuthProviderOptions` (line 413) has no `cookieSecret`, `cookieEncryption`, or analogous field — the only configuration surface is `apiRoute/apiHandler/defaultHandler/{authorize,token,clientRegistration}Endpoint`, TTLs, scope flags, etc.
- The library stores grant state encrypted in `OAUTH_KV`, with the encryption key derived from auth-code / refresh-token material (line 1242 `unwrapKeyWithToken`). No cookie is set on the `/authorize` response path that this scaffold uses.
- There is no consumer of `env.COOKIE_ENCRYPTION_KEY` anywhere in `packages/mcp-server/src/`, `wrangler.jsonc`, or `worker-configuration.d.ts`.

Impact:
1. **Operator confusion** — a first-time setup follows the documented step, sets a secret no code reads, and assumes the OAuth flow is "more secure" than it actually is. False sense of security.
2. **Fake threat-model coverage** — the README sentence "If you rotate it, existing OAuth grants are invalidated" is false. Rotating a no-op secret does nothing; the user may believe they've revoked grants when they have not. This is a **security-relevant documentation bug** (T-03-DOC-LEAK adjacent — misleading the operator about security controls).
3. **README and code drift** — section is uncited; not referenced from any plan / decision log.

Note that the OAuth library DOES require `env.OAUTH_KV` (verified at oauth-provider.d.ts:1187 and oauth-provider.js:895), and that IS declared in `wrangler.jsonc`. The single real configuration step the README omits is "ensure OAUTH_KV exists and is bound" — which is covered, but in a different section.

**Fix:**
Delete the entire "Set the cookie encryption secret" subsection (README.md lines 100-117). If the OAuthProvider gains a real secret in a future version, add it back with a code-anchored reference. Suggested replacement copy under "First-Time Setup":

```markdown
### No additional secrets required

`@cloudflare/workers-oauth-provider` v0.7.0 derives all encryption keys from
OAuth grant material stored in `OAUTH_KV` — no Worker secret is required.
If a future library version adds a secret binding, this section will document
it alongside the wrangler change that consumes it.
```

Also remove the corresponding paragraph in the smoke-test / troubleshooting flow if any other section references `COOKIE_ENCRYPTION_KEY` (none observed, but worth a grep before merge).

---

## Warnings

### WR-01: `oauth.ts` accepts any valid-JSON KV payload — no shape validation on `IdentityRecord`

**File:** `packages/mcp-server/src/oauth.ts:190-215`
**Issue:**
`JSON.parse(raw) as IdentityRecord` is a TypeScript cast, not a runtime check. If a contributor (or attacker with KV write access) stores a value that parses successfully but doesn't conform to `{ workspace_id: string, user_id: string }`, the handler silently continues:

- `JSON.parse("null")` → `identity = null` → `identity.workspace_id` throws TypeError → 500 with the library's default error body (NOT the sanitized T-03-PARSE literal — `try/catch` only wraps the parse, not the field access).
- `JSON.parse("{}")` → `identity = {}` → `userId: undefined` is passed to `completeAuthorization`, which may store an `undefined` userId or fail in a misleading downstream way.
- `JSON.parse('{"workspace_id": 12345, "user_id": null}')` → wrong types reach the JWT props; Phase 4 tool handlers downstream may then call `getAgentByName(env.WORKSPACE, 12345)` and fail in a confusing place.

The T-03-PARSE comment block (lines 185-189) explicitly says "the literal below is the only text emitted on the failure path" — but the implementation only catches the `JSON.parse` SyntaxError, not the wider class of shape-validation errors. The same threat class (corrupt identity record) leaks past the guard.

**Fix:**
Use the existing zod dep to validate the parsed shape inside the same try/catch:

```ts
// Top of file (near other imports)
import { z } from "zod";

const IdentityRecordSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
});

// In the /authorize handler:
let identity: IdentityRecord;
try {
  const parsed = JSON.parse(raw);
  identity = IdentityRecordSchema.parse(parsed);
} catch {
  return new Response("Internal error: corrupt identity record", {
    status: 500,
  });
}
```

Then extend `oauth.test.ts` with one additional case under "T-03-PARSE": `JSON.parse` succeeds but shape is invalid (e.g., `JSON.stringify({})`) — assert the same 500 + literal body. Without this, the test suite passes while the real failure mode silently leaks.

### WR-02: Both KV namespaces share an identical placeholder ID, masking a misconfiguration footgun

**File:** `packages/mcp-server/wrangler.jsonc:27-28`
**Issue:**

```jsonc
{ "binding": "OAUTH_KV",          "id": "<id-from-wrangler-kv-namespace-create>" },
{ "binding": "ENGRAM_IDENTITIES", "id": "<id-from-wrangler-kv-namespace-create>" },
```

Both placeholders are the exact same string. If a contributor copies the file and replaces ONE of them, the other still passes a syntactic check (it's a string) but resolves to whatever `wrangler` does with a literal angle-bracketed placeholder. More likely: someone could mistakenly bind BOTH namespaces to the same KV ID (because they didn't notice there are two distinct namespaces to create), conflating OAuth grant storage with the identity map and corrupting both.

This is a `wrangler kv namespace create` UX gap that the JSONC can compensate for trivially.

**Fix:**
Differentiate the placeholders so they fail loudly when one is copied without the other:

```jsonc
{ "binding": "OAUTH_KV",          "id": "<replace-with-OAUTH_KV-id-from-wrangler-kv-namespace-create>" },
{ "binding": "ENGRAM_IDENTITIES", "id": "<replace-with-ENGRAM_IDENTITIES-id-from-wrangler-kv-namespace-create>" },
```

Add a one-line note in the README "Create KV namespaces" section pointing out that the two IDs MUST be distinct.

### WR-03: Bootstrap script passes identity JSON as a positional CLI arg — leaks to process table

**File:** `scripts/kv-bootstrap.mjs:91, 95-105, 125`
**Issue:**
`identityJson = JSON.stringify({ workspace_id, user_id })` is built locally and passed as the final positional argument to `npx wrangler kv key put …`. On Linux / macOS, `ps -ef`, `/proc/<pid>/cmdline`, and `ps auxww` expose the full command line of any running process — including `wrangler` and `npx` while they are active.

The threat model header (lines 18-19, 23-28) claims "T-03-KV-LEAK mitigation — the identity JSON value is computed locally and passed straight to wrangler; it is NEVER echoed to stdout in either real or dry-run mode" — but stdout/stderr leakage is not the only vector. The JSON value transits the process table during the wrangler subprocess lifetime.

For the documented v0.1 defaults (`workspace_id: "rmoore-personal"`, `user_id: "rmoore"`), the leak is low-signal. But if a future caller passes a real PII-bearing user identifier (email, customer id, etc.), the values are exposed to any local process that can read the process list.

**Fix:**
Use wrangler's `--path` flag (or stdin, if supported) instead of a positional value. From `wrangler kv key put --help`:

```bash
npx wrangler kv key put --binding ENGRAM_IDENTITIES --remote <sub> --path <file-path>
```

Implementation sketch:

```js
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "kv-bootstrap-"));
const tmpFile = join(tmpDir, "identity.json");
try {
  writeFileSync(tmpFile, identityJson, { mode: 0o600 });
  const wranglerArgs = [
    "wrangler", "kv", "key", "put",
    "--binding", "ENGRAM_IDENTITIES",
    "--remote", sub,
    "--path", tmpFile,
  ];
  const result = spawnSync("npx", wranglerArgs, { stdio: ["ignore", "inherit", "inherit"] });
  // ...existing error-handling...
} finally {
  try { unlinkSync(tmpFile); } catch {}
  try { rmdirSync(tmpDir); } catch {}
}
```

Update the threat-model header to add "T-03-KV-LEAK process-table mitigation: identity JSON written to a `0o600` temp file, never passed as a CLI arg."

### WR-04: `oauth.ts` calls `lookupClient` and discards the result — redundant call OR a silent gap

**File:** `packages/mcp-server/src/oauth.ts:163`
**Issue:**

```ts
const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
```

The result of `lookupClient` is discarded. From `node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js:2821`, `lookupClient(clientId)` returns `Promise<ClientInfo | null>` — null on a missing client. The provider's `completeAuthorization` (line 2834) does its OWN `lookupClient` and validates the redirect URI against `clientInfo.redirectUris`, throwing if the client is missing or the URI doesn't match.

So the line is either:
1. **Redundant** — `completeAuthorization` repeats the check (current effective behavior). Net cost: one extra KV read per `/authorize`. Net benefit: zero. Misleading because the discarded result LOOKS like it's being checked.
2. **A silent gap** — the original author intended to assert the client exists and short-circuit with a clearer 4xx before reaching the KV identity lookup, but forgot to capture/check the result. If so, an unknown `client_id` currently falls through to the KV lookup (`env.ENGRAM_IDENTITIES.get(<bogus-client-id>)`) and returns "Unknown OAuth subject" — a misleading error message (the real issue is "Unknown OAuth client", not subject).

Either way, the line as written is wrong: it's a side-effecting call whose return value is the actionable signal, dropped on the floor.

**Fix (preferred — assert and short-circuit):**

```ts
const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);

const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
if (clientInfo === null) {
  return new Response(`Unknown OAuth client: ${oauthReqInfo.clientId}`, { status: 400 });
}

const sub = oauthReqInfo.clientId;
// ...continue with KV identity lookup...
```

**Fix (alternative — delete the dead call):**
If the redundancy is intentional (warm-cache, etc.), delete the line entirely and let `completeAuthorization` handle the check. Document the choice in the JSDoc.

Add a test case under `oauth.test.ts` describe `"oauth defaultHandler — /authorize flow"`: "unknown OAuth client returns 400, NOT 403 (T-03-PROPS — error class signals the real failure)".

### WR-05: Bootstrap script bakes a single developer's identity into a project-wide tool

**File:** `scripts/kv-bootstrap.mjs:48-49`
**Issue:**

```js
let workspaceId = "rmoore-personal";
let userId = "rmoore";
```

The defaults are Russell-specific. `scripts/` is shared, OSS-eligible code (per CLAUDE.md "v1.0 Public Launch — OSS launch"). A future contributor or self-hoster who runs the script without explicit flags writes a record keyed on a stranger's identity.

The README at line 142-146 partially compensates by always passing `--workspace-id rmoore-personal --user-id rmoore` in its example — but the script-level default still applies if either flag is omitted. The CLI never errors out on "no workspace-id provided"; it just silently writes Russell's defaults.

**Fix:**
Make `--workspace-id` and `--user-id` required (mirror `--sub`'s required treatment), OR replace the defaults with sentinel values that fail loudly:

```js
let workspaceId = ""; // REQUIRED — supply via --workspace-id
let userId = "";      // REQUIRED — supply via --user-id

// ...after parsing...
if (!workspaceId || !userId) {
  process.stderr.write(`${TAG} ERROR: --workspace-id and --user-id are required\n`);
  usage(process.stderr);
  process.exit(1);
}
```

Update the README CLI examples accordingly (drop the implied defaults; show all three flags as REQUIRED).

### WR-06: `EngramMcp.init()` JSDoc misstates the `agents/mcp` type signature

**File:** `packages/mcp-server/src/index.ts:85-91`
**Issue:**
The eslint-disable comment block reads:

> The `async` keyword is kept because `McpAgent.init()` is typed `init(): Promise<void> | void`

Verified against `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts:396`:

```ts
abstract init(): Promise<void>;
```

The library types it strictly as `Promise<void>` — not the union shown in the comment. The `async` keyword is required (not "kept"), and Phase 4's plan to add async setup doesn't depend on a union return type that doesn't exist.

This is a minor doc-drift, but the comment is the rationale for an eslint-disable that suppresses real lints. If a future contributor reads this and assumes they can remove `async` for a synchronous Phase 4 init, they would break the contract.

**Fix:**

```ts
/* eslint-disable @typescript-eslint/require-await --
   `registerTools` is synchronous (each `server.registerTool` is sync). The
   `async` keyword is REQUIRED because `McpAgent.init()` is typed strictly
   `init(): Promise<void>` (agents/dist/agent-tool-types-*.d.ts:396) and
   Phase 4 may add async setup (e.g., warm-loading user preferences from
   `this.env`). Keeping the keyword now means Phase 4 edits are body-only. */
```

---

## Info

### IN-01: `dry-run` redaction loop in `kv-bootstrap.mjs` is a no-op transform

**File:** `scripts/kv-bootstrap.mjs:111-117`
**Issue:**

```js
wranglerArgs
  .slice(0, -1) // drop the final identity JSON arg
  .map((a) => (a === sub ? sub : a))
  .join(" ")
```

The `.map` callback is `(a) => (a === sub ? sub : a)` — both branches return `a` unchanged. This is dead-equivalent to `.map((a) => a)` and serves no purpose. The actual redaction (dropping the identity JSON) is done by `.slice(0, -1)`; the map is leftover scaffolding.

**Fix:**
Delete the `.map(...)` line:

```js
process.stdout.write(
  `${TAG} DRY RUN: would call: npx ` +
    wranglerArgs.slice(0, -1).join(" ") +
    ` <identity-json-redacted>\n`,
);
```

### IN-02: Schemas accept unbounded string lengths (defer to Phase 4)

**File:** `packages/mcp-server/src/schemas.ts:46-90`
**Issue:**
`RememberInputSchema.content`, `IngestInputSchema.source`, `RecallInputSchema.query`, etc. all use `z.string().min(1)` with no `.max(N)`. A 1MB+ content string parses successfully. For Phase 3 stubs this is irrelevant (callbacks throw before reading args), but Phase 4 handlers will need bounds before storing to SQLite / calling CF AI APIs (which have token / payload limits).

**Fix (Phase 4 work — capture now as a follow-up):**
Add reasonable `.max(N)` caps consistent with `@engram/types` block content limits (e.g., `.max(100_000)` for `content`, `.max(2048)` for URL-shaped `source`). Track as a Phase 4 todo against TOL-01..05.

### IN-03: `IngestInputSchema.source` accepts any non-empty string (no URL shape check)

**File:** `packages/mcp-server/src/schemas.ts:84`
**Issue:**
CLAUDE.md describes ingest as taking an external source (URL-shaped per the Slack / Drive connector examples). The schema accepts any string ≥ 1 char. `RememberInputSchema.expires` uses `.datetime()`; `IngestInputSchema.source` could use `.url()` analogously.

This is intentionally loose for Phase 3 (the handler is a stub) and may be deliberately loose in Phase 4 if non-URL sources are valid (file paths, connector identifiers). Track as a follow-up.

**Fix:**
Decision needed in Phase 4: if all valid `source` values are URLs, switch to `z.string().url()`. If file paths / opaque identifiers are also valid, document the union explicitly with `z.union([z.string().url(), z.string().regex(/^connector:/)])` or similar.

### IN-04: README `dev:mcp` script invocation reference is slightly inconsistent

**File:** `packages/mcp-server/README.md:55, 263`
**Issue:**
README line 55 uses `npm run dev:mcp` (project-root convenience script — defined at root `package.json:25`). README line 261-263 uses `cd packages/mcp-server && npm run dev` (workspace-local). Both work; both should be presented as equivalent options. Minor consistency: the smoke-test section could cite `npm run dev:mcp` from the repo root as the simpler alternative.

**Fix:**
In README §"Smoke Test: MCP Inspector — Two-terminal procedure", add a one-liner above the `cd packages/mcp-server` block:

```markdown
**Terminal 1 — boot the Worker locally** (from repo root):

```bash
npm run dev:mcp
```

Or, equivalently, from the package directory:

```bash
cd packages/mcp-server
npm run dev
```
```

---

_Reviewed: 2026-05-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
