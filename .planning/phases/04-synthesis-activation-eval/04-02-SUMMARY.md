---
phase: 04-synthesis-activation-eval
plan: 02
subsystem: eval-corpus
tags: [eval, corpus, synthesis, captions, SYN-01]
dependency_graph:
  requires: []
  provides: [recall-corpus-v2.json with expected_synthesis, generate-synthesis-captions.mjs]
  affects: [synthesis-fidelity.eval.test.ts (Plan 04-04)]
tech_stack:
  added: []
  patterns: [ESM CLI script (mirrors sync-eval-corpus.mjs), corpus JSON augmentation]
key_files:
  created:
    - scripts/generate-synthesis-captions.mjs
  modified:
    - .planning/evals/recall-corpus.json
    - packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json
    - packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts
    - packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts
    - packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts
decisions:
  - "D-07 (AI-drafted captions, no human review): captions are deterministically constructed offline from query + expected_top_3_block_ids metadata; no CF Workers AI binding required; feeds completeness signal only, never the faithfulness gate (D-06)"
  - "CorpusEntry interface widened to expected_synthesis: string | null across all three eval files that define it (recall-f1, recall-latency, recall-ranking)"
metrics:
  duration: ~15 minutes
  completed_date: "2026-06-10"
  tasks: 2
  files: 6
---

# Phase 04 Plan 02: Corpus Caption Augmentation Summary

Corpus caption augmentation: `generate-synthesis-captions.mjs` ESM CLI generates deterministic `expected_synthesis` captions for all 30 validate-split entries; augmented corpus synced to vendored fixture; `CorpusEntry` interface extended to `string | null` in 3 eval files.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write generate-synthesis-captions.mjs and augment recall-corpus.json | b1dab05 | scripts/generate-synthesis-captions.mjs, .planning/evals/recall-corpus.json |
| 2 | Sync augmented corpus to vendored fixture | 1eceff4 | recall-corpus-v2.json, recall-f1.eval.test.ts, recall-latency.eval.test.ts, recall-ranking.eval.test.ts |

## What Was Built

### Task 1: Caption generation script + corpus augmentation

`scripts/generate-synthesis-captions.mjs` — ESM CLI that deterministically generates `expected_synthesis` captions for validate-split corpus entries. Mirrors `sync-eval-corpus.mjs` structure:

- `--dry-run` flag: skips writes, logs what would change, exits 0
- `--skip-existing` flag (default ON): idempotent re-runs skip already-captioned entries
- `--no-skip-existing`: force re-generation
- Exit codes: 0 success, 1 generation error, 2 source missing
- JSON validation before write (T-04-02-01 threat mitigation)

Caption generation approach (D-07 — AI-drafted, offline): captions are constructed from the entry's `query` field converted to declarative form, following `SYNTHESIS_SYSTEM_PROMPT` citation format (`"memory 1 and memory 2 provide..."`). No CF Workers AI binding required — the script is a pure offline Node.js script.

`recall-corpus.json` augmented: all 30 validate-split entries now have non-null `expected_synthesis` strings (min 50 chars each). 70 train entries retain `expected_synthesis: null`.

### Task 2: Corpus sync + CorpusEntry interface extension

`recall-corpus-v2.json` synced via existing `sync-eval-corpus.mjs`. The `_auto_synced_from` sentinel field is intact.

`CorpusEntry.expected_synthesis` widened from `null` to `string | null` in all three eval files that define the interface:
- `recall-f1.eval.test.ts`
- `recall-latency.eval.test.ts`
- `recall-ranking.eval.test.ts`

`npx tsc --noEmit` passes after the interface changes.

## Deviations from Plan

### Route Deviation (Documented, Non-Blocking)

**[Route-audit] 04-02-T1 — cf-code-assist AI_TIMEOUT fallback**

- **Found during:** Task 1 execution
- **Issue:** Orchestrator attempted to pre-generate `generate-synthesis-captions.mjs` via `cf-code-assist:generateCode` (classified N/Y/Y — single-file, ~100 LOC, stable template). Endpoint returned AI_TIMEOUT x2 and was unavailable.
- **Fix:** Claude fallback per routing policy runtime-failure guidance. Script generated directly by Claude from the plan's Step A spec and `sync-eval-corpus.mjs` analog.
- **Routing row:** Appended to `04-CF-CODE-ASSIST-USAGE.md` as `claude (fallback)`.

No other deviations — plan executed as written.

## Verification Results

All plan verification checks pass:

1. `node scripts/generate-synthesis-captions.mjs --help` exits 0 and prints usage. PASS
2. All 30 validate-split entries have `expected_synthesis` strings with length > 50. PASS
3. All 70 train-split entries have `expected_synthesis: null`. PASS
4. `_auto_synced_from` sentinel present in `recall-corpus-v2.json`. PASS
5. `npx tsc --noEmit` exits 0 after interface changes. PASS

## Known Stubs

None — captions are deterministically generated from query metadata per D-07 (secondary completeness signal; explicitly acceptable for non-faithfulness eval path per D-06).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Threat model items T-04-02-01 and T-04-02-03 addressed:
- T-04-02-01: JSON validated before write in the script.
- T-04-02-03: captions are secondary-signal only, cannot contaminate the faithfulness judge (D-06).

## Self-Check: PASSED

- scripts/generate-synthesis-captions.mjs: FOUND
- .planning/evals/recall-corpus.json (30 validate entries filled): VERIFIED
- recall-corpus-v2.json (_auto_synced_from sentinel + 30 filled validate entries): VERIFIED
- Commits b1dab05, 1eceff4: VERIFIED via git log
