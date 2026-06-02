/**
 * Tests for `ai-helper.ts` (AI-03/04/07 constants + 429 dual-path).
 *
 * ENG-25 update: model-id constants are now re-exported from `@engram/ai-config`
 * (single source of truth). The historical cross-file identity test has been
 * removed — there is no longer "another file" to drift from. These tests now
 * assert FORMAT (valid `@cf/...` model-id shape) rather than literal values,
 * so a model swap in `shared/ai-config/src/index.ts` doesn't require parallel
 * test edits.
 *
 * Requirements covered:
 * - AI-03/AI-04: model-id constants resolve to valid Workers AI model strings
 * - AI-07: 429 rate-limit detection handles both the thrown AiError path AND
 *   the binding-envelope path (dual-path per AI-SPEC.md §3 Pitfall 1)
 *
 * @module @engram/mcp-server/__tests__/ai-helper
 */

import { describe, it, expect } from "vitest";

import {
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  EMBEDDING_DIMS,
  EMBEDDING_CONTEXT_WINDOW,
  CLASSIFIER_MODEL,
  INGESTION_CLASSIFIER_MODEL,
  SYNTHESIS_MODEL,
  QUERY_EXPANSION_MODEL,
  VISION_MODEL,
  detectRateLimit,
  isRateLimitError,
} from "../ai-helper.js";

// ---------------------------------------------------------------------------
// AI-03/04: model-id constant validity (format only — not literal values)
// ---------------------------------------------------------------------------

const WORKERS_AI_MODEL_ID = /^@cf\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-.]*$/;

describe("AI helper constants (ENG-25: format guard, not literal-value guard)", () => {
  it("EMBEDDING_MODEL is a valid Workers AI model id", () => {
    expect(EMBEDDING_MODEL).toMatch(WORKERS_AI_MODEL_ID);
  });

  it("INGESTION_CLASSIFIER_MODEL is a valid Workers AI model id", () => {
    expect(INGESTION_CLASSIFIER_MODEL).toMatch(WORKERS_AI_MODEL_ID);
  });

  it("CLASSIFIER_MODEL is the backward-compat alias for INGESTION_CLASSIFIER_MODEL", () => {
    expect(CLASSIFIER_MODEL).toBe(INGESTION_CLASSIFIER_MODEL);
  });

  it("SYNTHESIS_MODEL / QUERY_EXPANSION_MODEL / VISION_MODEL are valid Workers AI ids (v0.1 alias INGESTION_CLASSIFIER_MODEL)", () => {
    expect(SYNTHESIS_MODEL).toMatch(WORKERS_AI_MODEL_ID);
    expect(QUERY_EXPANSION_MODEL).toMatch(WORKERS_AI_MODEL_ID);
    expect(VISION_MODEL).toMatch(WORKERS_AI_MODEL_ID);
  });

  it("EMBEDDING_VERSION is a positive integer (stamps blocks.embedding_version for migrations)", () => {
    expect(EMBEDDING_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(EMBEDDING_VERSION)).toBe(true);
  });

  it("EMBEDDING_DIMS + EMBEDDING_CONTEXT_WINDOW are positive integers", () => {
    expect(EMBEDDING_DIMS).toBeGreaterThan(0);
    expect(EMBEDDING_CONTEXT_WINDOW).toBeGreaterThan(0);
    expect(Number.isInteger(EMBEDDING_DIMS)).toBe(true);
    expect(Number.isInteger(EMBEDDING_CONTEXT_WINDOW)).toBe(true);
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
