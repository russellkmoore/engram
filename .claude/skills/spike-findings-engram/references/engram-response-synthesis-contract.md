# EngramResponse Synthesis Contract

Implementation blueprint for the v0.1 `EngramResponse<T>` envelope's synthesis-related fields. Spikes 001 + 002 measured `@cf/meta/llama-3.1-8b-instruct` quality on (a) structured-JSON field extraction and (b) plain-text summarization fidelity. Both measurements landed in the 75-90% BORDERLINE band — the synthesis-only thesis is **viable but fragile**, and the envelope's escape hatches must be active by default in v0.1.

## Requirements

Non-negotiable for the Phase 4 build (carry forward from `MANIFEST.md` Requirements + Phase 4 `04-CONTEXT.md`):

- **Synthetic-sample optimism bias is real.** Synthetic gates are tightened to ≥90% / 75-90% / <75% (vs the real-world ≥85% / 70-85% / <70%). Real-corpus validation on Russell's job-search agent samples is a **Phase 4 plan task gated before TOL-08 closure** — NOT optional.
- **Honest-stubs posture (D-04) is locked.** Every envelope field is present and typed; AI-requiring fields ship as `null` or empty in v0.1. Phase 5 POPULATES; Phase 4 NEVER fakes with templated heuristics.
- **Workers AI calls use REAL Cloudflare AI** (no local emulation for AI binding). `wrangler login` required at deploy/dev time. Pricing is cent-per-call territory — acceptable.

## How to Build It

### 1. `recall()` envelope — verbosity default is `"both"`, not `"synthesis"`

Phase 4 `04-CONTEXT.md` D-02 originally specified `verbosity` default = `"synthesis"`. Spike 001 + 002 BOTH land in the 75-90% band → **flip default to `"both"`** (raw chunks always returned alongside synthesis).

```typescript
// packages/mcp-server/src/schemas.ts — add to RecallInputSchema
verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("both"),
// Default changed from "synthesis" to "both" based on spikes 001+002.
// Synthesis quality is borderline on synthetic samples; raw chunks are
// the recovery surface when llama-3.1-8b hallucinates nullable fields or
// drops dates/sources/identifiers from the summary.
```

`recall.result.chunks` is the new optional field. Shape:

```typescript
type RecallChunk = {
  id: string; // block id
  content_excerpt: string; // first ~300 chars of content or matched window
  score: number | null; // v0.1: null (lexical, no ranking); Phase 5: cosine score
};
```

### 2. `result.synthesis` MUST be `null` in v0.1

No templated `"Found N memories matching '<query>'"` heuristic. The honest-stub posture is the recovery posture — `null` tells Claude "AI synthesis didn't run yet" rather than misleading with a hand-written string Claude might trust. Phase 5 / AI-04 populates this with real CF AI synthesis after the spike-002 prompt design (below) is applied.

### 3. `meta.gaps` is the load-bearing recovery hint

Every honest-stub `null` envelope field gets a corresponding human-readable string in `meta.gaps`. Concrete strings to ship:

```typescript
const META_GAPS_PHASE_4 = {
  recall: [
    "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only.",
  ],
  remember: [
    "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
    "Conflict detection lands in Phase 5 (semantic similarity via Vectorize).",
  ],
  ingest: ["Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."],
};
```

Strings are TEMPLATED but FROZEN at v0.1 (planner picks final wording during plan-phase) so MCP-08 token-budget tests can reproduce exact byte counts.

### 4. `remember()` honest-stub output (locked by D-06)

```typescript
return {
  result: {
    id, // real UUID
    classified_type: args.type ?? null, // pass-through from caller
    extracted_fields: {}, // {} until Phase 5 / AI-05
    confidence: null, // no AI ran
  },
  context: {
    related: [], // no semantic adjacency yet
    entities: [], // Phase 5 / AI-05
    conflicts: [], // Phase 5 / AI-02 — empty contract in v0.1
  },
  meta: {
    confidence: null,
    coverage: null,
    last_updated: Date.now(),
    gaps: META_GAPS_PHASE_4.remember,
  },
};
```

### 5. `ingest()` honest-stub output (locked by D-05)

```typescript
const jobId = crypto.randomUUID();
return {
  result: { status: "accepted" as const, job_id: jobId },
  context: { related: [], entities: [] },
  meta: {
    confidence: null,
    coverage: null,
    last_updated: Date.now(),
    gaps: META_GAPS_PHASE_4.ingest,
  },
};
// NO env.INGEST_QUEUE.send(...) call here. Phase 6 swaps in:
//   ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent));
// underneath the same return shape — one-line diff.
```

### 6. Phase 5 AI-05 system-prompt design (when that phase arrives)

Spike 002 itemized the 5 fact categories that get dropped from llama-3.1-8b summaries. The Phase 5 extraction/summarization system prompt MUST explicitly call them out:

```text
You are extracting facts from a memory for Engram's recall layer.

Preserve VERBATIM:
- Dates (in any format: ISO, relative, partial)
- Sources / provenance / origin attribution (LinkedIn, Reddit, recruiter, "via blog post", etc.)
- Technical identifiers (URLs, function names, library names, file paths, error codes)
- Numeric values (salaries, durations, version numbers, counts)
- When a decision rejects an alternative, name BOTH the chosen and rejected options
  (e.g., "X chosen over Y, because…")

Do NOT:
- Resolve "today"/"this week"/"TBD" to concrete values — return null
- Invent project names from fragmentary identifiers
- Paraphrase entity names (use "Cloudflare", not "the company")
```

This costs nothing to add and addresses the four highest-frequency drop categories observed in spike 002.

### 7. Real-corpus validation gate (Phase 4 plan task)

Add this task to the Phase 4 PLAN.md before TOL-08 (Russell's job-search agent smoke test):

> **Real-corpus extraction validation:** Pull 10-20 actual job postings from Russell's job-search agent corpus (the historical data the existing agent has stored). Run them through the spike-001 `/extract` Worker. Compute per-bucket precision/recall against hand-coded ground truth. If real-corpus F1 < 75% (the synthetic-recalibrated FAIL gate translated back to real-world), block TOL-08 closure and surface to Phase 5 discuss.

## What to Avoid

- **Don't ship templated synthesis strings as a placeholder.** Spike 002 confirms the model paraphrases — Claude would over-trust the string. `null` is the honest contract.
- **Don't trust `response_format=json_schema` for null discipline.** Spike 001 found the model emits `"null"` (string literal), invents dates from "today"/"this week", and resolves "TBD" to a salary range. The Phase 5 system prompt MUST explicitly forbid these patterns.
- **Don't add `verbosity` to `search()`, `remember()`, `forget()`, `ingest()`.** They have no synthesis to escape from. Only `recall()` gets the parameter. (`reflect()` in v0.3 inherits.)
- **Don't measure verbatim string preservation.** Spike 001 + 002 both confirmed paraphrasing on free-text is the norm. The fact-preservation metric in spike 002 uses token-overlap + substring containment — not exact match.
- **Don't put more than 25 memories in a recall response.** Phase 4 D-10 tightens `RecallInputSchema.limit` from 100 to ≤25 based on the 8K-token budget. Don't relax this — `gpt-tokenizer` over-counts vs Claude, but the safety margin is intentional.

## Constraints

- **Workers AI latency variance:** 500-13,600ms per call. Cold-start tail is real. Phase 4 latency budget for `remember()` is ~150-430ms (per ARCHITECTURE.md) — Phase 5's inline embedding upsert in `remember()` will be cold-start-bounded; design with this variance in mind.
- **`@cf/meta/llama-3.1-8b-instruct`:** structured-JSON via `response_format: { type: "json_schema", json_schema: <schema> }`. Verified reliable on STRUCTURE (0 malformed JSON across 30 samples) but unreliable on NULL DISCIPLINE.
- **Workers AI cost:** ~$0.001-0.005 per extraction call. Negligible for v0.1 single-user use; relevant for v1.0 managed-cloud pricing.
- **`max_tokens` for extraction:** 1024 (covered worst-case in spike 001).
- **`temperature` for extraction:** 0.2 (stable). For summarization: 0.3 (allow natural paraphrase).
- **Synthetic samples carry optimism bias.** Real-world quality is likely lower. Real-corpus validation before TOL-08 closure is non-negotiable.

## Origin

Synthesized from spikes: 001 (extraction-precision-recall), 002 (summarization-fidelity).
Source files preserved in: `sources/001-extraction-precision-recall/`, `sources/002-summarization-fidelity/`.

Headline numbers (synthetic, recalibrated gates):

- Spike 001: F1=90.2% overall (PARTIAL — per-bucket research_note 85.4% borderline; nullable-field hallucinations).
- Spike 002: R=83.7% overall (PARTIAL — BORDERLINE; 25 facts dropped across 30 samples; dates/sources dominate drops).

Phase 4 CONTEXT.md decisions impacted: D-01 (spike-first), D-02 (verbosity default flips to `"both"`), D-04 (honest stubs reinforced), D-05 (ingest stub), D-06 (remember stub), D-07 (recall stub), D-08 (empty conflict contract), D-10 (limit ≤ 25).
