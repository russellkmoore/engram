---
phase: 04-synthesis-activation-eval
verified: 2026-06-10T08:30:00Z
status: passed
score: 10/10 must-haves verified (1 override + human-verify executed GREEN this session)
overrides_applied: 1
overrides:
  - must_have: "LLM-judge faithfulness pass rate >= 90% (SYN-02 hard gate)"
    reason: "passRate gate recalibrated to advisory during execution per explicit user decision (2026-06). The robust hard gate — totalHallucinatedEntities === 0 — passed GREEN (7/7 tests, zero hallucinated entities). passRate is logged at every eval run but not hard-asserted due to LLM-judge noise at small N (~1 false-negative per ~6 cases). Two backlog items track restoration: ROADMAP 999.2 (all-uncited floor) and 999.3 (judge robustness). REQUIREMENTS.md SYN-02 checkbox is stale — the hard gate it specifies (zero hallucinated entities) is met."
    accepted_by: "Russell Moore"
    accepted_at: "2026-06-10T00:00:00Z"
human_verification:
  - test: "Run the synthesis-fidelity eval gate with CF credentials"
    expected: "7/7 tests pass (or all non-skipped tests pass); exit 0; zero hallucinated entities; p99 <= 20s. The creds-gated faithfulness test skips gracefully without CLOUDFLARE_API_TOKEN."
    why_human: "The eval drives Workers AI (safeRun against JUDGE_MODEL + SYNTHESIS_MODEL). Cannot verify without live CF credentials and a billable AI call. The test files exist, type-check, and the no-creds smoke tests pass — but the faithfulness gate itself requires human execution with credentials."
---

# Phase 4: Synthesis Activation Eval — Verification Report

**Phase Goal:** Promote the scaffolded `verbosity=synthesis|both` branch in recall() from "implemented but unvalidated" to "shipped with an eval gate." Default verbosity stays "chunks" (SYN-08 regression guard — flipping the default is v0.3 territory, explicitly out of scope).
**Verified:** 2026-06-10T08:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | verbosity default is "chunks" in recall() schema (SYN-08 regression guard) | VERIFIED | `schemas.ts:67`: `z.enum(["synthesis", "chunks", "both"]).optional().default("chunks")` — confirmed "chunks" with inline comment "synthesis is opt-in per recall-latency budget" |
| 2 | SYNTHESIS_SYSTEM_PROMPT is byte-frozen and unchanged (SYN-10) | VERIFIED | `tools.ts:128-134`: single-match grep confirms 1 occurrence of "You are Engram's recall synthesizer"; no diff evidence of prompt edits; 04-03-SUMMARY verification result #5 confirms grep returns 1 |
| 3 | Post-processor helpers exported: trimRankedForSynthesis, applyHedgePrefix, mapPositionsToCitationIds, dropUncitedSentences (SYN-03/05/06) | VERIFIED | `tools.ts:145,184,199,226`: four `export function` declarations confirmed; all visible in source. SYN-05 throw at line 161: "synthesis-preflight: all memories exceed 6K token budget" |
| 4 | generateSynthesis() helper extracted and exported — eval can drive synthesis path directly (SYN-02 eval approach) | VERIFIED | `tools.ts:304`: `export async function generateSynthesis` — behavior-preserving extraction from recall(); synthesis-fidelity.eval.test.ts imports it at line 78 |
| 5 | SYN-07 single-memory guard: ranked.length < 2 → skip synthesis, push to synthesisGaps | VERIFIED | `tools.ts:990-996`: `if ((args.verbosity === "synthesis" \|\| args.verbosity === "both") && ranked.length < 2)` → `synthesisGaps.push("synthesis skipped: only one source")` |
| 6 | SYN-09 analytics: blobs[1]="synthesis", doubles[1]=Math.ceil(synthInput.length/4) on success path | VERIFIED | `tools.ts:1014-1018`: `blobs: ["mcp-server", "synthesis", wsTag, "success"]`, `doubles: [Date.now() - synthStart, Math.ceil(synthResult.synthInput.length / 4), 0, 0]` — both writeAnalytics call sites use "synthesis" string literal |
| 7 | synthesis-fidelity.eval.test.ts exists with zero-hallucination hard gate + p99 hang guard | VERIFIED | File exists at 22.7K bytes; `expect(totalHallucinatedEntities).toBe(0)` at line 497; `expect(p99).toBeLessThanOrEqual(LOCAL_HANG_CEILING_MS)` at line 501; `expect(judgedTotal).toBeGreaterThanOrEqual(MIN_JUDGED)` at line 492 |
| 8 | SYN-01: synthesis-eval-corpus.json curated corpus + recall-corpus-v2.json augmented with 30 validate-split captions | VERIFIED | `synthesis-eval-corpus.json` exists at 9.4K bytes; `recall-corpus-v2.json` validate-split check: 30 entries, 30 filled — confirmed via node verification command |
| 9 | All 4 plans have SUMMARY.md files | VERIFIED | 04-01-SUMMARY.md (5.7K), 04-02-SUMMARY.md (5.5K), 04-03-SUMMARY.md (8.3K), 04-04-SUMMARY.md (5.5K) — all present |
| 10 | SYN-02 faithfulness passRate >= 90% as hard gate | PASSED (override) | Override: passRate demoted to advisory per user-approved recalibration. Hard gate is totalHallucinatedEntities === 0 (GREEN). See overrides section. |

**Score:** 9/10 truths verified (10/10 counting override)

---

### Deferred Items

No items deferred to later phases — Phase 4 deliverables are complete. Two known-behavior items are tracked as backlog phases (ROADMAP 999.2, 999.3) and are NOT gaps in this phase:

| # | Item | Addressed In | Evidence |
|---|------|-------------|---------|
| 1 | D-09 all-uncited floor: dropUncitedSentences empties ~40% of syntheses when model produces faithful-but-uncited summaries | Phase 999.2 (BACKLOG) | ROADMAP.md Phase 999.2: "D-09 all-uncited synthesis floor (BACKLOG)" — tracked, not a Phase 4 defect |
| 2 | LLM-judge robustness: passRate false-negatives from collective-citation scoring | Phase 999.3 (BACKLOG) | ROADMAP.md Phase 999.3: "Synthesis faithfulness LLM-judge robustness (BACKLOG)" — tracked, not a Phase 4 defect |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/mcp-server/src/tools.ts` | Synthesis block hardening (SYN-03/05/06/07/09/10) + exported helpers | VERIFIED | All 4 helpers exported; synthesis block wired; SYNTHESIS_SYSTEM_PROMPT unchanged; verbosity default "chunks" |
| `packages/mcp-server/src/__tests__/evals/synthesis-fidelity.eval.test.ts` | Eval gate with zero-hallucination hard gate + latency guard | VERIFIED | 22.7K file; hard gates at lines 492, 497, 501; JUDGE_MODEL imported from @engram/ai-config |
| `packages/mcp-server/src/__tests__/evals/fixtures/synthesis-eval-corpus.json` | Curated 10-case coherent corpus | VERIFIED | Exists at 9.4K |
| `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` | 30 validate-split entries with expected_synthesis | VERIFIED | 52.2K; 30/30 validate entries filled; _auto_synced_from sentinel present |
| `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts` | Unit tests for D-02/D-09/SYN-06 post-processors | VERIFIED | 10.5K; 10 test cases covering mapPositionsToCitationIds, dropUncitedSentences, applyHedgePrefix, Intl.Segmenter probe |
| `packages/mcp-server/src/__tests__/synthesis-preflight.test.ts` | Unit tests for SYN-05 preflight throw | VERIFIED | 5.8K; 3 test cases (throw, partial truncation, meta.gaps boundary) |
| `shared/ai-config/src/index.ts` | JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const | VERIFIED | Line 123: `export const JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const` |
| `scripts/generate-synthesis-captions.mjs` | ESM CLI for corpus caption generation | VERIFIED | File exists; 30/30 validate entries in recall-corpus.json filled |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `synthesis-fidelity.eval.test.ts` | `shared/ai-config/src/index.ts` | `import { JUDGE_MODEL } from "@engram/ai-config"` | WIRED | Line 75: confirmed import present |
| `synthesis-fidelity.eval.test.ts` | `packages/mcp-server/src/tools.ts` | `import { generateSynthesis } from "../../tools.js"` | WIRED | Line 78: confirmed import; eval drives synthesis directly |
| `synthesis-fidelity.eval.test.ts` | `synthesis-eval-corpus.json` | `import synthesisCorpusJson from "./fixtures/synthesis-eval-corpus.json" with { type: "json" }` | WIRED | Line 82: confirmed |
| `synthesis-postprocess.test.ts` | `tools.ts` | `import * as toolsModule from "../tools.js"` + PendingToolsExports cast | WIRED | Line 57-72: cast-based import; functions are now exported (Plan 04-03 landed). TODO comment is stale but harmless. |
| `synthesis-preflight.test.ts` | `tools.ts` | `import * as toolsModule from "../tools.js"` + PendingToolsExports cast | WIRED | Line 54-63: same cast pattern; trimRankedForSynthesis is exported |
| `recall()` synthesis block | `generateSynthesis()` | `const synthResult = await generateSynthesis(env, ranked, args.query)` | WIRED | `tools.ts:1007`: delegation confirmed; SYN-07 guard, writeAnalytics, synthesisGaps merge retained in recall() |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `generateSynthesis()` | `synthesis` (string \| null) | `safeRun(env, CLASSIFIER_MODEL, ...)` + post-processor chain | Yes (live AI call in production; eval drives directly with curated fixtures) | FLOWING |
| `synthesis-fidelity.eval.test.ts` | `judgeResp.response` | `safeRun(env, JUDGE_MODEL, ...)` + `JudgeVerdict.safeParse()` | Yes (creds-gated; Zod-gated verdict) | FLOWING (creds required) |
| `recall-corpus-v2.json` | `expected_synthesis` (30 validate entries) | `generate-synthesis-captions.mjs` (offline deterministic) | Yes (30/30 filled strings, min 50 chars) | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: TypeScript compilation is the primary checkable behavior without live CF creds.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean (packages/mcp-server) | `npx tsc --noEmit` | Exit 0, no output | PASS |
| verbosity default is "chunks" in schema | `grep "default.*chunks\|chunks.*default"` on schemas.ts | `.default("chunks")` at line 67 | PASS |
| SYNTHESIS_SYSTEM_PROMPT count = 1 | `grep -c "You are Engram's recall synthesizer" tools.ts` | 1 | PASS |
| Zero-hallucination hard gate assertion present | `grep "toBe(0)" synthesis-fidelity.eval.test.ts` | Line 497: `expect(totalHallucinatedEntities).toBe(0)` | PASS |
| All 4 post-processors exported | `grep "^export function" tools.ts` | trimRankedForSynthesis, applyHedgePrefix, mapPositionsToCitationIds, dropUncitedSentences confirmed | PASS |
| SYN-07 guard present | `grep "synthesis skipped: only one source" tools.ts` | Line 995: confirmed | PASS |
| SYN-09 analytics blobs | `grep '"synthesis"' tools.ts \| grep -v SYNTHESIS_SYSTEM_PROMPT` | 2 writeAnalytics call sites use "synthesis" string | PASS |
| Eval with creds (faithfulness gate) | `cd packages/mcp-server && npm run test:eval -- synthesis-fidelity` | Requires CF credentials — SKIP | SKIP (human) |

---

### Probe Execution

Step 7c: No `scripts/*/tests/probe-*.sh` files declared for this phase. No probe discovery needed.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| SYN-01 | 04-02, 04-04 | synthesis-fidelity.eval.test.ts with corpus + expected_synthesis captions | SATISFIED | synthesis-fidelity.eval.test.ts exists; synthesis-eval-corpus.json (curated); recall-corpus-v2.json (30 captions for secondary completeness signal) |
| SYN-02 | 04-04 | LLM-judge faithfulness >= 90%; zero hallucinated entities | SATISFIED (override) | Zero-hallucination hard gate: expect(totalHallucinatedEntities).toBe(0) present and GREEN. passRate advisory per user-approved recalibration. REQUIREMENTS.md checkbox stale. |
| SYN-03 | 04-01, 04-03 | Citation density >= 1 [memory_id]/80 chars; uncited sentences dropped | SATISFIED | dropUncitedSentences enforces per-sentence citation requirement (the primary gate per RESEARCH.md D-09). Citation density diagnostic was explicitly classified as advisory/logged-only per 04-RESEARCH.md:404. REQUIREMENTS.md shows [x]. |
| SYN-04 | 04-04 | Synthesis p50 <= 5s, p99 <= 8s (logged); p99 <= 20s hang guard (hard) | SATISFIED (partial) | LOCAL_HANG_CEILING_MS=20_000 hard guard at line 501. p50/p99 logged against P50_BUDGET_MS=5000, P99_BUDGET_MS=8000. Production SLA verified on deployed Worker via Analytics Engine per 04-04-SUMMARY. Local assertion is hang-guard only. |
| SYN-05 | 04-03 | Preflight throw when all memories exceed 6K token budget | SATISFIED | trimRankedForSynthesis throws at tools.ts:161; catch at generateSynthesis:354-355 surfaces in meta.gaps |
| SYN-06 | 04-03 | Cosine-aware hedging: min(cosine) < 0.7 → hedge prefix applied post-safeRun | SATISFIED | applyHedgePrefix exported at tools.ts:184; wired in generateSynthesis:344 after safeRun |
| SYN-07 | 04-03 | Single-memory rejection; meta.gaps note | SATISFIED | tools.ts:990-996: guard before synthesis block; synthesisGaps merged after buildRecallResponse |
| SYN-08 | (regression guard) | verbosity default stays "chunks" | SATISFIED | schemas.ts:67: `.default("chunks")` confirmed |
| SYN-09 | 04-03 | Analytics blobs[1]="synthesis", doubles[1]=token_count | SATISFIED | tools.ts:1014-1017: blobs "synthesis" + Math.ceil(synthInput.length/4) on success path |
| SYN-10 | 04-01, 04-03 | SYNTHESIS_MODEL=Scout alias; SYNTHESIS_SYSTEM_PROMPT byte-frozen | SATISFIED | ai-config:245 SYNTHESIS_MODEL=INGESTION_CLASSIFIER_MODEL; tools.ts:128-134 prompt unchanged; grep count=1 |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `synthesis-postprocess.test.ts` | 55 | `TODO 04-03: Replace with named imports once Plan 04-03 exports these helpers` | Info | Stale TODO — Plan 04-03 has landed and the helpers are exported. The PendingToolsExports cast pattern works correctly. Not a debt marker blocker: the comment references task ID "04-03" (formal follow-up work). No behavioral impact. |
| `synthesis-preflight.test.ts` | 52 | `TODO 04-03: Replace with named import once Plan 04-03 exports trimRankedForSynthesis` | Info | Same stale TODO — trimRankedForSynthesis is exported at tools.ts:145. Cast pattern still works correctly. |
| `tools.ts` | 272 | `TODO: derive from env.ENVIRONMENT if Phase 7 adds staging/dev split` | Info | References a future phase (Phase 7). Not introduced by Phase 4 work; pre-existing comment. |

No TBD, FIXME, or XXX markers found in any Phase 4 modified files.

---

### Human Verification Required

#### 1. Synthesis Fidelity Eval Gate (creds required)

**Test:** With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set, run:
```
cd packages/mcp-server && npm run test:eval -- synthesis-fidelity
```

**Expected:**
- Corpus smoke test: PASS (10 curated cases found, >= 2 memories each)
- computePercentile sanity: PASS
- Faithfulness gate (creds required): 7/7 tests pass; zero hallucinated entities (`totalHallucinatedEntities === 0`); `judgedTotal >= 4`; `p99 <= 20_000ms`
- Faithfulness passRate is logged (advisory, not hard-asserted) — any value is acceptable
- Total test run time: ~57-82 seconds per 04-04-SUMMARY

**Why human:** The eval drives Workers AI (`safeRun` against `JUDGE_MODEL` = llama-3.3-70b-instruct-fp8-fast and `SYNTHESIS_MODEL` = Scout) with real Cloudflare bindings. Cannot verify without CF credentials and billable AI calls. Automated verification confirmed: file exists, type-checks, and all no-creds tests pass structurally. The gate was confirmed GREEN (7/7 pass, zero hallucinated entities) during phase execution per 04-04-SUMMARY — this human step re-confirms the gate still holds post-verification.

---

### Gaps Summary

No gaps blocking the phase goal. One item requires human verification (the live eval gate) before the phase can be marked fully passed.

**Stale TODO cleanup opportunity (non-blocking):** The `PendingToolsExports` cast in `synthesis-postprocess.test.ts` and `synthesis-preflight.test.ts` was introduced in Plan 04-01 as a TDD RED-state bridge. Plan 04-03 exported the helpers, but the cast was not cleaned up. The tests work correctly as-is (tsc passes; functions resolve via the cast). This can be cleaned up in a follow-up commit by replacing the cast imports with direct named imports.

---

_Verified: 2026-06-10T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
