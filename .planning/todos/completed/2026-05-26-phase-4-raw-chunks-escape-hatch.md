---
created: 2026-05-26T06:27:31.049Z
title: "Phase 4: Add raw_chunks escape hatch to recall/reflect tools"
area: api
phase_target: "04-core-tools-envelope"
files:
  - packages/mcp-server/src/tools.ts
  - packages/mcp-server/src/schemas.ts
  - CLAUDE.md
---

## Problem

CLAUDE.md's Core Design Principle states "Engram should return insights, not data. Claude should reason, not process" — every MCP response is synthesized by Workers AI before reaching Claude. The architectural inversion is real: Workers AI runs small models (qwen3, llama-3.1-8b) doing entity extraction, summarization, memorability scoring, and conflict detection, then deliberately starves Claude (the strong reasoner) of the raw evidence needed to catch the small model's mistakes.

`meta.coverage` and `meta.gaps` in `EngramResponse<T>` are band-aids — they tell Claude *what's missing* but not *what was filtered out*. If the qwen3 summarizer drops a critical fact, Claude has no path back to it.

Phase 4 freezes the `EngramResponse<T>` envelope on 5 production tools. Once Claude Desktop is calling `recall()` against this shape, adding an escape hatch becomes a breaking change.

## Solution

Add an optional `raw_chunks: boolean` (or `verbosity: "synthesis" | "chunks" | "raw"`) parameter to:

- `recall(query, ..., raw_chunks?: boolean)` — when true, return the full pre-synthesis chunks with their Vectorize scores instead of (or in addition to) the synthesized result
- `reflect(topic, ..., raw_chunks?: boolean)` — same escape hatch for deep synthesis

Costs: ~1 day to wire into the zod schema and handler signature in Phase 4. The Phase 5 implementations of these tools (where Vectorize + Workers AI actually run) honor the flag.

Default is `false` — synthesis-by-default, raw-on-request — preserves the core design principle while giving Claude a recovery path when the small model's judgment looks suspicious.

Decide BEFORE freezing schemas in Plan 02 / Plan 03 (zod definitions) of Phase 4.

## Rationale

Architectural critique from 2026-05-25 conversation: "You're trusting the weak model's judgment and hiding the evidence from the strong one." The fix is cheap now (parameter addition), expensive later (envelope migration after Claude Desktop adoption).

---

## Closure (2026-05-30, ENG-12 audit)

**Status:** Resolved by Phase 5 D-01/D-02/D-03 for `recall()`. Better-than-asked shipped.

### `recall()` escape hatch — SHIPPED

- Schema: `verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("chunks")` (`packages/mcp-server/src/schemas.ts`)
- Default is `chunks` (Phase 5 D-01 flipped from Phase 4 default of `both`) — raw memories + scored chunks, no LLM summary, no 2-5s synthesis latency
- `synthesis` adds the LLM summary; `both` returns both
- Implementation: `packages/mcp-server/src/tools.ts:556-584` — synthesis is OPT-IN, skipped on default
- Tool description documents the parameter explicitly (`packages/mcp-server/src/tools.ts:165-167`)

This is better than the todo's original `raw_chunks: boolean` proposal — three modes give Claude (and Russell) more flexibility, and the default-`chunks` posture means "raw + chunks unless you ask for synthesis" by default (Claude reads the chunks itself rather than relying on the small model's summary).

### `reflect()` escape hatch — N/A in v0.1

`reflect()` is a v0.3 MCP tool (Workspaces + Memory Types milestone), not yet implemented. When v0.3 ships `reflect()`, the verbosity pattern should be inherited from `recall()` (same shape, same default, same opt-in synthesis behavior). Note added to v0.3 prep below.

### Carry-forward for v0.3

When `reflect()` is implemented in v0.3, mirror the recall() verbosity pattern:
- Add `verbosity?: "synthesis" | "chunks" | "both"` to `ReflectInputSchema`
- Default to `chunks` (raw memories + scored chunks, no synthesis)
- Synthesis is opt-in
