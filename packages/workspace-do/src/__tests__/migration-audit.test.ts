/**
 * PRE-01 — embedding-version migration audit unit tests.
 *
 * Tests for `countStaleEmbeddings` (queries.ts) and `assertAllBlocksAtV2`
 * (WorkspaceDO admin RPC) added in v0.2 Phase 1. These tests verify:
 *
 *   1. The three-arm NULL-trap SQL clause catches all stale embedding states:
 *      - NULL embedding_version (most common: insertBlock writes NULL;
 *        stampEmbedding fills later; enrichment failures leave NULL forever)
 *      - embedding_version < 2 (v1 stamps from pre-ENG-25 code)
 *      - wrong embedding_model (old bge-base-en-v1.5 768d model)
 *   2. A clean workspace returns count_stale = 0.
 *   3. assertAllBlocksAtV2 enforces assertOwnsWorkspace as its first
 *      executable line — mismatched workspace_id throws McpError(InvalidRequest).
 *
 * PATTERN NOTE: per PATTERNS.md §`packages/workspace-do/src/__tests__/
 * embedding-version-audit.test.ts`, each test uses a unique workspace name
 * via `idFromName(...)` for per-test isolation within the workerd pool.
 *
 * @module @engram/workspace-do/__tests__/migration-audit
 * @requirement PRE-01 (v0.2)
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import type { WorkspaceDO } from "../index.js";

/** Type-coercion shim — workerd types the callback as the base `DurableObject` constraint. */
function asWorkspaceDO(instance: unknown): WorkspaceDO {
  return instance as WorkspaceDO;
}

const CURRENT_MODEL = "@cf/qwen/qwen3-embedding-0.6b";

// ---------------------------------------------------------------------------
// Helper: seed a block row with explicit embedding stamp values
// ---------------------------------------------------------------------------

async function seedBlock(
  stub: ReturnType<typeof env.WORKSPACE.get>,
  blockId: string,
  embeddingVersion: number | null,
  embeddingModel: string | null,
): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO blocks (id, type, content, embedding_version, embedding_model, scope, source, created_at, updated_at)
       VALUES (?, 'research_note', 'test content', ?, ?, 'personal', 'test', ?, ?)`,
      blockId,
      embeddingVersion,
      embeddingModel,
      Date.now(),
      Date.now(),
    );
  });
}

// ---------------------------------------------------------------------------
// Source assertion: SQL clause presence (no-runtime check via import)
// ---------------------------------------------------------------------------

describe("PRE-01 source assertions (queries.ts)", () => {
  it("countStaleEmbeddings is a named export", async () => {
    const mod = await import("../queries.js");
    expect(typeof mod.countStaleEmbeddings).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: countStaleEmbeddings via assertAllBlocksAtV2 RPC
// ---------------------------------------------------------------------------

describe("PRE-01 — assertAllBlocksAtV2 admin RPC", () => {
  it("returns count_stale=0 for a clean workspace (no blocks)", async () => {
    const wsName = "ws-pre01-clean";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(0);
    expect(result.workspace_id).toBe(wsName);
  });

  it("catches NULL embedding_version — cardinal-sin defense (PRE-01 Pitfall 1)", async () => {
    const wsName = "ws-pre01-null-stamp";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    // Seed a block with NULL embedding_version — exactly what insertBlock writes
    // before stampEmbedding runs. This is the most common stale state.
    await seedBlock(stub, "blk-null-1", null, null);
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(1);
  });

  it("catches embedding_version < 2 (v1 stamp from pre-ENG-25 code)", async () => {
    const wsName = "ws-pre01-v1-stamp";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    await seedBlock(stub, "blk-v1-1", 1, "@cf/baai/bge-base-en-v1.5");
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(1);
  });

  it("catches wrong embedding_model (old bge 768d model)", async () => {
    const wsName = "ws-pre01-wrong-model";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    // v2 stamp but wrong model — the model arm of the three-arm clause catches this
    await seedBlock(stub, "blk-wrong-model-1", 2, "@cf/baai/bge-base-en-v1.5");
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(1);
  });

  it("a clean block (v2 stamp + correct model) is NOT counted as stale", async () => {
    const wsName = "ws-pre01-current-stamp";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    // Seed one stale + one current block; only stale should be counted
    await seedBlock(stub, "blk-stale", null, null);
    await seedBlock(stub, "blk-current", 2, CURRENT_MODEL);
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(1);
  });

  it("counts multiple stale blocks correctly", async () => {
    const wsName = "ws-pre01-multi-stale";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);
    await seedBlock(stub, "blk-multi-1", null, null);
    await seedBlock(stub, "blk-multi-2", 1, "@cf/baai/bge-base-en-v1.5");
    await seedBlock(stub, "blk-multi-3", 2, "@cf/baai/bge-base-en-v1.5");
    const result = await runInDurableObject(stub, (instance) => {
      return asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: wsName });
    });
    expect(result.count_stale).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: assertOwnsWorkspace fires on workspace_id mismatch
// ---------------------------------------------------------------------------

describe("PRE-01 — assertAllBlocksAtV2 defense-in-depth (STO-07)", () => {
  it("throws McpError(InvalidRequest) when workspace_id mismatches the DO binding", async () => {
    const wsName = "ws-pre01-guard-test";
    const id = env.WORKSPACE.idFromName(wsName);
    const stub = env.WORKSPACE.get(id);

    let thrownError: unknown = null;
    await runInDurableObject(stub, (instance) => {
      try {
        asWorkspaceDO(instance).assertAllBlocksAtV2({ workspace_id: "wrong-workspace-id" });
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(McpError);
    expect((thrownError as McpError).code).toBe(ErrorCode.InvalidRequest);
  });
});
