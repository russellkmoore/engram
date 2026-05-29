# Phase 7: Deploy + Acceptance - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning
**Discussion mode:** discuss (4 areas, 8 product-level decisions; technical knobs under Claude's Discretion)

<domain>
## Phase Boundary

Both Workers (`packages/mcp-server/` and `packages/triage-worker/`) ship to Russell's Cloudflare account via `wrangler deploy` and are reachable at `*.workers.dev` URLs. Claude Desktop is configured with `mcp-remote` pointing at the deployed `/mcp` endpoint; the OAuth + KV-backed identity bootstrap (Phase 3 D-08 / oauth.ts T-03-PROPS) is documented inline in the README's Getting Started flow so the first 403 "Unknown OAuth subject" response is framed as a normal first-run step, not an error. The v0.1 binding acceptance test (`remember` a job posting in conversation A → 1+ hour real wait → `recall` correctly in conversation B) passes twice over a 1–2 day window with evidence persisted as `07-HUMAN-UAT.md`. Russell's job-search agent is rewired to Engram going forward (NO migration of existing local files — markdown/JSON/XLS history stays in place and pre-Engram), with a single-capture-then-next-day-recall smoke test as the regression verification. The README is good enough for Russell now and Devon later: prereqs, `npm run setup` (extended to include `setup:queue` + a deploy hint), `npm run deploy` (wraps `predeploy` eval gate + both `wrangler deploy` calls; per-package `deploy:mcp` / `deploy:triage` for surgical re-deploys), Claude Desktop config snippet, and the 4-step manual OAuth bootstrap walkthrough. The interactive `kv:bootstrap-interactive` script is deferred to v0.4 — v0.1 acknowledges the friction in the README and accepts it to ship faster.

</domain>

<decisions>
## Implementation Decisions

### OAuth bootstrap UX (DEP-02)

- **D-01: Ship the manual paste-the-sub flow for v0.1; document the v0.4 interactive bootstrap as deferred.** The existing `oauth.ts` design already supports the flow: `mcp-remote` registers → `/authorize` returns 403 with the literal body `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` → user copies `<sub>` from the error → runs `npm run kv:bootstrap -- --sub <sub> --workspace-id <id> --user-id <id>` → retries in Claude Desktop. Rationale: the code already supports it; the friction is real but transparent (the user understands what just happened); shipping manual gives us real signal on whether Devon hits the friction before we invest in the interactive script. The deferred-ideas section names the v0.4 work as `kv:bootstrap-interactive` (auto-deploys → connects to live /authorize as the user → captures the `sub` → prompts for workspace/user IDs → writes the KV entry → prints restart message).

- **D-02: README places the bootstrap flow INLINE in Getting Started as Step 4, not in Troubleshooting.** Step ordering: (1) install + setup, (2) deploy both Workers, (3) configure Claude Desktop with `mcp-remote` URL, (4) **first tool call — expect the bootstrap error, here's what to do** (paste the `sub` from the error, run `kv:bootstrap`, restart Claude Desktop). Frames the friction as a normal first-run step rather than something broken. Devon onboards by following Steps 1-4 sequentially, not by hunting through Troubleshooting after hitting a wall. Troubleshooting section still exists but covers OTHER errors (network failures, wrangler config drift, etc.) — not the bootstrap one.

### Acceptance test protocol (DEP-03)

- **D-03: Two REAL 1-hour runs over a 1-2 day window — no fast-forward, no "imagine time passed" prompts.** Run 1: remember a job posting in conversation A → wait 1+ hour real wall-clock → recall in conversation B (separate Claude Desktop chat session). If pass, Run 2 on the next day with a DIFFERENT job posting (different role/company/URL — exercises Vectorize semantic recall, not memoization of the exact same content). Rationale: this is the most honest test — exercises the actual async pipeline timing AND Vectorize indexing settle time AND the Claude Desktop session-boundary behavior. The "imagine time passed" alternative skips real signal. The same-day-with-1hr-gap alternative misses any daily background settling. Two-day window is slow but high-confidence and matches the real use case (Russell genuinely doesn't remember details from yesterday's conversations).

- **D-04: Evidence is captured as `07-HUMAN-UAT.md` (standard GSD HUMAN-UAT pattern).** Each run is a test entry: `### Run 1: {date}` with `expected: recall returns {company, role, URL} for the job remembered on {prev-date}`, `result: pending|pass|fail`, `notes: <conv A excerpt> <conv B excerpt>`. The file persists in version control alongside the phase artifacts. Surfaces in `/gsd:progress` and `/gsd:audit-uat`. If Run 1 passes but Run 2 fails, the phase does NOT close — gap closure cycle until both runs pass. Phase verification (gsd-verifier) reads HUMAN-UAT.md as the DEP-03 evidence source.

### Job-search agent rewire scope (DEP-04)

- **D-05: NO migration of existing job-search agent data. Pre-Engram local files (markdown notes, JSON files, XLS local DB) stay in place untouched.** The agent's existing capture history is preserved on disk as historical record. Phase 7's DEP-04 work is exclusively forward-looking: rewire the agent's CAPTURE path (and recall path) to call Engram's MCP tools going forward. New captures (from the rewire date onward) land in Engram; pre-rewire captures stay in the local files (Russell can manually reference them but the agent won't query them through Engram). This dramatically simplifies DEP-04 from "data migration + rewire" to "rewire only" — no import script, no dual-read, no migration verification needed. Implication: the v0.1 inbox/recall UI will only ever see post-rewire captures; pre-Engram job history is not searchable through Engram's recall.

- **D-06: Regression verification = single-capture smoke test, captured as a HUMAN-UAT entry alongside the DEP-03 entries.** Protocol: with the rewired agent active in Claude Desktop, paste one fresh job posting → agent calls Engram `remember()` → verify the block lands by calling Engram `recall()` in the same conversation → next day, open a fresh conversation, ask the same agent "what jobs have I saved?" → verify the recent capture is returned with extracted fields. One end-to-end smoke, one HUMAN-UAT entry. Rationale: dual-write (capture to BOTH old files AND Engram for N days) adds technical debt to the agent (extra code path that must be torn out later) and delays cutover. The cutover-with-no-verification alternative skips a real signal worth having. The smoke test threads the needle — cheap, real-world, catches the most likely failure mode (agent's prompt template doesn't produce a valid `remember()` call shape).

### Setup automation completeness (DEP-01 + DEP-05)

- **D-07: Extend `npm run setup` to `install + types:gen + setup:vectorize + setup:queue + deploy-hint`.** Currently `setup` runs `install + types:gen + setup:vectorize` only. Add `setup:queue` (idempotent — Phase 6 setup script, was added but not wired into the meta-`setup`). Add a final `echo` printing: `"Setup complete. Run 'npm run deploy' to ship both Workers, then see README Step 4 for the OAuth bootstrap."` Do NOT include `kv:bootstrap` in `setup` — bootstrap requires a deployed Worker + a real `sub` from Claude Desktop's `mcp-remote` registration, neither of which exists at setup time. Bootstrap stays a separate, documented Step 4 per D-02.

- **D-08: Add `npm run deploy` wrapper + per-package `deploy:mcp` / `deploy:triage` for surgical re-deploys.** The wrapper: `predeploy` (existing — runs `evals:ci`) → `wrangler deploy` for mcp-server → `wrangler deploy` for triage-worker. One command, predictable order, fails closed if evals fail. The per-package commands (`deploy:mcp` / `deploy:triage`) skip the `predeploy` evals gate — they're for day-N surgical re-deploys after a small fix (e.g., "just rebuild the triage worker, mcp-server is fine"). Rationale: wrapper covers the day-1 happy path AND the day-N "I want to be confident I haven't regressed evals" path. Per-package covers day-N "I know exactly what changed" workflows. README cites all three commands with clear "use this when" guidance. The wrapper IS the runbook for first-time deployers.

### Claude's Discretion

The following are technical implementation details the planner and executor handle. Documented here so they're visible during planning, not surfaced as user-facing decisions:

- **Wrangler deploy invocation shape.** Either `npm run --workspace=packages/mcp-server deploy` (if each package adds its own `deploy` script wrapping `wrangler deploy`) or `cd packages/mcp-server && npx wrangler deploy` (run from the root via `--prefix` / `&&`). Planner picks — workspace-script form is cleaner for `package.json` script wiring; `cd && npx` is more explicit in README walkthroughs. Either works.
- **Eval gate failure UX.** `predeploy` currently runs `evals:ci` (vitest evals + promptfoo). On failure, `npm run deploy` aborts before `wrangler deploy` fires. The error message from vitest/promptfoo IS the failure surface — no extra wrapper script needed. Document in the README: "if `npm run deploy` fails at the eval gate, see `npm run evals:ci` output for details; fix the regressions before re-running deploy."
- **Two real Workers, one Cloudflare account, one workspace (v0.1).** No `--env dev` vs `--env prod` separation. Single Worker per package, single workspace, single user (Russell). Per the PROJECT.md scope, this is intentional — v0.1 is single-user. v0.3 (Workspaces + Memory Types) introduces the env separation pattern.
- **mcp-remote pinning.** Document the currently-tested `mcp-remote` version in the README's Claude Desktop config snippet. Don't hard-pin in code (it's a Claude Desktop config string, not an npm dep), but the snippet should include a comment like `// tested with mcp-remote@<ver> on Claude Desktop <ver> 2026-05-29`. If a future mcp-remote breaks the bootstrap flow, the dated snippet is the rollback marker. v0.4+ may drop mcp-remote entirely once Claude Desktop ships native Streamable HTTP support (SUMMARY.md §9).
- **README structure (Phase 7 amendments).** Existing README is 443 lines. Phase 7 additions: (1) Getting Started Step 4 (OAuth bootstrap walkthrough, ~40 lines including error-message screenshot reference), (2) new "Deploy" section between "Install and run" and "Tool Surface" (~30 lines covering `npm run deploy` + per-package + predeploy eval gate), (3) Troubleshooting section refresh — fold the P1-P6 common errors observed during execution into a searchable list (~20-40 lines depending on how many distinct errors emerged). Total README delta probably ~100-150 lines. Planner refines.
- **What goes in `npm run setup`'s final echo.** Exact text: `"\n✓ Setup complete.\n  Next:  npm run deploy        # ships both Workers (runs eval gate first)\n         see README Step 4      # OAuth bootstrap for Claude Desktop\n"`. Or similar. Planner refines wording for tone consistency with the rest of the README.
- **Test infrastructure.** No new test infra. Phase 7's verification is HUMAN-UAT-driven (DEP-03 + DEP-04) plus the deploy gate's existing eval suite. No new vitest tests required. The phase IS the production smoke test.
- **Inline `[route]` tracker fires during execute-phase.** Phase 7 will exercise the cf-code-assist orchestrator-level routing rule per the recent `~/.claude/CLAUDE.md` amendment. Expected character: README authoring (potential `generateDocs` candidate per task), small wrapper scripts (mostly Claude — Q2=N under 50-line threshold). Realistic projection: 0-2 routes across the phase. Tracker lines visible inline in the execute-phase transcript; aggregate `## Routing log` summary block at phase completion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (gsd-phase-researcher, gsd-planner) MUST read these before planning or implementing.**

### Phase 7 design surface (primary)

- `.planning/ROADMAP.md` §"Phase 7: Deploy + Acceptance" — 5 success criteria (DEP-01..05) + 3 risk notes (first-prod-deploy invariant exercise, mcp-remote community risk, job-search-agent rewire as first stress test of envelope shape + recall semantic-vs-lexical promotion)
- `.planning/REQUIREMENTS.md` §"Deploy + Acceptance (DEP)" — DEP-01..DEP-05 acceptance criteria (read verbatim; do NOT paraphrase)
- `.planning/research/SUMMARY.md` §9 — `mcp-remote` community-maintenance risk flag; native Streamable HTTP rollback marker

### Phase 3 carry-forward (OAuth + KV-bootstrap surface, ALREADY SHIPPED)

- `packages/mcp-server/src/oauth.ts` — **The bootstrap flow is locked here.** OAuth defaultHandler; T-03-PROPS threat register (props sourced ONLY from `env.ENGRAM_IDENTITIES` KV lookup keyed on the OAuth `sub` claim); literal 403 error body `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` (the README's Step 4 walkthrough must reference this EXACT string); `D-08 public routes (no auth)` — GET `/` and GET `/health` are non-OAuth health surfaces.
- `packages/mcp-server/src/index.ts` — `OAuthProvider` wiring + `EngramMcp.serve("/mcp")` path. `apiRoute: "/mcp"` routes JWT-validated tool calls to the McpAgent; everything else falls to `defaultHandler` in oauth.ts.
- `scripts/kv-bootstrap.mjs` — existing CLI script Russell runs in Step 4. Phase 7 may add a `--help` banner referenced by the README, but does NOT change the script's argument shape (`--sub`, `--workspace-id`, `--user-id`).

### Phase 5/6 carry-forward (eval gate + setup wiring)

- `package.json` — root scripts. `setup` (D-07: extend), `predeploy` (already runs `evals:ci` — KEEP), `evals:ci` (vitest + promptfoo gate), `setup:vectorize` + `setup:queue` (both idempotent provisioning scripts to chain into `setup`). NEW per D-08: `deploy`, `deploy:mcp`, `deploy:triage`.
- `scripts/setup-vectorize.sh` + `scripts/setup-queue.sh` — both idempotent (skip-if-exists check). `setup` extension chains them after `types:gen`.
- `packages/mcp-server/wrangler.jsonc` — `wrangler deploy` target #1. Queue producer binding + AI + Vectorize + Analytics Engine + KV all already configured in prior phases.
- `packages/triage-worker/wrangler.jsonc` — `wrangler deploy` target #2. Queue consumer + AI + Analytics Engine + WORKSPACE DO binding all already configured.

### Project + global guidance (always-on)

- `CLAUDE.md` (project root) — Engram architecture spec; §"What This Is" (Russell as first user, Devon as first shared-workspace user); §"MCP Tool Surface" (the 5 tools that DEP-02 verifies in Claude Desktop's tool list); §"Linear Workflow" (Phase 7 = ENG issue; auto-sync at every GSD event per memory feedback-engram-linear-sync).
- `~/.claude/CLAUDE.md` §"AI Model Routing" — orchestrator-level routing rule + the new `[route]` inline tracker amendment. Phase 7 execute-phase fires the tracker per code-producing Agent spawn.

### Existing README

- `README.md` — 443 lines as of Phase 6 end. Phase 7 Wave 1 (most likely) extends Getting Started with Step 4 (OAuth bootstrap inline) + adds Deploy section + refreshes Troubleshooting with P1-P6 observed errors. The §"Tool Surface (v0.1)" tool docs already exist and are NOT modified by Phase 7.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/mcp-server/src/oauth.ts` — OAuth flow + KV-backed identity lookup. The Phase 7 README walkthrough reuses the exact error string from this file (`Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.`). Do NOT change the error string in oauth.ts during Phase 7 — the README references it verbatim.
- `scripts/kv-bootstrap.mjs` — existing CLI script. Phase 7 references it from README Step 4 with its current arg shape.
- `scripts/setup-vectorize.sh` + `scripts/setup-queue.sh` — both idempotent setup scripts. `setup` extension just chains them in `package.json` (no code changes to the scripts themselves).
- `package.json` `predeploy` hook (Phase 5) — already runs `evals:ci`. Phase 7's new `deploy` script gets the eval gate for free.

### Established Patterns

- **Setup scripts idempotent** (Phase 5/6 D-03 / D-03) — `setup:vectorize` and `setup:queue` both check-then-create. The new `deploy` wrapper follows the same posture (predeploy gate runs, then deploy).
- **README structure** — existing `README.md` follows: Getting Started → Tool Surface → Architecture Deep Dive. Phase 7 inserts Deploy + amends Getting Started but keeps the overall flow.
- **HUMAN-UAT.md as acceptance evidence** (Phase 5 pattern + `/gsd:audit-uat`) — Phase 7's DEP-03 + DEP-04 evidence persists as `07-HUMAN-UAT.md`. Standard GSD HUMAN-UAT frontmatter shape.
- **mcp-remote bridge** (Phase 3 + global Claude Desktop tooling) — Phase 7 just documents the bridge config + the bootstrap flow. No code changes.
- **Workspace-script wiring** (Phase 1 D-01 monorepo) — `deploy:mcp` and `deploy:triage` either become workspace scripts (`npm run --workspace=... deploy`) or `cd && npx wrangler deploy` snippets. Planner picks.

### Integration Points

- `README.md` (MAJOR EDIT) — Getting Started Step 4 inline bootstrap walkthrough (per D-02); new Deploy section between "Install and run" and "Tool Surface" (per D-08); Troubleshooting section refresh with P1-P6 observed errors (planner enumerates from prior SUMMARY.md files — each phase's "deviations" + "common failure modes" sections are the source).
- `package.json` (EDIT) — `setup` extended per D-07 (add `setup:queue` + final echo); `deploy` + `deploy:mcp` + `deploy:triage` added per D-08.
- `scripts/kv-bootstrap.mjs` (POSSIBLE EDIT) — add `--help` banner if needed to make README references discoverable; do NOT change arg shape.
- `.planning/phases/07-deploy-acceptance/07-HUMAN-UAT.md` (NEW, created at acceptance test time) — Run 1 + Run 2 of DEP-03 + the DEP-04 rewire smoke as three test entries.
- Both Workers' `wrangler.jsonc` — NO code changes. Phase 7 just runs `wrangler deploy` against them as-is.
- `~/.claude/CLAUDE.md` already has the `[route]` tracker rule; execute-phase will emit lines inline.

</code_context>

<specifics>
## Specific Ideas

- **"Russell now, Devon eventually" is the audience tier** (per PROJECT.md "What This Is"). README + bootstrap UX target Russell's single-machine setup first. Devon is the validation case: if Devon (Black Magic Consulting, future shared-workspace user) can follow the README from a fresh Cloudflare account without DM'ing Russell, the README is done. v0.1 doesn't ship multi-workspace, but the README's clarity needs to scale to that second user.
- **The acceptance test IS the v0.1 done-state.** Per CONTEXT.md D-03 + ROADMAP risk note 3, the phase doesn't close until DEP-03 passes twice on two consecutive runs over a 1-2 day window. There's no "phase-passes-with-known-issues" escape hatch for DEP-03 — if recall returns wrong/missing fields in conv B, that's a gap-closure cycle.
- **Pre-Engram job history stays in local files forever.** Per D-05, no migration. This is a permanent design decision, not a v0.1 limitation — Russell's pre-Engram captures are historical records that don't belong in Engram's queryable surface. A future v0.3+ "import" path could be added if needed but is explicitly out of scope for v0.1.
- **The "two real 1-hour runs" can stretch across days.** Per D-03, Run 1 + Run 2 with real wall-clock 1+ hour waits each. Plausibly: Run 1 morning of Day N, recall afternoon of Day N. Run 2 morning of Day N+1, recall afternoon of Day N+1. Phase 7's calendar duration is dominated by the acceptance window, not the deploy/README work.
- **The `[route]` tracker amendment in `~/.claude/CLAUDE.md` is now active.** Phase 7 will be the first execute-phase where the rule is in place from the start (not added mid-flow). Expected: 0-2 cf-code-assist routes (README content is the most likely `generateDocs` candidate; everything else is wrapper-script edits that fall under Q2=N).

</specifics>

<deferred>
## Deferred Ideas

- **v0.4 interactive `kv:bootstrap-interactive` script.** Per D-01. Auto-deploys, connects to live `/authorize` as the user, captures the `sub`, prompts for workspace/user IDs, writes the KV entry, prints a restart message. v0.4 owns this — by then we'll have real signal from Russell + Devon on whether the manual flow's friction actually bites.
- **v0.3+ migration of pre-Engram job history.** Per D-05, NOT in v0.1. If Russell ever wants pre-Engram captures queryable, v0.3 could ship a one-shot import path (read markdown notes / JSON / XLS → batch `remember()` each entry). v0.1 explicitly does not.
- **`--env dev` vs `--env prod` separation.** Per Claude's Discretion. v0.3 (Workspaces + Memory Types) introduces multi-environment patterns; v0.1 ships single-env single-workspace.
- **Drop `mcp-remote` for native Streamable HTTP.** Per Claude's Discretion + ROADMAP risk note. When Claude Desktop ships native Streamable HTTP support, the `mcp-remote` bridge can be removed and the bootstrap flow simplifies (no community-maintained risk). v0.4+ owns the rollback when the time comes.
- **CI/CD pipeline.** Phase 7 ships `npm run deploy` as a manual command. Future milestones may add a GitHub Actions workflow triggered on `main` branch merge that runs `evals:ci` → `wrangler deploy`. Not in v0.1.
- **Monitoring dashboards on the deployed Workers.** Workers Analytics Engine event writes are wired (Phase 5 + 6); Cloudflare's built-in observability is the v0.1 surface. v0.2 / v0.3 may add a Grafana / custom dashboard. Not in v0.1.

### Reviewed Todos (not folded — none actually Phase 7 work)

- `2026-05-26-phase-4-raw-chunks-escape-hatch.md` — Phase 4 closed; matched on keyword overlap, not Phase 7 scope.
- `2026-05-26-phase-4-spike-workers-ai-extraction-quality.md` — Phase 4 closed; matched on keyword overlap.
- `2026-05-26-phase-5-cold-storage-not-discard.md` — Phase 5 D-07 implemented; matched on keyword overlap.

</deferred>

---

*Phase: 07-deploy-acceptance*
*Context gathered: 2026-05-29*
