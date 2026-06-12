# Phase 5: Integration Kitchen Sink - Discussion Log

> **Audit trail only.** Not consumed by planning/research/execution agents. Decisions live in `05-CONTEXT.md`.

**Date:** 2026-06-10
**Phase:** 05-integration-kitchen-sink
**Mode:** discuss (standard)
**Areas presented:** Matrix closure strategy, INT-01 token budget, INT-03 pentest shape, INT-05 smoke model
**Areas selected for discussion:** Matrix closure strategy, INT-01 token budget, INT-03 pentest shape

## Area Selection

User selected 3 of 4 offered gray areas. INT-05 (smoke model) was not selected → resolved at Claude's discretion in CONTEXT.md with a documented default + flagged ambiguity for the planner.

## Matrix closure strategy (INT-04)

- **Options presented:** (1) Audit-first, then fill + scope [recommended]; (2) Author all 6 fresh; (3) Consolidate into one kitchen-sink suite.
- **User selection:** Audit-first, then fill + scope.
- **Notes:** Claude flagged that the `adaptive-routing × cosine-edge` matrix row maps to real v0.2 code (EXP-03 routing + EXP-10 429 retry), not stale v0.1 work — so the audit biases toward testing, marking `out-of-scope` only when a path is genuinely absent/redundant. → D-01, D-02, D-03.

## INT-01 token budget

- **Options presented:** (1) Post-trim ≤budget + content preserved [recommended]; (2) Pre-trim measurement + meta.gaps; (3) Literal ≤8K post-trim only.
- **User selection:** Post-trim ≤budget + content preserved.
- **Notes:** Driving insight surfaced before the question — `trimToBudget` already guarantees ≤7,500 post-trim, so a bare ≤8K post-trim assertion is trivially true. The teeth come from asserting trim preserves `result.synthesis` + high-severity `context.conflicts[]`. → D-04, D-05, D-06.

## INT-03 pentest shape

- **Options presented:** (1) Extend file, Prong-A per path, mirror C [recommended]; (2) Separate file per path; (3) Forge-arg (Prong B) depth per path.
- **User selection:** Extend file, Prong-A per path, mirror C.
- **Notes:** 4 new paths split across two Workers — 3 in mcp-server (extend the existing pentest file), conflict-pipeline writes in triage-worker (own isolation case in that package). Generic Prong B backstop not duplicated per path. → D-07, D-08, D-09, D-10, D-11.

## Claude's Discretion / Deferred

- INT-02 (envelope backward-compat): straightforward — existing `envelope.test.ts` + snapshot unchanged; non-breaking additive shape assertions for new optional fields.
- INT-05 (e2e smoke): default split into automated local `wrangler dev` smoke (CI-runnable) + documented manual against-staging ritual (not PR-blocking); planner confirms staging reachability.
- Deferred: 999.2 (all-uncited synthesis floor), 999.3 (judge robustness), verbosity default flip (v0.3). None in Phase 5 scope.
