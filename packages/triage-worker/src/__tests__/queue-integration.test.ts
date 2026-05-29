/**
 * Phase 6 PIP-01..06 — Queue consumer integration tests (Wave 4).
 *
 * Exercises the FULL async-pipeline consumer path end-to-end:
 *   handler.queue(batch, env) → extractAndScore → routeByMemorability →
 *   WorkspaceDO.{updateBlockEnrichment | moveToInbox | moveToColdStorage |
 *   markIngestFailed} → SQLite state assertions via runInDurableObject.
 *
 * Harness combination (per 06-PATTERNS.md §13):
 * - **vi.fn message mock** from `extract.test.ts` (lines 41–63) — `retry`, `ack`,
 *   `attempts` are all `vi.fn()` so the test can assert call ordering and counts.
 * - **Real-DO state assertions** from `tools-integration.test.ts` (lines 39–110) —
 *   `runInDurableObject` against the workerd test pool's WORKSPACE binding returns
 *   real SQLite state for raw-SQL reads (`SELECT ingest_status FROM blocks WHERE id = ?`).
 *
 * Test-infrastructure rationale (06-CONTEXT.md §"Test infrastructure"):
 * Wrangler@4's local Queue emulator coverage is thin. The default-exported queue
 * handler can be invoked DIRECTLY with mock `MessageBatch<MemoryEvent>` objects,
 * which is the established `extract.test.ts` shape. No Queue emulator needed —
 * the Queue is just the delivery mechanism; this file tests the consumer body
 * and the DO RPCs it issues.
 *
 * Cross-phase contract:
 * - **PIP-03 / IP-1:** at-least-once Queue delivery means replaying the same
 *   MemoryEvent.id MUST produce exactly 1 inbox row, 1 block row, 1 Vectorize
 *   entry (no duplicates). Verified by `it("PIP-03: replay-twice ...")`.
 * - **PIP-06 / D-03:** `blocks.ingest_status` transitions are atomic with the
 *   enrichment UPDATE for memorability >0.8 / 0.4–0.8 / <0.4. Verified by
 *   `it("PIP-06: memorability {>0.8 | 0.4–0.8 | <0.4} transitions pending →
 *   enriched ...")`. Cold-storage + enriched orthogonality (NEVER cold + failed)
 *   is the D-03 invariant — verified by negative assertion on the <0.4 path.
 * - **PIP-05:** permanent failure (Zod attempts>=2; DO-RPC catch on attempts>=2)
 *   flips `ingest_status` to `'failed'` + acks (no silent drop). Verified by
 *   two failure-path tests.
 *
 * Plan 06-05 Task 1 specifics:
 * - Test 1(f) (DO-RPC failure) uses the **seed-block + vi.spyOn** scenario per
 *   checker B1 fix. The un-seeded alternative was REMOVED because it cannot
 *   verify the must_have truth "block transitions ingest_status pending →
 *   failed" — if the block was never seeded, there is no SQLite row to assert
 *   against, and `markIngestFailed` itself would NotFoundError.
 *
 * @module @engram/triage-worker/__tests__/queue-integration
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
// Rationale: this test file mutates the ambient `env` from cloudflare:workers
// (env.AI is patched per test to control the memorability routing branch).
// The direct-assignment pattern unavoidably surfaces unsafe-member-access lint
// findings on `(env as any).AI = ...`; the same pattern is established in
// mcp-server's tools-integration.test.ts and is the canonical harness shape
// for tests that must inject mock bindings into a real workerd pool.
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { MemoryEvent } from "@engram/types";

import handler from "../index.js";

// DurableObjectNamespace is sourced as a GLOBAL AMBIENT type (from the wrangler-
// generated `worker-configuration.d.ts` Cloudflare.Env declaration via `Cloudflare`
// global namespace). Importing the same name from `@cloudflare/workers-types`
// resolves to a slightly different shape that does not match the runtime types
// the `runInDurableObject` signature expects under `exactOptionalPropertyTypes`.
// Mirrors the established `tools-integration.test.ts:423` pattern.

// ---------------------------------------------------------------------------
// Helpers — message + batch + event builders + DO seed + status readers
// ---------------------------------------------------------------------------

/**
 * Build a single mock Cloudflare Queue message with vi.fn ack/retry handles.
 * Cast as `unknown as Parameters<...>` is unavoidable — the vi.fn shape is
 * structurally different from the real `Message<T>` interface.
 */
function buildMessage(body: MemoryEvent, attempts = 0) {
  return {
    ack: vi.fn(),
    retry: vi.fn(),
    attempts,
    body,
    id: `msg-${body.id}`,
    timestamp: new Date(body.timestamp),
  };
}

type MockMessage = ReturnType<typeof buildMessage>;

/** Wrap a list of mock messages into a MessageBatch<MemoryEvent>. */
function buildBatch(messages: MockMessage[]): MessageBatch<MemoryEvent> {
  return { messages, queue: "engram-ingest" } as unknown as MessageBatch<MemoryEvent>;
}

/** Build a MemoryEvent with sensible defaults; overrides take precedence. */
function buildEvent(overrides: Partial<MemoryEvent> & { workspace_id: string }): MemoryEvent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: overrides.source ?? "mcp:claude",
    content: overrides.content ?? "Phase 6 integration test content for triage worker",
    workspace_id: overrides.workspace_id,
    timestamp: overrides.timestamp ?? Date.now(),
    ...(overrides.hint !== undefined && { hint: overrides.hint }),
    ...(overrides.context !== undefined && { context: overrides.context }),
  };
}

/**
 * Seed a block in the real WorkspaceDO via insertBlock RPC. Establishes
 * `ingest_status='pending'` (the V3 migration column default) before the queue
 * handler runs. REQUIRED for every failure-path test that asserts a SQLite
 * state transition (per checker B1 fix to Test 1f).
 */
async function seedBlockInDO(
  workspace_id: string,
  blockId: string,
  content: string,
): Promise<void> {
  const wsNs = (env as unknown as { WORKSPACE: DurableObjectNamespace }).WORKSPACE;
  const id = wsNs.idFromName(workspace_id);
  const stub = wsNs.get(id);
  await runInDurableObject(stub, (instance) => {
    const ws = instance as unknown as {
      insertBlock: (args: { workspace_id: string; block: Record<string, unknown> }) => void;
    };
    ws.insertBlock({
      workspace_id,
      block: {
        id: blockId,
        type: null,
        content,
        summary: null,
        properties: {},
        embedding_id: null,
        scope: "personal",
        project_id: null,
        source: "mcp:claude",
        confidence: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    });
  });
}

/** Read the current `ingest_status` value for a block via raw SQL inside the DO. */
async function getIngestStatus(workspace_id: string, blockId: string): Promise<string | null> {
  const wsNs = (env as unknown as { WORKSPACE: DurableObjectNamespace }).WORKSPACE;
  const id = wsNs.idFromName(workspace_id);
  const stub = wsNs.get(id);
  return await runInDurableObject(stub, (_inst, state) => {
    const row = state.storage.sql
      .exec("SELECT ingest_status FROM blocks WHERE id = ?", blockId)
      .toArray()[0];
    return row === undefined ? null : (row.ingest_status as string);
  });
}

/** Read the full block row (cold_storage + ingest_status + properties) for assertions. */
async function getBlockRow(
  workspace_id: string,
  blockId: string,
): Promise<{ cold_storage: number; ingest_status: string; properties: string } | null> {
  const wsNs = (env as unknown as { WORKSPACE: DurableObjectNamespace }).WORKSPACE;
  const id = wsNs.idFromName(workspace_id);
  const stub = wsNs.get(id);
  return await runInDurableObject(stub, (_inst, state) => {
    const row = state.storage.sql
      .exec("SELECT cold_storage, ingest_status, properties FROM blocks WHERE id = ?", blockId)
      .toArray()[0];
    if (row === undefined) return null;
    return {
      cold_storage: row.cold_storage as number,
      ingest_status: row.ingest_status as string,
      properties: row.properties as string,
    };
  });
}

/** Count inbox rows matching the inbox-${blockId} id format used by moveToInbox. */
async function getInboxRowCount(workspace_id: string, blockId: string): Promise<number> {
  const wsNs = (env as unknown as { WORKSPACE: DurableObjectNamespace }).WORKSPACE;
  const id = wsNs.idFromName(workspace_id);
  const stub = wsNs.get(id);
  return await runInDurableObject(stub, (_inst, state) => {
    const row = state.storage.sql
      .exec("SELECT COUNT(*) AS n FROM inbox WHERE id = ?", `inbox-${blockId}`)
      .one();
    return row.n as number;
  });
}

/**
 * Patch `env.AI.run` to return a TRIAGE_JSON_SCHEMA-valid response with the
 * given memorability. Lets each test select the routing branch deterministically.
 */
function patchAI(memorability: number, extras: Partial<{ summary: string }> = {}): void {
  (env as any).AI = {
    run: vi.fn().mockImplementation(() => {
      return Promise.resolve({
        response: {
          classified_type: "research_note",
          extracted_fields: { topic: "phase6-integration-test" },
          entities: [],
          summary: extras.summary ?? "integration test summary content here",
          memorability,
          confidence: 0.9,
        },
      });
    }),
  };
}

/**
 * Patch `env.AI.run` to return JSON that FAILS the TRIAGE_JSON_SCHEMA zod gate
 * — drives the Zod-permanent-fail branch when paired with attempts>=2.
 */
function patchAIInvalidJson(): void {
  (env as any).AI = {
    run: vi.fn().mockImplementation(() => {
      return Promise.resolve({
        response: { not_a_valid_field: "garbage that fails TriageOutput schema" },
      });
    }),
  };
}

// ---------------------------------------------------------------------------
// Per-test isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up any env.AI patches between tests so the next describe starts fresh.
  delete (env as any).AI;
});

// ---------------------------------------------------------------------------
// (a) PIP-03: Replay-twice idempotency — at-least-once delivery is safe
// ---------------------------------------------------------------------------

describe("PIP-03 / IP-1: replay-twice idempotency (inbox path)", () => {
  it("PIP-03: replay-twice with same MemoryEvent.id produces exactly 1 inbox row + 1 block + ingest_status='enriched'", async () => {
    const workspace_id = "ws-pip03-replay";
    const blockId = "blk-pip03-replay-001";

    // Memorability 0.5 → inbox branch — exercises moveToInbox's INSERT OR IGNORE
    // on the inbox.id PK collision (Plan 06-03 Task 1 hardening).
    patchAI(0.5);

    // Seed the block first — the producer (remember()) writes the block sync.
    await seedBlockInDO(workspace_id, blockId, "replay-twice idempotency test content");

    const event = buildEvent({ workspace_id, id: blockId });

    // First Queue delivery.
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);
    // Second Queue delivery — same event id (at-least-once duplicate).
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);

    // Exactly one inbox row (INSERT OR IGNORE on PK collision).
    const inboxCount = await getInboxRowCount(workspace_id, blockId);
    expect(inboxCount).toBe(1);

    // ingest_status idempotent — same value on second UPDATE.
    expect(await getIngestStatus(workspace_id, blockId)).toBe("enriched");

    // Block row is singular (PK uniqueness — seeded once, never duplicated).
    const row = await getBlockRow(workspace_id, blockId);
    expect(row).not.toBeNull();
    expect(row?.cold_storage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) PIP-06: memorability > 0.8 — store-normal path
// ---------------------------------------------------------------------------

describe("PIP-06: ingest_status lifecycle — store-normal (memorability > 0.8)", () => {
  it("PIP-06: memorability > 0.8 transitions ingest_status pending → enriched (no inbox row, cold_storage=0)", async () => {
    const workspace_id = "ws-pip06-storenormal";
    const blockId = "blk-pip06-store-001";

    patchAI(0.9);
    await seedBlockInDO(workspace_id, blockId, "high-memorability content for store-normal");

    // Baseline: V3 migration default.
    expect(await getIngestStatus(workspace_id, blockId)).toBe("pending");

    const event = buildEvent({ workspace_id, id: blockId });
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);

    // Status flipped to enriched in the same UPDATE as the enrichment write.
    expect(await getIngestStatus(workspace_id, blockId)).toBe("enriched");

    // No inbox row (store-normal does NOT call moveToInbox).
    expect(await getInboxRowCount(workspace_id, blockId)).toBe(0);

    // cold_storage stays 0 (D-03 orthogonality — store-normal is not cold).
    const row = await getBlockRow(workspace_id, blockId);
    expect(row?.cold_storage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) PIP-06: memorability 0.4–0.8 — inbox path
// ---------------------------------------------------------------------------

describe("PIP-06: ingest_status lifecycle — inbox (memorability 0.4–0.8)", () => {
  it("PIP-06: memorability 0.4–0.8 transitions ingest_status pending → enriched AND writes inbox row", async () => {
    const workspace_id = "ws-pip06-inbox";
    const blockId = "blk-pip06-inbox-001";

    patchAI(0.6);
    await seedBlockInDO(workspace_id, blockId, "mid-memorability content for inbox routing");

    expect(await getIngestStatus(workspace_id, blockId)).toBe("pending");

    const event = buildEvent({ workspace_id, id: blockId });
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);

    // moveToInbox composition: block UPDATE → enriched, inbox INSERT → 1 row.
    expect(await getIngestStatus(workspace_id, blockId)).toBe("enriched");
    expect(await getInboxRowCount(workspace_id, blockId)).toBe(1);

    // Negative orthogonality: never cold + inbox + failed combination.
    const row = await getBlockRow(workspace_id, blockId);
    expect(row?.cold_storage).toBe(0);
    expect(row?.ingest_status).not.toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// (d) PIP-06 / D-03 orthogonality: memorability < 0.4 — cold-storage path
// ---------------------------------------------------------------------------

describe("PIP-06 / D-03 orthogonality: cold-storage (memorability < 0.4)", () => {
  it("PIP-06 / D-03: memorability < 0.4 transitions pending → enriched AND sets cold_storage=1 simultaneously (NEVER failed)", async () => {
    const workspace_id = "ws-pip06-cold";
    const blockId = "blk-pip06-cold-001";

    patchAI(0.2);
    await seedBlockInDO(workspace_id, blockId, "low-memorability content for cold-storage routing");

    expect(await getIngestStatus(workspace_id, blockId)).toBe("pending");

    const event = buildEvent({ workspace_id, id: blockId });
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);

    const row = await getBlockRow(workspace_id, blockId);
    // D-03 orthogonality: cold_storage=1 AND ingest_status='enriched' co-occur.
    expect(row?.cold_storage).toBe(1);
    expect(row?.ingest_status).toBe("enriched");
    // Cardinal D-03 negative: cold-storage + failed is NEVER allowed.
    expect(row?.ingest_status).not.toBe("failed");

    // No inbox row — cold-storage routes via moveToColdStorage, not moveToInbox.
    expect(await getInboxRowCount(workspace_id, blockId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (e) PIP-05: Zod parse failure at attempts>=2 — permanent failure path
// ---------------------------------------------------------------------------

describe("PIP-05: Zod parse failure permanent (attempts >= 2)", () => {
  it("PIP-05: Zod parse failure on attempts >= 2 transitions ingest_status pending → failed AND acks (no retry)", async () => {
    const workspace_id = "ws-pip05-zod";
    const blockId = "blk-pip05-zod-001";

    // AI returns JSON that fails the TriageOutput zod schema (missing required fields).
    patchAIInvalidJson();
    await seedBlockInDO(workspace_id, blockId, "zod-permanent-fail content");

    const event = buildEvent({ workspace_id, id: blockId });
    const message = buildMessage(event, 2); // attempts=2 → isLastAttempt true in extract.ts

    await handler.queue(buildBatch([message]), env as never);

    // Block transitioned pending → failed via markIngestFailed RPC.
    expect(await getIngestStatus(workspace_id, blockId)).toBe("failed");

    // properties column overwritten with {error: "zod-parse-fail:...", failed_at}.
    const row = await getBlockRow(workspace_id, blockId);
    if (row === null) throw new Error("block row missing after handler ran");
    const parsedProps = JSON.parse(row.properties) as { error: string; failed_at: number };
    expect(parsedProps.error).toMatch(/^zod-parse-fail:/);
    expect(typeof parsedProps.failed_at).toBe("number");

    // Permanent ack — never retry on attempts >= 2.
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (f) PIP-05: DO-RPC failure at attempts>=2 — seed-block + vi.spyOn scenario
//     (per checker B1 fix — the un-seeded alternative was REMOVED).
// ---------------------------------------------------------------------------

describe("PIP-05: DO-RPC failure permanent (attempts >= 2, seed-block + vi.spyOn)", () => {
  it("PIP-05: DO-RPC failure on attempts >= 2 calls markIngestFailed + acks (no silent drop) — block transitions pending → failed", async () => {
    const workspace_id = "ws-pip05-dorpc";
    const blockId = "blk-pip05-dorpc-001";

    // memorability > 0.8 → store-normal path → updateBlockEnrichment is called.
    patchAI(0.9);

    // (1) Seed the block so SQLite has a row to flip pending → failed.
    await seedBlockInDO(workspace_id, blockId, "DO-RPC failure scenario content");
    expect(await getIngestStatus(workspace_id, blockId)).toBe("pending");

    // (2) Resolve the SAME stub the handler will resolve (env.WORKSPACE.get(idFromName(workspace_id))).
    const wsNs = (env as unknown as { WORKSPACE: DurableObjectNamespace }).WORKSPACE;
    const id = wsNs.idFromName(workspace_id);
    const stub = wsNs.get(id);

    // (3a) Stub updateBlockEnrichment on this stub instance to throw exactly once.
    //      cast pattern mirrors triage-worker/index.ts:151 — RPC methods are
    //      enumerable callable properties on the cross-Worker DO stub.
    const enrichmentSpy = vi
      .spyOn(
        stub as unknown as {
          updateBlockEnrichment: (args: unknown) => Promise<void>;
        },
        "updateBlockEnrichment",
      )
      .mockRejectedValueOnce(new Error("simulated do-rpc failure"));

    // (3b) CRITICAL: also spy on env.WORKSPACE.get so the handler resolves the
    //       SAME stub instance we just patched. Without this the handler would
    //       call .get(...) fresh and bypass our spy entirely.
    const getSpy = vi.spyOn(wsNs, "get").mockReturnValueOnce(stub);

    // markIngestFailed on the SAME stub is NOT spied — runs normally against
    // real SQLite so the ingest_status flip is observable.

    // (4) Console.error spy to verify the failure log surfaced.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* noop — capture without polluting test output */
    });

    // (5) Build message with attempts=2 → isLastAttempt true → pre-emption fires.
    const event = buildEvent({ workspace_id, id: blockId });
    const message = buildMessage(event, 2);

    await handler.queue(buildBatch([message]), env as never);

    // (6) Assertions in order (all REQUIRED per plan):

    // Pre-emption fired: message acked exactly once.
    expect(message.ack).toHaveBeenCalledTimes(1);

    // Last attempt — no retry budget remaining.
    expect(message.retry).not.toHaveBeenCalled();

    // MUST_HAVE TRUTH VERIFICATION: block transitioned pending → failed.
    // (The un-seeded-block scenario could NOT verify this — it could only
    // assert ack was called. seed-block + vi.spyOn is the only design that
    // proves the SQLite state transition.)
    expect(await getIngestStatus(workspace_id, blockId)).toBe("failed");

    // markIngestFailed properties contract (D-03): {error, failed_at}.
    const row = await getBlockRow(workspace_id, blockId);
    if (row === null) throw new Error("block row missing after handler ran");
    const parsedProps = JSON.parse(row.properties) as { error: string; failed_at: number };
    expect(parsedProps.error).toMatch(/^do-rpc-store-normal:/);
    expect(parsedProps.error).toContain("simulated do-rpc failure");
    expect(typeof parsedProps.failed_at).toBe("number");

    // The catch-path console.error was emitted ("triage:do-rpc-failed").
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "triage:do-rpc-failed",
      expect.objectContaining({
        id: blockId,
        decision: "store-normal",
        attempts: 2,
        reason: expect.stringContaining("simulated do-rpc failure") as unknown,
      }),
    );

    // Spies actually fired.
    expect(enrichmentSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (g) Optional smoke: full pipeline shape sanity (duplicates b, acts as smoke).
// ---------------------------------------------------------------------------

describe("end-to-end smoke: queue handler happy path produces enriched block", () => {
  it("smoke: seed + queue handler with memorability 0.9 flips ingest_status to 'enriched'", async () => {
    const workspace_id = "ws-pip-smoke";
    const blockId = "blk-pip-smoke-001";

    patchAI(0.95);
    await seedBlockInDO(workspace_id, blockId, "smoke test for end-to-end pipeline");

    const event = buildEvent({ workspace_id, id: blockId });
    await handler.queue(buildBatch([buildMessage(event, 0)]), env as never);

    expect(await getIngestStatus(workspace_id, blockId)).toBe("enriched");
  });
});
