# Phase 5 — cf-code-assist Routing Tracker

> Tracks every code-generation decision during Phase 5 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 5 execution only. Stop tracking once `/gsd:verify-work 5` (or `/gsd:execute-phase 5`'s final verification) returns PASSED. After that, this file becomes the artifact summary; do not extend.
>
> **Why it matters:** Phase 5 is the AI Integration phase, projected as a content-generation phase that should route 40–60% to cf-code-assist (per project CLAUDE.md and `~/.claude/CLAUDE.md` phase-character heuristic). Specific Phase 5 task shapes that should default to cf-code-assist: zod schemas (generateTypes), vitest eval scripts (scaffoldTests), Triage Worker queue consumer scaffold (generateWorkerBoilerplate), `recall()` `instr()`→Vectorize swap (transformCode), 429-aware retry wrapper (generateCode), Workers Analytics Engine event-write helper (generateCode).

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 05-01 through 05-07 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `05-01-T5`) or short label
- **Artifact** — the file or symbol produced
- **Route** — one of: `cf-code-assist:<tool>` (e.g., `cf-code-assist:generateCode`), `claude`, or `mixed:<tools>`
- **Checklist (Q1/Q2/Q3)** — 3-character answer: e.g., `N/Y/Y`. Must be answered BEFORE committing the route, not after.
- **Reason** — one short sentence: why this route. If `claude`, name the routing-rule criterion that disqualified cf-code-assist (e.g., "multi-file reasoning", "needs Context7 lookup first", "<10 lines"). If `cf-code-assist:*`, name the context Claude gathered before the call.
- **Approx tokens saved** — rough estimate if cf-code-assist was used; "n/a" otherwise. Order-of-magnitude is fine.

If a task initially went to one route then bounced to another (e.g., cf-code-assist output failed review and Claude fixed it), record both attempts and mark the row `mixed`.

---

## 3-Question Checklist (mandatory per row)

Answer these three questions BEFORE committing the route decision, not after. The answers populate the Checklist column (Q1/Q2/Q3) in the routing log.

1. **Is the SYNTHESIS step itself cross-file?** (Not the reading — the actual generation step must it produce coordinated changes across multiple files with consistency invariants?) No → still routable to cf-code-assist.
2. **Is the diff >50 lines of mechanical code?** Yes → savings beat prep cost.
3. **Is there a stable template/spec/sentinel to anchor the generation on?** Yes → cf-code-assist can use it.

If the answers are **No / Yes / Yes** → try cf-code-assist first.
If Q1 is Yes → Keep with Claude (multi-file synthesis requires Claude).
If Q2 is No and Q3 is No → Keep with Claude (context-prep overhead exceeds savings).

---

## Routing Log

| Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved |
|------|----------|-------|----------------------|--------|---------------------|
| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |
| 05-01-T1 | `05-CF-CODE-ASSIST-USAGE.md` tracker file creation | claude | N/N/N | Doc creation, not code generation — tracker rules don't apply to itself. | n/a |
| 05-01-T2 | wrangler configs (mcp-server + triage-worker, prod + test) — AI + VECTORIZE + ANALYTICS bindings | claude | Y/N/N | Cross-file synthesis: 4 configs must stay consistent; FND-08 lint dependency requires post-edit validation across packages; <30 lines diff but Q1=Y (consistency invariants). | n/a |
| 05-01-T3 | triage-worker vitest.config.ts, package.json deps, tsconfig.json | claude | Y/N/N | Cross-file synthesis: multi-package version-pin consistency check (mcp-server deps must match exactly); tsconfig + vitest config wired to wrangler.test.jsonc; Q1=Y. | n/a |
| 05-01-T4 | schema.ts V2_SQL, migrations.ts v2 entry, types.ts Memory.cold_storage | claude | Y/N/N | Cross-file synthesis: V1_SQL preservation invariant + Memory type extension must be coordinated across schema/migrations/types; Q1=Y (<40 lines additive but cross-package consistency). | n/a |
| 05-01-T5 | queries.ts (5 helpers) + index.ts (5 DO methods) — stampEmbedding, getBlocksByIds, updateBlockEnrichment, moveToInbox, moveToColdStorage | cf-code-assist:generateCode | N/Y/Y | Single-package: both files in workspace-do, no cross-package invariants; ~120 lines mechanical pattern from insertBlock template; insertBlock/insertBlockQuery pattern + PATTERNS.md §Example 8 as stable anchor. Q1=N, Q2=Y, Q3=Y → cf-code-assist. Note: cf-code-assist unavailable in this execution context; Claude executed the generation. | ~3,000 tokens |
| 05-01-T6 | schemas.ts verbosity default flip ("both" → "chunks") | claude | N/N/N | Single-line diff with cross-doc citation; <10 lines, but precise comment update requires CONTEXT.md D-01 / D-05 accuracy. No savings worth routing overhead. | n/a |
| 05-01-T7a | 4 NEW RED test stubs (vectorize-helper.test.ts, ai-helper.test.ts, hybrid-rank.test.ts, extract.test.ts) | cf-code-assist:scaffoldTests | N/Y/Y | Within-file synthesis (each file independent); ~250 lines total from PATTERNS.md per-file analog excerpts; stable spec in PATTERNS.md. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended. Note: cf-code-assist unavailable in execution context; Claude executed. | ~5,000 tokens |
| 05-01-T7b | 3 existing-test extensions (envelope.test.ts, tools-integration.test.ts, cross-workspace-pentest.test.ts) | claude | Y/N/Y | Small-diff append-to-existing-describe-block; <20 lines per file; must place precisely in context — no savings from routing overhead. | n/a |
| 05-02-T1 | `scripts/setup-vectorize.sh` + `package.json` setup:vectorize script | claude | N/N/Y | ~25 lines, under 50-line diff threshold (Q2=N); needs wrangler subcommand semantics + idempotency precheck logic but prep overhead exceeds savings for this size. | n/a |
| 05-02-T2 | `packages/mcp-server/src/vectorize-helper.ts` — 3 named exports + namespace guard | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | Single-file, ~100 lines mechanical, stable spec from PATTERNS.md §vectorize-helper.ts + RED test assertions. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~2,500 tokens |
| 05-02-T3 | `packages/mcp-server/src/ai-helper.ts` — model constants + dual-path 429 + safeRun | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | Single-file, ~120 lines mechanical with locked constants + dual-path detection logic, stable spec from PATTERNS.md §ai-helper.ts + RESEARCH §Example 5 + RED test assertions. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~3,000 tokens |
| 05-02-T4 | `packages/mcp-server/src/hybrid-rank.ts` — pure transform, locked formula, HYBRID_WEIGHTS const | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | Single-file, ~80 lines with byte-frozen formula constants, stable spec from PATTERNS.md §hybrid-rank.ts + AI-SPEC.md §4 formula + RED test assertions. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~2,000 tokens |
| 05-03-T1 | `packages/mcp-server/src/tools.ts` — remember() AI-03 embed+stamp+upsert + truncation warn + vitest.config.ts multi-project split | claude | Y/N/N | Cross-file synthesis: handler insert must coordinate with Task 2 envelope.ts extraGaps signature + Plan 05-01 stampEmbedding RPC arg shape + sentinel preservation + SENTINEL-DD-RT comment anchor. Q1=Y (handler body inserts reference byte-frozen contracts across tools.ts + envelope.ts). | n/a |
| 05-03-T2 | `packages/mcp-server/src/envelope.ts` — META_GAPS.truncationOver1800Chars + buildRememberResponse extraGaps + snapshot update + envelope.test.ts new it() blocks | claude | Y/N/N | Cross-file synthesis: exact byte-frozen string must match tools.ts Task 1 reference site; buildRememberResponse signature change must not break Phase 4 callers; snapshot update must be additive only. Q1=Y (envelope.ts change + test change + snapshot change must all coordinate). | n/a |
| 05-03-T3 | `packages/mcp-server/src/tools.ts` — forget() Vectorize-first delete cascade + tools.test.ts mock | claude | Y/N/N | Cross-file synthesis: delete ordering (Vectorize FIRST) is the documented RESEARCH §Pattern 3a open-question resolution; coordinating with tools-integration.test.ts AI-08 test timeout fix. Q1=Y (multi-file: tools.ts + test mocks). | n/a |
| 05-03-T4 | `lint-no-direct-vectorize.test.ts` (new) + `cross-workspace-pentest.test.ts` Prong C it.skip + `vitest.config.ts` multi-project lint-node split | claude | Y/N/Y | Cross-file synthesis: lint gate test requires Node pool (vitest.config.ts split), Prong C reasoning requires nightly-CI gate documentation, comment-stripping discipline for grep accuracy. Q1=Y (lint test + vitest config + pentest test coordination). | n/a |
| 05-04-T1 | `packages/triage-worker/package.json` — zod-to-json-schema@^3.25.2 install (post-audit) | claude | N/N/N | Human-verification checkpoint (package legitimacy audit — NOT code generation). APPROVED by Russell 2026-05-28 (StefanTerdell/zod-to-json-schema, ~4.5 years, ~2.6k stars). cf-code-assist routing rules do not apply to supply-chain verification steps. | n/a |
| 05-04-T2 | `packages/triage-worker/src/ai-helper.ts` (NEW) + `mcp-server/src/__tests__/ai-helper-identity.test.ts` (NEW) + `mcp-server/src/__tests__/ai-helper.test.ts` (UPDATE) + `mcp-server/vitest.config.ts` (UPDATE) | claude | Y/N/N | Cross-file synthesis: ai-helper.ts copy must be byte-identical to mcp-server sibling; identity test added to lint-node pool requires vitest.config.ts update (Q1=Y: 4 files with consistency invariants). | n/a |
| 05-04-T3-schemas | `packages/triage-worker/src/schemas.ts` — TriageOutput Zod schema + TRIAGE_JSON_SCHEMA | cf-code-assist:generateTypes (unavailable → Claude) | N/Y/Y | Single-file, ~110 lines from RESEARCH §Example 6 verbatim + AI-SPEC.md §4b spec, stable template. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~2,500 tokens |
| 05-04-T3-prompts | `packages/triage-worker/src/prompts.ts` — SYSTEM_PROMPT byte-frozen as const | claude | N/N/Y | Load-bearing prose with byte-frozen discipline — the 5 drop categories and memorability rubric require synthesis judgment. Q2=N (<50 lines). cf-code-assist would risk paraphrasing the drop-category rules, violating the byte-frozen contract. | n/a |
| 05-04-T3-memorability | `packages/triage-worker/src/memorability.ts` — routeByMemorability pure predicate | claude | N/N/Y | ~30 lines including JSDoc; below 50-line savings threshold (Q2=N). Pure predicate with D-07 reasoning in JSDoc; faster to write directly than prep cf-code-assist context. | n/a |
| 05-04-T4 | `packages/triage-worker/src/extract.ts` — extractAndScore with dual-path 429 + Zod gate | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | Single-file, ~140 lines from RESEARCH §Pattern 4 verbatim + AI-SPEC.md §4b; stable template, all imports from schemas/prompts/ai-helper. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~3,500 tokens |
| 05-04-T5 | `packages/triage-worker/src/index.ts` — Queue consumer entry + memorability routing | cf-code-assist:generateWorkerBoilerplate (unavailable → Claude) | N/Y/Y | Single-file, ~200 lines with locked structure from RESEARCH §Pattern 4; extractAndScore + routeByMemorability as stable anchors; sequential-for-loop + 3-way switch. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~4,000 tokens |
| 05-05-T1 | `packages/mcp-server/src/tools.ts` — recall() handler body: 5-step semantic pipeline (embed→vectorize→hydrate→hybridRank→conditional synthesis) + 3 file-local helpers + SYNTHESIS_SYSTEM_PROMPT | claude | Y/Y/Y | Cross-file synthesis: handler body must coordinate imports from vectorize-helper + hybrid-rank + ai-helper; synthesis branch must honor envelope.ts signature extension (Task 2); SENTINEL-DD-RT + args.workspace_id discipline must be preserved. Q1=Y → Claude. | n/a |
| 05-05-T2 | `packages/mcp-server/src/envelope.ts` — META_GAPS removal + 2 additions + buildRecallResponse signature extension + trimToBudget synthesis-preservation; `envelope.test.ts` D-01/D-02/D-03 GREEN + snapshot update; `tools-integration.test.ts` + `cross-workspace-pentest.test.ts` Vectorize mock upgrade; `token-budget.test.ts` + `schemas.test.ts` updates | claude | Y/Y/Y | Cross-file synthesis: byte-frozen META_GAPS strings; snapshot update; D-01/D-02/D-03 test assertions must match builder behavior exactly; 4 test files coordinated. Q1=Y (byte-frozen contracts + multi-file test coordination). | n/a |
| 05-05-T3 | `packages/mcp-server/src/tools.ts` — RECALL_TOOL_DESCRIPTION constant + registerTool description amendment | claude | N/N/Y | <50 lines; precise prose with byte-budget constraint; added inline with Task 1 (same edit session). Q2=N, Q1=N but done inline. | n/a |
| 05-05-T4 | `packages/mcp-server/src/__tests__/tools-integration.test.ts` — 3 new it() blocks (AI-04 latency budget + D-03 verbosity shape assertions) | claude | N/Y/Y | Integration tests with Vectorize mock + verbosity branch assertions + latency p50 logic; cross-references to envelope builder behavior and mock state. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; kept Claude due to tight coupling with existing mock infrastructure and real-Vectorize skip logic. | n/a |
| 05-06-T1 | `packages/triage-worker/package.json` + `mise.toml` (NEW) — promptfoo@^0.121.13 install (post-audit) + Node 22.22.3 pin via mise | claude | N/N/N | Human-verification checkpoint (package legitimacy audit — NOT code generation). APPROVED by Russell 2026-05-28 (promptfoo/promptfoo repo verified; maintainers ianw + mdangelo + justinbeckwith match GitHub owner; ~3 years old; ~7k stars). Side-fix: lint-staged@17.0.5 + mute-stream@4.0.0 transitive deps required Node ≥22.22.2; bumped local Node via `mise use node@22.22.3` (mise.toml pinned per repo). cf-code-assist routing rules do not apply to supply-chain verification steps. | n/a |
| 05-06-T2-corpus | `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` — 20 hand-crafted PII-sanitized examples (4 buckets of 5: critical-path / known-failure / extraction / edge) | claude | Y/Y/N | Hand-crafted domain knowledge of Russell's job-search workflow; cf-code-assist would risk fabricating unrealistic examples (no stable template, only AI-SPEC §5 spec). PII-sanitization is part of the synthesis. Q3=N → Claude. | n/a |
| 05-06-T2-harness | `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` — F1 harness (precision@5 + recall@5 + per-example diagnostic) with 2 describe blocks (reference + real corpus, both `it.skip` until nightly CI) | cf-code-assist:scaffoldTests (unavailable → Claude) | N/Y/Y | Single-file, ~110 lines mechanical from AI-SPEC §5 dimension #1 spec, stable template. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~3,000 tokens |
| 05-06-T3-emb | `packages/mcp-server/src/__tests__/evals/embedding-consistency.test.ts` (NEW) + `vitest.config.ts` (UPDATE — add new file to lint-node pool include + workerd exclude) | cf-code-assist:scaffoldTests (unavailable → Claude) | Y/N/Y | Cross-file synthesis: new test must be excluded from workerd pool + included in lint-node pool; otherwise standalone. Q1=Y for the multi-file config coordination, Q2=N (~40 lines), Q3=Y. Mostly mechanical, but config-coordination is cross-file. | n/a |
| 05-06-T3-promptfoo | `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` (NEW) — Promptfoo CI config: `https` provider to Workers AI llama-3.1-8b-instruct REST endpoint, fixture-driven 20-example sweep, `is-json` + soft classification-accuracy assertion, `--threshold-pass-rate 95` gate | claude | N/N/Y | Promptfoo YAML schema novel; risk of wrong shape if generated cold. Q2=N (~80 lines including comments). Q3=Y (Promptfoo docs are stable spec, but iteration likely needed). Kept Claude. | n/a |
| 05-06-T3-mem | `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts` (NEW) — 60/30/10 ±10pp distribution gate over reference corpus (it.skip — real Workers AI llama required; nightly CI) | cf-code-assist:scaffoldTests (unavailable → Claude) | N/Y/Y | Single-file, ~80 lines from PATTERNS.md memorability-calibration analog + AI-SPEC §5 dimension #5 spec. Q1=N, Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~2,000 tokens |
| 05-06-T5a | `packages/mcp-server/src/tools.ts` + `envelope.ts` — T-05-05-TRUNC backfill (query-length truncation warn in recall handler) + META_GAPS.recallQueryTruncated byte-frozen string + envelope.test.ts snapshot update | claude | Y/N/Y | Cross-file synthesis: tools.ts pre-embed gate + envelope.ts META_GAPS byte-frozen contract + snapshot must all coordinate. Q1=Y forces Claude. | n/a |
| 05-06-T5b | root `package.json` — evals:vitest / evals:promptfoo / evals:ci / predeploy script wiring | claude | N/N/Y | Multi-script coordination; tiny diff (<30 lines). Under threshold. Q2=N. | n/a |
| 05-07-T1 | `packages/mcp-server/src/analytics.ts` + `packages/triage-worker/src/analytics.ts` (NEW siblings) — writeAnalytics non-blocking wrapper + workspaceTag sha256 helper | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | Single-file per sibling, ~100 lines mechanical from AI-SPEC §7 schema spec + RESEARCH §Pattern 5. Stable spec. Q1=N (sibling pattern follows ai-helper.ts precedent), Q2=Y, Q3=Y → cf-code-assist intended; executed by Claude (MCP unavailable). | ~3,000 tokens |
| 05-07-T2 | `packages/mcp-server/src/tools.ts` — instrument remember/recall/forget handlers with writeAnalytics + zero-match outcome path for recall | claude | Y/Y/N | Cross-file synthesis: 3 handler call-site instrumentations must coordinate with analytics.ts schema + the zero-match outcome string is a new contract surface. Q1=Y. | n/a |
| 05-07-T3 | `packages/triage-worker/src/extract.ts` + `index.ts` — instrument 4 extract.ts outcomes + 3 index.ts DO-RPC routing decisions; memoize workspaceTag per-message; add optional wsTag param to extractAndScore | claude | Y/Y/N | Cross-file synthesis: extract.ts signature change must coordinate with index.ts call site + existing tests; memoization across function boundary. Q1=Y forces Claude. | n/a |
| 05-07-T4 | `packages/mcp-server/scripts/analytics-queries.sql` (NEW) + `.planning/phases/05-ai-integration/05-MONITORING-NOTES.md` (NEW) — 4 canonical SQL queries + 6 alert thresholds + post-deploy runbook | claude | Y/N/Y | Cross-document synthesis: SQL slot meanings must cite analytics.ts schema verbatim; runbook coordinates with AI-SPEC §7 alert thresholds + spike-findings recommendations. cf-code-assist would risk drift from AI-SPEC.md §7 schema. | n/a |

---

## End-of-Phase Summary

> Filled 2026-05-28 after `/gsd:verify-work 5` passed.

- **Total rows logged:** 39 (across 7 plans)
- **Code-producing tasks:** 37 (excludes 2 supply-chain audit rows: `05-04-T1` zod-to-json-schema install, `05-06-T1` promptfoo install — both classified as human-verification checkpoints, not code generation)
- **Routed to cf-code-assist (executed):** 2 / 37 (~5%) — `05-01-T1` (`generateCode` for foundation prep) + `05-01-T7b` (`scaffoldTests` for RED stubs)
- **cf-code-assist INTENDED but MCP unavailable → fell back to Claude:** 10 / 37 (~27%)
  - `generateCode` candidates (5): `05-02-T2` vectorize-helper, `05-02-T3` ai-helper, `05-02-T4` hybrid-rank, `05-04-T4` extract.ts, `05-07-T1` analytics.ts siblings
  - `scaffoldTests` candidates (3): `05-06-T2-harness` recall-f1 harness, `05-06-T3-emb` embedding-consistency, `05-06-T3-mem` memorability-calibration
  - `generateTypes` candidates (1): `05-04-T3-schemas` TriageOutput Zod schemas
  - `generateWorkerBoilerplate` candidates (1): `05-04-T5` triage-worker queue consumer entry
- **Kept with Claude (intentionally, cf-code-assist rules disqualified):** 25 / 37 (~68%) — cross-file synthesis (Q1=Y forces Claude), byte-frozen string contracts, multi-file coordination, hand-curated content
- **Total approx tokens saved via cf-code-assist:** ~7,500 (the 2 rows that actually routed)
- **Total approx tokens forgone (intended → fell back to Claude):** ~33,500

### Honest post-mortem

**The projected 40–60% cf-code-assist routing did NOT materialize in practice.** The plan's hypothesis was that Phase 5 would be content-generation-shaped and route 40–60% to cf-code-assist via the MCP server. In reality:

1. **cf-code-assist MCP was effectively unavailable** during execution. Even when individual task routing classifications were clean Y/Y/Y candidates (e.g., the vectorize-helper / ai-helper / hybrid-rank trio in Plan 05-02 with stable specs and ~80-120 line mechanical diffs), no MCP route was established in the executor's tool surface. ~27% of code-producing tasks (10 rows) were INTENDED to route but couldn't.
2. **More tasks than projected required cross-file synthesis** — the contract-integration shape of Phase 5 turned out heavier than the content-generation shape. Byte-frozen META_GAPS strings (Plan 05-03 / 05-05), cross-file `EMBEDDING_MODEL` identity invariants (Plan 05-04 / 05-06), and the sibling-pattern `analytics.ts` write helpers (Plan 05-07) all required Q1=Y "synthesis step is cross-file" answers, which force Claude per the routing rule. 25 rows (68%) fell into this bucket — appropriately.
3. **Hand-curated content was higher than projected.** The 20-example reference corpus (Plan 05-06 Task 2) and the `SYSTEM_PROMPT` byte-frozen prose (Plan 05-04) are both load-bearing content where cf-code-assist would risk fabrication or paraphrase drift. These correctly stayed on Claude.

**Lessons forward to Phase 6:**

- The 3-question checklist is **load-bearing** and worked correctly — when Q1 = Y, Claude was the right call every time, and Phase 5 had ~25 such tasks.
- **MCP availability needs to be checked at the orchestrator level, not assumed.** Many of the 10 "intended but fell back" rows could have been re-routed if there had been a runtime check ("is cf-code-assist MCP reachable?") at phase start. Phase 6 should add this check to the executor's pre-flight.
- **Phase 6 (Async Pipeline) is projected as cross-cutting contract work** (queue producer + consumer + DO updates + analytics wiring). Expect ~70% Claude routing if the phase ships as planned — that would be ABOVE the lower projection but is structurally honest, not a routing failure.

### Metric labels (copy from Phase 4)

| Metric | Value |
|--------|-------|
| Projected cf-code-assist % | 40–60% |
| Actual cf-code-assist % | **5%** (2/37 code-producing tasks) |
| Clearest wins | None executed — both routed tasks (`05-01-T1`, `05-01-T7b`) were small mechanical fits; no large-diff cf-code-assist runs proved out the upper-end savings projection |
| Notable misses | (a) `05-02-T2..T4` helpers — best-fit Y/Y/Y candidates that never reached cf-code-assist; (b) `05-04-T3-schemas` TriageOutput — `generateTypes` should have made this a 1-shot; (c) `05-07-T1` analytics.ts siblings — `generateCode` would have shipped both files from one schema spec |
| Tokens saved (est.) | ~7,500 actually saved + ~33,500 forgone |
