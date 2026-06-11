---
phase: 5
slug: integration-kitchen-sink
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
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

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| INT-01 | Worst-case envelope (10 conflicts + 50 entities + verbosity=synthesis) ≤ 7,500 cl100k tokens post-trim AND synthesis + high-severity conflicts survive trim | integration | `npm test -w packages/mcp-server -- --project=workerd -t v02-kitchen-sink` | ❌ Wave 0 |
| INT-02 | v0.1 envelope contract preserved; new optional `context.conflicts[]` content + optional `result.synthesis` have correct non-breaking shape | unit | `npm test -w packages/mcp-server -- --project=workerd -t envelope` | ✅ extend in place |
| INT-03 | 3 mcp-server paths (expanded-query fan-out, reranker, synthesis) reject foreign-workspace data (Prong A) | security | `npm test -w packages/mcp-server -- --project=workerd -t cross-workspace-pentest` | ✅ extend in place |
| INT-03 (D-10) | Conflict-pipeline routes inbox writes to correct workspace DO (not a forgeable arg) | security | `npm test -w packages/triage-worker -- --project=workerd -t conflict-pipeline-isolation` | ❌ Wave 0 |
| INT-04 | Matrix has zero `pending` rows; every `tested` row points to a real file on disk | gate/grep | `grep -c "pending" .planning/research/v0.2-INTEGRATION-MATRIX.md` | ✅ rows all `pending` |
| INT-05a | Local `wrangler dev` boot of both Workers + programmatic `remember → recall(synthesis) → conflict-surfacing` smoke | smoke/e2e | `bash scripts/smoke-wrangler-dev.sh …` | ✅ script exists |
| INT-05b | Manual staging ritual (documented checklist, not a PR gate) | manual | — | — |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` — INT-01 + kitchen-sink matrix row
- [ ] `packages/triage-worker/src/__tests__/conflict-pipeline-isolation.test.ts` — INT-03 D-10 workspace routing

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
