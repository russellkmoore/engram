# Phase 6: Async Pipeline - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning
**Discussion mode:** discuss (3 product-level decisions; technical knobs under Claude's Discretion)

<domain>
## Phase Boundary

The `engram-ingest` Cloudflare Queue connects the MCP Worker (producer, via `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` appended to the existing `remember()` handler in `packages/mcp-server/src/tools.ts`) to the Triage Worker (consumer, queue handler already shipped in Phase 5 at `packages/triage-worker/src/index.ts`). `MemoryEvent.id` (`= block.id`, minted by `crypto.randomUUID()` in `remember()`) is the idempotency key; duplicate Queue deliveries are handled by the Triage Worker's RPC calls being UPDATEs (`updateBlockEnrichment` / `moveToColdStorage` are idempotent overwrites) and by `inbox` row inserts using `INSERT OR IGNORE` on the block_id PK. A new SQLite column `blocks.ingest_status TEXT NOT NULL DEFAULT 'pending'` (added via a v3 migration appended to `MIGRATIONS` in `packages/workspace-do/src/migrations.ts`) tracks per-block enrichment state with three values: `pending` (sync embed done, async enrichment not yet complete), `enriched` (Triage Worker successfully routed via `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage`), or `failed` (permanent failure after retry budget exhausted — set via a new `markIngestFailed` RPC). The Triage Worker performs entity extraction, summarization, and memorability scoring (already implemented in Phase 5 `extract.ts` + `memorability.ts`); **per-write conflict detection is deferred to v0.2** per D-01 below. On permanent failure (Zod parse failure after one 5s retry, non-retryable Workers AI errors, or DO RPC failure after retry budget), the Triage Worker calls `markIngestFailed(workspace_id, block_id, reason)` and `message.ack()` — never silent drops. Phase 6 covers requirements **PIP-01..PIP-06** (6 total); the `ingest()` MCP tool stays a Phase 4 honest-stub per D-02 (Phase 6 does NOT modify `tools.ts` `ingest()` handler).

</domain>

<decisions>
## Implementation Decisions

### Conflict detection scope

- **D-01: Per-write conflict detection is DEFERRED to v0.2; Phase 6 ships entity extraction + summarization + memorability scoring only.** PIP-04's success criterion as written in ROADMAP.md includes "conflict detection against existing memories in the workspace." Russell's discussion call: defer the conflict-detection clause to v0.2 (lowest-risk path; preserves trust; keeps Phase 6 scope tight). Rationale comes from `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md`: Cloudflare's small AI model (`@cf/meta/llama-3.1-8b-instruct`) is a precision/recall minefield for the "genuine contradiction vs benign update" distinction; false-positive conflicts erode user trust faster than missed conflicts; and conflict detection is the foundation of the v0.4 Slack-alert demo (the flashiest feature in the roadmap). Effects:
  - `recall()` continues to return `context.conflicts: []` (already true per Phase 5 honest-stubs posture; no change).
  - The Triage Worker does NOT scan against existing memories in the workspace as part of the Phase 6 queue path.
  - The 50-sample precision validation described in the pending todo file moves to v0.2 scope — the todo file itself is updated by Phase 6 Wave 0 with a note: "Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01."
  - The `conflicts` SQLite table created by Phase 2 stays unused in v0.1 — no rows written, schema preserved for v0.2.
  - PIP-04's success criterion needs a Phase 6 ROADMAP amendment (Wave 0 doc touch-up): strike "and conflict detection against existing memories in the workspace" from the PIP-04 acceptance, replace with footnote "conflict detection deferred to v0.2 per Phase 6 CONTEXT.md D-01."

### `ingest()` MCP tool implementation

- **D-02: `ingest()` stays as a Phase 4 honest-stub for v0.1; the only Queue producer is `remember()`'s new `ctx.waitUntil` line.** Phase 6 does NOT modify the `ingest()` registration in `packages/mcp-server/src/tools.ts`. The handler continues to return `buildIngestResponse({ job_id: crypto.randomUUID() })` without sending Queue messages. Rationale: Russell's job-search agent uses `remember()` for content capture; there's no v0.1 user-facing need for a URL-fetch or async-only-remember path. `ingest()` is reserved for v0.4 connectors (Slack channel ingestion, Google Drive polling) per ROADMAP §"v0.4 Connectors + Alerts." The Phase 4 hand-off comment in `tools.ts` `ingest()` body — `/* eslint-disable @typescript-eslint/require-await -- D-05: ingest has no await in v0.1; async is kept so Phase 6 adds ctx.waitUntil(env.INGEST_QUEUE.send(...)) as a one-line diff */` — is now historically inaccurate (Phase 6 does NOT add that line). Phase 6 Wave 0 should retarget the comment: replace "Phase 6 adds" with "v0.4 connectors add."

### Failure-evidence surface

- **D-03: Permanent enrichment failures land in `blocks.ingest_status = 'failed'` + Workers Analytics Engine + Cloudflare observability logs; NO dedicated DLQ queue in v0.1.** Rationale: v0.1 has no inbox UI but v0.4 needs a SQLite-queryable surface for "show me broken memories"; the `ingest_status` column gives that surface cleanly. A dedicated `engram-ingest-dlq` queue + replay tool is heavier (extra wrangler config, extra Worker for the inspector, extra cost) and gains replay capability Russell doesn't need for single-user v0.1. Concrete contract:
  - **Schema:** Phase 2's `_schema_migrations` runner gets a v3 entry: `{ version: 3, name: "v3_ingest_status", sql: V3_SQL }` where `V3_SQL = "ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending'; CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status ON blocks(ingest_status);"`. Lives in `packages/workspace-do/src/schema.ts` alongside `V1_SQL` and `V2_SQL`.
  - **Initial state:** `remember()`'s `insertBlock` call writes blocks with default `ingest_status = 'pending'` (no explicit field set — the column default does the work; the `Memory` TS type stays unchanged for v0.1 because the column is internal-only at this point).
  - **`pending → enriched` transition:** Atomic, inside the same SQL UPDATE that writes enrichment outputs. `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage` each set `ingest_status = 'enriched'` as part of their existing UPDATE statements (one SQL change per query helper in `packages/workspace-do/src/queries.ts`; tests in Wave 4 assert the transition happens).
  - **`pending → failed` transition:** New WorkspaceDO RPC `markIngestFailed(workspace_id, block_id, reason)` — sets `ingest_status = 'failed'` AND writes a `properties = JSON.stringify({error: reason, failed_at: Date.now()})` for observability. The Triage Worker calls it from the catch-paths in `extract.ts` (after the 5s Zod-retry budget exhausts), from `index.ts` (after a non-retryable AI error after the retry budget exhausts), and from `index.ts` (if the DO RPC call itself throws after Queue retry budget exhausts). Always paired with `message.ack()` — never `message.retry()` after `markIngestFailed`.
  - **Cold-storage orthogonality:** `moveToColdStorage` sets BOTH `cold_storage = 1` AND `ingest_status = 'enriched'`. Cold-storage is a memorability decision (block stays in SQLite forever, excluded from default recall); `enriched` records the fact that extraction successfully ran. The two flags are orthogonal — no `cold-storage + failed` combination should exist in v0.1.
  - **Inbox orthogonality:** `moveToInbox` sets `ingest_status = 'enriched'` AND inserts a row into the `inbox` table. Inbox membership is a memorability decision; `enriched` records extraction completion.
  - **Observability tap:** Every `markIngestFailed` call is paired with `writeAnalytics(env, { blobs: ["triage-worker", "ingest-failed-{reason-tag}", wsTag, ...], ... })` and a `console.error(...)` so the failure surfaces in Cloudflare dashboard observability AND Workers Analytics Engine without requiring SQLite introspection.
  - **No DLQ queue in v0.1.** v0.2 can add `engram-ingest-dlq` if real-traffic data shows the need; the `ingest_status = 'failed'` rows are the v0.2 starting point for replay tooling.

### Claude's Discretion

The following are technical implementation details the planner and executor handle. Documented here so they're visible during planning, not surfaced as user-facing decisions:

- **Cloudflare Queues consumer config (`engram-ingest`).** Single consumer block on `packages/triage-worker/wrangler.jsonc`:
  - `max_batch_size: 10` — Triage Worker processes messages sequentially (Phase 5 Design note re: 429 risk with `Promise.all`); batches of 10 give a healthy buffer for the v0.1 single-user volume without amplifying the AI-429 risk.
  - `max_batch_timeout: 5` seconds — short timeout matches the interactive nature of the job-search agent path (user `remember`s a job posting; expects enrichment to start within seconds).
  - `max_retries: 3` — the existing `message.retry({delaySeconds: 30})` calls in `extract.ts` count against this budget; after 3 transient failures the Queue runtime acks the message itself, but the Triage Worker should pre-empt this by calling `markIngestFailed` before the retry budget exhausts (i.e., check `message.attempts >= 2` and route to permanent-failure path on the 3rd attempt). Planner refines.
  - `dead_letter_queue:` **NOT SET in v0.1** per D-03. The Queue runtime's silent drop on retry exhaustion is the failure mode that PIP-05 forbids; the Triage Worker's `markIngestFailed` pre-emption on `message.attempts >= max_retries - 1` is what prevents the silent drop. Planner verifies this pre-emption pattern is sound against Cloudflare Queues docs in Wave 0.
- **Producer wiring (`tools.ts` `remember()`).** The `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` call fires AFTER the sync embed + Vectorize upsert succeeds — placed at the end of the try-block, after the Analytics Engine write, before the envelope return. Fire-and-forget by design: if `INGEST_QUEUE.send()` itself fails (Cloudflare outage), the block exists with `ingest_status = 'pending'` indefinitely. v0.2 inbox UI surfaces stuck-pending via a "started more than N minutes ago AND still pending" query. Documented as known limitation in Phase 6 SUMMARY.md.
- **MemoryEvent payload contents.** Shape stays verbatim from `shared/types/src/index.ts` (locked Phase 1). Phase 6 populates:
  - `id: block.id` (same UUID as the SQLite row — this is what makes A11/IP-1 work)
  - `source: args.source ?? "mcp:claude"` (mirrors the `block.source` write)
  - `content: args.content` (raw user content, NOT the truncated embedding input)
  - `hint: args.type` (the user-provided type hint, if any — lets Triage Worker bias its classifier prompt)
  - `context: { user_id: props.user_id }` (so Triage Worker has the JWT-derived user_id if needed for v0.2 analytics; STO-07 still gates DO RPC by workspace_id)
  - `workspace_id: props.workspace_id` (the auth-derived workspace ID; Triage Worker uses this to route the DO RPC)
  - `timestamp: now` (the same `Date.now()` used in the block's `created_at`)
- **Idempotency on duplicate Queue delivery.** Cloudflare Queues are at-least-once; A11/IP-1 says `INSERT OR IGNORE`. By the time a duplicate message fires, the block already exists (sync write happened in `remember()` before the Queue message). The Triage Worker's RPC calls are UPDATEs (`updateBlockEnrichment`, `moveToColdStorage`) which are naturally idempotent — second call overwrites with the same values. The `moveToInbox` call inserts into the `inbox` table; this insert needs `INSERT OR IGNORE` on the `inbox.id` PK (which equals `block.id` per Phase 5 wiring). Add the `OR IGNORE` clause in Wave 2 query helper update. Tests in Wave 4 replay the same message twice and assert: zero duplicate blocks, zero duplicate Vectorize entries, zero duplicate inbox rows, zero duplicate conflict rows.
- **Wave layout suggestion.** Planner refines:
  - **Wave 0** — Doc touch-ups (ROADMAP PIP-04 footnote per D-01; `tools.ts` `ingest()` comment retarget per D-02; pending-todo annotation per D-01); v3 migration design (schema.ts `V3_SQL` + `MIGRATIONS` append + test in `__tests__/migrations.test.ts` RED).
  - **Wave 1** — `scripts/setup-queue.sh` (idempotent `wrangler queues create engram-ingest`, mirroring `scripts/setup-vectorize.sh` shape); wrangler.jsonc producer binding on `mcp-server` (`queues.producers[]` with `binding: "INGEST_QUEUE"`) AND consumer binding on `triage-worker` (`queues.consumers[]` with `queue: "engram-ingest"`, retry config above).
  - **Wave 2** — `pending → enriched` transitions baked into `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage` query helpers; `INSERT OR IGNORE` added to `moveToInbox`'s inbox insert; `markIngestFailed` RPC added to WorkspaceDO + queries.ts helper.
  - **Wave 3** — Producer wiring in `mcp-server/src/tools.ts` `remember()` (the one-line `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` + MemoryEvent assembly); Triage Worker permanent-failure path in `extract.ts` (after retry budget exhausts, call `markIngestFailed` + `message.ack()`) and in `index.ts` (DO RPC catch → `markIngestFailed` + `message.ack()`); Queue attempts pre-emption (check `message.attempts >= 2` → route to permanent failure on 3rd attempt).
  - **Wave 4** — Integration tests: latency test (`remember()` returns before Queue message consumed); replay-twice idempotency test (no duplicates anywhere); `ingest_status` lifecycle test (pending → enriched on success, pending → failed on permanent failure); cold-storage + enriched orthogonality test; inbox `INSERT OR IGNORE` test.
  - **Wave 5** — Phase 6 SUMMARY.md with the "known limitations" list (stuck-pending blocks visibility deferred to v0.2 inbox UI), Phase 7 hand-off notes (deploy + acceptance can now run end-to-end).
- **Test infrastructure.** Phase 6 reuses Phase 5's `@cloudflare/vitest-pool-workers` harness. Queue integration tests use Wrangler's local Queue emulator (planner verifies what local-emulator support exists in `wrangler@4` — Phase 5 spike notes mention Queue support is limited; if local emulation is too thin, fall back to in-process Queue mocking with the existing `MessageBatch<MemoryEvent>` shape used in `triage-worker/src/__tests__/extract.test.ts`).
- **No cf-code-assist routing tracker for Phase 6.** The project CLAUDE.md mandate was Phase 5-specific ("Stop logging when /gsd:verify-work 5 passes"). Phase 5 verification passed 2026-05-27. Phase 6 follows the normal `~/.claude/CLAUDE.md` AI Model Routing 3-question checklist case-by-case without a per-phase tracker file. Phase 6 character is **contract-integration** (coordinating Queue contract + WorkspaceDO RPC contract + producer-side site), so the expected cf-code-assist share is <20% — Claude does most of the work.
- **Phase 6 does NOT introduce new evaluation gates.** The Phase 5 AI-04 real-corpus F1 ≥75% gate remains the production-quality gate; Phase 6 ships the plumbing that allows the same enrichment outputs to flow async-first. The `ingest_status` lifecycle is verified via behavioral integration tests, not LLM-as-judge evals.

</decisions>

<specifics>
## Specific Ideas

- **"Do it RIGHT, not FAST" — the v0.1 plumbing decision.** Deferring conflict detection (D-01), keeping `ingest()` a stub (D-02), and skipping the dedicated DLQ queue (D-03) are all scope-tightening choices that pay forward into v0.2/v0.4. The pattern: every "extra capability we COULD add" surfaces in a future milestone (v0.2 conflict detection with measured precision, v0.4 connectors via `ingest()`, v0.2 DLQ replay if real traffic surfaces the need). Phase 6 ships the minimum plumbing the rest of v0.1 needs and nothing else.
- **Russell's job-search agent as the acceptance proof.** The Phase 7 DEP-03 acceptance test ("remember a job posting in conversation A → recall it in conversation B 1+ hour later") is the binding test for the entire async pipeline. Phase 6 success means: by the time conversation B asks `recall`, the job posting's enrichment has completed (entity extraction + memorability scoring done async via the Queue) and the block has `ingest_status = 'enriched'`. The async path is invisible to the user but enables the v0.2 "Engram knows about the entities you mentioned" upgrades without a sync-latency cost on `remember`.
- **The v0.2 "stuck-pending" detector is the visibility gate for D-03's known limitation.** The `ctx.waitUntil(env.INGEST_QUEUE.send())` is fire-and-forget; if it silently fails (Cloudflare Queues outage), the block sits with `ingest_status = 'pending'` indefinitely with no surface. v0.1 single-user accepts this risk because the Cloudflare Queues outage rate is low and the v0.4 inbox UI will surface stuck-pending state. Phase 6 SUMMARY.md should document this as the only known silent-failure mode in the async pipeline, so v0.2 planning surfaces it as a candidate for a stuck-pending sweep Cron Worker.
- **PIP-04 ROADMAP wording change is a Wave 0 doc touch-up.** ROADMAP.md `Phase 6: Async Pipeline` §"Success Criteria" item 4 currently reads "The Triage Worker performs entity extraction, summarization, memorability scoring, and conflict detection against existing memories in the workspace." After D-01 the comma should change to "entity extraction, summarization, and memorability scoring" with a parenthetical "(conflict detection deferred to v0.2 — see CONTEXT.md D-01)." This is the only ROADMAP edit Phase 6 makes. The PIP-04 line in REQUIREMENTS.md should likewise be amended.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (gsd-phase-researcher, gsd-planner) MUST read these before planning or implementing.**

### Phase 6 design surface (primary)

- `.planning/ROADMAP.md` §"Phase 6: Async Pipeline" — 6 success criteria + 4 risk notes (A7/C5, A11/IP-1, IP-7, STO-07). Note: SC4 needs a Wave 0 amendment per D-01 above (strike conflict detection clause).
- `.planning/REQUIREMENTS.md` §"Async Pipeline (PIP)" — PIP-01..PIP-06 acceptance criteria. PIP-04 needs a Wave 0 amendment per D-01 above.
- `.planning/research/SUMMARY.md` §3 A7, §3 A11, §6 C5, §6 IP-1, §6 IP-7 — the irreversible decisions Phase 6 makes concrete. Read these to understand WHY the constraints exist.

### Phase 5 carry-forward (the consumer body is already shipped)

- `.planning/phases/05-ai-integration/05-CONTEXT.md` — D-01..D-07 + the Triage Worker auth pattern under Claude's Discretion. Phase 6 inherits all of Phase 5's locked decisions (cold-storage routing, hybrid ranking, model bindings, Analytics Engine schema).
- `.planning/phases/05-ai-integration/05-AI-SPEC.md` §"State Management" (line 484) — the `ingest_status` row in the state-management table that D-03 makes concrete (the row currently says "Phase 5 may pre-populate to `pending` on insert" — that did NOT ship in Phase 5; Phase 6 D-03 amends to "Phase 6 adds the column via v3 migration").
- `.planning/phases/05-ai-integration/05-AI-SPEC.md` §3 "Tool Use" — Queue consumer retry semantics (`message.retry({delaySeconds: 30})`); Phase 6 extends with the pre-empt-before-exhaust pattern under Claude's Discretion.
- `packages/triage-worker/src/index.ts` — **The Queue consumer body is already shipped (Phase 5).** Lines 90–227 are the `async queue(batch, env)` handler with sequential message processing, memoized workspaceTag, extractAndScore call, memorability-based switch, Analytics Engine writes. Phase 6 adds: permanent-failure path (catch + `markIngestFailed` + `message.ack()`) + Queue attempts pre-emption.
- `packages/triage-worker/wrangler.jsonc` — Lines 22–24 declare the Queue consumer block as a Phase 6 wiring point ("Queue consumer block lands in Phase 6 PIP-01"). Phase 6 fills that in.
- `packages/triage-worker/src/extract.ts` — AI-05 + AI-07 retry-on-429 logic (Phase 5). Phase 6 hooks the post-retry-budget catch into `markIngestFailed`.
- `packages/mcp-server/src/tools.ts` lines 257–392 (`remember()` handler) — Phase 6 adds the `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` line after the Analytics Engine write, before the envelope return. Lines 628–652 (`ingest()` stub) get a comment retarget per D-02.
- `packages/mcp-server/wrangler.jsonc` — Phase 6 adds the `queues.producers[]` binding (`binding: "INGEST_QUEUE"`).

### WorkspaceDO surface

- `packages/workspace-do/src/schema.ts` — Lines 66–143 (V1_SQL), 182–185 (V2_SQL cold_storage). Phase 6 appends `V3_SQL` for `ingest_status` per D-03.
- `packages/workspace-do/src/migrations.ts` — `MIGRATIONS` array. Phase 6 appends `{ version: 3, name: "v3_ingest_status", sql: V3_SQL }`.
- `packages/workspace-do/src/queries.ts` — Lines 585–718 (updateBlockEnrichment / moveToInbox / moveToColdStorage). Phase 6 amends each UPDATE statement to set `ingest_status = 'enriched'`; amends `moveToInbox` insert to use `INSERT OR IGNORE`; adds new `markIngestFailed` helper.
- `packages/workspace-do/src/index.ts` — DO method surface. Phase 6 adds `markIngestFailed(workspace_id, block_id, reason)` RPC (mirroring the existing `updateBlockEnrichment` signature shape; STO-07 `assertOwnsWorkspace` as first line).
- `shared/types/src/index.ts` — `MemoryEvent` interface (lines 26–44). Locked Phase 1; Phase 6 populates it from `remember()` per Claude's Discretion §"MemoryEvent payload contents."
- `packages/workspace-do/src/__tests__/migrations.test.ts` — RED test target for the v3 migration (PRAGMA introspection asserting `blocks.ingest_status TEXT NOT NULL DEFAULT 'pending'` + index existence).

### Cloudflare official docs (for Queue config + DLQ semantics)

- <https://developers.cloudflare.com/queues/> — Queue overview.
- <https://developers.cloudflare.com/queues/configuration/configure-queues/> — `max_batch_size`, `max_batch_timeout`, `max_retries`, `dead_letter_queue` consumer config.
- <https://developers.cloudflare.com/queues/configuration/javascript-apis/#message> — Queue message API: `attempts`, `retry()`, `ack()`. Phase 5 already uses these; Phase 6's pre-emption pattern reads `message.attempts`.
- <https://developers.cloudflare.com/queues/reference/how-queues-works/#message-delivery-guarantees> — at-least-once delivery semantic that A11/IP-1 mitigates.
- <https://developers.cloudflare.com/queues/reference/local-development/> — Wrangler local Queue emulator; planner verifies coverage in Wave 4 test infra.

### Pending todos (referenced under decisions)

- `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md` — referenced by D-01. Phase 6 Wave 0 doc touch-up annotates the file with "Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01" and the file moves from `pending/` to `pending/` (stays open — v0.2 picks it up).

### Project + global guidance (always-on)

- `CLAUDE.md` (project root) — Engram architecture spec; §"What Goes Where" routing rules; §"MCP Tool Surface" (PIP-04's enrichment outputs feed `recall()`'s `context.entities` + `context.related` fields in v0.2); §"Ingest Pipeline" (the canonical pipeline diagram — Phase 5 amended it to remove the "discard" branch; Phase 6 does NOT amend the diagram, the pipeline as documented matches).
- `~/.claude/CLAUDE.md` §"AI Model Routing" — 3-question checklist + phase-character heuristic. Phase 6 is **contract-integration** (Queue/RPC/producer-site coordination), so the expected cf-code-assist share is <20% per Claude's Discretion above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/triage-worker/src/index.ts` — Queue consumer `async queue(batch, env)` ALREADY SHIPPED in Phase 5. Phase 6 extends the existing switch with a permanent-failure catch + `markIngestFailed` + `message.ack()` path. No new file in `triage-worker/src/` — Phase 6 amends `index.ts` + `extract.ts` only.
- `packages/triage-worker/src/extract.ts` — `extractAndScore` already implements 429 retry via `message.retry({delaySeconds: 30})` AND Zod parse retry once at 5s. Phase 6 hooks the post-retry-budget catch (currently the function logs + acks; Phase 6 wires the same catch to call `markIngestFailed` first).
- `packages/triage-worker/src/analytics.ts` — `writeAnalytics(env, dataPoint)` + `workspaceTag(workspace_id)` helpers. Phase 6 reuses both for every `markIngestFailed` call site.
- `packages/mcp-server/src/tools.ts` `remember()` handler — the sync embed + Vectorize upsert + Analytics Engine write path is complete (Phase 5). Phase 6 appends one `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` line + the MemoryEvent assembly above it.
- `packages/workspace-do/src/queries.ts` typed helpers — `updateBlockEnrichment`, `moveToInbox`, `moveToColdStorage`. Phase 6 amends each UPDATE statement to set `ingest_status = 'enriched'` (one-line addition per helper).
- `packages/workspace-do/src/migrations.ts` — `runMigrations(sql)` with `_schema_migrations` tracker. Phase 6 appends a v3 entry; the runner handles forward-only application + idempotency. Same pattern as Phase 5 V2_SQL.
- `scripts/setup-vectorize.sh` — idempotent `wrangler vectorize create` pattern. Phase 6 mirrors as `scripts/setup-queue.sh` (`wrangler queues create engram-ingest` with skip-if-exists check) OR extends `setup-vectorize.sh` to also create the Queue (planner picks; mirror is cleaner for single-purpose scripts).
- `packages/workspace-do/src/__tests__/migrations.test.ts` — Phase 2/5 test pattern for migration introspection (PRAGMA assertions). Phase 6 RED test for v3 migration mirrors this shape.

### Established Patterns

- **Sync helpers, async wrapper** (Phase 2 D-01) — WorkspaceDO methods stay sync internally; `markIngestFailed` follows the pattern (sync SQL UPDATE wrapped in the async RPC method that triage-worker calls via `(stub as any).markIngestFailed(...)`).
- **`assertOwnsWorkspace` first line of every RPC** (STO-07) — `markIngestFailed` starts with the same check, mirroring `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage`.
- **Workspace_id ALWAYS from props** (Phase 3 D-05 / MCP-05 / MT-1) — `remember()`'s MemoryEvent assembly uses `props.workspace_id`, NEVER `args.workspace_id`.
- **TS-source / no build step** (Phase 1 D-07) — Phase 6 stays in this posture.
- **Strict TS** (Phase 1 D-08) — Phase 6 additions satisfy `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- **vitest under `@cloudflare/vitest-pool-workers`** — Phase 6 integration tests use the existing harness; Queue tests fall back to in-process Queue mocking if Wrangler's local emulator coverage is thin (planner verifies in Wave 4).
- **Frozen META_GAPS strings** (Phase 4 D-09/D-10) — Phase 6 does NOT add new META_GAPS strings (no envelope changes); pattern carried forward unchanged.
- **Analytics Engine schema** — every AI/DO-RPC op writes one row (Phase 5 §"Production monitoring"). Phase 6 adds `triage-worker/ingest-failed-{reason-tag}` blob entries for every `markIngestFailed` call.
- **Sequential message processing** (Phase 5 Design note in `triage-worker/src/index.ts`) — `for...of` not `Promise.all`; carries forward to Phase 6's permanent-failure branches (sequential is still correct because failures still go through the same per-message loop).

### Integration Points

- `packages/triage-worker/wrangler.jsonc` (EDIT) — add the Queue consumer block per Claude's Discretion §"Cloudflare Queues consumer config." The placeholder comment at lines 22–24 already marks this as the Phase 6 wiring site.
- `packages/mcp-server/wrangler.jsonc` (EDIT) — add `"queues": { "producers": [{ "binding": "INGEST_QUEUE", "queue": "engram-ingest" }] }`.
- `packages/workspace-do/src/schema.ts` (EDIT) — append `V3_SQL` per D-03.
- `packages/workspace-do/src/migrations.ts` (EDIT) — append `{ version: 3, name: "v3_ingest_status", sql: V3_SQL }` to `MIGRATIONS`.
- `packages/workspace-do/src/queries.ts` (EDIT) — amend `updateBlockEnrichment` / `moveToInbox` / `moveToColdStorage` UPDATE statements with `ingest_status = 'enriched'`; amend `moveToInbox` `INSERT` to `INSERT OR IGNORE`; add `markIngestFailed` helper.
- `packages/workspace-do/src/index.ts` (EDIT) — add `markIngestFailed(workspace_id, block_id, reason)` RPC method.
- `packages/mcp-server/src/tools.ts` (EDIT) — `remember()` handler: append MemoryEvent assembly + `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` after the Analytics Engine write, before the envelope return. `ingest()` handler: retarget the Phase-6-hand-off comment per D-02.
- `packages/triage-worker/src/index.ts` (EDIT) — wrap the DO-RPC switch in a try/catch; on catch, call `markIngestFailed` + `message.ack()`. Add `message.attempts >= 2` pre-emption: route to permanent-failure on 3rd attempt instead of letting Queue runtime ack silently.
- `packages/triage-worker/src/extract.ts` (EDIT) — post-retry-budget catch path: call `markIngestFailed` before the existing `message.ack()`.
- `scripts/setup-queue.sh` (NEW) — idempotent `wrangler queues create engram-ingest` mirroring `scripts/setup-vectorize.sh`. Planner picks the exact wrangler invocation against Cloudflare docs.
- `packages/workspace-do/src/__tests__/migrations.test.ts` (EXTEND) — v3 migration introspection (RED).
- `packages/triage-worker/src/__tests__/` (NEW integration test) — replay-twice idempotency, ingest_status lifecycle, cold-storage + enriched orthogonality.
- `packages/mcp-server/src/__tests__/tools-integration.test.ts` (EXTEND) — latency test: `remember()` returns before Queue consumer runs.
- `.planning/ROADMAP.md` (EDIT, Wave 0 doc touch-up) — PIP-04 success criterion footnote per D-01.
- `.planning/REQUIREMENTS.md` (EDIT, Wave 0 doc touch-up) — PIP-04 line footnote per D-01.
- `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md` (EDIT, Wave 0 doc touch-up) — annotate "Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01."

</code_context>

<deferred>
## Deferred Ideas

- **v0.2 conflict detection with measured precision (formerly Phase 6 PIP-04 clause)** — Per D-01. The pending todo `2026-05-26-phase-6-validate-conflict-detection-precision.md` describes the 50-sample validation harness (25 genuine conflicts + 15 benign updates + 10 unrelated pairs) and the 3-way decision gate (≥90% ship per-write / 70–90% ship as suggestions / <70% defer to nightly batch). v0.2 owns this.
- **v0.2 stuck-pending sweep Cron Worker** — D-03's known limitation: `ctx.waitUntil(env.INGEST_QUEUE.send())` is fire-and-forget; a Cloudflare Queues outage can leave blocks at `ingest_status = 'pending'` indefinitely. A v0.2 Cron Worker can sweep `WHERE ingest_status = 'pending' AND created_at < now - N minutes` and re-enqueue (idempotent re-send is safe because the block.id is the dedup key).
- **v0.2 inbox UI partial-failure visibility** — Per D-03. The `ingest_status = 'failed'` column is the v0.2 inbox UI's "broken memories" tab. v0.2 milestone owns the UI build; Phase 6 ships the SQLite surface.
- **v0.2 DLQ queue + replay tool** — Per D-03. If v0.2 traffic data shows the SQLite-only failure surface is insufficient (e.g., Russell wants to replay a batch of failed enrichments after fixing a Triage Worker bug), v0.2 can add `engram-ingest-dlq` + a tiny `triage-replay-worker` inspector. v0.1 does not need this.
- **v0.4 `ingest()` MCP tool implementation** — Per D-02. The Phase 4 honest-stub stays through v0.1, v0.2, v0.3. v0.4 connectors (Slack channel ingestion, Google Drive polling) need a real producer surface; that's when the `ingest()` body fills in (likely as a URL-fetch path per the discussion's option (b)).
- **v0.4 `ingest-worker` package** — The CLAUDE.md mention of `ingest-worker` was Phase 1 deferred per C4. v0.4 brings it back as the connector orchestration layer.
- **v0.2 retry budget tuning** — Claude's Discretion sets `max_retries: 3` for v0.1. If Workers AI 429s become more common at higher v0.2 volume, the retry budget may need adjustment + maybe a separate "high-retry" queue for known-flaky operations.
- **v0.2 Queue throughput observability** — Phase 6 ships Workers Analytics Engine writes per message processed (carry-forward from Phase 5 §"Production monitoring") but does NOT add Queue-level dashboards (lag, throughput, in-flight count). v0.2 adds these as part of the broader Intelligence Layer observability work.

### Reviewed Todos (not folded — already resolved by Phase 5)

- `2026-05-26-phase-4-raw-chunks-escape-hatch.md` — Phase 4 closed.
- `2026-05-26-phase-4-spike-workers-ai-extraction-quality.md` — Phase 4 closed.
- `2026-05-26-phase-5-cold-storage-not-discard.md` — Phase 5 D-07 implemented cold-storage routing.
- `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` — Phase 5 AI-04 ships hybrid ranking.

</deferred>

---

*Phase: 06-async-pipeline*
*Context gathered: 2026-05-29*
