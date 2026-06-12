---
phase: 03-query-expansion-reranker
reviewed: 2026-06-08T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/mcp-server/src/rrf.ts
  - packages/mcp-server/src/query-expansion.ts
  - packages/mcp-server/src/tools.ts
  - packages/mcp-server/src/hybrid-rank.ts
  - packages/mcp-server/src/envelope.ts
  - shared/ai-config/src/index.ts
  - packages/mcp-server/src/__tests__/evals/reranker-ablation.eval.test.ts
  - packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts
  - packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts
findings:
  critical: 3
  warning: 5
  info: 4
  total: 12
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-08
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 3 ships query expansion (EXP-01/02/03), RRF fusion (EXP-04), bge-reranker cross-encoding
(EXP-06), and three eval suites (EXP-07/08/11). The core pure-transforms (`rrf.ts`,
`hybrid-rank.ts`, `query-expansion.ts`) are well-structured. The integration hub (`tools.ts`)
has three correctness defects: (1) `args.types` filter is silently dropped when the adaptive
gate triggers fan-out, causing type-filtered `recall()` calls to return off-type results;
(2) the EXP-06 fallback comment and the hybridRank score-scale expectation are inconsistent
when fan-out fires AND the reranker fails simultaneously, degrading ranking quality on a
specific failure intersection; (3) the `since`, `until`, and `project` args are accepted by
the schema and documented in the tool description but completely ignored in the handler,
creating a false API contract. The `rrf.ts` formula, the reranker index-alignment, and the
sigmoid normalization are all correct. No workerd-incompatible APIs were found.

---

## Critical Issues

### CR-01: `args.types` Vectorize filter dropped in fan-out path — wrong types returned

**File:** `packages/mcp-server/src/tools.ts:590-601`
**Issue:** The initial single-pass Vectorize query (line 571) correctly applies
`{ filter: { type: { $in: args.types } } }` when `args.types` is set. However, the fan-out
Vectorize queries inside the `kept.map(...)` block (lines 594-597) call `vectorizeQuery`
without any `filter` option, retrieving ALL memory types regardless of what the caller
requested. When `top1 < 0.65` triggers expansion, a user calling `recall({query: "Alice",
types: ["contact"]})` can receive `research_note`, `job_application`, and other off-type
memories. The `type_match` boost inside `hybridRank` partially compensates in ranking, but
does not exclude non-matching types from the returned result set. This contradicts the
documented semantics of the `types` parameter.

**Fix:**
```typescript
// Capture the filter object before the fan-out block:
const typeFilter = args.types?.length
  ? { filter: { type: { $in: args.types } } }
  : {};

// Then apply it in every fan-out Vectorize call:
const variantResult = await vectorizeQuery(env, props.workspace_id, variantVec, {
  topK: fetchSize,
  returnMetadata: "all",
  ...typeFilter,          // <-- add this
});
```

---

### CR-02: Hybrid score scale mismatch when fan-out fires AND reranker fails

**File:** `packages/mcp-server/src/tools.ts:700-703`
**Issue:** `HYBRID_WEIGHTS.rerank = 0.6` was calibrated against cosine similarity scores
in `[0.45, 1.0]` (D-34 sweep). When the reranker succeeds it returns sigmoid-normalized logits
in `[0, 1]` — the correct scale. When the reranker call fails (catch at line 691), the fallback
`?? m.score` is applied. In the single-query path `m.score` is Vectorize cosine `[0, 1]` — still
the right scale. But when fan-out fires and RRF fusion ran, `m.score` in `mergedMatches` is an
RRF score (e.g., first item ≈ `1/61 ≈ 0.016`, not `0.5`). This means `rerank * 0.6` in
`hybridRank` collapses to nearly zero, effectively zeroing the largest weight component and making
ranking fall back to recency alone. The code comment "raw-cosine fallback (EXP-06)" is incorrect
for the fan-out case.

This failure mode requires both conditions simultaneously (expansion triggered + reranker unavailable),
but during a reranker 429 storm both conditions are likely to co-occur.

**Fix:** After RRF fusion and before the reranker block, normalize the RRF scores back to `[0, 1]`
so the fallback is always on a consistent scale:

```typescript
// After mergedMatches = reciprocalRankFusion(lists).map(x => x.item)
// Normalize RRF scores to [0,1] by dividing by the theoretical max (1/(k+1)):
const rrfMax = 1 / (60 + 1); // default k=60; first-rank score
const normalizedMerged = mergedMatches.map((m) => ({
  ...m,
  score: Math.min(m.score / rrfMax, 1),
}));
mergedMatches = normalizedMerged;
```

Alternatively, when `rerankScores` is empty (reranker failed), fall back to the pre-expansion
cosine score from `result.matches` for candidates present in both sets instead of the RRF score.

---

### CR-03: `since`, `until`, and `project` parameters accepted but silently ignored

**File:** `packages/mcp-server/src/tools.ts:498-844` / `packages/mcp-server/src/schemas.ts:63-64`
**Issue:** `RecallInputSchema` defines `since: z.iso.datetime().optional()`,
`until: z.iso.datetime().optional()`, and `project: z.string().optional()`. The `RECALL_TOOL_DESCRIPTION`
and the `registerTool` comment both advertise these parameters to MCP clients. But none of them are
used anywhere in the `recall()` handler body. A caller filtering `since: "2026-01-01T00:00:00Z"` or
`project: "proj-123"` receives results from all time and all projects with no error, no warning, and
no gap message indicating the filter was not applied. This is a false API contract that will cause
incorrect behavior for any MCP client that relies on temporal or project-scoped recall.

`args.project` is similarly accepted in `remember()` to set `project_id` on the block, but
`recall()` never filters by `project_id` in either the Vectorize query or the SQLite hydration.

**Fix:** Either (a) apply the filters in the handler, or (b) remove the parameters from the schema
and tool description, or (c) add a `META_GAPS` entry and surface it in the envelope:

```typescript
// Option C: surface the limitation without removing the schema field
const ignoredFilters: string[] = [];
if (args.since !== undefined || args.until !== undefined) {
  ignoredFilters.push(META_GAPS.sinceUntilNotImplemented);
}
if (args.project !== undefined) {
  ignoredFilters.push(META_GAPS.projectFilterNotImplemented);
}
// Append ignoredFilters to envelope.meta.gaps after buildRecallResponse
```

---

## Warnings

### WR-01: Original query re-embedded and re-queried in fan-out (redundant AI + Vectorize call)

**File:** `packages/mcp-server/src/tools.ts:590-603`
**Issue:** `expandQuery` anchors `variants[0]` to `originalQuery` (EXP-01). The fan-out at line 591
calls `kept.map(async (v) => safeRun(env, EMBEDDING_MODEL, {text: [v]}) + vectorizeQuery(...))` for
ALL variants including `kept[0]` = the original query. This re-embeds a string that was already
embedded at line 531 (`queryVector`) and discards `result.matches` (the perfectly valid pre-expansion
Vectorize result). Every fan-out path wastes 1 embedding call and 1 Vectorize call. At p50 latency
of the expansion path (~1–2 AI calls at 200ms each), this is a meaningful fraction of the budget.

**Fix:** Skip `kept[0]` in the fan-out embed loop and reuse `result.matches` directly as `lists[0]`:

```typescript
const lists: (typeof result.matches)[] = [result.matches]; // reuse pre-expansion result
const paraphraseResults = await Promise.all(
  kept.slice(1).map(async (v) => {          // skip kept[0] = originalQuery
    const variantEmbedResp = await safeRun(env, EMBEDDING_MODEL, { text: [v] });
    const variantVec = (variantEmbedResp as { data?: number[][] }).data?.[0];
    if (!variantVec) return [] as typeof result.matches;
    const variantResult = await vectorizeQuery(env, props.workspace_id, variantVec, {
      topK: fetchSize,
      returnMetadata: "all",
      ...typeFilter,  // CR-01 fix
    });
    return variantResult.matches;
  }),
);
mergedMatches = reciprocalRankFusion([...lists, ...paraphraseResults]).map((x) => x.item);
```

---

### WR-02: `embedding_id` column always null — stampEmbedding comment misleading

**File:** `packages/mcp-server/src/tools.ts:307`, `packages/workspace-do/src/queries.ts:713`
**Issue:** The `remember()` handler constructs the block with `embedding_id: null` (line 307)
and never updates it. `stampEmbedding()` only sets `embedding_model` and `embedding_version`; it
explicitly documents "does NOT touch `embedding_id` (set by `remember()` at upsert time)"
(queries.ts line 713). But `remember()` never sets it. The `embedding_id` column in SQLite is
always `null` for every block created via the MCP `remember` tool. The `getBlocksByIds` query
selects `embedding_id` and returns it in the `Memory` type, creating a field that consumers
might rely on but that is never populated. This is a latent data integrity defect.

**Fix:** Set `embedding_id` in `stampEmbedding` (the Vectorize vector ID equals `block.id`):

```typescript
// In stampEmbedding args: add embedding_id: string
// UPDATE blocks SET embedding_id = ?, embedding_model = ?, embedding_version = ?, updated_at = ? WHERE id = ?
```

Or update the `remember()` handler to pass `embedding_id: id` in the initial block:

```typescript
const block: Memory = {
  id,
  embedding_id: id,  // Vectorize vector ID = block id (same UUID)
  // ...
};
```

---

### WR-03: `trimToBudget` Step 4 appends wrong `META_GAPS` entry for synthesis truncation

**File:** `packages/mcp-server/src/envelope.ts:553-555`
**Issue:** When `trimToBudget` hits Step 4 (synthesis alone exceeds the 7,500-token budget),
it appends `META_GAPS.recallChunksOmittedSynthesis` to `meta.gaps`. That string reads:
_"Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary."_
But synthesis is NOT omitted — it is present and truncated. A Claude client that reads this gap
message will be instructed to retry with `verbosity: 'synthesis'`, which is exactly what already
ran. The correct signal is "synthesis was truncated", not "synthesis was omitted".

**Fix:** Add a dedicated `META_GAPS` entry and use it in Step 4:

```typescript
// In META_GAPS const:
synthesisTruncated:
  "Synthesis truncated to fit token budget; pass a narrower query for full synthesis.",

// In trimToBudget Step 4:
const updatedGaps = [
  ...(Array.isArray(current.meta.gaps) ? current.meta.gaps : []),
  META_GAPS.synthesisTruncated,  // was: META_GAPS.recallChunksOmittedSynthesis
];
```

---

### WR-04: `cosine()` silently pads mismatched vector dimensions with zeros

**File:** `packages/mcp-server/src/query-expansion.ts:152-163`
**Issue:** `cosine(a, b)` iterates `a.length` times, using `b[i] ?? 0` when `i ≥ b.length`.
If the embedding model is ever swapped mid-deployment (or a different model is accidentally used
for a paraphrase vs the original query), vectors of different dimensions will be compared without
any error — the result will be a silently wrong similarity score. For the current single-model
architecture this is benign, but the silent failure mode is dangerous if `EMBEDDING_MODEL` is ever
changed and a stale cached vector from the old model is passed in.

**Fix:** Add a guard at the top of `cosine`:

```typescript
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosine: dimension mismatch (a=${String(a.length)}, b=${String(b.length)}) — ensure both vectors use ${EMBEDDING_MODEL}`,
    );
  }
  // ...existing loop...
}
```

---

### WR-05: `recall-latency.eval.test.ts` does not filter by `split="train"`

**File:** `packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts:203`
**Issue:** The latency eval uses `corpus.entries.slice(0, LATENCY_QUERY_CAP)` — the first 20 entries
of the file regardless of `split`. EXP-07 and EXP-08 filter `corpus.entries.filter(e => e.split === "train")`
to avoid data-leakage from the validation set. If the corpus is ordered with validation entries at
the front (or mixed), the timing sample may not represent the same query distribution as the eval
corpus. More critically, if the corpus grows and validation entries are interleaved, the latency
measurement becomes inconsistent across runs.

**Fix:**
```typescript
// Line 203: replace slice with filter + slice
const allEntries = corpus.entries
  .filter((e) => e.split === "train")   // consistent with EXP-07/08 discipline
  .slice(0, LATENCY_QUERY_CAP);
```

---

## Info

### IN-01: `sigmoid` function duplicated across `tools.ts` and `reranker-ablation.eval.test.ts`

**File:** `packages/mcp-server/src/tools.ts:653-655`, `packages/mcp-server/src/__tests__/evals/reranker-ablation.eval.test.ts:157-159`
**Issue:** Identical two-line `sigmoid(x)` implementations exist in both files. The eval file
comment says "mirrors tools.ts EXP-06 implementation." If the production implementation ever
changes (e.g., to a numerically stable variant for large positive `x`), the eval copy would silently
diverge.
**Fix:** Export `sigmoid` from `tools.ts` or from a new `packages/mcp-server/src/math-utils.ts`
and import it in the eval.

---

### IN-02: `EXP-12` entity-preservation rate measured on pre-gate expansion output

**File:** `packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts:384`
**Issue:** `entityPreservationRate` is computed against `scoutVariants.slice(1)` (raw model output)
rather than against the variants that survive `keepVariantsAboveGate` (the production path). If
entity-preserving but semantically drifted variants are dropped by the 0.85 cosine gate, the
production system may have a lower effective entity-preservation rate than the eval reports. The
eval passes the gate at 0.80 while the production path might not.
**Fix:** Either document this scope difference explicitly, or compute the metric against the gated
variants by running `keepVariantsAboveGate` inside the eval loop.

---

### IN-03: `CLASSIFIER_MODEL` used for synthesis instead of `SYNTHESIS_MODEL`

**File:** `packages/mcp-server/src/tools.ts:87, 782`
**Issue:** `tools.ts` imports `CLASSIFIER_MODEL` from `ai-helper` and uses it for the
`verbosity="synthesis"` LLM call. The intent was always to route synthesis through `SYNTHESIS_MODEL`
(the role-named alias in `ai-config`). Currently both constants point to the same model
(`llama-4-scout-17b-16e-instruct`) so there is no runtime difference. However, when v0.2
specializes `SYNTHESIS_MODEL` to a frontier model (e.g., per the CLAUDE.md comment about
`kimi-k2.6`), the synthesis call will silently stay on `llama-4-scout` instead of picking up
the new model, because the import and usage both reference `CLASSIFIER_MODEL`.
**Fix:** Import `SYNTHESIS_MODEL` from `@engram/ai-config` (or the `ai-helper` re-export) and use
it for the synthesis `safeRun` call in the `verbosity="synthesis"` block.

---

### IN-04: `since`/`until`/`project` not mentioned in `META_GAPS` for `recall`

**File:** `packages/mcp-server/src/envelope.ts:75-103`
**Issue:** Related to CR-03. Even if the full fix for CR-03 is deferred, there is no
`META_GAPS.sinceUntilNotImplemented` or `META_GAPS.projectFilterNotImplemented` entry. The existing
`META_GAPS.search` entry ("Lexical (LIKE) backing — semantic search lands in Phase 5") sets a
precedent for surfacing unimplemented filter behavior via gaps. Recall has analogous unimplemented
filters with no disclosure path.
**Fix:** Add canonical gap strings in `META_GAPS` and append them to the recall response whenever
the respective args are non-undefined.

---

_Reviewed: 2026-06-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
