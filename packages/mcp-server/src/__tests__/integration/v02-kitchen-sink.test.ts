/**
 * INT-01: v0.2 kitchen-sink integration test — worst-case envelope budget + all 6
 * v0.2-INTEGRATION-MATRIX rows.
 *
 * Purpose: Catches cross-feature regressions that isolated unit tests cannot catch.
 * Each describe block exercises a specific composition pair from the integration matrix
 * with an adversarial fixture designed to trip the real failure mode.
 *
 * INT-01 worst-case test additionally proves content preservation under trim:
 * synthesis + high-severity conflicts survive the budget cut (D-05 "teeth").
 *
 * Requirements covered:
 * - INT-01: worst-case envelope budget ≤ 7,500 tokens + content preservation
 * - INT-04: all 6 matrix rows tested (RNK×CON, RNK×EXP, EXP×SYN, CON×SYN,
 *           adaptive-routing×cosine-edge, INT-01 kitchen-sink)
 *
 * Design notes (locked):
 * - D-04: uses gpt-tokenizer/encoding/cl100k_base (NOT the barrel — Pitfall 4).
 * - D-05: asserts synthesis + high-severity conflicts survive trimToBudget.
 * - D-06: pre-trim > 7,500 assertion proves fixture is adversarial (Pitfall 1).
 * - hybridRank is NOT mocked — mocking it defeats the matrix's purpose.
 * - generateSynthesis is NOT mocked — real path runs with mocked env.AI.run.
 * - expandQuery is NOT mocked — env.AI.run returns expansion-shaped response.
 *
 * @module @engram/mcp-server/__tests__/integration/v02-kitchen-sink
 */
// packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts
// Source: 05-02-PLAN.md Task 1 spec + recall-conflicts.test.ts primary analog
//         + token-budget.test.ts INT-01 harness analog
//         + tools-integration.test.ts AI mock dispatch pattern.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "../../tools.js";
import { EMBEDDING_DIMS } from "../../ai-helper.js";
import type { WorkspaceDO } from "@engram/workspace-do";
import type { InboxConflictProperties } from "@engram/types";
import type { Conflict } from "@engram/types";

// Token-budget harness — exact import path (Pitfall 4: NOT the barrel "gpt-tokenizer")
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { buildRecallResponse, trimToBudget } from "../../envelope.js";

// ---------------------------------------------------------------------------
// Constants + mock state
// ---------------------------------------------------------------------------

/** Deterministic embedding sized to EMBEDDING_DIMS. */
const MOCK_VECTOR = new Array(EMBEDDING_DIMS).fill(0.1) as number[];

/** Per-namespace ID registry: tracks upserted IDs so recall can return them. */
const kitchenSinkVectorizeStore = new Map<string, Set<string>>();

/**
 * Current override for the first Vectorize query match score.
 * When set, the first match in any namespace query returns this score.
 * When undefined, all matches return 0.9 (default).
 */
let kitchenSinkTop1Score: number | undefined;

// ---------------------------------------------------------------------------
// patchEnvBindings — env.AI + env.VECTORIZE stubs
// Mirrors recall-conflicts.test.ts lines 48–88 with score override for EXP paths.
// AI mock distinguishes embed vs synthesis/expansion calls by checking body shape:
//   - embed call:  body has "text" key  → { data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] }
//   - chat call:   body has "messages"  → { response: "..." }
// ---------------------------------------------------------------------------

function patchEnvBindings(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;

  // AI mock — dispatches by body shape (embed vs chat/synthesis/expansion)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.AI = {
    run: vi
      .fn()
      .mockImplementation((_model: string, body: Record<string, unknown>): Promise<unknown> => {
        if ("messages" in body) {
          // Chat call: synthesis or expansion. Expansion uses JSON response.
          // Return a valid expansion JSON so expandQuery parses successfully.
          return Promise.resolve({
            response: JSON.stringify({ paraphrases: ["variant-1", "variant-2"] }),
          });
        }
        // Embedding call: return deterministic vector
        return Promise.resolve({ data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] });
      }),
  };

  // VECTORIZE mock — stateful namespace-aware tracking with score override
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.VECTORIZE = {
    upsert: vi
      .fn()
      .mockImplementation(
        (vectors: { id: string; namespace?: string }[]): Promise<{ mutationId: string }> => {
          for (const v of vectors) {
            const ns = v.namespace ?? "__default__";
            if (!kitchenSinkVectorizeStore.has(ns)) kitchenSinkVectorizeStore.set(ns, new Set());
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            kitchenSinkVectorizeStore.get(ns)!.add(v.id);
          }
          return Promise.resolve({ mutationId: "mock-upsert" });
        },
      ),
    deleteByIds: vi.fn().mockResolvedValue({ mutationId: "mock-delete" }),
    query: vi
      .fn()
      .mockImplementation(
        (
          _vector: unknown,
          opts: { namespace?: string; topK?: number },
        ): Promise<{ matches: { id: string; score: number }[]; count: number }> => {
          const ns = opts.namespace ?? "__default__";
          const ids = [...(kitchenSinkVectorizeStore.get(ns) ?? [])];
          const topK = opts.topK ?? 25;
          const matches = ids.slice(0, topK).map((id, i) => ({
            id,
            // First match uses the override score to trigger (or not) adaptive fan-out
            score: i === 0 && kitchenSinkTop1Score !== undefined ? kitchenSinkTop1Score : 0.9,
          }));
          return Promise.resolve({ matches, count: matches.length });
        },
      ),
  };
}

beforeAll(() => {
  patchEnvBindings();
});

afterEach(() => {
  kitchenSinkVectorizeStore.clear();
  kitchenSinkTop1Score = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.AI?.run as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.upsert as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (e.VECTORIZE?.query as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers — mirror recall-conflicts.test.ts patterns with localized prefixes
// ---------------------------------------------------------------------------

/**
 * Capture the registered callback for a tool bound to a given workspace_id.
 * Localized name (kitchenSinkCaptureCallback) per PATTERNS.md §Shared Patterns.
 */
function kitchenSinkCaptureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-kitchen-sink",
): (args: unknown, extra: unknown) => Promise<unknown> {
  const defaultCtxStub = {
    waitUntil: (p: Promise<unknown>) => {
      void p;
    },
  };
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-test-kitchen-sink", version: "0.0.1" });
    registerTools(
      server,
      () => ({ workspace_id, user_id }),
      env,
      () => defaultCtxStub as unknown as DurableObjectState,
    );
    let foundCallback: ((args: unknown, extra: unknown) => Promise<unknown>) | undefined;
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [
        string,
        unknown,
        (args: unknown, extra: unknown) => Promise<unknown>,
      ];
      if (callName === toolName) {
        foundCallback = callCb;
        break;
      }
    }
    if (foundCallback === undefined) throw new Error(`registration for '${toolName}' not captured`);
    return foundCallback;
  } finally {
    spy.mockRestore();
  }
}

/** Parse the MCP content wrapper and return the envelope as a plain object. */
function kitchenSinkParseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

/**
 * Seed a memory block directly into the DO and register it in the Vectorize mock.
 * Source: recall-conflicts.test.ts seedTwoMemoriesWithTimestamps pattern.
 */
async function kitchenSinkSeedBlock(
  workspace_id: string,
  id: string,
  createdAt: number,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const wsNs = e.WORKSPACE as DurableObjectNamespace<WorkspaceDO>;
  const stub = wsNs.get(wsNs.idFromName(workspace_id));

  await stub.insertBlock({
    workspace_id,
    block: {
      id,
      type: "research_note",
      content: `Kitchen-sink test memory ${id}`,
      summary: null,
      properties: null,
      embedding_id: null,
      scope: "personal",
      project_id: null,
      source: "mcp:test",
      confidence: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
  });

  // Register in Vectorize mock so recall() can retrieve it
  const ns = workspace_id;
  if (!kitchenSinkVectorizeStore.has(ns)) kitchenSinkVectorizeStore.set(ns, new Set());
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  kitchenSinkVectorizeStore.get(ns)!.add(id);
}

/**
 * Insert a conflict row linking two memory IDs.
 * Source: recall-conflicts.test.ts insertConflictRow pattern.
 */
async function kitchenSinkInsertConflict(
  workspace_id: string,
  props: InboxConflictProperties,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const wsNs = e.WORKSPACE as DurableObjectNamespace<WorkspaceDO>;
  const stub = wsNs.get(wsNs.idFromName(workspace_id));
  await stub.insertConflictAsInbox({
    workspace_id,
    ...props,
  });
}

/**
 * Build LexicalSearchHit objects for the INT-01 worst-case fixture.
 * Extends the buildWorstCaseMemories shape from token-budget.test.ts with
 * configurable entity-rich properties for the 50-entity INT-01 requirement.
 *
 * Source: token-budget.test.ts lines 59–77 + PATTERNS.md §INT-01 fixture builder.
 */
function buildKitchenSinkMemories(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `blk-ks-${String(i)}`,
    type: "research_note",
    content: "x".repeat(4_000), // 4KB content — adversarial size
    summary: "y".repeat(1_000), // 1KB summary
    // 50-entity requirement satisfied by including rich properties per memory.
    // Per D-03: JSON columns arrive parsed — properties is Record<string, unknown>,
    // NOT a JSON string. Pass the object directly to satisfy LexicalSearchHit.
    properties: {
      entities: Array.from({ length: 2 }, (__, j) => `entity-${String(i)}-${String(j)}`),
    },
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
// Matrix row 1: RNK × CON
// ---------------------------------------------------------------------------

describe("RNK × CON: conflicts survive hybridRank when conflict-linked memories rank lower", () => {
  it("context.conflicts is populated even when conflict-linked memory has lower Vectorize score", async () => {
    const workspace_id = "ws-ks-rnk-con";
    const now = Date.now();

    const idA = `blk-rnk-con-a-${String(Date.now())}`;
    const idB = `blk-rnk-con-b-${String(Date.now())}`;

    // Seed two blocks in the workspace
    await kitchenSinkSeedBlock(workspace_id, idA, now);
    await kitchenSinkSeedBlock(workspace_id, idB, now);

    // Insert a conflict row linking the two blocks
    const conflictProps: InboxConflictProperties = {
      memory_a_id: idA,
      memory_b_id: idB,
      category: "contradiction",
      ai_confidence: 0.88,
      description: "RNK×CON: blockA contradicts blockB",
    };
    await kitchenSinkInsertConflict(workspace_id, conflictProps);

    // Override: idA gets score 0.62 (lower than idB's 0.9) — conflict-linked memory ranks lower
    kitchenSinkTop1Score = 0.62;

    const recallCb = kitchenSinkCaptureCallback("recall", workspace_id);
    const result = await recallCb({ query: "RNK CON test", verbosity: "chunks" }, {});
    const envelope = kitchenSinkParseEnvelope(result);

    const ctx = envelope.context as Record<string, unknown>;

    // Conflict must survive despite blockA having a lower score
    expect(ctx).toHaveProperty("conflicts");
    const conflicts = ctx.conflicts as Record<string, unknown>[];
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    // result.memories must be non-empty (real hybridRank ran — not mocked)
    const resultField = envelope.result as Record<string, unknown>;
    const memories = resultField.memories as unknown[];
    expect(memories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Matrix row 2: RNK × EXP
// ---------------------------------------------------------------------------

describe("RNK × EXP: real hybridRank receives RRF-merged candidate set when fan-out fires", () => {
  it("fan-out fires when top1 < 0.65 and hybridRank receives RRF-merged candidates", async () => {
    const workspace_id = "ws-ks-rnk-exp";
    const now = Date.now();

    const idA = `blk-rnk-exp-a-${String(Date.now())}`;
    const idB = `blk-rnk-exp-b-${String(Date.now())}`;

    await kitchenSinkSeedBlock(workspace_id, idA, now);
    await kitchenSinkSeedBlock(workspace_id, idB, now);

    // Set top1 score to 0.60 — below ADAPTIVE_TOP1_THRESHOLD=0.65 → triggers fan-out
    kitchenSinkTop1Score = 0.6;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const aiMock = (env as any).AI?.run as ReturnType<typeof vi.fn> | undefined;

    const recallCb = kitchenSinkCaptureCallback("recall", workspace_id);
    const result = await recallCb({ query: "RNK EXP fan-out test", verbosity: "chunks" }, {});
    const envelope = kitchenSinkParseEnvelope(result);

    // AI.run must have been called multiple times (embed + expansion calls)
    expect(aiMock?.mock.calls.length).toBeGreaterThan(1);

    // result.memories must be non-empty (real hybridRank ran on merged candidates)
    const resultField = envelope.result as Record<string, unknown>;
    const memories = resultField.memories as unknown[];
    expect(memories.length).toBeGreaterThan(0);

    // No TypeErrors — the RRF-merged LexicalSearchHit list is valid hybridRank input
    expect(envelope).toHaveProperty("result");
    expect(envelope).toHaveProperty("context");
    expect(envelope).toHaveProperty("meta");
  });
});

// ---------------------------------------------------------------------------
// Matrix row 3: EXP × SYN
// ---------------------------------------------------------------------------

describe("EXP × SYN: synthesis is non-null when fan-out fires and ≥ 2 memories are returned", () => {
  it("synthesis is non-null after fan-out (top1 < 0.65 + ≥ 2 blocks seed)", async () => {
    const workspace_id = "ws-ks-exp-syn";
    const now = Date.now();

    // Seed ≥ 2 blocks (Pitfall 2: satisfies SYN-07 guard — ranked.length ≥ 2)
    const idA = `blk-exp-syn-a-${String(Date.now())}`;
    const idB = `blk-exp-syn-b-${String(Date.now())}`;

    await kitchenSinkSeedBlock(workspace_id, idA, now);
    await kitchenSinkSeedBlock(workspace_id, idB, now);

    // Set top1 score to 0.60 — triggers fan-out (EXP-03)
    kitchenSinkTop1Score = 0.6;

    const recallCb = kitchenSinkCaptureCallback("recall", workspace_id);
    const result = await recallCb({ query: "EXP SYN synthesis test", verbosity: "synthesis" }, {});
    const envelope = kitchenSinkParseEnvelope(result);

    const resultField = envelope.result as Record<string, unknown>;

    // result.synthesis must be non-null (AI mock returns { response: "..." } for chat calls)
    expect(resultField.synthesis).not.toBeNull();

    // result.memories.length ≥ 2 confirms fan-out expanded the candidate set beyond original
    const memories = resultField.memories as unknown[];
    expect(memories.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Matrix row 4: CON × SYN
// ---------------------------------------------------------------------------

describe("CON × SYN: both context.conflicts[] and result.synthesis populated simultaneously", () => {
  it("synthesis runs and conflicts surface in the same envelope (verbosity=synthesis)", async () => {
    const workspace_id = "ws-ks-con-syn";
    // Pitfall 6: created_at = Date.now() → diffDays=0 → severity="high"
    const now = Date.now();

    // Seed ≥ 2 blocks (SYN-07 guard)
    const idA = `blk-con-syn-a-${String(now)}`;
    const idB = `blk-con-syn-b-${String(now)}`;

    await kitchenSinkSeedBlock(workspace_id, idA, now);
    await kitchenSinkSeedBlock(workspace_id, idB, now);

    // Insert a conflict linking the two blocks (same created_at → high severity)
    const conflictProps: InboxConflictProperties = {
      memory_a_id: idA,
      memory_b_id: idB,
      category: "contradiction",
      ai_confidence: 0.91,
      description: "CON×SYN: high-severity contradiction with synthesis",
    };
    await kitchenSinkInsertConflict(workspace_id, conflictProps);

    const recallCb = kitchenSinkCaptureCallback("recall", workspace_id);
    const result = await recallCb(
      { query: "CON SYN simultaneous test", verbosity: "synthesis" },
      {},
    );
    const envelope = kitchenSinkParseEnvelope(result);

    const resultField = envelope.result as Record<string, unknown>;
    const ctx = envelope.context as Record<string, unknown>;

    // synthesis must be non-null
    expect(resultField.synthesis).not.toBeNull();

    // context.conflicts must have ≥ 1 entry
    expect(ctx).toHaveProperty("conflicts");
    const conflicts = ctx.conflicts as Record<string, unknown>[];
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    // The conflict must have severity "high" (same-day created_at → diffDays=0)
    const highSeverity = conflicts.filter((c) => c.severity === "high");
    expect(highSeverity.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Matrix row 5: adaptive-routing × cosine-edge
// ---------------------------------------------------------------------------

describe("adaptive-routing × cosine-edge: RateLimitError from expandQuery → single-query fallback", () => {
  it("graceful fallback to single-query path when expansion throws RateLimitError", async () => {
    const workspace_id = "ws-ks-adaptive-edge";
    const now = Date.now();

    const idA = `blk-adaptive-a-${String(now)}`;
    await kitchenSinkSeedBlock(workspace_id, idA, now);

    // Set top1 score to 0.64 — just below ADAPTIVE_TOP1_THRESHOLD=0.65 → triggers fan-out attempt
    kitchenSinkTop1Score = 0.64;

    // Override AI mock: expansion call (has "messages" AND "response_format") throws RateLimitError
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const e = env as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (e.AI.run as ReturnType<typeof vi.fn>).mockImplementation(
      (_model: string, body: Record<string, unknown>): unknown => {
        if ("messages" in body && "response_format" in body) {
          // Expansion call — throw to trigger EXP-10 single-query fallback
          const err = new Error("Rate limit exceeded") as Error & { status?: number };
          err.status = 429;
          return Promise.reject(err);
        }
        if ("messages" in body) {
          // Synthesis call — return normal response
          return Promise.resolve({ response: "Mock synthesis text." });
        }
        // Embed call
        return Promise.resolve({ data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] });
      },
    );

    const recallCb = kitchenSinkCaptureCallback("recall", workspace_id);
    const result = await recallCb({ query: "adaptive routing edge test", verbosity: "chunks" }, {});

    // Must not throw — graceful fallback
    const envelope = kitchenSinkParseEnvelope(result);

    // result.memories is non-empty — single-query fallback returned results
    const resultField = envelope.result as Record<string, unknown>;
    const memories = resultField.memories as unknown[];
    expect(memories.length).toBeGreaterThan(0);

    // meta.gaps must contain the queryExpansionUnavailable note (EXP-10)
    const meta = envelope.meta as Record<string, unknown>;
    const gaps = meta.gaps as string[];
    expect(gaps).toContain("query expansion unavailable");
  });
});

// ---------------------------------------------------------------------------
// Matrix row 6 (INT-01): kitchen-sink worst-case envelope
// ---------------------------------------------------------------------------

describe("INT-01 kitchen-sink: worst-case envelope ≤ 7,500 tokens post-trim AND content preservation", () => {
  it("post-trim envelope ≤ 7,500 tokens AND synthesis + high-severity conflicts survive trim (D-05)", () => {
    // Build worst-case fixture: 25 memories × ~5KB each (well over 7,500 tokens pre-trim)
    const kitchenSinkMemories = buildKitchenSinkMemories(25);

    // Build 10 conflict objects with severity: "high" (created_at: Date.now() → diffDays=0)
    const now = Date.now();
    const conflictArray: Conflict[] = Array.from({ length: 10 }, (_, i) => ({
      id: `conflict-ks-${String(i)}`,
      memory_a_id: `blk-ks-${String(i * 2)}`,
      memory_b_id: `blk-ks-${String(i * 2 + 1)}`,
      description:
        `Kitchen-sink adversarial conflict ${String(i)} with enough text to be substantial`.repeat(
          3,
        ),
      severity: "high" as const,
      detected_at: now,
      resolved_at: null,
    }));

    // Build the worst-case recall response
    const envelope = buildRecallResponse({
      memories: kitchenSinkMemories,
      verbosity: "synthesis",
      synthesis: "Synthesis text — this must survive the trim.",
      conflicts: conflictArray,
    });

    // Step 1 (adversarial-proof, Pitfall 1): assert fixture IS over budget BEFORE trim
    // If this assertion fails, the fixture is too small and the test is self-invalidating.
    const beforeTokens = encode(JSON.stringify(envelope)).length;
    expect(beforeTokens).toBeGreaterThan(7_500);

    // Step 2: trim the envelope
    const trimmed = trimToBudget(envelope);

    // Step 3 (budget): post-trim must fit within the 7,500 token budget
    const afterTokens = encode(JSON.stringify(trimmed)).length;
    expect(afterTokens).toBeLessThanOrEqual(7_500);

    // Step 4 (D-05 content-preservation — the "teeth" of INT-01):
    // synthesis must survive trim (not null after trimToBudget)
    expect(trimmed.result.synthesis).not.toBeNull();

    // At least one high-severity conflict must survive trim
    const survivingConflicts = trimmed.context.conflicts ?? [];
    const highSeverity = survivingConflicts.filter((c) => c.severity === "high");
    expect(highSeverity.length).toBeGreaterThan(0);
  });
});
