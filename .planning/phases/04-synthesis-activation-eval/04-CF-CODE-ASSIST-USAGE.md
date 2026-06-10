# Phase 4 — cf-code-assist Routing Tracker (v0.2 milestone)

> Tracks every code-generation decision during Phase 4 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 4 (Synthesis Activation Eval — SYN workstream) execution only. Stop logging when `/gsd:verify-work 4` passes. After that, this file becomes the artifact summary; do not extend.
>
> **Why it matters:** Phase 4 is the v0.2 synthesis activation + eval phase. Per CLAUDE.md's phase-character heuristic this is a MIXED phase: contract-integration work (byte-frozen prompt wiring, SYN-02 judge-prompt rubric authoring, SYN-09 analytics blob changes — stays with Claude) and content-generation work (eval test scaffold, post-processor helpers, caption-generation script — cf-code-assist candidates). Realistic content-generation share is expected `20–35%` — higher than Phase 1's `<10%` foundation share, lower than the projected Phase 5 `40–60%` AI-integration share. The tracker exists to enforce the routing discipline at the moment of truth (BEFORE each task's commit), not retrospectively.

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 04-01 through 04-04 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `04-01-T1`) or short label
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

## Phase 4 candidate task shapes (planning guidance, not pre-filled log rows)

The following task shapes are flagged as cf-code-assist candidates per CONTEXT.md D-10. The executor still answers the 3-question checklist at execution time — these are starting hypotheses, not auto-routes.

**From CONTEXT.md D-10 (4 candidates):**

1. `synthesis-fidelity.eval.test.ts` judge-call loop scaffold — vitest eval body, stable `recall-latency.eval.test.ts` template + judge-call pattern + Zod schema spec. Tool: `scaffoldTests` (N/Y/Y candidate).
2. position→`[memory_id]` post-processor helpers in `tools.ts` (`mapPositionsToCitationIds`, `dropUncitedSentences`, `applyHedgePrefix`) — pure-function transforms, stable spec from D-02/D-09/SYN-06 patterns. Tool: `generateCode` (N/Y/Y candidate).
3. `generate-synthesis-captions.mjs` script body — ESM CLI, stable template (mirrors `sync-eval-corpus.mjs`). Tool: `generateCode` (N/Y/Y candidate).

**Task shapes that should stay with Claude** (per CONTEXT.md D-10):

- Byte-frozen-prompt-adjacent wiring (any edit adjacent to `SYNTHESIS_SYSTEM_PROMPT`) — SYN-10 byte-freeze, one character drift invalidates the eval baseline.
- SYN-02 judge-prompt rubric authoring — faithfulness rubric is a correctness-critical contract; authorial precision is the work.
- SYN-09 analytics blob/double changes — cross-file SYNTHESIS: touches `writeAnalytics` callers in synthesis block, existing blob schema, and the Analytics Engine binding contract simultaneously.

---

## Routing Log

| Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved |
|------|----------|-------|----------------------|--------|---------------------|
| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |
| 04-01-T1 | `shared/ai-config/src/index.ts` JUDGE_MODEL constant + `04-CF-CODE-ASSIST-USAGE.md` tracker scaffold | claude | Y/N/N | <10 lines constant + doc scaffold, under 50-line threshold; no stable template for the doc-on-doc routing (mirrors Phase 2 02-01-T3 precedent). | n/a |

---

## End-of-Phase Summary

_TBD — populated at /gsd:verify-work 4 close._
