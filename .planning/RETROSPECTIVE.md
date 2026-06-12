# Engram Retrospective

> Living document. New milestone sections append before the Cross-Milestone Trends section.

## Milestone: v0.1 — MCP Foundation

**Shipped:** 2026-05-30
**Phases:** 7 | **Plans:** 44 | **Tasks:** ~93

### What Was Built

An MCP-native second brain deployed to Cloudflare. Russell (first user) writes via Claude Desktop, the MCP Worker handles tool calls + OAuth + JWT, a per-workspace Durable Object owns SQLite for structured storage + Vectorize for semantic search, and a separate Triage Worker enriches asynchronously via Workers AI (entity extraction, summarization, memorability scoring, classification). Async pipeline connects MCP Worker → `engram-ingest` Queue → Triage Worker → back into the WorkspaceDO via RPC, with `blocks.ingest_status` tracking `pending → enriched | failed` and no silent drops on retry exhaustion.

The binding acceptance test (`remember` in conv A → `recall` in fresh conv B 1+ hour later) PASSED twice in production with two different real job postings. The Triage Worker demonstrably extracts salary range, locations, visa sponsorship, and fit signals from a greenhouse.io job posting in the wild.

### What Worked

- **GSD's phase/plan/execute discipline.** Every phase produced PLAN.md → execute → SUMMARY.md → VERIFICATION.md artifacts. When something broke, the artifact chain made it easy to trace where the decision was made and what the original intent was.
- **Plan-checker iteration loop.** Two iterations on Phase 6 found 3 BLOCKERS that would have shipped wrong (closure-capture of `INGEST_QUEUE` breaking the latency test, `getCtx()` stub missing `waitUntil`, test cases using un-seeded blocks that couldn't verify the must_have truth). All caught BEFORE execution.
- **CONTEXT.md as the explicit locked-decisions surface.** Every phase had a discuss-phase output that downstream agents read literally. When Russell decided "defer conflict detection to v0.2" or "ship the manual auth flow + interactive bootstrap later," those calls landed in CONTEXT.md and propagated through research → plan → execute without re-asking.
- **Worktree-isolated parallel execution.** Phase 6 Wave 2 ran 06-02 + 06-03 in parallel worktrees with disjoint file ownership. No conflicts, atomic merges, real wall-clock savings.
- **Defense-in-depth on the high-value invariants.** STO-07 (`assertOwnsWorkspace` as first executable line of every RPC) caught zero bugs in v0.1 — which is the point. The defense exists so no future executor accidentally bypasses workspace isolation.
- **`gsd-sdk` query verbs for shared mechanics.** State transitions, ROADMAP annotations, audit-open scans, milestone archival — all behind named verbs the workflows call. Eliminated a ton of LLM-improvised file editing that would have drifted between phases.

### What Was Inefficient

- **Eval harnesses rotted silently.** The Phase 5 promptfoo YAML was authored on faith and never ran in CI. Between Phase 5 ship and Phase 7 deploy, promptfoo bumped a major version and FOUR schema/CLI defects accumulated. Discovery cost: ~1 hour of harness rebuild AT deploy time, under pressure to ship. Filed as ENG-10 (wire promptfoo into CI). Meta-lesson: any tool a future phase will depend on needs to RUN somewhere on every commit, not just exist in a file.
- **OAuth bootstrap UX bit harder than expected.** Phase 7 D-01 deferred `kv:bootstrap-interactive` to v0.4 on the assumption "the manual flow is fine for Russell." Russell's real verdict after dogfooding: ~60-90 min of friction across config wipe + script CWD bug + KV propagation lag. Pulled ENG-11 forward to v0.2. Meta-lesson: deferring UX rough edges to "later" is risky when the first dogfooder is the project owner — they have the patience to debug, but won't tolerate the same friction for v0.2 hand-off.
- **The `kv:bootstrap` script CWD bug (ENG-7)** is the kind of one-line fix that would have been caught by a CI smoke test invoking `npm run kv:bootstrap --help` from the repo root. Filed; v0.2 maintenance pass should cover it.
- **5 todos opened during planning never got auto-closed.** Phase 4/5/6 D-decisions implemented what the todos asked for (cold-storage routing, hybrid ranking, conflict-detection deferral) but the todo files stayed in `pending/`. GSD has todo-close mechanics (`resolves_phase:` frontmatter, `auto-close-todos` step) but they weren't consistently used. v0.2 should audit + close (ENG-12..16).
- **The `claude_desktop_config.json` user-error wipe.** Not a GSD issue — Russell edited the file manually + lost his other MCP servers. But it points at a fragility in the manual-edit OAuth bootstrap flow that ENG-11's interactive script would eliminate.
- **DEP-04 scope was wrong at plan time.** Original spec was "rewire the agent's capture path." Real shape was "rewrite the agent." Dropped from v0.1 mid-execution. Meta-lesson: when a deliverable depends on a separate codebase, scope as "Engram-side substrate ready" (which DEP-03 already proves), not "external thing rewired."

### Patterns Established

- **Inline `[route]` cf-code-assist tracker.** Added to `~/.claude/CLAUDE.md` during the conversation. Forces routing decision to fire at the moment of truth, not retroactively.
- **Orchestrator-level routing rule for restricted subagents.** When delegating code-generation to a subagent whose tool surface excludes a useful MCP (e.g., gsd-executor excludes cf-code-assist), the orchestrator makes the route call upstream and passes the result to the subagent. Survives plugin updates; doesn't require patching agent definitions.
- **Phase-character-aware planning.** Contract-integration phases (Phase 4, Phase 6) project differently than content-generation phases (Phase 5). Routing expectations, plan decomposition, and risk surface all differ. Captured in the AI Model Routing section of global CLAUDE.md.
- **Two-Worker split as the universal-intake pattern.** MCP Worker is one publisher among many (v0.4 connectors publish to the same Queue). Triage Worker is the universal enrichment substrate. Locked irreversibly at Phase 5/6.
- **Schema-as-data memory types.** Stored in `memory_types` table, never as TS classes. Enables user/community extensibility without redeploy. The pattern generalizes: ANY user-extensible primitive should be data, not code.
- **HUMAN-UAT.md as the operator-acceptance artifact.** Skeleton at plan-execute time, populated during the wall-clock acceptance window, surfaces in `/gsd:audit-uat`. Pattern works well for any phase with human-gated verification (Phase 1, Phase 5, Phase 7 all used it).

### Key Lessons

1. **Eval gates that don't run in CI are theatre.** They look like safety nets in PR descriptions but they don't catch anything between version bumps. Either wire them into CI or stop pretending they're protective.
2. **Dogfooding produces honest signal that planning doesn't.** Phase 7 D-01 deferred the better auth flow to v0.4 based on a hypothesis ("manual is fine"). Russell hit the friction in 6 hours of actual use and the hypothesis was wrong. Build the dogfood loop into the milestone, then re-prioritize based on what hurts.
3. **Failure-isolation pays for itself the first time.** The Triage Worker being a separate Worker meant `wrangler deploy` failures, eval-gate breaks, and Workers AI 429s ALL stayed out of the `remember()` hot path. If everything was inline in mcp-server, every deploy attempt during the 5-attempt cycle would have looked riskier than it actually was.
4. **`/gsd:secure-phase` short-circuit is correct for low-surface phases.** Phase 7 had 22 plan-time threats, all `accept` or `mitigate`, all verified during execution. Spawning the auditor subagent would have produced the same SECURITY.md result with 10+ min of extra work. Short-circuit is the right move when the threat model is exhaustive at plan time.
5. **"Plan a feature for v0.4" vs "Pull it forward to v0.2" is a real decision worth revisiting at every milestone close.** Don't anchor on the original deferral timing; re-evaluate based on what dogfooding revealed.
6. **Architectural decisions accrete value when they're surfaced + locked + revisited.** SUMMARY.md §6 + §7 enumerate the "irreversible decisions" that every phase had to honor. That register caught risks. v0.2 should maintain the same discipline.

### Cost Observations

- **Model mix:** Predominantly Claude Opus 4.7 throughout planning + orchestration. Sonnet for some routine execution. Cloudflare Workers AI (llama-3.1-8b + bge-base-en-v1.5) for all production preprocessing. Cost ratio of LLM-orchestration tokens : Workers AI inference is roughly 50:1 — Claude reasoning is expensive, Workers AI grunt work is essentially free.
- **cf-code-assist routes during v0.1:** 0/N. Phase 5 routing tracker recorded 0/37 actual routes (2 misattributed). Phase 6 + 7 zero routes — phases were contract-integration shape, every task had Q1=Y cross-file synthesis. Honest assessment: cf-code-assist's value proposition doesn't materialize at v0.1's scale; revisit if v0.4 connectors produce content-generation-shaped phases.
- **Sessions:** ~6-8 distinct conversations across the 6-day v0.1 build window. Phase 6 + Phase 7 alone each took ~4-5 hours of orchestration time, dominated by friction from harness rot + manual-step friction, not by actual code-gen work.

### What v0.2 Should Inherit From v0.1

- **Same GSD phase/plan/execute rhythm.** Worked well, ship the same discipline.
- **Same artifact chain** (CONTEXT.md → RESEARCH.md → PATTERNS.md → PLAN.md → SUMMARY.md → VERIFICATION.md → SECURITY.md → HUMAN-UAT.md).
- **Plan-checker iteration loop** with explicit BLOCKER/WARNING distinction.
- **`gsd-sdk` query verbs** as the centralized mechanics layer.
- **Linear sync convention** — phase = ENG issue, auto-sync at every GSD event. Worked cleanly.

### What v0.2 Should Do Differently

- **Wire all eval gates into CI on day one** (don't accept "we'll wire it later") — ENG-10
- **Treat Phase 7 / final phase as a deferred-UX cleanup phase explicitly** — bake in time to actually fix the friction the earlier phases papered over (ENG-11 is the prototype)
- **Use the `[route]` tracker for every code-producing Agent spawn from day one** — and emit the routing-log summary at phase close for retrospective audit
- **Audit todos folder at every phase-complete** and close anything resolved by the phase's D-decisions (the `resolves_phase:` frontmatter + auto-close exists; use it consistently)
- **Re-evaluate scope deferrals at milestone close, not at next milestone start** — i.e., when MILESTONES.md gets written, audit what was deferred and decide what's pulling forward (ENG-11 pattern)

---

## Milestone: v0.2 — Intelligence Layer

**Shipped:** 2026-06-12
**Phases:** 5 | **Plans:** 29 | **Tasks:** 40 | **Span:** 2026-06-03 → 2026-06-11 (8 days)

### What Was Built

The intelligence layer on top of v0.1's substrate: (1) hybrid-rank weight tuning via a 625-config sweep with Pareto/overfit/sensitivity gates; (2) conflict detection wired into the live triage flow (`conflict-pipeline.ts`, `ctx.waitUntil`, inbox writes, read-only `recall()` surfacing); (3) query expansion with cosine-gated paraphrases, adaptive fan-out, RRF, and a 429 fallback; (4) synthesis activation (`recall(verbosity=synthesis)`) with citation-density, cosine-hedging, and a zero-hallucinated-entities judge gate. Foundation work expanded the eval corpus 27→100 and stood up tiered vitest with a `MAX_AI_CALLS=200` budget guard.

### What Worked

- **The eval-corpus-first sequencing (Phase 1) paid off.** Every downstream quality gate (RNK sweep, EXP ablation, SYN judge) rested on the 100-entry labeled corpus; landing it before feature work made the gates statistically meaningful instead of decorative.
- **Letting an ablation kill a feature.** bge-reranker was integrated, measured, found worse than raw cosine, and shipped disabled at weight 0.0. The discipline to ship a negative result (rather than force the feature) is the system working as designed.
- **Accepted overrides instead of fudged gates.** SYN-02's passRate gate was recalibrated to advisory with the robust zero-hallucinated half kept hard — recorded honestly as an override with backlog follow-ups, not silently lowered.
- **The `MAX_AI_CALLS=200` budget guard.** Forced serialization of eval sessions (RNK vs CON, EXP-07 vs EXP-08) and prevented CI bill-shock across 4 feature eval suites.

### What Was Inefficient

- **VALIDATION.md tracking lag.** All 5 phases left their per-task validation maps in `draft`/`⬜-pending` state even though the tests existed and passed — requiring a full `/gsd:validate-phase 1..5` reconciliation pass at milestone close. The tests were written; the tracking docs just never got flipped to green during execution.
- **SUMMARY `requirements-completed` frontmatter mostly left empty**, so the milestone audit's 3-source cross-reference leaned almost entirely on VERIFICATION tables + the REQUIREMENTS registry.
- **cf-code-assist routing stayed low** despite v0.2 being projected as a content-generation (40–60% route) phase — the contract-integration character (byte-frozen prompts, cross-file envelope invariants) dominated more than projected.

### Patterns Established

- **Eval-tier creds-gating** (`hasEvalCreds` + `ENGRAM_RUN_EVAL=1`) cleanly separates cheap no-creds unit tests from billable Workers AI eval runs.
- **Deploy-gated metrics as a first-class deferral category** — latency SLAs (EXP-11) and staging E2E (INT-05) that genuinely cannot be confirmed pre-deploy are tracked as "verify at deploy," not faked locally.
- **Reranker-or-cosine fallback behind a live boolean flag** (`RERANKER_ENABLED`) so a disabled feature is dormant config, not deleted code.

### Key Lessons

- **Flip the VALIDATION.md status during execution, not at close.** The reconciliation was cheap only because the tests genuinely passed; if they hadn't, the lag would have hidden real gaps until milestone close. Treat `nyquist_compliant` as a per-phase exit gate, not a milestone-close chore.
- **A negative eval result is a deliverable.** Budget for the ablation arm to potentially disable the feature — and write the changelog rationale either way.

### Cost Observations

- Model mix: Opus-heavy orchestration (contract integration, eval design, override decisions); cf-code-assist routes lower than the content-generation projection.
- Notable: the 100-entry corpus labeling (Russell's manual time) was the critical path for the whole milestone, exactly as Phase 1 risk notes predicted.

### What v0.3 Should Inherit From v0.2

- Eval-corpus-first sequencing; the `MAX_AI_CALLS` budget guard; the accepted-override discipline; deploy-gated deferral category.

### What v0.3 Should Do Differently

- Reconcile VALIDATION.md to green at each phase exit (not at milestone close). Populate SUMMARY `requirements-completed` frontmatter during execution so the audit's 3-source check is real. Re-confirm the deploy-gated v0.2 items (EXP-11, INT-05) at first v0.3 deploy.

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Tasks | Span | Audit verdict |
|-----------|--------|-------|-------|------|---------------|
| v0.1 MCP Foundation | 7 | 44 | 93 | 2026-05-24 → 05-30 | shipped |
| v0.2 Intelligence Layer | 5 | 29 | 40 | 2026-06-03 → 06-11 | tech_debt (no blockers) |

**Emerging patterns:**

- **Tracking-doc lag at close** surfaced in v0.2 (VALIDATION.md drafts; sparse SUMMARY frontmatter). Watch whether v0.3 repeats it — if so, it's process, not a one-off.
- **Plans-per-phase tightening** (v0.1 ~6.3 → v0.2 ~5.8) as the eval-gated workflow front-loads discipline into fewer, denser plans.
