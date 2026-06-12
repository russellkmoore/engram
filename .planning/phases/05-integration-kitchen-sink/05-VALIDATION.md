---
phase: 5
slug: integration-kitchen-sink
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
validated: 2026-06-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `05-RESEARCH.md` § Validation Architecture. Per-task map is filled after plans land.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.7 + `@cloudflare/vitest-pool-workers` 0.16.9 |
| **Config file** | `packages/mcp-server/vitest.config.ts` (multi-project: workerd / lint-node / creds-gated eval) |
| **Quick run command** | `npm test --workspace=packages/mcp-server -- --project=workerd` |
| **Full suite command** | `npm test --workspaces --if-present` |
| **Estimated runtime** | ~30–60 seconds (workerd pool) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace=packages/mcp-server -- --project=workerd`
- **After every plan wave:** Run `npm test --workspaces --if-present`
- **Before `/gsd:verify-work`:** Full suite green AND `grep -c "pending" .planning/research/v0.2-INTEGRATION-MATRIX.md` returns `0`
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

> Filled after plans land (task IDs do not exist until planning completes). Requirement → behavior map below is the binding source.

> **Reconciled 2026-06-12 (as-built).** No-creds tests re-run green this session:
> mcp-server kitchen-sink + envelope + pentest (31 passed / 4 skipped — the 4 are the
> deploy-gated nightly Prong-C namespace cases), triage-worker isolation (2 passed).

| Req ID | Behavior | Test Type | Automated Command | File / Evidence | Status |
|--------|----------|-----------|-------------------|-----------------|--------|
| INT-01 | Worst-case envelope (10 conflicts + 50 entities + verbosity=synthesis) ≤ 7,500 cl100k tokens post-trim AND synthesis + high-severity conflicts survive trim | integration | `npm test -w packages/mcp-server -- --project=workerd -t v02-kitchen-sink` | `integration/v02-kitchen-sink.test.ts` | ✅ green (2026-06-12) |
| INT-02 | v0.1 envelope contract preserved; new optional `context.conflicts[]` + optional `result.synthesis` non-breaking | unit | `npm test -w packages/mcp-server -- --project=workerd -t envelope` | `envelope.test.ts` | ✅ green (2026-06-12) |
| INT-03 | 3 mcp-server paths (expanded-query fan-out, reranker, synthesis) reject foreign-workspace data (Prong A) | security | `npm test -w packages/mcp-server -- --project=workerd -t cross-workspace-pentest` | `cross-workspace-pentest.test.ts` (Prong-C nightly cases `it.skip`, deploy-gated) | ✅ green (2026-06-12) |
| INT-03 (D-10) | Conflict-pipeline routes inbox writes to correct workspace DO (not a forgeable arg) | security | `npm test -w packages/triage-worker -- --project=workerd -t conflict-pipeline-isolation` | `conflict-pipeline-isolation.test.ts` (2 tests) | ✅ green (2026-06-12) |
| INT-04 | Matrix has zero `pending` combo rows; every `tested` row points to a real file on disk | gate/grep | matrix Status-cell review | `v0.2-INTEGRATION-MATRIX.md` — 0 pending combos (the lone `pending` grep hit is the status-vocabulary legend row); integration-checker confirmed 6/6 tested | ✅ green |
| INT-05a | Local `wrangler dev` boot of both Workers + programmatic `remember → recall(synthesis) → conflict-surfacing` smoke | smoke/e2e | `bash scripts/smoke-wrangler-dev.sh …` | `scripts/smoke-wrangler-dev.sh` (runs in `ci.yml`) | ✅ script present + CI-wired |
| INT-05b | Manual staging ritual (documented checklist, not a PR gate) | manual | — | no staging env; deploy-gated | ⬜ manual-only |

*Status: ⬜ manual-only · ✅ green · ❌ red · ⚠️ flaky*

**Note:** INT-05b is the sole open item — the deployed-staging e2e ritual, which has no automated path because no staging environment is configured (both wrangler configs are production-only). It is Phase 5's `human_needed` verification item, to be run once at first deploy. The 4 skipped pentest cases are the nightly Prong-C namespace-isolation checks (run against live Vectorize on a schedule), deferred by design — not a coverage gap.

---

## Wave 0 Requirements

- [x] `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` — INT-01 + kitchen-sink matrix row
- [x] `packages/triage-worker/src/__tests__/conflict-pipeline-isolation.test.ts` — INT-03 D-10 workspace routing

---

## False-Positive Guards (verification-phase teeth)

| Risk | Guard |
|------|-------|
| `synthesis=null` (SYN-07 fired) makes content-preservation assertion vacuously pass | `expect(trimmed.result.synthesis).not.toBeNull()` BEFORE content assertions |
| Matrix row marked `tested` but file absent | `/gsd:verify-work 5` asserts `test -f <Test File>` per `tested` row (D-03) |
| Build/types GREEN while live behavior differs | Run workerd pool (not just `tsc`) in CI |
| ≤8K post-trim check trivially true without content teeth | Assert pre-trim `> 7,500` so `trimToBudget` actually trims (D-05) |
| Prong-A isolation passes vacuously (no data seeded) | Positive control: legit workspace returns ≥1 memory |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deployed-staging e2e smoke | INT-05b | No staging environment configured (both wrangler configs are production-only); needs real deploy + creds | Documented one-time ritual in `/gsd:verify-work 5` checklist at milestone close |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies or documented Manual-Only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-12 (`/gsd:validate-phase 5`)

---

## Validation Audit 2026-06-12

| Metric | Count |
|--------|-------|
| Requirements audited | 5 (INT-01..05, incl. INT-03 D-10 + INT-05a/b) |
| Automated (COVERED) | 4 (INT-01, INT-02, INT-03 ×2, INT-04, INT-05a) |
| Manual-only (justified) | 1 (INT-05b deployed-staging ritual) |
| Gaps found (MISSING) | 0 |
| Resolved this session | 0 (no fixable gaps) |
| Escalated | 0 |

**Outcome:** Phase 5 is NYQUIST-COMPLIANT. No-creds tests re-run green this session: mcp-server kitchen-sink + envelope + cross-workspace-pentest (31 passed / 4 skipped) and triage-worker conflict-pipeline-isolation (2 passed). The 4 skips are the deploy-gated nightly Prong-C namespace-isolation cases (run on schedule against live Vectorize), not gaps. INT-04 matrix has 0 pending combo rows (the lone `pending` grep hit is the status-vocabulary legend). INT-05b (deployed-staging e2e ritual) is the sole open item — legitimately Manual-Only because no staging environment is configured; it is Phase 5's `human_needed` verification, to run at first deploy. No test files generated — none were missing.
