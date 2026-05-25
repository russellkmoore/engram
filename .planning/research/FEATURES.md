# Feature Research — Engram

**Domain:** MCP-native layered memory system (personal → team → project → org) for AI assistants
**Researched:** 2026-05-24
**Confidence:** MEDIUM-HIGH (competitor data verified via 2026 sources; Engram tool-mapping is opinionated synthesis)
**Scope note:** Research covers the full v0.1 → v1.0 arc, not just v0.1, so milestone mapping is included for sequencing.

---

## Executive Summary

The "AI memory" category has bifurcated into two camps in 2026:

1. **Agent-memory infrastructure** (Mem0, Letta, Zep, Cognee) — SDK/API-first, designed to be embedded inside another product's agent loop. Optimized for `add()`/`search()` against a single user/agent identity. Multi-user is bolted on via scope tags. Conflict detection is shallow (mem0 has it via LLM-resolver; Zep tracks fact validity over time; Letta/Cognee don't really).
2. **Knowledge-base products with AI bolted on** (Notion AI, Mem.ai, Obsidian) — Built for humans first, then exposed to AI via MCP. Notion's hosted MCP is the most production-ready; Obsidian relies on community MCP servers; Mem.ai has no public MCP at all.

**Anthropic's native memory** (shipped March 2026, file-based memory tool April 2026) confirms that single-user cross-chat memory is now table-stakes at the model layer — but it stops at the standalone-chat boundary (Projects are siloed from memory), is per-user not per-team, and has no concept of project/org scoping. That's the gap.

**The clear whitespace for Engram:**
- **Layered scoping (personal/team/project/org) is genuinely unoccupied.** Mem0 has `user_id`/`org_id` tags but no hierarchical inheritance. Zep has user-graphs but team-graph is a 2026 roadmap item. Notion has team structure but is UI-first, not MCP-first.
- **MCP-native, single tool surface that traverses scopes** is unique. Every competitor either has no MCP (Mem.ai), has MCP but only for single-user data (Mem0, Letta), or has MCP that mirrors a UI rather than a memory abstraction (Notion).
- **Pre-processed response envelope (synthesis + conflicts + coverage + gaps)** is novel. Every competitor returns raw memory lists and expects the calling LLM to do the synthesis work — the opposite of Engram's design principle.
- **Schema-as-data memory types** is differentiated from the typed-memory approaches (Notion databases, Letta blocks) because it's user-extensible at runtime without code/schema migrations.

The Slack-and-Claude-same-answer demo is defensible because no competitor has both (a) a multi-channel intake pipeline and (b) an MCP-first query layer over the same shared store. Mem0 has the API but no Slack channel; Notion has the Slack integration but exposes it through Notion AI, not generic MCP traversal.

---

## Competitor Feature Matrix

### Detailed Comparison

| Product | Core Memory Model | AI Exposure | Multi-User / Team | Conflict Detection | Entity Extraction | Auth / Sharing |
|---|---|---|---|---|---|---|
| **Anthropic Claude Memory** | Per-user summary memory across standalone chats; file-based `/memory` tool for agentic use | Native (built into model) | No — strictly per-user; Projects siloed from memory | No | No (user-facing summaries only) | Anthropic account; no sharing |
| **Mem.ai** | Self-organizing PKM with AI-suggested tags and "Collections" | Proprietary "Mem Chat" only; no public MCP found | No multi-user; personal-only | No | Yes (tags, related-mems) | Email + Mem account; private only |
| **Letta (MemGPT)** | Three-tier: Core (in-context), Recall (searchable history), Archival (long-term); 2026 adding Context Repositories with git-versioning | Python/TS SDK, REST API, ADE GUI; **no first-party MCP** | Agent-scoped, not user-scoped; multi-agent collaboration via shared blocks | No (memory edits via agent self-tool-calls) | Limited (in agent prompts) | API key per agent; self-host or cloud |
| **Cognee** | Knowledge graph + vector hybrid; auto-extracts ontologies | **MCP server** (cognee-mcp), Python SDK | Single-tenant by default; multi-tenant via separate deployments | No (graph reasoning, not contradiction handling) | Yes (entities + relations from text) | API key; self-host free, cloud $35/mo |
| **Zep (Graphiti)** | Temporal knowledge graph (Graphiti) with dual timelines (event time + fact validity) | **MCP server** (Graphiti MCP), Python SDK, REST | User-graphs + group-graphs; team support exists but per-user is primary | **Yes — temporal invalidation** (fact-validity timeline) | Yes (entities, relations, episodes) | SOC2/HIPAA/GDPR; per-user API keys |
| **mem0** | Multi-signal retrieval (vector + BM25 + entity); graph memory option | Python/JS SDK, REST API; community MCP servers (not first-party) | **Yes — scope tags** (`user_id`, `agent_id`, `run_id`, `app_id`, `org_id`); **no hierarchy** | **Yes — LLM-resolver** (ADD/UPDATE/DELETE/NOOP); invalidates contradictions | Yes (graph mode); entity-linking in retrieval | SOC2/HIPAA/BYOK; self-host or cloud |
| **Pieces** | Long-Term Memory Engine (LTM-2) capturing IDE/browser/app context locally | **MCP server** (first-party); native PiecesOS | Single-user (per-device); no team mode | No | Some (snippet metadata) | Local-only; PiecesOS desktop runtime |
| **Notion AI** | Workspace pages/databases; AI agents read/write via permissions | **First-party hosted MCP** with page-level admin controls; Custom Agents; Workers | **Yes — workspaces, teamspaces, page-level perms** (built-in) | No (versioning yes; contradictions no) | Implicit (databases ARE structured) | OAuth + workspace; granular sharing |
| **Obsidian** | Local markdown vault; graph view; plugins | **Community MCP servers** (mcp-obsidian, mcpvault, obsidian-mcp-plugin); local REST API | Single-user (vault is a folder); sync is file-level | No | No (plugin-dependent) | File-system; sync via paid service |
| **Logseq** | Block-based outliner; local graph DB | Some community MCP integrations; no first-party | Single-user; collab is experimental | No | No | File-system; self-host |
| **Roam Research** | Block-based with bidirectional links; cloud-hosted graph | No first-party MCP; API access | Multi-player graphs (paid); permissions per page | No | No | Cloud account; graph sharing |

### What Each Competitor *Can't* Do (Defensibility Anchors)

| Capability | Anthropic | Mem.ai | Letta | Cognee | Zep | mem0 | Pieces | Notion | Obsidian |
|---|---|---|---|---|---|---|---|---|---|
| Layered scope (user → team → project → org) with hierarchical inheritance in one query | ✗ | ✗ | ✗ | ✗ | Partial (groups) | ✗ (flat tags) | ✗ | ✓ (UI-only, not MCP) | ✗ |
| MCP-native (not UI-first) and exposes the *memory abstraction*, not a wrapped product | ✗ | ✗ | ✗ | ✓ | ✓ | Partial | ✓ | ✗ (mirrors UI) | Partial |
| Pre-synthesized response envelope (synthesis + conflicts + coverage + gaps) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Schema-as-data user-extensible memory types (no redeploy) | ✗ | ✗ | Blocks (typed) | ✗ | ✗ | ✗ | ✗ | Databases (UI-only) | ✗ |
| Multi-source intake via shared pipeline (MCP + Slack + Drive → one store) | ✗ | Partial | ✗ | ✗ | Partial | ✗ | ✗ | ✓ (UI-side) | ✗ |
| Conflict detection at write time exposed to caller | ✗ | ✗ | ✗ | ✗ | ✓ (temporal) | ✓ (LLM-resolver) | ✗ | ✗ | ✗ |
| Open-core, user-owned data, no vendor lock-in (markdown/SQL export) | ✗ | ✗ | ✓ | ✓ | Partial | ✓ | Local-only | ✗ | ✓ |

**Reading this matrix:** Engram's defensible position is the intersection of layered scope + MCP-native + pre-synthesized envelope + multi-source intake. No single competitor has more than two of those four.

---

## Feature Landscape

### Table Stakes (Users Expect These)

If any of these are missing, users will say "this is broken." All map to existing MCP tools in CLAUDE.md.

| Feature | Why Expected | Complexity | MCP Tool | Milestone | Notes |
|---|---|---|---|---|---|
| Persistent storage across sessions | Anthropic native memory shipped this March 2026; users no longer believe AI memory is hard | LOW | `remember` | v0.1 | Foundational; just SQLite + DO |
| Semantic recall (not keyword) | Mem0, Zep, Cognee, Notion AI all do this; users expect "fuzzy" matching | MEDIUM | `recall` | v0.2 | Requires Vectorize + CF AI embeddings |
| Structured search with filters | Notion databases set this expectation; SQL-like filtering for power users | LOW | `search` | v0.1 | SQLite query layer; filters: type, project, scope, date range |
| Delete / forget specific memories | GDPR + general trust; users want a panic button | LOW | `forget` | v0.1 | Cascade flag is the nuance |
| Multi-source ingest pipeline | Mem.ai (Slack/email), Notion (connectors), Pieces (IDE/browser) — users assume AI memory accepts arbitrary content | HIGH | `ingest` | v0.1 contract / v0.4 connectors | v0.1 ships the tool + MemoryEvent contract; connectors land v0.4 |
| Entity extraction from raw content | Zep, Cognee, mem0 all extract; users expect "I dumped a transcript, it knew who was in it" | MEDIUM | `remember` (CF AI does it server-side) | v0.2 | Workers AI handles; never returns raw to Claude |
| Deduplication on write | mem0, Zep both do this; users hate seeing the same fact 5x | MEDIUM | `remember` (Vectorize similarity check) | v0.2 | Resolve-before-store in triage worker |
| Conflict / contradiction surfacing | mem0 invalidates, Zep tracks fact validity; bar is rising fast | MEDIUM | `conflict`, embedded in `recall`/`remember` envelope | v0.2 (detection) / v0.3 (`conflict` tool) | Detection at write, tool exposes pending conflicts |
| Multi-workspace / team sharing | Notion sets this expectation; Mem0 has scope tags. Without it, only a personal tool. | HIGH | All tools (`scope` param) | v0.3 | UserDO/TeamDO/ProjectDO hierarchy |
| Auth + permissioned access | Table stakes for anything shared; OAuth or JWT-per-workspace | MEDIUM | All tools (header-level) | v0.1 (JWT) / v1.0 (OAuth) | JWT-per-workspace v0.1; OAuth at v1.0 launch |
| Export / data portability | Notion has it (CSV/XLSX); Obsidian wins on it; users won't trust hosted memory without export | LOW | `export` | v0.3 | R2 signed URL pattern |

**Coverage check: does the 9-tool MCP surface cover table stakes?**

| Table Stake | Covered By | Verdict |
|---|---|---|
| Persistent storage | `remember` | ✓ |
| Semantic recall | `recall` | ✓ |
| Structured search | `search` | ✓ |
| Delete | `forget` | ✓ |
| Multi-source ingest | `ingest` | ✓ |
| Entity extraction | Server-side in `remember`/`ingest` | ✓ (correctly hidden from tool surface) |
| Deduplication | Server-side in `remember`/`ingest` | ✓ (correctly hidden) |
| Conflict surfacing | `conflict` + envelope `context.conflicts` | ✓ |
| Multi-workspace | `scope`/`project` params on every tool | ✓ |
| Auth | Header / transport layer | ✓ (out of MCP tool count) |
| Export | `export` | ✓ |

**Verdict: The 9-tool surface fully covers table stakes.** `reflect` and `relate` are differentiators (not table stakes), which is the correct allocation.

### Differentiators (Competitive Advantage)

These are where Engram beats the field. Each one is *defensible* (i.e., a competitor can't ship it in a sprint).

| Feature | Value Proposition | Complexity | MCP Tool | Milestone | Defensibility |
|---|---|---|---|---|---|
| **Hierarchical scoped memory (personal → team → project → org)** | One MCP query traverses all layers a user has access to; no other product does scoped inheritance | HIGH | All tools (`scope` param) | v0.3 | DO-per-workspace architecture is non-trivial; mem0's flat scope tags can't easily become hierarchical |
| **MCP-first interface (the tool surface IS the product)** | Every AI client gets the same answers; no UI dependency | MEDIUM | Entire surface | v0.1 | Notion/Mem.ai/Obsidian are all UI-first; rebuilding around MCP requires a redesign |
| **Pre-processed `EngramResponse` envelope (synthesis + conflicts + coverage + gaps)** | Claude reasons, doesn't process — radically reduces tokens & latency | MEDIUM | Wrapping every tool | v0.1 (envelope shape) / v0.2 (CF AI fills it) | Requires Workers AI integration on the hot path; not a config flag |
| **Schema-as-data memory types (user/community extensible)** | Job application, decision log, meeting notes as first-class typed records; community packs via R2 registry | MEDIUM | `remember` (type param), `memory_types` table | v0.1 (system types) / v0.3 (user types) / v1.0 (community registry) | Letta has typed blocks but not runtime-extensible; Notion DBs are UI-only |
| **`reflect` — deep synthesis with open-questions / gap detection** | Engram tells Claude what it *doesn't* know; turns memory into a research partner | HIGH | `reflect` | v0.3 | Requires the envelope's coverage signal + CF AI synthesis loop |
| **Slack ask-question = Claude ask-question (same store, same answer)** | The killer demo. Proves layered memory works end-to-end | HIGH | Slack connector + `recall` | v0.4 | Requires v0.1–v0.3 to be solid; multi-source intake + MCP must converge |
| **Proactive conflict alerts (Engram detects + posts to Slack)** | "You said the meeting is Tuesday but you also said Wednesday" — surfaces tensions humans miss | HIGH | `conflict` (active) + Slack connector | v0.4 | Requires triage worker + temporal reasoning + alert routing |
| **Inbox triage layer for low-confidence captures** | Humans review borderline items; avoids the "AI hallucinated this fact" trap | MEDIUM | (UI) + memorability scoring in `ingest` | v0.2 (scoring) / v0.4 (inbox UI) | Mem.ai auto-organizes (and is wrong sometimes); Engram is honest about uncertainty |
| **Progressive enrichment (phase 1 < 500ms, phases 2/3 via Queues)** | Claude never waits on the full pipeline; UX latency is bounded | HIGH | All ingest paths | v0.2 | Requires Queues + Workers; competitors that try this in Python are much slower |
| **CF-native cost structure (scale-to-zero)** | $5–20/mo managed pricing vs Zep enterprise; Cloudflare's pay-per-use makes the unit economics work | LOW (architectural choice) | N/A | v1.0 (pricing) | Stack lock-in is the moat; competitors on AWS/GCP can't match unit cost |
| **Open-core + self-host (user owns data, no lock-in)** | Letta and mem0 also OSS; differentiates from Mem.ai/Notion/Zep cloud-only | LOW | License + deploy docs | v1.0 | Architectural — must be designed in from day 1 (CF-only stack helps) |
| **`relate` — explicit knowledge graph edges as a first-class tool** | Cognee has this server-side; Engram exposes it to Claude as a verb | MEDIUM | `relate` | v0.3 | Most competitors infer relations; making it a verb invites richer agent loops |

### Anti-Features (Deliberately NOT Building)

These are features that look good in a feature comparison but undermine Engram's core thesis. The "Alternative" column is what we do *instead*.

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Real-time chat / sync** | Users see Notion's collab and assume memory needs it | DOs do support WebSockets but real-time memory mutation creates conflict storms; "memory" is not "chat" | Eventual consistency via Queues; conflict detection makes async safe |
| **Human browse UI as primary surface** | "How do I see my memories?" — the conventional Notion mental model | Forces every design decision toward visual organization; defeats the whole MCP-first thesis | MCP-first; UI (v0.4 inbox, v1.0 admin) is a strictly secondary convenience layer |
| **Mobile apps** | "I want to capture on the go" | App store overhead + native dev cost is enormous; Russell is solo + Devon's team | Slack/email connectors cover mobile capture; mobile-web UI later if needed |
| **Hosted-only / proprietary format** | Simpler GTM, better unit economics | Defeats "user owns memory" promise; alienates the OSS audience needed for thought-leadership goal | Open core: self-host free forever, managed $5–20/mo for convenience |
| **Auto-organize everything (Mem.ai pattern)** | "AI should figure out where things go" | Hallucinated organization erodes trust the first time it misfiles something important | Inbox triage for low confidence; user reviews ambiguous captures; high-confidence auto-stores |
| **Massive tool surface (15+ MCP tools)** | "More tools = more capability" | Claude's tool selection degrades with tool count; cognitive overhead spikes past ~10 | Hard cap at 9 tools; consolidate by verb not endpoint |
| **Real-time bidirectional sync with source systems** | "Edit in Engram, push back to Slack/Drive" | Multi-master conflict resolution across opinionated systems is a tar pit | Read-only ingest; source-of-truth stays in source system; Engram is the memory layer |
| **Native Notion/Linear/Asana integration as a feature** | "Compete with Notion AI directly" | These are connectors (v0.4+), not differentiators; competing head-on with Notion's UI loses | Connectors are commodity; the *layered memory traversal* is the differentiator |
| **Hand-edited memory blocks via a web editor** | "I want to fix that wrong fact" | Pulls product toward Notion-clone territory | `remember` with hint, `forget`, and conflict resolution covers it; CLI tools for power users |
| **LLM-routing / model abstraction (works with any LLM)** | "Don't lock me to Claude" | Adds complexity for a problem we don't have; CF Workers AI handles internals, MCP handles client-side | Use any MCP-compatible client; internals stay Workers AI |
| **Embedded RAG / retrieval as a service** | "Let me query my docs directly" | That's RAG, not memory; different product | `ingest` produces structured memories from docs, then `recall`/`reflect` |
| **End-user prompt customization for synthesis** | "Let me tune how synthesis works per query" | Surface area explosion; defeats the "Engram synthesizes correctly by default" promise | `reflect`'s `depth` param is the only knob; everything else is opinionated |
| **Browser extension for capture** | Mem.ai and Pieces both have this | Captures are better via MCP from inside Claude (where context is already structured) | MCP `remember` from Claude Desktop is the canonical capture path |

---

## Feature Dependencies

```text
[remember/recall/search/forget] (v0.1)
    └──requires──> [WorkspaceDO + SQLite schema] (v0.1)
                       └──requires──> [JWT auth] (v0.1)

[EngramResponse envelope] (v0.1 shape, v0.2 filled)
    └──requires──> [CF Workers AI integration] (v0.2)
                       └──requires──> [Vectorize] (v0.2)

[ingest] (v0.1 contract, v0.4 connectors)
    └──requires──> [MemoryEvent + Queue + Triage Worker] (v0.2)
                       └──requires──> [Memorability scoring] (v0.2)
                                          └──enables──> [Inbox triage] (v0.4)

[Multi-workspace (TeamDO/ProjectDO)] (v0.3)
    └──requires──> [WorkspaceDO + member table] (v0.1)
    └──enables──> [scope param on every tool] (v0.3)
                       └──enables──> [Slack-and-Claude same answer demo] (v0.4)

[Schema-as-data memory types] (v0.1 seed, v0.3 user-defined, v1.0 community)
    └──enables──> [reflect with typed synthesis] (v0.3)
    └──enables──> [export with type-aware columns] (v0.3)

[Conflict detection] (v0.2)
    └──requires──> [Vectorize similarity + CF AI scoring] (v0.2)
    └──enables──> [conflict tool] (v0.3)
    └──enables──> [Proactive Slack alerts] (v0.4)

[reflect + relate + export] (v0.3)
    └──requires──> [Multi-workspace + types]

[Connectors (Slack, Drive)] (v0.4)
    └──requires──> [Connector interface + Cron Workers]
    └──requires──> [ingest pipeline mature]

[Daily digest / inbox UI] (v0.4)
    └──requires──> [Memorability scoring + inbox table]

[Managed hosting + billing + OAuth] (v1.0)
    └──requires──> [Everything above stable]
    └──requires──> [Stripe + Cloudflare Access]
```

### Critical Dependency Notes

- **`recall` / `search` are technically operable in v0.1 without Vectorize** (SQLite full-text fallback). The contract ships v0.1; semantic backing arrives v0.2. This is the right call — it lets Russell dogfood the *shape* of the API early.
- **`ingest` ships v0.1 as a contract** (MemoryEvent + Queue plumbing) but real intake from external sources is v0.4. v0.1 ingest is essentially "MCP `remember` writes through the same pipeline."
- **The `EngramResponse` envelope must ship v0.1** even though most fields will be empty/null until v0.2 fills them. Adding the envelope later is a breaking change for every consumer.
- **Slack-and-Claude demo (v0.4) requires v0.3 multi-workspace.** Without TeamDO, "same store" isn't true. Don't try to fake it.
- **Schema-as-data memory types in `memory_types` table v0.1 enables v0.3 user types via simple INSERT.** The hard work is the type-aware UI (v0.4) and registry (v1.0), not the storage layer.

---

## MVP Definition (v0.1 — MCP Foundation)

### Launch With (v0.1)

The minimum to validate "Russell's job-search agent can `remember()` a job and `recall()` it in a new conversation."

- [x] `remember(content, type?, project?, tags?, source?, expires?)` — even if `type` inference is a stub returning `"note"` for everything
- [x] `recall(query, ...)` — backed by SQLite full-text search; Vectorize stub returns empty; envelope shows confidence=0.5
- [x] `search(query, filters)` — SQLite WHERE clauses; no semantic ranking yet
- [x] `forget(id, cascade?)` — straightforward DELETE
- [x] `ingest(source, ...)` — contract live; routes through MemoryEvent → Queue → Triage Worker (skeleton, no AI yet)
- [x] `WorkspaceDO` with the full SQLite schema (blocks, relations, tags, members, memory_types, inbox, conflicts)
- [x] System memory types seeded as data on workspace init
- [x] `EngramResponse` envelope wrapping every tool (most fields null/empty in v0.1)
- [x] `MemoryEvent` primitive
- [x] JWT-per-workspace auth (single user — Russell)
- [x] Wrangler deploy + MCP server reachable from Claude Desktop

**Notably NOT in v0.1:**
- `reflect`, `relate`, `export`, `conflict` tools — deferred to v0.3
- Vectorize integration — v0.2
- CF Workers AI integration — v0.2
- Multi-workspace — v0.3
- Connectors — v0.4

### Add After Validation

**v0.2 — Intelligence Layer (target 2026-06-21)**

- [ ] Vectorize integration (recall/search become semantic)
- [ ] CF Workers AI for embeddings, entity extraction, summarization, memorability scoring
- [ ] Triage Worker fully populated (chunking, dedup, conflict detection)
- [ ] EngramResponse envelope fields actually populated (synthesis, related, entities, conflicts, gaps)
- [ ] Progressive enrichment (phase 1 <500ms, phases 2/3 via Queue)
- [ ] Query expansion (3–4 semantic variants) in `recall`

**v0.3 — Workspaces + Types (target 2026-07-12)**

- [ ] UserDO / TeamDO / ProjectDO hierarchy
- [ ] Member management + roles (owner/editor/viewer)
- [ ] User-defined memory types (`memory_types` writes from MCP)
- [ ] `scope` param on every tool, with hierarchical traversal
- [ ] `reflect(topic, depth?, include_conflicts?)` tool
- [ ] `relate(id_a, id_b, relationship, properties?)` tool
- [ ] `export(query, format, filters?)` tool (R2 signed URLs)
- [ ] `conflict(passive?)` tool

**v0.4 — Connectors + Alerts (target 2026-08-02)**

- [ ] Slack connector (streaming + channel ingest)
- [ ] Google Drive connector (scheduled polling)
- [ ] Connector interface spec frozen
- [ ] Inbox UI (low-confidence triage review)
- [ ] Daily digest email
- [ ] Proactive conflict alerts to Slack
- [ ] **Killer demo lands here:** Ask Engram in Slack, get the same answer as Claude

### Future Consideration (v1.0+)

**v1.0 — Public Launch (target 2026-09-01)**

- [ ] Managed hosting (multi-tenant CF deployment)
- [ ] Stripe billing ($5–20/mo tiers)
- [ ] OAuth (replacing JWT-per-workspace for end users)
- [ ] Admin UI (workspace management, member invites, billing)
- [ ] Community memory-type pack registry on R2
- [ ] Linear, GitHub, Gmail, Calendar, Notion connectors
- [ ] OSS launch + HN post

**Post-v1.0**

- [ ] Mobile-web UI (defer until user demand is proven)
- [ ] Browser extension (only if users complain about capture friction)
- [ ] Native iOS/Android apps (only if Slack/email connectors don't cover mobile capture)
- [ ] Real-time WebSocket sync (only if collaborative editing becomes a user requirement)
- [ ] Custom embedding model fine-tuning per workspace

---

## Feature Prioritization Matrix (v0.1 scope)

Only listing v0.1-eligible features here. Later milestones get their own prioritization at `/gsd:new-milestone` time.

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| `WorkspaceDO` + SQLite schema | HIGH (everything depends on it) | MEDIUM | P1 |
| `remember` tool | HIGH | LOW | P1 |
| `recall` tool (SQLite FTS backing) | HIGH | LOW | P1 |
| `search` tool | MEDIUM | LOW | P1 |
| `forget` tool | MEDIUM | LOW | P1 |
| `EngramResponse` envelope shape | HIGH (locks contract) | LOW | P1 |
| `MemoryEvent` primitive | HIGH (locks ingest contract) | LOW | P1 |
| System memory types seeding | MEDIUM | LOW | P1 |
| JWT-per-workspace auth | HIGH (security) | LOW | P1 |
| `ingest` tool + Queue skeleton | MEDIUM (locks ingest contract) | MEDIUM | P1 |
| Triage Worker skeleton (no AI yet) | MEDIUM | MEDIUM | P1 |
| Wrangler deploy + Claude Desktop config | HIGH (dogfooding) | LOW | P1 |
| Russell's job-search agent integration | HIGH (validation) | LOW (consumer code) | P1 |
| Type inference (stub returning "note") | LOW | LOW | P2 |
| Confidence/coverage stub values in envelope | LOW | LOW | P2 |
| Migration tooling for SQLite schema | LOW (only Russell uses it) | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v0.1 launch — defines the contract Russell builds against
- P2: Nice to have, low cost — improves v0.1 polish
- P3: Defer to v0.2+

---

## Cross-Reference: MCP Tool Surface Audit

CLAUDE.md defines 9 tools. Auditing each against table-stakes coverage, differentiator support, and "doing too much / too little":

| Tool | Job-to-be-done | Verdict | Notes |
|---|---|---|---|
| `remember` | Single-shot capture, AI does type + entities + dedup + conflicts | **Right-sized** | Hot path; envelope return is critical |
| `recall` | Semantic query with query expansion + synthesis | **Right-sized** | Most-used tool; needs to be cheap |
| `search` | Structured query with filters; export hook (`format?`) | **Slightly overloaded** — `format?` blurs into `export`. Consider removing `format?` and forcing export-via-`export` | The format flag is convenient but couples two tools |
| `reflect` | Deep synthesis on a topic with gap detection | **Right-sized** — this is a differentiator | The `open_questions` field is unique vs competitors |
| `relate` | Explicit graph edge | **Right-sized** — atomic, single-purpose | Underused tools are fine if they're cheap |
| `forget` | Delete with optional cascade | **Right-sized** | Cascade semantics need care (relation cleanup) |
| `ingest` | Bulk + connector-driven ingest with priority knob | **Right-sized** | The `priority` knob ("fast"/"deep") is the only complexity worth having |
| `export` | Generate CSV/XLSX/JSON to R2 signed URL | **Right-sized** | Self-contained; could absorb `search`'s `format?` |
| `conflict` | Active scan vs passive read of known conflicts | **Slightly underused** — `passive=true` is mostly equivalent to a `recall("conflicts")` | Consider: do we really need this as a separate tool, or just an envelope field? But proactive scanning is real work, so keeping it separate is defensible |

### Recommendations

1. **Remove `format?` from `search`.** Force exports through `export` to keep tools single-purpose. Saves one mental load on Claude when picking tools.
2. **Keep `conflict` as a separate tool** despite the slight overlap with the envelope. The active-scan mode (`passive=false`) is genuinely a different operation (potentially expensive, user-initiated).
3. **Tool count after recommendation: still 9.** No headroom for new tools without removing one. Consider this when v1.0 community features come up — graph traversal, time-range navigation, etc. should NOT become new tools; they should become parameters on existing tools.
4. **All 9 tools must return the `EngramResponse` envelope** — even `forget` should return `meta.confidence` (was the delete clean?) and `suggestions.actions` (related items the user might also want to forget).

---

## Competitor Feature Analysis (Side-by-Side)

| Capability | Anthropic native | mem0 | Zep | Notion AI | Engram |
|---|---|---|---|---|---|
| Persistent memory across conversations | ✓ (per-user) | ✓ (scope-tagged) | ✓ (user-graph) | ✓ (workspace) | ✓ (layered) |
| Semantic search | N/A | ✓ (multi-signal) | ✓ (graph + vector) | ✓ (workspace AI) | ✓ (Vectorize + query expansion) |
| Team / multi-user | ✗ | Flat scope tags | Group-graphs (paid) | ✓ (UI-native) | ✓ (hierarchical DOs) |
| Conflict detection | ✗ | ✓ (LLM resolver) | ✓ (temporal) | ✗ | ✓ (CF AI + temporal) |
| MCP server | N/A (native) | Community | First-party | First-party hosted | **First-party, primary interface** |
| Pre-synthesized response (not raw) | Partial (in-context) | ✗ (returns raw) | ✗ (returns raw) | Partial (Notion AI synthesizes in UI) | ✓ (envelope-first) |
| Structured memory types | ✗ | ✗ (free-text) | ✓ (episodes/facts) | ✓ (databases, UI-only) | ✓ (schema-as-data, runtime-extensible) |
| Multi-source ingest pipeline | ✗ | ✗ (one add() at a time) | Partial (sources via SDK) | ✓ (connectors → workspace) | ✓ (MemoryEvent unifies all) |
| User owns data / self-host | ✗ | ✓ (OSS) | Partial (Apache 2 core) | ✗ | ✓ (open core) |
| Slack ingest + AI query same store | ✗ | ✗ | Partial | ✓ (UI-side) | ✓ (v0.4 — killer demo) |

---

## Sources

### Anthropic Claude Memory
- [Claude Memory 2026: Complete Guide](https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use)
- [Claude Features 2026: Projects, Artifacts, Memory, Computer Use, Skills, MCP](https://suprmind.ai/hub/claude/features/)
- [Memory tool - Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic adds persistent memory to Claude Managed Agents](https://www.edtechinnovationhub.com/news/anthropic-brings-persistent-memory-to-claude-managed-agents-in-public-beta)
- [Claude Memory Guide: 3-Layer Architecture](https://www.shareuhack.com/en/posts/claude-memory-feature-guide-2026)

### Mem.ai
- [Mem AI Review 2026: Features, Pricing & Alternatives](https://summarizemeeting.com/en/app-reviews/mem-ai)
- [15 Best Second Brain Apps in 2026](https://buildin.ai/blog/best-second-brain-apps-2026)
- [Mem Review 2026: Pricing & Features](https://productivitystack.io/tools/mem/)

### Letta / MemGPT
- [Letta (MemGPT) Review 2026](https://xyzeo.com/product/letta-memgpt)
- [Letta GitHub](https://github.com/letta-ai/letta)
- [Letta Docs - Research background](https://docs.letta.com/concepts/letta/)
- [Mem0 vs Letta vs MemGPT 2026 Comparison](https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026)
- [MemGPT is now part of Letta](https://www.letta.com/blog/memgpt-and-letta)

### Cognee
- [Cognee Memory Systems Guide](https://www.cognee.ai/blog/guides/ai-memory-systems-persist-across-sessions)
- [Cognee - Beyond Recall: Persistent Memory in AI Agents](https://www.cognee.ai/blog/tutorials/beyond-recall-building-persistent-memory-in-ai-agents-with-cognee)
- [Cognee MCP for Developers](https://www.cognee.ai/blog/cognee-news/introducing-cognee-mcp)
- [Cognee Profile - Barndoor AI](https://barndoor.ai/ai-tools/cognee-ai/)

### Zep / Graphiti
- [Zep - Context Engineering & Agent Memory Platform](https://www.getzep.com/)
- [Zep 2026 Review: AI Agent Temporal Memory King](https://weavai.app/blog/en/2026/05/09/zep-2026-review-ai-agent-temporal-memory-king/)
- [Zep: Temporal Knowledge Graph Architecture (arXiv)](https://arxiv.org/abs/2501.13956)
- [Knowledge Graph MCP Server | Zep Documentation](https://help.getzep.com/graphiti/getting-started/mcp-server)
- [Graphiti MCP Server by Zep](https://www.pulsemcp.com/servers/zep-graphiti)

### mem0
- [State of AI Agent Memory 2026 - Mem0 Blog](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Open Source Overview](https://docs.mem0.ai/open-source/overview)
- [Mem0: Production-Ready AI Agents with Long-Term Memory (arXiv)](https://arxiv.org/html/2504.19413v1)
- [Mem0 Architecture and Principles](https://medium.com/@zeng.m.c22381/mem0-overall-architecture-and-principles-8edab6bc6dc4)

### Pieces
- [Pieces MCP and Long-Term Memory](https://pieces.app/blog/mcp-memory)
- [Pieces MCP Features](https://pieces.app/features/mcp)
- [Pieces MCP with Claude Cowork](https://docs.pieces.app/products/mcp/claude-cowork)

### Notion AI
- [Meet your AI team | Notion](https://www.notion.com/product/ai)
- [Notion turned workspace into AI agent hub - TechCrunch](https://techcrunch.com/2026/05/13/notion-just-turned-its-workspace-into-a-hub-for-ai-agents/)
- [Notion MCP - Notion Docs](https://developers.notion.com/guides/mcp/mcp)
- [Notion Custom Agents (2026)](https://almcorp.com/blog/notion-custom-agents/)
- [Notion's hosted MCP server: an inside look](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [Best Notion MCP Servers 2026](https://mcp.directory/blog/best-notion-mcp-servers)

### Obsidian / Logseq / Roam
- [Obsidian vs Logseq 2026](https://thesoftwarescout.com/obsidian-vs-logseq-2026-which-note-taking-app-wins/)
- [Obsidian vs Roam vs LogSeq - The Sweet Setup](https://thesweetsetup.com/obsidian-vs-roam/)
- [I built an MCP server for Obsidian - Obsidian Forum](https://forum.obsidian.md/t/i-built-an-mcp-server-that-connects-claude-ai-directly-to-your-obsidian-vault/112454)
- [Obsidian MCP Tools - GitHub](https://github.com/jacksteamdev/obsidian-mcp-tools)
- [Obsidian MCP Server: Connect Your Vault to AI Agents (2026)](https://www.morphllm.com/obsidian-mcp-server)

### General / Cross-Reference
- [Best AI Agent Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/)
- [Agent Memory & Knowledge Systems Compared 2026](https://fountaincity.tech/resources/blog/agent-memory-knowledge-systems-compared/)
- [AI agent memory systems in 2026: Zep, Mem0, Letta](https://hermesos.cloud/blog/ai-agent-memory-systems)
- [Knowledge graph memory MCP server (reference)](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

---

*Feature research for: MCP-native layered memory system*
*Researched: 2026-05-24*
*Author: Claude (GSD researcher) for Russell Moore*
