---
phase: 1
slug: foundation-wave-0
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-02
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x with `@cloudflare/vitest-pool-workers` |
| **Config file** | `packages/*/vitest.config.ts` (per-package multi-project configs) |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test:unit && npm run test:integration` |
| **Estimated runtime** | ~60s unit; ~120s with integration |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run test:unit && npm run test:integration`
- **Before `/gsd:verify-work`:** Full suite must be green (unit + integration + eval-dry-run)
- **Max feedback latency:** ~120s (full pre-verify suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD by planner | TBD | TBD | PRE-01..05 | TBD | TBD | TBD | TBD | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner will populate this table per task during plan generation. Every task that produces verifiable output (script, config file, test, JSON corpus, markdown doc) must have a row with an automated command (`test`, `node script.js`, `jq` schema check, `wc -l` row count, etc.).*

---

## Wave 0 Requirements

- [ ] Tiered vitest config (`unit` / `integration` / `eval`) installed in `packages/*/vitest.config.ts` — enables PRE-02 + sampling
- [ ] `MAX_AI_CALLS=200` counter wrapper in `eval` setupFiles — enables PRE-02 enforcement
- [ ] Migration audit script `scripts/audit-migration.ts` — enables PRE-01
- [ ] `.planning/evals/recall-corpus.json` schema validator — enables PRE-03 row-count + split assertions
- [ ] Existing `@cloudflare/vitest-pool-workers` infrastructure covers the rest

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Corpus query labeling quality | PRE-03 | Requires human judgment on whether `expected_top_3_block_ids` are semantically correct for the query. No oracle exists. | Russell labels ≥100 query→top_3 pairs; spot-check 10 random pairs from validate split for relevance. |
| Integration matrix completeness | PRE-04 | Whether the enumerated cross-feature combos cover real risk surface is a design judgment, not a computable property. | Russell reviews matrix vs Phase 2/3/4/5 plan objectives before milestone close. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
