/**
 * `@engram/mcp-server` entry — Phase 3 final integration.
 *
 * Cross-phase contract:
 * - **Phase 3 Wave 3 (this plan, 03-05):** the Phase 1 type-witness pong handler
 *   is REMOVED; the default export is `new OAuthProvider({...})` wrapping
 *   `EngramMcp.serve("/mcp")` as the `apiHandler` and `defaultHandler` (from
 *   `./oauth.js`) as the catch-all. This is the OAuth Resource Server pattern
 *   (D-01) co-deployed with the Authorization Server endpoints (D-07).
 * - **Phase 3 Wave 1+ (consumer contract):** the exported `EngramProps`
 *   interface is the agreed shape of `this.props` after the OAuth provider's
 *   `completeAuthorization({ props: { workspace_id, user_id } })` call. Tools
 *   (`./tools.ts`) and OAuth (`./oauth.ts`) consume it via type-only imports.
 * - **Phase 4+:** tool-handler bodies (TOL-01..05) read `this.props.workspace_id`
 *   exclusively — NEVER `args.workspace_id` — per Phase 2 STO-07 / MCP-05
 *   defense-in-depth contract.
 *
 * Design notes (locked):
 * - `EngramProps` extends `Record<string, unknown>` (RESEARCH §Pattern 1) so
 *   the `agents/mcp` `McpAgent<Env, State, Props>` third type parameter accepts
 *   it under the SDK's `Props extends Record<string, unknown>` constraint.
 * - `EngramMcp.init()` calls `registerTools(this.server, () => this.props,
 *   this.env)` with the LAZY props getter — the closure captures the live
 *   `this.props` so token refresh (RESEARCH Pitfall 6 / Open Question 4) is
 *   reflected on the next tool call.
 * - The `Env` type used by `McpAgent<Env, unknown, EngramProps>` is sourced
 *   from the wrangler-generated `worker-configuration.d.ts` global declaration
 *   — NO local `interface Env` declaration here (T-03-ENV-DRIFT mitigation,
 *   checker WARNING 1).
 * - The OAuthProvider library auto-mounts `/.well-known/oauth-protected-resource`,
 *   `/.well-known/oauth-authorization-server`, `/jwks` — they bypass
 *   `defaultHandler`. The library's `/authorize` is intercepted before
 *   reaching `defaultHandler` UNLESS the configured `authorizeEndpoint` path
 *   matches — RESEARCH Pattern 3 + Pitfall 4 documents the dispatch order.
 *
 * @module @engram/mcp-server
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { registerTools } from "./tools.js";
import { defaultHandler } from "./oauth.js";

/**
 * `EngramProps` — shape of `this.props` on an `EngramMcp` instance after OAuth
 * authorization completes.
 *
 * Populated by `OAuthProvider.completeAuthorization({ props: { workspace_id,
 * user_id } })` in `./oauth.ts`. Read by tool-handler bodies in Phase 4
 * (TOL-01..05). The two fields are derived from the `ENGRAM_IDENTITIES` KV
 * namespace lookup keyed on the OAuth `sub` claim (D-04).
 *
 * Extending `Record<string, unknown>` satisfies the
 * `McpAgent<Env, State, Props extends Record<string, unknown>>` constraint
 * from `agents/mcp`.
 */
export interface EngramProps extends Record<string, unknown> {
  workspace_id: string;
  user_id: string;
}

/**
 * `EngramMcp` — the session DO declared in `wrangler.jsonc` under
 * `migrations[1].new_sqlite_classes: ["EngramMcp"]` (D-09).
 *
 * The class generic position `McpAgent<Env, unknown, EngramProps>` resolves
 * `Env` through the wrangler-codegen global declaration in
 * `worker-configuration.d.ts` — which types `MCP_OBJECT:
 * DurableObjectNamespace<EngramMcp>` and `WORKSPACE:
 * DurableObjectNamespace<WorkspaceDO>`. The two new KV bindings declared by
 * this plan (`OAUTH_KV`, `ENGRAM_IDENTITIES`) appear on the same codegen
 * `Env` after `wrangler types` regeneration.
 */
export class EngramMcp extends McpAgent<Env, unknown, EngramProps> {
  server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" });

  /**
   * `init()` — wires the 5 v0.1 MCP tools onto `this.server`. Invoked once per
   * session-DO instance by `agents/mcp` after `this.props` is populated by the
   * OAuthProvider's `completeAuthorization` callback. The lazy `() => this.props`
   * getter ensures that if `agents/mcp` rebinds `this.props` after a token
   * refresh (RESEARCH Pitfall 6), the next tool callback sees the fresh value.
   */
  /* eslint-disable @typescript-eslint/require-await --
     `registerTools` is synchronous (each `server.registerTool` is sync). The
     `async` keyword is kept because `McpAgent.init()` is typed
     `init(): Promise<void> | void` and Phase 4 may add async setup (e.g.,
     warm-loading user preferences from `this.env`). Keeping the keyword now
     means Phase 4 edits are body-only. Mirrors the pattern used in
     packages/mcp-server/src/tools.ts for the stub callbacks. */
  async init(): Promise<void> {
    registerTools(this.server, () => this.props, this.env);
  }
  /* eslint-enable @typescript-eslint/require-await */
}

// Re-export the DO class from @engram/workspace-do so wrangler can bind it from this script.
export { WorkspaceDO } from "@engram/workspace-do";

/**
 * Default export — the OAuthProvider-wrapped Worker entry point.
 *
 * Dispatch order (RESEARCH §System Architecture Diagram + Pitfall 4):
 *   1. Library-owned well-known + token + jwks + register routes are matched first.
 *   2. `apiRoute: "/mcp"` → `apiHandler` (EngramMcp.serve via the DO namespace).
 *      OAuthProvider validates the bearer JWT BEFORE dispatching to apiHandler.
 *   3. Everything else → `defaultHandler` (./oauth.ts) — `/`, `/health`,
 *      `/authorize` (KV lookup + completeAuthorization).
 *
 * The `EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })` call returns an
 * `ExportedHandler` whose `fetch` routes the inbound request to the
 * `MCP_OBJECT` namespace by session id (per `agents/mcp` convention).
 */
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }),
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
