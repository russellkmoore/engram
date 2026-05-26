# Phase 5 Ranking Strategy

Implementation blueprint for Engram's Phase 5 semantic-recall upgrade. Spike 003 measured `@cf/baai/bge-base-en-v1.5` embedding sensibility on the same 30-sample corpus and found that embeddings encode **domain, not memory type** — vector-only ranking is insufficient for Engram's `recall()` semantics.

This reference is consumed at `/gsd:discuss-phase 5` / `/gsd:plan-phase 5`. It does NOT affect Phase 4 (which ships lexical-only).

## Requirements

- **`@cf/baai/bge-base-en-v1.5` is locked** (768d, cosine) per ROADMAP §"Phase 5: AI Integration" SC#1. The spike measures this exact model; substitutions would require a new spike.
- **Vectorize namespaces handle workspace isolation** (per ROADMAP AI-02 / SUMMARY.md §3 A5). One global index, namespace per workspace. Phase 5 MUST NOT create per-workspace indexes.
- **Hybrid ranking is REQUIRED, not optional** — empirically validated by spike 003. The Phase 5 todo `2026-05-26-phase-5-hybrid-ranking-not-vector-only.md` should be folded into Phase 5 scope at `/gsd:discuss-phase 5`.
- **Synthetic-sample bias applies here too** — spike 003 measured Δ=0.0696 on synthetic samples. Real-corpus measurement during AI-04 implementation is a verification task.

## How to Build It

### 1. Vectorize query layer — type-filter MANDATORY when caller supplies `args.types[]`

Spike 003's top cross-bucket pair scored cosine **0.8251** (`dl-01` Engram-DO decision vs `rn-09` Engram-DO research note — both about Cloudflare Durable Objects, different memory types). This is HIGHER than the intra-bucket mean of 0.6472. Cosine alone is NOT sufficient discrimination.

```typescript
// Phase 5 / packages/mcp-server/src/tools/recall.ts (Phase 5 territory)
const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
  text: args.query,
});

const vectorizeResult = await env.VECTORIZE.query(queryEmbedding.data[0], {
  topK: args.limit ?? 25,
  namespace: props.workspace_id,
  // MANDATORY when args.types is supplied — empirically validated by spike 003
  filter: args.types?.length ? { type: { $in: args.types } } : undefined,
  returnMetadata: "all",
});
```

The Vectorize metadata filter is the structural answer to the topic-vs-type overlap problem. Without it, a query for "Durable Objects decisions" would surface research notes about Durable Objects with similar scores.

### 2. Hybrid ranking — score = α·cosine + β·recency + γ·type_match + δ·scope_boost

Spike 003 Δ=0.0696 is below the 0.10 PASS gate AND IQR overlaps. Cosine alone leaves a fuzzy boundary. Re-rank the Vectorize topK with additional signals:

```typescript
// Phase 5 hybrid re-ranking — initial weights to tune empirically during AI-04
const WEIGHTS = {
  cosine: 1.0, // baseline semantic similarity from Vectorize
  recency: 0.15, // newer memories slightly preferred
  type_match: 0.2, // boost when block.type matches one of args.types
  scope_match: 0.15, // boost when block.scope matches args.scope
};

function hybridScore(hit: VectorizeHit, args: RecallInput, now: number): number {
  const ageHours = (now - hit.metadata.created_at) / (60 * 60 * 1000);
  const recency = Math.exp(-ageHours / (24 * 30)); // 30-day half-life
  const typeMatch = args.types?.includes(hit.metadata.type) ? 1 : 0;
  const scopeMatch = args.scope && args.scope === hit.metadata.scope ? 1 : 0;
  return (
    WEIGHTS.cosine * hit.score +
    WEIGHTS.recency * recency +
    WEIGHTS.type_match * typeMatch +
    WEIGHTS.scope_match * scopeMatch
  );
}
```

Weights are starting points — tune during AI-04 against the 30-sample corpus + Russell's job-search agent corpus.

### 3. Batch embeddings on intake AND query

Spike 003 showed one batched call for 30 samples runs in ~900ms total (vs ~30 × 200-500ms = 6-15s for sequential calls). Use the batched API at both ends:

```typescript
// remember() — single-sample embed (one text)
const embed = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [content] });
const vector = embed.data[0]; // number[768]

// Bulk re-embed migrations (Phase 5+ — model version upgrades) — batch up to N
const embed = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
  text: contentBatch, // string[] up to ~50-100 per call
});
const vectors = embed.data; // number[][]
```

### 4. Stamp `embedding_model` and `embedding_version` on every block

Phase 2 STO-04 already added `blocks.embedding_model TEXT` and `blocks.embedding_version INTEGER` columns. Phase 5 MUST stamp them on every write:

```typescript
const block = {
  // ...other fields...
  embedding_model: "@cf/baai/bge-base-en-v1.5",
  embedding_version: 1,
};
```

Future model upgrades increment `embedding_version`; a migration script can re-embed all rows where `embedding_version < CURRENT_VERSION`.

### 5. `research_note` memory type — accept loose clustering or sub-divide

Spike 003 found `research_note` clusters loosest (intra-mean 0.6159) because it's a "container type" — anything Russell jots down spans MCP, Vectorize, mem0, prompt caching, agents SDK. Three Phase 5+ options:

- **Accept the heterogeneity:** trust query expansion + tags to disambiguate. Cheapest.
- **Tag-based sub-clustering:** treat tags as a virtual type axis at query time (boost when tag overlap is high).
- **Compute embedding clusters post-write:** k-means on each workspace's `research_note` corpus, store cluster id as metadata, filter by cluster at query. Heaviest; defer unless heterogeneity causes user-visible recall failures.

Surface this question at `/gsd:discuss-phase 5`.

## What to Avoid

- **Don't ship vector-only `recall()`.** Spike 003 empirically invalidates it for Engram's semantics. Top cross-bucket cosine (0.8251) > intra-bucket mean (0.6472). Hybrid ranking is required.
- **Don't create per-workspace Vectorize indexes.** ROADMAP AI-02 + spike 003 both confirm: one global index, namespace per workspace. The 100-index-per-account Cloudflare cap kills the managed-cloud model otherwise.
- **Don't trust the spike's exact weight values (0.15 / 0.20 / 0.15).** They're seeds. The AI-04 plan must tune them empirically on real corpus.
- **Don't skip `embedding_model` / `embedding_version` stamping.** The columns exist in Phase 2's first migration specifically because re-embedding is inevitable; not stamping creates a future migration nightmare.
- **Don't measure intra/inter cosine on the v0.1 corpus and call it done.** Spike 003's synthetic samples have known optimism bias. The real signal comes from Russell's job-search agent corpus once it lands in Engram (post-DEP-04).

## Constraints

- **`@cf/baai/bge-base-en-v1.5` outputs 768-dim cosine-normalized vectors.** Workers AI returns `{ shape: [N, 768], data: number[][] }` — vectors are pre-normalized, no client-side normalization needed.
- **Vectorize index lock-in is permanent.** The `engram-memories` index will be created with `--preset=@cf/baai/bge-base-en-v1.5` (per AI-01). Cannot be changed without recreating + re-embedding all data. Treat as irreversible.
- **Single batched embedding call is the right pattern.** ~900ms for 30 samples in spike 003 vs ~6-15s sequential. For bulk re-embed migrations (Phase 5+), batch up to ~50-100 samples per call.
- **Workers AI cost:** ~$0.0001-0.0005 per embedding call. Cheaper per call than text generation by ~10x. Negligible for single-user v0.1; relevant for v1.0 managed-cloud at scale.
- **Vectorize namespace filter is workspace_id (string).** Combined with `metadata.type` $in filter (Phase 5), this is the two-layer isolation Engram needs.
- **Synthetic-sample optimism bias:** the 0.0696 Δ measured here is likely an upper bound — real-world Δ on Russell's heterogeneous corpus will be smaller. Hybrid ranking weights may need rebalancing once real data lands.

## Origin

Synthesized from spike: 003 (embedding-sensibility).
Source files preserved in: `sources/003-embedding-sensibility/`.

Headline numbers (synthetic, recalibrated gates):

- Intra-bucket mean cosine: 0.6472 (n=135 pairs)
- Inter-bucket mean cosine: 0.5776 (n=300 pairs)
- Δ = 0.0696 (PASS gate ≥ 0.10; BORDERLINE 0.05-0.10; ⚠ this run is BORDERLINE)
- IQR overlap: yes (inter.p75=0.6095 > intra.p25=0.6025)
- Top cross-bucket pair: 0.8251 (`dl-01` Engram-DO decision vs `rn-09` Engram-DO research note)
- Per-bucket cluster tightness: job_application (0.6816) > decision_log (0.6442) > research_note (0.6159)

Phase 5 ROADMAP requirements impacted: AI-01 (index creation — unchanged), AI-02 (namespaces — confirmed mandatory), AI-04 (semantic recall — gain hybrid ranking + type filter), AI-06 (memorability scoring — independent of this finding).
