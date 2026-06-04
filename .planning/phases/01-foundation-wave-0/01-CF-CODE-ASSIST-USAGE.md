# Phase 1 — cf-code-assist Routing Tracker (v0.2 milestone)

> Tracks every code-generation decision during Phase 1 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 1 execution only. Stop logging when `/gsd:verify-work 1` passes. After that, this file becomes the artifact summary; do not extend.
>
> **Why it matters:** Phase 1 is the v0.2 Foundation phase. It produces markdown docs, vitest config, CI workflow YAML, and one short audit script — content-generation share is expected `<10%`. The tracker exists to enforce the routing discipline even when most rows route to `claude`.

---

## Instructions for the executor (and Claude orchestrating)

For **every task** in plans 01-01 through 01-05 that produces code, append one row to the table below. "Code" means: any new `.ts` file body, any non-trivial edit to an existing `.ts`/`.tsx`/`.mjs`/`.js` file, any test fixture, any zod fragment, any commit message generated from a diff. Pure file moves, frontmatter edits, doc-only changes do NOT need a row.

Each row records:
- **Task** — task id (e.g., `01-01-T5`) or short label
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
| 01-04-T1 | `01-CF-CODE-ASSIST-USAGE.md` tracker file creation | claude | N/N/N | Doc creation, not code generation — tracker rules don't apply to itself. | n/a |

---

## End-of-Phase Summary

_TBD — populated at /gsd:verify-work 1 close._

<!-- Note: REQUIREMENTS.md PRE-05 specifies path .planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md. That path was written before the phase slug was finalized. The canonical location is this file, at .planning/phases/01-foundation-wave-0/. -->
