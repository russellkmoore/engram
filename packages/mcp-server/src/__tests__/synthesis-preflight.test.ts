/**
 * Unit tests for `trimRankedForSynthesis` SYN-05 preflight assertion.
 *
 * Requirements covered:
 * - SYN-05: Pre-flight asserts that serialized synthesis input ≤ 6K tokens.
 *   When ALL memories exceed the budget, `trimRankedForSynthesis` must THROW with
 *   a message matching /synthesis-preflight: all memories exceed 6K token budget/.
 *   When partial truncation occurs, it returns only the memories that fit.
 *
 * All tests are creds-free — safeRun is mocked so no AI binding is required.
 * Mirrors the `query-expansion.test.ts` describe/it + vi.mock hoisting pattern.
 *
 * RED state: `trimRankedForSynthesis` is file-local in tools.ts until Plan 04-03 exports it.
 * Tests fail at call time until then (correct TDD posture). The test file is
 * syntactically valid TypeScript and passes `tsc --noEmit`.
 *
 * @module @engram/mcp-server/__tests__/synthesis-preflight
 */

// ---------------------------------------------------------------------------
// vi.mock declarations MUST be hoisted BEFORE any imports.
// ---------------------------------------------------------------------------

vi.mock("../ai-helper.js", () => ({
  safeRun: vi.fn(),
  CLASSIFIER_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  INGESTION_CLASSIFIER_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  QUERY_EXPANSION_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  EMBEDDING_MODEL: "@cf/qwen/qwen3-embedding-0.6b",
  EMBEDDING_VERSION: 2,
  EMBEDDING_DIMS: 1024,
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

// analytics is fire-and-forget — stub it to avoid env binding errors.
vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("test-workspace-tag"),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LexicalSearchHit } from "@engram/workspace-do";

// TODO 04-03: Replace with named import once Plan 04-03 exports trimRankedForSynthesis from tools.ts.
// Using a typed module record avoids unsafe-call ESLint errors on the not-yet-exported symbol.
import * as toolsModule from "../tools.js";

// Typed cast for the not-yet-exported helper (RED state until Plan 04-03).
// Cast chain: toolsModule is typed; cast to a named interface to access via dot notation.
interface PendingToolsExports {
  trimRankedForSynthesis: (memories: LexicalSearchHit[], maxTokens: number) => LexicalSearchHit[];
}

const pendingExports = toolsModule as unknown as PendingToolsExports;
const { trimRankedForSynthesis } = pendingExports;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeLexicalSearchHit(id: string, content: string): LexicalSearchHit {
  return {
    id,
    type: null,
    content,
    summary: null,
    properties: null,
    embedding_id: null,
    scope: "personal",
    project_id: null,
    source: "mcp:claude",
    confidence: null,
    created_at: 0,
    updated_at: 0,
    snippet: null,
    match_column: null,
    score: 0.8,
  };
}

// ---------------------------------------------------------------------------
// trimRankedForSynthesis SYN-05 preflight
// ---------------------------------------------------------------------------

describe("trimRankedForSynthesis SYN-05 preflight (no creds required)", () => {
  it("Test 1 (SYN-05 throw): single memory with content.length = 6001*4+1 chars throws preflight error", () => {
    // ~4 chars per token: 6001 tokens × 4 chars = 24004 chars. Add 1 to exceed budget.
    const oversizedContent = "x".repeat(6001 * 4 + 1);
    const oversizedMemory = makeLexicalSearchHit("m-1", oversizedContent);
    expect(() => trimRankedForSynthesis([oversizedMemory], 6000)).toThrow(
      /synthesis-preflight: all memories exceed 6K token budget/,
    );
  });

  it("Test 2 (SYN-05 partial truncation): two memories where only the first fits budget → returns [first] only; no throw", () => {
    // First memory fits: 100 chars content + 0 summary = 100 chars (≪ 6000*4=24000 char budget)
    const smallMemory = makeLexicalSearchHit("m-1", "x".repeat(100));
    // Second memory overflows the remaining budget after first is added
    const largeMemory = makeLexicalSearchHit("m-2", "y".repeat(6001 * 4));
    const result = trimRankedForSynthesis([smallMemory, largeMemory], 6000);
    expect(result).toHaveLength(1);
    const firstResult = result[0];
    expect(firstResult?.id).toBe("m-1");
  });

  it("Test 3 (SYN-05 meta.gaps boundary): when truncation occurs, caller must surface a meta.gaps note (integration-level boundary)", () => {
    // This test documents the boundary between trimRankedForSynthesis (preflight)
    // and the recall() tools.ts integration behavior.
    // When trimRankedForSynthesis drops trailing memories, the CALLER (recall() in tools.ts)
    // must append a meta.gaps note: "synthesis context truncated: N of M memories exceeded 6K budget".
    // This integration behavior is tested in Plan 04-03 at the tools.ts integration level.
    // This test exists as a contract marker — it asserts the truncation itself (not the gap note).
    const smallMemory = makeLexicalSearchHit("m-1", "x".repeat(100));
    const largeMemory = makeLexicalSearchHit("m-2", "y".repeat(6001 * 4));
    const result = trimRankedForSynthesis([smallMemory, largeMemory], 6000);
    // Truncation happened: only 1 of 2 memories fits
    expect(result.length).toBeLessThan(2);
    // Gap-note wiring: the caller in tools.ts will check `result.length < ranked.length`
    // and append to meta.gaps. That is tested in 04-03, not here.
  });
});
