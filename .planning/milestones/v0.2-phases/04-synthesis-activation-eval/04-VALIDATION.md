---
phase: 04
slug: synthesis-activation-eval
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-09
validated: 2026-06-12
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.8 (multi-project: `workerd` unit pool + `eval` tier gated on CF creds) |
| **Config file** | `packages/mcp-server/vitest.config.ts` |
| **Quick run command** | `cd packages/mcp-server && npx vitest run --project workerd` |
| **Full suite command** | `cd packages/mcp-server && npm run test:eval` |
| **Estimated runtime** | unit ~10s · eval tier ~90 AI calls (within MAX_AI_CALLS ≤ 200, PRE-02) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project workerd` (unit tests — no AI calls)
- **After every plan wave:** Run `npm run test:eval -- synthesis-fidelity` (eval gate)
- **Before `/gsd:verify-work`:** Full eval suite green + SYN-02 ≥ 90% + SYN-05 throw + SYN-07 unit pass
- **Max feedback latency:** ~10s (unit) / minutes (eval tier)

---

## Per-Task Verification Map

> **Reconciled 2026-06-12 (as-built).** Unit tests re-run green this session:
> synthesis-postprocess + synthesis-preflight (13), tools/schemas/envelope/ai-helper-identity
> (67/1-skip). Eval-gated rows rely on `04-VERIFICATION.md` (7/7 green, zero hallucinated).

| Req ID | Behavior | Test Type | Automated Command | File / Evidence | Status |
|--------|----------|-----------|-------------------|-----------------|--------|
| SYN-01 | Corpus has `expected_synthesis` captions for validate split | eval (corpus content) | `vitest run synthesis-fidelity.eval.test.ts` | VERIFICATION: 7/7 green | ✅ green (VERIFICATION) |
| SYN-02 | LLM-judge faithfulness ≥ 90%; **zero hallucinated entities** | eval (AI judge) | `vitest run synthesis-fidelity.eval.test.ts` | Hard gate `totalHallucinatedEntities===0` GREEN (7/7). passRate≥90% recalibrated to **advisory** per accepted override (Russell Moore, `overrides_applied:1`); restoration tracked by ROADMAP 999.2 + 999.3 | ✅ hard gate green; passRate advisory (override) |
| SYN-03 | Citation density ≥ 1 marker/80 chars; uncited sentences dropped | unit | `vitest run synthesis-postprocess.test.ts` | `synthesis-postprocess.test.ts` | ✅ green (2026-06-12) |
| SYN-04 | p50 ≤ 5s, p99 ≤ 8s (logged; local hang-guard hard-assert) | eval (latency) | `vitest run synthesis-fidelity.eval.test.ts` | VERIFICATION: local green; **prod latency Manual-Only** | ✅ local green; prod deploy-gated |
| SYN-05 | Pre-flight throws when all memories exceed 6K token budget | unit | `vitest run synthesis-preflight.test.ts` | `synthesis-preflight.test.ts` | ✅ green (2026-06-12) |
| SYN-06 | Cosine-aware hedge prefix applied when min cosine < 0.7 | unit | `vitest run synthesis-postprocess.test.ts` | `synthesis-postprocess.test.ts` | ✅ green (2026-06-12) |
| SYN-07 | Single-memory synthesis rejected with `meta.gaps` note | unit | `vitest run synthesis-postprocess.test.ts` | `synthesis-postprocess.test.ts` | ✅ green (2026-06-12) |
| SYN-08 | `verbosity` default remains `"chunks"` (regression guard) | unit | `vitest run tools schemas` | `tools.test.ts` / `schemas.test.ts` | ✅ green (2026-06-12) |
| SYN-09 | Analytics blobs: `blobs[1]="synthesis"`, `doubles[1]=token_count` | unit | `vitest run envelope recall` | `envelope.test.ts` / `recall.test.ts` | ✅ green (2026-06-12) |
| SYN-10 | `SYNTHESIS_SYSTEM_PROMPT` byte-frozen; `SYNTHESIS_MODEL` = Scout alias | unit (grep/identity) | `vitest run ai-helper-identity` | `ai-helper-identity.test.ts` | ✅ green (2026-06-12) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**SYN-02 override note:** The requirement's catastrophic half — **zero hallucinated entities** — passed GREEN (7/7, `totalHallucinatedEntities===0`). The `passRate ≥ 90%` half was recalibrated to *advisory* during execution by explicit user decision (LLM-judge noise at small N produced ~1 false-negative per ~6 cases). This is a documented, accepted override (`04-VERIFICATION.md` `overrides_applied:1`), not an unmet gate; REQUIREMENTS.md keeps SYN-02 `[ ]` to reflect the advisory status. Restoration is tracked by ROADMAP backlog 999.2 (all-uncited floor) + 999.3 (judge robustness).

---

## Wave 0 Requirements

- [x] `packages/mcp-server/src/__tests__/evals/synthesis-fidelity.eval.test.ts` — SYN-01, SYN-02, SYN-04
- [x] `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts` — SYN-03, SYN-06, SYN-07 (workerd pool, no AI calls)
- [x] `packages/mcp-server/src/__tests__/synthesis-preflight.test.ts` — SYN-05 throw behavior
- [x] `.planning/evals/recall-corpus.json` caption augmentation — `expected_synthesis` for validate entries
- [x] `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — synced after augmentation
- [x] `shared/ai-config/src/index.ts` — `JUDGE_MODEL` constant
- [x] `Intl.Segmenter` availability probe in workerd (regex fallback if absent)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| p99 latency under real CF network conditions | SYN-04 | Eval latency is measured against Workers AI live; CI percentiles are indicative, not contractual | Run `npm run test:eval -- synthesis-fidelity` against deployed bindings; inspect logged p50/p99 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s (unit tier)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-12 (`/gsd:validate-phase 4`)

---

## Validation Audit 2026-06-12

| Metric | Count |
|--------|-------|
| Requirements audited | 10 (SYN-01..10) |
| Automated (COVERED) | 10 |
| Accepted override | 1 (SYN-02 passRate → advisory; zero-hallucinated hard gate GREEN) |
| Gaps found (MISSING) | 0 |
| Resolved this session | 0 (no fixable gaps) |
| Escalated | 0 |

**Outcome:** Phase 4 is NYQUIST-COMPLIANT. Unit tests re-run green this session: synthesis-postprocess + synthesis-preflight (13), tools/schemas/envelope/ai-helper-identity (67 passed / 1 skipped) — covering SYN-03/05/06/07/08/09/10. Eval-gated SYN-01/04 green per `04-VERIFICATION.md` (7/7, zero hallucinated entities). SYN-02 carries an accepted override (passRate advisory; the robust zero-hallucinated-entities gate passed) with restoration tracked by ROADMAP 999.2 + 999.3 — this is a documented recalibration, not a coverage gap. SYN-04 production latency is deploy-gated. No test files generated — none were missing.
