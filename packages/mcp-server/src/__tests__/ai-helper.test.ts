/**
 * Tests for `ai-helper.ts` (AI-03/04/07 constant + 429 dual-path).
 *
 * Plan 05-02 (Wave 1) shipped `ai-helper.ts` in mcp-server.
 * Plan 05-04 (Wave 2b) ships `ai-helper.ts` in triage-worker and wires the
 * cross-file identity test asserting literal-string equality on all 3 model
 * constants (AI-SPEC.md §5 dimension #2 identity-check gate).
 *
 * Requirements covered:
 * - AI-03/AI-04: model-id constants locked at AI-SPEC.md §5 values; drift
 *   between mcp-server and triage-worker is caught by a cross-file equality
 *   assertion.
 * - AI-07: 429 rate-limit detection must handle BOTH the thrown AiError path
 *   AND the binding-envelope path (dual-path per AI-SPEC.md §3 Pitfall 1).
 *
 * @module @engram/mcp-server/__tests__/ai-helper
 */

import { describe, it, expect } from "vitest";

import {
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  CLASSIFIER_MODEL,
  detectRateLimit,
  isRateLimitError,
} from "../ai-helper.js";

// ---------------------------------------------------------------------------
// AI-03/04: model-id constant drift guard
// ---------------------------------------------------------------------------

describe("AI helper constants (AI-03/04 drift guard)", () => {
  it("EMBEDDING_MODEL is @cf/baai/bge-base-en-v1.5 (AI-SPEC.md §5)", () => {
    expect(EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
  });

  it("EMBEDDING_VERSION is 1 (stamps blocks.embedding_version for future model migrations)", () => {
    expect(EMBEDDING_VERSION).toBe(1);
  });

  it("CLASSIFIER_MODEL is @cf/meta/llama-3.1-8b-instruct (AI-SPEC.md §5)", () => {
    expect(CLASSIFIER_MODEL).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  it.skip("EMBEDDING_MODEL is identical across mcp-server and triage-worker (AI-SPEC.md §5 dimension #2 identity-check gate — tested in ai-helper-identity.test.ts lint-node pool)", () => {
    // workerd pool cannot use node:fs readFileSync for cross-package file reads.
    // The actual identity assertion lives in ai-helper-identity.test.ts (lint-node pool)
    // which uses node:fs to read triage-worker/src/ai-helper.ts directly.
  });
});

// ---------------------------------------------------------------------------
// AI-07: 429 detection — envelope path (detectRateLimit)
// ---------------------------------------------------------------------------

describe("AI-07: 429 detection (envelope path — detectRateLimit)", () => {
  it("returns true on envelope {success:false, errors:[{code:7501}]}", () => {
    expect(
      detectRateLimit({ success: false, errors: [{ code: 7501, message: "rate limit" }] }),
    ).toBe(true);
  });

  it("returns true on errors[].code 3036 (out-of-capacity)", () => {
    expect(
      detectRateLimit({ success: false, errors: [{ code: 3036, message: "out of capacity" }] }),
    ).toBe(true);
  });

  it("returns true on errors[].code 3040", () => {
    expect(
      detectRateLimit({ success: false, errors: [{ code: 3040, message: "rate exceeded" }] }),
    ).toBe(true);
  });

  it("returns true when errors[].message matches /429|rate|capacity/i", () => {
    expect(
      detectRateLimit({ success: false, errors: [{ code: 9999, message: "HTTP 429 too many" }] }),
    ).toBe(true);
  });

  it("returns false on success response", () => {
    expect(detectRateLimit({ data: [[1, 2, 3]], shape: [1, 3] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AI-07: 429 detection — thrown path (isRateLimitError)
// ---------------------------------------------------------------------------

describe("AI-07: 429 detection (thrown path — isRateLimitError)", () => {
  it("returns true for Error with 'HTTP 429' in message", () => {
    expect(isRateLimitError(new Error("inference upstream HTTP 429"))).toBe(true);
  });

  it("returns true for Error with error code 3040 in message", () => {
    expect(isRateLimitError(new Error("error 3040 out of capacity"))).toBe(true);
  });

  it("returns false for generic Error('invalid model id')", () => {
    expect(isRateLimitError(new Error("invalid model id"))).toBe(false);
  });
});
