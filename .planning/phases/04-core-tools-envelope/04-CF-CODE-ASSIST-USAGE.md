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

---

## End-of-Phase Summary

> Fill this in after `/gsd:verify-work 4` passes. Do not pre-populate.

- **Total code-producing tasks:** _TBD_
- **Routed to cf-code-assist:** _TBD_ (`X/N`, `XX%`)
- **Kept with Claude:** _TBD_
- **Mixed (re-routed):** _TBD_
- **Total approx tokens saved:** _TBD_
- **Routing-rule lessons:**
  - _e.g., "scaffoldTests overshot when the test referenced a not-yet-existing module — better to write the imports first then route the bodies"_
  - _e.g., "transformCode handled the 5 handler-body swaps in tools.ts cleanly once Plan 03's <action> blocks were copied as context"_
- **Recommended changes to `~/.claude/CLAUDE.md` AI routing section:** _TBD or "none"_
