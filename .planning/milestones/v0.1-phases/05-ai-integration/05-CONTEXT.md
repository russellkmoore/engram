# Phase 5: AI Integration - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning
**Discussion mode:** discuss (single area deep-dived: synthesis policy)

<domain>
## Phase Boundary

Vectorize and Workers AI go live. The index `engram-memories` is provisioned with `--preset=@cf/baai/bge-base-en-v1.5` (768d, cosine) and uses `namespace = workspace_id` for tenant isolation (one global index, AI-02). `remember()` synchronously generates an embedding via `env.AI.run('@cf/baai/bge-base-en-v1.5', ...)`, stamps `(embedding_model, embedding_version) = ('@cf/baai/bge-base-en-v1.5', 1)` on the SQLite row (STO-04 columns), and upserts the vector into the workspace namespace before returning. `recall()` embeds the query with the same model, runs Vectorize top-K against the workspace namespace with the AI-04 metadata filter (`type` $in when `args.types` supplied), hydrates full block records via `WorkspaceDO.getBlocksByIds(...)`, and re-ranks with the spike-validated hybrid formula (`α·cosine + β·recency + γ·type_match + δ·scope_match`, starting weights from `phase-5-ranking-strategy.md`). The Triage Worker package introduces `extract.ts` + `memorability.ts` + `prompts.ts` + `schema.ts`, calls `@cf/meta/llama-3.1-8b-instruct` with `response_format: { type: "json_schema", json_schema: zodToJsonSchema(TriageOutput) }`, parses through a Zod gate (one retry on parse failure at 5s, then ack+log per Section 4b), routes by memorability score (>0.8 normal, 0.4–0.8 inbox, <0.4 — see Deferred), and handles Workers AI 429 via `success: false` inspection → `message.retry({delaySeconds: 30})` (AI-07). `forget()` cascades the SQLite delete to `env.VECTORIZE.deleteByIds([id])` in the same workspace namespace (AI-08, allowing up to 5s for Vectorize eventual consistency). The Phase 4 `EngramResponse<T>` envelope shape stays frozen; Phase 5 is a body change that swaps null/empty values for real AI output. Phase 5 covers requirements **AI-01..AI-08** (8 total); the `ingest()` handler is untouched (Queue wiring lands in Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Synthesis policy on `recall()` (amends Phase 4 D-02)

- **D-01: `verbosity` default flips from `"both"` to `"chunks"` — synthesis becomes opt-in.** Phase 4 D-02 (and `spike-findings-engram` requirements line "verbosity parameter default is 'both' on recall(), NOT 'synthesis'") defaulted to `"both"` so synthesis would run on every recall with chunks as a recovery surface. Phase 5 amends: the LLM synthesis call costs 2–5s of additional p50 latency and ~$0.002/call. For Russell's recall pattern (job-search agent, Claude Desktop sessions), paying that tax on every default recall is a worse UX trade-off than the "Claude makes a follow-up call when synthesis is wanted" cost. Effects:
  - Schema diff: `RecallInputSchema.verbosity = z.enum(["synthesis", "chunks", "both"]).optional().default("chunks")` (was `default("both")`).
  - Handler behavior on default recall: embed query → Vectorize query → hybrid re-rank → hydrate → return `result.memories` + `result.chunks` + `result.synthesis = null`. The synthesis LLM call is **skipped entirely** — no latency cost, no token cost.
  - `verbosity: "synthesis"` still runs synthesis and returns `result.synthesis !== null` with `result.chunks = null` (chunks-as-recovery rationale is moot when caller explicitly asked for synthesis).
  - `verbosity: "both"` still runs synthesis AND returns chunks alongside (the original recovery-surface posture).
  - `verbosity: "chunks"` (now the default) skips synthesis, returns memories + chunks.
  - Enum shape unchanged (Phase 4 hand-off "DO NOT change the verbosity enum" honored — only the default changes).

- **D-02: Discoverability of opt-in synthesis — three surfaces, defense in depth.** When `recall()` returns the default chunks-only response, Claude is told via:
  - **Tool description** (in `packages/mcp-server/src/tools.ts` registration): documents the default and the opt-in path. Must stay under the MCP-08 1.5KB budget per tool description; the planner picks final wording. Suggested addition: `"Default verbosity is 'chunks' (raw memories + scored chunks, no LLM summary). Pass verbosity: 'synthesis' to add an LLM summary (adds 2–5s latency)."`
  - **`meta.gaps` string** (frozen, byte-stable for MCP-08 reproducibility): on every default recall, `meta.gaps` includes `"Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary."` This is a new frozen META_GAPS string added to the envelope builder.
  - **`suggestions.actions` entry** (first activation in v0.1 — amends Phase 4 D-04 which deferred `suggestions` to v0.2): on every default recall, `suggestions.actions` includes `"Set verbosity: 'synthesis' to add a summary of these memories."` `suggestions` was Phase-4-undefined; Phase 5 activates it for this single signal. Planner: extend `buildRecallResponse(...)` in `envelope.ts` to accept and populate `suggestions`.

- **D-03: Knock-on to AI-SPEC.md Section 5 eval dimension #8 (honest-stub envelope contract preserved).** The dimension #8 assertion `expect(env.result.synthesis).not.toBeNull()` for "AI input fixtures" must be **conditioned on the fixture passing `verbosity: "synthesis"` or `verbosity: "both"`**. Default-verbosity fixtures must assert `synthesis === null` AND that `meta.gaps` + `suggestions.actions` carry the discoverability strings. Phase 5 plan: amend the eval harness so the test parameterizes by verbosity. The real-corpus F1 ≥ 75% gate on AI-04 closure still applies — when callers opt in, synthesis must work — but the metric now measures opt-in calls only.

- **D-04: AI-SPEC.md Section 4 contract diagram needs amending in the source-of-truth doc.** The current diagram shows synthesis as `[optional per verbosity arg]` with the call always wired. After D-01, the diagram should make explicit that the synthesis line is skipped on default recall and only runs when `verbosity ∈ {"synthesis", "both"}`. The amendment lives in AI-SPEC.md itself (not a separate doc); Phase 5 plan should include a docs touch-up task.

- **D-05: `spike-findings-engram` skill `<requirements>` line is now historically accurate, not normatively binding.** The line `"verbosity parameter default is 'both' on recall(), NOT 'synthesis'"` reflects the Phase 4 decision based on spike outcome. Phase 5 supersedes the default; the spike's quality finding (synthesis is BORDERLINE 75-90%) still drives the F1 gate. Phase 5 plan should include a one-line annotation in `SKILL.md` noting the Phase 5 amendment so future readers don't mistake the older line for current canon.

### Phase 5 inherits and honors AI-SPEC.md verbatim

- **D-06: Models, ranking, evaluation, monitoring are LOCKED by AI-SPEC.md.** The following are NOT re-discussed in Phase 5 — they are inherited as-is from the Phase 5 design contract:
  - Embedding model: `@cf/baai/bge-base-en-v1.5` (768d, cosine, preset-locked at index creation)
  - Classifier model: `@cf/meta/llama-3.1-8b-instruct` with `temperature: 0.2`, `max_tokens: 1024`, structured JSON via `response_format: { type: "json_schema", json_schema }`
  - Vectorize topology: one global `engram-memories` index, `namespace = workspace_id` (AI-02), metadata indexes on `type` + `scope`
  - Hybrid ranking formula: `cosine * 1.0 + recency * 0.15 + type_match * 0.2 + scope_match * 0.15` (weights are starting points; tuning is a Phase 5 implementation task, not a v0.2 deferral)
  - Online guardrails: `vectorize-helper.ts` (mandatory `workspace_id` arg, 64-byte namespace length guard, embedding-stamp precondition), `ai-helper.ts` (429 detection on `success: false`), ESLint custom rule banning direct `env.VECTORIZE.query` / `.upsert` outside `vectorize-helper.ts`
  - Offline flywheel: Weekly Cron Worker re-runs reference corpus + Promptfoo extraction prompt; monthly Russell sample review (memorability calibration); pre-release `npm run evals:ci` gate
  - Eval tooling: Promptfoo (extraction) + Vitest custom evals (F1, namespace isolation, forget cascade, 429 retry) + Cloudflare Workers Analytics Engine (tracing) + Logpush→R2 (offline batch). Phoenix / Langfuse / RAGAS / LangSmith / Braintrust explicitly rejected with rationale documented in AI-SPEC.md §5.
  - Reference dataset: 20 examples in 4 buckets of 5 (critical-path successes, known failure modes, entity-extraction inputs, edge cases). Stored at `packages/mcp-server/src/__tests__/evals/reference-corpus.json`. PII-sanitized per Phase 4 T-04-LEAK pattern.
  - Real-corpus validation gate: 10-20 actual job postings from Russell's job-search agent corpus, hand-coded ground truth, F1 ≥ 75% blocks AI-04 closure. Non-optional, carry-forward from Phase 4.
  - Production monitoring: Workers Analytics Engine schema (1 row per AI/Vectorize op), Email Routing alerts to russellkmoore@mac.com, smart sampling (always-sample for zero-match recalls / Zod parse fails / 2× budget latency; 5% baseline stratified; Russell-tagged via future `feedback()`).
  - Latency budgets: `remember()` ≤ 430ms p50, `recall()` no-synthesis ≤ 400ms p50, `recall()` with-synthesis ≤ 5.5s p50.

- **D-07: Honest-stubs posture from Phase 4 D-04 is inverted, not amended.** Phase 5 swaps null/empty values for real AI output without adding/removing/renaming envelope fields. All Phase 4 envelope tests stay GREEN unchanged; Phase 5 adds new assertions for the populated values (conditioned on AI-input fixtures and verbosity arg per D-03).

### Claude's Discretion

The following are implementation details the planner and executor handle. Documented here so they're visible during planning, not surfaced as user-facing decisions:

- **Wave layout for Phase 5** — AI-SPEC.md and the parallelization notes in ROADMAP.md suggest at least four independent workstreams (setup script + Vectorize bindings, `remember`/`recall`/`forget` handler bodies, Triage Worker AI internals, eval harness + real-corpus gate). The planner decomposes these into waves; suggested skeleton: Wave 0 = test infra + zod schema diff (D-01 schema change + new `meta.gaps`/`suggestions` test fixtures) + RED tests; Wave 1 = `setup-vectorize.sh` + `vectorize-helper.ts` + `ai-helper.ts` (helpers ship first because every handler depends on them); Wave 2 = `remember()` + `forget()` (parallel, both touch only mcp-server); Wave 3 = `recall()` (depends on helpers + hybrid-rank function); Wave 4 = Triage Worker package internals (`extract.ts` + `memorability.ts` + `prompts.ts` + `schema.ts`) — can run parallel to Waves 2/3; Wave 5 = eval harness + reference corpus + real-corpus gate; Wave 6 = Production monitoring (Workers Analytics Engine + Logpush). Planner refines.

- **CF-code-assist routing tracker for Phase 5** — Project CLAUDE.md mandates that every code-producing task during Phase 5 execution append one row to `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`. The file does not exist yet — **the Phase 5 plan MUST include a Wave 0 task to create the file with the prescribed header schema** (3-question checklist per task: synthesis cross-file?, diff >50 lines mechanical?, stable template/spec to anchor on?). Phase 5 is projected as a content-generation phase that should route 40–60% to cf-code-assist (zod schemas via `generateTypes`, vitest eval scripts via `scaffoldTests`, Triage Worker queue consumer via `generateWorkerBoilerplate`, `recall()` `instr()` → Vectorize swap via `transformCode`, 429 retry wrapper via `generateCode`, Workers Analytics Engine event-write helper via `generateCode`). Plan 05-01 should establish the file; every subsequent plan's executor logs its route decisions inline.

- **Vectorize helper module shape** — `packages/mcp-server/src/vectorize-helper.ts` wraps `env.VECTORIZE.query/upsert/deleteByIds` with mandatory `workspaceId` positional argument + 64-byte namespace length guard + embedding-stamp precondition for upserts. Suggested signature: `vectorizeQuery(env, workspaceId: string, vector: number[], opts: { topK; filter?; returnMetadata? })`, `vectorizeUpsert(env, workspaceId: string, vectors: VectorizeVector[])`, `vectorizeDelete(env, workspaceId: string, ids: string[])`. ESLint custom rule `no-direct-vectorize-binding` lives alongside in `eslint.config.mjs`. Planner decides whether to ship the lint rule as a project-wide eslint custom rule or as a CI-only grep check (faster to land); AI-SPEC.md suggests ESLint but a grep-based rule lands faster.

- **AI helper module shape** — `packages/mcp-server/src/ai-helper.ts` + sibling in `packages/triage-worker/src/ai-helper.ts` wrap `env.AI.run(...)` with: model-id constants (`EMBEDDING_MODEL`, `CLASSIFIER_MODEL` exported once, imported by both `tools.ts` and `extract.ts` per AI-SPEC.md eval dimension #2's identity-check requirement), 429 detector (`detectRateLimit(aiResp): boolean` returns true when `aiResp.success === false` AND `errors[].code === 7501 || /429|rate/i.test(message)`), and a `safeRun(env, model, body)` wrapper that returns the parsed response or throws on non-429 failure.

- **Triage Worker → WorkspaceDO authentication** — AI-SPEC.md §"Tool Use" flagged this open: "Phase 5 must address how the consumer authenticates — STO-07's `assertOwnsWorkspace` must hold for triage-worker callers." Planner decides between (a) Triage Worker reads `workspace_id` from `MemoryEvent` and passes it to every WorkspaceDO RPC call (the field is already on the event per CLAUDE.md ingest pipeline); STO-07 verifies internally. The Worker has no JWT — it's a Queue consumer — so the auth contract is "the producer put the workspace_id on the event; the DO trusts it because the DO ID is `getAgentByName(env.WORKSPACE, workspace_id)`." This matches the v0.1 single-user posture (single workspace, all events are Russell's) and the v0.3 multi-workspace posture (events carry their owning workspace_id; the DO is keyed by the same id; STO-07 verifies match at the boundary). Document this in the Phase 5 plan as the canonical pattern.

- **Real-corpus F1 gate timing** — AI-SPEC.md says "before AI-04 closure." Planner decides: (a) Wave 0 hard gate (block AI-04 plan from starting until 20 real samples exist + hand-labeled — blocks early progress); (b) Wave-N validation step that runs after `recall()` ships and gates AI-04 marked-done (allows handlers to ship in parallel, validates before closure — recommended); (c) Phase 5 verification gate (runs at `/gsd:verify-work 5`). Recommendation: (b). Russell's job-search agent corpus is the only source of real samples; pulling 10-20 of those, sanitizing, and labeling against the 4-bucket reference corpus structure is a 1-2 hour task that can run in parallel with handler development.

- **Hybrid ranking weight tuning** — AI-SPEC.md says "tune empirically during AI-04 against the 30-sample corpus + Russell's job-search agent corpus." Starting weights are `{ cosine: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15 }`. Planner decides: (a) ship starting weights, defer all tuning to v0.2; (b) ship starting weights, tune in Wave 5/6 against the real-corpus samples once they're labeled; (c) include a single weight-tuning task in the Phase 5 plan that runs after the F1 baseline. Recommendation: (b) — the real-corpus gate already pulls real samples; a single tuning pass once the labels exist gives Phase 5 a defensible "we measured and chose" answer without scope-creeping. v0.2 owns the long-term tuning cadence.

- **`research_note` heterogeneity strategy** — `phase-5-ranking-strategy.md` §5 surfaced three options (accept / tag-cluster / k-means) and explicitly asked to settle them at discuss-phase 5. Russell deferred to planner discretion in this discussion. Recommendation: **accept the heterogeneity for v0.1** — trust query expansion (v0.2 scope) + tags (Phase 2 schema has `tags` table) + hybrid ranking's `type_match` and `scope_match` weights to disambiguate. Tag-based sub-clustering and k-means clustering are both v0.2+ work that should not enter Phase 5 scope. Surface a `<deferred>` entry below so the v0.2 milestone planner picks this up if real-corpus testing surfaces heterogeneity-induced recall misses.

- **Long-content truncation policy** — AI-SPEC.md §"Context Window Strategy" says "The MCP `remember()` handler should reject (or warn + truncate) inputs over ~1,800 chars." Russell deferred to planner discretion. Recommendation: **warn + truncate + store-full-in-SQLite + flag in `meta.gaps`** — pragmatic mid-ground that matches the existing honest-stubs posture (every limitation is signaled to Claude via `meta.gaps`, no silent data loss). Concrete: `remember()` embeds the first ~1,800 chars (≈512 tokens worst-case), stores the full content in SQLite, includes `"Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable."` in `meta.gaps`. Russell's job postings sometimes exceed 1,800 chars; rejecting would force the caller to chunk client-side (which v0.2 chunking will solve anyway). Lexical-only fallback (option c) is rejected because v0.1 has no `search()` semantic path for these blocks — they'd be invisible to recall, defeating the purpose of remembering them.

- **Memorability `<0.4` routing** — `2026-05-26-phase-5-cold-storage-not-discard.md` calls hard-discard "the cardinal sin of a memory product." Russell deferred this in the discussion; planner discretion. **Strong recommendation: implement cold-storage, NOT discard.** The Workers AI scorer is unproven on Russell's corpus; calibration drift between model versions is documented as a known failure mode (AI-SPEC.md §3 pitfall #8); a single under-scored entry could be a job offer email. Concrete: add `blocks.cold_storage BOOLEAN DEFAULT FALSE` column via a Phase 5 SQLite migration (Phase 2's `_schema_migrations` runner handles forward-only migrations; Phase 5 introduces migration v2). Cold blocks are excluded from default `recall()` results, NOT indexed in Vectorize (cost savings), queryable via a future `include_cold: true` parameter (v0.2 scope or earlier if Russell hits the case). Triage Worker routing becomes: `>0.8` → `updateBlockEnrichment`, `0.4–0.8` → `moveToInbox`, `<0.4` → `moveToColdStorage` (NOT `discardWithLog`). Update CLAUDE.md `## Ingest Pipeline` to remove the "discard" branch — this is a doc-only touch-up task in Phase 5 Wave 0 alongside the AI-SPEC.md amendment from D-04. **The planner should treat this as a near-locked decision and only ship hard-discard if there's a compelling reason surfaced during planning (which I do not see).**

### Folded Todos

- `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` — **FOLDED.** Already locked by AI-SPEC.md §4 hybrid ranking formula (cosine·1.0 + recency·0.15 + type·0.2 + scope·0.15) and spike-findings-engram requirements ("Hybrid ranking REQUIRED for Phase 5 `recall()`"). Phase 5 plan ships this as the AI-04 implementation, with the real-corpus weight tuning task per Claude's Discretion above.

### Reviewed Todos (not folded into THIS discussion, but in Phase 5 scope per Claude's Discretion above)

- `2026-05-26-phase-5-cold-storage-not-discard.md` — Captured under Claude's Discretion as a strong recommendation for the planner. Russell's "cardinal sin" framing in the todo file is the binding argument.
- `2026-05-26-phase-6-validate-conflict-detection-precision.md` — Phase 6 scope (Triage Worker conflict detection precision validation); surfaces at `/gsd:discuss-phase 6`. Out of Phase 5 scope per the AI-SPEC.md split (Phase 5 ships AI-05 entity extraction + AI-06 memorability; conflict detection is a Phase 6 enrichment step running on the async Queue path).

### Reviewed Phase 4 todos (resolved by Phase 4)

- `2026-05-26-phase-4-raw-chunks-escape-hatch.md` — Resolved by Phase 4 D-02 (verbosity enum + `result.chunks` field). D-01 above amends the default but the underlying escape hatch ships unchanged.
- `2026-05-26-phase-4-spike-workers-ai-extraction-quality.md` — Resolved by the spike run captured in `spike-findings-engram`. The BORDERLINE-band synthesis quality is the carry-forward gate (real-corpus F1 ≥ 75% blocks AI-04 closure).

</decisions>

<specifics>
## Specific Ideas

- **"Do it RIGHT, not FAST" still applies hardest here.** Phase 5 is the milestone where Engram actually delivers on the core promise — "Engram should return insights, not data; Claude should reason, not process." Synthesis-on-demand (D-01) is a deliberate trade against premium UX in favor of speed-by-default; the recovery surfaces (D-02) ensure Claude never loses the ability to ask for synthesis. The eval gate (real-corpus F1 ≥ 75%) is what proves we earned the right to ship.
- **Russell's job-search agent is the first real consumer.** Every UX choice in this CONTEXT.md should be evaluable against "what does this feel like when the agent calls `recall()` in a multi-step planning loop?" 2–5s synthesis latency on every recall is unacceptable for a tight loop; chunks-by-default with synthesis-on-request is the right ergonomics.
- **The `suggestions.actions` field activates earlier than Phase 4 D-04 anticipated** — Phase 4 deferred it to v0.2 on the assumption Phase 5 would not need it. Phase 5 needs it for the synthesis-discoverability triad. This is a Phase 4-compatible amendment (the field is `optional` in the envelope contract; populating it does not break any v0.1 client) — but it is a CONTEXT-level decision worth flagging because future phases may now lean on it for similar signals (e.g., Phase 6 could surface "set `priority: 'deep'` to enrich this memory more thoroughly").
- **The synthesis-policy decision is reversible at v0.2.** If the real-corpus F1 gate lands ≥85% AND Russell's pattern shifts toward "I want the summary by default after all," the default can flip back to `"synthesis"` (or to `"both"`) via a single-line schema change. The enum is permanent; the default is data.
- **Memorability cold-storage (Claude's Discretion above) and the long-content truncation policy (Claude's Discretion above) are both schema-touching decisions for Phase 5.** Cold-storage adds a column (`blocks.cold_storage BOOLEAN`); truncation does not add a column but does require a `meta.gaps` frozen string. The cold-storage migration is the only new SQLite schema work Phase 5 introduces — every other AI-related column (`embedding_model`, `embedding_version`) already exists from Phase 2's first migration. Plan Wave 0 should land the schema migration before any handler that writes to the column.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (gsd-phase-researcher, gsd-planner) MUST read these before planning or implementing.**

### Phase 5 design contract (primary)

- `.planning/phases/05-ai-integration/05-AI-SPEC.md` — **The Phase 5 master design contract (914 lines).** System classification, framework decision, framework quick reference (install + imports + entry-point patterns + key abstractions + 10 common pitfalls + recommended project structure + sources), full implementation guidance (model config, core pattern, tool use, state management, context window strategy), AI systems best practices (Zod structured outputs, async-first design, prompt engineering discipline, context window management, cost+latency budget), evaluation strategy (8 dimensions with rubrics + mapping to critical failure modes + tooling selection with rejection rationales + reference dataset spec), guardrails (online + offline), production monitoring (Workers Analytics Engine schema + alert thresholds + smart sampling). **Every Phase 5 plan inherits this verbatim except where this CONTEXT.md amends.** D-01 amends the `verbosity` default; D-03 amends eval dimension #8 test parameterization; D-04 amends the Section 4 contract diagram (synthesis call skipped on default recall).
- `.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md` — **The envelope-field-population map.** Catalogs every honest-stub field Phase 5 populates, which `META_GAPS` string is removed when each population lands, which test files turn from RED to deeper-GREEN, and the "What Phase 5 Should NOT Change" lock-in rules. The lock-in rule "DO NOT change the `verbosity` enum on `recall()`" is honored (enum shape unchanged; only default flips per D-01). The lock-in rule "Phase 5 may flip the default back from `"both"` to `"synthesis"` IF real-corpus extraction quality consistently lands ≥85%" is amended by D-01 (Phase 5 instead flips to `"chunks"`); this is a documented Phase-5-discussant override.
- `.planning/phases/04-core-tools-envelope/04-CONTEXT.md` — Phase 4 D-01..D-10 (especially D-02 about verbosity default, which D-01 above amends; D-04 honest-stubs posture; D-06/D-07/D-08 envelope shapes Phase 5 inverts).

### Spike findings (validated patterns, BORDERLINE-band reality)

- `.claude/skills/spike-findings-engram/SKILL.md` — Auto-loaded per project CLAUDE.md. Locks the model bindings + BORDERLINE-band quality reality (75-90% synthesis fidelity on synthetic samples). Phase 5 D-05 notes the `<requirements>` line about `verbosity = "both"` default is now historically accurate but not normatively binding.
- `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` — §6 has the AI-05 system-prompt design (5 drop categories: dates, sources, technical identifiers, numeric values, decision-rejection naming). §7 has the real-corpus F1 validation gate Phase 5 must run before AI-04 closure.
- `.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md` — **REQUIRED for AI-04 design.** Spike 003 proved `bge-base-en-v1.5` encodes domain not memory type — hybrid ranking is MANDATORY. Starting weights, batch-embedding pattern, embedding stamp policy, `research_note` heterogeneity options (option (a) Accept is the Phase 5 default per Claude's Discretion).

### v0.1 scope + acceptance

- `.planning/REQUIREMENTS.md` §"AI Integration (AI)" — AI-01..AI-08 acceptance criteria (each is a hard test).
- `.planning/REQUIREMENTS.md` §"Acceptance Criteria for v0.1" — the v0.1 "done state" Russell's job-search agent depends on. DEP-03/04 (Phase 7) is the full integration; Phase 5 makes it possible.
- `.planning/ROADMAP.md` §"Phase 5: AI Integration" — 7 success criteria + 5 risk notes (irreversible decision callouts for A10/AI-1 embedding lock-in, A5 namespace topology, AI-2 rate-limit handling, MP-5 transactional forget).

### Architectural source-of-truth (project-wide)

- `CLAUDE.md` (project root, `/Users/rmoore/Workspaces/engram/CLAUDE.md`) — Engram architecture spec: MCP tool surface, EngramResponse envelope, DO hierarchy, "What Goes Where" routing rules. Phase 5 Auto-Load Routing section mandates `Skill("spike-findings-engram")` and the **Phase 5 cf-code-assist routing tracker** (every code-producing task appends a row to `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` with the 3-question checklist — see Claude's Discretion above for plan implications). The `## Ingest Pipeline` section needs a doc-only amendment as part of Phase 5 Wave 0 (cold-storage replaces discard per Claude's Discretion).
- `~/.claude/CLAUDE.md` §"AI Model Routing" — the project-wide cf-code-assist routing rules; 3-question checklist; phase-character heuristic (Phase 5 = content-generation, projected 40–60% cf-code-assist).

### Shared types + Phase 4 live code

- `shared/types/src/index.ts` — `EngramResponse<T>` envelope contract. Phase 5 modifies the BUILDER INPUTS (add `synthesis`, `entities`, `confidence`, `suggestions` params to `buildRememberResponse` and `buildRecallResponse`) but NOT the field set. The optional `suggestions?: { actions: string[]; queries: string[] }` field activates in Phase 5 per D-02.
- `packages/mcp-server/src/envelope.ts` — Phase 4 envelope builders. Phase 5 extends `buildRecallResponse(...)` to accept a `synthesis: string | null` arg, a `chunks: RecallChunk[] | null` arg, and a `suggestions?: { actions: string[] }` arg, AND adds a new frozen META_GAPS string for the synthesis-omitted hint per D-02.
- `packages/mcp-server/src/tools.ts` — Phase 4 honest-stub handler bodies. Phase 5 modifies `remember()` (add embed + upsert), `recall()` (add embed + Vectorize query + hybrid rerank + conditional synthesis), `forget()` (add Vectorize delete). `ingest()` is **untouched** per Phase 4 hand-off (Phase 6 owns it).
- `packages/mcp-server/src/schemas.ts` — `RecallInputSchema.verbosity` default changes from `"both"` to `"chunks"` per D-01. Structural defense-in-depth invariant (no `workspace_id` field on any schema) unchanged.

### Phase 2 carry-forward (DO surface + auth invariant)

- `.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md` §D-01..D-04 — sync helpers, throw on miss, JSON parsed at boundary, explicit cascade. Phase 5 Triage Worker consumes these via `getAgentByName(env.WORKSPACE, workspace_id).<method>()`.
- `packages/workspace-do/src/index.ts` — DO methods. Phase 5 adds (or extends) `stampEmbedding(workspace_id, block_id, model, version)`, `getBlocksByIds(workspace_id, ids[])`, `updateBlockEnrichment(workspace_id, id, parsed)`, `moveToInbox(workspace_id, id, parsed)`, `moveToColdStorage(workspace_id, id, parsed)` (per cold-storage recommendation under Claude's Discretion). All inherit STO-07's `assertOwnsWorkspace` as the first line.
- `packages/workspace-do/src/schema.ts` — Phase 2 first migration. Phase 5 introduces a v2 migration adding `blocks.cold_storage BOOLEAN DEFAULT FALSE` per the cold-storage recommendation (Claude's Discretion). The `_schema_migrations` table handles forward-only versioning; Phase 5 migration runs idempotently.

### Cloudflare official docs (read by gsd-phase-researcher; cited in AI-SPEC.md §3)

- https://developers.cloudflare.com/vectorize/reference/client-api/ — Vectorize client API
- https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/ — insert + namespaces
- https://developers.cloudflare.com/vectorize/best-practices/query-vectors/ — query patterns
- https://developers.cloudflare.com/vectorize/reference/metadata-filtering/ — metadata filter syntax
- https://developers.cloudflare.com/workers-ai/configuration/bindings/ — Workers AI bindings
- https://developers.cloudflare.com/workers-ai/features/json-mode/ — structured output via `response_format: json_schema`
- https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/ — embedding model card (768d, cosine, 512-token window)
- https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/ — classifier model card
- https://developers.cloudflare.com/queues/configuration/javascript-apis/#message — Queue consumer retry semantics (Phase 5 leans on `message.retry({delaySeconds})`; Phase 6 owns producer wiring)

### Pending todos (referenced under Claude's Discretion + Reviewed Todos)

- `.planning/todos/pending/2026-05-26-phase-5-cold-storage-not-discard.md` — Russell's "cardinal sin" framing; planner picks up per Claude's Discretion strong recommendation.
- `.planning/todos/pending/2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` — Folded; already locked by AI-SPEC.md hybrid ranking formula.
- `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md` — Reviewed, Phase 6 scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/mcp-server/src/envelope.ts` — Phase 4's 5 builders. `buildRecallResponse(...)` needs a `synthesis: string | null` arg + `chunks: RecallChunk[] | null` arg + `suggestions?: { actions: string[] }` arg added per D-01/D-02. The frozen META_GAPS strings live here; Phase 5 adds one for the synthesis-omitted hint.
- `packages/mcp-server/src/tools.ts` — 5 tool registration shapes Phase 5 keeps stable. Handler bodies modified for `remember`/`recall`/`forget`; `ingest` and `search` untouched. Phase 4's DD-RT sentinel comment + `args.workspace_id` ban remain.
- `packages/mcp-server/src/schemas.ts` — `RecallInputSchema.verbosity` default flips to `"chunks"` per D-01; rest unchanged.
- `packages/mcp-server/src/error-mapping.ts` — `mapToMcpError(err)` consumed by every Phase 5 handler unchanged.
- `packages/workspace-do/src/index.ts` — Phase 2 DO methods. Phase 5 extends with embedding stamp + cold-storage routing (per Claude's Discretion).
- `packages/workspace-do/src/queries.ts` — Phase 2 typed query helpers. Phase 5 extends.
- `packages/workspace-do/src/schema.ts` — Phase 2 first migration (`V1_SQL`). Phase 5 adds `V2_SQL` for the `blocks.cold_storage` column.
- `shared/types/src/index.ts` — `EngramResponse<T>` envelope. The `suggestions?: { actions: string[]; queries: string[] }` field is already optional; Phase 5 populates it.
- `gpt-tokenizer` (Phase 4 D-09) — still the MCP-08 token-budget tokenizer. New `meta.gaps` and `suggestions.actions` strings per D-02 must fit under the 7,500-token post-trim cap.
- `@cloudflare/vitest-pool-workers` — Phase 5 evals + the Vectorize-isolation integration test run here. Wrangler local Vectorize emulator handles the AI-02 namespace isolation test.
- Phase 4 `04-MCP-INSPECTOR-SMOKE.md` (with TOL-08 verbal-acceptance override) — Phase 5 should produce a parallel `05-MCP-INSPECTOR-SMOKE.md` that verifies synthesis opt-in via verbosity arg.

### Established Patterns

- **TS-source / no build step** (Phase 1 D-07) — Phase 5 stays in this posture.
- **Strict TS** (Phase 1 D-08) — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Phase 5's new helpers + Vectorize/AI binding usage must satisfy.
- **Sync helpers, async wrapper** (Phase 2 D-01) — `WorkspaceDO` methods stay sync internally; Phase 5 handlers are `async` because of the AI/Vectorize bindings.
- **workspace_id ALWAYS from props** (STO-07 / D-05 / MCP-05 / MT-1) — Phase 5 AI handlers obey. The `vectorize-helper.ts` wrapper makes `workspaceId` a non-optional positional arg precisely so this invariant cannot be bypassed.
- **`McpError` discipline** (Phase 3 D-05) — every Phase 5 handler error path goes through `mapToMcpError`.
- **vitest under `@cloudflare/vitest-pool-workers`** — Phase 5 evals + integration tests use the existing harness; AI binding hits real Cloudflare AI in dev (per spike-findings-engram `<requirements>`), mocked in CI for cost.
- **Frozen META_GAPS strings** (Phase 4 D-09/D-10) — MCP-08 test reproducibility requires byte-stable strings. Phase 5's new synthesis-omitted string + cold-storage gap (if Russell's cold-storage discretion lands) follow the same frozen-string discipline.

### Integration Points

- `packages/mcp-server/src/vectorize-helper.ts` (NEW, Wave 1) — wraps `env.VECTORIZE.query/upsert/deleteByIds` with mandatory `workspaceId` arg + length guard + embedding-stamp precondition.
- `packages/mcp-server/src/ai-helper.ts` (NEW, Wave 1) — wraps `env.AI.run()` with model-id constants + 429 detector.
- `packages/triage-worker/src/ai-helper.ts` (NEW, Wave 1) — sibling to mcp-server's; reuses the same 429 detector logic.
- `packages/triage-worker/src/extract.ts` (NEW, Wave 4) — AI-05 entity extraction with Zod gate + retry policy.
- `packages/triage-worker/src/memorability.ts` (NEW, Wave 4) — AI-06 memorability routing; routes `<0.4` to `moveToColdStorage` per Claude's Discretion (NOT `discardWithLog`).
- `packages/triage-worker/src/prompts.ts` (NEW, Wave 4) — `SYSTEM_PROMPT` constant per `engram-response-synthesis-contract.md` §6 (5 drop categories).
- `packages/triage-worker/src/schema.ts` (NEW, Wave 4) — Zod schemas (`TriageOutput`, `Entity`) + derived `TRIAGE_JSON_SCHEMA` via `zodToJsonSchema`.
- `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` (NEW, Wave 5) — AI-SPEC.md eval dimension #1.
- `packages/mcp-server/src/__tests__/evals/embedding-consistency.test.ts` (NEW, Wave 5) — eval dimension #2.
- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (EXTEND) — add Vectorize-side AI-02 namespace isolation assertion.
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` (EXTEND) — add the 5s-delay assertion for AI-08 `remember → forget → recall = 0` (Vectorize eventual consistency).
- `packages/mcp-server/src/__tests__/envelope.test.ts` (EXTEND) — D-03 verbosity-parameterized assertions (default = chunks-only with synthesis-null + discoverability triad; explicit = synthesis-populated).
- `packages/triage-worker/src/__tests__/extract.test.ts` (NEW, Wave 5) — eval dimensions #4 (Zod parse rate) + #7 (429 retry correctness).
- `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts` (NEW, Wave 5) — eval dimension #5.
- `packages/mcp-server/src/__tests__/evals/reference-corpus.json` (NEW, Wave 5) — 20-example reference dataset, 4 buckets of 5, PII-sanitized.
- `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` (NEW, Wave 5) — Promptfoo CI config.
- `scripts/setup-vectorize.sh` (NEW, Wave 1) — idempotent `wrangler vectorize create engram-memories --preset=@cf/baai/bge-base-en-v1.5` + metadata indexes (`type`, `scope`).
- `packages/mcp-server/wrangler.jsonc` (EDIT) — add `ai` binding + `vectorize` binding (`{ binding: "VECTORIZE", index_name: "engram-memories" }`).
- `packages/triage-worker/wrangler.jsonc` (EDIT) — add `ai` + `vectorize` + `durable_objects.bindings[]` (WORKSPACE_DO service binding) + Queue consumer block (consumer comes alive in Phase 6; the binding declaration can land here without functional impact).
- `packages/workspace-do/src/schema.ts` (EXTEND) — add `V2_SQL` for `blocks.cold_storage BOOLEAN DEFAULT FALSE` (per cold-storage recommendation under Claude's Discretion).
- `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` (NEW, Wave 0) — routing tracker file per project CLAUDE.md mandate.
- `.planning/phases/05-ai-integration/05-AI-SPEC.md` (EDIT, Wave 0 doc touch-up) — amend Section 4 contract diagram to make explicit that synthesis is skipped on default recall per D-04.
- `CLAUDE.md` (project root, EDIT, Wave 0 doc touch-up) — amend `## Ingest Pipeline` to remove the "discard" branch (cold-storage replaces it).
- `.claude/skills/spike-findings-engram/SKILL.md` (EDIT, Wave 0 doc touch-up) — annotate the `<requirements>` line about `verbosity = "both"` default with a Phase 5 supersession note per D-05.

</code_context>

<deferred>
## Deferred Ideas

- **v0.2 query expansion** — CF AI generates 3-4 semantic variants of the `recall` query before Vectorize search. Out of Phase 5 scope; deferred to v0.2 Intelligence Layer per ROADMAP.md.
- **v0.2 caching strategy** — exact-match embedding cache (KV, 60s TTL) + semantic recall cache (sha256(query)+workspace_id, 30s TTL). AI-SPEC.md §4b "Cost and Latency Budget" notes this; out of Phase 5 scope (low priority since v0.1 cost is < $5/mo).
- **v0.2 `meta.coverage` semantic estimation** — Phase 5 ships `meta.coverage` populated by AI-04 but the semantic completeness heuristic (`matches_returned / matches_estimated via Vectorize result confidence`) can be refined in v0.2 once production traffic gives baseline data.
- **v0.2 tag-based sub-clustering for `research_note`** — per `phase-5-ranking-strategy.md` §5 option (b). Phase 5 accepts heterogeneity (option a) per Claude's Discretion. If real-corpus testing during AI-04 surfaces heterogeneity-induced recall failures, surface to v0.2 scope.
- **v0.2 k-means post-write clustering for `research_note`** — option (c). Heaviest of the three; defer unless v0.1 production usage proves it necessary.
- **v0.2 cold-storage `include_cold: true` recall parameter** — Phase 5 lands the cold-storage bucket (per recommendation) but does NOT expose a recall flag to opt cold blocks into results. The v0.4 inbox UI surfaces "Demoted" tab; v0.2 may add the recall flag.
- **v0.2 cold-storage TTL** — 90-day default mentioned in the todo file; v0.1 ships the bucket without TTL (cold blocks stay forever until manually promoted). TTL machinery (background sweep + `expires` field on cold rows) lives in v0.2 or later.
- **v0.2 chunking strategy** — content over 1,800 chars / 512 tokens is truncated with `meta.gaps` flag in Phase 5 per Claude's Discretion. v0.2 introduces semantic-boundary chunking with 50-token overlap; until then, full content lives in SQLite but only first ~512 tokens are semantically searchable.
- **v0.2 spike re-evaluation against real-corpus** — spike-findings-engram is synthetic-sample-based. Once Phase 5 ships and Russell's job-search agent is rewired (Phase 7 DEP-04), the spike's headline numbers (extraction F1 90.2%, summarization R 83.7%, embedding Δ 0.0696) should be re-measured on real data. AI-SPEC.md §6 offline flywheel covers the ongoing F1 drift monitoring; the one-shot spike re-run is a v0.2 task.
- **v0.2 `reflect()` MCP tool** — synthesis across all related memories with `open_questions` gap detection. Out of Phase 5 scope per ROADMAP.md (v0.3 actually; v0.2 lays the groundwork in Triage Worker prompt refinements).
- **v0.2 `relate()` MCP tool** — explicit knowledge graph edges. Out of Phase 5 scope.
- **v0.2 conflict detection precision validation** — `2026-05-26-phase-6-validate-conflict-detection-precision.md`. Validates Triage Worker's semantic conflict scan before enabling per-write scans. Surfaces at `/gsd:discuss-phase 6`.
- **v0.3 multi-workspace JWT routing** — Phase 5 assumes single-user single-workspace (Russell). Multi-tenant cross-workspace entity resolution + UUID-shaped workspace IDs (64-byte namespace check matters) is v0.3 scope.
- **v0.4 Slack / Drive connectors using `ingest_status`** — Phase 5 may pre-populate `blocks.ingest_status = 'pending'` on insert (per AI-SPEC.md §"State Management"); Phase 6 adds the column (PIP-06) and the consumer transitions it. The v0.4 inbox UI surfaces partial-failure visibility.
- **v0.4 `conflict(passive?)` MCP tool** — active vs passive conflict scan. Conflict records ship in Phase 5 via Triage Worker scan-on-write (AI-SPEC.md §"State Management" notes this is "deferred to Phase 5 plan"); the `conflict()` MCP tool is v0.4.
- **v1.0 prompt prefix caching for Triage** — llama-3.1-8b-instruct on Workers AI does not currently support OpenAI-style `cache_control`. Re-evaluate at v1.0 if Cloudflare adds it.
- **v1.0 cheaper-model routing for memorability** — `@cf/meta/llama-3.2-1b-instruct` or `@cf/microsoft/phi-2` could handle memorability alone at ~1/5 cost. Phase 5 ships single-classifier-call (extraction + summarization + memorability in one call) to keep the Zod schema simple; revisit at v1.0 when Triage volume justifies splitting.
- **v1.0 multi-tenant observability** — Cloudflare Workers Analytics Engine handles v0.1 single-user; v1.0 may need Arize Phoenix or similar (AI-SPEC.md §5 explicitly rejected for v0.1 with rationale).
- **v1.0 alerting integration** — v0.1 uses Cloudflare Email Routing to russellkmoore@mac.com; v1.0 multi-tenant migrates to PagerDuty / Slack webhook.

### Reviewed Todos (not folded into THIS discussion — surfaced under Claude's Discretion or Reviewed Todos above)

- `2026-05-26-phase-5-cold-storage-not-discard.md` — surfaced as Claude's Discretion strong recommendation (planner should implement cold-storage unless a compelling counter surfaces during planning).
- `2026-05-26-phase-6-validate-conflict-detection-precision.md` — Phase 6 scope.

</deferred>

---

*Phase: 05-ai-integration*
*Context gathered: 2026-05-28*
