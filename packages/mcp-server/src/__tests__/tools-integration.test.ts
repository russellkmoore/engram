/**
 * RED → GREEN (Plan 04-03) — MCP tool handler round-trip integration tests.
 *
 * Wave 0 tests that will go GREEN when Plan 04-03 ships the 5 real handler
 * bodies in `tools.ts`. Until then each handler throws
 * `McpError(MethodNotFound)` so every `it()` below that invokes a callback
 * fails with the MethodNotFound error — the expected RED failure mode.
 *
 * Cross-phase contract:
 * - **Phase 4 TOL-01:** `remember()` writes a block to WorkspaceDO and returns
 *   a fully-shaped `EngramResponse<RememberResult>` with `result.id` populated.
 * - **Phase 4 TOL-02:** `recall()` returns lexical hits + null synthesis +
 *   verbosity branches + `meta.last_updated` populated when non-empty.
 * - **Phase 4 TOL-03:** `search()` accepts NO `format?` param (schema rejects
 *   it) + returns memories + count.
 * - **Phase 4 TOL-04:** `remember → recall (hit) → forget → recall (0 hits)` round-trip.
 * - **Phase 4 TOL-04b:** `forget(cascade=true)` removes related rows.
 * - **Phase 4 TOL-05:** `ingest()` returns `{status: "accepted", job_id: <UUID>}`.
 *
 * Design notes (locked):
 * - All tool callbacks are captured via the `captureCallback` pattern (S6).
 *   `registerTools(server, () => ({workspace_id, user_id}), env)` binds a real
 *   DO stub so handler bodies can call `getAgentByName(env.WORKSPACE, workspace_id)`.
 * - Each test uses an isolated `workspace_id` string so DO state does not bleed
 *   across tests (DO instances are keyed by name via `idFromName`).
 * - The `captureCallback` helper mirrors PATTERNS.md §"tools-integration.test.ts"
 *   lines 466-479.
 *
 * Threat model:
 * - **T-04-RED-MIRROR (Information Disclosure):** RED failure messages are
 *   "MethodNotFound: not implemented in Phase 3" — no DB internals or env
 *   values. Acceptable per threat register disposition: accept.
 *
 * @module @engram/mcp-server/__tests__/tools-integration
 */
// packages/mcp-server/src/__tests__/tools-integration.test.ts
// Source: PATTERNS.md §"tools-integration.test.ts" + helpers.test.ts:21-29
//         + 04-CONTEXT.md TOL-01..05.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// SqlStorage is a Cloudflare-provided type (available in workerd environment)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlStorage = any;

import { registerTools } from "../tools.js";

// ---------------------------------------------------------------------------
// Phase 5 AI-03 / AI-08 mocks: VECTORIZE + AI binding stubs
//
// tools-integration.test.ts exercises the full handler pipeline via a real
// WorkspaceDO (WORKSPACE binding from wrangler.test.jsonc). With Plan 05-03,
// remember() now calls env.AI.run (for embeddings) and env.VECTORIZE.upsert;
// forget() now calls env.VECTORIZE.deleteByIds. These bindings require a remote
// Cloudflare account when not mocked — local miniflare throws "needs to be run
// remotely" (per Vectorize docs: no local dev support).
//
// Strategy: intercept the helpers' binding calls via Object.defineProperty on
// the env proxy so the DO-backed WORKSPACE path (real SQL) remains intact while
// AI and Vectorize calls are stubbed.
// ---------------------------------------------------------------------------

/** Deterministic 768-dim embedding returned by the AI mock on every call. */
const MOCK_VECTOR = new Array(768).fill(0.1) as number[];

/**
 * Patch env.AI and env.VECTORIZE with minimal stubs that satisfy the
 * Plan 05-03 handler logic without hitting the remote binding.
 *
 * - env.AI.run returns a deterministic 768-dim embedding vector.
 * - env.VECTORIZE.upsert / deleteByIds are no-ops returning { mutationId: "mock" }.
 *
 * Returns cleanup functions for beforeAll / afterAll usage.
 */
function patchEnvBindings() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;

  // AI mock: return deterministic embedding
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.AI = {
    run: vi.fn().mockResolvedValue({ data: [MOCK_VECTOR], shape: [1, 768] }),
  };

  // VECTORIZE mock: no-op upsert + deleteByIds
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.VECTORIZE = {
    upsert: vi.fn().mockResolvedValue({ mutationId: "mock-upsert" }),
    deleteByIds: vi.fn().mockResolvedValue({ mutationId: "mock-delete" }),
    query: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
  };
}

beforeAll(() => {
  patchEnvBindings();
});

afterEach(() => {
  // Reset mock call counts between tests, but keep the stubs installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.AI?.run as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.upsert as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.deleteByIds as ReturnType<typeof vi.fn> | undefined)?.mockClear();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Capture the registered callback for a specific tool bound to the given
 * workspace_id. Injects real env so Phase 4 handler bodies can resolve the
 * WORKSPACE DO via getAgentByName.
 *
 * Pattern: PATTERNS.md §"tools-integration.test.ts" lines 466-479 (S6).
 */
function captureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-test",
): (args: unknown, extra: unknown) => Promise<unknown> {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-server-test", version: "0.0.1" });
    registerTools(server, () => ({ workspace_id, user_id }), env);
    let foundCallback: ((args: unknown, extra: unknown) => Promise<unknown>) | undefined;
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [
        string,
        unknown,
        (args: unknown, extra: unknown) => Promise<unknown>,
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

/** Parse the MCP content wrapper and return the envelope as a plain object. */
function parseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TOL-01: remember writes block + returns RememberResult envelope
// ---------------------------------------------------------------------------

describe("TOL-01: remember", () => {
  it("remember writes block + returns RememberResult envelope with id + null confidence + empty context.conflicts", async () => {
    const cb = captureCallback("remember", "ws-tol01");
    const result = await cb({ content: "test memory for tol01" }, {});
    const envelope = parseEnvelope(result);

    expect(envelope).toHaveProperty("result");
    expect(envelope).toHaveProperty("context");
    expect(envelope).toHaveProperty("meta");

    const r = envelope.result as Record<string, unknown>;
    expect(typeof r.id).toBe("string");
    expect(r.id).toBeTruthy();
    expect(r.classified_type).toBeNull();
    expect(r.extracted_fields).toEqual({});
    expect(r.confidence).toBeNull();

    const ctx = envelope.context as Record<string, unknown>;
    expect(ctx.conflicts).toEqual([]);
    expect(ctx.entities).toEqual([]);
    expect(ctx.related).toEqual([]);

    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.confidence).toBeNull();
    expect(meta.coverage).toBeNull();
  });

  it("TOL-01-CR01: bare remember stores null type — subsequent recall echoes type = null (read-your-writes)", async () => {
    const workspace_id = "ws-tol01-roundtrip";

    // 1. remember with no type argument
    const rememberCb = captureCallback("remember", workspace_id);
    const rememberResult = await rememberCb({ content: "bare remember no type" }, {});
    const rememberEnvelope = parseEnvelope(rememberResult);
    const rr = rememberEnvelope.result as Record<string, unknown>;
    // classified_type in the envelope must be null (honest-stub contract D-06)
    expect(rr.classified_type).toBeNull();
    const id = rr.id as string;
    expect(typeof id).toBe("string");

    // 2. recall the same block by its content
    const recallCb = captureCallback("recall", workspace_id);
    const recallResult = await recallCb({ query: "bare remember no type" }, {});
    const recallEnvelope = parseEnvelope(recallResult);
    const recallR = recallEnvelope.result as Record<string, unknown>;
    const memories = recallR.memories as Record<string, unknown>[];
    expect(memories.length).toBeGreaterThanOrEqual(1);

    // 3. The stored block must echo type = null — CR-01 read-your-writes contract
    const storedMemory = memories.find((m) => m.id === id) ?? memories[0];
    expect(storedMemory).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(storedMemory!.type).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TOL-02: recall returns LexicalSearchHits + null synthesis
// ---------------------------------------------------------------------------

describe("TOL-02: recall", () => {
  it("recall returns LexicalSearchHits + null synthesis (verbosity=synthesis) + meta.last_updated populated when non-empty", async () => {
    const workspace_id = "ws-tol02-synthesis";

    // Seed a block first so recall has something to find
    const rememberCb = captureCallback("remember", workspace_id);
    await rememberCb({ content: "recall test block" }, {});

    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "recall test", verbosity: "synthesis" }, {});
    const envelope = parseEnvelope(result);

    const r = envelope.result as Record<string, unknown>;
    expect(Array.isArray(r.memories)).toBe(true);
    expect(r.synthesis).toBeNull(); // D-07 honest stub
    // verbosity="synthesis" → chunks absent
    expect(Object.prototype.hasOwnProperty.call(r, "chunks")).toBe(false);

    const meta = envelope.meta as Record<string, unknown>;
    // last_updated should be a finite number when memories non-empty
    if ((r.memories as unknown[]).length > 0) {
      expect(typeof meta.last_updated).toBe("number");
      expect(isFinite(meta.last_updated as number)).toBe(true);
    }
  });

  it("TOL-02b: recall with verbosity=both surfaces result.chunks alongside memories", async () => {
    const workspace_id = "ws-tol02b-both";

    // Seed a block
    const rememberCb = captureCallback("remember", workspace_id);
    await rememberCb({ content: "chunk test block" }, {});

    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "chunk test", verbosity: "both" }, {});
    const envelope = parseEnvelope(result);

    const r = envelope.result as Record<string, unknown>;
    // verbosity="both" → chunks PRESENT
    expect(Object.prototype.hasOwnProperty.call(r, "chunks")).toBe(true);
    expect(Array.isArray(r.chunks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TOL-03: search accepts NO format param + returns memories + count
// ---------------------------------------------------------------------------

describe("TOL-03: search", () => {
  it("search returns memories + count", async () => {
    const workspace_id = "ws-tol03";

    // Seed a block
    const rememberCb = captureCallback("remember", workspace_id);
    await rememberCb({ content: "searchable content" }, {});

    const searchCb = captureCallback("search", workspace_id);
    const result = await searchCb({ query: "searchable" }, {});
    const envelope = parseEnvelope(result);

    const r = envelope.result as Record<string, unknown>;
    expect(Array.isArray(r.memories)).toBe(true);
    expect(typeof r.count).toBe("number");
    expect(r.count).toBeGreaterThanOrEqual(0);
  });

  it("TOL-03b: search schema has no 'format' field (defense-in-depth — no format on search)", async () => {
    // The SearchInputSchema does NOT have a format field per CLAUDE.md §MCP Tool Surface.
    // Zod strips unknown keys by default, but we verify the shape does not declare it.
    // If someone accidentally adds format to SearchInputSchema.shape, this fails.
    const { SearchInputSchema } = await import("../schemas.js");
    expect(Object.keys(SearchInputSchema.shape)).not.toContain("format");
  });
});

// ---------------------------------------------------------------------------
// TOL-04: remember → recall (hit) → forget → recall (zero hits) round-trip
// ---------------------------------------------------------------------------

describe("TOL-04: forget round-trip", () => {
  it("remember → recall (hit) → forget → recall (zero hits) round-trip", async () => {
    const workspace_id = "ws-tol04-roundtrip";

    const rememberCb = captureCallback("remember", workspace_id);
    const recallCb = captureCallback("recall", workspace_id);
    const forgetCb = captureCallback("forget", workspace_id);

    // 1. remember a block
    const rememberResult = await rememberCb({ content: "needle to find in tol04" }, {});
    const rememberEnv = parseEnvelope(rememberResult);
    const id = (rememberEnv.result as Record<string, unknown>).id as string;
    expect(typeof id).toBe("string");

    // 2. recall finds it
    const recallResult = await recallCb({ query: "needle to find" }, {});
    const recallEnv = parseEnvelope(recallResult);
    const memories = (recallEnv.result as Record<string, unknown>).memories as unknown[];
    expect(memories.length).toBeGreaterThan(0);

    // 3. forget removes it
    await forgetCb({ id }, {});

    // 4. recall now returns zero
    const recallAfter = await recallCb({ query: "needle to find" }, {});
    const recallAfterEnv = parseEnvelope(recallAfter);
    const memoriesAfter = (recallAfterEnv.result as Record<string, unknown>).memories as unknown[];
    expect(memoriesAfter.length).toBe(0);
  });

  it("TOL-04b: forget with cascade=true on a block-with-relations removes relation rows", async () => {
    const workspace_id = "ws-tol04b-cascade";
    const { runInDurableObject } = await import("cloudflare:test");

    const rememberCb = captureCallback("remember", workspace_id);
    const forgetCb = captureCallback("forget", workspace_id);

    // 1. remember two blocks
    const r1 = parseEnvelope(await rememberCb({ content: "block A for cascade" }, {}));
    const r2 = parseEnvelope(await rememberCb({ content: "block B for cascade" }, {}));
    const idA = (r1.result as Record<string, unknown>).id as string;
    const idB = (r2.result as Record<string, unknown>).id as string;

    // 2. add a relation directly via DO SQL (WorkspaceDO.relate() ships in v0.3;
    //    seed via raw SQL for now — this is a test-only path)
    const wsNs = (env as Record<string, unknown>).WORKSPACE as DurableObjectNamespace;
    await runInDurableObject(wsNs.get(wsNs.idFromName(workspace_id)), (instance: unknown) => {
      // Access the SQL storage directly via the ctx — test-only pattern
      const doInstance = instance as { ctx: { storage: { sql: SqlStorage } } };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      doInstance.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO relations (from_id, to_id, relationship, properties, created_at) VALUES (?, ?, ?, NULL, ?)",
        idA,
        idB,
        "related_to",
        Date.now(),
      );
    });

    // 3. forget with cascade=true
    const forgetResult = await forgetCb({ id: idA, cascade: true }, {});
    const forgetEnv = parseEnvelope(forgetResult);
    const fr = forgetEnv.result as Record<string, unknown>;
    expect((fr.relations_deleted as number) >= 1).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AI-08: forget cascade with Vectorize delete + eventual consistency
// RED until Plan 05-03 wires embed + Vectorize delete.
// Currently fails: remember() doesn't embed, so lexical recall after forget
// still finds the block by content match — memories.length !== 0.
// ---------------------------------------------------------------------------

describe("AI-08: forget cascade with Vectorize delete + eventual consistency (RED until Plan 05-03)", () => {
  // Timeout: 12s to allow the 5s Vectorize eventual-consistency sleep + per-step latency
  // (AI-SPEC.md §3 Pitfall 7 — Vectorize delete is eventually consistent ~seconds).
  // Per RESEARCH §Assumption A8: if this becomes flaky in CI, Plan 05-06 owns conversion
  // to poll-with-timeout (poll every 500ms up to 10s).
  it("remember → forget → sleep(5s) → recall returns 0 semantic matches", async () => {
    const workspace_id = "ws-ai08-roundtrip";
    const rememberCb = captureCallback("remember", workspace_id);
    const recallCb = captureCallback("recall", workspace_id);
    const forgetCb = captureCallback("forget", workspace_id);

    const rememberResult = await rememberCb({ content: "ai08 needle to forget cascade" }, {});
    const id = (parseEnvelope(rememberResult).result as { id: string }).id;

    await forgetCb({ id }, {});

    // AI-SPEC.md §3 Pitfall 7: Vectorize delete is eventually consistent (~seconds).
    // Allow up to 5s for the delete to propagate per 05-RESEARCH.md §"Pitfall 4".
    // Note: recall() uses lexical SQLite search in v0.1 (Phase 5 Plan 05-05 wires Vectorize
    // into recall). The SQLite cascade from forget() means lexical recall also returns 0.
    // The 5s sleep is insurance for future Vectorize-backed recall path.
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const recallAfter = await recallCb(
      { query: "needle to forget cascade", verbosity: "chunks" },
      {},
    );
    const memories = (parseEnvelope(recallAfter).result as { memories: unknown[] }).memories;
    expect(memories.length).toBe(0);
  }, 12_000);
});

// ---------------------------------------------------------------------------
// TOL-05: ingest returns accepted envelope
// ---------------------------------------------------------------------------

describe("TOL-05: ingest", () => {
  it("ingest returns {status: 'accepted', job_id: <UUID>} with no Queue side effect (D-05)", async () => {
    const cb = captureCallback("ingest", "ws-tol05");
    const result = await cb({ source: "https://example.com/article" }, {});
    const envelope = parseEnvelope(result);

    const r = envelope.result as Record<string, unknown>;
    expect(r.status).toBe("accepted");
    expect(typeof r.job_id).toBe("string");
    expect(r.job_id).toBeTruthy();

    const meta = envelope.meta as Record<string, unknown>;
    const gaps = meta.gaps as string[];
    expect(Array.isArray(gaps)).toBe(true);
    // D-05: gaps must mention the async pipeline
    expect(gaps.some((g) => g.toLowerCase().includes("phase 6"))).toBe(true);
  });
});
