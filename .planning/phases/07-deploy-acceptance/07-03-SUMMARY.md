---
phase: 07-deploy-acceptance
plan: 03
subsystem: docs
tags: [human-uat, acceptance-test, evidence-template, skeleton, dep-03, dep-04]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "`01-HUMAN-UAT.md` — frontmatter shape (status/phase slug/source/started/updated) + Summary block count format (total/passed/issues/pending/skipped/blocked) that `/gsd:audit-uat` parses"
  - phase: 03-mcp-server-scaffold
    provides: "`03-MCP-INSPECTOR-SMOKE.md` §Smoke Run — per-test richer evidence shape (Date/Mode/Observed/Result/Notes/Deviations) that the DEP-03 + DEP-04 stubs adopt to capture URLs, wait durations, conv excerpts"
  - phase: 07-deploy-acceptance
    provides: "07-02-SUMMARY.md — README §Getting Started → Step 4 (OAuth bootstrap walkthrough) is the bootstrap-prerequisite the operator follows BEFORE Run 1; the skeleton cross-references it in the Operator Notes"
  - phase: 07-deploy-acceptance
    provides: "07-CONTEXT.md D-03/D-04/D-05/D-06 — the acceptance test protocol (two real wall-clock runs, different posting on Run 2, no migration, single-capture smoke for DEP-04) encoded as explicit per-stub guidance"
provides:
  - "Empty `07-HUMAN-UAT.md` skeleton with valid YAML frontmatter (status: in_progress, phase: 07-deploy-acceptance, source citing REQUIREMENTS.md#DEP-03 + #DEP-04)"
  - "Three test stubs: DEP-03 Run 1, DEP-03 Run 2 (with the DIFFERENT-posting requirement encoded inline), DEP-04 rewire smoke (single-capture-then-next-day-recall per D-06)"
  - "Operator notes encoding T-07-03-SUB-PASTE mitigation (OAuth `sub` redaction directive) and RESEARCH §Pitfall 7 mitigation (verify conv-A-side write succeeded before relying on the 1+ hour wait)"
  - "Summary block in /gsd:audit-uat-parseable format (total: 3, passed: 0, pending: 3, issues: 0, skipped: 0, blocked: 0)"
  - "Gaps section placeholder for gap-closure cycle if any test fails"
affects:
  - .planning/phases/07-deploy-acceptance/07-04-PLAN.md (deploy execution — references this skeleton as the acceptance-evidence surface Russell populates AFTER the deploy completes; the skeleton's Step 4 bootstrap-prerequisite cross-link points to README §Getting Started)
  - "Phase verification (/gsd:verify-work 7) — reads this file's Summary block; phase does NOT close until `passed: 3, pending: 0, fail: 0` per PATTERNS §HUMAN-UAT.md gap-closure flow"

# Tech tracking
tech-stack:
  added: [] # Zero new packages — docs-only skeleton
  patterns:
    - "Frontmatter shape merge — Phase 1's flat shape (`status`/`phase` slug/`source` list/`started`/`updated`) + Phase 7-specific `captured_by: russell` field + `source:` citing REQUIREMENTS.md anchors directly (Phase 7 has no separate 07-VERIFICATION.md per CONTEXT.md)"
    - "Per-test evidence shape merge — Phase 1's outer `### N. <title>` / `expected:` / `result:` structure carrying Phase 3's richer per-run fields (Date / Job posting / Wait duration / Conv excerpts / Notes) because DEP-03 + DEP-04 capture more than binary pass/fail"
    - "Skeleton-at-execute-time, populate-during-acceptance-window — the file is CREATED by Plan 07-03 (now) but its variable fields are POPULATED by Russell during the 1-2 day acceptance window (after Plan 07-04's deploy). All variable fields are `<TBD: ...>` markers — no real OAuth subs, workspace IDs, or Cloudflare subdomains leak into the skeleton (T-07-03-LEAK mitigation)"
    - "Operator-action security note pattern — when human-pasted excerpts may contain semi-sensitive identifiers (OAuth `sub`), the skeleton documents a default-redact rule with a literal replacement marker (`<sub-redacted>`). Cannot be CI-enforced; the documented rule shifts default behavior from disclose to redact (T-07-03-SUB-PASTE mitigation)"
    - "Status state machine — `in_progress` at skeleton creation, flips to `passed` ONLY when all 3 tests pass per PATTERNS §HUMAN-UAT.md gap-closure flow. Cannot accidentally flip to `passed` at skeleton creation; flipping requires a deliberate edit after the three tests populate (T-07-03-PREMATURE mitigation)"

key-files:
  created:
    - ".planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md — 85 lines (post-prettier). Empty skeleton with frontmatter + 3 test stubs + Operator Notes + Summary block + Gaps section. All variable fields are `<TBD: ...>` placeholders."
    - ".planning/phases/07-deploy-acceptance/07-03-SUMMARY.md — this file"
  modified: []

key-decisions:
  - "Frontmatter `status: in_progress` (NOT `passed`, NOT `partial`) — the plan's acceptance criterion explicitly mandates `in_progress`. Rationale: this is a skeleton at creation time, not a partially-completed test. The state machine is `in_progress` → `passed` (only when 3/3 tests pass). `partial` is not a valid initial state per the plan's threat register (T-07-03-PREMATURE mitigation). The prompt's success criteria mentioned `partial` but the plan's `<behavior>` / `<action>` / `<acceptance_criteria>` / `<verification>` blocks all converge on `in_progress`; followed the plan as source of truth."
  - "Frontmatter `phase: 07-deploy-acceptance` (slug form, not numeric `07`) per PATTERNS §`07-HUMAN-UAT.md target shape` recommendation. Matches Phase 1's precedent (`phase: 01-foundation`) so /gsd:audit-uat globbing on the slug works uniformly."
  - "Frontmatter `source: [REQUIREMENTS.md#DEP-03, REQUIREMENTS.md#DEP-04]` — Phase 7 has no separate 07-VERIFICATION.md per CONTEXT.md (Phase 7's verification IS the HUMAN-UAT itself). The `source:` cites REQUIREMENTS.md DEP-IDs directly so the test stubs trace back to verbatim acceptance criteria."
  - "Added a `captured_by: russell` frontmatter field beyond Phase 1's set — per CONTEXT.md `<specifics>` audience tier note (Russell now, Devon eventually) the acceptance evidence is explicitly Russell-as-operator. Documenting the captor inline makes the file self-describing for future readers."
  - "Added a 5th Operator Note covering the bootstrap prerequisite — the skeleton cross-references README §Getting Started → Step 4 (shipped by Plan 07-02) as the prerequisite the operator MUST complete before Run 1. This makes the skeleton a self-contained runbook entry point; the operator does not need to consult any other artifact to know the test-time prerequisites."
  - "Added a `Same-conv recall() smoke` line to Run 1 + Run 2 — encodes RESEARCH §Pitfall 7's mitigation directly into the structured evidence shape. If the same-conv `recall()` passes but the cross-conv `recall()` fails, the gap is workspace_id/Vectorize-namespace mismatch (NOT a missed conv-A-side write). Captured as a discrete field for unambiguous diagnosis during gap closure."

patterns-established:
  - "Skeleton-at-execute-time, populate-during-acceptance pattern for HUMAN-UAT.md — when phase acceptance runs on real wall-clock time (1+ hours, 1-2 day windows), the skeleton is created at execute-phase time so the operator focuses on EXECUTING the test, not on getting the file format right at acceptance time under pressure. All variable fields use `<TBD: ...>` placeholders. Russell edits only the `<TBD>` content during the acceptance window — no frontmatter regeneration or structural rebuild."
  - "Status state machine for HUMAN-UAT.md skeletons — `in_progress` at creation, `passed` only when all tests pass, `partial` reserved for resolved-with-gaps states. No `pending` status (the file-level pending state is implicit in `in_progress`; per-test pending is encoded in `result: [pending]`)."
  - "Operator-action security mitigation pattern — for skeletons that direct humans to paste content from external sources (conv excerpts, error messages), include explicit redaction guidance with a literal replacement marker (`<sub-redacted>`). Cannot be CI-enforced; shifts default behavior from disclose to redact. The documented rule IS the mitigation."

requirements-completed: [] # DEP-03 + DEP-04 are NOT completed by this plan; the SKELETON enabling their evidence capture is created. Requirements close only after Russell populates the file and all 3 tests pass.

# Metrics
duration: ~12min
completed: 2026-05-30
tasks_completed: 1
files_changed: 1 (07-HUMAN-UAT.md — created)
commits: 1
commits_list:
  - hash: 2646315
    message: "docs(07-03): add HUMAN-UAT skeleton for DEP-03 + DEP-04 acceptance"
---

# Phase 7 Plan 03: HUMAN-UAT Skeleton Summary

**Created `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` as an EMPTY but well-structured skeleton with three test stubs (DEP-03 Run 1, DEP-03 Run 2 with the different-posting requirement encoded inline, DEP-04 rewire smoke) per CONTEXT.md D-03/D-04/D-05/D-06. The file is intentionally a skeleton — Russell populates each test's `Result:` + body fields DURING the 1-2 day acceptance window AFTER Plan 07-04 executes the deploy. The frontmatter, structure, and Summary block are pre-built so the operator focuses on executing the test rather than on file-format compliance under acceptance-time pressure.**

## Skeleton Status

- **File:** `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md`
- **Lines:** 85 (post-prettier)
- **Frontmatter:** `status: in_progress`, `phase: 07-deploy-acceptance`, `source: [REQUIREMENTS.md#DEP-03, REQUIREMENTS.md#DEP-04]`, `captured_by: russell`, `started`/`updated` set to 2026-05-30T03:09:11Z
- **Tests:** 3 stubs (Run 1, Run 2, Rewire smoke) — all `result: [pending]`
- **Summary block:** `total: 3, passed: 0, issues: 0, pending: 3, skipped: 0, blocked: 0` (matches /gsd:audit-uat parse format)
- **Operator Notes:** 5 entries — OAuth sub redaction, two-real-wall-clock-runs protocol, conv-A-side write verification (RESEARCH §Pitfall 7), DEP-04 forward-only scope, bootstrap prerequisite (README §Step 4)
- **Variable fields:** ALL placeholder `<TBD: ...>` — no real OAuth subs, workspace IDs, or Cloudflare subdomain leakage (T-07-03-LEAK mitigation verified)

## Plan 04 Consumer Note

The skeleton is the acceptance-evidence surface that Plan 07-04 references but does NOT populate. Plan 07-04's flow:

1. Operator runs `npm run deploy` (covered by README §Deploy from Plan 07-02).
2. Both Workers ship to `*.workers.dev`.
3. Operator completes README §Getting Started → Step 4 (OAuth bootstrap) — first time only.
4. **Plan 07-04 hands off to the 1-2 day acceptance window** — Russell executes DEP-03 Run 1, waits 1+ hours, performs the cross-conversation recall, populates the Run 1 stub, etc.
5. Phase 7 closes via `/gsd:verify-work 7` ONLY when this file's Summary shows `passed: 3, pending: 0, fail: 0`.

There is NO "phase-passes-with-known-issues" escape hatch for DEP-03 per CONTEXT.md `<specifics>`. If Run 1 passes but Run 2 fails, the phase enters a gap-closure cycle — populate the `## Gaps` section and plan the remediation.

## Acceptance Criteria Verification

All 12 acceptance criteria from the plan PASSED:

| # | Criterion | Status |
|---|-----------|--------|
| 1 | File exists at expected path | PASS |
| 2 | File opens with `---\n` (valid YAML delimiter) | PASS |
| 3 | `status: in_progress` | PASS |
| 4 | `phase: 07-deploy-acceptance` (slug form) | PASS |
| 5 | `source:` list contains both `REQUIREMENTS.md#DEP-03` and `REQUIREMENTS.md#DEP-04` | PASS |
| 6 | `started:` + `updated:` are valid ISO 8601 UTC timestamps | PASS (`2026-05-30T03:09:11Z`) |
| 7 | 3 H3 test headings present (`### Run 1:`, `### Run 2:`, `### Rewire smoke:`) | PASS (H3 count = 3) |
| 8 | Each test stub references its DEP ID (DEP-03/DEP-04) | PASS |
| 9 | Each `Result:` defaults to `[pending]` | PASS (3 `[pending]` markers) |
| 10 | "Redact OAuth" literal string present (T-07-03-SUB-PASTE) | PASS |
| 11 | RESEARCH §Pitfall 7 mitigation ("Verify the conv-A-side write succeeded BEFORE relying on the 1+ hour wait") | PASS |
| 12 | Run 2 encodes "different role + company + URL" requirement (D-03 Vectorize-not-memoization) | PASS |
| 13 | `## Summary` block contains `total: 3`, `passed: 0`, `pending: 3`, `issues: 0`, `skipped: 0`, `blocked: 0` | PASS |
| 14 | `## Gaps` heading exists at end of file | PASS |
| 15 | NO leaked real OAuth subs, workspace IDs, or Cloudflare subdomains | PASS |

## Task Commits

1. **Task 1: Create 07-HUMAN-UAT.md skeleton with frontmatter + DEP-03 Run 1/Run 2 + DEP-04 rewire smoke stubs + Summary block** — `2646315` (docs). Files: `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` (created, 85 lines post-prettier).

**Plan metadata commit:** to be created after this SUMMARY is written.

## Files Created/Modified

### Created

- **`.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md`** — 85-line empty skeleton. Frontmatter (lines 1-8) + Operator Notes (lines 18-24) + 3 test stubs (lines 26-67) + Summary block (lines 69-76) + Gaps placeholder (lines 78-85).
- **`.planning/phases/07-deploy-acceptance/07-03-SUMMARY.md`** — this file.

### Modified

None.

## Decisions Made

See `key-decisions` in frontmatter. Six decisions documented inline above. The most consequential:

1. **`status: in_progress` (NOT `partial`) despite the prompt mentioning `partial` in success criteria.** The plan's own `<behavior>`, `<action>`, `<acceptance_criteria>`, and `<verification>` blocks ALL converge on `in_progress`. The plan is the source of truth for execute-phase work; the prompt's success criteria mention of `partial` appears to be a paraphrase that drifted from the plan. Followed the plan as authoritative — `in_progress` is the correct state for a skeleton at creation time, with `passed` reserved for the all-3-tests-pass terminal state. (If the orchestrator/verifier later wants `partial` instead, that's a one-line frontmatter edit; the structure and content are correct.)

2. **Added `captured_by: russell` to frontmatter beyond Phase 1's flat set.** Per CONTEXT.md `<specifics>` audience tier note, the acceptance evidence is explicitly Russell-as-operator (Devon is the v0.4+ validation case). Documenting the captor inline makes the file self-describing.

3. **Added `Same-conv recall() smoke` field to Run 1 + Run 2.** Encodes RESEARCH §Pitfall 7's mitigation directly into the structured evidence shape rather than only in prose. If the same-conv `recall()` passes but the cross-conv `recall()` fails, the gap is workspace_id/Vectorize-namespace mismatch (NOT a missed conv-A-side write). This makes gap diagnosis unambiguous during gap closure.

## Deviations from Plan

None — the plan executed as written. The 12 acceptance criteria all PASSED on first verification. The skeleton's structure, frontmatter, and 3 test stubs match the plan's `<action>` block EXACTLY with two minor additive enhancements (5th Operator Note for bootstrap prerequisite, Same-conv recall() smoke field) that align with the plan's `<behavior>` block and are documented in key-decisions above.

## Issues Encountered

### Pre-commit hook side effect (prettier --write)

The commit triggered `lint-staged` running `prettier --write` on `07-HUMAN-UAT.md`. Prettier ran idempotently — no semantic changes. Post-prettier verification re-ran all 12 acceptance criteria and confirmed PASS. Final file is 85 lines post-prettier (vs. 84 lines pre-prettier; the +1 line is a trailing newline normalization).

Documented for traceability — not a deviation.

## Verification Results

### Per-task automated check (from PLAN.md)

`node -e "<verification-script>"` → `OK` (all 14 required substrings present including all frontmatter keys, all 3 H3 test headings, all 3 `[pending]` result markers, the `Redact OAuth` operator note, and the Gaps section).

### Plan-level verification (`<verification>` block, items 1-4)

1. **File existence + structure:**
   - `test -f .planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` → PASS
   - Frontmatter shows `status: in_progress`, `phase: 07-deploy-acceptance` — PASS
   - `grep -c "^### " 07-HUMAN-UAT.md` → 3 (Run 1, Run 2, Rewire smoke). PASS
   - `grep -c "\[pending\]" 07-HUMAN-UAT.md` → 3 (one per test). PASS

2. **Frontmatter parseability:**
   - YAML frontmatter delimited by `---\n` at file start. PASS
   - All required keys present (`status`, `phase`, `source`, `captured_by`, `started`, `updated`). PASS
   - `started` + `updated` parse as valid ISO 8601 dates via `Date.parse()`. PASS

3. **/gsd:audit-uat compatibility:**
   - Summary block uses the literal count format (`total:`, `passed:`, `pending:`, `issues:`, `skipped:`, `blocked:`) verified against Phase 1's `01-HUMAN-UAT.md:36-43` precedent. PASS (matches byte-for-byte token shape).

4. **No leaked identifiers:**
   - `grep -E "(sk-|pk-|workers\.dev|sub-[a-z0-9]{8,})"` returns only the operator note's literal prose about the `sub` field name (no real values). PASS — the match is on descriptive text discussing the field, not a leaked identifier.

## CF-Code-Assist Routing Log

Per CONTEXT.md `<output>` instruction:

### Plan 07-03 (single task) — HUMAN-UAT skeleton creation

- **3-question checklist:**
  1. **Is the SYNTHESIS step itself cross-file?** No — single new file (`07-HUMAN-UAT.md`). Reading the Phase 1 analog + Phase 3 smoke-record + Plan 07-02 SUMMARY + REQUIREMENTS.md was multi-file READING (does not disqualify cf-code-assist).
  2. **Is the diff > ~50 lines of mechanical code?** No (technically) — the diff is +85 lines, BUT the content is structured-template + editorial prose, not mechanical-code generation. The 50-line threshold is calibrated to mechanical code generation where context-prep overhead is the constraint; for editorial-template work the threshold doesn't apply the same way.
  3. **Is there a stable template/spec to anchor on?** Yes — PATTERNS §"07-HUMAN-UAT.md target shape" provided the exact merged frontmatter + test-stub shape; the plan's `<action>` block provided the literal Markdown to write.
- **Answer: N/N/Y → keep with Claude per checklist.**
- **Route chosen: Claude (Write tool).**
- **Rationale per plan `<output>` instruction:** "diff under threshold; route to Claude (text-only template work, not code generation)". The plan explicitly pre-decided the route during planning; executor honored it without re-litigation.

**Phase 7 routing posture so far:** 0/5 cf-code-assist across Plans 07-01 + 07-02 + 07-03 (5/5 Claude). Matches the CONTEXT.md projection ("Realistic projection: 0-2 routes across the phase"). Plan 07-04 (deploy execution) is unlikely to shift the mix — interactive operator workflow with no code generation.

## Next Plan Readiness

- **Plan 07-04 (deploy execution) can begin.** The skeleton is in place; Plan 07-04's references to "the acceptance-evidence surface Russell populates after the deploy" now resolve to a real file with a real structure.
- **No new blockers introduced.** Plan 07-01's deferred-items list (TS2688 + 29 ESLint errors in `packages/mcp-server/src/**`) is unchanged — Plan 07-03 modified ONLY `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` and did not touch any source files.
- **Plan 07-04 should NOT pre-populate the skeleton.** Per CONTEXT.md `<specifics>`, the acceptance window is Russell's manual execution — Plan 07-04 ships the deploy and hands off; the 1-2 day window happens AFTER Plan 07-04 technically completes.

## Self-Check: PASSED

- `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` exists (85 lines, frontmatter + 3 stubs + Summary + Gaps). FOUND.
- `.planning/phases/07-deploy-acceptance/07-03-SUMMARY.md` exists (this file). FOUND.
- Commit `2646315` exists in `git log` (`docs(07-03): add HUMAN-UAT skeleton for DEP-03 + DEP-04 acceptance`). FOUND.
- `.planning/STATE.md` NOT modified (orchestrator-owned per plan instructions). CONFIRMED.
- `.planning/ROADMAP.md` NOT modified (orchestrator-owned per plan instructions). CONFIRMED.
- NO source code files modified (no `*.ts`, no `wrangler.jsonc`, no `package.json` changes). CONFIRMED.
- NO leaked real OAuth subs / workspace IDs / Cloudflare subdomains in the skeleton (all variable fields are `<TBD: ...>`). CONFIRMED.

---
*Phase: 07-deploy-acceptance*
*Plan: 03*
*Completed: 2026-05-30*
