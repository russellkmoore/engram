---
phase: 01-foundation-wave-0
plan: "03"
subsystem: planning-docs
tags:
  - integration-matrix
  - documentation
  - foundation-wave-0
  - pre-04
dependency_graph:
  requires:
    - 01-01-SUMMARY.md (phase context)
  provides:
    - .planning/research/v0.2-INTEGRATION-MATRIX.md (cross-feature E2E coverage matrix with closure-rule footer for v0.2)
  affects:
    - .planning/research/v0.2-INTEGRATION-MATRIX.md
tech_stack:
  added: []
  patterns:
    - "Byte-fixed status vocabulary (tested | pending | out-of-scope) for grep-based CI gate"
    - "Covering Plan column placeholders (02-04, 03-03, 04-03, 04-04, 04-05, 05-04) linking future plans to matrix rows"
    - "Closure Rule footer binding Phases 2..5 to update rows when integration tests land"
key_files:
  created:
    - .planning/research/v0.2-INTEGRATION-MATRIX.md
  modified: []
decisions:
  - "Status vocabulary frozen to three literal tokens (tested, pending, out-of-scope) — synonyms break Phase 5 INT-04 grep gate"
  - "Em-dash used for blank Test File cells rather than empty string — markdown table rendering and grep-gate compatibility"
  - "Covering Plan placeholders use most-likely plan IDs from the roadmap (02-04, 03-03, 04-03, 04-04, 04-05, 05-04) — not load-bearing; the closure mechanism is"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-06-04"
  tasks: 1
  files_modified: 1
---

# Phase 1 Plan 03: PRE-04 Integration Matrix Summary

Six-pairing cross-feature E2E coverage matrix with byte-fixed status vocabulary (`tested | pending | out-of-scope`) and a Closure Rule footer binding Phases 2..5 to update rows as integration tests land — greppable by Phase 5 INT-04 for zero-pending milestone close.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create v0.2 integration matrix with six pairings and closure rule | 6d74654 | .planning/research/v0.2-INTEGRATION-MATRIX.md |

## What Was Built

**`.planning/research/v0.2-INTEGRATION-MATRIX.md`** — the cross-feature E2E coverage matrix for v0.2. Structure:

- **Status Vocabulary section** — enumerates the three valid tokens (`tested`, `pending`, `out-of-scope`) with one-line definitions. The Phase 5 INT-04 grep gate matches these literals exactly.

- **Coverage Matrix** — six rows, one per cross-feature pairing:

  | Pairing | Covering Plan | Initial Status |
  |---------|---------------|----------------|
  | RNK × CON (ranking + conflict detection) | 02-04 | pending |
  | RNK × EXP (ranking + query expansion) | 03-03 | pending |
  | EXP × SYN (expansion + synthesis) | 04-03 | pending |
  | CON × SYN (conflict detection + synthesis) | 04-04 | pending |
  | kitchen-sink (all four) | 04-05 | pending |
  | adaptive-routing × cosine-edge | 05-04 | pending |

  All Test File cells initialized to em-dash (`—`) — Phase 5 INT-04 will reject `tested` rows with empty Test File cells.

- **Closure Rule footer** — three binding rules for Phases 2..5:
  1. Cell vocabulary is frozen — only `tested`, `pending`, `out-of-scope` are valid
  2. Each plan that lands an integration test MUST update its row (Status → `tested`, fill Test File)
  3. `/gsd:verify-work 5` asserts `grep -c "pending"` = 0 AND every `tested` row has a Test File pointing at a file that exists on disk

## Deviations from Plan

None — plan executed exactly as written. Single-task plan, verification checks all passed.

## Known Stubs

None — the em-dash Test File cells are intentional placeholders documented in the Closure Rule, not stubs. They will be filled by Phase 2..5 plans as integration tests land.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. The file is a planning doc. The plan's threat model (T-03-LIE, T-03-VOCAB) was fully addressed via the Closure Rule footer's Phase 5 INT-04 gate delegation.

## Self-Check: PASSED

File exists and commit verified:

- `test -f .planning/research/v0.2-INTEGRATION-MATRIX.md` → exists ✓
- `git log --oneline | grep 6d74654` → `6d74654 docs(01-03): create v0.2 integration matrix with six pairings and closure rule` ✓
- `grep -cE "^\| (RNK × CON|RNK × EXP|EXP × SYN|CON × SYN|kitchen-sink|adaptive-routing × cosine-edge)" .planning/research/v0.2-INTEGRATION-MATRIX.md` = 6 ✓
- Status column contains only `pending` (all row Status cells) ✓
- `grep -c "## Closure Rule"` = 1 ✓
- `grep -c "verify-work 5"` = 3 ✓
- Full automated verification command from plan exits with ALL CHECKS PASSED ✓
