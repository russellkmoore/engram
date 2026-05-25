# Architecture Patterns

**Domain:** MCP-native second brain on Cloudflare (Workers + Durable Objects + Vectorize + Workers AI + Queues + R2 + KV)
**Researched:** 2026-05-24
**Mode:** ecosystem + validation of CLAUDE.md baseline
**Overall confidence:** HIGH (every architectural primitive validated against current Cloudflare + MCP docs via Context7)

---

## TL;DR — Validation Verdict

CLAUDE.md's architecture is **mostly right** and survives contact with current docs. The shape (DO-per-workspace + Queue-buffered ingest + Vectorize semantic layer + thin Worker router) matches the canonical Cloudflare pattern for stateful per-tenant AI agents.

**Five corrections / refinements** the roadmap should absorb (each detailed below):

1. **Use Cloudflare's `McpAgent` (from `agents/mcp`), not raw MCP SDK + custom transport.** It's purpose-built to host an MCP server inside a Durable Object. ~20 LOC for a working server. Skipping this means rebuilding Streamable HTTP transport, session management, and DO routing by hand.
2. **`McpAgent.serve()` defaults to one DO per session — WRONG for Engram.** A user opening Claude Desktop on laptop + phone must hit the same workspace. We must override the routing with `getAgentByName(env.WORKSPACE, workspaceId)` based on the JWT, not the session ID.
3. **Phase-1 "immediate" write should NOT go through Queue.** The MCP Worker should call the WorkspaceDO via RPC directly for the synchronous fast path, then `ctx.waitUntil(queue.send(...))` to fire-and-forget the deep-enrichment job. Round-tripping through Queue adds 100-500ms of unnecessary latency.
4. **Use ONE global Vectorize index with workspace_id metadata filter, not one index per workspace.** Vectorize caps you at 100 indexes per account — per-workspace doesn't scale past 100 workspaces. Namespaces (1000 per index) are the right unit for workspace isolation; metadata filtering handles project scope.
5. **Phase-3 cross-workspace work belongs in a Cron Worker, not a DO alarm.** DO alarms are local-to-an-object; cross-workspace entity resolution needs to scan multiple DOs and cannot live inside one of them.

For v0.1, **mostly defer corrections 4 and 5** — they're v0.2/v0.3 problems. Corrections 1, 2, and 3 must land in v0.1 because they shape the foundational code.

---

## v0.1 Component Map (Minimal Set)

**Day 1 packages (real code):**

| Package | Purpose | Why minimal |
|---|---|---|
| `shared/types` | `MemoryEvent`, `Memory`, `EngramResponse`, `Conflict`, `Entity` TS types | Both Worker and DO import these; cannot stub. |
| `shared/schema` | System memory type seed data (job_application, contact, etc.) as JSON | Loaded by DO on first init. |
| `packages/workspace-do` | `WorkspaceDO` class, SQLite schema, query helpers | Owns all per-workspace state. |
| `packages/mcp-server` | Worker with `McpAgent` subclass, JWT validation, RPC into WorkspaceDO | Single Worker; routes to DO via `getAgentByName`. |

**Day 1 stubs (skeleton only, real impl in v0.2):**

| Package | Stub-level scope | When real |
|---|---|---|
| `packages/triage-worker` | Queue consumer skeleton; logs each MemoryEvent and forwards to WorkspaceDO synchronously with no AI processing. | v0.2 (real chunking, embedding, scoring). |

**Day 1 deferred entirely (do not create the directory):**

- `packages/ingest-worker` — CLAUDE.md lists this separately, but in v0.1 the MCP server *is* the only ingest source. Adding a second Worker now is dead code. Merge back in v0.4 when connectors arrive.
- `packages/connector-slack`, `packages/connector-drive` — v0.4.

**v0.1 deliverable shape (5 components, 4 of which do real work):**

```
mcp-server Worker
    ├── extends McpAgent (Durable Object subclass, runs MCP server inside DO)
    ├── registers 5 tools: remember, recall, search, forget, ingest
    └── routes by workspace_id from JWT (one DO per workspace, NOT per session)
        │
        ├── RPC ────── WorkspaceDO (per workspace, SQLite-backed)
        │                  ├── blocks, relations, tags, members,
        │                  │    memory_types, inbox, conflicts tables
        │                  └── seeds system memory types on first init
        │
        └── ctx.waitUntil(queue.send(MemoryEvent)) — fire-and-forget deep enrichment
                                      │
                                      ↓
                              triage-worker (Queue consumer; v0.1 stub)
                                      │
                                      └── RPC ────── WorkspaceDO (deep-enrich same DO)
```

---

## Component-by-Component Boundaries

### `mcp-server` (Worker, extends McpAgent)

**Responsible for:**
- Receiving MCP Streamable HTTP requests from any AI client (Claude Desktop, Antigravity, etc.).
- Validating JWT, extracting `workspace_id` and `user_id` from claims → puts in `this.props` (McpAgent auth context).
- Hosting the 5 v0.1 tool handlers (`remember`, `recall`, `search`, `forget`, `ingest`).
- Routing every tool call into the correct `WorkspaceDO` via `getAgentByName(env.WORKSPACE, workspace_id).<rpc-method>(...)`.
- Wrapping every response in the `EngramResponse` envelope.
- For writes: `ctx.waitUntil(env.INGEST_QUEUE.send(...))` to enqueue deep enrichment without blocking the response.

**NOT responsible for:**
- SQL queries (those live in the DO).
- Embedding generation (that's the Triage Worker in v0.2; for v0.1 we synchronously embed inline using Workers AI from inside `remember()` because the data volume is one user).
- Chunking, entity extraction, dedup, conflict scoring (all triage worker, v0.2).
- Any state — the Worker is stateless across requests; all session/auth state is McpAgent's responsibility (held in its own per-session DO, separate from the workspace DO — see "DO Topology" below).

**v0.1 scope:** Wire 5 tools end-to-end with minimal AI; JWT for Russell only.
**v0.2 scope:** Wire `recall` to Vectorize; add query expansion; deepen `ingest`.
**v0.3 scope:** Multi-workspace routing (UserDO/TeamDO/ProjectDO resolution); add `reflect`, `relate`, `export`, `conflict` tools (4 more, total 9).

### `WorkspaceDO` (Durable Object, SQLite-backed)

**Responsible for:**
- Owning the workspace's SQLite database (`blocks`, `relations`, `tags`, `members`, `memory_types`, `inbox`, `conflicts`).
- All read/write queries against that database.
- Seeding the 7 system memory types on first construction (idempotent).
- Holding the source of truth for `memory_types` (schema-as-data) — readers always go through the DO, never inline TS schemas.
- Generating block IDs.
- Updating `vectorize` from the DO when an embedding is computed for a block (writes happen via env binding from inside the DO).

**NOT responsible for:**
- Authentication (Worker does this).
- Embedding generation (Triage Worker does this in v0.2; v0.1 may do it inline inside the DO using `env.AI` for simplicity given single-user volume).
- Cross-workspace queries (impossible — each DO is isolated by design).
- WebSocket sync — explicit anti-feature for v0.1.

**v0.1 scope:** Schema + queries for 5 tools, system type seeding, single-workspace.
**v0.2 scope:** Conflict detection (writes to `conflicts`), inbox writes, vector ID linkage.
**v0.3 scope:** Membership management, project_id scoping in queries, custom memory_types CRUD.

### `triage-worker` (Worker, Queue consumer)

**Responsible for (v0.2 onwards):**
- Consuming `MemoryEvent` batches from the `engram-ingest` queue.
- Phase 2 of progressive enrichment: chunking, embedding (Workers AI), entity extraction (Workers AI), memorability scoring, dedup check (Vectorize similarity), conflict detection.
- Writing enriched results back into the WorkspaceDO via RPC.
- Writing vectors to Vectorize.
- Sending derived events (e.g., detected conflicts) onto secondary queues (`engram-conflicts`) for follow-up.

**NOT responsible for:**
- The synchronous write path (that's the MCP server → WorkspaceDO direct RPC).
- Cron/scheduled work (separate Cron Worker for that).
- Sending responses to the user (it's async-after-response).

**v0.1 scope:** STUB — receives messages, logs them, no-ops. Proves the Queue plumbing.
**v0.2 scope:** Real pipeline — chunk, embed, score, dedup, store, conflict-detect.
**v0.3 scope:** Adds project-scope routing in writes; custom memory_type field validation.
**v0.4 scope:** Adds connector-sourced MemoryEvent handling (Slack/Drive batches).

### Vectorize (managed Cloudflare service, no package)

**Responsible for (v0.2 onwards):**
- Storing embeddings keyed by `block_id`.
- Returning ranked similarity matches for query vectors.
- Filtering by metadata (workspace_id, project_id, type) at query time.

**NOT responsible for:**
- Generating embeddings (Workers AI does that).
- Storing original content (DO SQLite does that).
- v0.1 — not used at all. `recall` in v0.1 should fall back to SQL `LIKE` search, returning a degraded but correct EngramResponse. This avoids blocking v0.1 on Vectorize wiring.

**v0.1 scope:** Bindings declared in `wrangler.toml` so the namespace exists, but no writes/reads. Alternative: skip the binding entirely until v0.2.
**v0.2 scope:** Single global index, namespace-per-workspace, metadata-indexed on `workspace_id`, `project_id`, `type`.
**v0.3+ scope:** Cross-workspace conflict scans (with caution — see Pitfalls below).

### Workers AI (managed Cloudflare service, no package)

**Responsible for:**
- v0.1: `@cf/baai/bge-small-en-v1.5` (384-dim) embeddings — optional if `recall` falls back to LIKE.
- v0.2: Add summarization (`@cf/meta/llama-3.1-8b-instruct` or similar), entity extraction (same), memorability scoring.

**NOT responsible for:**
- Any reasoning surfaced to the user (that's Claude's job via MCP response).
- Final ranking (Vectorize does similarity; CF AI does scoring).

**v0.1 scope:** Optional inline embedding inside `WorkspaceDO.remember()`. If skipped, push to v0.2.
**v0.2 scope:** All pipeline AI calls move to Triage Worker.

---

## DO Topology — Validated and Refined

### The CLAUDE.md proposal

```
UserDO → TeamDO → ProjectDO   (hierarchical; each is its own isolated DO instance)
```

### Validation verdict

**The topology is correct, but in v0.1 only `WorkspaceDO` exists.** UserDO is just a WorkspaceDO with `workspace_type='personal'`. TeamDO and ProjectDO are deferred to v0.3.

**For v0.1, collapse to ONE DO class:** `WorkspaceDO`. It takes a `workspace_id` and serves any of the three roles. Splitting the class hierarchy now (`UserDO`/`TeamDO`/`ProjectDO`) is premature — you'd write three almost-identical classes that diverge in v0.3 anyway, when the divergences are actually known.

### Trade-off table: how to scope state per workspace

| Pattern | Pros | Cons | Verdict for Engram |
|---|---|---|---|
| **One DO per workspace** (chosen) | Hard isolation, clean archive/delete, SQLite scales to 10GB/workspace, hibernates when idle (~free at rest), strong consistency within a workspace. | Cross-workspace queries are RPC-fanout (slow if many workspaces). One DO = one logical region for primary requests (latency varies for cross-region clients). | **Right choice.** Engram's design specifically does not need cross-workspace queries on the hot path; cross-workspace work is async via Vectorize global index. |
| Single DO with workspace partitioning (one big SQLite, `workspace_id` column on every table) | One place for ops; cross-workspace queries trivial. | Single DO is a single point of contention (one thread); 10GB shared cap; deleting a workspace is hard; security model relies on every query remembering the filter (one bug = cross-tenant leak). | Anti-pattern. Catastrophic at >1 active user. |
| D1 backing | SQL ergonomics + read replicas + larger storage. | No strong consistency guarantees across writes from concurrent Workers; no per-tenant isolation; schema migrations are global; sharding logic is your problem. | Wrong for stateful per-tenant. D1 is for the *registry* (which workspace exists, which user owns it) at v1.0, not the memory itself. |
| Worker-level dispatch with no DO (KV/R2 + something) | Cheapest, simplest. | No transactions, no query layer, no consistency. Building a vector-aware second brain on KV is rebuilding SQLite badly. | Anti-pattern for this domain. |

**Confidence:** HIGH. Cloudflare's own canonical examples for "multi-tenant AI agent with per-tenant memory" use exactly this pattern (`getAgentByName(env.AGENT, tenantId)` → DO with SQLite). The blog post "Zero-latency SQLite storage in every Durable Object" makes the per-tenant-DO pattern the recommended default.

### The McpAgent wrinkle (important)

`McpAgent.serve('/path')` creates **one DO per MCP session**, not per user. This is for stateful per-conversation context (e.g., a chat that remembers tool call results inside that one conversation). For Engram, where workspace memory must be shared across sessions, devices, and AI clients, the session-DO is the wrong scope.

**Solution:** Use `McpAgent` for the *server hosting* (transport, tool registration, session lifecycle) but have every tool handler delegate to a separate `WorkspaceDO` resolved by `workspace_id` from the JWT:

```typescript
// Conceptual — confirmed shape from Cloudflare Agents docs.
export class EngramMcp extends McpAgent<Env, {}, AuthContext> {
  server = new McpServer({ name: "engram", version: "0.1.0" })

  async init() {
    this.server.registerTool("remember", { ... }, async (args) => {
      const ws = await getAgentByName(this.env.WORKSPACE, this.props.workspace_id)
      const result = await ws.remember(args)
      // Fire-and-forget deep enrichment
      this.ctx.waitUntil(this.env.INGEST_QUEUE.send({ ... }))
      return envelope(result)
    })
    // ...other tools
  }
}
export default EngramMcp.serve("/mcp")
```

So there are **two DO classes per v0.1**: the McpAgent-managed session DO (transient per session, ~auto) and the `WorkspaceDO` (durable per workspace, owns the SQLite). The session DO holds nothing important; the WorkspaceDO is the actual memory store.

This split is not extra work — it's how the SDK already works. Adopting `McpAgent` means you get session transport + DO routing for free, and you only have to design your *own* WorkspaceDO class.

---

## MCP Server Hosting — Cleanest Path

### Recommended: `agents/mcp` SDK (Cloudflare)

```bash
npm install agents @modelcontextprotocol/sdk zod
```

```typescript
import { McpAgent } from "agents/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
```

**Why this over hand-rolling Streamable HTTP transport:**
- McpAgent handles session lifecycle, transport, SSE streaming, CORS, OAuth integration.
- Each session gets a DO automatically (you don't write the routing).
- Tools are registered declaratively with Zod schemas → MCP clients see them.
- `this.props` carries auth context populated by `withMcpAuth` middleware or an OAuth provider, so per-tool authorization is trivial.

**Reference repos:**
- `cloudflare/agents` (the SDK itself, with `examples/mcp/` showing the canonical pattern)
- `examples/mcp-rpc-transport` in that repo — shows multiple DO classes coexisting with cross-DO calls via `this.env`, which is exactly the McpAgent → WorkspaceDO shape we need.

### Worker → DO dispatch pattern

```typescript
// In a tool handler inside McpAgent
const stub = await getAgentByName(this.env.WORKSPACE, this.props.workspace_id)
const result = await stub.remember({ content, type, tags })
```

`getAgentByName` is Cloudflare's blessed routing helper — string name (workspace_id) deterministically maps to a stable DO instance. RPC method calls on the stub feel like ordinary async function calls (since the `rpc` compatibility flag landed in April 2024).

### `wrangler.toml` shape for v0.1

```toml
name = "engram-mcp"
main = "packages/mcp-server/src/index.ts"
compatibility_date = "2026-01-28"
compatibility_flags = ["nodejs_compat"]

[[durable_objects.bindings]]
name = "MCP_SESSION"      # used by McpAgent internally
class_name = "EngramMcp"

[[durable_objects.bindings]]
name = "WORKSPACE"        # our actual memory store
class_name = "WorkspaceDO"
script_name = "engram-mcp" # same script hosts both classes for v0.1

[[migrations]]
tag = "v1"
new_sqlite_classes = ["EngramMcp", "WorkspaceDO"]

[[queues.producers]]
binding = "INGEST_QUEUE"
queue = "engram-ingest"

[ai]
binding = "AI"

# Vectorize binding declared but unused in v0.1 (optional — can omit entirely)
# [[vectorize]]
# binding = "VECTORIZE"
# index_name = "engram-memories"
```

The `triage-worker` is a *separate* Worker (separate `wrangler.toml`) so its Queue consumer binding doesn't interfere with the MCP server. It needs a service binding to call into the WorkspaceDO (same `WORKSPACE` namespace).

**Confidence:** HIGH. Validated against Cloudflare Agents repo and Workers SDK docs.

---

## Data Flow Diagrams

### Synchronous MCP Tool Call (e.g., `remember`)

```
Claude Desktop
    │  HTTP POST /mcp (Streamable HTTP)
    │  Authorization: Bearer <JWT for workspace W>
    ↓
[Cloudflare edge → mcp-server Worker]
    │
    ├── McpAgent.serve("/") handles transport, parses MCP message
    ├── Session DO spins up (transient, McpAgent-managed)
    │
    │   Inside session DO, tool handler for "remember" runs:
    │     1. Validate JWT → workspace_id = "W", user_id = "U"
    │     2. const ws = await getAgentByName(env.WORKSPACE, "W")
    │     3. const block = await ws.remember({content, type, tags})
    │        ↓ RPC
    │        [WorkspaceDO "W"]
    │          - Insert into blocks (id, content, type=hint or "unclassified",
    │            properties, source="mcp:claude", confidence=null)
    │          - Optionally call env.AI for embedding inline (small batches OK)
    │          - Return {id, type, extracted_fields, confidence}
    │        ↑ RPC return
    │     4. ctx.waitUntil(env.INGEST_QUEUE.send({
    │          id, source: "mcp:claude", content, workspace_id: "W",
    │          timestamp: Date.now()
    │        }))  ← fire-and-forget; does not block response
    │     5. Wrap in EngramResponse envelope
    │
    ↓ Response (within ~100-300ms for tiny payloads, <500ms for moderate)
Claude Desktop renders the envelope
```

**Latency budget breakdown (estimate, conservative):**

| Step | Budget | Notes |
|---|---|---|
| Edge → Worker cold | 30-80ms | First request in region |
| McpAgent transport + session DO RPC | 10-30ms | Internal |
| Worker → WorkspaceDO RPC | 5-15ms | Both run in same region after warm-up |
| SQLite write | 1-5ms | Local to DO |
| Inline embedding (optional, v0.1) | 100-300ms | `bge-small-en-v1.5` is fast |
| Response serialization | 1-5ms | |
| **Total (no inline embedding)** | **~50-130ms** | |
| **Total (with inline embedding)** | **~150-430ms** | Within 500ms target |

**Decision for v0.1:** Embed inline inside `remember()` for the single-user case. When multi-user lands in v0.3 and Triage Worker is real, move embedding into the async phase.

### Async Ingest (deep enrichment, v0.2+)

```
[mcp-server Worker]
    │  ctx.waitUntil(env.INGEST_QUEUE.send(MemoryEvent))
    ↓
[Cloudflare Queues: engram-ingest]
    │  batches: max 10 messages or 5s timeout
    ↓
[triage-worker Worker, queue handler]
    │  for each MemoryEvent in batch:
    │    1. Re-fetch block from WorkspaceDO (ensures latest content/type)
    │    2. Chunk (semantic, 512 token, 50 overlap)
    │    3. env.AI.run("@cf/...", chunks)  ← parallel: embed + extract + summarize
    │    4. Score memorability (CF AI)
    │       > 0.8 → continue; 0.4–0.8 → write to inbox; < 0.4 → discard
    │    5. Vectorize.upsert(vectors)
    │    6. RPC → WorkspaceDO:
    │         - Update block (summary, properties, confidence, embedding_id)
    │         - Insert tags
    │         - Insert relations
    │         - Detect conflicts against related blocks (Vectorize neighbors)
    │           - If found, insert into conflicts table
    │           - ctx.waitUntil(env.CONFLICT_QUEUE.send(...))  ← phase 3
    │    7. ack message
    ↓
[engram-conflicts Queue, v0.3+]
    │  Cron Worker or Conflict Worker processes:
    │    - Cross-workspace entity dedup
    │    - Trend detection
    │    - Daily digest emails (v0.4)
```

**On phase 3 implementation:**

> CLAUDE.md asks: "DO alarm() for phase 3? Queue with delayed dispatch?"

**Verdict:** Neither — use a **separate Cron Worker** for phase 3.

- DO `alarm()` is local to one DO. Phase 3's job (cross-workspace entity resolution, trend detection across all users) needs to scan multiple DOs and the global Vectorize index. It does not "belong" to any single workspace DO.
- Queue delayed dispatch (Cloudflare Queues do support `delaySeconds`) is fine for "process this thing in N seconds" but not great for "every night at 3am, scan everything."
- A Cron Worker (scheduled handler with `wrangler.toml` `[triggers] crons = ["0 3 * * *"]`) is the natural fit for the phase-3 batch workload. It can enqueue per-workspace jobs onto the existing `engram-ingest` queue or a separate `engram-batch` queue.

**Use DO alarms for:** per-workspace scheduled work like "in 24h, expire memories with `expires` set" or "summarize today's activity for this workspace." These are workspace-local and benefit from being inside the DO that owns the data.

**Use Queue delayed dispatch for:** retries with backoff, "process this in 30s if no follow-up edit," debouncing.

**Use Cron Worker for:** cross-workspace, account-wide, or time-of-day work.

---

## Vectorize Strategy — Refined

### CLAUDE.md leaves this open. Three options:

| Strategy | Pros | Cons | Verdict |
|---|---|---|---|
| One index per workspace | Maximum isolation; simple mental model. | **Hard cap: 100 indexes per account.** Engram cannot grow past 100 workspaces. Also: index creation isn't instant; provisioning lag on workspace creation. | **Anti-pattern.** Kills the OSS managed-hosting business model. |
| One global index, **namespace per workspace + metadata filtering** | Scales to 1000 namespaces per index (per Vectorize limits); metadata filter on `workspace_id` is the natural unit; supports cross-workspace queries (v0.4 dedup, trend) by removing the filter. | One blast radius if index is corrupted; account-wide vector budget shared (200K vectors per index — re-shard later if needed). | **Right choice.** |
| Sharded (multiple indexes, hash(workspace_id) → index N) | Sidesteps 200K-per-index cap. | Complex; defeats easy cross-workspace queries; premature optimization for v0.1–v1.0. | Defer until you hit 150K vectors per shard. |

**Recommendation:** Single global index `engram-memories`, namespace = workspace_id, with **metadata indexes** on `workspace_id`, `project_id`, `type`, and `scope`. Workers query with:

```typescript
const matches = await env.VECTORIZE.query(queryVec, {
  topK: 20,
  filter: { workspace_id: ws, type: { $in: types } },
  returnMetadata: "indexed",
})
```

**Implication for v0.4 cross-workspace conflict detection:** Easy — query *without* the `workspace_id` filter (or scoped to the union of workspaces the user has access to). The Triage Worker can do this nightly via a Cron Worker.

**Note:** Metadata indexes must be created up-front via `wrangler vectorize create-metadata-index` and are capped at 10 indexed properties per index. Choose carefully.

**v0.1 decision:** Either declare the binding and a stub index but don't use it (call SQL `LIKE` for `recall` and `search`) OR skip Vectorize entirely in v0.1 and add it as the first thing in v0.2. Russell's call.

**Recommendation:** Skip Vectorize in v0.1. Reasons:
- Adds binding setup, index creation, embedding pipeline → all of which are real v0.2 work.
- `recall` over SQL `LIKE` works fine for one user with <1000 memories.
- Forces a clean v0.2 milestone with measurable "before/after" semantic vs. lexical.

**Confidence:** HIGH on the topology choice. MEDIUM on the v0.1 deferral — both options are defensible; deferral is the depth-over-speed move.

---

## Build-Order Dependencies (Critical Path for v0.1)

Read as: "X depends on Y because Z."

```
1. shared/types/MemoryEvent + Memory + EngramResponse
     └── nothing depends on; everything else imports these
     └── BLOCKS: tool stubs, DO interface, Queue payload
        ↓
2. shared/schema/system-types.ts
     └── depends on shared/types
     └── BLOCKS: WorkspaceDO init (which seeds them)
        ↓
3. WorkspaceDO class skeleton + SQLite schema + seed
     └── depends on (1) and (2)
     └── BLOCKS: tool RPC implementations, Queue consumer
        ↓
4. WorkspaceDO query helpers (insert block, search blocks, get block by id, etc.)
     └── depends on (3)
     └── BLOCKS: tool implementations
        ↓
5. wrangler.toml + DO migrations + Queue binding + AI binding
     └── depends on (3) for class names
     └── BLOCKS: any `wrangler dev` run
        ↓
6. JWT validation + auth context shape
     └── depends on (5) (env types)
     └── BLOCKS: tool handlers that need workspace_id
        ↓
7. mcp-server McpAgent subclass with empty tool stubs
     └── depends on (5), (6)
     └── BLOCKS: real tool wiring
        ↓
8. Tool implementations (remember, recall, search, forget, ingest)
     └── depend on (4), (7)
     └── Order within: remember → recall → search → forget → ingest
        (write before read; read before bulk; manipulation before fetch-and-store)
        ↓
9. EngramResponse envelope wrapper
     └── depends on (8)
     └── BLOCKS: all tool returns satisfying the contract
        ↓
10. triage-worker stub (Queue consumer that no-ops)
     └── depends on (1), (5)
     └── Validates Queue plumbing; not on the critical path for "does Claude see my memory back"
        ↓
11. End-to-end test: Russell adds a memory in Claude Desktop, opens new conversation, recalls it
     └── depends on (1–9)
     └── This is the v0.1 acceptance criterion
        ↓
12. Wrangler deploy + Claude Desktop config
     └── depends on all of the above passing locally
```

**Critical path = 1 → 2 → 3 → 4 → 5 → 7 → 8(remember) → 8(recall) → 9 → 11 → 12.** Everything else (triage stub, other tools) is parallelizable.

**Phase suggestion for the roadmapper (5 phases for v0.1):**

| Phase | Scope | Critical-path items | Ships when |
|---|---|---|---|
| P1: Foundation | Shared types, schema, monorepo layout, wrangler config | 1, 2, 5 | `wrangler dev` boots a no-op Worker |
| P2: WorkspaceDO | DO class, SQLite schema, seed, query helpers | 3, 4 | Vitest passes for DO query layer |
| P3: MCP server scaffold | McpAgent subclass, JWT, empty tool registrations | 6, 7 | Claude Desktop sees 5 tools listed |
| P4: Core tools | remember, recall (LIKE-based), search, forget, ingest + envelope | 8, 9 | Tools round-trip in Claude Desktop |
| P5: Async plumbing + deploy | Triage stub, Queue wiring, Vectorize binding placeholder (or omit), deploy | 10, 12 | Russell's agent uses it daily |

Phase 5 doubles as the "real-world test" phase — it's where the deploy lands and Russell flips his job-search agent over.

---

## Patterns to Follow

### Pattern 1: RPC over fetch for DO communication

**What:** Use the new `rpc` compat flag (default since 2024-04-03) and call DO methods as ordinary async functions instead of `await stub.fetch(...)`.

**When:** Always, for v0.1+. There's no reason to use the fetch idiom for internal Worker→DO communication.

**Example:**
```typescript
// Good (RPC)
const stub = await getAgentByName(env.WORKSPACE, wsId)
const result = await stub.remember(args)

// Bad (legacy fetch)
const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(wsId))
const resp = await stub.fetch("http://do/remember", { method: "POST", body: JSON.stringify(args) })
const result = await resp.json()
```

### Pattern 2: `ctx.waitUntil` for fire-and-forget enrichment

**What:** Return the synchronous response immediately; let async work continue using `ctx.waitUntil`.

**When:** Anywhere the user wants a fast acknowledgment but background processing is needed.

**Example:**
```typescript
async remember(args) {
  const block = await ws.remember(args)              // sync write
  this.ctx.waitUntil(
    this.env.INGEST_QUEUE.send({                    // async enrich
      id: block.id, source: "mcp:claude", ...
    })
  )
  return envelope(block)                            // immediate return
}
```

**Gotcha:** `waitUntil` has a 30s budget for the background work. For longer pipelines, the Queue handler picks up from there with its own (much longer) budget.

### Pattern 3: Schema-as-data lookup at DO boot

**What:** Don't import system memory types as TS constants. Seed them into SQLite on first DO construction, then read from SQL forever.

**When:** Every DO start (idempotent INSERT OR IGNORE).

**Example:**
```typescript
constructor(ctx, env) {
  super(ctx, env)
  this.sql = ctx.storage.sql
  this.initSchema()        // CREATE TABLE IF NOT EXISTS ...
  this.seedSystemTypes()   // INSERT OR IGNORE for each system type
}
```

This way `memory_types` is always populated and the same query path serves system, user, and community types.

### Pattern 4: McpAgent props as the auth/tenant boundary

**What:** Validate JWT once in a middleware, set `workspace_id`/`user_id` in `props`, and trust `this.props` inside tool handlers.

**When:** Every authenticated MCP request. The pattern composes cleanly with the Cloudflare Workers OAuth Provider for v1.0.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: One DO per MCP session (the default)

**What:** Letting `McpAgent.serve()` create a fresh DO for every MCP session.

**Why bad:** A user on laptop + phone + Antigravity would have three disconnected memory stores. Memories saved in one session wouldn't appear in another.

**Instead:** Use McpAgent only for transport; route every tool call into a *separate* `WorkspaceDO` resolved by `workspace_id` from JWT props.

### Anti-Pattern 2: Queue on the synchronous write path

**What:** MCP Worker → Queue → consumer → DO for every `remember()`.

**Why bad:** Adds 100-500ms of queue latency to writes the user is waiting on. `remember()` is a synchronous user action — they expect the response to confirm "yes, stored."

**Instead:** Direct RPC into WorkspaceDO for the canonical write; `ctx.waitUntil(queue.send(...))` for the enrichment job that follows.

### Anti-Pattern 3: One Vectorize index per workspace

**What:** Provisioning a fresh index on workspace creation.

**Why bad:** 100-index account cap; provisioning latency; index migrations become per-workspace.

**Instead:** Global index, namespace per workspace, metadata filter for queries.

### Anti-Pattern 4: Storing memory_types as TS classes

**What:** `class JobApplication extends Memory { ... }` and so on.

**Why bad:** Hardcodes schema in deploy artifact. Every new memory type = code change + deploy. Defeats v0.3 "users define custom types."

**Instead:** Validated by the SQLite `memory_types` row; validation logic reads field definitions from that row.

### Anti-Pattern 5: Hand-rolling MCP Streamable HTTP transport

**What:** Using the raw `@modelcontextprotocol/sdk` and building your own HTTP/SSE transport for Workers.

**Why bad:** ~500 LOC of boilerplate to get session lifecycle, SSE streaming, CORS, and auth right. Cloudflare's `McpAgent` already does all of this.

**Instead:** `extends McpAgent`, register tools, done.

### Anti-Pattern 6: Cross-DO transactions

**What:** "In one logical operation, write to WorkspaceDO A *and* WorkspaceDO B."

**Why bad:** Cloudflare DOs do not support cross-DO transactions. Each DO is a strong-consistency island.

**Instead:** Eventual consistency. For example, "promoting" a memory from a UserDO to a TeamDO is a copy + tombstone, mediated by the Worker (and reconciled async via Queue if it fails halfway).

---

## Local Testing Topology

| Component | Local emulation | How |
|---|---|---|
| Worker | `wrangler dev` (Miniflare v3, `workerd` runtime) | Same runtime as prod. Hot reload on save. |
| Durable Object + SQLite | Native in `wrangler dev` | Real `ctx.storage.sql`, persists across reloads in `.wrangler/state/v3/`. |
| Queues | Simulated in `wrangler dev` | Producer + consumer in same `wrangler dev` session, or pass `--config` for multiple Workers. |
| Workers AI | **Calls real CF API** | Local emulation falls back to remote in dev. Requires `CLOUDFLARE_ACCOUNT_ID` + auth. Mock in unit tests. |
| Vectorize | **No local emulation** | `wrangler dev` calls the real Vectorize index in your account. Use a dev-prefixed index name (`engram-memories-dev`). |
| KV/R2 | Local by default | Free in dev. |

### Concrete commands

```bash
# Boot mcp-server locally with all bindings simulated
cd packages/mcp-server
npx wrangler dev --local --persist-to .wrangler/state

# Run triage-worker in parallel (separate terminal, different port)
cd packages/triage-worker
npx wrangler dev --local --port 8788

# Better: from monorepo root, run both with one command
npx wrangler dev \
  --config packages/mcp-server/wrangler.toml \
  --config packages/triage-worker/wrangler.toml
```

### Unit testing

```bash
npm install -D vitest @cloudflare/vitest-pool-workers
```

`@cloudflare/vitest-pool-workers` runs tests inside `workerd`, giving real DO/SQLite/Queue access. This is the current recommended path (the older `unstable_dev` approach from `wrangler` is being deprecated in favor of the pool).

```typescript
// Example: testing WorkspaceDO query layer
import { env, runInDurableObject } from "cloudflare:test"

describe("WorkspaceDO", () => {
  it("seeds system memory types on first init", async () => {
    const id = env.WORKSPACE.idFromName("test-workspace")
    const stub = env.WORKSPACE.get(id)
    const types = await runInDurableObject(stub, async (instance) => {
      return instance.listMemoryTypes()
    })
    expect(types).toHaveLength(7) // 7 system types from CLAUDE.md
  })
})
```

### MCP client testing

For testing the MCP server end-to-end without going through Claude Desktop, use the **MCP Inspector** (`npx @modelcontextprotocol/inspector`). It connects to your local `wrangler dev` URL and lets you call tools interactively. Essential for P3/P4 of the v0.1 roadmap.

```bash
# Terminal 1
cd packages/mcp-server && npx wrangler dev

# Terminal 2
npx @modelcontextprotocol/inspector http://localhost:8787/mcp
```

**Confidence:** HIGH. All commands and tools verified from current docs.

---

## Risks Where CLAUDE.md Architecture Might Bite Us (Mitigations)

### Risk 1: MCP Streamable HTTP requires HTTPS for production clients

**Symptom:** Claude Desktop connects to `http://localhost:8787/mcp` fine in dev but refuses `http://` in production.
**Probability:** Certain.
**Mitigation:** `wrangler deploy` puts the Worker on `*.workers.dev` which is HTTPS by default. Don't try to run a self-hosted demo on raw HTTP. For local Claude Desktop config, point at the deployed URL.

### Risk 2: McpAgent default routing creates DO-per-session, not DO-per-workspace

**Symptom:** Memories saved in one Claude conversation don't appear in another.
**Probability:** Certain if uncorrected.
**Mitigation:** Documented above. Tool handlers must explicitly route to `WorkspaceDO` via `getAgentByName(env.WORKSPACE, this.props.workspace_id)`. Do not store any memory in `McpAgent.state`.

### Risk 3: Vectorize index dimensions are immutable

**Symptom:** You create the index with `bge-small-en-v1.5` (384 dims), later want to swap to a 1024-dim model, can't.
**Probability:** Medium (model selection is rarely a one-shot).
**Mitigation:** Either (a) commit to bge-small-en-v1.5 for v0.1–v1.0 and design around 384 dims, or (b) build re-embedding tooling early (`/scripts/reembed.ts` that walks all blocks and rebuilds the index). Recommendation: commit to bge-small for v0.1; revisit at v0.4 when you actually feel the limit.

### Risk 4: DO request affinity ≠ user latency

**Symptom:** Russell in NYC routes to a Worker in IAD, but his WorkspaceDO was created in SFO from an earlier request, so every tool call hops coast-to-coast.
**Probability:** Low for single user; medium at v0.3+.
**Mitigation:** Cloudflare migrates DOs toward request hotspots automatically over time. For v0.1, do nothing. If it bites in v0.3, look at `locationHint` when creating the DO based on JWT-claimed home region.

### Risk 5: SQLite per-DO cap is 10GB

**Symptom:** A power user (or an aggressive Slack connector) blows past 10GB of memory data in one workspace, writes start failing.
**Probability:** Low for personal use; real for org workspaces with connector dumps.
**Mitigation:** Track `ctx.storage.sql.databaseSize` and surface in a `health` tool. Add a cold-tier R2 archive in v1.0 for blocks older than N months. Not v0.1 concern.

### Risk 6: Schema-as-data validation is everyone's responsibility

**Symptom:** A user creates a memory type with weird fields; a connector writes blocks with mismatched properties; you have to define what "valid" means.
**Probability:** Certain by v0.3.
**Mitigation:** Validate properties on write inside `WorkspaceDO.remember()` against the `memory_types` row fields JSON. Define a small validator (probably Zod, dynamically built from the `fields` JSON). v0.1 punts this — system types are well-formed by construction.

### Risk 7: Triage worker idempotency

**Symptom:** Queue redelivers a `MemoryEvent` (which it will, in failure cases). The worker re-embeds, re-extracts, re-inserts. Now you have duplicate vectors and inflated dedup signals.
**Probability:** High once Queues are in real use.
**Mitigation:** Make every triage step idempotent. Block updates should be `UPDATE ... WHERE id = ? AND embedding_id IS NULL` so reprocessing is a no-op. Vector upserts use `block_id` as the vector ID, so they overwrite cleanly. v0.1: triage is a stub, this is a v0.2 design rule to bake in.

### Risk 8: The "9 tools max" cap is tight

**Symptom:** v0.3 adds `reflect`, `relate`, `export`, `conflict` → 9. v0.4 wants `digest`, `subscribe`, `share` and you're already at the cap.
**Probability:** Medium.
**Mitigation:** Treat the cap as a budget. When you want to add tool #10, ask "can this be a `mode` param on an existing tool?" e.g., `recall(query, mode: "timeline" | "synthesis" | "list")` rather than three tools. The cap is a feature, not a bug — it forces tool clarity.

### Risk 9: `EngramResponse` envelope adds tokens

**Symptom:** The whole point is token efficiency, but every response wraps `result` in a context+meta+suggestions block — those tokens count too.
**Probability:** Always present; question is the magnitude.
**Mitigation:** Keep envelope fields *optional*. If `related` is empty, don't include the key. If `coverage = 1.0`, drop the meta block. Build a `compactEnvelope()` helper that strips empty fields before serialization. Measure token counts in a real Claude conversation; iterate on what's worth including. v0.1: ship full envelope, instrument it, decide what to trim in v0.2.

---

## Scalability Considerations

| Concern | 1 user (v0.1) | 100 users (v0.4-ish) | 10K users (v1.0+) |
|---|---|---|---|
| **DO count** | 1 WorkspaceDO | ~150 (1 user + project DOs) | ~30K | All within CF limits. |
| **Vectorize vectors** | <1K | ~500K (5K/user) | ~50M | Triggers index sharding at ~150K per index. v1.0 problem. |
| **DO storage** | <10MB | <100MB/user | Cap visibility needed | Tracking + cold-tier in v1.0. |
| **MCP request rate** | <100/day | ~10K/day | ~1M/day | Workers scale automatically; DOs may need queue-buffered writes. |
| **Workers AI inference cost** | trivial | $5-20/mo | budget concern | Migrate embedding to BYO model for org tier? v1.0 strategic decision. |
| **Queue throughput** | <100 msg/day | ~10K msg/day | ~1M msg/day | Within CF Queues capacity (10K msg/s/queue). |

**v0.1 conclusion:** Every limit is irrelevant. Build for correctness, not scale.

---

## Sources

All sources verified via Context7 MCP (Cloudflare official docs corpus) on 2026-05-24, with one cross-check via WebSearch.

| Topic | Source | Confidence |
|---|---|---|
| Durable Objects SQLite backend, RPC, alarms | [Cloudflare DO docs (Context7)](https://developers.cloudflare.com/durable-objects/) | HIGH |
| DO SQLite 10GB per-object limit (GA April 2025) | [SQLite in DO GA changelog](https://developers.cloudflare.com/changelog/2025-04-07-sqlite-in-durable-objects-ga/), [DO platform limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | HIGH |
| Cloudflare Agents SDK `McpAgent` | [cloudflare/agents repo + docs (Context7)](https://github.com/cloudflare/agents/blob/main/docs/mcp-servers.md) | HIGH |
| MCP TypeScript SDK Streamable HTTP transport | [MCP TS SDK docs (Context7)](https://ts.sdk.modelcontextprotocol.io/) | HIGH |
| `getAgentByName` / `routeAgentRequest` routing | [Cloudflare Agents routing API (Context7)](https://developers.cloudflare.com/agents/api-reference/routing) | HIGH |
| Vectorize limits and metadata filtering | [Vectorize docs (Context7)](https://developers.cloudflare.com/vectorize/) | HIGH |
| Workers AI `bge-small-en-v1.5` embedding model | [Workers AI models (Context7)](https://developers.cloudflare.com/workers-ai/models/) | HIGH |
| Queues consumer config, batching, retries | [Cloudflare Queues config (Context7)](https://developers.cloudflare.com/queues/configuration/batching-retries/) | HIGH |
| `ctx.waitUntil` and 30s background budget | [Workers runtime API context (Context7)](https://developers.cloudflare.com/workers/runtime-apis/context/) | HIGH |
| Local testing with `wrangler dev` + Miniflare v3 | [Workers testing Miniflare (Context7)](https://developers.cloudflare.com/workers/testing/miniflare/get-started) | HIGH |
| MCP Inspector for client testing | MCP TypeScript SDK + ecosystem knowledge | MEDIUM |

---

## Phase Ordering Rationale for the Roadmap

Recommended v0.1 phases (5 total, fits 2-week milestone with day-of-slip headroom):

1. **P1 Foundation** — Types, schema seed data, monorepo + wrangler config, "wrangler dev boots." (1.5 days)
2. **P2 WorkspaceDO + SQLite** — DO class, schema migrations, system type seeding, query helpers, vitest passes. (2.5 days)
3. **P3 MCP Server Scaffold** — `McpAgent` subclass, JWT validation, 5 empty tool registrations, Claude Desktop sees the tools. (1.5 days)
4. **P4 Core Tools** — remember + recall (SQL LIKE) + search + forget + ingest; EngramResponse envelope; MCP Inspector + Claude Desktop smoke tests. (3-4 days)
5. **P5 Async Plumbing + Deploy** — Triage Worker stub, Queue wiring, `wrangler deploy`, Claude Desktop config pointing at deployed URL, Russell's agent flips over. (2 days)

**Total:** ~11 working days = 2.2 weeks → matches v0.1 target of 2026-06-07 (~2 weeks from 2026-05-24).

**Phase-level rationale (what depends on what, why this order):**

- P1 before everything because types and config define the contracts everything else implements.
- P2 before P3 because the MCP server's tool handlers RPC into the DO — no DO means the tools have nothing to call.
- P3 before P4 because tools need a place to live (registered on a `McpAgent` subclass).
- P4 before P5 because P5 is a deploy and you want working tools to deploy.
- P5 ships the triage stub last because it's not critical-path for "Russell uses it daily" — it's critical-path for "v0.2 has something to extend."

---

## Open Questions for Phase-Specific Research Later

- **OAuth at v0.4:** Engram needs to authenticate Slack/Drive connectors and (later) end users. The Cloudflare Workers OAuth Provider integrates with McpAgent. Worth a focused research pass at v0.4 start.
- **Embedding model choice at v0.2:** bge-small (384 dims) is the easy default. bge-base or bge-large or external model (OpenAI, Cohere) may be worth evaluating once we see recall quality with real data.
- **Triage worker AI cost ceilings:** Workers AI is metered. Need a v0.2 budget model: cost per memory event at 10K users.
- **Cross-DO read fanout for v0.3 `reflect`:** "What do I know about X?" across personal + team + project DOs requires querying multiple DOs. Latency and orchestration pattern needs design before v0.3.
- **R2 connector registry format at v1.0:** Memory type packs, connector configs — JSON manifest? Versioning?
