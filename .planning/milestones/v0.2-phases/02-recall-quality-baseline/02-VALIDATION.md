---
phase: 02
slug: recall-quality-baseline
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-05
validated: 2026-06-12
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `02-RESEARCH.md` §"Validation Architecture" (lines 1065–1115).
> Reconciled 2026-06-12 by `/gsd:validate-phase 2` — placeholder Per-Task Map replaced
> with the as-built requirement→test map. No MISSING gaps: 13/15 requirements automated,
> RNK-05 + RNK-07 are documented Manual-Only (optional grep gates intentionally not built).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest` + `@cloudflare/vitest-pool-workers` (Phase 1 PRE-02 locked) |
| **Config file** | `packages/mcp-server/vitest.config.ts` (multi-project: `workerd` / `lint-node` / `eval`); `packages/triage-worker/vitest.config.ts` analog |
| **Quick run command** | `cd packages/mcp-server && npm test -- --project=workerd <test-pattern>` |
| **Full eval suite** | `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npm test -- --project=eval` (per package) |
| **Estimated runtime** | unit/integration ~30s per package; eval tier ~3–5 min per invocation |
| **Eval budget enforcement** | `eval-budget.setup.ts` — `MAX_AI_CALLS=200` (immutable per PRE-02 contract) |
| **Eval credential gate** | `hasEvalCreds()` — eval project excluded entirely when CLOUDFLARE_API_TOKEN/ACCOUNT_ID absent |

---

## Sampling Rate

- **After every task commit:** `npm test -- --project=workerd` in the affected package (unit + integration; ~30s)
- **After every plan wave:** All `workerd` + `lint-node` tiers across mcp-server, workspace-do, triage-worker (~2 min)
- **Before `/gsd:verify-work`:** Full eval-tier suite must be green. **CRITICAL:** RNK-01 (recall-ranking) and CON-01 (conflict-precision) eval runs MUST be invoked as **separate eval sessions**. Combined they consume ~230 AI calls vs the 200-call budget cap; the planner must serialize them.
- **Max feedback latency:** unit/integration ≤30s; eval tier ≤5 min per session

---

## Per-Task Verification Map

> Populated by the planner as plans land. Each task row pairs to a specific PLAN.md task block.

> **Reconciled 2026-06-12 (as-built).** No-creds behavior tests re-run green this session
> (triage-worker 28/28, mcp-server recall-conflicts + no-proactive 5/5). Eval-gated rows
> (RNK sweep, CON-01 precision) rely on the recorded green results in `02-VERIFICATION.md`.

| Req | Behavior | Test Type | Automated Command | File / Evidence | Status |
|-----|----------|-----------|-------------------|-----------------|--------|
| RNK-01 | 625-config weight sweep over labeled corpus | eval (creds-gated) | `npx vitest run -- recall-ranking.eval.test.ts --project=eval` | `recall-ranking.eval.test.ts`; VERIFICATION: sweep winner F1=0.4476 | ✅ green (VERIFICATION) |
| RNK-02 | Pareto front (F1, MRR, top-1) | eval (within RNK-01) | (same) | same file; 84 distinct F1 values across 2500 configs | ✅ green (VERIFICATION) |
| RNK-03 | Train→validate F1 gap < 10pp | eval (within RNK-01) | (same) | gap=0.0143 < 0.10 (D-34-RESULT) | ✅ green (VERIFICATION) |
| RNK-04 | Sensitivity top-1 flip rate < 30% | eval (within RNK-01) | (same) | flip_rate=0.0268 < 0.30 | ✅ green (VERIFICATION) |
| RNK-05 | `HYBRID_WEIGHTS` audit comment matches D-06 contract | manual (optional grep gate not built) | visual inspection of `shared/ai-config/src/index.ts` | optional `ai-config-audit.test.ts` intentionally not built | ⬜ manual-only |
| RNK-06 | F1 ≥ baseline (D-34 recalibrated: winner beats cosine-only by ≥0.02) | eval (creds-gated) | `npx vitest run -- recall-f1.eval.test.ts recall-ranking.eval.test.ts --project=eval` | improvement_delta=+0.1095; `recall-f1.eval.test.ts` = absolute 0.8254 prod guard | ✅ green (VERIFICATION; D-34) |
| RNK-07 | `docs/hybrid-rank-changelog.md` first row (D-21 schema) | manual (optional schema test not built) | open file post-merge; verify 13 columns | `docs/hybrid-rank-changelog.md` exists | ⬜ manual-only |
| CON-01 | 30-pair eval: precision ≥ 0.85, recall ≥ 0.90 | eval (creds-gated) | `cd packages/triage-worker && npx vitest run -- conflict-precision.eval.test.ts --project=eval` | `conflict-precision.eval.test.ts`; VERIFICATION: P/R held | ✅ green (VERIFICATION) |
| CON-02 | conflict-pipeline orchestration (cosine prefilter → bounded-parallel detectConflict → inbox) | integration | `npm test --workspace=packages/triage-worker -- --run --project=workerd` | `conflict-pipeline.test.ts` | ✅ green (2026-06-12) |
| CON-03 | `ctx.waitUntil(conflictPipeline(...))` fires once from store-normal branch | integration | (same triage-worker workerd run) | `queue-integration.test.ts` (waitUntil assertion @ line ~747) | ✅ green (2026-06-12) |
| CON-04 | Inbox-write shape (`proposed_type='conflict'`, properties JSON round-trip) | unit/integration | (same triage-worker run) + `helpers.test.ts` | `conflict-pipeline.test.ts` + `workspace-do/.../helpers.test.ts` | ✅ green (2026-06-12) |
| CON-05 | Recall envelope `context.conflicts[]` via SQL join on `inbox` | integration | `npm test --workspace=packages/mcp-server -- --run recall-conflicts` | `recall-conflicts.test.ts` | ✅ green (2026-06-12) |
| CON-06 | Cosine ≥ 0.92 dupe skip; 180d age → severity="low" | unit (within CON-02/05) | (within CON-02 + CON-05 runs) | covered in `conflict-pipeline.test.ts` | ✅ green (2026-06-12) |
| CON-07 | Per-write budget = 3 (topK cap); async branch p99 < 4s | integration (cap) + telemetry (p99) | cap asserted in `conflict-pipeline.test.ts:199,314`; p99 via `eval-budget-summary.mjs --conflict-pipeline-p99` | cap green this session; **p99 deploy-gated** (Analytics Engine) | ✅ cap green; p99 deploy-gated |
| CON-08 | No proactive notifications anywhere (architectural grep gate) | lint-node | `npm test --workspace=packages/mcp-server -- --run no-proactive` | `no-proactive-notifications.test.ts` | ✅ green (2026-06-12) |

*Status: ⬜ manual-only · ✅ green · ✗ red · ⚠ flaky*

**Note:** CON-07's per-write budget cap (topK=3) is asserted and green; the async-branch p99<4s SLA is deploy-gated telemetry (same posture as v0.2 EXP-11) — confirm via Analytics Engine once deployed.

### Phase-Requirement → Test-File Map (planner inputs)

Sourced from `02-RESEARCH.md` §"Phase Requirements → Test Map":

| Req ID | Behavior | Test Type | Automated Command | File Status |
|---|---|---|---|---|
| RNK-01 | 625-config sweep | eval | `npx vitest run -- recall-ranking.eval.test.ts --project=eval` | ✗ new |
| RNK-02 | Pareto front (F1, MRR, top-1) | eval (within RNK-01) | (same) | ✗ new |
| RNK-03 | Train→validate gap < 10pp | eval (within RNK-01) | (same) | ✗ new |
| RNK-04 | Sensitivity rank-flip rate < 30% (top-1 flip metric — researcher recommendation) | eval (within RNK-01) | (same) | ✗ new |
| RNK-05 | Audit comment written + weights committed | unit (grep test) | `npm test -- --project=workerd ai-config-audit.test.ts` | ✗ new (optional grep gate) |
| RNK-06 | F1 ≥ 0.8254 on BOTH 100-entry AND 27-entry corpora (D-15 dual gate) | eval | `npx vitest run -- recall-f1.eval.test.ts recall-ranking.eval.test.ts --project=eval` | ✓ recall-f1 exists; ✗ recall-ranking new |
| RNK-07 | `docs/hybrid-rank-changelog.md` first row | unit (file-exists + schema check) | `npm test -- --project=lint-node changelog-schema.test.ts` | ✗ new (optional) |
| CON-01 | 30-pair eval: P ≥ 0.85, R ≥ 0.90 | eval | `cd packages/triage-worker && npx vitest run -- conflict-precision.eval.test.ts --project=eval` | ✓ exists (`.skip`'d) — Plan unskips + raises thresholds |
| CON-02 | conflict-pipeline orchestration | integration | `cd packages/triage-worker && npm test -- --project=workerd conflict-pipeline.test.ts` | ✗ new |
| CON-03 | `ctx.waitUntil(conflictPipeline(...))` insertion in store-normal | integration | `cd packages/triage-worker && npm test -- --project=workerd triage-store-normal.test.ts` | ✗ new (or extend existing) |
| CON-04 | Inbox-write shape (`proposed_type='conflict'`, properties JSON round-trip) | unit | `cd packages/workspace-do && npm test -- queries.test.ts` | ✓ extend existing |
| CON-05 | Recall envelope `context.conflicts[]` populated via SQL join on `inbox` | integration | `cd packages/mcp-server && npm test -- --project=workerd recall-conflicts.test.ts` | ✗ new |
| CON-06 | Cosine ≥ 0.92 dupe skip; 180d age → severity="low" | unit (covered in CON-02 + CON-05 tests) | (within CON-02 + CON-05 tests) | ✗ new |
| CON-07 | Per-write conflict budget = 3; async branch p99 < 4s | eval (latency probe) + nightly `scripts/eval-budget-summary.mjs --conflict-pipeline-p99` | (run eval + GraphQL aggregate) | Partial — extend summary script |
| CON-08 | No proactive notifications, anywhere | architectural (grep gate for forbidden binding usage) | `npm test -- --project=lint-node no-proactive-notifications.test.ts` | ✗ new (optional — PR review acceptable) |

---

## Wave 0 Requirements

New artifacts every downstream plan depends on (the planner should bundle these in the first RNK / CON waves):

- [x] `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` — RNK-01..04, RNK-06 inner check
- [x] `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — synced from `.planning/evals/recall-corpus.json` via D-13
- [x] `scripts/sync-eval-corpus.mjs` — D-13 sync helper (runs as `pretest:eval` npm hook)
- [x] `shared/vectorize-utils/{package.json, tsconfig.json, src/index.ts}` — D-08 new shared package
- [x] `packages/triage-worker/src/conflict-pipeline.ts` — CON-02 orchestrator
- [x] `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` — CON-02..04, CON-06 coverage
- [x] `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — CON-05 SQL-join coverage
- [x] `packages/workspace-do/src/queries.ts` — `insertConflictAsInbox` + `listInboxConflictsForMemoryIds` helpers
- [x] `docs/hybrid-rank-changelog.md` — RNK-07 first row (schema per CONTEXT.md D-21)
- [x] `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` — D-19 routing tracker
- [ ] (Optional, NOT built — RNK-05 covered Manual-Only) `packages/mcp-server/src/__tests__/ai-config-audit.test.ts`
- [x] `packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts` — CON-08 architectural gate
- [x] No new framework install needed (vitest + workers-pool already configured in Phase 1 PRE-02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visually inspect `HYBRID_WEIGHTS` audit comment in `shared/ai-config/src/index.ts` matches D-06 verbatim contract (corpus filename, sweep date, F1/MRR/top-1 scores, cross-phase footgun warning) | RNK-05 + D-06 | Audit-comment content is byte-frozen contract for Phase 3 readers — single-character drift breaks EXP-06 understanding | `/gsd:verify-work 2` reviewer reads the comment block; cross-reference against D-06 in CONTEXT.md; confirm Phase 3 reading-comprehension is intact |
| `docs/hybrid-rank-changelog.md` row schema matches D-21 spec (date, corpus_filename, corpus_size, corpus_split, embedding_model, weights, F1_train, F1_validate, MRR_train, top1_train, sensitivity_pass_rate, notes, bge_reranker_active) | RNK-07 + D-21 | Schema enforcement test is OPTIONAL (planner may add changelog-schema.test.ts); manual confirms first row landed correctly | Open the file post-merge; verify all 13 columns present + populated |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies or documented Manual-Only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all built except optional RNK-05 grep gate → Manual-Only)
- [x] No watch-mode flags in any test command
- [x] Feedback latency < 30s for workerd tier
- [x] Eval-tier separation documented: RNK + CON run as separate eval sessions (MAX_AI_CALLS=200 budget guard)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-12 (`/gsd:validate-phase 2`)

---

## Validation Audit 2026-06-12

| Metric | Count |
|--------|-------|
| Requirements audited | 15 (RNK-01..07, CON-01..08) |
| Automated (COVERED) | 13 |
| Manual-only (justified) | 2 (RNK-05 audit comment, RNK-07 changelog row) |
| Gaps found (MISSING) | 0 |
| Resolved this session | 0 (no fixable gaps) |
| Escalated | 0 |

**Outcome:** Phase 2 is NYQUIST-COMPLIANT. The prior `draft` state reflected an unreconciled placeholder Per-Task Map; the detailed Phase-Requirement→Test-File Map was already accurate. Re-ran no-creds behavior tests green this session: triage-worker 28/28 (CON-02/03/04/06/07-cap/08), mcp-server recall-conflicts + no-proactive 5/5 (CON-05/08). Eval-gated rows (RNK-01..04/06 sweep, CON-01 precision) rely on recorded green results in `02-VERIFICATION.md`. CON-07's async p99<4s SLA is deploy-gated telemetry. RNK-05/RNK-07 optional grep gates were intentionally not built — both have documented Manual-Only verification. No test files generated — none were missing.
