---
phase: 3
slug: query-expansion-reranker
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
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

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| EXP-01 | `expandQuery` returns `[original, p1, p2]`, original at [0], zod-gated | unit | `npx vitest run query-expansion` | ❌ W0 | ⬜ pending |
| EXP-02 | paraphrase dropped if cosine(orig,p) < 0.85 | unit (mock embeds) | `npx vitest run query-expansion` | ❌ W0 | ⬜ pending |
| EXP-03 | fan-out only fires when top1_cosine < 0.65 | unit (handler branch) | `npx vitest run recall` | ❌ W0 | ⬜ pending |
| EXP-04 | `reciprocalRankFusion` matches Elasticsearch/AI21 reference vectors | unit (pure) | `npx vitest run rrf` | ❌ W0 | ⬜ pending |
| EXP-05 | `RERANKER_MODEL` constant present; `HYBRID_WEIGHTS.rerank` exists | unit | `npx vitest run ai-config` | rename ✅ / const ❌ | ⬜ pending |
| EXP-06 | reranker score replaces cosine; 429/error → raw-cosine fallback | unit (mock safeRun throw) | `npx vitest run recall` | ❌ W0 | ⬜ pending |
| EXP-07 | reranker beats cosine by ≥3% **precision@3/F1@3** on labeled corpus, else weight=0.0 | eval (creds) | `npm run test:eval -- reranker-ablation` | ❌ W0 (clone recall-ranking.eval) | ⬜ pending |
| EXP-08 | Scout vs llama-3.2-3b recall@5 A/B | eval (creds) | `npm run test:eval -- query-expansion-recall` | ❌ W0 | ⬜ pending |
| EXP-09 | variants contain no HyDE/fabricated-answer content | eval assertion | `npm run test:eval -- query-expansion-recall` | ❌ W0 | ⬜ pending |
| EXP-10 | persistent 429 → single-query path + meta.gaps note | unit (mock RateLimitError) | `npx vitest run recall` | ❌ W0 | ⬜ pending |
| EXP-11 | recall p50 ≤ 1.8s, p99 ≤ 3s with expansion ON | eval/latency (creds) | `npm run test:eval -- recall-latency` | ❌ W0 | ⬜ pending |
| EXP-12 | >80% named entities preserved in ≥1 variant | eval assertion | `npm run test:eval -- query-expansion-recall` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/rrf.ts` + `__tests__/rrf.test.ts` — EXP-04 (pure, reference-vector fixtures from Elasticsearch/AI21)
- [ ] `src/query-expansion.ts` + `__tests__/query-expansion.test.ts` — EXP-01/02/09 (zod gate, original-as-variant[0] anchor, anti-HyDE)
- [ ] `__tests__/evals/reranker-ablation.eval.test.ts` — EXP-07 (clone `recall-ranking.eval.test.ts` pre-resolve-once + budget pattern; precision@3/F1@3 metric)
- [ ] `__tests__/evals/query-expansion-recall.eval.test.ts` — EXP-08/09/12 (A/B + anti-HyDE + entity-preservation assertions)
- [ ] latency harness for EXP-11 (reuse `scripts/eval-budget-summary.mjs --*-p99` pattern from CON-07)
- [ ] `RERANKER_MODEL` constant + `hybrid-rank.ts` rerank-source edit (no new framework install — vitest already present)

*`HYBRID_WEIGHTS.cosine → rerank` rename already landed in Phase 2 (D-05); EXP-05 only adds the constant.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Workers AI bge-reranker latency under live load | EXP-11 | Live-creds timing varies; automated eval captures p50/p99 but production confirmation is manual | Run `npm run test:eval -- recall-latency` against deployed Worker, inspect Analytics Engine `recall` latency blob |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit subset)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
