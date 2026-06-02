# Phase 5: AI Integration — Research

**Researched:** 2026-05-28
**Domain:** Cloudflare-native RAG (Workers AI + Vectorize) wired into MCP tool surface + Queue-based Triage Worker
**Confidence:** HIGH for architecture (locked by AI-SPEC.md); MEDIUM for testing infrastructure; LOW for two specific 429 mechanics (see Open Questions)
**Researcher:** gsd-phase-researcher

## Artifacts Read (Provenance)

The planner can trust this research because every claim is grounded in one or more of:

| Artifact | Purpose |
|---|---|
| `.planning/phases/05-ai-integration/05-CONTEXT.md` | D-01..D-07 user decisions (verbosity default flip; cold-storage routing; truncation policy) |
| `.planning/phases/05-ai-integration/05-AI-SPEC.md` (914 lines) | The master design contract — framework selection, model bindings, eval strategy, guardrails, monitoring |
| `.planning/phases/05-ai-integration/05-DISCUSSION-LOG.md` | Audit trail for synthesis-policy gray-area deep-dive |
| `.planning/REQUIREMENTS.md` §"AI Integration (AI)" | AI-01..AI-08 acceptance criteria |
| `.planning/ROADMAP.md` Phase 5 section | 7 Success Criteria + 5 Risk Notes (irreversible-decision callouts) |
| `.planning/STATE.md` | Project state, prior-phase summaries |
| `.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md` | Envelope-field-population map, "DO NOT change" rules |
| `.claude/skills/spike-findings-engram/SKILL.md` + `references/*.md` | BORDERLINE-band reality, hybrid ranking requirement, AI-05 prompt design |
| `packages/mcp-server/src/{tools,envelope,schemas,result-types}.ts` | Phase 4 live code Phase 5 modifies |
| `packages/workspace-do/src/{index,queries,schema,migrations}.ts` | DO methods the Triage Worker calls back into |
| `packages/mcp-server/src/__tests__/{tools-integration,cross-workspace-pentest,envelope}.test.ts` | Test patterns the planner extends |
| `packages/mcp-server/wrangler.{jsonc,test.jsonc}` + `packages/triage-worker/wrangler.jsonc` | Current binding declarations |
| Cloudflare official docs (Vectorize client API, query/insert best practices, metadata filtering, Workers AI bindings, JSON mode, Queues consumer API, errors) | Verified API signatures |
| `https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/ai-vectorize` | Canonical Cloudflare test-mocking pattern for AI + Vectorize bindings |

## Summary

Phase 5 is a **body-change, not a contract-change**: the Phase 4 envelope shape is frozen and every honest-stub field gets populated with real Workers AI / Vectorize output without modifying field presence or types. The decisions are tightly locked — AI-SPEC.md and CONTEXT.md leave very little research surface to discover. The research focus is therefore (a) **verifying exact API signatures** the planner will write into task acceptance criteria, (b) **flagging two AI-SPEC.md claims that the official Cloudflare docs contradict** (429 error code + binding-throws-vs-returns), and (c) **detailing the test infrastructure gap** — the Triage Worker currently has zero test infrastructure and there is no local Workers AI / Vectorize emulator, so the Plan 05-XX tasks need explicit strategy for mocking with `vi.spyOn(env.AI, "run")` (the Cloudflare-canonical pattern) and using `remote: true` bindings for integration tests when real Vectorize behavior is required.

**Primary recommendation:** Follow AI-SPEC.md verbatim for the architecture (models, hybrid ranking, namespace topology, guardrails, monitoring). Apply CONTEXT.md amendments D-01..D-07 (verbosity default → `"chunks"`, synthesis-omitted META_GAPS string, cold-storage routing, truncation policy). For test infrastructure, use the Cloudflare-canonical `vi.spyOn(env.AI, "run").mockResolvedValue(...)` pattern for unit tests and provision a separate `wrangler.test.jsonc` block for the triage-worker package matching the mcp-server pattern. For the 429 detection helper, implement defense-in-depth: detect BOTH the AI-SPEC.md-claimed `{success:false, errors:[]}` shape AND a thrown `AiError`/`InferenceUpstreamError` shape, because the Cloudflare docs document the latter as the canonical pattern while AI-SPEC.md (Context7-fetched 2026-05-27) documents the former for the binding-level envelope. Test both paths.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **AI-01** | Vectorize index `engram-memories` exists, `--preset=@cf/baai/bge-base-en-v1.5` (768d cosine), idempotent setup script | §1 Vectorize Provisioning — `wrangler vectorize create` is NOT natively idempotent; setup script must precheck via `wrangler vectorize get` |
| **AI-02** | Single global Vectorize index, `namespace = workspace_id` for tenant isolation | §2 Vectorize Binding API + §10 Pitfall #1 (namespace mistakes) |
| **AI-03** | `remember()` synchronously embeds via Workers AI, stamps `embedding_model`+`embedding_version` on SQLite row, upserts to Vectorize in workspace namespace | §3 Workers AI Embedding Call + §6 WorkspaceDO RPC for stampEmbedding |
| **AI-04** | `recall()` embeds query with same model, queries Vectorize top-K in workspace namespace, hydrates from SQLite, returns ranked semantic results | §2 query API + §8 Hybrid ranking from spike findings + §7 verbosity-conditional synthesis |
| **AI-05** | Entity extraction runs in Triage Worker via `@cf/meta/llama-3.1-8b-instruct` with structured JSON output; results update `blocks.{properties,summary}` via RPC | §4 Workers AI structured-output + §6 WorkspaceDO RPC + §10 Pitfall #4 (JSON-mode best-effort) |
| **AI-06** | Memorability scoring routes: `>0.8` → store, `0.4–0.8` → inbox, `<0.4` → **cold-storage** (per CONTEXT.md D-07) | §6 RPC routing + cold_storage schema migration (Wave 0) |
| **AI-07** | Workers AI 429 → `message.retry({delaySeconds: 30})` instead of throwing/dropping batch | §5 Queue consumer 429-aware retry + Open Question 1 (binding-throws-vs-returns) |
| **AI-08** | `forget()` cascades SQLite delete to Vectorize `deleteByIds`; round-trip `remember → forget → recall = 0` | §2 deleteByIds API + §10 Pitfall #7 (eventual consistency 5s slack) |

## User Constraints (from 05-CONTEXT.md)

### Locked Decisions (D-01..D-07 from CONTEXT.md)

**D-01** — `verbosity` default flips from `"both"` to `"chunks"` on `recall()`. Synthesis becomes opt-in. Schema change: `RecallInputSchema.verbosity = z.enum(["synthesis", "chunks", "both"]).optional().default("chunks")`.

**D-02** — Discoverability of opt-in synthesis on default recall via three defense-in-depth surfaces:
1. Tool description in `tools.ts` (under MCP-08 1.5KB budget): "Default verbosity is 'chunks'... Pass verbosity: 'synthesis' to add an LLM summary (adds 2–5s latency)."
2. Frozen META_GAPS string: `"Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary."`
3. `suggestions.actions` entry: `"Set verbosity: 'synthesis' to add a summary of these memories."` — **first activation of the `suggestions` field in v0.1** (amends Phase 4 D-04 which deferred it to v0.2).

**D-03** — `envelope.test.ts` assertions for AI-input fixtures must parameterize by verbosity: default-verbosity asserts `synthesis === null` AND discoverability triad present; opt-in verbosity asserts `synthesis !== null`.

**D-04** — `AI-SPEC.md` §4 contract diagram needs amending (Wave 0 doc touch-up): make explicit that synthesis line is skipped on default recall.

**D-05** — `spike-findings-engram/SKILL.md` `<requirements>` line about `verbosity = "both"` is historically accurate but not normatively binding; annotate with Phase 5 supersession note (Wave 0 doc touch-up).

**D-06** — All of AI-SPEC.md inherited verbatim: model IDs locked, namespace topology locked, hybrid ranking formula locked (`cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15`), eval tooling locked (Promptfoo + Vitest + Workers Analytics Engine + Logpush→R2; Phoenix/Langfuse/RAGAS/LangSmith/Braintrust REJECTED), reference dataset locked (20 examples, 4 buckets of 5), real-corpus F1 ≥ 75% gate locked, latency budgets locked.

**D-07** — Honest-stubs posture inverted (not amended): swap null/empty for real AI output without adding/removing/renaming envelope fields. All Phase 4 envelope tests stay GREEN unchanged.

### Claude's Discretion (planner decides per CONTEXT.md recommendations)

- **Wave layout** — recommended skeleton: Wave 0 = test infra + zod schema diff + RED tests + doc touch-ups + cold_storage migration; Wave 1 = `setup-vectorize.sh` + `vectorize-helper.ts` + `ai-helper.ts` (helpers ship first); Wave 2 = `remember()` + `forget()`; Wave 3 = `recall()`; Wave 4 = Triage Worker internals (parallel to Waves 2/3); Wave 5 = eval harness + reference corpus + real-corpus gate; Wave 6 = production monitoring.
- **CF-code-assist routing tracker** — Plan 05-01 MUST create `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` with the 3-question checklist header (per project CLAUDE.md mandate).
- **Vectorize helper module shape** — `vectorizeQuery(env, workspaceId, vector, opts)` / `vectorizeUpsert(env, workspaceId, vectors)` / `vectorizeDelete(env, workspaceId, ids)`. Lint rule via ESLint custom rule OR grep-based CI check (grep is faster to land).
- **AI helper module shape** — `ai-helper.ts` in BOTH `mcp-server` and `triage-worker` with shared model-id constants (`EMBEDDING_MODEL`, `CLASSIFIER_MODEL`) for AI-SPEC.md eval dimension #2 identity-check; `detectRateLimit(aiResp)` returns true on `success: false` with 429-shaped error code OR catches `AiError` with HTTP 429.
- **Triage Worker → WorkspaceDO authentication** — Triage Worker reads `workspace_id` from `MemoryEvent`, passes it to every `WorkspaceDO` RPC call; `STO-07 assertOwnsWorkspace` verifies internally. No JWT (consumer is internal).
- **Real-corpus F1 gate timing** — recommendation: Wave-N validation step after `recall()` ships, gates AI-04 marked-done (allows parallel handler development).
- **Hybrid ranking weight tuning** — recommendation: ship starting weights from AI-SPEC.md, tune in Wave 5/6 against real-corpus samples once labeled; one weight-tuning task in Phase 5 plan.
- **`research_note` heterogeneity** — recommendation: accept heterogeneity for v0.1; trust query expansion + tags + type_match/scope_match weights. Defer tag-cluster / k-means to v0.2.
- **Long-content truncation policy** — recommendation: warn + truncate + store-full-in-SQLite + flag in `meta.gaps`. New frozen META_GAPS string: `"Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable."`
- **Memorability `<0.4` routing** — strong recommendation: **cold-storage, NOT discard**. Add `blocks.cold_storage BOOLEAN DEFAULT FALSE` column via Phase 5 SQLite migration v2. Routing: `>0.8` → `updateBlockEnrichment`, `0.4–0.8` → `moveToInbox`, `<0.4` → `moveToColdStorage`. Update CLAUDE.md `## Ingest Pipeline` to remove "discard" branch.

### Deferred Ideas (OUT OF SCOPE for Phase 5)

- v0.2 query expansion, caching strategy, `meta.coverage` semantic estimation refinement, `research_note` tag-cluster/k-means, cold-storage `include_cold: true` recall flag, cold-storage TTL, chunking strategy, spike re-evaluation on real corpus, `reflect()`/`relate()` MCP tools, conflict detection precision validation
- v0.3 multi-workspace JWT routing, UUID-shaped workspace IDs
- v0.4 Slack/Drive connectors, `ingest_status` consumer transitions, `conflict()` MCP tool
- v1.0 prompt prefix caching, cheaper-model routing for memorability, multi-tenant observability, PagerDuty/Slack alerting

## Project Constraints (from CLAUDE.md)

**Engram project CLAUDE.md mandates (extracted from project root + AI Model Routing):**

- **Auto-load `Skill("spike-findings-engram")`** during Phase 5 implementation work. The planner must include `Skill("spike-findings-engram")` in every PLAN.md's required-reading section.
- **Phase 5 cf-code-assist routing tracker is MANDATORY.** Every code-producing Phase 5 task must append one row to `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` with the 3-question checklist BEFORE committing the route. The file does not exist yet — Plan 05-01 must create it with the prescribed header schema. Phase 5 is projected as a content-generation phase that should route 40–60% to cf-code-assist. Specific Phase 5 task shapes that should default to cf-code-assist: zod schemas (`generateTypes`), vitest eval scripts (`scaffoldTests`), Triage Worker queue consumer scaffold (`generateWorkerBoilerplate`), `recall()` `instr()` → Vectorize swap (`transformCode`), 429-aware retry wrapper (`generateCode`), Workers Analytics Engine event-write helper (`generateCode`).
- **"Engram should return insights, not data."** Every MCP response pre-processes, returns synthesis (when verbosity includes it), includes pre-detected conflicts (when Triage produces them), pre-ranked results, coverage signals, entities extracted at ingest time (Triage Worker), NOT at query time.
- **"If a task can be done by Cloudflare AI, it must not be done by Claude."** CF AI handles embeddings, chunking, entity extraction, summarization, type inference, conflict detection, query expansion, deduplication. Claude handles reasoning, synthesis, user interaction.
- **Workspace ID ALWAYS from `props.workspace_id` (JWT-derived), NEVER from `args` (tool input).** Phase 2 STO-07 + Phase 3 MCP-05 + Phase 4 T-04-DD-RT invariant. Phase 5 AI handlers must obey.
- **DO methods stay sync internally.** Phase 2 D-01. Phase 5 handlers are `async` because of AI/Vectorize bindings, but DO methods invoked from them stay sync.
- **`McpError` discipline.** Every Phase 5 handler error path goes through `mapToMcpError` (Phase 3 D-05 contract).
- **Strict TS** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Phase 5 new helpers + Vectorize/AI binding usage must satisfy.
- **TS-source / no build step** — Phase 1 D-07 carries forward.
- **Linear sync rule.** Phase = Linear Issue. `/gsd:plan-phase 5` creates the ENG issue; `/gsd:execute-phase 5` updates state.

The planner's verification steps should grep PLAN.md output for these invariants.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Embedding generation (write + query) | Workers AI (`env.AI.run`) | — | Sub-second inference; Cloudflare-native; no other tier can produce vectors |
| Vector storage + namespace isolation | Vectorize (`env.VECTORIZE`) | — | The product is semantic recall; Vectorize provides the namespace primitive AI-02 requires |
| Block hydration (id → full row) | WorkspaceDO SQLite | — | SQLite owns the canonical block records per Phase 2; Vectorize is index-only |
| Embedding model + version stamp | WorkspaceDO SQLite (`blocks.embedding_model`, `blocks.embedding_version`) | — | STO-04 columns exist for failure-mode #2 (drift detection); written inside the `stampEmbedding` RPC |
| Workspace-isolation enforcement | WorkspaceDO `assertOwnsWorkspace` (data plane) | `props.workspace_id` routing (Worker plane) + `vectorize-helper.ts` mandatory workspaceId arg | Three-layer defense-in-depth: Worker routes by `idFromName`, DO asserts ID match, helper requires explicit workspace_id on every Vectorize call |
| Hybrid re-ranking | mcp-server `recall()` handler | — | Pure CPU; runs inside the Worker after Vectorize topK + SQLite hydration |
| Entity extraction + summarization + memorability | Triage Worker (`@cf/meta/llama-3.1-8b-instruct`) | — | NEVER on sync write path (latency would blow remember() budget); async Queue path only |
| Memorability routing (write back) | Triage Worker → WorkspaceDO RPC | — | Update `blocks.properties` + `blocks.summary` for `>0.8`; insert `inbox` for `0.4–0.8`; mark `cold_storage = true` for `<0.4` |
| 429-aware retry | Triage Worker Queue consumer | — | `message.retry({delaySeconds: 30})` is the contract; throwing would retry the entire batch (verified) |
| Test mocking (unit) | `vi.spyOn(env.AI, "run").mockResolvedValue(...)` + `vi.spyOn(env.VECTORIZE, "query").mockResolvedValue(...)` | — | Cloudflare-canonical pattern; no local emulator exists for either binding |
| Test integration (real bindings) | `remote: true` Vectorize binding (or `wrangler.test.jsonc` `unsafe.bindings` for AI) | — | Vectorize has NO local emulator; AI binding needs real CF account for end-to-end |

## Standard Stack

### Core (already locked by AI-SPEC.md §3 — versions verified 2026-05-28)

| Library / Binding | Version | Purpose | Why Standard |
|---|---|---|---|
| `env.AI` (Workers AI binding) | runtime (workerd) | Embeddings + LLM inference | Native Cloudflare binding; no SDK to version; AI-SPEC.md §2 ruled out 3rd-party RAG frameworks |
| `@cf/baai/bge-base-en-v1.5` | model preset (locked at index creation) | 768d cosine embeddings | LOCKED by AI-01 preset and STO-04 stamp; permanent once vectors land [CITED: AI-SPEC.md §3] |
| `@cf/meta/llama-3.1-8b-instruct` | model ID | Structured-output extraction + memorability | LOCKED by AI-05/AI-06; spike-validated [CITED: spike-findings-engram] |
| `env.VECTORIZE` (Vectorize binding) | runtime | Vector storage + query | Native CF binding; `engram-memories` index `--preset=@cf/baai/bge-base-en-v1.5` |
| `wrangler` (CLI) | 4.94.0 [VERIFIED: `npx wrangler --version`, 2026-05-28] | Index provisioning, deploy, local dev | Cloudflare-official CLI |
| `zod` | ^4.0.0 [VERIFIED: `packages/mcp-server/package.json`] | Input/output schema validation | Phase 3 SoT; Phase 5 extends with `TriageOutput` |
| `gpt-tokenizer` | ^3.4.0 [VERIFIED: `packages/mcp-server/package.json`] | MCP-08 token-budget assertions | Phase 4 D-09; Phase 5 new META_GAPS + `suggestions.actions` strings must fit |
| `@cloudflare/vitest-pool-workers` | ^0.16.9 [VERIFIED: `packages/mcp-server/package.json`] | Test runner inside workerd | Phase 3 SoT; Phase 5 adds eval tests |
| `vitest` | ^4.1.7 [VERIFIED: `packages/mcp-server/package.json`] | Test framework | Phase 3 SoT |

### Supporting (new in Phase 5)

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `zod-to-json-schema` | latest [ASSUMED] — verify with `npm view zod-to-json-schema version` before install | Derive `response_format.json_schema` from Zod `TriageOutput` shape | AI-05 structured-output call. Install only in `packages/triage-worker` workspace |
| `promptfoo` | latest [ASSUMED] — workspace-local devDependency in triage-worker | Prompt regression CI for AI-05 extraction and AI-06 memorability | Wave 5 eval harness; runs in CI |

### Alternatives Considered (already ruled out by AI-SPEC.md §2)

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Cloudflare-native primitives | LlamaIndex (TS), LangChain.js, LangGraph, CrewAI, Vercel AI SDK | All add bundle weight on workerd, indirection over single-provider direct calls; AI-SPEC.md §2 documents the rejection rationale per framework. Do NOT relitigate. |
| Vectorize | Pinecone, Weaviate, Qdrant | Cross-cloud hops on every `remember()`/`recall()`; breaks single-vendor consolidation; forfeits namespace-per-workspace pattern |

### Package Legitimacy Audit

> Phase 5 introduces TWO new npm packages: `zod-to-json-schema` and `promptfoo`. All other "packages" are runtime CF bindings (no install) or already-vetted Phase 4 deps. slopcheck was not available in this research session — both new packages are tagged `[ASSUMED]` and the planner MUST gate each install behind a `checkpoint:human-verify` task before `npm install`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `zod-to-json-schema` | npm | ~3 yr [ASSUMED — verify with `npm view zod-to-json-schema time.created`] | well-known popular [ASSUMED] | `github.com/StefanTerdell/zod-to-json-schema` [ASSUMED] | unchecked | `[ASSUMED]` — planner must verify before install |
| `promptfoo` | npm | ~2 yr [ASSUMED] | well-known [ASSUMED] | `github.com/promptfoo/promptfoo` [ASSUMED] | unchecked | `[ASSUMED]` — planner must verify before install |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck not run)
**Packages flagged as suspicious [SUS]:** none (slopcheck not run)

**Planner action required:** Insert a `checkpoint:human-verify` task in Wave 1 (before any install) that runs:
```bash
npm view zod-to-json-schema version time.created repository.url
npm view promptfoo version time.created repository.url
```
Russell confirms each is the expected package before the install task runs.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  MCP Client (Claude)                                 │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │ JSON-RPC over HTTP/SSE
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  mcp-server Worker (packages/mcp-server)                                             │
│  ┌────────────────────────────────────────────────────────────────────────────┐    │
│  │  EngramMcp (session DO) → registerTools → 5 handlers                        │    │
│  └────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                       │
│  remember(content, ...)                                                              │
│    1. WorkspaceDO.insertBlock(...)         [SQLite write — Phase 4 path]            │
│    2. env.AI.run(EMBEDDING_MODEL, {text})  [AI-03 sync embed; 50-150ms p50]         │
│    3. WorkspaceDO.stampEmbedding(...)      [STO-04 columns; same workspace DO]      │
│    4. vectorizeUpsert(env, ws_id, [...])   [helper enforces namespace; 40-100ms]    │
│    5. buildRememberResponse(...)            [Phase 4 envelope; new params]          │
│                                                                                       │
│  recall(query, types?, ..., verbosity?)                                              │
│    1. env.AI.run(EMBEDDING_MODEL, {text})  [AI-04 embed query]                      │
│    2. vectorizeQuery(env, ws_id, vec, opts)[topK=25, namespace=ws_id, type filter] │
│    3. WorkspaceDO.getBlocksByIds(ids)       [NEW Phase 5 method — hydrate]          │
│    4. hybridRank(matches, blocks, args)     [cosine·1.0 + recency·0.15 + ...]      │
│    5. IF verbosity ∈ {"synthesis","both"}: env.AI.run(CLASSIFIER_MODEL, synth)     │
│       ELSE: skip — D-01 default-chunks path; synthesis=null                         │
│    6. buildRecallResponse(...)              [D-02 discoverability triad on default] │
│                                                                                       │
│  forget(id, cascade?)                                                                │
│    1. WorkspaceDO.deleteBlock(...)          [Phase 4 SQLite cascade]                │
│    2. vectorizeDelete(env, ws_id, [id])    [AI-08; eventual ~seconds consistency]  │
│    3. buildForgetResponse(...)              [Phase 4 envelope unchanged]            │
│                                                                                       │
│  search(query, ...)  — UNTOUCHED Phase 5; lexical search via SQLite                 │
│  ingest(source, ...) — UNTOUCHED Phase 5; Phase 6 wires Queue producer              │
└───────┬─────────────────────────────────────────┬───────────────────────────────────┘
        │                                         │
        │ Durable Object stub                     │ Vectorize binding (HTTP under the hood)
        ▼                                         ▼
┌───────────────────────────────┐    ┌──────────────────────────────────────────────┐
│  WorkspaceDO (packages/        │    │  Cloudflare Vectorize                         │
│  workspace-do)                 │    │  index: engram-memories                       │
│                                │    │  preset: @cf/baai/bge-base-en-v1.5            │
│  Phase 5 NEW methods:          │    │  dimensions: 768 cosine (LOCKED)              │
│  - stampEmbedding(...)         │    │  namespace per workspace (≤64 bytes)          │
│  - getBlocksByIds(...)         │    │  metadata indexes: type, scope                │
│  - updateBlockEnrichment(...)  │    │                                                │
│  - moveToInbox(...)            │    │  Per-vector metadata:                          │
│  - moveToColdStorage(...)      │    │    { type, scope, created_at }                │
│                                │    └──────────────────────────────────────────────┘
│  Schema v2 migration:          │
│  - blocks.cold_storage BOOL    │    ┌──────────────────────────────────────────────┐
│                                │    │  Cloudflare Workers AI                        │
│  All Phase 5 methods inherit   │    │  models:                                       │
│  STO-07 assertOwnsWorkspace    │    │   @cf/baai/bge-base-en-v1.5 (embed, 768d)    │
│  as the first executable line  │    │   @cf/meta/llama-3.1-8b-instruct (classify) │
└────────────────────────────────┘    └──────────────────────────────────────────────┘

  ┌── ASYNC PATH (Phase 6 wires Queue producer; Phase 5 ships the consumer body) ──┐
  │                                                                                  │
  │   triage-worker (packages/triage-worker)                                         │
  │                                                                                   │
  │   queue() consumer (per-MessageBatch):                                            │
  │     for each Message:                                                             │
  │       1. Parse MemoryEvent body                                                   │
  │       2. env.AI.run(CLASSIFIER_MODEL, {messages, response_format: json_schema})  │
  │       3. detectRateLimit(aiResp) → message.retry({delaySeconds:30}); continue   │
  │       4. TriageOutput.safeParse(aiResp.response) — Zod gate                      │
  │          - fail + attempts<2 → message.retry({delaySeconds:5})                  │
  │          - fail + attempts≥2 → log + message.ack() (PIP-05 DLQ-equiv)           │
  │       5. Route by memorability:                                                   │
  │          - >0.8  → getAgentByName(env.WORKSPACE, ws_id).updateBlockEnrichment() │
  │          - 0.4–0.8 → ...moveToInbox(...)                                         │
  │          - <0.4 → ...moveToColdStorage(...)  [CONTEXT.md cold-storage strong rec]│
  │       6. message.ack()                                                            │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions to existing layout)

```
engram/
├── scripts/
│   └── setup-vectorize.sh           # NEW Wave 1 — idempotent index + metadata indexes
├── packages/
│   ├── mcp-server/
│   │   ├── src/
│   │   │   ├── tools.ts             # MODIFY — remember/recall/forget bodies
│   │   │   ├── envelope.ts          # MODIFY — buildRecallResponse params; new META_GAPS
│   │   │   ├── schemas.ts           # MODIFY — RecallInputSchema.verbosity default → "chunks"
│   │   │   ├── vectorize-helper.ts  # NEW — mandatory workspaceId arg + length guard + stamp precond
│   │   │   ├── ai-helper.ts         # NEW — model-id constants + detectRateLimit + safeRun
│   │   │   ├── hybrid-rank.ts       # NEW — α·cosine + β·recency + γ·type + δ·scope formula
│   │   │   └── __tests__/
│   │   │       ├── envelope.test.ts                        # EXTEND — D-03 verbosity-parameterized
│   │   │       ├── tools-integration.test.ts               # EXTEND — 5s sleep on AI-08 round-trip
│   │   │       ├── cross-workspace-pentest.test.ts         # EXTEND — Vectorize-side AI-02 assertion
│   │   │       ├── vectorize-helper.test.ts                # NEW — namespace mandatory + 64-byte guard
│   │   │       ├── ai-helper.test.ts                       # NEW — 429 detection (both shapes)
│   │   │       ├── hybrid-rank.test.ts                     # NEW — weight formula unit test
│   │   │       └── evals/
│   │   │           ├── recall-f1.eval.test.ts              # NEW — Wave 5 dimension #1
│   │   │           ├── embedding-consistency.test.ts       # NEW — Wave 5 dimension #2
│   │   │           └── reference-corpus.json               # NEW — Wave 5; 20 examples, 4 buckets of 5
│   │   ├── wrangler.jsonc           # EDIT — add "ai" + "vectorize" bindings
│   │   └── wrangler.test.jsonc      # EDIT — same + remote:true for Vectorize integration tests
│   ├── triage-worker/
│   │   ├── src/
│   │   │   ├── index.ts             # REWRITE — queue consumer entry; from current health-check stub
│   │   │   ├── extract.ts           # NEW — AI-05 extraction + Zod gate + retry policy
│   │   │   ├── memorability.ts      # NEW — AI-06 routing (>0.8/0.4-0.8/<0.4 → cold-storage)
│   │   │   ├── prompts.ts           # NEW — SYSTEM_PROMPT (5 drop categories per spike contract)
│   │   │   ├── schema.ts            # NEW — TriageOutput Zod schema + TRIAGE_JSON_SCHEMA
│   │   │   ├── ai-helper.ts         # NEW — sibling to mcp-server's; same detectRateLimit logic
│   │   │   └── __tests__/
│   │   │       ├── extract.test.ts                                # NEW — Zod gate + 429 retry
│   │   │       └── evals/
│   │   │           └── memorability-calibration.eval.test.ts      # NEW — Wave 5 dimension #5
│   │   ├── evals/
│   │   │   └── triage-extraction.promptfoo.yaml                   # NEW — Wave 5
│   │   ├── vitest.config.ts         # NEW — mirror mcp-server pattern
│   │   ├── wrangler.jsonc           # EDIT — add ai + vectorize + WORKSPACE service binding + queue consumer block
│   │   └── wrangler.test.jsonc      # NEW — mirror mcp-server pattern
│   └── workspace-do/
│       └── src/
│           ├── schema.ts            # EDIT — append V2_SQL constant for cold_storage column
│           ├── migrations.ts        # EDIT — append migration v2 to MIGRATIONS array
│           ├── queries.ts           # EXTEND — stampEmbedding, getBlocksByIds, updateBlockEnrichment, moveToInbox, moveToColdStorage
│           └── index.ts             # EXTEND — wrap each new query as DO method with assertOwnsWorkspace as first line
├── .planning/phases/05-ai-integration/
│   ├── 05-CF-CODE-ASSIST-USAGE.md   # NEW Wave 0 — per project CLAUDE.md mandate
│   └── 05-AI-SPEC.md                # EDIT Wave 0 — amend §4 contract diagram per D-04
├── CLAUDE.md                        # EDIT Wave 0 — amend ## Ingest Pipeline to remove "discard" branch (D-07 cold-storage)
└── .claude/skills/spike-findings-engram/SKILL.md  # EDIT Wave 0 — annotate verbosity-default line per D-05
```

### Pattern 1: `remember()` — Sync Embed + Upsert (AI-03)

**What:** After the Phase 4 SQLite insert succeeds, embed inline + stamp model/version + upsert to Vectorize, then return the envelope.

**When to use:** Every `remember()` call on the sync hot path.

**Latency budget:** 150–430ms p50 [CITED: AI-SPEC.md §4b]. SQLite insert ~10–30ms + embed ~50–150ms + upsert ~40–100ms + envelope build ~5–15ms. Phase 5 must add a p50 assertion in integration tests.

**Example (drawn from AI-SPEC.md §3, validated against Cloudflare client API docs):**

```typescript
// packages/mcp-server/src/tools.ts — remember handler additions
import { EMBEDDING_MODEL, EMBEDDING_VERSION, safeRun } from "./ai-helper.js";
import { vectorizeUpsert } from "./vectorize-helper.js";

// (existing Phase 4 path runs first — insertBlock + crypto.randomUUID id)
// ...

// AI-03 inline embed + upsert (after the SQLite insert succeeds)
const embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [block.content] });
// shape: { shape: [1, 768], data: number[768][] }
const vector: number[] = embedResp.data[0];

await stub.stampEmbedding({
  workspace_id: props.workspace_id,
  block_id: id,
  embedding_model: EMBEDDING_MODEL,
  embedding_version: EMBEDDING_VERSION,
});

await vectorizeUpsert(env, props.workspace_id, [{
  id,
  values: vector,
  namespace: props.workspace_id,     // mandatory; helper enforces
  metadata: {
    type: block.type ?? "",
    scope: block.scope,
    created_at: block.created_at,
  },
}]);

const envelope = buildRememberResponse({ id, classified_type: args.type ?? null });
return wrapMcpContent(trimToBudget(envelope));
```

**Source:** [VERIFIED via Cloudflare Vectorize client API docs + insert-vectors best practices] — vector object shape `{ id, values, namespace, metadata }` confirmed; metadata key constraints (no `.`, `"`, leading `$`) confirmed; namespace ≤ 64 bytes confirmed; max 1000 namespaces per index confirmed.

### Pattern 2: `recall()` — Embed Query + Vectorize Query + Hydrate + Hybrid Rank + Conditional Synthesis (AI-04 + D-01)

**What:** Replace Phase 4's `lexicalSearchBlocks` (instr() LIKE) with embed query → Vectorize topK in workspace namespace → hydrate full blocks from SQLite → hybrid re-rank → conditional synthesis based on verbosity arg.

**When to use:** Every `recall()` call.

**Latency budget:** 150–400ms p50 no-synthesis; 2–5.5s p50 with-synthesis [CITED: AI-SPEC.md §4b].

**Example (incorporates D-01 default flip + D-02 discoverability triad):**

```typescript
// packages/mcp-server/src/tools.ts — recall handler replacement
import { EMBEDDING_MODEL, CLASSIFIER_MODEL, safeRun, detectRateLimit } from "./ai-helper.js";
import { vectorizeQuery } from "./vectorize-helper.js";
import { hybridRank } from "./hybrid-rank.js";

const embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [args.query] });
const queryVector: number[] = embedResp.data[0];

const result = await vectorizeQuery(env, props.workspace_id, queryVector, {
  topK: args.limit ?? 25,
  filter: args.types?.length ? { type: { $in: args.types } } : undefined,
  returnMetadata: "all",
});
// result.matches: { id, score, namespace, metadata }[]

const ids = result.matches.map((m) => m.id);
const blocks = await stub.getBlocksByIds({ workspace_id: props.workspace_id, ids });

// Hybrid re-rank — formula LOCKED by AI-SPEC.md §4 + spike-findings phase-5-ranking-strategy.md
const ranked = hybridRank(result.matches, blocks, args, Date.now());

// D-01: synthesis is OPT-IN. Default verbosity="chunks" skips the LLM call entirely.
let synthesis: string | null = null;
if (args.verbosity === "synthesis" || args.verbosity === "both") {
  // Truncate input to ~6K tokens before sending (drop trailing memories first)
  const trimmedForSynth = truncateForSynthesis(ranked, 6000);
  const synthResp = await safeRun(env, CLASSIFIER_MODEL, {
    messages: [
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: formatBlocksForSynthesis(trimmedForSynth, args.query) },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });
  synthesis = (synthResp as any).response ?? null;
}

const envelope = buildRecallResponse({
  memories: ranked,
  verbosity: args.verbosity,
  synthesis,
  suggestions: args.verbosity === "chunks" ? {
    actions: ["Set verbosity: 'synthesis' to add a summary of these memories."],
  } : undefined,
});
return wrapMcpContent(trimToBudget(envelope));
```

**Discoverability triad (D-02) wiring inside `buildRecallResponse`:** add a frozen META_GAPS entry when `verbosity === "chunks"` (the default):

```typescript
// envelope.ts — extend META_GAPS.recall
export const META_GAPS = {
  recall: {
    SYNTHESIS_OMITTED: "Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary.",
    TRUNCATED: "Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable.",
  },
  // ... existing entries kept
} as const;
```

**Source:** [VERIFIED via Cloudflare query-vectors best practices + metadata filtering reference] — `topK` defaults to 5; max 100 (or 50 with `returnMetadata: "all"` / `returnValues: true`); `namespace` parameter on query restricts search to that bucket (NOT a metadata predicate); `filter` uses `$in/$eq/$ne/$nin/$lt/$lte/$gt/$gte` operators with implicit AND between keys; filter JSON ≤ 2048 bytes; metadata properties must be pre-declared via `wrangler vectorize create-metadata-index` before they can be filtered.

### Pattern 3: `forget()` — Transactional Cascade to Vectorize (AI-08)

**What:** Extend Phase 4 TOL-04's SQLite cascade with `vectorizeDelete` of the same id in the workspace namespace.

**Example:**

```typescript
// packages/mcp-server/src/tools.ts — forget handler addition
const { blocks_deleted, relations_deleted } = await stub.deleteBlock({
  workspace_id: props.workspace_id,
  id: args.id,
  cascade: args.cascade ?? true,
});

// AI-08 — Vectorize cascade. deleteByIds is async (eventually consistent).
// Phase 4 envelope contract preserved: still return blocks_deleted + relations_deleted truth.
await vectorizeDelete(env, props.workspace_id, [args.id]);

const envelope = buildForgetResponse({ id: args.id, blocks_deleted, relations_deleted });
return wrapMcpContent(trimToBudget(envelope));
```

**Partial-failure story (planner must resolve before AI-08 closure):** If the SQLite delete succeeds but `vectorizeDelete` throws, the block is gone from SQLite but the vector lingers in Vectorize. Next `recall()` returns a 404-hydrated phantom. Two options for the planner:
- **(a) Reverse order** — Vectorize delete first, then SQLite. If Vectorize delete fails, SQLite row stays; user can re-call forget. If SQLite delete fails after Vectorize succeeds, vector is gone but block remains (orphan in SQLite — same "ghost" inversion).
- **(b) Eventual-consistency assumption** — accept that vectors are eventually consistent and write a Wave 6 background-sweep task that scans Vectorize for vectors whose SQLite row is gone, deletes them.

**Recommendation:** ship (a) for Phase 5 (SQLite delete is the user-facing operation; if Vectorize delete fails, the SQLite delete should NOT proceed — surface the failure as `mapToMcpError`). The Vectorize-orphan case (rare; only on retried writes) is acceptable; reverse-orphan SQLite case (block present but un-hydratable on hit) is worse UX.

### Pattern 4: Triage Worker — Queue Consumer with Structured Extraction + 429 Retry (AI-05/06/07)

**What:** Queue-consumer entry that for each Message: calls llama-3.1-8b-instruct with `response_format: json_schema`, parses through Zod gate, routes by memorability score, handles 429 via `message.retry`.

**Example (drawn from AI-SPEC.md §4b, validated against Queue API docs):**

```typescript
// packages/triage-worker/src/index.ts — replace current health-check stub
import type { MemoryEvent } from "@engram/types";
import { getAgentByName } from "agents";
import { CLASSIFIER_MODEL, safeRun, detectRateLimit } from "./ai-helper.js";
import { extractAndScore } from "./extract.js";
import { SYSTEM_PROMPT } from "./prompts.js";

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  WORKSPACE: DurableObjectNamespace;
  // Queue consumer is wired in Phase 6 — Phase 5 ships the consumer body
}

export default {
  async queue(batch: MessageBatch<MemoryEvent>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      const event = message.body;

      const parsed = await extractAndScore(env, event, message);
      if (parsed === null) {
        // extractAndScore handled the retry/ack internally; move on
        continue;
      }

      // AI-06 routing — CONTEXT.md D-07 cold-storage recommendation
      const stub = getAgentByName(env.WORKSPACE, event.workspace_id);
      if (parsed.memorability > 0.8) {
        await stub.updateBlockEnrichment({ workspace_id: event.workspace_id, id: event.id, enrichment: parsed });
      } else if (parsed.memorability >= 0.4) {
        await stub.moveToInbox({ workspace_id: event.workspace_id, id: event.id, enrichment: parsed });
      } else {
        await stub.moveToColdStorage({ workspace_id: event.workspace_id, id: event.id, enrichment: parsed });
      }

      message.ack();
    }
  },
};

// packages/triage-worker/src/extract.ts — extractAndScore body
import { TriageOutput, TRIAGE_JSON_SCHEMA } from "./schema.js";

export async function extractAndScore(
  env: Env,
  event: MemoryEvent,
  message: Message<MemoryEvent>,
): Promise<TriageOutput | null> {
  let aiResp: any;
  try {
    aiResp = await env.AI.run(CLASSIFIER_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: event.content },
      ],
      response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA },
      temperature: 0.2,
      max_tokens: 1024,
    });
  } catch (err) {
    // OPEN QUESTION 1: AI-SPEC.md claims env.AI.run returns { success: false, errors:[]}
    // on 429; Cloudflare error docs show it throws AiError / InferenceUpstreamError.
    // Defense-in-depth: catch + check + retry.
    if (isRateLimitError(err)) {
      message.retry({ delaySeconds: 30 });
      return null;
    }
    throw err; // non-429 → consumed retry budget via batch-level retry (acceptable)
  }

  // Also check the binding-level envelope path AI-SPEC.md documents
  if (detectRateLimit(aiResp)) {
    message.retry({ delaySeconds: 30 });
    return null;
  }

  const candidate = aiResp?.response ?? aiResp;
  const parsed = TriageOutput.safeParse(candidate);
  if (!parsed.success) {
    if (!message.attempts || message.attempts < 2) {
      console.warn("triage:zod-parse-failed-retrying", { id: event.id, attempts: message.attempts ?? 0 });
      message.retry({ delaySeconds: 5 });
      return null;
    }
    console.error("triage:zod-parse-failed-permanent", {
      id: event.id,
      issues: parsed.error.issues,
      sample: JSON.stringify(candidate).slice(0, 500),
    });
    message.ack();
    return null;
  }

  return parsed.data;
}
```

**Source:** [VERIFIED via Cloudflare Queues consumer API docs] — `message.retry(options?: QueueRetryOptions)` where `QueueRetryOptions = { delaySeconds?: number }` (positive integer, seconds); `message.attempts` is 1-indexed; **throwing inside the consumer retries the entire batch** (not just the message); `message.ack()` explicitly marks success regardless of handler return. The "use retry for transient, throw for batch-level retry" pattern is what AI-07 enforces.

### Anti-Patterns to Avoid

- **`env.VECTORIZE.query(vector)` without `namespace` parameter** — silently queries the global index across ALL workspaces. NO error. Defense: helper enforces.
- **Passing `embed` (full response object) to `vectorizeQuery` instead of `embed.data[0]`** — type error in strict TS; if forced through with `any`, every query returns zero matches. The Workers AI embedding response is `{ shape: [N, 768], data: number[][] }`; you want `data[0]` for single-text input.
- **Calling `env.AI.run(EMBEDDING_MODEL, { text: "..." })` with a string instead of `[string]`** — some Workers AI docs accept both forms but the model card consistently uses array form; standardize on `text: [string]` everywhere.
- **Throwing inside Triage Worker consumer on 429** — retries the WHOLE BATCH per Cloudflare docs; AI-07's `message.retry({delaySeconds:30})` retries only the offending message.
- **Skipping `embedding_model` + `embedding_version` stamp on `remember()`** — vector becomes unrecoverable on future model rotation; the columns exist specifically because re-embed is inevitable.
- **Templated synthesis strings as placeholder when AI is unavailable** — Phase 4 D-04 rejected this; honest-stubs is the recovery posture, `synthesis: null` is the honest contract.
- **Mixing `MIGRATIONS[]` push vs. registering a new constant** — when adding migration v2 for `cold_storage`, follow `migrations.ts` pattern strictly: append to `MIGRATIONS` const array, do NOT modify v1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Embedding generation | tokenizer + ONNX runtime in Worker | `env.AI.run("@cf/baai/bge-base-en-v1.5", ...)` | Workers AI runs the model on Cloudflare's GPU fleet; ~50-150ms p50; ~$0.000003/call |
| Vector storage + ANN search | custom HNSW in SQLite | `env.VECTORIZE` | Native CF binding; namespace primitive AI-02 requires |
| JSON-schema constrained LLM output | regex-parse model freeform output | `response_format: { type: "json_schema", json_schema: <derived from Zod> }` + Zod runtime gate | Strict mode is best-effort but cuts JSON-mode parse failures ~10x; Zod gate catches the rest |
| 429 retry logic | exponential backoff loop in handler | `message.retry({delaySeconds: 30})` on Queue Message | Queue runtime handles delayed redelivery; doesn't consume max_retries the same way a throw does |
| Token-budget enforcement on response | manual length calc | `gpt-tokenizer` (Phase 4 D-09 SoT) + `trimToBudget` from envelope.ts | Already in the codebase; new META_GAPS strings just need to fit |
| Workspace isolation in Vectorize | per-workspace index | namespace per workspace, ONE global index | 100-index cap per CF account kills the per-workspace model at v0.3+ scale |
| RAG framework (LlamaIndex/LangChain/etc.) | install + adapt to envelope | direct `env.AI.run` + `env.VECTORIZE.query/upsert/deleteByIds` | AI-SPEC.md §2 documents the rejection rationale per framework |
| Triage prompt few-shot examples | inline 5-shot per call | zero-shot with explicit 5-drop-category guidance from spike contract | Spike validated zero-shot at ≥85% on synthetic; few-shot inflates input 2-5x per call |
| Pre-baked Vectorize index | `wrangler vectorize insert` of seed vectors | empty index at create time; vectors populate via real `remember()` writes | v0.1 is single-user; the "seed" is Russell's actual usage |

**Key insight:** The cf-code-assist routing rules in project CLAUDE.md make this even more important — qwen3-30b can scaffold the Zod schema, the test harness, and the 429-aware wrapper from a spec without trying to invent its own retry logic. Hand-rolling here would defeat both the architectural intent AND the per-phase token-savings mandate.

## Runtime State Inventory

> Phase 5 is **not** a rename/refactor phase, but it touches one persistent storage layer (`cold_storage` column) and creates a new external storage layer (Vectorize index + namespaces). Both are runtime state that survives across deploys.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) Vectorize index `engram-memories` — created once via setup script; once vectors land, the preset (`@cf/baai/bge-base-en-v1.5`) and dimensions (768 cosine) are permanent. (2) Vectorize namespaces = `workspace_id`; for v0.1 single-user this is "rmoore-personal" or similar (≤64 bytes). (3) New `blocks.cold_storage BOOLEAN DEFAULT FALSE` column via migration v2. (4) Existing `blocks.embedding_model TEXT` and `blocks.embedding_version INTEGER` columns from v1 (Phase 2 STO-04) — Phase 5 starts WRITING them. | Vectorize: irreversible after first vector lands — verify preset locks dimensions+metric at create time. SQLite migration v2: append to `MIGRATIONS` array; `_schema_migrations` runner handles forward-only versioning idempotently. embedding_model/version: existing columns; Phase 5 adds the write path. |
| **Live service config** | (1) Workers AI is account-scoped — no per-Worker config beyond the binding declaration. (2) Cloudflare account daily neuron allocation (10,000 free, then paid) affects 429 frequency. (3) Workers Analytics Engine dataset binding (Wave 6 — production monitoring). | None on Phase 5 ship beyond binding declarations. Wave 6 documents the daily allocation for Russell's monitoring; alert at >5% 429 rate (Section 7 of AI-SPEC.md). |
| **OS-registered state** | None — no scheduled tasks, no pm2, no launchd. Cron Workers for the weekly eval-flywheel job land in Wave 5 but are deployed via `wrangler deploy --triggers` not OS scheduling. | None. |
| **Secrets / env vars** | None new in Phase 5. The existing OAuth cookie-encryption secret (Phase 3 wrangler.jsonc comment) stays; Workers AI + Vectorize bindings need no API keys (they are account-bound). | None. |
| **Build artifacts** | (1) `worker-configuration.d.ts` in mcp-server + triage-worker — regenerated by `wrangler types` after wrangler.jsonc binding edits. (2) New `vitest.config.ts` + `wrangler.test.jsonc` in triage-worker — Wave 0 task creates both. | Run `npm run types:gen --workspace=packages/mcp-server` and same for triage-worker after every wrangler.jsonc edit. CI should verify the regenerated file is committed. |

**The canonical question for Phase 5:** *After Phase 5 deploys, what runtime systems still need provisioning that the code itself can't bootstrap?*
- **Vectorize index `engram-memories` must exist before the first `remember()` call.** This is the AI-01 setup script's reason for being. The mcp-server Worker will throw if `env.VECTORIZE.upsert()` runs against a non-existent index. The setup script must be (a) idempotent (precheck via `wrangler vectorize get`), (b) documented in setup README (Wave 6 or DEP-05), and (c) part of `npm run setup` chain.
- **Metadata indexes for `type` and `scope` must be created BEFORE the first metadata-filtered query.** Vectors inserted before a metadata index's creation are NOT included in that index's filtering. The setup script creates both via `wrangler vectorize create-metadata-index engram-memories --property-name=type --type=string` (and `scope`). Order: index first, metadata indexes second, then deploy Workers.

## Common Pitfalls

### Pitfall 1: Vectorize namespace mistakes → cross-workspace leakage

**What goes wrong:** A `query()` call without the `namespace` parameter silently searches the **global** index across ALL workspaces. No error, no warning, no log. The pentest test from Phase 4 (cross-workspace-pentest.test.ts) only catches the SQLite-side leakage; the Vectorize-side requires a separate assertion.

**Why it happens:** TypeScript signature has `namespace?: string` (optional). A forgotten arg compiles silently.

**How to avoid:** ESLint custom rule OR grep-based CI check banning direct `env.VECTORIZE.query/upsert/deleteByIds` outside `vectorize-helper.ts`. Helper signature has `workspaceId: string` as **non-optional positional arg**. Test in `cross-workspace-pentest.test.ts` extends with: write vector in workspace_A namespace → query with same vector in workspace_B namespace → assert `matches.length === 0`.

**Warning signs:** Any new test that imports `env.VECTORIZE` directly. Any handler that calls `vectorizeQuery` without an explicit `props.workspace_id` argument.

### Pitfall 2: Embedding model + version drift → silent recall quality loss

**What goes wrong:** `remember()` calls `EMBEDDING_MODEL` constant, `recall()` calls a different constant. Vectors in the index were encoded with v1; new queries encode with v2; cosine similarity scores become meaningless.

**Why it happens:** Two files import the same string literal but it drifts between commits. Cloudflare can silently rotate model weights without changing the ID (Pitfall 8 in AI-SPEC.md §3).

**How to avoid:** Single shared `EMBEDDING_MODEL` constant in `ai-helper.ts` imported by both `tools.ts` (remember + recall) and `extract.ts`. Vitest unit test imports both call sites and asserts `=== ` equality. The `blocks.embedding_model TEXT` + `blocks.embedding_version INTEGER` columns from STO-04 are the migration escape hatch — when CF announces rotation, bump version, gate re-embed migration on `WHERE embedding_version < CURRENT_VERSION`.

**Warning signs:** Recall F1 drift in weekly eval flywheel (>5pp drop from baseline triggers alert per AI-SPEC.md §7).

### Pitfall 3: Workers AI 429 → entire batch fail in Triage Worker

**What goes wrong:** Naive `try/await env.AI.run(...)` either throws (per Cloudflare error docs) or returns `{success:false}` (per AI-SPEC.md Context7 fetch). Throwing inside the queue consumer retries the ENTIRE BATCH per Cloudflare Queue docs [VERIFIED]. A single throttle event drops every event in the batch.

**Why it happens:** Workers AI 429 mechanism is dual: documented errors page shows codes 3036 (Account limited) and 3040 (Out of capacity) returning HTTP 429 [CITED: developers.cloudflare.com/workers-ai/platform/errors/]; AI-SPEC.md (Context7-fetched 2026-05-27) shows the binding returning `{success:false, errors:[{code:7501,...}]}` envelope. The two may both occur depending on which layer fails. See Open Question 1.

**How to avoid:** `detectRateLimit(aiResp)` checks BOTH paths (binding envelope `success:false` AND thrown `AiError`/`InferenceUpstreamError` with HTTP 429 or message matching `/429|rate|too many|capacity/i`). On detection: `message.retry({delaySeconds: 30})` — DO NOT throw, DO NOT ack. Non-429 errors: throw so Queue runtime engages `max_retries` machinery (acceptable batch-level retry for genuine failures).

**Warning signs:** 429 rate per hour >5% (Section 7 alert threshold). Promptfoo CI failures spiking. Russell's job-search agent reports "Engram dropped a memory."

### Pitfall 4: `forget()` partial failure (SQLite delete succeeds, Vectorize delete fails)

**What goes wrong:** SQLite row gone, vector still in Vectorize. Future `recall()` returns a match with `id=X`; hydration via `getBlocksByIds([X])` returns empty array. The match becomes a "ghost" — present in topK, absent from hydrated results.

**Why it happens:** Two independent network operations; no two-phase commit. Vectorize is eventually consistent ("a few seconds"). A transient network blip between SQLite delete (Phase 4 path) and Vectorize delete (Phase 5 addition) leaves the index in stale state.

**How to avoid:** Per Pattern 3 recommendation (a) — reverse order: Vectorize delete FIRST, SQLite delete SECOND. If Vectorize fails, SQLite still has the row; user can retry `forget()`. If Vectorize succeeds but SQLite fails, the vector is gone (harmless — `recall()` won't find it) and SQLite still has the row (re-callable, can be re-forgotten). Either failure surfaces to the caller as `mapToMcpError`. The cleanup case (orphan vector when SQLite is gone) is a Wave 6 background-sweep concern, not Phase 5.

**Alternative:** Accept the eventual-consistency window per AI-SPEC.md Pitfall #7 (5s slack on AI-08 integration test). Don't reverse the order; instead document that recall may return a brief ghost during the propagation window.

**Recommendation:** ship the reverse-order approach; AI-08 integration test `await sleep(5000)` between forget and recall continues to be the acceptance bar.

### Pitfall 5: Inline embed latency creep → `remember()` blows the 430ms budget

**What goes wrong:** `remember()` p50 latency grows past 430ms because: (a) cold-start on rarely-used model, (b) account neuron exhaustion routing to slower data center, (c) someone adds a synchronous metadata-extraction call inside `remember()` instead of leaving it for Triage Worker.

**Why it happens:** Embed call latency is ~50-150ms typical but the p99 is 5-15s on Workers AI cold-start. The Triage Worker's AI calls (extraction, memorability) are explicitly Queue-only per AI-SPEC.md — a future PR could accidentally inline one of them.

**How to avoid:** Workers Analytics Engine assertion in CI: `remember()` p50 latency over the last 10 production calls < 430ms (Section 7 monitoring). Integration test in `tools-integration.test.ts` asserts: `expect(p50Latency).toBeLessThan(430)` over a small loop. ESLint or grep check banning `env.AI.run(CLASSIFIER_MODEL, ...)` inside `tools.ts` `remember` handler body.

**Warning signs:** Section 7 alert "remember() p50 latency >430ms for 2 weeks running."

### Pitfall 6: Long-content truncation silently degrades recall

**What goes wrong:** A job posting >1,800 chars (≈512 tokens) gets only its first ~512 tokens embedded. The semantic "fingerprint" of the document is only the opening paragraph; recall queries about the salary section (typically late in posting) miss the document.

**Why it happens:** `bge-base-en-v1.5` has 512-token context window; longer inputs silently truncate at the model layer.

**How to avoid:** CONTEXT.md "warn + truncate + store-full + flag in meta.gaps" policy. `remember()` handler: if `args.content.length > 1800`, store FULL content in SQLite (no truncation), embed only `args.content.slice(0, 1800)`, append the frozen TRUNCATED META_GAPS string to the envelope `meta.gaps`. Surface to Claude so the agent can either chunk client-side or accept the limitation.

**Warning signs:** Russell's job-search agent reports "I stored a long job posting but recall by salary fails." Promptfoo eval bucket "Edge case: content >2000 chars" failing.

### Pitfall 7: Vectorize `topK` default is 5 → recall silently caps

**What goes wrong:** `recall()` handler calls `env.VECTORIZE.query(vec, { namespace, filter })` without explicit `topK`. Default is 5 [VERIFIED]; the user expected 25 (Phase 4 D-10 cap).

**Why it happens:** TypeScript signature defaults parameters; the docs default differs from the schema default.

**How to avoid:** `vectorize-helper.ts` requires `topK` as explicit positional or named arg; never defaults it.

### Pitfall 8: `returnMetadata: "all"` + topK>50 → silent cap

**What goes wrong:** `returnMetadata: "all"` AND `returnValues: true` cap `topK` at 50 (not 100). Engram's `limit ≤ 25` is well under this, but a future relaxation of D-10 must check the current Vectorize limit page.

**How to avoid:** Comment in `vectorize-helper.ts` documenting the 50-cap relationship; lint rule (or test) asserting `topK ≤ 50` if `returnMetadata === "all"`.

### Pitfall 9: Metadata index must be created BEFORE filtered queries land

**What goes wrong:** `filter: { type: { $in: [...] } }` returns zero matches because the `type` metadata index doesn't exist yet on the Vectorize index. Vectors inserted before the metadata index creation are NOT included in that index.

**Why it happens:** The setup script's create-metadata-index step is separate from the create-index step. Easy to skip.

**How to avoid:** Setup script creates BOTH metadata indexes (`type` and `scope`) as part of the AI-01 idempotent run. Setup README explicitly documents: "if you create vectors before the metadata index, you must re-upsert them to populate the index."

### Pitfall 10: Vitest has NO local Workers AI / Vectorize emulator

**What goes wrong:** Tests fail in CI because they expect `env.AI.run` to work locally; the Workers runtime in vitest-pool-workers has no local AI inference and no local Vectorize index.

**Why it happens:** [VERIFIED via Cloudflare docs] — "there is no current local simulation for Workers AI" and "no current local simulation for Vectorize."

**How to avoid:** Two-tier test strategy:
- **Unit tests (default, CI fast path):** mock both bindings with `vi.spyOn(env.AI, "run").mockResolvedValue({ shape: [1, 768], data: [Array(768).fill(0.1)] })` and `vi.spyOn(env.VECTORIZE, "query").mockResolvedValue({ matches: [...] })`. This is the Cloudflare-canonical pattern (verified at `github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/ai-vectorize`).
- **Integration tests (real-binding, CI slow path or dev-only):** declare bindings in `wrangler.test.jsonc` with `remote: true` (binds to real Cloudflare account). These tests cost neurons + Vectorize ops; run on a CI gate (e.g. nightly) or `npm run test:integration` not in PR-time CI.

## Code Examples

### Example 1: `wrangler.jsonc` bindings (mcp-server EDIT)

```jsonc
{
  // ... existing fields (durable_objects.bindings, kv_namespaces, migrations) ...
  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "engram-memories" }
  ]
}
```

Source: [VERIFIED via Cloudflare workers-ai bindings docs + AI-SPEC.md §3]. The `ai` field is an object, not an array. The `vectorize` field is an array of `{binding, index_name}` objects (one per index — Engram has exactly one).

### Example 2: `wrangler.jsonc` bindings (triage-worker EDIT)

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-triage-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "dev": { "port": 8788 },
  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "engram-memories" }
  ],
  "services": [
    // Triage Worker reaches WorkspaceDO via service binding to mcp-server (which hosts the DO)
    { "binding": "WORKSPACE", "service": "engram-mcp-server", "entrypoint": "WorkspaceDO" }
    // ALTERNATIVE: declare durable_objects.bindings with script_name = "engram-mcp-server"
  ]
  // queues consumer wired in Phase 6 — Phase 5 can declare the binding for type-checking
  // but the consumer config arrives with PIP-01
}
```

**Open question for planner:** the `services` vs `durable_objects.bindings` choice for cross-Worker DO access. `durable_objects.bindings` with `script_name` is the more battle-tested path; `services` with `entrypoint` is newer (RPC-based DO entrypoint). Recommendation: `durable_objects.bindings` for v0.1, document `services` path as future migration. AI-SPEC.md Tool Use table mentions `getAgentByName(env.WORKSPACE, workspace_id)` which works with the namespace shape from `durable_objects.bindings`.

### Example 3: `setup-vectorize.sh` (NEW — Wave 1)

```bash
#!/usr/bin/env bash
# scripts/setup-vectorize.sh
# AI-01: idempotent provisioning of the `engram-memories` Vectorize index + metadata indexes.
# Re-running this script is a no-op (uses precheck via `wrangler vectorize get`).

set -euo pipefail

INDEX_NAME="engram-memories"
PRESET="@cf/baai/bge-base-en-v1.5"

echo "Setup: Vectorize index ${INDEX_NAME} (preset=${PRESET})..."

if npx wrangler vectorize get "${INDEX_NAME}" >/dev/null 2>&1; then
  echo "  ✓ Index exists — skipping create"
else
  echo "  → Creating index..."
  npx wrangler vectorize create "${INDEX_NAME}" \
    --preset="${PRESET}" \
    --description="Engram v0.1 — single global index, namespace per workspace"
  echo "  ✓ Index created"
fi

# Metadata indexes — re-running create-metadata-index on an existing one errors.
# Use list-metadata-index to check first.
EXISTING_META=$(npx wrangler vectorize list-metadata-index "${INDEX_NAME}" --json 2>/dev/null || echo "[]")

for prop in type scope; do
  if echo "${EXISTING_META}" | grep -q "\"propertyName\":\"${prop}\""; then
    echo "  ✓ Metadata index '${prop}' exists — skipping"
  else
    echo "  → Creating metadata index '${prop}'..."
    npx wrangler vectorize create-metadata-index "${INDEX_NAME}" \
      --property-name="${prop}" \
      --type=string
    echo "  ✓ Metadata index '${prop}' created"
  fi
done

echo ""
echo "Vectorize setup complete. The index is ready for upserts."
```

**Verification step:** `npx wrangler vectorize get engram-memories --json` returns the preset + dimensions + metric; assert `dimensions == 768` and `metric == "cosine"`.

### Example 4: `vectorize-helper.ts` (NEW — Wave 1, mandatory workspaceId guard)

```typescript
// packages/mcp-server/src/vectorize-helper.ts
// Phase 5 — mandatory workspaceId positional arg + namespace length guard.
// Defense-in-depth for failure mode #1 (cross-workspace vector leakage).

import type { VectorizeIndex, VectorizeVector, VectorizeMatches } from "@cloudflare/workers-types";

const NAMESPACE_MAX_BYTES = 64;
const VECTORIZE_TOPK_DEFAULT = 25;

function assertNamespace(workspaceId: string): void {
  if (!workspaceId || workspaceId.length === 0) {
    throw new Error("Vectorize helper: workspaceId is required (failure mode #1 defense)");
  }
  // Use Buffer.byteLength equivalent — TextEncoder works on workerd
  const bytes = new TextEncoder().encode(workspaceId).byteLength;
  if (bytes > NAMESPACE_MAX_BYTES) {
    throw new Error(
      `Vectorize helper: namespace '${workspaceId}' exceeds ${NAMESPACE_MAX_BYTES} bytes (got ${bytes})`,
    );
  }
}

export async function vectorizeQuery(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: {
    topK?: number;
    filter?: Record<string, unknown>;
    returnMetadata?: "none" | "indexed" | "all";
  },
): Promise<VectorizeMatches> {
  assertNamespace(workspaceId);
  return await env.VECTORIZE.query(vector, {
    topK: opts.topK ?? VECTORIZE_TOPK_DEFAULT,
    namespace: workspaceId,
    ...(opts.filter !== undefined ? { filter: opts.filter } : {}),
    returnMetadata: opts.returnMetadata ?? "all",
  });
}

export async function vectorizeUpsert(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vectors: Array<VectorizeVector & { metadata?: Record<string, unknown> }>,
): Promise<{ mutationId: string }> {
  assertNamespace(workspaceId);
  // Pre-stamp every vector's namespace to workspaceId regardless of caller intent.
  // Caller MUST also have stamped embedding_model + embedding_version on the SQLite row
  // BEFORE calling this helper (precondition surfaced as a code-review checkpoint, not
  // enforced here — that would require a SQL roundtrip and the cost is not justified
  // for a defense-in-depth that's already covered by the test in embedding-consistency.test.ts).
  const stamped = vectors.map((v) => ({ ...v, namespace: workspaceId }));
  return await env.VECTORIZE.upsert(stamped);
}

export async function vectorizeDelete(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  ids: string[],
): Promise<{ mutationId: string }> {
  assertNamespace(workspaceId);
  if (ids.length === 0) return { mutationId: "noop" };
  // Vectorize deleteByIds is namespace-agnostic per the API (vectors have one namespace each
  // by their upsert-time tag), but we assert workspace ownership at the SQLite layer before
  // calling this helper. The helper's role here is the namespace-length precondition only.
  return await env.VECTORIZE.deleteByIds(ids);
}
```

### Example 5: `ai-helper.ts` (NEW — Wave 1, model constants + 429 detection)

```typescript
// packages/mcp-server/src/ai-helper.ts (and SIBLING in packages/triage-worker/src/ai-helper.ts)
// Phase 5 — model-ID constants imported by both call sites + 429 detection (dual-path)

export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
export const EMBEDDING_VERSION = 1 as const;
export const CLASSIFIER_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const;

export interface AiBindingResponse {
  // Embedding shape
  shape?: number[];
  data?: number[][];
  // Chat shape
  response?: string | object;
  // Error envelope shape (AI-SPEC.md §3 Pitfall #1)
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: unknown;
}

/**
 * Detects a Workers AI rate-limit response.
 *
 * Defense-in-depth: AI-SPEC.md (Context7-fetched 2026-05-27) documents the binding-level
 * envelope `{success:false, errors:[{code:7501,...}]}` for 429. Cloudflare's public error
 * docs page documents codes 3036 (Account limited) and 3040 (Out of capacity) at HTTP 429,
 * delivered via thrown `AiError`/`InferenceUpstreamError`. This function handles the
 * binding-envelope path; isRateLimitError below handles the thrown path.
 */
export function detectRateLimit(resp: AiBindingResponse | undefined | null): boolean {
  if (!resp || resp.success !== false) return false;
  const errs = resp.errors ?? [];
  if (errs.length === 0) return false;
  return errs.some((e) => {
    if (e.code === 7501 || e.code === 3036 || e.code === 3040) return true;
    return /429|rate|too\s*many|capacity/i.test(e.message ?? "");
  });
}

/**
 * Detects a thrown rate-limit error from env.AI.run().
 * Catches `AiError`, `InferenceUpstreamError`, and any error whose message indicates 429.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; status?: number };
  if (e.status === 429) return true;
  if (e.name && /AiError|InferenceUpstreamError/i.test(e.name)) {
    if (/429|rate|too\s*many|capacity/i.test(e.message ?? "")) return true;
  }
  return /429|rate|too\s*many|capacity/i.test(e.message ?? "");
}

/**
 * safeRun — wraps env.AI.run with the dual-path rate-limit detection.
 * On 429: throws a tagged RateLimitError that the caller (handler or queue consumer)
 * inspects to choose between handler-level error mapping and queue-level message.retry.
 */
export class RateLimitError extends Error {
  readonly isRateLimit = true;
  constructor(public readonly origin: "binding-envelope" | "thrown") {
    super(`Workers AI rate-limited (${origin})`);
    this.name = "RateLimitError";
  }
}

export async function safeRun(
  env: { AI: Ai },
  model: string,
  body: Record<string, unknown>,
): Promise<AiBindingResponse> {
  let resp: AiBindingResponse;
  try {
    resp = (await env.AI.run(model, body as any)) as AiBindingResponse;
  } catch (err) {
    if (isRateLimitError(err)) throw new RateLimitError("thrown");
    throw err;
  }
  if (detectRateLimit(resp)) throw new RateLimitError("binding-envelope");
  return resp;
}
```

### Example 6: `TriageOutput` Zod schema (NEW — Wave 4, triage-worker/src/schema.ts)

```typescript
// packages/triage-worker/src/schema.ts
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SYSTEM_MEMORY_TYPES = [
  "job_application",
  "contact",
  "company",
  "project",
  "research_note",
  "decision_log",
  "meeting_note",
] as const;

export const Entity = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["person", "company", "role", "date", "url"]),
});

export const TriageOutput = z.object({
  classified_type: z.enum(SYSTEM_MEMORY_TYPES),
  extracted_fields: z.record(z.string(), z.unknown()),
  entities: z.array(Entity).max(50),
  summary: z.string().min(10).max(800),
  memorability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export const TRIAGE_JSON_SCHEMA = zodToJsonSchema(TriageOutput, {
  target: "openApi3",
  $refStrategy: "none",
});
```

### Example 7: `vi.spyOn` mock pattern for AI binding (NEW — Wave 0 test infra)

```typescript
// packages/mcp-server/src/__tests__/tools-ai-mock.test.ts (illustration)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:workers";

describe("AI-03: remember embeds + upserts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: embed → stamp → upsert", async () => {
    const fakeEmbedding = new Array(768).fill(0.1);
    const aiSpy = vi.spyOn(env.AI, "run").mockResolvedValue({
      shape: [1, 768],
      data: [fakeEmbedding],
    } as any);
    const upsertSpy = vi.spyOn(env.VECTORIZE, "upsert").mockResolvedValue({
      mutationId: "test-mutation",
    } as any);

    // ... captureCallback("remember", workspace_id) → invoke → assertions ...

    expect(aiSpy).toHaveBeenCalledWith("@cf/baai/bge-base-en-v1.5", { text: [expect.any(String)] });
    expect(upsertSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ namespace: "ws-id", values: fakeEmbedding }),
    ]));
  });

  it("AI-07: 429 binding envelope triggers message.retry", async () => {
    vi.spyOn(env.AI, "run").mockResolvedValue({
      success: false,
      errors: [{ code: 7501, message: "Too Many Requests" }],
      result: null,
    } as any);

    // ... drive through extractAndScore with a fake message stub ...
    const message = {
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
      body: { id: "evt-1", content: "...", workspace_id: "ws-1", source: "mcp:claude", timestamp: Date.now() },
    };

    await extractAndScore(env as any, message.body, message as any);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("AI-07: 429 thrown error also triggers message.retry", async () => {
    const err: any = new Error("Too Many Requests");
    err.name = "AiError";
    err.status = 429;
    vi.spyOn(env.AI, "run").mockRejectedValue(err);

    const message = { /* ... as above ... */ };
    await extractAndScore(env as any, message.body, message as any);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });
});
```

**Source:** [VERIFIED via `cloudflare/workers-sdk/fixtures/vitest-pool-workers-examples/ai-vectorize`]. The `vi.spyOn(env.AI, "run").mockResolvedValue(...)` pattern is Cloudflare-canonical for mocking the AI binding.

### Example 8: WorkspaceDO new methods (EXTEND — Wave 0 or Wave 2)

```typescript
// packages/workspace-do/src/queries.ts — append
export function stampEmbedding(
  sql: SqlStorage,
  id: string,
  model: string,
  version: number,
): void {
  sql.exec(
    "UPDATE blocks SET embedding_model = ?, embedding_version = ?, updated_at = ? WHERE id = ?",
    model,
    version,
    Date.now(),
    id,
  );
}

export function getBlocksByIds(sql: SqlStorage, ids: string[]): Memory[] {
  if (ids.length === 0) return [];
  // Positional bindings — workerd SQLite supports positional `?` only (per migrations.ts comment).
  const placeholders = ids.map(() => "?").join(",");
  const rows = sql
    .exec(
      `SELECT id, type, content, summary, properties, embedding_id, embedding_model, embedding_version, scope, project_id, source, confidence, created_at, updated_at FROM blocks WHERE id IN (${placeholders})`,
      ...ids,
    )
    .toArray();
  return rows.map((row) => narrowBlockRow(row as Record<string, SqlStorageValue | undefined>));
}

export function updateBlockEnrichment(
  sql: SqlStorage,
  id: string,
  enrichment: { properties: Record<string, unknown>; summary: string; confidence: number },
): void {
  sql.exec(
    "UPDATE blocks SET properties = ?, summary = ?, confidence = ?, updated_at = ? WHERE id = ?",
    JSON.stringify(enrichment.properties),
    enrichment.summary,
    enrichment.confidence,
    Date.now(),
    id,
  );
}

export function moveToColdStorage(
  sql: SqlStorage,
  id: string,
  enrichment: { properties: Record<string, unknown>; summary: string; confidence: number; memorability: number },
): void {
  // Marks the block cold-storage; does NOT delete the row, does NOT touch Vectorize
  // (cold blocks are not indexed in v0.1 — they remain in SQLite forever).
  sql.exec(
    "UPDATE blocks SET cold_storage = 1, properties = ?, summary = ?, confidence = ?, updated_at = ? WHERE id = ?",
    JSON.stringify(enrichment.properties),
    enrichment.summary,
    enrichment.confidence,
    Date.now(),
    id,
  );
  // (Optional log to Workers Analytics Engine — Wave 6)
}

// packages/workspace-do/src/index.ts — wrap each as DO method with assertOwnsWorkspace
stampEmbedding(args: { workspace_id: string; block_id: string; embedding_model: string; embedding_version: number }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  stampEmbeddingQuery(this.ctx.storage.sql, args.block_id, args.embedding_model, args.embedding_version);
}

getBlocksByIds(args: { workspace_id: string; ids: string[] }): Memory[] {
  this.assertOwnsWorkspace(args.workspace_id);
  return getBlocksByIdsQuery(this.ctx.storage.sql, args.ids);
}

updateBlockEnrichment(args: { workspace_id: string; id: string; enrichment: { properties: Record<string, unknown>; summary: string; confidence: number } }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  updateBlockEnrichmentQuery(this.ctx.storage.sql, args.id, args.enrichment);
}

moveToInbox(args: { workspace_id: string; id: string; enrichment: { properties: Record<string, unknown>; summary: string; confidence: number; memorability: number } }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  // Uses existing createInboxEntry pattern — copy block content + proposed properties
  // ... implementation per spike-findings-engram + AI-SPEC.md §"State Management" ...
}

moveToColdStorage(args: { workspace_id: string; id: string; enrichment: { properties: Record<string, unknown>; summary: string; confidence: number; memorability: number } }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  moveToColdStorageQuery(this.ctx.storage.sql, args.id, args.enrichment);
}
```

### Example 9: Schema migration v2 (NEW — Wave 0)

```typescript
// packages/workspace-do/src/schema.ts — append after V1_SQL
export const V2_SQL = `
  ALTER TABLE blocks ADD COLUMN cold_storage INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_blocks_cold_storage ON blocks(cold_storage);
` as const;

// packages/workspace-do/src/migrations.ts — extend MIGRATIONS
import { V1_SQL, V2_SQL } from "./schema.js";
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema", sql: V1_SQL },
  { version: 2, name: "v2_cold_storage", sql: V2_SQL },
];
```

**Note:** SQLite booleans are stored as INTEGER (0/1). The narrowBlockRow helper does NOT need to read `cold_storage` for the Phase 5 hot path (recall hides cold blocks via WHERE clause). v0.2's `include_cold` recall flag will add the field-read path.

## Test Patterns

### Test infrastructure gap (Wave 0 must close)

- **`packages/triage-worker/vitest.config.ts`** — does NOT exist. Wave 0 task creates it, mirroring `packages/mcp-server/vitest.config.ts`.
- **`packages/triage-worker/wrangler.test.jsonc`** — does NOT exist. Wave 0 creates with AI + Vectorize + WORKSPACE bindings.
- **`packages/triage-worker/package.json` devDependencies** — does NOT have vitest, @cloudflare/vitest-pool-workers, or zod. Wave 0 adds: `vitest`, `@cloudflare/vitest-pool-workers`, `zod`, `zod-to-json-schema`. Promptfoo is a Wave 5 add.

### Mock-or-real strategy

| Test type | AI binding | Vectorize binding | When to run |
|---|---|---|---|
| Unit (most tests) | `vi.spyOn(env.AI, "run").mockResolvedValue(...)` | `vi.spyOn(env.VECTORIZE, ".").mockResolvedValue(...)` | Every PR CI |
| Integration (round-trip) | Real binding via `wrangler.test.jsonc` with `remote: true` OR mocked with realistic fixture data | Real binding via `remote: true` for the AI-02 namespace isolation test (no other way) | Nightly CI gate OR `npm run test:integration` (cost-controlled) |
| Eval (Promptfoo, recall F1) | Real binding (the whole point is measuring real quality) | Real binding | Pre-release CI; weekly batch via Cron Worker (Wave 5) |

### Forcing a 429 in tests

**Two test cases required (both shapes):**

```typescript
// Shape 1: binding envelope
vi.spyOn(env.AI, "run").mockResolvedValue({
  success: false,
  errors: [{ code: 7501, message: "Too Many Requests" }],
  result: null,
} as any);

// Shape 2: thrown error
const err: any = new Error("Too Many Requests");
err.name = "AiError";
err.status = 429;
vi.spyOn(env.AI, "run").mockRejectedValue(err);
```

Both must produce `message.retry({delaySeconds:30})` and NOT throw out of the consumer. This is AI-07 with defense-in-depth.

### Asserting namespace isolation between workspaces

Extends `cross-workspace-pentest.test.ts`:

```typescript
it("AI-02 Vectorize-side: query in workspace_B namespace does NOT return workspace_A vectors", async () => {
  // 1. write a vector under namespace=workspace_A via the legitimate handler path
  const rememberA = captureCallback("remember", "workspace_A");
  await rememberA({ content: "secret vectorized data in A" }, {});

  // 2. allow Vectorize eventual consistency window
  await new Promise((r) => setTimeout(r, 5000));

  // 3. forcibly query with the same embedding under workspace_B namespace
  // (requires real Vectorize binding via remote:true; no local emulator)
  const fakeEmbedding = new Array(768).fill(0.1);
  const matches = await vectorizeQuery(env as any, "workspace_B", fakeEmbedding, { topK: 10 });
  expect(matches.matches.length).toBe(0);
});
```

This is the AI-SPEC.md §5 dimension #3 acceptance test. MUST use real Vectorize binding.

### AI-08 forget round-trip (extends TOL-04)

```typescript
it("AI-08: remember → forget → wait → recall returns 0 semantic matches", async () => {
  const ws = "ws-ai08";
  const rememberCb = captureCallback("remember", ws);
  const forgetCb = captureCallback("forget", ws);
  const recallCb = captureCallback("recall", ws);

  const r = parseEnvelope(await rememberCb({ content: "unique forget test content xyz123" }, {}));
  const id = (r.result as any).id;

  await forgetCb({ id }, {});

  // Vectorize eventual consistency — AI-SPEC.md Pitfall #7 allows up to 5s
  await new Promise((r) => setTimeout(r, 5000));

  const recallResult = parseEnvelope(await recallCb({ query: "unique forget test xyz123" }, {}));
  const memories = (recallResult.result as any).memories as any[];
  expect(memories.length).toBe(0);
});
```

## Phase 5 Ranking Strategy (from spike-findings-engram skill — operative bullets for AI-04)

Drawn verbatim from `.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md`. The planner MUST embed these in `recall()` task acceptance criteria; **do NOT re-derive the ranking strategy from scratch — the spike findings are the contract.**

1. **Hybrid ranking is MANDATORY, not optional.** Spike 003 top cross-bucket cosine 0.8251 > intra-bucket mean 0.6472. Vector-only cosine ranking will surface wrong-type matches with high confidence. The Vectorize metadata filter (`type: { $in }`) is the structural defense; hybrid ranking is the in-handler scoring layer that pushes type matches up even when no explicit filter is supplied.

2. **Vectorize metadata filter is MANDATORY when `args.types` is supplied.** `filter: args.types?.length ? { type: { $in: args.types } } : undefined`. Pre-declaration via `wrangler vectorize create-metadata-index engram-memories --property-name=type --type=string` is in the Wave 1 setup script.

3. **Hybrid ranking formula (starting weights — tune in Wave 5/6 against real corpus):**
   ```
   score = 1.0·cosine + 0.15·recency + 0.2·type_match + 0.15·scope_match
   ```
   - `recency = exp(-ageHours / (24 * 30))` — 30-day half-life
   - `type_match = args.types?.includes(hit.metadata.type) ? 1 : 0`
   - `scope_match = args.scope && args.scope === hit.metadata.scope ? 1 : 0`

4. **Batch embeddings only at intake/migration; single-text on the hot path.** `remember()` and `recall()` send `text: [string]` (one element). Bulk re-embed migrations (Phase 5+) batch up to ~50-100 per call.

5. **Stamp `embedding_model` + `embedding_version` on every Vectorize upsert.** Hard precondition; planner's vectorize-helper.ts may enforce via PRE-call DB roundtrip if cost permits, OR via code-review checkpoint + test in `embedding-consistency.test.ts`.

6. **`research_note` heterogeneity** — accept for v0.1 per CONTEXT.md Claude's Discretion. Trust query expansion (v0.2) + tags (Phase 2 schema has the table) + type_match/scope_match weights to disambiguate. Surface to v0.2 if real-corpus testing flags the issue.

## Validation Architecture (Nyquist — REQUIRED, nyquist_validation = true)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^4.1.7` + `@cloudflare/vitest-pool-workers@^0.16.9` [VERIFIED] |
| Config files | `packages/mcp-server/vitest.config.ts` (exists), `packages/triage-worker/vitest.config.ts` (Wave 0 creates) |
| Quick run command | `npm test --workspace=packages/mcp-server` and `npm test --workspace=packages/triage-worker` |
| Full suite command | `npm test --workspaces` (from repo root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | Vectorize index exists with preset + idempotent setup | smoke | `npx wrangler vectorize get engram-memories --json | jq '.dimensions == 768 and .metric == "cosine"'` | Wave 1 creates `scripts/setup-vectorize.sh` |
| AI-02 | Namespace isolation: vector under ws_A not returned by query under ws_B | integration | `npm test --workspace=packages/mcp-server -- cross-workspace-pentest` | EXTEND existing file with new it() block |
| AI-03 | remember() embeds + stamps + upserts within 430ms p50 | unit (mocked) + integration (real bindings) | `npm test --workspace=packages/mcp-server -- tools-integration` | EXTEND existing file |
| AI-04 | recall() embeds + queries Vectorize + hybrid re-ranks; verbosity-conditional synthesis | unit + integration + eval | `npm test --workspace=packages/mcp-server -- recall-f1.eval` | NEW Wave 5 file `__tests__/evals/recall-f1.eval.test.ts` |
| AI-05 | Triage Worker extracts entities via structured JSON; ≥95% first-parse rate | unit (mocked) + eval (Promptfoo) | `npm test --workspace=packages/triage-worker -- extract` + `npx promptfoo eval -c packages/triage-worker/evals/triage-extraction.promptfoo.yaml` | NEW Wave 4/5 files |
| AI-06 | Memorability routing: >0.8 store, 0.4-0.8 inbox, <0.4 cold-storage; ±10pp band distribution | unit + eval | `npm test --workspace=packages/triage-worker -- memorability-calibration.eval` | NEW Wave 5 file |
| AI-07 | 429 triggers message.retry({delaySeconds:30}) — both envelope and thrown shapes | unit (forced 429) | `npm test --workspace=packages/triage-worker -- extract` (the 2 cases above) | NEW Wave 4 file |
| AI-08 | Forget cascade: remember → forget → wait 5s → recall = 0 matches | integration (real Vectorize) | `npm test --workspace=packages/mcp-server -- tools-integration` (AI-08 it() block) | EXTEND existing file |

### Validation dimensions per AI-NN requirement

| Req ID | Source-presence | Behavior-assertion | Integration-assertion | Eval-assertion |
|---|---|---|---|---|
| AI-01 | `scripts/setup-vectorize.sh` exists; `setup-vectorize` is in `npm run setup` chain | Re-running the script is a no-op (precheck via `wrangler vectorize get`) | `wrangler vectorize get engram-memories` returns 768 dimensions, cosine, preset | N/A (provisioning, not quality) |
| AI-02 | `vectorize-helper.ts` exists with mandatory workspaceId arg; no direct `env.VECTORIZE` access outside helper (grep check) | helper throws on missing/empty workspaceId; helper throws on namespace > 64 bytes | cross-workspace-pentest: ws_A vector not returned in ws_B query (real Vectorize binding) | N/A (security boundary, not quality) |
| AI-03 | `remember()` handler calls `env.AI.run(EMBEDDING_MODEL, ...)` + `stampEmbedding()` + `vectorizeUpsert()`; EMBEDDING_MODEL imported from shared constant | Mocked: handler invokes all 3 in correct order with correct args; envelope.result.id populated | Real: end-to-end remember() succeeds; SQLite row has embedding_model + embedding_version stamped; Vectorize index has the vector in the workspace namespace | Latency: p50 over 10 runs < 430ms (Section 7 budget) |
| AI-04 | `recall()` handler calls `env.AI.run(EMBEDDING_MODEL, ...)` + `vectorizeQuery(env, ws_id, ...)` + `getBlocksByIds()` + `hybridRank()`; verbosity branch matches D-01 default | Mocked: handler invokes all 4 in correct order; verbosity="chunks" skips synthesis; verbosity="synthesis" populates synthesis | Real: end-to-end recall() returns matches ranked by hybrid score; namespace isolation holds | F1 ≥ 75% on 20-example reference corpus (recall-f1.eval.test.ts) — BLOCKS AI-04 closure |
| AI-05 | `extract.ts` calls `env.AI.run(CLASSIFIER_MODEL, ...)` with `response_format: json_schema`; CLASSIFIER_MODEL imported from shared constant; TriageOutput Zod schema exists | Mocked: 429 envelope → message.retry({delaySeconds:30}); Zod parse fail attempts<2 → message.retry({delaySeconds:5}); attempts≥2 → message.ack() + log | Real (dev only): real llama-3.1-8b call against reference corpus produces parseable TriageOutput ≥95% | Promptfoo eval: `is-json` + `is-valid-zod(TriageOutput)` ≥95% first-parse rate |
| AI-06 | Triage consumer routes by `parsed.memorability`: >0.8 → updateBlockEnrichment, 0.4-0.8 → moveToInbox, <0.4 → moveToColdStorage (NOT discardWithLog per CONTEXT.md D-07) | Mocked: stub WorkspaceDO; assert correct method called with correct args at each band boundary (0.81, 0.8, 0.79, 0.4, 0.39) | Real (dev): full Triage round-trip per band; SQLite reflects state changes | Calibration eval: 20-sample distribution ±10pp from 60/30/10 target (memorability-calibration.eval) |
| AI-07 | `detectRateLimit` and `isRateLimitError` exist in ai-helper.ts; `safeRun` wraps env.AI.run with both | Mocked binding-envelope 429 → message.retry called with {delaySeconds:30}, ack not called, no console.error; Mocked thrown 429 → same; Mocked non-429 throws → bubbles up, message.retry NOT called | N/A (mocked is sufficient; real 429 hard to force) | N/A (deterministic test, not eval) |
| AI-08 | `forget()` handler calls `vectorizeDelete(env, ws_id, [id])` after (or before per partial-failure recommendation) `deleteBlock()` | Mocked: handler calls both; envelope still returns blocks_deleted truth | Real: remember → forget → sleep(5s) → recall returns 0 memories (Vectorize-side assertion) | N/A (deterministic round-trip, not eval) |

### Sampling Rate

- **Per task commit:** `npm test --workspace=<changed-package>` (~5–15s for unit-only)
- **Per wave merge:** `npm test --workspaces` (~30–60s with all unit tests; integration tests on dev opt-in)
- **Phase gate (`/gsd:verify-work 5`):** `npm run evals:ci` — runs all Vitest evals + Promptfoo full corpus; exits non-zero if F1 < 75% (dimension #1) OR JSON parse rate < 95% (dimension #4) OR any AI-02/AI-07/AI-08 test fails

### Wave 0 Gaps

- [ ] `packages/triage-worker/vitest.config.ts` — mirror mcp-server pattern (no exists)
- [ ] `packages/triage-worker/wrangler.test.jsonc` — declare AI + VECTORIZE + WORKSPACE service bindings for tests (no exists)
- [ ] `packages/triage-worker/package.json` devDependencies — add vitest, @cloudflare/vitest-pool-workers, zod, zod-to-json-schema (planner verifies each via npm view BEFORE install per Package Legitimacy Audit)
- [ ] `packages/mcp-server/wrangler.test.jsonc` — extend with AI + VECTORIZE bindings (add `"ai": {...}` and `"vectorize": [...]` arrays)
- [ ] `packages/mcp-server/wrangler.jsonc` — extend with AI + VECTORIZE bindings (production config)
- [ ] `packages/triage-worker/wrangler.jsonc` — extend with AI + VECTORIZE + WORKSPACE service binding (queue consumer block lands in Phase 6)
- [ ] RED test stubs: `__tests__/vectorize-helper.test.ts`, `__tests__/ai-helper.test.ts`, `__tests__/hybrid-rank.test.ts` (mcp-server); `__tests__/extract.test.ts` (triage-worker)
- [ ] `__tests__/envelope.test.ts` extension: verbosity-parameterized assertions per D-03
- [ ] `__tests__/tools-integration.test.ts` extension: AI-08 5-second-sleep round-trip
- [ ] `__tests__/cross-workspace-pentest.test.ts` extension: Vectorize-side AI-02 isolation
- [ ] Schema migration v2 (`cold_storage` column) in `workspace-do/src/schema.ts` + `migrations.ts`
- [ ] `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` per project CLAUDE.md mandate (Plan 05-01 creates)
- [ ] Doc touch-ups: AI-SPEC.md §4 diagram (D-04), CLAUDE.md ## Ingest Pipeline (cold-storage), spike-findings-engram/SKILL.md (D-05 verbosity note)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | yes (carry-forward from Phase 3 OAuth) | OAuth Provider per Phase 3; no Phase 5 changes |
| V3 Session Management | yes (Phase 3 OAuth-issued JWT; carry-forward) | `props.workspace_id` derived from JWT only; never from args |
| V4 Access Control | **YES — Phase 5 critical** | (1) `props.workspace_id` ALWAYS from JWT, NEVER from args (Phase 3 MCP-05 + Phase 4 T-04-DD-RT carry-forward). (2) Vectorize namespace = `workspace_id` enforced by `vectorize-helper.ts` (mandatory positional arg). (3) `WorkspaceDO.assertOwnsWorkspace` fires as first line on every new Phase 5 method (Phase 2 STO-07). (4) Triage Worker authenticates by passing `workspace_id` from MemoryEvent to every RPC call; STO-07 verifies at the DO boundary. |
| V5 Input Validation | yes | (1) Zod schemas at MCP boundary (Phase 3 SoT, unchanged). (2) Zod `TriageOutput.safeParse` at the LLM-output boundary (new in Phase 5 — gates malformed JSON from llama-3.1-8b). (3) `vectorize-helper.ts` length guard on namespace (64-byte cap). (4) `recall()` query length warning ≥1,800 chars (truncation surface). |
| V6 Cryptography | no (Phase 3 OAuth secret carry-forward; no Phase 5 cryptography) | N/A |
| V7 Error Handling | yes | `mapToMcpError` discipline (Phase 3 D-05 carry-forward). NEW: `RateLimitError` class for the dual-path detection; consumer translates to `message.retry`. Permanent failures log + ack (PIP-05 DLQ-equiv) — never silent drop. |
| V10 Malicious Code | yes | Package legitimacy audit (above). Zod gate on LLM output (failure mode #4 mitigation). |
| V11 Business Logic | yes | (1) AI-07 retry policy explicit (not throw-and-pray). (2) AI-08 forget cascade order documented (Pitfall 4). (3) Memorability routing thresholds public contract — code can change prompt, NOT thresholds. |

### Known Threat Patterns for Cloudflare Workers AI + Vectorize stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Cross-workspace vector leakage (forgotten namespace param) | Information Disclosure | `vectorize-helper.ts` mandatory positional `workspaceId` arg + grep/lint banning direct `env.VECTORIZE` access |
| Embedding model drift (write vs read) | Tampering | Shared `EMBEDDING_MODEL` constant + STO-04 stamp on every write + embedding-consistency.test.ts identity check |
| Workers AI 429 → full batch fail | Denial of Service | `detectRateLimit` + `isRateLimitError` defense-in-depth; `message.retry` not throw |
| Malformed LLM JSON output crashes Triage consumer | Denial of Service | Zod gate at boundary; safeParse + 1 retry then ack+log; never throw |
| Forget orphan vector → "ghost" recall | Information Disclosure (semantic, not data) | Reverse-order delete (Vectorize first, SQLite second) + 5s eventual-consistency window in AI-08 test |
| Prompt injection in user content | Tampering | None added in v0.1 (single-user, low-stakes). System prompt is constant; user content is `user` role only (separated). Future v1.0 multi-tenant revisits. |
| Long-content silent truncation | Information Disclosure (degraded recall) | 1,800-char threshold + frozen META_GAPS string surfaces to Claude |
| Vectorize index re-create destroys data | Repudiation | Setup script is idempotent (no destructive default); index preset is locked at create time; documented in setup README |

## State of the Art

| Old Approach (Phase 4 baseline) | Current Approach (Phase 5 target) | When Changed | Impact |
|---|---|---|---|
| Lexical (`instr()` LIKE) search over SQLite | Semantic search via Vectorize + hybrid rank | Phase 5 ships AI-04 | Recall quality jumps from "exact-substring or nothing" to "semantic similarity"; spike-validated as MANDATORY for the use case |
| `recall().synthesis = null` always | Conditional synthesis per `verbosity` arg (D-01: default `"chunks"` skips LLM) | Phase 5 ships AI-04 + D-01 | Default recall stays fast (no 2-5s LLM tax); synthesis opt-in via three discoverability surfaces |
| `result.entities = []`, `meta.confidence = null` (honest stubs) | Real Triage Worker extracted entities + confidence scores | Phase 5 ships AI-05 (Triage consumer body) | Envelope shape unchanged; values populated; META_GAPS strings removed per the field-population map |
| No Vectorize provisioning | `engram-memories` index with bge-base preset + namespace per workspace + metadata indexes for type/scope | Phase 5 ships AI-01 + AI-02 | Permanent commitment to 768d cosine; permanent commitment to one-global-index topology |
| `<0.4 memorability` → discard (CLAUDE.md current Ingest Pipeline) | `<0.4` → cold-storage column (CONTEXT.md D-07) | Phase 5 ships AI-06 + migration v2 | Russell's "cardinal sin" framing honored; no data loss; v0.2 may add recall include_cold flag |
| `verbosity` default `"both"` (Phase 4 D-02) | `verbosity` default `"chunks"` (Phase 5 D-01) | Phase 5 amends Phase 4 D-02 | Speed-by-default for job-search agent multi-step loops; spike-fragility honored differently (chunks alone is enough; synthesis on demand still passes F1 ≥ 75% gate) |

**Deprecated / outdated:**
- `lexicalSearchBlocks` in `workspace-do/src/queries.ts` — still used by `search()` (Phase 4 untouched in Phase 5); Phase 5's `recall()` switches to `getBlocksByIds`. Eventually `search()` may move to a Vectorize-backed structured-filter path, but that's v0.3 scope.
- The "discard <0.4 memorability" branch in CLAUDE.md `## Ingest Pipeline` — Wave 0 doc-touch-up replaces with "cold-storage <0.4".
- AI-SPEC.md §4 contract diagram showing synthesis always wired — Wave 0 amendment per D-04 makes the default-recall skip explicit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Workers AI 429 error code is `7501` per AI-SPEC.md (Context7-fetched 2026-05-27) | Pattern 4 / ai-helper.ts | Public Cloudflare errors page lists codes 3036 (Account limited) and 3040 (Out of capacity) at HTTP 429 — `7501` is NOT documented. Mitigation: `detectRateLimit` checks BOTH paths (envelope `success:false` with any of {7501, 3036, 3040} OR message text regex). Risk: if neither code surfaces in production, the helper falls back to text matching `/429|rate|too many|capacity/i`. Test BOTH binding-envelope and thrown-error shapes. |
| A2 | Workers AI binding returns `{success:false, errors:[]}` on 429 instead of throwing per AI-SPEC.md | Pitfall 3 / safeRun | Cloudflare error docs and community examples show `env.AI.run()` THROWS `AiError` or `InferenceUpstreamError` with HTTP 429. Mitigation: `safeRun` catches the throw path AND inspects the envelope path; throws tagged `RateLimitError` in either case. Test both paths in `ai-helper.test.ts`. |
| A3 | `wrangler vectorize create` errors when index already exists (not idempotent) | Setup script | Cloudflare docs do not explicitly document the error path. Setup script handles via precheck `wrangler vectorize get` before create — works regardless of whether create errors or no-ops. |
| A4 | `zod-to-json-schema` and `promptfoo` are legitimate npm packages | Package Legitimacy Audit | slopcheck not available; both tagged `[ASSUMED]`. Planner must add `checkpoint:human-verify` task before install. Russell verifies via `npm view <pkg> repository.url` and matches against known maintainer accounts. |
| A5 | `services` vs `durable_objects.bindings` for Triage Worker → WorkspaceDO access (which one CF supports for cross-Worker DO RPC in 2026-05) | Example 2 wrangler.jsonc | Both should work; recommendation is `durable_objects.bindings` with `script_name` for v0.1. If `services` with `entrypoint` is the modern path, planner can switch. Risk: planner picks wrong one and deploy fails — easy to remediate. |
| A6 | `getAgentByName(env.WORKSPACE, workspace_id)` is the RPC entrypoint for cross-Worker DO access (used by both mcp-server and triage-worker) | Pattern 4 | This is the AI-SPEC.md-documented pattern but is `agents/mcp` SDK-specific. May need `env.WORKSPACE.get(env.WORKSPACE.idFromName(workspace_id))` raw stub form in triage-worker if `agents` package isn't imported there. Planner picks. |
| A7 | The `suggestions` field on `EngramResponse` is optional and Phase 4 envelope tests will not break when Phase 5 populates `suggestions.actions` on default recalls | D-02 wiring | The type def confirms `suggestions?: { actions: string[]; queries: string[] }` is optional. Phase 4 tests that DO assert `suggestions === undefined` would fail; planner must check `__tests__/envelope.test.ts` for such assertions and amend per D-03. |
| A8 | Eventual consistency window for Vectorize upsert/delete is bounded by ~5 seconds | AI-08 test | AI-SPEC.md and CF docs say "may take a few seconds" — no SLA. 5s slack is the AI-SPEC.md choice. Risk: production sees longer windows; integration test goes flaky. Mitigation: convert to poll-with-timeout (poll every 500ms up to 10s) if flake observed in CI. |
| A9 | Cold-storage routing (`<0.4` memorability) is a near-locked CONTEXT.md recommendation; the planner ships it unless they surface a compelling counter-argument | D-07 / Wave 0 migration v2 | CONTEXT.md uses "Strong recommendation" language but "planner discretion" allows hard-discard. If planner ships hard-discard, the migration v2 step disappears but CLAUDE.md doc-touchup also reverses. Russell's "cardinal sin" framing in the source todo is the binding argument. |
| A10 | `promptfoo` works on workerd-compatible Node and doesn't need a separate Python sidecar | Wave 5 eval harness | AI-SPEC.md §5 documents this as the choice. If promptfoo turns out to require Python (e.g. for certain assertions), planner falls back to Vitest-only evals for AI-05 and adds Promptfoo as v0.2 work. |

## Open Questions for the Planner

1. **Workers AI 429 mechanics — envelope-return vs throw.** AI-SPEC.md (Context7-fetched 2026-05-27) documents the binding returning `{success:false, errors:[{code:7501,...}]}`. Cloudflare's public errors documentation (verified 2026-05-28) documents codes 3036 (Account limited) and 3040 (Out of capacity) at HTTP 429, delivered via thrown `AiError`/`InferenceUpstreamError`. Both may be valid depending on which infrastructure layer fails. **Recommendation: implement BOTH detection paths** (`detectRateLimit` + `isRateLimitError`) in `ai-helper.ts`, test BOTH paths in `ai-helper.test.ts`, document the dual mechanism in the helper's JSDoc. Cost is ~30 lines of helper code; value is robustness against either code's appearance in production.

2. **Vectorize integration tests — `remote: true` cost and CI integration.** No local emulator exists for Vectorize. Integration tests (AI-02 namespace isolation, AI-08 forget round-trip) MUST run against real Vectorize. **Planner decides:** (a) gate these tests behind `npm run test:integration` (manual / nightly only), accepting that PR-time CI does NOT verify them; (b) wire `remote: true` bindings into `wrangler.test.jsonc` and run on every PR with cost (~$0.001 per test run); (c) split — unit tests with mocks in PR CI, integration tests in nightly CI Cron Worker. **Recommendation: (c)** — PR CI stays fast and free; nightly catches regressions.

3. **`forget()` order: SQLite-first vs Vectorize-first?** Pitfall 4 analyzes both. AI-SPEC.md §3 shows SQLite-first then Vectorize. Recommendation in Pattern 3 is to flip to Vectorize-first because the ghost-recall failure mode is worse UX than orphan-block-in-SQLite. **Planner decides.** If Vectorize-first, test in `tools-integration.test.ts` AI-08 block needs reordering; the existing TOL-04 SQLite-first test stays as-is (semantics of "SQLite block gone after forget" hold either way).

4. **`durable_objects.bindings` (with `script_name`) vs `services` (with `entrypoint`) for Triage Worker → WorkspaceDO.** Both Cloudflare-supported patterns. The mcp-server hosts the WorkspaceDO; the triage-worker needs RPC access. **Recommendation:** `durable_objects.bindings` with `script_name = "engram-mcp-server"`. Established pattern, less novel surface. If the planner wants newer `services` entrypoint syntax, both work; document the choice in 05-CONTEXT.md or 05-RESEARCH.md addendum.

5. **Real-corpus F1 gate — Wave 0 hard gate vs Wave-N validation step.** CONTEXT.md recommends (b) Wave-N validation. **Open:** when in Wave 5 exactly? After `recall()` ships (Wave 3 done)? After Triage Worker ships (Wave 4 done)? After all evals are in place (Wave 5 complete)? Recommendation: dedicated task at end of Wave 5 that pulls 10–20 of Russell's job-search agent corpus samples, sanitizes, labels against the 4-bucket reference structure, runs the recall-f1.eval, and produces a `.planning/phases/05-ai-integration/05-REAL-CORPUS-RESULTS.md` artifact. Gates the AI-04 requirement marked-done in REQUIREMENTS.md.

6. **Hybrid rank weight tuning timing.** AI-SPEC.md ships starting weights; CONTEXT.md recommends (b) — tune in Wave 5/6 against real-corpus samples once labeled. **Planner decides** whether to include a tuning task in Phase 5 plan or punt to v0.2. Recommendation: one tuning task in Wave 5 (after real-corpus samples land), single A/B against the F1 metric, persist chosen weights in `hybrid-rank.ts` constants with a comment "tuned 2026-MM-DD against real-corpus N=20."

7. **Cron Worker for weekly eval flywheel** — AI-SPEC.md §6 specifies Sunday 06:00 UTC. **Open:** is this a new Worker (`packages/eval-cron-worker`) or a `scheduled()` handler added to the existing mcp-server or triage-worker? Recommendation: standalone tiny Worker `packages/eval-cron-worker` to keep the mcp-server fast-path clean. Lives in Wave 6 (production monitoring), can be deferred to v0.2 if Phase 5 timeline tight.

8. **`research_note` heterogeneity** — CONTEXT.md recommends Accept (option a) per spike findings. **Planner confirms** Phase 5 ships accept; tag-cluster (b) and k-means (c) deferred to v0.2 unless real-corpus testing in Wave 5 surfaces heterogeneity-induced recall misses.

9. **Workers Analytics Engine `env.ANALYTICS` binding** — Wave 6 (production monitoring). **Open:** is the binding declared in Wave 6 only, or in Wave 0 (alongside AI + VECTORIZE) for type-checking? Recommendation: declare in Wave 0 wrangler.jsonc EDIT alongside AI/VECTORIZE for type-correctness; write-call sites land in Wave 6.

10. **`include_cold` recall flag** — out of Phase 5 scope per CONTEXT.md (v0.2). **Open:** does Phase 5's `recall()` SQL WHERE clause include `AND (cold_storage = 0 OR cold_storage IS NULL)`? Recommendation: YES — even without the flag, cold blocks must be excluded from default recall results from the moment migration v2 ships. The recall path through Vectorize doesn't return cold vectors (they're never upserted by `moveToColdStorage`), but a future migration that retroactively cold-storages existing indexed vectors would surface them without the WHERE clause. Belt-and-suspenders.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | Phase 5 dev + CI | ✓ | v22.14.0 [VERIFIED] | — |
| npm | workspaces install | ✓ | 11.15.0 [VERIFIED] | — |
| wrangler (via npx) | Vectorize provisioning, wrangler dev/deploy | ✓ | 4.94.0 [VERIFIED via `npx wrangler --version`] | — |
| Cloudflare account with Workers AI + Vectorize enabled | AI-01 setup + all AI-NN execution | ✓ (per Phase 3+4 deploys; Russell's account) [ASSUMED — Russell confirms] | — | — |
| `wrangler login` session | Workers AI dev-time real-binding tests, setup-vectorize.sh | ✓ (per spike findings + Phase 3/4 dev) [ASSUMED — Russell confirms current session valid] | — | — |
| zod | Phase 3 carry-forward | ✓ | ^4.0.0 [VERIFIED] | — |
| @cloudflare/vitest-pool-workers | All Phase 5 tests | ✓ in mcp-server | ^0.16.9 [VERIFIED] | — |
| @cloudflare/vitest-pool-workers | triage-worker tests | ✗ | — | Wave 0 adds via `npm install --workspace=packages/triage-worker --save-dev @cloudflare/vitest-pool-workers vitest` |
| zod | triage-worker code | ✗ | — | Wave 0 adds via `npm install --workspace=packages/triage-worker zod` |
| zod-to-json-schema | triage-worker Wave 4 | ✗ | — | Wave 1 adds (gated by Package Legitimacy Audit checkpoint) |
| promptfoo | Wave 5 eval CI | ✗ | — | Wave 5 adds (gated by Package Legitimacy Audit checkpoint) |
| Workers AI local emulator | Unit tests | ✗ | — | Use `vi.spyOn(env.AI, "run").mockResolvedValue(...)` per Cloudflare canonical pattern |
| Vectorize local emulator | Unit + integration tests | ✗ | — | Use `vi.spyOn(env.VECTORIZE, "query").mockResolvedValue(...)` for unit; `remote: true` binding in wrangler.test.jsonc for integration |

**Missing dependencies with no fallback:** none — all gaps have either an install task (Wave 0/1/5) or a mocking pattern.

**Missing dependencies with fallback:** Workers AI + Vectorize local emulation has the Cloudflare-canonical `vi.spyOn` fallback; the planner uses this for ≥80% of tests and uses real `remote: true` only for AI-02 namespace isolation + AI-08 forget round-trip + Wave 5 evals.

## Sources

### Primary (HIGH confidence — Cloudflare official docs + verified local code)

- `/Users/rmoore/Workspaces/engram/.planning/phases/05-ai-integration/05-AI-SPEC.md` — Phase 5 master design contract (914 lines)
- `/Users/rmoore/Workspaces/engram/.planning/phases/05-ai-integration/05-CONTEXT.md` — User decisions D-01..D-07
- `/Users/rmoore/Workspaces/engram/.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md` — Envelope-field-population map
- `/Users/rmoore/Workspaces/engram/.claude/skills/spike-findings-engram/{SKILL.md, references/*.md}` — Spike findings, ranking strategy, synthesis contract
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/src/{tools,envelope,schemas}.ts` — Phase 4 live code
- `/Users/rmoore/Workspaces/engram/packages/workspace-do/src/{index,queries,schema,migrations}.ts` — DO surface
- https://developers.cloudflare.com/vectorize/reference/client-api/ — Vectorize API signatures (upsert, query, deleteByIds)
- https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/ — Namespace 64-byte limit, max 1000 namespaces/index, metadata key constraints
- https://developers.cloudflare.com/vectorize/best-practices/query-vectors/ — topK default 5 / max 100 (50 with returnValues:true or returnMetadata:"all")
- https://developers.cloudflare.com/vectorize/reference/metadata-filtering/ — `$in/$eq/$ne/$nin/$lt/$lte/$gt/$gte` operators, implicit AND, 2048-byte filter cap, pre-declared metadata indexes
- https://developers.cloudflare.com/queues/configuration/javascript-apis/ — `message.retry({delaySeconds: positive integer})`, throw retries entire batch (VERIFIED), `message.attempts` 1-indexed
- https://developers.cloudflare.com/workers-ai/features/json-mode/ — `response_format: {type: "json_schema", json_schema}`, `.response` field, best-effort compliance ("Workers AI can't guarantee...")
- https://developers.cloudflare.com/workers-ai/platform/errors/ — 429 codes 3036 (Account limited) and 3040 (Out of capacity) [contradicts AI-SPEC.md's 7501 claim — see Assumption A1]
- https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/ai-vectorize — Canonical `vi.spyOn(env.AI, "run").mockResolvedValue(...)` test pattern
- `npx wrangler --version` → 4.94.0; `npx wrangler vectorize create --help` → preset/dimensions/metric flags

### Secondary (MEDIUM confidence — verified via web search + cross-referenced)

- https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/ — `cloudflare:test` exports (`runInDurableObject`, `createExecutionContext`, etc.)
- https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/ — `remote: true` binding pattern
- https://blog.cloudflare.com/workers-vitest-integration/ — vitest-pool-workers overview
- https://developers.cloudflare.com/workers-ai/configuration/bindings/ — `env.AI.run()` minimal signature
- https://developers.cloudflare.com/vectorize/get-started/embeddings/ — RAG tutorial confirming `embed.data[0]` unwrap

### Tertiary (LOW confidence — single-source claims marked for validation)

- Workers AI 429 binding-envelope vs thrown error mechanism — AI-SPEC.md claims envelope (Context7-fetched 2026-05-27); Cloudflare community examples + errors page suggest thrown. Defense-in-depth implementation covers both. [LOW confidence on which is canonical; HIGH confidence that the dual-detection helper handles both.]
- `wrangler vectorize create` idempotency — not explicitly documented; setup-script precheck via `wrangler vectorize get` is the robust workaround. [LOW confidence on native idempotency; HIGH confidence on the workaround.]
- `services` vs `durable_objects.bindings` for cross-Worker DO RPC in 2026-05 wrangler — both supported, but the recommended pattern in current docs is ambiguous. Phase 5 ships `durable_objects.bindings`. [MEDIUM confidence.]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by AI-SPEC.md (Context7-verified 2026-05-27) + verified again against current Cloudflare docs 2026-05-28
- Architecture: HIGH — CONTEXT.md decisions + AI-SPEC.md + spike findings all align
- Pitfalls: MEDIUM-HIGH — 10 enumerated from official docs + Phase 4 carry-forward + AI-SPEC.md §3; the 429 mechanism pitfall has LOW confidence on which shape is canonical (Open Question 1)
- Validation Architecture: HIGH — eval tooling locked by AI-SPEC.md §5; test infrastructure gap identified explicitly
- Security domain: HIGH — STRIDE patterns documented; ASVS V4 access control is the Phase 5 critical surface

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (30 days for stable Cloudflare APIs; sooner if Cloudflare announces Vectorize/Workers AI changes — set a weekly check during Phase 5 execution)
