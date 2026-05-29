---
phase: 06-async-pipeline
verified: 2026-05-29T14:45:00Z
status: passed
score: 31/31 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  initial_verification: true
---

# Phase 6: Async Pipeline Verification Report

**Phase Goal:** The `engram-ingest` Queue connects the MCP Worker (producer, via `ctx.waitUntil`) to the Triage Worker (consumer), `MemoryEvent.id` serves as the idempotency key with `INSERT OR IGNORE` semantics, partial failures are tracked via `blocks.ingest_status`, and retries / DLQ logging never silently drop events.

**Verified:** 2026-05-29T14:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### ROADMAP Success Criteria (the canonical contract)

| # | Success Criterion | Status | Evidence |
|---|------|--------|----------|
| 1 | `engram-ingest` Queue exists and is bound to `mcp-server` (producer) + `triage-worker` (consumer) per per-package wrangler.jsonc | VERIFIED | `packages/mcp-server/wrangler.jsonc:19-21` declares `queues.producers[]` with binding `INGEST_QUEUE` → `engram-ingest`. `packages/triage-worker/wrangler.jsonc:30-39` declares `queues.consumers[]` with `queue=engram-ingest, max_batch_size=10, max_batch_timeout=5, max_retries=3` and NO `dead_letter_queue` (per D-03). `scripts/setup-queue.sh` (48 lines) is idempotent (precheck via `wrangler queues info` then conditional create). |
| 2 | Sync writes from `remember()` go direct to WorkspaceDO via RPC; `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` fires async enrichment afterward | VERIFIED | `packages/mcp-server/src/tools.ts:399-451`: MemoryEvent is assembled AFTER Vectorize upsert succeeds (line 388 comment marks the boundary), then `getCtx().waitUntil((async () => await ingestQueue.send(memoryEvent))())` fires fire-and-forget (line 429). `packages/mcp-server/src/__tests__/tools-integration.test.ts:640-722` PIP-02 describe asserts `queueSendInvokedAt === null` at `remember()`'s return point (binary decoupling proof — flake-free). Test GREEN. |
| 3 | `MemoryEvent.id` is producer-generated UUID; replaying same event twice does not duplicate blocks (verified by integration test using `INSERT OR IGNORE`) | VERIFIED | `tools.ts:400` sets `id: id` (same UUID minted at line 281 via `crypto.randomUUID()` for the block row). `queries.ts:480-491` `createInboxEntry` uses `INSERT OR IGNORE INTO inbox`. `queue-integration.test.ts:246-278` "PIP-03: replay-twice with same MemoryEvent.id produces exactly 1 inbox row + 1 block + ingest_status='enriched'" — GREEN. |
| 4 | Triage Worker performs entity extraction, summarization, memorability scoring; writes results back via RPC (not direct SQL). Conflict detection deferred to v0.2 per D-01 | VERIFIED | `triage-worker/src/index.ts:211-292` resolves DO stub via `env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id))` and calls one of three WorkspaceDO RPCs (`updateBlockEnrichment`, `moveToInbox`, `moveToColdStorage`) based on memorability decision. Zero direct SQL in triage-worker. D-01 deferral confirmed in ROADMAP.md:303 ("_Conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01._") and REQUIREMENTS.md:76. |
| 5 | Triage Worker failures use `message.retry()` (transient) or `message.ack()` + DLQ logging (permanent); no silent drops; test exercises both paths | VERIFIED | Three permanent-failure paths all call `markIngestFailed` + `message.ack()` BEFORE the Queues runtime could silently ack-on-retry-exhaustion: (a) `extract.ts:144-175` non-429 throw on last attempt; (b) `extract.ts:251-278` Zod parse fail on attempts >= 2; (c) `index.ts:303-355` DO-RPC catch on last attempt. CR-01 + WR-03 also covered by per-message wrapper at `index.ts:120-187` (commit 6a2e20e). Tests: `queue-integration.test.ts:370-499` cover both Zod-permanent AND DO-RPC-permanent paths (GREEN). |
| 6 | `blocks.ingest_status` tracks per-block enrichment state (pending, enriched, failed); query joins return coherent partial-failure visibility | VERIFIED | `schema.ts:246-249` `V3_SQL = ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending'; CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status ON blocks(ingest_status);`. `migrations.ts:59` declares `{ version: 3, name: "v3_ingest_status", sql: V3_SQL }`. `queries.ts` atomically writes `ingest_status = 'enriched'` in `updateBlockEnrichment:617`, `moveToInbox:671`, `moveToColdStorage:716`; writes `ingest_status = 'failed'` in `markIngestFailed:766`. `queue-integration.test.ts` GREEN — all three lifecycle transitions exercised end-to-end. |

**Score:** 6/6 success criteria verified

### Observable Truths (merged from PLAN frontmatter must_haves)

#### Wave 1 (06-01-PLAN.md)

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 1 | ROADMAP PIP-04 SC4 documents conflict-detection deferral to v0.2 (per D-01) | VERIFIED | `ROADMAP.md:303` contains "_Conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01._" |
| 2 | REQUIREMENTS PIP-04 line documents conflict-detection deferral to v0.2 (per D-01) | VERIFIED | `REQUIREMENTS.md:76` contains "conflict detection deferred to v0.2 — see Phase 6 CONTEXT.md D-01" |
| 3 | Pending conflict-detection-precision todo notes validation moves to v0.2 (per D-01) | VERIFIED | `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md:45` contains "Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01." |
| 4 | Fresh WorkspaceDO has `blocks.ingest_status` column (TEXT NOT NULL DEFAULT 'pending') after v3 migration | VERIFIED | `schema.ts:247` defines the ALTER; `schema.test.ts` PRAGMA introspection test "includes ingest_status TEXT NOT NULL DEFAULT 'pending' added by v3 migration" GREEN |
| 5 | `idx_blocks_ingest_status` index exists on blocks after v3 migration | VERIFIED | `schema.ts:248` `CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status`; `schema.test.ts` "creates idx_blocks_ingest_status supporting index" GREEN |
| 6 | `_schema_migrations` table contains exactly 3 rows after first init: v1_initial_schema, v2_cold_storage, v3_ingest_status | VERIFIED | `migrations.ts:51-60` declares all 3 entries; `schema.test.ts` "contains rows for v1_initial_schema, v2_cold_storage, v3_ingest_status after first init" GREEN; `hibernation.test.ts` row-count bumped 2→3 |
| 7 | Re-instantiating WorkspaceDO does not re-run v3 migration (idempotency via `_schema_migrations` runner) | VERIFIED | `migrations.ts:62+` runMigrations applies entries with `WHERE version NOT IN`; `hibernation.test.ts` (STO-09) GREEN — replay does not duplicate seed or schema rows |

#### Wave 2 — Plan 06-02 (Queue infra + getCtx)

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 8 | Idempotent `setup-queue.sh` exists (re-runs are no-op) | VERIFIED | `scripts/setup-queue.sh:39` `if npx wrangler queues info "${QUEUE_NAME}" >/dev/null 2>&1; then echo "[skip] ... already exists"; else create; fi` |
| 9 | mcp-server/wrangler.jsonc declares `queues.producers[]` with binding `INGEST_QUEUE` → `engram-ingest` | VERIFIED | `packages/mcp-server/wrangler.jsonc:19-21` `"queues": { "producers": [{ "binding": "INGEST_QUEUE", "queue": "engram-ingest" }] }` |
| 10 | triage-worker/wrangler.jsonc declares `queues.consumers[]` with `engram-ingest, max_batch_size 10, max_batch_timeout 5, max_retries 3`, NO `dead_letter_queue` | VERIFIED | `packages/triage-worker/wrangler.jsonc:30-39` declares all four config fields. Line 28 explicitly comments "No DLQ per D-03". Grep confirms no `dead_letter_queue` token in file. |
| 11 | `registerTools()` accepts 4th `getCtx: () => DurableObjectState` parameter | VERIFIED | `tools.ts:193` signature shows `getCtx: () => DurableObjectState`; jsdoc at line 182-185 |
| 12 | `EngramMcp.init()` passes `() => this.ctx` as the new 4th arg | VERIFIED | `mcp-server/src/index.ts:94-99` `registerTools(this.server, () => this.props, this.env, () => this.ctx)` |
| 13 | No existing handler behavior changed by the registerTools signature widening (existing tests stay GREEN) | VERIFIED | mcp-server test suite: 129 passed | 5 skipped (134); all TOL-01..05 tests pass unchanged |

#### Wave 2 — Plan 06-03 (WorkspaceDO surface)

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 14 | `updateBlockEnrichment` transitions block to `ingest_status='enriched'` | VERIFIED | `queries.ts:617` UPDATE includes `ingest_status = 'enriched'` atomic with enrichment write |
| 15 | `moveToColdStorage` sets BOTH `cold_storage=1` AND `ingest_status='enriched'` (D-03 orthogonality) | VERIFIED | `queries.ts:716` `UPDATE blocks SET cold_storage = 1, ingest_status = 'enriched', ...`; `queue-integration.test.ts:341-365` "PIP-06 / D-03: memorability < 0.4 transitions pending → enriched AND sets cold_storage=1 simultaneously (NEVER failed)" GREEN |
| 16 | `moveToInbox` results in source block `ingest_status='enriched'` AND exactly one inbox row | VERIFIED | `queries.ts:664-678` calls `createInboxEntry` then explicit `UPDATE blocks SET ingest_status = 'enriched'`; `queue-integration.test.ts:313-336` GREEN |
| 17 | Calling `moveToInbox` twice with same block_id results in exactly one inbox row (PIP-03/IP-1 idempotency) | VERIFIED | `queries.ts:482` `INSERT OR IGNORE INTO inbox`; `queue-integration.test.ts:246-278` "replay-twice ... produces exactly 1 inbox row" GREEN |
| 18 | `markIngestFailed` flips block to `ingest_status='failed'` AND writes `properties = {error, failed_at}` | VERIFIED | `queries.ts:760-774` UPDATE sets `ingest_status = 'failed'` and `properties = JSON.stringify({error: args.reason, failed_at: Date.now()})`; `defense-in-depth.test.ts:180-191` positive test GREEN; `queue-integration.test.ts:370-399` GREEN |
| 19 | WorkspaceDO.markIngestFailed RPC with mismatched workspace_id throws McpError(InvalidRequest) BEFORE any SQLite write (STO-07 gate) | VERIFIED | `workspace-do/src/index.ts:351-357` first line is `this.assertOwnsWorkspace(args.workspace_id)`; `defense-in-depth.test.ts:193-212` "markIngestFailed throws McpError(InvalidRequest) on workspace_id mismatch (STO-07 gate)" GREEN |
| 20 | Calling `markIngestFailed` for non-existent block throws NotFoundError | VERIFIED | `queries.ts:771-773` `if (result.rowsWritten === 0) throw new NotFoundError("block", args.block_id)`; helpers.test.ts NotFoundError assertion GREEN |

#### Wave 3 — Plan 06-04 (producer wiring + permanent-failure)

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 21 | `remember()` handler enqueues a MemoryEvent to env.INGEST_QUEUE via `getCtx().waitUntil(...)` AFTER Vectorize upsert succeeds | VERIFIED | `tools.ts:388-451` Phase 6 block lives between Vectorize upsert writeAnalytics (line 374-385) and envelope return (line 456); `getCtx().waitUntil((async () => ingestQueue.send(memoryEvent))())` at line 429 |
| 22 | `remember()` returns BEFORE `env.INGEST_QUEUE.send` resolves (PIP-02 latency invariant) | VERIFIED | `tools-integration.test.ts:703` asserts `queueSendInvokedAt === null` at remember()'s synchronous return point; tracker-based decoupling proof; GREEN |
| 23 | env.INGEST_QUEUE is read LAZILY inside the handler body (NOT closure-captured at registerTools entry) so test-time env patches take effect | VERIFIED | `tools.ts:415` `const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;` lives inside the handler body, with explicit B3-fix comment at line 409-414. The PIP-02 latency test relies on this and is GREEN |
| 24 | `ingest()` tool comment retargeted from 'Phase 6 adds' to 'v0.4 connectors will' per D-02 | VERIFIED | `tools.ts:702` `/* eslint-disable @typescript-eslint/require-await -- D-05: ingest has no await in v0.1; async is kept so v0.4 connectors (Slack channel ingestion, Google Drive polling) add the Queue producer body — Phase 6 left ingest as a stub per Phase 6 CONTEXT.md D-02 */` |
| 25 | Triage Worker extract.ts Zod-permanent-fail branch (attempts >= 2) calls `markIngestFailed` BEFORE `message.ack()` | VERIFIED | `extract.ts:228-278` permanent branch: lines 251-276 call `markIngestFailed` (with inner try/catch), then line 278 `message.ack()` |
| 26 | Triage Worker extract.ts non-429 throw branch detects last attempt and calls `markIngestFailed` before bubbling | VERIFIED | `extract.ts:144-175` `const isLastAttempt = (message.attempts ?? 0) >= 2; if (isLastAttempt) { ... markIngestFailed ... message.ack(); return null; } throw err;` — on last attempt, marks + acks instead of re-throwing |
| 27 | Triage Worker index.ts DO-RPC catch path: on last allowed attempt (attempts >= 2), calls `markIngestFailed` + `message.ack()` (pre-empts silent drop) | VERIFIED | `index.ts:303-355` catch block: `if (isLastAttempt) { try { ... markIngestFailed ... } catch ... ; message.ack(); }` |
| 28 | Triage Worker index.ts DO-RPC catch path: on non-last attempts, calls `message.retry({delaySeconds: 30})` | VERIFIED | `index.ts:351-354` `else { message.retry({ delaySeconds: 30 }); }` |
| 29 | `MemoryEvent.workspace_id` sourced from `props.workspace_id` (JWT-derived), NEVER from args | VERIFIED | `tools.ts:403` `workspace_id: props.workspace_id` (no `args.workspace_id` anywhere in MemoryEvent assembly) |
| 30 | `MemoryEvent.id` equals the SQLite `block.id` (A11/IP-1 idempotency hook) | VERIFIED | `tools.ts:400` `id: id` — uses the same UUID `const id = crypto.randomUUID()` minted upstream for the block row |

#### Wave 4 — Plan 06-05 (integration tests)

| # | Truth | Status | Evidence |
|---|------|--------|----------|
| 31 | All Phase 6 behavioral invariants covered by automated tests (PIP-01..06) | VERIFIED | `queue-integration.test.ts` (715 lines, 9 it() blocks across 7 describes); `tools-integration.test.ts` PIP-02 describe (lines 640-722); triage-worker test suite GREEN (14 passed | 1 skipped); workspace-do test suite GREEN (37 passed | 1 skipped); mcp-server test suite GREEN (129 passed | 5 skipped) |

**Total Score:** 31/31 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/workspace-do/src/schema.ts` | V3_SQL exported constant (ALTER TABLE + CREATE INDEX) | VERIFIED | 249 lines; V3_SQL at line 246-249 exactly matches D-03 contract |
| `packages/workspace-do/src/migrations.ts` | MIGRATIONS v3 entry | VERIFIED | Line 59 declares v3 entry; V3_SQL imported at line 40 |
| `packages/workspace-do/src/queries.ts` | Amended helpers + new markIngestFailed | VERIFIED | 774 lines; markIngestFailed at line 760-774; 3 enrichment helpers amended at lines 617, 671, 716; INSERT OR IGNORE at line 482 |
| `packages/workspace-do/src/index.ts` | WorkspaceDO.markIngestFailed RPC | VERIFIED | 358 lines; RPC method at line 351-357; STO-07 gate first executable line |
| `packages/mcp-server/wrangler.jsonc` | queues.producers[] INGEST_QUEUE binding | VERIFIED | Lines 19-21 |
| `packages/triage-worker/wrangler.jsonc` | queues.consumers[] engram-ingest config (no DLQ) | VERIFIED | Lines 30-39; no `dead_letter_queue` token |
| `packages/mcp-server/src/tools.ts` | remember() Queue producer + ingest() comment retarget + registerTools getCtx | VERIFIED | 726 lines; producer block at line 388-451; ingest() comment retarget at line 702; registerTools signature at line 183-195 |
| `packages/mcp-server/src/index.ts` | EngramMcp.init() passes () => this.ctx as 4th arg | VERIFIED | Line 94-99 |
| `packages/triage-worker/src/extract.ts` | env widened with WORKSPACE + markIngestFailed in 2 permanent branches | VERIFIED | 290 lines; env type widened at line 89; non-429 last-attempt branch at line 144-175; Zod permanent branch at line 228-278 |
| `packages/triage-worker/src/index.ts` | DO-RPC try/catch + attempts pre-emption + markIngestFailed | VERIFIED | 358 lines; per-message wrapper at line 120-187 (CR-01/WR-03 fix); DO-RPC catch at line 303-355 |
| `scripts/setup-queue.sh` | Idempotent Queue provisioning | VERIFIED | 48 lines; precheck via `wrangler queues info` at line 39; conditional create at line 41-44 |
| `packages/triage-worker/src/__tests__/queue-integration.test.ts` | PIP-01..06 integration tests | VERIFIED | 715 lines; 9 it() blocks covering replay-twice idempotency, lifecycle transitions, orthogonality, permanent-failure paths, CR-01/WR-03 regression |
| `packages/triage-worker/src/__tests__/test-worker-entry.ts` | Test-only Worker entry re-exporting WorkspaceDO | VERIFIED | 24 lines; re-exports WorkspaceDO alongside the queue handler so workerd test pool can mount WORKSPACE as same-Worker binding |
| `packages/triage-worker/wrangler.test.jsonc` | Test pool config with same-Worker WORKSPACE binding | VERIFIED | File exists with main pointing at test-worker-entry.ts; same-Worker WorkspaceDO binding + v1 migration |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` | PIP-02 latency describe | VERIFIED | Lines 640-722; tracker-based decoupling proof (`queueSendInvokedAt === null` at return point); GREEN |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| migrations.ts | schema.ts | named import of V3_SQL | WIRED | `import { V1_SQL, V2_SQL, V3_SQL } from "./schema.js"` at line 40 |
| EngramMcp.init() | registerTools | 4 args (server, getProps, env, getCtx) | WIRED | Line 94-99 in index.ts matches pattern exactly |
| mcp-server/wrangler.jsonc | engram-ingest Queue | queues.producers[] binding declaration | WIRED | Line 20: `{ "binding": "INGEST_QUEUE", "queue": "engram-ingest" }` |
| triage-worker/wrangler.jsonc | engram-ingest Queue | queues.consumers[] binding declaration | WIRED | Line 33: `"queue": "engram-ingest"` |
| WorkspaceDO.markIngestFailed (RPC) | markIngestFailed (queries.ts helper) | renamed-import + delegation | WIRED | `markIngestFailed as markIngestFailedQuery` at line 86; called at line 353 |
| WorkspaceDO.markIngestFailed body | assertOwnsWorkspace gate | first-line invariant (STO-07) | WIRED | Line 352 is first executable line |
| createInboxEntry | inbox.id PK | INSERT OR IGNORE clause | WIRED | Line 482 |
| remember() handler | env.INGEST_QUEUE.send | `getCtx().waitUntil((async () => INGEST_QUEUE.send(...))())` lazy dereference | WIRED | Line 415 lazy read; line 432 inner `await ingestQueue.send(memoryEvent)`; wrapped in waitUntil at line 429 |
| MemoryEvent assembly | props.workspace_id (JWT-derived) | object literal `workspace_id: props.workspace_id` | WIRED | Line 403 |
| extract.ts permanent-fail branches | WorkspaceDO.markIngestFailed RPC | cross-Worker DO stub cast | WIRED | Lines 146-156 (non-429), 251-265 (Zod) |
| triage-worker index.ts catch | WorkspaceDO.markIngestFailed RPC | same cast pattern on cross-Worker stub | WIRED | Lines 326-338 (DO-RPC catch); lines 162-174 (pre-route wrapper) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|---------------------|--------|
| `remember()` handler MemoryEvent | `memoryEvent` | Assembled from `id` (crypto.randomUUID), `args.content`, `props.workspace_id`, `now` (Date.now), `props.user_id` | Yes — sourced from real JWT props + crypto-generated UUID + user content | FLOWING |
| Queue consumer | `event` (MessageBatch body) | Cloudflare Queues runtime delivers `MemoryEvent` published by `remember()` | Yes — full producer → queue → consumer chain tested in `queue-integration.test.ts` smoke test (line 702-714) | FLOWING |
| Triage Worker → WorkspaceDO | RPC call args | `event.workspace_id`, `event.id`, AI extraction output | Yes — `extractAndScore` returns `TriageOutput` (zod-validated AI response); `routeByMemorability` selects RPC; integration test GREEN | FLOWING |
| `markIngestFailed` reason | `args.reason` | Upstream error message via `err.message` (with reason-prefix) | Yes — wrapped JSON `{error, failed_at}` written to `blocks.properties` | FLOWING |
| `blocks.ingest_status` column | SQLite column value | Default 'pending' on insert; UPDATEd to 'enriched' on success or 'failed' on permanent fail | Yes — column populated for every block; queries can JOIN/WHERE on it | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| triage-worker tests pass | `npm test --workspace=@engram/triage-worker` | 14 passed \| 1 skipped | PASS |
| workspace-do tests pass | `npm test --workspace=@engram/workspace-do` | 37 passed \| 1 skipped | PASS |
| mcp-server tests pass | `npm test --workspace=@engram/mcp-server` | 129 passed \| 5 skipped | PASS |
| Queue consumer config is parseable JSON | `node -e 'JSON.parse(require("fs").readFileSync("packages/triage-worker/wrangler.jsonc","utf8").replace(/\/\/.*/g,"").replace(/,([\s}\]])/g,"$1"))'` | (jsonc parses cleanly when comments stripped) | PASS |
| setup-queue.sh has executable shape (bash shebang + idempotency check) | grep '#!/usr/bin/env bash' + grep 'queues info' setup-queue.sh | both present | PASS |
| No silent drops: every catch path in extract.ts ends in ack OR retry OR throw | manual code review of extract.ts lines 117-176, 209-279 | all 3 paths covered (retry for 429; ack-with-mark for last-attempt; throw on early non-429 caught by index.ts wrapper) | PASS |

### Probe Execution

No formal probe scripts declared by Phase 6 plans. Behavioral verification driven via the integration test suites listed above (which are the project-equivalent probes for this phase per CONTEXT.md §"Test infrastructure"). All test suites GREEN.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIP-01 | 06-02, 06-05 | `engram-ingest` Queue exists, bound to mcp-server (producer) + triage-worker (consumer) | SATISFIED | Both wrangler configs declare bindings; setup-queue.sh provisions; queue-integration tests exercise full producer→consumer chain |
| PIP-02 | 06-02, 06-04, 06-05 | Sync writes go direct to WorkspaceDO via RPC; `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` fires async | SATISFIED | `tools.ts:429` is the canonical pattern; PIP-02 latency test asserts the decoupling invariant |
| PIP-03 | 06-03, 06-04, 06-05 | `MemoryEvent.id = block.id` is the idempotency key; replay-twice does not duplicate | SATISFIED | `tools.ts:400` populates `id: id` from the same crypto.randomUUID; `INSERT OR IGNORE` at queries.ts:482; replay-twice test GREEN |
| PIP-04 | 06-01, 06-03, 06-04, 06-05 | Triage Worker performs entity extraction, summarization, memorability scoring; writes via RPC (conflict detection deferred to v0.2) | SATISFIED | D-01 deferral documented in ROADMAP + REQUIREMENTS; triage-worker calls only RPC methods (no direct SQL); enrichment via Phase 5 extract.ts (still in place) |
| PIP-05 | 06-03, 06-04, 06-05 | Triage Worker failures use `message.retry()` (transient) or `message.ack()` + DLQ logging (permanent); no silent drops | SATISFIED | All three permanent paths call `markIngestFailed` + `message.ack()` BEFORE Queues runtime could silent-ack on retry exhaustion; CR-01/WR-03 wrapper also covers pre-route throws; PIP-05 tests for both Zod-permanent and DO-RPC-permanent GREEN |
| PIP-06 | 06-01, 06-03, 06-05 | `blocks.ingest_status` tracks per-block enrichment state (`pending`, `enriched`, `failed`) | SATISFIED | V3 migration adds column + index; 3 enrichment helpers transition pending → enriched atomically; markIngestFailed transitions pending → failed; lifecycle integration tests GREEN |

All 6 declared PIP requirements satisfied. No orphaned PIP requirements detected (ROADMAP "Requirements: PIP-01..PIP-06" matches PLAN frontmatter exactly).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/mcp-server/src/tools.ts` | 151 | `TODO: derive from env.ENVIRONMENT if Phase 7 adds staging/dev split` | Info | Pre-existing TODO from Phase 5 (commit 3160dcc), NOT introduced by Phase 6. Refers to Phase 7 work (env tagging for staging/prod split). Not a Phase 6 blocker — out of scope. |
| `packages/triage-worker/src/extract.ts` | 131, 174, 194, 225, 279 | `return null` | Info (intentional) | All five returns are documented design — `extractAndScore` returns `null` to signal "caller should skip; retry/ack was already called inside". Not a stub pattern. Caller-side `if (parsed === null) continue;` at index.ts:189-192. |
| (none in Phase 6 modified files) | — | TBD/FIXME/XXX/HACK | (none found) | Phase 6 code is clean of debt markers. |

**Lint baseline:** Pre-Phase 6 baseline = 84 errors. Post-Phase 6 = 83 errors. Phase 6 slightly REDUCED lint errors (-1). All Phase 6 changes are lint-clean within the existing project baseline.

**Typecheck baseline:** Pre-Phase 6 baseline = 37 TS errors. Post-Phase 6 = 36 TS errors. Phase 6 slightly REDUCED typecheck errors (-1). All Phase 6 changes are type-safe within the existing project baseline.

### Code Review Findings Disposition

Per `06-REVIEW.md` (12 findings: 1 Critical + 6 Warnings + 5 Info):

| Finding | Severity | Status |
|---------|----------|--------|
| CR-01 | Critical | FIXED in commit 6a2e20e (per-message try/catch wrapper at index.ts:120-187) |
| WR-03 | Warning | FIXED in commit 6a2e20e (workspaceTag await now inside the wrapper try) |
| WR-01 | Warning | DEFERRED — reason field unsanitized; v0.2 inbox-UI surface concern. Per 06-REVIEW-FIX.md, out-of-scope-for-this-run (does not affect PIP-01..06 acceptance) |
| WR-02 | Warning | DEFERRED — `attempts >= 2` constant drift risk if max_retries changes; v0.2 hygiene. Current code is functionally correct. |
| WR-04 | Warning | DEFERRED — markIngestFailed overwrites properties; unreachable in Phase 6 code paths (every call site is on permanent-fail branch); v0.2 connector concern |
| WR-05 | Warning | DEFERRED — `Memory` type lacks discriminated union for enriched vs failure metadata; v0.2 type-safety hygiene |
| WR-06 | Warning | DEFERRED — `recall()`/`lexicalSearchBlocks` does not exclude `ingest_status='failed'` rows; v0.2 query hardening (Phase 6 PIP requirements do not mandate this filter; it's a quality-of-life improvement) |
| IN-01..05 | Info | DEFERRED — minor observability + JSDoc improvements; not blockers |

The disposition is documented in `06-REVIEW-FIX.md` with `status: all_fixed` for the in-scope findings (CR-01 + WR-03 explicitly requested). The 6 deferred warnings + 5 info findings do NOT block PIP-01..06 acceptance — they are quality-of-life improvements that will land naturally as v0.2 (Intelligence Layer) work progresses.

### Locked Decision Verification (D-01/D-02/D-03)

| Decision | Statement | Honored? | Evidence |
|----------|-----------|----------|----------|
| D-01 | Conflict detection deferred to v0.2; Phase 6 ships entity extraction + summarization + memorability scoring only | YES | ROADMAP.md:303 + REQUIREMENTS.md:76 amended; todo annotated at line 45. Triage Worker code does NOT scan against existing memories — only routes by memorability decision. `conflicts` SQLite table unused (zero rows written). |
| D-02 | `ingest()` stays as a Phase 4 honest-stub for v0.1; only Queue producer is `remember()`'s new ctx.waitUntil line | YES | `tools.ts:702` eslint-disable comment retargeted to "v0.4 connectors" (not "Phase 6"). `tools.ts:704-719` `ingest()` body unchanged — still returns `buildIngestResponse({ job_id: crypto.randomUUID() })` without sending Queue messages. `tools-integration.test.ts:593-612` TOL-05 test still GREEN with "no Queue side effect (D-05)" assertion. |
| D-03 | Permanent enrichment failures land in `blocks.ingest_status = 'failed'` + Workers Analytics Engine + Cloudflare observability logs; NO dedicated DLQ queue in v0.1 | YES | `triage-worker/wrangler.jsonc:28` comment "No DLQ per D-03"; no `dead_letter_queue` token in file. `markIngestFailed` helper writes `ingest_status = 'failed'` + `properties = {error, failed_at}` JSON. Every `markIngestFailed` call site paired with `writeAnalytics(env, { blobs: [..., "ingest-failed-*", ...] })` AND `console.error(...)` for observability. Orthogonality invariant (cold-storage + enriched never cold-storage + failed) enforced by code convention (moveToColdStorage is the only writer of cold_storage=1, and it pairs with enriched). |

All three D-* locked decisions honored in shipped code.

### Plan-Checker Iteration 1 Fixes (B1/B2/B3) Verification

| Fix | Description | Honored? | Evidence |
|-----|-------------|----------|----------|
| B1 | Use seed-block + vi.spyOn pattern for DO-RPC failure test (only way to prove SQLite pending → failed transition) | YES | `queue-integration.test.ts:404-499` "PIP-05: DO-RPC failure permanent (attempts >= 2, seed-block + vi.spyOn scenario)" uses `vi.spyOn(env.WORKSPACE, 'get').mockReturnValueOnce(spied_stub)` per the B1 fix; GREEN |
| B2 | `captureCallback` ctxOverride 4th-arg seat for PIP-02 latency test (tracker-based decoupling proof) | YES | `tools-integration.test.ts:195` line 195 comment notes B2 fix; PIP-02 describe uses `waitUntilPromises` array tracker at lines 680-720 |
| B3 | env.INGEST_QUEUE lazily dereferenced INSIDE the handler body (NOT closure-captured at registerTools entry) | YES | `tools.ts:415` lazy dereference; line 409-414 explicit B3-fix comment; PIP-02 latency test relies on this and is GREEN |

All 3 critical fixes from plan-checker iteration 1 hold in committed source.

### Test Suite Health

| Package | Pass | Skip | Fail | Status |
|---------|------|------|------|--------|
| @engram/triage-worker | 14 | 1 | 0 | GREEN |
| @engram/workspace-do | 37 | 1 | 0 | GREEN |
| @engram/mcp-server | 129 | 5 | 0 | GREEN |
| **Total** | **180** | **7** | **0** | **GREEN** |

All test suites GREEN. Zero regressions detected in pre-existing tests.

### Gaps Summary

**None.** Phase 6 goal achieved end-to-end:

1. `engram-ingest` Queue connects mcp-server (producer via `ctx.waitUntil`) → triage-worker (consumer) — verified via wrangler config + integration tests.
2. `MemoryEvent.id` IS the SQLite block.id (same UUID); INSERT OR IGNORE on inbox enforces idempotency on duplicate Queue delivery — verified via replay-twice test.
3. Partial failures tracked via `blocks.ingest_status` (pending → enriched on success | pending → failed on permanent fail) — verified via lifecycle integration tests covering 3 happy paths + 2 failure paths.
4. Retries / DLQ logging never silently drop events — verified via 3 permanent-failure paths all calling `markIngestFailed` + `message.ack()` BEFORE the Queues runtime could silent-ack on retry exhaustion. CR-01 + WR-03 wrapper provides additional batch-poisoning protection.

The phase goal is observably true in the codebase. All 6 PIP requirements satisfied. All 3 locked decisions (D-01/D-02/D-03) honored. All 3 plan-checker fixes (B1/B2/B3) hold. The Critical code-review finding (CR-01) and one Warning (WR-03) were explicitly fixed in commit 6a2e20e; the remaining 5 Warnings + 5 Info findings are documented as v0.2 quality-of-life improvements that do NOT block PIP-01..06 acceptance.

---

_Verified: 2026-05-29T14:45:00Z_
_Verifier: Claude (gsd-verifier)_
