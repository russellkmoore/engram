// packages/mcp-server/src/index.ts
// Phase 1: placeholder. Phase 3 replaces with `export default EngramMcp.serve("/mcp")`.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// FND-04 consumer smoke: importing all 5 v0.1 types via @engram/types proves
// the workspace TS-source exports field resolves under moduleResolution: "bundler".
import type { MemoryEvent, Memory, Entity, EngramResponse, Conflict } from "@engram/types";

// FND-05 consumer smoke: importing SYSTEM_TYPES via @engram/schema proves the
// schema package is consumable from a Worker context.
import { SYSTEM_TYPES } from "@engram/schema";

// Declared so the DO binding in wrangler.jsonc has a target class — Phase 3 fills it in.
// Abstract members `server` and `init` are implemented as no-ops for Phase 1.
// Phase 3 will replace these with real MCP tool registration and server configuration.
export class EngramMcp extends McpAgent {
  // Phase 1 stub: minimal McpServer instance satisfies the abstract property requirement.
  // Phase 3 registers all Engram MCP tools here.
  server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" });

  // Phase 1 stub: init() is a required abstract method from McpAgent.
  // Phase 3 populates this with tool registrations.
  async init(): Promise<void> {
    // no-op in Phase 1
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
