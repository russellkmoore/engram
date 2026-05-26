# Spike Wrap-Up Summary

**Date:** 2026-05-26
**Spikes processed:** 3 (001, 002, 003)
**Feature areas:** 2 (EngramResponse synthesis contract; Phase 5 ranking strategy)
**Skill output:** [`./.claude/skills/spike-findings-engram/`](../../.claude/skills/spike-findings-engram/)

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
| --- | --- | --- | --- | --- |
| 001 | extraction-precision-recall | standard | PARTIAL ⚠ | EngramResponse synthesis contract |
| 002 | summarization-fidelity | standard | PARTIAL ⚠ | EngramResponse synthesis contract |
| 003 | embedding-sensibility | standard | PARTIAL ⚠ | Phase 5 ranking strategy |

## Key Findings

### EngramResponse synthesis contract (spikes 001 + 002)

Two independent measurements of `@cf/meta/llama-3.1-8b-instruct` quality both landed in the **75-90% BORDERLINE band** on synthetic samples:

- **Spike 001 — extraction:** F1=90.2% overall (just clears synthetic-recalibrated ≥90% gate), but per-bucket `research_note`=85.4% AND the model hallucinates nullable fields ("today" → concrete date, "TBD" → salary string, fragmentary identifiers → invented project names). JSON-schema mode is reliable on structure (0 malformed JSON across 30 samples) but not on null discipline.
- **Spike 002 — summarization:** R=83.7% fact preservation overall. 25 facts dropped across 30 samples. Drop pattern (in order of frequency): dates (8), sources/provenance (5), technical identifiers (5), numeric metadata (3), "rejected alternative" facts (4). `job_application` was worst (78.8%); `decision_log` best (88.7%).

**The two measurements together drive Phase 4 D-02's `verbosity` default from `"synthesis"` to `"both"`.** Raw chunks ship alongside synthesis by default so Claude can recover dates / sources / identifiers when the model triages them out. D-04 honest-stubs posture is reinforced — `synthesis = null` in v0.1 is the correct contract until Phase 5 demonstrates ≥95% real-corpus fact preservation.

### Phase 5 ranking strategy (spike 003)

`@cf/baai/bge-base-en-v1.5` (768d, cosine) embeddings encode **domain, not memory type**:

- Intra-bucket mean cosine 0.6472; inter-bucket mean 0.5776; **Δ=0.0696** below the 0.10 PASS gate. IQR overlaps (inter.p75=0.6095 > intra.p25=0.6025).
- Top cross-bucket pair scored cosine **0.8251** (`dl-01` Engram-DO decision vs `rn-09` Engram-DO research note) — both about Cloudflare Durable Objects, different memory types. The embedding doesn't care; it sees the topic.
- Per-bucket cluster tightness: `job_application` (0.6816) > `decision_log` (0.6442) > `research_note` (0.6159). `research_note` is a "container type" — heterogeneous topics under one type — and clusters loosest.

**Phase 5 AI-04 must apply a `metadata.type` filter at Vectorize query time AND use hybrid ranking** (vector score + recency decay + type match boost + scope filter). Folds the Phase 5 todo `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` which now has empirical support.

## Phase 4 actions

Locked into the spike-findings skill — Phase 4 plan-phase consumes these via auto-load:

1. **D-02 `verbosity` default flips to `"both"`** on `recall()`.
2. **D-04 honest-stubs reinforced** — every AI-requiring envelope field ships as `null` in v0.1.
3. **Real-corpus validation gate** added as a Phase 4 plan task before TOL-08 closure. Russell's job-search agent corpus is the validation set.
4. **Phase 5 AI-05 prompt design hints** documented in [`references/engram-response-synthesis-contract.md`](../../.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md) — explicit instructions to preserve dates / sources / technical identifiers / numerics / rejected-alternative facts.

## Phase 5 actions (deferred — surface at /gsd:discuss-phase 5)

1. **AI-04 acceptance:** Vectorize `metadata.type` filter mandatory when caller supplies `args.types[]`.
2. **Hybrid ranking required**, not optional. Initial weights documented in [`references/phase-5-ranking-strategy.md`](../../.claude/skills/spike-findings-engram/references/phase-5-ranking-strategy.md); tune empirically against Russell's real corpus during AI-04 implementation.
3. **`research_note` semantic heterogeneity** — consider tag-based sub-clustering or query expansion. Surface for Phase 5 discuss.

## Cost & runtime notes

- Total Workers AI cost across all 3 spikes (including debugging runs): ~$0.10 against Russell's Cloudflare account.
- Cold-start latency variance is real: 500ms-13.6s per call. Median ~700-900ms warm. Phase 5's inline `remember()` embedding upsert will be cold-start-bounded.
- One batched `bge-base-en-v1.5` call for 30 samples: ~900ms total. Sequential would be 6-15s — always batch when the model supports it.

## Commits

- `b1fd697` — spike-001 PARTIAL
- `59cd358` — spike-002 PARTIAL
- `add495e` — spike-003 PARTIAL
- `757028c` — conventions + manifest summary
