/**
 * Tests for `query-expansion.ts` (EXP-01, EXP-02, EXP-09).
 *
 * Requirements covered:
 * - EXP-01: `expandQuery` returns `[original, p1, p2]` with the original
 *   ALWAYS at index 0 (prepended in code, never requested from the model — QE-7).
 *   A malformed model response fails the zod safeParse gate and degrades to
 *   `[originalQuery]` (single-item fallback).
 * - EXP-02: `keepVariantsAboveGate` drops paraphrases whose cosine similarity
 *   to the original query vector is < 0.85. The original (variants[0]) is
 *   NEVER dropped regardless of gate.
 * - EXP-09: `EXPANSION_SYSTEM_PROMPT` contains an explicit anti-HyDE rule
 *   (no hypothetical documents / no fabrication) and a verbatim named-entity
 *   preservation rule.
 *
 * All tests are creds-free — `safeRun` is mocked via vi.mock so no AI binding
 * is required. Mirrors the `hybrid-rank.test.ts` describe/it structure.
 *
 * @module @engram/mcp-server/__tests__/query-expansion
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ai-helper module BEFORE importing query-expansion so safeRun is
// intercepted at module load time.
vi.mock("../ai-helper.js", () => ({
  safeRun: vi.fn(),
  QUERY_EXPANSION_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
}));

import {
  expandQuery,
  keepVariantsAboveGate,
  ExpansionOutput,
  EXPANSION_SYSTEM_PROMPT,
} from "../query-expansion.js";
import { safeRun } from "../ai-helper.js";

const mockSafeRun = vi.mocked(safeRun);

// Minimal env mock — safeRun is mocked so AI is never called directly.
const mockEnv = { AI: {} as Ai };

describe("expandQuery (EXP-01 anchor + zod gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 (anchor, EXP-01): returns [original, p1, p2] with original always at index 0", async () => {
    mockSafeRun.mockResolvedValueOnce({
      response: { paraphrases: ["how do I auth", "login flow steps"] },
    });

    const original = "authentication flow for OAuth";
    const result = await expandQuery(mockEnv, original);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(original); // QE-7: original anchored at [0]
    expect(result[1]).toBe("how do I auth");
    expect(result[2]).toBe("login flow steps");
  });

  it("Test 2 (zod gate degrade): returns [originalQuery] when model returns wrong paraphrase count", async () => {
    // 3 paraphrases violates `.length(2)` constraint — safeParse must fail
    mockSafeRun.mockResolvedValueOnce({
      response: { paraphrases: ["how do I auth", "login flow steps", "extra paraphrase"] },
    });

    const original = "authentication flow for OAuth";
    const result = await expandQuery(mockEnv, original);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(original);
  });

  it("Test 2b (zod gate degrade): returns [originalQuery] when model returns non-string element", async () => {
    mockSafeRun.mockResolvedValueOnce({
      response: { paraphrases: [123, "login flow steps"] },
    });

    const original = "authentication flow for OAuth";
    const result = await expandQuery(mockEnv, original);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(original);
  });

  it("Test 3 (unwrap): handles string-serialized JSON in response field", async () => {
    // Workers AI sometimes returns JSON as a string inside `response`
    mockSafeRun.mockResolvedValueOnce({
      response: JSON.stringify({ paraphrases: ["how do I auth", "login flow steps"] }),
    });

    const original = "authentication flow for OAuth";
    const result = await expandQuery(mockEnv, original);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(original);
    expect(result[1]).toBe("how do I auth");
    expect(result[2]).toBe("login flow steps");
  });

  it("Test 4 (anti-HyDE string, EXP-09): EXPANSION_SYSTEM_PROMPT forbids hypothetical documents and preserves named entities", () => {
    // String-content assertions — behavioral HyDE check lives in the EXP-09 eval (03-05).
    const prompt = EXPANSION_SYSTEM_PROMPT;

    // Anti-HyDE rule must be present (case-insensitive match for flexibility)
    const hasNoHyDE =
      /hypothetical/i.test(prompt) ||
      /fabricat/i.test(prompt) ||
      /never invent/i.test(prompt) ||
      /HyDE/i.test(prompt);
    expect(hasNoHyDE).toBe(true);

    // Named-entity preservation rule must be present
    const hasEntityPreservation = /named entity/i.test(prompt) || /named entities/i.test(prompt);
    expect(hasEntityPreservation).toBe(true);

    // No-fabrication / real-query framing
    const hasRealQueryRule = /real search query/i.test(prompt) || /not.*answer/i.test(prompt);
    expect(hasRealQueryRule).toBe(true);
  });
});

describe("ExpansionOutput zod schema", () => {
  it("accepts exactly 2 paraphrases", () => {
    const result = ExpansionOutput.safeParse({
      paraphrases: ["query variant one", "query variant two"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 2 paraphrases", () => {
    const result = ExpansionOutput.safeParse({ paraphrases: ["only one"] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 2 paraphrases (.length(2) hard cap)", () => {
    const result = ExpansionOutput.safeParse({
      paraphrases: ["one", "two", "three"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string elements", () => {
    const result = ExpansionOutput.safeParse({ paraphrases: [123, "two"] });
    expect(result.success).toBe(false);
  });

  it("rejects empty strings (min(1) constraint)", () => {
    const result = ExpansionOutput.safeParse({ paraphrases: ["", "two"] });
    expect(result.success).toBe(false);
  });
});

describe("keepVariantsAboveGate (EXP-02 similarity gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a unit vector from a 2D angle so cosine is predictable:
   *   cos(theta) = dot(a, b) / (|a| * |b|) = cos(angle_diff)
   */
  function vectorAtAngle(angleRad: number): number[] {
    return [Math.cos(angleRad), Math.sin(angleRad)];
  }

  /**
   * Compute cosine between two 2D vectors (for test documentation).
   */
  function cosine(a: number[], b: number[]): number {
    const dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0);
    return dot; // unit vectors → |a|=|b|=1
  }

  it("Test 1 (keep above gate): keeps paraphrase with cosine ≥ 0.85", async () => {
    // original at angle 0 → [1, 0]
    // p1 at angle that gives cosine 0.90 ≈ cos(25.84°)
    const origVec = vectorAtAngle(0);
    const p1Angle = Math.acos(0.9);
    const p1Vec = vectorAtAngle(p1Angle);

    // Mock: embed call for p1 returns p1Vec
    mockSafeRun.mockResolvedValueOnce({
      data: [p1Vec],
    });

    const variants = ["original query", "high cosine paraphrase"];
    const result = await keepVariantsAboveGate(mockEnv, origVec, variants);

    expect(result).toContain("original query"); // original always survives
    expect(result).toContain("high cosine paraphrase"); // 0.90 ≥ 0.85 → kept

    // Verify our test setup: cos should be ~0.90
    const actualCos = cosine(origVec, p1Vec);
    expect(actualCos).toBeCloseTo(0.9, 5);
  });

  it("Test 2 (drop below gate): drops paraphrase with cosine < 0.85 silently (no throw)", async () => {
    const origVec = vectorAtAngle(0);
    // p2 at angle that gives cosine 0.80 < 0.85
    const p2Angle = Math.acos(0.8);
    const p2Vec = vectorAtAngle(p2Angle);

    mockSafeRun.mockResolvedValueOnce({
      data: [p2Vec],
    });

    const variants = ["original query", "low cosine paraphrase"];

    // Must NOT throw — call directly and verify no error
    const result = await keepVariantsAboveGate(mockEnv, origVec, variants);

    expect(result).toBeDefined();
    expect(result).toContain("original query");
    expect(result).not.toContain("low cosine paraphrase"); // 0.80 < 0.85 → dropped
  });

  it("Test 3 (original always survives): original (variants[0]) never gate-checked or dropped", async () => {
    // No embedding calls should happen for variants[0]
    const origVec = vectorAtAngle(0);

    // variants array with only the original — no paraphrases to embed
    const variants = ["original query"];
    const result = await keepVariantsAboveGate(mockEnv, origVec, variants);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe("original query");
    // safeRun should NOT have been called (no paraphrases to check)
    expect(mockSafeRun).not.toHaveBeenCalled();
  });

  it("Test 4 (mixed): keeps high-cosine paraphrase, drops low-cosine paraphrase", async () => {
    const origVec = vectorAtAngle(0);
    const highVec = vectorAtAngle(Math.acos(0.9)); // cosine 0.90 → kept
    const lowVec = vectorAtAngle(Math.acos(0.8)); // cosine 0.80 → dropped

    // Two paraphrases → two embedding calls (in parallel via Promise.all)
    mockSafeRun
      .mockResolvedValueOnce({ data: [highVec] })
      .mockResolvedValueOnce({ data: [lowVec] });

    const variants = ["original query", "high cosine paraphrase", "low cosine paraphrase"];
    const result = await keepVariantsAboveGate(mockEnv, origVec, variants);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe("original query"); // original always first
    expect(result).toContain("high cosine paraphrase");
    expect(result).not.toContain("low cosine paraphrase");
  });
});
