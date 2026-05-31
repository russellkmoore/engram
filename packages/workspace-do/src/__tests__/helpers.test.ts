/**
 * STO-06 — typed query helpers GREEN tests (one `it` per helper).
 *
 * Each test exercises one of the 7 helpers Plan 02-05 adds to `WorkspaceDO`
 * via the live workerd runtime (`@cloudflare/vitest-pool-workers`). No mocks
 * — `runInDurableObject` returns a real instance + state and the assertions
 * run against the actual SQLite store.
 *
 * Plan 02-06 guard compatibility: every test's `args.workspace_id` value
 * EQUALS the `idFromName` string used to obtain the DO. Plan 02-06's guard
 * fires on a workspace-id mismatch, so this convention keeps the tests
 * passing once the guard wires in (the orchestration note from the plan
 * frontmatter — verified by grep before commit).
 *
 * Cursor conventions per 02-PATTERNS.md Shared Pattern A:
 * - `.toArray()` for list reads; `.one()` for COUNT queries.
 * - Never mix with `.next()` (Pitfall 7).
 *
 * @module @engram/workspace-do/__tests__/helpers
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

import type { Memory } from "@engram/types";

import { NotFoundError } from "../errors.js";
import type { WorkspaceDO } from "../index.js";
import { markIngestFailed } from "../queries.js";
import type { InboxEntry } from "../types.js";

// Type-coercion shim: the `runInDurableObject` callback parameter is typed as
// the constraint upper bound `DurableObject | Rpc.DurableObject` rather than
// our concrete `WorkspaceDO` subclass (the constraint widens because the base
// class's `env: Env` parameter is invariant and our `extends DurableObject<unknown>`
// instantiates Env = unknown, not Cloudflare.Env). At runtime the instance IS
// a `WorkspaceDO`; this cast is a TS-level narrowing only. Centralizing in
// one helper keeps the workaround visible and easy to remove if a future
// `cloudflare:test` release relaxes the constraint.
function asWorkspaceDO(instance: unknown): WorkspaceDO {
  return instance as WorkspaceDO;
}

// Helper: construct a fully-populated `Memory` fixture with deterministic
// timestamps so deep-equal assertions across the JSON round-trip are stable.
function makeBlock(overrides: Partial<Memory> & Pick<Memory, "id">): Memory {
  const now = 1_700_000_000_000;
  return {
    id: overrides.id,
    type: overrides.type ?? "research_note",
    content: overrides.content ?? "test content",
    summary: overrides.summary ?? "test summary",
    properties: overrides.properties === undefined ? { foo: "bar", n: 42 } : overrides.properties,
    embedding_id: overrides.embedding_id ?? null,
    scope: overrides.scope ?? "personal",
    project_id: overrides.project_id ?? null,
    source: overrides.source ?? "mcp:test",
    confidence: overrides.confidence ?? 0.95,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

describe("WorkspaceDO typed query helpers (STO-06)", () => {
  it("insertBlock writes a row and getBlock returns it (JSON round-trip)", async () => {
    const workspace_id = "ws-helpers-insert-get";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({
        id: "blk-insert-001",
        properties: { company: "Acme", role: "Eng", nested: { k: "v" } },
      });
      ws.insertBlock({ workspace_id, block });

      const fetched = ws.getBlock({ workspace_id, id: block.id });
      // Deep-equal asserts the JSON round-trip on properties survived.
      expect(fetched).toEqual(block);
      // Belt-and-braces: properties is a parsed object, not a JSON string.
      expect(typeof fetched.properties).toBe("object");
      expect(fetched.properties).toEqual({
        company: "Acme",
        role: "Eng",
        nested: { k: "v" },
      });
    });
  });

  it("getBlock throws NotFoundError on miss with resource='block'", async () => {
    const workspace_id = "ws-helpers-notfound";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance) => {
      const ws = asWorkspaceDO(instance);
      let caught: unknown = undefined;
      try {
        ws.getBlock({ workspace_id, id: "does-not-exist" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NotFoundError);
      expect((caught as NotFoundError).resource).toBe("block");
      expect((caught as NotFoundError).id).toBe("does-not-exist");
    });
  });

  it("lexicalSearchBlocks returns LIKE matches and [] on no match", async () => {
    const workspace_id = "ws-helpers-lexical";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance) => {
      const ws = asWorkspaceDO(instance);
      ws.insertBlock({
        workspace_id,
        block: makeBlock({ id: "blk-lex-001", content: "the needle is here", summary: null }),
      });
      ws.insertBlock({
        workspace_id,
        block: makeBlock({ id: "blk-lex-002", content: "totally unrelated", summary: null }),
      });

      const hits = ws.lexicalSearchBlocks({ workspace_id, query: "needle" });
      expect(hits.length).toBe(1);
      expect(hits[0]?.id).toBe("blk-lex-001");
      // v0.1 snippet contract: always null until Phase 4.
      expect(hits[0]?.snippet).toBeNull();

      const empty = ws.lexicalSearchBlocks({ workspace_id, query: "zzz-no-match-zzz" });
      expect(empty).toEqual([]);
    });
  });

  it("lexicalSearchBlocks accepts realistic multi-word queries without tripping LIKE complexity", async () => {
    // Regression: the prior `'%' || ? || '%'` SQL concatenation tripped
    // workerd SQLite's "LIKE or GLOB pattern too complex" guard for realistic
    // queries (smoke caught `"Acme Corp staff engineer"` failing). The fix
    // pre-computes the pattern in JS and binds a single literal. This test
    // exercises a query string of the same shape that originally failed.
    const workspace_id = "ws-helpers-lexical-complex";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance) => {
      const ws = asWorkspaceDO(instance);
      ws.insertBlock({
        workspace_id,
        block: makeBlock({
          id: "blk-lex-complex-001",
          content: "Phase 4 smoke test: applied to Acme Corp staff engineer role 2026-05-26",
          summary: null,
        }),
      });

      const hits = ws.lexicalSearchBlocks({ workspace_id, query: "Acme Corp staff engineer" });
      expect(hits.length).toBe(1);
      expect(hits[0]?.id).toBe("blk-lex-complex-001");
    });
  });

  it("deleteBlock cascades to relations when cascade=true (default)", async () => {
    const workspace_id = "ws-helpers-delete";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const blockId = "blk-del-001";
      ws.insertBlock({ workspace_id, block: makeBlock({ id: blockId }) });
      // Insert a relation row directly so we can assert cascade.
      state.storage.sql.exec(
        "INSERT INTO relations (from_id, to_id, relationship, created_at) VALUES (?, ?, ?, ?)",
        blockId,
        "other-block",
        "knows",
        Date.now(),
      );

      const result = ws.deleteBlock({ workspace_id, id: blockId });
      expect(result.blocks_deleted).toBe(1);
      expect(result.relations_deleted).toBe(1);

      // Block is gone: getBlock now throws.
      let caught: unknown = undefined;
      try {
        ws.getBlock({ workspace_id, id: blockId });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NotFoundError);

      // Cascade left zero rows in relations.
      const relCount = state.storage.sql
        .exec(
          "SELECT COUNT(*) AS n FROM relations WHERE from_id = ? OR to_id = ?",
          blockId,
          blockId,
        )
        .one();
      expect(relCount.n).toBe(0);
    });
  });

  it("listMemoryTypes returns the 7 system types post-seed", async () => {
    const workspace_id = "ws-helpers-list-types";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance) => {
      const ws = asWorkspaceDO(instance);
      const types = ws.listMemoryTypes({ workspace_id });
      expect(types.length).toBe(7);
      // job_application is the first system type per CLAUDE.md §"Memory Types".
      const ids = types.map((t) => t.id);
      expect(ids).toContain("job_application");
      // Every system type's fields was parsed from JSON (not a raw string).
      for (const t of types) {
        expect(typeof t.fields).toBe("object");
        expect(t.source).toBe("system");
        expect(t.workspace_id).toBeNull();
      }
    });
  });

  it("createInboxEntry writes a row that survives readback (JSON round-trip)", async () => {
    const workspace_id = "ws-helpers-inbox";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const entry: InboxEntry = {
        id: "inbox-001",
        content: "saw an interesting role posted",
        proposed_type: "job_application",
        proposed_properties: { company: "Acme", role: "Eng" },
        memorability_score: 0.55,
        source: "mcp:test",
        created_at: 1_700_000_000_000,
      };
      ws.createInboxEntry({ workspace_id, entry });

      // Read back via raw SQL — Phase 2 has no getInboxEntry helper (Phase 3
      // inbox-management tools own that surface).
      const row = state.storage.sql
        .exec("SELECT id, proposed_properties FROM inbox WHERE id = ?", entry.id)
        .one();
      expect(row.id).toBe(entry.id);
      expect(typeof row.proposed_properties).toBe("string");
      const parsed = JSON.parse(row.proposed_properties as string) as Record<string, unknown>;
      expect(parsed).toEqual({ company: "Acme", role: "Eng" });
    });
  });

  it("listConflicts returns rows ordered by detected_at DESC and supports resolved filter", async () => {
    const workspace_id = "ws-helpers-conflicts";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      // Insert two conflicts directly: one unresolved (resolved_at = NULL),
      // one resolved (resolved_at = a timestamp). Use distinct detected_at
      // values so ORDER BY DESC is deterministic.
      state.storage.sql.exec(
        "INSERT INTO conflicts (id, memory_a_id, memory_b_id, description, severity, detected_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        "cnf-open",
        "mem-a",
        "mem-b",
        "open conflict",
        "high",
        2_000,
        null,
      );
      state.storage.sql.exec(
        "INSERT INTO conflicts (id, memory_a_id, memory_b_id, description, severity, detected_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        "cnf-resolved",
        "mem-c",
        "mem-d",
        "resolved conflict",
        "low",
        1_000,
        1_500,
      );

      const all = ws.listConflicts({ workspace_id });
      expect(all.length).toBe(2);
      // DESC ordering: cnf-open (detected_at=2000) before cnf-resolved (1000).
      expect(all[0]?.id).toBe("cnf-open");
      expect(all[1]?.id).toBe("cnf-resolved");

      const unresolved = ws.listConflicts({ workspace_id, resolved: false });
      expect(unresolved.length).toBe(1);
      expect(unresolved[0]?.id).toBe("cnf-open");
      expect(unresolved[0]?.resolved_at).toBeNull();

      const resolved = ws.listConflicts({ workspace_id, resolved: true });
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.id).toBe("cnf-resolved");
      expect(resolved[0]?.resolved_at).toBe(1_500);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 6 D-03 — ingest_status lifecycle on Phase 5 enrichment helpers.
  // Each amended helper (updateBlockEnrichment / moveToColdStorage / moveToInbox)
  // must atomically set `ingest_status='enriched'` as part of its UPDATE clause.
  // ---------------------------------------------------------------------------

  it("updateBlockEnrichment transitions ingest_status pending → enriched (Phase 6 D-03)", async () => {
    const workspace_id = "ws-pip-updateBlockEnrichment-status";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({ id: "blk-pip-enrich-001" });
      ws.insertBlock({ workspace_id, block });

      // Baseline: V3 migration defaults ingest_status to 'pending'.
      const before = state.storage.sql
        .exec("SELECT ingest_status FROM blocks WHERE id = ?", block.id)
        .one();
      expect(before.ingest_status).toBe("pending");

      ws.updateBlockEnrichment({
        workspace_id,
        block_id: block.id,
        properties: { ai_extracted: true },
        summary: "ai summary",
        confidence: 0.9,
      });

      const after = state.storage.sql
        .exec("SELECT ingest_status FROM blocks WHERE id = ?", block.id)
        .one();
      expect(after.ingest_status).toBe("enriched");
    });
  });

  // ENG-8: updateBlockEnrichment must persist the classifier's `type` via
  // COALESCE — fill nulls when the user didn't pass `type` at remember() time,
  // but never overwrite an explicit user-asserted type. Before the fix the
  // classifier's resolved `parsed.classified_type` was dropped on the floor
  // in the Triage Worker's store-normal branch, leaving `blocks.type` null
  // forever and producing the recall-envelope shape inconsistency that
  // surfaced as ENG-8.
  it("updateBlockEnrichment with type=<classifier> fills blocks.type when it was NULL (ENG-8)", async () => {
    const workspace_id = "ws-eng8-fill-null";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      // Simulate the remember()-without-type path: insert, then clear type to
      // null via direct SQL. The makeBlock helper's `??` coalesce prevents
      // passing null through the overrides, so we set the precondition
      // directly. The shape this mimics is `tools.ts:285` writing
      // `type: args.type ?? null` when Claude did not classify pre-call.
      const block = makeBlock({ id: "blk-eng8-null-001" });
      ws.insertBlock({ workspace_id, block });
      state.storage.sql.exec("UPDATE blocks SET type = NULL WHERE id = ?", block.id);

      const before = state.storage.sql.exec("SELECT type FROM blocks WHERE id = ?", block.id).one();
      expect(before.type).toBeNull();

      ws.updateBlockEnrichment({
        workspace_id,
        block_id: block.id,
        properties: { company: "Apple", role: "SWE" },
        summary: "Apple SWE posting",
        confidence: 0.92,
        type: "job_application",
      });

      const after = state.storage.sql.exec("SELECT type FROM blocks WHERE id = ?", block.id).one();
      expect(after.type).toBe("job_application");
    });
  });

  it("updateBlockEnrichment with type=<classifier> preserves user-asserted type via COALESCE (ENG-8)", async () => {
    const workspace_id = "ws-eng8-preserve-user";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      // Simulate the remember()-WITH-explicit-type path: user said it's a
      // meeting_note, classifier later disagrees and says job_application.
      // COALESCE(type, ?) keeps the user-asserted value.
      const block = makeBlock({ id: "blk-eng8-userwins-001", type: "meeting_note" });
      ws.insertBlock({ workspace_id, block });

      ws.updateBlockEnrichment({
        workspace_id,
        block_id: block.id,
        properties: { ai_extracted: true },
        summary: "enriched",
        confidence: 0.85,
        type: "job_application",
      });

      const after = state.storage.sql.exec("SELECT type FROM blocks WHERE id = ?", block.id).one();
      // User intent wins — classifier never overrides an explicit assertion.
      expect(after.type).toBe("meeting_note");
    });
  });

  it("updateBlockEnrichment with type omitted leaves blocks.type untouched (ENG-8 back-compat)", async () => {
    const workspace_id = "ws-eng8-omit";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({ id: "blk-eng8-omit-001", type: "contact" });
      ws.insertBlock({ workspace_id, block });

      // Pre-ENG-8 call shape — no `type` arg. Must not regress.
      ws.updateBlockEnrichment({
        workspace_id,
        block_id: block.id,
        properties: { ai_extracted: true },
        summary: "enriched",
        confidence: 0.9,
      });

      const after = state.storage.sql.exec("SELECT type FROM blocks WHERE id = ?", block.id).one();
      expect(after.type).toBe("contact");
    });
  });

  it("moveToColdStorage sets BOTH cold_storage=1 AND ingest_status='enriched' (D-03 orthogonality)", async () => {
    const workspace_id = "ws-pip-moveToColdStorage-status";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({ id: "blk-pip-cold-001" });
      ws.insertBlock({ workspace_id, block });

      ws.moveToColdStorage({
        workspace_id,
        block_id: block.id,
        memorability: 0.1,
      });

      const row = state.storage.sql
        .exec("SELECT cold_storage, ingest_status FROM blocks WHERE id = ?", block.id)
        .one();
      // D-03 orthogonality: cold-storage + enriched ALWAYS co-occur,
      // NEVER cold-storage + failed.
      expect(row.cold_storage).toBe(1);
      expect(row.ingest_status).toBe("enriched");
    });
  });

  it("moveToInbox sets source block ingest_status='enriched' AND inserts exactly one inbox row", async () => {
    const workspace_id = "ws-pip-moveToInbox-status";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({ id: "blk-pip-inbox-001" });
      ws.insertBlock({ workspace_id, block });

      ws.moveToInbox({
        workspace_id,
        block_id: block.id,
        entry: {
          content: "inbox content",
          proposed_type: "job_application",
          proposed_properties: { company: "Acme" },
          memorability_score: 0.55,
          source: "mcp:test",
        },
      });

      const blockRow = state.storage.sql
        .exec("SELECT ingest_status FROM blocks WHERE id = ?", block.id)
        .one();
      expect(blockRow.ingest_status).toBe("enriched");

      const inboxCount = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM inbox WHERE id = ?", `inbox-${block.id}`)
        .one();
      expect(inboxCount.n).toBe(1);
    });
  });

  it("moveToInbox called twice with same block_id is idempotent (INSERT OR IGNORE, PIP-03 / IP-1)", async () => {
    const workspace_id = "ws-pip-moveToInbox-idempotent";
    const id = env.WORKSPACE.idFromName(workspace_id);
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      const ws = asWorkspaceDO(instance);
      const block = makeBlock({ id: "blk-pip-replay-001" });
      ws.insertBlock({ workspace_id, block });

      const args = {
        workspace_id,
        block_id: block.id,
        entry: {
          content: "first delivery",
          proposed_type: "job_application",
          proposed_properties: { company: "Acme" },
          memorability_score: 0.55,
          source: "mcp:test",
        },
      };
      // First Queue delivery.
      ws.moveToInbox(args);
      // Duplicate Queue delivery (at-least-once semantic). The INSERT OR IGNORE
      // on the inbox.id PK collision must make the second insert a no-op AND
      // not raise a UNIQUE-constraint failure. The block UPDATE is naturally
      // idempotent (second call overwrites with the same value).
      expect(() => {
        ws.moveToInbox(args);
      }).not.toThrow();

      const inboxCount = state.storage.sql
        .exec("SELECT COUNT(*) AS n FROM inbox WHERE id = ?", `inbox-${block.id}`)
        .one();
      expect(inboxCount.n).toBe(1);

      const blockRow = state.storage.sql
        .exec("SELECT ingest_status FROM blocks WHERE id = ?", block.id)
        .one();
      expect(blockRow.ingest_status).toBe("enriched");
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 6 D-03 / PIP-05 — markIngestFailed helper (new in 06-03).
  // ---------------------------------------------------------------------------

  describe("markIngestFailed (Phase 6 D-03 / PIP-05)", () => {
    it("transitions ingest_status pending → failed and overwrites properties with {error, failed_at}", async () => {
      const workspace_id = "ws-pip-markIngestFailed-happy";
      const id = env.WORKSPACE.idFromName(workspace_id);
      const stub = env.WORKSPACE.get(id);
      await runInDurableObject(stub, (instance, state) => {
        const ws = asWorkspaceDO(instance);
        const block = makeBlock({ id: "blk-pip-fail-001" });
        ws.insertBlock({ workspace_id, block });

        // Direct helper call against the DO's SQL store (not RPC — Task 2
        // covers the RPC path).
        markIngestFailed(state.storage.sql, {
          block_id: block.id,
          reason: "test-reason",
        });

        const row = state.storage.sql
          .exec("SELECT ingest_status, properties FROM blocks WHERE id = ?", block.id)
          .one();
        expect(row.ingest_status).toBe("failed");
        expect(typeof row.properties).toBe("string");
        const parsed = JSON.parse(row.properties as string) as Record<string, unknown>;
        expect(parsed.error).toBe("test-reason");
        expect(typeof parsed.failed_at).toBe("number");
      });
    });

    it("throws NotFoundError with resource='block' on non-existent block_id (D-02 contract mirror)", async () => {
      const workspace_id = "ws-pip-markIngestFailed-throw";
      const id = env.WORKSPACE.idFromName(workspace_id);
      const stub = env.WORKSPACE.get(id);
      await runInDurableObject(stub, (_instance, state) => {
        let caught: unknown = undefined;
        try {
          markIngestFailed(state.storage.sql, {
            block_id: "does-not-exist",
            reason: "x",
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(NotFoundError);
        expect((caught as NotFoundError).resource).toBe("block");
        expect((caught as NotFoundError).id).toBe("does-not-exist");
      });
    });
  });
});
