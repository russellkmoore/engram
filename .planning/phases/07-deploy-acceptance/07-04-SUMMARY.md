---
plan: 07-04
phase: 07-deploy-acceptance
status: complete
completed: 2026-05-30
key_files:
  created:
    - .planning/phases/07-deploy-acceptance/07-04-SUMMARY-PARTIAL.md (superseded by this file)
  modified:
    - .planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md (populated during acceptance window)
    - .planning/REQUIREMENTS.md (DEP-04 dropped from v0.1 scope)
    - .planning/ROADMAP.md (DEP-04 dropped from Phase 7 success criteria)
    - packages/triage-worker/evals/triage-extraction.promptfoo.yaml (rebuilt for promptfoo 0.121.x)
    - packages/triage-worker/evals/load-fixtures.mjs (new — fixture loader)
    - eslint.config.mjs (extend allowDefaultProject for evals dir)
    - package.json (fix evals:promptfoo flag)
---

# Plan 07-04 Summary — Deploy + Acceptance Execution

## One-liner

Shipped both Workers to Russell's Cloudflare account, walked through the OAuth bootstrap, and verified the v0.1 binding acceptance test (remember in conv A → recall in fresh conv B 9+ hours later) twice with different job postings.

## Goal achieved

Plan 07-04's `<objective>` was to execute the Phase 7 deploy + acceptance protocol — Task 1 (deploy) + Tasks 2-4 (human-gated checkpoints for OAuth bootstrap, two DEP-03 acceptance runs, DEP-04 rewire smoke).

**Outcome:** DEP-01, DEP-02, DEP-03 (both runs) PASSED. DEP-04 DROPPED from v0.1 scope by operator decision during execution.

## Tasks executed

### Task 1 — `npm run deploy` (deploy execution)

**Result:** PASS after 2 prior eval-gate failures + 1 missing-resource failure surfaced + fixed inline.

- **Attempt 1:** Blocked at `evals:promptfoo` predeploy gate. Root cause: deprecated `--threshold-pass-rate` CLI flag. Fixed in commit `02c1b9f` (orchestrator); no Cloudflare state mutated.
- **Attempt 2:** Blocked at `evals:promptfoo` predeploy gate (different defect). Root cause: 4 promptfoo YAML schema drift defects (sharedTests pattern removed, commandLineOptions.output shape changed, transformResponse callable signature changed, plus the prior CLI flag). Fixed via rebuilt harness in commit `b27da62`; no Cloudflare state mutated.
- **Attempt 3:** Blocked at `wrangler deploy mcp-server` — `Queue "engram-ingest" does not exist`. Russell ran `npm run setup:queue`; queue created.
- **Attempt 4:** Blocked at `wrangler deploy mcp-server` — `Vectorize index 'engram-memories' was not found`. Russell ran `npm run setup:vectorize`; index created.
- **Attempt 5:** PASS. Both Workers shipped successfully:
  - `https://engram-mcp-server.russellkmoore.workers.dev` (version `1f209f19-3e59-4f1b-9d86-100e46f03f3a`) — producer for engram-ingest
  - `https://engram-triage-worker.russellkmoore.workers.dev` (version `d4df0c97-7ba7-4c00-827e-cb5db1d9ccd3`) — consumer for engram-ingest

### Task 2 — OAuth bootstrap (human checkpoint)

**Result:** PASS after surfacing 1 user-error + 1 script bug + 1 KV propagation lag.

- Russell edited `claude_desktop_config.json` to add the Engram MCP entry. Accidentally wiped his other MCP servers (recoverable: Context7 reconstructed from canonical install snippet; Invest Collective re-added via `claude mcp add`).
- Russell ran `npm run kv:bootstrap` — failed with `No KV Namespaces configured`. Root cause: script invokes wrangler from repo root where the binding isn't visible. Worked around by running wrangler directly from `packages/mcp-server/`. Filed as ENG-7 for v0.2 fix.
- First retry after KV write returned `Unknown OAuth subject` error — eventually-consistent KV propagation lag. Resolved on subsequent retry.
- Confirmed Engram MCP tools available in Claude Desktop: 5 tools registered (remember, recall, search, forget, ingest).

### Task 3 — DEP-03 acceptance runs (human checkpoints, both PASS)

**Run 1 (Apple ML Research Scientist):**
- Conv A: 2026-05-30 00:38 PT. Block ID `34ee3009`, classified `job_application`.
- Conv B: 2026-05-30 10:08 PT (9h 30m wait, fresh chat session).
- Result: PASS. Recall returned company + team + Req ID + URL intact.

**Run 2 (Anthropic TPM Inference Performance):**
- Conv A: 2026-05-30 01:02 PT. Block ID created at greenhouse.io URL; auto-enrichment via Triage Worker extracted salary range, locations, visa sponsorship, fit signals.
- Conv B: 2026-05-30 10:08 PT (9h 06m wait, same fresh chat as Run 1).
- Result: PASS. Recall returned full structured fields.

Both runs satisfied D-03's "two real wall-clock runs over 1-2 days" with REAL 1+ hour waits and DIFFERENT postings (different role + company + URL → exercises Vectorize semantic recall, not memoization).

### Task 4 — DEP-04 rewire smoke (DROPPED)

**Result:** DROPPED from v0.1 scope by operator decision during execution.

Rewiring the existing Job Scout agent requires a real rewrite of that agent (separate codebase), not the in-place capture-path swap originally scoped. Engram's substrate readiness is verified via DEP-03 — when Russell rewrites Job Scout to use Engram, that work lives in the Job Scout repo and exercises the same MCP tools already proven in production. No Engram-side work required.

REQUIREMENTS.md + ROADMAP.md amended to mark DEP-04 dropped (commit `91bb2ab`). Not tracked as a separate Linear issue per operator direction.

## Deviations

1. **Promptfoo harness rebuild** (not in original plan scope) — discovered necessary during deploy attempts; full YAML schema rewrite. Documented in commit `b27da62`.
2. **Setup-queue + setup-vectorize had to be run manually** before deploy succeeded. The `npm run setup` chain (which now includes both) was added in Wave 1 but Russell hadn't run `npm run setup` since adding it. Future fresh-clone users will hit `setup` automatically.
3. **Claude Desktop config wipe + recovery** — user-error during config edit. Manual reconstruction worked but motivated ENG-11 (pull better auth flow forward from v0.4 to v0.2).
4. **DEP-04 dropped from scope** — see Task 4 above.

## Follow-ups filed

- **ENG-7** (Medium): kv:bootstrap script CWD bug
- **ENG-8** (Medium): Recall envelope `type` field parse-error inconsistency
- **ENG-9** (High): Promptfoo eval gate silently passes on Workers AI 404 errors
- **ENG-10** (Medium): Wire promptfoo into CI to catch schema drift earlier
- **ENG-11** (High): Better first-run auth flow — pull `kv:bootstrap-interactive` from v0.4 to v0.2

## Verification status

- DEP-01: PASS (deploy succeeded; both Workers live + responding to `/health`)
- DEP-02: PASS (OAuth bootstrap completed; Claude Desktop sees 5 tools)
- DEP-03 Run 1: PASS (9h 30m wait, Apple posting recalled correctly)
- DEP-03 Run 2: PASS (9h 06m wait, Anthropic posting recalled correctly, semantic-recall via different content)
- DEP-04: DROPPED (out of v0.1 scope)
- Security gate: PASS (07-SECURITY.md: 22/22 threats closed)

## Commits

Phase 7 execution generated 28+ commits across planning, research, 4 PLAN files, 4 waves of execution + 2 partial attempts + harness rebuild + acceptance + scope amendments + security. Key milestones:

- `ca4f40b` — Phase 7 plan created
- `02c1b9f` — promptfoo CLI flag fix
- `b27da62` — promptfoo YAML harness rebuild
- `35e4c65` — DEP-01 deploy URLs recorded
- `91bb2ab` — DEP-03 results + DEP-04 dropped
- `5ba8b58` (or similar) — SECURITY.md committed
- `8a3a7b3` (or similar) — phase.complete tracking update

This SUMMARY supersedes `07-04-SUMMARY-PARTIAL.md` which captured the diagnostic record across the two failed deploy attempts.
