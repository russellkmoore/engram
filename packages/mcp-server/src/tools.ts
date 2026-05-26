/**
 * `registerTools` — register the 5 v0.1 MCP tools as stubs on an `McpServer`.
 *
 * Cross-phase contract:
 * - **Phase 3 (this plan, 03-03):** ships the registration + stub callback for
 *   each of the 5 v0.1 tools (`remember`, `recall`, `search`, `forget`,
 *   `ingest`). Every callback body is exactly one line — throw
 *   `McpError(ErrorCode.MethodNotFound)` with a message pinned to "Phase 3" +
 *   "Phase 4 (TOL-0N)" per D-05. The SDK auto-validates the input via
 *   `inputSchema` BEFORE invoking the callback (verified against
 *   `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150-157`),
 *   so the stubs can ignore `args` entirely.
 * - **Phase 3 Plan 05 (downstream consumer):** `EngramMcp.init()` will call
 *   `registerTools(this.server, () => this.props, this.env)` after the OAuth
 *   provider's `completeAuthorization` populates `this.props`. The
 *   `getProps` parameter is a closure so each invocation re-reads the
 *   freshest `this.props` (per RESEARCH Open Question 4 — props may rebind
 *   across token refresh).
 * - **Phase 4 (TOL-01..05):** each callback body is swapped for the
 *   Phase-4-ready handler shape documented in the comment block below. The
 *   registration shape and identity (name + description + inputSchema) stay
 *   STABLE — Phase 4 plans literally diff against this file's callbacks.
 *
 * Design notes (locked):
 * - Schemas are imported from `./schemas.js`; this file declares ZERO inline
 *   schemas (D-06 — schemas.ts is the single source of truth). The
 *   `inputSchema` field of each `registerTool` config receives `<Schema>.shape`
 *   (ZodRawShape), NOT the `z.object` wrapper — that is what the SDK expects.
 * - `EngramProps` is imported `type`-only from `./index.js` (Wave 0
 *   contract). This avoids a Plan-05 circular dependency on `./tools.js`.
 * - `_env` is parameter-prefixed because Phase 3 stubs do not touch the Worker
 *   environment; Phase 4 handlers will dereference `env.WORKSPACE` to call
 *   `getAgentByName`. The eslint config's `argsIgnorePattern` (or its
 *   absence) drove the renaming convention.
 * - Tool descriptions are sourced from CLAUDE.md §"MCP Tool Surface" so the
 *   MCP Inspector smoke (MCP-09) lists the canonical descriptions.
 *
 * Threat model:
 * - **T-03-DD-RT (Tampering / Elevation of Privilege):** mitigated
 *   structurally. (1) Stubs throw before consuming `args`, so even if a
 *   future contributor smuggled a `workspace_id` field through the schema,
 *   no Phase 3 callback would read it. (2) The Phase-4-ready comment block
 *   below documents the canonical handler shape — `await
 *   getAgentByName(env.WORKSPACE, props.workspace_id)` + `args.workspace_id:
 *   props.workspace_id` — and explicitly forbids reading `workspace_id`
 *   from `args` (tool input). (3) `src/__tests__/tools.test.ts` asserts the
 *   non-comment body of this file does NOT contain the literal string
 *   `args.workspace_id` — any regression that wires tool input as the
 *   workspace source fails CI. (4) A unique DD-RT sentinel comment
 *   (declared verbatim inside the Phase-4-ready comment block below) is
 *   the integrity anchor that proves the structural test actually read
 *   the live source — checker WARNING 2.
 * - **T-03-MSG (Information Disclosure):** mitigated. `MethodNotFound`
 *   message strings mention ONLY "Phase 3" and "Phase 4 (TOL-0N)". No DB
 *   internals, no env values, no stack traces.
 * - **T-03-DOS (Denial of Service):** accepted. Stubs throw immediately and
 *   consume no resources; rate-limiting + budget checks are MCP-08
 *   (Phase 4).
 *
 * Plan boundaries:
 * - This module is owned by Plan 03-03 (Wave 2). Plan 03-05 wires the call
 *   site (`EngramMcp.init()`). Phase 4 (TOL-01..05) ships the real bodies.
 *
 * @module @engram/mcp-server/tools
 */
// packages/mcp-server/src/tools.ts
// Source: 03-RESEARCH.md §Pattern 4 (registerTool API verified against
//         node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150).
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

/**
 * Register the 5 v0.1 MCP tools on the given `McpServer`. Every callback is
 * a Phase 3 stub that throws `McpError(MethodNotFound)` — Phase 4 swaps the
 * callback body while preserving the registration.
 *
 * @param server   the `McpServer` instance owned by `EngramMcp` (Plan 03-05
 *                 wires this from `this.server`).
 * @param getProps a closure returning the live `EngramProps` (`undefined`
 *                 before OAuth `completeAuthorization` has run). Phase 3
 *                 stubs do not call this — Phase 4 handlers will.
 * @param _env     the Worker `Env`. Phase 3 stubs do not dereference it —
 *                 Phase 4 handlers will read `env.WORKSPACE` for the
 *                 `getAgentByName` lookup.
 */
export function registerTools(
  server: McpServer,
  getProps: () => EngramProps | undefined,
  _env: Env,
): void {
  // --------------------------------------------------------------------------
  // Phase-4-ready handler shape — DOCUMENTATION ONLY (Phase 3 stubs throw
  // before reaching any of this). Phase 4 plans (TOL-01..05) literally diff
  // each callback body against the canonical shape below.
  //
  // Source: VERIFIED against `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts`
  //         `getAgentByName(namespace, name)` returns `Promise<DurableObjectStub<T>>`
  //         — MUST be awaited (per RESEARCH.md Pitfall 1).
  //
  // SENTINEL-DD-RT-PHASE-03-TOOLS-TS — do not remove; structural test depends on this
  //
  // Defense-in-depth (T-03-DD-RT / MCP-05 / Phase 2 STO-07):
  //   The workspace_id is ALWAYS sourced from `props.workspace_id` (JWT-
  //   derived), NEVER from args (tool input). Any future handler that
  //   reads `args.workspace_id` breaks the defense-in-depth invariant —
  //   the test `tools.test.ts` asserts the production code does NOT
  //   contain `args.workspace_id` outside comment lines.
  //
  // Tool → TOL → WorkspaceDO method mapping:
  //   remember → TOL-01 → insertBlock({ workspace_id, block })
  //   recall   → TOL-02 → lexicalSearchBlocks({ workspace_id, query, limit? })
  //                       (Phase 5 swaps to semantic search via Vectorize)
  //   search   → TOL-03 → lexicalSearchBlocks({ workspace_id, query, limit? })
  //                       (with structured filters layered on top)
  //   forget   → TOL-04 → deleteBlock({ workspace_id, id, cascade? })
  //   ingest   → TOL-05 → (no direct WorkspaceDO method — Phase 6 wires
  //                        the Queue producer; Phase 3 stub will likely be
  //                        the last to lift its MethodNotFound)
  //
  // Canonical Phase-4-ready handler skeleton (for `remember`; others mirror):
  //
  //   async (args, _extra) => {
  //     const props = getProps();
  //     if (props === undefined) {
  //       throw new McpError(
  //         ErrorCode.InvalidRequest,
  //         "Missing authentication context",
  //       );
  //     }
  //     try {
  //       const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
  //       stub.insertBlock({
  //         workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args (NEVER from tool input)
  //         block: { /* ...derived from args... */ },
  //       });
  //       return { content: [{ type: "text", text: "..." }] };
  //     } catch (err) {
  //       throw mapToMcpError(err);  // src/error-mapping.ts
  //     }
  //   }
  //
  // The two-key invariant (Plan 03-04 T-03-PROPS):
  //   `props` carries EXACTLY `{ workspace_id, user_id }` — no extraneous
  //   fields. Combined with `assertOwnsWorkspace` inside WorkspaceDO (Phase 2
  //   STO-07), this is the defense-in-depth chain that prevents a forged
  //   workspace_id from reaching SQLite.
  // --------------------------------------------------------------------------

  /* eslint-disable @typescript-eslint/require-await --
     Phase 3 stub callbacks throw synchronously. The `async` keyword is kept
     because (a) `McpServer.registerTool` types the callback as
     `(args, extra) => Promise<CallToolResult>`, and (b) Phase 4 swaps each
     body for a real async implementation (await getAgentByName(...) +
     stub.<method>(...)). Keeping the keyword now means Phase 4 edits stay
     limited to the body. */

  // remember(content, type?, project?, tags?, source?, expires?)
  server.registerTool(
    "remember",
    {
      description:
        "Store a memory in the user's workspace. Returns the stored memory with classified type, extracted fields, and detected conflicts.",
      inputSchema: RememberInputSchema.shape,
    },
    async () => {
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

  /* eslint-enable @typescript-eslint/require-await */

  // Reference unused parameters so a future Phase 4 implementation has the
  // callable + env available — suppresses unused-var lint until then. Plan
  // 05's `EngramMcp.init()` will pass `() => this.props` and `this.env`.
  void getProps;
  void _env;
}
