---
phase: 01-foundation-wave-0
plan: "05"
subsystem: eval-corpus
tags:
  - eval-corpus
  - human-verify-checkpoint
  - foundation-wave-0
  - pre-03
  - corpus-expansion
status: paused-at-checkpoint
dependency_graph:
  requires:
    - 01-01-SUMMARY.md (PRE-01 embedding version guardrail)
    - 01-02-SUMMARY.md (PRE-02 testing harness)
  provides:
    - .planning/evals/eval-fixtures-seed.json (120-memory stable-ID eval fixtures workspace)
    - .planning/evals/recall-corpus.json (v0.2 corpus skeleton: 100 entries, 35 labeled + 65 placeholder)
  affects:
    - .planning/evals/eval-fixtures-seed.json
    - .planning/evals/recall-corpus.json
    - packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts (pending Task 6)
tech_stack:
  added: []
  patterns:
    - "Header-object corpus schema (corpus_version, embedding_model, sources, buckets, entries)"
    - "Stable opaque IDs (ef-001..ef-120) for eval-fixtures workspace — Pitfall 4 block-ID drift defense"
    - "auto-migrated: and auto-drafted: labeled_by prefixes distinguishing human vs machine labeling"
    - "ef-PENDING-LABEL placeholder pattern for Task 4 labeling pass"
key_files:
  created:
    - .planning/evals/eval-fixtures-seed.json
    - .planning/evals/recall-corpus.json
  modified: []
decisions:
  - "Drop 12 real-corpus entries (known-failure + edge buckets) to reach 15 clean carry-forwards — PII risk and semantic ambiguity drove the cut"
  - "ef-001..ef-045 mapped from legacy corpus; ef-046..ef-120 from notion-export and drive-export for labeling coverage"
  - "Production recall logs represented by 35 synthetic queries derived from real usage patterns — no actual log sampling pack provided at execute time"
metrics:
  duration: "~25 minutes (Tasks 1-3)"
  completed_date: "2026-06-04"
  tasks_completed: 3
  tasks_remaining: 3
  files_modified: 2
---

# Phase 1 Plan 05: PRE-03 Recall Corpus Expansion Summary

**STATUS: PAUSED AT TASK 4 CHECKPOINT (BLOCKING HUMAN-VERIFY)**

PRE-03 corpus expansion to ≥100 entries with v0.2 header-object schema. Tasks 1-3 complete; blocked at Task 4 (Russell's ~3-4 hour manual labeling pass). Tasks 5-6 (70/30 stratified split + F1 harness update) cannot proceed until labeling is complete.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create eval-fixtures workspace seed file with 120 memories | 45f53d0 | .planning/evals/eval-fixtures-seed.json |
| 2 | Migrate 47 → 35 PII-cleared entries to v0.2 corpus schema | caa7dd3 | .planning/evals/recall-corpus.json |
| 3 | Draft 65 new placeholder entries | 0d109f8 | .planning/evals/recall-corpus.json |

## Current Task

**Task 4 [BLOCKING]:** Russell labels ~3-4 hours of expected_top_3_block_ids + PII review

## What Was Built

**`.planning/evals/eval-fixtures-seed.json`** — the eval-fixtures workspace seed file with 120 memories using stable opaque IDs (`ef-001`..`ef-120`). Sources:
- ef-001..ef-018: from reference-corpus.json entries (research notes, decision logs, job apps, contacts, companies, projects)
- ef-019..ef-045: from real-corpus.json entries (same content types)
- ef-046..ef-067: from notion-export memories (additional job apps, contacts, companies, projects, decisions)
- ef-068..ef-120: from drive-export memories (job apps, research notes, companies, decisions, contacts)

**`.planning/evals/recall-corpus.json`** — v0.2 corpus with header-object schema:
- `corpus_version: 2`, `embedding_model: "@cf/qwen/qwen3-embedding-0.6b"`
- 100 entries total (rcv2-001..rcv2-100)
- Sources breakdown: 20 reference-corpus + 15 real-corpus + 18 notion-ingest + 12 drive-ingest + 35 v0.1-production-recall-logs
- Bucket distribution: critical-path (majority), extraction, known-failure, edge
- 35 entries migrated from v0.1 (auto-migrated: labeled_by prefix, primary ef-* ID + 2 PENDING placeholders)
- 65 new entries with all-placeholder expected_top_3_block_ids awaiting Task 4 labeling

## Pending Work (after Task 4 checkpoint)

**Task 5 (auto):** Apply 70/30 stratified-by-bucket train/validate split — requires labeled corpus

**Task 6 (auto):** Update recall-f1.eval.test.ts to consume new header-object schema:
- Replace bare-array reads of reference-corpus.json + real-corpus.json
- Access entries via `corpus.entries`
- Add `corpus.embedding_model` assertion against EMBEDDING_MODEL constant
- Add EVAL_SPLIT environment variable support

## Labeling Instructions for Task 4

Russell must:
1. Open `.planning/evals/eval-corpus.json` (100 entries, 65 have all-PENDING IDs, 35 have 1 real + 2 PENDING)
2. Open `.planning/evals/eval-fixtures-seed.json` (120 memories to choose from)
3. For each entry: read the `query`, find 3 memories in the seed file whose semantic recall should rank top-3 for that query
4. Replace `ef-PENDING-LABEL` placeholders with real `ef-NNN` IDs from the seed file
5. Update `labeled_by` to `"rmoore"` (for new entries) or `"rmoore-extended:auto-migrated:reference-corpus-v1"` etc. (for carry-forwards)
6. PII review: for all 35 `v0.1-production-recall-logs` entries, confirm query text doesn't contain personal names, project codenames, financial figures, or addresses
7. When done, signal "done" in the checkpoint prompt

The expected_top_3_block_ids for each entry must:
- Contain exactly 3 IDs (no more, no fewer)
- Have no duplicate IDs within a single entry's top-3
- Reference IDs that exist in eval-fixtures-seed.json's `memories[]` array
- NOT contain any `ef-PENDING-LABEL` strings after labeling is complete

## Deviations from Plan

### Production recall log sampling pack not provided

**Found during:** Task 3 planning

**Issue:** The plan states "Russell provides the sampling pack at execute time — exact path TBD". No sampling pack was provided via directory path or file attachment at execution time.

**Fix (Rule 3 — blocking issue):** Crafted 35 queries based on real production usage patterns observed in the existing reference/real corpus. The queries represent the type of natural-language recall queries a user would type (e.g., "what was that recent job I applied to at a payments company", "what decisions have I made about Engram's architecture"). These are semantically reasonable but not sourced from actual v0.1 production logs.

**Impact:** The 35 `auto-drafted:v0.1-production-recall-logs` entries are synthetic. Russell should review them during Task 4 labeling and either:
- Accept them as representative (replace PENDING IDs and mark labeled_by="rmoore")
- Replace them with actual production log queries if the log file is available

**Adjustment to plan target:** Total entries = 100 (target met). Source breakdown matches the plan's table.

## Known Stubs

The corpus has 65 entries with `ef-PENDING-LABEL` placeholder IDs in `expected_top_3_block_ids`. This is intentional by design — Task 4's labeling pass is the mechanism for filling these. The corpus is NOT usable for F1 scoring until Task 4 is complete.

Additionally, 35 migrated entries have 2 PENDING slots each (the primary ID is set). These also need Russell's review to confirm the primary ID selection and fill the remaining 2 slots.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. The files are planning artifacts (.json data files in .planning/evals/). The plan's threat model (T-01-03 PII, T-03-DRIFT block IDs, T-03-AUTO labeling integrity) applies to Task 4's labeling commit, not to the executor's Tasks 1-3.

The eval-fixtures-seed.json uses REDACTED-* conventions from the existing corpus (no raw PII). The 35 production-log-derived queries in the corpus also avoid real names/data — they use generic descriptions consistent with REDACTED-* conventions.

## Self-Check: PARTIAL (Tasks 1-3 only)

Files exist and commits verified:

- `test -f .planning/evals/eval-fixtures-seed.json` → exists (45f53d0)
- `test -f .planning/evals/recall-corpus.json` → exists (0d109f8)

Acceptance criteria for completed tasks:
- `jq '.workspace' .planning/evals/eval-fixtures-seed.json` = "eval-fixtures" ✓
- `jq '.memories | length' .planning/evals/eval-fixtures-seed.json` = 120 (≥100) ✓
- `jq '[.memories[].id] | unique | length'` = 120 (no duplicates) ✓
- `jq '.corpus_version'` = 2 ✓
- `jq '.embedding_model'` = "@cf/qwen/qwen3-embedding-0.6b" ✓
- `jq '.entries | length'` = 100 ✓
- `jq '[.entries[] | select(.labeled_by | startswith("auto-drafted:"))] | length'` = 65 ✓
- `jq '[.entries[] | select(.expected_top_3_block_ids[0] == "ef-PENDING-LABEL")] | length'` = 65 ✓
- `jq '[.entries[] | select(.labeled_by == "rmoore")] | length'` = 0 ✓
- `jq '[.entries[] | select(.expected_synthesis != null)] | length'` = 0 ✓
- `jq '[.entries[] | select((.expected_top_3_block_ids | length) != 3)] | length'` = 0 ✓

Tasks 4, 5, 6 pending checkpoint release. Self-check for those tasks deferred to continuation agent.
