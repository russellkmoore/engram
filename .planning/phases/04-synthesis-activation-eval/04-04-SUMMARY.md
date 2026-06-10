---
phase: "04-synthesis-activation-eval"
plan: "04"
subsystem: "mcp-server"
tags: ["synthesis", "eval", "llm-judge", "SYN-01", "SYN-02", "SYN-04", "faithfulness"]
dependency_graph:
  requires:
    - "04-01 (JUDGE_MODEL constant)"
    - "04-02 (corpus caption work — SYN-01 secondary signal)"
    - "04-03 (hardened synthesis block + exported post-processors)"
  provides:
    - "synthesis-fidelity.eval.test.ts — LLM-judge faithfulness gate (SYN-02)"
    - "generateSynthesis() exported helper in tools.ts (extracted from recall())"
    - "synthesis-eval-corpus.json — curated 10-case coherent synthesis corpus"
    - "Zero-hallucinated-entities hard gate (GREEN)"
  affects:
    - "Phase 4 completion / verify-work"
    - "Backlog: D-09 all-uncited floor; LLM-judge robustness"
status: "complete"
gate: "GREEN (recalibrated)"
---

# 04-04 Summary — Synthesis Fidelity Eval Gate

## What was built

- **`synthesis-fidelity.eval.test.ts`** — the SYN-02 LLM-judge faithfulness eval. Drives the
  production synthesis path directly via the extracted `generateSynthesis()` helper, judges each
  output with `JUDGE_MODEL` (llama-3.3-70b, larger than Scout to avoid self-lenient judging),
  Zod-gates the verdict (V5 ASVS), and logs SYN-04 p50/p99 latency.
- **`generateSynthesis(env, ranked, query)`** — extracted from `recall()`'s inline synthesis block
  (behavior-preserving; `recall()` retains SYN-07 guard + analytics + gaps merge). Lets the eval
  exercise the real synthesis path without the full recall pipeline (RESEARCH.md Pitfall 2).
- **`synthesis-eval-corpus.json`** — hand-authored, 10 coherent cases (query + 3 mutually-related
  memories each), no adversarial entries, no PII.

## Gap-fix history (the eval was hard-won)

The original plan assumed the `eval-fixtures` workspace was seeded with `ef-*` block content. It is
not — only orphan Vectorize vectors exist (`seed-eval-workspace.mjs` does not exist). Three cycles:

1. **All-null (NaN).** Eval drove `recall()` against the unseeded workspace → contentless hits →
   honest-stub `synthesis=null` for all 30 → `passRate 0/0 = NaN`. Fixed by extracting
   `generateSynthesis()` and calling it directly.
2. **Incoherent corpus + judge false-positives + timeout.** First rewrite used reference/real-corpus
   with a sliding window of 3 *unrelated* entries (1/3 of which are adversarial ingest-robustness
   fixtures — prompt injections, empty content) → degenerate syntheses; the judge also counted
   citation markers `[ref-013]` as hallucinated entities; 30 sequential 70B-judge calls hit the
   10-min timeout. Fixed by the curated coherent corpus, a judge prompt that excludes bracketed
   citation markers from entity scoring, and a 10-case cap (~57–82s).
3. **D-09 empties ~40% + judge noise.** With the curated corpus: **zero hallucinated entities**
   (core SYN-02 goal met), but D-09 (`dropUncitedSentences`) empties any synthesis the model writes
   without "memory N" citations → ~40% of cases return empty (`judgedTotal=6`). One faithfulness
   "fail" was a judge false-negative (the claim *is* in source `blk-052`).

## Final gate (recalibrated per user decision)

- **HARD gate — `totalHallucinatedEntities === 0`** ✓ — the robustly-measurable faithfulness signal:
  synthesis never fabricates entities/values absent from the source memories.
- **HARD floor — `judgedTotal >= 4`** ✓ — catches a fully-broken synthesis path (the prior all-null
  regression) without penalizing D-09's known emptying.
- **HARD — `p99 <= 20_000ms`** ✓ — local hang guard (production SLA confirmed on deployed Worker via
  Analytics Engine).
- **ADVISORY (logged, not gated) — faithfulness passRate vs 0.90** — demoted because the LLM judge is
  noisy at small N (~1 borderline false-negative per ~6). Zero-hallucination is the hard gate.

Result: **GREEN** — 7/7 tests pass, exit 0, zero hallucinated entities.

## Known behavior → filed as backlog (NOT defects in synthesis faithfulness)

1. **D-09 all-uncited emptying.** When the model produces a faithful-but-uncited summary,
   `dropUncitedSentences` drops every sentence → empty synthesis (~40% on this corpus). Recommended
   fix: an all-uncited floor (keep the synthesis, optionally hedge, when every sentence would drop).
   A synthesis-availability improvement; does not weaken faithfulness.
2. **LLM-judge robustness.** The faithfulness judge mis-scores claims that cite multiple memories
   collectively. Larger N and/or a refined judge rubric would reduce noise enough to restore a hard
   passRate gate.

## Deviations from plan

- Faithfulness corpus is the curated `synthesis-eval-corpus.json`, not `recall-corpus-v2` validate
  split (whose `ef-*` content is not ingestable). SYN-01's recall-corpus-v2 caption work (04-02)
  stands as the secondary completeness-signal fixture.
- The SYN-02 passRate gate was recalibrated from hard (≥0.90) to advisory; zero-hallucination is the
  retained hard gate. Approved by the user during execution.

## Requirements

- SYN-01: corpus captions (04-02) + eval references a content-bearing corpus ✓
- SYN-02: zero hallucinated entities (hard gate, GREEN); faithfulness rate logged ✓
- SYN-04: p50/p99 logged; p99 hang guard GREEN ✓

## Self-Check: PASSED

- `tsc --noEmit` exits 0.
- `vitest --project eval synthesis-fidelity` → 7/7 pass, exit 0, zero hallucinated entities.
- 04-03 regression guards (synthesis-postprocess, synthesis-preflight, recall, tools-integration) GREEN.
- `tools.ts` `generateSynthesis` extraction behavior-preserving; SYNTHESIS_SYSTEM_PROMPT byte-frozen.
