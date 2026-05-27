---
phase: "04"
plan: "05"
subsystem: "mcp-server"
tags: ["docs", "TOL-08", "DEP-05", "smoke-test", "README", "phase-5-handoff", "checkpoint"]
dependency_graph:
  requires:
    - "04-01: envelope.test.ts, tools-integration.test.ts, cross-workspace-pentest.test.ts, token-budget.test.ts (Wave 0 RED)"
    - "04-02: envelope.ts honest-stub builders + META_GAPS byte-frozen strings"
    - "04-03: tools.ts live handler bodies (5 tools)"
    - "04-04: TOL-07 + MCP-08 behavioral proofs GREEN"
    - "03-MCP-INSPECTOR-SMOKE.md: structural analog for artifact shape"
  provides:
    - "04-MCP-INSPECTOR-SMOKE.md: TOL-08 LOCAL smoke procedure artifact (deferred -> resolved after human-verify)"
    - "README.md ## Tool Surface (v0.1): DEP-05 amendment with per-tool request/response/honest-stub/token-budget/error docs"
    - "04-PHASE-5-HANDOFF.md: envelope field population map + META_GAPS removal map + Wave 0 RED test pointers"
  affects:
    - "Phase 5: handoff note is Phase 5 discussant's starting document"
    - "04-VALIDATION.md: Wave 4 complete + nyquist_compliant=true (pending Task 05-05 after smoke passes)"
    - "README public-facing contract: every consumer reads Tool Surface before wiring Engram"
tech_stack:
  added: []
  patterns:
    - "Smoke artifact as recorded artifact (Phase 3 analog mirror)"
    - "DEP-05 README amendment: doc cites live builders as source of truth (T-04-DOC-DRIFT mitigation)"
    - "Phase-to-phase handoff note format (Phase 4 -> Phase 5 planner-to-planner protocol)"
key_files:
  created:
    - ".planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md"
    - ".planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md"
  modified:
    - "README.md (additive: ## Tool Surface (v0.1) section inserted between ## Getting Started and ## Architecture Deep Dive)"
decisions:
  - "TOL-08 scope boundary: LOCAL smoke only in this plan; full Russell-agent reconfig is DEP-04 in Phase 7"
  - "DEP-05 Amendment: Phase 3 deferred README response-shape rows because only MethodNotFound stubs existed; Phase 4 amends now that contract is concrete"
  - "Verbosity default 'both' documented with spike-findings rationale (BORDERLINE band recovery surface)"
  - "forget() is the one non-stubbed tool — fully implemented in v0.1 (blocks + relations deleted, idempotent on missing id)"
metrics:
  duration: "~6 minutes (Tasks 05-01, 05-03, 05-04 — auto tasks completed before checkpoint)"
  completed: "2026-05-27"
  tasks_completed: 3
  tasks_pending: 2
  files_created: 2
  files_modified: 1
---

# Phase 4 Plan 05: Wave 4 Documentation + Smoke Procedure Summary

Wave 4 (FINAL) documentation artifacts delivered: TOL-08 smoke procedure written and staged for
human execution, DEP-05 README amendment landed with the concrete v0.1 tool surface contract,
and Phase 5 hand-off note produced. Tasks 05-03 and 05-04 were completed before the checkpoint
(no dependency on smoke outcome); Task 05-02 (smoke execution) halted for human-verify; Task
05-05 (VALIDATION.md close-out) awaits smoke approval.

## Tasks Completed (Pre-Checkpoint)

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 05-01 | Write 04-MCP-INSPECTOR-SMOKE.md procedure artifact | `57995bd` | `.planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md` |
| 05-03 | Append Tool Surface (v0.1) to README (DEP-05 amendment) | `0859203` | `README.md` |
| 05-04 | Write 04-PHASE-5-HANDOFF.md | `bd29717` | `.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md` |

## Tasks Pending (Post-Smoke-Checkpoint)

| Task | Name | Blocked By |
|------|------|------------|
| 05-02 | Execute LOCAL MCP Inspector smoke + record results (TOL-08 acceptance) | Human-verify checkpoint |
| 05-05 | Final regression + VALIDATION.md close-out | Requires `04-MCP-INSPECTOR-SMOKE.md` status: resolved |

## What Was Built

### 04-MCP-INSPECTOR-SMOKE.md (Task 05-01)

A procedure artifact in `deferred` state, mirroring Phase 3's `03-MCP-INSPECTOR-SMOKE.md`
structure. Documents the 4-call round-trip procedure (remember -> recall verbosity=both ->
forget cascade=true -> recall post-forget), 12 acceptance criteria with all canonical META_GAPS
strings verbatim, T-04-LEAK sanitization guidance, and explicit DEP-04 Phase 7 scope boundary
(LOCAL smoke only in this plan; Russell-agent reconfig deferred).

### README.md Tool Surface Section (Task 05-03)

New `## Tool Surface (v0.1)` section inserted between `## Getting Started` and
`## Architecture Deep Dive`. Per-tool documentation (5 tools) with:
- Request shape from `schemas.ts` (source of truth)
- Response shape from `envelope.ts` builders (byte-compatible with `buildXResponse()` output)
- Honest-stub table: v0.1 null/empty fields + Phase 5 population source (AI-02/AI-04/AI-05)
- Cross-cutting subsections: common envelope fields, token budget (7,500 cl100k tokens,
  `gpt-tokenizer/encoding/cl100k_base`), error codes (-32602/-32600/-32603), source-of-truth
  file cross-refs

### 04-PHASE-5-HANDOFF.md (Task 05-04)

Phase 5 discussant's starting document. Contains:
- Envelope Field Population Map table (10 rows: every field Phase 5 populates)
- META_GAPS removal map: 3 strings Phase 5 removes + 1 string that is Phase 6 (NOT Phase 5)
- ingest() hand-off: Phase 6 one-line diff, Phase 5 must NOT touch ingest body
- Wave 0 RED tests: 4 test files + Phase 5 assertion deltas for each
- 5 DO NOT rules locking Phase 4 contract invariants
- Real-Corpus Validation Gate carry-forward: F1 < 75% blocks AI-04
- Required reading list with rationale (spike-findings skill, CONTEXT.md, envelope.ts)

## Deviations from Plan

### Pre-existing lint/typecheck failures (scope boundary)

**Found during:** Task 05-03 (README amendment)
**Issue:** `npm run lint` exits non-zero (11 errors in `index.test.ts` and `oauth.ts`) and
`npm run typecheck` exits non-zero (worker-configuration.d.ts missing) — both were failing
before any changes in this plan.
**Scope ruling:** Pre-existing failures in files not touched by this plan are out of scope
per deviation scope boundary rules. README.md contains no TypeScript; the plan's acceptance
criteria for `npm run lint` and `npm run typecheck` could not be satisfied as written because
the pre-existing baseline already fails.
**Logged to:** `deferred-items.md` (see below).
**No fix applied** — out of scope.

### Task ordering adjustment

Tasks 05-03 and 05-04 were executed BEFORE the human-verify checkpoint at Task 05-02
(instead of strictly after). Rationale: these tasks have no dependency on the smoke outcome
and completing them pre-checkpoint reduces continuation agent work. Task 05-05 (which
explicitly checks `status: resolved`) correctly remains post-checkpoint.

## Known Stubs

None — this plan is documentation-only. The smoke artifact's `## Smoke Run` section contains
a TBD placeholder intentionally; this is not a stub in the data-flow sense but a gate pending
Task 05-02 execution.

## Threat Flags

None — no new attack surface introduced. All changes are documentation-only.

## Cross-References (Prior Plan SUMMARYs)

- [`04-01-SUMMARY.md`](./04-01-SUMMARY.md) — Wave 0 RED tests (4 test files) + type widening
- [`04-02-SUMMARY.md`](./04-02-SUMMARY.md) — `envelope.ts` honest-stub builders + `trimToBudget` + META_GAPS
- [`04-03-SUMMARY.md`](./04-03-SUMMARY.md) — 5 live handler bodies in `tools.ts` + TOL-01..05 GREEN
- [`04-04-SUMMARY.md`](./04-04-SUMMARY.md) — TOL-07 cross-workspace pentest + MCP-08 token-budget behavioral proofs

## Self-Check: PARTIAL (checkpoint)

This summary covers Tasks 05-01, 05-03, and 05-04 only. Tasks 05-02 and 05-05 are pending
the human-verify smoke gate. The continuation agent (after smoke approval) will:
1. Execute the smoke procedure per `04-MCP-INSPECTOR-SMOKE.md`
2. Update frontmatter to `status: resolved` + `resolved_at: YYYY-MM-DD`
3. Run `npm run test --workspaces --if-present` (zero regressions expected)
4. Update `04-VALIDATION.md` to mark `nyquist_compliant: true` + Wave 4 complete
5. Commit with message from Task 05-05 spec

**Created files exist:**

- `57995bd` (Task 05-01): `.planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md` — CONFIRMED
- `0859203` (Task 05-03): `README.md` Tool Surface section — CONFIRMED
- `bd29717` (Task 05-04): `.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md` — CONFIRMED
