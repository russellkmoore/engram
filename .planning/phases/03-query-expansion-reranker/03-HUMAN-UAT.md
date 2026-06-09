---
status: partial
phase: 03-query-expansion-reranker
source: [03-VERIFICATION.md]
started: 2026-06-08
updated: 2026-06-08
---

## Current Test

[awaiting human testing — run the three eval suites under Cloudflare credentials]

> **How to run (corrected):** there is no `test:eval` npm script in `packages/mcp-server`.
> From `packages/mcp-server`, with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exported,
> invoke the `eval` vitest project directly:
> `npx vitest run --project=eval <suite>` — one suite per invocation (each eval file gets a
> fresh MAX_AI_CALLS=200 budget; bundling multiplies the spend).

## Tests

### 1. EXP-07 — Reranker weight ablation (precision@3/F1@3, D-EXP07)
expected: `npm run test:eval -- reranker-ablation` runs in its own session (≤200 AI calls). The `[EXP-07-RESULT]` log line surfaces `gate_passed=true/false`. If the bge-reranker beats raw cosine by ≥3% F1@3, `HYBRID_WEIGHTS.rerank` stays 0.6; otherwise update it to 0.0 and append the changelog row. Currently `rerank=0.6` (unchanged, pending this run).
result: [pending — requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID]

### 2. EXP-08 / EXP-09 / EXP-12 — Query-expansion recall eval (A/B + anti-HyDE + entity preservation)
expected: `npm run test:eval -- query-expansion-recall` (own session, SEPARATE from EXP-07 per MAX_AI_CALLS=200 budget). Asserts Scout-vs-llama-3.2-3b recall@5 A/B, anti-HyDE behavioral check passes, entity-preservation rate > 0.80.
result: [pending — requires Cloudflare eval creds]

### 3. EXP-11 — Recall latency budget
expected: `npm run test:eval -- recall-latency` confirms recall p50 ≤ 1800ms and p99 ≤ 3000ms with expansion ON. If over budget, the QE-5 lever is tightening the adaptive threshold 0.65 → 0.70 (documented in the eval comments).
result: [pending — requires Cloudflare eval creds]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

None — all Phase 3 implementation is complete and unit-tested (157 tests green). These items are empirical eval runs deferred only because live Cloudflare credentials are not present in the execution session. Run them in CI or locally after `wrangler login` + exporting `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, then re-run `/gsd:verify-work 3` (or `/gsd:execute-phase 3` to re-verify) to flip the phase to passed.
