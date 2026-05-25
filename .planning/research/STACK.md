# Technology Stack — Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Researched:** 2026-05-24
**Stack constraint:** Cloudflare end-to-end (non-negotiable per PROJECT.md)
**Overall stack confidence:** HIGH for Cloudflare primitives + Wrangler; HIGH for MCP SDK + Agents SDK pairing; MEDIUM for Vitest Workers pool (config surface still moving); MEDIUM for AI model selection (the right model depends on prompt design — recommendations below are starting points, not gospel).

---

## TL;DR — The Prescribed Stack

| Layer | Pick | Version | Confidence |
|---|---|---|---|
| Runtime | Cloudflare Workers (TypeScript, ES modules) | `compatibility_date = "2026-05-22"`, `nodejs_compat` enabled | HIGH |
| Wrangler CLI | `wrangler` | `^4.94.0` (latest stable 2026-05-22) | HIGH |
| Worker types | `@cloudflare/workers-types` | `^4.20260525.1` | HIGH |
| Config format | `wrangler.jsonc` (NOT `wrangler.toml`) | per-package | HIGH |
| MCP SDK | `@modelcontextprotocol/sdk` v2.x | `^1.29.0` (track v2 branch — `__branch__v1.x` is legacy) | HIGH |
| MCP-on-Workers adapter | `agents` (Cloudflare Agents SDK, McpAgent class) | `^0.13.2` | HIGH |
| Schema validation | `zod` | `^4.4.3` | HIGH |
| Storage (per workspace) | Durable Object with SQLite — `ctx.storage.sql.exec` | built-in | HIGH |
| Semantic search | Vectorize V2 (NOT V1) | built-in | HIGH |
| AI grunt work | Workers AI bindings, `env.AI.run(...)` | built-in | HIGH |
| Async pipeline | Cloudflare Queues | built-in | HIGH |
| Blob/export | Cloudflare R2 | built-in | HIGH |
| Config/metadata | Cloudflare KV | built-in | HIGH |
| Build | esbuild (built into Wrangler — do not add Vite or tsc-as-bundler) | bundled with Wrangler | HIGH |
| Package manager | npm workspaces (per PROJECT.md constraint) | npm 10+ | HIGH |
| Test runner | Vitest + `@cloudflare/vitest-pool-workers` | Vitest `^4.1.7`, pool `^0.9.x` (track latest at scaffold time) | MEDIUM |
| TypeScript | `typescript` | `^6.0.3` | HIGH |

---

## 1. MCP Server on Cloudflare Workers

### The Big Choice: `agents` (McpAgent) vs raw MCP SDK on Workers

**Pick: `agents` SDK with the `McpAgent` class for the public Engram MCP server.**

The decision pivots on transport. The Model Context Protocol officially deprecated SSE in favor of **Streamable HTTP** (March 2025 spec). Cloudflare's `agents` SDK is the only first-party path that:

1. Implements Streamable HTTP cleanly inside the Workers runtime (Node-only transports from the official SDK like `NodeStreamableHTTPServerTransport` will not load in `workerd`).
2. Backs each MCP session with its own Durable Object — meaning session state, tool-call history, and an embedded SQL database persist across reconnects without you writing a session store.
3. Exposes `McpAgent.serve("/mcp")` as a one-line Worker default export.
4. Bundles OAuth/auth via `@cloudflare/workers-oauth-provider` (`^0.7.0`) for the v1.0 multi-tenant phase.

**Anti-pattern: Do NOT try to use `@modelcontextprotocol/sdk`'s `NodeStreamableHTTPServerTransport` directly on Workers.** It depends on `node:http` request/response objects. The MCP SDK's v2 migration notes explicitly call out a Cloudflare Workers path that requires using the Workers-flavored adapter — that adapter is exactly what `agents/mcp` provides.

**Pattern for Engram's MCP server (recommended):**

```typescript
// packages/mcp-server/src/index.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class EngramMcp extends McpAgent {
  server = new McpServer({ name: "engram", version: "0.1.0" });

  async init() {
    this.server.registerTool(
      "remember",
      {
        description: "Store a memory and return classified + extracted result",
        inputSchema: {
          content: z.string(),
          type: z.string().optional(),
          project: z.string().optional(),
          tags: z.array(z.string()).optional(),
          source: z.string().optional(),
          expires: z.string().optional(),
        },
      },
      async (args) => {
        // route to WorkspaceDO via service binding / DO namespace
        // CF AI handles classify + extract + embed; this method returns synthesis
        // ...
      }
    );
    // ...register remaining tools
  }
}

export default EngramMcp.serve("/mcp");
```

**Stateless tool path (alternative for utility Workers):** `createMcpHandler(server)(request, env, ctx)` from `agents/mcp` — use for the auxiliary connector Workers in v0.4 that just need to push `MemoryEvent`s, not hold session state.

### MCP SDK Version

- `@modelcontextprotocol/sdk` is at **v1.29.0** on npm (latest, 2026-03-30).
- Context7 shows the canonical branch is `__branch__v1.x` and there's a v2 migration in progress. v1.29.x is the version `agents@0.13.2` integrates against today.
- **Verified via Context7:** the v2 migration doc explicitly addresses Cloudflare Workers — in v1, you passed `jsonSchemaValidator: new CfWorkerJsonSchemaValidator()`; in v2, that's auto-selected. Use the v2-style constructor.
- **Pin to `^1.29.0`** for v0.1. Bump when `agents` releases a 1.0 that requires MCP SDK v2.

### Claude Desktop Connection

For v0.1 (Russell-only), use `mcp-remote` to bridge Claude Desktop's stdio expectation to the remote HTTP endpoint:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["mcp-remote", "https://engram-mcp.<account>.workers.dev/mcp"]
    }
  }
}
```

**Risk flag (MEDIUM):** `mcp-remote` is community-maintained. Watch for Claude Desktop adding native Streamable HTTP support; when it does, drop `mcp-remote` and connect directly. Track Claude Desktop changelog quarterly.

---

## 2. Durable Objects + SQLite

### Use `ctx.storage.sql.exec` — the SQLite Storage API

The SQLite-backed Durable Objects API is the recommended path for **all new DO namespaces** as of late 2025. Cloudflare documentation: _"Cloudflare recommends all new Durable Object namespaces use the SQLite storage backend."_

| API | Use? | Why |
|---|---|---|
| `ctx.storage.sql.exec<T>(sql, ...bindings)` | YES — primary | Stable, billed as of Jan 2026, zero-latency colocated queries, fits Engram's relational schema |
| `ctx.storage.put/get/delete/list` (KV-style) | NO for new tables | Legacy. On SQLite-backed DOs it just writes to a hidden `__cf_kv` table you can't query via SQL. Pointless indirection. |
| `state.storage.transaction(...)` | Optional | The SQL API is implicitly transactional per call; only reach for `transaction()` when you need multi-statement atomicity that spans business logic |

**Stability note (verified via Cloudflare docs):** _"Storage billing on SQLite-backed Durable Objects will be enabled in January 2026"_ — so the API surface itself is stable and production; billing turning on is the only behavior change you'll see. v0.1 is already past that date, plan for storage costs on day one.

### Required `wrangler.jsonc` migration directive

For a **new** SQLite-backed DO class, the migration uses `new_sqlite_classes` (NOT `new_classes` — that creates a legacy KV-backed DO and there is no in-place upgrade path yet):

```jsonc
// packages/workspace-do/wrangler.jsonc
{
  "name": "engram-workspace-do",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "WORKSPACE_DO", "class_name": "WorkspaceDO" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["WorkspaceDO"] }
  ]
}
```

**Anti-pattern:** Using `new_classes` instead of `new_sqlite_classes`. The class will be created KV-backed and you cannot retroactively switch. Hard rebuild required.

### DO Class Skeleton for Engram

```typescript
// packages/workspace-do/src/index.ts
import { DurableObject } from "cloudflare:workers";

type BlockRow = {
  id: string; type: string; content: string | null; summary: string | null;
  properties: string; embedding_id: string | null; scope: string;
  project_id: string | null; source: string; confidence: number;
  created_at: number; updated_at: number;
};

export class WorkspaceDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Initialize schema on first boot — idempotent
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT,
        summary TEXT,
        properties TEXT,
        embedding_id TEXT,
        scope TEXT DEFAULT 'personal',
        project_id TEXT,
        source TEXT,
        confidence REAL,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(type);
      CREATE INDEX IF NOT EXISTS idx_blocks_project ON blocks(project_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_updated ON blocks(updated_at DESC);
      -- ...relations, tags, members, memory_types, inbox, conflicts
    `);
  }

  async insertBlock(b: BlockRow): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO blocks (id, type, content, summary, properties, embedding_id,
        scope, project_id, source, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id, b.type, b.content, b.summary, b.properties, b.embedding_id,
      b.scope, b.project_id, b.source, b.confidence, b.created_at, b.updated_at
    );
  }

  async findById(id: string): Promise<BlockRow | undefined> {
    return this.ctx.storage.sql
      .exec<BlockRow>("SELECT * FROM blocks WHERE id = ?", id)
      .toArray()[0];
  }
}
```

**Per-DO storage limits (current Cloudflare quotas):** 10 GB SQLite per DO, 2 GB practical recommended limit before you should re-shard. For Engram, one user's memory base is unlikely to approach this in v0.1–v1.0, but flag it for v0.3 when teams enter.

---

## 3. Workers AI — Model Selections

Workers AI pricing is **per-Neuron**, with each model published rate in $/M tokens (also reported as Neurons/M tokens). Paid plan gets **10,000 Neurons/day free**, overage `$0.011 / 1,000 Neurons`. Engram should design every CF AI call around this floor — for Russell-only v0.1, the daily free tier will absorb most usage.

### Embeddings: `@cf/baai/bge-base-en-v1.5`

| Spec | Value |
|---|---|
| Model ID | `@cf/baai/bge-base-en-v1.5` |
| Dimensions | **768** |
| Pricing | $0.067/M input tokens (~6,058 Neurons/M tokens) |
| Use case | Default Engram embedding model |
| Confidence | HIGH |

**Why this over `bge-large-en-v1.5` (1024d):** 33% cheaper, smaller Vectorize storage footprint, marginal quality difference for short personal-memory text. Cost matters when you're embedding every chunk + every query expansion variant (3-4× multiplier for `recall`).

**Why this over `bge-m3` (cheapest at $0.012/M):** `bge-m3` is multilingual + multi-granularity. For an English-first personal memory tool, the BGE base English model is better tuned. Revisit `bge-m3` only if multilingual content becomes a real use case.

**Vectorize index config:**
```bash
npx wrangler vectorize create engram-memories --dimensions=768 --metric=cosine
```
Or with a preset (preferred — preset locks dim+metric so you can't mismatch later):
```bash
npx wrangler vectorize create engram-memories --preset=@cf/baai/bge-base-en-v1.5
```

### Text generation / structured extraction / summarization: `@cf/meta/llama-3.1-8b-instruct`

| Spec | Value |
|---|---|
| Model ID | `@cf/meta/llama-3.1-8b-instruct` |
| Pricing | $0.282/M input, $0.827/M output tokens |
| Context window | ~128k tokens (industry standard for Llama 3.1) |
| Confidence | MEDIUM |

**Use this for v0.1 for:** type classification, entity extraction, short summarization, memorability scoring. Use Workers AI's **structured JSON output** (`response_format: { type: 'json_schema', schema: ... }`) so the model returns parseable shapes, not free text.

**Upgrade path for v0.2+ when reasoning quality matters more (e.g., `reflect`):**
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — $0.293/M input, $2.253/M output. Roughly 3× output cost; reach for it when synthesis quality bites you, not before.
- `@cf/mistralai/mistral-small-3.1-24b-instruct` — $0.351/M input, $0.555/M output. Cheaper output than 70B Llama, similar reasoning band. Good middle option.

**Vercel AI SDK (`workers-ai-provider` `^3.1.14`) is the recommended client for structured outputs.** It pairs `generateObject({ model, prompt, schema: z.object({...}) })` with Zod schemas — much cleaner than hand-rolling `response_format: { type: 'json_schema' }` payloads.

```typescript
import { createWorkersAI } from "workers-ai-provider";
import { generateObject } from "ai";
import { z } from "zod";

const workersai = createWorkersAI({ binding: env.AI });
const { object } = await generateObject({
  model: workersai("@cf/meta/llama-3.1-8b-instruct"),
  prompt: `Classify and extract from: ${content}`,
  schema: z.object({
    type: z.enum(["job_application", "contact", "company", /* ... */]),
    confidence: z.number().min(0).max(1),
    properties: z.record(z.string(), z.any()),
    entities: z.array(z.object({ name: z.string(), kind: z.string() })),
  }),
});
```

### Memorability scoring

There is **no first-party memorability model**. Implement as a prompt-engineered classifier on top of Llama 3.1-8B with a 0–1 numeric output. This is a place where prompt design matters more than model — flag for prompt iteration in v0.2 phase research.

### Rate limits (verified — current as of 2026-05-24)

Workers AI does not publish hard per-minute caps for these models; the practical ceiling is **Neuron daily allocation** (10k/day free, then pay). For the v0.2 ingest worker that fans out embeddings, batch where the model supports it — `@cf/baai/bge-base-en-v1.5` accepts arrays of strings in one call.

---

## 4. Vectorize — Hard Limits (V2)

**Use V2. Never use `--deprecated-v1`.** V1 is a dead-end (200k vector cap, smaller top-K).

| Limit | V2 (use this) | V1 (avoid) |
|---|---|---|
| Max vectors per index | **10,000,000** | 200,000 |
| Max dimensions | 1536 | 1536 |
| Max metadata bytes per vector | 10 KiB | 10 KiB |
| Max namespaces per index | 50,000 (Paid) / 1,000 (Free) | 1,000 |
| Max top-K (with values or metadata="all") | **50** | 20 |
| Max top-K (without values/metadata) | 100 | 20 |
| Max upsert batch (Workers binding) | 1,000 | 1,000 |
| Max upsert batch (HTTP API) | 5,000 | 5,000 |

**Pricing:** 50M queried vector-dimensions/month free, $0.01 per additional million queried. 10M stored vector-dimensions free, $0.05 per additional 100M stored. For Engram with 768d embeddings: 10M free storage = ~13,000 vectors free, and 50M free queries = ~65,000 free queries/month. Russell-only v0.1 sits comfortably in free tier.

### Metadata Filtering — set this up at index creation time

Metadata indexes must be declared **before** the first vector insert that references them. For Engram's `search` tool to filter by `type`, `project_id`, `scope`, `source` — create those indexes immediately after creating the Vectorize index:

```bash
npx wrangler vectorize create-metadata-index engram-memories --propertyName=type --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=project_id --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=scope --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=source --type=string
```

**Anti-pattern: stuffing all filterable fields into one giant `properties` JSON object inside metadata.** Vectorize filters work per-property — design metadata as flat key/value with explicit types. Hierarchical properties cost an extra query layer in your code.

### Query shape

```typescript
const matches = await env.VECTORIZE.query(queryEmbedding, {
  topK: 20,                          // remember: max 50 if returnValues/returnMetadata="all", max 100 otherwise
  returnValues: false,               // never return vectors to Claude — wasted bytes
  returnMetadata: "indexed",         // "all" or "indexed" — "indexed" is cheaper and usually enough
  namespace: workspaceId,            // use namespace to partition by workspace, NOT separate indexes
  filter: { type: { $eq: "job_application" }, scope: { $in: ["personal", "project"] } },
});
```

**Critical pattern:** Use Vectorize **namespaces** to partition per workspace, not one index per workspace. Index creation/deletion is heavyweight; namespaces are lightweight (up to 50k per index on Paid). This pairs naturally with Engram's per-workspace DOs — workspace ID = namespace name.

---

## 5. Cloudflare Queues — Current Limits & Patterns

| Limit | Value |
|---|---|
| Max message size | 128 KB |
| Max batch size (sendBatch) | 100 messages or 256 KB total |
| Max consumer batch | 100 messages |
| Max retries per message | 100 |
| Max retry/delay window | 24 hours |
| Per-queue throughput | 5,000 msgs/sec |
| Concurrent consumer invocations | 250 (push-based) |
| Message retention | up to 14 days (24h on free plan) |
| Per-queue backlog | 25 GB |
| Consumer wall clock | 15 min |
| Consumer CPU time | configurable up to 5 min (default 30s) |

### Recommended config for `engram-ingest` queue

```jsonc
// packages/triage-worker/wrangler.jsonc
{
  "name": "engram-triage-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "engram-memories" }],
  "queues": {
    "consumers": [
      {
        "queue": "engram-ingest",
        "max_batch_size": 10,            // CF AI calls are expensive; small batches keep latency low
        "max_batch_timeout": 5,           // 5s — phase-2 enrichment doesn't need to wait long
        "max_retries": 5,                 // raw default 3 is too low for transient AI errors
        "dead_letter_queue": "engram-ingest-dlq",
        "max_concurrency": 10,            // tune up after observing load
        "retry_delay": 30                 // 30s — long enough to ride out AI rate limits
      }
    ]
  }
}
```

Producer side (mcp-server Worker):
```jsonc
// packages/mcp-server/wrangler.jsonc — partial
"queues": {
  "producers": [{ "binding": "INGEST_QUEUE", "queue": "engram-ingest" }]
}
```

**Anti-pattern:** Using `max_batch_size: 100` with AI calls inside the consumer. You'll burn through CPU/wall-clock budget on a single bad batch. Keep batches small, let concurrency do the scaling.

---

## 6. Monorepo & Wrangler Configuration

### Config format: `wrangler.jsonc` (NOT `wrangler.toml`)

Cloudflare officially recommends **`wrangler.jsonc`** for new projects as of Wrangler v3.91.0. Newer Wrangler features ship JSONC-first. CLAUDE.md says `wrangler.toml`; **deviate from CLAUDE.md here** — update CLAUDE.md as part of the v0.1 scaffold phase.

### Layout: one `wrangler.jsonc` per package (no root wrangler config)

```
engram/
  package.json                         # workspaces = ["packages/*", "shared/*"]
  tsconfig.json                        # base, references for project refs
  packages/
    mcp-server/
      wrangler.jsonc                   # the public MCP entrypoint
      package.json
      src/index.ts
      tsconfig.json                    # extends ../../tsconfig.json
    workspace-do/
      wrangler.jsonc                   # DO Worker (deployed separately for service binding)
      package.json
      src/index.ts
    triage-worker/
      wrangler.jsonc                   # queue consumer
      package.json
      src/index.ts
    ingest-worker/
      wrangler.jsonc
      package.json
      src/index.ts
  shared/
    types/
      package.json                     # private workspace, no wrangler
      src/index.ts
    schema/
      package.json
      src/system-types.ts
    utils/
      package.json
      src/index.ts
```

**Why no root `wrangler.jsonc`:** Cloudflare's monorepo docs note that Wrangler "analyzes the project directory where you run the command" — there's no first-class multi-Worker config inheritance. Trying to make a root config the source of truth fights the tool. Keep each Worker self-contained.

**Local dev pattern:** to run mcp-server + workspace-do + triage-worker together:
```bash
npx wrangler dev \
  -c packages/mcp-server/wrangler.jsonc \
  -c packages/workspace-do/wrangler.jsonc \
  -c packages/triage-worker/wrangler.jsonc
```
First `-c` is primary (port 8787). Others are reachable via service bindings.

**Deploy pattern:** wire each package's `npm run deploy` to `wrangler deploy --config wrangler.jsonc`. Root `package.json` gets a `deploy:all` script that runs each in order (DO first, then mcp-server which depends on it).

### Package manager: npm workspaces (per PROJECT.md constraint)

npm workspaces work fine for this layout. **Limitation flagged in Cloudflare docs:** when dependencies are hoisted to the workspace root, Wrangler's auto-detection can miss things. Mitigation: ensure each Worker package declares its own direct dependencies in its own `package.json` (don't rely on hoist).

**Risk flag (LOW):** Cloudflare docs literally say _"Support for monorepos and npm/yarn/pnpm workspaces is currently limited."_ This is mostly about the auto-config wizard, not runtime deploys. Treat as a friction wart, not a blocker.

### Service Bindings (Worker → Worker)

Engram's mcp-server calls workspace-do via a DO namespace binding (not a service binding — DOs are accessed via their namespace). But the triage-worker may need to call back into mcp-server, or vice versa. Use service bindings:

```jsonc
"services": [
  { "binding": "WORKSPACE", "service": "engram-workspace-do" }
]
```

**Anti-pattern:** Reaching across packages with `fetch("https://other-worker.workers.dev")`. That's a round-trip over the public internet. Service bindings are zero-latency in-region calls.

---

## 7. TypeScript Build Tooling

### Use `wrangler`'s built-in esbuild — do NOT add Vite or run `tsc` as a bundler

Wrangler embeds esbuild and is the only Workers-aware bundler that knows about compat dates, bindings, and DO migrations. Vite adds zero value for Workers code. Use plain `tsc --noEmit` for type-checking only.

**Recommended `tsconfig.json` (root):**
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  }
}
```

Per-package `tsconfig.json` extends root with `"include": ["src"]`. Skip TypeScript project references for v0.1 (overhead > benefit at 4 packages); revisit at v0.3 when packages grow.

---

## 8. Testing

### Vitest + `@cloudflare/vitest-pool-workers`

The pool runs your tests **inside the `workerd` runtime** via Miniflare, so DO `ctx.storage.sql`, KV, R2, Vectorize bindings, and AI bindings all work natively — no mock layer.

**Recommended `vitest.config.ts` per package:**
```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // override or augment bindings for tests if needed
        },
      },
    },
  },
});
```

**Caveats (verified via Cloudflare docs):**
- Vectorize and Workers AI bindings inside Miniflare hit **real** Cloudflare endpoints unless you set `experimental_remoteBindings: false` and provide mocks. For unit tests of triage logic, mock the `env.AI.run(...)` calls. For Vectorize, the Miniflare local simulator is fine for assertion-level tests but won't reflect real ranking.
- `runInDurableObject(stub, async (instance, state) => { ... })` lets you reach into a DO's internal state from tests — invaluable for asserting SQL writes happened.

**Risk flag (MEDIUM):** the vitest pool config surface has shifted incrementally (defineConfig vs defineWorkersConfig, `cloudflareTest` plugin form vs `poolOptions.workers` form). Pin Vitest at `^4.1.x` and the pool at the latest matching version when you scaffold; expect to update the snippet above based on what `npm create cloudflare@latest` emits at that moment.

### Don't bring in MSW for MCP

The MCP protocol is JSON-RPC over a streaming transport — MSW (designed for REST/GraphQL) is the wrong tool. For end-to-end MCP testing, use `@modelcontextprotocol/inspector` (`npx @modelcontextprotocol/inspector@latest`) against a `wrangler dev` instance. For unit testing tool handlers, call the handler functions directly with mocked env.

---

## 9. Supporting Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `zod` | `^4.4.3` | Schema validation for MCP tool inputs + structured AI outputs | Every MCP tool input, every `generateObject` schema |
| `workers-ai-provider` | `^3.1.14` | Vercel AI SDK provider that targets `env.AI` binding | Whenever you want `generateObject` / `streamText` over Workers AI |
| `ai` (Vercel AI SDK) | `^4.x` | Companion to `workers-ai-provider` — provides `generateObject`, `streamText` | Paired with the provider above |
| `@cloudflare/workers-oauth-provider` | `^0.7.0` | OAuth 2.1 for the v1.0 multi-tenant gating | Defer to v1.0 — v0.1 uses static JWT |
| `hono` | `^4.12.23` | (Optional) HTTP routing inside Workers | **Skip for v0.1** — the MCP server is one endpoint. Reach for Hono only when you build the v1.0 admin UI or REST surface. |
| `miniflare` | `^4.20260521.0` | Local Workers runtime simulator (used transitively by the Vitest pool) | Don't depend on directly; comes with Wrangler and the test pool |
| `tsx` | `^4.22.3` | Run TS scripts outside Workers (seed scripts, dev helpers) | Memory-type seed scripts, migration utilities |

### Anti-recommendations (what NOT to add)

| Avoid | Why |
|---|---|
| `express`, `fastify` | Node-only HTTP frameworks. Use Hono if you ever need routing, otherwise raw `fetch` handler. |
| `drizzle-orm` or `kysely` for DO SQLite | These ORMs target D1/Postgres. The DO SQL API is small enough that thin typed query helpers (your `queries.ts`) beat the ORM tax. Revisit at v0.4 only if queries balloon. |
| `prisma` | Doesn't run in `workerd`. Don't go down this path. |
| `vite` for Workers builds | Wrangler's esbuild is the right bundler. Vite adds config complexity for no Workers-specific benefit. |
| `turbo` for v0.1 | Premature. With 4 packages and `npm run --workspaces`, turbo's cache benefits don't yet pay for its setup. Revisit at v0.4 when you have 6+ packages and CI minutes matter. |
| `pnpm` / `yarn` | PROJECT.md locks npm workspaces. Don't switch. |

---

## 10. Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| MCP transport | Streamable HTTP via `agents/mcp` | SSE via `McpAgent.serveSSE()` | SSE deprecated by MCP spec (March 2025). Use only for legacy client compat. |
| MCP host | Cloudflare `agents` SDK | Raw `@modelcontextprotocol/sdk` server | Official SDK's HTTP transports require Node. `agents` is the Workers-native adapter. |
| Embedding model | `@cf/baai/bge-base-en-v1.5` (768d) | `bge-large-en-v1.5` (1024d) | 3× cost, marginal quality gain for short personal content |
| Embedding model | `@cf/baai/bge-base-en-v1.5` | `bge-m3` ($0.012/M) | Cheaper but multilingual focus; for English-first second brain, base-en is better tuned |
| Text gen | `llama-3.1-8b-instruct` (default) | `llama-3.3-70b-instruct-fp8-fast` | 70B is 3× output cost; reserve for `reflect` synthesis quality |
| DO storage | SQLite (`ctx.storage.sql`) | KV-style (`storage.put/get`) | KV is legacy on SQLite-backed DOs; new code should never touch it |
| Storage backend | DOs | D1 | D1 lacks per-tenant isolation, requires you to invent sharding |
| Config format | `wrangler.jsonc` | `wrangler.toml` | Cloudflare actively recommends JSONC; new features ship JSONC-first |
| Build | Wrangler/esbuild | Vite | Vite adds no Workers-specific value |
| Workspace partitioning | Vectorize namespaces | One index per workspace | Index ops are heavy; namespaces are cheap (50k/index on Paid) |
| Test runner | Vitest + `@cloudflare/vitest-pool-workers` | Node `node:test` with mocks | Mocks lie. Pool runs in real `workerd`. |

---

## 11. Installation — One-Shot Bootstrap

```bash
# Root scaffold
mkdir -p engram && cd engram
npm init -y
npm pkg set "workspaces[]=packages/*" "workspaces[]=shared/*" "type=module"

# Dev deps at root (shared across all workers)
npm install -D \
  wrangler@^4.94.0 \
  typescript@^6.0.3 \
  @cloudflare/workers-types@^4.20260525.1 \
  @cloudflare/vitest-pool-workers@latest \
  vitest@^4.1.7 \
  tsx@^4.22.3

# Per-package runtime deps (run inside each packages/<name>/)
npm install \
  agents@^0.13.2 \
  @modelcontextprotocol/sdk@^1.29.0 \
  zod@^4.4.3 \
  workers-ai-provider@^3.1.14 \
  ai@^4.x

# Vectorize: create index once
npx wrangler vectorize create engram-memories --preset=@cf/baai/bge-base-en-v1.5
npx wrangler vectorize create-metadata-index engram-memories --propertyName=type --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=project_id --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=scope --type=string
npx wrangler vectorize create-metadata-index engram-memories --propertyName=source --type=string

# Queues: create both ingest queue and DLQ
npx wrangler queues create engram-ingest
npx wrangler queues create engram-ingest-dlq

# KV: config + sessions namespaces
npx wrangler kv namespace create ENGRAM_CONFIG
npx wrangler kv namespace create ENGRAM_SESSIONS

# R2: three buckets per CLAUDE.md naming
npx wrangler r2 bucket create engram-storage
npx wrangler r2 bucket create engram-exports
npx wrangler r2 bucket create engram-registry
```

---

## 12. Risks & Things That Will Move on You

| Risk | Severity | Mitigation |
|---|---|---|
| `agents` SDK is pre-1.0 (`0.13.2`) — API may shift | MEDIUM | Pin exact minor versions. Watch [cloudflare/agents changelog](https://github.com/cloudflare/agents/releases) before bumping. Their breaking changes have been mostly additive in 2026 (RPC transport, elicitation), but assume one breaking change between v0.1 and v1.0. |
| MCP SDK v2 migration in progress; Cloudflare integration path may rename | MEDIUM | The v2 docs already include Cloudflare Workers snippets. Don't ship anything until the `agents` SDK confirms which MCP SDK major it depends on at that moment. |
| `wrangler.jsonc` vs `wrangler.toml` doc drift | LOW | CLAUDE.md says `wrangler.toml`. Update CLAUDE.md to JSONC in the v0.1 scaffold commit. |
| Vitest pool config keeps shifting (`cloudflareTest` plugin vs `defineWorkersConfig`) | MEDIUM | Generate config from `npm create cloudflare@latest --template=cloudflare/workers-vitest` at scaffold time and treat that as the source of truth for your tsconfig + vitest setup. Don't transcribe from older blog posts. |
| Workers AI Neuron pricing — daily 10k allocation is generous but burst-able | LOW | Add telemetry on `env.AI.run` calls in v0.2. If you blow past the free tier, batch embeddings (`bge-base` accepts arrays). |
| Vectorize namespace counts cap at 50k on Paid | LOW | Not a v0.1 concern (Russell-only). Re-evaluate at v0.3 when teams enter — 50k workspaces is plenty for the foreseeable horizon. |
| DO SQLite billing turned on Jan 2026 | LOW | Already in effect. Budget assumes paid tier. Per-DO storage cost is low ($/GB-month) but adds up at scale. |
| `mcp-remote` is community-maintained | MEDIUM | Track Claude Desktop releases for native Streamable HTTP support. Drop the proxy when it lands. |
| Monorepo wrangler ergonomics ("limited support" caveat in CF docs) | LOW | Real-world impact is minor — keep per-package configs, declare deps explicitly per package, and you'll be fine. |

---

## Sources

### Context7-verified (HIGH confidence)
- `/modelcontextprotocol/typescript-sdk` — MCP SDK API, v1→v2 migration notes, Cloudflare Workers section
- `/cloudflare/agents` — `McpAgent`, `createMcpHandler`, OAuth provider pairing
- `/websites/developers_cloudflare_workers` — Durable Objects SQLite (`ctx.storage.sql`), Vectorize commands, Queues config, Wrangler binding syntax, Workers AI structured output

### Cloudflare official docs (HIGH confidence)
- [Cloudflare Vectorize platform limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Cloudflare Queues platform limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Durable Objects SQL Storage API](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
- [Durable Objects best practices — accessing storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cloudflare Agents — Model Context Protocol](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Cloudflare Agents — MCP transport (Streamable HTTP vs SSE)](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- [Cloudflare Agents — `McpAgent` API reference](https://developers.cloudflare.com/agents/model-context-protocol/mcp-agent-api/)
- [Cloudflare Agents — `createMcpHandler` API reference](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)
- [Build a Remote MCP server (Cloudflare guide)](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [Wrangler vectorize commands](https://developers.cloudflare.com/workers/wrangler/commands/vectorize/)
- [Wrangler queues commands](https://developers.cloudflare.com/workers/wrangler/commands/queues/)
- [Wrangler configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Vitest integration for Workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Multi-Worker dev with `wrangler dev -c`](https://developers.cloudflare.com/workers/development-testing/multi-workers/)
- [Workers AI — pricing & Neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI — `@cf/baai/bge-base-en-v1.5`](https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/)
- [Workers AI — `@cf/baai/bge-m3`](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Workers AI — OpenAI-compatible endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [Workers AI — Vercel AI SDK provider](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/)
- [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)
- [Vectorize query client API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Monorepo advanced setups (Cloudflare CI/CD)](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Cloudflare Agents SDK changelog — http-streamable + task queues (2025-08-05)](https://developers.cloudflare.com/changelog/2025-08-05-agents-mcp-update/)

### npm (HIGH confidence — versions verified at 2026-05-24)
- `wrangler@4.94.0` (modified 2026-05-22)
- `@modelcontextprotocol/sdk@1.29.0` (modified 2026-03-30)
- `agents@0.13.2` (modified 2026-05-21)
- `@cloudflare/vitest-pool-workers@0.16.9` (modified 2026-05-22)
- `@cloudflare/workers-types@4.20260525.1`
- `miniflare@4.20260521.0`
- `zod@4.4.3`
- `vitest@4.1.7`
- `typescript@6.0.3`
- `hono@4.12.23`
- `@cloudflare/workers-oauth-provider@0.7.0`
- `workers-ai-provider@3.1.14`

### Web (MEDIUM confidence — used for cross-check)
- [Cloudflare blog: Piecing together the Agent puzzle (MCP + auth + DOs)](https://blog.cloudflare.com/building-ai-agents-with-mcp-authn-authz-and-durable-objects/)
- [DeepWiki — McpAgent API](https://deepwiki.com/cloudflare/agents/11.3-mcpagent-api)
- [Hono Cloudflare Testing example](https://hono.dev/examples/cloudflare-vitest)
