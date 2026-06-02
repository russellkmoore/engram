# Phase 7: Deploy + Acceptance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in 07-CONTEXT.md — this log preserves the discussion flow.

**Date:** 2026-05-29
**Phase:** 07-deploy-acceptance
**Mode:** discuss (default)
**Areas selected:** First-run OAuth bootstrap UX, Acceptance test ritual, Job-search agent rewire scope, Setup automation completeness

---

## Area 1 — First-run OAuth bootstrap UX (DEP-02)

### Q1: How should the first-run OAuth bootstrap work?

**Options presented:**
1. Manual paste-the-sub from error (current oauth.ts design)
2. Interactive script (`kv:bootstrap-interactive`)
3. Both — ship manual now, document interactive as v0.4 work

**User selection:** Option 3 — Both: ship manual now, document interactive as v0.4 work.

**Captured as:** D-01.

### Q2: Where in the README should the bootstrap flow live?

**Options presented:**
1. Inline in Getting Started as Step 4 of the happy path
2. Dedicated "First-run bootstrap" section after Getting Started
3. In Troubleshooting under the literal error string

**User selection:** Option 1 — inline in Getting Started as Step 4.

**Captured as:** D-02.

---

## Area 2 — Acceptance test ritual (DEP-03)

### Q1: What's the protocol for "passes on at least two consecutive runs"?

**Options presented:**
1. Two real 1-hour runs over 1-2 days
2. Two same-day runs, 1+ hour gap each
3. Two runs, one real-time + one fast-forward via long conversation

**User selection:** Option 1 — two real 1-hour runs over 1-2 days.

**Captured as:** D-03.

### Q2: How should the acceptance test evidence be captured?

**Options presented:**
1. `07-HUMAN-UAT.md` with the 2 runs as test entries
2. Append to 07-SUMMARY.md as a "Verification log" section
3. External log only (Linear comment on ENG-7)

**User selection:** Option 1 — HUMAN-UAT.md as standard GSD pattern.

**Captured as:** D-04.

---

## Area 3 — Job-search agent rewire scope (DEP-04)

### Q1: What's the existing job-search agent's memory backend right now?

**Options presented:**
1. Local file (JSON / markdown notes)
2. Notion / external SaaS
3. Local sqlite / lightweight DB
4. No persistent backend yet — ad-hoc per conversation

**User selection (via "Other"):** "Local files - markdown notes, JSON files possibly, XLS file for a local DB, however I do not care about importing existing data at the start."

**Captured as:** D-05 (extended to formalize NO migration as a permanent decision, not just a v0.1 simplification).

### Q2: How do we verify "no regression in the agent's capture path" after the rewire?

**Options presented:**
1. Smoke test: capture 1 new job, verify it lands in Engram + agent can recall it next conversation
2. Side-by-side run for N days (capture to BOTH old files AND Engram, compare)
3. Cutover immediately, no verification — trust the acceptance test (DEP-03)

**User selection:** Option 1 — smoke test as a HUMAN-UAT entry.

**Captured as:** D-06.

---

## Area 4 — Setup automation completeness (DEP-01 + DEP-05)

### Q1: What should `npm run setup` do?

**Options presented:**
1. Extend to include setup:queue
2. Extend further: setup:queue + a deploy hint at the end
3. Leave as-is; add setup:queue to the README's manual setup list

**User selection:** Option 2 — extend to include setup:queue + final deploy hint echo.

**Captured as:** D-07.

### Q2: Deploy command — wrapper script or documented manual?

**Options presented:**
1. `npm run deploy` wrapper that deploys both Workers in order
2. Documented manual deploy per package, no wrapper
3. `npm run deploy` for default + `npm run deploy:mcp` / `deploy:triage` for per-package

**User selection:** Option 3 — wrapper + per-package commands.

**Captured as:** D-08.

---

## Deferred / Out of Scope

Surfaced during discussion and captured in CONTEXT.md `<deferred>`:

- v0.4 `kv:bootstrap-interactive` script (named in D-01)
- v0.3+ pre-Engram job history migration (explicitly excluded by D-05)
- `--env dev` vs `--env prod` separation (Claude's Discretion → v0.3)
- Drop `mcp-remote` for native Streamable HTTP (when Claude Desktop adds support)
- CI/CD pipeline / GitHub Actions deploy
- Monitoring dashboards beyond Cloudflare built-ins

## Reviewed Todos (not folded)

Three Phase 4/5 todos matched on keyword overlap but are unrelated to Phase 7 scope. All confirmed already addressed in their original phases:

- 2026-05-26-phase-4-raw-chunks-escape-hatch.md (Phase 4 closed)
- 2026-05-26-phase-4-spike-workers-ai-extraction-quality.md (Phase 4 closed)
- 2026-05-26-phase-5-cold-storage-not-discard.md (Phase 5 D-07 implemented cold-storage routing)

---

*Generated 2026-05-29 during /gsd:discuss-phase 7*
