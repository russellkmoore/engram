# Phase 2: Recall Quality Baseline — Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 18 new / extended deliverables (RNK + CON workstreams)
**Analogs found:** 18 / 18 (every file has at minimum a role-match analog in the engram codebase)

> Phase 2 is dependency-ordered composition of primitives already in repo: `hybridRank` exists, `detectConflict()` exists, `vectorizeQuery` exists, `createInboxEntry` exists, `ctx.waitUntil()` is the established fire-and-forget pattern, eval-tier vitest is locked from Phase 1. Nothing is greenfield. Every Phase 2 file extends an analog with surgical, documented deltas. The two highest-leverage patterns to reproduce verbatim:
>
> 1. The Phase 1 `shared/ai-config/{package.json,tsconfig.json,src/index.ts}` shape (mirrored by the new `shared/vectorize-utils/` package).
> 2. The Phase 5 `vectorizeQuery` mandatory-positional-`workspaceId` discipline (preserved on extraction + replicated in the new `vectorizeNeighbors`).

---

## File Classification

### RNK workstream (lands first per D-16)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` (NEW) | eval-tier test | request-response → in-memory sweep | `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | role-match (same eval-tier shape; new file adds 625-config grid + Pareto + sensitivity + dual-corpus gate, drops async-pipeline wait) |
| `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` (NEW vendored fixture) | data fixture | (none — JSON bundled at build time) | `packages/mcp-server/src/__tests__/evals/fixtures/real-corpus.json` + `reference-corpus.json` + `.planning/evals/recall-corpus.json` | exact (vendor-copy of the authoritative `.planning/evals/recall-corpus.json` — same wrapper shape produced by `apply-split.mjs`) |
| `scripts/sync-eval-corpus.mjs` (NEW monorepo-root .mjs) | utility script | request-response (filesystem copy) | `.planning/evals/apply-split.mjs` (closest in-tree mjs in spirit) + `scripts/kv-bootstrap.mjs` (CLI skeleton + secrets discipline) | role-match (no prior `.mjs` does cross-tree file copy; `apply-split.mjs` is the closest read/parse/write-JSON precedent) |
| `shared/vectorize-utils/package.json` (NEW) | workspace package manifest | (build config) | `shared/ai-config/package.json` | exact (mirror verbatim with name swap) |
| `shared/vectorize-utils/tsconfig.json` (NEW) | workspace tsconfig | (build config) | `shared/ai-config/tsconfig.json` | exact (4-line file; mirror verbatim) |
| `shared/vectorize-utils/src/index.ts` (NEW — exports `vectorizeQuery` + `vectorizeNeighbors`) | shared utility | request-response (Worker → Vectorize) | `packages/mcp-server/src/vectorize-helper.ts` (verbatim source for `vectorizeQuery`; `vectorizeNeighbors` is structurally new) | exact (extraction) + role-match (new helper) |
| `shared/ai-config/src/index.ts` (MODIFY — rename `HYBRID_WEIGHTS.cosine` → `rerank`, audit comment) | shared config | (constants module) | its own existing audit-comment block on `MIN_COSINE_THRESHOLD` (lines 96–113) + `EMBEDDING_MODEL` (lines 40–62) | exact (extending the same file's own convention) |
| `packages/mcp-server/src/hybrid-rank.ts` (MODIFY — parameterize on `weights`, rename `cosine` ref → `rerank`) | pure functional rank engine | (in-memory transform) | its own current shape | exact (variable rename + optional 5th param; formula structurally unchanged per D-07) |
| `packages/mcp-server/src/tools.ts` recall handler (MODIFY — import swap to shared/vectorize-utils per D-09; populate `context.conflicts[]` per CON-05) | Worker handler extension | request-response | its own existing `recall()` handler (~lines 530–620) + existing `buildRecallResponse` | exact (extending the same file's own conventions) |
| `docs/hybrid-rank-changelog.md` (NEW append-only doc) | doc / changelog | (markdown only) | `docs/architecture.svg` is the ONLY existing entry in `docs/`; closest markdown precedent is `.planning/research/v0.2-SUMMARY.md` table-driven prose | role-match (no `docs/*.md` precedent; D-21 dictates the schema verbatim) |
| `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` (NEW routing tracker) | planning artifact / append-only log | (markdown only) | `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` | exact (canonical copy with phase-number swap per D-19 + PRE-05) |

### CON workstream (lands after RNK per D-16)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/triage-worker/src/conflict-pipeline.ts` (NEW orchestrator) | Worker orchestrator | event-driven (queue → waitUntil → AI + Vectorize + DO RPC + Analytics) | `packages/triage-worker/src/index.ts` queue-consumer (~lines 200–298) + `packages/triage-worker/src/conflict-detection.ts` (call signature) + `packages/triage-worker/src/analytics.ts` (writeAnalytics pattern) | role-match (composes 3 existing patterns; orchestrator shape itself is new) |
| `packages/triage-worker/src/index.ts` (MODIFY — `ctx.waitUntil(conflictPipeline(...))` in store-normal branch after `updateBlockEnrichment`) | Worker queue consumer | event-driven | its own `store-normal` branch (lines 214–242) + `mcp-server/src/tools.ts:448–474` `ctx.waitUntil(env.QUEUE.send(...))` pattern | exact (single insertion point, surrounding code unchanged) |
| `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` (NEW unit + integration) | DO/Worker unit test | request-response (test → orchestrator) | `packages/triage-worker/src/__tests__/extract.test.ts` (closest sibling unit test; uses `cloudflare:test` env + `runInDurableObject` analog) | role-match (same workerd-pool harness; orchestrator-under-test is new) |
| `packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts` (EXTEND — unskip + raise thresholds to P≥0.85 R≥0.90) | eval-tier test | request-response | its own current structure (lines 76–176) | exact (constants + `it.skip` → `it` toggle; assertion shape unchanged) |
| `packages/workspace-do/src/queries.ts` (MODIFY — add `insertConflictAsInbox` + `listInboxConflictsForMemoryIds`) | DB helper | CRUD (single INSERT, bounded SELECT) | `createInboxEntry` (lines 480–491) for the writer + `listConflicts` (lines 511–530) for the reader | exact (extending the same file; both new helpers follow the established `sql.exec(?, ?, ...)` positional-binding convention) |
| `packages/workspace-do/src/index.ts` (MODIFY — add RPC methods for the two new helpers) | DO admin RPC method | request-response | existing RPC methods at lines 172–215 + `stampEmbedding` at 230+ | exact (3-line method body delegating to `queries.ts`; `assertOwnsWorkspace` first executable line) |
| `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` (NEW CON-05 integration test) | DO/Worker integration test | request-response | (none under `__tests__/integration/` — directory does not yet exist); closest analogs are `packages/mcp-server/src/__tests__/tools-integration.test.ts` + `cross-workspace-pentest.test.ts` | role-match (creates the `integration/` subdir; existing top-level integration tests dictate the harness shape) |
| `scripts/eval-budget-summary.mjs` (EXTEND — add `--conflict-pipeline-p99` mode) | utility/reporting script | request-response (GraphQL fetch) | its own current GraphQL-summary shape (lines 1–100) | exact (extending the same file with one new arg + one new GraphQL aggregate) |

### Cross-cutting (optional grep gates)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/__tests__/ai-config-audit.test.ts` (OPTIONAL — RNK-05 / D-06 grep gate) | lint-node test | request-response (filesystem) | `packages/mcp-server/src/__tests__/lint-no-direct-vectorize.test.ts` (canonical lint-node grep test) | exact (same `readFileSync` + grep shape; new file greps `shared/ai-config/src/index.ts` for D-06 verbatim audit comment markers) |
| `packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts` (OPTIONAL — CON-08 architectural gate) | lint-node test | request-response (filesystem) | `packages/mcp-server/src/__tests__/lint-no-direct-vectorize.test.ts` | exact (same `walk` + grep; new file forbids `EMAIL`/`WEBHOOK`/`PUSH_NOTIFICATION`-shaped bindings or function names) |

---

## Pattern Assignments

### `packages/mcp-server/src/__tests__/evals/recall-ranking.eval.test.ts` (NEW eval test)

**Primary analog:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` (same directory, ran in `eval` project; same `EVAL_SPLIT` semantics, same `EMBEDDING_MODEL` cutover fail-fast).

**Imports + corpus loader (KEEP VERBATIM)** — `recall-f1.eval.test.ts:33-52`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import { EMBEDDING_MODEL } from "../../ai-helper.js";

// Loaded as a build-time JSON import (Vite bundles it into the worker) rather
// than a runtime fs.readFileSync. Workers in the @cloudflare/vitest-pool-workers
// pool cannot read host filesystem paths outside the bundle — node's fs module
// is available but only resolves what Vite has shipped.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };
```

**`CorpusEntry` shape (KEEP VERBATIM)** — `recall-f1.eval.test.ts:53-70`:

```typescript
interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: null;
}
```

**Split selection (KEEP VERBATIM)** — `recall-f1.eval.test.ts:83-88` — but Phase 2 uses BOTH splits (train for sweep, validate for D-04 gap):

```typescript
const trainSet = corpus.entries.filter((e) => e.split === "train");
const validateSet = corpus.entries.filter((e) => e.split === "validate");
```

**Sweep skeleton (NEW — researcher's recommended shape per RESEARCH §"Code Examples → Embedding cache + sweep skeleton"):**

```typescript
// Step 1: Pre-resolve EVERY query ONCE. ~100 AI + ~100 Vectorize calls total.
const resolutions = new Map<string, QueryResolution>();
for (const entry of corpus.entries) {
  const embed = await env.AI.run(EMBEDDING_MODEL, { text: [entry.query] });
  const queryVec = embed.data[0];
  const result = await vectorizeQuery(env, workspace_id, queryVec, {
    topK: 25 * VECTORIZE_OVERFETCH_FACTOR, returnMetadata: "all",
  });
  const filtered = result.matches.filter(m => m.score >= MIN_COSINE_THRESHOLD).slice(0, 25);
  const blocks = await stub.getBlocksByIds({ workspace_id, ids: filtered.map(m => m.id) });
  resolutions.set(entry.id, { matches: filtered, blocks });
}
// Step 2: enumerate 625 configs — PURE-MATH reranking only.
for (const cfg of enumerateGrid()) {
  /* hybridRank(matches, blocks, args, now, cfg) per config — no env.AI / env.VECTORIZE */
}
```

**Notes:**
- KEEP VERBATIM: the `import corpusJson from "..." with { type: "json" }` Vite bundle path. `fs.readFileSync` does NOT work in workerd-pool tests per the lines 42–50 comment.
- KEEP VERBATIM: the EMBEDDING_MODEL fail-fast at the top — match the corpus header `embedding_model` field against the imported constant before doing ANY scoring (prevents stale-label silent corruption per the existing test header).
- ADAPT: drop the 180-second async-pipeline wait (`ASYNC_PIPELINE_WAIT_MS` at line 163) — the new sweep is read-only against a pre-seeded eval-fixtures workspace; no ingestion.
- ADAPT: the `captureCallback("recall", workspace)` pattern at lines 94–124 is reusable for the inline F1 sanity check on top of the sweep, but the sweep ITSELF should call `hybridRank` directly (not `recall()`) so the budget counter only ticks for embeddings + Vectorize, not full-handler invocations.
- BUDGET DISCIPLINE: the sweep MUST call `env.AI.run` + `env.VECTORIZE.query` exactly ONCE per query (per RESEARCH §Pitfall 2). The pure-math inner loop must never touch a binding.

---

### `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` (NEW vendored fixture)

**Analog:** `.planning/evals/recall-corpus.json` (the authoritative source per D-11) + `recall-f1.eval.test.ts` expects a `CorpusFile` wrapper.

**Authoritative shape** (already produced by `.planning/evals/apply-split.mjs` and consumed by Phase 1 PRE-03):

```jsonc
{
  "corpus_version": 2,                      // numeric, not string
  "embedding_model": "@cf/qwen/qwen3-embedding-0.6b",
  "sources": [{ "name": "...", "count": N, "sourced_at": "..." }],
  "buckets": ["critical-path", "known-failure", "extraction", "edge"],
  "entries": [
    {
      "id": "rc-001",
      "bucket": "critical-path",
      "query": "...",
      "expected_top_3_block_ids": ["blk-eval-001", "blk-eval-002", "blk-eval-003"],
      "split": "train",
      "labeled_by": "russell",
      "labeled_at": "2026-06-XX",
      "expected_synthesis": null
    }
  ]
}
```

**Notes:**
- KEEP VERBATIM: the wrapper shape from `.planning/evals/recall-corpus.json`. The vendored copy is bit-for-bit identical except for a top-of-file comment marker indicating it is auto-synced.
- ADD: a top-of-file marker comment (`"_auto_synced_from": ".planning/evals/recall-corpus.json"` or similar; JSON does not support comments — use a sentinel field at the top of the wrapper). Phase 1 Plan 01-05 introduced this corpus shape; reuse it verbatim.
- CRITICAL: `embedding_model` field MUST match the `EMBEDDING_MODEL` constant in `shared/ai-config/src/index.ts:62` by exact string equality. The eval test's fail-fast guard depends on this.

---

### `scripts/sync-eval-corpus.mjs` (NEW)

**Primary analog (CLI shape + secrets posture):** `scripts/eval-budget-summary.mjs` (lines 1–60).

**Header / arg-parse / TAG pattern (KEEP VERBATIM)** — `scripts/eval-budget-summary.mjs:1-43`:

```javascript
// scripts/sync-eval-corpus.mjs
// D-13: copies .planning/evals/recall-corpus.json →
// packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json so the
// vendored fixture stays in sync with the authoritative editing surface (D-11).
//
// Usage: node scripts/sync-eval-corpus.mjs [--check] [--help]
//   --check: exit 1 if files differ instead of overwriting (CI guard)
// Exit codes: 0 success | 1 drift (--check mode) | 2 source missing.

import { argv, exit, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TAG = "[sync-eval-corpus]";
const args = argv.slice(2);
let checkOnly = false;
let showHelp = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--check") checkOnly = true;
  else if (a === "--help" || a === "-h") showHelp = true;
}
```

**Secondary analog (JSON read/write + path resolution from script location):** `.planning/evals/apply-split.mjs:10-16`:

```javascript
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(__dirname, "recall-corpus.json");
const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
```

**Notes:**
- KEEP VERBATIM: the `import.meta.url` → `__dirname` pattern from `apply-split.mjs`; resolves the repo-root paths from the script location, no env vars needed.
- KEEP VERBATIM: the `TAG`/`usage(stream)`/exit-code convention from `eval-budget-summary.mjs:1-55`. Exit 0 success, exit 2 missing source — matches the existing convention.
- ADAPT: NO Cloudflare-token requirement (this is a pure filesystem copy). Strip the env-validation block. The `--check` mode is the only operational addition for CI drift-detection.
- ADAPT: wire into `packages/mcp-server/package.json` as a `pretest:eval` npm script per D-13. Phase 1 PATTERNS.md §"Vitest project-tier convention" establishes that npm-script names are stable identifiers — adding `pretest:eval` is additive.

---

### `shared/vectorize-utils/package.json` (NEW)

**Analog (KEEP VERBATIM with name swap):** `shared/ai-config/package.json` (16 lines, the canonical shape).

```json
{
  "name": "@engram/vectorize-utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "files": ["src"]
}
```

**Notes:**
- KEEP VERBATIM: every field except the `name`. The `shared/ai-config` precedent proves npm workspaces auto-resolves this shape with zero ts-config `paths` entries — `tsconfig.base.json` already includes the `shared/*` glob.
- KEEP VERBATIM: `private: true` (every shared workspace package is private — this is not a publishable package).
- ADAPT: dependency declarations on the consumer side — `packages/mcp-server/package.json` and `packages/triage-worker/package.json` both add `"@engram/vectorize-utils": "*"` to `dependencies` (the workspace-link wildcard form already used for `@engram/ai-config` and `@engram/types`).

---

### `shared/vectorize-utils/tsconfig.json` (NEW)

**Analog (KEEP VERBATIM):** `shared/ai-config/tsconfig.json` — 4 lines:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

**Notes:** literally mirror byte-for-byte. The `shared/ai-config` precedent is the contract.

---

### `shared/vectorize-utils/src/index.ts` (NEW — exports `vectorizeQuery` + `vectorizeNeighbors`)

**Primary analog (KEEP VERBATIM for `vectorizeQuery`):** `packages/mcp-server/src/vectorize-helper.ts` (entire file).

**Excerpt — the existing `vectorizeQuery` to extract verbatim (`vectorize-helper.ts:39-99`):**

```typescript
/** Maximum namespace byte length enforced by Vectorize. */
const NAMESPACE_MAX_BYTES = 64;
/** Default topK per Phase 4 D-10 (overrides Vectorize's implicit default of 5). */
const VECTORIZE_TOPK_DEFAULT = 25;

function assertNamespace(workspaceId: string): void {
  if (!workspaceId) {
    throw new Error("Vectorize helper: workspaceId is required (failure mode #1 defense)");
  }
  const byteLength = new TextEncoder().encode(workspaceId).byteLength;
  if (byteLength > NAMESPACE_MAX_BYTES) {
    throw new Error(
      `Vectorize helper: namespace '${workspaceId}' exceeds 64-byte namespace cap (${String(byteLength)} bytes) — Pitfall 9 guard`,
    );
  }
}

export function vectorizeQuery(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: { topK?: number; filter?: Record<string, unknown>; returnMetadata?: "none" | "indexed" | "all"; },
): Promise<VectorizeMatches> {
  assertNamespace(workspaceId);   // SYNCHRONOUS throw BEFORE async work
  const topK = opts.topK ?? VECTORIZE_TOPK_DEFAULT;
  const returnMetadata = opts.returnMetadata ?? "all";
  const queryOpts: Record<string, unknown> = { namespace: workspaceId, topK, returnMetadata };
  if (opts.filter !== undefined) queryOpts.filter = opts.filter;
  return env.VECTORIZE.query(vector, queryOpts);
}
```

**`vectorizeNeighbors` — NEW (RESEARCH §"Pattern 4" — over-fetch + client-side threshold + slice):**

```typescript
export interface VectorizeNeighborsOpts {
  topK: number;
  type?: string;
  scope?: string;
  threshold: number;        // CON-02: client-side filter (Vectorize has NO score floor — Context7 verified)
}

export function vectorizeNeighbors(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: VectorizeNeighborsOpts,
): Promise<VectorizeMatches["matches"]> {
  // D-10: workspace_id is MANDATORY (positional); type/scope optional and stack as $in / $eq
  const filter: Record<string, unknown> = {};
  if (opts.type !== undefined) filter.type = { $in: [opts.type] };
  if (opts.scope !== undefined) filter.scope = { $eq: opts.scope };
  const fetchSize = opts.topK * VECTORIZE_OVERFETCH_FACTOR;   // mirror tools.ts:556 over-fetch
  const result = await vectorizeQuery(env, workspaceId, vector, {
    topK: fetchSize,
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
    returnMetadata: "all",
  });
  return result.matches.filter((m) => m.score >= opts.threshold).slice(0, opts.topK);
}
```

**Notes:**
- KEEP VERBATIM: the `assertNamespace` 64-byte guard, the `returnMetadata: "all"` default, the `VECTORIZE_TOPK_DEFAULT = 25` constant. These encode AI-02 / Pitfall 7 / Pitfall 8 / Pitfall 9 defenses simultaneously. Extraction must preserve every line of the existing `vectorize-helper.ts:39-99`.
- KEEP VERBATIM: `workspaceId` is the SECOND positional argument (non-optional). The compile-time defense is the contract — RESEARCH §Pitfall 4 explicitly warns against making `workspace_id` a filter-object key instead of the namespace positional.
- KEEP VERBATIM: the `Object.keys(filter).length > 0 ? { filter } : {}` conditional spread — matches the `exactOptionalPropertyTypes` discipline at `tools.ts:559-564`.
- ADAPT: `vectorizeNeighbors` does NOT need an `opts.filter` escape hatch — the helper's whole point is to constrain to `{type, scope}` stacks. Future callers who need raw filter can still use `vectorizeQuery` directly.
- ADAPT: `vectorizeUpsert` + `vectorizeDelete` stay in `packages/mcp-server/src/vectorize-helper.ts` (only `vectorizeQuery` migrates per D-08 — they're not needed by the triage worker's conflict-pipeline path).
- IMPORT SWAP per D-09: `tools.ts:562` `import { vectorizeQuery } from "./vectorize-helper.js"` → `from "@engram/vectorize-utils"`. The lint-node-tier `lint-no-direct-vectorize.test.ts:36-39` `HELPER_FILE` constant may need updating to also exempt `@engram/vectorize-utils` import sites (verify during execution; if the lint grep already only checks for `env.VECTORIZE.{query|upsert|deleteByIds}` literal strings, no change needed because helper consumers DO NOT call those directly).

---

### `shared/ai-config/src/index.ts` (MODIFY — rename + D-06 audit comment)

**Analog (this file's own audit-comment convention):** the existing audit comment block on `MIN_COSINE_THRESHOLD` (lines 96–113) and the model-ID audit blocks on `EMBEDDING_MODEL` (lines 53–62) and `INGESTION_CLASSIFIER_MODEL` (lines 40–51).

**Existing audit-comment shape — KEEP VERBATIM** (`shared/ai-config/src/index.ts:96-113`):

```typescript
/**
 * Cosine-similarity threshold used by `recall()` to filter low-relevance
 * Vectorize matches before hydrate + hybrid-rank.
 *
 * Why this exists (ENG-25): Vectorize's `topK` returns the BEST K matches but
 * doesn't filter on absolute relevance. ...
 *
 * Tuned 2026-06-02 against the reference + real corpus. See ENG-25 PR
 * description for the sweep results.
 *
 * If you swap the embedding model, you MUST retune this — different models
 * have different distance distributions.
 */
export const MIN_COSINE_THRESHOLD = 0.6;
```

**Current shape of the literal to rename (`shared/ai-config/src/index.ts` lines NOT yet in file — `HYBRID_WEIGHTS` currently lives in `packages/mcp-server/src/hybrid-rank.ts:44-49`):**

```typescript
// CURRENT — in packages/mcp-server/src/hybrid-rank.ts:
export const HYBRID_WEIGHTS = {
  cosine: 1.0,
  recency: 0.15,
  type_match: 0.2,
  scope_match: 0.15,
} as const;
```

**Post-Phase-2 shape (per D-05 + D-06):**

```typescript
// MOVED TO shared/ai-config/src/index.ts:
/**
 * Hybrid-rank component weights — single source of truth for both Workers.
 *
 * v0.2 Phase 2: `rerank` weight values tuned against RAW COSINE (`match.score`
 * from Vectorize). bge-reranker invocation lands in Phase 3 (EXP-06). Until
 * then, `HYBRID_WEIGHTS.rerank * match.score` means "raw-cosine weighted by
 * the tuned rerank weight." Do NOT read `HYBRID_WEIGHTS.rerank` as
 * "reranker active" in v0.2.
 *
 * Corpus: .planning/evals/recall-corpus.json (100 entries, qwen3-embedding-0.6b,
 *         sweep date YYYY-MM-DD)
 * Scores: F1=X.XX, MRR=X.XX, top1=X.XX
 * Sensitivity metric: top1_flip_rate (RESEARCH §Pattern 3 recommendation)
 * Re-tune at v0.3 when corpus grows.
 */
export const HYBRID_WEIGHTS = {
  rerank: <tuned>,        // RENAMED from `cosine` per D-05
  recency: <tuned>,
  type_match: <tuned>,
  scope_match: <tuned>,
} as const;
```

**Notes:**
- KEEP VERBATIM: D-06 spells out the audit-comment text VERBATIM. The 5-line cross-phase-footgun warning ("v0.2 Phase 2: `rerank` weight values tuned against RAW COSINE...") is a BYTE-FROZEN contract — Phase 3 EXP-06 readers depend on it for understanding which score source feeds the rerank weight. Single-character drift breaks Phase 3 reading-comprehension.
- KEEP VERBATIM: the existing `as const` literal type. Phase 2's parameterization of `hybridRank` (RESEARCH §"Open Question 1") preserves this — the function default is still the const-typed literal.
- ADAPT: the literal MOVES from `packages/mcp-server/src/hybrid-rank.ts` (current location) to `shared/ai-config/src/index.ts` (per the RESEARCH §"Architectural Responsibility Map" entry "shared config (single source of truth for both Workers per ENG-25 convention)"). The `hybrid-rank.ts` file imports the constant rather than declaring it.
- AUTHORING: this file is on the "stays with Claude" list per D-19 + RESEARCH §"cf-code-assist Routing → Stay with Claude" — the audit-comment text encodes a Phase 2 → Phase 3 contract semantic. cf-code-assist routing here is forbidden.

---

### `packages/mcp-server/src/hybrid-rank.ts` (MODIFY — parameterize + rename)

**Analog (this file's own existing shape):** `packages/mcp-server/src/hybrid-rank.ts:77-133` — pure functional transform, immutable spreads, O(1) lookup map.

**Current signature and formula (KEEP STRUCTURALLY IDENTICAL per D-07):**

```typescript
export function hybridRank(
  matches: VectorizeMatches["matches"],
  blocks: LexicalSearchHit[],
  args: Partial<RecallInput>,
  now: number = Date.now(),
): LexicalSearchHit[] {
  // ...
  const cosine = match.score;
  const ageHours = Math.max(0, (now - block.created_at) / 3_600_000);
  const recency = Math.exp(-ageHours / (24 * 30));
  const type_match = args.types !== undefined && args.types.length > 0 && block.type !== null
    ? args.types.includes(block.type) ? 1 : 0 : 0;
  const scope_match = args.scope !== undefined ? (args.scope === block.scope ? 1 : 0) : 0;

  const _score =
    HYBRID_WEIGHTS.cosine * cosine +        // ← rename to HYBRID_WEIGHTS.rerank
    HYBRID_WEIGHTS.recency * recency +
    HYBRID_WEIGHTS.type_match * type_match +
    HYBRID_WEIGHTS.scope_match * scope_match;
  // ...
}
```

**Post-Phase-2 shape (per D-07 + RESEARCH §Pitfall 1 recommendation to parameterize on weights):**

```typescript
import { HYBRID_WEIGHTS } from "@engram/ai-config";        // moved per D-05

type HybridWeights = typeof HYBRID_WEIGHTS;

export function hybridRank(
  matches: VectorizeMatches["matches"],
  blocks: LexicalSearchHit[],
  args: Partial<RecallInput>,
  now: number = Date.now(),
  weights: HybridWeights = HYBRID_WEIGHTS,   // NEW — defaulted; zero behavior change to existing callers
): LexicalSearchHit[] {
  // ...
  const rerank = match.score;                              // local rename from `cosine`
  // recency / type_match / scope_match: unchanged
  const _score =
    weights.rerank * rerank +                              // was HYBRID_WEIGHTS.cosine * cosine
    weights.recency * recency +
    weights.type_match * type_match +
    weights.scope_match * scope_match;
  // ...
}
```

**Notes:**
- KEEP VERBATIM: the immutable-spread discipline (`ranked.push({ ...block, _score })`), the orphan-vector tolerance (`console.warn("hybrid-rank:orphan-vector", { id: match.id })` then `continue`), the O(1) lookup-map construction, the stable descending sort via `[...ranked].sort(...)`. These are documented contracts at lines 60–66 (immutability), 91–94 (orphan tolerance), 130–132 (stable sort).
- KEEP VERBATIM: the 30-day half-life decay formula `Math.exp(-ageHours / (24 * 30))` — spike-003 derivation (`SKILL.md` references this), not a tuning surface.
- ADAPT: import `HYBRID_WEIGHTS` from `@engram/ai-config` instead of declaring it locally. Export is removed from `hybrid-rank.ts`. Tests that imported `HYBRID_WEIGHTS` from `./hybrid-rank.js` update their import path.
- ADAPT (parameterization per RESEARCH §"Open Question 1"): add `weights = HYBRID_WEIGHTS` 5th parameter. The sweep test passes per-config weights; production callers pass nothing and get the same behavior. This is the cleanest way to support both the sweep AND single-source-of-truth.
- ADAPT (local variable rename): the `cosine` local variable becomes `rerank` to mirror the weight-key rename. The line `const cosine = match.score;` becomes `const rerank = match.score;`. RESEARCH §"Claude's Discretion" explicitly permits this rename.
- VALIDATION: the existing test file `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` (4.7K, already in repo) asserts exact weight values. That test MUST update to match the renamed key + the new default-weights behavior. The test's pre-existing structure (asserting weighted sums of contrived `match.score`+`block.created_at` combinations) survives the rename unchanged.

---

### `packages/mcp-server/src/tools.ts` recall handler (MODIFY — D-09 + CON-05)

**Analog (this file's own existing shape):** `tools.ts:530-625` (recall handler, AI-04 steps 1–5).

**Existing pattern to modify** (`tools.ts:556-596`):

```typescript
// === AI-04 Step 2: Vectorize query in workspace namespace (AI-02 isolation via helper) ===
const fetchSize = topK * VECTORIZE_OVERFETCH_FACTOR;
const result = await vectorizeQuery(env, props.workspace_id, queryVector, {
  topK: fetchSize,
  ...(args.types?.length ? { filter: { type: { $in: args.types } } } : {}),
  returnMetadata: "all",
});

const filteredMatches = result.matches
  .filter((m) => m.score >= MIN_COSINE_THRESHOLD)
  .slice(0, topK);

writeAnalytics(env, { blobs: ["mcp-server", "vectorize-query", wsTag, vectorizeQueryOutcome], ... });

// === AI-04 Step 3: hydrate full blocks from SQLite (cold_storage excluded by getBlocksByIds) ===
const ids = filteredMatches.map((m) => m.id);
const blocks = await stub.getBlocksByIds({ workspace_id: props.workspace_id, ids });

// === AI-04 Step 4: hybrid re-rank (spike-validated formula) ===
const ranked = hybridRank(filteredMatches, blocks, args, Date.now());
```

**D-09 modification (one-line import swap):**

```typescript
// BEFORE: import { vectorizeQuery } from "./vectorize-helper.js";
// AFTER:  import { vectorizeQuery } from "@engram/vectorize-utils";
```

**CON-05 modification (NEW — populate `EngramResponse.context.conflicts[]`):**

```typescript
// === CON-05 Step (NEW, after Step 4 hybridRank): join inbox for conflicts ===
const recallIds = ranked.map((r) => r.id);
const inboxConflicts = await stub.listInboxConflictsForMemoryIds({
  workspace_id: props.workspace_id, ids: recallIds,
});
// Map InboxConflictRow → Conflict (Phase 2 mapping rule per RESEARCH §"Pattern 6"):
const conflicts: Conflict[] = inboxConflicts.map((row) => {
  const props_parsed = JSON.parse(row.proposed_properties);
  const memA_age = ranked.find((b) => b.id === props_parsed.memory_a_id)?.created_at ?? row.created_at;
  const memB_age = ranked.find((b) => b.id === props_parsed.memory_b_id)?.created_at ?? row.created_at;
  const diffDays = Math.abs(memA_age - memB_age) / (1000 * 60 * 60 * 24);
  const severity: "low" | "medium" | "high" = diffDays > 180 ? "low" : "high";  // CON-06 + CD-5
  return {
    id: row.id,
    memory_a_id: props_parsed.memory_a_id,
    memory_b_id: props_parsed.memory_b_id,
    description: props_parsed.description,
    severity, detected_at: row.created_at, resolved_at: null,
  };
});

// `buildRecallResponse` extension point — pass `conflicts` into the envelope's context:
// envelope.context.conflicts = conflicts.length > 0 ? conflicts : undefined;
```

**Notes:**
- KEEP VERBATIM: the AI-04 step-numbered comments — they're part of the Phase 5 narrative thread; Phase 2 ADDS a CON-05 step, doesn't renumber.
- KEEP VERBATIM: every Analytics Engine `writeAnalytics({ blobs: [...], doubles: [...], indexes: [...] })` call — the 4-blob / 4-double / 1-index schema is AI-SPEC §7 byte-frozen (`analytics.ts:36-47`).
- KEEP VERBATIM: `props.workspace_id` (NEVER `args.workspace_id`) for cross-workspace isolation. RESEARCH §"V4 Access Control" cites this for every helper that touches a workspace boundary.
- ADAPT: the `Conflict` type is imported from `@engram/types` (already declares the field at `shared/types/src/index.ts:172-192`). Phase 2 POPULATES, doesn't redefine.
- ADAPT: severity computation happens at READ time inside the recall handler (per RESEARCH §"Pattern 6"). The inbox row stores raw fields only; severity is derived per-request from the age-diff of memory_a / memory_b.
- AUTHORING: this is on the "stays with Claude" list per D-19 — cross-file SYNTHESIS (Q1=Y) touching recall handler + buildRecallResponse + new WorkspaceDO read helper + Conflict type + InboxConflictProperties mapping.

---

### `docs/hybrid-rank-changelog.md` (NEW — D-21 row schema)

**Analog:** No prior `docs/*.md` exists; `docs/` currently contains only `architecture.svg`. Closest markdown precedents are `.planning/research/v0.2-SUMMARY.md` (table-driven prose convention) and `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` (append-only-with-schema convention).

**D-21 row schema (verbatim from CONTEXT.md):**

```markdown
# Hybrid-Rank Weight Tuning Changelog

> Append-only. One row per `HYBRID_WEIGHTS` re-tune. The schema reflects every
> dimension a future reviewer needs to reproduce the sweep result. New rows
> append below the table footer; do NOT edit historical rows.

| date | corpus_filename | corpus_size | corpus_split | embedding_model | weights {rerank, recency, type_match, scope_match} | F1_train | F1_validate | MRR_train | top1_train | sensitivity_pass_rate | sensitivity_metric | bge_reranker_active | notes |
|------|-----------------|-------------|--------------|-----------------|----------------------------------------------------|----------|-------------|-----------|------------|-----------------------|--------------------|---------------------|-------|
| 2026-06-XX | recall-corpus.json | 100 | 70/30 | @cf/qwen/qwen3-embedding-0.6b | {X, X, X, X} | X.XX | X.XX | X.XX | X.XX | XX% | top1_flip_rate | false | First v0.2 tune; D-15 dual-corpus gate passed |
```

**Notes:**
- KEEP VERBATIM: the 14-column row schema from D-21 — these columns are the contract Phase 3 + v0.3 readers consume.
- KEEP VERBATIM: `bge_reranker_active: false` for the v0.2 row. Phase 3 EXP-06 sets to `true` per CONTEXT.md `<deferred>` section.
- ADD: the `sensitivity_metric` column was added during research (RESEARCH §"Pattern 3" + §"Assumptions A5") to document whether the row used `top1_flip_rate` or `kendall_tau_top3`. D-21 listed `sensitivity_pass_rate` only; the planner should choose whether to add the metric-name column or fold it into `notes`.
- ADAPT: this is a Markdown table, not a code file. The cf-code-assist routing decision per D-19 routes initial creation to `generateDocs` (Q1=N, Q2=N, Q3=Y); but the seed row's actual numbers depend on sweep results, which Claude reads from the test output. Net: the FILE SCAFFOLD routes to `generateDocs`; the FIRST ROW VALUES are Claude-authored.

---

### `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` (NEW)

**Analog (CANONICAL — copy verbatim with phase-number swap):** `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` (entire file, 55 lines).

**Header swap pattern** — Phase 1 file lines 1–8 verbatim with substitutions:

```markdown
# Phase 2 — cf-code-assist Routing Tracker (v0.2 milestone)

> Tracks every code-generation decision during Phase 2 execution so we can measure how often the Cloudflare Workers AI (qwen3-30b-a3b-fp8) MCP route was viable vs. when Claude handled it directly.
>
> **Scope:** Active for Phase 2 execution only. Stop logging when `/gsd:verify-work 2` passes.
>
> **Why it matters:** Phase 2 is the Recall Quality Baseline phase (RNK + CON workstreams). Phase character per CLAUDE.md heuristic: "contract-integration" (CON workstream) + "content-generation" (RNK sweep + workspace package). Expected routing mix: 15–30% cf-code-assist (mixed character — higher than Phase 1's <10% foundation, lower than Phase 5's 40–60% AI-integration).
```

**Sections 2-4 (KEEP VERBATIM — these are the heart of the routing discipline):**
- Instructions for the executor (Phase 1 lines 11–24)
- 3-Question Checklist (Phase 1 lines 27–37)
- Routing Log table header (Phase 1 lines 41–45)

**Notes:**
- KEEP VERBATIM: the seed row `| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |` — Phase 1 / Phase 4 / Phase 5 all use this exact placeholder.
- ADAPT: phase number throughout (1 → 2). Scope statement changes from "foundation" to "Recall Quality Baseline (RNK + CON)". Stop-trigger references `/gsd:verify-work 2`.
- ADAPT: expected routing mix changes (<10% → 15–30%) per CLAUDE.md "Phase character heuristic" + Phase 2 mixed character.
- ADAPT: pre-populate D-19's 5 candidate cf-code-assist task shapes as guidance rows above the seed (sync-eval-corpus.mjs, sweep test scaffold, vectorize-utils package skeleton, hybrid-rank-changelog.md scaffold, insertConflictAsInbox helper) — but as planning guidance only; actual rows append at execute-phase kickoff.

---

### `packages/triage-worker/src/conflict-pipeline.ts` (NEW orchestrator)

**Primary analog (orchestration shape):** `packages/triage-worker/src/index.ts:200-298` (queue-consumer `store-normal` / `inbox` / `cold-storage` branching pattern).

**Secondary analog (call signature for `detectConflict`):** `packages/triage-worker/src/conflict-detection.ts:138-179`:

```typescript
export async function detectConflict(
  env: { AI: Ai },
  memoryA: string,
  memoryB: string,
): Promise<ConflictOutput | null> {
  // returns null on AI error / zod-parse failure — never throws (eval-friendly contract)
}
```

**Tertiary analog (analytics emission):** `packages/triage-worker/src/analytics.ts:60-102`:

```typescript
export async function workspaceTag(workspaceId: string): Promise<string> {
  const data = new TextEncoder().encode(workspaceId);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function writeAnalytics(
  env: { ANALYTICS?: AnalyticsEngineDataset },
  datapoint: AnalyticsDataPoint,
): void {
  if (env.ANALYTICS === undefined) return;     // dev / tests — no-op
  try { env.ANALYTICS.writeDataPoint({ blobs: [...datapoint.blobs], doubles: [...datapoint.doubles], indexes: [...datapoint.indexes] }); }
  catch (err) { console.warn("analytics:write-failed", { err: err instanceof Error ? err.message : String(err) }); }
}
```

**`conflictPipeline` skeleton (RESEARCH §"Code Examples → Conflict-pipeline orchestrator"):**

```typescript
import { detectConflict } from "./conflict-detection.js";
import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { writeAnalytics, workspaceTag } from "./analytics.js";

const ANALYTICS_ENV_TAG = "engram-prod" as const;
const CONFLICT_COSINE_FLOOR = 0.7;       // CON-02 prefilter threshold
const CONFLICT_DUPE_CEILING = 0.92;      // CON-06 (PITFALLS CD-4 dupe defense)
const CONFLICT_PER_WRITE_BUDGET = 3;     // CON-07 cap

export async function conflictPipeline(
  env: { AI: Ai; VECTORIZE: VectorizeIndex; WORKSPACE: DurableObjectNamespace;
        ANALYTICS?: AnalyticsEngineDataset },
  newBlock: { id: string; workspace_id: string; type: string; scope: string;
              content: string; embedding: number[]; created_at: number },
): Promise<void> {
  const start = Date.now();
  const wsTag = await workspaceTag(newBlock.workspace_id);
  let neighborsExamined = 0;
  let verdict: "contradiction" | "benign_update" | "unrelated" | "skipped-dupe" | "error" = "unrelated";

  try {
    // Step 1: cosine prefilter (CON-02).
    const neighbors = await vectorizeNeighbors(env, newBlock.workspace_id, newBlock.embedding, {
      topK: CONFLICT_PER_WRITE_BUDGET, type: newBlock.type, scope: newBlock.scope,
      threshold: CONFLICT_COSINE_FLOOR,
    });
    neighborsExamined = neighbors.length;
    if (neighbors.length === 0) { verdict = "unrelated"; return; }

    // Step 2: cosine-ceiling dupe filter (CON-06).
    const candidates = neighbors.filter((n) => n.score < CONFLICT_DUPE_CEILING);
    if (candidates.length === 0) { verdict = "skipped-dupe"; return; }

    // Step 3: hydrate neighbor blocks.
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id));
    const neighborBlocks = await stub.getBlocksByIds({
      workspace_id: newBlock.workspace_id, ids: candidates.map((n) => n.id),
    });

    // Step 4: bounded-parallel detectConflict (≤3 per write, CON-07).
    const detections = await Promise.all(
      neighborBlocks.map((neighbor) =>
        detectConflict(env, newBlock.content, neighbor.content)
          .then((out) => ({ neighbor, out }))
      ),
    );

    // Step 5: write contradiction verdicts to inbox.
    for (const { neighbor, out } of detections) {
      if (out?.category !== "contradiction") continue;
      await stub.insertConflictAsInbox({
        workspace_id: newBlock.workspace_id,
        memory_a_id: newBlock.id, memory_b_id: neighbor.id,
        category: "contradiction",
        ai_confidence: out.confidence, description: out.reason,
      });
    }

    verdict = detections.some((d) => d.out?.category === "contradiction") ? "contradiction" : "benign_update";
  } catch (err) {
    console.error("conflict-pipeline:failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    verdict = "error";
  } finally {
    // Step 6: D-20 analytics — emit even on error.
    writeAnalytics(env, {
      blobs: ["conflict-pipeline", verdict, wsTag, verdict === "error" ? "failed" : "ok"],
      doubles: [Date.now() - start, neighborsExamined, 0, verdict === "error" ? 1 : 0],
      indexes: [ANALYTICS_ENV_TAG],
    });
  }
}
```

**Notes:**
- KEEP VERBATIM: `writeAnalytics(env, { blobs: [4-tuple], doubles: [4-tuple], indexes: [1-tuple] })` — AI-SPEC §7 byte-frozen 4/4/1 slot schema (`analytics.ts:36-47`). Phase 2 D-20 specifies `blobs[0]="conflict-pipeline"`, `blobs[1]=verdict`, `doubles[0]=latency_ms`, `doubles[1]=neighbors_examined` — the remaining slots (`blobs[2]=wsTag`, `blobs[3]=outcome`, `doubles[2]=0`, `doubles[3]=error_flag`) preserve the schema.
- KEEP VERBATIM: `try { ... } catch (err) { console.error(...); verdict = "error"; } finally { writeAnalytics(...); }` — RESEARCH §Pitfall 6 makes this mandatory. Analytics emitted inside the function body (which runs inside `ctx.waitUntil`), NEVER extracted to a sibling fire-and-forget.
- KEEP VERBATIM: the workspaceTag SHA-256 prefix discipline — RAW workspace_id never logged (PII per `analytics.ts:21-22`).
- ADAPT: the orchestrator is structurally NEW but composes 3 existing patterns. No raw `env.VECTORIZE.query` (forbidden by AI-02 lint gate); always via `vectorizeNeighbors`.
- ADAPT: stub typing — the triage-worker uses cross-Worker stub access through `env.WORKSPACE` (the `script_name: engram-mcp-server` cross-Worker binding established in Phase 1 / Phase 5). `insertConflictAsInbox` + `getBlocksByIds` are RPC methods on the WorkspaceDO; type-cast pattern from `triage-worker/src/index.ts:222-242` should be reused (see `as unknown as { updateBlockEnrichment: (...) => Promise<void> }`).
- AUTHORING per D-19: cross-file SYNTHESIS (Q1=Y) — touches conflict-detection contract + vectorize-utils contract + WorkspaceDO RPC contract + Analytics Engine schema. **Stays with Claude.**

---

### `packages/triage-worker/src/index.ts` (MODIFY — CON-03 single-line insertion)

**Analog (this file's own existing shape):** `triage-worker/src/index.ts:214-242` (the `store-normal` branch after `updateBlockEnrichment`).

**Existing pattern (KEEP VERBATIM SURROUNDING CODE):**

```typescript
case "store-normal":
  await (stub as unknown as {
    updateBlockEnrichment: (args: { /* ... */ }) => Promise<void>;
  }).updateBlockEnrichment({
    workspace_id: event.workspace_id,
    block_id: event.id,
    properties: parsed.extracted_fields,
    summary: parsed.summary,
    confidence: parsed.confidence,
    type: parsed.classified_type,
  });
  // ← CON-03 INSERTION POINT: ctx.waitUntil(conflictPipeline(env, {
  //     id: event.id, workspace_id: event.workspace_id, type: parsed.classified_type,
  //     scope: event.scope ?? "personal", content: event.content,
  //     embedding: parsed.embedding, created_at: Date.now(),
  //   }));
  break;
```

**Secondary analog (`ctx.waitUntil` precedent):** `packages/mcp-server/src/tools.ts:448-474` — established `ctx.waitUntil(env.QUEUE.send(...))` pattern for fire-and-forget post-write side-effects.

**Notes:**
- KEEP VERBATIM: the entire surrounding switch/case structure — Phase 2 inserts ONE line, no refactor.
- KEEP VERBATIM: the `await updateBlockEnrichment(...)` call comes FIRST. The conflict pipeline runs ONLY after the new block exists in SQLite (no race window).
- ADAPT: `ctx.waitUntil(conflictPipeline(env, { ... }))` is INSIDE the `case "store-normal"` block, after the `await updateBlockEnrichment(...)` call, before the `break`. The `ctx` reference must be available in this scope — verify against `triage-worker/src/index.ts` queue-consumer signature (typical Cloudflare Worker `queue(batch, env, ctx)` shape).
- ADAPT: the `embedding` field on `newBlock` requires `parsed.embedding` to be available. If the current `parsed` struct doesn't carry the embedding, the planner must either (a) recompute it here (NO — would double the AI budget), (b) extract it from a stage that already computed it (memorability/extraction step), or (c) re-Vectorize-query the just-written block by id. The first option is cleanest if `extractAndScore` already returns the embedding vector. Verify during execution; mention as a sub-plan in the CON workstream.

---

### `packages/triage-worker/src/__tests__/conflict-pipeline.test.ts` (NEW)

**Primary analog:** `packages/triage-worker/src/__tests__/extract.test.ts` (closest sibling — same harness, `import { env } from "cloudflare:workers"`, `vi.spyOn` patterns).

**Pattern excerpt for harness shape** (from the existing eval-test conventions):

```typescript
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { conflictPipeline } from "../conflict-pipeline.js";

describe("CON-02 conflict-pipeline orchestration", () => {
  it("skips when no neighbors above threshold (verdict=unrelated)", async () => {
    // mock vectorizeNeighbors to return []
    // assert no detectConflict calls, no inbox writes, analytics row with verdict="unrelated"
  });

  it("skips dupes above 0.92 cosine ceiling (verdict=skipped-dupe, CON-06)", async () => {
    // mock vectorizeNeighbors → matches with score 0.95
    // assert no detectConflict calls, analytics verdict="skipped-dupe"
  });

  it("writes contradiction verdicts to inbox (CON-04)", async () => {
    // mock detectConflict → { category: "contradiction", confidence: 0.9, reason: "..." }
    // assert exactly one stub.insertConflictAsInbox call with shape matching CON-04
  });

  it("bounded-parallel ≤3 detectConflict calls per write (CON-07)", async () => {
    // mock vectorizeNeighbors → 3 matches
    // assert exactly 3 detectConflict invocations, all via Promise.all (not sequential)
  });

  it("emits analytics row even on error (CON-08 observability)", async () => {
    // mock detectConflict to throw
    // assert analytics row with verdict="error"
  });
});
```

**Notes:**
- KEEP VERBATIM: the `import { env } from "cloudflare:workers"` + `vi.spyOn` pattern. Test runs in the `workerd` project; budget setup file is NOT loaded (this is unit + integration, not eval-tier).
- KEEP VERBATIM: each test's `describe`-name uses the requirement ID prefix (`CON-02`, `CON-04`, etc.) — matches Phase 1's RNK/CON requirement-ID-in-test-name convention from `recall-f1.eval.test.ts:91`.
- ADAPT: the tests mock `vectorizeNeighbors` (via `vi.mock("@engram/vectorize-utils", ...)` or via passing a stub env) and `detectConflict` (via vi.spyOn on its module export). The conflict-pipeline's purity (no direct env.AI / env.VECTORIZE access) makes mocking straightforward.

---

### `packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts` (EXTEND)

**Analog (this file's own existing shape):** `packages/triage-worker/src/__tests__/evals/conflict-precision.eval.test.ts:76-176`.

**Existing constants (MODIFY)** — `conflict-precision.eval.test.ts:73-85`:

```typescript
const SHIP_PRECISION_THRESHOLD = 0.9;          // ← raise per CON-01: 0.85
const SUGGEST_PRECISION_THRESHOLD = 0.7;       // ← drop; CON-01 has no "suggest" branch
// ADD: const SHIP_RECALL_THRESHOLD = 0.90;

type Verdict = "ship-per-write" | "ship-as-suggestions" | "defer-to-batch";

function decisionFor(precision: number): Verdict {
  if (precision >= SHIP_PRECISION_THRESHOLD) return "ship-per-write";
  if (precision >= SUGGEST_PRECISION_THRESHOLD) return "ship-as-suggestions";
  return "defer-to-batch";
}
```

**Existing test (MODIFY — unskip + raise thresholds)** — `conflict-precision.eval.test.ts:92-175`:

```typescript
// BEFORE:
it.skip("meets the v0.2 per-write precision gate on the labeled corpus", async () => { ... });

// AFTER (per CON-01 + D-18):
it("CON-01: 30-pair eval P≥0.85 R≥0.90 before wiring", async () => {
  // ... existing TP/FP/TN/FN loop unchanged ...

  if (isFullCorpus) {
    expect(precision).toBeGreaterThanOrEqual(0.85);
    expect(recall).toBeGreaterThanOrEqual(0.90);
  } else {
    expect(nulls).toBeLessThan(pairs.length);   // seed-run-only sanity
  }
}, 600_000);
```

**Notes:**
- KEEP VERBATIM: the precision/recall computation (`tp / (tp + fp)`, `tp / (tp + fn)`), the confusion matrix, the `it.skip` → `it` toggle, the 600s timeout (`600_000`). The math + harness shape are correct per CON-01 contract.
- KEEP VERBATIM: the verdict console.log lines + the `failures` debug array — these surface misclassifications for D-18's re-prompt loop.
- ADAPT: the `SHIP_PRECISION_THRESHOLD` constant value changes (0.9 → 0.85 per CON-01). The `SUGGEST_PRECISION_THRESHOLD` may stay for legacy reporting (the verdict function still uses it) or be deleted — CON-01 has no "ship-as-suggestions" branch; the precision/recall double-gate is binary pass/fail.
- ADAPT: ADD a recall threshold + assertion. The existing test only asserts precision; CON-01 requires BOTH.
- ADAPT: D-18 failure procedure — if either threshold fails on `isFullCorpus`, the executor STOPS + logs a `gsd-add-blocker`-style blocker on the Linear sub-issue + `/clear`s + `/gsd:plan-phase 2 --replan-section conflict-prompt`. The test itself does not implement this orchestration (test just throws on assertion failure); the workflow is encoded in the PLAN.md action section.

---

### `packages/workspace-do/src/queries.ts` (MODIFY — add 2 helpers)

**Primary analog (writer):** `createInboxEntry` (`queries.ts:480-491`):

```typescript
export function createInboxEntry(sql: SqlStorage, entry: InboxEntry): void {
  sql.exec(
    "INSERT OR IGNORE INTO inbox (id, content, proposed_type, proposed_properties, memorability_score, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    entry.id,
    entry.content,
    entry.proposed_type,
    entry.proposed_properties === null ? null : JSON.stringify(entry.proposed_properties),
    entry.memorability_score,
    entry.source,
    entry.created_at,
  );
}
```

**Secondary analog (reader):** `listConflicts` (`queries.ts:511-530`):

```typescript
export function listConflicts(
  sql: SqlStorage,
  opts: { resolved?: boolean; limit?: number } = {},
): Conflict[] {
  let query =
    "SELECT id, memory_a_id, memory_b_id, description, severity, detected_at, resolved_at FROM conflicts";
  if (opts.resolved === true) query += " WHERE resolved_at IS NOT NULL";
  else if (opts.resolved === false) query += " WHERE resolved_at IS NULL";
  query += " ORDER BY detected_at DESC";
  const rows = opts.limit !== undefined
    ? sql.exec(query + " LIMIT ?", opts.limit).toArray()
    : sql.exec(query).toArray();
  return rows.map((row) => narrowConflictRow(row as Record<string, SqlStorageValue | undefined>));
}
```

**New writer (CON-04, per RESEARCH §"Code Examples → insertConflictAsInbox helper"):**

```typescript
export function insertConflictAsInbox(
  sql: SqlStorage,
  args: {
    memory_a_id: string;
    memory_b_id: string;
    category: "contradiction";
    ai_confidence: number;
    description: string;
  },
): void {
  const id = `conflict-${crypto.randomUUID()}`;
  const proposedProperties = JSON.stringify({
    memory_a_id: args.memory_a_id,
    memory_b_id: args.memory_b_id,
    category: args.category,
    ai_confidence: args.ai_confidence,
    description: args.description,
  });
  sql.exec(
    `INSERT OR IGNORE INTO inbox
       (id, content, proposed_type, proposed_properties, memorability_score, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    args.description,              // content = description for grep-ability
    "conflict",                    // proposed_type — the CON-05 join key
    proposedProperties,
    args.ai_confidence,            // memorability_score slot reused for AI confidence
    "triage:conflict-pipeline",    // source
    Date.now(),
  );
}
```

**New reader (CON-05, per RESEARCH §"Pattern 6" Option A):**

```typescript
interface InboxConflictRow {
  id: string;
  proposed_properties: string;
  created_at: number;
}

export function listInboxConflictsForMemoryIds(
  sql: SqlStorage,
  ids: string[],
): InboxConflictRow[] {
  if (ids.length === 0) return [];
  const rows = sql.exec(
    `SELECT id, proposed_properties, created_at
       FROM inbox
      WHERE proposed_type = 'conflict'
        AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 100`,
    Date.now() - 60 * 24 * 3600 * 1000,    // 60-day window
  ).toArray();
  return rows
    .filter((r) => {
      try {
        const props = JSON.parse(r.proposed_properties as string);
        return ids.includes(props.memory_a_id) || ids.includes(props.memory_b_id);
      } catch { return false; }
    })
    .map((r) => ({
      id: r.id as string,
      proposed_properties: r.proposed_properties as string,
      created_at: r.created_at as number,
    }));
}
```

**Notes:**
- KEEP VERBATIM: `INSERT OR IGNORE INTO inbox (...) VALUES (?, ?, ?, ?, ?, ?, ?)` — the at-least-once delivery safety from `createInboxEntry` carries through (Phase 6 PIP-03 / IP-1 discipline at `queries.ts:472-478`). Conflict pipeline is fire-and-forget; idempotency matters.
- KEEP VERBATIM: positional `?` placeholders — no string interpolation, no named params. RESEARCH §Pitfall 8 + every existing helper at the top of `queries.ts` follows this.
- KEEP VERBATIM: the comment block on `listConflicts:506-509` ("SQL construction note: the conditional WHERE arm is appended as a STATIC string...") sets the precedent for SQL-injection discipline. `listInboxConflictsForMemoryIds` uses the same posture — its only bound parameter is the bounded-window timestamp.
- ADAPT: `crypto.randomUUID()` for the `conflict-${uuid}` id — Web Crypto is available on workerd; `nanoid` is not in tree.
- ADAPT: 60-day window + LIMIT 100 — RESEARCH §"Pattern 6 Option A" rationale. Phase 2 ships Option A (TS-side JSON.parse filter); Option B (SQLite `json_extract`) deferred per RESEARCH §"Assumptions A3".
- ADAPT: the TS-side `JSON.parse(...)` is wrapped in try/catch — Phase 2 Pitfall 5 (envelope mapping drift) defense. Malformed rows are silently skipped rather than throwing.

---

### `packages/workspace-do/src/index.ts` (MODIFY — add 2 RPC methods)

**Analog (this file's own existing shape):** `workspace-do/src/index.ts:172-215` (every RPC method follows the same 3-line body shape).

**Existing pattern (KEEP VERBATIM):**

```typescript
createInboxEntry(args: { workspace_id: string; entry: InboxEntry }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  createInboxEntryQuery(this.ctx.storage.sql, args.entry);
}

listConflicts(args: { workspace_id: string; resolved?: boolean; limit?: number }): Conflict[] {
  this.assertOwnsWorkspace(args.workspace_id);
  const opts: { resolved?: boolean; limit?: number } = {};
  if (args.resolved !== undefined) opts.resolved = args.resolved;
  if (args.limit !== undefined) opts.limit = args.limit;
  return listConflictsQuery(this.ctx.storage.sql, opts);
}
```

**New RPC methods (mirror exactly):**

```typescript
insertConflictAsInbox(args: {
  workspace_id: string;
  memory_a_id: string;
  memory_b_id: string;
  category: "contradiction";
  ai_confidence: number;
  description: string;
}): void {
  this.assertOwnsWorkspace(args.workspace_id);
  insertConflictAsInboxQuery(this.ctx.storage.sql, {
    memory_a_id: args.memory_a_id, memory_b_id: args.memory_b_id,
    category: args.category, ai_confidence: args.ai_confidence,
    description: args.description,
  });
}

listInboxConflictsForMemoryIds(args: {
  workspace_id: string; ids: string[];
}): InboxConflictRow[] {
  this.assertOwnsWorkspace(args.workspace_id);
  return listInboxConflictsForMemoryIdsQuery(this.ctx.storage.sql, args.ids);
}
```

**Notes:**
- KEEP VERBATIM: `this.assertOwnsWorkspace(args.workspace_id)` is the FIRST executable line of every RPC method. STO-07 / T-05-01-STO07 discipline — no exceptions (Phase 1 PATTERNS.md §"Shared Patterns → STO-07" calls this out for every new RPC).
- KEEP VERBATIM: the queries.ts function is imported with a `Query` suffix to avoid shadowing (e.g., `listConflictsQuery`, `createInboxEntryQuery`). Phase 2 follows: `insertConflictAsInboxQuery`, `listInboxConflictsForMemoryIdsQuery`.
- KEEP VERBATIM: the `if (args.x !== undefined) opts.x = args.x;` conditional-spread for `exactOptionalPropertyTypes` discipline (cf. `listConflicts` RPC body lines 211–214).
- ADAPT: `InboxConflictRow` type is co-located with the query helper (NOT a separate shared/types export). The recall handler imports the type from the DO RPC stub interface — same pattern as `LexicalSearchHit` (queries.ts type, mcp-server consumer at `tools.ts:530`).
- ADAPT (security per RESEARCH §"V4 Access Control"): both methods reside INSIDE the WorkspaceDO scope; the cross-workspace DO routing is the partition boundary. Adding these RPC methods to the class registers them on the DO surface; they MUST NOT be registered as MCP tools (no `registerTool` call). Verify during execution via the existing `cross-workspace-pentest.test.ts` posture.

---

### `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` (NEW)

**Analog (closest sibling — there's no existing `integration/` subdir):** `packages/mcp-server/src/__tests__/tools-integration.test.ts` (top-level integration test, 34K; same workerd harness). Secondary: `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts`.

**Recommendation:** Phase 2 CREATES the `__tests__/integration/` subdir. The new file's harness shape mirrors the top-level integration tests:

```typescript
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";

describe("CON-05 recall envelope context.conflicts[] SQL-join", () => {
  it("returns empty conflicts[] when no inbox conflicts touch recalled memories", async () => {
    // seed workspace with 3 blocks, no inbox conflict rows
    // call recall(), assert envelope.context.conflicts === undefined OR []
  });

  it("populates conflicts[] when an inbox row links a recalled memory", async () => {
    // seed: blockA, blockB, plus an inbox row with proposed_type='conflict'
    //       AND proposed_properties.memory_a_id === blockA.id
    // call recall() with a query that returns blockA in ranked output
    // assert envelope.context.conflicts has 1 entry with severity='high' (180d default)
  });

  it("computes severity='low' when memory_a vs memory_b age diff > 180d (CON-06)", async () => {
    // seed: blockA (today), blockB (200 days ago), inbox conflict linking them
    // call recall(), assert envelope.context.conflicts[0].severity === 'low'
  });

  it("does not surface conflicts from sibling workspaces (V4 isolation)", async () => {
    // seed two workspaces with overlapping inbox rows; recall in ws-1
    // assert no leak from ws-2
  });
});
```

**Notes:**
- KEEP VERBATIM: the `import { env } from "cloudflare:workers"` + `runInDurableObject`-style seeding pattern from existing workspace-do unit tests (cf. Phase 1 PATTERNS.md §"embedding-version-audit.test.ts" excerpt at lines 218–256).
- KEEP VERBATIM: distinct workspace `idFromName(...)` per test (Phase 1 PATTERNS.md §"workspace-do unit-test harness" Pitfall 3 mitigation).
- ADAPT: this is an INTEGRATION test (multi-RPC interaction: `insertConflictAsInbox` + `recall()` handler + `listInboxConflictsForMemoryIds`). Lives in `__tests__/integration/` per the path requested in `02-VALIDATION.md`.
- ADAPT: the test must seed a Vectorize-backed corpus AND inbox rows. The Vectorize seeding is the hard part — RESEARCH §"Pattern 1" caching trick may not apply because this is an integration test (not eval-tier). Likely the test mocks `env.VECTORIZE.query` to return canned matches, bypassing the real binding. Document that decision in the planner's PLAN.md.

---

### `scripts/eval-budget-summary.mjs` (EXTEND — D-20 conflict-pipeline p99 mode)

**Analog (this file's own existing shape):** `scripts/eval-budget-summary.mjs:1-100` — arg parsing, env validation, GraphQL fetch.

**Existing arg-parse pattern (KEEP VERBATIM):**

```javascript
const args = argv.slice(2);
let sinceOverride = "";
let showHelp = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--since") sinceOverride = args[++i] ?? "";
  else if (a === "--help" || a === "-h") showHelp = true;
}
```

**D-20 extension:**

```javascript
// ADD a third flag:
let conflictPipelineP99 = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--since") sinceOverride = args[++i] ?? "";
  else if (a === "--conflict-pipeline-p99") conflictPipelineP99 = true;   // NEW
  else if (a === "--help" || a === "-h") showHelp = true;
}

// Mode dispatch:
if (conflictPipelineP99) {
  // Query Analytics Engine `aiInferenceAdaptive` for blobs[0]="conflict-pipeline" rows
  // Compute p99 of doubles[0] (latency_ms) over the window
  // Print markdown table: window, total_rows, p50, p99, error_rate (verdict="error" count)
  // Exit 0 if p99 < 4000 (CON-07 budget), exit 1 if over
}
```

**Notes:**
- KEEP VERBATIM: the env-validation (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID) — D-20 reuses the same GraphQL credentials. Exit code 2 on missing creds.
- KEEP VERBATIM: the `TAG = "[eval-budget-summary]"` log prefix — Phase 2 mode uses the same tag for consistency.
- ADAPT: D-20 specifies the analytics schema for conflict-pipeline rows — query filters on `blobs[0]="conflict-pipeline"` and aggregates p99 over `doubles[0]`. The GraphQL query shape is a near-clone of the existing `aiInferenceAdaptiveGroups` query but against the conflict-pipeline dataset.
- ADAPT: a NEW exit-code convention is reasonable — exit 1 on p99 > 4s (CON-07 budget breach). The existing script's exit codes (0 success / 1 GraphQL / 2 missing env) are mode-overloaded; document in the usage text.

---

## Shared Patterns

### Project instructions header (every PLAN.md must reference)

**Source:** `CLAUDE.md` (project root)
**Apply to:** All Phase 2 plans
**Rule:** Every PLAN.md must start with "Project instructions: Read ./CLAUDE.md" so spawned gsd-executor subagents inherit the Phase 2 CF-CODE-ASSIST tracker convention (D-19). The executor appends to `02-CF-CODE-ASSIST-USAGE.md`, NOT Phase 1's tracker.

### STO-07 / assertOwnsWorkspace discipline

**Source:** `packages/workspace-do/src/index.ts:148-155`
**Apply to:** Every new RPC method on `WorkspaceDO` (`insertConflictAsInbox`, `listInboxConflictsForMemoryIds`)
**Rule:** `this.assertOwnsWorkspace(args.workspace_id)` is the FIRST executable line of every RPC method. No exceptions.

```typescript
private assertOwnsWorkspace(workspaceId: string): void {
  if (this.ctx.id.name !== workspaceId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Workspace mismatch: DO bound to '${this.ctx.id.name ?? "<unnamed>"}' but request claims '${workspaceId}'`,
    );
  }
}
```

### AI-02 cross-workspace isolation lock

**Source:** `packages/mcp-server/src/vectorize-helper.ts:50-60` (`assertNamespace`)
**Apply to:** `shared/vectorize-utils/src/index.ts` (extracted), `packages/triage-worker/src/conflict-pipeline.ts` (new caller)
**Rule:** `workspaceId` is the SECOND positional argument of every Vectorize-touching helper. Non-optional. Validated synchronously BEFORE any async work. 64-byte UTF-8 byte-length cap.

### Eval-tier budget discipline

**Source:** `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts:47-110`
**Apply to:** `recall-ranking.eval.test.ts` (RNK-01 sweep), `conflict-precision.eval.test.ts` (CON-01 re-eval — unskipped)
**Rule:**
1. MAX_AI_CALLS = 200 is a literal constant. NEVER env-configurable. NEVER raised to make tests pass.
2. The counter is shared across files in the `eval` project (`isolate: false`, `singleWorker: true` per Phase 1 PRE-02).
3. Phase 2 RNK + CON eval suites MUST run as SEPARATE invocations (`02-VALIDATION.md` "Sampling Rate" — combined would consume ~230 AI calls).

### Analytics Engine 4/4/1 slot schema

**Source:** `packages/triage-worker/src/analytics.ts:36-47` + `tools.ts:537-541`
**Apply to:** `packages/triage-worker/src/conflict-pipeline.ts` (D-20 telemetry), `scripts/eval-budget-summary.mjs` (read side)
**Rule:** Every Analytics Engine datapoint uses exactly `blobs: [4-tuple]`, `doubles: [4-tuple]`, `indexes: [1-tuple]`. Schema-slot meaning is BYTE-FROZEN per AI-SPEC §7 — changing slot meaning breaks the analytics-queries.sql canonical queries.

### Workspace tag privacy (SHA-256 prefix)

**Source:** `packages/triage-worker/src/analytics.ts:60-68`
**Apply to:** `conflict-pipeline.ts` analytics emission
**Rule:** RAW workspace_id NEVER logged. The `workspaceTag()` helper computes `sha256(workspace_id).slice(0, 8 bytes → 16 hex chars)` for the `blobs[2]` privacy slot.

### `ctx.waitUntil()` fire-and-forget contract

**Source:** `packages/mcp-server/src/tools.ts:448-474` (established pattern); RESEARCH §Pattern 5
**Apply to:** `packages/triage-worker/src/index.ts` (CON-03 insertion), `conflict-pipeline.ts` body
**Rule:**
1. The waitUntil callback returns void. Failures are caught locally and logged via `console.error` + `writeAnalytics`. NEVER re-throw inside `waitUntil` — would mark the parent invocation as failed.
2. Analytics writes via `writeDataPoint` are non-blocking per AI-SPEC §7 (cited in `analytics.ts:79`).
3. Phase 2 keeps `writeAnalytics` calls INSIDE the conflict-pipeline function body. NOT extracted to a sibling fire-and-forget (RESEARCH §Pitfall 6).

### Vectorize filter syntax (Cloudflare docs verified via Context7)

**Source:** RESEARCH §"Pattern 4" verified facts (HIGH confidence)
**Apply to:** `vectorizeNeighbors` filter construction
**Rule:** Operators are `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`. Multi-key object = implicit logical AND. Compact JSON filter must be <2048 bytes. `topK ≤ 50` when `returnMetadata: "all"` (Pitfall 8). Vectorize has NO native score floor — client-side `.filter(m => m.score >= threshold)` is the only option.

### Secrets discipline (CI + scripts)

**Source:** `.github/workflows/ci.yml:111-119` + `scripts/eval-budget-summary.mjs:79-90`
**Apply to:** Any new script that may need CF tokens (only `scripts/sync-eval-corpus.mjs` if it ever fetches; Phase 2 sync is pure filesystem)
**Rule:**
1. Tokens read from env only. NEVER `console.log`.
2. Tokens NEVER positional argv. NEVER `set -x`.
3. Workflow-level `env:` block hoisting (Pitfall 7).
4. Fail loud on missing creds with `::error::` annotations (Pitfall 2).

### Lint-node-tier grep-gate harness

**Source:** `packages/mcp-server/src/__tests__/lint-no-direct-vectorize.test.ts:36-60`
**Apply to:** `ai-config-audit.test.ts` (RNK-05 / D-06), `no-proactive-notifications.test.ts` (CON-08) — both OPTIONAL
**Rule:**
1. Pure-Node `readFileSync` + recursive walk; runs in `lint-node` vitest project (no workerd dependency).
2. Comment-stripping is mandatory before grepping — false positives from JSDoc references are the standard failure mode.
3. Authorized files are exempted via filename match (e.g., `vectorize-helper.ts` for the direct-VECTORIZE gate; for CON-08, the exempt list might include `conflict-detection.ts` and `conflict-pipeline.ts` if the prompt strings legitimately mention notifications as out-of-scope).

### Schema-as-data: NEVER change the `inbox` / `conflicts` table shape in Phase 2

**Source:** `packages/workspace-do/src/schema.ts:122-142` + ROADMAP §"v0.2 introduces zero new npm dependencies and zero Vectorize index changes"
**Apply to:** all Phase 2 work
**Rule:** Phase 2 introduces no SQL migrations. The `inbox` table is reused (writer `proposed_type='conflict'`); the `conflicts` table remains UNUSED in v0.2 per CON-04 (reserved for the v0.3 `conflict()` MCP tool). `proposed_properties` is the JSON column that encodes the Phase 2 → Phase 2 mapping contract; the read side parses it back via JSON.parse.

### Audit-comment-as-contract

**Source:** `shared/ai-config/src/index.ts:96-113` (`MIN_COSINE_THRESHOLD` audit) + `EMBEDDING_MODEL` block at lines 53–62
**Apply to:** D-06 `HYBRID_WEIGHTS` audit comment authoring
**Rule:** Audit comments next to AI-config constants are BYTE-FROZEN contracts for downstream-phase readers. Phase 3 EXP-06 reads the `HYBRID_WEIGHTS.rerank` audit text to know which score source feeds the rerank weight; drift breaks cross-phase reading comprehension. cf-code-assist routing for these comments is forbidden per D-19.

### Single-source-of-truth for EMBEDDING_MODEL

**Source:** Phase 1 PATTERNS.md §"Shared Patterns → EMBEDDING_MODEL"; `shared/ai-config/src/index.ts:62`
**Apply to:** `recall-corpus-v2.json` header (`"embedding_model"` field), `recall-ranking.eval.test.ts` (fail-fast guard), `shared/vectorize-utils/src/index.ts` (no need to reference; helper does not embed)
**Rule:** NEVER re-declare the literal `"@cf/qwen/qwen3-embedding-0.6b"`. Always `import { EMBEDDING_MODEL } from "@engram/ai-config"`. The corpus header is the one exception (it's data, not code) but must match by exact string equality, verified at parse time.

### Vitest project-tier convention

**Source:** Phase 1 PATTERNS.md §"Vitest project-tier convention"; `packages/mcp-server/vitest.config.ts`
**Apply to:** New eval-tier test placement
**Rule:** Project names are stable identifiers consumed by CLI (`--project=workerd`, `--project=lint-node`, `--project=eval`). Phase 2 adds NO new projects — `recall-ranking.eval.test.ts` slots into the existing `eval` project via glob match; `conflict-pipeline.test.ts` slots into `workerd`; optional grep gates slot into `lint-node`.

### File-locking discipline for parallel tracker appends

**Source:** Phase 1 PATTERNS.md §"File-locking discipline"; established for `01-CF-CODE-ASSIST-USAGE.md`
**Apply to:** `02-CF-CODE-ASSIST-USAGE.md`
**Rule:** Append rows in a single `Edit` operation with explicit `oldString` matching the preceding row + the seed comment. NEVER multiple parallel `Edit`s to the same tracker file.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 2 file has at minimum a role-match analog in-repo. The weakest matches are: (a) `docs/hybrid-rank-changelog.md` — no prior `docs/*.md` exists, but D-21 spells out the schema verbatim; (b) `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — the `integration/` subdir does not yet exist, but `tools-integration.test.ts` provides the harness shape; (c) `scripts/sync-eval-corpus.mjs` — no prior cross-tree filesystem-copy mjs, but the CLI skeleton from `eval-budget-summary.mjs` + the JSON read/write pattern from `apply-split.mjs` compose cleanly. |

---

## Metadata

**Analog search scope:**
- `packages/mcp-server/src/` — `hybrid-rank.ts`, `vectorize-helper.ts`, `tools.ts` recall handler, `analytics.ts`, `__tests__/evals/`, `__tests__/integration/` (absent — Phase 2 creates)
- `packages/triage-worker/src/` — `index.ts` queue consumer (store-normal branch), `conflict-detection.ts`, `analytics.ts`, `__tests__/`, `__tests__/evals/`
- `packages/workspace-do/src/` — `queries.ts` (createInboxEntry + listConflicts + stampEmbedding), `index.ts` RPC methods, `schema.ts` inbox + conflicts table DDL
- `shared/` — `ai-config/`, `types/`, `schema/` (mirror sources for the new `vectorize-utils/` package shape)
- `scripts/` — `eval-budget-summary.mjs`, `kv-bootstrap.mjs`, `lint-wrangler.mjs`
- `.planning/evals/` — `recall-corpus.json` (authoritative source), `apply-split.mjs` (closest mjs precedent for JSON read/write)
- `.planning/phases/01-foundation-wave-0/` — `01-CF-CODE-ASSIST-USAGE.md` (canonical tracker copy source), `01-PATTERNS.md` (carry-forward conventions)
- `docs/` — only `architecture.svg`; no markdown precedents for changelog scaffold

**Files scanned:** ~28 source files + 6 planning artifacts

**Pattern extraction date:** 2026-06-05

## PATTERN MAPPING COMPLETE

**Phase:** 2 — Recall Quality Baseline
**Files classified:** 18 (RNK: 11, CON: 8, cross-cutting: 2; counts overlap because `tools.ts` modify rolls into both workstreams per D-09 + CON-05)
**Analogs found:** 18 / 18 — every file has at minimum a role-match analog

### Coverage
- Files with exact analog: 11 (vectorize-helper extraction, ai-config audit-comment extension, hybrid-rank in-file modifications, recall handler in-file modifications, conflict-precision.eval.test.ts unskip, queries.ts helper extensions, workspace-do RPC method extensions, scripts/eval-budget-summary.mjs extension, 02-CF-CODE-ASSIST-USAGE.md canonical copy, shared/vectorize-utils/package.json mirror, shared/vectorize-utils/tsconfig.json mirror)
- Files with role-match analog: 7 (recall-ranking.eval.test.ts harness, recall-corpus-v2.json vendor copy, sync-eval-corpus.mjs CLI skeleton, vectorize-utils/src/index.ts vectorizeNeighbors helper, hybrid-rank-changelog.md schema, conflict-pipeline.ts orchestrator composition, conflict-pipeline.test.ts harness, recall-conflicts.test.ts harness, optional grep gates)
- Files with partial / no analog: 0

### Key Patterns Identified
- Every Phase 2 deliverable composes existing in-repo primitives — no greenfield files. The closest thing to "new" is `conflict-pipeline.ts` which orchestrates 3 existing modules (`detectConflict`, `vectorizeNeighbors`, `writeAnalytics`) under a new top-level function.
- The `shared/<name>/` package shape is a verbatim mirror — `shared/ai-config/{package.json, tsconfig.json}` is the byte-frozen template for `shared/vectorize-utils/`.
- The `vectorizeQuery` mandatory-positional-`workspaceId` discipline (AI-02 compile-time defense) MUST be preserved on extraction — Pitfall 4 (Vectorize filter vs namespace confusion) is the catastrophic v0.4 multi-tenant risk.
- The `HYBRID_WEIGHTS` audit comment per D-06 is a BYTE-FROZEN cross-phase contract — Phase 3 EXP-06 readers depend on its verbatim text. cf-code-assist routing for this comment is forbidden.
- The `inbox` table is the conflict-write target in v0.2 (`proposed_type='conflict'`); the `conflicts` table stays UNUSED until v0.3's dedicated `conflict()` MCP tool ships. CON-04 + CON-05 encode this contract on both write and read sides.
- The CF-CODE-ASSIST tracker is a copy-and-rename operation against Phase 1's canonical instance; Phase 2's expected routing mix (15–30%) is higher than Phase 1's (<10%) due to mixed character (contract-integration on CON + content-generation on RNK).
- `ctx.waitUntil()` fire-and-forget is the established CON-03 wiring pattern; analytics emission stays INSIDE the pipeline function body (RESEARCH §Pitfall 6).
- The shared eval-budget counter across the `eval` vitest project means RNK + CON eval suites MUST run as separate invocations (~230 AI calls combined vs 200 budget) — `02-VALIDATION.md` Sampling Rate makes this explicit.

### File Created
`/Users/rmoore/Workspaces/engram/.planning/phases/02-recall-quality-baseline/02-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns by file:line in PLAN.md action sections. RNK workstream patterns (plans 02-01..02-N) land before CON workstream patterns (plans 02-(N+1)..02-M) in merge order per D-16.
