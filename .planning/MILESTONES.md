# Milestones

## v0.1 MCP Foundation (Shipped: 2026-05-30)

**Phases completed:** 7 phases, 44 plans, 93 tasks

**Goal:** MCP-native second brain for AI assistants, deployed on Cloudflare. Russell's first user; the binding acceptance test is `remember` a job posting in conv A → `recall` correctly in fresh conv B 1+ hour later.

### Key accomplishments

1. **Per-workspace Durable Object architecture.** `WorkspaceDO` owns a SQLite database per workspace (7 tables, 10 indexes, idempotent migrations with `_schema_migrations` runner). Defense-in-depth: `assertOwnsWorkspace()` is the first executable line of every RPC method (STO-07).
2. **OAuth-bridged MCP transport.** `EngramMcp extends McpAgent` over Cloudflare Workers OAuth Provider. `mcp-remote` bridge connects Claude Desktop → deployed Worker. KV-backed identity lookup keyed on OAuth `sub`. Five MCP tools registered: `remember`, `recall`, `search`, `forget`, `ingest`.
3. **`EngramResponse<T>` envelope across all 5 tools.** Synthesis-first contract: `result`, `context: {related, entities, timeline?, conflicts?}`, `meta: {confidence, coverage, last_updated, gaps[]}`, `suggestions?`. Pre-processed by Workers AI so Claude receives minimum tokens for maximum utility.
4. **Cloudflare Workers AI for all preprocessing.** `bge-base-en-v1.5` for embeddings (768-dim cosine via Vectorize); `llama-3.1-8b-instruct` for entity extraction + memorability scoring + classification. Triage Worker is a separate Worker (separate failure domain, separate scaling, separate hot path).
5. **Hybrid recall ranking.** `recall()` combines vector similarity + recency + type + scope, not vector-only. Implemented in `packages/mcp-server/src/hybrid-rank.ts` (AI-04).
6. **Async pipeline with no silent drops.** `engram-ingest` Queue connects MCP Worker (producer via `ctx.waitUntil`) to Triage Worker (consumer). `MemoryEvent.id` is the idempotency key. `blocks.ingest_status` column tracks `pending → enriched | failed`. All permanent-failure paths call `markIngestFailed` + `ack()` instead of letting Queues runtime silently drop on retry exhaustion (PIP-05).
7. **Cold-storage routing instead of discard.** Memorability `<0.4` blocks go to `cold_storage = 1`, NEVER discarded (Phase 5 D-07 — the "cardinal sin" of a memory product structurally prevented).
8. **Production deploy + binding acceptance test PASS.** Both Workers shipped to Russell's Cloudflare account (`engram-mcp-server.russellkmoore.workers.dev` + `engram-triage-worker.russellkmoore.workers.dev`). DEP-03 verified twice: remember in conv A (Apple ML Research Scientist at 00:38 PT + Anthropic TPM at 01:02 PT) → recall in fresh conv B at 10:08 PT (9h+ waits) returned both postings with full structured fields intact.

### Architectural decisions locked

- **Two-Worker split** (MCP + Triage) per A7/C5 — hot-path latency + failure isolation + universal intake (v0.4 connectors fan into same Queue)
- **DO-per-workspace** (not D1) — workspace isolation by default, no sharding complexity, clean archive/delete
- **Schema-as-data memory types** — stored in `memory_types` table, never as TS classes; enables user/community extensibility without redeploy
- **MemoryEvent as universal intake primitive** — same shape from MCP, Slack, Drive, webhooks
- **9-tool MCP surface cap** — cognitive overhead constraint for Claude
- **mcp-remote bridge** — pragmatic v0.1 choice; drop when Claude Desktop ships native Streamable HTTP
- **No DLQ queue in v0.1** — `blocks.ingest_status = 'failed'` + Analytics Engine + Cloudflare logs are the surface; dedicated DLQ deferred to v0.2 if real-traffic data shows the need

### Phase summary

- **Phase 1: Foundation** (6/6) — Monorepo, shared types, system memory types, per-package wrangler.jsonc, Apache-2.0, CLAUDE.md baseline
- **Phase 2: WorkspaceDO + SQLite** (9/9) — DO + idempotent migrations + 7 tables + 7 query helpers + STO-07 defense-in-depth + lint script blocking async-in-blockConcurrencyWhile
- **Phase 3: MCP Server Scaffold** (6/6) — `EngramMcp extends McpAgent`, OAuth Provider, KV-backed identity, 5 tool registrations as stubs, MCP Inspector smoke
- **Phase 4: Core Tools + Envelope** (7/7) — All 5 tools live with `EngramResponse<T>` envelope, McpError shape, response-size budgets, transactional `forget`, cross-workspace pentest
- **Phase 5: AI Integration** (7/7) — Vectorize index + namespaces, bge embeddings, Triage Worker with extraction + memorability + classification, hybrid ranking, cold-storage routing, 429-aware retry, eval harness (vitest + promptfoo)
- **Phase 6: Async Pipeline** (5/5) — `engram-ingest` Queue, producer wiring with `ctx.waitUntil`, Triage Worker consumer, `ingest_status` lifecycle, `markIngestFailed` RPC, attempts pre-emption against silent drops
- **Phase 7: Deploy + Acceptance** (4/4) — Deploy wrapper + per-package scripts, README hoist, HUMAN-UAT skeleton, live deploy + OAuth bootstrap + DEP-03 acceptance (2 runs PASS)

### Known deferred items at close

14 Linear issues tracked (ENG-7..20). 5 surfaced during Phase 7 execution, 9 carry-forwards from earlier phases. See STATE.md `## Deferred Items` for the full list with priorities. High-priority deferrals:

- **ENG-9** (High): Promptfoo eval gate silently passes on Workers AI 404 errors
- **ENG-11** (High): Better first-run auth flow — pull `kv:bootstrap-interactive` from v0.4 to v0.2
- **ENG-16** (High): Validate Triage Worker conflict detection precision before v0.2 ships it
- **ENG-18** (High): SEED-002 — Connector cost + throughput model before v0.4
- **ENG-20** (High): Close out Phase 5 verification (3 deferred AI eval gates)

### Scope adjustments at close

- **DEP-04 dropped from v0.1 scope** (Phase 7): Job Scout agent rewire to use Engram as backend required a real rewrite of the agent (separate codebase), not the in-place capture-path swap originally scoped. Engram's substrate readiness verified via DEP-03; Job Scout rewrite owned in that repo.

### Timeline

- **Roadmap created:** 2026-05-24
- **Phase 1 complete:** 2026-05-25
- **Phase 7 complete:** 2026-05-30
- **Total duration:** 6 days

### Stack

- TypeScript (strict mode: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
- Cloudflare Workers + Durable Objects (SQLite-backed) + Workers AI + Vectorize + Queues + KV + Analytics Engine + R2
- wrangler@4.95.0, vitest + `@cloudflare/vitest-pool-workers`, promptfoo
- npm workspaces (monorepo)
- License: Apache-2.0

---
