# Phase 3: Query Expansion + Reranker - Research

**Researched:** 2026-06-08
**Domain:** Cloudflare Workers AI (bge-reranker + LLM query rewriting), Reciprocal Rank Fusion, recall() latency engineering, eval-harness reuse
**Confidence:** HIGH (external API contracts verified via Context7 + official docs; codebase patterns read directly from source)

## Summary

Phase 3 activates the multi-query-expansion → RRF-merge → bge-reranker rerank path inside `recall()`. Almost every locked decision (model IDs, file paths, thresholds, weights, gate values) is already pinned by the ROADMAP success criteria and REQUIREMENTS.md; this research deliberately does **not** re-derive those. It focuses on the three genuinely uncertain / external-dependency areas: the exact `@cf/baai/bge-reranker-base` I/O contract on Workers AI, the canonical RRF formula with reference vectors for unit testing, and how the adaptive-routing + similarity-gate + variant-cap latency model composes to stay inside the EXP-11 budget (p50 ≤ 1.8s, p99 ≤ 3s).

The single biggest finding: **the bge-reranker response is `{ response: [{ id, score }] }` where `id` is the integer index into the request `contexts[]` array — NOT a memory ID, and the array is reordered by score**. Every integration touchpoint must map `id` back to the original RRF-merged candidate list. There is also a live workerd bug (cloudflare/workerd#5998, opened 2026-12-27, still open) where `wrangler types` omits the required `query` field from the generated `Ai_Cf_Baai_Bge_Reranker_Base_Input` type — the runtime accepts `query`, but the TS types don't, so the call must be made through a cast or a hand-written interface (the codebase already has the `safeRun(env, model, body): Promise<AiBindingResponse>` escape hatch that sidesteps this entirely).

The codebase is exceptionally well-prepared for this phase. `safeRun` already implements the dual-path 429 detection EXP-06/EXP-10 require. The zod-gated structured-output pattern (`z.toJSONSchema` → `sanitizeJsonSchemaForWorkersAI` → `response_format.json_schema` → `safeParse` runtime gate) is proven in `triage-worker/src/extract.ts` and is the exact template for EXP-01's expansion prompt. The `recall-ranking.eval.test.ts` harness already pre-resolves queries once, runs a pure-math inner loop, and enforces an F1/precision gate against the labeled corpus — EXP-07's weight ablation is a near-clone of it. `HYBRID_WEIGHTS.rerank` was already renamed from `cosine` in Phase 2 (D-05), so EXP-05 is partially done — only `RERANKER_MODEL` is new in `ai-config`.

**Primary recommendation:** Build `query-expansion.ts` and `rrf.ts` as pure/near-pure modules first (both are unit-testable without AI creds), wire bge-reranker through `safeRun` with a hand-typed input interface to dodge workerd#5998, and clone the `recall-ranking.eval.test.ts` pre-resolve-once pattern for both the EXP-07 weight ablation and the EXP-08 A/B eval. Keep the reranker score as the `rerank` component feeding the existing `hybridRank` formula unchanged — Phase 3 changes *what* feeds `rerank`, not the formula.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Query expansion (1 query → 2 paraphrases) | API / Backend (mcp-server, CF Workers AI) | — | "If CF AI can do it, it must not be done by Claude" (CLAUDE.md). Query rewriting is a CF AI task per AI-SPEC §"Query expansion: MCP Server". |
| Variant similarity gate (cosine ≥ 0.85) | API / Backend (mcp-server) | CF Workers AI (embeddings) | Pure cosine math on `EMBEDDING_MODEL` vectors; reuses the existing recall embed path. |
| Adaptive routing (single-query first, fan-out if top1<0.65) | API / Backend (mcp-server `recall()`) | — | Pure control-flow decision in the handler; no new tier. |
| RRF merge | API / Backend (mcp-server `rrf.ts`) | — | Pure deterministic transform — no IO, no AI. Mirrors `hybrid-rank.ts` purity discipline. |
| bge-reranker scoring | CF Workers AI (`@cf/baai/bge-reranker-base`) | API / Backend (mcp-server invokes via `safeRun`) | Cross-encoder relevance scoring is a model task; the Worker orchestrates + maps `id`→candidate. |
| Hybrid rank (rerank·w + recency·w + …) | API / Backend (mcp-server `hybrid-rank.ts`) | — | Existing pure transform; Phase 3 only swaps the `rerank` input source. |
| 429 fallback / retry envelope | API / Backend (mcp-server `safeRun` + handler catch) | — | Already implemented; Phase 3 reuses `RateLimitError` origin-tagging. |
| Weight ablation + A/B eval | Test tier (vitest eval project, CF creds) | CF Workers AI + Vectorize | Reuses the `eval` vitest project + `eval-budget.setup.ts` MAX_AI_CALLS=200 counter. |

## Standard Stack

### Core
| Library / Model | Version / ID | Purpose | Why Standard |
|---------|------|---------|--------------|
| `@cf/baai/bge-reranker-base` | Workers AI catalog (current) | Cross-encoder reranking of RRF-merged candidates (EXP-05/06) | The only Workers AI native reranker; `[VERIFIED: developers.cloudflare.com/workers-ai/models/bge-reranker-base]` |
| `@cf/meta/llama-4-scout-17b-16e-instruct` (alias `QUERY_EXPANSION_MODEL`) | Workers AI catalog (current) | Query expansion rewriter (EXP-01, EXP-08 default) | Already the project's locked classifier; stays aliased per EXP-08 / D-2 `[VERIFIED: shared/ai-config/src/index.ts]` |
| `@cf/meta/llama-3.2-3b-instruct` | Workers AI catalog (current) | EXP-08 A/B challenger vs Scout for expansion | Smaller/faster; promotion gated on recall@5 within 5pp `[VERIFIED: developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct]` |
| `@cf/qwen/qwen3-embedding-0.6b` (`EMBEDDING_MODEL`) | Workers AI catalog (current) | Variant similarity gate cosine (EXP-02) | Already the recall embedding model; same vector space `[VERIFIED: shared/ai-config/src/index.ts]` |
| `zod` | already a dependency | Structured-output gate for the expansion prompt (EXP-01) | Existing pattern in `triage-worker/src/schemas.ts` `[VERIFIED: package.json]` |

### Supporting (existing — reuse, do not re-add)
| Module | Purpose | When to Use |
|---------|---------|-------------|
| `safeRun(env, model, body)` (`mcp-server/src/ai-helper.ts`) | env.AI.run wrapper with dual-path 429 → `RateLimitError` | Every AI call in this phase (expansion, reranker) — EXP-06/EXP-10 fallback |
| `vectorizeQuery(env, wsId, vec, opts)` (`@engram/vectorize-utils`) | Namespace-isolated Vectorize query | Each variant's vector search in the fan-out (EXP-03) |
| `hybridRank(matches, blocks, args, now, weights?)` (`mcp-server/src/hybrid-rank.ts`) | Combined-score rank; `weights.rerank * match.score + …` | Unchanged formula; Phase 3 swaps the `match.score` source to reranker score |
| `sanitizeJsonSchemaForWorkersAI` (`@engram/ai-config`) | Strips `propertyNames` etc. that trip Scout's JSON-mode validator (error 3030) | When deriving the expansion `response_format.json_schema` |
| `eval-budget.setup.ts` (MAX_AI_CALLS=200) | Shared AI+Vectorize call counter for eval project | Wraps EXP-07 / EXP-08 evals automatically |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bge-reranker-base | Skip reranker, keep raw cosine | This IS the EXP-07 fallback (`HYBRID_WEIGHTS.rerank = 0.0`) if it doesn't beat cosine by ≥3% precision@5. The constant lands regardless. |
| RRF merge | Score-normalized weighted merge (e.g., min-max then weighted sum) | RRF is rank-based (immune to score-scale differences across variants) and is the EXP-04-locked choice; reference vectors exist for unit testing. Do NOT switch. |
| Scout for expansion | llama-3.2-3b-instruct | This IS the EXP-08 A/B — challenger, not default. Promotion is a follow-on PR, out of Phase 3 scope. |
| HyDE (hypothetical doc expansion) | — | **Explicitly forbidden (EXP-09).** All prior research converged on no-HyDE; eval has an anti-HyDE assertion. |

**Installation:** None. Phase 3 adds **zero npm packages** — only two new model-ID string constants in `shared/ai-config/src/index.ts` (`RERANKER_MODEL`, and optionally an `EXPANSION_CHALLENGER_MODEL` for the A/B). `zod` is already a dependency.

**Version verification:**
- `@cf/baai/bge-reranker-base` — confirmed present in the live Workers AI catalog `[VERIFIED: developers.cloudflare.com/workers-ai/models/bge-reranker-base, fetched 2026-06-08]`
- `@cf/meta/llama-3.2-3b-instruct` — confirmed present `[VERIFIED: developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct, fetched 2026-06-08]`

## Package Legitimacy Audit

Phase 3 installs **no external packages**. The two new identifiers are Cloudflare Workers AI model strings consumed via `env.AI.run(...)`, not npm/PyPI packages. There is no registry-install surface and therefore no slopcheck applicable.

| "Package" | Registry | Disposition |
|-----------|----------|-------------|
| `@cf/baai/bge-reranker-base` | Workers AI model catalog (not npm) | Approved — verified on official catalog |
| `@cf/meta/llama-3.2-3b-instruct` | Workers AI model catalog (not npm) | Approved — verified on official catalog |
| `zod` | npm | Already a project dependency (no new install) |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
recall(query, …)
   │
   ▼
[1] embed(query) ──► queryVector  (safeRun, EMBEDDING_MODEL)   ← EXISTING path
   │
   ▼
[2] SINGLE-QUERY PASS: vectorizeQuery(queryVector) ──► matches
   │
   ├── top1_cosine = matches[0].score
   │
   ▼
[3] ADAPTIVE GATE (EXP-03):  top1_cosine ≥ 0.65 ?
   │                              │
   │ YES → skip fan-out           │ NO → fan-out
   │ (use single-query matches)   ▼
   │                         [4] expandQuery(env, query)  (safeRun, QUERY_EXPANSION_MODEL, zod-gated)
   │                              │  ──► [original, p1, p2]   (EXP-01; original = variant[0])
   │                              ▼
   │                         [5] SIMILARITY GATE (EXP-02): keep pi iff cosine(orig, pi) ≥ 0.85
   │                              │      (embed each paraphrase, drop failures silently)
   │                              ▼
   │                         [6] FAN-OUT: vectorizeQuery() per surviving variant ──► list[]
   │                              ▼
   │                         [7] reciprocalRankFusion(list[], k=60)  (rrf.ts — PURE)  ← EXP-04
   │                              │  ──► merged candidate ID list, RRF-ordered
   ▼                              ▼
   └──────────────►  [8] mergedCandidates  ◄──────────────────────┘
                          │
                          ▼
                     [9] bge-reranker (safeRun, RERANKER_MODEL)        ← EXP-06
                          │  input:  { query, contexts: [{text: candidate.content}] }
                          │  output: { response: [{ id: <origIndex>, score }] }
                          │  ON FAILURE (429/error) → fall back to raw cosine (safeRun discipline)
                          ▼
                     [10] map reranker.id → candidate; reranker.score replaces match.score
                          ▼
                     [11] hybridRank(rerankedMatches, blocks, args, now)  ← UNCHANGED formula
                          │  _score = w.rerank·rerankScore + w.recency·… + …
                          ▼
                     [12] CON-05 conflict hydration (EXISTING, after hybridRank)
                          ▼
                     [13] buildRecallResponse(...)  → envelope
                          │  meta.gaps += "query expansion unavailable" on EXP-10 fallback
                          ▼
                        result
```

### Recommended Module Structure
```text
packages/mcp-server/src/
├── query-expansion.ts   # NEW (EXP-01): expandQuery(env, query): Promise<string[]>
│                        #   + zod schema + response_format.json_schema + safeParse gate
│                        #   + anti-HyDE prompt (EXP-09)
├── rrf.ts               # NEW (EXP-04): reciprocalRankFusion(lists, k=60) — PURE transform
├── hybrid-rank.ts       # MODIFY (EXP-06): rerank input becomes reranker score (formula unchanged)
├── tools.ts             # MODIFY (EXP-03/06/10): adaptive routing + reranker call + fallback in recall()
└── __tests__/
    ├── rrf.test.ts                        # NEW: pure unit tests vs Elasticsearch/AI21 reference vectors
    ├── query-expansion.test.ts            # NEW: zod gate, [original,...] shape, anti-HyDE (no creds)
    └── evals/
        ├── query-expansion-recall.eval.test.ts  # NEW (EXP-08): Scout vs llama-3.2-3b A/B + EXP-09/EXP-12 assertions
        └── recall-ranking.eval.test.ts          # CLONE pattern for EXP-07 reranker weight ablation

shared/ai-config/src/index.ts   # MODIFY (EXP-05): add RERANKER_MODEL = "@cf/baai/bge-reranker-base"
                                #   (HYBRID_WEIGHTS.cosine→rerank already done in Phase 2 D-05)
```

### Pattern 1: bge-reranker invocation via safeRun (EXP-06)
**What:** Call the reranker, then map the score-ordered `response[].id` back to your candidate list by original index.
**When to use:** Step [9]–[10] above, between RRF merge and `hybridRank`.
**Critical:** The response `id` is the **integer index into the request `contexts` array**, not a memory ID. The array is reordered by descending score. You MUST keep your candidate array index-aligned with the `contexts` you send.

```typescript
// Source: developers.cloudflare.com/workers-ai/models/bge-reranker-base
//         + Context7 /llmstxt/developers_cloudflare_workers-ai (response schema)
// candidates: the RRF-merged, deduped list of hydrated blocks (index-aligned with contexts).
const contexts = candidates.map((c) => ({ text: c.content ?? c.summary ?? "" }));

let rerankScores = new Map<string, number>(); // memoryId -> reranker score
try {
  // safeRun gives dual-path 429 → RateLimitError; body is Record<string,unknown>
  // so the workerd#5998 missing-`query`-field type bug does NOT block us here.
  const resp = await safeRun(env, RERANKER_MODEL, { query: originalQuery, contexts });
  // Response shape: { response: [{ id: number /* index into contexts */, score: number }] }
  const ranked = (resp as { response?: { id: number; score: number }[] }).response ?? [];
  for (const r of ranked) {
    const cand = candidates[r.id];           // id is the ORIGINAL contexts index
    if (cand !== undefined) rerankScores.set(cand.id, r.score);
  }
} catch (err) {
  // EXP-06 fallback: reranker failure (429/error) → use raw cosine, do NOT crash recall.
  // Leave rerankScores empty; downstream falls back to match.score per the default below.
  console.warn("recall:EXP-06:reranker-failed", { err });
}

// Feed hybridRank: rerank component = reranker score when present, else raw cosine.
const rerankedMatches = mergedMatches.map((m) => ({
  ...m,
  score: rerankScores.get(m.id) ?? m.score, // defensive default = raw cosine (safeRun discipline)
}));
const ranked = hybridRank(rerankedMatches, blocks, args, Date.now());
```

**Score-scale note:** bge-reranker raw scores are **logits**, mappable to [0,1] via sigmoid. The Phase 2 weight sweep tuned `HYBRID_WEIGHTS.rerank` against **raw cosine in [0,1]**. If reranker logits are passed unmapped, they live on a different scale and the tuned weight is meaningless. **Apply sigmoid `1/(1+e^-x)` to each reranker score before it enters `hybridRank`** so it occupies the same [0,1] range the weight was tuned against. The EXP-07 ablation re-tunes against the reranker source regardless, but sigmoid-normalizing keeps the comparison apples-to-apples. `[CITED: developers.cloudflare.com/workers-ai/models/bge-reranker-base — "mapped to a float value in [0,1] by sigmoid function"]`

### Pattern 2: Reciprocal Rank Fusion — pure transform (EXP-04)
**What:** `score(d) = Σ_lists 1/(k + rank_in_list(d))`, k=60, rank is 1-indexed, sum only over lists where d appears.
**When to use:** Step [7], merging the per-variant Vectorize result lists into one ordered candidate list.

```typescript
// Source: Elastic RRF docs (rank_constant default 60) + Cormack-Clarke-Büttcher 2009.
// Pure, deterministic, no IO. Unit-testable without creds (EXP-04).
export function reciprocalRankFusion<T extends { id: string }>(
  lists: T[][],
  k = 60,
): { id: string; rrfScore: number; item: T }[] {
  const scores = new Map<string, { rrfScore: number; item: T }>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const rank = idx + 1;                 // 1-indexed
      const contribution = 1 / (k + rank);
      const prev = scores.get(item.id);
      if (prev) prev.rrfScore += contribution;
      else scores.set(item.id, { rrfScore: contribution, item });
    });
  }
  return [...scores.entries()]
    .map(([id, v]) => ({ id, rrfScore: v.rrfScore, item: v.item }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}
```

**Reference vectors for unit tests (k=60 unless noted):**

*Elasticsearch worked example (rank_constant = 1, two retrievers BM25 + kNN):* `[CITED: elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion]`
```
doc 1: 1/(1+4) + 1/(1+3) = 0.4500
doc 2: 1/(1+3) + 1/(1+2) = 0.5833
doc 3: 1/(1+2) + 1/(1+1) = 0.8333   ← winner
doc 4: 1/(1+1)           = 0.5000
doc 5:           1/(1+4) = 0.2000
```
*Standard k=60 example (two lists, docs D1/D2/D3):* `[CITED: bigdataboutique.com RRF explainer, cross-checked against formula]`
```
D1 ranks (1, 2): 1/61 + 1/62 ≈ 0.03226   ← winner
D2 ranks (2, 4): 1/62 + 1/64 ≈ 0.03200
D3 ranks (3, 1): 1/63 + 1/61 ≈ 0.03226   (ties D1 to ~5 d.p.; tiebreak by insertion order)
```
Use the Elasticsearch k=1 vectors as the primary unit-test fixture (larger, more distinguishable score gaps), and at least one k=60 case to lock the default constant. Both are reproducible by hand — exact, not approximate.

### Pattern 3: Zod-gated query expansion prompt (EXP-01, EXP-09, EXP-12)
**What:** Mirror `triage-worker/src/extract.ts` exactly — `response_format.json_schema` derived from a zod schema via `z.toJSONSchema` → `sanitizeJsonSchemaForWorkersAI`, then `safeParse` the response as the runtime gate.
**When to use:** `query-expansion.ts`.

```typescript
// Source: packages/triage-worker/src/{schemas,extract}.ts (proven Phase 5/6 pattern)
import { z } from "zod";
import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";

export const ExpansionOutput = z.object({
  // EXACTLY 2 paraphrases — variant cap defense (QE-1). The original is prepended
  // by the caller, NOT requested from the model, so the model can never drop the anchor.
  paraphrases: z.array(z.string().min(1).max(400)).length(2),
});
export type ExpansionOutput = z.infer<typeof ExpansionOutput>;

export const EXPANSION_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(ExpansionOutput);
  void $schema;
  return sanitizeJsonSchemaForWorkersAI(schema);
})();

// Anti-HyDE (EXP-09) + entity-preservation (EXP-12) live in the system prompt:
export const EXPANSION_SYSTEM_PROMPT =
  "You rewrite a search query into 2 alternative phrasings that preserve the user's intent. " +
  "RULES: (1) Each rewrite MUST be a real search query, NOT a hypothetical answer or fabricated " +
  "document — never invent facts (NO HyDE). (2) Preserve every named entity (people, companies, " +
  "products, dates) from the original query verbatim in BOTH rewrites. (3) Vary phrasing/synonyms " +
  "only — do not change the subject. Return JSON: { \"paraphrases\": [\"...\", \"...\"] }.";

export async function expandQuery(env: { AI: Ai }, originalQuery: string): Promise<string[]> {
  try {
    const resp = await safeRun(env, QUERY_EXPANSION_MODEL, {
      messages: [
        { role: "system", content: EXPANSION_SYSTEM_PROMPT },
        { role: "user", content: originalQuery },
      ],
      response_format: { type: "json_schema", json_schema: EXPANSION_JSON_SCHEMA },
      temperature: 0.4,
      max_tokens: 256,
    });
    const candidate = typeof resp.response === "string"
      ? JSON.parse(resp.response)
      : resp.response;
    const parsed = ExpansionOutput.safeParse(candidate);
    if (!parsed.success) return [originalQuery];           // gate failure → degrade to single query
    return [originalQuery, ...parsed.data.paraphrases];     // EXP-01: original is variant[0]
  } catch (err) {
    // EXP-10: 429 / persistent failure → single-query fallback. Caller adds meta.gaps note.
    throw err; // let recall()'s catch decide; or return [originalQuery] if you prefer silent degrade
  }
}
```

### Anti-Patterns to Avoid
- **Treating reranker `id` as a memory ID.** It is the index into the `contexts[]` you sent. Index-align or you corrupt results silently.
- **Feeding raw reranker logits into the tuned `rerank` weight.** Sigmoid-normalize to [0,1] first (Pattern 1 note).
- **Requesting the original query back from the expansion model.** Prepend it in code (EXP-01 anchor) so the model physically cannot drop or mutate it (QE-7).
- **Asking the model for "3-4 variants."** Spec is exactly 2 paraphrases + original = 3 total (EXP-01). The `.length(2)` zod constraint enforces it.
- **Running the fan-out unconditionally.** Adaptive gate (EXP-03) is the cost defense — single-query first, fan-out only when `top1_cosine < 0.65`.
- **Changing the `hybridRank` formula.** Phase 3 changes the *input* to the `rerank` component, not the formula. Touching the formula re-opens the Phase 2 sweep.
- **Adding a second Vectorize topK fetch for the reranker.** Rerank the already-fetched RRF-merged candidates; do not re-query Vectorize.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-encoder relevance scoring | A custom similarity heuristic | `@cf/baai/bge-reranker-base` | Native, GPU-backed, [0,1]-mappable; the whole point of EXP-05/06 |
| 429 detection + retry envelope | New try/catch around env.AI.run | `safeRun` + `RateLimitError` (`ai-helper.ts`) | Dual-path detection (binding-envelope code 7501 AND thrown AiError) already implemented |
| Structured-output validation | Manual JSON.parse + field checks | `z.toJSONSchema` → `sanitizeJsonSchemaForWorkersAI` → `safeParse` | Proven in `extract.ts`; handles Scout's 3030 `propertyNames` rejection |
| Namespace-isolated vector query | Direct `env.VECTORIZE.query` | `vectorizeQuery(env, wsId, …)` | AI-02 tenant isolation + 64-byte guard; a CI grep gate BANS direct access |
| Rank-list merge | Score-normalized weighted sum | `reciprocalRankFusion` (rrf.ts) | RRF is scale-invariant across variants and has reference vectors for testing |
| Eval AI-call budgeting | Ad-hoc call counting | `eval-budget.setup.ts` (MAX_AI_CALLS=200) | Shared counter wraps env.AI.run + env.VECTORIZE.query; throws on overrun |
| Precision@K / F1 / MRR metrics | New metric code | `computeF1`/`computeMRR`/`computeTop1` in `recall-ranking.eval.test.ts` | Already written, tested, and corpus-validated |

**Key insight:** The codebase already solved every hard sub-problem in this phase during Phases 2/5/6 (safeRun, zod-gate, vectorizeQuery isolation, eval budget, metric functions, the `rerank` rename). Phase 3 is overwhelmingly *composition + two pure modules*, not new infrastructure.

## Common Pitfalls

### Pitfall 1: workerd#5998 — missing `query` field in generated reranker types
**What goes wrong:** `wrangler types` generates `Ai_Cf_Baai_Bge_Reranker_Base_Input` WITHOUT the required `query` field. TS rejects `env.AI.run("@cf/baai/bge-reranker-base", { query, contexts })` even though the runtime accepts it.
**Why it happens:** Schema-to-types generation bug, opened 2026-12-27, still open (assignees MattieTK, lrapoport-cf). `[VERIFIED: github.com/cloudflare/workerd/issues/5998]`
**How to avoid:** Call through `safeRun(env, RERANKER_MODEL, body)` — its `body: Record<string, unknown>` signature sidesteps the typed overload entirely. If you need the typed binding directly, define a hand-written `BgeRerankerInput` interface and cast.
**Warning signs:** A TS error like `Object literal may only specify known properties, and 'query' does not exist in type Ai_Cf_Baai_Bge_Reranker_Base_Input`.

### Pitfall 2: Reranker score scale mismatch vs tuned weight
**What goes wrong:** Reranker emits logits (can be negative, unbounded); the tuned `HYBRID_WEIGHTS.rerank` (0.6) was fit against raw cosine in [0,1]. Passing logits unmapped makes the rank formula behave unpredictably.
**Why it happens:** "reranker-score replaces raw cosine" (EXP-06) is read literally without normalizing scale.
**How to avoid:** Sigmoid-map each reranker score to [0,1] before it enters `hybridRank`. The EXP-07 ablation then re-validates the weight against this normalized source.
**Warning signs:** Ablation shows reranker dramatically worse than cosine, or top-1 ordering dominated entirely by the rerank component regardless of recency/type.

### Pitfall 3: Latency stacking blows the EXP-11 budget (QE-5)
**What goes wrong:** expansion call (~300–600ms) + N-way fan-out (parallel, ~150–300ms) + reranker call (~150–400ms) stack on top of the existing single-query path and exceed p50 ≤ 1.8s / p99 ≤ 3s.
**Why it happens:** The fan-out path adds two extra AI calls + N Vectorize calls. If it fires on every query, p50 balloons.
**How to avoid:** The layered defenses ARE the budget model — (a) adaptive routing means most queries with a good top-1 (≥0.65) never pay expansion cost at all; (b) fan-out Vectorize calls run in parallel (`Promise.all`); (c) reranker scores the already-fetched candidates (no extra Vectorize round-trip). If the ablation shows over-budget, the prescribed lever is **tightening the adaptive threshold 0.65 → 0.70** (more queries skip fan-out), NOT removing the feature (ROADMAP QE-5 note).
**Warning signs:** EXP-11 latency assertion fails; analytics show fan-out firing on > ~40% of queries.

### Pitfall 4: Variant drift collapses precision (QE-2)
**What goes wrong:** The rewriter produces paraphrases that semantically wander, pulling in off-topic Vectorize matches that RRF then promotes.
**Why it happens:** Temperature too high, or the similarity gate is removed/loosened.
**How to avoid:** The 0.85 cosine gate (EXP-02) + original-as-variant[0] anchor (EXP-01) are non-negotiable. Drop any paraphrase below 0.85 silently. Keep temperature modest (~0.4).
**Warning signs:** EXP-12 entity-preservation < 80%, or recall@5 with expansion < single-query baseline.

### Pitfall 5: HyDE regression (QE-3)
**What goes wrong:** A future prompt edit nudges the model toward generating a hypothetical answer/document instead of a query rewrite — fabricating facts that contaminate retrieval.
**Why it happens:** Prompt drift; "expand the query" misinterpreted as "answer the query."
**How to avoid:** Explicit anti-HyDE rule in the system prompt (Pattern 3) PLUS an eval assertion (EXP-09) that checks variants don't contain fabricated claims / look like answers.
**Warning signs:** Variants are declarative sentences/answers rather than search phrasings; eval anti-HyDE assertion fails.

### Pitfall 6: Empty / whitespace contexts to the reranker
**What goes wrong:** A candidate with null `content` and null `summary` yields `{ text: "" }`, which violates the reranker's `text` min-length 1 and can error the whole call.
**Why it happens:** Orphan/cold-storage rows or summary-only blocks.
**How to avoid:** Filter candidates to those with non-empty `content ?? summary` before building `contexts`; if a candidate has neither, exclude it from reranking and let it keep its raw cosine.
**Warning signs:** Reranker call throws on otherwise-valid recalls; `safeRun` surfaces a non-429 error.

## Code Examples

### Adaptive routing decision in recall() (EXP-03)
```typescript
// Source: composed from recall handler (tools.ts ~550-597) + EXP-03 spec
const ADAPTIVE_TOP1_THRESHOLD = 0.65; // EXP-03; lever for QE-5 (raise to 0.70 if over budget)
const single = await vectorizeQuery(env, props.workspace_id, queryVector, {
  topK: fetchSize,
  ...(args.types?.length ? { filter: { type: { $in: args.types } } } : {}),
  returnMetadata: "all",
});
const top1 = single.matches[0]?.score ?? 0;

let mergedMatches = single.matches;
let expansionUnavailable = false;
if (top1 < ADAPTIVE_TOP1_THRESHOLD) {
  try {
    const variants = await expandQuery(env, queryForEmbed);          // [orig, p1, p2]
    const kept = await keepVariantsAboveGate(env, queryVector, variants, 0.85); // EXP-02
    const lists = await Promise.all(                                  // parallel fan-out
      kept.map(async (v) => {
        const vec = (await safeRun(env, EMBEDDING_MODEL, { text: [v] })).data?.[0];
        const r = await vectorizeQuery(env, props.workspace_id, vec!, { topK: fetchSize, returnMetadata: "all" });
        return r.matches;
      }),
    );
    mergedMatches = reciprocalRankFusion(lists).map((x) => x.item);   // EXP-04
  } catch {
    expansionUnavailable = true;                                      // EXP-10
    mergedMatches = single.matches;                                   // v0.1 single-query fallback
  }
}
// … reranker (Pattern 1) → hybridRank → CON-05 → envelope …
// EXP-10: if (expansionUnavailable) append meta.gaps "query expansion unavailable"
```

### EXP-12 entity-preservation metric (eval)
```typescript
// Capitalized-token heuristic for named entities (people/companies/products/dates).
function namedEntities(q: string): string[] {
  return [...new Set((q.match(/\b[A-Z][a-zA-Z0-9.&-]+\b/g) ?? []))];
}
function entityPreservationRate(original: string, variants: string[]): number {
  const ents = namedEntities(original);
  if (ents.length === 0) return 1; // vacuously satisfied
  const present = ents.filter((e) => variants.some((v) => v.includes(e)));
  return present.length / ents.length; // EXP-12 gate: > 0.80 averaged across corpus
}
```

## Runtime State Inventory

Phase 3 is a **code + config change** (new modules, model-ID constants, recall-handler edits). It does NOT rename or migrate any stored data, live-service config, OS state, secrets, or build artifacts.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema change; reranker/RRF operate on already-stored vectors + blocks. Vectorize index + SQLite untouched. | none |
| Live service config | None — `RERANKER_MODEL` is a source constant in `ai-config`, not a deployed service config. No wrangler binding change (the `AI` binding already exists). | none |
| OS-registered state | None — verified: no Task Scheduler / pm2 / cron entries reference query-expansion or reranking. | none |
| Secrets/env vars | None — uses the existing `AI` + `VECTORIZE` bindings and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` eval creds. No new secret. | none |
| Build artifacts | None — pure TS additions; no package rename, no egg-info / compiled-binary analog. | none |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-query Vectorize search, raw cosine as `rerank` input | Adaptive multi-query + RRF + bge-reranker cross-encoder | This phase (EXP-01..06) | Largest user-facing latency change in v0.2; gated by ablation + adaptive routing |
| `HYBRID_WEIGHTS.cosine` | `HYBRID_WEIGHTS.rerank` | Phase 2 (D-05) — **already done** | EXP-05's rename is complete; only `RERANKER_MODEL` constant is new |
| `zod-to-json-schema@3.x` (silently returned `{}` with zod@4) | native `z.toJSONSchema()` | ENG-21 fix | Use `z.toJSONSchema` for the expansion schema — do NOT reintroduce the third-party converter |

**Deprecated/outdated:**
- HyDE-style expansion — explicitly out of scope (EXP-09), never implement.
- Score-normalized weighted merge — superseded by RRF for the variant-merge step.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | bge-reranker raw scores are logits requiring sigmoid → [0,1] before entering the tuned `rerank` weight | Pattern 1, Pitfall 2 | If scores are already [0,1], sigmoid double-compresses; mitigated because EXP-07 re-tunes the weight against the actual reranker source regardless. Verify empirically in the ablation. |
| A2 | Per-stage latency estimates (expansion ~300–600ms, reranker ~150–400ms, fan-out Vectorize ~150–300ms parallel) | Pitfall 3 | Cloudflare publishes no official per-model latency for bge-reranker; numbers are order-of-magnitude from comparable Workers AI calls. The EXP-11 assertion measures real latency — treat these as planning estimates only, not gates. |
| A3 | No documented hard cap on `contexts[]` count per reranker call (embedding batch cap is 100; reranker unspecified) | Standard Stack | If a low cap exists, a large RRF-merged candidate set could error. Mitigation: rerank only the top-N merged candidates (e.g., topK=25 the recall already caps to) — well under any plausible cap. |
| A4 | The eval-budget MAX_AI_CALLS=200 counter is sufficient for EXP-07 + EXP-08 if run in **separate sessions** (each ~100-query pre-resolve) | Validation Architecture | The Phase 2 `recall-ranking.eval` already hit the cap with one 100-query sweep; running two evals together would exceed 200. Plans must run EXP-07 and EXP-08 in separate vitest sessions (the existing harness already documents this constraint). |
| A5 | Capitalized-token regex is an adequate named-entity proxy for EXP-12 | Code Examples | Misses lowercase entities / multi-word names; acceptable for a >80% aggregate gate but may need a small curated entity list per corpus query if it proves noisy. |

## Open Questions (RESOLVED)

1. **Does bge-reranker enforce a max `contexts[]` length?**
   - What we know: embedding batch cap is 100; reranker docs specify no cap.
   - What's unclear: whether sending 25–50 contexts is safe (almost certainly yes).
   - Recommendation: rerank only the recall topK (≤25 after MIN_COSINE_THRESHOLD) — stays well under any plausible limit. Confirm in the first eval run.
   - **RESOLVED:** rerank topK ≤ 25 (post-MIN_COSINE_THRESHOLD); 03-04 caps accordingly and confirms the raw range in the first live eval run.

2. **Exact reranker score range (logit vs already-sigmoid)?**
   - What we know: docs say scores are "mapped to [0,1] by sigmoid," implying raw output is pre-sigmoid logit.
   - What's unclear: whether `env.AI.run` returns the logit or the sigmoid-mapped value.
   - Recommendation: log raw reranker scores in the EXP-07 ablation's first run; if any are <0 or >1, apply sigmoid. The ablation tunes the weight either way.
   - **RESOLVED:** 03-03 applies sigmoid normalization unconditionally (idempotent on already-[0,1] values is not assumed — sigmoid is applied to the raw model output before hybridRank); 03-04 Task 2 logs the raw score range on the first live run to confirm.

3. **Where does precision@5 get measured for EXP-07 (the spec says precision@5, the Phase 2 harness computes F1@3)?**
   - What we know: `recall-ranking.eval.test.ts` has `computeF1` (precision@3 ∩ recall@3) and the corpus has `expected_top_3_block_ids`.
   - What's unclear: EXP-07 says "precision@5" but the corpus labels top-3. precision@5 against a top-3 gold set caps at 0.6.
   - Recommendation: either (a) compute precision@3 to match the existing labels and adjust the EXP-07 gate wording, or (b) extend corpus labels to top-5. Flag to the planner — this is a corpus-vs-metric mismatch that needs a decision before the ablation is written.
   - **RESOLVED by D-EXP07 (orchestrator decision, 2026-06-08):** option (a) — EXP-07 is measured with **precision@3 / F1@3** reusing the existing `computeF1` harness; ship `HYBRID_WEIGHTS.rerank = 0.0` if the reranker doesn't beat raw cosine by ≥3% on that metric. The metric substitution is documented in `docs/hybrid-rank-changelog.md` (03-04 Task 3). ROADMAP success criterion #7 and REQUIREMENTS EXP-07 updated to match.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Workers AI `AI` binding | expansion + reranker calls | ✓ (existing binding) | live | EXP-10 single-query fallback on 429 |
| `@cf/baai/bge-reranker-base` | EXP-05/06 | ✓ (catalog verified) | current | EXP-07 zero-weight ship if it doesn't beat cosine |
| `@cf/meta/llama-3.2-3b-instruct` | EXP-08 A/B | ✓ (catalog verified) | current | A/B only; Scout stays default |
| Vectorize `VECTORIZE` binding | fan-out queries | ✓ (existing) | — | adaptive routing skips fan-out |
| CF eval creds (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) | EXP-07/08 evals | conditional (CI/local with `wrangler login`) | — | eval project excluded when absent (clean skip) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** eval creds — without them the `eval` vitest project is excluded entirely (no silent failure), so EXP-07/08 run only where creds exist (nightly CI / local `wrangler login`). This matches the established Phase 2 pattern.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1+ with `@cloudflare/vitest-pool-workers` (workerd pool) + Node pool for lint/grep |
| Config file | `packages/mcp-server/vitest.config.ts` (3 projects: `workerd`, `lint-node`, `eval`) |
| Quick run command | `cd packages/mcp-server && npx vitest run rrf query-expansion` (pure unit tests, no creds) |
| Full suite command | `cd packages/mcp-server && npm test` (workerd + lint-node); evals via `npm run test:eval` with creds |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXP-01 | `expandQuery` returns `[original, p1, p2]`, original at [0], zod-gated | unit | `npx vitest run query-expansion` | ❌ Wave 0 |
| EXP-02 | paraphrase dropped if cosine(orig,p) < 0.85 | unit (mock embeds) | `npx vitest run query-expansion` | ❌ Wave 0 |
| EXP-03 | fan-out only fires when top1_cosine < 0.65 | unit (handler branch) | `npx vitest run recall` | ❌ Wave 0 |
| EXP-04 | `reciprocalRankFusion` matches Elasticsearch/AI21 reference vectors | unit (pure) | `npx vitest run rrf` | ❌ Wave 0 |
| EXP-05 | `RERANKER_MODEL` constant present; `HYBRID_WEIGHTS.rerank` exists | unit | `npx vitest run ai-config` | rename ✅ / constant ❌ |
| EXP-06 | reranker score replaces cosine; 429/error → raw-cosine fallback | unit (mock safeRun throw) | `npx vitest run recall` | ❌ Wave 0 |
| EXP-07 | reranker beats cosine by ≥3% precision@K on labeled corpus, else weight=0.0 | eval (creds) | `npm run test:eval -- reranker-ablation` | ❌ Wave 0 (clone recall-ranking.eval) |
| EXP-08 | Scout vs llama-3.2-3b recall@5 A/B | eval (creds) | `npm run test:eval -- query-expansion-recall` | ❌ Wave 0 |
| EXP-09 | variants contain no HyDE/fabricated-answer content | eval assertion | `npm run test:eval -- query-expansion-recall` | ❌ Wave 0 |
| EXP-10 | persistent 429 → single-query path + meta.gaps note | unit (mock RateLimitError) | `npx vitest run recall` | ❌ Wave 0 |
| EXP-11 | recall p50 ≤ 1.8s, p99 ≤ 3s with expansion ON | eval/latency (creds) | `npm run test:eval -- recall-latency` | ❌ Wave 0 |
| EXP-12 | >80% named entities preserved in ≥1 variant | eval assertion | `npm run test:eval -- query-expansion-recall` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run rrf query-expansion recall` (pure unit subset — fast, no creds)
- **Per wave merge:** `cd packages/mcp-server && npm test` (full workerd + lint-node)
- **Phase gate:** eval suite green under creds (`npm run test:eval`), run EXP-07 and EXP-08 in **separate sessions** (MAX_AI_CALLS=200 budget — A4), before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/rrf.ts` + `__tests__/rrf.test.ts` — EXP-04 (pure, reference-vector fixtures)
- [ ] `src/query-expansion.ts` + `__tests__/query-expansion.test.ts` — EXP-01/02/09 (zod gate, anchor, anti-HyDE)
- [ ] `__tests__/evals/reranker-ablation.eval.test.ts` — EXP-07 (clone `recall-ranking.eval.test.ts` pre-resolve-once + budget pattern)
- [ ] `__tests__/evals/query-expansion-recall.eval.test.ts` — EXP-08/09/12 (A/B + assertions)
- [ ] latency harness for EXP-11 (reuse `scripts/eval-budget-summary.mjs --*-p99` pattern from CON-07)
- [ ] `RERANKER_MODEL` constant + `hybrid-rank.ts` rerank-source edit (no new framework install — vitest already present)

## Security Domain

> `security_enforcement` not explicitly set in config — treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | recall() auth (JWT→workspace_id) unchanged; no new entry point |
| V3 Session Management | no | no session surface change |
| V4 Access Control | yes | Multi-tenant isolation: every fan-out Vectorize query MUST go through `vectorizeQuery(env, props.workspace_id, …)` — never `args`-derived. `workspace_id` always from `props` (MCP-05/MT-1). Phase 5 INT-03 will pentest expanded-query + reranker calls against foreign JWTs. |
| V5 Input Validation | yes | Expansion model output gated by zod `safeParse` (EXP-01); reranker `contexts.text` min-length 1 enforced by filtering empty candidates (Pitfall 6). |
| V6 Cryptography | no | no crypto in this phase |

### Known Threat Patterns for Workers AI + multi-tenant recall
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-workspace vector leak via fan-out query missing namespace | Information Disclosure | `vectorizeQuery` mandatory positional `workspaceId` from `props` (compile-time defense) + CI grep ban on direct `env.VECTORIZE` |
| Prompt injection through user query into expansion model | Tampering | Expansion output is zod-gated and only used as *search variants* (never executed/trusted as instructions); reranker scores are numeric only |
| 429 DoS silently dropping the expansion → degraded recall | Denial of Service | `safeRun` dual-path 429 → `RateLimitError`; EXP-10 explicit single-query fallback + meta.gaps note (no crash) |
| Reranker fabricates relevance on empty context | Tampering | Filter empty `content/summary` candidates before reranking (Pitfall 6) |

## Sources

### Primary (HIGH confidence)
- Context7 `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` — bge-reranker-base request/response schema (`{ response: [{ id, score }] }`, `id` = contexts index), TypeScript Worker example
- https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/ — input schema (query/contexts/top_k), sigmoid [0,1] mapping, pricing
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/ — EXP-08 challenger model ID verification
- https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion — RRF formula, default rank_constant=60, worked reference vectors (k=1 example)
- Codebase (read directly): `tools.ts` recall handler, `ai-helper.ts` (safeRun/RateLimitError/dual-path 429), `hybrid-rank.ts`, `ai-config/src/index.ts` (HYBRID_WEIGHTS, model aliases), `triage-worker/src/{extract,schemas}.ts` (zod-gate pattern), `recall-ranking.eval.test.ts` + `eval-budget.setup.ts` (eval harness), `vectorize-utils/src/index.ts` (vectorizeQuery)

### Secondary (MEDIUM confidence)
- https://github.com/cloudflare/workerd/issues/5998 — missing `query` field in generated reranker types (open bug; affects typing only, not runtime)
- https://bigdataboutique.com/blog/reciprocal-rank-fusion-how-it-works-and-when-to-use-it — k=60 worked example cross-checked against the formula
- https://blog.cloudflare.com/workers-ai-improvements/ — batch workload support, embedding batch cap 100 (reranker cap unspecified)

### Tertiary (LOW confidence)
- Per-model latency estimates for bge-reranker (A2) — no official figure; order-of-magnitude planning numbers only

## Metadata

**Confidence breakdown:**
- bge-reranker I/O contract: HIGH — verified via Context7 + official docs, response schema explicit (`{response:[{id,score}]}`)
- RRF formula + reference vectors: HIGH — canonical, reproducible by hand, multiple authoritative sources agree
- Query-expansion zod pattern: HIGH — exact template exists in `extract.ts`, proven in production
- Eval harness reuse: HIGH — read the actual `recall-ranking.eval.test.ts` + budget setup
- Latency budget composition: MEDIUM — control flow is clear; absolute per-stage timings are estimates (A2), validated by EXP-11 assertion
- Reranker score scale (sigmoid): MEDIUM — docs imply logits; confirm empirically in ablation (Open Q2)

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (stable — Cloudflare model catalog + RRF math are slow-moving; re-check workerd#5998 status before relying on generated types)
