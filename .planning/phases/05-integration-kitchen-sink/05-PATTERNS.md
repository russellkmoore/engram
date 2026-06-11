# Phase 5: Integration Kitchen Sink — Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 5 (2 new, 3 modified)
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` | integration test | request-response (end-to-end recall pipeline) | `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` + `packages/mcp-server/src/__tests__/token-budget.test.ts` | exact (composite) |
| `packages/triage-worker/src/__tests__/conflict-pipeline-isolation.test.ts` | security/unit test | CRUD (workspace routing assertion) | `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` | exact |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (extend) | security/integration test | request-response | itself (extend in place) | self |
| `packages/mcp-server/src/__tests__/envelope.test.ts` (extend) | unit test | request-response | itself (extend in place) | self |
| `.planning/research/v0.2-INTEGRATION-MATRIX.md` (update) | doc/gate | — | itself (status cell updates only) | self |

---

## Pattern Assignments

### `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts`
**Role:** integration test | **Data Flow:** request-response (full recall pipeline)
**Primary Analog:** `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts`
**Secondary Analog:** `packages/mcp-server/src/__tests__/token-budget.test.ts`

---

#### Imports pattern
Mirror `recall-conflicts.test.ts` lines 27–35 plus the cl100k encoder from `token-budget.test.ts` line 44:

```typescript
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import { EMBEDDING_DIMS } from "../../ai-helper.js";
import type { WorkspaceDO, InboxConflictRow } from "@engram/workspace-do";
import type { InboxConflictProperties } from "@engram/types";
// Token-budget harness (Pitfall 4 — NOT the barrel "gpt-tokenizer")
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { buildRecallResponse, trimToBudget } from "../envelope.js";
```

---

#### Stateful Vectorize mock pattern
Copy from `recall-conflicts.test.ts` lines 46–105. The kitchen-sink file needs the same stateful namespace-aware mock but with score override capability for EXP paths (top1 < 0.65 to trigger adaptive fan-out per RESEARCH Pitfall 3):

```typescript
const kitchenSinkVectorizeStore = new Map<string, Set<string>>();

// AI mock: must return { data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] } for embed calls
// AND { response: "Mock synthesis." } for synthesis model calls.
// Distinguish by checking if output key is "data" vs "response" — mirror tools-integration.test.ts line 102.
function patchEnvBindings(opts: { top1Score?: number } = {}): void {
  const e = env as any;
  e.AI = {
    run: vi.fn().mockResolvedValue({ data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] }),
  };
  // Override AI mock for synthesis calls — mock returns { response: "Mock synthesis." }
  // when the model is the synthesis model (checked by callers via the "response" key)
  e.VECTORIZE = {
    upsert: vi.fn().mockImplementation(...), // same as recall-conflicts.test.ts lines 59–70
    deleteByIds: vi.fn().mockResolvedValue({ mutationId: "mock-delete" }),
    query: vi.fn().mockImplementation(
      (_vec, opts) => {
        const ns = opts.namespace ?? "__default__";
        const ids = [...(kitchenSinkVectorizeStore.get(ns) ?? [])];
        const topK = opts.topK ?? 25;
        // For EXP path: override first match score to trigger adaptive gate
        const matches = ids.slice(0, topK).map((id, i) => ({
          id,
          score: i === 0 && kitchenSinkTop1Score !== undefined ? kitchenSinkTop1Score : 0.9,
        }));
        return Promise.resolve({ matches, count: matches.length });
      },
    ),
  };
}
```

---

#### `captureCallback` helper
**Source:** `recall-conflicts.test.ts` lines 115–151 (identical shape used in `cross-workspace-pentest.test.ts` lines 125–161). Copy verbatim — do NOT reinvent:

```typescript
function captureCallback(
  toolName: string,
  workspace_id: string,
  user_id = "u-kitchen-sink",
): (args: unknown, extra: unknown) => Promise<unknown> {
  const defaultCtxStub = {
    waitUntil: (p: Promise<unknown>) => { void p; },
  };
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-mcp-test-kitchen-sink", version: "0.0.1" });
    registerTools(server, () => ({ workspace_id, user_id }), env,
      () => defaultCtxStub as unknown as DurableObjectState);
    let foundCallback: ((args: unknown, extra: unknown) => Promise<unknown>) | undefined;
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [string, unknown, (args: unknown, extra: unknown) => Promise<unknown>];
      if (callName === toolName) { foundCallback = callCb; break; }
    }
    if (foundCallback === undefined) throw new Error(`registration for '${toolName}' not captured`);
    return foundCallback;
  } finally {
    spy.mockRestore();
  }
}
```

---

#### `parseEnvelope` helper
**Source:** `recall-conflicts.test.ts` lines 154–157 (identical in `cross-workspace-pentest.test.ts` lines 164–167). Copy verbatim:

```typescript
function parseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}
```

---

#### `seedTwoMemoriesWithTimestamps` + `insertConflictRow` helpers
**Source:** `recall-conflicts.test.ts` lines 164–243. Copy both helpers — they use `stub.insertBlock` and `stub.insertConflictAsInbox` DO RPCs, which are the established patterns for seeding state in workerd pool tests.

Key fixture notes for the kitchen-sink test:
- Use `created_at: Date.now()` for both memories when creating high-severity conflicts (Pitfall 6 — diffDays=0 → severity="high"). Source: `recall-conflicts.test.ts` lines 255–256.
- Seed ≥ 2 blocks before calling recall to satisfy SYN-07 guard (`ranked.length >= 2`). Source: RESEARCH Pitfall 2.

---

#### INT-01 worst-case fixture builder
**Source:** `token-budget.test.ts` lines 59–77. Extend `buildWorstCaseMemories` to 10-conflict + 50-entity configuration:

```typescript
/** Build LexicalSearchHit objects — extend the token-budget.test.ts shape for kitchen-sink. */
function buildKitchenSinkMemories(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `blk-ks-${String(i)}`,
    type: "research_note",
    content: "x".repeat(4_000),   // 4KB content — adversarial size
    summary: "y".repeat(1_000),   // 1KB summary
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
```

---

#### INT-01 adversarial-proof + content-preservation assertion shape
**Source:** `token-budget.test.ts` lines 153–169 (adversarial-proof pattern) + CONTEXT.md D-05 + RESEARCH.md §INT-01:

```typescript
// Step 1: verify fixture IS over budget before trim (adversarial-proof)
// Source: token-budget.test.ts lines 198–234 / RESEARCH Pitfall 1
const beforeTokens = encode(JSON.stringify(envelope)).length;
expect(beforeTokens).toBeGreaterThan(7_500);

// Step 2: trim
const trimmed = trimToBudget(envelope);

// Step 3: post-trim budget
const tokenCount = encode(JSON.stringify(trimmed)).length;
expect(tokenCount).toBeLessThanOrEqual(7_500);

// Step 4: content-preservation assertions (D-05 — the "teeth" of INT-01)
expect(trimmed.result.synthesis).not.toBeNull();        // synthesis survived trim
const survivingConflicts = trimmed.context.conflicts ?? [];
const highSeverity = survivingConflicts.filter((c) => c.severity === "high");
expect(highSeverity.length).toBeGreaterThan(0);         // high-severity conflicts survived
```

Note: `buildRecallResponse` accepts `{ memories, verbosity, synthesis, conflicts }` — confirmed by `tools.ts` line 1046 and RESEARCH §INT-01.

---

#### Positive-control pattern (anti-vacuous isolation)
**Source:** `cross-workspace-pentest.test.ts` lines 203–207. Used in any workspace isolation assertion to prove seeding worked:

```typescript
// After asserting workspace_B sees 0 memories, confirm workspace_A sees ≥1
const recallCb_legit = captureCallback("recall", "workspace_A");
const legitResult = await recallCb_legit({ query: "..." }, {});
const legitEnvelope = parseEnvelope(legitResult);
const legitMemories = (legitEnvelope.result as Record<string, unknown>).memories as unknown[];
expect(legitMemories.length).toBeGreaterThanOrEqual(1);
```

---

### `packages/triage-worker/src/__tests__/conflict-pipeline-isolation.test.ts`
**Role:** security/unit test | **Data Flow:** CRUD (workspace routing assertion)
**Analog:** `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts`

---

#### Imports pattern
**Source:** `conflict-pipeline.test.ts` lines 24–59:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { conflictPipeline } from "../conflict-pipeline.js";
import { EMBEDDING_MODEL } from "@engram/ai-config";

vi.mock("@engram/vectorize-utils", () => ({
  vectorizeNeighbors: vi.fn(),
}));
vi.mock("../conflict-detection.js", () => ({
  detectConflict: vi.fn(),
}));
vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("ws-tag-stub"),
}));

import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { detectConflict } from "../conflict-detection.js";
```

---

#### `makeWorkspaceStub` pattern
**Source:** `conflict-pipeline.test.ts` lines 91–109. This is the EXACT pattern for the isolation test — spy on `WORKSPACE.idFromName` to capture which workspace_id was passed:

```typescript
function makeWorkspaceStub(
  overrides: {
    getBlocksByIds?: () => Promise<{ id: string; content: string; created_at: number }[]>;
    insertConflictAsInbox?: () => Promise<void>;
  } = {},
) {
  const mockGetBlocks = vi.fn(overrides.getBlocksByIds ?? (() => Promise.resolve([neighborBlock])));
  const mockInsertConflict = vi.fn(overrides.insertConflictAsInbox ?? (() => Promise.resolve()));
  const stub = {
    getBlocksByIds: mockGetBlocks,
    insertConflictAsInbox: mockInsertConflict,
  };
  const WORKSPACE = {
    idFromName: vi.fn().mockReturnValue({ toString: () => "fake-do-id" }),
    get: vi.fn().mockReturnValue(stub),
  };
  return { WORKSPACE, mockGetBlocks, mockInsertConflict };
}
```

---

#### D-10 isolation assertion shape
**Source:** CONTEXT.md D-10 + RESEARCH.md §INT-03 triage-worker section.

The key isolation assertion for `conflict-pipeline-isolation.test.ts`: spy on `WORKSPACE.idFromName` and assert the captured argument equals `newBlock.workspace_id`. The actual routing line is `conflict-pipeline.ts` line 152:
```
env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id))
```

The test shape:

```typescript
it("D-10: conflictPipeline routes workspace DO lookup by newBlock.workspace_id, not a forgeable arg", async () => {
  const targetWorkspaceId = "ws-isolation-target";
  const mockAiRun = vi.fn().mockResolvedValue(fakeEmbedResp);
  const { WORKSPACE, mockInsertConflict } = makeWorkspaceStub({
    getBlocksByIds: () => Promise.resolve([neighborBlock]),
  });
  const mockEnv = {
    ...env,
    AI: { run: mockAiRun },
    WORKSPACE,
  } as unknown as Parameters<typeof conflictPipeline>[0];

  vi.mocked(vectorizeNeighbors).mockResolvedValue([neighborBelowCeiling]);
  vi.mocked(detectConflict).mockResolvedValue({
    is_conflict: true,
    category: "contradiction",
    confidence: 0.88,
    reason: "test contradiction",
  });

  const block = { ...baseNewBlock, workspace_id: targetWorkspaceId };
  await conflictPipeline(mockEnv, block);

  // Assert idFromName was called with the block's workspace_id — NOT a forgeable arg
  expect(WORKSPACE.idFromName).toHaveBeenCalledWith(targetWorkspaceId);

  // Assert insertConflictAsInbox was called with the correct workspace_id
  expect(mockInsertConflict).toHaveBeenCalledWith(
    expect.objectContaining({ workspace_id: targetWorkspaceId }),
  );
});
```

---

#### `baseNewBlock` + fixture shapes
**Source:** `conflict-pipeline.test.ts` lines 66–83. Copy `baseNewBlock`, `fakeEmbedResp`, `neighborBelowCeiling`, `neighborBlock` verbatim:

```typescript
const baseNewBlock = {
  id: "blk-new",
  workspace_id: "ws-test",
  type: "fact",
  scope: "personal",
  content: "X is Y",
  created_at: Date.now(),
};
const fakeEmbedResp = { data: [new Array<number>(1024).fill(0.1)] };
const neighborBelowCeiling = { id: "blk-neighbor-1", score: 0.75, values: [] };
const neighborBlock = { id: "blk-neighbor-1", content: "A is B", created_at: Date.now() - 1000 };
```

---

### `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (extend in place)
**Role:** security/integration test | **Data Flow:** request-response
**Analog:** itself — add 3 new `it()` blocks as Prong-A cases per D-07/D-11

---

#### 3 new Prong-A cases to add

All 3 cases follow the existing Prong A pattern at lines 183–207 of the file. Each adds a new `it()` inside the existing `describe("TOL-07 / AI-02: ...")` block.

**Prong A structure to mirror** (lines 183–207):
1. Seed workspace_A via legitimate handler
2. Call the same tool (recall) with forged `props.workspace_id="workspace_B"`
3. Assert result memories = []
4. Positive-control: assert workspace_A returns ≥ 1 memory (anti-vacuous)

**Case 1 — Expanded-query Vectorize fan-out (D-11):**
```typescript
it("TOL-07 Prong A v0.2-EXP: expanded-query fan-out variants query only the forged workspace namespace", async () => {
  // Seed workspace_A
  const rememberCb_A = captureCallback("remember", "workspace_A_exp");
  await rememberCb_A({ content: "exp fan-out isolation seed" }, {});

  // Override Vectorize mock to return top1 score < 0.65 to trigger adaptive fan-out
  // (penTestVectorizeStore tracks namespace → Set<id>)
  // Query from workspace_B — fan-out variants must resolve workspace_B namespace, not workspace_A
  const recallCb_B = captureCallback("recall", "workspace_B_exp");
  const result = await recallCb_B({ query: "exp fan-out", verbosity: "chunks" }, {});
  const envelope = parseEnvelope(result);
  const memories = (envelope.result as Record<string, unknown>).memories as unknown[];
  expect(memories).toEqual([]); // D-11: no workspace_A data bleeds into workspace_B

  // Positive control
  const recallCb_legit = captureCallback("recall", "workspace_A_exp");
  const legitResult = await recallCb_legit({ query: "exp fan-out isolation seed" }, {});
  const legitMemories = (parseEnvelope(legitResult).result as Record<string, unknown>).memories as unknown[];
  expect(legitMemories.length).toBeGreaterThanOrEqual(1);
});
```

**Case 2 — Reranker path (RERANKER_ENABLED=false → raw cosine fallback):**
The reranker receives only blocks from workspace-scoped Vectorize results. Prong A isolation proof: workspace_B recall returns zero hits → reranker contexts contain zero workspace_A content. Same structure as Case 1 — assert `memories = []` from workspace_B.

**Case 3 — Synthesis path:**
```typescript
it("TOL-07 Prong A v0.2-SYN: synthesis call from workspace_B returns null synthesis (no workspace_A data)", async () => {
  const rememberCb_A = captureCallback("remember", "workspace_A_syn");
  await rememberCb_A({ content: "syn isolation seed" }, {});

  const recallCb_B = captureCallback("recall", "workspace_B_syn");
  const result = await recallCb_B({ query: "synthesis isolation", verbosity: "synthesis" }, {});
  const envelope = parseEnvelope(result);

  // SYN-07 guard fires (0 ranked memories for workspace_B) → synthesis must be null
  const resultField = envelope.result as Record<string, unknown>;
  expect(resultField.synthesis).toBeNull();
});
```

**Prong C skip pattern** (lines 266–294 in file) — for any new Prong C additions:
```typescript
it.skip("AI-02 Prong C v0.2-EXP: [description]", async () => {
  // SKIPPED: requires real Cloudflare Vectorize binding (remote: true).
  // Run nightly with CLOUDFLARE_ACCOUNT_ID set + wrangler login.
}, 15_000);
```

---

### `packages/mcp-server/src/__tests__/envelope.test.ts` (extend in place)
**Role:** unit test | **Data Flow:** request-response
**Analog:** itself — add one `context.conflicts` discipline assertion per INT-02

---

#### The only new assertion needed (INT-02)
**Source:** RESEARCH.md §INT-02 + existing file lines 229–264.

The existing D-01 describe block (lines 229–264) already covers synthesis population. The one genuinely missing assertion is the `context.conflicts` field-omit discipline at the tool handler level (CON-05 D-08 / T-02-08-05):

```typescript
// Add inside the existing "envelope builders (TOL-06...)" describe block
it("buildRecallResponse omits context.conflicts when no conflicts provided (CON-05 D-08 field-omit discipline)", () => {
  // When no conflicts param supplied, context.conflicts should be empty [] from builder
  const envelope = buildRecallResponse({ memories: [], verbosity: "chunks" });
  // Builder contract (D-08): empty [] from builder is correct at the builder level
  expect(envelope.context.conflicts).toEqual([]);
  // The field-OMIT behavior (T-02-08-05) is at the tools.ts handler level, not the builder
  // Already covered by recall-conflicts.test.ts Test 3 (lines 334–349)
});
```

**INT-02 key insight from RESEARCH.md §INT-02:** The snapshot covers `META_GAPS` byte-determinism only. The snapshot MUST NOT change. The `buildRecallResponse({ synthesis: "text" })` path is already tested at lines 241–250. INT-02 is satisfied by running `envelope.test.ts` unchanged + verifying GREEN.

---

### `.planning/research/v0.2-INTEGRATION-MATRIX.md` (update status cells)
**Role:** doc/gate | **Data Flow:** —
**Analog:** itself

The 6 matrix rows need Status updated from `pending` to `tested` and Test File cells filled. The exact update pattern is:

```
| RNK × CON (ranking + conflict detection) | 02-04 | packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts | tested | ... |
```

Status vocabulary is **fixed**: only `tested`, `pending`, `out-of-scope` (exact tokens, D-03).

---

## Shared Patterns

### Stateful Vectorize + AI mock setup
**Source:** `recall-conflicts.test.ts` lines 46–105
**Apply to:** `v02-kitchen-sink.test.ts`

Both the kitchen-sink file and any new INT test that calls `remember()` or `recall()` must patch `env.AI` and `env.VECTORIZE` in `beforeAll`. The stateful namespace-tracking map pattern is the established contract — do not use a simple `vi.fn().mockResolvedValue()` because that won't simulate the Vectorize namespace isolation.

The AI mock must handle two response shapes distinguished by the caller's expectations:
- Embed calls return: `{ data: [MOCK_VECTOR], shape: [1, EMBEDDING_DIMS] }`
- Synthesis calls return: `{ response: "Mock synthesis." }`
Source: `tools-integration.test.ts` line 102 (referenced in RESEARCH §Open Questions 2).

### `captureCallback` / `parseEnvelope` helpers
**Source:** `recall-conflicts.test.ts` lines 115–157
**Apply to:** `v02-kitchen-sink.test.ts`

These two helpers are copy-pasted identically in `recall-conflicts.test.ts`, `cross-workspace-pentest.test.ts`, and `tools-integration.test.ts`. Do not abstract them — copy verbatim with a localized name prefix (`kitchenSink*`) to avoid future grep confusion.

### `afterEach` cleanup
**Source:** `recall-conflicts.test.ts` lines 94–105
**Apply to:** `v02-kitchen-sink.test.ts`

```typescript
afterEach(() => {
  kitchenSinkVectorizeStore.clear();
  const e = env as any;
  (e.AI?.run as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  (e.VECTORIZE?.upsert as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  (e.VECTORIZE?.query as ReturnType<typeof vi.fn> | undefined)?.mockClear();
  vi.restoreAllMocks();
});
```

### `makeWorkspaceStub` helper
**Source:** `conflict-pipeline.test.ts` lines 91–109
**Apply to:** `conflict-pipeline-isolation.test.ts`

Copy verbatim. The isolation test extends it only by adding a spy capture on `WORKSPACE.idFromName`.

### `beforeEach(() => vi.clearAllMocks())`
**Source:** `conflict-pipeline.test.ts` line 118
**Apply to:** `conflict-pipeline-isolation.test.ts`

All triage-worker tests use `beforeEach(() => vi.clearAllMocks())` as the inter-test reset.

### `it.skip` real-creds gating
**Source:** `cross-workspace-pentest.test.ts` lines 266–294
**Apply to:** Any new Prong C additions in `cross-workspace-pentest.test.ts`

Pattern: `it.skip("...", async () => { /* SKIPPED: requires real Cloudflare Vectorize binding */ }, 15_000)`

---

## No Analog Found

All files have close analogs in the codebase. No new dependency or pattern is required beyond what already exists.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All files have existing analogs |

---

## Key Anti-Patterns to Avoid (from RESEARCH.md)

| Anti-Pattern | File Affected | Correct Approach |
|---|---|---|
| Mock `hybridRank` in kitchen-sink | `v02-kitchen-sink.test.ts` | Use real `hybridRank` — mocking it defeats the matrix's purpose |
| Use `verbosity: "chunks"` for CON×SYN matrix row | `v02-kitchen-sink.test.ts` | Must use `verbosity: "synthesis"` |
| Fixture too small → trivially-true trim | `v02-kitchen-sink.test.ts` | Assert pre-trim tokens > 7,500 BEFORE asserting post-trim ≤ 7,500 |
| Import `gpt-tokenizer` barrel | `v02-kitchen-sink.test.ts` | Use `gpt-tokenizer/encoding/cl100k_base` exactly |
| Prong A passes vacuously (no seed data) | `cross-workspace-pentest.test.ts` | Add positive-control assertion (workspace_A recalls ≥ 1 memory) |
| Conflict `created_at` 200 days apart | `v02-kitchen-sink.test.ts` | Use `created_at: Date.now()` for high-severity (same-day = diffDays 0) |
| Change snapshot for non-META_GAPS fields | `envelope.test.ts.snap` | Snapshot covers META_GAPS ONLY — do not add new snapshot assertions |

---

## Metadata

**Analog search scope:** `packages/mcp-server/src/__tests__/`, `packages/triage-worker/src/__tests__/`, `.planning/research/`
**Files scanned:** 7 source files read directly
**Pattern extraction date:** 2026-06-10
