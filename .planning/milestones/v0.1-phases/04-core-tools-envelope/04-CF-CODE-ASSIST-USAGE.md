# Phase 4 — cf-code-assist Routing Tracker

> Tracks every code-generation decision during Phase 4 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 4 execution only. Stop tracking once `/gsd:verify-work 4` (or `/gsd:execute-phase 4`'s final verification) returns PASSED. After that, this file becomes the artifact summary; do not extend.
>
> **Why it matters:** The routing rules in `~/.claude/CLAUDE.md` say Cloudflare Workers AI handles generation; Claude handles orchestration. Phase 4 is the first heavy-generation phase (5 handler bodies, `envelope.ts`, 4 test files, README amend). This tracker tells us whether the rules survive contact with reality or need refinement before Phase 5.

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 04-01 through 04-05 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `04-01-03`) or short label
- **Artifact** — the file or symbol produced
- **Route** — one of: `cf-code-assist:<tool>` (e.g., `cf-code-assist:generateCode`), `claude`, or `mixed:<tools>`
- **Reason** — one short sentence: why this route. If `claude`, name the routing-rule criterion that disqualified cf-code-assist (e.g., "multi-file reasoning", "needs Context7 lookup first", "<10 lines"). If `cf-code-assist:*`, name the context Claude gathered before the call.
- **Approx tokens saved** — rough estimate if cf-code-assist was used; "n/a" otherwise. Order-of-magnitude is fine.

If a task initially went to one route then bounced to another (e.g., cf-code-assist output failed review and Claude fixed it), record both attempts and mark the row `mixed`.

---

## Routing Log

| Task | Artifact | Route | Reason | Approx tokens saved |
|------|----------|-------|--------|---------------------|
| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |
| 04-01-02 | `shared/types/src/index.ts` widen `meta.confidence` + `meta.coverage` to `number \| null` | claude | Multi-file reasoning needed (had to verify no existing consumers of `EngramResponse.meta.*` across all workspaces before widening); <10 line diff after context analysis | n/a |
| 04-01-02 | `npm install gpt-tokenizer@^3.4.0` to `packages/mcp-server` | claude | Package install (not code generation); supply-chain gate already approved by human reviewer | n/a |
| 04-01-03 | `schemas.ts` — add `verbosity` to `RecallInputSchema`, add `limit` to `SearchInputSchema`, tighten both to `max(25)` | claude | Multi-file context needed (04-CONTEXT.md D-03/D-10, spike-findings SKILL.md §1, existing schema shape) before diff; <15 line additive diff after context read | n/a |
| 04-01-03 | `schemas.test.ts` — 8 new test assertions for verbosity + limit | claude | Cross-file reasoning with TDD RED/GREEN cycle; test referenced existing file shape; needed full file context | n/a |
| 04-01-04 | `result-types.ts` — 6 typed result interfaces (RememberResult, RecallChunk, RecallResult, SearchResult, ForgetResult, IngestResult) | claude | Architecture reasoning needed (LexicalSearchHit import chain, import type verbatimModuleSyntax compliance, D-05/D-06/D-07 decisions); multi-file context from CONTEXT.md + workspace-do/types.ts + PATTERNS.md | n/a |
| 04-01-05 | `envelope.test.ts` (NEW) — 14 RED assertions for envelope builders + META_GAPS snapshot (TOL-06) | claude | Cross-file reasoning: needed CONTEXT.md D-04/D-06/D-07/D-08, PATTERNS.md analog, result-types.ts shape; tests reference not-yet-existing envelope.ts module | n/a |
| 04-01-05 | `tools-integration.test.ts` (NEW) — 8 RED round-trip tests (TOL-01..05) | claude | Multi-file: captureCallback pattern from PATTERNS.md, DO method surface from workspace-do/index.ts, vitest-pool-workers cloudflare:test + cloudflare:workers APIs | n/a |
| 04-01-05 | `cross-workspace-pentest.test.ts` (NEW) — 2 RED prong tests (TOL-07) | claude | Security reasoning: two-prong test design from RESEARCH §Pattern 4; DO method + assertOwnsWorkspace message contract from Phase 2 code | n/a |
| 04-01-05 | `token-budget.test.ts` (NEW) — 3 RED budget assertions (MCP-08) | claude | Multi-file: gpt-tokenizer import path (Pitfall 6), D-10 worst-case fixture spec, TextEncoder workerd-native pattern; references envelope.ts which doesn't exist yet | n/a |
| 04-01-05 | `tools.test.ts` (EXTEND) — replace MethodNotFound stubs with happy-path callbacks (RED until Plan 03) | claude | In-file reasoning: preserve DD-RT sentinel block, replace MethodNotFound assertions with happy-path block; captureCallback helper addition | n/a |
| 04-01-05 | `error-mapping.test.ts` (EXTEND) — 3 Phase 4 regression lock assertions (GREEN) | claude | Additive test: context from existing error-mapping.ts behavior + PATTERNS.md §error-mapping.test.ts EXTEND | n/a |
| 04-02-01..09 | `packages/mcp-server/src/envelope.ts` (NEW) — all 8 named exports: META_GAPS const, 5 build*Response builders, trimToBudget, wrapMcpContent, plus file-local helpers | claude | Multi-file reasoning required: CONTEXT.md D-04/D-05/D-06/D-07/D-08/D-09/D-10, spike-findings-engram §3 (byte-frozen META_GAPS strings), PATTERNS.md builder templates, result-types.ts interfaces, token-budget.test.ts/envelope.test.ts RED contracts, workspace-do LexicalSearchHit shape — all needed simultaneously to produce a correctly-typed file that turns 18 RED tests GREEN | n/a |
| 04-03-01..05 | `packages/mcp-server/src/tools.ts` — swap 5 MethodNotFound stub callback bodies for live handlers (TOL-01..05) | claude | Multi-file cross-cutting reasoning required: PLAN.md interface contracts, CONTEXT.md D-05..D-10, RESEARCH.md Pitfall 1/4/5/7, PATTERNS.md canonical handler bodies, envelope.ts API, workspace-do method signatures, plus runtime debugging of getAgentByName vs plain DO stub issue that required Rule 1 fix — too much simultaneous cross-file context for cf-code-assist to handle without hallucinating the stub routing | n/a |
| 04-04-01..02 | `cross-workspace-pentest.test.ts` — live TOL-07 two-prong bodies: asWorkspaceDO shim, Prong A reinforcement assertion, Prong B Workspace mismatch message-shape lock-in | claude | Security reasoning across multiple files: defense-in-depth.test.ts:180-228 pattern mirror, RESEARCH §Pattern 4 two-prong design, WorkspaceDO.assertOwnsWorkspace message contract from Phase 2 — needed to understand the exact synchronous throw semantics (do NOT use .rejects) and the message shape lock-in | n/a |
| 04-04-03..05 | `token-budget.test.ts` — captureToolRegistrations helper, description-size refactor with toHaveLength(5), adversarial negative-fixture sanity test | claude | Multi-file reasoning: PLAN.md D-10 spec, tools.ts registration surface, gpt-tokenizer import path (Pitfall 6), TextEncoder workerd-native pattern, envelope.ts buildRecallResponse + trimToBudget behavior — cross-cutting enough to require the full context set | n/a |

| 04-06-T1 | `shared/types/src/index.ts` — widen Memory.type to `string \| null` + JSDoc; `packages/workspace-do/src/queries.ts` — relax narrowBlockRow invariant + cast; `packages/workspace-do/src/schema.ts` — relax `blocks.type TEXT NOT NULL` to `TEXT` | claude | Multi-file reasoning: schema constraint discovery required reading schema.ts + migrations.ts + queries.ts simultaneously; type widening needed cross-package impact analysis (LexicalSearchHit extension check); pre-existing error baseline check needed to confirm clean diff | n/a |
| 04-06-T2 | `packages/mcp-server/src/tools.ts` — change `args.type ?? "research_note"` to `args.type ?? null`; `packages/mcp-server/src/__tests__/tools-integration.test.ts` — add TOL-01-CR01 round-trip test | claude | Multi-file: test integration pattern from PATTERNS.md, recall callback wiring with workspace_id isolation, ESLint non-nullable-type-assertion-style vs no-non-null-assertion rule resolution; worktree/node_modules symlink issue required editing both worktree and main-repo symlink targets | n/a |

---

## End-of-Phase Summary

> Fill this in after `/gsd:verify-work 4` passes. Do not pre-populate.

- **Total code-producing tasks:** _TBD_
- **Routed to cf-code-assist:** _TBD_ (`X/N`, `XX%`)
- **Kept with Claude:** _TBD_
- **Mixed (re-routed):** _TBD_
- **Total approx tokens saved via cf-code-assist:** 0

### Honest post-mortem — was 0% right?

No. Walking back through the table after Phase 4 closed, the realistic split was:

| Category | Count | Tasks |
|---|---|---|
| **Clear missed opportunities** (textbook cf-code-assist shapes) | 5 | `schemas.test.ts` constraint assertions, `result-types.ts` 6 interfaces, `error-mapping.test.ts` additive locks, `token-budget.test.ts` budget assertions, `tools.test.ts` MethodNotFound → happy-path stub swap |
| **Partial misses** (some generation routable, some Claude-required) | 4 | `envelope.test.ts` structural scaffold, `tools-integration.test.ts` captureCallback layer, Plan 03 5-handler-body transform, `token-budget.test.ts` helper |
| **Legitimately Claude** | 6 | `envelope.ts` (7-doc cross-cutting + byte-frozen META_GAPS), cross-workspace pentest (security reasoning), Plan 06-T1 schema impact analysis, ESLint+symlink debug |
| **Not applicable** (not generation) | 1 | npm install |

Estimated tokens we left on the table: **~10-15K** if the 5 clear misses + half of the 4 partial misses had routed cleanly.

### Diagnosis: the routing rule was applied too coarsely

CLAUDE.md said **"Multi-file reasoning or cross-cutting changes → Keep with Claude."** That got read as **"any task that REQUIRED reading multiple files → Claude"** when it should have been **"any task whose GENERATION step requires synthesizing multiple files → Claude."**

For test scaffolding specifically, the multi-file READING is the planning step — Claude gathers PATTERNS.md + DO method signatures + CONTEXT.md decisions, then the **emission** step (`scaffoldTests` with packaged context) is cf-code-assist's sweet spot. The Phase 4 executor agents conflated those two steps and defaulted to Claude on every row.

### Other lessons

- **Context-prep friction is real.** For diffs under ~15 lines, packaging up CONTEXT.md excerpts + file references + spec snippets into a clean `context` parameter probably costs more tokens than it saves. The 5 clear misses above are all in the 50–150 line band where the math clearly works.
- **Runtime debugging breaks the contract.** Plan 03's handler-body swap started as a textbook `transformCode` case, but the `getAgentByName` symlink issue forced a debug round-trip mid-task. cf-code-assist can't course-correct on runtime errors it can't see. Lesson: route the first cut; fall back to Claude only when the failure mode surfaces.
- **RED-first TDD is hostile to cf-code-assist's type analysis.** Test files that import not-yet-existing modules confuse generators that try to infer types from the import graph. Plan 01's envelope.test.ts and tools-integration.test.ts hit this. Workaround: write the empty module stub first, then route the test scaffold.
- **Phase character predicts routing mix.** Phase 4 was a *contract-integration phase* (5 plans, all coordinating envelope/handler/test contracts across 3 packages). Phase 5 (AI Integration) is the opposite — *content-generation phase* with lots of zod schemas, vitest evals, Workers AI bindings. Expect a 40–60% cf-code-assist routing mix there.

### Phase 5 hypothesis — concrete bets

Phase 5's task shapes that should route to cf-code-assist (assuming Claude packages context correctly):

| Phase 5 task shape | cf-code-assist tool | Context Claude must package |
|---|---|---|
| Zod schemas for Triage AI structured outputs (entity-extraction, memorability scoring) | `generateTypes` or `generateCode` | AI-SPEC §4b schema spec + existing `shared/types/src/index.ts` patterns |
| Vitest eval scripts (recall F1 on reference corpus, classification accuracy harness) | `scaffoldTests` | AI-SPEC §5 dimension rubrics + reference-corpus.json schema + existing test helpers |
| Triage Worker queue consumer scaffold | `generateWorkerBoilerplate` | AI-SPEC §3 entry pattern + Cloudflare Queues docs (via Cloudflare MCP) + wrangler.jsonc binding shape |
| Mechanical recall() swap from instr() → Vectorize query | `transformCode` | AI-SPEC §3 Vectorize.query pattern + current tools.ts:recall body + namespace=workspace_id contract |
| 429-aware retry wrapper for Workers AI calls | `generateCode` | AI-SPEC §3 Pitfall 1 + Queue retry pattern |
| Workers Analytics Engine event-write helper | `generateCode` | AI-SPEC §7 schema (blobs[0..3] + doubles[0..3] + indexes[0]) + CF Analytics Engine docs |

### Recommended changes to `~/.claude/CLAUDE.md` AI routing section

Applied 2026-05-27. Key adjustments:

1. **Split "multi-file reasoning"** into READING (still routable; Claude packages context) vs SYNTHESIS (Claude). The Phase 4 default-to-Claude pattern came from conflating these.
2. **Add "task shape" examples** at the top of the "Route to" list — scaffoldTests, generateTypes, transformCode with sentinel anchors — instead of just verbs.
3. **Add a diff-size heuristic** — <15 lines mechanical = probably not worth the prep; 50–150 lines mechanical = clear win; >150 = strong win.
4. **Add a "phase character" note** — contract-integration phases lean Claude-heavy; content-generation phases lean cf-code-assist-heavy. Track per phase and reassess at /gsd:verify-work.
5. **Add a "Before defaulting to Claude" 3-question checklist** — "Is the SYNTHESIS step itself cross-file?", "Is the diff > 50 lines?", "Is there a stable template I can anchor on?". If "no, yes, yes" → try cf-code-assist first.

### Phase 5 tracking forward

The Phase 4 routing-tracker pattern carries forward to Phase 5 as `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` — but with an active forcing-function column: **"Did Claude apply the 3-question checklist BEFORE committing the route?"** That converts the tracker from a passive log into a routing-decision audit. Stop tracking when `/gsd:verify-work 5` passes.
