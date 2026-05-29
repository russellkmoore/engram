# Phase 5 — Production Monitoring Runbook

> Reference for wiring Workers Analytics Engine + Email Routing alerts after Phase 7 deploy.

## Dataset: `engram_ai_analytics`

Schema is defined in `packages/mcp-server/src/analytics.ts` (and the sibling `packages/triage-worker/src/analytics.ts`) per AI-SPEC.md §7 — 4 blobs / 4 doubles / 1 index. Every AI / Vectorize call across both Workers writes one row.

Slot meanings (see `analytics-queries.sql` header comment for the authoritative list):

| Slot | Purpose |
|---|---|
| `blob0` | worker (`"mcp-server"` / `"triage-worker"`) |
| `blob1` | op-kind (model ID / `vectorize-*` / `zod-parse-fail` / `do-rpc-*`) |
| `blob2` | workspace-tag — `sha256(workspace_id).slice(0, 16)` (privacy + GDPR forward-compat) |
| `blob3` | outcome (`success` / `retry-429` / `throw` / `zero-match` / `retry-5s` / `ack-permanent`) |
| `double0` | latency-ms |
| `double1` | input-length (chars) |
| `double2` | retry-count (Queues `message.attempts`) |
| `double3` | success-false-flag (1 if envelope-path 429) |
| `index0` | environment (`"engram-prod"` v0.1; `"engram-staging"` reserved) |

Workspace-tag privacy: raw `workspace_id` NEVER appears in `blobs[2]`. The sha256-prefix scheme means a single workspace shows up as the same tag forever (queryable per-tenant) while staying useless for cross-tenant correlation.

## Canonical Queries

SQL canonicalized in `packages/mcp-server/scripts/analytics-queries.sql`. Four queries:

1. **p50/p95/p99 latency by model** (last 24h) — informs the AI-SPEC.md §4b budget check
2. **429 rate per hour** (last 7 days) — informs the AI-07 retry effectiveness check
3. **Zero-match recall rate per day** (last 30 days) — informs the AI-04 + AI-02 health check
4. **Memorability-band routing distribution** (last 7 days) — informs the AI-06 calibration drift check

Run via the Cloudflare dashboard's Analytics Engine SQL editor. A v0.2 follow-up may ship a tiny `analytics-query-worker` that exposes these as REST endpoints for a Russell-facing dashboard.

## Email Routing Alert Thresholds (per AI-SPEC.md §7)

| Trigger | Threshold | Severity | Russell action |
|---|---|---|---|
| 429 rate per hour | >5% in any 1-hour window | High | Capacity issue — verify Cloudflare account neuron allocation OR investigate batch-storm bug in Triage Worker |
| Zod parse failure rate per day | >5% | Medium | Prompt regression — check if CF rotated llama-3.1-8b-instruct weights OR if SYSTEM_PROMPT was edited; re-run Promptfoo eval |
| `remember()` p50 latency per day | >430ms | Medium | Perf regression — check if extraction call was inadvertently added to remember handler (Pitfall 5); inspect VectorizeUpsert cold-start metrics |
| Vectorize zero-match recall rate per day | >10% on non-empty workspaces | High | Likely namespace mishandling OR embedding drift — re-run `embedding-consistency.test.ts`; inspect recent commits to `vectorize-helper.ts` |
| Reference-corpus F1 (weekly batch — DEFERRED to v0.2) | drops >5pp from previous week's baseline | High | Model rotation or hidden ingest regression; manual investigation |
| Reference-corpus F1 (pre-release) | <75% absolute | Critical (BLOCKS DEPLOY) | `npm run evals:ci` catches this in CI; investigate failing buckets before merge |

## Setup Instructions (post-Phase-7-deploy)

1. **Verify dataset is receiving writes:**
   ```bash
   # After 5+ remember/recall calls land in prod:
   npx wrangler analytics-engine query "SELECT count() FROM engram_ai_analytics WHERE timestamp > NOW() - INTERVAL '1' HOUR"
   ```
   Should return > 0.

2. **Wire Email Routing alert (Cloudflare dashboard):**
   - Navigate to Email Routing → `russellkmoore@mac.com` is the destination.
   - Create alert rules per the table above. Cloudflare's alert engine supports SQL-based trigger conditions on Analytics Engine datasets.
   - For the 429 rate alert: trigger when query 2 from `analytics-queries.sql` returns `rate_429 > 0.05` in the most recent hour.

3. **Smart Sampling (Logpush → R2):**
   - Cloudflare dashboard: Workers → Logpush → Add destination → R2 bucket `engram-evals-archive`.
   - Filter: `outcome IN ('zero-match', 'zod-parse-fail') OR latency > 2 * <budget>` (always-sample for concerning signals).
   - Random 5%: separate filter rule for baseline traffic stratified across memorability bands.
   - Per AI-SPEC.md §7: sampled interactions older than 90 days auto-deleted from R2.

4. **Monthly memorability calibration review** (AI-SPEC.md §6 offline flywheel — Russell's manual cadence):
   - Pull a 20-sample stratified random selection of prod blocks via Workers Analytics Engine query 4 (memorability-band distribution).
   - Score each against the 5-point rubric (AI-SPEC.md §5 dimension #5).
   - Append new labeled examples to `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` with a `discovered_in_prod_at` timestamp.
   - If band-distribution drifts outside ±10pp, trigger a Triage prompt re-tune PR (re-edit `packages/triage-worker/src/prompts.ts` `SYSTEM_PROMPT` memorability rubric — NEVER change the 0.8/0.4 thresholds; thresholds are public contract).

## Deferred (v0.2 per RESEARCH §Open Question 7)

- **`eval-cron-worker`:** standalone Worker scheduled at Sunday 06:00 UTC that re-runs `recall-f1.eval` against production-deployed code + alerts on >5pp F1 drift. Manual `npm run evals:ci` from Plan 05-06 is the v0.1 substitute; cron Worker lands in v0.2 if Russell wants the automation.
- **PagerDuty / Slack alerting:** v0.1 ships email-only. v1.0 multi-tenant SaaS revisits.
- **`include_cold: true` recall flag** (v0.2): exposes cold-storage blocks via recall.
- **Cold-storage TTL** (v0.2 or later): 90-day default per the source todo; v0.1 keeps cold blocks forever.
- **Real-corpus F1 gate** (Plan 05-06 Task 4 follow-up): currently DEFERRED with `it.skip`; gets enabled in the nightly CI eval-cron-worker or when Russell completes the manual sanitization step.

---

_Generated 2026-05-28 by Phase 5 Plan 05-07. Update after first production traffic to record real latency baselines (replace the AI-SPEC.md §4b targets with measured p50/p95/p99 from the first 7 days of prod traffic)._
