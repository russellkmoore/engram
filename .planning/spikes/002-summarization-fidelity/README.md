---
spike: 002
name: summarization-fidelity
type: standard
validates: "Given the 30 synthetic samples from spike 001 and a hand-curated load-bearing-facts list per sample, when each is summarized via @cf/meta/llama-3.1-8b-instruct, then the fraction of load-bearing facts preserved (verbatim or paraphrased) in the summary meets the synthetic-recalibrated gate (≥90% / 75-90% / <75%)."
verdict: PARTIAL
related: ["001"]
tags: [summarization, llama-3.1-8b, P5/AI-05, synthesis-contract, P4/D-04]
---

# Spike 002: Summarization Fidelity

## What This Validates

**Given** the same 30 synthetic samples from spike 001 plus a per-sample list of **load-bearing facts** (the entities/dates/numbers/identifiers a synthesis MUST preserve to be useful),
**when** each sample is summarized via `@cf/meta/llama-3.1-8b-instruct` in plain-text mode (no JSON schema — summaries are free-text by design),
**then** the fraction of load-bearing facts surviving into the summary (verbatim OR paraphrased) meets the synthetic-recalibrated decision gate (≥90% → PASS, 75-90% → BORDERLINE, <75% → FAIL).

This validates whether the **synthesis-only EngramResponse contract** (D-04 / Phase 4 CONTEXT.md) is fundamentally viable. If summaries routinely drop names/dates/numbers/identifiers, Claude is reasoning over stripped-down evidence and the contract is broken.

Spike 001's "paraphrasing on free-text" finding makes this spike load-bearing — verbatim phrasing was already shown NOT to survive; the question now is whether the *facts* survive even when *phrasing* doesn't.

## Why This Is the Right Test

`result.synthesis` in the Engram envelope is meant to give Claude a token-cheap overview. The cheapness only matters if synthesis preserves the load-bearing facts Claude (or downstream tools) would otherwise need to query for. Spike 001 already showed that JSON-schema field extraction is reasonable; this spike asks whether the same model can write a *narrative* that doesn't drop key facts.

Load-bearing facts per sample were curated by hand — for a job posting, that's company + role + salary + date; for a decision log, that's the decision + owner + project + date; for a research note, that's the key technical entities and identifiers. The full list lives in `load-bearing-facts.json`.

## Research

### API surface

`env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, max_tokens: 256, temperature: 0.3 })` — plain text generation. No `response_format` — summaries are free-text. Verified against spike 001's API surface findings.

### Knobs locked

- `temperature: 0.3` — slightly higher than spike 001's 0.2 to allow for natural paraphrase; not so high that key facts get dropped to noise
- `max_tokens: 256` — enough for 1-2 dense sentences; forces the model to triage
- System prompt: `"Write a concise 1-2 sentence summary of the input. Preserve key facts — names, dates, numbers, specific decisions, identifiers. Do not invent details. Do not add commentary. Output only the summary text."` (explicit about what counts as load-bearing)

### Fact-preservation comparator (same module as spike 001 but with one tweak)

- Substring containment (case-insensitive, normalized punctuation) → preserved
- For short facts (≤2 tokens): require ALL tokens present in summary
- For longer facts (>2 tokens): allow 1 missing token (token overlap ≥ ceil(n × 0.6))
- Hallucination is NOT measured here (would require open-vocab semantic matching against the source content). Real-corpus validation later will catch this.

## How to Run

```bash
# Terminal 1 — start the spike Worker against real Cloudflare Workers AI
npx wrangler dev --config .planning/spikes/002-summarization-fidelity/wrangler.jsonc

# Terminal 2 — run the harness
node .planning/spikes/002-summarization-fidelity/scripts/run-spike.mjs
```

Outputs land in `results/results.json` (machine-readable) and `results/results.html` (per-sample viewer showing the summary + colour-coded ✓/✗ for each load-bearing fact).

## What to Expect

- Each sample: ~500-2,000ms (model latency)
- 30 samples → ~30-60 seconds total
- Cost: ~$0.01-0.05 against Russell's Cloudflare account
- Per-sample output: `id ✓/⚠/✗ R=X% (preserved/total facts, Wms)`
- Final aggregate: overall fact-preservation recall + per-bucket recall + decision gate verdict

## Observability

Per-sample HTML viewer shows for each sample: original content, generated summary, and a ✓/✗ list of every load-bearing fact. Lets a human spot-check WHICH facts get dropped, not just the aggregate number.

## Investigation Trail

### Run 1 — initial pass (2026-05-26)

Ran all 30 samples against `@cf/meta/llama-3.1-8b-instruct` summarization endpoint. 153 load-bearing facts total across the corpus.

**Headline numbers:**

- Overall: **128/153 facts preserved → R=83.7%** → BORDERLINE
- job_application: R=78.8% (41/52) — **worst per-bucket**
- decision_log: R=88.7% (47/53) — close to PASS
- research_note: R=83.3% (40/48) — middle

Zero errors. Median latency ~600-700ms; cold-start tail (rn-07, rn-10, dl-03) hit 4-7s same as spike 001.

### Drop pattern (the actionable finding)

The 25 dropped facts cluster into 5 categories. Counts across all 30 samples:

| Category | Drops | Examples |
| --- | --- | --- |
| **Dates** | 8 | `2026-05-23`, `2026-05-15`, `2026-05-19`, `2026-05-08`, `2026-05-18` |
| **Sources / provenance** | 5 | `LinkedIn`, `Wellfound`, `Reddit`, `recruiter` |
| **Technical identifiers** | 5 | `llama-3.1-8b`, `MemGPT`, `/authorize`, `/token`, `/jwks`, `DurableObjectStub` |
| **Numeric metadata** | 3 | `$220k-$260k`, `230k-280k`, `270s` |
| **Negative-frame / "rejected alternative" facts** | 4 | `D1`, `single-DO`, `MCP-first`, `namespaces` |

**Dates dominate.** A summary that drops the date answers fewer of Russell's job-search-agent queries usefully ("what did I apply to last week?" requires the date). This is the single most consequential drop category for Engram's first-user use case.

**Sources and identifiers are next.** "Where did I find this?" and "what library is this about?" both depend on facts the model deprioritizes.

**Negative-frame facts** are a subtle one — when a decision log records "X chosen over Y", the model preserves X but tends to drop Y. The `relate()` v0.3 tool may need raw chunks to capture both sides of an alternatives-considered decision.

### What this changes for D-02 and D-04

**Spike 001 was BORDERLINE on per-bucket research_note (85.4%) but PASS overall (90.2%).** This spike is BORDERLINE on overall recall (83.7%). Two independent measurements both land in the 75-90% band.

**Conclusion:** D-02's `verbosity` default MUST be `"both"`. Synthesis alone drops a meaningful fraction of load-bearing facts; Claude needs raw chunks alongside to recover dates / sources / identifiers when the synthesis triages them out.

**D-04 (honest stubs) is REINFORCED:** Phase 4's `result.synthesis = null` is the correct contract until Phase 5's prompt engineering can demonstrate ≥95% fact preservation on real-corpus samples. Anything less is the user-facing equivalent of "answers some questions but not others, in ways Claude can't detect."

### Phase 5 system-prompt design hints (from the drop pattern)

When AI-05 ships in Phase 5, the summarization prompt should explicitly call out the categories observed dropping here:

> "Preserve dates verbatim. Preserve source / origin attribution. Preserve technical identifiers (URLs, function names, library names) verbatim. Preserve numeric values verbatim. When a decision rejects an alternative, name both the chosen and rejected option."

This costs nothing and addresses the four highest-frequency drop categories observed.

## Results

**Verdict:** PARTIAL — synthesis-only thesis is fragile. Summaries preserve 83.7% of load-bearing facts on synthetic samples; dates, sources, and technical identifiers are the worst-performing fact categories.

**Phase 4 recommendations (feed into `/gsd:spike-wrap-up` → Phase 4 plan):**

1. **Confirm D-02 default flip** to `"both"` on `recall()` — both spike 001 and spike 002 land in the same BORDERLINE band, and the dropped fact categories (dates, sources) are exactly what Claude needs to recover from raw chunks.
2. **Confirm D-04 honest-stubs posture** — `synthesis = null` in v0.1 is the right contract; populating it with a quality-uncertain CF AI output would mislead Claude.
3. **Phase 5 AI-05 prompt design** — explicit category-level instructions per the drop-pattern findings (above).
4. **Real-corpus validation gate before TOL-08** — synthetic samples here may have understated drops (or overstated them — both are possible). Russell's job-search agent corpus must be exercised against the same fidelity metric before Phase 7 closes.
5. **Consider `meta.gaps` as the recovery hint** — when synthesis drops a category, emit `meta.gaps: ["Synthesis omitted: dates, sources — see raw chunks"]` so Claude knows to look at the verbosity="both" chunks.

**Evidence:** `results/results.json`, `results/results.html`.

**Surprises:**

- Decision logs survived best (88.7%) because the "decision" itself is usually the dominant semantic content. Job postings dropped the worst (78.8%) because they're metadata-dense with no single dominant fact.
- Negative-frame facts ("X chosen over Y" → Y gets dropped) is a quiet failure mode the spike 001 extraction path didn't surface.
- Latency variance is dominated by Workers AI cold starts, same as spike 001 — not by summary content length.
