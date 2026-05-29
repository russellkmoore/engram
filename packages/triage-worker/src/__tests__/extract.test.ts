/**
 * RED test stubs for `extract.ts` (AI-05 + AI-07 queue-consumer pipeline).
 *
 * These tests COMPILE but FAIL because `../extract.js` does not exist yet —
 * Plan 05-04 (Wave 2) creates it. The import-resolution failure is the
 * expected RED state.
 *
 * Requirements covered:
 * - AI-05: extractAndScore orchestrates the Triage Worker AI pipeline
 *   (AI classification → Zod parse → memorability routing).
 * - AI-07: 429 rate-limit handling has TWO paths:
 *   (1) thrown AiError → message.retry({delaySeconds: 30})
 *   (2) binding envelope {success: false, errors: [{code: 7501}]} → same retry
 *   Both MUST trigger retry, not crash the batch.
 *
 * The vi.fn() message mock shape mirrors RESEARCH §"Example 7".
 *
 * @module @engram/triage-worker/__tests__/extract
 */
/* eslint-disable @typescript-eslint/require-await */
// Rationale: extract.ts now exists (Phase 5 shipped). The no-unsafe-* rules are no
// longer needed (Phase 6 cleanup); require-await remains because mock AI.run callbacks
// are `async` for type compatibility but don't await anything.
import { describe, it, expect, vi } from "vitest";

import { extractAndScore } from "../extract.js";

// Minimal MemoryEvent shape for mocking.
const baseEvent = {
  id: "evt-001",
  source: "mcp:claude",
  content: "I had a meeting with Alice from Acme Corp",
  workspace_id: "ws-test",
  timestamp: Date.now(),
};

// Phase 6 PIP-05: shared stub builder for the cross-Worker WORKSPACE DO binding.
// Returns a fake namespace whose `get(...)` yields a stub with `markIngestFailed`
// as a vi.fn(). Tests can inspect mockMarkIngestFailed to assert call order/args.
function makeWorkspaceStub() {
  const mockMarkIngestFailed = vi.fn().mockResolvedValue(undefined);
  const stub = { markIngestFailed: mockMarkIngestFailed };
  const WORKSPACE = {
    idFromName: vi.fn().mockReturnValue({ toString: () => "fake-id" }),
    get: vi.fn().mockReturnValue(stub),
  };
  return { WORKSPACE, mockMarkIngestFailed };
}

// ---------------------------------------------------------------------------
// AI-07: 429 dual-path retry tests
// ---------------------------------------------------------------------------

describe("AI-05 + AI-07: extractAndScore", () => {
  it("AI-07 dual-path #1: thrown AiError(429) triggers message.retry({delaySeconds: 30})", async () => {
    const message = {
      retry: vi.fn(),
      ack: vi.fn(),
      attempts: 1,
      body: baseEvent,
    } as unknown as Parameters<typeof extractAndScore>[2];

    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      AI: {
        run: async () => {
          throw new Error("HTTP 429 too many requests");
        },
      },
      WORKSPACE,
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("AI-07 dual-path #2: envelope {success:false, errors:[{code:7501}]} triggers message.retry", async () => {
    const message = {
      retry: vi.fn(),
      ack: vi.fn(),
      attempts: 1,
      body: baseEvent,
    } as unknown as Parameters<typeof extractAndScore>[2];

    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      AI: {
        run: async () => ({
          success: false,
          errors: [{ code: 7501, message: "Workers AI rate limit reached" }],
        }),
      },
      WORKSPACE,
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("AI-05: Zod parse fail + attempts<2 → message.retry({delaySeconds: 5})", async () => {
    const message = {
      retry: vi.fn(),
      ack: vi.fn(),
      attempts: 1,
      body: baseEvent,
    } as unknown as Parameters<typeof extractAndScore>[2];

    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      AI: {
        // Returns valid HTTP 200 but body is not a valid TriageOutput (missing required fields).
        run: async () => ({
          response: { not_a_valid_field: "garbage output from AI" },
        }),
      },
      WORKSPACE,
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("AI-05: Zod parse fail + attempts>=2 → message.ack (permanent failure, DLQ-equivalent)", async () => {
    const message = {
      retry: vi.fn(),
      ack: vi.fn(),
      attempts: 2,
      body: baseEvent,
    } as unknown as Parameters<typeof extractAndScore>[2];

    const { WORKSPACE } = makeWorkspaceStub();
    const mockEnv = {
      AI: {
        run: async () => ({
          response: { not_a_valid_field: "still garbage on attempt 2" },
        }),
      },
      WORKSPACE,
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Phase 6 PIP-05: markIngestFailed call ordering on Zod-permanent-fail
  // -------------------------------------------------------------------------

  it("PIP-05: Zod parse fail + attempts>=2 calls markIngestFailed BEFORE ack with reason starting 'zod-parse-fail:'", async () => {
    const message = {
      retry: vi.fn(),
      ack: vi.fn(),
      attempts: 2,
      body: baseEvent,
    } as unknown as Parameters<typeof extractAndScore>[2];

    const { WORKSPACE, mockMarkIngestFailed } = makeWorkspaceStub();
    const mockEnv = {
      AI: {
        run: async () => ({
          response: { not_a_valid_field: "permanent garbage" },
        }),
      },
      WORKSPACE,
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);

    // markIngestFailed must be called BEFORE ack — proves the SQLite surface
    // gets flipped to 'failed' before the queue runtime releases the message.
    expect(mockMarkIngestFailed).toHaveBeenCalledTimes(1);
    expect(message.ack).toHaveBeenCalledTimes(1);
    const markOrder = mockMarkIngestFailed.mock.invocationCallOrder[0];
    const ackOrder = (message.ack as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0];
    if (markOrder === undefined || ackOrder === undefined) {
      throw new Error("missing invocationCallOrder entries");
    }
    expect(markOrder).toBeLessThan(ackOrder);

    // Verify the reason payload — workspace_id + block_id + reason prefix.
    const callArgs = mockMarkIngestFailed.mock.calls[0]?.[0] as {
      workspace_id: string;
      block_id: string;
      reason: string;
    };
    expect(callArgs.workspace_id).toBe(baseEvent.workspace_id);
    expect(callArgs.block_id).toBe(baseEvent.id);
    expect(callArgs.reason).toMatch(/^zod-parse-fail:/);

    expect(result).toBeNull();
  });
});
