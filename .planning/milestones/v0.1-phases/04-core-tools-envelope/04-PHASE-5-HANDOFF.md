---
phase: 04-core-tools-envelope
plan: 05
task: 4
artifact: phase-handoff
target_phase: 05-ai-integration
status: ready-for-phase-5-discuss
---

# Phase 4 -> Phase 5 Hand-Off: Envelope Field Population Map

## Purpose

The Phase 4 `EngramResponse<T>` envelope contract is **FROZEN**. Every AI-requiring field is
present and typed correctly in `shared/types/src/index.ts`; values are `null` / `[]` / absent
per D-04 honest stubs. Phase 5's diff against the envelope is a **BODY change** (replace
honest-stub values with real Workers AI / Vectorize outputs) — NOT a contract change (no new
fields, no removed fields, no widened types beyond what Plan 04-01 already widened:
`meta.confidence` and `meta.coverage` are already `number | null`).

This hand-off note is the source-of-truth catalog of what changes in Phase 5 and what does
not. The Phase 5 discussant should read these files in this order:

1. This note (start here — understand what Phase 4 left unfilled and why)
2. `.claude/skills/spike-findings-engram/SKILL.md` (auto-loaded per CLAUDE.md routing)
3. `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md`
4. `.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md`
5. Then run `/gsd:discuss-phase 5`

## Envelope Field Population Map

Every field Phase 5 populates, what populates it, and which `meta.gaps` string is removed
when that population lands:

| Field path | v0.1 value | Phase 5 population source | Phase 5 req ID | META_GAPS string removed when populated |
|---|---|---|---|---|
| `result.synthesis` (recall only) | `null` | Workers AI synthesis call against ranked memory chunks (model: `@cf/meta/llama-3.1-8b-instruct`, prompt per spike-findings §6) | AI-04 | `"AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only."` |
| `result.extracted_fields` (remember) | `{}` | Triage Worker entity/field extraction via CF Workers AI structured-output | AI-05 | _(part of)_ `"AI classification lands in Phase 5. classified_type echoes args.type when supplied."` |
| `result.classified_type` (remember) | echoes `args.type ?? null` | Workers AI classifier picks best system memory type when `args.type` is absent | AI-05 | (same string as extracted_fields gap — both removed together when AI-05 lands) |
| `result.confidence` (remember) | `null` | AI classifier confidence score (0-1) | AI-05 | (covered by extracted_fields gap) |
| `result.memories[].score` / `result.chunks[].score` (recall, search) | `null` | Vectorize cosine score, hybrid-reranked per spike-findings `phase-5-ranking-strategy.md` | AI-04 | _(covered by synthesis gap; no separate META_GAPS string for score)_ |
| `context.related` | `[]` | Vectorize semantic-adjacency query (top-k related blocks by embedding similarity) | AI-04 | (covered by synthesis gap) |
| `context.entities` | `[]` | Triage Worker entity extraction (people, companies, projects from content) | AI-05 | (covered by extracted_fields gap) |
| `context.conflicts` | `[]` | Triage Worker conflict detection via semantic similarity scan against existing memories on `remember` | AI-02 | `"Conflict detection lands in Phase 5 (semantic similarity via Vectorize)."` |
| `meta.confidence` | `null` | Aggregate confidence (mean of AI scores in this response) | AI-05 | (no dedicated gap string — covered by extracted_fields gap) |
| `meta.coverage` | `null` | Semantic coverage estimate (matches_returned / matches_estimated via Vectorize result confidence) | AI-04 | (covered by synthesis gap) |

**Summary of META_GAPS removals by Phase 5:**

- `"AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only."` — removed by AI-04 (recall + search path)
- `"AI classification lands in Phase 5. classified_type echoes args.type when supplied."` — removed by AI-05 (remember path; extracted_fields + classified_type + confidence all land together)
- `"Conflict detection lands in Phase 5 (semantic similarity via Vectorize)."` — removed by AI-02 (remember path; Triage Worker semantic scan)

**META_GAPS string that is NOT Phase 5's responsibility:**

- `"Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."` — this belongs to **Phase 6, NOT Phase 5**. The `ingest()` handler in v0.1 generates a job_id and returns `status: "accepted"` but does NOT call `env.INGEST_QUEUE.send(...)`. Phase 6 PIP-01/02 adds exactly one line inside the existing handler body: `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))`. Phase 5 must leave the `ingest()` body untouched — modifying it before the Queue is wired would be incorrect.

## `ingest()` Hand-Off (separate from envelope changes)

The `ingest()` response shape is `{ status: "accepted", job_id: <UUID> }` in v0.1. The
Phase 6 diff is ONE LINE inside the existing handler body in `packages/mcp-server/src/tools.ts`:
replace the synthetic `void 0` placeholder with
`ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))`. NO envelope change. The builder
`buildIngestResponse` in `envelope.ts` is unchanged by both Phase 5 and Phase 6.

Phase 5 leaves `ingest()` untouched. The `meta.gaps` string mentioning Phase 6 is removed
by Phase 6 when PIP-01/02 lands.

## Wave 0 RED Tests — Phase 5 GREEN Targets

Phase 4 Wave 0 (Plan 04-01) wrote RED tests that Plans 04-02/04-03/04-04 turned GREEN
against the HONEST-STUB contract. Phase 5's job is to KEEP those tests GREEN while ADDING
new assertions that prove real AI output. **The contract files do not move; the assertion
bars rise.**

### `packages/mcp-server/src/__tests__/envelope.test.ts`

Phase 4 asserts:
- `result.extracted_fields` deep-equals `{}`
- `result.synthesis === null`
- `context.conflicts` is `[]`
- All `meta.confidence` and `meta.coverage` are `null`

Phase 5 adds (for fixtures with AI input):
- `expect(env.result.synthesis).not.toBeNull()` (AI-04 Workers AI synthesis)
- `expect(env.result.synthesis.length).toBeGreaterThan(20)` (sanity floor)
- `expect(env.context.entities.length).toBeGreaterThan(0)` for a job-posting fixture with
  extractable named entities
- Phase 5 design decision: real Workers AI in dev, mocked in CI for cost reasons (spike
  findings §6 recommends real AI at dev time). The honest-stub assertions remain valid for
  the "AI binding unavailable" path.

### `packages/mcp-server/src/__tests__/tools-integration.test.ts`

Phase 4 asserts the `remember -> recall -> forget -> recall=0` round-trip works at the
envelope-shape level. Phase 5 adds:
- A fixture-input recall returns memories ranked by hybrid score (vector + recency + type +
  scope per `phase-5-ranking-strategy.md`), AND
- `result.synthesis` is a non-null string referencing facts from the memory content

### `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts`

Phase 4 asserts TOL-07 cross-workspace isolation. **Phase 5 inherits this test unchanged.**
The isolation invariants do not weaken under AI. The two-pronged proof (data isolation by
routing + active `assertOwnsWorkspace`) survives Phase 5 without modification.

### `packages/mcp-server/src/__tests__/token-budget.test.ts`

Phase 4 asserts MCP-08 (worst-case envelope post-trim to ≤ 7,500 cl100k_base tokens + tool
description ≤ 1,500 bytes). Phase 5 adds:
- With AI synthesis populated (synthesis can be 200-2,000 tokens by itself), the worst-case
  envelope STILL post-trims to ≤ 7,500 tokens
- The synthesis string is included in the trim algorithm: drop trailing memories first,
  **never drop synthesis, never drop `meta.gaps`**
- Phase 5 may need to extend `trimToBudget` in `envelope.ts` with a synthesis-preservation
  rule (currently `trimToBudget` only trims `memories[]` — synthesis and meta are untouched).
  Flag this as a Phase 5 design task before AI-04 closure.

## What Phase 5 Should NOT Change

Lock-in rules to prevent contract drift. Each rule preserves a Phase 3 or Phase 4 invariant:

- **DO NOT** add new fields to `EngramResponse<T>`. The envelope contract in
  `shared/types/src/index.ts` is frozen at v0.1. Field population is a body change; field
  addition is a contract change and requires a separate plan with a new Phase-N CONTEXT.md
  honest-stubs decision.
- **DO NOT** remove the `meta.gaps` array. As gaps are filled, the array shortens to `[]`.
  The field itself is permanent — it is a load-bearing signal for MCP clients.
  Phase 5 may add NEW gap strings for v0.2/v0.3 surfaces (e.g.,
  `"Cross-workspace entity resolution lands in v0.4"`) but must not remove the field.
- **DO NOT** change the `verbosity` enum on `recall()`. The 3 values
  (`"synthesis" | "chunks" | "both"`) are public surface. Phase 5 may flip the default back
  from `"both"` to `"synthesis"` IF real-corpus extraction quality consistently lands ≥85%
  (per spike-findings-engram requirements gate), but the enum shape stays.
- **DO NOT** modify `mapToMcpError` in `error-mapping.ts`. The JSON-RPC error code mapping
  (`-32602 InvalidParams`, `-32600 InvalidRequest`, `-32603 InternalError`) is the Phase 3
  D-09 contract. Phase 5 handler bodies use the same try/catch/mapToMcpError pattern.
- **DO NOT** change `assertOwnsWorkspace` semantics in `WorkspaceDO`. The STO-07 hard
  backstop is the security contract. Phase 5 AI calls happen AFTER this check, never before.

## Required Reading for Phase 5 Discussant

- **`.claude/skills/spike-findings-engram/SKILL.md`** — auto-loaded per CLAUDE.md routing.
  Locks the LOCKED model bindings (`@cf/meta/llama-3.1-8b-instruct` for synthesis,
  `@cf/baai/bge-base-en-v1.5` for embeddings) and the BORDERLINE-band reality: synthesis
  quality is 75-90% on synthetic fixtures. Real-corpus validation is a non-optional Phase 4
  gate that Phase 5 should re-run before AI-04 closure.

- **`.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md`**
  — §6 has the AI-05 system-prompt design (5 drop categories the prompt MUST address: dates,
  sources, technical identifiers, numeric values, decision-rejection naming). §7 has the
  real-corpus validation gate that should fire BEFORE Phase 5 ships AI-04.

- **`.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md`** —
  REQUIRED for AI-04 design. Spike 003 proved `bge-base-en-v1.5` encodes domain, not memory
  type — vector-only ranking is INSUFFICIENT. Hybrid ranking (vector + recency + type + scope
  weights) is MANDATORY; tune weights empirically during AI-04 implementation.

- **`.planning/phases/02-workspacedo-sqlite/02-CONTEXT.md`** — Phase 2 sync-helper contract.
  Phase 5's Triage Worker writes to WorkspaceDO via the same helpers. The `assertOwnsWorkspace`
  invariant must hold for triage-worker callers too — Phase 5 plan must address how the Triage
  Worker authenticates its WorkspaceDO calls.

- **`.planning/phases/04-core-tools-envelope/04-CONTEXT.md`** — full Phase 4 context,
  especially D-04..D-08 honest-stubs decisions. Phase 5 inverts the null/empty values to real
  AI outputs.

- **`packages/mcp-server/src/envelope.ts`** — the live builders. Phase 5 modifies the
  BUILDER INPUTS (add `synthesis`, `entities`, `confidence` params to `buildRememberResponse`
  and `buildRecallResponse`) — the BUILDER OUTPUT SHAPE stays byte-stable. The handler bodies
  in `tools.ts` populate the new params from Workers AI calls.

## Real-Corpus Validation Gate (Carry-Forward from Phase 4)

Per spike-findings-engram requirements: BEFORE Phase 5's AI-04 closure, the Phase 5 plan
MUST include a real-corpus validation task that pulls 10-20 actual job postings from
Russell's job-search agent corpus, runs them through the AI-05 extraction prompt, and scores
against hand-coded ground truth.

**Gate:** If real-corpus F1 < 75% (the synthetic-recalibrated FAIL gate translated to
real-world), block AI-04 closure and surface to Phase 5 discuss. Do not ship AI-04 without
passing this gate.

This is a NON-OPTIONAL gate carried forward from spike findings. Phase 4 scoped it out (per
CONTEXT.md §"Claude's Discretion") because Phase 4 did not run AI at all. Phase 5 must close
this gate during AI-05 implementation — before calling AI-04 done, not after.

## Cross-References

- Phase 4 plans: [`04-01-PLAN.md`](./04-01-PLAN.md), [`04-02-PLAN.md`](./04-02-PLAN.md), [`04-03-PLAN.md`](./04-03-PLAN.md), [`04-04-PLAN.md`](./04-04-PLAN.md), [`04-05-PLAN.md`](./04-05-PLAN.md)
- Phase 4 context: [`04-CONTEXT.md`](./04-CONTEXT.md), [`04-RESEARCH.md`](./04-RESEARCH.md)
- Smoke artifact (TOL-08 proof): [`04-MCP-INSPECTOR-SMOKE.md`](./04-MCP-INSPECTOR-SMOKE.md)
- Spike findings skill: [`.claude/skills/spike-findings-engram/SKILL.md`](../../../.claude/skills/spike-findings-engram/SKILL.md)
- Synthesis contract: [`.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md`](../../../.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md)
- Ranking strategy: [`.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md`](../../../.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md)
- Live envelope builders: [`packages/mcp-server/src/envelope.ts`](../../../packages/mcp-server/src/envelope.ts)
- Live handlers: [`packages/mcp-server/src/tools.ts`](../../../packages/mcp-server/src/tools.ts)
- Envelope contract: [`shared/types/src/index.ts`](../../../shared/types/src/index.ts)
