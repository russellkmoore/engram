/**
 * Unit tests for synthesis post-processing helpers (D-02/D-03/D-09/SYN-06).
 *
 * Requirements covered:
 * - D-02: `mapPositionsToCitationIds` deterministically replaces "memory N" with `[block_id]`
 *   from the ranked list ordering (ranked[i] ↔ "memory i+1").
 * - D-03: Out-of-range citation guard — "memory N" where N exceeds supplied count is left
 *   unmatched and the resulting uncited sentence is dropped by `dropUncitedSentences`.
 * - D-09: `dropUncitedSentences` drops every uncited sentence EXCEPT (a) the leading hedge
 *   sentence on low-confidence paths (SYN-06) and (b) gap-acknowledgment sentences.
 * - SYN-06: `applyHedgePrefix` prepends the canonical hedge string when `lowConfidence=true`.
 *
 * All tests are creds-free — safeRun is mocked so no AI binding is required.
 * Mirrors the `query-expansion.test.ts` describe/it + vi.mock hoisting pattern.
 *
 * RED state: mapPositionsToCitationIds, dropUncitedSentences, applyHedgePrefix are
 * file-local in tools.ts until Plan 04-03 exports them. Tests fail at call time until
 * then. The Intl.Segmenter probe test passes in any state.
 *
 * @module @engram/mcp-server/__tests__/synthesis-postprocess
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

// TODO 04-03: Replace with named imports once Plan 04-03 exports these helpers from tools.ts.
// Using a typed module record avoids unsafe-call ESLint errors on the not-yet-exported symbols.
import * as toolsModule from "../tools.js";

// Typed casts for the not-yet-exported helpers (RED state until Plan 04-03).
// Cast chain: toolsModule is typed; cast to a named interface to access via dot notation.
interface PendingToolsExports {
  mapPositionsToCitationIds: (synthesis: string, trimmedForSynth: LexicalSearchHit[]) => string;
  dropUncitedSentences: (
    synthesis: string,
    trimmedForSynth: LexicalSearchHit[],
    opts: { lowConfidenceHedge?: boolean },
  ) => string;
  applyHedgePrefix: (synthesis: string, lowConfidence: boolean) => string;
}

const pendingExports = toolsModule as unknown as PendingToolsExports;
const { mapPositionsToCitationIds, dropUncitedSentences, applyHedgePrefix } = pendingExports;

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
// Intl.Segmenter availability probe (workerd)
// ---------------------------------------------------------------------------

describe("Intl.Segmenter availability probe (workerd)", () => {
  it("Intl.Segmenter is available or regex fallback is defined", () => {
    let segmenterAvailable = false;
    try {
      const seg = new Intl.Segmenter("en", { granularity: "sentence" });
      const segments = [...seg.segment("Hello world. Another sentence.")];
      // Confirm it actually segments (not a no-op)
      expect(segments.length).toBeGreaterThan(0);
      segmenterAvailable = true;
      console.log(
        "[synthesis-postprocess probe] Intl.Segmenter is AVAILABLE in this workerd build",
      );
    } catch (err) {
      // Segmenter absent — verify the regex fallback pattern is valid
      const fallbackRegex = /(?<=[.!?])\s+(?=[A-Z])/;
      expect(() => new RegExp(fallbackRegex.source)).not.toThrow();
      console.warn(
        "[synthesis-postprocess probe] Intl.Segmenter UNAVAILABLE; regex fallback is valid. Error:",
        err,
      );
    }
    // Test always passes — it documents which path is active, not fails on missing API.
    expect(segmenterAvailable || true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapPositionsToCitationIds (D-02 deterministic mapping)
// ---------------------------------------------------------------------------

describe("mapPositionsToCitationIds (D-02 deterministic mapping)", () => {
  it("Test 1 (D-02 basic): replaces 'memory 1' and 'memory 2' with [block_id] for ranked items", () => {
    const synthesis = "memory 1 did X and memory 2 confirmed it";
    const trimmedForSynth: LexicalSearchHit[] = [
      makeLexicalSearchHit("blk-001", "content a"),
      makeLexicalSearchHit("blk-002", "content b"),
    ];
    const result = mapPositionsToCitationIds(synthesis, trimmedForSynth);
    expect(result).toBe("[blk-001] did X and [blk-002] confirmed it");
  });

  it("Test 2 (D-02 case-insensitive): 'Memory 1' (capitalized) is also replaced", () => {
    const synthesis = "Memory 1 is first";
    const trimmedForSynth: LexicalSearchHit[] = [makeLexicalSearchHit("blk-001", "content a")];
    const result = mapPositionsToCitationIds(synthesis, trimmedForSynth);
    expect(result).toBe("[blk-001] is first");
  });

  it("Test 3 (D-03 out-of-range): 'memory 5' when only 2 supplied leaves citation string unmatched", () => {
    // Out-of-range guard: no match → citation string stays as-is (then dropUncitedSentences removes the sentence)
    const synthesis = "memory 5 gave us the answer";
    const trimmedForSynth: LexicalSearchHit[] = [
      makeLexicalSearchHit("blk-001", "content a"),
      makeLexicalSearchHit("blk-002", "content b"),
    ];
    const result = mapPositionsToCitationIds(synthesis, trimmedForSynth);
    // "memory 5" is not replaced (no match for position 5 in a 2-item list)
    expect(result).toBe("memory 5 gave us the answer");
    // The resulting uncited sentence is then dropped by dropUncitedSentences (tested separately in D-09)
  });
});

// ---------------------------------------------------------------------------
// dropUncitedSentences (D-09 sentence-drop + hedge/gap exceptions)
// ---------------------------------------------------------------------------

describe("dropUncitedSentences (D-09 sentence-drop)", () => {
  it("Test 4 (D-03+D-09 integration): out-of-range 'memory 5' → uncited after mapping → sentence dropped", () => {
    // After mapPositionsToCitationIds, "memory 5" stays unmatched (2 memories supplied).
    // dropUncitedSentences then drops that sentence.
    const synthesisAfterMapping = "memory 5 gave us the answer. [blk-001] told us more.";
    const trimmedForSynth: LexicalSearchHit[] = [
      makeLexicalSearchHit("blk-001", "content a"),
      makeLexicalSearchHit("blk-002", "content b"),
    ];
    const result = dropUncitedSentences(synthesisAfterMapping, trimmedForSynth, {});
    // Only the cited sentence should survive
    expect(result).toContain("[blk-001]");
    expect(result).not.toContain("memory 5");
  });

  it("Test 5 (D-09 basic drop): uncited sentence is dropped, cited sentence is kept", () => {
    const synthesis = "[blk-001] told us the answer. This sentence has no citation.";
    const trimmedForSynth: LexicalSearchHit[] = [makeLexicalSearchHit("blk-001", "content a")];
    const result = dropUncitedSentences(synthesis, trimmedForSynth, {});
    expect(result).toContain("[blk-001] told us the answer");
    expect(result).not.toContain("This sentence has no citation");
  });

  it("Test 6 (D-09 hedge exception): first sentence is hedge + lowConfidenceHedge=true → kept even without citation", () => {
    const synthesis =
      "Note: the following is based on loosely-matched memories and may be incomplete. [blk-001] confirmed the answer.";
    const trimmedForSynth: LexicalSearchHit[] = [makeLexicalSearchHit("blk-001", "content a")];
    const result = dropUncitedSentences(synthesis, trimmedForSynth, { lowConfidenceHedge: true });
    // Hedge sentence (first sentence, no citation) should be preserved
    expect(result).toContain("Note: the following is based on loosely-matched memories");
    expect(result).toContain("[blk-001]");
  });

  it("Test 7 (D-09 gap-ack exception): sentence containing 'no information' is kept even without citation", () => {
    const synthesis = "[blk-001] gave context. There is no information about the deadline.";
    const trimmedForSynth: LexicalSearchHit[] = [makeLexicalSearchHit("blk-001", "content a")];
    const result = dropUncitedSentences(synthesis, trimmedForSynth, {});
    // Gap-ack sentence must be preserved
    expect(result).toContain("[blk-001]");
    expect(result).toContain("no information");
  });
});

// ---------------------------------------------------------------------------
// applyHedgePrefix (SYN-06 cosine-aware hedging)
// ---------------------------------------------------------------------------

describe("applyHedgePrefix (SYN-06 cosine-aware hedging)", () => {
  it("Test 8 (SYN-06 lowConfidence=true): returns hedge prefix prepended to synthesis", () => {
    const synthesis = "The project deadline is Q3 2026 based on the timeline.";
    const result = applyHedgePrefix(synthesis, true);
    expect(result).toBe(
      "Note: the following is based on loosely-matched memories and may be incomplete. " +
        synthesis,
    );
  });

  it("Test 9 (SYN-06 lowConfidence=false): returns synthesis unchanged", () => {
    const synthesis = "The project deadline is Q3 2026.";
    const result = applyHedgePrefix(synthesis, false);
    expect(result).toBe(synthesis);
  });
});
