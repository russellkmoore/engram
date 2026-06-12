---
phase: 3
slug: query-expansion-reranker
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-08
validated: 2026-06-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture. Metric note: EXP-07
> gate uses **precision@3 / F1@3** (D-EXP07 decision) — the corpus is labeled with
> `expected_top_3_block_ids`, so precision@5 caps at 0.6; reuse the Phase 2 harness metric.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1+ with `@cloudflare/vitest-pool-workers` (workerd pool) + Node pool for lint/grep |
| **Config file** | `packages/mcp-server/vitest.config.ts` (projects: `workerd`, `lint-node`, `eval`) |
| **Quick run command** | `cd packages/mcp-server && npx vitest run rrf query-expansion recall` |
| **Full suite command** | `cd packages/mcp-server && npm test` (workerd + lint-node) |
| **Estimated runtime** | ~30 seconds (unit subset); evals separate, creds-gated |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run rrf query-expansion recall` (pure unit subset — fast, no creds)
- **After every plan wave:** Run `cd packages/mcp-server && npm test` (full workerd + lint-node)
- **Before `/gsd:verify-work`:** Eval suite green under creds (`npm run test:eval`); run **EXP-07 and EXP-08 in separate vitest sessions** (MAX_AI_CALLS=200 budget cannot hold two ~100-query pre-resolves)
- **Max feedback latency:** ~30 seconds (unit); evals are out-of-band

---

## Per-Task Verification Map

> **Reconciled 2026-06-12 (as-built).** Unit subset re-run green this session
> (`rrf query-expansion recall` → 4 files, 32 tests). Eval-gated rows rely on the
> recorded live results in `03-VERIFICATION.md` (2026-06-08 Cloudflare run).

| Req ID | Behavior | Test Type | Automated Command | File / Evidence | Status |
|--------|----------|-----------|-------------------|-----------------|--------|
| EXP-01 | `expandQuery` returns `[original, p1, p2]`, original at [0], zod-gated | unit | `npx vitest run query-expansion` | `query-expansion.test.ts` | ✅ green (2026-06-12) |
| EXP-02 | paraphrase dropped if cosine(orig,p) < 0.85 | unit (mock embeds) | `npx vitest run query-expansion` | `query-expansion.test.ts` | ✅ green (2026-06-12) |
| EXP-03 | fan-out only fires when top1_cosine < 0.65 | unit (handler branch) | `npx vitest run recall` | `recall.test.ts:210` | ✅ green (2026-06-12) |
| EXP-04 | `reciprocalRankFusion` matches Elasticsearch/AI21 reference vectors | unit (pure) | `npx vitest run rrf` | `rrf.test.ts` | ✅ green (2026-06-12) |
| EXP-05 | `RERANKER_MODEL` constant present; `HYBRID_WEIGHTS.rerank` exists | unit | `npx vitest run recall hybrid-rank` | `ai-config/index.ts:74`; `recall.test.ts` + `hybrid-rank.test.ts` | ✅ green (2026-06-12) |
| EXP-06 | reranker score replaces cosine; 429/error → raw-cosine fallback | unit (mock safeRun throw) | `npx vitest run recall` | `recall.test.ts` (RERANKER_ENABLED flag) | ✅ green (2026-06-12) |
| EXP-07 | reranker beats cosine by ≥3% precision@3/F1@3, else weight=0.0 | eval (creds) | `npm run test:eval -- reranker-ablation` | `reranker-ablation.eval.test.ts`; VERIFICATION: gate FAILED (F1 0.2611 vs 0.4556) → `RERANKER_ENABLED=false` (correct per spec) | ✅ green (VERIFICATION; disabled-by-design) |
| EXP-08 | Scout vs llama-3.2-3b recall@5 A/B | eval (creds) | `npm run test:eval -- query-expansion-recall` | VERIFICATION: PASSED (within gate, EVAL_QUERY_CAP 12) | ✅ green (VERIFICATION) |
| EXP-09 | variants contain no HyDE/fabricated-answer content | unit + eval assertion | `npx vitest run query-expansion` + eval | `query-expansion.test.ts`; VERIFICATION: 0 anti-HyDE failures | ✅ green (2026-06-12 + VERIFICATION) |
| EXP-10 | persistent 429 → single-query path + meta.gaps note | unit (mock RateLimitError) | `npx vitest run recall` | `recall.test.ts:337` | ✅ green (2026-06-12) |
| EXP-11 | recall p50 ≤ 1.8s, p99 ≤ 3s with expansion ON | eval/latency (creds) | `npm run test:eval -- recall-latency` | `recall-latency.eval.test.ts`; VERIFICATION: local smoke passed; **production SLA deploy-gated** | ✅ local green; prod SLA deploy-gated |
| EXP-12 | >80% named entities preserved in ≥1 variant | eval assertion | `npm run test:eval -- query-expansion-recall` | VERIFICATION: entityPreservation >0.80 PASSED | ✅ green (VERIFICATION) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note:** EXP-07's reranker ablation gate intentionally **failed** (bge-reranker F1@3 worse than raw cosine) — the requirement specifies shipping `RERANKER_ENABLED=false` / weight=0.0 in that case, which is what landed. This is a passing requirement via a correctly-handled negative result, not a gap. EXP-11's production p50/p99 SLA is deploy-gated telemetry (Manual-Only below).

---

## Wave 0 Requirements

- [x] `src/rrf.ts` + `__tests__/rrf.test.ts` — EXP-04 (pure, reference-vector fixtures from Elasticsearch/AI21)
- [x] `src/query-expansion.ts` + `__tests__/query-expansion.test.ts` — EXP-01/02/09 (zod gate, original-as-variant[0] anchor, anti-HyDE)
- [x] `__tests__/evals/reranker-ablation.eval.test.ts` — EXP-07 (precision@3/F1@3 metric; gate failed → reranker disabled)
- [x] `__tests__/evals/query-expansion-recall.eval.test.ts` — EXP-08/09/12 (A/B + anti-HyDE + entity-preservation assertions)
- [x] latency harness for EXP-11 (`recall-latency.eval.test.ts` + `eval-budget-summary.mjs --*-p99` pattern)
- [x] `RERANKER_MODEL` constant + `hybrid-rank.ts` rerank-source edit (no new framework install — vitest already present)

*`HYBRID_WEIGHTS.cosine → rerank` rename already landed in Phase 2 (D-05); EXP-05 only adds the constant.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Workers AI bge-reranker latency under live load | EXP-11 | Live-creds timing varies; automated eval captures p50/p99 but production confirmation is manual | Run `npm run test:eval -- recall-latency` against deployed Worker, inspect Analytics Engine `recall` latency blob |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (unit subset)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-12 (`/gsd:validate-phase 3`)

---

## Validation Audit 2026-06-12

| Metric | Count |
|--------|-------|
| Requirements audited | 12 (EXP-01..12) |
| Automated (COVERED) | 12 |
| Manual-only (justified) | 0 (EXP-11 prod SLA is deploy-gated, automated locally) |
| Gaps found (MISSING) | 0 |
| Resolved this session | 0 (no fixable gaps) |
| Escalated | 0 |

**Outcome:** Phase 3 is NYQUIST-COMPLIANT. The prior `draft` state reflected an unreconciled scaffold (all rows `❌ W0`). Unit subset re-run green this session (`rrf query-expansion recall` → 4 files / 32 tests), covering EXP-01..06, EXP-09, EXP-10. Eval-gated rows (EXP-07/08/12 + EXP-09/11 eval halves) rely on the recorded 2026-06-08 live Cloudflare results in `03-VERIFICATION.md`. EXP-07's reranker gate intentionally failed → `RERANKER_ENABLED=false` (passing-by-design negative result). EXP-11's production p50/p99 SLA is deploy-gated telemetry. No test files generated — none were missing.
