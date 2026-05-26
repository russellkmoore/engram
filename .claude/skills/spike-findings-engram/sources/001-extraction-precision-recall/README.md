---
spike: 001
name: extraction-precision-recall
type: standard
validates: "Given 30 synthetic samples spanning 3 type buckets and per-bucket target field schemas, when each is run through @cf/meta/llama-3.1-8b-instruct with response_format=json_schema, then field-level precision and recall against hand-coded ground truth meet the synthetic-recalibrated gate (≥90% / 75-90% / <75%)."
verdict: PARTIAL
related: []
tags: [extraction, llama-3.1-8b, P4, P5/AI-05, structured-output, synthetic-samples]
---

# Spike 001: Extraction Precision / Recall

## What This Validates

**Given** 30 synthetic samples spanning 3 type buckets (10 job applications, 10 decision logs, 10 research notes), each paired with hand-coded ground-truth fields,
**when** each is sent through `@cf/meta/llama-3.1-8b-instruct` using Workers AI's JSON-schema response_format,
**then** the field-level precision/recall against ground truth meets the synthetic-recalibrated decision gate (≥90% → PASS, 75-90% → BORDERLINE, <75% → FAIL).

The headline number for D-01's verdict on Engram's synthesis-only EngramResponse envelope contract. Gates whether Phase 4 can ship the envelope as-designed, or must flip `verbosity` default to `"both"`, or re-open the envelope architecture entirely.

## Synthetic-Sample Recalibration (Important)

D-01 originally specified a real-corpus gate of ≥85% / 70-85% / <70%. User selected "all synthetic" for sample sourcing during alignment. Synthetic samples are CLEANER than real-world inputs (Claude generates them with consistent formatting, complete entity surface, no OCR errors, no idiomatic shorthand). The gate is therefore tightened to ≥90% / 75-90% / <75% to compensate for the optimism bias.

The recalibration is documented in [`MANIFEST.md`](../MANIFEST.md) Requirements section and survives into the Phase 4 plan's verification artifact. **Real-corpus validation is deferred to a Phase 4 plan task** (Russell's job-search agent corpus is the obvious source).

## Research

### API surface (verified against Workers AI docs via Context7)

`env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, response_format: { type: "json_schema", json_schema: { ... } } })` — supports structured output via JSON schema directly. Response shape is `{ response: <parsed object | JSON string> }`. The runner script handles both cases (parsed and string) because some Workers AI paths return parsed objects and some return strings.

### Approach comparison

| Approach                               | Pros                                                                 | Cons                                                                                  | Status                                          |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `response_format=json_schema` (chosen) | Workers AI enforces structure server-side; no post-hoc parsing layer | Requires `messages` array (no `prompt` shortcut for schema mode); model-version-bound | ✅ used                                         |
| Prompt-only "output JSON"              | Works on any model; no API constraint                                | Hallucinated JSON / partial JSON / wrapping prose; needs robust parsing               | ❌ rejected (lower-bound on quality)            |
| `response_format=json_object` (loose)  | Returns valid JSON without enforced schema                           | Doesn't constrain field set — can omit required fields silently                       | ❌ rejected (under-tests extraction discipline) |

**Chosen:** `response_format=json_schema` with `required` field list — matches what Engram Phase 5 / AI-05 will actually use.

### Knobs locked

- `temperature: 0.2` — low for extraction stability; not 0.0 because the model can produce near-degenerate outputs at exact zero
- `max_tokens: 1024` — well above any expected per-sample extraction output
- No `seed` — accept run-to-run variance as part of the signal

## How to Run

From the repo root:

```bash
# Terminal 1 — start the spike Worker against real Cloudflare Workers AI
# (requires `wrangler login` against an account with Workers AI access)
npx wrangler dev --config .planning/spikes/001-extraction-precision-recall/wrangler.jsonc

# Terminal 2 — run the harness
node .planning/spikes/001-extraction-precision-recall/scripts/run-spike.mjs
```

Outputs land in `results/results.json` (machine-readable) and `results/results.html` (human-readable side-by-side viewer).

Open `results/results.html` in a browser to see per-sample expected-vs-extracted diffs colour-coded by verdict (TP / FP / FN / MISMATCH).

## What to Expect

- Each sample takes ~500-2,000ms end-to-end (model latency + tiny network)
- 30 samples → ~30-60 seconds total
- Cost: ~$0.01-0.05 against Russell's Cloudflare account (Workers AI extraction pricing)
- Per-sample output: `id … P=X% R=Y% F1=Z% (Wms)`
- Final aggregate: overall P/R/F1 + per-bucket P/R/F1 + decision-gate verdict (PASS/BORDERLINE/FAIL)

A `MISMATCH` verdict means the model returned a non-null value but it didn't match the expected — counted as both FP (wrong value emitted) and FN (true value missed). This is the strictest possible reading; lenient half-credit scoring would weaken the signal.

## Observability

The runner emits per-sample timing in the console. The HTML viewer shows full content + per-field verdict + expected/extracted diff. No external log layer needed — the spike's outputs ARE the observability layer.

## Investigation Trail

### Run 1 — initial pass (2026-05-26)

Ran all 30 samples cold against `@cf/meta/llama-3.1-8b-instruct` via `wrangler dev` with `remote: true` AI binding (real Workers AI charges, ~$0.02 observed).

**Headline numbers:**

- Overall: **P=88.4%, R=92.1%, F1=90.2%, errors=0** (the gate is computed on F1)
- job_application: F1=90.7% (n=10) — PASS
- decision_log: F1=95.1% (n=10) — PASS
- research_note: F1=85.4% (n=10) — **BORDERLINE per-bucket**

Latency: 700-13,600ms per sample; median ~900ms; long tail driven by occasional remote-AI cold starts (`dl-07` and `rn-08` both >12s).

### Failure decomposition (the surprising finding)

Of 16 non-TP / non-TN field outcomes across 180 field evaluations (30 samples × 6 fields), roughly half are real model errors and half are scoring artifacts:

**Real model errors (~7):**

- `ja-08 [FP] applied_date "2026-05-21"` — model resolved "today" in the prompt to a literal date that ground truth marked null
- `ja-09 [FN] applied_date null` — missed "2026-05-19" that was directly in the text
- `ja-07 [FP] salary_range "TBD"` — captured "Compensation TBD" as a salary range string instead of null
- `dl-02 [FP] date "today"` — emitted the literal string "today" as the date value
- `dl-04 [FP] project "MCP-first"` — invented a project name from a phrase fragment
- `dl-07 [FP] project "MCP-08"` — invented a project name from an unrelated identifier
- `dl-10 [FP] rationale "..."` — fabricated a rationale by paraphrasing the content
- `ja-01 [FP] applied_date "null"` — string `"null"` instead of JSON null (schema-mode artifact)

The pattern: **the model hallucinates nullable fields when adjacent text suggests a value is "almost there."** It pulls "today" / "this week" / "TBD" / fragmentary identifiers and emits them rather than respecting the "return null if not present" instruction.

**Scoring artifacts (~8) — model output was semantically correct but the strict comparator flagged a mismatch:**

- `ja-02 source "referral (Devon)" vs "Devon's referral"` — same fact, different phrasing
- `ja-05 salary_range "$220k-$260k" vs "220-260k"` — same range, missing punctuation
- `ja-07 source "Reddit (r/cscareerquestions)" vs "/r/cscareerquestions"` — same source, dropped prefix
- `rn-02 topic "conflict resolution in memory systems" vs "mem0"` — model picked the proper-noun subject; ground truth was the abstract topic
- `rn-03/07/08 topic` — similar: model preferred concrete identifier over abstract topic phrase
- `rn-04/05/10 summary` — model **paraphrased** the load-bearing facts instead of copying verbatim. All key facts survive but with different word choice.

The "paraphrasing on free-text" pattern is the most consequential finding. It's exactly what Spike 002 (summarization fidelity) will measure more rigorously.

### What this changes about D-01's verdict

Strict reading of the gate: **F1=90.2% overall meets the synthetic-recalibrated ≥90% threshold → PASS / VALIDATED**.

Depth reading: the per-bucket research_note=85.4% is in the BORDERLINE zone, and the hallucination pattern on nullable fields argues for raw_chunks-as-default rather than synthesis-only. The hallucinations are precisely what the `verbosity="both"` defensive default exists to mitigate.

**Recommended Phase 4 D-02 adjustment:** flip `verbosity` default to `"both"` on `recall()`. The cost (always returning chunks alongside synthesis) is low; the benefit (Claude can verify when the model hallucinates a nullable field) is direct mitigation of the observed failure mode.

The verdict is **PARTIAL** rather than VALIDATED because the per-bucket research_note is borderline and the failure pattern argues for the borderline-branch action (flip default to `"both"`), not the pass-branch action (default stays `"synthesis"`). Russell makes the final call during Phase 4 planning.

## Results

**Verdict:** PARTIAL — gate technically met overall (F1=90.2%) but per-bucket research_note (F1=85.4%) and observed hallucination pattern on nullable fields argue for the BORDERLINE-branch action.

**Phase 4 recommendation (feeds into `/gsd:spike-wrap-up` → Phase 4 plan):**

1. **Adopt D-01 BORDERLINE branch:** flip `recall()`'s `verbosity` parameter default from `"synthesis"` to `"both"`. Raw chunks return alongside synthesis. The breaking-change risk that motivated the escape hatch is now active (model demonstrably hallucinates on nullable fields under JSON-schema mode).
2. **Sharpen the extraction system prompt** in the eventual Phase 5 AI-05 implementation: explicitly call out the failure modes observed here ("Do NOT resolve 'today' / 'this week' / 'TBD' / fragmentary identifiers to concrete values — emit null"). This is essentially free.
3. **Real-corpus validation remains required.** Synthetic samples may have under-stated the hallucination rate; Russell's job-search agent corpus is the validation set. Add as a Phase 4 plan task gated before TOL-08 closure.
4. **Keep Spike 002 (summarization fidelity)** — the paraphrasing-on-free-text pattern observed here is exactly its scope, and the verdict on synthesis-only as a CONTRACT depends on whether paraphrased summaries preserve load-bearing facts.

**Evidence:** `results/results.json` (machine-readable), `results/results.html` (per-sample colour-coded diff viewer).

**Surprises:**

- Workers AI JSON-schema mode is reliable on STRUCTURE (zero malformed-JSON errors across 30 samples) but not on NULL DISCIPLINE (hallucinates nullable values from adjacent text).
- Latency variance is wide (700ms-13.6s); spike samples that ran during a Workers AI cold-start window were 10x slower.
- The model's paraphrasing tendency is itself a finding for Phase 5: the `result.synthesis` field will NOT preserve verbatim phrasing — Claude must rely on `meta.gaps` + raw chunks to detect drift from source content.
