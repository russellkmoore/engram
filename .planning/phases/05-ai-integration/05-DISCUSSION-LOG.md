# Phase 5: AI Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in 05-CONTEXT.md — this log preserves the analysis.

**Date:** 2026-05-28
**Phase:** 05-ai-integration
**Mode:** discuss (default)
**Areas analyzed:** synthesis policy on `recall()` (1 of 4 surfaced)

## Pre-discussion context

Phase 5 starts on an unusually thick foundation:

- `05-AI-SPEC.md` (914 lines, generated 2026-05-27 via `/gsd:ai-integration-phase`) locks framework choice (Cloudflare-native: Workers AI + Vectorize, no third-party RAG framework), models (`@cf/baai/bge-base-en-v1.5` + `@cf/meta/llama-3.1-8b-instruct`), implementation guidance (sync embed+upsert in `remember`, sync embed+query+hybrid-rerank in `recall`, async extraction in Triage Worker, 429 handling via `success: false` inspection), evaluation strategy (8 dimensions with rubrics, Promptfoo + Vitest custom + Workers Analytics Engine, F1 ≥ 75% gate on AI-04, 20-example reference dataset), production monitoring (Workers Analytics Engine schema + Email Routing alerts + Logpush→R2 sampling).
- `spike-findings-engram` skill (auto-loaded per project CLAUDE.md) locks the hybrid-ranking-required finding (spike 003 top cross-bucket cosine 0.8251 > intra-bucket mean 0.6472), the BORDERLINE-band synthesis quality (75-90% on synthetic, real-corpus gate ≥75% F1 mandatory), and the AI-05 system-prompt 5-drop-category design.
- `04-PHASE-5-HANDOFF.md` (Phase 4 hand-off note) locks the envelope-field-population map, the "DO NOT change" rules (verbosity enum, `meta.gaps` field, `mapToMcpError` mapping, `assertOwnsWorkspace` semantics), and the real-corpus validation gate.
- Phase 4 `04-CONTEXT.md` locks honest-stubs posture (D-04) and the v0.1 envelope semantics for each tool (D-05 ingest, D-06 remember, D-07 recall, D-08 conflicts, D-09 tokenizer, D-10 limit cap).
- Phase 2 `02-CONTEXT.md` locks DO method surface + STO-07 `assertOwnsWorkspace` invariant.

Gray-area identification analyzed the phase against this foundation. Four open areas surfaced — only one was selected for deep-dive discussion; the others were left to planner discretion with strong recommendations in CONTEXT.md.

## Gray Areas Presented

| Area | Selected? |
|------|-----------|
| Memorability `<0.4` routing (cold-storage vs hard-discard) | No — captured under Claude's Discretion in CONTEXT.md with strong recommendation for cold-storage |
| Synthesis cost on every recall (always-on vs lazy vs gated) | **Yes — discussed** |
| `research_note` heterogeneity strategy (accept / tag-cluster / k-means) | No — captured under Claude's Discretion in CONTEXT.md with recommendation for option (a) Accept |
| Long-content truncation policy (reject / warn+truncate / lexical-only) | No — captured under Claude's Discretion in CONTEXT.md with recommendation for warn+truncate |

## Discussion: Synthesis policy on `recall()`

### Q1: When `recall()` is called with the default verbosity, should synthesis run unconditionally?

**Options presented:**

1. Always run synthesis on default recall (honor AI-SPEC.md verbatim; 2–5s p50 latency + ~$1/mo)
2. Lazy synthesis — `"both"` returns chunks now, synthesis null (changes meaning of "both")
3. Threshold-gated synthesis (≥3 memories AND ≥500 chars hydrated content)
4. Honor verbosity strictly, but flip default to `"chunks"` (synthesis-on-demand)

**Russell's selection:** Option 4 — flip default to `"chunks"`.

**Rationale (Russell):** Implicit in the selection — speed-by-default for his recall pattern (job-search agent multi-step loops + Claude Desktop sessions) is worth the trade of "Claude makes a follow-up call when synthesis is wanted." The spike-flip rationale ("synthesis is fragile, give Claude both as recovery surface") is honored differently — chunks alone is enough by default; synthesis on opt-in must still pass the F1 ≥ 75% gate.

**Knock-on effects flagged inline:**

- Overrides Phase 4 D-02 (verbosity default was `"both"`).
- Amends `spike-findings-engram` `<requirements>` line about `verbosity = "both"` default.
- Phase 4 hand-off "DO NOT change" rule for verbosity allowed flipping back to `"synthesis"` IF F1 ≥ 85%; this is a flip to `"chunks"` instead, which is a documented Phase-5-discussant override.
- AI-SPEC.md eval dimension #8 test must parameterize by verbosity.
- AI-SPEC.md Section 4 contract diagram needs amending.

### Q2: How should the envelope tell Claude that synthesis is available on demand?

**Options presented:**

1. `meta.gaps` hint string only
2. `suggestions.actions` entry only (first activation of `suggestions` in v0.1)
3. Tool description only (zero envelope overhead)
4. All three (defense in depth)

**Russell's selection:** Option 4 — all three.

**Rationale (Russell):** Implicit in the selection — Claude must not miss the affordance, even across context-trimmed sessions or long conversations where the tool description may not be top-of-mind.

**Knock-on effects flagged inline:**

- `suggestions` field activates earlier than Phase 4 D-04 anticipated (it had been deferred to v0.2). Phase-4-compatible amendment because the field is `optional`.
- Token cost ~200 additional tokens per default-recall envelope — well under the 7,500 post-trim cap, but worth a planner-side verification via MCP-08 test.

## Auto-Resolved

None — auto mode was not active.

## External Research

None performed during this discussion — AI-SPEC.md already incorporates Context7-fetched Cloudflare docs (Vectorize + Workers AI + Queues) and spike-findings-engram has the empirical signal. No additional research gaps surfaced.

## Areas Not Discussed (Captured as Planner Discretion in CONTEXT.md)

- **Memorability `<0.4` routing** — strong recommendation for cold-storage (per Russell's "cardinal sin" framing in the todo file).
- **`research_note` heterogeneity** — recommendation for option (a) Accept heterogeneity; v0.2 surfaces tag-cluster / k-means if real-corpus testing flags the issue.
- **Long-content truncation** — recommendation for warn+truncate+`meta.gaps` (pragmatic middle path; matches honest-stubs posture).
- **Wave layout, helper module shapes, Triage Worker auth, real-corpus gate timing, hybrid ranking weight tuning cadence** — all documented under Claude's Discretion with concrete recommendations.

## Notes for Future Phases

- v0.2 should re-evaluate synthesis-on-demand default vs always-on once production traffic gives a baseline on (a) how often Claude actually opts into synthesis and (b) real-corpus F1 trends from the offline flywheel. If F1 lands consistently ≥85% AND Claude opt-in rate is >60%, flipping back to `"synthesis"` default may make sense. The default is data; the enum is permanent.
- v0.2 may want to add a `verbosity: "memories-only"` value (no chunks) if recall patterns show callers only need hydrated full blocks. Not added in v0.1 to keep the enum stable.
