/**
 * CON-05 integration test — recall() envelope context.conflicts[] wiring.
 *
 * Verifies that after Plan 02-08 wires `listInboxConflictsForMemoryIds` into
 * the recall handler, the `EngramResponse.context.conflicts[]` field is correctly
 * populated from inbox rows linked to the recalled memories.
 *
 * Four test cases per the plan spec:
 * 1. severity="high" — memories created same day, diffDays=0 → "high"
 * 2. severity="low"  — memories created 200 days apart → diffDays > 180 → "low"
 * 3. No conflicts → context.conflicts is undefined (field OMITTED per T-02-08-05)
 * 4. Malformed JSON row is silently skipped; well-formed row still surfaces
 *
 * Cross-phase contract:
 * - PULL-ONLY / PASSIVE (CON-08): conflicts surface only because the caller invoked
 *   recall. No proactive push, notification, or webhook is introduced here.
 * - No `_unsafe_insertRawInbox` RPC method — the malformed-JSON test uses
 *   `vi.spyOn` at the RPC return-shape boundary (T-02-08-06 mitigation).
 * - No NODE_ENV gate anywhere in production code or this test file.
 *
 * @module @engram/mcp-server/__tests__/integration/recall-conflicts
 */
// packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts
// Source: 02-08-PLAN.md Task 2 spec + tools-integration.test.ts harness shape
//         + cross-workspace-pentest.test.ts DO RPC pattern.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "../../tools.js";
import { EMBEDDING_DIMS } from "../../ai-helper.js";
import type { WorkspaceDO, InboxConflictRow } from "@engram/workspace-do";
import type { InboxConflictProperties } from "@engram/types";

// ---------------------------------------------------------------------------
// AI + Vectorize binding stubs (required for remember() + recall() to work
// without a real Cloudflare account — same approach as tools-integration.test.ts).
// ---------------------------------------------------------------------------

/** Deterministic embedding sized to EMBEDDING_DIMS. */
const MOCK_VECTOR = new Array(EMBEDDING_DIMS).fill(0.1) as number[];

/** Per-namespace ID registry: tracks upserted IDs so recall can return them. */
const conflictTestVectorizeStore = new Map<string, Set<string>>();

function patchEnvBindings(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e = env as any;
  // AI mock: return deterministic embedding for embed calls; plain response for synthesis.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.AI = {
    run: vi.fn().mockResolvedValue({ data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] }),
  };
  // VECTORIZE mock: stateful namespace-aware tracking so upsert → query round-trips work.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  e.VECTORIZE = {
    upsert: vi
      .fn()
      .mockImplementation(
        (vectors: { id: string; namespace?: string }[]): Promise<{ mutationId: string }> => {
          for (const v of vectors) {
            const ns = v.namespace ?? "__default__";
            if (!conflictTestVectorizeStore.has(ns)) conflictTestVectorizeStore.set(ns, new Set());
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            conflictTestVectorizeStore.get(ns)!.add(v.id);
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
          const ids = [...(conflictTestVectorizeStore.get(ns) ?? [])];
          const topK = opts.topK ?? 25;
          const matches = ids.slice(0, topK).map((id) => ({ id, score: 0.9 }));
          return Promise.resolve({ matches, count: matches.length });
        },
      ),
  };
}

beforeAll(() => {
  patchEnvBindings();
});

afterEach(() => {
  conflictTestVectorizeStore.clear();
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
// Helpers — mirror tools-integration.test.ts patterns
// ---------------------------------------------------------------------------

/**
 * Capture the registered callback for a tool bound to a given workspace_id.
 * Re-uses the exact same captureCallback pattern as tools-integration.test.ts.
 */
function captureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-con-test",
): (args: unknown, extra: unknown) => Promise<unknown> {
  const defaultCtxStub = {
    waitUntil: (p: Promise<unknown>) => {
      void p;
    },
  };
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-test-conflicts", version: "0.0.1" });
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
function parseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

/**
 * Seed two memories into the workspace via the DO RPC, with controlled created_at timestamps.
 *
 * Returns the two block ids.
 */
async function seedTwoMemoriesWithTimestamps(
  workspace_id: string,
  createdAtA: number,
  createdAtB: number,
): Promise<{ idA: string; idB: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e1 = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const wsNs = e1.WORKSPACE as DurableObjectNamespace<WorkspaceDO>;
  const stub = wsNs.get(wsNs.idFromName(workspace_id));

  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();

  // Insert memory A
  await stub.insertBlock({
    workspace_id,
    block: {
      id: idA,
      type: "research_note",
      content: "Memory A for conflict test",
      summary: null,
      properties: null,
      embedding_id: null,
      scope: "personal",
      project_id: null,
      source: "mcp:claude",
      confidence: null,
      created_at: createdAtA,
      updated_at: createdAtA,
    },
  });

  // Insert memory B
  await stub.insertBlock({
    workspace_id,
    block: {
      id: idB,
      type: "research_note",
      content: "Memory B for conflict test",
      summary: null,
      properties: null,
      embedding_id: null,
      scope: "personal",
      project_id: null,
      source: "mcp:claude",
      confidence: null,
      created_at: createdAtB,
      updated_at: createdAtB,
    },
  });

  // Register both in the Vectorize mock so recall() can retrieve them.
  const ns = workspace_id;
  if (!conflictTestVectorizeStore.has(ns)) conflictTestVectorizeStore.set(ns, new Set());
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  conflictTestVectorizeStore.get(ns)!.add(idA);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  conflictTestVectorizeStore.get(ns)!.add(idB);

  return { idA, idB };
}

/**
 * Insert an inbox conflict row via the DO RPC writer (Plan 02-05 insertConflictAsInbox).
 */
async function insertConflictRow(
  workspace_id: string,
  props: InboxConflictProperties,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
  const e2 = env as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const wsNs2 = e2.WORKSPACE as DurableObjectNamespace<WorkspaceDO>;
  const stub = wsNs2.get(wsNs2.idFromName(workspace_id));
  await stub.insertConflictAsInbox({
    workspace_id,
    ...props,
  });
}

// ---------------------------------------------------------------------------
// Test 1: severity="high" — memories same-age, diffDays = 0
// ---------------------------------------------------------------------------

describe("CON-05: recall() context.conflicts[] wiring", () => {
  it("recall returns context.conflicts when inbox contains contradiction rows linking ranked memories (severity=high)", async () => {
    const workspace_id = "ws-con05-severity-high";
    const now = Date.now();

    // Seed two memories with the same created_at (diffDays = 0 → severity="high")
    const { idA, idB } = await seedTwoMemoriesWithTimestamps(workspace_id, now, now);

    // Insert one conflict row linking the two memory IDs
    const conflictProps: InboxConflictProperties = {
      memory_a_id: idA,
      memory_b_id: idB,
      category: "contradiction",
      ai_confidence: 0.92,
      description: "Memory A contradicts Memory B on the same topic",
    };
    await insertConflictRow(workspace_id, conflictProps);

    // Call recall
    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "conflict test", verbosity: "chunks" }, {});
    const envelope = parseEnvelope(result);

    const ctx = envelope.context as Record<string, unknown>;

    // context.conflicts must be present and have exactly 1 entry
    expect(ctx).toHaveProperty("conflicts");
    const conflicts = ctx.conflicts as Record<string, unknown>[];
    expect(conflicts).toHaveLength(1);

    const conflict = conflicts[0];
    if (conflict === undefined) throw new Error("expected conflict[0] to be defined");

    expect(conflict.memory_a_id).toBe(idA);
    expect(conflict.memory_b_id).toBe(idB);
    expect(conflict.description).toBe(conflictProps.description);
    expect(conflict.severity).toBe("high"); // same-day memories → diffDays=0 → "high"
    expect(typeof conflict.detected_at).toBe("number");
    expect(conflict.resolved_at).toBeNull(); // v0.2: always null
    expect(typeof conflict.id).toBe("string");
    // id must follow the "conflict-<UUID>" pattern
    expect((conflict.id as string).startsWith("conflict-")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: severity="low" — memories 200 days apart (> 180 days → "low")
  // ---------------------------------------------------------------------------

  it("severity=low when memory age diff > 180 days", async () => {
    const workspace_id = "ws-con05-severity-low";
    const now = Date.now();
    const TWO_HUNDRED_DAYS_MS = 200 * 24 * 60 * 60 * 1000;
    const oldTimestamp = now - TWO_HUNDRED_DAYS_MS;

    // Seed two memories 200 days apart
    const { idA, idB } = await seedTwoMemoriesWithTimestamps(workspace_id, now, oldTimestamp);

    const conflictProps: InboxConflictProperties = {
      memory_a_id: idA,
      memory_b_id: idB,
      category: "contradiction",
      ai_confidence: 0.78,
      description: "Old memory contradicts recent memory — stale contradiction",
    };
    await insertConflictRow(workspace_id, conflictProps);

    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "conflict test old", verbosity: "chunks" }, {});
    const envelope = parseEnvelope(result);
    const ctx = envelope.context as Record<string, unknown>;

    expect(ctx).toHaveProperty("conflicts");
    const conflicts = ctx.conflicts as Record<string, unknown>[];
    expect(conflicts.length).toBeGreaterThanOrEqual(1);

    // Find the conflict linking idA and idB
    const relevant = conflicts.find((c) => c.memory_a_id === idA || c.memory_b_id === idB);
    if (relevant === undefined) throw new Error("expected conflict linking idA/idB not found");
    expect(relevant.severity).toBe("low"); // 200d gap > 180d → "low"
  });

  // ---------------------------------------------------------------------------
  // Test 3: no conflicts → context.conflicts is ABSENT (field omitted per T-02-08-05)
  // ---------------------------------------------------------------------------

  it("envelope.context.conflicts is undefined when no inbox conflicts touch the ranked set", async () => {
    const workspace_id = "ws-con05-no-conflicts";
    const now = Date.now();

    // Seed memories but insert NO conflict rows
    await seedTwoMemoriesWithTimestamps(workspace_id, now, now);

    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "no conflict test", verbosity: "chunks" }, {});
    const envelope = parseEnvelope(result);
    const ctx = envelope.context as Record<string, unknown>;

    // context.conflicts must be ABSENT (undefined) when there are no inbox rows.
    // The field is conditionally-spread — empty array is NOT serialized (T-02-08-05).
    expect(Object.prototype.hasOwnProperty.call(ctx, "conflicts")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 4: malformed JSON row silently skipped; well-formed row still surfaces
  // ---------------------------------------------------------------------------

  it("malformed inbox row does not crash recall — well-formed row surfaces, malformed row is dropped", async () => {
    const workspace_id = "ws-con05-malformed-json";
    const now = Date.now();

    // Seed memories so Vectorize returns real IDs to the recall handler
    const { idA, idB } = await seedTwoMemoriesWithTimestamps(workspace_id, now, now);

    const wellFormedProps: InboxConflictProperties = {
      memory_a_id: idA,
      memory_b_id: idB,
      category: "contradiction",
      ai_confidence: 0.85,
      description: "Well-formed conflict row",
    };

    // Build a well-formed InboxConflictRow (mirrors the shape returned by the real DO helper)
    const wellFormedRow: InboxConflictRow = {
      id: `conflict-${crypto.randomUUID()}`,
      content: wellFormedProps.description,
      proposed_type: "conflict",
      proposed_properties: JSON.stringify(wellFormedProps),
      memorability_score: wellFormedProps.ai_confidence,
      source: "triage:conflict-pipeline",
      created_at: now,
    };

    // Build a malformed row whose proposed_properties is invalid JSON
    const malformedRow: InboxConflictRow = {
      id: `conflict-${crypto.randomUUID()}`,
      content: "malformed row",
      proposed_type: "conflict",
      proposed_properties: "{not-valid-json", // intentionally broken
      memorability_score: 0.5,
      source: "triage:conflict-pipeline",
      created_at: now,
    };

    // Intercept env.WORKSPACE.get() to return a proxy that overrides
    // listInboxConflictsForMemoryIds with the controlled mixed batch.
    // All other methods (getBlocksByIds, insertBlock, etc.) delegate to the real stub.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const e3 = env as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const wsNs3 = e3.WORKSPACE as DurableObjectNamespace<WorkspaceDO>;
    const realGetFn = wsNs3.get.bind(wsNs3);

    // Spy on wsNs3.get to wrap the returned stub with our mock
    vi.spyOn(wsNs3, "get").mockImplementationOnce(
      (id: DurableObjectId): DurableObjectStub<WorkspaceDO> => {
        const realStub = realGetFn(id);
        // Proxy: intercept listInboxConflictsForMemoryIds; delegate everything else
        return new Proxy(realStub, {
          get(target, prop) {
            if (prop === "listInboxConflictsForMemoryIds") {
              return () => Promise.resolve([wellFormedRow, malformedRow] as InboxConflictRow[]);
            }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
            return (target as any)[prop];
          },
        });
      },
    );

    // Spy on console.warn so we can assert the parse-failure log fires
    const warnSpy = vi.spyOn(console, "warn");

    const recallCb = captureCallback("recall", workspace_id);
    const result = await recallCb({ query: "malformed json conflict", verbosity: "chunks" }, {});
    const envelope = parseEnvelope(result);

    // Recall must succeed (no throw)
    expect(envelope).toHaveProperty("result");
    expect(envelope).toHaveProperty("context");

    const ctx = envelope.context as Record<string, unknown>;

    // The well-formed row must appear in context.conflicts
    expect(ctx).toHaveProperty("conflicts");
    const conflicts = ctx.conflicts as Record<string, unknown>[];
    expect(conflicts).toHaveLength(1); // malformed row dropped → only 1
    const surfaced = conflicts[0];
    if (surfaced === undefined) throw new Error("expected conflicts[0] to be defined");
    expect(surfaced.memory_a_id).toBe(idA);
    expect(surfaced.memory_b_id).toBe(idB);

    // console.warn must have been called with the CON-05 parse-failure tag
    const warnCalls = warnSpy.mock.calls;
    const parseFailCall = warnCalls.find(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("recall:CON-05:inbox-conflict-parse-failed"),
    );
    expect(parseFailCall).toBeDefined();
  });
});
