# Roadmap: Engram v0.1 — MCP Foundation

**Project:** Engram (MCP-native second brain on Cloudflare)
**Milestone:** v0.1 — MCP Foundation
**Linear Milestone:** v0.1 — MCP Foundation (target 2026-06-07)
**Created:** 2026-05-24
**Granularity:** standard (horizontal layers)
**Mode:** standard

> **Project mode:** PROJECT_MODE = standard (Horizontal Layers). Each phase is a horizontal slice (types/config → storage → MCP scaffold → tools → AI/pipeline → deploy) that enables the next. Phases are NOT user-story slices — they are dependency-ordered foundation layers, intentionally so for v0.1.

## Coverage

- v0.1 requirements: **54**
- Mapped to phases: **54**
- Unmapped: **0**

## Phases

- [x] **Phase 1: Foundation** — Monorepo, shared types, system memory type seeds, per-package `wrangler.jsonc`, license, CLAUDE.md corrections (completed 2026-05-25)
- [x] **Phase 2: WorkspaceDO + SQLite** — Durable Object with idempotent schema migrations, all seven tables, system type seeding, typed query helpers, vitest coverage (completed 2026-05-26)
- [x] **Phase 3: MCP Server Scaffold** — `EngramMcp extends McpAgent`, JWT-to-`props` middleware, two-DO topology, empty tool registrations, MCP Inspector connectivity (completed 2026-05-26)
- [x] **Phase 4: Core Tools + Envelope** — `remember`/`recall`/`search`/`forget`/`ingest` with `EngramResponse` envelope, `McpError` shape, response-size budgets, transactional `forget`, cross-workspace penetration test (completed 2026-05-27)
- [ ] **Phase 5: AI Integration** — Vectorize index + namespaces, `bge-base-en-v1.5` embeddings on sync write, semantic recall, Triage-Worker AI (entity extraction, memorability), 429-aware retry, vector delete on forget
- [x] **Phase 6: Async Pipeline** — `engram-ingest` Queue, producer wiring with `ctx.waitUntil`, Triage Worker consumer with idempotency + DLQ, `blocks.ingest_status` tracking, RPC back into WorkspaceDO (completed 2026-05-29)
- [ ] **Phase 7: Deploy + Acceptance** — `wrangler deploy` for both Workers, Russell JWT + Claude Desktop config, end-to-end acceptance (store in conv A, recall in conv B), job-search agent flipped over, setup README

## Phase Details

### Phase 1: Foundation

**Goal:** A clean clone bootstraps into a typed, lint-clean, license-bearing monorepo where every Worker package can boot under `wrangler dev`, and CLAUDE.md reflects the corrected baseline (JSONC, two-DO topology, `McpAgent`, `search` without `format?`, `ingest-worker` deferred).
**Depends on:** none
**Requirements:** FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08
**Plans:** 6/6 plans complete

Plans:
**Wave 1**

- [x] 01-01-PLAN.md (Wave 1, autonomous) — Root scaffolding: package.json + workspaces, tsconfigs, ESLint flat config, Prettier, Husky+lint-staged, dotfiles, LICENSE [FND-01, FND-06]
- [x] 01-02-PLAN.md (Wave 1, autonomous) — FND-08 wrangler lint script + good/bad fixtures + smoke scripts (install + wrangler-dev) [FND-08]
- [x] 01-03-PLAN.md (Wave 1, autonomous) — CLAUDE.md surgical edits per RESEARCH Pattern 11 (six line-anchored swaps + three additive paragraphs) [FND-07]

**Wave 2** _(blocked on Wave 1 completion)_

- [x] 01-04-PLAN.md (Wave 2, autonomous) — Shared packages: @engram/types (5 v0.1 types) + @engram/schema (7 system memory types) [FND-04, FND-05]

**Wave 3** _(blocked on Wave 2 completion)_

- [x] 01-05-PLAN.md (Wave 3, autonomous) — Worker packages: @engram/mcp-server (two-DO topology) + @engram/triage-worker (minimal) + @engram/workspace-do (library stub); end-to-end wrangler dev + lint:wrangler proofs [FND-02, FND-03]

**Wave 4** _(blocked on Wave 3 completion)_

- [x] 01-06-PLAN.md (Wave 4, checkpoint) — GitHub Actions CI workflow + portfolio-quality README + docs/architecture.svg + scripts/setup-dev.sh retirement + human-verify checkpoint [FND-01, FND-03, FND-08]

**Success Criteria:**

1. `git clone` + `npm install` from a clean tree completes without errors and produces a working workspace tree (`packages/*`, `shared/*`).
2. `npx wrangler dev` against a placeholder Worker boots end-to-end and serves a no-op response without errors.
3. `shared/types` exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` and at least one other package imports them successfully.
4. `shared/schema/system-types.ts` exports the seven system memory type definitions with field metadata; type-check passes.
5. CI lint rule rejects any `wrangler.jsonc` whose `[[migrations]]` declares a Durable Object class under `new_classes` instead of `new_sqlite_classes`; the rule is wired into `npm run lint:wrangler` and runs in CI.
6. `LICENSE` exists at repo root with Apache-2.0 text and a top-of-file comment "subject to final confirmation at v1.0".
7. CLAUDE.md reflects v0.1 architectural corrections (JSONC, two DO classes, `McpAgent`, `search` without `format?`, `ingest-worker` deferred to v0.4).

**Risk Notes:**

- **Touches irreversible decision DO-1 (SQLite class election)** via FND-08 — the CI lint rule established here is the only durable defense against accidental `new_classes` regressions when new Workers are scaffolded later. (Maps to SUMMARY.md §7 item #1.)
- **Touches irreversible decision C8 (license)** via FND-06 — Apache-2.0 placeholder must land at first commit to avoid accidental drift to AGPL/no-license.
- PROJECT.md/CLAUDE.md doc drift is a known hazard; FND-07 is the canonical "update CLAUDE.md to JSONC and two-DO topology" task and must not be skipped.

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)

### Phase 2: WorkspaceDO + SQLite

**Goal:** `WorkspaceDO` is a SQLite-backed Durable Object that owns the per-workspace schema, seeds system memory types idempotently, exposes typed query helpers for every v0.1 read/write pattern, and survives hibernation replay without duplication or migration re-runs.
**Depends on:** Phase 1
**Requirements:** STO-01, STO-02, STO-03, STO-04, STO-05, STO-06, STO-07, STO-08, STO-09, STO-10
**Success Criteria:**

1. A fresh `WorkspaceDO` instance constructs cleanly, runs schema migrations exactly once via a `_schema_migrations` table inside `blockConcurrencyWhile()`, and the SQLite database contains all seven tables (`blocks`, `relations`, `tags`, `members`, `memory_types`, `inbox`, `conflicts`).
2. The `blocks` table includes `embedding_model TEXT` and `embedding_version INTEGER` columns from the first migration (verified by introspecting `PRAGMA table_info(blocks)` in a vitest assertion).
3. After first init the `memory_types` table contains the seven system types; a forced re-init does not duplicate rows (verified via `INSERT OR IGNORE` round-trip test).
4. Every typed query helper (insert block, get block by id, lexical `LIKE` search, delete block + cascade relations, list memory types, create inbox entry, list conflicts) has a passing vitest under `@cloudflare/vitest-pool-workers`.
5. Hibernation-replay test: simulating DO eviction and re-instantiation does not re-run completed migrations and does not duplicate seed data.
6. Grep-based lint (or test) flags any `blockConcurrencyWhile()` block containing `env.`, `fetch(`, or `await this.ai` patterns and fails CI on regression.
7. Cross-workspace defense-in-depth: every `WorkspaceDO` method throws `McpError(-32600 InvalidRequest)` when `this.state.id.name !== args.workspace_id` (covered by unit test before any tool wiring exists).

**Risk Notes:**

- **Touches irreversible decision STO-01 / DO-1 (`new_sqlite_classes`)**: declaration must be in `wrangler.jsonc` and verified by the FND-08 lint. Catastrophic if missed at first deploy. (SUMMARY.md §7 #1.)
- **Touches irreversible decision STO-02 / DO-2 (schema migration without `PRAGMA user_version`)**: STO-02 + STO-09 are the mitigation pair — `_schema_migrations` table + hibernation-replay test. (SUMMARY.md §7 #2.)
- **Touches irreversible decision DO-3 (`blockConcurrencyWhile` across I/O)**: STO-10 enforces this by lint; STO-02 only uses `blockConcurrencyWhile()` for synchronous SQL init. (SUMMARY.md §7 #3.)
- **Touches irreversible decision AI-1 / STO-04 (embedding columns from day 1)**: must land in P2's first migration even though AI doesn't activate until P5. (SUMMARY.md §7 #8.)
- **Touches irreversible decision MT-1 / STO-07 (DO defense-in-depth)**: workspace_id check verified here so all later tool/RPC code inherits it. (SUMMARY.md §7 #4.)

**Plans:** 9/9 plans complete

Plans:

**Wave 0** (test infrastructure)

- [x] 02-00-PLAN.md (Wave 0, autonomous) — Vitest framework install + per-package vitest.config.ts + wrangler.test.jsonc + 6 RED test stubs + 2 lint fixtures under __fixtures__/ + root npm test wiring [STO-08]

**Wave 1** (schema + migrations + seeding — sequential within wave, can run after Wave 0)

- [x] 02-01-PLAN.md (Wave 1, autonomous) — Migration runner (_schema_migrations table, no PRAGMA user_version) + NotFoundError class [STO-02]
- [x] 02-02-PLAN.md (Wave 1, autonomous) — V1_SQL DDL string (7 tables + 10 indexes + STO-04 embedding columns) [STO-03, STO-04]
- [x] 02-03-PLAN.md (Wave 1, autonomous) — seedSystemTypes helper (INSERT OR IGNORE on SYSTEM_TYPES) [STO-05]

**Wave 2** (DO body wiring + 3 GREEN test files)

- [x] 02-04-PLAN.md (Wave 2, autonomous) — WorkspaceDO constructor wires runMigrations + seedSystemTypes inside blockConcurrencyWhile + GREEN schema/seeding/hibernation tests [STO-01, STO-02, STO-05, STO-09]

**Wave 3** (query helpers + last GREEN test file)

- [x] 02-05-PLAN.md (Wave 3, autonomous) — 7 typed query helpers (queries.ts) + query-specific types (types.ts) + WorkspaceDO method scaffolding + GREEN helpers test [STO-06]

**Wave 4** (defense-in-depth + lint script — parallel)

- [x] 02-06-PLAN.md (Wave 4, autonomous) — assertOwnsWorkspace guard + per-method wiring + GREEN defense-in-depth test [STO-07]
- [x] 02-07-PLAN.md (Wave 4, autonomous) — scripts/lint-blockconcurrency.mjs + GREEN self-test [STO-10]

**Wave 5** (CI + lint-staged wiring)

- [x] 02-08-PLAN.md (Wave 5, autonomous) — CI workflow patch (3-step lint block + Vitest step) + lint-staged rule [STO-08, STO-10]


**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)

### Phase 3: MCP Server Scaffold

**Goal:** The `mcp-server` Worker hosts an `EngramMcp extends McpAgent` that validates JWTs, populates `this.props.{workspace_id, user_id}`, routes every tool call to the correct `WorkspaceDO` via `getAgentByName(env.WORKSPACE, this.props.workspace_id)`, and exposes the five v0.1 tools (as empty registrations) to any MCP client.
**Depends on:** Phase 2
**Requirements:** MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-09
**Success Criteria:**

1. `packages/mcp-server/` uses `agents/mcp` `McpAgent` (^0.13.2) — not raw `@modelcontextprotocol/sdk` HTTP transport — and exports an `EngramMcp` class served at `/mcp` via `McpAgent.serve("/mcp")`.
2. The Worker's `wrangler.jsonc` declares BOTH DO classes under `new_sqlite_classes` (`EngramMcp` session DO + `WorkspaceDO` durable store) and the deploy plan recognizes them as the same script.
3. JWT validation middleware extracts `workspace_id` + `user_id` from the bearer token and exposes them on `this.props`; unit test verifies that an invalid/missing JWT rejects with a JSON-RPC error.
4. All five v0.1 tools (`remember`, `recall`, `search`, `forget`, `ingest`) are registered with zod input schemas; tool handlers route through `getAgentByName(env.WORKSPACE, this.props.workspace_id).<method>()` (no direct DO storage access from the Worker).
5. `npx @modelcontextprotocol/inspector` connects to a local `wrangler dev` instance and lists all five tools by name.

**Risk Notes:**

- **Touches irreversible decision A1/A2 (`McpAgent` host + two-DO topology)**: MCP-01–03 implement this directly. Hand-rolling Streamable HTTP transport here would be ~500 LOC of avoidable boilerplate. (SUMMARY.md §3 A1/A2.)
- **Touches irreversible decision MT-1 (defense-in-depth)**: routing pattern in MCP-05 must always pass `this.props.workspace_id` to RPC calls — never let user input override it. (SUMMARY.md §7 #4.)
- `agents` SDK is pre-1.0 (0.13.2); MCP-01 pins the exact version. Expect one breaking change between v0.1 and v1.0; integration test against MCP Inspector on every SDK bump.

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)
**UI hint:** no

**Plans:** 6/6 plans complete

Plans:

**Wave 0** (test infrastructure + dependency installs + EngramProps interface emit)

- [x] 03-01-PLAN.md (Wave 0, autonomous) — package.json deps (oauth-provider 0.7.0, zod ^4, vitest), EngramProps interface emit (no default-export swap), vitest.config.ts + wrangler.test.jsonc + 4 RED test files, scripts/kv-bootstrap.mjs + root npm script [MCP-01, MCP-06]

**Wave 1** (pure-data/pure-function modules — parallel within wave)

- [x] 03-02-PLAN.md (Wave 1, autonomous) — schemas.ts (5 zod input schemas + 5 z.infer aliases, T-03-DD-IN structural invariant) + error-mapping.ts (mapToMcpError + sanitize for T-03-LEAK) + schemas.test.ts + error-mapping.test.ts GREEN [MCP-06]

**Wave 2** (independent modules — parallel within wave; both depend on Wave 0+1)

- [x] 03-03-PLAN.md (Wave 2, autonomous) — tools.ts (registerTools + 5 MethodNotFound stubs with TOL pointers + Phase-4-ready comment block enforcing T-03-DD-RT) + tools.test.ts GREEN [MCP-05, MCP-06]
- [x] 03-04-PLAN.md (Wave 2, autonomous) — oauth.ts (defaultHandler: /, /health, /authorize with KV-only props per T-03-PROPS, sanitized 500 per T-03-PARSE, 403 with no KV-value leak per T-03-KV-LEAK) + oauth.test.ts GREEN [MCP-04]

**Wave 3** (unifier — depends on all of Wave 1+2)

- [x] 03-05-PLAN.md (Wave 3, autonomous) — index.ts default-export swap to OAuthProvider wrapping EngramMcp + defaultHandler, EngramMcp.init wires registerTools, wrangler.jsonc v2 migration + KV bindings + JSDoc cleanup per D-09, worker-configuration.d.ts regen, wrangler deploy --dry-run gate per Pitfall 3, index.test.ts GREEN [MCP-01, MCP-02, MCP-03]

**Wave 4** (docs + manual smoke — blocked on Wave 3)

- [x] 03-06-PLAN.md (Wave 4, checkpoint:human-verify) — DEP-05 README (OAuth flow, mcp-remote, Claude Desktop config, KV bootstrap, COOKIE_ENCRYPTION_KEY setup, MCP Inspector smoke procedure, troubleshooting) + MCP Inspector manual smoke against `wrangler dev` recorded in 03-MCP-INSPECTOR-SMOKE.md [MCP-09]

### Phase 4: Core Tools + Envelope

**Goal:** The five v0.1 tools work end-to-end against the WorkspaceDO using the lexical (SQL `LIKE`) backing, every response is wrapped in the `EngramResponse` envelope, failures use `McpError` with proper JSON-RPC codes, response sizes stay under the 8K-token budget, `forget` is transactional and complete, and cross-workspace penetration testing confirms the JWT-to-DO defense holds.
**Depends on:** Phase 3
**Requirements:** TOL-01, TOL-02, TOL-03, TOL-04, TOL-05, TOL-06, TOL-07, TOL-08, MCP-07, MCP-08
**Success Criteria:**

1. `remember(content, type?, project?, tags?, source?, expires?)` writes to `blocks` via `WorkspaceDO` RPC and returns an `EngramResponse<{id, classified_type, extracted_fields, confidence}>` envelope with `context.conflicts` populated when lexical overlap is detected.
2. `recall(query, types?, project?, scope?, limit?, since?, until?)` returns an `EngramResponse<{memories, synthesis}>` with `context.related`, `context.entities`, and `meta.gaps` populated (recall backing is `LIKE`-based; semantic upgrade lands in P5).
3. `search(query, filters)` returns an `EngramResponse<{memories, count}>` and accepts NO `format?` parameter (export is a deferred v0.3 tool).
4. `forget(id, cascade?)` deletes the block plus (when `cascade=true`) related blocks and relations rows transactionally; a `remember → forget → recall` round-trip returns zero matches (verified by integration test). The `forget` contract already promises "Vectorize vectors will be deleted too" — implementation extends in P5.
5. `ingest(source, type?, project?, priority?, threshold?)` enqueues a `MemoryEvent` and returns `EngramResponse<{status, job_id}>` (Queue wiring lands in P6; the contract ships here).
6. Every tool response wraps in `EngramResponse<T>` envelope (`result`, `context.{related, entities, timeline?, conflicts?}`, `meta.{confidence, coverage, last_updated, gaps}`, `suggestions?.{actions, queries}`) — fields may be null/empty, envelope shape is always present.
7. Tool failures throw `McpError` with appropriate JSON-RPC error codes (`-32602 InvalidParams`, `-32600 InvalidRequest`, etc.); no ad-hoc `{error: "..."}` envelopes; verified by an integration test that asserts user-visible failure on bad input.
8. Unit test per tool asserts serialized success-case response stays under 8K tokens with worst-case data (tokenizer: `gpt-tokenizer`); each tool description is <1.5KB.
9. Cross-workspace penetration test: a request bearing a `workspace_A` JWT cannot read or write `workspace_B` data even if the DO id is supplied directly; the STO-07 check fires and the request is rejected.
10. Russell's job-search agent can call `remember()` to store a job posting (URL + extracted fields) and `recall()` against the same workspace; integration smoke test passes.

**Risk Notes:**

- **Touches irreversible decision MP-5 / TOL-04 (transactional `forget`)**: contract must already promise "gone everywhere" in v0.1 even before Vectorize exists, so P5 only has to extend implementation, not redesign the contract. (SUMMARY.md §7 #7.)
- **Touches irreversible decision MCP-1/MCP-7 (response size budgets)**: MCP-08 unit tests are the only durable defense against 8K-token regressions as future features add envelope fields. (SUMMARY.md §7 #5.)
- **Touches irreversible decision MCP-3 (`McpError` shape)**: ad-hoc error envelopes would be misread by Claude as data; the integration test in success-criterion 7 is non-negotiable. (SUMMARY.md §7 #6.)
- **Touches irreversible decision A8 (`EngramResponse` envelope on every tool from v0.1)**: skipping the envelope here is a breaking-change debt that grows with every consumer. All five tools wrap it from day 1.
- **Touches irreversible decision MT-1 (defense-in-depth)**: TOL-07 penetration test is the only behavioral proof that workspace isolation holds. (SUMMARY.md §7 #4.)

**Plans:** 7/7 plans complete

Plans:

**Wave 0** (RED scaffolds + types)

- [x] 04-01-PLAN.md (Wave 0, checkpoint:human-verify) — gpt-tokenizer install + Memory meta widening to number|null + schemas diff (verbosity D-03, limit ≤25 D-10) + result-types.ts (6 interfaces) + 4 RED test scaffolds [TOL-01, TOL-06, TOL-07, MCP-08]

**Wave 1** (envelope helpers)

- [x] 04-02-PLAN.md (Wave 1, autonomous) — envelope.ts (5 build*Response builders + trimToBudget + wrapMcpContent + META_GAPS frozen strings) [TOL-06, MCP-08]

**Wave 2** (live tool handler bodies)

- [x] 04-03-PLAN.md (Wave 2, autonomous) — tools.ts: 5 live async handler bodies (remember/recall/search/forget/ingest) routing through WorkspaceDO via DO namespace, all 116 tests GREEN [TOL-01, TOL-02, TOL-03, TOL-04, TOL-05, MCP-07]

**Wave 3** (behavioral proofs)

- [x] 04-04-PLAN.md (Wave 3, autonomous) — TOL-07 cross-workspace pentest (Prong A + B) + MCP-08 token-budget behavioral proof (6/6 GREEN) [TOL-07, MCP-08]

**Wave 4** (docs + smoke)

- [x] 04-05-PLAN.md (Wave 4, checkpoint:human-verify) — TOL-08 local MCP Inspector smoke (status: resolved) + DEP-05 README Tool Surface section + 04-PHASE-5-HANDOFF.md [TOL-08]

**Wave 5** (gap closure — CR-01 fix)

- [x] 04-06-PLAN.md (Wave 5, autonomous) — CR-01: widen Memory.type to string|null, fix remember handler to store null not research_note, relax narrowBlockRow invariant, add round-trip regression test [TOL-01]

**Wave 6** (gap closure — TOL-08 override)

- [x] 04-07-PLAN.md (Wave 6, autonomous) — TOL-08 verbal-acceptance override: add overrides block to 04-VERIFICATION.md frontmatter, add ### Verification Override subsection to 04-MCP-INSPECTOR-SMOKE.md [TOL-08]

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)
**UI hint:** no

### Phase 5: AI Integration

**Goal:** Vectorize is provisioned with the `bge-base-en-v1.5` preset (768d, cosine, namespaced per workspace), `remember()` synchronously embeds + upserts to Vectorize on the sync write path, `recall()` performs semantic search and hydrates from SQLite, the Triage Worker handles entity extraction + memorability scoring via Workers AI with 429-aware retry, and `forget()` cascades to the Vectorize vector.
**Depends on:** Phase 4
**Requirements:** AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08
**Success Criteria:**

1. Vectorize index `engram-memories` is created idempotently via setup script using `--preset=@cf/baai/bge-base-en-v1.5` (768 dimensions, cosine metric); re-running setup is a no-op.
2. The index uses Vectorize **namespaces** for tenant isolation (one global index; `namespace = workspace_id`); a unit/integration test confirms a vector upserted under `workspace_A` is not returned by a query in `workspace_B`'s namespace.
3. `remember()` synchronously generates an embedding via `env.AI.run('@cf/baai/bge-base-en-v1.5', ...)`, stamps `embedding_model='@cf/baai/bge-base-en-v1.5'` and `embedding_version=1` on the row, and upserts the vector to Vectorize in the workspace namespace before the tool returns.
4. `recall()` embeds the query via the same model, queries Vectorize top-K within the workspace namespace, hydrates the matching block records from SQLite, and returns ranked semantic results (replacing the P4 lexical backing).
5. Triage Worker calls `env.AI.run('@cf/meta/llama-3.1-8b-instruct', ...)` with structured JSON output for entity extraction; results update `blocks.properties` and `blocks.summary` via RPC back to the WorkspaceDO. Memorability scoring routes: `>0.8` stored normally, `0.4–0.8` written to the `inbox` table, `<0.4` discarded with a log line.
6. Workers AI rate-limit handling: a forced 429 in tests triggers `message.retry({delaySeconds: 30})` rather than failing the whole consumer batch.
7. `forget()` deletes the Vectorize vector in the workspace namespace in addition to the SQLite row; round-trip test `remember → forget → recall` returns zero matches semantically (extends TOL-04 to the Vectorize layer).

**Risk Notes:**

- **Touches irreversible decision A10 / AI-1 (embedding dimension/metric/index lock-in)**: 768d cosine `engram-memories` is permanent once a vector lands. STO-04's columns enable future re-embed but the v0.1 choice is binding. (SUMMARY.md §7 #8 paired with §3 A10.)
- **Touches irreversible decision A5 (one global Vectorize index, namespace per workspace)**: never create one index per workspace — 100-index-per-account cap kills the managed model. AI-02 is the implementation of this rule. (SUMMARY.md §3 A5.)
- **Touches AI-2 / PITFALLS AI-2 (rate-limit handling)**: AI-07 enforces explicit `message.retry()` over thrown errors to preserve Queue retry budget.
- **Touches irreversible decision MP-5 (transactional forget)**: AI-08 is the v0.1 completion of the `forget` contract started in P4. (SUMMARY.md §7 #7.)
- The triage-worker AI calls run only inside the Queue consumer (P6), never on the sync write path beyond `remember()`'s inline embedding. This split keeps `remember()` latency at ~150–430ms per ARCHITECTURE.md §"Data Flow Diagrams".

**Plans:** 7 plans across 6 waves

Plans:

**Wave 0** (infra + tracker + migrations + WorkspaceDO RPCs + RED stubs + doc touch-ups)

- [ ] 05-01-PLAN.md (Wave 0, checkpoint:human-verify) — BLOCKING cf-code-assist routing tracker + wrangler AI/VECTORIZE bindings + triage-worker vitest infra + schema v2 (cold_storage) + 5 new WorkspaceDO RPCs + RecallInputSchema verbosity default flip + 4 RED test stubs + AI-SPEC.md/CLAUDE.md/SKILL.md doc touch-ups [AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08]

**Wave 1** (helpers + setup script — blocked on Wave 0)

- [ ] 05-02-PLAN.md (Wave 1, autonomous) — scripts/setup-vectorize.sh idempotent provisioning + vectorize-helper.ts (mandatory workspaceId + 64-byte guard) + ai-helper.ts (model constants + dual-path 429 + safeRun + RateLimitError) + hybrid-rank.ts (locked AI-04 formula) [AI-01, AI-02, AI-03, AI-04, AI-07]

**Wave 2** (parallel — both depend on Wave 1; no file overlap)

- [ ] 05-03-PLAN.md (Wave 2, autonomous) — remember() AI-03 sync embed+stamp+upsert + truncation warn + forget() AI-08 Vectorize-first cascade + AI-02 Prong C pentest + AI-08 round-trip + lint-no-direct-vectorize gate [AI-02, AI-03, AI-08]
- [ ] 05-04-PLAN.md (Wave 2, checkpoint:human-verify) — Package Legitimacy Audit (zod-to-json-schema) + Triage Worker schemas/prompts/memorability/extract/index queue consumer + cross-file ai-helper identity test [AI-05, AI-06, AI-07]

**Wave 3** (recall — depends on Waves 1+2)

- [ ] 05-05-PLAN.md (Wave 3, autonomous) — recall() AI-04 semantic backing (Vectorize + hybrid rank + conditional synthesis per D-01) + envelope.ts D-02 discoverability triad + trimToBudget synthesis-preservation + recall tool description amendment [AI-02, AI-04]

**Wave 4** (evals + real-corpus gate + tuning — depends on Waves 2+3)

- [ ] 05-06-PLAN.md (Wave 4, checkpoint:human-verify) — Package Legitimacy Audit (promptfoo) + 20-example reference corpus + recall-f1.eval F1≥0.75 gate + embedding-consistency cross-file test + Promptfoo extraction eval + memorability-calibration eval + Russell real-corpus sanitization checkpoint + hybrid-rank weight tuning + npm run evals:ci wiring [AI-04, AI-05, AI-06]

**Wave 5** (production monitoring — depends on Wave 4; LOW priority — may defer to v0.2 if timeline tight)

- [ ] 05-07-PLAN.md (Wave 5, autonomous) — Workers Analytics Engine writeAnalytics helpers (mcp-server + triage-worker siblings) + instrumentation at AI/Vectorize/DO-RPC call sites + canonical SQL queries + 05-MONITORING-NOTES.md runbook (Email Routing alerts + Logpush + monthly calibration cadence; eval-cron-worker deferred to v0.2) [AI-04, AI-05, AI-07]

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)

### Phase 6: Async Pipeline

**Goal:** The `engram-ingest` Queue connects the MCP Worker (producer, via `ctx.waitUntil`) to the Triage Worker (consumer), `MemoryEvent.id` serves as the idempotency key with `INSERT OR IGNORE` semantics, partial failures are tracked via `blocks.ingest_status`, and retries / DLQ logging never silently drop events.
**Depends on:** Phase 5
**Requirements:** PIP-01, PIP-02, PIP-03, PIP-04, PIP-05, PIP-06
**Success Criteria:**

1. `engram-ingest` Queue exists (created via setup script idempotently) and is bound to `mcp-server` (producer) and `triage-worker` (consumer) per the per-package `wrangler.jsonc` configs.
2. Synchronous writes from `remember()` go directly to `WorkspaceDO` via RPC; `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` fires the async enrichment afterward — verified by latency test: `remember()` returns before the queue message is consumed.
3. `MemoryEvent.id` is a UUID generated by the producer; replaying the same event through the consumer twice does not duplicate blocks (verified by integration test using `INSERT OR IGNORE` semantics).
4. The Triage Worker performs entity extraction, summarization, and memorability scoring; writes results back to the `WorkspaceDO` via RPC (not direct SQL). _Conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01._
5. Triage Worker failures use `message.retry()` for transient errors or `message.ack()` + DLQ logging for permanent failures; no silent drops; a test exercises both paths.
6. `blocks.ingest_status` column tracks per-block enrichment state (`pending`, `enriched`, `failed`); a query that joins on this column returns coherent partial-failure visibility for the v0.2 inbox UI.

**Risk Notes:**

- **Touches irreversible decision A7 / C5 (direct RPC for sync writes, Queue for async)**: PIP-02 enforces the split. Routing `remember()` through Queue would add 100–500ms of latency on a synchronous user action. (SUMMARY.md §3 A7 + §6 C5.)
- **Touches irreversible decision A11 / IP-1 (Queue at-least-once → idempotency)**: PIP-03 implements `MemoryEvent.id` as the idempotency key. Duplicate handling design is set when the contract is.
- **Touches IP-7 (silent partial failures)**: PIP-06 (`ingest_status`) is the schema-level mitigation; without it, blocks stuck at "phase 1 only" become invisible.
- Triage Worker RPC into WorkspaceDO must respect the STO-07 workspace_id check; PIP-04's RPC calls always pass the workspace_id from the MemoryEvent.

**Plans:** 5/5 plans complete

Plans:

**Wave 1** (doc touch-ups + v3 migration — no deps)

- [x] 06-01-PLAN.md (Wave 1, autonomous) — ROADMAP/REQUIREMENTS/pending-todo doc edits per D-01 (defer conflict detection to v0.2) + V3_SQL `ingest_status` migration (TEXT NOT NULL DEFAULT 'pending' + index) + schema.test.ts v3 column + 3-row `_schema_migrations` assertions [PIP-04, PIP-06]

**Wave 2** (parallel — both depend on Wave 1; no file overlap)

- [x] 06-02-PLAN.md (Wave 2, autonomous) — scripts/setup-queue.sh idempotent provisioning + npm run setup:queue + mcp-server queues.producers binding (INGEST_QUEUE) + triage-worker queues.consumers binding (max_batch_size 10, max_retries 3, NO dead_letter_queue per D-03) + registerTools 4th param `getCtx` + EngramMcp.init wires `() => this.ctx` [PIP-01, PIP-02]
- [x] 06-03-PLAN.md (Wave 2, autonomous) — queries.ts pending→enriched in updateBlockEnrichment / moveToColdStorage / moveToInbox + createInboxEntry INSERT OR IGNORE (PIP-03 idempotency) + new markIngestFailed helper + WorkspaceDO.markIngestFailed RPC (STO-07 first line) + defense-in-depth.test.ts STO-07 gate on new RPC [PIP-03, PIP-04, PIP-05, PIP-06]

**Wave 3** (producer wiring + consumer permanent-failure paths — depends on Waves 1+2)

- [x] 06-04-PLAN.md (Wave 3, autonomous) — remember() MemoryEvent assembly + getCtx().waitUntil(INGEST_QUEUE.send) + ingest() comment retarget per D-02 + extract.ts widen env to include WORKSPACE + markIngestFailed in Zod-permanent + non-429-last-attempt branches + triage-worker/index.ts try/catch around DO-RPC switch + attempts >= 2 pre-emption + markIngestFailed + message.ack (no silent drop) [PIP-02, PIP-03, PIP-04, PIP-05]

**Wave 4** (behavioral verification — depends on Wave 3)

- [x] 06-05-PLAN.md (Wave 4, autonomous) — queue-integration.test.ts (replay-twice idempotency + ingest_status lifecycle: 3 happy paths + 2 failure paths + cold-storage/inbox orthogonality + markIngestFailed observability) + tools-integration.test.ts PIP-02 latency describe (remember() resolves before 200ms queue.send delay — ctx.waitUntil decoupling proof) [PIP-01, PIP-02, PIP-03, PIP-04, PIP-05, PIP-06]

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)

### Phase 7: Deploy + Acceptance

**Goal:** Both Workers ship to Russell's Cloudflare account via `wrangler deploy`, a single Russell-workspace JWT is configured into Claude Desktop via `mcp-remote`, the v0.1 acceptance test passes (store in conversation A, recall in conversation B 1+ hour later), Russell's job-search agent is rewired to Engram as its memory backend, and the setup README is good enough for Russell — and eventually Devon — to follow without tribal knowledge.
**Depends on:** Phase 6
**Requirements:** DEP-01, DEP-02, DEP-03, DEP-04, DEP-05
**Success Criteria:**

1. `wrangler deploy` succeeds for both `packages/mcp-server/` and `packages/triage-worker/` against Russell's Cloudflare account; both Workers are live and reachable at `*.workers.dev` URLs.
2. A JWT for Russell's single workspace is issued (via a documented script or runbook), pasted into Claude Desktop's MCP config via the `mcp-remote` bridge, and the connection is verified by listing the five Engram tools in Claude Desktop.
3. **Acceptance test (the v0.1 done-state):** Russell asks Claude in conversation A to `remember` a job posting (URL + role + company). One or more hours later, in conversation B (no shared chat history), Russell asks "what job did I save earlier?" Claude calls `recall`, returns the correct posting with extracted fields, and Russell reads it back. Test passes on at least two consecutive runs.
4. Russell's job-search agent is reconfigured to use Engram as its memory backend; the agent's existing job-storage flow continues to work end-to-end (no regression in the agent's capture path).
5. Setup README documents prereqs (Cloudflare account, paid Workers plan, npm 10+), one-command bootstrap (`npm install && npm run setup`), Claude Desktop config snippet, and troubleshooting for the common errors observed during P1–P6.

**Risk Notes:**

- First production deploy exercises every irreversible decision at once. The CI lint from P1 (FND-08) is the last gate against `new_classes` regressions in any wrangler config that has been touched since.
- `mcp-remote` is community-maintained (SUMMARY.md §9 risk flag). Watch Claude Desktop releases for native Streamable HTTP support and drop the proxy when it lands.
- Russell's job-search agent rewire (DEP-04) is the first real-world stress test of the EngramResponse envelope shape and the recall semantic-vs-lexical promotion (P5). A regression here means scoping the issue immediately — do not let v0.1 close until DEP-04 holds for at least 3 consecutive working days (per REQUIREMENTS.md acceptance criteria).

**Plans:** 1/4 plans executed

Plans:

**Wave 1** (npm script wiring — no deps)

- [x] 07-01-PLAN.md (Wave 1, autonomous) — package.json setup chain extension per D-07 (chain setup:queue + completion echo) + deploy / deploy:mcp / deploy:triage scripts per D-08 (cross-worker DO deploy order: mcp-server BEFORE triage-worker) + scripts/kv-bootstrap.mjs `--help` discoverability hint pointing at README Step 4 [DEP-01, DEP-05]

**Wave 2** (README hoist — depends on Wave 1)

- [ ] 07-02-PLAN.md (Wave 2, autonomous) — root README.md restructure: Getting Started numbered Steps 1-4 (Install, Deploy, Configure Claude Desktop, First tool call OAuth bootstrap per D-02 with literal `Unknown OAuth subject` 403 body verbatim from oauth.ts:201) + new H2 `## Deploy` documenting all three scripts with cross-worker DO precondition + new H2 `## Troubleshooting` with 6 P1-P6 triaged entries (EXCLUDES the bootstrap-403 entry per D-02) + new H2 `## Reference` with down-links to per-package READMEs [DEP-02, DEP-05]

**Wave 3** (HUMAN-UAT skeleton — depends on Wave 2)

- [ ] 07-03-PLAN.md (Wave 3, autonomous) — create EMPTY 07-HUMAN-UAT.md skeleton with frontmatter (`status: in_progress`, `phase: 07-deploy-acceptance`, `source: [REQUIREMENTS.md#DEP-03, REQUIREMENTS.md#DEP-04]`) + 3 test stubs (DEP-03 Run 1, DEP-03 Run 2 with different posting per D-03, DEP-04 rewire smoke per D-06) with merged Phase 1 + Phase 3 evidence shape + operator-facing sub-redaction guidance + Summary block matching /gsd:audit-uat format. Skeleton structure only — Russell populates [pending] -> [pass/fail] entries DURING the 1-2 day acceptance window in Plan 04 [DEP-03, DEP-04]

**Wave 4** (deploy execution + human-gated acceptance — depends on Waves 1-3)

- [ ] 07-04-PLAN.md (Wave 4, checkpoint:human-verify + checkpoint:human-action) — Task 1: run `npm run deploy` from Plan 01 wrapper, verify both Workers live at *.workers.dev URLs (DEP-01) + Task 2 (human-verify): Russell configures Claude Desktop + walks OAuth bootstrap per README Steps 3+4, verifies 5 tools listed (DEP-02) + Task 3 (human-action): DEP-03 Run 1 + Run 2 over 1-2 day window with 1+ hour real wall-clock wait per D-03, populate 07-HUMAN-UAT.md entries + Task 4 (human-action): DEP-04 rewire smoke per D-06 (forward-only per D-05 — no pre-Engram file migration), populate Rewire smoke entry [DEP-01, DEP-02, DEP-03, DEP-04]

**Linear:** Maps to milestone "v0.1 — MCP Foundation" (existing in workspace)
**UI hint:** no

## Progress

| Phase                    | Plans Complete | Status      | Completed |
| ------------------------ | -------------- | ----------- | --------- |
| 1. Foundation            | 6/6 | Complete   | 2026-05-25 |
| 2. WorkspaceDO + SQLite  | 9/9 | Complete   | 2026-05-26 |
| 3. MCP Server Scaffold   | 6/6 | Complete   | 2026-05-26 |
| 4. Core Tools + Envelope | 7/7 | Complete   | 2026-05-27 |
| 5. AI Integration        | 0/7            | Ready to execute | —    |
| 6. Async Pipeline        | 5/5 | Complete   | 2026-05-29 |
| 7. Deploy + Acceptance   | 1/4 | In Progress|  |

## Parallelization Notes

`config.parallelization = true`. Phase ordering above is the strict dependency chain; within that chain, the following sub-tracks can run in parallel during plan-phase decomposition:

- **Phase 1:** FND-01/02/03 (monorepo + wrangler bootstrap) is independent of FND-04 (shared types) and FND-05 (system-types seed file). FND-06 (LICENSE) and FND-07 (CLAUDE.md edits) are doc-only and parallel with everything else.
- **Phase 2:** STO-01/02/03/04 (DO + schema) must precede STO-05/06 (seed + helpers). STO-08/09 (vitest + hibernation test) can be written alongside STO-06 in parallel.
- **Phase 4:** Tool implementation order within the phase is `remember → recall → search → forget → ingest` per ARCHITECTURE.md §"Build-Order Dependencies"; envelope wrapper (TOL-06) can be developed in parallel as a helper. MCP-08 (size budgets) lands after each tool exists.
- **Phase 5:** AI-01/02 (Vectorize index + namespaces, setup script) is independent of AI-05 (Triage Worker AI) and can run in parallel. AI-03/04 (sync embed + semantic recall) sit on the critical path.
- **Phase 6:** PIP-01/02 (Queue wiring) blocks PIP-03/04/05/06. PIP-06 (`ingest_status` column) is a schema migration that can be developed in parallel with PIP-04.

## Phases NOT in v0.1 (anchor for future milestones)

These exist in REQUIREMENTS.md "Later Milestones" and will be scoped via `/gsd:new-milestone` when each begins:

- **v0.2 — Intelligence Layer (target 2026-06-21):** semantic conflict detection upgrade, query expansion, embedding upgrade-path validation
- **v0.3 — Workspaces + Memory Types (target 2026-07-12):** UserDO/TeamDO/ProjectDO hierarchy, member management, `reflect`/`relate`/`export` tools, user-defined memory types
- **v0.4 — Connectors + Alerts (target 2026-08-02):** Slack + Drive connectors, `ingest-worker` package returns, daily digest, inbox UI, `conflict` tool, killer demo
- **v1.0 — Public Launch (target 2026-09-01):** managed hosting, Stripe billing, OAuth, admin UI, connector registry, OSS launch

---

_Roadmap created: 2026-05-24_
