---
phase: 04
slug: synthesis-activation-eval
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
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

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| SYN-01 | Corpus has `expected_synthesis` captions for validate split | eval (corpus content) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ W0 |
| SYN-02 | LLM-judge faithfulness ≥ 90%; zero hallucinated entities | eval (AI judge) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ W0 |
| SYN-03 | Citation density ≥ 1 marker/80 chars; uncited sentences dropped | unit | `vitest run synthesis-postprocess.test.ts` | ❌ W0 |
| SYN-04 | p50 ≤ 5s, p99 ≤ 8s (logged; local hang-guard hard-assert) | eval (latency) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ W0 |
| SYN-05 | Pre-flight throws when all memories exceed 6K token budget | unit | `vitest run synthesis-preflight.test.ts` | ❌ W0 |
| SYN-06 | Cosine-aware hedge prefix applied when min cosine < 0.7 | unit | `vitest run synthesis-postprocess.test.ts` | ❌ W0 |
| SYN-07 | Single-memory synthesis rejected with `meta.gaps` note | unit | `vitest run synthesis-postprocess.test.ts` | ❌ W0 |
| SYN-08 | `verbosity` default remains `"chunks"` (regression guard) | unit | existing `tools.test.ts` schema default test | ✅ existing |
| SYN-09 | Analytics blobs: `blobs[1]="synthesis"`, `doubles[1]=token_count` | unit | `vitest run analytics-schema.test.ts` (or extend existing) | ❌ W0 |
| SYN-10 | `SYNTHESIS_SYSTEM_PROMPT` byte-frozen; `SYNTHESIS_MODEL` = Scout alias | unit (grep/identity) | existing model-identity tests | ✅ existing |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/mcp-server/src/__tests__/evals/synthesis-fidelity.eval.test.ts` — SYN-01, SYN-02, SYN-04
- [ ] `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts` — SYN-03, SYN-06, SYN-07 (workerd pool, no AI calls)
- [ ] `packages/mcp-server/src/__tests__/synthesis-preflight.test.ts` — SYN-05 throw behavior
- [ ] `.planning/evals/recall-corpus.json` caption augmentation — `expected_synthesis` for 30 validate entries
- [ ] `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — synced after augmentation
- [ ] `shared/ai-config/src/index.ts` — `JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"` constant
- [ ] `Intl.Segmenter` availability probe in workerd (Wave 0 unit assert; regex fallback if absent)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| p99 latency under real CF network conditions | SYN-04 | Eval latency is measured against Workers AI live; CI percentiles are indicative, not contractual | Run `npm run test:eval -- synthesis-fidelity` against deployed bindings; inspect logged p50/p99 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s (unit tier)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
