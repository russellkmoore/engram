/**
 * Unit tests for `conflictPipeline` (CON-02/04/06/07/08 + embed-on-entry contract).
 *
 * Tests run in the `workerd` project via `@cloudflare/vitest-pool-workers`.
 * Each scenario exercises one verdict branch; mocks are reset between tests
 * via `beforeEach(() => vi.clearAllMocks())`.
 *
 * Requirements covered:
 * - CON-02: embed → prefilter → parallel detect orchestration
 * - CON-04: contradiction inbox write with exact shape (InboxConflictProperties)
 * - CON-06: cosine-ceiling dupe filter at 0.92
 * - CON-07: bounded-parallel ≤3 detectConflict calls (structural cap via topK=3)
 * - CON-08: source file has no notification primitives (grep test)
 * - Embed-on-entry: env.AI.run called exactly once with EMBEDDING_MODEL + text content
 *
 * Note: workerd does NOT implement `node:fs`. The CON-08 grep test uses a Vite
 * `?raw` import to inline the source file as a string at bundle time — this is
 * the canonical Cloudflare-pool-safe alternative to `fs.readFileSync` (same
 * pattern as `packages/mcp-server/src/__tests__/index.test.ts`).
 *
 * @module @engram/triage-worker/__tests__/conflict-pipeline
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:workers";

// Vite `?raw` query inlines the file content as a string at bundle time.
// workerd does not implement `node:fs` — `?raw` is the canonical alternative.
// @ts-expect-error -- `?raw` is a Vite runtime feature; TS doesn't know the module shape
import conflictPipelineSourceRaw from "../conflict-pipeline.ts?raw";
const conflictPipelineSource: string = conflictPipelineSourceRaw as string;

import { conflictPipeline } from "../conflict-pipeline.js";
import { EMBEDDING_MODEL } from "@engram/ai-config";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@engram/vectorize-utils", () => ({
  vectorizeNeighbors: vi.fn(),
}));

vi.mock("../conflict-detection.js", () => ({
  detectConflict: vi.fn(),
}));

vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("ws-tag-stub"),
}));

// ---------------------------------------------------------------------------
// Import mocked modules for assertions
// ---------------------------------------------------------------------------

import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { detectConflict } from "../conflict-detection.js";
import { writeAnalytics } from "../analytics.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Standard newBlock shape — 6 fields, no `embedding` field (Path A). */
const baseNewBlock = {
  id: "blk-new",
  workspace_id: "ws-test",
  type: "fact",
  scope: "personal",
  content: "X is Y",
  created_at: Date.now(),
};

/** A minimal 1024-float embed response matching qwen3-embedding-0.6b shape. */
const fakeEmbedResp = { data: [new Array<number>(1024).fill(0.1)] };

/** A neighbor match below the dupe ceiling. */
const neighborBelowCeiling = { id: "blk-neighbor-1", score: 0.75, values: [] };

/** A neighbor block body returned by getBlocksByIds. */
const neighborBlock = { id: "blk-neighbor-1", content: "A is B", created_at: Date.now() - 1000 };

// ---------------------------------------------------------------------------
// WorkspaceDO stub builder
// ---------------------------------------------------------------------------

/**
 * Returns a fake DurableObjectNamespace whose `get(...)` yields a stub with
 * `getBlocksByIds` and `insertConflictAsInbox` as vi.fn() mocks.
 */
function makeWorkspaceStub(
  overrides: {
    getBlocksByIds?: () => Promise<{ id: string; content: string; created_at: number }[]>;
    insertConflictAsInbox?: () => Promise<void>;
  } = {},
) {
  const mockGetBlocks = vi.fn(overrides.getBlocksByIds ?? (() => Promise.resolve([neighborBlock])));
  const mockInsertConflict = vi.fn(overrides.insertConflictAsInbox ?? (() => Promise.resolve()));
  const stub = {
    getBlocksByIds: mockGetBlocks,
    insertConflictAsInbox: mockInsertConflict,
  };
  const WORKSPACE = {
    idFromName: vi.fn().mockReturnValue({ toString: () => "fake-do-id" }),
    get: vi.fn().mockReturnValue(stub),
  };
  return { WORKSPACE, mockGetBlocks, mockInsertConflict };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CON-02 conflict-pipeline orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Embed-on-entry contract
  // -------------------------------------------------------------------------

  it("embed call fires exactly once per pipeline invocation (embed-on-entry)", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    // vectorizeNeighbors returns empty — pipeline exits early (verdict=unrelated)
    vi.mocked(vectorizeNeighbors).mockResolvedValue([]);

    await conflictPipeline(mockEnv, baseNewBlock);

    expect(mockAiRun).toHaveBeenCalledTimes(1);
    expect(mockAiRun).toHaveBeenCalledWith(EMBEDDING_MODEL, { text: [baseNewBlock.content] });
  });

  // -------------------------------------------------------------------------
  // Verdict: unrelated (no neighbors above threshold)
  // -------------------------------------------------------------------------

  it("no neighbors above threshold → verdict=unrelated, no inbox writes (CON-02)", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub();
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    vi.mocked(vectorizeNeighbors).mockResolvedValue([]);

    await conflictPipeline(mockEnv, baseNewBlock);

    expect(vi.mocked(detectConflict)).not.toHaveBeenCalled();
    expect(mockInsertConflict).not.toHaveBeenCalled();
    expect(vi.mocked(writeAnalytics)).toHaveBeenCalledOnce();
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    const datapoint = analyticsCall[1];
    expect(datapoint.blobs[0]).toBe("conflict-pipeline");
    expect(datapoint.blobs[1]).toBe("unrelated");
    expect(datapoint.doubles[1]).toBe(0); // neighbors_examined = 0
  });

  // -------------------------------------------------------------------------
  // Verdict: skipped-dupe (all neighbors above dupe ceiling)
  // -------------------------------------------------------------------------

  it("all neighbors above dupe ceiling (cosine ≥ 0.92) → verdict=skipped-dupe (CON-06)", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub();
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    // 3 neighbors all above the 0.92 dupe ceiling
    vi.mocked(vectorizeNeighbors).mockResolvedValue([
      { id: "blk-a", score: 0.95, values: [] },
      { id: "blk-b", score: 0.94, values: [] },
      { id: "blk-c", score: 0.93, values: [] },
    ]);

    await conflictPipeline(mockEnv, baseNewBlock);

    expect(vi.mocked(detectConflict)).not.toHaveBeenCalled();
    expect(mockInsertConflict).not.toHaveBeenCalled();
    expect(vi.mocked(writeAnalytics)).toHaveBeenCalledOnce();
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    const datapoint = analyticsCall[1];
    expect(datapoint.blobs[1]).toBe("skipped-dupe");
    expect(datapoint.doubles[1]).toBe(3); // neighbors_examined = 3
  });

  // -------------------------------------------------------------------------
  // Verdict: contradiction + CON-04 inbox write shape
  // -------------------------------------------------------------------------

  it("contradiction detected → inbox write with exact CON-04 shape; verdict=contradiction", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub({
      getBlocksByIds: () => Promise.resolve([neighborBlock]),
    });
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    vi.mocked(vectorizeNeighbors).mockResolvedValue([neighborBelowCeiling]);

    vi.mocked(detectConflict).mockResolvedValue({
      is_conflict: true,
      category: "contradiction",
      confidence: 0.88,
      reason: "claims A but later claims not-A",
    });

    await conflictPipeline(mockEnv, baseNewBlock);

    // Inbox write must be called exactly once
    expect(mockInsertConflict).toHaveBeenCalledTimes(1);
    expect(mockInsertConflict).toHaveBeenCalledWith({
      workspace_id: baseNewBlock.workspace_id,
      memory_a_id: baseNewBlock.id,
      memory_b_id: neighborBlock.id,
      category: "contradiction",
      ai_confidence: 0.88,
      description: "claims A but later claims not-A",
    });

    // Analytics verdict
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    expect(analyticsCall[1].blobs[1]).toBe("contradiction");
  });

  // -------------------------------------------------------------------------
  // Verdict: benign_update (no contradictions)
  // -------------------------------------------------------------------------

  it("only benign updates from detectConflict → verdict=benign_update, no inbox writes", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub({
      getBlocksByIds: () => Promise.resolve([neighborBlock]),
    });
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    vi.mocked(vectorizeNeighbors).mockResolvedValue([neighborBelowCeiling]);

    // detectConflict returns benign_update (not contradiction)
    vi.mocked(detectConflict).mockResolvedValue({
      is_conflict: false,
      category: "benign_update",
      confidence: 0.9,
      reason: "role changed forward in time",
    });

    await conflictPipeline(mockEnv, baseNewBlock);

    expect(mockInsertConflict).not.toHaveBeenCalled();
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    expect(analyticsCall[1].blobs[1]).toBe("benign_update");
  });

  // -------------------------------------------------------------------------
  // CON-07: bounded-parallel ≤3 detectConflict calls
  // -------------------------------------------------------------------------

  it("bounded-parallel ≤3 detectConflict calls per write (CON-07)", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const threeNeighborBlocks = [
      { id: "blk-n1", content: "content-1", created_at: Date.now() },
      { id: "blk-n2", content: "content-2", created_at: Date.now() },
      { id: "blk-n3", content: "content-3", created_at: Date.now() },
    ];
    const { WORKSPACE } = makeWorkspaceStub({
      getBlocksByIds: () => Promise.resolve(threeNeighborBlocks),
    });
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    // 3 neighbors all below dupe ceiling → all reach detectConflict
    vi.mocked(vectorizeNeighbors).mockResolvedValue([
      { id: "blk-n1", score: 0.75, values: [] },
      { id: "blk-n2", score: 0.78, values: [] },
      { id: "blk-n3", score: 0.8, values: [] },
    ]);

    vi.mocked(detectConflict).mockResolvedValue({
      is_conflict: false,
      category: "unrelated",
      confidence: 0.5,
      reason: "different topics",
    });

    await conflictPipeline(mockEnv, baseNewBlock);

    // Structural cap: topK=3 means exactly 3 detectConflict calls
    expect(vi.mocked(detectConflict)).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Error: embed AI call throws → verdict=error, analytics still emitted
  // -------------------------------------------------------------------------

  it("embed AI call throws → verdict=error; analytics still emitted; no re-throw", async () => {
    const mockAiRun = vi.fn().mockRejectedValue(new Error("Workers AI 429"));
    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    // Should NOT throw
    await expect(conflictPipeline(mockEnv, baseNewBlock)).resolves.toBeUndefined();

    // Vectorize should NOT have been called (embed failed first)
    expect(vi.mocked(vectorizeNeighbors)).not.toHaveBeenCalled();

    // Analytics must still fire with verdict=error
    expect(vi.mocked(writeAnalytics)).toHaveBeenCalledOnce();
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    expect(analyticsCall[1].blobs[1]).toBe("error");
    expect(analyticsCall[1].blobs[3]).toBe("failed");
    expect(analyticsCall[1].doubles[3]).toBe(1); // error_flag
  });

  // -------------------------------------------------------------------------
  // Error: Vectorize throws → caught locally, analytics still emitted (Pitfall 6)
  // -------------------------------------------------------------------------

  it("Vectorize throws → caught locally; verdict=error; analytics still emitted (Pitfall 6)", async () => {
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    vi.mocked(vectorizeNeighbors).mockRejectedValue(new Error("Vectorize binding error"));

    // Should NOT throw
    await expect(conflictPipeline(mockEnv, baseNewBlock)).resolves.toBeUndefined();

    // Analytics still fired
    expect(vi.mocked(writeAnalytics)).toHaveBeenCalledOnce();
    const analyticsCall = vi.mocked(writeAnalytics).mock.calls[0];
    if (analyticsCall === undefined) throw new Error("writeAnalytics not called");
    expect(analyticsCall[1].blobs[1]).toBe("error");
    expect(analyticsCall[1].doubles[3]).toBe(1); // error_flag
  });

  // -------------------------------------------------------------------------
  // CON-08: source file has no notification primitives
  // -------------------------------------------------------------------------

  it("CON-08: source has no notification primitives", () => {
    // Strip block comments and line comments before grepping.
    // The architectural-lock note in the file header IS allowed to mention
    // "notifications" / "notify" as the lock text — we strip comments first.
    const code = conflictPipelineSource
      .replace(/\/\*[\s\S]*?\*\//g, "") // strip block comments
      .replace(/\/\/.*$/gm, ""); // strip line comments
    // Forbidden: real notification/alerting primitives in executable code.
    // Regex is specific enough to match API-like names but not generic substrings.
    const forbidden =
      /\b(sendEmail|sendWebhook|pushNotif(?:ication)?|notifyUser|slackNotif|slackMessage|postToSlack)\b/i;
    expect(code).not.toMatch(forbidden);

    // Broader check: none of EMAIL_, WEBHOOK_ identifier prefixes
    const broadForbidden = /\b(?:email|webhook)_\w+\b/i;
    expect(code).not.toMatch(broadForbidden);
  });
});
