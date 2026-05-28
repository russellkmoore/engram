---
name: spike-findings-engram
description: Implementation blueprint from Engram spike experiments. Requirements, proven patterns, and verified knowledge for building Engram's v0.1 MCP foundation — specifically the EngramResponse synthesis contract (Phase 4) and the Phase 5 ranking strategy. Auto-loaded during implementation work.
---

<context>
## Project: engram

Engram is an open-source, MCP-native second brain for AI assistants. The v0.1 milestone (MCP Foundation, target 2026-06-07) builds a Cloudflare Workers stack — Durable Objects for per-workspace SQLite storage, Vectorize for semantic search, Workers AI for embeddings/extraction/summarization, Queues for async enrichment — exposed via 5 MCP tools (`remember`, `recall`, `search`, `forget`, `ingest`) wrapped in the universal `EngramResponse<T>` envelope.

Spike sessions wrapped: 2026-05-26 (3 spikes, all PARTIAL — synthetic-sample run pre-Phase 4 planning).
</context>

<requirements>
## Requirements

Non-negotiable design decisions that emerged from Phase 4 discuss and the spike alignment session. Every feature-area reference honors these:

- **Models under test are LOCKED:** `@cf/meta/llama-3.1-8b-instruct` for extraction + summarization; `@cf/baai/bge-base-en-v1.5` (768d, cosine) for embeddings. Per ROADMAP §"Phase 5: AI Integration" SC#1 / SC#3 / SC#5. The spikes measure these exact bindings.
- **Synthetic-recalibrated gates apply:** ≥90% PASS / 75-90% BORDERLINE / <75% FAIL on synthetic samples (translates to ≥85% / 70-85% / <70% real-world). All three spikes used synthetic samples; real-corpus validation is deferred to Phase 4 plan tasks.
- **Real-corpus validation gate before TOL-08 closure** (Phase 4 plan task): pull 10-20 actual samples from Russell's job-search agent corpus, run them through the spike-001 `/extract` Worker, score against ground truth. If real-corpus F1 < 75%, block TOL-08 and surface to Phase 5 discuss.
- **Honest-stubs posture (D-04) is locked.** Every `EngramResponse<T>` field is present and typed correctly; AI-requiring fields ship as `null` or empty in v0.1. Phase 5 POPULATES; Phase 4 NEVER fakes with heuristic templates.
- **`verbosity` parameter default is `"both"` on `recall()`**, NOT `"synthesis"`. Spikes 001 + 002 both landed in the 75-90% BORDERLINE band — the BORDERLINE-branch action from D-01's decision gate fires. Raw chunks always returned alongside synthesis.
  _Phase 5 supersession (2026-05-28, .planning/phases/05-ai-integration/05-CONTEXT.md D-01 / D-05): the default is `"chunks"`, not `"both"`. Synthesis is opt-in. The BORDERLINE quality finding still drives the F1 ≥ 75% gate on AI-04 closure — when callers opt in, synthesis must hit the bar. This line is historically accurate; D-01 is normatively binding._
- **Workers AI calls hit REAL Cloudflare AI** at dev time (no local emulation for AI binding). `wrangler login` required.
- **Vectorize uses one global index + namespace per workspace** (per AI-02 + spike 003 confirmation). Never one-index-per-workspace.
- **Hybrid ranking REQUIRED for Phase 5 `recall()`** — empirically validated by spike 003. Vector-only cosine is insufficient: top cross-bucket pair scored 0.8251 (above the intra-bucket mean of 0.6472).
  </requirements>

<findings_index>

## Feature Areas

| Area                              | Reference                                                                                            | Key Finding                                                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EngramResponse synthesis contract | [references/engram-response-synthesis-contract.md](references/engram-response-synthesis-contract.md) | Synthesis-only thesis is fragile (~84-90% fidelity on synthetic); flip `verbosity` default to `"both"`; honest-stubs everywhere; Phase 5 system-prompt has 5 specific drop categories to address. |
| Phase 5 ranking strategy          | [references/phase-5-ranking-strategy.md](references/phase-5-ranking-strategy.md)                     | `bge-base-en-v1.5` encodes domain not memory type — top cross-bucket cosine 0.8251 > intra-bucket mean 0.6472. Hybrid ranking (vector + type filter + recency + scope) required, not optional.    |

## Source Files

Original spike source files are preserved in `sources/` for complete reference:

- `sources/001-extraction-precision-recall/` — Worker + harness + 30 synthetic samples (10/10/10) + Phase-4-shaping README. Verdict: PARTIAL (F1=90.2% overall; per-bucket research_note 85.4% borderline; nullable-field hallucinations).
- `sources/002-summarization-fidelity/` — Worker + harness + load-bearing-facts annotations. Reuses spike 001's sample corpus. Verdict: PARTIAL (R=83.7% overall; BORDERLINE band; dates/sources/identifiers drop most).
- `sources/003-embedding-sensibility/` — Worker + harness for pairwise cosine matrix. Reuses spike 001's sample corpus. Verdict: PARTIAL (Δ=0.0696 below 0.10 gate; IQR overlaps; embedding captures domain not type).
  </findings_index>

<metadata>
## Processed Spikes

- 001-extraction-precision-recall
- 002-summarization-fidelity
- 003-embedding-sensibility
  </metadata>
