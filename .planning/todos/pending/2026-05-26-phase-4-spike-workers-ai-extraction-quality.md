---
created: 2026-05-26T06:27:31.049Z
title: "Phase 4 prep: Spike Workers AI extraction quality before envelope freezes"
area: planning
phase_target: "04-core-tools-envelope"
files:
  - CLAUDE.md
  - packages/mcp-server/src/schemas.ts
---

## Problem

The entire Engram design rests on "CF AI does everything, return synthesis not data". Workers AI models are small (qwen3-30b, llama-3.1-8b). They will do entity extraction, summarization, memorability scoring, conflict detection, query expansion — and Claude only sees pre-digested output.

The riskiest assumptions (CF AI quality, conflict precision, cross-layer recall) are not validated until v0.2/v0.3. Phase 4 freezes the `EngramResponse<T>` envelope around a synthesis-only contract on 5 production tools — BEFORE we have any empirical data on whether the small models can actually extract a job posting, a meeting note, or a Slack thread cleanly.

"Do it RIGHT, not FAST" + the synthesis-only thesis being unvalidated until v0.2 are in tension. If qwen3 frequently mis-extracts, the entire response envelope needs an escape hatch baked in from day one. We want to know in week 1, not week 6.

## Solution

Run a throwaway spike BEFORE planning Phase 4 (`/gsd:spike`):

1. Pick ~30 real samples spanning the expected memory types:
   - 10 job postings (Russell's actual job-search agent corpus)
   - 10 meeting notes / decision logs
   - 10 Slack threads or research notes
2. Run them through the candidate Workers AI models (`@cf/meta/llama-3.1-8b-instruct` for extraction + `@cf/baai/bge-base-en-v1.5` for embeddings — per ROADMAP Phase 5 spec)
3. Score against hand-extracted ground truth:
   - Field-level recall (did it find company, role, salary, applied_date?)
   - Field-level precision (did it hallucinate fields?)
   - Summarization fidelity (does the summary preserve load-bearing facts?)
4. Decision gate:
   - **≥85% precision / recall on structured fields** → synthesis-only thesis survives; proceed with envelope as designed
   - **70–85%** → keep synthesis-only but make `raw_chunks` escape hatch mandatory (see paired todo)
   - **<70%** → reconsider the architecture: hybrid envelope (synthesis + raw chunks always) or move extraction to a stronger model

Output is a single-page findings doc + a `/gsd:spike-wrap-up` to capture the learnings before Phase 4 plans land.

Cost: ~1 day of work. Risk reduction: enormous — informs the most consequential design decision in v0.1.

## Rationale

Architectural critique from 2026-05-25 conversation: "Doing it right would mean a throwaway spike on Workers AI extraction/scoring quality now — before you freeze the whole response envelope around a synthesis-only contract. If the small models can't extract a job posting cleanly, the entire 'return insights not data' thesis needs rethinking."
