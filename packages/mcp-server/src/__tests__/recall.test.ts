/**
 * Handler-branch unit tests for the `recall()` adaptive routing + bge-reranker path (EXP-03, EXP-06, EXP-10).
 *
 * Requirements covered:
 * - EXP-03: adaptive gate — single-query pass first; fan-out via expandQuery ONLY when top1_cosine < 0.65.
 * - EXP-06: bge-reranker invoked via safeRun between RRF merge and hybridRank; id is the index into
 *   contexts[] (NOT a memory id); scores are sigmoid-normalized; 429/error falls back to raw cosine.
 * - EXP-10: persistent rewriter 429 → single-query path + meta.gaps "query expansion unavailable".
 * - T-03-05 workspace isolation: every fan-out vectorizeQuery call uses props.workspace_id.
 * - T-03-07 empty-context filter (Pitfall 6): null-content/null-summary candidates are excluded
 *   from reranker contexts; they keep their raw cosine score.
 *
 * All tests are creds-free — safeRun, vectorizeQuery, expandQuery, keepVariantsAboveGate,
 * reciprocalRankFusion, hybridRank, and the workspace DO are mocked.
 *
 * @module @engram/mcp-server/__tests__/recall
 */

// ---------------------------------------------------------------------------
// vi.mock declarations MUST be hoisted BEFORE any imports.
// ---------------------------------------------------------------------------

vi.mock("../ai-helper.js", () => ({
  safeRun: vi.fn(),
  EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
  EMBEDDING_VERSION: 2,
  EMBEDDING_DIMS: 1024,
  CLASSIFIER_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  INGESTION_CLASSIFIER_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  QUERY_EXPANSION_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  RateLimitError: class RateLimitError extends Error {
    readonly isRateLimit = true;
    readonly origin: string;
    constructor(origin: string, message?: string) {
      super(message ?? `Rate limit (${origin})`);
      this.name = "RateLimitError";
      this.origin = origin;
    }
  },
}));

vi.mock("@engram/vectorize-utils", () => ({
  vectorizeQuery: vi.fn(),
}));

vi.mock("../query-expansion.js", () => ({
  expandQuery: vi.fn(),
  keepVariantsAboveGate: vi.fn(),
}));

vi.mock("../rrf.js", () => ({
  reciprocalRankFusion: vi.fn(),
}));

// hybridRank needs to return ranked blocks — keep it deterministic.
vi.mock("../hybrid-rank.js", () => ({
  hybridRank: vi.fn(),
  HYBRID_WEIGHTS: { rerank: 0.6, recency: 0.05, type_match: 0.1, scope_match: 0.05 },
}));

// Production ships RERANKER_ENABLED=false (EXP-07 ablation: reranker worse than
// raw cosine). The EXP-06 tests below validate the reranker LOGIC (index-alignment,
// sigmoid, fallback), which is preserved behind the flag — so force the flag true
// here while keeping every other real ai-config export intact.
vi.mock("@engram/ai-config", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, RERANKER_ENABLED: true };
});

// analytics is fire-and-forget — stub it to avoid env binding errors.
vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("test-workspace-tag"),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "../tools.js";
import { safeRun } from "../ai-helper.js";
import { vectorizeQuery } from "@engram/vectorize-utils";
import { expandQuery, keepVariantsAboveGate } from "../query-expansion.js";
import { reciprocalRankFusion } from "../rrf.js";
import { hybridRank } from "../hybrid-rank.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const EMBEDDING_DIMS = 1024;

/** Deterministic fake query vector. */
const MOCK_QUERY_VECTOR: number[] = new Array(EMBEDDING_DIMS).fill(0.1) as number[];

/** Create a fake VectorizeMatch with the given id and score. */
function makeMatch(id: string, score: number) {
  return { id, score, metadata: { type: "contact", scope: "personal" } };
}

/** Create a minimal memory block for hybridRank/DO stubs. */
function makeBlock(
  id: string,
  content: string | null = "some content",
  summary: string | null = null,
) {
  return {
    id,
    content,
    summary,
    type: "contact",
    scope: "personal" as const,
    created_at: Date.now() - 1000,
    updated_at: Date.now() - 1000,
    properties: {},
    embedding_id: `vec-${id}`,
    source: "mcp:claude",
    confidence: null,
    project_id: null,
    workspace_id: "ws-recall-test",
    _score: 0,
  };
}

/** Workspace DO stub: getBlocksByIds returns the blocks matching the requested ids. */
function makeDoStub(blocks: ReturnType<typeof makeBlock>[]) {
  return {
    getBlocksByIds: vi.fn().mockResolvedValue(
      blocks, // return all — tests can filter by id if needed
    ),
    listInboxConflictsForMemoryIds: vi.fn().mockResolvedValue([]),
  };
}

/** Register tools with a mocked DO stub and capture the `recall` callback. */
function captureRecallCallback(
  workspaceId: string,
  doStub: ReturnType<typeof makeDoStub>,
): (args: unknown) => Promise<unknown> {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-test", version: "0.0.1" });
    const fakeEnv = {
      // WORKSPACE DO namespace stub
      WORKSPACE: {
        idFromName: vi.fn().mockReturnValue({ toString: () => workspaceId }),
        get: vi.fn().mockReturnValue(doStub),
      },
      AI: {} as Ai,
    };

    registerTools(
      server,
      () => ({ workspace_id: workspaceId, user_id: "u-recall-test" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      fakeEnv as any,
      () => ({ waitUntil: (p: Promise<unknown>) => void p }) as unknown as DurableObjectState,
    );

    let foundCallback: ((args: unknown) => Promise<unknown>) | undefined;
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [
        string,
        unknown,
        (args: unknown) => Promise<unknown>,
      ];
      if (callName === "recall") {
        foundCallback = callCb;
        break;
      }
    }
    if (foundCallback === undefined) throw new Error("recall callback not captured");
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
// Shared setup
// ---------------------------------------------------------------------------

const mockSafeRun = vi.mocked(safeRun);
const mockVectorizeQuery = vi.mocked(vectorizeQuery);
const mockExpandQuery = vi.mocked(expandQuery);
const mockKeepVariantsAboveGate = vi.mocked(keepVariantsAboveGate);
const mockRRF = vi.mocked(reciprocalRankFusion);
const mockHybridRank = vi.mocked(hybridRank);

const WS_ID = "ws-recall-test";

beforeEach(() => {
  vi.clearAllMocks();

  // Default embed mock: return MOCK_QUERY_VECTOR for every safeRun(EMBEDDING_MODEL) call.
  mockSafeRun.mockResolvedValue({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });

  // Default hybridRank: return an empty ranked list (tests that need results override this).
  mockHybridRank.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Task 1 Tests: EXP-03 adaptive routing + fan-out + EXP-10 fallback
// ---------------------------------------------------------------------------

describe("EXP-03: adaptive routing", () => {
  it("Test 1 (skip fan-out): expandQuery NOT called when top1 cosine ≥ 0.65", async () => {
    const blocks = [makeBlock("m1"), makeBlock("m2")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    // top1 = 0.70 — above the 0.65 adaptive threshold → fan-out must NOT fire.
    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("m1", 0.7), makeMatch("m2", 0.68)],
      count: 2,
    });

    mockHybridRank.mockReturnValue(blocks as never[]);

    await recall({ query: "find contact" });

    expect(mockExpandQuery).not.toHaveBeenCalled();
    // safeRun called only once for the initial embedding (no fan-out variant embeds).
    const safeRunCalls = mockSafeRun.mock.calls;
    // Only embedding call expected; no RERANKER call in Task 1 tests (reranker wired in Task 2).
    const embeddingCalls = safeRunCalls.filter((c) => c[1] !== "@cf/baai/bge-reranker-base");
    expect(embeddingCalls).toHaveLength(1);
  });

  it("Test 2 (fire fan-out): expandQuery called and RRF merges lists when top1 cosine < 0.65", async () => {
    const blocks = [makeBlock("m1"), makeBlock("m2"), makeBlock("m3")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    // top1 = 0.50 — below threshold → fan-out fires.
    const singleQueryMatches = [makeMatch("m1", 0.5), makeMatch("m2", 0.48)];
    mockVectorizeQuery.mockResolvedValue({
      matches: singleQueryMatches,
      count: 2,
    });

    // expandQuery returns [original, p1, p2].
    mockExpandQuery.mockResolvedValue(["find contact", "search contact", "locate contact"]);
    // keepVariantsAboveGate returns all three.
    mockKeepVariantsAboveGate.mockResolvedValue([
      "find contact",
      "search contact",
      "locate contact",
    ]);

    // Each fan-out variant gets its own vector (safeRun for embedding).
    // First call: initial query embed (already set in beforeEach).
    // Subsequent calls: one embed per variant.
    const vec02 = Array.from<number>({ length: EMBEDDING_DIMS }).fill(0.2);
    const vec03 = Array.from<number>({ length: EMBEDDING_DIMS }).fill(0.3);
    const vec04 = Array.from<number>({ length: EMBEDDING_DIMS }).fill(0.4);
    mockSafeRun
      .mockResolvedValueOnce({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] }) // initial embed
      .mockResolvedValueOnce({ data: [vec02], shape: [1, EMBEDDING_DIMS] }) // v0
      .mockResolvedValueOnce({ data: [vec03], shape: [1, EMBEDDING_DIMS] }) // v1
      .mockResolvedValueOnce({ data: [vec04], shape: [1, EMBEDDING_DIMS] }); // v2

    // Fan-out vectorize calls: one per variant (returns different sets).
    const v0Matches = [makeMatch("m1", 0.5), makeMatch("m2", 0.48)];
    const v1Matches = [makeMatch("m2", 0.55), makeMatch("m3", 0.52)];
    const v2Matches = [makeMatch("m3", 0.6), makeMatch("m1", 0.5)];
    mockVectorizeQuery
      .mockResolvedValueOnce({ matches: singleQueryMatches, count: 2 }) // single-query pass
      .mockResolvedValueOnce({ matches: v0Matches, count: 2 }) // v0 fan-out
      .mockResolvedValueOnce({ matches: v1Matches, count: 2 }) // v1 fan-out
      .mockResolvedValueOnce({ matches: v2Matches, count: 2 }); // v2 fan-out

    // RRF merges the variant lists.
    const rrfResult = [
      { id: "m1", rrfScore: 0.08, item: makeMatch("m1", 0.5) },
      { id: "m3", rrfScore: 0.07, item: makeMatch("m3", 0.6) },
      { id: "m2", rrfScore: 0.06, item: makeMatch("m2", 0.55) },
    ];
    mockRRF.mockReturnValue(rrfResult);
    mockHybridRank.mockReturnValue(blocks as never[]);

    await recall({ query: "find contact" });

    expect(mockExpandQuery).toHaveBeenCalledOnce();
    expect(mockKeepVariantsAboveGate).toHaveBeenCalledOnce();
    expect(mockRRF).toHaveBeenCalledOnce();

    // Fan-out vectorizeQuery calls (plus the initial single-pass = 4 total).
    const vzCalls = mockVectorizeQuery.mock.calls;
    expect(vzCalls.length).toBeGreaterThanOrEqual(2); // at least initial + ≥1 fan-out

    // Workspace isolation: all vectorizeQuery calls use props.workspace_id.
    for (const call of vzCalls) {
      expect(call[1]).toBe(WS_ID); // second arg is workspaceId (from props, NOT args)
    }
  });

  it("Test 3 (EXP-10 fallback): returns single-query matches + meta.gaps on rewriter RateLimitError", async () => {
    const blocks = [makeBlock("m1")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    // top1 = 0.50 — below threshold → fan-out fires but rewriter throws 429.
    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("m1", 0.5)],
      count: 1,
    });

    // expandQuery throws a rate-limit error (EXP-10). The catch block in recall()
    // sets expansionUnavailable=true regardless of error type.
    const rle = Object.assign(new Error("Rate limit 429"), { isRateLimit: true, origin: "thrown" });
    mockExpandQuery.mockRejectedValue(rle);

    mockHybridRank.mockReturnValue(blocks as never[]);

    const result = await recall({ query: "find contact" });

    // recall must NOT throw — fallback to single-query path.
    const envelope = parseEnvelope(result);

    // meta.gaps must include the EXP-10 "query expansion unavailable" note.
    const meta = envelope.meta as { gaps: string[] };
    expect(meta.gaps).toContain("query expansion unavailable");

    // RRF was NOT called (fallback to single-query).
    expect(mockRRF).not.toHaveBeenCalled();
  });

  it("Test 4 (workspace isolation): all fan-out vectorizeQuery calls use props.workspace_id, never args", async () => {
    const doStub = makeDoStub([makeBlock("m1")]);
    const recall = captureRecallCallback(WS_ID, doStub);

    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("m1", 0.5)],
      count: 1,
    });

    mockExpandQuery.mockResolvedValue(["query", "variant1", "variant2"]);
    mockKeepVariantsAboveGate.mockResolvedValue(["query", "variant1", "variant2"]);

    mockSafeRun
      .mockResolvedValueOnce({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] })
      .mockResolvedValueOnce({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] })
      .mockResolvedValueOnce({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] })
      .mockResolvedValueOnce({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });

    mockRRF.mockReturnValue([{ id: "m1", rrfScore: 0.1, item: makeMatch("m1", 0.5) }]);
    mockHybridRank.mockReturnValue([makeBlock("m1")] as never[]);

    await recall({ query: "test query" });

    // All vectorizeQuery calls must use props.workspace_id (WS_ID), NOT args.
    for (const call of mockVectorizeQuery.mock.calls) {
      expect(call[1]).toBe(WS_ID);
    }
  });

  it("Test 5 (CR-01 type filter in fan-out): every fan-out vectorizeQuery applies the same type filter as the single-query pass", async () => {
    const doStub = makeDoStub([makeBlock("m1")]);
    const recall = captureRecallCallback(WS_ID, doStub);

    // top1 = 0.5 → below threshold → fan-out fires.
    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("m1", 0.5)],
      count: 1,
    });
    mockExpandQuery.mockResolvedValue(["query", "variant1", "variant2"]);
    mockKeepVariantsAboveGate.mockResolvedValue(["query", "variant1", "variant2"]);
    mockSafeRun.mockResolvedValue({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });
    mockRRF.mockReturnValue([{ id: "m1", rrfScore: 0.1, item: makeMatch("m1", 0.5) }]);
    mockHybridRank.mockReturnValue([makeBlock("m1")] as never[]);

    await recall({ query: "test query", types: ["contact"] });

    // Every vectorizeQuery call (single-query pass AND all fan-out variant calls)
    // must carry the same metadata filter — otherwise the fan-out leaks off-type memories.
    const expectedFilter = { type: { $in: ["contact"] } };
    expect(mockVectorizeQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of mockVectorizeQuery.mock.calls) {
      expect(call[3]).toMatchObject({ filter: expectedFilter });
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2 Tests: EXP-06 bge-reranker index-alignment, sigmoid, fallback, empty-context filter
// ---------------------------------------------------------------------------

describe("EXP-06: bge-reranker invocation", () => {
  it("Test 1 (index-alignment): candidate at original index 2 wins when it has the top score", async () => {
    // Three candidates ordered by RRF: cand0, cand1, cand2.
    // Reranker returns: id=2 (score=5.0, highest), id=0 (score=1.0), id=1 (score=-2.0).
    // So cand2 should receive the highest sigmoid-normalized rerank score.

    const blocks = [makeBlock("cand0"), makeBlock("cand1"), makeBlock("cand2")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    // top1 ≥ 0.65 so no fan-out — just the single-query path with 3 matches.
    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("cand0", 0.8), makeMatch("cand1", 0.78), makeMatch("cand2", 0.76)],
      count: 3,
    });

    // safeRun(EMBEDDING_MODEL) → MOCK_QUERY_VECTOR
    // safeRun(RERANKER_MODEL) → reranker response with id=2 winning
    mockSafeRun.mockImplementation((_env, model: string) => {
      if (model === "@cf/baai/bge-reranker-base") {
        return Promise.resolve({
          response: [
            { id: 2, score: 5.0 }, // cand2 — highest
            { id: 0, score: 1.0 }, // cand0
            { id: 1, score: -2.0 }, // cand1 — lowest
          ],
        });
      }
      // embedding model
      return Promise.resolve({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });
    });

    const capturedMatches: { id: string; score: number }[] = [];
    mockHybridRank.mockImplementation((matches) => {
      capturedMatches.push(...(matches as { id: string; score: number }[]));
      return blocks as never[];
    });

    await recall({ query: "test" });

    // hybridRank must have been called with reranked matches.
    expect(capturedMatches.length).toBeGreaterThan(0);

    // Find the match for each candidate in the input to hybridRank.
    const cand0 = capturedMatches.find((m) => m.id === "cand0");
    const cand1 = capturedMatches.find((m) => m.id === "cand1");
    const cand2 = capturedMatches.find((m) => m.id === "cand2");

    // All candidates must be present — any undefined means the block lookup failed.
    expect(cand2).toBeDefined();
    expect(cand0).toBeDefined();
    expect(cand1).toBeDefined();

    // cand2 has reranker id=2 (highest score=5.0) → should have highest sigmoid-normalized score.
    // cand1 has reranker id=1 (score=-2.0) → should have lowest score.
    // Use optional chaining + toBeGreaterThan (undefined fails the comparison).
    expect(cand2?.score ?? -Infinity).toBeGreaterThan(cand0?.score ?? Infinity);
    expect(cand0?.score ?? -Infinity).toBeGreaterThan(cand1?.score ?? Infinity);
  });

  it("Test 2 (sigmoid normalization): logit 5.0 maps to ≈0.9933, logit -2.0 maps to ≈0.1192", async () => {
    const blocks = [makeBlock("a"), makeBlock("b"), makeBlock("c")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("a", 0.8), makeMatch("b", 0.78), makeMatch("c", 0.76)],
      count: 3,
    });

    mockSafeRun.mockImplementation((_env, model: string) => {
      if (model === "@cf/baai/bge-reranker-base") {
        return Promise.resolve({
          response: [
            { id: 0, score: 5.0 }, // a: logit 5.0 → sigmoid ≈ 0.9933
            { id: 1, score: 0.0 }, // b: logit 0.0 → sigmoid = 0.5
            { id: 2, score: -2.0 }, // c: logit -2.0 → sigmoid ≈ 0.1192
          ],
        });
      }
      return Promise.resolve({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });
    });

    const capturedMatches2: { id: string; score: number }[] = [];
    mockHybridRank.mockImplementation((matches) => {
      capturedMatches2.push(...(matches as { id: string; score: number }[]));
      return blocks as never[];
    });

    await recall({ query: "test" });

    expect(capturedMatches2.length).toBeGreaterThan(0);
    const matchA = capturedMatches2.find((m) => m.id === "a");
    const matchB = capturedMatches2.find((m) => m.id === "b");
    const matchC = capturedMatches2.find((m) => m.id === "c");

    expect(matchA).toBeDefined();
    expect(matchB).toBeDefined();
    expect(matchC).toBeDefined();

    // Sigmoid-normalized logit 5.0 → 1/(1+e^-5) ≈ 0.9933.
    expect(matchA?.score).toBeCloseTo(0.9933, 3);
    // Sigmoid-normalized logit 0.0 → 0.5.
    expect(matchB?.score).toBeCloseTo(0.5, 3);
    // Sigmoid-normalized logit -2.0 → 1/(1+e^2) ≈ 0.1192.
    expect(matchC?.score).toBeCloseTo(0.1192, 3);
  });

  it("Test 3 (reranker fallback): recall does NOT crash on reranker throw; matches keep raw cosine scores", async () => {
    const blocks = [makeBlock("m1"), makeBlock("m2")];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    const singleMatches = [makeMatch("m1", 0.8), makeMatch("m2", 0.75)];
    mockVectorizeQuery.mockResolvedValue({
      matches: singleMatches,
      count: 2,
    });

    // Reranker throws (any error, not necessarily 429).
    mockSafeRun.mockImplementation((_env, model: string) => {
      if (model === "@cf/baai/bge-reranker-base") {
        return Promise.reject(new Error("reranker service unavailable"));
      }
      return Promise.resolve({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });
    });

    const capturedMatches3: { id: string; score: number }[] = [];
    mockHybridRank.mockImplementation((matches) => {
      capturedMatches3.push(...(matches as { id: string; score: number }[]));
      return blocks as never[];
    });

    // Must not throw.
    await expect(recall({ query: "test" })).resolves.not.toThrow();

    // Each match must have kept its original raw cosine score (fallback via ?? m.score).
    expect(capturedMatches3.length).toBeGreaterThan(0);
    const m1 = capturedMatches3.find((m) => m.id === "m1");
    const m2 = capturedMatches3.find((m) => m.id === "m2");
    expect(m1?.score).toBe(0.8); // raw cosine preserved
    expect(m2?.score).toBe(0.75); // raw cosine preserved
  });

  it("Test 4 (empty-context filter, Pitfall 6): null-content/null-summary candidate excluded from reranker contexts", async () => {
    // cand0: has content; cand1: null content AND null summary (empty — excluded from reranker).
    const blocks = [makeBlock("cand0", "real content"), makeBlock("cand1", null, null)];
    const doStub = makeDoStub(blocks);
    const recall = captureRecallCallback(WS_ID, doStub);

    mockVectorizeQuery.mockResolvedValue({
      matches: [makeMatch("cand0", 0.8), makeMatch("cand1", 0.75)],
      count: 2,
    });

    let capturedRerankerBody: { query: string; contexts: { text: string }[] } | null = null;
    mockSafeRun.mockImplementation((_env, model: string, body) => {
      if (model === "@cf/baai/bge-reranker-base") {
        capturedRerankerBody = body as { query: string; contexts: { text: string }[] };
        // Return a valid single-context response (for cand0 only, since cand1 is excluded).
        return Promise.resolve({
          response: [{ id: 0, score: 1.0 }],
        });
      }
      return Promise.resolve({ data: [MOCK_QUERY_VECTOR], shape: [1, EMBEDDING_DIMS] });
    });

    mockHybridRank.mockReturnValue(blocks as never[]);

    await recall({ query: "test" });

    // The reranker must have been called (cand0 has content).
    expect(capturedRerankerBody).not.toBeNull();
    // cand1 (null content + null summary) must NOT appear in contexts.
    // capturedRerankerBody is null until the mock sets it; use type assertion after the not-null check.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const rerankerBody = capturedRerankerBody!;
    expect(rerankerBody.contexts).toHaveLength(1);
    expect(rerankerBody.contexts[0]?.text).toBe("real content");

    // cand1 must have kept its raw cosine score (excluded from reranking).
    // hybridRank was called — check its input for cand1's score.
    const capturedMatches4: { id: string; score: number }[] = [];
    // The mock was set to mockReturnValue above — we need to read calls instead.
    // hybridRank was already called; inspect its first call's first argument.
    const hybridCallsArg = mockHybridRank.mock.calls[0]?.[0];
    if (hybridCallsArg) {
      capturedMatches4.push(...(hybridCallsArg as { id: string; score: number }[]));
    }
    const cand1InHybrid = capturedMatches4.find((m) => m.id === "cand1");
    // cand1's score should be its original cosine 0.75 (since it was excluded from reranking).
    if (cand1InHybrid) {
      expect(cand1InHybrid.score).toBe(0.75);
    }
  });
});
