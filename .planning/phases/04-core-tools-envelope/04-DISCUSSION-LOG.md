# Phase 4: Core Tools + Envelope - Discussion Log

> **Audit trail only.** Do NOT use as input to planning, research, or execution agents.
> Decisions captured in `04-CONTEXT.md` — this log preserves the reasoning that produced them.

**Date:** 2026-05-26
**Phase:** 04-core-tools-envelope
**Mode:** discuss (standard)
**Areas selected:** Synthesis contract + spike + raw_chunks · v0.1 envelope stub semantics · Lexical conflict detection scope · Token budget enforcement (MCP-08)

## Folded Todos

Two pending todos targeted `phase_target: 04-core-tools-envelope` and fire BEFORE Phase 4 planning (they constrain zod schemas and the envelope shape). User confirmed folding both.

| Todo | Title | Folded into |
|---|---|---|
| `2026-05-26-phase-4-spike-workers-ai-extraction-quality.md` | Spike Workers AI extraction quality before envelope freezes | D-01 |
| `2026-05-26-phase-4-raw-chunks-escape-hatch.md` | Add raw_chunks escape hatch to recall/reflect tools | D-02 + D-03 |

Three Phase-5/Phase-6 todos were reviewed but NOT folded (they surface at their own `/gsd:discuss-phase`):
- `2026-05-26-phase-5-cold-storage-not-discard.md`
- `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md`
- `2026-05-26-phase-6-validate-conflict-detection-precision.md`

## Areas Discussed

### Area 1: Synthesis contract + spike + raw_chunks

**Q1.1 — Workers AI extraction-quality spike: when does it run?**
- Options:
  - Run BEFORE Phase 4 planning (~1 day, 30 samples, score → gate envelope decisions) ← Recommended
  - Skip spike, ship envelope as-designed with optional raw_chunks
  - Defer spike to Phase 5
  - Run spike in parallel with Phase 4 planning
- **User selected:** Run BEFORE Phase 4 planning.
- **Captured as:** D-01 — spike runs first; decision gate ≥85% / 70–85% / <70% tunes the verbosity default.

**Q1.2 — raw_chunks parameter shape.**
- Options:
  - `verbosity` enum: `"synthesis" | "chunks" | "both"`, default `"synthesis"` ← Recommended
  - `raw_chunks: boolean`, default false
  - Add only to recall in v0.1 (defer reflect to v0.3)
  - Skip the escape hatch entirely
- **User selected:** verbosity enum.
- **Captured as:** D-02 — three-state enum with default `"synthesis"`; shape is forward-compatible with v0.3 `reflect()`.

**Q1.3 — verbosity scope + default.**
- Options:
  - `recall` only, default `"synthesis"` ← Recommended
  - `recall` AND `search`, default `"synthesis"`
  - `recall` only, default depends on spike outcome
- **User selected:** recall only, default `"synthesis"` (default may flip to `"both"` if spike scores 70-85%).
- **Captured as:** D-02 + D-03 — `RecallInputSchema` gains `verbosity`; other 4 schemas untouched.

### Area 2: v0.1 envelope stub semantics

**Q2.1 — overall posture for AI-requiring fields.**
- Options:
  - Honest stubs — empty/null where AI is needed ← Recommended
  - Minimal deterministic heuristics (templated synthesis, computed coverage, etc.)
  - Hybrid (honest stubs for AI fields, heuristics for computable fields like last_updated)
- **User selected:** honest stubs.
- **Captured as:** D-04 — every envelope field present and typed; AI-requiring fields ship as null/empty; Phase 5 POPULATES rather than RESTRUCTURES.

**Q2.2 — ingest() v0.1 contract.**
- Options:
  - Synthetic accepted: real UUID job_id, no real queue ← Recommended
  - Inbox-table write (sync stub)
  - throw McpError(MethodNotFound) "ships in Phase 6"
  - Synthetic accepted + console log line
- **User selected:** synthetic accepted with real job_id.
- **Captured as:** D-05 — `EngramResponse<{status: "accepted", job_id}>`, no queue side effect, `meta.gaps` notes Phase 6, swap is one line in Phase 6.

**Q2.3 — remember()/recall() stub specifics.**
- Options:
  - Pass-through type; null synthesis ← Recommended
  - Pass-through type; templated synthesis
  - Null type unless AI; templated synthesis
- **User selected:** pass-through type, null synthesis.
- **Captured as:** D-06 + D-07 — `classified_type = args.type ?? null`, `extracted_fields = {}`, `confidence = null`, `synthesis = null`.

### Area 3: Lexical conflict detection scope

**Q3.1 — what counts as lexical overlap in v0.1?**
- Options:
  - Empty contract in v0.1; always `[]` with documented P5 upgrade ← Recommended
  - Same-content substring match (LIKE)
  - Same-type + content substring match
  - Jaccard token similarity ≥ threshold
- **User selected:** empty contract.
- **Captured as:** D-08 — `context.conflicts = []` always; `meta.gaps` notes "Conflict detection lands in Phase 5 (semantic similarity via Vectorize)."

### Area 4: Token budget enforcement (MCP-08)

**Q4.1 — tokenizer choice.**
- Options:
  - `gpt-tokenizer` (pure-JS, portability) ← Recommended
  - `tiktoken` (WASM, Claude-fidelity)
  - Hand-rolled ~4 chars/token approximation
- **User selected:** gpt-tokenizer.
- **Captured as:** D-09 — pure-JS, ~50KB, runs cleanly in workerd + vitest-pool-workers; over-counting gives safety margin.

**Q4.2 — cap strategy at the 8K boundary.**
- Options:
  - Cap limit at schema (≤25) + post-trim memories[]; MCP-08 asserts worst-case ← Recommended
  - Drop optional envelope fields first, then truncate
  - Reject over-budget queries with -32602 InvalidParams
  - Synthesis-only fallback (replace result.memories with [])
- **User selected:** cap limit + post-trim.
- **Captured as:** D-10 — schema constrains limit to ≤25 (down from current 100); post-trim drop order: content > summary > snippet only > trailing memories; never drop `meta` or `context.conflicts` or `result.id`; MCP-08 unit test asserts worst-case <8K via `gpt-tokenizer`.

## Decisions at Claude's Discretion

The following are downstream-agent guidance (executor / planner will refine during plan-phase) — captured in `04-CONTEXT.md` `<decisions>` Claude's Discretion subsection rather than asked of the user:

- **Cross-workspace pen test (TOL-07):** vitest integration test with two-workspace harness; spin up `workspace_A` + `workspace_B`, route a `workspace_B`-JWT request to A's DO ID, assert Phase 2's `assertOwnsWorkspace` throws `McpError(-32600 InvalidRequest)`.
- **TOL-08 smoke:** local script (`scripts/smoke-job-agent.mjs`) against `wrangler dev` — NOT a full agent reconfig (that's DEP-04 in Phase 7).
- **`forget(cascade)` semantics:** unchanged from Phase 2 (block + cascade to relations rows only, NOT related blocks); Vectorize delete is Phase 5 / AI-08.
- **Error mapping centralization:** all 5 handlers wrap try/catch through `mapToMcpError` (Phase 3 D-04 already exists in `packages/mcp-server/src/error-mapping.ts`).
- **Wave layout:** Wave 0 = test infra + schema diff; Wave 1 = envelope helper; Wave 2 = 5 handler bodies in parallel; Wave 3 = TOL-07 + MCP-08 tests; Wave 4 = TOL-08 smoke + DEP-05 README amendment.
- **`recall.result.chunks` shape:** new optional field, `Array<{id, content_excerpt, score: number | null}>`, used only when `verbosity ∈ {"chunks", "both"}`.
- **`meta.gaps` strings:** templated but FROZEN at v0.1 so MCP-08 token-budget tests are deterministic.
- **`suggestions` field:** `undefined` in v0.1 across all 5 tools (honest-stubs posture).

## Deferred Ideas (cross-phase)

Captured in `04-CONTEXT.md` `<deferred>`:
- Block-cascade on `forget(cascade=true)` → v0.3 (`relate()` graph semantics).
- `transactionSync()` wrap on `forget(cascade)` → revisit only on invariant violation.
- `recall.synthesis` heuristic templates → rejected; Phase 5 populates real AI synthesis.
- `meta.coverage` computed signal → rejected; Phase 5 ships real semantic coverage.
- `suggestions` population → Phase 5 / v0.2.
- `lexicalConflictCheck()` helper → rejected; Phase 5 ships semantic detection.
- FTS5 backing → Phase 5 displaces lexical entirely.
- `tiktoken` swap → only if v1.0 reporting surface needs Claude-fidelity counts.
- Full Russell-agent reconfig → DEP-04 in Phase 7.

---

*Discussion held: 2026-05-26*
*Phase: 04-core-tools-envelope*
