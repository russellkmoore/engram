/**
 * RED → GREEN (Plan 04-02) — MCP-08 token budget enforcement tests.
 *
 * Wave 0 tests that will go GREEN when Plan 04-02 ships `envelope.ts` with
 * `trimToBudget` + the builders. Until then each import of `../envelope.js`
 * fails with "Cannot find module" — the expected RED failure mode.
 *
 * Cross-phase contract:
 * - **Phase 4 MCP-08:** Post-trim envelope MUST be ≤ 7,500 cl100k_base tokens.
 * - **Phase 4 MCP-08:** Every registered tool description MUST be ≤ 1,500 bytes (UTF-8).
 * - **Phase 4 D-10 invariant:** `trimToBudget` NEVER drops `meta` or
 *   `context.conflicts`; it NEVER returns an envelope over budget.
 *
 * Design notes (locked):
 * - Uses `gpt-tokenizer/encoding/cl100k_base` (Pitfall 6 — specific encoding path,
 *   NOT the barrel default `o200k_base`). Verified importable from workerd via the
 *   `@cloudflare/vitest-pool-workers` pool.
 * - Description-size assertion uses `new TextEncoder().encode(desc).byteLength`
 *   (workerd-native; do NOT use `Buffer.byteLength` — not available in workerd).
 * - Worst-case fixture: 25 `LexicalSearchHit` rows with 4KB content + 1KB summary,
 *   matching D-10's specification for the token-budget derivation.
 * - `trimToBudget` returns the SAME reference when under budget (no copy overhead).
 *
 * Threat model:
 * - **T-04-RED-MIRROR (Information Disclosure):** RED failure is
 *   "Cannot find module '../envelope.js'" — no DB internals or env values surfaced.
 *
 * @module @engram/mcp-server/__tests__/token-budget
 */
// packages/mcp-server/src/__tests__/token-budget.test.ts
// Source: 04-RESEARCH.md §Pattern 3 (worst-case fixture + encode shape)
//         + PATTERNS.md §"token-budget.test.ts" lines 574-634.
//

// Rationale: envelope.ts does not exist yet (Plan 04-02 deliverable). TypeScript
// resolves all imports from ../envelope.js as `error`-typed, triggering no-unsafe-*
// rules. These tests are intentionally RED until Plan 04-02 ships. The disable
// comments are scoped to this file only and will be removed when envelope.ts exists.
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";

// Import the specific cl100k_base encoding (Pitfall 6 — NOT the barrel default).
// This is the import gpt-tokenizer/encoding/cl100k_base; NOT import from "gpt-tokenizer".
import { encode } from "gpt-tokenizer/encoding/cl100k_base";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// These imports are RED until Plan 04-02 ships envelope.ts.
// Expected RED failure: "Cannot find module '../envelope.js'"
import { buildRecallResponse, buildRememberResponse, trimToBudget } from "../envelope.js";

import { registerTools } from "../tools.js";

// ---------------------------------------------------------------------------
// Worst-case fixture builder (D-10 specification)
// ---------------------------------------------------------------------------

/** Build 25 LexicalSearchHit objects with 4KB content + 1KB summary each. */
function buildWorstCaseMemories() {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `blk-${String(i)}`,
    type: "research_note",
    content: "x".repeat(4_000), // 4KB content
    summary: "y".repeat(1_000), // 1KB summary
    properties: null,
    embedding_id: null,
    scope: "personal" as const,
    project_id: null,
    source: "mcp:test",
    confidence: 0.9,
    created_at: Date.now(),
    updated_at: Date.now(),
    snippet: null,
    match_column: null as "content" | "summary" | null,
    score: null,
  }));
}

// ---------------------------------------------------------------------------
// Helper: captureToolRegistrations (mirrors captureRegistrations in tools.test.ts:67-84)
// Named captureToolRegistrations to avoid grep-collision with the tools.test.ts helper
// if both files are ever co-loaded by a test-helper extract in the future.
// ---------------------------------------------------------------------------

function captureToolRegistrations(): { name: string; description: string }[] {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTools(
      server,
      () => undefined,
      env,
      () =>
        ({
          waitUntil: (p: Promise<unknown>) => {
            void p;
          },
        }) as unknown as DurableObjectState,
    );
    return spy.mock.calls.map((call) => {
      const [name, config] = call as unknown as [string, { description?: string }];
      return { name, description: config.description ?? "" };
    });
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// MCP-08: token budget post-trim assertions
// ---------------------------------------------------------------------------

describe("MCP-08: token-budget post-trim ≤ 7,500 cl100k_base tokens", () => {
  it("worst-case recall envelope (25 memories × 4KB content + 1KB summary) trims to ≤ 7,500 tokens", () => {
    const worstCaseMemories = buildWorstCaseMemories();
    const envelope = buildRecallResponse({ memories: worstCaseMemories, verbosity: "synthesis" });
    const trimmed = trimToBudget(envelope);

    const tokenCount = encode(JSON.stringify(trimmed)).length;
    expect(tokenCount).toBeLessThanOrEqual(7_500);

    // D-10 invariant: meta MUST be preserved after trim
    expect(trimmed).toHaveProperty("meta");
    expect(trimmed.meta.gaps).toBeDefined();
    expect(Array.isArray(trimmed.meta.gaps)).toBe(true);
    // Phase 5 Plan 05-05: META_GAPS.recall[] is now empty (Phase 4 placeholder removed;
    // AI synthesis ships in Phase 5). For verbosity="synthesis", meta.gaps is [] (no gaps).
    // For verbosity="chunks" (default), meta.gaps contains recallChunksOmittedSynthesis.
    // D-10 invariant: meta.gaps is NEVER dropped — it may be an empty array, which is valid.
    // The length>0 assertion is removed here because synthesis verbosity legitimately has 0 gaps.
  });

  it("worst-case remember envelope trims correctly (meta.confidence/coverage preserved)", () => {
    // remember() envelope is typically small but verify trimToBudget handles it
    const envelope = buildRememberResponse({ id: "abc-123", classified_type: null });
    const trimmed = trimToBudget(envelope);

    // Under budget: trimToBudget should return the same reference
    const tokenCount = encode(JSON.stringify(trimmed)).length;
    expect(tokenCount).toBeLessThanOrEqual(7_500);

    // result.id MUST be preserved (D-10: never drop result.id on remember)
    expect(trimmed.result.id).toBe("abc-123");
  });

  it("trim returns same reference when envelope is already under budget (no unnecessary copy)", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "synthesis" });
    const trimmed = trimToBudget(envelope);
    // Small envelope should be returned as-is (same reference)
    expect(trimmed).toBe(envelope);
  });

  it("over-budget trim preserves meta and context.conflicts intact (D-10 never-drop invariant)", () => {
    const worstCaseMemories = buildWorstCaseMemories();
    const envelope = buildRecallResponse({ memories: worstCaseMemories, verbosity: "synthesis" });

    // Verify it IS over budget before trim
    const beforeTokens = encode(JSON.stringify(envelope)).length;
    expect(beforeTokens).toBeGreaterThan(7_500);

    const trimmed = trimToBudget(envelope);

    // After trim: meta must still be present
    expect(trimmed).toHaveProperty("meta");
    expect(trimmed.meta).toHaveProperty("gaps");
    expect(trimmed.meta).toHaveProperty("last_updated");
    // context.conflicts must still be present (may be empty array — that's fine)
    expect(trimmed.context).toHaveProperty("conflicts");
  });
});

// ---------------------------------------------------------------------------
// MCP-08: tool description size assertion
// ---------------------------------------------------------------------------

describe("MCP-08: every registered tool description is ≤ 1,500 bytes (UTF-8)", () => {
  it("each tool description is ≤ 1,500 UTF-8 bytes (TextEncoder.encode — workerd-native)", () => {
    const registrations = captureToolRegistrations();

    // Sanity check: all 5 tools are registered (proves the spy captured the full set)
    expect(registrations).toHaveLength(5);

    for (const { name, description } of registrations) {
      // Sanity check: non-empty description (proves test is not passing vacuously)
      expect(description.length, `${name} description is empty`).toBeGreaterThan(0);

      // TextEncoder is workerd-native (use instead of any node:buffer API).
      const byteLength = new TextEncoder().encode(description).byteLength;
      expect(byteLength, `${name} description byte length`).toBeLessThanOrEqual(1_500);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP-08: negative-fixture sanity (adversarial-proof)
// ---------------------------------------------------------------------------

describe("MCP-08: worst-case envelope WITHOUT trimToBudget exceeds 8,000 tokens — adversarial proof", () => {
  it("MCP-08: worst-case recall envelope WITHOUT trimToBudget exceeds 8,000 tokens — proves the fixture is adversarial", () => {
    // Build the SAME worst-case fixture as the "worst-case" test above
    // (25 memories × 4KB content + 1KB summary + populated metadata).
    // Assert the un-trimmed envelope EXCEEDS the MCP-08 8K-token ceiling.
    //
    // Purpose: this is the adversarial-proof test. If the fixture
    // does NOT exceed 8K tokens raw, then the "trims to ≤ 7,500"
    // assertion in the worst-case test passes trivially (trim never
    // had to do anything), and the entire MCP-08 guarantee is unverified.
    // This test locks the fixture's adversarial-ness as a regression check.
    const worstCaseMemories = Array.from({ length: 25 }, (_, i) => ({
      id: `blk-${String(i)}`,
      type: "research_note",
      content: "x".repeat(4_000), // 4KB content
      summary: "y".repeat(1_000), // 1KB summary
      properties: null,
      embedding_id: null,
      scope: "personal" as const,
      project_id: null,
      source: "mcp:test",
      confidence: 0.9,
      created_at: 1_700_000_000_000 + i,
      updated_at: 1_700_000_000_000 + i,
      snippet: null,
      match_column: null as "content" | "summary" | null,
      score: null,
    }));

    const envelope = buildRecallResponse({ memories: worstCaseMemories, verbosity: "synthesis" });
    const rawTokens = encode(JSON.stringify(envelope)).length;

    // If this assertion ever fails (rawTokens drops below 8K), the worst-case test
    // above is no longer load-bearing — investigate whether `buildRecallResponse`
    // output shape changed or whether the fixture sizes need scaling up.
    expect(rawTokens).toBeGreaterThan(8_000);
  });
});
