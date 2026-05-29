---
phase: 05-ai-integration
plan: "07"
subsystem: monitoring
tags:
  - wave-5
  - analytics
  - workers-analytics-engine
  - production-monitoring
  - sql
  - runbook
  - ai-04
  - ai-05
  - ai-07

dependency_graph:
  requires:
    - 05-01 (wrangler ANALYTICS binding declarations — added at scaffolding time)
    - 05-03 (remember instrumentation surface: tools.ts remember handler)
    - 05-04 (extract.ts dual-path 429 + Zod gate sites — instrumented here)
    - 05-05 (recall semantic pipeline — embed/vectorize/synthesis instrumentation surfaces)
  provides:
    - packages/mcp-server/src/analytics.ts (writeAnalytics + workspaceTag — sha256-prefix privacy)
    - packages/triage-worker/src/analytics.ts (sibling, byte-identical pattern to mcp-server)
    - 6 writeAnalytics call sites in mcp-server/src/tools.ts (remember/recall/forget, including zero-match outcome)
    - 6 writeAnalytics call sites in triage-worker (4 in extract.ts: success/retry-429-thrown/retry-429-envelope/zod-retry/zod-permanent/throw; 1 in index.ts per DO RPC decision)
    - Memoized workspaceTag per-message in queue() handler (single sha256 call per message)
    - packages/mcp-server/scripts/analytics-queries.sql (4 canonical Workers Analytics Engine queries)
    - .planning/phases/05-ai-integration/05-MONITORING-NOTES.md (operational runbook for post-deploy)

verification:
  green:
    - "Task 1 — writeAnalytics + workspaceTag non-blocking wrappers in BOTH mcp-server and triage-worker; sibling pattern follows ai-helper.ts precedent (Plan 05-04)"
    - "Task 2 — mcp-server tools.ts instrumented: remember (success/throw), recall (success/zero-match/throw), forget (success/throw); zero-match outcome surfaces the AI-04 + AI-02 health signal"
    - "Task 3 — triage-worker extract.ts + index.ts instrumented: 4 extract outcomes + 1 DO-RPC datapoint per message (do-rpc-store-normal / do-rpc-inbox / do-rpc-cold-storage); workspaceTag memoized per-message"
    - "Task 4 — analytics-queries.sql (4 canonical queries) + 05-MONITORING-NOTES.md (alert thresholds + setup runbook + v0.2 deferral list)"
    - "Tests still GREEN: mcp-server 128 passed + 5 skipped; triage-worker 4 passed + 1 skipped"
  deferred:
    - "Workers Analytics Engine binding (ANALYTICS) is OPTIONAL in v0.1 — writeAnalytics no-ops if env.ANALYTICS undefined (dev mode, vitest). Phase 7 deploy wires the real binding in wrangler.jsonc."
    - "Email Routing alert rules wiring (Cloudflare dashboard work — post-Phase-7)"
    - "Logpush → R2 smart-sampling rule (Cloudflare dashboard work — post-Phase-7)"
    - "eval-cron-worker (v0.2)"

requirements_closed:
  - AI-01: closed — Vectorize index provisioned by setup script (Plan 05-02); embedding-consistency eval confirms model+version identity across packages
  - AI-02: closed — vectorize-helper.ts enforces mandatory workspaceId namespace; lint gate enforces helper-only access
  - AI-03: closed — remember() syncs embed + stampEmbedding + upsert under namespace
  - AI-04: code path closed; **eval gate ENFORCED but DEFERRED** — synthetic-corpus F1 ≥ 0.75 gate is wired; real-corpus carry-forward gate (Plan 05-06 Task 4 follow-up) is DEFERRED to a focused Russell session
  - AI-05: code path closed; Promptfoo JSON-parse-rate ≥ 95% gate ENFORCED but DEFERRED to nightly CI (requires CLOUDFLARE_API_TOKEN)
  - AI-06: code path closed; memorability calibration ±10pp band gate ENFORCED but DEFERRED to nightly CI (requires real llama-3.1-8b-instruct bindings)
  - AI-07: closed — dual-path 429 retry policy live in extract.ts + remember()/recall(); writeAnalytics datapoints capture 429 rate for the AI-SPEC §7 alert threshold
  - AI-08: closed — forget() Vectorize-first cascade prevents ghost recall; round-trip test asserts the contract

---

# Plan 05-07 Summary — Wave 5: Production Monitoring + Synthesis Handoff

> **Status: 4 of 4 tasks complete. Plan 05-07 ships writeAnalytics infrastructure + 12 instrumented call sites across mcp-server and triage-worker + 4 canonical SQL queries + the post-Phase-7 operational runbook.**

## What Shipped

### Task 1 — writeAnalytics non-blocking wrappers (commit `00b01d8`)
Sibling pattern, following the `ai-helper.ts` precedent from Plan 05-04:

- `packages/mcp-server/src/analytics.ts` — exports `writeAnalytics(env, datapoint)` + `workspaceTag(workspace_id)`. `writeAnalytics` wraps `env.ANALYTICS.writeDataPoint` in a try/catch and NO-OPS silently when `env.ANALYTICS === undefined` (dev mode, vitest without `remote: true`). Per AI-SPEC.md §7 non-blocking constraint: failure to write MUST NOT degrade the hot-path operation.
- `packages/triage-worker/src/analytics.ts` — byte-identical sibling. The two files are independent because triage-worker and mcp-server are independent Workers with no shared package dependency.
- `workspaceTag` returns `sha256(workspace_id).slice(0, 16)` — privacy + Section 1b regulatory forward-compat. Raw `workspace_id` NEVER appears in `blobs[2]`.

### Task 2 — mcp-server call-site instrumentation (commit `3160dcc`)
6 writeAnalytics call sites in `packages/mcp-server/src/tools.ts`:
- `remember()` — success outcome (latency, content length) + throw outcome
- `recall()` — success outcome (latency, query length); **zero-match outcome** when Vectorize returns 0 matches OR hybridRank returns empty (AI-04 + AI-02 health signal); throw outcome
- `forget()` — success outcome + throw outcome

The zero-match outcome is a new contract surface that feeds Query 3 from `analytics-queries.sql` (Zero-match recall rate per day — alert at >10%).

### Task 3 — triage-worker call-site instrumentation (commit `d9954e4`)
4 writeAnalytics call sites in `packages/triage-worker/src/extract.ts`:
- AI call success (model returned + Zod parsed OK)
- AI call retry-429 (dual-path: thrown error path + envelope `success:false` path)
- AI call throw (non-429 error bubbles to Queues runtime)
- Zod parse fail — `retry-5s` (attempts<2) or `ack-permanent` (attempts>=2) — PIP-05 DLQ-equivalent

1 writeAnalytics call site in `packages/triage-worker/src/index.ts` queue consumer:
- After the DO RPC switch, write one datapoint per message tagged by decision (`do-rpc-store-normal` / `do-rpc-inbox` / `do-rpc-cold-storage`). Feeds bonus Query 4 from `analytics-queries.sql` (Memorability-band routing distribution).

Memoized `workspaceTag` per-message inside the `queue()` handler — SHA-256 is called ONCE per message and passed through to `extractAndScore` via a new optional `wsTag` parameter. Tests use the default `"test-ws"` sentinel.

### Task 4 — SQL queries + operational runbook (commit `a5268b9`)
- `packages/mcp-server/scripts/analytics-queries.sql` — 4 canonical queries against the `engram_ai_analytics` dataset:
  1. p50/p95/p99 latency by model (last 24h) — AI-SPEC §4b budget check
  2. 429 rate per hour (last 7d) — AI-07 retry effectiveness check (alert at >5%)
  3. Zero-match recall rate per day (last 30d) — AI-04 + AI-02 health check (alert at >10%)
  4. Memorability-band routing distribution per workspace per day (bonus — AI-06 calibration drift)
- `.planning/phases/05-ai-integration/05-MONITORING-NOTES.md` — Russell's post-deploy runbook:
  - Dataset slot semantics (4 blobs / 4 doubles / 1 index)
  - 6 Email Routing alert thresholds with severity + Russell-action descriptions
  - Setup instructions (dataset verification, alert wiring, Logpush smart sampling, monthly memorability calibration review)
  - Deferred-to-v0.2 list (eval-cron-worker, PagerDuty/Slack, include_cold flag, cold-storage TTL, real-corpus F1 gate automation)

## Final Phase 5 Requirements Closure

| Req | Status | Notes |
|---|---|---|
| AI-01 | CLOSED | Vectorize index provisioned (Plan 05-02 setup script); embedding-consistency eval confirms model+version identity (Plan 05-06 Task 3) |
| AI-02 | CLOSED | vectorize-helper namespace mandate + lint-gate test; Prong C round-trip via stateful mock |
| AI-03 | CLOSED | remember() syncs embed + stampEmbedding + upsert |
| AI-04 | CLOSED (code path); DEFERRED (real-corpus gate) | Synthetic-corpus F1 ≥ 0.75 gate ENFORCED; real-corpus carry-forward gate awaits Russell's Task 4 follow-up |
| AI-05 | CLOSED (code path); DEFERRED (Promptfoo gate) | Triage AI internals + Zod gate live; Promptfoo ≥95% JSON parse rate gate awaits nightly CI |
| AI-06 | CLOSED (code path); DEFERRED (calibration gate) | routeByMemorability + cold-storage cardinal-sin; ±10pp band check awaits nightly CI |
| AI-07 | CLOSED | Dual-path 429 retry live; writeAnalytics captures rate for alert |
| AI-08 | CLOSED | forget() Vectorize-first cascade; round-trip GREEN |

## Files Modified (this plan)
- `packages/mcp-server/src/analytics.ts` (NEW)
- `packages/mcp-server/src/tools.ts` (6 writeAnalytics call sites + zero-match outcome path)
- `packages/triage-worker/src/analytics.ts` (NEW)
- `packages/triage-worker/src/extract.ts` (4 writeAnalytics call sites + wsTag parameter)
- `packages/triage-worker/src/index.ts` (1 writeAnalytics call site per message + workspaceTag memoization)
- `packages/mcp-server/scripts/analytics-queries.sql` (NEW)
- `.planning/phases/05-ai-integration/05-MONITORING-NOTES.md` (NEW)

## Routing Tracker

Rows `05-07-T1` through `05-07-T4` recorded in `05-CF-CODE-ASSIST-USAGE.md`. All routed to Claude — T1 due to cross-file consistency (sibling pattern across two packages requires byte-identical schema); T2/T3 cross-cutting handler instrumentation; T4 cross-document synthesis (SQL slot meanings must cite analytics.ts schema verbatim). cf-code-assist routing rules show T1 as the strongest candidate (~3,000 tokens forgone) but MCP was unavailable.

## Incident Notes
This plan was initially dispatched as a subagent (`worktree-agent-ab9b632c2af6c6ac4`) which landed Tasks 1 and 2 before hitting an `API Error: socket connection was closed unexpectedly` mid-flight. The orchestrator inherited the 2 commits via fast-forward merge, then completed Tasks 3 and 4 inline. This is the second subagent API error in Phase 5 (Plan 05-05 had a similar `ConnectionRefused`); the inline completion pattern is now well-rehearsed and the recovery cost was small (~10 min orchestrator inline work per task).

## Hand-Off to Phase 6 + Phase 7

**Phase 6 (Async Pipeline) inherits:**
- `MemoryEvent` type — producer for `env.INGEST_QUEUE.send(...)` lands here (Plan 06 / PIP-02)
- Queue consumer body (`triage-worker/src/index.ts`) is wired only at PIP-01 (binding declaration in wrangler.jsonc)
- writeAnalytics datapoints will start flowing once the queue is wired

**Phase 7 (Deploy + Acceptance) inherits:**
- `predeploy` hook → `npm run evals:ci` BLOCKS deploy if F1 / Promptfoo / memorability gates fail
- ANALYTICS binding must be declared in production `wrangler.jsonc` for both mcp-server and triage-worker (declared as optional in v0.1; binding wiring is Phase 7 work)
- `05-MONITORING-NOTES.md` setup instructions execute post-deploy

**Phase 5 Task 4 + Task 5.1 follow-up (separate session):**
- Russell sanitizes 10–20 real-corpus samples → `real-corpus.json`
- Run F1 against real corpus → `05-REAL-CORPUS-RESULTS.md`
- Hybrid-rank weight tuning A/B → persist tuned weights in `hybrid-rank.ts` (or retain with no-improvement audit comment)
- Tick AI-04 closed in REQUIREMENTS.md iff F1 ≥ 0.75
