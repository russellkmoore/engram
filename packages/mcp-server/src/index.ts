/**
 * `@engram/mcp-server` entry — Phase 3 Wave 0: EngramProps publication.
 *
 * Cross-phase contract:
 * - **Phase 1 (current default export):** the `export default { fetch() }`
 *   block below is the Phase 1 type-witness pong handler. It MUST remain
 *   operational until Plan 03-05 swaps it for `new OAuthProvider({...})` —
 *   Wave 0's job is to publish the `EngramProps` interface and align the
 *   `EngramMcp` class generic position, NOT to swap the default export.
 * - **Phase 3 Wave 1+ (cross-plan contract):** the exported `EngramProps`
 *   interface is the agreed shape of `this.props` after the OAuth provider's
 *   `completeAuthorization({ props: { workspace_id, user_id } })` call. Every
 *   downstream plan (schemas, tools, oauth) imports it from this module via
 *   `import type { EngramProps } from "../index.js"` to avoid a circular
 *   dependency on `./tools.js` or `./oauth.js`.
 * - **Phase 4+:** tool-handler bodies (TOL-01..05) read `this.props.workspace_id`
 *   exclusively — NEVER `args.workspace_id` — per Phase 2 STO-07 / MCP-05
 *   defense-in-depth contract.
 *
 * Design notes (locked):
 * - `EngramProps` extends `Record<string, unknown>` (RESEARCH §Pattern 1) so the
 *   `agents/mcp` `McpAgent<Env, State, Props>` third type parameter accepts it
 *   under the SDK's `Props extends Record<string, unknown>` constraint.
 * - The `EngramMcp` class generic position becomes `extends McpAgent<Env, unknown,
 *   EngramProps>` here in Wave 0 so Wave 1+ files can rely on the type contract
 *   without code in this file having to depend on `./tools.js` yet.
 * - A LOCAL `interface Env { ... }` is declared below as a Wave 0 type witness.
 *   Plan 05 regenerates `worker-configuration.d.ts` via `wrangler types` once
 *   the new KV bindings (`ENGRAM_IDENTITIES`, `OAUTH_KV`) land in
 *   `wrangler.jsonc`, and removes this local interface in favor of the codegen.
 *   Until then, this local interface lets the generic position typecheck.
 *
 * @module @engram/mcp-server
 */
// packages/mcp-server/src/index.ts
// Phase 1: placeholder. Phase 3 Plan 05 replaces with `export default new OAuthProvider({...})`.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// FND-04 consumer smoke: importing all 5 v0.1 types via @engram/types proves
// the workspace TS-source exports field resolves under moduleResolution: "bundler".
import type { MemoryEvent, Memory, Entity, EngramResponse, Conflict } from "@engram/types";

// FND-05 consumer smoke: importing SYSTEM_TYPES via @engram/schema proves the
// schema package is consumable from a Worker context.
import { SYSTEM_TYPES } from "@engram/schema";

/**
 * `EngramProps` — shape of `this.props` on an `EngramMcp` instance after OAuth
 * authorization completes.
 *
 * Populated by `OAuthProvider.completeAuthorization({ props: { workspace_id,
 * user_id } })` in Plan 03-04 (`./oauth.ts`). Read by tool-handler bodies in
 * Phase 4 (TOL-01..05). The two fields are derived from the
 * `ENGRAM_IDENTITIES` KV namespace lookup keyed on the OAuth `sub` claim
 * (D-04).
 *
 * Extending `Record<string, unknown>` satisfies the
 * `McpAgent<Env, State, Props extends Record<string, unknown>>` constraint
 * from `agents/mcp`.
 */
export interface EngramProps extends Record<string, unknown> {
  workspace_id: string;
  user_id: string;
}

// `Env` is sourced from the wrangler-generated `worker-configuration.d.ts`
// (regenerated via `npm run types:gen` from the package directory, or
// `npm run types:gen` from the workspace root). The generated file emits
// `interface Env extends __BaseEnv_Env {}` with `MCP_OBJECT:
// DurableObjectNamespace<EngramMcp>` and `WORKSPACE:
// DurableObjectNamespace<WorkspaceDO>`. Plan 05 adds the KV bindings
// (`ENGRAM_IDENTITIES`, `OAUTH_KV`) and the secret (`COOKIE_ENCRYPTION_KEY`)
// to wrangler.jsonc, after which `types:gen` regenerates the same `Env`
// shape with the new bindings — no source edit here needed.

// Declared so the DO binding in wrangler.jsonc has a target class — Phase 3 Plan 05 fills it in.
// Abstract members `server` and `init` remain Phase 1 no-ops here; Plan 05 swaps them.
// The generic position `McpAgent<Env, unknown, EngramProps>` is published in Wave 0 so
// Wave 1+ schema / tool / oauth files can import `EngramProps` without a circular
// dependency on the as-yet-unimplemented `./tools.js` or `./oauth.js` modules.
export class EngramMcp extends McpAgent<Env, unknown, EngramProps> {
  // Phase 1 stub: minimal McpServer instance satisfies the abstract property requirement.
  // Phase 3 Plan 05 registers all Engram MCP tools here.
  server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" });

  // Phase 1 stub: init() is a required abstract method from McpAgent.
  // Phase 3 Plan 05 populates this with `registerTools(this.server, () => this.props, this.env)`.
  async init(): Promise<void> {
    // no-op in Phase 1 — Plan 05 replaces this body
  }
}

// Re-export the DO class from @engram/workspace-do so wrangler can bind it from this script.
export { WorkspaceDO } from "@engram/workspace-do";

// Reference the imported types so tsc -b doesn't drop them as unused (verbatimModuleSyntax
// requires type-only imports to be used at the type position; we annotate the handler).
interface Phase1Pong {
  ok: true;
  worker: "engram-mcp-server";
  phase: 1;
  // The next fields are not serialized — they are type-witnesses proving the imports resolve.
  _types?: {
    memoryEvent?: MemoryEvent;
    memory?: Memory;
    entity?: Entity;
    envelope?: EngramResponse<unknown>;
    conflict?: Conflict;
  };
  systemTypesCount: number;
}

// Phase 1 default export — Plan 03-05 replaces this with `new OAuthProvider({...})`.
// PRESERVED here in Wave 0: the pong shape, the system-type witness, and the type
// witnesses for @engram/types canonical shapes.
export default {
  fetch(): Response {
    const body: Phase1Pong = {
      ok: true,
      worker: "engram-mcp-server",
      phase: 1,
      systemTypesCount: SYSTEM_TYPES.length,
    };
    return Response.json(body);
  },
};
