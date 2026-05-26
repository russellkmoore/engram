---
created: 2026-05-26T06:27:31.049Z
title: "Phase 6: Validate triage worker conflict detection precision before per-write scan"
area: planning
phase_target: "06-async-pipeline"
files:
  - packages/triage-worker/
  - CLAUDE.md
---

## Problem

CLAUDE.md `## Ingest Pipeline` step 9 specifies: "Run conflict detection against related memories" — per write, on a small Workers AI model. The same conflict signal is the foundation of the v0.4 Slack-alert demo (one of the flashier features in the roadmap).

This combination is precarious:

- **Conflict detection on a small model is a precision/recall minefield.** Distinguishing a genuine contradiction ("hired Alice as CTO" vs "Alice left the company") from a benign update ("Alice promoted to CTO") requires nuanced reasoning that qwen3 / llama-3.1-8b will get wrong some non-trivial fraction of the time.
- **False positives erode trust faster than missed conflicts.** A user who sees three spurious "this contradicts what you remembered last week" alerts will turn the feature off — and never trust it again.
- **It's compute-heavy on the hot path.** Per-write scanning multiplies Workers AI calls per ingest by N (related memories).

Phase 6 (Async Pipeline) is where triage-worker conflict detection actually ships per ROADMAP Phase 6 success criterion #4 ("entity extraction, summarization, memorability scoring, and conflict detection against existing memories in the workspace").

## Solution

Before committing to per-write conflict scanning in Phase 6 implementation, validate precision empirically:

1. **Build a 50-sample test set** in `.planning/research/conflict-precision-fixtures/`:
   - 25 genuine conflict pairs (hand-curated) — "hired Alice / Alice left" patterns
   - 15 benign update pairs — "promoted Alice / Alice's title changed"
   - 10 unrelated pairs — sanity check that the model doesn't hallucinate conflicts

2. **Run the candidate detection prompt** through the chosen Workers AI model against all 50 pairs

3. **Decision gate based on results:**
   - **≥90% precision** (few false positives) → ship per-write conflict scanning as designed
   - **70–90% precision** → ship per-write detection but treat results as **suggestions** (`context.conflicts[]` with `severity: "low"` by default; require an explicit promote-to-conflict step before alerting)
   - **<70% precision** → drop per-write scanning entirely; move to **nightly batch** with the same model OR escalate the detection step to Claude via an MCP tool call (`detect_conflicts(memory_a, memory_b)` — pay the token cost selectively for high-stakes pairs)

4. **Phase 6 plan documents the chosen path** in CONTEXT.md so the v0.4 Slack-alert feature inherits a validated foundation rather than discovering precision issues in production.

## Rationale

Architectural critique from 2026-05-25 conversation: "Conflict detection is your shakiest component carrying your flashiest feature. Per-write conflict scanning on a small model is a precision/recall minefield; false-positive 'conflicts' erode trust. And it's the v0.4 Slack-alert demo. High risk concentrated on the thing you most want to show off."
