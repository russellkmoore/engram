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
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
// Rationale: extract.ts does not exist yet (Plan 05-04 deliverable). TypeScript
// resolves all imports from ../extract.js as error-typed, triggering no-unsafe-*
// and require-await rules. Tests are intentionally RED until Plan 05-04 ships.
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

    const mockEnv = {
      AI: {
        run: async () => {
          throw new Error("HTTP 429 too many requests");
        },
      },
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

    const mockEnv = {
      AI: {
        run: async () => ({
          success: false,
          errors: [{ code: 7501, message: "Workers AI rate limit reached" }],
        }),
      },
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

    const mockEnv = {
      AI: {
        // Returns valid HTTP 200 but body is not a valid TriageOutput (missing required fields).
        run: async () => ({
          response: { not_a_valid_field: "garbage output from AI" },
        }),
      },
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

    const mockEnv = {
      AI: {
        run: async () => ({
          response: { not_a_valid_field: "still garbage on attempt 2" },
        }),
      },
    } as unknown as Parameters<typeof extractAndScore>[0];

    const result = await extractAndScore(mockEnv, baseEvent, message);
    expect(message.ack).toHaveBeenCalled();
    expect(message.retry).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
