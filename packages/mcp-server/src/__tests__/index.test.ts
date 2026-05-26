/**
 * GREEN tests for `packages/mcp-server/src/index.ts` (Wave 3 integration).
 *
 * Wave 3 (Plan 03-05) turn of the Wave 0 RED stubs. Covers MCP-01/02/03:
 *   - MCP-01: index.ts uses `agents/mcp` McpAgent (no streamableHttp anti-pattern)
 *   - MCP-02: `EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" })` is the apiHandler
 *   - MCP-03: wrangler.jsonc migrations[] declares BOTH WorkspaceDO (v1) and
 *             EngramMcp (v2) under `new_sqlite_classes`
 *
 * Strategy (mirrors `tools.test.ts` for workerd-pool safety):
 *   1. `?raw` imports — `../index.ts?raw` and `../../wrangler.jsonc?raw` —
 *      inline both files as strings at bundle time. workerd does NOT
 *      implement `node:fs`, so the `?raw` query is the canonical
 *      Cloudflare-pool-safe alternative.
 *   2. Module-shape check — dynamic `import("../index.js")` and assert the
 *      default export exposes `.fetch` (OAuthProvider exposes a fetch handler).
 *   3. 5-tool registration — spy on `McpServer.prototype.registerTool`, then
 *      construct an `EngramMcp` via `runInDurableObject(env.MCP_OBJECT.get(...))`
 *      and call `instance.init()`. The spy captures all 5 registrations.
 *   4. Anti-pattern check (RESEARCH §Anti-Patterns line 626) — the inlined
 *      `index.ts` source MUST NOT contain `streamableHttp` (the raw MCP SDK
 *      HTTP transport that depends on `node:http` and won't run on workerd).
 *
 * @module @engram/mcp-server/__tests__/index
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { parse as parseJsonc } from "jsonc-parser";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Vite `?raw` query inlines the file content as a string at bundle time.
// No runtime `node:fs` required — workerd does not implement that module.
// @ts-expect-error -- `?raw` is a Vite runtime feature; TS doesn't know the
//                    module shape, but bundling produces a string default.
import indexSourceRaw from "../index.ts?raw";
const indexSource: string = indexSourceRaw as string;

// @ts-expect-error -- same `?raw` query, applied to wrangler.jsonc.
import wranglerJsoncRaw from "../../wrangler.jsonc?raw";
const wranglerJsonc: string = wranglerJsoncRaw as string;

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Module shape (MCP-01 + MCP-02 — OAuthProvider default export)
// ---------------------------------------------------------------------------

describe("module shape (MCP-01 / MCP-02 — OAuthProvider default export)", () => {
  it("default export exposes a fetch handler (OAuthProvider shape)", async () => {
    const mod = (await import("../index.js")) as {
      default: { fetch: (...args: unknown[]) => unknown };
    };
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });

  it("exports the EngramMcp class (McpAgent subclass)", async () => {
    const mod = (await import("../index.js")) as { EngramMcp: unknown };
    expect(typeof mod.EngramMcp).toBe("function");
  });

  it("re-exports WorkspaceDO from @engram/workspace-do (wrangler binding target)", async () => {
    const mod = (await import("../index.js")) as { WorkspaceDO: unknown };
    expect(typeof mod.WorkspaceDO).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// EngramMcp.init registers 5 tools (MCP-06 integration check)
// ---------------------------------------------------------------------------

describe("EngramMcp.init registers 5 tools (MCP-06 integration)", () => {
  it("init() registers exactly 5 tools by name — remember, recall, search, forget, ingest", async () => {
    const spy = vi.spyOn(McpServer.prototype, "registerTool");
    const id = env.MCP_OBJECT.idFromName("engram-mcp-init-test");
    const stub = env.MCP_OBJECT.get(id);
    await runInDurableObject(stub, async (instance) => {
      // EngramMcp inherits from McpAgent — `init()` is the public method
      // we wired in Plan 05's index.ts swap. Calling it directly bypasses
      // the McpAgent transport setup and is enough to drive the spy.
      const engramInstance = instance as unknown as { init(): Promise<void> };
      await engramInstance.init();
    });

    // 5 tools registered, in any order — we sort for stable assertion.
    expect(spy.mock.calls).toHaveLength(5);
    const names = spy.mock.calls.map((call) => call[0]).sort();
    expect(names).toEqual(["forget", "ingest", "recall", "remember", "search"]);
  });
});

// ---------------------------------------------------------------------------
// wrangler.jsonc v2 migration shape (MCP-03 / D-09)
// ---------------------------------------------------------------------------

describe("wrangler.jsonc v2 migration shape (MCP-03 / D-09)", () => {
  // Type assertion on the parsed JSONC — we know the shape we wrote.
  interface MigrationEntry {
    tag?: string;
    new_sqlite_classes?: string[];
    new_classes?: string[];
  }
  interface KvBinding {
    binding?: string;
    id?: string;
  }
  interface WranglerConfig {
    migrations?: MigrationEntry[];
    kv_namespaces?: KvBinding[];
  }

  it("migrations[] has v1 (WorkspaceDO) + v2 (EngramMcp) under new_sqlite_classes", () => {
    const config = parseJsonc(wranglerJsonc, [], {
      allowTrailingComma: true,
    }) as WranglerConfig;
    expect(config.migrations).toBeDefined();
    expect(config.migrations).toHaveLength(2);

    const v1 = config.migrations?.[0];
    expect(v1?.tag).toBe("v1");
    expect(v1?.new_sqlite_classes).toContain("WorkspaceDO");
    expect(v1?.new_classes).toBeUndefined(); // FND-08

    const v2 = config.migrations?.[1];
    expect(v2?.tag).toBe("v2");
    expect(v2?.new_sqlite_classes).toContain("EngramMcp");
    expect(v2?.new_classes).toBeUndefined(); // FND-08
  });

  it("kv_namespaces[] declares OAUTH_KV and ENGRAM_IDENTITIES bindings", () => {
    const config = parseJsonc(wranglerJsonc, [], {
      allowTrailingComma: true,
    }) as WranglerConfig;
    const bindings = (config.kv_namespaces ?? []).map((kv) => kv.binding);
    expect(bindings).toContain("OAUTH_KV");
    expect(bindings).toContain("ENGRAM_IDENTITIES");
  });
});

// ---------------------------------------------------------------------------
// Anti-patterns + cross-cutting structural locks (RESEARCH §Anti-Patterns)
// ---------------------------------------------------------------------------

describe("anti-patterns (RESEARCH §Anti-Patterns)", () => {
  it("index.ts source does NOT import @modelcontextprotocol/sdk/server/streamableHttp", () => {
    // Negative assertion — the literal `streamableHttp` MUST NOT appear in
    // index.ts. The raw HTTP transport depends on `node:http` and breaks
    // workerd; `agents/mcp`'s McpAgent.serve() is the only sanctioned path.
    expect(indexSource).not.toMatch(/streamableHttp/);
  });

  it("index.ts source wires defaultHandler into the OAuthProvider constructor", () => {
    // Structural pin — Plan 04's defaultHandler MUST be referenced in the
    // OAuthProvider constructor. If a future refactor drops the import,
    // OAuth fall-through routes (/, /health, /authorize) stop working.
    expect(indexSource).toMatch(/import\s+\{\s*defaultHandler\s*\}\s+from\s+["']\.\/oauth\.js["']/);
    expect(indexSource).toMatch(/new OAuthProvider\(/);
    expect(indexSource).toMatch(/defaultHandler/);
  });

  it("index.ts source pins apiRoute='/mcp' + EngramMcp.serve('/mcp', { binding: 'MCP_OBJECT' })", () => {
    // Anchors MCP-02 — the apiHandler routes /mcp to the EngramMcp DO via
    // the MCP_OBJECT namespace, which is the wrangler.jsonc binding name.
    expect(indexSource).toMatch(/apiRoute:\s*["']\/mcp["']/);
    expect(indexSource).toMatch(/EngramMcp\.serve\(\s*["']\/mcp["']/);
    expect(indexSource).toMatch(/binding:\s*["']MCP_OBJECT["']/);
  });
});
