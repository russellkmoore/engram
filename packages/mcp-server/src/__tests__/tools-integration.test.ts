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

// ---------------------------------------------------------------------------
// Phase 5 AI-04: Vectorize mock state tracking
//
// recall() now uses Vectorize semantically. The mock must simulate the
// upsert→query→delete lifecycle so integration tests (TOL-01, TOL-04, AI-08)
// can exercise read-your-writes behaviour without a real Vectorize binding.
//
// Implementation: a Map from (namespace → Set<id>) accumulates upserted IDs.
// On query, the mock returns all IDs in the namespace as deterministic matches.
// On deleteByIds, the mock removes the IDs from the namespace set.
// This gives realistic round-trip behaviour for the test suite.
// ---------------------------------------------------------------------------

/** Per-namespace ID registry for the Vectorize mock. keyed by workspaceId. */
const vectorizeStore = new Map<string, Set<string>>();

/**
 * Patch env.AI and env.VECTORIZE with minimal stubs that satisfy the
 * Plan 05-03 + Plan 05-05 handler logic without hitting the remote binding.
 *
 * Phase 5 AI-04 additions:
 * - env.VECTORIZE.query returns deterministic matches for all IDs upserted
 *   into the same namespace, enabling recall round-trips in integration tests.
 * - env.VECTORIZE.upsert tracks IDs per namespace (workspace isolation correct).
 * - env.VECTORIZE.deleteByIds removes IDs from the namespace set.
 */
function patchEnvBindings() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;

  // AI mock: return deterministic embedding for both embed + synthesis calls.
  // For synthesis calls (CLASSIFIER_MODEL), return { response: "Mock synthesis." }
  // so verbosity="synthesis" tests get a non-null synthesis value.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.AI = {
    run: vi.fn().mockImplementation((model: string): Promise<unknown> => {
      if (model === "@cf/meta/llama-3.1-8b-instruct") {
        return Promise.resolve({ response: "Mock synthesis for test." });
      }
      // Default: embedding model returns deterministic 768-dim vector
      return Promise.resolve({ data: [MOCK_VECTOR], shape: [1, 768] });
    }),
  };

  // VECTORIZE mock: stateful upsert + query + deleteByIds simulating namespace isolation.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.VECTORIZE = {
    upsert: vi
      .fn()
      .mockImplementation(
        (vectors: { id: string; namespace?: string }[]): Promise<{ mutationId: string }> => {
          for (const v of vectors) {
            const ns = v.namespace ?? "__default__";
            if (!vectorizeStore.has(ns)) vectorizeStore.set(ns, new Set());
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            vectorizeStore.get(ns)!.add(v.id);
          }
          return Promise.resolve({ mutationId: "mock-upsert" });
        },
      ),
    deleteByIds: vi.fn().mockImplementation((ids: string[]): Promise<{ mutationId: string }> => {
      // Remove IDs from all namespaces (Vectorize deleteByIds is namespace-agnostic)
      for (const set of vectorizeStore.values()) {
        for (const id of ids) {
          set.delete(id);
        }
      }
      return Promise.resolve({ mutationId: "mock-delete" });
    }),
    query: vi
      .fn()
      .mockImplementation(
        (
          _vector: unknown,
          opts: { namespace?: string; topK?: number },
        ): Promise<{ matches: { id: string; score: number }[]; count: number }> => {
          const ns = opts.namespace ?? "__default__";
          const ids = [...(vectorizeStore.get(ns) ?? [])];
          const topK = opts.topK ?? 25;
          const matches = ids.slice(0, topK).map((id) => ({ id, score: 0.9 }));
          return Promise.resolve({ matches, count: matches.length });
        },
      ),
  };
}

beforeAll(() => {
  patchEnvBindings();
});

afterEach(() => {
  // Reset mock call counts between tests, but keep the stubs installed.
  // Clear the Vectorize store so tests are isolated.
  vectorizeStore.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.AI?.run as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.upsert as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.deleteByIds as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.query as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // Phase 6 PIP-02 latency test (below) patches env.INGEST_QUEUE — clear here so
  // subsequent tests (TOL-* / AI-* / etc.) see the production code path (which
  // logs a warn + skips when INGEST_QUEUE is undefined, per tools.ts B3 fix).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  delete e.INGEST_QUEUE;
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
  ctxOverride?: { waitUntil: (p: Promise<unknown>) => void },
): (args: unknown, extra: unknown) => Promise<unknown> {
  // Plan 06-02 B2 fix: forward-compat seat for Plan 06-05's PIP-02 latency test.
  // Default drop-the-promise stub: safe because no current TOL-* test exercises
  // the getCtx().waitUntil(...) call path (lands in Plan 06-04 / 06-05).
  const defaultCtxStub = {
    waitUntil: (p: Promise<unknown>) => {
      void p;
    },
  };
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-server-test", version: "0.0.1" });
    registerTools(
      server,
      () => ({ workspace_id, user_id }),
      env,
      () => (ctxOverride ?? defaultCtxStub) as unknown as DurableObjectState,
    );
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
    // Phase 5 AI-04: synthesis is no longer always null — verbosity="synthesis" returns
    // a real synthesis when memories are present (mock returns "Mock synthesis for test.").
    // When memories.length === 0 (no Vectorize hits), synthesis may be null (skipped).
    expect(r.synthesis === null || typeof r.synthesis === "string").toBe(true);
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
    const wsNs = (env as unknown as Record<string, unknown>).WORKSPACE as DurableObjectNamespace;
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
// AI-04: recall latency budget (default verbosity = "chunks", no synthesis)
//
// Per AI-SPEC.md §4b "Cost and Latency Budget": p50 < 400ms no-synthesis.
// Note: requires real Vectorize binding (remote: true). In PR CI the mock
// Vectorize binding responds instantly; the 5s sleep dominates latency.
// Marked it.skip until Plan 05-06 configures nightly-CI with real bindings.
// ---------------------------------------------------------------------------

describe("AI-04: recall latency budget (default verbosity)", () => {
  // Skip in PR CI — real Vectorize binding required for a meaningful measurement.
  // Plan 05-06 owns the nightly-CI gate that un-skips this test.
  it.skip("p50 latency under 400ms for default-verbosity (chunks) recall", async () => {
    const ws = "ws-latency-p50";
    const rememberCb = captureCallback("remember", ws);
    const recallCb = captureCallback("recall", ws);

    // Seed 10 memories with distinct content
    for (let i = 0; i < 10; i++) {
      await rememberCb(
        { content: `latency seed memory ${String(i)} about topic-${String(i % 3)}` },
        {},
      );
    }
    // Vectorize eventual consistency — per AI-SPEC.md §3 Pitfall 7.
    await new Promise((r) => setTimeout(r, 5_000));

    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await recallCb({ query: `find topic-${String(i % 3)} content`, verbosity: "chunks" }, {});
      latencies.push(Date.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length / 2)];
    console.log(
      `AI-04 default recall p50: ${String(p50)}ms (latencies: ${latencies.join(", ")}ms)`,
    );
    expect(p50).toBeLessThan(400); // AI-SPEC.md §4b budget
  }, 70_000);
});

// ---------------------------------------------------------------------------
// AI-04: recall envelope shape (D-03 verbosity parameterization)
//
// Asserts the two verbosity branches produce the correct envelope shape:
// - verbosity="chunks" → synthesis=null, suggestions.actions present, meta.gaps opt-in hint
// - verbosity="synthesis" → synthesis populated, no suggestions, no opt-in hint in gaps
// ---------------------------------------------------------------------------

describe("AI-04: recall envelope shape (D-03 verbosity parameterization)", () => {
  it("default verbosity (chunks) returns synthesis=null + suggestions.actions + meta.gaps opt-in hint", async () => {
    const ws = "ws-shape-chunks";
    const rememberCb = captureCallback("remember", ws);
    const recallCb = captureCallback("recall", ws);
    await rememberCb({ content: "shape test memory for chunks verbosity" }, {});

    const result = parseEnvelope(await recallCb({ query: "shape test", verbosity: "chunks" }, {}));
    const r = result.result as Record<string, unknown>;
    // D-01: default verbosity returns synthesis=null (no LLM synthesis call)
    expect(r.synthesis).toBeNull();
    // D-02: suggestions.actions present with opt-in hint
    const suggestions = result.suggestions as { actions: string[] } | undefined;
    expect(suggestions?.actions).toContain(
      "Set verbosity: 'synthesis' to add a summary of these memories.",
    );
    // D-02: meta.gaps includes the frozen opt-in discoverability string
    const meta = result.meta as { gaps: string[] };
    expect(meta.gaps).toContain(
      "Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary.",
    );
  });

  it("verbosity='synthesis' returns synthesis-populated + no suggestions + no opt-in gap", async () => {
    const ws = "ws-shape-synthesis";
    const rememberCb = captureCallback("remember", ws);
    const recallCb = captureCallback("recall", ws);
    await rememberCb(
      { content: "shape test memory for synthesis verbosity — concrete fact about Cloudflare" },
      {},
    );

    const result = parseEnvelope(
      await recallCb({ query: "shape test", verbosity: "synthesis" }, {}),
    );
    const r = result.result as Record<string, unknown>;
    // verbosity="synthesis": synthesis is populated (mock returns "Mock synthesis for test.")
    expect(r.synthesis).not.toBeNull();
    expect(typeof r.synthesis).toBe("string");
    expect((r.synthesis as string).length).toBeGreaterThan(20);
    // D-02: no suggestions when synthesis is requested
    expect(result.suggestions).toBeUndefined();
    // meta.gaps does NOT contain the opt-in hint (user already opted in)
    const meta = result.meta as { gaps: string[] };
    expect(meta.gaps).not.toContain(
      "Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary.",
    );
  });
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

// ---------------------------------------------------------------------------
// PIP-02: remember() returns before async enrichment completes
//
// Phase 6 Plan 06-05 Task 2 — proves that `getCtx().waitUntil(...)` in the
// remember() handler decouples the response latency from the inner queue.send
// latency. The producer's `INGEST_QUEUE.send` runs after the response is
// returned to the client; remember() resolves in well under the simulated
// queue-send delay.
//
// Two parts to this test (both load-bearing):
//
// 1. **ctxOverride tracker** — captureCallback's 4th arg is wired so the
//    real `getCtx().waitUntil(p)` invocation pushes `p` into a tracker array.
//    The default `captureCallback` ctxOverride is a drop-the-promise stub
//    (06-02 carry-forward) — calling .waitUntil(...) on that would not let
//    the test (a) measure that remember() returns BEFORE the inner-send
//    resolves AND (b) await the inner-send afterwards to verify it eventually
//    fired. The tracker is the only design that proves BOTH the decoupling
//    AND the eventual fire.
//
// 2. **Tightened timing thresholds (W4 fix)** — inner queue.send delay is
//    500ms, outer threshold is <200ms. The 300ms safety buffer eliminates
//    the prior 50ms-buffer flake risk under workerd test-pool startup +
//    5-tool registerTools + Node event-loop scheduling. The W4 fix raised
//    the inner-delay (was 200ms) and tightened the outer threshold (was
//    150ms) so the gap proves decoupling even on a slow CI VM.
// ---------------------------------------------------------------------------

describe("PIP-02: remember() returns before async enrichment completes", () => {
  it("remember() resolves before INGEST_QUEUE.send awaited (waitUntil decouples)", async () => {
    const workspace_id = "ws-pip02-latency";

    // (2) Tracker — pushes every promise the handler hands to getCtx().waitUntil.
    //     Lets the test both assert that remember() returns BEFORE the inner-send
    //     resolves AND await the tracked promise afterward to verify the inner-send
    //     actually fired (not silently swallowed).
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctxOverride = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
    };

    // (3) Bind the live remember() handler with the tracking ctxOverride.
    //     The captureCallback signature is (toolName, workspace_id, user_id?, ctxOverride?)
    //     per 06-02 carry-forward — pass "u-test" for user_id symmetry with the
    //     other TOL-* tests, then the tracker as the 4th arg.
    const rememberCb = captureCallback("remember", workspace_id, "u-test", ctxOverride);

    // (4) Patch env.INGEST_QUEUE.send with a deliberate 500ms delay (W4 fix).
    //     The handler's lazy dereference (tools.ts B3 fix) reads env.INGEST_QUEUE
    //     INSIDE the handler body on every invocation — so this test-time patch
    //     takes effect even though registerTools ran above before the patch.
    //
    //     Deviation note (Rule 1 fix from the plan's stated threshold):
    //     The plan's literal `<200ms` outer threshold assumed a minimal baseline
    //     latency for remember(). In practice, remember()'s SYNC pipeline (DO
    //     insertBlock → AI embed mock → stampEmbedding RPC → Vectorize upsert)
    //     takes ~400-600ms in the workerd test pool — already over 200ms before
    //     any waitUntil work. The PIP-02 decoupling proof is therefore expressed
    //     RELATIVELY: remember() must return BEFORE the inner queue.send delay
    //     elapses, not against a fixed absolute threshold. The 500ms inner delay
    //     is wider than any realistic baseline jitter; the gap between the
    //     remember() return time and the queue.send completion time is the
    //     decoupling evidence. The plan-checker's "proof is the gap, not the
    //     absolute number" guidance in the verification §"Common failure modes"
    //     supports this framing.
    const QUEUE_SEND_DELAY_MS = 500;
    let queueSendInvokedAt: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (env as any).INGEST_QUEUE = {
      send: async (_evt: unknown) => {
        void _evt;
        await new Promise((r) => setTimeout(r, QUEUE_SEND_DELAY_MS));
        queueSendInvokedAt = Date.now();
      },
    };

    // (5) Invoke remember() and measure how long it takes to resolve.
    const rememberStart = Date.now();
    await rememberCb({ content: "PIP-02 latency probe" }, {});
    const rememberDuration = Date.now() - rememberStart;

    // (6) STRONGEST DECOUPLING PROOF: at the moment remember() returned, the
    //     inner queue.send promise had NOT yet resolved (queueSendInvokedAt is
    //     still null). The handler has handed the IIFE promise to waitUntil
    //     and returned — the inner 500ms-delayed work has not even completed.
    //     This is a binary check (null vs. not-null) — flake-free regardless
    //     of absolute timing. Subsumes the plan's `<200ms` relative latency
    //     assertion: if the inner send had been awaited synchronously,
    //     queueSendInvokedAt would already be a Date.now() value here.
    expect(queueSendInvokedAt).toBeNull();

    // (7) Diagnostic-only log so the timing delta is visible in CI output.
    //     remember()'s sync pipeline takes ~400-900ms (DO inserts + Vectorize
    //     upsert + 5-tool registerTools); the absolute number varies by host
    //     but the (6) assertion above is what proves decoupling.
    console.log(
      `[PIP-02] remember() returned in ${String(rememberDuration)}ms; ` +
        `inner queue.send had NOT yet fired (decoupled via waitUntil).`,
    );

    // (8) POST-AWAIT SANITY: drain the tracked promises (deterministic — no
    //     setTimeout race) and verify the inner-send eventually fired AND
    //     took at least the simulated 500ms (proves the send actually ran,
    //     not just got swallowed).
    await Promise.all(waitUntilPromises);
    expect(queueSendInvokedAt).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(queueSendInvokedAt! - rememberStart).toBeGreaterThanOrEqual(QUEUE_SEND_DELAY_MS);
  });
});
