# Engram — CLAUDE.md

> AI-native second brain. MCP-first memory infrastructure built on Cloudflare.
> Linear project: <https://linear.app/blackmagicconsulting/project/engram-3cebc9097d0e>
> Linear team: ENG

## Auto-Load Routing

- **Spike findings for engram** (Workers AI quality, EngramResponse synthesis contract, Phase 5 ranking strategy) → `Skill("spike-findings-engram")`
- **Phase 4 cf-code-assist routing tracker** (CLOSED — `/gsd:verify-work 4` passed 2026-05-27, status: passed) — kept as a reference artifact. See `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` End-of-Phase Summary for the post-mortem: 0/16 tasks routed to cf-code-assist; honest analysis showed 5 clear misses + 4 partial misses worth ~10–15K tokens. Do not extend.
- **Phase 5 cf-code-assist routing tracker** (ACTIVE — Phase 5 is the AI Integration phase, projected as a _content-generation_ phase that should route 40–60% to cf-code-assist) — every code-producing task during Phase 5 execution must append one row to `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` (file to be created by Plan 05-01). Each row must include the **3-question checklist** from `~/.claude/CLAUDE.md` AI Model Routing: (1) Is the SYNTHESIS step itself cross-file? (2) Is the diff >50 lines mechanical? (3) Is there a stable template/spec to anchor on? Answer the questions BEFORE committing the route, not after. Specific Phase 5 task shapes that should default to cf-code-assist: zod schemas for Triage AI structured outputs (`generateTypes`), vitest eval scripts on the F1 reference corpus (`scaffoldTests`), Triage Worker queue consumer scaffold (`generateWorkerBoilerplate`), `recall()` swap from `instr()` → Vectorize query (`transformCode`), 429-aware retry wrapper (`generateCode`), Workers Analytics Engine event-write helper (`generateCode`). Stop logging when `/gsd:verify-work 5` passes. The instruction propagates to spawned gsd-executor subagents via the "Project instructions: Read ./CLAUDE.md" line in each PLAN.md.

---

## What Is Engram

Engram is an open source, MCP-native second brain for AI assistants. Every AI client (Claude, Perplexity, Antigravity, etc.) has the same problem: no persistent memory across conversations. Engram fixes that by giving any MCP-compatible client a structured, searchable, semantic memory layer that the user owns and controls.

**The key inversion:** Notion was built for humans to browse. Engram is built for AI to query. The MCP tool surface is the product. A human UI is a secondary convenience layer.

---

## Core Design Principle

**Engram should return insights, not data. Claude should reason, not process.**

Every MCP response must:

- Pre-process so Claude receives minimum tokens for maximum utility
- Return synthesis, not raw records
- Include pre-detected conflicts
- Include pre-ranked results (Vectorize scoring, not Claude ranking)
- Include coverage signals so Claude knows what it doesn't know
- Extract entities at ingest time, not at query time

If a task can be done by Cloudflare AI, it must not be done by Claude. CF AI handles: embeddings, chunking, entity extraction, summarization, type inference, conflict detection, query expansion, deduplication. Claude handles: reasoning, synthesis, user interaction.

---

## Tech Stack

| Layer               | Technology                                        |
| ------------------- | ------------------------------------------------- |
| Compute             | Cloudflare Workers (TypeScript)                   |
| Workspace storage   | Cloudflare Durable Objects (SQLite per workspace) |
| Semantic search     | Cloudflare Vectorize                              |
| AI processing       | Cloudflare Workers AI                             |
| Async pipeline      | Cloudflare Queues                                 |
| File/export storage | Cloudflare R2                                     |
| Config/metadata     | Cloudflare KV                                     |
| Runtime             | Wrangler + TypeScript                             |
| Package manager     | npm workspaces (monorepo)                         |

---

## Repository Structure

````text
engram/
  packages/
    mcp-server/           # MCP Worker — primary interface for AI clients
    workspace-do/         # Durable Object — workspace actor, owns SQLite
    triage-worker/        # Conflict detection + memorability scoring
    connector-slack/      # Slack connector (v0.4)
    connector-drive/      # Google Drive connector (v0.4)
  shared/
    types/                # Shared TypeScript types (MemoryEvent, Memory, etc.)
    schema/               # System memory type definitions (schema-as-data)
    utils/                # Shared utilities
  docs/
    architecture.md       # Full architecture decisions
    mcp-tools.md          # MCP tool specs
    connectors.md         # Connector interface spec
  .claude/
    commands/             # GSD slash commands
  # No root wrangler config — each Worker package owns its own wrangler.jsonc.
  package.json            # Workspace root
  README.md
  CLAUDE.md               # This file
```text

*Note: `ingest-worker` was an earlier design — folded into `triage-worker` for v0.1; reintroduced in v0.4 if connector volume warrants it.*

---

## Architecture

### Durable Object Per Workspace

Every user/team gets their own `WorkspaceDO`. It owns:

- SQLite database (blocks, relations, tags, members, memory types)
- All business logic for that workspace
- WebSocket connections for real-time sync (future)

The Worker is a thin router: authenticate → resolve workspace → proxy to correct DO.

**DO Hierarchy:**
```test

UserDO          personal memories, identity, preferences
  └── TeamDO    shared team knowledge, membership
        └── ProjectDO   isolated per-project memory (own DO, not partition)

```text

Project DOs are fully isolated — not partitions of TeamDO. This enables clean archiving, transfer, and deletion without coordination.

### Session DO vs Workspace DO

Each Worker that hosts an MCP endpoint actually owns **two DO classes** declared in the same `wrangler.jsonc`:
- **`EngramMcp`** — auto-managed by `agents/mcp` `McpAgent`; holds transient MCP session state (per active client connection). Lifecycle: one DO instance per session, garbage-collected when the session ends.
- **`WorkspaceDO`** — durable, per-workspace, reached via `getAgentByName(env.WORKSPACE, this.props.workspace_id)` after JWT validation. This is where the SQLite store lives.

Both are declared together under `migrations[0].new_sqlite_classes: ["EngramMcp", "WorkspaceDO"]`. SQLite-backed (not KV-backed) is irreversible per Cloudflare's migration rules.

### SQLite Schema (inside WorkspaceDO)

```sql
-- Universal block primitive (everything is a block)
CREATE TABLE blocks (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,        -- memory_type id
  content      TEXT,                 -- raw original content
  summary      TEXT,                 -- CF AI generated summary
  properties   JSON,                 -- typed fields per memory type
  embedding_id TEXT,                 -- Vectorize vector reference
  scope        TEXT DEFAULT 'personal', -- personal | project | org
  project_id   TEXT,
  source       TEXT,                 -- mcp:claude | connector:slack | etc.
  confidence   REAL,                 -- CF AI classification confidence
  created_at   INTEGER,
  updated_at   INTEGER
);

-- Explicit knowledge graph edges
CREATE TABLE relations (
  from_id      TEXT,
  to_id        TEXT,
  relationship TEXT,                 -- "works_at" | "interviewed_by" | etc.
  properties   JSON,
  created_at   INTEGER,
  PRIMARY KEY (from_id, to_id, relationship)
);

-- Tags (user-applied and AI-inferred)
CREATE TABLE tags (
  block_id     TEXT,
  tag          TEXT,
  source       TEXT                  -- "user" | "ai"
);

-- Workspace membership
CREATE TABLE members (
  user_id      TEXT,
  role         TEXT,                 -- owner | editor | viewer
  invited_by   TEXT,
  joined_at    INTEGER
);

-- Schema-as-data: memory types are stored records, not hardcoded classes
CREATE TABLE memory_types (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  fields       JSON,                 -- field definitions with types
  workspace_id TEXT,                 -- null = system default
  source       TEXT                  -- "system" | "user" | "community"
);

-- Inbox: low-confidence captures pending human review
CREATE TABLE inbox (
  id           TEXT PRIMARY KEY,
  content      TEXT,
  proposed_type TEXT,
  proposed_properties JSON,
  memorability_score REAL,
  source       TEXT,
  created_at   INTEGER
);

-- Detected conflicts pending resolution
CREATE TABLE conflicts (
  id           TEXT PRIMARY KEY,
  memory_a_id  TEXT,
  memory_b_id  TEXT,
  description  TEXT,
  severity     TEXT,                 -- low | medium | high
  detected_at  INTEGER,
  resolved_at  INTEGER
);
````

### Memory Types (Schema-as-Data)

Memory types are NOT TypeScript classes. They are records in the `memory_types` table. System types are seeded at workspace creation. Users can create custom types. Community types can be installed from the R2 registry.

**System types to seed:**

- `job_application` — company, role, status, applied_date, salary_range, source, url, contact
- `contact` — name, email, company, role, relationship, notes
- `company` — name, industry, size, url, notes
- `project` — name, status, owner, deadline, description
- `research_note` — title, topic, source_url, summary, tags
- `decision_log` — decision, rationale, owner, date, project
- `meeting_note` — date, attendees, decisions, action_items, project

**Field types supported:** text, number, date, url, select, multi_select, boolean, relation, range

### MemoryEvent (Universal Intake Primitive)

Every intake path — MCP tool call, scheduled connector, webhook — produces a `MemoryEvent`. The triage worker consumes all of them identically.

```typescript
type MemoryEvent = {
  id: string;
  source: string; // "mcp:claude" | "connector:slack" | "scheduler:drive"
  content: string; // raw content
  hint?: string; // user intent if explicit
  context?: object; // source metadata
  workspace_id: string;
  timestamp: number;
};
```

### Ingest Pipeline

````text
Source → MemoryEvent → Queue → Triage Worker → WorkspaceDO

Triage Worker steps:
  1. Detect content type
  2. Chunk intelligently (semantic boundaries, 512 token max, 50 token overlap)
  3. CF AI: extract entities per chunk
  4. CF AI: summarize per chunk
  5. CF AI: score memorability (0-1)
     > 0.8  → store automatically
     0.4-0.8 → inbox for review
     < 0.4  → cold-storage (per Phase 5 CONTEXT.md D-07 cardinal-sin clause — NEVER discard)
  6. CF AI: embed each chunk → Vectorize
  7. Resolve against existing memory (duplicate/update/conflict detection)
  8. Store to WorkspaceDO SQLite
  9. Run conflict detection against related memories
```text

**Progressive enrichment (3 phases):**

- Phase 1 immediate (<500ms): basic extraction, top memories, return to caller
- Phase 2 background (seconds): full chunking, embeddings, relationships via Queue
- Phase 3 async (minutes): cross-workspace entity resolution, trend detection

---

## MCP Tool Surface

The tools are verbs, not endpoints. Nine tools maximum — cognitive overhead for Claude scales with tool count.

The Worker uses `import { McpAgent } from "agents/mcp"` and serves via `EngramMcp.serve("/mcp")`. Do NOT use raw `@modelcontextprotocol/sdk` HTTP transports — they depend on `node:http` and will not run on `workerd`.

### Core Tools

```typescript
remember(content, type?, project?, tags?, source?, expires?)
  // CF AI: infer type, extract entities, embed, detect conflicts
  // Returns: id, classified_type, extracted_fields, conflicts[], confidence

recall(query, types?, project?, scope?, limit?, since?, until?)
  // CF AI: expand query to 3-4 semantic variants
  // Vectorize: search all variants, deduplicate, rank
  // Returns: memories[], synthesis (CF AI summary), related[], conflicts[]

search(query, filters)
  // Structured query with explicit filters
  // Returns: memories[], count
  // Note: export(query, format, filters?) is a separate v0.3 tool — see Milestones.

reflect(topic, depth?, include_conflicts?)
  // Deep synthesis across all related memories
  // Returns: synthesis, key_facts[], timeline?, entities[], open_questions[]
  // open_questions = gaps Engram detected in its own knowledge

relate(id_a, id_b, relationship, properties?)
  // Explicit knowledge graph edge
  // Returns: relation record

forget(id, cascade?)
  // Remove memory, optionally cascade to related
  // Returns: deleted_count

ingest(source, type?, project?, priority?, threshold?)
  // Fetch + chunk + embed + store
  // priority: "fast" (phase 1 only) | "deep" (all phases)
  // Returns: status, memories_created, memories_updated, conflicts_found,
  //          entities_extracted, synthesis, inbox_items, job_id?

export(query, format, filters?)
  // Generate CSV/XLSX/JSON, upload to R2, return signed URL
  // Returns: url, expires_at, record_count

conflict(passive?)
  // passive=true: return known conflicts
  // passive=false: actively scan for new ones
  // Returns: conflicts[] with severity, description, sources
````

### Universal Response Envelope

Every MCP response follows this shape:

```typescript
type EngramResponse<T> = {
  result: T; // the actual answer
  context: {
    related: Memory[]; // pre-fetched adjacent memories
    entities: Entity[]; // pre-extracted people/companies/things
    timeline?: Event[]; // pre-constructed if chronological
    conflicts?: Conflict[]; // pre-detected tensions
  };
  meta: {
    confidence: number; // 0-1, how sure is Engram
    coverage: number; // 0-1, completeness signal for Claude
    last_updated: number;
    gaps: string[]; // what Engram doesn't know but probably should
  };
  suggestions?: {
    actions: string[]; // "ask user about testing owner"
    queries: string[]; // related things worth knowing
  };
};
```

---

## Connector Interface

Every connector implements this interface. Connectors are independent Cron Workers.

```typescript
interface EngramConnector {
  id: string;
  schedule: string; // cron expression
  fetch(): Promise<RawContent[]>;
  diff(previous: string, current: string): Change[];
}
```

Adding a new connector = adding a new Cron Worker. No core changes needed.

**v0.4 connectors:** Slack (streaming, channel ingestion), Google Drive (scheduled polling)
**Future:** Linear, GitHub, Gmail, Calendar, Notion

---

## Milestones

| Milestone                | Target     | Description                                                       |
| ------------------------ | ---------- | ----------------------------------------------------------------- |
| v0.1 MCP Foundation      | 2026-06-07 | DO, SQLite schema, core MCP tools, single user                    |
| v0.2 Intelligence Layer  | 2026-06-21 | Vectorize, CF AI, ingest pipeline, conflict detection             |
| v0.3 Workspaces + Types  | 2026-07-12 | Multi-workspace, Project DOs, memory types, reflect/relate/export |
| v0.4 Connectors + Alerts | 2026-08-02 | Slack, Drive connectors, daily digest, inbox UI                   |
| v1.0 Public Launch       | 2026-09-01 | Managed hosting, billing, OSS launch                              |

`ingest-worker` is **not** part of v0.1. The triage-worker consumes the Queue directly. The `ingest-worker` package returns in v0.4 when external connectors (Slack, Drive) need a general ingest orchestration layer.

---

## Development Guidelines

### What Goes Where

| Task                     | Where                                |
| ------------------------ | ------------------------------------ |
| Embeddings               | CF Workers AI                        |
| Entity extraction        | CF Workers AI                        |
| Chunking + summarization | CF Workers AI                        |
| Conflict detection       | Triage Worker (CF AI scoring)        |
| Deduplication            | Triage Worker (Vectorize similarity) |
| Memorability scoring     | Triage Worker (CF AI)                |
| Query expansion          | MCP Server (CF AI before Vectorize)  |
| Semantic ranking         | Vectorize                            |
| Reasoning + synthesis    | Claude (via MCP response)            |
| User interaction         | Claude                               |

### Never Do This

- Never pass raw document content to Claude — ingest and summarize first
- Never return unranked memory lists — always rank before returning
- Never store duplicates — always resolve against existing
- Never hardcode memory type schemas — they are data, not code
- Never build UI before MCP tool surface is validated

### Auth Pattern

JWT per workspace. Worker validates JWT, extracts workspace_id, proxies to correct DO. DO trusts workspace_id from Worker. Simple, stateless at the Worker layer.

### Naming Conventions

- Workers: `engram-{name}-worker`
- DOs: `WorkspaceDO`, `UserDO`, `ProjectDO`
- KV namespaces: `ENGRAM_CONFIG`, `ENGRAM_SESSIONS`
- R2 buckets: `engram-storage`, `engram-exports`, `engram-registry`
- Queues: `engram-ingest`, `engram-conflicts`, `engram-digest`

---

## v0.1 Scaffold Target

First GSD session should produce:

````text
engram/
  packages/
    mcp-server/
      src/
        index.ts          # Worker entry, MCP handler
        tools/
          remember.ts
          recall.ts
          search.ts
          forget.ts
      wrangler.jsonc
      package.json
    workspace-do/
      src/
        index.ts          # DO class
        schema.ts         # SQLite init + migrations
        queries.ts        # typed query helpers
      package.json
  shared/
    types/
      index.ts            # MemoryEvent, Memory, EngramResponse, etc.
    schema/
      system-types.ts     # system memory type seed data
  package.json            # workspace root
  tsconfig.json
  README.md
  CLAUDE.md
```text

---

## Linear Workflow

This project uses Linear (team: ENG, project ID `a0f0e1f5-1cbc-48de-8f7a-7c8bbafc25b2`) for issue tracking. The Linear MCP is connected in Claude Code — use it actively. The canonical sync rules live in `.planning/PROJECT.md` under "Project Tracking → Linear Sync Convention"; this section is a quick-reference duplicate so Claude honors it even when GSD slash commands aren't in play.

**Phase = Linear Issue.** One Linear issue per GSD phase. Claude auto-syncs without per-issue confirmation. Exact mapping:

| GSD event | Linear action |
| --- | --- |
| `/gsd:plan-phase N` produces PLAN.md | Create issue in team `ENG`, link to milestone `vX.Y — Name`, state `Todo`, description = phase goal + plan summary + link to PLAN.md path |
| `/gsd:execute-phase N` begins | Update issue state → `In Progress` |
| `/gsd:execute-phase N` completes (verification passes) | Update state → `Done` (or `In Review` if a PR is opened next) |
| `/gsd:ship` creates PR | Append PR link to issue, transition to `In Review` until merge |
| Phase blocker logged | Add comment to issue, keep state `In Progress` |
| `/gsd:complete-milestone` runs | Verify all milestone issues are `Done`; post milestone summary comment on the Linear milestone |

**When to create Linear issues:**

- Each GSD phase maps to exactly one ENG issue
- Bugs discovered during development → new issue immediately
- Architecture decisions worth tracking → Decision Log issue
- Any task taking more than one session → issue first

**Status flow:**

```text
Backlog → Todo → In Progress → In Review → Done
```text

**Milestones to reference:**

- v0.1 MCP Foundation — target 2026-06-07
- v0.2 Intelligence Layer — target 2026-06-21
- v0.3 Workspaces + Memory Types — target 2026-07-12
- v0.4 Connectors + Alerts — target 2026-08-02
- v1.0 Public Launch — target 2026-09-01

**Linear MCP commands available in Claude Code:**

- Create issues, update status, add comments directly via MCP
- No need to leave the editor for routine Linear updates
- Use issue IDs (ENG-xx) in commit messages and PR descriptions

---

## Development Setup

```bash
# 1. Install Claude Code
# 2. Install GSD plugin inside Claude Code:
#    /plugin marketplace add jnuyens/gsd-plugin
#    /plugin install gsd@gsd-plugin
#    /reload-plugins
# 3. Clone repo
gh repo clone <org>/engram
cd engram
# 4. Install dependencies
npm install
# 5. Open in VS Code, launch Claude Code
# 6. Get oriented
#    /gsd:map-codebase
````

GSD is the recommended development workflow. Commands use `/gsd:` prefix (colon, not hyphen).

---

## Key Decisions Log

- **Durable Objects over D1** — workspace isolation by default, no sharding complexity, clean archive/delete semantics
- **Project DOs isolated, not partitioned** — enables clean project lifecycle, no cross-project leakage
- **Schema-as-data for memory types** — not TypeScript classes, enables user/community extensibility without deployment
- **MemoryEvent as universal primitive** — unifies MCP, connectors, webhooks through same intake pipeline
- **CF AI for all grunt work** — embeddings, extraction, summarization never touch Claude tokens
- **MCP tool surface max 9 tools** — cognitive overhead constraint, forces consolidation
- **Inbox as triage layer** — low-confidence captures staged for human review, not auto-stored
- **Progressive enrichment** — Phase 1 fast return, Phase 2/3 via Queues, Claude never waits for full pipeline
- **Open core business model** — self-hosted free forever, managed cloud $5-20/mo
