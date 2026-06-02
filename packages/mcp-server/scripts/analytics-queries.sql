-- analytics-queries.sql — canonical SQL for the engram_ai_analytics dataset.
-- Run via the Cloudflare dashboard's Analytics Engine SQL editor OR a tiny
-- analytics-query-worker (v0.2 if Russell wants automation).
--
-- Dataset schema (per AI-SPEC.md §7, ratified by Plan 05-07 analytics.ts):
--   blobs[0]  = worker         ("mcp-server" | "triage-worker")
--   blobs[1]  = op-kind        (EMBEDDING_MODEL | INGESTION_CLASSIFIER_MODEL
--                              | "vectorize-query" | "vectorize-upsert" | "vectorize-delete"
--                              | "zod-parse-fail" | "do-rpc-store-normal" | "do-rpc-inbox"
--                              | "do-rpc-cold-storage")
--                              See `shared/ai-config/src/index.ts` for the
--                              current EMBEDDING_MODEL / INGESTION_CLASSIFIER_MODEL
--                              values; analytics queries should join against
--                              whichever is current, not hardcode literal IDs.
--   blobs[2]  = workspace-tag  (sha256(workspace_id)[:16] — never raw IDs)
--   blobs[3]  = outcome        ("success" | "retry-429" | "throw" | "zero-match"
--                              | "retry-5s" | "ack-permanent")
--   doubles[0] = latency-ms
--   doubles[1] = input-length (chars; for embed/AI calls)
--   doubles[2] = retry-count  (Queues message.attempts)
--   doubles[3] = success-false-flag (1 if envelope 429 path, else 0)
--   indexes[0] = environment  ("engram-prod" | future "engram-staging")

-- ============================================================================
-- Query 1: p50/p95/p99 latency by model, last 24h
-- AI-SPEC.md §7 dimension #1 + #2: latency budgets
--   embed EMBEDDING_MODEL       → ≤ 150ms p50 target (current: qwen3-embedding-0.6b per ENG-25)
--   classifier INGESTION_CLASSIFIER_MODEL → 1.5-4s p50 (Triage); 2-5s p50 (synthesis)
--                              (current: llama-4-scout-17b-16e-instruct per ENG-25)
-- ============================================================================
SELECT
  blob1 AS model,
  quantileWeighted(0.50, double1, _sample_interval) AS p50_ms,
  quantileWeighted(0.95, double1, _sample_interval) AS p95_ms,
  quantileWeighted(0.99, double1, _sample_interval) AS p99_ms,
  count() AS n
FROM engram_ai_analytics
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY model;

-- ============================================================================
-- Query 2: 429 rate per hour, last 7 days
-- AI-SPEC.md §7 alert threshold: >5% of any 1-hour window → email alert
-- ============================================================================
SELECT
  toStartOfHour(timestamp) AS hour,
  sum(double3) / count() AS rate_429,    -- double3 = 1 if success:false (429 envelope path)
  count() AS n
FROM engram_ai_analytics
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 LIKE '@cf/%'                 -- only Workers AI calls, not Vectorize
GROUP BY hour
ORDER BY hour;

-- ============================================================================
-- Query 3: Zero-match recall rate per day, last 30 days
-- AI-SPEC.md §7 alert threshold: >10% on non-empty workspaces → high-severity
-- (indicates either embedding drift OR namespace mishandling — both critical
-- failure modes per AI-SPEC.md §1).
-- ============================================================================
SELECT
  toDate(timestamp) AS day,
  sum(if(blob3 = 'zero-match', 1, 0)) / count() AS zero_match_rate,
  count() AS n
FROM engram_ai_analytics
WHERE timestamp > NOW() - INTERVAL '30' DAY
  AND blob1 = 'vectorize-query'
GROUP BY day;

-- ============================================================================
-- Bonus query: Memorability-band routing distribution per workspace per day
-- (informs the AI-06 calibration eval — if the prod distribution drifts
-- outside the 60/30/10 ±10pp band, trigger a Triage prompt re-tune.)
-- ============================================================================
SELECT
  toDate(timestamp) AS day,
  blob2 AS workspace_tag,
  countIf(blob1 = 'do-rpc-store-normal') AS store_normal,
  countIf(blob1 = 'do-rpc-inbox')        AS inbox,
  countIf(blob1 = 'do-rpc-cold-storage') AS cold_storage,
  count() AS total
FROM engram_ai_analytics
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob0 = 'triage-worker'
  AND blob1 LIKE 'do-rpc-%'
GROUP BY day, workspace_tag
ORDER BY day, workspace_tag;
