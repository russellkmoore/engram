/**
 * OAuth `defaultHandler` + public-routes handler for `@engram/mcp-server`.
 *
 * This module exports `defaultHandler`, the standard Cloudflare Workers
 * `ExportedHandler<EngramOAuthEnv>` consumed by `@cloudflare/workers-oauth-provider`'s
 * `OAuthProvider` as the non-API fall-through. The provider routes everything
 * matching `apiRoute: "/mcp"` to its `apiHandler` (the `EngramMcp.serve("/mcp")`
 * McpAgent path); everything else lands here.
 *
 * Cross-phase contract:
 * - **Wave 1+ schemas / tools:** `props.{workspace_id, user_id}` are sourced
 *   EXCLUSIVELY from a `ENGRAM_IDENTITIES` KV lookup keyed on the OAuth `sub`
 *   claim. Tool handlers in Phase 4 read these via `this.props` (T-03-PROPS
 *   defense-in-depth — D-04).
 * - **Plan 05 (`index.ts`):** wires this handler into the OAuthProvider default
 *   export via `defaultHandler`. This module does NOT export the OAuthProvider
 *   itself — that lives in `index.ts` after Plan 05 ships.
 * - **Plan 06 (DEP-05 README):** documents the 2-step bootstrap flow that
 *   surfaces the `Unknown OAuth subject` error from the 403 path below — Russell
 *   reads the `sub` from the error, runs `npm run kv:bootstrap -- --sub <sub>`,
 *   retries.
 *
 * Design notes (locked):
 * - **T-03-PROPS (Spoofing/EoP, threat register):** the `/authorize` handler
 *   sources `props.{workspace_id, user_id}` ONLY from `await
 *   env.ENGRAM_IDENTITIES.get(sub)` — never from request body, query params,
 *   headers, or the `metadata`/`scope` fields. `completeAuthorization()` is
 *   invoked with a literal `{ workspace_id: identity.workspace_id, user_id:
 *   identity.user_id }` props object — the 2-key literal shape is structurally
 *   enforced.
 * - **T-03-KV-LEAK (Information Disclosure):** the 403 response body contains
 *   ONLY the literal string `Unknown OAuth subject: ${sub}. Bootstrap via npm
 *   run kv:bootstrap.` — never the KV value content (the key is missing, so
 *   the value is null anyway; this comment locks the invariant for future
 *   contributors). The `sub` itself is echoed because it IS the requester's
 *   own dynamically-registered client id — already known to them.
 * - **T-03-PARSE (Tampering):** `JSON.parse(raw)` is wrapped in try/catch. On
 *   parse failure the 500 response body is the SANITIZED literal `Internal
 *   error: corrupt identity record` — never the raw value content, never the
 *   parser error message (which could include malformed-JSON fragments).
 * - **D-08 public routes (no auth):** GET `/` returns project info JSON; GET
 *   `/health` returns status JSON. Both bypass OAuth by design — the
 *   OAuthProvider dispatches them to `defaultHandler` without JWT validation
 *   because they are not matched by `apiRoute: "/mcp"`. NEVER add a secret or
 *   identity-bearing field to these payloads.
 * - **`sub` claim source (v0.1 simplification, RESEARCH Open Question 3):**
 *   `sub = oauthReqInfo.clientId`. This is the dynamic-registered client id
 *   for `mcp-remote`'s first-token flow; Plan 06's smoke captures the observed
 *   value and Russell bootstraps the KV entry. v0.2 may replace this with a
 *   real login + consent UI; the contract here (props derived from KV only)
 *   does not change.
 * - **Env shape:** `EngramOAuthEnv` extends the wrangler-codegen `Env`
 *   interface (from `worker-configuration.d.ts`, which after Plan 05 ships
 *   types `MCP_OBJECT`, `WORKSPACE`, `OAUTH_KV`, and `ENGRAM_IDENTITIES`
 *   directly) with the single runtime helper injected by the OAuth library
 *   (`OAUTH_PROVIDER`). `OAUTH_PROVIDER` is NOT a wrangler binding — it is
 *   surfaced by `@cloudflare/workers-oauth-provider` at request-dispatch
 *   time, so it must live in this module-scoped augmentation rather than
 *   in wrangler.jsonc / worker-configuration.d.ts (T-03-ENV-DRIFT — checker
 *   WARNING 1: the codegen Env owns every binding-derived field; only the
 *   non-binding library surface is extended here).
 *
 * @module @engram/mcp-server/oauth
 */
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Parsed shape of an `ENGRAM_IDENTITIES` KV value.
 *
 * The KV value is written ONLY by `scripts/kv-bootstrap.mjs` (D-04, Plan 01)
 * via `wrangler kv key put`. Key = OAuth `sub` claim. Value = JSON-serialized
 * `{ workspace_id, user_id }` record.
 */
interface IdentityRecord {
  workspace_id: string;
  user_id: string;
}

/**
 * Environment augmentation for the OAuth `defaultHandler`.
 *
 * Extends the wrangler-codegen global `Env` (which after Plan 05 ships types
 * `MCP_OBJECT` → `EngramMcp`, `WORKSPACE` → `WorkspaceDO`, `OAUTH_KV` →
 * `KVNamespace`, and `ENGRAM_IDENTITIES` → `KVNamespace`) with the SINGLE
 * runtime-injected surface from the OAuth library:
 * - `OAUTH_PROVIDER`: `OAuthHelpers` instance injected by
 *   `@cloudflare/workers-oauth-provider` at request-dispatch time. NOT a
 *   wrangler binding — does NOT appear in wrangler.jsonc and therefore does
 *   NOT appear in the regenerated `worker-configuration.d.ts`. This is the
 *   only field this augmentation contributes (T-03-ENV-DRIFT — every other
 *   binding-derived field flows from the codegen Env).
 */
interface EngramOAuthEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/**
 * `defaultHandler` — the OAuth provider's non-API fall-through.
 *
 * Serves three routes:
 *   - GET `/`         → project info JSON (D-08 public, no auth)
 *   - GET `/health`   → status JSON (D-08 public, no auth)
 *   - GET `/authorize` → KV lookup + completeAuthorization (D-04 / T-03-PROPS)
 *
 * Any other path returns 404. The OAuth library's well-known endpoints
 * (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
 * `/token`, `/jwks`, `/register`) are intercepted by the library BEFORE
 * `defaultHandler.fetch` runs — they never reach this code per RESEARCH
 * Pitfall 4.
 */
export const defaultHandler: ExportedHandler<EngramOAuthEnv> = {
  // `ctx` (ExecutionContext) is intentionally omitted: defaultHandler does
  // NOT call `waitUntil` or `passThroughOnException`. TypeScript permits
  // callbacks shorter than the declared signature; ESLint's no-unused-vars
  // would flag a `_ctx` parameter that exists only to satisfy the shape.
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // ---- D-08 public routes (no auth) --------------------------------------

    // GET / → project info JSON.
    // Lock: do NOT add identity-bearing fields here. The payload is intentionally
    // metadata-only; it advertises the public surface and nothing else.
    if (url.pathname === "/") {
      return Response.json({
        name: "engram-mcp-server",
        version: "0.1.0",
        mcp: "/mcp",
        oauth: "/.well-known/oauth-protected-resource",
        docs: "https://github.com/blackmagicconsulting/engram",
      });
    }

    // GET /health → status JSON.
    // Lock: status is always "ok" when this handler runs — the Worker itself
    // is responsive. Real degradation surfaces in the OAuthProvider /token
    // and /jwks library routes, not here.
    if (url.pathname === "/health") {
      // `globalThis.process.env.GIT_COMMIT` is populated at deploy time via
      // wrangler vars; falls back to "dev" for local/test runs where the
      // variable is unset.
      const commit =
        (globalThis as { process?: { env?: { GIT_COMMIT?: string } } }).process?.env?.GIT_COMMIT ??
        "dev";
      return Response.json({
        status: "ok",
        version: "0.1.0",
        commit,
        timestamp: Date.now(),
      });
    }

    // ---- D-04 OAuth authorize flow (KV lookup + completeAuthorization) -----

    if (url.pathname === "/authorize") {
      // parseAuthRequest + lookupClient are library-provided. Per RESEARCH
      // Pattern 3 / threat T-03-CALL, we deliberately do NOT wrap these in
      // try/catch — an invalid request or unknown client should propagate as
      // the library's RFC 6749 error response (typically a 400). defaultHandler
      // is only responsible for the consent-step semantics (KV lookup +
      // completeAuthorization).
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);

      // v0.1 simplification (RESEARCH Open Question 3 — RESOLVED):
      // for the single-user auto-approve flow, the OAuth `sub` claim equals
      // the dynamic-registered client id. Plan 06's manual smoke captures
      // the observed value and the bootstrap script writes the KV mapping.
      // v0.2 will replace this with a real consent UI; the contract below
      // (props derived from KV only) does not change.
      const sub = oauthReqInfo.clientId;

      const raw = await env.ENGRAM_IDENTITIES.get(sub);

      // T-03-KV-LEAK fail-closed path: the 403 body contains the literal
      // sub (which is already known to the requester) and the bootstrap
      // pointer — nothing else. Do NOT JSON.stringify the KV value (it's
      // null here anyway), and do NOT echo any request body / headers.
      if (raw === null) {
        return new Response(`Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.`, {
          status: 403,
        });
      }

      // T-03-PARSE: malformed KV value triggers a SANITIZED 500. The error
      // message must NOT include the raw value content (could contain
      // attacker-controlled JSON fragments) or the parser's error message
      // (which echoes the malformed input). The literal below is the only
      // text emitted on the failure path.
      let identity: IdentityRecord;
      try {
        identity = JSON.parse(raw) as IdentityRecord;
      } catch {
        return new Response("Internal error: corrupt identity record", {
          status: 500,
        });
      }

      // T-03-PROPS structural enforcement: `props` is constructed as a literal
      // 2-key object whose values come EXCLUSIVELY from `identity.*` (the
      // parsed KV record). No request-derived fields, no library defaults, no
      // additional keys. The cast to `Record<string, unknown>` aligns with
      // `EngramProps extends Record<string, unknown>` in `./index.ts`.
      const props: Record<string, unknown> = {
        workspace_id: identity.workspace_id,
        user_id: identity.user_id,
      };

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: identity.user_id,
        metadata: { label: "engram-v0.1" },
        scope: ["mcp:tools"],
        props,
      });

      return Response.redirect(redirectTo, 302);
    }

    // ---- 404 fall-through --------------------------------------------------
    return new Response("Not found", { status: 404 });
  },
};
