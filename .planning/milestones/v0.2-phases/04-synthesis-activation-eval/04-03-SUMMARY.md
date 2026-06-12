---
phase: "04-synthesis-activation-eval"
plan: "03"
subsystem: "mcp-server"
tags: ["synthesis", "post-processing", "analytics", "SYN-05", "SYN-06", "SYN-07", "SYN-09", "D-02", "D-09"]
dependency_graph:
  requires:
    - "04-01 (RED unit tests for synthesis post-processors)"
    - "tools.ts synthesis scaffold (pre-existing)"
  provides:
    - "Exported post-processor helpers: trimRankedForSynthesis, applyHedgePrefix, mapPositionsToCitationIds, dropUncitedSentences"
    - "SYN-05 preflight throw inside trimRankedForSynthesis"
    - "SYN-07 single-memory guard before synthesis block"
    - "SYN-06 cosine-aware hedge prefix applied post-safeRun"
    - "D-02/D-09 post-processing chain wired in synthesis block"
    - "SYN-09 analytics blobs[1]='synthesis', doubles[1]=token_count"
    - "synthesisGaps merged into envelope.meta.gaps post-buildRecallResponse"
  affects:
    - "04-04 (synthesis-fidelity eval — will exercise the hardened synthesis block)"
    - "Wave 1 RED tests (synthesis-postprocess, synthesis-preflight) now GREEN"
tech_stack:
  added: []
  patterns:
    - "Intl.Segmenter with '. [' presplit for citation-adjacent sentence boundaries"
    - "Honest-stubs posture: SYN-05 throw propagates to synthesis try/catch → meta.gaps"
    - "synthesisGaps local array + post-buildRecallResponse merge (mirrors EXP-10 pattern)"
key_files:
  created: []
  modified:
    - "packages/mcp-server/src/tools.ts"
    - "packages/mcp-server/src/__tests__/tools-integration.test.ts"
decisions:
  - "D-02: mapPositionsToCitationIds uses word-boundary lookahead regex `memory N(?=\\b|[^0-9])` to prevent partial digit matches"
  - "Intl.Segmenter presplit: insert sentinel newline before '. [' so segmenter splits citation-adjacent sentences correctly"
  - "dropUncitedSentences signature retains trimmedForSynth param for future citation-density checks (SYN-03)"
  - "SYN-07 guard placed before synthesis if-block using ranked.length (not trimmedForSynth.length)"
  - "lowConfidence and trimmedForSynth declared with let outside try block so they remain in scope for post-processing"
metrics:
  duration: "~35 minutes"
  completed_date: "2026-06-10"
  tasks_completed: 2
  files_modified: 2
---

# Phase 04 Plan 03: Synthesis Activation Hardening Summary

Exported synthesis post-processors and wired all Phase 4 guards into the recall() synthesis block: SYN-05 preflight throw, SYN-07 single-memory rejection, SYN-06 cosine hedge, D-02 position-to-id mapping, D-09 uncited-sentence drop, and SYN-09 analytics.

## What Was Built

**Task 1 — Export post-processor helpers + harden trimRankedForSynthesis (12dc654)**

Four helpers exported from `tools.ts`:

1. `trimRankedForSynthesis` — hardened with SYN-05 throw when `out.length === 0` (all memories exceed 6K token budget). Previously returned empty array silently.

2. `applyHedgePrefix(synthesis, lowConfidence)` — prepends `"Note: the following is based on loosely-matched memories and may be incomplete. "` when lowConfidence=true (SYN-06).

3. `mapPositionsToCitationIds(synthesis, trimmedForSynth)` — replaces `"memory N"` (case-insensitive, with word-boundary lookahead to prevent partial digit matches on `"memory 10"`) with `[block_id]` from the ranked list (D-02).

4. `dropUncitedSentences(synthesis, trimmedForSynth, opts)` — drops every sentence lacking a `[citation]` marker except: first sentence when `lowConfidenceHedge=true` (hedge exception), and gap-acknowledgment sentences matching `GAP_ACK_RE` (D-09).

**Key deviation from plan:** Intl.Segmenter correctly handles `"Hello. World."` but does NOT split `"memory 5 gave us the answer. [blk-001] told us more."` because `[` is not a capital letter and does not trigger ICU sentence boundary rules. Added a `PRESPLIT_RE` step that inserts a sentinel newline before `. [` patterns, then the segmenter sees the break correctly. Regex fallback updated to `(?<=[.!?])\s+(?=[A-Z[])` as well. All 13 unit tests pass GREEN.

**Task 2 — Wire synthesis block guards + SYN-09 analytics (93cc2e4)**

Applied all five integration steps from PATTERNS.md to the synthesis block:

1. **SYN-07 guard**: `if (synthVerbosity && ranked.length < 2)` → push `"synthesis skipped: only one source"` to `synthesisGaps`, skip block.

2. **SYN-05 catch**: `if synthErr.message.includes("synthesis-preflight:")` → push `"synthesis skipped: context exceeded 6K token budget"` to `synthesisGaps`.

3. **SYN-06 flag**: `const minCosine = Math.min(...cosineScores); lowConfidence = minCosine < 0.7;` computed inside try block after `trimRankedForSynthesis`.

4. **Post-processing chain**: `applyHedgePrefix` → `mapPositionsToCitationIds` → `dropUncitedSentences` wired after `safeRun` returns, before `writeAnalytics`.

5. **SYN-09 analytics**: Both `writeAnalytics` call sites updated: `blobs[1]` changed from `CLASSIFIER_MODEL` to `"synthesis"` (operation-kind discriminator); `doubles[1]` on success path changed from `synthInput.length` (char count) to `Math.ceil(synthInput.length / 4)` (estimated token count).

`synthesisGaps` merged into `envelope.meta.gaps` after `buildRecallResponse`, using the same pattern as `queryWasTruncated` / `expansionUnavailable` (EXP-10 precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Intl.Segmenter does not split `. [block_id]` sentence boundaries**
- **Found during:** Task 1 — Test 4 (D-03+D-09 integration) was failing
- **Issue:** `Intl.Segmenter` uses ICU sentence boundary rules. A period followed by `[` (not a capital letter) is NOT recognized as a sentence boundary, so `"memory 5 gave us the answer. [blk-001] told us more."` was treated as one sentence containing the citation → dropped correctly but the uncited text was preserved in the same segment.
- **Fix:** Added `PRESPLIT_RE = /([.!?])\s+(?=\[)/g` pre-processing step that inserts a sentinel newline before citation-adjacent sentence boundaries. Also updated the regex fallback to `(?<=[.!?])\s+(?=[A-Z[])`.
- **Files modified:** `packages/mcp-server/src/tools.ts`
- **Commit:** 12dc654

**2. [Rule 1 - Bug] tools-integration.test.ts synthesis test used single memory, violating SYN-07**
- **Found during:** Task 2 — `verbosity='synthesis' returns synthesis-populated` test failed
- **Issue:** The test stored one memory before calling recall(). SYN-07 guard correctly skips synthesis when `ranked.length < 2`, so synthesis was null. Test was asserting pre-SYN-07 behavior.
- **Fix:** Added a second `rememberCb` call to store a second memory before recall so `ranked.length >= 2`.
- **Files modified:** `packages/mcp-server/src/__tests__/tools-integration.test.ts`
- **Commit:** 93cc2e4

### ESLint Issues Caught by Pre-commit Hook

Three ESLint issues fixed before commit:
- `@typescript-eslint/no-non-null-assertion` on `trimmedForSynth[i]!` → replaced with null guard
- `no-useless-escape` for `\[` in character class → added eslint-disable comment (bracket inside character class is syntactically valid without escape but semantically intentional)
- `@typescript-eslint/no-non-null-assertion` on `segments[idx]!` → replaced with null guard + continue

## Verification Results

All 6 verification checks from PLAN.md pass:

1. `npx vitest run --project workerd` — 18 test files, 170 tests PASS, 2 skipped (creds-gated evals)
2. `grep -c "synthesis skipped: only one source" tools.ts` → 1 (SYN-07 present)
3. `grep -c "synthesis-preflight" tools.ts` → 2 (throw declaration + catch surface)
4. `grep -n '"synthesis"' tools.ts | grep -v SYNTHESIS_SYSTEM_PROMPT` → 2 writeAnalytics call sites (SYN-09)
5. `grep -c "You are Engram's recall synthesizer" tools.ts` → 1 (SYNTHESIS_SYSTEM_PROMPT unchanged)
6. `npx tsc --noEmit` → exits 0

## Known Stubs

None. All synthesis post-processors are fully implemented and wired into the production recall() path.

## Threat Flags

No new threat surface introduced. All changes are within the existing `tools.ts` synthesis block. The T-04-03-01 prompt injection mitigation (D-09 uncited-sentence drop) is now active — unsupported claims without citation markers are dropped before the synthesis reaches `buildRecallResponse`.

## Self-Check: PASSED

- `/Users/rmoore/Workspaces/engram/packages/mcp-server/src/tools.ts` — FOUND
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/src/__tests__/tools-integration.test.ts` — FOUND
- Commit 12dc654 — FOUND (feat(04-03): export synthesis post-processor helpers)
- Commit 93cc2e4 — FOUND (feat(04-03): wire synthesis block guards + post-processors)
