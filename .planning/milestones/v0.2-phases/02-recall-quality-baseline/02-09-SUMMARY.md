---
phase: 02-recall-quality-baseline
plan: "09"
subsystem: scripts
tags:
  - con
  - observability
  - analytics-engine
dependency_graph:
  requires:
    - 02-06  # conflictPipeline D-20 analytics emitter
  provides:
    - CON-07 p99 budget observability via --conflict-pipeline-p99 mode
  affects:
    - scripts/eval-budget-summary.mjs
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
tech_stack:
  added: []
  patterns:
    - Cloudflare Analytics Engine SQL API (POST /accounts/<id>/analytics_engine/sql) — external-tool query path for writeDataPoint data
    - ClickHouse-flavored quantileTDigest aggregate for p99 estimation
    - Dual-mode CLI (nightly-summary + conflict-pipeline-p99 coexist; different HTTP clients, different endpoints)
key_files:
  created: []
  modified:
    - scripts/eval-budget-summary.mjs
    - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
decisions:
  - "D-20 layout reconciliation: plan text said blob1='conflict-pipeline', double1=latency_ms, double2=neighbors_examined. Actual shipped code (conflict-pipeline.ts writeAnalytics call) confirmed identical layout — blobs[0]='conflict-pipeline', doubles[0]=latency_ms, doubles[1]=neighbors_examined. No reconciliation delta needed; SQL query uses double1 for latency_ms and filters blob1='conflict-pipeline' exactly as specified."
  - "SQL API over GraphQL: planner pre-resolved (Context7, 2026-06-05) that the Analytics Engine SQL API (POST .../analytics_engine/sql) is the documented external-tool path for custom writeDataPoint data. Cloudflare GraphQL 'powers the dashboard' but exposes no public node for custom AE datasets. The existing nightly-summary mode's aiInferenceAdaptiveGroups GraphQL node is for auto-tracked Workers AI inference data only — a different data path. Both endpoints coexist in the same file, one per mode."
  - "Exit code 3 for insufficient data: sample_count=0 is a soft warn (exit 3), not a hard failure (exit 1). Early in the production lifecycle before any blocks are stored, zero data points are expected and should not trip CI as a budget breach."
  - "CON-07 budget threshold is a top-of-function constant CON07_BUDGET_MS=4000 (T-02-09-03 mitigation: avoids copy-paste drift)."
metrics:
  duration: "~10 minutes"
  completed: "2026-06-08"
  tasks_completed: 1
  files_modified: 2
---

# Phase 2 Plan 09: CON-07 p99 Budget Loop Summary

One-liner: `--conflict-pipeline-p99` mode added to eval-budget-summary.mjs — queries Analytics Engine SQL API for conflict-pipeline D-20 data points, computes quantileTDigest p99 latency over 24h, reports against CON-07 4s budget with 4 distinct exit codes.

## What Was Built

### Task 1 — `--conflict-pipeline-p99` mode in `eval-budget-summary.mjs`

Commit `61a62b9`

**CLI flag:** `--conflict-pipeline-p99` (new; additive alongside existing `--since` and `--help`)

**Mode dispatch:** `let mode = "nightly-summary"` default; `--conflict-pipeline-p99` sets `mode = "conflict-pipeline-p99"`. Mode check fires immediately after env validation; if mode matches, `runConflictPipelineP99Mode()` is called and the nightly-summary code path is skipped entirely.

**SQL query (verbatim from plan interfaces — pre-pinned by planner via Context7 2026-06-05):**
```sql
SELECT
  quantileTDigest(0.50)(double1) AS p50,
  quantileTDigest(0.95)(double1) AS p95,
  quantileTDigest(0.99)(double1) AS p99,
  COUNT(*) AS sample_count,
  SUM(double2) AS total_neighbors_examined
FROM engram_ai_analytics
WHERE blob1 = 'conflict-pipeline'
  AND timestamp > NOW() - INTERVAL '24' HOUR
```

**D-20 column mapping (confirmed from conflict-pipeline.ts):**

| D-20 field | AE column | SQL alias | Notes |
|-----------|-----------|-----------|-------|
| `blobs[0]` | `blob1` | filter | `= 'conflict-pipeline'` — route discriminator |
| `doubles[0]` (latency_ms) | `double1` | p50/p95/p99 | quantileTDigest aggregate target |
| `doubles[1]` (neighbors_examined) | `double2` | total_neighbors_examined | SUM for sanity check |

**HTTP call:**
- Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`
- Auth: `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}` (same token as nightly-summary)
- Content-Type: `text/plain` (body is raw SQL string, NOT a JSON object — per Cloudflare docs)
- Response shape: `{ data: [{ p50, p95, p99, sample_count, total_neighbors_examined }], ... }`; also handles older `{ result: [...] }` shape defensively.

**Exit codes:**

| Code | Condition | Meaning |
|------|-----------|---------|
| 0 | `sample_count > 0` AND `p99 < 4000` | PASS — CON-07 budget met |
| 1 | `sample_count > 0` AND `p99 >= 4000` | FAIL — CON-07 budget breach |
| 2 | HTTP non-2xx OR JSON parse error | API/network error |
| 3 | `sample_count === 0` | Insufficient data (soft warn — early production lifecycle) |

**Security controls (T-02-09-01):** On HTTP error, response body is NOT logged — only the HTTP status code is emitted to stderr. This prevents accidental echo of account-level metadata.

**Existing nightly-summary mode:** Completely unchanged. The nightly GraphQL mode (`aiInferenceAdaptiveGroups`) runs only when `mode === "nightly-summary"` (default). The two modes share env validation only; all HTTP calls are separate functions/paths.

## D-20 Schema Reconciliation

The plan text specified: `blob1='conflict-pipeline'`, `double1=latency_ms`, `double2=neighbors_examined`.

Actual `conflict-pipeline.ts` `writeAnalytics` call (line 218–222):
```typescript
writeAnalytics(env, {
  blobs: ["conflict-pipeline", verdict, wsTag, verdict === "error" ? "failed" : "ok"],
  doubles: [Date.now() - start, neighborsExamined, 0, verdict === "error" ? 1 : 0],
  indexes: [ANALYTICS_ENV_TAG],
});
```

Confirmed mapping:
- `blobs[0]` = `"conflict-pipeline"` → AE column `blob1` (plan text: correct)
- `doubles[0]` = latency_ms → AE column `double1` (plan text: correct)
- `doubles[1]` = neighbors_examined → AE column `double2` (plan text: correct)

**No reconciliation delta.** The plan text exactly matches the shipped code. The consistency note's concern (02-06 SUMMARY described blobs[1]=verdict, doubles[1]=neighbors_examined using 1-indexed notation in the summary table but 0-indexed arrays in code) was notation only — the underlying byte positions are identical.

## Deviations from Plan

None — plan executed exactly as written. The mode dispatch, SQL query, HTTP client pattern, exit codes, and routing tracker row all match the plan specification.

## CF-Code-Assist Routing

Appended row to `02-CF-CODE-ASSIST-USAGE.md`:
- **Task:** 02-09-T1
- **Q1/Q2/Q3:** N/Y/Y (single-file, >50 LOC mechanical, stable template + pre-pinned SQL)
- **Route:** claude (cf-code-assist tool surface unavailable in executor subagent)
- **Eligible:** Yes — would have been a clean `generateCode` route in a parent-orchestrator context

## Known Stubs

None. The new mode is fully implemented. No hardcoded returns, no placeholder responses.

## Threat Model Coverage

| Threat ID | Mitigation | Location |
|-----------|-----------|---------|
| T-02-09-01 | HTTP error path logs only status code, never response body | `runConflictPipelineP99Mode()` non-2xx branch |
| T-02-09-02 | One additional query per nightly cycle; well under AE SQL API rate limits | Design (accepted) |
| T-02-09-03 | `CON07_BUDGET_MS = 4000` is a named constant at top of function | `runConflictPipelineP99Mode()` line ~1 |
| T-02-09-04 | Script reads aggregated quantile data (COUNT/SUM/quantile); no individual row data exposed | SQL query shape (accepted) |

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. The AE SQL API endpoint is a read-only query against the existing `engram_ai_analytics` dataset.

## CON Workstream Status

With Plan 02-09 landing:
- **CON-01..08:** All closed. Conflict detection precision validated (CON-01), cosine prefilter (CON-02), ctx.waitUntil wiring (CON-03), inbox write (CON-04), recall conflicts hydration (CON-05), dupe-ceiling filter (CON-06), per-write budget structural cap (CON-07), no-notifications architectural lock (CON-08).
- **Observability:** `node scripts/eval-budget-summary.mjs --conflict-pipeline-p99` is now CI-ready for nightly p99 budget tracking.
- **Phase 2** is ready for `/gsd:verify-work 2`.

## Self-Check: PASSED

- `scripts/eval-budget-summary.mjs` exists: FOUND
- `--conflict-pipeline-p99` flag: CONFIRMED (grep + --help output)
- `analytics_engine/sql` endpoint: CONFIRMED
- `quantileTDigest` function: CONFIRMED
- `engram_ai_analytics` dataset: CONFIRMED
- `blob1 = 'conflict-pipeline'` filter: CONFIRMED
- `CON-07` reference: CONFIRMED
- `4000` threshold constant: CONFIRMED
- `node scripts/eval-budget-summary.mjs --help` shows new flag: CONFIRMED
- Existing nightly-summary mode unchanged: CONFIRMED (all existing code paths intact)
- Commit `61a62b9`: FOUND
- No unexpected file deletions: CONFIRMED
