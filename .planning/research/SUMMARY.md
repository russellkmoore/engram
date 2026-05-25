# Engram Research Synthesis

**Project:** Engram — MCP-native second brain on Cloudflare
**Synthesized:** 2026-05-24
**Inputs:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, PROJECT.md, CLAUDE.md
**Confidence:** HIGH on Cloudflare primitives + DO topology + 9-tool surface; MEDIUM on Workers AI model choice (prompt-design-dependent) and MCP SDK v2 timing.

---

## 1. TL;DR (read this first)

1. **Cloudflare's `agents/mcp` `McpAgent` is the only viable MCP host.** Raw `@modelcontextprotocol/sdk` transports are Node-only and will not run in `workerd`. `McpAgent` gives us Streamable HTTP transport, session lifecycle, and OAuth integration in ~20 LOC.
2. **Two DO classes per Worker, not one.** `McpAgent.serve()` creates a session DO automatically; we must add a separate `WorkspaceDO` reached via `getAgentByName(env.WORKSPACE, props.workspace_id)` from JWT claims. The session DO is transient; the WorkspaceDO is the durable memory store.
3. **Defer Vectorize to v0.2; ship v0.1 with SQL `LIKE` as the recall backing.** Forces a clean intelligence-layer milestone and keeps v0.1 critical path lean. But `blocks` schema MUST include `embedding_model` and `embedding_version` columns from day 1 (Vectorize dimensions are immutable forever).
4. **Five v0.1 phases over ~11 working days:** Foundation → WorkspaceDO+SQLite → MCP Scaffold → Core Tools → Async Plumbing+Deploy. Fits the 2-week v0.1 target (2026-06-07) with day-of-slip headroom.
5. **9-tool MCP surface is correct and complete.** One refinement: remove `format?` from `search` so exports go through `export` only. Tool count stays at 9 across the full v1.0 surface — treat as a hard cap.
6. **Eight irreversible v0.1 decisions** bind permanently before first deploy — listed in §7 below. Most catastrophic: `new_sqlite_classes` (not `new_classes`) in the wrangler migration block.
7. **Strategic positioning is intact:** Anthropic shipped native cross-chat memory in March 2026, which validates that personal memory is table stakes — and confirms Engram's moat is team/project/org scope + the same-answer-across-clients story (v0.4 killer demo), not personal scope alone.
8. **Switch from `wrangler.toml` to `wrangler.jsonc` throughout.** Cloudflare actively recommends JSONC for new projects; new features ship JSONC-first. CLAUDE.md needs a one-line fix during Phase 1 of v0.1.

---

## 2. Stack at a Glance (version-pinned)

| Layer | Pick | Pin | Confidence |
|---|---|---|---|
| Runtime | Cloudflare Workers (TS, ES modules) | `compatibility_date = "2026-05-22"`, `nodejs_compat` | HIGH |
| Wrangler CLI | `wrangler` | `^4.94.0` | HIGH |
| Worker types | `@cloudflare/workers-types` | `^4.20260525.1` | HIGH |
| Config format | `wrangler.jsonc` per package, no root config | — | HIGH |
| MCP SDK | `@modelcontextprotocol/sdk` (v1.x branch, v2 migration in flight) | `^1.29.0` (pin exact in v0.1) | HIGH |
| MCP host adapter | `agents` (Cloudflare Agents SDK, `McpAgent`) | `^0.13.2` | HIGH |
| Schema validation | `zod` | `^4.4.3` | HIGH |
| Storage (per workspace) | DO with SQLite via `ctx.storage.sql.exec` | built-in | HIGH |
| Semantic search | Vectorize V2 — **deferred to v0.2** | built-in | HIGH |
| AI grunt work | Workers AI bindings — **deferred to v0.2** | built-in | HIGH |
| Async pipeline | Cloudflare Queues — **stub in v0.1, real in v0.2** | built-in | HIGH |
| Embeddings (v0.2) | `@cf/baai/bge-base-en-v1.5` (768d, cosine) | — | HIGH |
| Text gen (v0.2) | `@cf/meta/llama-3.1-8b-instruct` (upgrade to 70B only when synthesis quality bites) | — | MEDIUM |
| Build | Wrangler's embedded esbuild (NOT Vite, NOT tsc-as-bundler) | — | HIGH |
| Test runner | Vitest + `@cloudflare/vitest-pool-workers` | `^4.1.7` / latest pool | MEDIUM |
| Package manager | npm workspaces | npm 10+ | HIGH (per PROJECT.md) |
| TypeScript | `typescript` | `^6.0.3` | HIGH |
| AI SDK client (v0.2) | `workers-ai-provider` + Vercel `ai` | `^3.1.14` / `^4.x` | HIGH |

**Explicit anti-recommendations (do NOT add):** `express`, `fastify`, `drizzle-orm`, `kysely`, `prisma`, `vite`, `turbo`, `pnpm`/`yarn`, raw `@modelcontextprotocol/sdk` HTTP transport, MSW.

---

## 3. Architectural Decisions Locked at v0.1

These shape every line of v0.1 code and cannot be changed cheaply later.

| # | Decision | Why it locks early | Cost of changing later |
|---|---|---|---|
| A1 | **`McpAgent` from `agents/mcp` as the MCP host** | Only Workers-native Streamable HTTP transport; bakes session DO lifecycle | Hand-rolling transport = ~500 LOC + auth/CORS/SSE bugs |
| A2 | **Two DO classes: session DO (auto, McpAgent-managed) + `WorkspaceDO` (per-workspace, durable)** | Default `McpAgent.serve()` creates DO-per-session which is wrong for shared memory across devices/clients | Cross-DO memory migration after first user data exists |
| A3 | **`new_sqlite_classes` (NOT `new_classes`) in wrangler migration** | SQLite class election is irreversible; KV-backed DOs cannot be converted | Re-deploy under new class name + workspace-by-workspace data migration |
| A4 | **`wrangler.jsonc` everywhere, no root config; one config per package** | Cloudflare's official recommendation; new features JSONC-first; root-config inheritance fights the tool | Bulk format conversion + CLAUDE.md correction (one-line fix during P1) |
| A5 | **One global Vectorize index in v0.2, namespaced per workspace, NOT one index per workspace** | 100-index-per-account cap kills the managed business model; namespaces (50K/index Paid) scale | Re-shard with dual-write cutover |
| A6 | **Two DO classes per Worker SHARE the same script** (`script_name` binding) | Simpler deploy; both classes evolve together | Splitting after the fact = new wrangler config + binding rename |
| A7 | **Direct RPC into WorkspaceDO on the synchronous write path; `ctx.waitUntil(queue.send(...))` for async enrichment** | Queue round-trip on writes adds 100-500ms unnecessary latency on a synchronous user action | Refactor every tool handler |
| A8 | **EngramResponse envelope on every tool from v0.1, even when most fields are null/empty** | Adding the envelope shape later is a breaking change for every consumer | Coordinated client + server release |
| A9 | **JWT-per-workspace, DO performs defense-in-depth check (`state.id.name === workspace_id`)** | Auth trust model is set at v0.1; multi-tenant security holes are catastrophic | Penetration test + patch + customer notification |
| A10 | **`blocks` schema includes `embedding_model` + `embedding_version` columns from day 1** | Vectorize dimensions/metric/index name are immutable; future re-embedding migration becomes `UPDATE ... WHERE embedding_version = X` | Schema migration across every existing block + full re-embed of corpus |
| A11 | **`MemoryEvent.id` is the idempotency key; consumers `INSERT OR IGNORE`** | Cloudflare Queues are at-least-once; duplicate handling design is set when the contract is | Backfill dedup + retroactive cleanup of duplicate vectors |
| A12 | **MCP tool surface hard-capped at 9 tools, descriptions ≤1.5KB each, responses ≤8K tokens** | Claude's tool selection degrades with surface size; 25K-token cap on tool responses is enforced by Claude clients | Token-budget audit + tool consolidation |
| A13 | **System memory types seeded as SQLite rows on first DO init (idempotent), never as TS classes** | Schema-as-data is the whole point of v0.3 user/community extensibility | Rewrite type registry + every consumer that referenced types as code |

---

## 4. Differentiators Worth Marketing (defensible moat)

Engram's defensible position is the **intersection** of these four. No single competitor has more than two:

1. **Hierarchical scoped memory (personal → team → project → org)** with one MCP query traversing all layers the user can access. Mem0 has flat scope tags. Notion has team structure but UI-only. Zep has group-graphs but per-user is primary. **No competitor has hierarchical inheritance over MCP.**
2. **MCP-first interface (the tool surface IS the product).** Every AI client (Claude, Perplexity, Antigravity, Cursor) gets the same answers without a UI dependency. Notion/Mem.ai/Obsidian are UI-first; rebuilding around MCP requires a full redesign.
3. **Pre-processed `EngramResponse` envelope (synthesis + conflicts + coverage + gaps)** so Claude reasons rather than processes. **Every competitor returns raw memory lists** and expects the calling LLM to do the synthesis. The `meta.gaps[]` and `meta.coverage` fields — Engram telling Claude what it doesn't know — are unique.
4. **Schema-as-data memory types, user/community extensible at runtime.** Letta has typed blocks but not runtime-extensible. Notion databases are UI-only. Engram lets a user `INSERT INTO memory_types` and immediately store typed blocks.

**Plus, two demo-driven differentiators that land later:**

- **v0.4 killer demo:** Slack ask-question = Claude ask-question (same store, same answer). Proves layered memory works end-to-end. **No competitor has both** a multi-channel intake pipeline AND an MCP-first query layer over the same shared store.
- **Anti-Anthropic positioning:** Anthropic shipped native cross-chat memory in March 2026 (per-user, no team/project/org scope, no MCP). Engram's pitch must lead with team/project/org + same-answer-across-clients — NOT generic "second brain" — or it sounds like "Anthropic's thing but worse."

---

## 5. v0.1 Phase Structure (5 phases, ~11 working days)

Source: ARCHITECTURE.md §"Phase Ordering Rationale for the Roadmap". This is the primary input for the roadmapper.

| # | Phase | Days | Critical-path items | Ships when |
|---|---|---|---|---|
| **P1** | **Foundation** | 1.5 | Shared types (`MemoryEvent`, `Memory`, `EngramResponse`); system memory types seed data; monorepo layout; per-package `wrangler.jsonc` with `new_sqlite_classes` migration; root `package.json` workspaces; `tsconfig.json` | `wrangler dev` boots a no-op Worker; CLAUDE.md updated to JSONC |
| **P2** | **WorkspaceDO + SQLite** | 2.5 | `WorkspaceDO` class skeleton; SQLite schema for all 7 tables (blocks/relations/tags/members/memory_types/inbox/conflicts) with `embedding_model`/`embedding_version` columns on blocks; system type seeding (idempotent, `INSERT OR IGNORE`); query helpers (insert block, search blocks, get by id); schema-migration runner using `_schema_migrations` table (NOT `PRAGMA user_version`) | Vitest passes for DO query layer under `@cloudflare/vitest-pool-workers` |
| **P3** | **MCP Server Scaffold** | 1.5 | `EngramMcp extends McpAgent` subclass; JWT validation middleware → `this.props.{workspace_id, user_id}`; defense-in-depth DO check (`state.id.name === workspace_id`); empty tool registrations for 5 tools; `getAgentByName(env.WORKSPACE, ...)` routing pattern | Claude Desktop (via `mcp-remote`) sees 5 tools listed; MCP Inspector connects |
| **P4** | **Core Tools + Envelope** | 3-4 | Tool implementations in order: `remember` → `recall` (SQL `LIKE` backing) → `search` → `forget` → `ingest`; `EngramResponse` envelope wrapper with per-section byte budgets; `McpError` with JSON-RPC codes for failures; `forget` is transactional across stores (set the contract even though Vectorize lands v0.2); response-size unit tests (<8K tokens worst case) | Tools round-trip in Claude Desktop and MCP Inspector; Russell's job-search agent integration smoke-tests pass |
| **P5** | **Async Plumbing + Deploy** | 2 | Triage Worker stub (Queue consumer that logs and forwards to WorkspaceDO with no AI); Queue producer wired into MCP server via `ctx.waitUntil`; `wrangler deploy` for both Workers; production Claude Desktop config pointing at `*.workers.dev` URL; Russell flips his job-search agent over | Russell uses Engram daily; v0.1 acceptance: store a job posting in one conversation, recall it in a new one |

**Phase dependency rationale:**
- P1 before everything because types/config define the contracts everything else implements.
- P2 before P3 because MCP tool handlers RPC into the DO — no DO means tools have nothing to call.
- P3 before P4 because tools need a place to live (registered on an `McpAgent` subclass).
- P4 before P5 because P5 is a deploy and you want working tools to deploy.
- P5 ships the triage stub last because it's not critical-path for "Russell uses it daily" — it's critical-path for "v0.2 has something to extend."

**Research flags for phase planning:**

| Phase | Needs `/gsd:plan-phase --research-phase`? | Reason |
|---|---|---|
| P1 | NO | Standard monorepo + wrangler setup; STACK.md covers it |
| P2 | LIGHT | DO SQLite patterns well-documented in STACK.md/ARCHITECTURE.md; verify `durable-utils` `SQLSchemaMigrations` API surface at scaffold time |
| P3 | YES | `McpAgent` `props` shape + JWT integration pattern + Claude Desktop `mcp-remote` bridge are the highest-churn areas; verify `agents` SDK version at scaffold time |
| P4 | LIGHT | Tool patterns are well-specified in CLAUDE.md + FEATURES.md; envelope per-section budgets need tokenizer choice (probably `gpt-tokenizer` or `tiktoken`) |
| P5 | NO | Standard wrangler deploy + Queue consumer skeleton |

---

## 6. Cross-Research Conflicts and Resolutions

Where the four research dimensions disagreed, here is how it resolves:

| # | Conflict | Resolution | Locked in |
|---|---|---|---|
| C1 | **CLAUDE.md says v0.1 includes Vectorize + Workers AI.** FEATURES.md says `recall`/`search` semantic backing is a v0.2 item. ARCHITECTURE.md recommends deferring Vectorize entirely from v0.1 in favor of SQL `LIKE`. | **Defer Vectorize and Workers AI to v0.2.** v0.1 ships the contract (envelope shape, `MemoryEvent`, `embedding_model`/`embedding_version` columns) but the backing is lexical. This is the "do it right, not fast" path: a clean v0.2 milestone with measurable before/after semantic vs. lexical, and v0.1 doesn't block on AI infrastructure. | PROJECT.md Active list needs minor edit during P1; current list overscopes v0.1 |
| C2 | **CLAUDE.md implies "one DO per workspace" is the whole story.** ARCHITECTURE.md identifies that `McpAgent.serve()` creates a session DO automatically — so we actually have TWO DO classes per Worker. | **Both DO classes coexist in the same Worker script.** The session DO is auto-managed by `McpAgent`; the `WorkspaceDO` is durable and reached via `getAgentByName(env.WORKSPACE, props.workspace_id)`. The wrangler migration declares both classes under `new_sqlite_classes`. CLAUDE.md needs a clarification note. | A2, A6 above; CLAUDE.md update during P1 |
| C3 | **CLAUDE.md uses `wrangler.toml` throughout.** STACK.md and ARCHITECTURE.md both recommend `wrangler.jsonc` as Cloudflare's current preferred config format. | **Use `wrangler.jsonc` from day 1.** Update CLAUDE.md as a one-line correction during P1. | A4 above |
| C4 | **CLAUDE.md `ingest-worker` is listed as a v0.1 package.** ARCHITECTURE.md says don't create that package in v0.1 — the MCP server IS the only ingest source until v0.4 connectors land. | **Drop `ingest-worker` from v0.1.** Merge back in v0.4 when external connectors arrive. v0.1 has 4 real packages (mcp-server, workspace-do, shared/types, shared/schema) + 1 stub (triage-worker). | PROJECT.md repo-structure clarification during P1 |
| C5 | **CLAUDE.md describes ingest pipeline as "Source → MemoryEvent → Queue → Triage Worker → WorkspaceDO" for everything.** ARCHITECTURE.md says synchronous writes should go MCP Worker → WorkspaceDO directly (RPC), then `ctx.waitUntil(queue.send(...))` for async enrichment. | **Adopt the split: direct RPC for sync writes, Queue for async enrichment.** Round-tripping `remember()` through a Queue adds 100-500ms on a synchronous user action. | A7 above |
| C6 | **FEATURES.md flags that `search` has a `format?` param that overlaps with `export`.** | **Remove `format?` from `search`.** Exports go through `export` only. Tool count stays at 9; tools stay single-purpose. CLAUDE.md MCP tool list needs a one-line edit. | A12 plus tool-spec edit during P3 |
| C7 | **PITFALLS.md identifies that `conflict` tool overlaps slightly with the envelope's `context.conflicts`.** | **Keep `conflict` as a separate tool.** Active scan (`passive=false`) is a genuinely different operation: potentially expensive, user-initiated, and v0.4 powers proactive Slack alerts. | No change; defer to v0.3 when the tool ships |
| C8 | **No explicit license decision in CLAUDE.md or PROJECT.md.** PITFALLS.md (OSS-3) flags this is a serious permanent decision. | **Default toward Apache 2.0 + CLA for the core (with re-licensing rights retained).** Defer the formal call to v1.0 but FLAG NOW so we don't accidentally pick AGPL or omit a LICENSE file at first commit. Add a placeholder `LICENSE` file in v0.1 stating "Apache 2.0 — subject to confirmation at v1.0." | Phase 1 task |
| C9 | **STACK.md and ARCHITECTURE.md disagree slightly on default embedding model.** ARCHITECTURE.md mentions `bge-small-en-v1.5` (384d) as a possible starting point; STACK.md recommends `bge-base-en-v1.5` (768d) as the cost/quality sweet spot. | **Go with `bge-base-en-v1.5` (768d).** STACK.md analysis is more recent and accounts for query-expansion cost multipliers. Lock dimensions = 768, metric = cosine, index name = `engram-memories` in v0.2 phase research. Schema columns from v0.1 enable future re-embed if needed. | A10 above; final lock during v0.2 phase planning |

---

## 7. v0.1 Must-Mitigate List (the irreversible 8)

The eight things v0.1 absolutely cannot ship without addressing. Anything else is deferrable; these are foundation-class. Sourced from PITFALLS.md but tightened for the roadmapper.

1. **`new_sqlite_classes` directive** — Wrangler `[[migrations]]` (or JSONC equivalent) MUST use `new_sqlite_classes = ["EngramMcp", "WorkspaceDO"]`. Add a CI lint check on every `wrangler.jsonc` that rejects merges if a new DO class appears under `new_classes`. **Severity: catastrophic, irreversible.**

2. **Schema migrations without `PRAGMA user_version`** — Use the `durable-utils` `SQLSchemaMigrations` class OR hand-roll a `_schema_migrations` table queried by `SELECT MAX(version)` in the constructor inside `blockConcurrencyWhile()`. Hibernation-replay safety test required.

3. **No `blockConcurrencyWhile()` across network I/O** — Lint rule (grep) flagging `blockConcurrencyWhile.*(env\.|fetch\()` patterns. This single mistake collapses DO throughput from ~1000 req/sec to ~200 and is easy to introduce. Use `blockConcurrencyWhile()` only for synchronous init.

4. **DO defense-in-depth on workspace_id** — Every WorkspaceDO method verifies `state.id.name === workspace_id` parameter. Auth cannot be trusted only at the edge. Penetration test in P4 that crafts a request with workspace_a JWT but workspace_b DO id and verifies rejection.

5. **MCP response size budgets** — Every tool has a unit test asserting serialized output <8K tokens with worst-case data. `EngramResponse.context.related[]` and `context.entities[]` are the dangerous fields (cap at 5-10 items each). Tool descriptions ≤1.5KB each (total surface ≤8KB). Use `gpt-tokenizer` or `tiktoken` for the byte-count check.

6. **MCP error response shape** — Use `McpError` with proper JSON-RPC error codes (`-32602 InvalidParams`, etc.). Don't invent ad-hoc `{ error: "...", message: "..." }` envelopes that Claude reads as success data. Integration test verifies user-visible failure on bad input.

7. **`forget` is transactional and complete** — Even before Vectorize lands in v0.2, the `forget` contract MUST promise "after forget, the data is gone everywhere." v0.1 implementation deletes from SQLite + relations cleanup; v0.2 extends to Vectorize delete. Round-trip test: store → forget → recall returns zero.

8. **`embedding_model` + `embedding_version` columns on `blocks` from day 1** — Vectorize dimensions and metric are immutable. Adding these columns to the v0.1 schema makes future re-embedding migrations a SQL `UPDATE WHERE`. Without them, dimension lock-in at v0.2 is permanent.

**Bonus pre-flight check (not strictly v0.1 but flag now):**
- **License placeholder:** Drop an `Apache-2.0` `LICENSE` file in the root at first commit with a comment noting "subject to confirmation at v1.0." Avoids accidentally publishing without a license or picking AGPL by drift.

---

## 8. Open Questions Deferred to Later Milestones

These are real questions that surfaced during research; none block v0.1 but each needs an explicit phase-planning answer at the indicated milestone.

| Question | Decide by | Why deferred |
|---|---|---|
| **Final Vectorize dimensions/metric/index name** (recommendation: 768d / cosine / `engram-memories`) | v0.2 P1 | Immutable choice; needs ADR before any vectors land |
| **Vectorize metadata index plan** (max 10 indexes/index, 64 bytes per indexed field) | v0.2 P1 | Must be created up-front; affects every future query |
| **Workers AI rate-limit budget per memory event** (per-task-type, not per-account, unevenly distributed) | v0.2 P2 | Determines Queue consumer concurrency settings |
| **Memorability threshold per workspace** (default: 0.85 auto-store, 0.5 inbox) | v0.2 P3 | Drift-prone; needs telemetry baseline first |
| **Embedding model upgrade path** (bge-base → bge-large?) | v0.4 | Requires real recall-quality eval set from v0.2/v0.3 usage |
| **UserDO / TeamDO / ProjectDO class hierarchy** (one class with `workspace_type` vs three classes) | v0.3 P1 | Collapsed to single `WorkspaceDO` in v0.1; divergences become clear once team semantics are real |
| **`reflect` tool synthesis prompt + 70B vs 8B model trade-off** | v0.3 | Quality-sensitive; needs prompt iteration with real data |
| **OAuth provider integration** (`@cloudflare/workers-oauth-provider` + `McpAgent`) | v0.4 / v1.0 | Single-user JWT covers v0.1-v0.4 |
| **Cross-workspace `reflect` query orchestration** (RPC fanout across multiple DOs) | v0.3 | Latency design needs real workspace counts |
| **Final OSS license decision** (default: Apache 2.0 + CLA; AGPL flagged as enterprise-hostile) | v1.0 | Placeholder Apache 2.0 LICENSE in v0.1 commit avoids accidental drift |
| **R2 memory-type pack registry format** (JSON manifest schema + versioning) | v1.0 | Community types are v1.0 scope |
| **Inbox triage UX** (MCP-exposed `inbox` tool vs. `search` with `scope: "inbox"` filter — counts toward 9-tool cap) | v0.4 | Touches the tool surface budget; decide when inbox UI is real |
| **Vectorize cross-tenant strategy** (one global index vs. index-per-workspace) — STACK.md says global+namespace, ARCHITECTURE.md says index-per-workspace at v0.3+ | v0.3 P1 | Security vs. cost trade-off; only matters at multi-tenant |
| **Tool-call telemetry / cost attribution per workspace** | v1.0 | Required for managed-offering pricing model |

---

## 9. Confidence Assessment

| Dimension | Confidence | Notes |
|---|---|---|
| **Stack** | HIGH | Every primitive verified via Context7 + Cloudflare official docs as of 2026-05-24. Versions pinned exactly. Two MEDIUM areas: Vitest pool config surface (still shifting) and Workers AI model choice (prompt-design-dependent — recommendations are starting points, not gospel). |
| **Features** | MEDIUM-HIGH | Competitor data verified via 2026 sources. Anthropic's March 2026 native memory + Notion's hosted MCP are the biggest landscape shifts and confirm Engram's positioning. Engram-specific tool mappings are opinionated synthesis. |
| **Architecture** | HIGH | Every architectural primitive validated against current Cloudflare + MCP docs. Five corrections to CLAUDE.md identified and resolved above. Recommended 5-phase v0.1 structure aligns with the 2-week target. |
| **Pitfalls** | HIGH for Cloudflare-stack and memory-product issues (well-documented in CF docs + RAG literature). MEDIUM for MCP ecosystem (newer protocol, faster churn). 8-item must-mitigate list is ruthless and complete for v0.1. |
| **Overall** | **HIGH** | Foundation is on solid ground. Biggest residual risk: `agents` SDK is pre-1.0 (v0.13.2) — pin exact, expect one breaking change between v0.1 and v1.0. Mitigation: integration test against MCP Inspector + Claude Desktop on every SDK bump. |

**Identified gaps that need planning attention:**

1. **`durable-utils` `SQLSchemaMigrations` API verification** — recommended in PITFALLS.md DO-2 but not version-pinned in STACK.md. Verify package + version at P2 scaffold.
2. **`mcp-remote` community-maintained risk** — needed to bridge Claude Desktop stdio expectation to remote HTTP for v0.1. Watch Claude Desktop changelog quarterly for native Streamable HTTP support.
3. **Tokenizer choice for response-size budgets** — not specified anywhere; pick during P4 (probably `gpt-tokenizer` for portability or `tiktoken` for Claude-fidelity).
4. **CI lint rules for the irreversible decisions** — `new_sqlite_classes` check, `blockConcurrencyWhile` grep, response-size budget tests, tool-description byte limits. Should land in P1 or P2.

---

## 10. Sources

All sources aggregated from the four research files. Cross-reference each underlying document for full citations.

### Context7-verified (HIGH confidence)
- `/modelcontextprotocol/typescript-sdk` — MCP SDK API, v1→v2 migration notes, Cloudflare Workers section
- `/cloudflare/agents` — `McpAgent`, `createMcpHandler`, OAuth provider pairing
- `/websites/developers_cloudflare_workers` — Durable Objects SQLite, Vectorize, Queues, Wrangler bindings, Workers AI structured output

### Cloudflare official docs (HIGH confidence)
- DO SQLite Storage API + SQLite class election + 10GB cap + Jan 2026 billing
- Vectorize V2 platform limits (10M vectors, 50K namespaces, 50 topK with metadata, 10 metadata indexes / 64 bytes)
- Queues delivery guarantees (at-least-once), batching, retries, 100 max retries, 25GB backlog
- `McpAgent` + `getAgentByName` routing + Streamable HTTP transport
- Workers AI pricing (Neurons), `bge-base-en-v1.5` 768d, llama-3.1-8b-instruct
- Wrangler JSONC recommendation; monorepo `-c` multi-config dev pattern
- `ctx.waitUntil` 30s background budget; `blockConcurrencyWhile` rules
- `@cloudflare/vitest-pool-workers` integration

### Competitor research (MEDIUM-HIGH confidence)
- Anthropic Claude Memory (March 2026 launch); file-based memory tool (April 2026)
- Mem0, Letta/MemGPT, Cognee, Zep/Graphiti, Pieces, Notion AI hosted MCP, Mem.ai
- Obsidian/Logseq/Roam community MCP servers
- 2026 ecosystem comparison articles

### RAG / memory research (HIGH confidence — academic)
- RAG recall problem, adversarial poisoning, semantic illusion (embedding hallucination)
- Embedding portability and versioning literature

### OSS licensing (MEDIUM confidence)
- AGPL-as-enterprise-non-starter literature; Apache 2.0 + CLA pattern for open-core

### npm package versions verified at 2026-05-24
- `wrangler@4.94.0`, `@modelcontextprotocol/sdk@1.29.0`, `agents@0.13.2`, `@cloudflare/vitest-pool-workers@0.16.9`, `@cloudflare/workers-types@4.20260525.1`, `zod@4.4.3`, `vitest@4.1.7`, `typescript@6.0.3`, `workers-ai-provider@3.1.14`

---

*Research synthesis for: Engram v0.1 — MCP Foundation*
*Synthesized: 2026-05-24*
*Author: Claude (GSD synthesizer) for Russell Moore*
