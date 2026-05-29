# Phase 6: Async Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in [06-CONTEXT.md](./06-CONTEXT.md) — this log preserves the discussion shape and the path taken to reach each decision.

**Date:** 2026-05-29
**Phase:** 06-async-pipeline
**Mode:** discuss (interactive, single round after technical framing reset)
**Areas discussed:** Conflict detection scope, ingest() MCP tool implementation, Failure-evidence surface

---

## Round 1 — Initial Gray Area Presentation (rejected by user)

Initial framing presented 4 multi-select gray areas with deep technical detail:

1. `ingest_status` state machine transitions (PIP-06)
2. Cloudflare Queues retry + DLQ policy (PIP-01, PIP-05)
3. Conflict detection scope (PIP-04 + pending todo)
4. `ingest()` MCP tool implementation (TOL-05 boundary)

**User response:** *"what actually needs to be decided? I dont understand most of the discussions presented"*

**Diagnosis:** The first-round framing leaned on internal terminology (`INSERT OR IGNORE` semantics, `ctx.waitUntil`, Workers AI 429, DLQ shapes) that the user is the visionary for — not the technical architect of. Workflow principle: "Ask about vision and implementation choices. The user is the founder/visionary. Claude is the builder."

---

## Round 2 — Re-framing as Product/UX Decisions

Re-presented 3 of the 4 areas in user-visible terms (the 4th — state machine + retry knobs — became Claude's Discretion with recommended defaults):

### Area A — Conflict detection in v0.1

**Question (user-visible framing):** "Should Engram detect conflicts between memories in v0.1, or defer the feature?"

**Context shared:** PIP-04 asks the Triage Worker to flag contradictions (e.g., "hired Alice as CTO" vs "Alice left the company") so `recall()` can surface them via `context.conflicts`. But Cloudflare's small AI model is a precision/recall minefield — false-positive conflicts erode trust faster than missed conflicts.

**Options presented:**

| Option | Trade-off |
|---|---|
| Defer to v0.2 (Recommended) | Lowest risk; preserves trust; tightest Phase 6 scope. `recall()` returns `context.conflicts: []`. Pending-todo precision validation moves to v0.2. |
| Ship as low-confidence suggestions | Ship per-write detection but every flag is `severity:"low"`. Claude treats them as "MIGHT contradict." Gathers signal without being authoritative. |
| Ship full detection now | Wave 0 hard gate runs 50-sample precision validation; ≥90% precision → ship as designed; <90% → stop Phase 6 and revisit. Highest reward, highest scope cost. |

**User selection:** **Defer to v0.2 (Recommended)** → CONTEXT.md D-01.

**Rationale (user's vision lens):** "Do it RIGHT, not FAST." Russell prefers ship-minimum-correct over ship-broad-noisy.

### Area B — `ingest()` MCP tool implementation

**Question (user-visible framing):** "Should `ingest()` be a real MCP tool in v0.1, or stay a stub for v0.4 connectors?"

**Context shared:** Right now `ingest()` is a stub returning a fake `job_id`. With the Queue going live, you could make it do something useful — e.g., `ingest("https://job-posting-url")` actually fetches and enriches. Or keep it as a stub; the only producer becomes `remember()`'s `ctx.waitUntil` (path the job-search agent already uses).

**Options presented:**

| Option | Trade-off |
|---|---|
| Keep as stub for v0.4 (Recommended) | Tightest Phase 6 scope. Job-search agent goes through `remember()` (already does). |
| Implement URL fetch path | `ingest({source: 'https://...'})` fetches, builds MemoryEvent, enqueues. Useful for "absorb a URL without first pasting the text." |
| Implement async-only `remember()` | `ingest({content})` for large captures where caller doesn't need block ID immediately. Adds parallel API surface. |

**User selection:** **Keep as stub for v0.4 (Recommended)** → CONTEXT.md D-02.

**Rationale (user's vision lens):** Job-search agent is the v0.1 acceptance proof and uses `remember()`. No v0.1 need for ingest(). Defer the expanded surface to v0.4 when external connectors arrive.

### Area C — Failure-evidence surface

**Question (user-visible framing):** "When background enrichment permanently fails, where does the evidence go so it's not lost?"

**Context shared:** v0.1 has no inbox UI yet, but you'll want this surface available for v0.2. Options trade off between SQLite-queryable (sets up v0.4 inbox), Cloudflare-dashboard-only (lightest), and dedicated DLQ queue (heaviest; gives replay).

**Options presented:**

| Option | Trade-off |
|---|---|
| `ingest_status='failed'` on block + Cloudflare logs (Recommended) | SQLite-queryable for v0.4 inbox; observability via Analytics Engine + console.error. No replay in v0.1. |
| Add dedicated `engram-ingest-dlq` queue + replay tool | Heavier (extra queue, extra worker for inspector); gains replay capability. |
| Log-only (Cloudflare Analytics + console.error only) | Simplest. No SQLite surface for v0.4 inbox to query. |

**User selection:** **`ingest_status='failed'` + Cloudflare logs (Recommended)** → CONTEXT.md D-03.

**Rationale (user's vision lens):** Sets up the v0.4 inbox cleanly without v0.1 over-engineering. Cloudflare observability is automatically in place; SQLite surface is the targeted addition.

---

## Folded Todos (in scope for Phase 6)

| Todo | Disposition |
|---|---|
| `2026-05-26-phase-6-validate-conflict-detection-precision.md` | Folded; relocated to v0.2 scope per D-01. Wave 0 doc touch-up annotates the file. |

## Reviewed Todos (not folded — already resolved by earlier phases)

| Todo | Reason not folded |
|---|---|
| `2026-05-26-phase-4-raw-chunks-escape-hatch.md` | Phase 4 D-02 implemented; closed. |
| `2026-05-26-phase-4-spike-workers-ai-extraction-quality.md` | Spike captured in `spike-findings-engram`; closed. |
| `2026-05-26-phase-5-cold-storage-not-discard.md` | Phase 5 D-07 ships cold-storage routing. |
| `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` | Phase 5 AI-04 ships hybrid ranking. |

## Deferred Ideas Surfaced This Discussion

- v0.2 conflict detection with measured precision (D-01 deferral)
- v0.2 stuck-pending sweep Cron Worker (D-03 known limitation)
- v0.2 inbox UI partial-failure visibility (D-03 future consumer)
- v0.2 DLQ queue + replay tool (D-03 deferred enhancement)
- v0.4 `ingest()` MCP tool implementation (D-02 deferral)
- v0.4 `ingest-worker` package (PROJECT.md C4 carry-forward)
- v0.2 retry budget tuning (Claude's Discretion follow-up)
- v0.2 Queue throughput observability (Claude's Discretion follow-up)

## Claude's Discretion Items (no user input needed; recommended defaults documented in CONTEXT.md)

- Cloudflare Queues consumer config (`max_batch_size: 10`, `max_batch_timeout: 5s`, `max_retries: 3`, no `dead_letter_queue` setting).
- Producer wiring site (end of `remember()` try-block after Analytics Engine write).
- MemoryEvent payload contents (`id`, `source`, `content`, `hint`, `context.user_id`, `workspace_id`, `timestamp`).
- Idempotency strategy (UPDATE idempotency for enrichment paths; `INSERT OR IGNORE` for inbox row insert).
- Wave layout suggestion (5 waves; planner refines).
- Test infrastructure (vitest-pool-workers; Queue mocking fallback if local emulator coverage is thin).
- No cf-code-assist routing tracker for Phase 6 (Phase 5 closed the per-phase tracker mandate; Phase 6 follows the standard `~/.claude/CLAUDE.md` 3-question checklist).
