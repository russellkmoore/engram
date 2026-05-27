# Phase 4: Core Tools + Envelope — Research

**Researched:** 2026-05-26
**Domain:** MCP tool implementation on Cloudflare Workers (workerd) + DO RPC + JSON-RPC error discipline + token budget enforcement
**Confidence:** HIGH (every Phase 4 question maps to verified evidence in existing source files, installed package typings, or official docs)

## Summary

Phase 4 swaps 5 `MethodNotFound` stubs in `packages/mcp-server/src/tools.ts:173-230` for real handler bodies that route `args` to `WorkspaceDO` methods (Phase 2) via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` (Phase 3 D-05). Every contract decision (D-01..D-10) is LOCKED in `04-CONTEXT.md`; research scope is HOW, not WHAT.

The phase is a **body change, not a contract change** — the 5 registrations in `tools.ts:173-230` stay byte-stable, the zod schemas in `schemas.ts:46-90` get two small additive diffs (D-03 adds `verbosity` to `RecallInputSchema`; D-10 tightens `limit` from `max(100)` to `max(25)` on `RecallInputSchema` and ADDS `limit` to `SearchInputSchema`), and the `mapToMcpError` helper from `error-mapping.ts:57-73` is imported by every new handler. The risk surface is narrow but sharp: (a) the EngramResponse envelope freezes on 5 production tools and Russell's job-search agent becomes its first consumer (TOL-08), (b) the cross-workspace pentest (TOL-07) is the only behavioral proof that `assertOwnsWorkspace` actually fires when a forged `props.workspace_id` mismatches the DO it's addressing, (c) the 8K-token cap is enforced at handler exit via `gpt-tokenizer` (D-09) — over-counting vs Claude's BPE is intentional margin.

**Primary recommendation:** Add a new `packages/mcp-server/src/envelope.ts` helper module (per CONTEXT.md "Integration Points") that owns the honest-stub `EngramResponse<T>` construction for every tool's success shape AND owns the post-trim algorithm (D-10). Every handler in `tools.ts` becomes a 6–8 line body: validate props → await `getAgentByName` → call typed sync method → pass result to `envelope.buildRememberResponse(...)` (or equivalent) → wrap whole try/catch through `mapToMcpError`. Centralizing the envelope build is the single biggest leverage point — keeps handlers thin, keeps the D-04 honest-stubs posture grep-auditable, keeps MCP-08 worst-case fixtures deterministic.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP tool input validation | MCP SDK (auto) | zod (`schemas.ts`) | SDK auto-validates against `inputSchema.shape` BEFORE callback runs (verified in `tools.ts:11`); handlers do not re-parse |
| Workspace authorization | DO (`assertOwnsWorkspace`) | MCP handler (passes `props.workspace_id`) | STO-07 inside DO is the hard backstop; handler simply must pass JWT-derived id (Phase 2 carry-forward) |
| SQLite read/write | WorkspaceDO method | — | Phase 2 typed helpers (`insertBlock`, `lexicalSearchBlocks`, `deleteBlock`); handlers do not touch SQL |
| Envelope construction | MCP handler (`envelope.ts`) | Shared types (`EngramResponse<T>`) | D-04 honest-stub semantics centralized; handlers stay thin |
| Token budget enforcement | MCP handler (post-trim) | `gpt-tokenizer` | D-09/D-10 — JSON.stringify(response) → encode → trim → re-encode loop happens at handler exit |
| Error normalization | MCP handler (`mapToMcpError`) | — | Phase 3 D-09 — single funnel ensures uniform JSON-RPC shape |
| Async enrichment dispatch | DEFERRED to Phase 6 | — | `ingest()` returns synthetic accepted in v0.1 (D-05) — no Queue side effect |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` (already pinned) | `McpError`, `ErrorCode` enum, `McpServer` registration types | Locked by Phase 3 [VERIFIED: `packages/mcp-server/package.json`] |
| `agents` | `^0.13.2` (already pinned) | `McpAgent`, `getAgentByName` | Locked by Phase 3 [VERIFIED: `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts:3946-3954`] |
| `zod` | `^4.0.0` (already pinned) | Schema diff (`verbosity` + `limit` tightening) | Locked by Phase 3 |
| `gpt-tokenizer` | `3.4.0` (latest) | Post-trim token count enforcement (MCP-08) | [VERIFIED: npm registry — `npm view gpt-tokenizer version` returned `3.4.0`; pure-JS BPE, no WASM, no `node:*` requirements per `niieani/gpt-tokenizer` README] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@cloudflare/vitest-pool-workers` | `^0.16.9` (already pinned) | Real workerd runtime in tests — `runInDurableObject`, `listDurableObjectIds`, `env` | TOL-07 pentest (two-workspace), MCP-08 token-budget, round-trip integration |
| `@modelcontextprotocol/sdk/client/index.js` + `StreamableHTTPClientTransport` | bundled with SDK | Optional — for `scripts/smoke-job-agent.mjs` (TOL-08) | LOCAL smoke against `wrangler dev` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `gpt-tokenizer` | `tiktoken` (WASM) | Closer to Claude BPE; ~3MB WASM init cost on cold starts; D-09 rejects this in favour of portability — over-counting is intentional safety margin |
| `gpt-tokenizer` (default `o200k_base`) | `gpt-tokenizer/encoding/cl100k_base` | `cl100k_base` is the GPT-4 / GPT-3.5 encoding — closer in spirit to Claude's BPE than `o200k_base` (GPT-4o); `cl100k_base` import keeps the bundle smaller AND aligns the over-count margin with the spike that informed D-09 |

**Installation:**

```bash
npm install --workspace=@engram/mcp-server gpt-tokenizer
```

**Version verification:** `gpt-tokenizer@3.4.0` verified via `npm view gpt-tokenizer version` (2026-05-26). Pure-JS BPE encoder, MIT license, repo `github.com/niieani/gpt-tokenizer`. No `node:*` API dependency, no WASM, no native bindings — runs identically in browser, Node, and workerd per its own README claims. The `.` export is `./esm/main.js` (ESM-first), with a `cjs/main.js` fallback — `verbatimModuleSyntax` + `"type": "module"` in our package.json picks the ESM path automatically.

## Package Legitimacy Audit

> Phase 4 adds exactly ONE new package. Everything else is already in `packages/mcp-server/package.json` from Phases 1/3.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `gpt-tokenizer` | npm | 3+ years (3.x stable line) | High (used widely in OpenAI ecosystem JS tooling) | `github.com/niieani/gpt-tokenizer` | Not run (no slopcheck available in this session) | `[ASSUMED]` — planner gates install behind `checkpoint:human-verify` per Package Legitimacy Protocol fallback |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time; the planner MUST insert a `checkpoint:human-verify` task before the `npm install gpt-tokenizer` step OR run `pip install slopcheck && slopcheck install gpt-tokenizer --json` themselves. The package has a well-known author (`niieani`), real GitHub repo, no postinstall script (`npm view gpt-tokenizer scripts.postinstall` returned empty), but the audit protocol requires the gate when slopcheck didn't run.*

## Architecture Patterns

### System Architecture Diagram

```text
MCP Client (Claude Desktop / mcp-remote / Inspector)
              │
              │  JSON-RPC over HTTP (Streamable HTTP via agents/mcp)
              ▼
        OAuthProvider (validates JWT)
              │  populates props.{workspace_id, user_id}
              ▼
        EngramMcp DO  ─── registerTools(server, () => this.props, this.env)
              │
              │  await handler(args, extra)  // SDK auto-validated args via inputSchema.shape
              ▼
       ┌──────────────────────────────────────────────┐
       │ Phase 4 handler body (per tool)              │
       │ 1. const props = getProps();                 │
       │    if (props === undefined) throw McpError(  │
       │      InvalidRequest, "Missing auth context"  │
       │    )                                         │
       │ 2. try {                                     │
       │ 3.   const stub = await getAgentByName(      │
       │        env.WORKSPACE,                        │
       │        props.workspace_id  // JWT-derived    │
       │      );                                      │
       │ 4.   const result = stub.<typedSyncMethod>({ │
       │        workspace_id: props.workspace_id,     │
       │        ...derivedArgs                        │
       │      }); // SYNC call across RPC layer       │
       │ 5.   const envelope =                        │
       │        envelope.build<Tool>Response(result); │
       │ 6.   return trimToBudget(envelope);          │
       │ 7. } catch (err) {                           │
       │      throw mapToMcpError(err);  // funnel    │
       │    }                                         │
       └──────────────────────────────────────────────┘
              │
              │  RPC over DO transport (marshalled by Cloudflare runtime)
              ▼
        WorkspaceDO instance
              │  assertOwnsWorkspace(args.workspace_id) ← hard backstop
              │  └── throws McpError(InvalidRequest) on mismatch (STO-07)
              │  └── pass-through unchanged by mapToMcpError (instanceof guard)
              ▼
        SQLite (storage.sql.exec)
```

### Recommended Project Structure

```text
packages/mcp-server/src/
├── index.ts                # UNCHANGED — EngramMcp class + OAuthProvider wiring
├── oauth.ts                # UNCHANGED — defaultHandler, /authorize, /, /health
├── schemas.ts              # DIFF: add verbosity to RecallInputSchema; tighten limits to ≤25 (D-03, D-10)
├── error-mapping.ts        # UNCHANGED — mapToMcpError
├── tools.ts                # BODY DIFF: 5 callback bodies swap; registrations stable
├── envelope.ts             # NEW — buildRememberResponse / buildRecallResponse / ... + trimToBudget
├── result-types.ts         # NEW (optional) — RecallResult, RememberResult, ChunkExcerpt types
└── __tests__/
    ├── tools.test.ts                    # EXTEND — happy-path callback assertions per tool
    ├── tools-integration.test.ts        # NEW — remember→recall→forget round-trip (TOL-04)
    ├── cross-workspace-pentest.test.ts  # NEW — TOL-07 (forged props.workspace_id)
    ├── token-budget.test.ts             # NEW — MCP-08 worst-case fixture
    ├── envelope.test.ts                 # NEW — honest-stub semantics per builder
    └── ... (existing index/oauth/schemas/error-mapping tests stay)
```

Optional: `scripts/smoke-job-agent.mjs` (TOL-08 local smoke) — node script that talks to `wrangler dev` over MCP-remote.

### Pattern 1: Thin Handler + Envelope Builder

**What:** Each of the 5 handler bodies is 6–8 lines. The shape never changes; only the typed method call and the envelope builder differ.

**When to use:** Every Phase 4 handler.

**Example (canonical — `remember`):**

```typescript
// packages/mcp-server/src/tools.ts (Phase 4 replacement for the MethodNotFound stub)
// Source: tools.ts:131-149 (Phase-4-ready skeleton commented in source).
import { getAgentByName } from "agents";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { mapToMcpError } from "./error-mapping.js";
import { buildRememberResponse } from "./envelope.js";

// inside registerTools(server, getProps, env):
server.registerTool("remember", { description: "...", inputSchema: RememberInputSchema.shape }, async (args) => {
  const props = getProps();
  if (props === undefined) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context");
  }
  try {
    const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
    const id = crypto.randomUUID();
    const now = Date.now();
    const block: Memory = {
      id,
      type: args.type ?? "research_note",  // pass-through; classified_type echoes args.type below
      content: args.content,
      summary: null, properties: null, embedding_id: null,
      scope: "personal", project_id: args.project ?? null,
      source: args.source ?? "mcp:claude",
      confidence: null,
      created_at: now, updated_at: now,
    };
    stub.insertBlock({ workspace_id: props.workspace_id, block });  // SYNC RPC call (await NOT needed)
    const envelope = buildRememberResponse({ id, classified_type: args.type ?? null });
    return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
  } catch (err) {
    throw mapToMcpError(err);
  }
});
```

### Pattern 2: Honest-Stub Envelope Builder

**What:** Single source of truth for the D-04 + D-06 + D-07 + D-08 contracts. Builder function per tool; gaps strings frozen as a `const` in `envelope.ts` (so MCP-08 fixtures can reproduce exact byte counts per D-10 paragraph 3).

**When to use:** Inside every Phase 4 handler — handlers never construct `EngramResponse` literals inline.

**Example:**

```typescript
// packages/mcp-server/src/envelope.ts (NEW)
// Source: spike-findings-engram §"meta.gaps is the load-bearing recovery hint"
import type { EngramResponse, Memory, Entity, Conflict } from "@engram/types";
import type { LexicalSearchHit } from "@engram/workspace-do";

export const META_GAPS = {
  remember: [
    "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
    "Conflict detection lands in Phase 5 (semantic similarity via Vectorize).",
  ],
  recall: [
    "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only.",
  ],
  search: [
    "Lexical (LIKE) backing — semantic search lands in Phase 5.",
  ],
  ingest: [
    "Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed.",
  ],
  forget: [],  // forget is fully implemented in v0.1 (D-04 carveout — cascade is real)
} as const;

interface RememberResult {
  id: string;
  classified_type: string | null;
  extracted_fields: Record<string, unknown>;  // {} in v0.1
  confidence: number | null;                  // null in v0.1
}

export function buildRememberResponse(result: { id: string; classified_type: string | null }): EngramResponse<RememberResult> {
  return {
    result: {
      id: result.id,
      classified_type: result.classified_type,
      extracted_fields: {},        // D-06 — Phase 5 / AI-05 populates
      confidence: null,            // D-06 — no AI ran
    },
    context: {
      related: [],
      entities: [],
      conflicts: [],               // D-08 empty contract — no false positives
    },
    meta: {
      confidence: null as unknown as number,  // see "exactOptionalPropertyTypes" note below
      coverage: null as unknown as number,
      last_updated: Date.now(),
      gaps: [...META_GAPS.remember],
    },
    // suggestions: undefined — D-04 honest-stubs leaves this absent (not present-with-undefined)
  };
}

// Similar builders: buildRecallResponse, buildSearchResponse, buildForgetResponse, buildIngestResponse.
```

### Pattern 3: Post-Trim Algorithm (MCP-08 / D-10)

**What:** Token-count the serialized envelope; if over budget, drop content → drop summary → drop trailing memories, re-tokenize after each step.

**When to use:** Inside `envelope.ts.trimToBudget(envelope)` called from every handler's return path.

**Example:**

```typescript
// packages/mcp-server/src/envelope.ts
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
// cl100k_base is the GPT-4 BPE; closer to Claude than o200k_base AND has the
// smaller bundle (~50KB encoding table). Pure JS, no WASM, no node:*.

const BUDGET = 7500;  // safety margin under 8K cap (MCP-08)

export function trimToBudget<T>(envelope: EngramResponse<T>): EngramResponse<T> {
  if (countTokens(envelope) <= BUDGET) return envelope;

  // Step 1: drop content from result.memories[i] (recall/search only — guarded by type test)
  const e1 = dropMemoryField(envelope, "content");
  if (countTokens(e1) <= BUDGET) return e1;

  // Step 2: drop summary
  const e2 = dropMemoryField(e1, "summary");
  if (countTokens(e2) <= BUDGET) return e2;

  // Step 3: drop trailing memories until under budget
  let e3 = e2;
  while (countTokens(e3) > BUDGET && hasMemories(e3) && memoryCount(e3) > 1) {
    e3 = dropLastMemory(e3);
  }
  // INVARIANT: never drop meta, never drop context.conflicts, never drop result.id on remember.
  return e3;
}

function countTokens(env: unknown): number {
  return encode(JSON.stringify(env)).length;
}
```

**Worst case sanity check (from D-10 + skill findings):** 25 memories × ~400 tokens/hit (4KB content + 1KB summary + metadata) ≈ 10K tokens raw. Trim step 1 (drop content) saves ~80% of memory size → ~2.5K post-trim. Envelope overhead (`context`, `meta.gaps`, `suggestions`) ≈ 400 tokens. Total well under 7,500. **The 25-cap (D-10 schema-level) and the post-trim algorithm are double protection — trim should rarely fire in practice.**

### Pattern 4: Two-Workspace Test Harness (TOL-07)

**What:** Use `@cloudflare/vitest-pool-workers` to spin up two different DO instance names (`workspace_A`, `workspace_B`) addressing the SAME `WorkspaceDO` class, then invoke a tool handler with a **forged `props` object** carrying `workspace_id: workspace_B` while addressing `workspace_A`'s DO — assert `assertOwnsWorkspace` fires.

**When to use:** Once, in `cross-workspace-pentest.test.ts`.

**Example:**

```typescript
// packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts (NEW)
// Source: vitest-pool-workers types verified at
//   node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts:24-45
import { describe, it, expect } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "../tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";

it("TOL-07: cross-workspace forgery — props.workspace_id=B addressing DO of A throws InvalidRequest", async () => {
  // 1. Seed memory in workspace_A via the legitimate path.
  const stubA = env.WORKSPACE.get(env.WORKSPACE.idFromName("workspace_A"));
  await runInDurableObject(stubA, (instance) => {
    instance.insertBlock({
      workspace_id: "workspace_A",
      block: { /* ...minimal Memory... */ } as Memory,
    });
  });

  // 2. Simulate a Phase 4 handler call with forged props.
  //    We don't invoke the MCP transport; we capture the registered callback
  //    via the McpServer spy (mirrors tools.test.ts:60-79 pattern) and invoke
  //    it directly with a `getProps` returning the WRONG workspace_id.
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  const server = new McpServer({ name: "pentest", version: "0.0.1" });
  registerTools(server, () => ({ workspace_id: "workspace_B", user_id: "u" }), env as unknown as Env);
  const recallCall = spy.mock.calls.find(([name]) => name === "recall");
  const recallCallback = recallCall![2] as (args: unknown, extra: unknown) => Promise<unknown>;
  spy.mockRestore();

  // 3. Crucially: the handler will derive `getAgentByName(env.WORKSPACE, "workspace_B")`
  //    — which returns a DO stub for the wrong instance. Tool args do NOT carry
  //    workspace_id (defense-in-depth invariant); the read happens against
  //    DO_B (empty) not DO_A (seeded), so this test alone proves isolation by data absence.
  //    To prove the ACTIVE assertOwnsWorkspace pathway fires, swap to a direct DO call:

  // 4. Active assertion: take stubA, force a method call with workspace_id="workspace_B".
  //    assertOwnsWorkspace (workspace-do/src/index.ts:139-146) MUST throw McpError(InvalidRequest).
  await expect(runInDurableObject(stubA, (instance) => {
    return instance.lexicalSearchBlocks({ workspace_id: "workspace_B", query: "anything" });
  })).rejects.toMatchObject({ code: ErrorCode.InvalidRequest });
});
```

The two-pronged proof is intentional: (a) the handler's `getAgentByName(env.WORKSPACE, props.workspace_id)` ALONE prevents cross-workspace reads because it routes to a different DO instance (so data isolation holds even if `assertOwnsWorkspace` didn't exist) — that's the route-by-DO-id check. (b) The direct-DO-call test PROVES `assertOwnsWorkspace` fires for any caller that bypasses the handler and forges the workspace_id arg. Both must pass.

### Anti-Patterns to Avoid

- **Inline envelope literals in handler bodies.** Centralize in `envelope.ts` — the D-04 grep audit ("show me every place we ship a null synthesis") becomes a one-file scan.
- **Heuristic synthesis strings.** Locked rejection per D-04 and spike-findings-engram `§"What to Avoid"`. `null` is the honest contract; templated strings would mislead Claude.
- **`await stub.<method>(...)`** when the typed method is sync. The DO RPC layer auto-marshals — `await getAgentByName(...)` once, then call methods synchronously. Phase 3 RESEARCH Pitfall 1 documents this; tools.ts:140 comments reinforce it.
- **Reading `args.workspace_id`** in any handler — Phase 3's `tools.test.ts:178-191` structural test fails CI immediately. Always derive from `props.workspace_id` (JWT-derived). The DD-RT sentinel comment at `tools.ts:109` must survive every Phase 4 edit.
- **Calling `.parse(args)` inside handlers.** The MCP SDK auto-validates via `inputSchema.shape` BEFORE the callback runs — `tools.ts:11-14` comment block documents the verified path. Double-parsing is wasted CPU.
- **Wrapping the cascade in `ctx.storage.transactionSync()`** to make `forget(cascade=true)` atomic across both DELETEs. Phase 2 RESEARCH explicitly accepted "atomic individually, NOT atomic as a pair" at v0.1 scale (`queries.ts:78-81`). Wrapping would require pushing the helper into a DO method, complicating Phase 5's Vectorize-cascade extension. **Revisit only if an invariant violation surfaces post-deploy.**
- **`ctx.waitUntil(env.INGEST_QUEUE.send(...))`** in `ingest()` — Phase 6 territory (D-05). Phase 4 ships synthetic `{ status: "accepted", job_id: <UUID> }` with `meta.gaps: ["Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."]`. The Phase 6 diff is ONE LINE inside the existing handler body.
- **`Buffer.byteLength(description, 'utf8')`** for MCP-08 tool-description size enforcement. `Buffer` is a `node:` API; workerd has `nodejs_compat` enabled, but `new TextEncoder().encode(description).byteLength` is the platform-native equivalent and matches the existing repo posture (no `Buffer.*` in `packages/mcp-server/src/`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Char-count / word-count heuristic | `gpt-tokenizer` `encode(JSON.stringify(env)).length` | BPE tokens are sub-word units; char/word counts under-estimate by 20–40% on JSON keys with quotes. Locked by D-09. |
| Envelope construction | Per-handler literal builders | Shared `envelope.ts` with frozen `META_GAPS` const | D-04 honest-stubs must be byte-deterministic for MCP-08 fixtures |
| JSON-RPC error envelope | `{ error: "..." }` ad-hoc | `throw new McpError(ErrorCode.X, ...)` | MCP-07 + spike-findings — Claude reads ad-hoc envelopes as DATA, not errors |
| Cascade delete | New `transactionSync()` wrap | Phase 2's `deleteBlock(cascade=true)` as-is | D-04 (CONTEXT.md Claude's Discretion); Phase 2 already accepted "atomic individually" |
| Conflict detection (v0.1) | Lexical overlap heuristic | Empty array + `meta.gaps` note | D-08 — zero false positives is better than approximate ones |
| MCP `synthesis` string (v0.1) | Templated "Found N matches for X" | `null` + `meta.gaps` note | D-04 — honest stubs, spike-findings confirms heuristic mislead is real |
| Cross-workspace JWT enforcement | Worker-layer check + skip DO check | Always pass `props.workspace_id`; trust DO `assertOwnsWorkspace` | Defense-in-depth — MT-1 / STO-07 is the hard backstop |

**Key insight:** Every column-2 hand-roll is something the user/Claude could have wanted to do "for performance" or "for v0.1 simplicity" — every one is rejected because the column-4 reason has bitten this project class before. The Phase 4 mission is "ship the contract Phase 5 inherits, NOT the implementation Phase 5 replaces." That mission is the single most load-bearing sentence in `04-CONTEXT.md`.

## Common Pitfalls

### Pitfall 1: `await getAgentByName(...)` then awaiting the method too

**What goes wrong:** A handler does `const stub = await getAgentByName(env.WORKSPACE, id); await stub.insertBlock({...})` — the second `await` adds no value (the typed method is sync at the call site), but it doesn't BREAK anything. The pitfall is the inverse: forgetting the FIRST `await` (`getAgentByName` returns `Promise<DurableObjectStub<T>>` per `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts:3950-3954` — call .method on the Promise itself and TS catches it; runtime catches it as "stub.insertBlock is not a function").

**Why it happens:** `getAgentByName` LOOKS like a sync namespace lookup (it's an Agents-SDK helper, not a DO native API); the `Promise` wrapper is a v0.13.x convention because the helper handles in-flight session-state coordination. Phase 3 RESEARCH Pitfall 1 documented this.

**How to avoid:** Code review rule — every handler MUST contain exactly ONE `await` and it MUST be on `getAgentByName(...)`. If a handler has zero `await`s, the stub is wrong. If it has two, the second is wasted. The DO RPC layer marshals the sync method calls automatically.

**Warning signs:** Type error `Property 'insertBlock' does not exist on type 'Promise<DurableObjectStub<...>>'` — that's the first-await-missing case.

### Pitfall 2: `exactOptionalPropertyTypes` rejection on `meta.confidence: null`

**What goes wrong:** `EngramResponse.meta.confidence: number` (NOT `number | null`) — see `shared/types/src/index.ts:213-216`. The CONTEXT D-06 says "`meta.confidence` = `null`". TypeScript with `exactOptionalPropertyTypes: true` (Phase 1 D-08) will REJECT assigning `null` to a non-nullable `number`.

**Why it happens:** The original `shared/types` definition was authored when "null = honest stub" wasn't yet a contract. Spike findings + D-04 then mandated null semantics, but the type wasn't widened.

**How to avoid:** Widen `EngramResponse.meta.confidence: number | null` and `meta.coverage: number | null` in `shared/types/src/index.ts` as part of Phase 4's Wave 0 / first commit. This is a `shared/types` change that ripples to every package — but it's safe because `meta` is only consumed by MCP clients (which are tolerant) and the triage-worker (which doesn't read meta yet). The alternative — `null as unknown as number` casts everywhere — is worse: defeats type safety and signals "we know this is wrong but…" which is exactly the smell Phase 4 is preventing.

**Warning signs:** `TS2375: Type '{ confidence: null; ... }' is not assignable to type ... with 'exactOptionalPropertyTypes: true'`. Don't suppress — widen the type.

### Pitfall 3: `JSON.stringify` and `Date` / `Map` / `BigInt` landmines in the envelope

**What goes wrong:** If any handler constructs the envelope with a `Date` object, a `Map`, a `Set`, or a `BigInt`, the `JSON.stringify(envelope)` step in `trimToBudget` either drops the field silently (`Map`/`Set`) or throws (`BigInt`). The MCP transport ultimately runs `JSON.stringify` too, so the issue could surface only in production.

**Why it happens:** Russell's job-search agent (TOL-08) might send a `Date` somewhere; if a handler passed `Date.now()` (number — fine) vs `new Date()` (Date object — JSON.stringify drops the prototype, keeps the ISO string), it's not deterministic.

**How to avoid:** Envelope builder functions accept ONLY primitive types (number, string, boolean, null, plain objects, arrays). Timestamps are `number` (`Date.now()`). The TypeScript types already enforce this via `EngramResponse.meta.last_updated: number` — but a runtime smoke is cheap: add an `envelope.test.ts` assertion `JSON.stringify(buildXResponse(...))` is round-trip stable.

**Warning signs:** Field disappears from MCP Inspector output. Or `TypeError: Do not know how to serialize a BigInt`.

### Pitfall 4: Cascade rowsWritten + `forget` round-trip

**What goes wrong:** `deleteBlock` returns `{ blocks_deleted, relations_deleted }` (`queries.ts:420-433`). The TOL-04 round-trip test (`remember → forget → recall returns zero matches`) is the contract surface. A handler that ignores the return value and lies in the envelope (`result: { deleted: 1 }` when `blocks_deleted: 0` because the id didn't exist) violates the contract silently.

**Why it happens:** Lazy handler implementation. Phase 2's helper returns the right info; just pass it through.

**How to avoid:** `forget()` envelope shape MUST include `result.blocks_deleted` and `result.relations_deleted` (mirroring the helper). When the id doesn't exist, `blocks_deleted: 0` and the helper does NOT throw `NotFoundError` (it's a list-style delete by id, not a single-row read). Decide explicitly during plan: do we throw `NotFoundError` (which → InvalidParams via mapToMcpError) when blocks_deleted=0, or do we return success with `blocks_deleted: 0`? **Recommendation:** echo `blocks_deleted: 0` without throwing — matches Phase 2 helper behavior, gives MCP clients the truth, makes integration tests cleaner. Document in PLAN.md.

**Warning signs:** TOL-04 integration test passes `remember → forget → recall=0` but `remember → forget(bogus_id) → ...` either crashes or silently returns success.

### Pitfall 5: `crypto.randomUUID()` in workerd

**What goes wrong:** `remember()` and `ingest()` both need a real UUID (D-05, D-06). `crypto.randomUUID()` is available in workerd via Web Crypto API — no import needed. The pitfall is using `import { randomUUID } from "node:crypto"` instead, which works under `nodejs_compat` but is the wrong idiom for Cloudflare Workers and could mask future workerd changes.

**Why it happens:** TS autocomplete suggests both; `node:crypto` is more familiar from server-side JS habits.

**How to avoid:** Always use `crypto.randomUUID()` (global). No imports needed. The `workerd` runtime provides it.

**Warning signs:** Extra `import { randomUUID } from "node:crypto"` showing up in a handler file. Project-wide grep should never match `from "node:crypto"` in `packages/mcp-server/src/`.

### Pitfall 6: `gpt-tokenizer` default export uses `o200k_base` — bundle size

**What goes wrong:** `import { encode } from "gpt-tokenizer"` loads the o200k_base encoding (GPT-4o). The package's unpacked size is ~50MB across all encodings (`dist.unpackedSize = 53MB` per `npm view`), but each encoding has its own ~50–200KB BPE table. Wrangler bundles only what's imported, but importing the barrel pulls more than needed.

**Why it happens:** Default convenience.

**How to avoid:** Import the specific encoding: `import { encode } from "gpt-tokenizer/encoding/cl100k_base"`. `cl100k_base` (GPT-3.5/4) is closer to Claude than `o200k_base` (GPT-4o) — the D-09 "over-counting is intentional safety margin" calculus is stable under cl100k_base.

**Warning signs:** `wrangler dev --dry-run` shows the bundle size jumping by >500KB after the gpt-tokenizer import lands.

### Pitfall 7: MCP tool response `content` shape

**What goes wrong:** The MCP SDK expects tool responses in the shape `{ content: [{ type: "text", text: string }] }` — not the raw `EngramResponse<T>` object. Some handlers might return the envelope directly, which serializes wrong and breaks MCP Inspector.

**Why it happens:** TypeScript autocomplete via `registerTool` shows `Promise<CallToolResult>` but doesn't enforce the inner shape.

**How to avoid:** Every handler's `return` is `{ content: [{ type: "text", text: JSON.stringify(envelope) }] }`. The `envelope` itself is the EngramResponse — the wrapper is the MCP transport layer. Add a single helper `wrapMcpContent(envelope)` in `envelope.ts` so every handler is symmetric.

**Warning signs:** MCP Inspector shows `[object Object]` or empty response body.

## Code Examples

Verified patterns from existing source:

### Example A: handler skeleton (from `tools.ts:131-149`)

```typescript
// Source: packages/mcp-server/src/tools.ts:131-149 (canonical Phase-4-ready comment block)
async (args, _extra) => {
  const props = getProps();
  if (props === undefined) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Missing authentication context",
    );
  }
  try {
    const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
    stub.insertBlock({
      workspace_id: props.workspace_id,  // ALWAYS from props
      block: { /* ...derived from args... */ },
    });
    return { content: [{ type: "text", text: "..." }] };
  } catch (err) {
    throw mapToMcpError(err);
  }
}
```

### Example B: WorkspaceDO method surface (from `packages/workspace-do/src/index.ts:163-206`)

```typescript
// All 4 methods Phase 4 calls. Each prepends assertOwnsWorkspace(args.workspace_id).
insertBlock(args: { workspace_id: string; block: Memory }): void
lexicalSearchBlocks(args: { workspace_id: string; query: string; limit?: number }): LexicalSearchHit[]
deleteBlock(args: { workspace_id: string; id: string; cascade?: boolean }): { blocks_deleted: number; relations_deleted: number }
// (getBlock is available but Phase 4's tool surface does not call it — `forget` doesn't need a pre-read)
```

### Example C: ErrorCode enum (from `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:257-266`)

```typescript
export declare enum ErrorCode {
  ConnectionClosed = -32000,
  RequestTimeout = -32001,
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,    // Phase 3 stubs use this; Phase 4 retires from production
  InvalidParams = -32602,     // NotFoundError → here (Phase 3 D-09)
  InternalError = -32603,     // Unknown errors → here (sanitized message)
  UrlElicitationRequired = -32042
}
```

### Example D: `McpError` shape (from `types.d.ts:7924-7932`)

```typescript
export declare class McpError extends Error {
    readonly code: number;
    readonly data?: unknown;
    constructor(code: number, message: string, data?: unknown);
    static fromError(code: number, message: string, data?: unknown): McpError;
}
```

`McpError.data` is `unknown` and serializes via the JSON-RPC error response schema (`types.d.ts:273-278`: `data: z.ZodOptional<z.ZodUnknown>`). Round-trips cleanly through `agents/mcp` McpAgent.serve — verified by Phase 3's existing tests passing.

### Example E: `runInDurableObject` signature (from `@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts:24-30`)

```typescript
export function runInDurableObject<
  O extends DurableObject | Rpc.DurableObject,
  R,
>(
  stub: DurableObjectStub<O>,
  callback: (instance: O, state: DurableObjectState) => R | Promise<R>
): Promise<R>;
```

This is the entry point for TOL-07: spin up two DO instances by name (`env.WORKSPACE.idFromName("workspace_A")` / `"workspace_B"`), invoke methods on them in the test runtime. The two-workspace test pattern lives at `node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts:24-77`.

## Runtime State Inventory

> Not applicable. Phase 4 is greenfield handler-body implementation — no rename, no refactor, no string replacement, no migration. CONTEXT.md confirms this is a "body diff" against Phase 3 stubs.

**Nothing found in category:** All five categories are empty by design — Phase 4 only adds new code paths.

## Open Questions

1. **`forget(bogus_id)` semantics — throw or echo zero?**
   - What we know: `deleteBlock(sql, id)` does NOT throw `NotFoundError` when the id doesn't exist; it returns `{blocks_deleted: 0, relations_deleted: 0}` (`queries.ts:420-433`).
   - What's unclear: should the handler synthetically throw `NotFoundError` when `blocks_deleted === 0` to match the "single-row" semantics of other tools? Or echo the truth?
   - Recommendation: **echo the truth.** `forget` is idempotent; clients calling `forget("nonexistent-id")` getting `result: { blocks_deleted: 0, relations_deleted: 0 }` is more useful than an InvalidParams error. Confirm during plan-phase.

2. **`EngramResponse.meta.confidence/coverage` type widening — Phase 4 or Wave 0?**
   - What we know: `shared/types/src/index.ts:213-222` declares both as `number` (non-nullable). D-06/D-07 require `null` for v0.1.
   - What's unclear: do we widen the type in `shared/types` (ripple to every consumer) OR layer the `| null` only in `envelope.ts` via local result types?
   - Recommendation: **widen in `shared/types`.** Phase 5 will populate with real numbers; the `| null` arm is permanent (covers any future "no AI ran" path like backwards-compatible migrations). Cleaner than per-package shims.

3. **`META_GAPS` final wording — locked at plan-phase or research?**
   - What we know: D-10 paragraph 3 says strings are FROZEN at v0.1 so MCP-08 token-budget tests can reproduce exact byte counts; planner picks final wording.
   - What's unclear: should this research suggest exact strings, or defer to planner?
   - Recommendation: this RESEARCH document suggests strings (see Pattern 2 `META_GAPS` const above, lifted from spike-findings-engram), but planner has final word. Planner SHOULD lock them in plan-phase (committed in `envelope.ts` const).

4. **TOL-08 LOCAL smoke client — `mcp-remote` bridge vs direct MCP client?**
   - What we know: CONTEXT.md "Claude's Discretion" suggests `scripts/smoke-job-agent.mjs` calling MCP over the OAuth bridge.
   - What's unclear: simplest path is probably to call `wrangler dev` directly with a hard-coded JWT bypassing OAuth — but that requires `oauth.ts` already-issued-token support OR a `--dev-token` flag. Alternative: `@modelcontextprotocol/sdk`'s `Client` + `StreamableHTTPClientTransport` pointed at `http://localhost:8787/mcp` with the OAuth provider's `/authorize` flow.
   - Recommendation: **MCP Inspector (`npx @modelcontextprotocol/inspector`) is the lowest-friction TOL-08 smoke** — Phase 3 already documented its use in DEP-05 README. The `scripts/smoke-job-agent.mjs` is over-engineering for v0.1; an Inspector smoke recorded as `04-MCP-INSPECTOR-SMOKE.md` (mirroring Phase 3's `03-MCP-INSPECTOR-SMOKE.md`) is sufficient. The "full reconfig of Russell's actual job-search agent" is DEP-04 in Phase 7, NOT here. Confirm during plan-phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `gpt-tokenizer` | MCP-08 token-budget test, post-trim algorithm | not installed yet | latest = 3.4.0 | none — must install |
| `@cloudflare/vitest-pool-workers` | TOL-07 + token-budget + integration tests | ✓ | 0.16.9 (installed) | — |
| `@modelcontextprotocol/sdk` | `McpError`, `ErrorCode`, `McpServer` types | ✓ | 1.29.0 (installed) | — |
| `agents` | `getAgentByName`, `McpAgent` | ✓ | 0.13.2 (installed) | — |
| `@modelcontextprotocol/inspector` (CLI) | TOL-08 smoke (optional) | available via `npx` | — | use MCP Inspector smoke pattern from Phase 3 |

**Missing dependencies with no fallback:** `gpt-tokenizer` — `npm install --workspace=@engram/mcp-server gpt-tokenizer` is a required Phase 4 install.

**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation = true in `.planning/config.json`. This section gives the Phase 4 planner everything it needs to lay out test infra in Wave 0.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.7 + `@cloudflare/vitest-pool-workers` 0.16.9 |
| Config file | `packages/mcp-server/vitest.config.ts` (existing) + `wrangler.test.jsonc` (existing) |
| Quick run command | `npm run test --workspace=@engram/mcp-server` |
| Full suite command | `npm run test --workspaces --if-present` (root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOL-01 | `remember()` writes block + returns EngramResponse with `id`, `classified_type`, empty `extracted_fields`, null `confidence`, empty `context.conflicts` | unit (envelope) + integration (DO) | `vitest run src/__tests__/tools-integration.test.ts -t remember` | ❌ Wave 0 |
| TOL-02 | `recall()` returns lexical hits + null `synthesis` + verbosity branches + `meta.gaps` + `meta.last_updated` populated | unit + integration | `vitest run -t recall` | ❌ Wave 0 |
| TOL-03 | `search()` accepts NO `format?` param + returns memories with structured filters + `result.count` | unit + integration | `vitest run -t search` | ❌ Wave 0 |
| TOL-04 | `remember → forget → recall=0` round-trip; `cascade=true` removes relations | integration | `vitest run -t "forget round-trip"` | ❌ Wave 0 |
| TOL-05 | `ingest()` returns `{status: "accepted", job_id: <UUID>}` envelope; no Queue send | unit | `vitest run -t ingest` | ❌ Wave 0 |
| TOL-06 | Every tool response has all envelope fields PRESENT (even if null/empty) | unit (envelope) | `vitest run src/__tests__/envelope.test.ts` | ❌ Wave 0 |
| TOL-07 | Cross-workspace forgery — `props.workspace_id=B` addressing DO of A throws `InvalidRequest` | integration | `vitest run src/__tests__/cross-workspace-pentest.test.ts` | ❌ Wave 0 |
| TOL-08 | Local smoke against `wrangler dev` via MCP Inspector or `scripts/smoke-job-agent.mjs` | manual + recorded artifact | `npx @modelcontextprotocol/inspector` | ❌ Wave 4 |
| MCP-07 | Bad input → `McpError(InvalidParams)`; missing auth → `McpError(InvalidRequest)`; unknown error → `McpError(InternalError)` with sanitized message | integration | `vitest run -t "McpError shape"` | ❌ Wave 0 (extend `error-mapping.test.ts`) |
| MCP-08 | Worst-case envelope post-trim ≤ 7,500 tokens; each tool description ≤ 1,500 bytes | unit | `vitest run src/__tests__/token-budget.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test --workspace=@engram/mcp-server` (~30 tests, <30 seconds — all in workerd pool)
- **Per wave merge:** `npm run test --workspaces --if-present` (all 4 packages, ~5–10s overhead from workspace-do + tests; ~60 tests total)
- **Phase gate:** Full suite green BEFORE `/gsd:verify-work`; MCP Inspector smoke recorded as artifact

### Wave 0 Gaps

- [ ] `packages/mcp-server/src/__tests__/envelope.test.ts` — covers TOL-06 (envelope shape per tool); reads `META_GAPS` const for byte-exact assertions
- [ ] `packages/mcp-server/src/__tests__/tools-integration.test.ts` — covers TOL-01/02/03/04/05 round-trips (remember → recall → forget end-to-end via `runInDurableObject` on `MCP_OBJECT` DO with manual `props` injection per Pattern 4)
- [ ] `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — covers TOL-07 (forged props.workspace_id, both data-isolation AND assertOwnsWorkspace paths)
- [ ] `packages/mcp-server/src/__tests__/token-budget.test.ts` — covers MCP-08 (worst-case fixture + post-trim assertion + tool-description size assertion via `new TextEncoder().encode(desc).byteLength`)
- [ ] Extension to `packages/mcp-server/src/__tests__/tools.test.ts` — happy-path callback assertions per tool (current file only tests `MethodNotFound` stubs; Wave 0 RED → Wave 2 GREEN)
- [ ] Extension to `packages/mcp-server/src/__tests__/error-mapping.test.ts` — assert `mapToMcpError(new NotFoundError("block", "x"))` returns `McpError(InvalidParams)`; assert `mapToMcpError(new Error("/Users/secret/path"))` sanitizes to `<path>` (regression locks for Phase 3 D-09 + threat model T-03-LEAK)
- [ ] Framework install: `npm install --workspace=@engram/mcp-server gpt-tokenizer` (required for token-budget test); planner inserts `checkpoint:human-verify` per Package Legitimacy Audit fallback

## Security Domain

> `security_enforcement` is implicitly enabled (config does not opt out). Phase 4 is the FIRST phase to ship behaviorally-verified workspace isolation (TOL-07) and the first to expose tool surfaces to a real MCP client.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | inherited | OAuth + JWT props (Phase 3 D-01/D-02); Phase 4 does not re-implement |
| V3 Session Management | inherited | EngramMcp DO + agents/mcp; Phase 4 does not re-implement |
| V4 Access Control | **yes** | `assertOwnsWorkspace` (STO-07) + handler-side `props.workspace_id` derivation (MCP-05) — defense-in-depth verified by TOL-07 |
| V5 Input Validation | **yes** | zod schemas (single source of truth); MCP SDK auto-validates BEFORE callback runs |
| V6 Cryptography | inherited | `crypto.randomUUID()` for `id` / `job_id` generation — Web Crypto, no hand-roll |
| V7 Error Handling | **yes** | `mapToMcpError` + `sanitize()` regex (Phase 3) — never leak stacks, paths, secrets |

### Known Threat Patterns for MCP + DO stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace data access (forged workspace_id) | Spoofing / Elevation of Privilege | Two-layer: (1) handler derives from JWT props, never tool input — `tools.ts:178-191` structural test; (2) DO `assertOwnsWorkspace` is the hard backstop. TOL-07 verifies BOTH paths |
| Information disclosure via error messages | Information Disclosure | `mapToMcpError` → `sanitize()` strips `/Users/...` paths + 32+ char hex (Phase 3 D-09); InternalError messages capped at 500 chars |
| Token-budget exhaustion (DoS via large response) | Denial of Service | Schema-level `limit ≤ 25` (D-10) + post-trim algorithm (D-10) + worst-case fixture in `token-budget.test.ts` |
| Tool-description verbosity attack (1.5KB cap) | Resource Exhaustion | `Buffer-free` per-registration size check at startup — assert `new TextEncoder().encode(description).byteLength ≤ 1500` |
| Heuristic synthesis poisoning | Tampering (downstream) | D-04 + spike-findings — null synthesis only; templated strings rejected. Phase 5's real synthesis ships with the AI-05 prompt's null-discipline locks (spike-findings §6) |
| Schema injection (caller adds `workspace_id` field) | Spoofing | `schemas.ts` structural invariant + `schemas.test.ts` asserts no field named `workspace_id` on any v0.1 schema |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `@modelcontextprotocol/sdk` HTTP transport | `agents/mcp` `McpAgent` + DO session class | Phase 3 (locked) | Workerd-compatible; no `node:http` dependency |
| One Vectorize index per workspace | One global index + namespace per workspace | Pre-Phase 5 design (research C5) | Required for 100-index-cap; Phase 4 not affected, Phase 5 implements |
| `tiktoken` (WASM) for token counting | `gpt-tokenizer` (pure JS, cl100k_base) | Phase 4 D-09 | No WASM cold-start cost; over-counts vs Claude → intentional safety margin |
| Heuristic `synthesis` strings | `null` synthesis + verbosity escape hatch | Spike-findings 2026-05-26 (BORDERLINE band) | Phase 5 populates; Phase 4 ships honest stubs |
| `limit: max(100)` on recall | `limit: max(25)` | Phase 4 D-10 | Aligns with 8K-token budget |

**Deprecated/outdated:**
- `synthesis = "synthesis"` default on `verbosity` — flipped to `"both"` per spike-findings (CONTEXT.md D-02 + skill §1)
- Phase 3's `MethodNotFound` stubs — retired from production by Phase 4 (test fixtures may keep `MethodNotFound` for negative-path coverage)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gpt-tokenizer@3.4.0` is the package being installed (not a typosquat) | Package Legitimacy Audit | Supply-chain risk; mitigated by planner inserting `checkpoint:human-verify` before install |
| A2 | `cl100k_base` is the right encoding (vs `o200k_base`) for Claude-margin approximation | Standard Stack Alternatives | Slightly tighter budget → minor; D-09's "over-counting is safety margin" stands either way |
| A3 | `crypto.randomUUID()` is available in workerd without import (Web Crypto API) | Pitfall 5 | Already verified by existing Phase 3 code paths; if wrong, fall back to `import { randomUUID } from "node:crypto"` (works under `nodejs_compat`) |
| A4 | `JSON.stringify(envelope).length / 4` is roughly the token count (back-of-envelope estimate) | Pattern 3 worst-case | Only affects 25-cap derivation; actual measurement in `token-budget.test.ts` is authoritative |
| A5 | `MCP_OBJECT` DO will accept `runInDurableObject` for setting props in tests | Pattern 4 | If `props` cannot be injected via `runInDurableObject`, alternative is the `McpServer.prototype.registerTool` spy pattern from `tools.test.ts:60-79` (proven Phase 3 pattern) |
| A6 | `EngramResponse.meta.confidence` should be widened to `number \| null` in `shared/types` | Open Question 2 | If rejected, fall back to local result types in `envelope.ts` with `| null` overlay; functional equivalence, less clean |

## Sources

### Primary (HIGH confidence)

- `node_modules/agents/dist/agent-tool-types-Dn9n-3SI.d.ts:3946-3954` — `getAgentByName` returns `Promise<DurableObjectStub<T>>` [VERIFIED]
- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:257-266` — `ErrorCode` enum values [VERIFIED]
- `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:7924-7932` — `McpError` shape with `data: unknown` [VERIFIED]
- `node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts:24-77` — `runInDurableObject` + `listDurableObjectIds` signatures [VERIFIED]
- `packages/mcp-server/src/tools.ts` — Phase-4-ready handler skeleton + DD-RT sentinel + 5 registrations [VERIFIED]
- `packages/mcp-server/src/schemas.ts` — 5 zod schemas (current shape) [VERIFIED]
- `packages/mcp-server/src/error-mapping.ts` — `mapToMcpError` + `sanitize` [VERIFIED]
- `packages/mcp-server/src/oauth.ts` — `EngramProps` source pathway (`this.props` from KV) [VERIFIED]
- `packages/mcp-server/src/index.ts:75-97` — `EngramMcp.init` calls `registerTools(server, () => this.props, this.env)` [VERIFIED]
- `packages/workspace-do/src/index.ts:163-206` — 4 typed sync DO methods Phase 4 calls [VERIFIED]
- `packages/workspace-do/src/queries.ts:78-81` — `deleteBlock` is "atomic individually, NOT atomic as a pair" [VERIFIED]
- `packages/workspace-do/src/errors.ts:29-37` — `NotFoundError` shape [VERIFIED]
- `shared/types/src/index.ts:190-238` — `EngramResponse<T>` contract [VERIFIED]
- `.claude/skills/spike-findings-engram/SKILL.md` — `verbosity` default flips to `"both"`; honest-stubs locked [VERIFIED]
- `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` — `META_GAPS` strings, ingest stub shape, anti-patterns [VERIFIED]
- `.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md` — confirms Phase 5 boundary (NOT Phase 4) [VERIFIED]
- `.planning/phases/04-core-tools-envelope/04-CONTEXT.md` — D-01..D-10 locked decisions [VERIFIED]
- `.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md` — Phase 2 sync helpers + STO-07 carry-forward [VERIFIED]
- `.planning/phases/03-mcp-server-scaffold/03-CONTEXT.md` — Phase 3 tools.ts skeleton + error-mapping + props wiring [VERIFIED]
- `npm view gpt-tokenizer version` → `3.4.0` [VERIFIED: npm registry]
- `npm view gpt-tokenizer scripts.postinstall` → empty [VERIFIED: no postinstall script]

### Secondary (MEDIUM confidence)

- [niieani/gpt-tokenizer README](https://github.com/niieani/gpt-tokenizer) — pure JS, no WASM, no `node:*` deps; `cl100k_base` import shape; isomorphic claims [CITED]
- [Cloudflare workerd README](https://github.com/cloudflare/workerd) — `nodejs_compat` provides `crypto`, `node:crypto`, etc. — but Web Crypto `crypto.randomUUID()` is platform-native [CITED]

### Tertiary (LOW confidence)

- None — every load-bearing claim is backed by a primary source.

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every package verified via installed typings or npm registry
- Architecture: **HIGH** — patterns derive from existing source comments (`tools.ts:131-149` canonical skeleton)
- Pitfalls: **HIGH** — every pitfall maps to a line-number in an existing file or a verified type
- Token-budget reasoning: **MEDIUM** — back-of-envelope math is approximate; authoritative measurement deferred to `token-budget.test.ts` at execution time
- TOL-07 pentest design: **MEDIUM** — the two-pronged proof (data isolation + active assertion) is sound; specific test runner shape needs plan-phase refinement
- TOL-08 smoke approach: **MEDIUM** — Recommendation prefers MCP Inspector pattern from Phase 3; planner has discretion to over-engineer to `scripts/smoke-job-agent.mjs` if value is clear

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30 days — stable APIs in pinned dep versions; `gpt-tokenizer` minor releases unlikely to affect token-count semantics)
