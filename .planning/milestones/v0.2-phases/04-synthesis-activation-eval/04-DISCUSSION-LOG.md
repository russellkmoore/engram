# Phase 4: Synthesis Activation Eval - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in `04-CONTEXT.md` — this log preserves the discussion.

**Date:** 2026-06-09
**Phase:** 04-synthesis-activation-eval
**Mode:** discuss
**Areas analyzed:** Citation strategy, LLM-judge setup, Ground-truth captions, Citation post-processing

## Pre-discussion findings (scout)

- Synthesis path is already scaffolded + opt-in in `packages/mcp-server/src/tools.ts` (Phase 5 of v0.1). Phase 4 hardens + gates it, does not build from scratch.
- **Central tension surfaced before discussion:** the byte-frozen `SYNTHESIS_SYSTEM_PROMPT` cites by POSITION ("memory 1"), but SYN-03 wants inline `[memory_id]` markers, and SYN-10 byte-freezes the prompt. Reconciliation became the first discussion area.
- Eval suite is entirely vitest `.eval.test.ts`; ROADMAP's "promptfoo" wording is descriptive. Surfaced framework choice as a recommended default (vitest) rather than a question.

## Areas presented

User selected all four offered gray areas: Citation strategy, LLM-judge setup, Ground-truth captions, Citation post-processing.

## Decisions

### Citation strategy
- **Options:** (a) Post-process position→id [Rec], (b) edit prompt to emit ids, (c) short numeric ids in prompt.
- **Selected:** (a) Post-process position→id — keep prompt byte-frozen, map deterministically from ranked list, drop out-of-range citations.
- → CONTEXT D-01, D-02, D-03.

### LLM-judge setup
- **Options:** (a) Larger CF model [Rec], (b) same Scout, (c) external frontier judge.
- **Selected:** (a) Larger CF model — generator stays Scout, judge uses stronger CF model; avoids self-bias, stays all-CF-AI.
- **Framework (recommended default, not contested):** extend vitest `.eval.test.ts`, not promptfoo.
- → CONTEXT D-04, D-05, D-06.

### Ground-truth captions
- **Options:** (a) AI-draft + human review ~30 [Rec], (b) Russell manual all 100, (c) AI-draft only, no review.
- **Selected:** (c) AI-draft only, no review.
- **Claude clarification applied:** the catastrophic faithfulness gate (SYN-02) judges synthesis against SOURCE MEMORIES, not against captions — so unreviewed captions only feed a secondary completeness signal and cannot corrupt the hard gate. This de-risks the no-review choice; locked on that basis.
- → CONTEXT D-07, D-08.

### Citation post-processing
- **Options:** (a) Exempt hedge + gap [Rec], (b) strict drop, (c) soft-flag only.
- **Selected:** (a) Exempt hedge + gap — drop uncited sentences except the leading hedge sentence and explicit gap-acknowledgments.
- → CONTEXT D-09.

## Claude's discretion items
- Judge faithfulness rubric wording; caption-generation model + coverage count (default validate-30); post-processor file location; 6K token-count estimation method.

## Process
- D-10: create `04-CF-CODE-ASSIST-USAGE.md` (PRE-05 pattern) — every code-producing task appends a row.

## Deferred
- verbosity default→"both" (v0.3); SYNTHESIS_MODEL specialization (v0.3); promptfoo adoption; human-reviewed captions.
