---
phase: 07-deploy-acceptance
plan: 04
subsystem: deploy-execution
status: blocked-pre-deploy
tags: [deploy, blocked, eval-gate-failure, promptfoo, predeploy, gap-closure-trigger]
partial_completion: "Task 1 of 4 attempted; aborted at predeploy eval gate before any wrangler invocation. Tasks 2-4 (human-gated acceptance window) untouched."

# Dependency graph
requires:
  - phase: 05-ai-integration
    provides: "`predeploy` npm lifecycle hook running `evals:ci` (vitest + promptfoo gate) — this is the Phase 5-wired gate that Phase 7 inherits via the npm `pre<X>` semantic. The promptfoo step is what failed here."
  - phase: 07-deploy-acceptance
    provides: "Plan 07-01 `npm run deploy` wrapper — invoked end-to-end exactly as documented; the wrapper correctly aborted when predeploy failed, validating the fail-closed posture."
provides:
  - "Diagnostic record of the pre-existing `evals:promptfoo` script defect in package.json:31 — the `--threshold-pass-rate 95` flag is not recognized by the installed promptfoo@0.121.13 CLI. Surfaces a gap-closure trigger before any production state was mutated."
  - "Confirmation of Cloudflare auth identity (russellkmoore@mac.com) and account ID (2b0a49e80e2c9fd83946bbcefb4c0e3d) — Russell's account is the deploy target; no surprise account mismatch."
  - "Confirmation that `npm run deploy` exits non-zero on predeploy failure (D-08 fail-closed invariant) — vitest evals passed, promptfoo aborted with `unknown option '--threshold-pass-rate'`, `npm run deploy` exited 1, neither `deploy:mcp` nor `deploy:triage` was invoked."
affects:
  - .planning/phases/07-deploy-acceptance/07-04-PLAN.md (Task 1 blocked at predeploy; Tasks 2-4 unblocked once predeploy is fixed)

# Tech tracking
tech-stack:
  added: []  # No code changes; pre-deploy failure
  patterns: []  # No new patterns; documents a regression

key-files:
  created:
    - ".planning/phases/07-deploy-acceptance/07-04-SUMMARY-PARTIAL.md — this file (partial summary; full SUMMARY pending re-attempt after predeploy fix)"
  modified: []  # No repo files modified by this run

key-decisions:
  - "Did NOT bypass the eval gate (no `--no-predeploy`, no direct `wrangler deploy` per package). Per production_deploy_caveat and CONTEXT.md `<specifics>` cardinal rule (no 'phase-passes-with-known-issues' escape hatch), the gate is fail-closed by design. Bypassing would deploy un-eval'd Worker code to Russell's production Cloudflare account."
  - "Did NOT auto-fix the `--threshold-pass-rate` flag deprecation. This is a Rule 4 architectural change — promptfoo's eval-gate strategy needs Russell's decision (replace flag with `assertions:` block in YAML? Upgrade promptfoo? Pin to an older version that still supports the flag?). Logged here for the gap-closure cycle."
  - "Surfaced eval-gate failure to user as a CHECKPOINT REACHED return rather than blocking on it silently. The partial summary captures all observable state for the continuation agent."

requirements-completed: []  # DEP-01 NOT met (no deploy happened)

# Metrics
duration: ~1m
completed: 2026-05-30
tasks_completed: 0
tasks_attempted: 1
tasks_blocked: 1
files_changed: 0
commits: 0
---

# Phase 7 Plan 04 (Partial): Deploy Execution — BLOCKED at predeploy eval gate

**Task 1 (`npm run deploy`) aborted at the promptfoo eval-gate step before any wrangler invocation. The pre-existing `evals:promptfoo` script in package.json:31 uses `--threshold-pass-rate 95`, which is not recognized by the installed promptfoo@0.121.13 CLI (the flag was removed/renamed in a prior promptfoo release). Vitest evals passed (mcp-server + triage-worker both clean); promptfoo failed; `npm run deploy` exited 1; `deploy:mcp` + `deploy:triage` never ran. Russell's Cloudflare account is unchanged. Tasks 2-4 (Claude Desktop config + DEP-03 acceptance window + DEP-04 rewire smoke) are intrinsically blocked behind a successful deploy.**

## What Was Attempted

1. **Worktree branch + base assertion** — PASSED. Branch `worktree-agent-a260d1a328aa89b97` is in the `worktree-agent-*` namespace; HEAD reset to expected base `b225a6b`.
2. **Cloudflare auth verification** — PASSED. `npx wrangler whoami` confirmed `russellkmoore@mac.com` / account `2b0a49e80e2c9fd83946bbcefb4c0e3d`. No surprise account mismatch.
3. **`npm run deploy` invocation** — ABORTED at predeploy. See "Eval Gate Failure" below.

## Eval Gate Failure (Root Cause)

### Sequence of events

1. `npm run deploy` triggered `predeploy` → `npm run evals:ci`.
2. `evals:ci` → `evals:vitest` ran:
   - `packages/mcp-server`: **3 passed, 2 skipped** (out of 5 tests across 2 test files).
   - `packages/triage-worker`: **1 skipped** (single test file, no failing eval).
   - Vitest stage exited 0.
3. `evals:ci` → `evals:promptfoo` ran:
   - Command: `npx promptfoo eval -c packages/triage-worker/evals/triage-extraction.promptfoo.yaml --threshold-pass-rate 95`
   - Output: `error: unknown option '--threshold-pass-rate'`
   - Promptfoo printed its full `eval --help` and exited non-zero.
4. `evals:ci` aborted (the `&&` chain stops on first non-zero).
5. `predeploy` exited non-zero.
6. `npm` aborted `deploy` before invoking `deploy:mcp` or `deploy:triage`.
7. `npm run deploy` exited **1**.

### Diagnostic data

| Item | Value |
|------|-------|
| Installed `promptfoo` version | `0.121.13` |
| `package.json` pinned version | `^0.121.13` (workspace devDependency) |
| Failing flag | `--threshold-pass-rate 95` |
| Flag status in CLI | NOT in `eval --help` output (no `--threshold` or `--pass-rate` variant visible) |
| Origin of flag in script | Phase 5 wired (package.json:31; introduced when Phase 5's promptfoo eval gate landed) |
| Wrangler invocations | **ZERO** (`deploy:mcp` not invoked; `deploy:triage` not invoked) |
| Russell's Cloudflare account state | **UNCHANGED** (no new Worker uploaded; no existing Worker overwritten) |

### Why this matters

This is exactly the failure mode the production_deploy_caveat anticipated:

> "If evals fail in step 1: Do NOT skip the eval gate (no `--no-predeploy` workaround); Do NOT proceed with manual `wrangler deploy` per package. Stop, return with `## CHECKPOINT REACHED` describing the eval failure, let Russell investigate."

The eval gate exists to prevent un-eval'd Worker code from landing in production. Even though the *current* failure mode is a CLI-flag deprecation (not a model-quality regression), bypassing the gate would (a) violate the D-08 fail-closed invariant and (b) deploy code that has never been validated against the F1 reference corpus on this branch state.

## Why I Did NOT Auto-Fix

Per `<deviation_rules>` Rule 4 (Ask about architectural changes), the fix surface here is a Russell-decision:

| Option | Trade-off |
|--------|-----------|
| **A. Replace `--threshold-pass-rate 95` with a YAML `defaultTest.threshold` or `assertions:` block** | Cleanest — moves the threshold into the config file where it belongs. Requires editing `packages/triage-worker/evals/triage-extraction.promptfoo.yaml`. |
| **B. Remove `--threshold-pass-rate` and rely on individual test assertions** | If the YAML already has per-test assertions with a pass/fail verdict, the gate may already work without the flag. Requires verifying the YAML's current shape. |
| **C. Pin promptfoo to an older version that still supports the flag** | Reverts CLI surface to the previously-working version. Risk: misses any subsequent bugfixes in newer promptfoo releases. |
| **D. Upgrade promptfoo to a newer major version and adopt the new threshold mechanism** | If the flag was removed in a major bump, the threshold mechanism may have moved to config-as-code. Requires understanding the post-removal API. |

This is Rule 4 territory (architectural choice with code/config trade-offs), not Rule 1-3 territory (mechanical bug fix). Auto-picking would commit Russell to one of these paths without his input.

**Recommended diagnostic next step (Russell):** open `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` and check whether it already declares a `defaultTest.threshold` or per-assertion `passRate`. If yes, Option B is a one-line `package.json` fix. If no, Option A or D requires more thought.

## What Was Skipped (Per Scope Limit)

The plan's Task 1 acceptance criteria included "record the observed `<subdomain>` value" and "update `07-HUMAN-UAT.md` Operator Notes with deployed URLs." Since **no Workers were deployed**:

- No `<subdomain>` value to record (resolves RESEARCH Open Question 1 deferred to next attempt).
- No `*.workers.dev` URLs to populate into HUMAN-UAT.md Operator Notes.
- `07-HUMAN-UAT.md` was NOT modified (no false-success state).

Per the parallel_execution + scope_limit blocks, Tasks 2-4 are intrinsically blocked behind a successful Task 1. No attempt was made to advance them. The orchestrator will re-spawn a continuation agent once Russell fixes the predeploy gate.

## What Was Verified (Even in Failure)

- **Wrapper script ordering is correct.** `npm run deploy` correctly invokes `predeploy` → `deploy:mcp && deploy:triage` and correctly aborts on predeploy failure.
- **Fail-closed posture works.** D-08's "predeploy gate fires before either wrangler invocation" invariant held — vitest evals ran, promptfoo failed, NEITHER `wrangler deploy` invocation fired. This is the desired behavior.
- **Vitest evals are healthy.** mcp-server + triage-worker both pass cleanly (3 passed / 2 skipped on mcp-server; 1 skipped on triage-worker — the skips are pre-existing and not regressions of this attempt).
- **Wrangler auth is healthy.** `npx wrangler whoami` confirmed Russell's account; the token has all required scopes (workers:write, workers_kv:write, ai:write, vectorize:write equivalent, queues:write).
- **No partial state.** No Worker was uploaded; no live infrastructure changed; no `*.workers.dev` URL was overwritten.

## Files Created/Modified

### Created
- `.planning/phases/07-deploy-acceptance/07-04-SUMMARY-PARTIAL.md` — this file.

### Modified
- **None.** No source code, no config, no docs. The only side effects were transient log files in `/tmp/` (not committed).

## Decisions Made

See `key-decisions` in frontmatter. Three decisions documented:

1. Did NOT bypass eval gate.
2. Did NOT auto-fix the flag deprecation (Rule 4 — Russell's call).
3. Surfaced as CHECKPOINT REACHED rather than silent stall.

## Deviations from Plan

**One deviation (Rule 4 escalation), not Rule 1-3 auto-fix:**

- The plan's Task 1 `<action>` step 3 says: "If the eval gate fails: Re-run `npm run deploy` ONCE (LLM evals have variance per RESEARCH §Pitfall 6). If it fails twice, run `npm run evals:ci` directly to surface the specific assertion failure, fix the regression, and re-deploy."

  **What I did instead:** Re-ran `npm run deploy` once (second invocation confirmed exit code 1 and the same `unknown option '--threshold-pass-rate'` error). Then stopped without diving into `npm run evals:ci` directly, because the failure is **deterministic CLI-flag deprecation**, not the **LLM eval variance** Pitfall 6 anticipated. RESEARCH §Pitfall 6 contemplates "flaky LLM judgment" — not "the CLI invocation itself is wrong." The two are different failure classes and warrant different responses.

  **Why this is the right call:** the plan's step-3 fallback ("fix the regression") presupposes the regression is in the eval model output. Here, the regression is in the eval *invocation*. Fixing the invocation requires choosing between Options A-D above, which is Rule 4 (architectural). Surfacing as CHECKPOINT REACHED preserves Russell's agency on the fix-choice.

## Verification Results

### Per-task automated checks (from PLAN.md Task 1 `<acceptance_criteria>`)

| Criterion | Status |
|-----------|--------|
| `npm run deploy` exits 0 | **FAIL** (exited 1) |
| `predeploy` hook ran and passed BEFORE either wrangler invocation | **PARTIAL** (ran; passed vitest stage; FAILED at promptfoo stage) |
| `wrangler deploy` for `engram-mcp-server` succeeded | **NOT ATTEMPTED** (predeploy failure aborted before this stage) |
| `wrangler deploy` for `engram-triage-worker` succeeded | **NOT ATTEMPTED** (same) |
| `curl -i https://engram-mcp-server.<subdomain>.workers.dev/health` returns HTTP 200 | **NOT ATTEMPTED** (no deployed URL exists) |
| Observed `<subdomain>` value recorded | **NOT POSSIBLE** (no deploy printed a subdomain) |
| If eval gate failed on first attempt and passed on re-run, document the flake | **N/A** — Failed on both attempts deterministically, not flake (RESEARCH §Pitfall 6 is about LLM variance; this is a CLI-flag deprecation, not variance) |
| No repo files modified | **PASS** (this is the one criterion still met; the partial SUMMARY is in `.planning/`, not the production tree) |

### Plan-level verification

Skipped — Plan 04's verification block presupposes Tasks 1-4 all completed. None of the prerequisites are met.

## Issues Encountered

1. **`evals:promptfoo` script invokes deprecated flag `--threshold-pass-rate`.** Root cause documented in detail above. This is a pre-existing config defect from Phase 5 that has not been exercised against `npm run deploy` in the production path until Phase 7. Logged here as a gap-closure trigger; Russell decides Option A/B/C/D for the fix.

2. **Misleading initial exit code from `tee` pipeline.** The first invocation used `2>&1 | tee /tmp/...` which masked the real exit code (the pipeline returned `tee`'s exit code, not `npm run deploy`'s). Caught the mistake immediately and re-ran without the pipe; confirmed real exit code is 1. Documented here so a continuation agent doesn't fall into the same trap.

## Deferred Issues

None new from this run. The two pre-existing Plan 07-01 deferred items (`packages/triage-worker/worker-configuration.d.ts` missing for typecheck; 29 lint errors in `packages/mcp-server/src/**`) were not exercised here (the predeploy gate does not transitively gate on `typecheck` or `lint`, only on `evals:ci`).

The newly-discovered defect (`evals:promptfoo --threshold-pass-rate` deprecated) is **the blocker** and is documented inline above rather than in `deferred-items.md`, because it actively prevents the phase from progressing rather than being merely "out of current scope."

## CF-Code-Assist Routing Log

Per `~/.claude/CLAUDE.md` 3-question checklist for Task 1:

### Task 1 (Attempted) — Run `npm run deploy`

- **Was this a code-producing task?** No. It is a CLI invocation against pre-existing scripts. No code was generated.
- **Route:** N/A (no code synthesis).
- **Phase 7 routing tally update:** still **0/0 cf-code-assist routes attempted in Plan 07-04 so far** (the plan has zero code-producing tasks — Tasks 2-4 are also human checkpoints, not code). Final tally for Plan 07-04 will be 0/0 when the plan closes. Net Phase 7 routing tally per CONTEXT.md projection ("0-2 routes across the phase"): 0/4 across Plans 07-01 + 07-02 + 07-03 + 07-04 (per the Plan 07-02 SUMMARY's roll-up: 4/4 Claude across the first two plans of code-producing tasks; Plans 07-03 + 07-04 are docs/operational with no code synthesis). Matches the operational-phase projection.

## Next Steps for Continuation Agent

When Russell fixes the eval-gate flag deprecation and re-runs this plan:

1. **Verify the fix landed:** `npm run evals:promptfoo` should exit 0.
2. **Re-run Task 1:** `npm run deploy` should now proceed through vitest → promptfoo → `deploy:mcp` → `deploy:triage` → completion.
3. **Capture both `*.workers.dev` URLs** from the wrangler stdout.
4. **Update `07-HUMAN-UAT.md` Operator Notes** with the observed URLs (replace `<your-subdomain>` placeholders).
5. **Commit the HUMAN-UAT update + full SUMMARY** atomically.
6. **Return CHECKPOINT REACHED type `human-action`** for Task 2 (OAuth bootstrap) — Russell will handle Claude Desktop config + the OAuth dance in his own session.

If Russell instead chooses to fix the flag in this same agent session (against the production_deploy_caveat guidance), the path is:

- Option B (likely cheapest): inspect `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` — if `defaultTest.assert` or per-test `assert` already has pass/fail verdicts, simply remove `--threshold-pass-rate 95` from `package.json:31` (the eval pass/fail will then be determined by per-test assertions only).
- Verify by running `npm run evals:promptfoo` standalone; expect exit 0.
- Then proceed with the deploy.

But: **this is Russell's call, not the executor's.** The deploy was attempted; the gate caught a real defect; the gate did its job; the safest next step is the human checkpoint.

## Self-Check: PASSED

- `.planning/phases/07-deploy-acceptance/07-04-SUMMARY-PARTIAL.md` exists (this file). FOUND.
- No new commits created (correct — nothing to commit; no production state changed). VERIFIED via `git log --oneline -1` returning the pre-task HEAD.
- `.planning/STATE.md` NOT modified (per parallel_execution rule). CONFIRMED.
- `.planning/ROADMAP.md` NOT modified (per parallel_execution rule). CONFIRMED.
- `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` NOT modified (correct — no deploy URLs to record). CONFIRMED.
- No source code, no `package.json`, no `wrangler.jsonc` files modified. CONFIRMED.
- No Cloudflare Worker was uploaded (verified by absence of `wrangler deploy` invocation in the log; `evals:ci` aborted before either deploy step). CONFIRMED.

---
*Phase: 07-deploy-acceptance*
*Plan: 04 (partial — Task 1 attempted, blocked at predeploy)*
*Captured: 2026-05-30*
