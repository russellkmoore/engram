---
spike: 003
name: embedding-sensibility
type: standard
validates: "Given the 30 synthetic samples from spike 001 embedded via @cf/baai/bge-base-en-v1.5, when pairwise cosine similarity is computed, then intra-bucket pairs are systematically higher than inter-bucket pairs (mean(intra) − mean(inter) ≥ 0.10 with IQR overlap absent)."
verdict: PARTIAL
related: ["001", "002"]
tags: [embeddings, bge-base-en-v1.5, P5/AI-04, vectorize, ranking]
---

# Spike 003: Embedding Sensibility

## What This Validates

**Given** the 30 synthetic samples from spike 001 (10 job_application, 10 decision_log, 10 research_note) — typed corpora with known semantic membership,
**when** each is embedded via `@cf/baai/bge-base-en-v1.5` (768-dimensional, cosine-distance) and pairwise cosine similarity is computed across all 435 pairs (30 choose 2),
**then** intra-bucket pairs (same memory type) cluster systematically higher than inter-bucket pairs, with `mean(intra) − mean(inter) ≥ 0.10` AND IQR overlap absent.

This is the Phase 5 ranking-strategy validation: does the chosen embedding model produce vectors that meaningfully separate Engram's memory types? If yes, Vectorize cosine-distance recall + a memory-type filter is sufficient for v0.1's `recall()` semantic upgrade. If no, Phase 5 needs hybrid ranking (vector + recency + type + scope) to disambiguate at the boundaries.

Doesn't block Phase 4 envelope freeze (Phase 4 ships lexical-only). Informs Phase 5 plan-phase scoping — specifically the AI-04 acceptance criteria.

## Why The Gate Numbers

- **Δ ≥ 0.10:** rule of thumb for cosine-distance retrieval — buckets are meaningfully separated. Mean intra around 0.75, mean inter around 0.65 would be a strong signal.
- **IQR overlap = none:** the 75th percentile of inter-bucket pairs must be ≤ the 25th percentile of intra-bucket pairs. This is the "no false-positive boundary" guarantee — even the most-similar cross-bucket pair is less similar than the least-similar same-bucket pair.
- **BORDERLINE (0.05 ≤ Δ < 0.10 OR IQR overlaps but is separable):** embeddings discriminate buckets but the boundary is fuzzy. Hybrid ranking is necessary.
- **FAIL (Δ < 0.05):** model fails to separate memory types — Phase 5 ranking strategy needs rework.

## Research

### API surface

`env.AI.run("@cf/baai/bge-base-en-v1.5", { text: string[] })` — batched. Returns `{ shape: [N, 768], data: number[][] }`. The runner does one batched call for all 30 samples (much faster than 30 individual calls; also more deterministic — same model instance).

### Knobs locked

- No tunable knobs for the embedding model itself (no temperature, no max_tokens)
- Single batched call (efficiency + determinism)
- Embedding dim is fixed at 768 (Vectorize index `engram-memories` will be created with `--preset=@cf/baai/bge-base-en-v1.5` per ROADMAP AI-01)

### Comparator: pairwise cosine

Standard cosine. No length normalization (BGE outputs are already normalized to unit length per HuggingFace card).

## How to Run

```bash
# Terminal 1
npx wrangler dev --config .planning/spikes/003-embedding-sensibility/wrangler.jsonc

# Terminal 2
node .planning/spikes/003-embedding-sensibility/scripts/run-spike.mjs
```

Outputs land in `results/results.json` (machine-readable: full pairwise matrix + stats) and `results/results.html` (viewer showing distribution stats, per-bucket intra-cosine, top-10 cross-bucket false-positive risks, bottom-10 intra-bucket false-negative risks).

## What to Expect

- Single batched call: ~500-2000ms total (vs 30 sequential calls at ~200-500ms each)
- 435 pairs scored in <100ms locally
- Cost: ~$0.005 (embeddings are cheaper per call than text generation)
- Final aggregate: intra/inter mean cosine, delta, IQR overlap test, decision gate verdict

## Observability

The HTML viewer surfaces two risk tables:

- **Top-10 closest cross-bucket pairs** — if these are anomalously close to intra-bucket means, they're the false-positive risk surface for Phase 5 recall (a job_application query returning a decision_log)
- **Bottom-10 weakest intra-bucket pairs** — if these are anomalously distant from each other, they're the false-negative risk surface (a job_application query missing other job_applications)

## Investigation Trail

### Run 1 — initial pass (2026-05-26)

Single batched embedding call: 30 samples → 30×768d vectors in 907ms (worker 881ms). 435 pairwise cosines computed locally in <50ms.

**Headline numbers:**

- Intra-bucket cosine (n=135): mean=**0.6472**, median=0.6479, IQR=[0.6025, 0.6915], range=[0.5293, 0.7839]
- Inter-bucket cosine (n=300): mean=**0.5776**, median=0.5728, IQR=[0.5400, 0.6095], range=[0.4289, 0.8251]
- **Delta: 0.0696** — falls in BORDERLINE band (0.05-0.10), below the 0.10 PASS gate
- **IQR overlap: yes** — inter.p75 (0.6095) exceeds intra.p25 (0.6025). The bucket boundary is fuzzy.

**Per-bucket intra mean:**

| Bucket | Mean intra-cosine | Median | Range |
| --- | --- | --- | --- |
| job_application | 0.6816 | 0.6827 | [0.586, 0.779] |
| decision_log | 0.6442 | 0.6441 | [0.538, 0.784] |
| research_note | 0.6159 | 0.6107 | [0.529, 0.766] |

`job_application` clusters tightest — samples share template-like structure (company + role + compensation + URL). `research_note` clusters loosest because the bucket is a CONTAINER TYPE (anything Russell jotted down) rather than a TOPIC TYPE — its members span MCP, Vectorize, mem0, prompt caching, agents SDK, etc.

### Risk surfaces

**Top-5 cross-bucket pairs (the false-positive risk):**

```text
0.8251  dl-01 (decision_log)  vs  rn-09 (research_note)
0.8059  dl-01 (decision_log)  vs  rn-05 (research_note)
0.7316  dl-01 (decision_log)  vs  rn-01 (research_note)
0.7026  dl-09 (decision_log)  vs  rn-09 (research_note)
0.7015  dl-09 (decision_log)  vs  rn-02 (research_note)
```

The 0.8251 pair: `dl-01` is the decision "Use Cloudflare Durable Objects per workspace rather than D1" — a decision about Engram's DO architecture. `rn-09` is a research note on "Durable Objects SQLite migration footgun" — also about Engram's DO architecture. Topically nearly identical; structurally different memory types.

**The embedding captures domain, not type.** For Engram's `recall()` semantics, this is the exact failure mode type-filtering exists to address. Hybrid ranking (vector + memory-type filter + project filter + recency) is REQUIRED — not just a nice-to-have for Phase 5.

**Bottom-5 intra-bucket pairs (the false-negative risk):**

```text
0.5293  rn-04  vs  rn-10  (research_note)  — MCP OAuth spec vs agents-SDK pitfall
0.5377  dl-02  vs  dl-06  (decision_log)   — Apache-2.0 license vs Vectorize HNSW tuning
0.5413  dl-08  vs  dl-10  (decision_log)   — envelope stubs vs Monday standup cadence
0.5419  rn-04  vs  rn-07  (research_note)  — MCP OAuth vs Anthropic prompt cache
0.5429  rn-02  vs  rn-10  (research_note)  — mem0 conflict resolution vs agents-SDK
```

These bottom pairs are unrelated TOPICS within the same memory type. A query "what did I research about MCP?" should return rn-04 (MCP OAuth) but NOT rn-10 (agents SDK pitfall) — vector-only ranking would conflate them less reliably than topic-specific tags or query expansion would. Confirms the Phase 5 query-expansion path (folded todo `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` — review-but-not-fold from Phase 4 discuss).

### What this changes for Phase 5

This spike doesn't change Phase 4's envelope contract — Phase 4 ships lexical-only `recall()`. But it shapes Phase 5's AI-04 plan:

1. **Type-filter is mandatory before cosine-ranking.** Vectorize namespaces handle workspace isolation; an additional `metadata.type` filter at query time is required to prevent cross-type false-positives.
2. **Hybrid ranking confirmed.** The Phase 5 todo `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` is validated empirically — cosine alone is insufficient.
3. **`research_note` is a problematic memory type** — too loose semantically to cluster cleanly. Phase 5 should consider whether to:
   - Subdivide via finer-grained tags (treat tags as a virtual type axis)
   - Compute embedding clusters within the bucket post-write
   - Or accept that `research_note` recall always demands query expansion + reranking

## Results

**Verdict:** PARTIAL — embeddings discriminate buckets (Δ=0.0696, intra > inter) but the signal is weaker than the 0.10 gate AND IQR overlaps. Vector-only ranking is INSUFFICIENT; hybrid ranking required for Phase 5.

**Phase 5 plan-phase hints (NOT Phase 4 plan):**

1. **AI-04 acceptance criteria addition:** `recall()` MUST apply a `metadata.type` filter at Vectorize query time when the caller supplies `args.types[]`. Without the filter, cross-type false-positives are observed at cosine ≥ 0.80.
2. **Hybrid ranking on top of Vectorize:** vector score + memory-type match boost + recency decay + scope filter. Folds `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` from Phase-5 backlog.
3. **`research_note` semantic heterogeneity** — consider whether this memory type needs sub-clustering or query expansion. Surface for Phase 5 discuss-phase.

**Evidence:** `results/results.json` (full pairwise matrix + stats), `results/results.html` (distribution + risk-surface viewer).

**Surprises:**

- One batched call (30 samples × 768d) returned in 907ms. Embedding latency is NOT the bottleneck for Phase 5 (extraction at ~1-13s is).
- `job_application` clusters tightest (template-like structure); `research_note` clusters loosest (container-type heterogeneity).
- The TOPIC-vs-TYPE overlap is the real finding. Embeddings see "Durable Objects" twice and don't care that one is a decision and one is a research note. Type-filtering at the Vectorize query layer is the structural answer.
