# Phase 3: Query Expansion + Reranker - Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 11 (7 new, 4 modified)
**Analogs found:** 11 / 11 (every file has an in-repo analog — this phase is composition, not new infrastructure)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/query-expansion.ts` | service | request-response (AI) | `packages/triage-worker/src/extract.ts` (zod-gate) + `shared/ai-config/src/index.ts` (`TRIAGE_JSON_SCHEMA` derivation in `schemas.ts`) | role-match (zod-gated AI call; no queue/retry-ack envelope) |
| `packages/mcp-server/src/rrf.ts` | utility | transform (pure) | `packages/mcp-server/src/hybrid-rank.ts` | exact (pure deterministic transform, no IO) |
| `packages/mcp-server/src/__tests__/rrf.test.ts` | test | transform | `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` | exact (pure unit test, plain-JS inputs, no binding mocks) |
| `packages/mcp-server/src/__tests__/query-expansion.test.ts` | test | request-response | `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` (structure) + `schemas.test.ts` (zod-gate assertions) | role-match |
| `packages/mcp-server/src/__tests__/evals/reranker-ablation.eval.test.ts` | test (eval) | batch | `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | exact (clone pre-resolve-once + 2500-config CPU loop + Pareto/gate) |
| `packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts` | test (eval) | batch | `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` | role-match (A/B variant of the same harness) |
| `docs/hybrid-rank-changelog.md` | config (doc) | — | existing `docs/hybrid-rank-changelog.md` (append a row) | exact (file already exists; append-only) |
| `packages/mcp-server/src/tools.ts` (recall handler) | controller | request-response | itself — `recall()` handler `tools.ts:494-727` | exact (modify in place; integration hub) |
| `packages/mcp-server/src/hybrid-rank.ts` | utility | transform | itself — `hybrid-rank.ts:90-91` (`rerank` component) | exact (swap `rerank` input source; formula unchanged) |
| `shared/ai-config/src/index.ts` | config | — | itself — `INGESTION_CLASSIFIER_MODEL`/`EMBEDDING_MODEL` const block `index.ts:51-94` | exact (add one `as const` model-ID constant) |
| `packages/mcp-server/src/vectorize-helper.ts` / `@engram/vectorize-utils` | utility | request-response | `shared/vectorize-utils/src/index.ts` `vectorizeQuery` | exact (reuse unchanged in fan-out) |

> **Import-path note:** `vectorizeQuery` lives in `@engram/vectorize-utils` (`shared/vectorize-utils/src/index.ts`), NOT in `packages/mcp-server/src/vectorize-helper.ts`. The mcp-server `vectorize-helper.ts` retains only `vectorizeUpsert`/`vectorizeDelete` (Phase 2 D-08/D-09 split). The fan-out in `recall()` must `import { vectorizeQuery } from "@engram/vectorize-utils"` — matching the existing line `tools.ts:90`.

## Pattern Assignments

### `packages/mcp-server/src/query-expansion.ts` (service, zod-gated AI request-response)

**Analog A (zod schema → Workers-AI JSON-schema → safeParse gate):** `packages/triage-worker/src/schemas.ts:93-138` + `packages/triage-worker/src/extract.ts:200-282`

**Schema + JSON-schema derivation** (copy this exact 3-step pipeline from `schemas.ts:93-138`):
```typescript
// schemas.ts:93-100 — the zod schema IS both the model contract and the runtime gate.
export const TriageOutput = z.object({ /* ... fields ... */ });
export type TriageOutput = z.infer<typeof TriageOutput>;

// schemas.ts:131-138 — derive response_format.json_schema. THREE locked steps:
//   1. z.toJSONSchema (NOT the third-party zod-to-json-schema@3.x — ENG-21: it
//      silently returns {} under zod@4).
//   2. destructure-strip $schema (saves request bytes).
//   3. sanitizeJsonSchemaForWorkersAI (strips `propertyNames` → avoids Scout error 3030).
export const TRIAGE_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(TriageOutput);
  void $schema;
  return sanitizeJsonSchemaForWorkersAI(schema);
})();
```
> `sanitizeJsonSchemaForWorkersAI` is exported from `@engram/ai-config` (`shared/ai-config/src/index.ts:238-240`). Import it the same way `schemas.ts:32` does: `import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";`

**For `query-expansion.ts`** the schema is exactly 2 paraphrases (EXP-01 variant cap; original is prepended in code, never requested from the model — QE-7 anchor):
```typescript
export const ExpansionOutput = z.object({
  paraphrases: z.array(z.string().min(1).max(400)).length(2), // .length(2) is the hard cap
});
```

**The AI call + unwrap + safeParse gate** (copy the shape from `extract.ts:104-118` and `extract.ts:200-282`):
```typescript
// extract.ts:204-208 — chat responses wrap JSON in a `response` field; unwrap then gate.
const candidate = (aiResp as { response?: unknown }).response ?? aiResp;
const parsed = TriageOutput.safeParse(candidate);
if (!parsed.success) { /* gate failure handling */ }
```
For query-expansion the gate-failure branch is a **degrade-to-single-query** (`return [originalQuery]`), NOT the triage retry/ack/markIngestFailed machinery (that is queue-consumer-specific and out of scope here). The model call body mirrors `extract.ts:104-118` and the synthesis call in `tools.ts:670-677`:
```typescript
// Use safeRun (NOT raw env.AI.run) — see Shared Pattern "429 / safeRun" below.
const resp = await safeRun(env, QUERY_EXPANSION_MODEL, {
  messages: [
    { role: "system", content: EXPANSION_SYSTEM_PROMPT }, // anti-HyDE (EXP-09) + entity-preservation (EXP-12) rules live here
    { role: "user", content: originalQuery },
  ],
  response_format: { type: "json_schema", json_schema: EXPANSION_JSON_SCHEMA },
  temperature: 0.4,  // modest — drift defense (QE-2)
  max_tokens: 256,
});
```
> `QUERY_EXPANSION_MODEL` is already exported from `@engram/ai-config` (`index.ts:194`, aliased to `INGESTION_CLASSIFIER_MODEL` = Scout) and re-exported via `ai-helper.ts:62`. EXP-08 keeps this alias; the A/B challenger is a separate eval-only constant.

---

### `packages/mcp-server/src/rrf.ts` (utility, pure transform)

**Analog:** `packages/mcp-server/src/hybrid-rank.ts` (the repo's reference pure-transform module)

**Purity discipline to copy** (`hybrid-rank.ts:69-126`):
- No `env`, no IO, no mutation. Header doc-comment states "Pure transform — no env, no IO, no mutation" (`hybrid-rank.ts:13`).
- Build an O(1) `Map` keyed by `id` (`hybrid-rank.ts:77`), accumulate, then return a **new** sorted array via `[...arr].sort(...)` — never sort in place (`hybrid-rank.ts:124-125`).
- Default the tuning constant as a parameter (`k = 60`) the same way `hybridRank` defaults `weights` and `now` (`hybrid-rank.ts:73-74`) so tests can pass explicit values deterministically.

**Signature + body** (from RESEARCH §Pattern 2, lines 194-211 — already validated against Elasticsearch + Cormack-Clarke-Büttcher):
```typescript
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

---

### `packages/mcp-server/src/__tests__/rrf.test.ts` (test, pure)

**Analog:** `packages/mcp-server/src/__tests__/hybrid-rank.test.ts:1-60`

**Structure to copy** (`hybrid-rank.test.ts:17-40`):
- `import { describe, it, expect } from "vitest";` — no `cloudflare:workers` env, no binding mocks (these are workerd-pool unit tests, not eval).
- Define a minimal local interface for inputs (`hybrid-rank.test.ts:21-27` `RankableMemory`) — for RRF, `{ id: string }[][]` lists.
- First `it()` asserts a known fixed truth, then per-behavior `it()` blocks.

**Reference vectors (already computed by hand in RESEARCH §Pattern 2, lines 214-230):**
- Primary fixture — Elasticsearch k=1 worked example (5 docs, BM25 + kNN): doc3=0.8333 winner, doc2=0.5833, doc4=0.5000, doc1=0.4500, doc5=0.2000.
- Lock the default k=60: D1 ranks (1,2)=1/61+1/62≈0.03226, D2 ranks (2,4)≈0.03200, D3 ranks (3,1)≈0.03226 (D1/D3 tie → tiebreak by insertion order — assert this explicitly).

---

### `packages/mcp-server/src/__tests__/query-expansion.test.ts` (test, request-response)

**Analog:** `hybrid-rank.test.ts` (describe/it structure) + the zod-gate assertion style in `schemas.test.ts`

**What to assert (no creds — mock `env.AI`/embeddings):**
- `expandQuery` returns `[original, p1, p2]` with `result[0] === originalQuery` (EXP-01 anchor — original is prepended in code).
- zod gate: a malformed model response (e.g. 3 paraphrases, or non-string) → `safeParse` fails → falls back to `[originalQuery]`.
- anti-HyDE (EXP-09): assert the exported `EXPANSION_SYSTEM_PROMPT` string contains the no-hypothetical-document / no-fabrication rule (string-content assertion; the behavioral anti-HyDE check lives in the eval).
- similarity-gate helper (EXP-02): with mocked embeddings, a paraphrase whose cosine(original, p) < 0.85 is dropped.

---

### `packages/mcp-server/src/__tests__/evals/reranker-ablation.eval.test.ts` (eval, batch)

**Analog:** `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` — clone the harness directly. This is the single most-reused pattern in Phase 3.

**Imports (copy `recall-ranking.eval.test.ts:45-59`):**
```typescript
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { EMBEDDING_MODEL, VECTORIZE_OVERFETCH_FACTOR, type HybridWeights } from "@engram/ai-config";
import { hybridRank } from "../../hybrid-rank.js";
import { vectorizeQuery } from "@engram/vectorize-utils";
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" }; // build-time JSON import — workerd cannot fs.readFileSync
```
> JSON corpus is a **build-time import with `{ type: "json" }`** (`recall-ranking.eval.test.ts:51-54`) — workerd pool cannot read host-filesystem paths. Do not use `fs.readFileSync`.

**Pre-resolve-once + budget discipline** (THE pattern — `recall-ranking.eval.test.ts:501-558`):
- Loop every corpus entry EXACTLY ONCE: `await env.AI.run(EMBEDDING_MODEL, { text: [entry.query] })` then `await vectorizeQuery(env, EVAL_WORKSPACE_ID, queryVec, { topK: 25 * VECTORIZE_OVERFETCH_FACTOR, returnMetadata: "all" })`. ~100 AI + ~100 Vectorize = ~200 calls (the `MAX_AI_CALLS=200` ceiling — A4: run EXP-07 and EXP-08 in SEPARATE vitest sessions, never together).
- Cache `{ rawMatches, blocks }` in a `Map<string, QueryResolution>` keyed by entry id (`recall-ranking.eval.test.ts:509,553`).
- The ablation inner loop is **PURE-MATH** — it MUST NOT touch `env.AI`/`env.VECTORIZE` (`recall-ranking.eval.test.ts:506`). For the reranker ablation the reranker scores must ALSO be pre-resolved once per candidate set (the reranker is an AI call — budget it into the ~200 ceiling) and cached, then swept against `HYBRID_WEIGHTS.rerank` in the CPU loop.
- `EVAL_WORKSPACE_ID = "eval-fixtures"` (`recall-ranking.eval.test.ts:499`) — the stable seeded fixtures workspace.

**Metric functions — DO NOT re-implement; copy verbatim from `recall-ranking.eval.test.ts:206-235`:**
```typescript
function computeF1(ranked, expectedIds)   { /* precision@3 ∩ recall@3 harmonic mean — lines 206-213 */ }
function computeMRR(ranked, expectedIds)  { /* 1/rank_of_first_relevant — lines 219-227 */ }
function computeTop1(ranked, expectedIds) { /* ranked[0] ∈ expectedIds — lines 232-235 */ }
```
> **Corpus-vs-metric mismatch (RESEARCH Open Q3, flag to planner):** EXP-07 says "precision@5" but the corpus labels `expected_top_3_block_ids` and `computeF1` is precision@3. precision@5 against a top-3 gold set caps at 0.6. The ablation should compute precision@3 to match labels (and adjust the EXP-07 gate wording), OR the corpus is extended to top-5. Decide before writing the assertion.

**Gate pattern** (copy the baseline-comparison + Pareto shape, `recall-ranking.eval.test.ts:97-107, 658-733`): define a cosine-only baseline config (`{ rerank: 1.0, recency: 0, type_match: 0, scope_match: 0 }`, `recall-ranking.eval.test.ts:101-107`); winner must beat it by the EXP-07 margin (≥3% precision) else ship `HYBRID_WEIGHTS.rerank = 0.0` and document in the changelog. The constant lands regardless.

---

### `packages/mcp-server/src/__tests__/evals/query-expansion-recall.eval.test.ts` (eval, batch A/B)

**Analog:** same `recall-ranking.eval.test.ts` harness (pre-resolve-once + budget + metrics). A/B variant:
- Two expansion models — Scout (`QUERY_EXPANSION_MODEL`) vs `@cf/meta/llama-3.2-3b-instruct` (EXP-08). recall@5 within 5pp gates promotion (a follow-on PR, not this phase).
- EXP-09 anti-HyDE assertion: variants must read as search phrasings, not fabricated answers/documents.
- EXP-12 entity-preservation metric — copy the capitalized-token heuristic from RESEARCH §Code Examples (lines 386-394): `>80%` of named entities in the original present in ≥1 variant.
- Same `MAX_AI_CALLS=200` ceiling — run in its own session, separate from the EXP-07 ablation (A4).

---

### `docs/hybrid-rank-changelog.md` (config doc, append-only)

**Analog:** the file already exists and was seeded in Phase 2 (Plan 02-03). Append one new row using the **14 D-21 columns** already defined in its header. The header already anticipates Phase 3:
> "`bge_reranker_active` flips `true` in Phase 3 EXP-06 when the bge-reranker model score replaces raw Vectorize cosine as the `rerank` input."

The EXP-07 ablation result row sets `bge_reranker_active` = `true` (if the reranker beats cosine ≥3% and ships with non-zero weight) or records the zero-weight rationale (EXP-07 fallback). Do not rewrite existing rows — append only.

---

### `packages/mcp-server/src/tools.ts` — `recall()` handler (controller, integration hub) — MODIFY

**Analog:** the existing `recall()` handler, `tools.ts:494-727`. This is where every Phase 3 wire lands. Current linear shape to preserve and extend:

| Step | Lines | What it does | Phase 3 change |
|------|-------|--------------|----------------|
| Auth + stub | 498-506 | `getProps()` → `workspaceNs.idFromName(props.workspace_id)` | unchanged — `workspace_id` ALWAYS from `props`, never `args` (MT-1) |
| Query truncate | 512-516 | 1800-char guard → `queryForEmbed` | unchanged |
| Embed query | 518-548 | `safeRun(env, EMBEDDING_MODEL, { text: [queryForEmbed] })` → `queryVector` | reused by the variant fan-out |
| Single Vectorize pass | 550-577 | `vectorizeQuery(env, props.workspace_id, queryVector, { topK: fetchSize, ...filter, returnMetadata: "all" })`, then `MIN_COSINE_THRESHOLD` filter + `.slice(0, topK)` | **EXP-03 adaptive gate inserts here**: read `top1 = result.matches[0]?.score ?? 0`; if `top1 < 0.65` run expansion fan-out + RRF |
| Hydrate blocks | 588-594 | `stub.getBlocksByIds({ workspace_id, ids })` | unchanged |
| Hybrid rank | 596-597 | `hybridRank(filteredMatches, blocks, args, Date.now())` | **EXP-06**: feed reranker-scored matches (see Pattern 1 below) |
| CON-05 conflicts | 599-658 | inbox-conflict hydration via `listInboxConflictsForMemoryIds` | unchanged — runs AFTER hybridRank |
| Synthesis (opt-in) | 660-701 | `safeRun(env, CLASSIFIER_MODEL, ...)` when verbosity≠chunks | unchanged |
| Build envelope | 709-723 | `buildRecallResponse({...})` → `trimToBudget` | **EXP-10**: append `meta.gaps` "query expansion unavailable" on fallback (mirrors the truncation-gap append at `tools.ts:720-722`) |

**Adaptive routing decision (EXP-03)** — insert after the single-query Vectorize pass (`tools.ts:577`). Use RESEARCH §"Adaptive routing" (lines 350-381) as the template. Fan-out Vectorize calls run in parallel via `Promise.all`; each variant re-embeds via `safeRun(env, EMBEDDING_MODEL, ...)` then calls the SAME `vectorizeQuery(env, props.workspace_id, ...)` (workspace_id from `props` — V4 access control, INT-03 pentest target).

**bge-reranker invocation (EXP-06)** — insert between RRF merge and `hybridRank` (`tools.ts:596`). Copy the `safeRun` + try/catch fallback shape from RESEARCH §Pattern 1 (lines 154-183):
```typescript
const contexts = candidates
  .filter((c) => (c.content ?? c.summary ?? "").length > 0)   // Pitfall 6: drop empty contexts
  .map((c) => ({ text: c.content ?? c.summary ?? "" }));       // index-aligned with `candidates`
let rerankScores = new Map<string, number>();
try {
  const resp = await safeRun(env, RERANKER_MODEL, { query: originalQuery, contexts });
  // response: { response: [{ id: <index into contexts>, score: number }] } — id is NOT a memory id
  const ranked = (resp as { response?: { id: number; score: number }[] }).response ?? [];
  for (const r of ranked) {
    const cand = candidates[r.id];
    if (cand) rerankScores.set(cand.id, sigmoid(r.score)); // sigmoid-normalize logits → [0,1] (Pitfall 2)
  }
} catch (err) {
  console.warn("recall:EXP-06:reranker-failed", { err }); // EXP-06 fallback — leave map empty
}
const rerankedMatches = mergedMatches.map((m) => ({
  ...m,
  score: rerankScores.get(m.id) ?? m.score,  // defensive default = raw cosine (safeRun discipline)
}));
const ranked = hybridRank(rerankedMatches, blocks, args, Date.now()); // formula UNCHANGED
```
> Call the reranker through `safeRun` (not raw `env.AI.run`) specifically to sidestep workerd#5998 (the generated reranker type omits the required `query` field; `safeRun`'s `body: Record<string, unknown>` signature dodges the typed overload). See Shared Pattern "429 / safeRun".

**429 fallback (EXP-10)** — `safeRun` already throws `RateLimitError` (origin-tagged). Wrap the expansion call so a persistent 429 degrades to the v0.1 single-query path. Mirror the existing recall-embed catch (`tools.ts:526-536`) which already branches on `"isRateLimit" in err`.

---

### `packages/mcp-server/src/hybrid-rank.ts` (utility transform) — MODIFY

**Analog:** itself, `hybrid-rank.ts:90-91`. The `rerank` component reads `match.score` today:
```typescript
// hybrid-rank.ts:90-91
// ---- Component: rerank (raw cosine in v0.2; bge-reranker score in Phase 3 — see HYBRID_WEIGHTS audit comment) ----
const rerank = match.score;
```
**Phase 3 change is upstream, not here.** EXP-06 swaps what `match.score` CONTAINS (reranker score, sigmoid-normalized) before `hybridRank` is called — the formula at `hybrid-rank.ts:113-117` (`weights.rerank * rerank + ...`) stays byte-identical. Touching the formula re-opens the Phase 2 weight sweep (anti-pattern, RESEARCH lines 292). The only edit candidate here is updating the doc-comment to note bge-reranker is now live.

---

### `shared/ai-config/src/index.ts` (config) — MODIFY

**Analog:** the existing model-ID const block, `index.ts:51-94`. Add ONE constant matching the `as const` literal style:
```typescript
// Mirror EMBEDDING_MODEL (index.ts:62) / INGESTION_CLASSIFIER_MODEL (index.ts:51) form.
export const RERANKER_MODEL = "@cf/baai/bge-reranker-base" as const;
```
- `HYBRID_WEIGHTS.cosine → rerank` rename is **already done** (Phase 2 D-05 — see `index.ts:151-156`, `HYBRID_WEIGHTS.rerank: 0.6`). EXP-05's rename is complete; only `RERANKER_MODEL` is net-new.
- Re-export through `ai-helper.ts` is optional — `ai-helper.ts:55-64` re-exports model IDs for backward-compat; new code can import `RERANKER_MODEL` from `@engram/ai-config` directly (matching the `vectorizeQuery`/`MIN_COSINE_THRESHOLD` direct-import style at `tools.ts:89-90`).
- Optional EXP-08 A/B challenger: `export const EXPANSION_CHALLENGER_MODEL = "@cf/meta/llama-3.2-3b-instruct" as const;` (eval-only; Scout stays the default per EXP-08).

---

### `@engram/vectorize-utils` (`shared/vectorize-utils/src/index.ts`) (utility) — REUSE UNCHANGED

**Analog:** `vectorizeQuery` (`vectorize-utils/src/index.ts:75-96`). The fan-out reuses it verbatim — per-variant: `vectorizeQuery(env, props.workspace_id, variantVector, { topK: fetchSize, returnMetadata: "all" })`. The mandatory positional `workspaceId` (AI-02) is the compile-time cross-workspace-leak defense (INT-03 pentest target). No edit needed; do NOT call `env.VECTORIZE.query` directly (CI grep gate bans it — `lint-no-direct-vectorize.test.ts`).

## Shared Patterns

### 429 detection / safeRun (apply to EVERY AI call in this phase)
**Source:** `packages/mcp-server/src/ai-helper.ts:224-245`
**Apply to:** `query-expansion.ts` (expansion call), `tools.ts` recall handler (reranker call + expansion call)
```typescript
// ai-helper.ts:224-245 — exact signature. body is Record<string,unknown> (sidesteps workerd#5998 reranker type bug).
export async function safeRun(
  env: { AI: Ai },
  model: string,
  body: Record<string, unknown>,
): Promise<AiBindingResponse> {
  let resp: AiBindingResponse;
  try {
    resp = await env.AI.run(model, body);
  } catch (err) {
    if (isRateLimitError(err)) throw new RateLimitError("thrown");  // dual-path #1: thrown AiError
    throw err;
  }
  if (detectRateLimit(resp)) {                                       // dual-path #2: binding envelope {success:false, errors:[{code:7501}]}
    throw new RateLimitError("binding-envelope", `Workers AI 429: ${JSON.stringify(resp.errors ?? [])}`);
  }
  return resp;
}
```
`safeRun` is imported in `tools.ts` (see the embed call `tools.ts:525` and synthesis call `tools.ts:670`). `RateLimitError` carries `isRateLimit = true` + `origin` — callers branch on `"isRateLimit" in err` (`tools.ts:528`). EXP-10's fallback is "catch → single-query path + meta.gaps note".

### zod-to-Workers-AI JSON-schema sanitization (apply to the expansion prompt)
**Source:** `shared/ai-config/src/index.ts:225-240` (`sanitizeJsonSchemaForWorkersAI`) + `packages/triage-worker/src/schemas.ts:131-138` (derivation site)
**Apply to:** `query-expansion.ts` `EXPANSION_JSON_SCHEMA` derivation
Three locked steps: `z.toJSONSchema` (native zod@4, never `zod-to-json-schema@3.x` — ENG-21) → strip `$schema` via destructure → `sanitizeJsonSchemaForWorkersAI` (strips `propertyNames` → avoids Scout error 3030).

### Pure-transform discipline (apply to rrf.ts)
**Source:** `packages/mcp-server/src/hybrid-rank.ts:13, 69-126`
**Apply to:** `rrf.ts`
No env/IO/mutation; O(1) `Map` accumulation; `[...arr].sort(...)` returns a new array; tuning constant (`k=60`) as a defaulted parameter for deterministic tests.

### Eval pre-resolve-once + MAX_AI_CALLS budget (apply to both evals)
**Source:** `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts:501-558` + `eval-budget.setup.ts:84-110`
**Apply to:** `reranker-ablation.eval.test.ts`, `query-expansion-recall.eval.test.ts`
Resolve each corpus query's embeddings/Vectorize/reranker EXACTLY ONCE into a `Map<string, QueryResolution>`; sweep configs in a PURE-MATH CPU loop that never touches bindings. The `eval-budget.setup.ts` `beforeAll` spies on `env.AI.run` AND `env.VECTORIZE.query` against one shared `MAX_AI_CALLS=200` counter (throws on overrun). Vitest `eval` project requires `isolate: false` + `maxWorkers: 1` (`vitest.config.ts:126-137`) so the counter is not reset per-file. **A4: EXP-07 and EXP-08 must run in SEPARATE sessions** — two 100-query pre-resolves together exceed 200.

### Tenant isolation on every Vectorize call (V4 access control)
**Source:** `shared/vectorize-utils/src/index.ts:75-96` (mandatory positional `workspaceId`)
**Apply to:** every fan-out variant query in `recall()`
`workspace_id` ALWAYS from `props.workspace_id`, NEVER from `args` (`tools.ts:592,619` show the existing pattern). INT-03 pentests the expanded-query + reranker paths against foreign JWTs.

## No Analog Found

None. Every Phase 3 file maps to an in-repo analog. The reranker I/O contract (`{ response: [{ id, score }] }`, `id` = contexts index) is the one piece with no codebase precedent — it is fully specified in RESEARCH §Pattern 1 (lines 149-185) and §Pitfall 1 (lines 311-315), so the planner should reference RESEARCH directly for the reranker response-mapping, not a codebase analog.

## Metadata

**Analog search scope:** `packages/mcp-server/src/` (recall handler, hybrid-rank, vectorize-helper, ai-helper, tests + evals), `packages/triage-worker/src/` (extract, schemas — zod-gate), `shared/ai-config/src/`, `shared/vectorize-utils/src/`, `docs/`
**Files scanned:** 11 source/test analogs read in full or in targeted ranges
**Pattern extraction date:** 2026-06-08
