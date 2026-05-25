# Requirements: Engram

**Defined:** 2026-05-24
**Milestone in scope:** v0.1 — MCP Foundation (target 2026-06-07)
**Core Value (from PROJECT.md):** Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.

> **Scope framing:** "v1" in this document = **Engram v0.1 (MCP Foundation)** — the current milestone. The longer-term v0.2 → v1.0 arc is captured under "Later Milestones" below; each will get its own `/gsd:new-milestone` scoping pass when it begins. Out of Scope below applies to v0.1 specifically.

## v1 Requirements (Engram v0.1 — MCP Foundation)

Russell's call: **keep AI integration in v0.1** (Vectorize + Workers AI ship now, not in v0.2). Apply all other research corrections (C2–C9) as the locked baseline.

### Foundation (FND) — monorepo, types, config, license

- [ ] **FND-01**: Monorepo bootstraps via `npm install` from a clean clone (root `package.json` workspaces, per-package `package.json`, `tsconfig.json`)
- [ ] **FND-02**: Each Worker package has its own `wrangler.jsonc` (not `wrangler.toml`) with `compatibility_date = "2026-05-22"` and `nodejs_compat`
- [ ] **FND-03**: `wrangler dev` boots a no-op Worker successfully end-to-end
- [ ] **FND-04**: `shared/types/` exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` types consumable from every package
- [ ] **FND-05**: `shared/schema/system-types.ts` defines the seven system memory types (`job_application`, `contact`, `company`, `project`, `research_note`, `decision_log`, `meeting_note`) with field definitions
- [ ] **FND-06**: `LICENSE` file at repo root is Apache-2.0 with a top-of-file comment "subject to final confirmation at v1.0"
- [ ] **FND-07**: CLAUDE.md updated to reflect: `wrangler.jsonc` everywhere, two-DO-class topology, `agents/mcp` `McpAgent` adapter, `search` without `format?`, `ingest-worker` deferred to v0.4
- [ ] **FND-08**: CI lint (or `npm run lint:wrangler`) rejects any wrangler config whose `[[migrations]]` block uses `new_classes = [...]` for a Durable Object class (must be `new_sqlite_classes`)

### Storage (STO) — WorkspaceDO + SQLite

- [ ] **STO-01**: `WorkspaceDO` Durable Object class lives in `packages/workspace-do/` and is declared in its `wrangler.jsonc` under `new_sqlite_classes`
- [ ] **STO-02**: `WorkspaceDO` constructor runs schema migration idempotently via a `_schema_migrations` table (not `PRAGMA user_version`), inside `blockConcurrencyWhile()` with no network I/O
- [ ] **STO-03**: SQLite schema creates all seven tables (`blocks`, `relations`, `tags`, `members`, `memory_types`, `inbox`, `conflicts`) per CLAUDE.md spec
- [ ] **STO-04**: `blocks` table includes `embedding_model TEXT` and `embedding_version INTEGER` columns from first migration (immutable Vectorize lock-in mitigation)
- [ ] **STO-05**: On first init, `memory_types` table is seeded with the seven system types via `INSERT OR IGNORE` (idempotent across DO restarts)
- [ ] **STO-06**: Typed query helpers exist for: insert block, get block by id, lexical search blocks (LIKE), delete block + cascading relations, list memory types, create inbox entry, list conflicts
- [ ] **STO-07**: Every `WorkspaceDO` method verifies `this.state.id.name === args.workspace_id` and throws `McpError(-32600 InvalidRequest)` on mismatch (defense in depth)
- [ ] **STO-08**: Vitest suite under `@cloudflare/vitest-pool-workers` covers schema migration, system type seeding, and each query helper (green in CI)
- [ ] **STO-09**: Hibernation-replay safety test: re-instantiating `WorkspaceDO` after simulated hibernation does not re-run completed migrations and does not duplicate seed data
- [ ] **STO-10**: Grep-based lint rule (or test) flags any `blockConcurrencyWhile()` block containing `env.`, `fetch(`, `await this.ai`, or other network I/O

### MCP Server (MCP) — `EngramMcp` Worker

- [ ] **MCP-01**: `packages/mcp-server/` Worker uses `agents/mcp` `McpAgent` (^0.13.2) — not raw `@modelcontextprotocol/sdk` HTTP transport
- [ ] **MCP-02**: Worker exports an `EngramMcp extends McpAgent` class served at `/mcp` via `McpAgent.serve("/mcp")`
- [ ] **MCP-03**: Worker's `wrangler.jsonc` declares BOTH DO classes under `new_sqlite_classes`: `EngramMcp` (auto-managed session DO) and `WorkspaceDO` (durable per-workspace store)
- [ ] **MCP-04**: JWT validation middleware extracts `workspace_id` + `user_id` from the bearer token and exposes them on `this.props`
- [ ] **MCP-05**: All tool handlers route to `WorkspaceDO` via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` rather than calling DO storage directly
- [ ] **MCP-06**: All five v0.1 tools (`remember`, `recall`, `search`, `forget`, `ingest`) are registered with zod input schemas
- [ ] **MCP-07**: Tool failures throw `McpError` with appropriate JSON-RPC error codes (`-32602 InvalidParams`, etc.) — never invent ad-hoc `{error: "..."}` envelopes
- [ ] **MCP-08**: Each tool's serialized success response is verified <8K tokens worst-case by a unit test (tokenizer: `gpt-tokenizer`); each tool description is <1.5KB
- [ ] **MCP-09**: MCP Inspector (`npx @modelcontextprotocol/inspector`) successfully connects to a local `wrangler dev` instance and lists all five tools

### Core Tools (TOL) — the five v0.1 verbs

- [ ] **TOL-01**: `remember(content, type?, project?, tags?, source?, expires?)` writes to `blocks`, returns `EngramResponse<{id, classified_type, extracted_fields, confidence}>` with `context.conflicts` populated when overlaps detected
- [ ] **TOL-02**: `recall(query, types?, project?, scope?, limit?, since?, until?)` performs semantic search via Vectorize, returns `EngramResponse<{memories, synthesis}>` with `context.related`, `context.entities`, and `meta.gaps`
- [ ] **TOL-03**: `search(query, filters)` performs structured filter-based query (no `format?` param), returns `EngramResponse<{memories, count}>`
- [ ] **TOL-04**: `forget(id, cascade?)` deletes block + (when cascade) related blocks + relations rows + Vectorize vectors transactionally; a `store → forget → recall` round-trip returns zero matches
- [ ] **TOL-05**: `ingest(source, type?, project?, priority?, threshold?)` enqueues a `MemoryEvent` to the ingest Queue, returns `EngramResponse<{status, job_id}>` (real processing happens in PIP)
- [ ] **TOL-06**: Every tool response wraps in `EngramResponse<T>` envelope — `result`, `context.{related, entities, timeline?, conflicts?}`, `meta.{confidence, coverage, last_updated, gaps}`, `suggestions?.{actions, queries}` — fields may be null/empty but envelope shape is present
- [ ] **TOL-07**: Cross-workspace penetration test: a request with JWT for `workspace_A` cannot read/write `workspace_B` data even if the DO id is supplied directly (defense-in-depth check fires and request is rejected)
- [ ] **TOL-08**: Russell's job-search agent can call `remember()` to store a job posting (URL + extracted fields) and `recall()` in a separate Claude conversation to retrieve it; integration smoke test passes

### AI Integration (AI) — Vectorize + Workers AI

- [ ] **AI-01**: Vectorize index `engram-memories` exists with `--preset=@cf/baai/bge-base-en-v1.5` (768 dimensions, cosine metric) — created idempotently via `wrangler vectorize create` in setup script
- [ ] **AI-02**: Vectorize index uses **namespaces** for tenant isolation (one global index, namespace = `workspace_id`), not one index per workspace
- [ ] **AI-03**: `remember()` synchronously generates an embedding via `env.AI.run('@cf/baai/bge-base-en-v1.5', ...)`, stamps `embedding_model='@cf/baai/bge-base-en-v1.5'` and `embedding_version=1` on the row, and upserts the vector to Vectorize in the workspace namespace
- [ ] **AI-04**: `recall()` calls `env.AI.run('@cf/baai/bge-base-en-v1.5', ...)` on the query, queries Vectorize for top-K matches in the workspace namespace, hydrates block records from SQLite, returns ranked results
- [ ] **AI-05**: Entity extraction runs in the Triage Worker (not on the sync write path) via `env.AI.run('@cf/meta/llama-3.1-8b-instruct', ...)` with structured JSON output; results update `blocks.properties` and `blocks.summary`
- [ ] **AI-06**: Memorability scoring runs in the Triage Worker; scores >0.8 are stored normally, 0.4-0.8 land in the `inbox` table, <0.4 are discarded with a log line
- [ ] **AI-07**: Workers AI rate-limit handling: 429 responses from `env.AI.run()` trigger Queue message retry with `message.retry({delaySeconds: 30})` rather than failing the consumer batch
- [ ] **AI-08**: `forget()` deletes the corresponding Vectorize vector via the workspace namespace; round-trip test verifies deletion (recall after forget returns zero)

### Pipeline (PIP) — Triage Worker + Queue + async enrichment

- [ ] **PIP-01**: `engram-ingest` Queue exists and is bound to `mcp-server` (producer) and `triage-worker` (consumer)
- [ ] **PIP-02**: Synchronous writes from `remember()` go directly to `WorkspaceDO` via RPC; `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` fires the async enrichment afterward (no Queue round-trip on the sync path)
- [ ] **PIP-03**: `MemoryEvent.id` is a UUID generated by the producer; the Triage Worker uses it as an idempotency key with `INSERT OR IGNORE` semantics (Queues are at-least-once)
- [ ] **PIP-04**: Triage Worker performs: entity extraction, summarization, memorability scoring, conflict detection against existing memories in the workspace; writes results back to the `WorkspaceDO` via RPC
- [ ] **PIP-05**: Triage Worker failures use `message.retry()` (transient) or `message.ack()` + DLQ logging (permanent); no silent drops
- [ ] **PIP-06**: `blocks.ingest_status` column tracks per-block enrichment state: `pending`, `enriched`, `failed` (partial-failure visibility for v0.2 inbox UI)

### Deploy + Acceptance (DEP) — production wire-up

- [ ] **DEP-01**: `wrangler deploy` succeeds for `packages/mcp-server/` and `packages/triage-worker/` against Russell's Cloudflare account; both Workers are live at `*.workers.dev` URLs
- [ ] **DEP-02**: A JWT for Russell's single workspace is issued (script or doc), pasted into Claude Desktop's MCP config via `mcp-remote` bridge
- [ ] **DEP-03**: Acceptance test (the v0.1 done-state): Russell, in a Claude conversation, asks Claude to `remember` a job posting (URL + role + company). In a separate Claude conversation 1+ hour later, Russell asks "what job did I save earlier?" and Claude calls `recall` and returns the correct posting with extracted fields.
- [ ] **DEP-04**: Russell's job-search agent is reconfigured to use Engram as its memory backend; the agent's existing job-storage flow continues to work end-to-end
- [ ] **DEP-05**: Setup README documents: prereqs (Cloudflare account, paid Workers plan, npm 10+), one-command bootstrap (`npm install && npm run setup`), Claude Desktop config snippet, troubleshooting for common errors

## v1 Counts

| Category | Count |
|---|---|
| Foundation (FND) | 8 |
| Storage (STO) | 10 |
| MCP Server (MCP) | 9 |
| Core Tools (TOL) | 8 |
| AI Integration (AI) | 8 |
| Pipeline (PIP) | 6 |
| Deploy (DEP) | 5 |
| **Total v0.1** | **54** |

## Later Milestones (deferred — get their own `/gsd:new-milestone` scoping pass)

These are not "v2 requirements" in the lean PRD sense — they're future milestones in Engram's roadmap. Listed here as scope anchors so the roadmapper sees the arc.

### v0.2 — Intelligence Layer (target 2026-06-21)

- Conflict detection upgraded from "naive overlap" to semantic similarity + LLM-resolver (`ADD/UPDATE/DELETE/NOOP` per mem0)
- Query expansion (CF AI generates 3-4 semantic variants of `recall` query before Vectorize search)
- `reflect`-style synthesis improvements (groundwork for v0.3 `reflect` tool)
- Improved Triage Worker prompt design (memorability scoring stability, entity extraction quality)
- Telemetry baseline for `meta.confidence`, `meta.coverage`, `meta.gaps` quality
- `embedding_model` upgrade path validated end-to-end (re-embed by `embedding_version`)

### v0.3 — Workspaces + Memory Types (target 2026-07-12)

- Multi-workspace: UserDO / TeamDO / ProjectDO class hierarchy (one class with `workspace_type` discriminator OR three classes — decide at v0.3 P1)
- Member management (invite, accept, role assignment: owner/editor/viewer)
- Schema-as-data memory types: user-defined types via `INSERT INTO memory_types`, validated at write
- `reflect(topic, depth?, include_conflicts?)` MCP tool — synthesis across all related memories with `open_questions` gap detection
- `relate(id_a, id_b, relationship, properties?)` MCP tool — explicit knowledge graph edges
- `export(query, format, filters?)` MCP tool — CSV/XLSX/JSON via R2 signed URLs
- Cross-workspace `reflect` orchestration (RPC fanout across DOs the user can access)

### v0.4 — Connectors + Alerts (target 2026-08-02)

- Slack connector (channel ingestion, entity extraction, ask-Engram-in-Slack thread)
- Google Drive connector (scheduled polling, diff detection)
- `ingest-worker` package brought back (general connector ingest orchestration)
- Daily digest email
- Inbox UI (agentic triage of low-confidence captures)
- `conflict(passive?)` MCP tool — active scan vs passive list
- **Killer demo lands here:** same answer from Slack and from Claude, cross-workspace conflict detection posted to Slack

### v1.0 — Public Launch (target 2026-09-01)

- Managed hosting (Cloudflare-billed shared infra for non-self-hosted users)
- Stripe billing ($5-20/mo tiers)
- OAuth connector flows (`@cloudflare/workers-oauth-provider` + `McpAgent`)
- Admin UI (workspace management, member admin, audit log)
- Connector registry on R2 (community connectors)
- Community memory-type packs (JSON manifest registry)
- Final OSS license decision confirmed (default: Apache 2.0 + CLA)
- Public OSS launch + HN/Twitter/blog announcement

## Out of Scope (v0.1)

Explicit boundaries for v0.1. Each has its reason so we don't re-litigate.

| Excluded from v0.1 | Reason |
|---|---|
| Multi-user / shared workspaces / team memory | v0.3 milestone; v0.1 ships with single user (Russell only) |
| `reflect`, `relate`, `export`, `conflict` MCP tools | v0.3 / v0.4 milestones; keeps v0.1 tool surface at 5/9 |
| Slack, Drive, GitHub, Linear, Gmail, Calendar, Notion connectors | v0.4 milestone; v0.1 ingest source = MCP server only |
| Inbox UI, daily digest, conflict alerting | v0.4 milestone; v0.1 stores inbox entries but no UI to review them |
| OAuth flows | v1.0 milestone; v0.1 uses single hand-issued JWT for Russell |
| `ingest-worker` package | Per research C4, deferred to v0.4 when external connectors arrive |
| Managed hosting, billing, multi-tenant ops | v1.0 milestone; v0.1 is self-hosted on Russell's Cloudflare account |
| Real-time WebSocket sync between clients | Explicit anti-feature for v0.1; revisit post-v1.0 if demand exists |
| Web/desktop UI for browsing memories | Engram is MCP-first; any human UI is secondary and waits for the tool surface to be validated |
| Mobile apps (iOS, Android) | Out of scope through v1.0 |
| Self-edit memory mode (Letta-style) | Considered for v0.3 if `reflect` reveals demand |
| `embedding_model` upgrade migration | Schema supports it (AI-03 stamps current model), but actual migration script is v0.2 work |
| User-defined memory types | v0.3 milestone; v0.1 has only system types |
| Community memory-type pack registry | v1.0 milestone |
| Cross-MCP-client compatibility tests beyond Claude Desktop | v1.0 milestone; v0.1 just needs Claude Desktop to work for Russell |

## Traceability

Populated by the roadmapper at ROADMAP.md creation. Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|---|---|---|
| FND-01 | Phase 1: Foundation | Pending |
| FND-02 | Phase 1: Foundation | Pending |
| FND-03 | Phase 1: Foundation | Pending |
| FND-04 | Phase 1: Foundation | Pending |
| FND-05 | Phase 1: Foundation | Pending |
| FND-06 | Phase 1: Foundation | Pending |
| FND-07 | Phase 1: Foundation | Pending |
| FND-08 | Phase 1: Foundation | Pending |
| STO-01 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-02 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-03 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-04 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-05 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-06 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-07 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-08 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-09 | Phase 2: WorkspaceDO + SQLite | Pending |
| STO-10 | Phase 2: WorkspaceDO + SQLite | Pending |
| MCP-01 | Phase 3: MCP Server Scaffold | Pending |
| MCP-02 | Phase 3: MCP Server Scaffold | Pending |
| MCP-03 | Phase 3: MCP Server Scaffold | Pending |
| MCP-04 | Phase 3: MCP Server Scaffold | Pending |
| MCP-05 | Phase 3: MCP Server Scaffold | Pending |
| MCP-06 | Phase 3: MCP Server Scaffold | Pending |
| MCP-07 | Phase 4: Core Tools + Envelope | Pending |
| MCP-08 | Phase 4: Core Tools + Envelope | Pending |
| MCP-09 | Phase 3: MCP Server Scaffold | Pending |
| TOL-01 | Phase 4: Core Tools + Envelope | Pending |
| TOL-02 | Phase 4: Core Tools + Envelope | Pending |
| TOL-03 | Phase 4: Core Tools + Envelope | Pending |
| TOL-04 | Phase 4: Core Tools + Envelope | Pending |
| TOL-05 | Phase 4: Core Tools + Envelope | Pending |
| TOL-06 | Phase 4: Core Tools + Envelope | Pending |
| TOL-07 | Phase 4: Core Tools + Envelope | Pending |
| TOL-08 | Phase 4: Core Tools + Envelope | Pending |
| AI-01 | Phase 5: AI Integration | Pending |
| AI-02 | Phase 5: AI Integration | Pending |
| AI-03 | Phase 5: AI Integration | Pending |
| AI-04 | Phase 5: AI Integration | Pending |
| AI-05 | Phase 5: AI Integration | Pending |
| AI-06 | Phase 5: AI Integration | Pending |
| AI-07 | Phase 5: AI Integration | Pending |
| AI-08 | Phase 5: AI Integration | Pending |
| PIP-01 | Phase 6: Async Pipeline | Pending |
| PIP-02 | Phase 6: Async Pipeline | Pending |
| PIP-03 | Phase 6: Async Pipeline | Pending |
| PIP-04 | Phase 6: Async Pipeline | Pending |
| PIP-05 | Phase 6: Async Pipeline | Pending |
| PIP-06 | Phase 6: Async Pipeline | Pending |
| DEP-01 | Phase 7: Deploy + Acceptance | Pending |
| DEP-02 | Phase 7: Deploy + Acceptance | Pending |
| DEP-03 | Phase 7: Deploy + Acceptance | Pending |
| DEP-04 | Phase 7: Deploy + Acceptance | Pending |
| DEP-05 | Phase 7: Deploy + Acceptance | Pending |

**Coverage (after roadmapper run):**

- v0.1 requirements: 54 total
- Mapped to phases: 54
- Unmapped: 0 ✓

**Per-phase mapping summary:**

- Phase 1 (Foundation): 8 — FND-01..08
- Phase 2 (WorkspaceDO + SQLite): 10 — STO-01..10
- Phase 3 (MCP Server Scaffold): 7 — MCP-01..06, MCP-09
- Phase 4 (Core Tools + Envelope): 10 — TOL-01..08, MCP-07, MCP-08
- Phase 5 (AI Integration): 8 — AI-01..08
- Phase 6 (Async Pipeline): 6 — PIP-01..06
- Phase 7 (Deploy + Acceptance): 5 — DEP-01..05
- Sum: 8 + 10 + 7 + 10 + 8 + 6 + 5 = **54** ✓

## Acceptance Criteria for v0.1 (the "done" definition)

The single user-facing acceptance test:

> Russell tells Claude (Desktop or Code) in conversation A: "Remember this job posting: [URL]." Claude calls Engram's `remember` tool. Engram stores the posting, extracts company / role / status / applied_date / salary_range / source / url / contact, embeds it via Workers AI, and confirms back. **One hour later, in conversation B (no shared chat history)**, Russell asks Claude: "What job posting did I save earlier?" Claude calls `recall` against Engram, gets the posting back with extracted fields, and tells Russell about it. This works repeatedly, persistently, and is the backing for Russell's existing job-search agent.

Plus the foundational requirements:

- All 8 must-mitigate items from research SUMMARY.md §7 are addressed (no exceptions)
- `wrangler deploy` succeeds; both Workers live on `*.workers.dev`
- Russell uses Engram daily in his job-search agent for at least 3 consecutive working days post-deploy
- No data loss observed across DO hibernation cycles
- v0.2 can start without untangling v0.1 architectural mistakes

---
*Requirements defined: 2026-05-24*
*Last updated: 2026-05-24 — Traceability section populated by roadmapper (7 phases, 54/54 mapped)*
