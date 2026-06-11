# Phase 5 — cf-code-assist Routing Tracker (v0.2 milestone)

> Tracks every code-generation decision during Phase 5 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Phase:** 5 (Integration Kitchen Sink)
> **Status:** ACTIVE
> **Target route ratio:** 40–60% cf-code-assist (content-generation phase per CLAUDE.md phase-character heuristic)
> **Stop condition:** when `/gsd:verify-work 5` passes — stop logging after that; this file becomes the artifact summary.

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 05-01 through 05-05 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `05-02-T1`) or short label
- **Artifact** — the file or symbol produced
- **Route** — one of: `cf-code-assist:<tool>` (e.g., `cf-code-assist:scaffoldTests`), `claude`, or `mixed:<tools>`
- **Checklist (Q1/Q2/Q3)** — 3-character answer: e.g., `N/Y/Y`. Must be answered BEFORE committing the route, not after.
- **Reason** — one short sentence: why this route. If `claude`, name the routing-rule criterion that disqualified cf-code-assist (e.g., "multi-file reasoning", "needs Context7 lookup first", "<10 lines"). If `cf-code-assist:*`, name the context Claude gathered before the call.
- **Approx tokens saved** — rough estimate if cf-code-assist was used; "n/a" otherwise. Order-of-magnitude is fine.

If a task initially went to one route then bounced to another (e.g., cf-code-assist output failed review and Claude fixed it), record both attempts and mark the row `mixed`.

---

## 3-Question Checklist (mandatory per row)

Answer these three questions BEFORE committing the route decision, not after. The answers populate the Checklist column (Q1/Q2/Q3) in the routing log.

1. **Is the SYNTHESIS step itself cross-file?** (Not the reading — the actual generation step: must it produce coordinated changes across multiple files with consistency invariants?) No → still routable to cf-code-assist.
2. **Is the diff >50 lines of mechanical code?** Yes → savings beat prep cost.
3. **Is there a stable template/spec/sentinel to anchor the generation on?** Yes → cf-code-assist can use it.

If the answers are **No / Yes / Yes** → try cf-code-assist first.
If Q1 is Yes → Keep with Claude (multi-file synthesis requires Claude).
If Q2 is No and Q3 is No → Keep with Claude (context-prep overhead exceeds savings).

---

## Phase 5 candidate task shapes

The following task shapes are flagged as cf-code-assist candidates per CLAUDE.md Phase 5 routing tracker rule. The executor still answers the 3-question checklist at execution time — these are starting hypotheses, not auto-routes.

**From CLAUDE.md Phase 5 tracking rule:**

1. **Zod schemas for Triage AI structured outputs** — `generateTypes`. Single-file mechanical generation from a known spec.
2. **Vitest eval scripts on the F1 reference corpus** — `scaffoldTests`. Single-file from stable eval helper template.
3. **Triage Worker queue consumer scaffold** — `generateWorkerBoilerplate`. Bindings + handler pattern.
4. **`recall()` swap from `instr()` → Vectorize query** — `transformCode`. Sentinel-anchored method body swap.
5. **429-aware retry wrapper** — `generateCode`. Single function, clear contract.
6. **Workers Analytics Engine event-write helper** — `generateCode`. Single function, clear contract.

---

## Routing Log

| Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved |
|------|----------|-------|----------------------|--------|---------------------|
| _seed_ | _(no rows yet — first code-producing executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |
| 05-02-T1 (actual) | `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` body generation (~350 LOC integration test scaffold) | `claude` | N/Y/Y | Q1=No (single file, no cross-file consistency invariants). Q2=Yes (~350 LOC mechanical scaffold). Q3=Yes (PATTERNS.md + RESEARCH.md stable spec). **Route decision: claude.** Despite N/Y/Y checklist suggesting cf-code-assist, the binding constraint was runtime-GREEN iteration — the test needed 1 fix cycle (wrong relative path `../envelope.js` → `../../envelope.js`). cf-code-assist cannot observe runtime failures, so Claude handled the full generation + fix loop. The pre-classified estimate was correct on the checklist but underweighted the fix-iteration cost. | n/a |
| 05-03-T1 (envelope.test.ts, actual) | `packages/mcp-server/src/__tests__/envelope.test.ts` context.conflicts discipline assertion (~8 LOC) | `claude` | N/N/N | Q1=No (single file). Q2=No (~8 LOC, well under 15-LOC threshold). Q3=Yes (stable spec from PATTERNS.md). Route: claude — context-prep overhead exceeds savings for sub-15-LOC additions per CLAUDE.md diff-size heuristic. | n/a |
| 05-03-T2 (cross-workspace-pentest, actual) | `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` additions (3 Prong-A + 3 Prong-C stubs, ~95 LOC) | `claude` | N/Y/Y | Q1=No (single file, no cross-file consistency invariants). Q2=Yes (~95 LOC). Q3=Yes (stable Prong-A template + PATTERNS.md spec). **Route decision: claude.** N/Y/Y checklist suggests cf-code-assist, but binding constraint was runtime-GREEN iteration: positive-control was missing from SYN case on first generation, required fix cycle. cf-code-assist cannot observe test failures or iterate. Same rationale as 05-02-T1. | n/a |
| 05-04-T1 (pre-classified estimate) | `packages/triage-worker/src/__tests__/integration/conflict-pipeline-isolation.test.ts` (new file, ~80 LOC, makeWorkspaceStub pattern + D-10 assertion shape) | `cf-code-assist:scaffoldTests` | N/Y/Y | Single-file new test, ~80 LOC, stable makeWorkspaceStub helpers + D-10 isolation assertion spec from RESEARCH.md — N/Y/Y candidate. **(pre-classified estimate — update at execution time)** | ~3–5K tokens |

---

## End-of-Phase Summary

_TBD — populated at `/gsd:verify-work 5` close._

---

> **Per CLAUDE.md Phase 5 tracking rule:** every code-producing task during Phase 5 execution must append one row (or update the estimate row) with the actual 3-question answers before committing. Stop logging when `/gsd:verify-work 5` passes.
