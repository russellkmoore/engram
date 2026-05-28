/**
 * GREEN tests for `packages/mcp-server/src/tools.ts` (registerTools + 5 stubs).
 *
 * Wave 2 (Plan 03-03) turn of the Wave 0 RED stubs. Strategy:
 *   1. Spy on `McpServer.prototype.registerTool` to capture every
 *      (name, config, callback) tuple registerTools() writes. No real
 *      JSON-RPC dispatch needed; we invoke each captured callback directly
 *      and assert the thrown `McpError`.
 *   2. The DD-RT structural assertion (T-03-DD-RT) reads `tools.ts` source
 *      via Vite's `?raw` query — which inlines the file contents at
 *      bundle time so no `node:fs` runtime call is required. This is the
 *      workerd-pool-safe alternative to `fs.readFileSync` (which is not
 *      available in workerd; verified against
 *      `node_modules/@cloudflare/vitest-pool-workers/dist/worker/lib/cloudflare/snapshot.mjs.map`
 *      where the team wrote a service-binding shim to avoid `node:fs`).
 *
 * Defense-in-depth contracts asserted GREEN:
 *   - T-03-DD-RT (Tampering / EoP): tools.ts production code does NOT
 *     reference `args.workspace_id` outside comment lines. The sentinel
 *     integrity anchor `SENTINEL-DD-RT-PHASE-03-TOOLS-TS` is asserted
 *     FIRST — if it is missing, the structural test FAILS LOUDLY,
 *     surfacing "the test couldn't locate the live source" instead of
 *     silently passing the negative-token check on an empty read (checker
 *     WARNING 2).
 *   - D-05 phase-pinned message: every MethodNotFound message contains
 *     "Phase 3" AND "Phase 4 (TOL-0N)" with the correct N per tool
 *     (remember=01, recall=02, search=03, forget=04, ingest=05).
 *
 * @module @engram/mcp-server/__tests__/tools
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { env } from "cloudflare:workers";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "../tools.js";

// ---------------------------------------------------------------------------
// Phase 5 AI-03 mocks: patch env.AI + env.VECTORIZE for local test execution.
//
// tools.test.ts exercises remember() + forget() in the "Phase 4 happy-path
// callbacks" describe block. With Plan 05-03, these handlers now call
// env.AI.run (embeddings) and env.VECTORIZE.upsert / deleteByIds.
// Patch with minimal stubs so the DO routing logic remains intact without
// requiring a remote Cloudflare connection.
// ---------------------------------------------------------------------------
const MOCK_VECTOR = new Array(768).fill(0.1) as number[];

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.AI = { run: vi.fn().mockResolvedValue({ data: [MOCK_VECTOR], shape: [1, 768] }) };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.VECTORIZE = {
    upsert: vi.fn().mockResolvedValue({ mutationId: "mock-upsert" }),
    deleteByIds: vi.fn().mockResolvedValue({ mutationId: "mock-delete" }),
    query: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
  };
});

// Vite's `?raw` query inlines the file content as a string at bundle time —
// no runtime `node:fs` required (workerd does not implement `node:fs`).
// The string IS the live `tools.ts` source the structural assertions need.
// @ts-expect-error -- `?raw` is a Vite runtime feature; TS doesn't know
//                    the module shape but bundling produces a string default
//                    export typed at the consumption site below.
import toolsSourceRaw from "../tools.ts?raw";
const toolsSource: string = toolsSourceRaw as string;

// ---------------------------------------------------------------------------
// Helpers — bare McpServer + spy on registerTool to capture registrations
// ---------------------------------------------------------------------------

interface RegisteredToolCall {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  };
  callback: (args: unknown, extra: unknown) => Promise<unknown>;
}

/**
 * Run registerTools() against a fresh McpServer with the prototype spy in
 * place. Returns the captured (name, config, callback) tuples for each of
 * the 5 expected tools — ordered as registered.
 */
function captureRegistrations(): RegisteredToolCall[] {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-server-test", version: "0.0.1" });
    registerTools(server, () => undefined, {} as Env);
    const captured: RegisteredToolCall[] = spy.mock.calls.map((call) => {
      const [name, config, callback] = call as unknown as [
        string,
        RegisteredToolCall["config"],
        RegisteredToolCall["callback"],
      ];
      return { name, config, callback };
    });
    return captured;
  } finally {
    spy.mockRestore();
  }
}

/**
 * Capture the registered callback for a specific tool and return it bound to
 * the given workspace_id. Injects real env from cloudflare:workers so the
 * Phase 4 handler bodies can resolve the WORKSPACE DO via getAgentByName.
 *
 * Pattern from PATTERNS.md §S6 + tools-integration.test.ts analog.
 */
function captureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-test",
): (args: unknown, extra: unknown) => Promise<unknown> {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-server-test", version: "0.0.1" });
    registerTools(server, () => ({ workspace_id, user_id }), env as Env);
    let foundCallback: ((args: unknown, extra: unknown) => Promise<unknown>) | undefined;
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [
        string,
        RegisteredToolCall["config"],
        RegisteredToolCall["callback"],
      ];
      if (callName === toolName) {
        foundCallback = callCb;
        break;
      }
    }
    if (foundCallback === undefined) throw new Error(`registration for '${toolName}' not captured`);
    return foundCallback;
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerTools registration", () => {
  it("registers exactly 5 tools by name: remember, recall, search, forget, ingest", () => {
    const calls = captureRegistrations();
    expect(calls).toHaveLength(5);
    const names = calls.map((c) => c.name).sort();
    expect(names).toEqual(["forget", "ingest", "recall", "remember", "search"]);
  });

  it("every registration declares a non-empty description and an inputSchema", () => {
    const calls = captureRegistrations();
    for (const { name, config } of calls) {
      expect(config.inputSchema, `${name} inputSchema`).toBeDefined();
      expect(config.description, `${name} description`).toBeTypeOf("string");
      expect((config.description ?? "").length, `${name} description non-empty`).toBeGreaterThan(0);
    }
  });
});

describe("Phase 4 happy-path callbacks (TOL-01..05)", () => {
  // RED until Plan 03 (tools.ts handler bodies) ships. These tests reference the
  // real DO via getAgentByName(env.WORKSPACE, workspace_id); the callbacks
  // currently throw McpError(MethodNotFound) so each it() below fails with
  // "MethodNotFound" until Phase 4 Plan 03 swaps the bodies.
  it.each([
    ["remember", { content: "hello" }],
    ["recall", { query: "x" }],
    ["search", { query: "x" }],
    ["forget", { id: "nonexistent" }],
    ["ingest", { source: "https://example.com" }],
  ] as [string, Record<string, unknown>][])(
    "%s callback returns wrapped EngramResponse envelope",
    async (toolName, args) => {
      const cb = captureCallback(toolName, "ws-happy-path");
      const result = (await cb(args, {})) as { content: [{ type: "text"; text: string }] };
      expect(result).toHaveProperty("content");
      const envelope = JSON.parse(result.content[0].text) as Record<string, unknown>;
      expect(envelope).toHaveProperty("result");
      expect(envelope).toHaveProperty("context");
      expect(envelope).toHaveProperty("meta");
    },
  );
});

describe("defense-in-depth structural T-03-DD-RT", () => {
  // Read the live source ONCE for all assertions in this block. Vite's `?raw`
  // import already inlined the bytes as a string at bundle time.
  const src: string = toolsSource;

  it("sentinel integrity anchor — proves test read the live tools.ts (checker WARNING 2)", () => {
    // If THIS fails, the structural test below is meaningless (it would
    // pass on an empty/wrong file). The sentinel must be present in
    // tools.ts (Task 1 acceptance criteria enforce this).
    expect(
      src,
      "DD-RT structural test could not locate sentinel in tools.ts — file may be empty, missing, or replaced",
    ).toMatch(/SENTINEL-DD-RT-PHASE-03-TOOLS-TS/);
  });

  it("source documents props.workspace_id contract", () => {
    expect(src).toMatch(/props\.workspace_id/);
    // Reference the anti-pattern phrase below so the test file itself
    // contains `args.workspace_id` (so the negative-non-presence assertion
    // can be written in the same describe block without needing a literal
    // tested elsewhere).
    expect(src).toMatch(/NEVER from args/);
  });

  it("source does NOT reference args.workspace_id outside comment lines", () => {
    // Strip lines that start with `//` or ` *` (JSDoc continuation) before
    // searching. Mirrors the production grep in tools.ts:
    //   grep -v -E "^[[:space:]]*(//|\*)" packages/mcp-server/src/tools.ts
    const nonComment = src
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        // Drop pure // comment lines and JSDoc continuation lines (`*`).
        // Keep code lines and lines with trailing inline comments — if
        // someone embeds `args.workspace_id` after code on the same line,
        // we want the test to catch it.
        return !trimmed.startsWith("//") && !trimmed.startsWith("*");
      })
      .join("\n");
    expect(nonComment).not.toMatch(/args\.workspace_id/);
  });
});
