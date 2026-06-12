/**
 * INT-03 D-10: Conflict-pipeline workspace routing isolation test.
 *
 * Proves that `conflictPipeline()` in the triage-worker routes its inbox write
 * to the correct workspace DO — identified by `newBlock.workspace_id` — and NOT
 * to a hardcoded or forgeable DO identifier.
 *
 * Security surface:
 * - The routing line under test: `env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id))`
 * - The write target under test: `insertConflictAsInbox({ workspace_id: newBlock.workspace_id, ... })`
 *
 * This file lives in the triage-worker package (not mcp-server) because
 * `conflictPipeline()` runs in a separate Worker. The mcp-server pentest
 * (cross-workspace-pentest.test.ts) covers the MCP layer; this file closes the
 * gap at the async fire-and-forget conflict pipeline layer.
 *
 * Requirements covered:
 * - INT-03 D-10: Triage-worker conflict-pipeline isolation proof
 * - T-05-04-01: WORKSPACE.idFromName spy captures the workspace_id argument
 * - T-05-04-02: insertConflictAsInbox write payload includes correct workspace_id
 * - T-05-04-03: Positive-control (anti-vacuous) proves spy actually records arguments
 *
 * @module @engram/triage-worker/__tests__/conflict-pipeline-isolation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { conflictPipeline } from "../conflict-pipeline.js";

// ---------------------------------------------------------------------------
// Module mocks (mirror conflict-pipeline.test.ts exactly)
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
// Import mocked modules for assertions (mirror conflict-pipeline.test.ts)
// ---------------------------------------------------------------------------

import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { detectConflict } from "../conflict-detection.js";

// ---------------------------------------------------------------------------
// Test fixtures (copied verbatim from conflict-pipeline.test.ts lines 66–83)
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

/** A neighbor match below the dupe ceiling (score 0.75 < 0.92). */
const neighborBelowCeiling = { id: "blk-neighbor-1", score: 0.75, values: [] };

/** A neighbor block body returned by getBlocksByIds. */
const neighborBlock = { id: "blk-neighbor-1", content: "A is B", created_at: Date.now() - 1000 };

// ---------------------------------------------------------------------------
// WorkspaceDO stub builder
// (copied from conflict-pipeline.test.ts lines 91–109 with spy-capture extension)
//
// D-10 extension: WORKSPACE.idFromName uses mockImplementation (not just
// mockReturnValue) so the spy records its argument for assertion while still
// returning a valid stub that `get()` can consume.
// ---------------------------------------------------------------------------

/**
 * Returns a fake DurableObjectNamespace whose `get(...)` yields a stub with
 * `getBlocksByIds` and `insertConflictAsInbox` as vi.fn() mocks.
 *
 * D-10 extension: idFromName uses mockImplementation to record the workspace_id
 * argument while returning a stub that `get()` accepts.
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
    // D-10: use mockImplementation so the spy captures the argument
    // while still returning a stub that env.WORKSPACE.get() can use.
    idFromName: vi
      .fn()
      .mockImplementation((id: string) => ({ toString: () => `fake-do-id-${id}` })),
    get: vi.fn().mockReturnValue(stub),
  };
  return { WORKSPACE, mockGetBlocks, mockInsertConflict };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("D-10 conflict-pipeline workspace routing isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // D-10 primary isolation assertion
  // -------------------------------------------------------------------------

  it("D-10: conflictPipeline routes WORKSPACE.idFromName lookup by newBlock.workspace_id, not a hardcoded or forgeable arg", async () => {
    const targetWorkspaceId = "ws-isolation-target-123";
    const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
    const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub({
      getBlocksByIds: () => Promise.resolve([neighborBlock]),
    });

    const mockEnv = {
      ...env,
      AI: { run: mockAiRun },
      WORKSPACE,
    } as unknown as Parameters<typeof conflictPipeline>[0];

    // score 0.75 — below 0.92 dupe ceiling, above 0.7 prefilter: reaches detectConflict
    vi.mocked(vectorizeNeighbors).mockResolvedValue([neighborBelowCeiling]);

    // detectConflict returns contradiction so insertConflictAsInbox is called
    vi.mocked(detectConflict).mockResolvedValue({
      is_conflict: true,
      category: "contradiction",
      confidence: 0.88,
      reason: "test contradiction for isolation proof",
    });

    const block = { ...baseNewBlock, workspace_id: targetWorkspaceId };
    await conflictPipeline(mockEnv, block);

    // Assert 1 (D-10 routing): idFromName was called with the block's workspace_id
    // — NOT a hardcoded string, NOT a forgeable request arg.
    expect(WORKSPACE.idFromName).toHaveBeenCalledWith(targetWorkspaceId);

    // Assert 2 (write target): insertConflictAsInbox write payload uses correct workspace_id
    expect(mockInsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: targetWorkspaceId }),
    );
  });

  // -------------------------------------------------------------------------
  // D-10 positive control (anti-vacuous — T-05-04-03)
  //
  // If idFromName were called with a hardcoded string (e.g., "ws-default"),
  // the primary assertion above might pass vacuously if the hardcoded value
  // happened to equal targetWorkspaceId. This test uses a DIFFERENT workspace_id
  // and asserts idFromName was NOT called with "ws-B" — proving the spy actually
  // records arguments correctly and is not vacuously passing.
  // -------------------------------------------------------------------------

  it("D-10 positive control: conflictPipeline does NOT write to a different workspace_id", async () => {
    const targetWorkspaceId = "ws-A";
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
      confidence: 0.9,
      reason: "positive-control contradiction",
    });

    const block = { ...baseNewBlock, workspace_id: targetWorkspaceId };
    await conflictPipeline(mockEnv, block);

    // Anti-vacuous: idFromName was called with "ws-A" (the block's workspace)
    expect(WORKSPACE.idFromName).toHaveBeenCalledWith(targetWorkspaceId);

    // Anti-vacuous: idFromName was NOT called with "ws-B"
    // If routing were hardcoded (e.g., "ws-B"), this would fail — proving the spy
    // records arguments accurately and the primary assertion is NOT vacuously true.
    expect(WORKSPACE.idFromName).not.toHaveBeenCalledWith("ws-B");

    // The write went to the correct workspace
    expect(mockInsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: targetWorkspaceId }),
    );
  });
});
