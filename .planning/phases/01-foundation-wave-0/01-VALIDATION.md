---
phase: 1
slug: foundation-wave-0
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-02
validated: 2026-06-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconciled 2026-06-12 by `/gsd:validate-phase 1` — placeholder Per-Task Map replaced
> with the as-built requirement→test map. No MISSING gaps: every requirement has automated
> verification or a documented Manual-Only justification.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x with `@cloudflare/vitest-pool-workers` |
| **Config file** | `packages/*/vitest.config.ts` (per-package multi-project: workerd / lint-node / eval) |
| **Quick run command** | `npm test --workspaces --if-present` (workerd + lint-node; no creds) |
| **Eval-tier command** | `ENGRAM_RUN_EVAL=1 npm run evals:vitest` (gated on CF creds via `hasEvalCreds`) |
| **Estimated runtime** | ~60s default suite; eval tier adds Workers AI calls under MAX_AI_CALLS=200 |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspaces --if-present`
- **After every plan wave:** Run default suite + eval-tier dry run where creds available
- **Before `/gsd:verify-work`:** Full suite green (unit + integration; eval tier green when creds present)
- **Max feedback latency:** ~120s (default pre-verify suite)

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File / Evidence | Status |
|-----|----------|-----------|-------------------|-----------------|--------|
| PRE-01 | `countStaleEmbeddings` + `assertAllBlocksAtV2` catch NULL / `embedding_version<2` / wrong-model stale rows; CI rejects any non-zero count | unit + CI gate | `npm test --workspace=packages/workspace-do -- --run migration-audit` | `packages/workspace-do/src/__tests__/migration-audit.test.ts` (8 assertions); `.github/workflows/ci.yml` "Migration audit (PRE-01)" step | ✅ green (8/8, run 2026-06-12) |
| PRE-02 | Tiered vitest (`unit`/`integration`/`eval`); `eval` tier enforces `MAX_AI_CALLS=200` (throws on exceed, not skips); daily neuron-consumption summary | infra + CI | `ENGRAM_RUN_EVAL=1 npm run evals:vitest` | `eval-budget.setup.ts` (setupFiles @ `mcp-server/vitest.config.ts:139` + `triage-worker/vitest.config.ts:87`); `scripts/eval-budget-summary.mjs`; `.github/workflows/evals.yml` | ✅ green (infra wired + active) |
| PRE-03 | `recall-corpus.json` holds ≥100 labeled `query→expected_top_3_block_ids` pairs; every entry `split ∈ {train, validate}` | unit (pure-data) | `ENGRAM_RUN_EVAL=1 npm test --workspace=packages/mcp-server -- --run evals/recall-f1` | corpus = **100 entries** (confirmed 2026-06-12); assertions @ `recall-f1.eval.test.ts:249` (`≥100`) + `:252` (valid splits) | ✅ green (data confirmed; assertion is eval-tier creds-gated) |
| PRE-04 | Integration matrix enumerates cross-feature combos; resolves to **0 untested** by milestone close | manual + grep gate | design review + `grep` pending-row count on `v0.2-INTEGRATION-MATRIX.md` | `.planning/research/v0.2-INTEGRATION-MATRIX.md`; 0 pending confirmed by milestone integration-checker | ⬜ manual-only |
| PRE-05 | CF-code-assist routing tracker scaffolded with 3-question-checklist columns; every v0.2 code task appends a row | manual | doc existence + per-task append discipline | `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` | ⬜ manual-only |

*Status: ⬜ pending/manual-only · ✅ green · ❌ red · ⚠️ flaky*

**Coverage note:** PRE-03's structural assertion is correct and present but lives inside an `.eval.test.ts` file, so it only executes when the `eval` project materializes (`hasEvalCreds` + `ENGRAM_RUN_EVAL=1`) — it does not run in a no-creds CI lane. The corpus data itself (100 entries, documented 5-source provenance, train/validate split) was confirmed by direct inspection during reconciliation. If a no-creds row-count guard is wanted, a pure-data copy of the `≥100 / valid-split` assertion could be moved into the default `workerd` project (tracked as optional follow-up, not a blocker).

---

## Wave 0 Requirements

- [x] Tiered vitest config (`unit` / `integration` / `eval`) installed in `packages/*/vitest.config.ts` — enables PRE-02 + sampling
- [x] `MAX_AI_CALLS=200` counter wrapper in `eval` setupFiles — enables PRE-02 enforcement
- [x] Migration audit script `scripts/audit/embedding-version-audit.ts` + `migration-audit.test.ts` — enables PRE-01
- [x] `.planning/evals/recall-corpus.json` (100 entries) + structural assertions — enables PRE-03 row-count + split checks
- [x] Existing `@cloudflare/vitest-pool-workers` infrastructure covers the rest

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Corpus query labeling quality | PRE-03 | Requires human judgment on whether `expected_top_3_block_ids` are semantically correct for the query. No oracle exists. | Russell labels ≥100 query→top_3 pairs; spot-check 10 random pairs from validate split for relevance. **Resolved** at Phase 1 human-UAT (2026-06-05): AI cross-validated labels accepted. |
| Integration matrix completeness | PRE-04 | Whether the enumerated cross-feature combos cover real risk surface is a design judgment, not a computable property. | Russell reviews matrix vs Phase 2/3/4/5 plan objectives. **Confirmed** by milestone integration-checker: 0 pending / 6 combos tested. |
| CF-code-assist tracker upkeep | PRE-05 | The doc is a routing-discipline ledger; "every code task appended a row" is a process-adherence judgment, not an asserted property. | Reviewer confirms the tracker exists and v0.2 phases appended rows. Scaffold present; per-phase trackers exist 02–05. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies or documented Manual-Only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-12 (`/gsd:validate-phase 1`)

---

## Validation Audit 2026-06-12

| Metric | Count |
|--------|-------|
| Requirements audited | 5 (PRE-01..05) |
| Automated (COVERED) | 3 (PRE-01, PRE-02, PRE-03) |
| Manual-only (justified) | 2 (PRE-04, PRE-05) |
| Gaps found (MISSING) | 0 |
| Resolved this session | 0 (no fixable gaps) |
| Escalated | 0 |

**Outcome:** Phase 1 is NYQUIST-COMPLIANT. The prior `draft` / `nyquist_compliant: false` state reflected an unreconciled placeholder Per-Task Map (`TBD by planner`), not absent validation. PRE-01 verified green this session (8/8); PRE-03 corpus confirmed (100 entries) with eval-tier creds-gated assertions; PRE-02 budget infrastructure wired and active; PRE-04/PRE-05 are legitimate Manual-Only items with documented resolution. No test files were generated — none were missing.
