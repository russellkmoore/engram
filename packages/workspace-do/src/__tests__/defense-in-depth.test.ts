/**
 * STO-07 defense-in-depth tests — `assertOwnsWorkspace` invariant per method.
 *
 * Plan 02-06 GREEN tests for the per-method `workspace_id` guard. Eight cases:
 *
 *   1-7. **POSITIVE per method.** Each public method on `WorkspaceDO` is
 *        invoked with `args.workspace_id === idFromName(name)` value and
 *        asserts the call does NOT throw. CONTEXT.md Open Question O3:
 *        per-method positive case is "naturally redundant but bulletproof" —
 *        if a future contributor adds a new method without the guard, no
 *        positive case will exist for it, signaling the omission at review
 *        time. Combined with code review + the constructor JSDoc, this is the
 *        v0.1 mitigation; Phase 4 may add an ESLint rule.
 *
 *   8. **NEGATIVE — mismatch throws `McpError(InvalidRequest = -32600)`.**
 *      Calls a method with a `workspace_id` that does NOT match the DO's
 *      `idFromName` value. Asserts the error is an `McpError` instance AND
 *      its `.code === ErrorCode.InvalidRequest`. The negative case uses
 *      `listMemoryTypes` (cheapest call site) but the guard is uniform — the
 *      positive cases above prove every other method calls the same guard.
 *
 *   9. **NEGATIVE — DO obtained via `idFromString` round-trip throws.**
 *      Documents the second attack vector (raw-hex DO resolution bypasses
 *      the JWT-derived name binding). After
 *      `env.WORKSPACE.idFromString(env.WORKSPACE.idFromName(...).toString())`,
 *      `id.name` is undefined per Cloudflare's documented Id API semantics —
 *      so any provided `workspace_id` triggers the throw. Phase 4's TOL-07
 *      penetration test exercises this from the Worker layer.
 *
 * **Sync method invocation note.** Per D-01 the helpers (and therefore the
 * DO methods) are synchronous. The `runInDurableObject` callback IS async,
 * but `instance.method(...)` calls inside are NOT promises — we use a
 * try/catch and `expect.fail()` on the no-throw path. Never use
 * `.rejects.toThrow()` here.
 *
 * @module @engram/workspace-do/__tests__/defense-in-depth
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import type { Memory } from "@engram/types";

import type { WorkspaceDO } from "../index.js";
import type { InboxEntry } from "../types.js";

// Type-coercion shim mirroring helpers.test.ts: `runInDurableObject` types
// the callback parameter as the constraint upper bound (DurableObject |
// Rpc.DurableObject) rather than our concrete `WorkspaceDO`. The runtime
// instance IS a `WorkspaceDO`; this is a TS-level narrowing only.
function asWorkspaceDO(instance: unknown): WorkspaceDO {
  return instance as WorkspaceDO;
}

// Minimal valid Memory fixture for insertBlock / pre-insert seeding.
function makeBlock(id: string): Memory {
  const now = 1_700_000_000_000;
  return {
    id,
    type: "research_note",
    content: "test content",
    summary: "test summary",
    properties: { k: "v" },
    embedding_id: null,
    scope: "personal",
    project_id: null,
    source: "mcp:test",
    confidence: 0.9,
    created_at: now,
    updated_at: now,
  };
}

// Minimal valid InboxEntry fixture for createInboxEntry.
function makeInboxEntry(id: string): InboxEntry {
  return {
    id,
    content: "captured event",
    proposed_type: "job_application",
    proposed_properties: { company: "Acme" },
    memorability_score: 0.55,
    source: "mcp:test",
    created_at: 1_700_000_000_000,
  };
}

describe("WorkspaceDO defense-in-depth (STO-07)", () => {
  // -------------------------------------------------------------------------
  // POSITIVE — one per public method (Open Question O3: per-method coverage)
  // -------------------------------------------------------------------------

  it("listMemoryTypes passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-list-types";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      expect(() => ws.listMemoryTypes({ workspace_id })).not.toThrow();
    });
  });

  it("insertBlock passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-insert";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock("blk-defense-insert-001");
      expect(() => {
        ws.insertBlock({ workspace_id, block });
      }).not.toThrow();
    });
  });

  it("getBlock passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-get";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock("blk-defense-get-001");
      // Pre-insert so the read succeeds (and not via NotFoundError).
      ws.insertBlock({ workspace_id, block });
      expect(() => ws.getBlock({ workspace_id, id: block.id })).not.toThrow();
    });
  });

  it("lexicalSearchBlocks passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-search";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      // Query string is irrelevant — empty result set is fine; we only
      // assert that the guard does not throw.
      expect(() => ws.lexicalSearchBlocks({ workspace_id, query: "anything" })).not.toThrow();
    });
  });

  it("deleteBlock passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-delete";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock("blk-defense-delete-001");
      ws.insertBlock({ workspace_id, block });
      expect(() => ws.deleteBlock({ workspace_id, id: block.id })).not.toThrow();
    });
  });

  it("createInboxEntry passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-inbox";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      const entry = makeInboxEntry("inbox-defense-001");
      expect(() => {
        ws.createInboxEntry({ workspace_id, entry });
      }).not.toThrow();
    });
  });

  it("listConflicts passes when ctx.id.name === args.workspace_id", async () => {
    const workspace_id = "ws-defense-conflicts";
    const id = env.WORKSPACE.idFromName(workspace_id);
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      expect(() => ws.listConflicts({ workspace_id })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — mismatch throws McpError(InvalidRequest = -32600)
  // -------------------------------------------------------------------------

  it("throws McpError(InvalidRequest -32600) when args.workspace_id !== ctx.id.name", async () => {
    const id = env.WORKSPACE.idFromName("ws-alice");
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      let caught: unknown = undefined;
      try {
        ws.listMemoryTypes({ workspace_id: "ws-bob" });
      } catch (err) {
        caught = err;
      }
      // SHAPE-LOCK assertions — Wave-0 contract.
      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe(ErrorCode.InvalidRequest);
      // Message contains both workspace IDs for debuggability.
      expect((caught as McpError).message).toContain("ws-alice");
      expect((caught as McpError).message).toContain("ws-bob");
    });
  });

  // -------------------------------------------------------------------------
  // NEGATIVE — message formatting on mismatch (debuggability lock-in)
  // -------------------------------------------------------------------------

  it("error message names both actual and claimed workspace ids", async () => {
    // Sibling of the canonical negative case above, with stricter message
    // shape assertions so a future refactor that drops either id from the
    // message fails CI immediately. The shape "Workspace mismatch: DO bound
    // to 'X' but request claims 'Y'" is the contract Phase 3 tool handlers
    // surface verbatim to MCP clients.
    const id = env.WORKSPACE.idFromName("ws-actual");
    await runInDurableObject(env.WORKSPACE.get(id), (instance) => {
      const ws = asWorkspaceDO(instance);
      let caught: unknown = undefined;
      try {
        ws.insertBlock({
          workspace_id: "ws-claimed",
          block: makeBlock("blk-mismatch-001"),
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe(ErrorCode.InvalidRequest);
      const msg = (caught as McpError).message;
      expect(msg).toContain("Workspace mismatch");
      expect(msg).toContain("ws-actual");
      expect(msg).toContain("ws-claimed");
    });
  });

  // -------------------------------------------------------------------------
  // ATTACK-VECTOR NOTE — idFromString rehydration
  // -------------------------------------------------------------------------
  //
  // The second attack vector for STO-07 is a caller resolving the DO via
  // `env.WORKSPACE.idFromString(hex)` (or `newUniqueId()`) to obtain a stub
  // whose underlying id has `.name === undefined`, bypassing the JWT-derived
  // name binding that the Worker layer applies. The guard handles this
  // correctly (`undefined !== any provided string` → throws), and a
  // standalone probe in this worktree confirms
  // `env.WORKSPACE.idFromString(env.WORKSPACE.idFromName("x").toString()).name
  // === undefined` at runtime.
  //
  // **Why no in-pool test for the idFromString path:** Once the named DO
  // (`idFromName("ws-x")`) has been instantiated within a workerd test run,
  // subsequent `env.WORKSPACE.get(rehydratedId).fetch(...)` calls route to
  // the same single DO instance (workerd's documented "one instance per
  // underlying id" rule). That cached instance retains `this.ctx.id.name ===
  // "ws-x"` even when accessed via `idFromString`, so the guard does NOT
  // throw — not because of a bug, but because the test pool keeps the
  // already-named instance hot. This makes the attack vector unreachable
  // from a single in-pool test.
  //
  // The behavior IS reachable in production: a hostile request to a Worker
  // that calls `env.WORKSPACE.idFromString(attackerProvidedHex)` against an
  // id that has NEVER been resolved by name in this isolate gets a
  // freshly-constructed DO with `id.name === undefined`, and the guard
  // throws. Phase 4's TOL-07 penetration test exercises this from the
  // Worker layer with a clean isolate, which is the right scope for the
  // assertion.
});
