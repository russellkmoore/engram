# Phase 5: AI Integration — Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 35 (24 NEW · 11 MODIFY)
**Analogs found:** 33 / 35 (2 no-analog: `setup-vectorize.sh`, `evals/reference-corpus.json` fixture)

> Consumed by `gsd-planner` in the next step. Every NEW or MODIFIED file in Phase 5 is
> mapped to its closest existing-codebase analog. Each entry pulls 1–4 concrete excerpts
> (function shape, import block, test harness, wrangler binding) so the planner can write
> `<read_first>` + `<acceptance_criteria>` blocks that point at line ranges instead of
> saying "follow the pattern."
>
> **Critical conventions surfaced once here, referenced everywhere downstream:**
> 1. All DO RPC methods take `args: { workspace_id: string; ... }` as the first arg and call `this.assertOwnsWorkspace(args.workspace_id)` as the **first executable line** (STO-07 / `packages/workspace-do/src/index.ts:139–146,163–166,etc.`).
> 2. All MCP handler bodies read `workspace_id` from `props.workspace_id` (JWT-derived), **never** from `args` — enforced by the `T-03-DD-RT` regex in `tools.test.ts` and the `SENTINEL-DD-RT-PHASE-03-TOOLS-TS` anchor at `tools.ts:121`.
> 3. All handler error paths funnel through `mapToMcpError(err)` (`packages/mcp-server/src/error-mapping.ts`); pass-through preserves the STO-07 `McpError(InvalidRequest)` unchanged.
> 4. Every test file imports from `cloudflare:test` (`runInDurableObject`) and `cloudflare:workers` (`env`); `@cloudflare/vitest-pool-workers` resolves bindings from `wrangler.test.jsonc`, NOT production `wrangler.jsonc`.
> 5. Test files live in `src/__tests__/` for `mcp-server` and `workspace-do`. The Phase 5 hand-off file list says `packages/<pkg>/__tests__/` (top-level); the planner MUST normalize to `packages/<pkg>/src/__tests__/` to match the existing two packages. The new triage-worker tests follow the same convention.
> 6. `wrangler.jsonc` files are linted by `scripts/lint-wrangler.mjs` (FND-08). The `.test.jsonc` suffix opts out of the lint; mirror the dual-file split (`wrangler.jsonc` + `wrangler.test.jsonc`) when adding bindings.
> 7. SQLite migrations are forward-only via the `_schema_migrations` table; append a new `Migration` entry to `MIGRATIONS` const, do NOT modify `V1_SQL`. Each `sql.exec()` is implicitly atomic; no `BEGIN`/`COMMIT`.
> 8. META_GAPS strings are byte-frozen (`__snapshots__/envelope.test.ts.snap`); new strings must be added to `META_GAPS.recall` array, NOT inlined in handlers.

---

## File Classification

### NEW files (24)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `packages/mcp-server/src/vectorize-helper.ts` | helper (binding wrapper) | request-response (sync I/O) | `packages/mcp-server/src/error-mapping.ts` | role-match (single-purpose wrapper module shape) |
| `packages/mcp-server/src/ai-helper.ts` | helper (binding wrapper) | request-response | `packages/mcp-server/src/error-mapping.ts` | role-match (same shape) |
| `packages/mcp-server/src/hybrid-rank.ts` | utility (pure transform) | transform | `packages/mcp-server/src/envelope.ts` `dropMemoryField`/`dropLastMemory` (lines 357–387) | role-match (pure functional transform over memories) |
| `packages/mcp-server/src/__tests__/vectorize-helper.test.ts` | test (unit, mocked binding) | request-response | `packages/mcp-server/src/__tests__/error-mapping.test.ts` (structure) + `tools-integration.test.ts` (env spy pattern) | role-match |
| `packages/mcp-server/src/__tests__/ai-helper.test.ts` | test (unit, mocked binding) | request-response | same as vectorize-helper.test.ts | role-match |
| `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` | test (pure unit) | transform | `packages/mcp-server/src/__tests__/envelope.test.ts` (pure-function describe pattern) | exact |
| `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | test (eval) | batch | `packages/mcp-server/src/__tests__/envelope.test.ts` (describe/it format) + Wave 5 NEW pattern | role-match (no eval analog yet) |
| `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` | test fixture | data | none — first eval fixture | no-analog |
| `packages/triage-worker/src/extract.ts` | queue-consumer body | event-driven (Queue + async AI) | `packages/mcp-server/src/tools.ts` `recall` handler body (lines 226–252) — closest async-binding-call shape + try/catch + 3-step pipeline | role-match (different runtime: Queue consumer vs MCP handler) |
| `packages/triage-worker/src/memorability.ts` | utility (routing predicate) | transform | `packages/mcp-server/src/envelope.ts` `hasMemoriesArray` (lines 344–351) (single-purpose discriminator) | role-match |
| `packages/triage-worker/src/schemas.ts` | schema (zod) | structural | `packages/mcp-server/src/schemas.ts` (entire file shape) | exact |
| `packages/triage-worker/src/prompts.ts` | constant module | static | `packages/mcp-server/src/envelope.ts` `META_GAPS` (lines 56–80) — frozen-string-const pattern | role-match |
| `packages/triage-worker/src/ai-helper.ts` | helper (binding wrapper) | request-response | `packages/mcp-server/src/ai-helper.ts` (sibling NEW file in Wave 1) + `packages/mcp-server/src/error-mapping.ts` (module shape) | role-match (sibling — shares model-id constants exactly) |
| `packages/triage-worker/src/__tests__/extract.test.ts` | test (unit, mocked + 429 paths) | request-response | `packages/mcp-server/src/__tests__/tools-integration.test.ts` (call-then-assert-envelope pattern) | role-match |
| `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts` | test (eval) | batch | `packages/mcp-server/src/__tests__/envelope.test.ts` (test-shape) | role-match |
| `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` | eval config (Promptfoo) | batch | none in repo — first promptfoo file | no-analog |
| `packages/triage-worker/vitest.config.ts` | config | n/a | `packages/mcp-server/vitest.config.ts` (entire file) | exact |
| `packages/triage-worker/wrangler.test.jsonc` | config (wrangler test) | n/a | `packages/mcp-server/wrangler.test.jsonc` (entire file) | exact |
| `scripts/setup-vectorize.sh` | setup script | one-shot CLI | none — first shell-script provisioning artifact | no-analog (use Vectorize docs verbatim) |
| `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` | doc (routing tracker) | log | `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` (header + row schema verbatim) | exact |

### MODIFY files (15)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `packages/mcp-server/src/tools.ts` (modify `remember`/`recall`/`forget` bodies) | controller / MCP handler | request-response | `packages/mcp-server/src/tools.ts` lines 181–223 (the current `remember` shape) | exact (extending self) |
| `packages/mcp-server/src/envelope.ts` (extend `buildRecallResponse`, add META_GAPS entries) | helper (envelope builder) | transform | `packages/mcp-server/src/envelope.ts` lines 169–207 (current `buildRecallResponse`) | exact (extending self) |
| `packages/mcp-server/src/schemas.ts` (`verbosity` default `"both"` → `"chunks"`) | schema (zod) | structural | `packages/mcp-server/src/schemas.ts` line 66 | exact (single-line diff) |
| `packages/mcp-server/wrangler.jsonc` (add `ai` + `vectorize` bindings) | config | n/a | `packages/mcp-server/wrangler.jsonc` (whole file) | exact (additive) |
| `packages/mcp-server/wrangler.test.jsonc` (add `ai` + `vectorize` test bindings) | config (wrangler test) | n/a | `packages/mcp-server/wrangler.test.jsonc` (whole file) | exact (additive) |
| `packages/mcp-server/package.json` (devDependency add only if planner picks zod-to-json-schema here) | config | n/a | `packages/mcp-server/package.json` line 23–26 | exact |
| `packages/mcp-server/src/__tests__/envelope.test.ts` (verbosity-parameterized + new META_GAPS) | test | structural | `packages/mcp-server/src/__tests__/envelope.test.ts` lines 90–119 (verbosity branches) | exact (extending self) |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` (AI-08 5-second-sleep round-trip) | test (integration) | request-response | lines 237–265 (TOL-04 round-trip) | exact (extending self) |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (Vectorize-side AI-02 prong) | test (integration) | request-response | lines 103–166 (two-prong shape) | exact (add Prong C) |
| `packages/triage-worker/wrangler.jsonc` (add `ai` + `vectorize` + `WORKSPACE` service binding) | config | n/a | `packages/triage-worker/wrangler.jsonc` (whole file) + `packages/mcp-server/wrangler.jsonc` lines 13–18 (durable_objects shape) | exact (compose two existing files) |
| `packages/triage-worker/package.json` (add zod, zod-to-json-schema, vitest, vitest-pool-workers) | config | n/a | `packages/mcp-server/package.json` (whole file) | exact |
| `packages/workspace-do/src/schema.ts` (append `V2_SQL` for `blocks.cold_storage`) | schema (DDL constant) | structural | `packages/workspace-do/src/schema.ts` lines 66–143 (`V1_SQL` const) | exact (additive sibling) |
| `packages/workspace-do/src/migrations.ts` (append v2 Migration entry) | migration runner | structural | `packages/workspace-do/src/migrations.ts` lines 51–53 (MIGRATIONS array) | exact (additive) |
| `packages/workspace-do/src/queries.ts` (add 5 new query helpers) | helper (typed SQL) | CRUD | `packages/workspace-do/src/queries.ts` `insertBlock`/`getBlock`/`deleteBlock` (lines 314–442) | exact (extending self) |
| `packages/workspace-do/src/index.ts` (expose 5 new RPC methods with `assertOwnsWorkspace`) | RPC handler (DO) | request-response | `packages/workspace-do/src/index.ts` lines 163–206 (every existing method) | exact (uniform method shape) |
| `.planning/phases/05-ai-integration/05-AI-SPEC.md` (§4 diagram amendment per D-04) | doc | n/a | self-edit | exact |
| `.claude/skills/spike-findings-engram/SKILL.md` (D-05 verbosity supersession note) | doc | n/a | self-edit | exact |
| `CLAUDE.md` (`## Ingest Pipeline` cold-storage replacement) | doc | n/a | self-edit | exact |

---

## Pattern Assignments

### `packages/mcp-server/src/vectorize-helper.ts` (NEW — helper, binding wrapper)

**Analog:** `packages/mcp-server/src/error-mapping.ts` (module shape + sanitizer-as-private-helper pattern)

**Module JSDoc pattern** (`error-mapping.ts:1–43`):
```typescript
/**
 * `vectorizeQuery` / `vectorizeUpsert` / `vectorizeDelete` —
 * mandatory-workspace-id wrappers around `env.VECTORIZE` (AI-02 defense-in-depth).
 *
 * Cross-phase contract:
 * - **Phase 5 AI-02:** the `workspaceId` arg is non-optional positional on every
 *   call — a forgotten arg becomes a TS compile error instead of a silent
 *   global-index query.
 * - **Phase 5 AI-03:** `vectorizeUpsert` enforces the embedding-stamp precondition
 *   (caller must have written `embedding_model`/`embedding_version` to the SQLite
 *   row before calling — the helper does NOT verify but documents the contract).
 *
 * Design notes (locked):
 * - 64-byte namespace length guard fires before any binding call (Pitfall 9).
 * - Direct `env.VECTORIZE.{query|upsert|deleteByIds}` outside this file is
 *   banned by a CI grep check (or ESLint custom rule — planner picks).
 * - No default export — matches the repo-wide convention.
 *
 * @module @engram/mcp-server/vectorize-helper
 */
```

**Public-surface shape** (3 named exports, single private helper):
```typescript
// Mirrors error-mapping.ts public/private split (lines 57–73 public, 80–92 private).

import type { VectorizeIndex, VectorizeVector, VectorizeMatches, VectorizeQueryOptions }
  from "@cloudflare/workers-types";

const NAMESPACE_MAX_BYTES = 64;

function assertNamespace(workspaceId: string): void {
  if (new TextEncoder().encode(workspaceId).byteLength > NAMESPACE_MAX_BYTES) {
    throw new Error(`vectorize: workspace_id exceeds 64-byte namespace cap (${workspaceId.length} chars)`);
  }
}

export async function vectorizeQuery(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vector: number[],
  opts: { topK: number; filter?: Record<string, unknown>; returnMetadata?: "all" | "indexed" | "none" },
): Promise<VectorizeMatches> {
  assertNamespace(workspaceId);
  return env.VECTORIZE.query(vector, { namespace: workspaceId, ...opts });
}

export async function vectorizeUpsert(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  vectors: Omit<VectorizeVector, "namespace">[],
): Promise<unknown> {
  assertNamespace(workspaceId);
  return env.VECTORIZE.upsert(vectors.map((v) => ({ ...v, namespace: workspaceId })));
}

export async function vectorizeDelete(
  env: { VECTORIZE: VectorizeIndex },
  workspaceId: string,
  ids: string[],
): Promise<unknown> {
  assertNamespace(workspaceId);
  return env.VECTORIZE.deleteByIds(ids);
}
```

**Conventions to honor:**
- Named exports only (no default) — matches `error-mapping.ts:57`.
- JSDoc cross-phase block at top, threat-model section in JSDoc — same shape as `error-mapping.ts:1–43`.
- Helper takes `env: { VECTORIZE: ... }` (structural) so tests can pass `env as any` or a partial mock without satisfying the full Cloudflare Env interface — matches how `tools-integration.test.ts:68` uses `env as Env`.

---

### `packages/mcp-server/src/ai-helper.ts` (NEW — helper, binding wrapper)

**Analog:** `packages/mcp-server/src/error-mapping.ts` (module shape) + AI-SPEC.md §3 entry-point pattern

**Public surface (model-id constants + 429 detector + safeRun)**:
```typescript
// Source: AI-SPEC.md §3 "Core Imports" + §3 "Common Pitfalls #1" (binding-returns-vs-throws).

import type { Ai } from "@cloudflare/workers-types";

// AI-SPEC.md eval dimension #2 identity-check: both mcp-server and triage-worker
// import the SAME constant. Cross-file equality test in ai-helper.test.ts.
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
export const EMBEDDING_VERSION = 1 as const;
export const CLASSIFIER_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const;

/**
 * Detects a 429-rate-limit response on the binding-level envelope path.
 * AI-SPEC.md §3 Pitfall #1: `env.AI.run` does NOT throw on 429 — it returns
 * `{ success: false, errors: [{ code: 7501, message: "..." }] }`.
 *
 * Defense-in-depth: callers should ALSO wrap env.AI.run in try/catch and
 * call `isRateLimitError(err)` on the thrown side (per 05-RESEARCH.md
 * Open Question 1 — Cloudflare error docs show thrown AiError shape).
 */
export function detectRateLimit(aiResp: unknown): boolean {
  if (typeof aiResp !== "object" || aiResp === null) return false;
  const r = aiResp as { success?: boolean; errors?: { code?: number; message?: string }[] };
  if (r.success !== false) return false;
  return (r.errors ?? []).some(
    (e) => e.code === 7501 || /429|rate|too many|capacity/i.test(e.message ?? ""),
  );
}

/**
 * Detects a 429-rate-limit on the thrown-error path (Cloudflare error docs:
 * codes 3036 "Account limited" + 3040 "Out of capacity" return HTTP 429).
 * Used in the triage-worker consumer's try/catch around env.AI.run.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|too.?many|capacity|3036|3040/i.test(message);
}

/**
 * Wraps env.AI.run with envelope-level 429 detection. Returns the response
 * untouched on success; throws on 429 so the caller's outer try/catch +
 * isRateLimitError() path also covers the envelope case.
 */
export async function safeRun<Body, Resp>(
  env: { AI: Ai },
  model: string,
  body: Body,
): Promise<Resp> {
  const resp = await (env.AI as unknown as { run: (m: string, b: unknown) => Promise<Resp> }).run(model, body);
  if (detectRateLimit(resp)) {
    throw new Error(`Workers AI 429: ${JSON.stringify((resp as unknown as { errors?: unknown }).errors ?? [])}`);
  }
  return resp;
}
```

**Conventions to honor:**
- `as const` on every model id so each is a literal type (downstream `import { EMBEDDING_MODEL }` gets the exact string for snapshot tests).
- Two detection functions because there are TWO paths (binding envelope vs thrown) — both must be tested in `ai-helper.test.ts`.
- `safeRun` returns the response untouched on success (no shape transformation); the caller still does `embedResp.data[0]` per AI-SPEC.md §3 Pitfall #3.

---

### `packages/mcp-server/src/hybrid-rank.ts` (NEW — utility, pure transform)

**Analog:** `packages/mcp-server/src/envelope.ts` `dropMemoryField`/`dropLastMemory` (lines 357–387) — pure-functional transform over memory arrays, no mutation, spread + map

**Pattern to copy** (envelope.ts:357–387, the immutability + return-new-object discipline):
```typescript
// envelope.ts:357–371 — the immutability + spread-only pattern hybrid-rank.ts MUST mirror:
function dropMemoryField<T extends { memories: LexicalSearchHit[] }>(
  envelope: EngramResponse<T>,
  field: "content" | "summary",
): EngramResponse<T> {
  return {
    ...envelope,
    result: {
      ...envelope.result,
      memories: envelope.result.memories.map((m) => ({
        ...m,
        [field]: null,
      })),
    },
  };
}
```

**hybrid-rank.ts signature** (per AI-SPEC.md §4 hybrid ranking formula):
```typescript
// Source: AI-SPEC.md §4 "Core Pattern" + spike-findings-engram phase-5-ranking-strategy.md.
// Formula LOCKED: cosine·1.0 + recency·0.15 + type_match·0.2 + scope_match·0.15.

import type { VectorizeMatches } from "@cloudflare/workers-types";
import type { LexicalSearchHit } from "@engram/workspace-do";
import type { RecallInput } from "./schemas.js";

// Exported as a const so test fixtures can import + assert exact weights.
export const HYBRID_WEIGHTS = {
  cosine: 1.0,
  recency: 0.15,
  type_match: 0.2,
  scope_match: 0.15,
} as const;

// Pure function — no env, no IO, no mutation. Mirrors envelope.ts:357–387 discipline.
export function hybridRank(
  matches: VectorizeMatches["matches"],
  blocks: LexicalSearchHit[],
  args: RecallInput,
  now: number,
): LexicalSearchHit[] {
  // ... (planner specifies exact decay function — recency = exp(-age_days / 30) is
  // the recommended starting heuristic per phase-5-ranking-strategy.md §3)
}
```

**Test fixture file:** `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` mirrors `envelope.test.ts` (pure-function describe blocks, no `runInDurableObject`).

---

### `packages/mcp-server/src/__tests__/vectorize-helper.test.ts` (NEW — unit, mocked binding)

**Analog:** `packages/mcp-server/src/__tests__/envelope.test.ts` (pure-unit describe structure, no DO needed) — plus the spy pattern from `tools-integration.test.ts:60–86` for verifying namespace arg propagation.

**Import block to copy** (envelope.test.ts:47–58):
```typescript
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";

import { vectorizeQuery, vectorizeUpsert, vectorizeDelete } from "../vectorize-helper.js";
```

**Test shape — namespace propagation assertion** (mirrors envelope.test.ts:90–113 verbosity-branching shape):
```typescript
describe("vectorize-helper (AI-02 namespace mandatory)", () => {
  it("vectorizeQuery sets namespace = workspace_id on every call", async () => {
    const calls: { vector: number[]; opts: Record<string, unknown> }[] = [];
    const mockEnv = {
      VECTORIZE: {
        query: async (vector: number[], opts: Record<string, unknown>) => {
          calls.push({ vector, opts });
          return { matches: [], count: 0 };
        },
      } as unknown as VectorizeIndex,
    };
    await vectorizeQuery(mockEnv, "ws-test-001", [0.1, 0.2, 0.3], { topK: 25 });
    expect(calls[0]?.opts.namespace).toBe("ws-test-001");
  });

  it("rejects namespace > 64 bytes", () => {
    const big = "x".repeat(65);
    expect(() => vectorizeQuery({ VECTORIZE: {} } as any, big, [], { topK: 1 }))
      .toThrow(/64-byte namespace/);
  });
});
```

**Conventions to honor:**
- Inline mock object via `as unknown as VectorizeIndex` cast (matches the `env as Env` cast pattern in `tools-integration.test.ts:68`).
- `describe(req-id + behavior)` titles so verifier greps map directly to AI-02.

---

### `packages/mcp-server/src/__tests__/ai-helper.test.ts` (NEW — unit, mocked binding, 429 dual-path)

**Analog:** `packages/mcp-server/src/__tests__/envelope.test.ts` (pure-unit describe shape) + `error-mapping.test.ts` (per-branch one-it pattern).

**Critical assertion — model-id identity check** (per AI-SPEC.md §5 dimension #2):
```typescript
import { EMBEDDING_MODEL as MCP_EMBEDDING_MODEL } from "../ai-helper.js";

// This import will fail compilation until triage-worker's ai-helper.ts exists.
// The point of the test IS the cross-file equality check.
it("EMBEDDING_MODEL is identical across mcp-server and triage-worker (AI-03/04 drift guard)", async () => {
  // Use Vite ?raw import (matches tools.test.ts:38–45 pattern) to read sibling
  // package's source without runtime fs.
  // @ts-expect-error -- ?raw is Vite-only
  const triageAiHelperRaw: string = (await import("../../../triage-worker/src/ai-helper.ts?raw")).default;
  // Or simpler: import from the package directly once it's wired into the workspace.
  expect(triageAiHelperRaw).toContain(`"${MCP_EMBEDDING_MODEL}"`);
});
```

**429 dual-path tests** (per Pitfall 1 in AI-SPEC.md §3):
```typescript
import { detectRateLimit, isRateLimitError } from "../ai-helper.js";

describe("AI-07: 429 detection (dual-path)", () => {
  it("detectRateLimit returns true on envelope shape {success:false, errors:[{code:7501}]}", () => {
    expect(detectRateLimit({ success: false, errors: [{ code: 7501, message: "rate limit" }] })).toBe(true);
  });
  it("detectRateLimit returns true on errors[].message matching /429|rate|capacity/i", () => {
    expect(detectRateLimit({ success: false, errors: [{ code: 9999, message: "HTTP 429 too many" }] })).toBe(true);
  });
  it("detectRateLimit returns false on success", () => {
    expect(detectRateLimit({ data: [[1, 2, 3]], shape: [1, 3] })).toBe(false);
  });
  it("isRateLimitError catches thrown AiError matching /429|capacity|3036|3040/", () => {
    expect(isRateLimitError(new Error("inference upstream HTTP 429"))).toBe(true);
    expect(isRateLimitError(new Error("error 3040 out of capacity"))).toBe(true);
    expect(isRateLimitError(new Error("invalid model id"))).toBe(false);
  });
});
```

---

### `packages/mcp-server/src/__tests__/hybrid-rank.test.ts` (NEW — pure unit)

**Analog:** `packages/mcp-server/src/__tests__/envelope.test.ts` lines 64–146 (pure builder tests, no DO).

**Pattern to copy verbatim** — describe-per-property shape:
```typescript
import { describe, it, expect } from "vitest";
import { hybridRank, HYBRID_WEIGHTS } from "../hybrid-rank.js";

describe("hybridRank (AI-04 formula)", () => {
  it("weights are LOCKED at AI-SPEC.md §4 starting values", () => {
    expect(HYBRID_WEIGHTS).toEqual({ cosine: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15 });
  });
  it("recent block scores higher than older block at same cosine", () => { /* ... */ });
  it("type_match boosts when args.types contains block.type", () => { /* ... */ });
  it("scope_match boosts when args.scope === block.scope", () => { /* ... */ });
  it("reorders matches monotonically by combined score (no ties)", () => { /* ... */ });
});
```

---

### `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` (NEW — eval gate, Wave 5)

**Analog:** No eval exists in the codebase yet. Closest is `packages/mcp-server/src/__tests__/envelope.test.ts` (vitest + workerd shape). For the fixture-loading + per-corpus-row assertion pattern, mirror `helpers.test.ts:45–61` `makeBlock` fixture builder.

**Required shape** (per `05-VALIDATION.md` "F1 ≥ 75% gate"):
```typescript
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";

// 20-example corpus: 4 buckets of 5 (critical-path / known-failures / extraction / edge).
import corpus from "./fixtures/reference-corpus.json";

describe("AI-04 recall F1 — reference corpus (BLOCKS AI-04 closure if < 75%)", () => {
  it("F1 ≥ 0.75 across the 20-example reference corpus", async () => {
    // For each row: seed memory via remember(), recall with the row's query,
    // assert the expected memory id is in top-5. Compute precision/recall/F1
    // across the whole corpus.
    // ... (planner specifies exact harness — see 05-VALIDATION.md per-task map)
    const f1 = await runEvalCorpus(corpus);
    expect(f1).toBeGreaterThanOrEqual(0.75);
  });
});
```

**Conventions to honor:**
- Test lives under `src/__tests__/evals/` subdirectory (NOT `__tests__/evals/`) to match existing `src/__tests__/` convention.
- Suffix `.eval.test.ts` so a future `vitest --filter "*.eval"` invocation maps to evals only.
- Fixture path `__tests__/evals/fixtures/reference-corpus.json` mirrors `__snapshots__` directory pattern (private to tests).

---

### `packages/triage-worker/src/extract.ts` (NEW — queue-consumer body)

**Analog:** `packages/mcp-server/src/tools.ts` recall handler body (lines 226–252) — closest async-binding-call pattern with try/catch and multi-step pipeline. The structural shape is the same: async function, get binding, call AI, parse result, route to a DO method.

**Pattern to copy — the try/catch + pipeline shape** (tools.ts:226–252):
```typescript
// tools.ts:226–252 — pattern Phase 5 extract.ts mirrors at the consumer level:
async (args) => {
  const props = getProps();
  if (props === undefined) { throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context"); }
  try {
    const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));
    const memories = await stub.lexicalSearchBlocks({ workspace_id: props.workspace_id, query: args.query, ... });
    const envelope = buildRecallResponse({ memories, verbosity: args.verbosity });
    return wrapMcpContent(trimToBudget(envelope));
  } catch (err) {
    throw mapToMcpError(err);
  }
}
```

**extract.ts shape** (per AI-SPEC.md §4b + 05-RESEARCH.md §"Pattern 4"):
```typescript
import { getAgentByName } from "agents";
import { z } from "zod";
import { TriageOutput, TRIAGE_JSON_SCHEMA } from "./schemas.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { CLASSIFIER_MODEL, detectRateLimit, isRateLimitError } from "./ai-helper.js";
import type { MemoryEvent } from "@engram/types";

export async function extractAndScore(
  env: Env,
  event: MemoryEvent,
  message: Message<MemoryEvent>,
): Promise<TriageOutput | null> {
  let aiResp: unknown;
  try {
    aiResp = await env.AI.run(CLASSIFIER_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: event.content },
      ],
      response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA },
      temperature: 0.2,
      max_tokens: 1024,
    });
  } catch (err) {
    // AI-07 dual-path #1: thrown AiError → message.retry, do NOT crash batch.
    if (isRateLimitError(err)) { message.retry({ delaySeconds: 30 }); return null; }
    throw err;
  }

  // AI-07 dual-path #2: binding envelope shape.
  if (detectRateLimit(aiResp)) { message.retry({ delaySeconds: 30 }); return null; }

  const candidate = (aiResp as { response?: unknown }).response ?? aiResp;
  const parsed = TriageOutput.safeParse(candidate);
  if (!parsed.success) {
    if (!message.attempts || message.attempts < 2) {
      message.retry({ delaySeconds: 5 });
      return null;
    }
    console.error("triage:zod-parse-failed-permanent", { id: event.id, issues: parsed.error.issues });
    message.ack();
    return null;
  }
  return parsed.data;
}
```

**Conventions to honor:**
- The `try { await env.AI.run(...) } catch (err) { ... }` shape is the inverse of `tools.ts:226–252` where the AI call is INSIDE the try (which catches everything). Here we need the AI call in its own try because 429 has special handling — different from a generic error funnel.
- `console.error` log shape `"triage:event-name"` matches `error-mapping.ts:71` style (lowercase, colon-separated namespace).

---

### `packages/triage-worker/src/memorability.ts` (NEW — utility, routing predicate)

**Analog:** `packages/mcp-server/src/envelope.ts` `hasMemoriesArray` (lines 344–351) — single-purpose discriminator function.

**Shape**:
```typescript
import type { TriageOutput } from "./schemas.js";

// Per AI-SPEC.md §4 + CONTEXT.md D-07: NOT discard. cold_storage replaces it.
export type RouteDecision = "store-normal" | "inbox" | "cold-storage";

export function routeByMemorability(score: number): RouteDecision {
  if (score > 0.8) return "store-normal";
  if (score >= 0.4) return "inbox";
  return "cold-storage"; // NOT "discard" — CONTEXT.md D-07 cardinal-sin clause.
}
```

---

### `packages/triage-worker/src/schemas.ts` (NEW — zod schema module)

**Analog:** `packages/mcp-server/src/schemas.ts` (entire file) — zod schemas, no inline z.object outside this file, type aliases via z.infer.

**Header to copy verbatim** (schemas.ts:1–42):
```typescript
/**
 * Zod input/output schemas for the Triage Worker.
 *
 * Single source of truth — Triage handler bodies `import type { TriageOutput }`
 * for compile-time + `TriageOutput.safeParse(...)` for runtime gate at the
 * LLM boundary.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-05:** the LLM is told (via response_format.json_schema) to emit
 *   this exact shape. The Zod schema is the runtime gate after.
 *
 * Design notes (locked):
 * - Hand-written zod (matches mcp-server/src/schemas.ts) — no zod-to-ts build.
 * - `zodToJsonSchema` derives the `response_format.json_schema` for the LLM —
 *   single source of truth for both the model contract AND the runtime gate.
 *
 * @module @engram/triage-worker/schemas
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SYSTEM_MEMORY_TYPES = [
  "job_application", "contact", "company", "project",
  "research_note", "decision_log", "meeting_note",
] as const;

export const Entity = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["person", "company", "role", "date", "url"]),
});

export const TriageOutput = z.object({
  classified_type: z.enum(SYSTEM_MEMORY_TYPES),
  extracted_fields: z.record(z.unknown()),
  entities: z.array(Entity).max(50),
  summary: z.string().min(10).max(800),
  memorability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export const TRIAGE_JSON_SCHEMA = zodToJsonSchema(TriageOutput, {
  target: "openApi3",
  $refStrategy: "none",
});
```

**Conventions to honor:**
- One `as const` literal-array constant before each `z.enum(...)` so SYSTEM_MEMORY_TYPES can be imported separately by routing code.
- z.infer named identically to the schema (`TriageOutput` value AND type) — matches `RememberInput` / `RecallInput` pattern in `mcp-server/src/schemas.ts:54,68`.

---

### `packages/triage-worker/src/prompts.ts` (NEW — frozen constant module)

**Analog:** `packages/mcp-server/src/envelope.ts` `META_GAPS` (lines 56–80) — exported `as const` frozen-string constant.

**Pattern to copy**:
```typescript
// envelope.ts:56–80 META_GAPS shape — Phase 5 prompts.ts mirrors the byte-frozen discipline.
export const META_GAPS = {
  remember: [
    "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
    "Conflict detection lands in Phase 5 (semantic similarity via Vectorize).",
  ],
  recall: [
    "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only.",
  ],
  // ...
} as const;
```

**prompts.ts shape** (per spike-findings `engram-response-synthesis-contract.md` §6 — 5 drop categories):
```typescript
/**
 * SYSTEM_PROMPT for AI-05 entity extraction + memorability scoring.
 *
 * Byte-frozen per spike-findings-engram synthesis contract — changes to this string
 * invalidate Wave 5 promptfoo + memorability-calibration eval baselines.
 *
 * 5 drop categories (spike §6): dates, sources, technical identifiers, numeric
 * values, decision-rejection naming.
 */
export const SYSTEM_PROMPT = `You are Engram's triage classifier. Given a user memory, output JSON with...` as const;
```

---

### `packages/triage-worker/src/ai-helper.ts` (NEW — helper, sibling of mcp-server's)

**Analog:** `packages/mcp-server/src/ai-helper.ts` (the Wave 1 sibling). The two files MUST export identical `EMBEDDING_MODEL`, `EMBEDDING_VERSION`, `CLASSIFIER_MODEL` constants — verified by the cross-file equality test in `mcp-server/src/__tests__/ai-helper.test.ts`.

**Pattern:** literally copy `packages/mcp-server/src/ai-helper.ts` and adjust the module JSDoc `@module` header. The 429 detector logic is identical between both packages.

**Alternative the planner may consider:** extract `ai-helper.ts` to a shared package (`shared/ai-helpers/` or re-export from `@engram/types`) to enforce the identity at compile time instead of via cross-file equality test. Phase 5 plan can choose; the AI-SPEC.md leans toward duplication-with-test (simpler, no new package).

---

### `packages/triage-worker/src/__tests__/extract.test.ts` (NEW — unit, mocked + 429 dual-path)

**Analog:** `packages/mcp-server/src/__tests__/tools-integration.test.ts` (call-then-assert-envelope shape) + the 429 dual-path describe blocks from `ai-helper.test.ts`.

**Test scaffold for 429 retry assertions**:
```typescript
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { extractAndScore } from "../extract.js";

describe("AI-05 + AI-07: extractAndScore", () => {
  it("AI-07 dual-path #1: thrown AiError(429) triggers message.retry({delaySeconds: 30})", async () => {
    const message = { retry: vi.fn(), ack: vi.fn(), attempts: 1, body: { /* MemoryEvent */ } } as any;
    const mockEnv = {
      AI: { run: async () => { throw new Error("HTTP 429 too many requests"); } },
    } as any;
    const result = await extractAndScore(mockEnv, message.body, message);
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("AI-07 dual-path #2: envelope {success:false, errors:[{code:7501}]} triggers message.retry", async () => {
    // ... mirror shape with mockEnv returning the 429 envelope instead of throwing
  });

  it("AI-05 Zod parse fail + attempts<2 → message.retry({delaySeconds: 5})", async () => { /* ... */ });
  it("AI-05 Zod parse fail + attempts>=2 → message.ack (permanent failure, DLQ-equiv)", async () => { /* ... */ });
});
```

---

### `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts` (NEW — Wave 5 eval)

**Analog:** `recall-f1.eval.test.ts` (sibling Wave 5 eval — same structure).

**Shape** (per AI-SPEC.md eval dimension #5):
```typescript
describe("AI-06 memorability calibration (±10pp band)", () => {
  it("score distribution on reference corpus falls in 60/30/10 ± 10pp split", async () => {
    // Run 20-example corpus through extractAndScore, bucket by memorability:
    // >0.8 → store-normal target ~60%
    // 0.4-0.8 → inbox target ~30%
    // <0.4 → cold-storage target ~10%
    // Assert each band is within 10pp.
  });
});
```

---

### `packages/triage-worker/vitest.config.ts` (NEW — config)

**Analog:** `packages/mcp-server/vitest.config.ts` (entire file).

**Copy verbatim** (mcp-server/vitest.config.ts):
```typescript
/**
 * Vitest pool configuration for @engram/triage-worker.
 *
 * Single workerd project — every test under `src/__tests__/` runs inside the
 * real Cloudflare workerd runtime via `@cloudflare/vitest-pool-workers`.
 *
 * @module @engram/triage-worker/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

---

### `packages/triage-worker/wrangler.test.jsonc` (NEW — config)

**Analog:** `packages/mcp-server/wrangler.test.jsonc` (entire file, lines 25–54).

**Adapt for triage-worker bindings** (AI + VECTORIZE + WORKSPACE service binding to mcp-server's DO):
```jsonc
// packages/triage-worker/wrangler.test.jsonc
// TEST-ONLY config — separate from wrangler.jsonc to opt out of FND-08 lint glob.
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-triage-worker-test",
  "main": "src/index.ts",
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "engram-memories" }],
  "durable_objects": {
    "bindings": [
      // Cross-Worker DO binding: WorkspaceDO lives in mcp-server package.
      // script_name pins the source Worker. Mirrors AI-SPEC.md §4 "Tool Use" row 3.
      { "name": "WORKSPACE", "class_name": "WorkspaceDO", "script_name": "engram-mcp-server" },
    ],
  },
}
```

**Conventions to honor:**
- The `.test.jsonc` suffix opts the file out of `scripts/lint-wrangler.mjs` per the FND-08 invariant documented at `mcp-server/wrangler.test.jsonc:6–10,15–22`.
- No `compatibility_date` (mirrors mcp-server pattern; pool infers latest).

---

### `scripts/setup-vectorize.sh` (NEW — no analog)

**No analog in repo.** Use AI-SPEC.md §3 "Installation" verbatim:
```bash
#!/usr/bin/env bash
# AI-01: idempotent Vectorize index provisioning.
# Re-running with the same name returns "already exists" without modifying.
set -euo pipefail

INDEX="engram-memories"
# Precheck (per 05-RESEARCH.md: wrangler vectorize create is NOT natively idempotent —
# 2nd run errors; precheck via 'get' to make this safe to re-run).
if npx wrangler vectorize get "$INDEX" >/dev/null 2>&1; then
  echo "vectorize: index '$INDEX' already exists (no-op)"
else
  npx wrangler vectorize create "$INDEX" --preset=@cf/baai/bge-base-en-v1.5
fi

# Metadata indexes (idempotent — wrangler create-metadata-index returns success
# on duplicate per Cloudflare docs).
npx wrangler vectorize create-metadata-index "$INDEX" --property-name=type  --type=string || true
npx wrangler vectorize create-metadata-index "$INDEX" --property-name=scope --type=string || true
```

---

### `packages/mcp-server/src/tools.ts` (MODIFY — extend `remember`/`recall`/`forget`)

**Analog:** Itself — `packages/mcp-server/src/tools.ts` lines 181–223 (`remember`), 226–252 (`recall`), 285–309 (`forget`). The existing handler shape is the canonical pattern; Phase 5 inlines additional steps before the envelope build.

**Pattern to extend — `remember` (current tools.ts:181–223)**:
```typescript
// tools.ts:181–223 — extend AFTER the insertBlock call, BEFORE buildRememberResponse.
server.registerTool("remember", { description: "...", inputSchema: RememberInputSchema.shape }, async (args) => {
  const props = getProps();
  if (props === undefined) { throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context"); }
  try {
    const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));
    const id = crypto.randomUUID();
    const now = Date.now();
    const block: Memory = { id, type: args.type ?? null, content: args.content, /* ... */ };
    await stub.insertBlock({ workspace_id: props.workspace_id, block });

    // === Phase 5 AI-03 additions START ===
    const embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [block.content] });
    const vector = (embedResp as { data: number[][] }).data[0]!;
    await stub.stampEmbedding({
      workspace_id: props.workspace_id,
      block_id: id,
      embedding_model: EMBEDDING_MODEL,
      embedding_version: EMBEDDING_VERSION,
    });
    await vectorizeUpsert(env, props.workspace_id, [{
      id, values: vector,
      metadata: { type: block.type ?? "", scope: block.scope, created_at: block.created_at },
    }]);
    // === Phase 5 AI-03 additions END ===

    const envelope = buildRememberResponse({ id, classified_type: args.type ?? null });
    return wrapMcpContent(trimToBudget(envelope));
  } catch (err) { throw mapToMcpError(err); }
});
```

**Pattern to replace — `recall` (current tools.ts:226–252)** — full body replacement, lexical → semantic:
```typescript
server.registerTool("recall", { /* ... */ }, async (args) => {
  const props = getProps();
  if (props === undefined) { throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context"); }
  try {
    const stub = workspaceNs.get(workspaceNs.idFromName(props.workspace_id));

    // === Phase 5 AI-04 replacement (was lexicalSearchBlocks) ===
    const embedResp = await safeRun(env, EMBEDDING_MODEL, { text: [args.query] });
    const queryVector = (embedResp as { data: number[][] }).data[0]!;
    const result = await vectorizeQuery(env, props.workspace_id, queryVector, {
      topK: args.limit ?? 25,
      filter: args.types?.length ? { type: { $in: args.types } } : undefined,
      returnMetadata: "all",
    });
    const ids = result.matches.map((m) => m.id);
    const blocks = await stub.getBlocksByIds({ workspace_id: props.workspace_id, ids });
    const ranked = hybridRank(result.matches, blocks, args, Date.now());

    // === D-01: synthesis OPT-IN ===
    let synthesis: string | null = null;
    if (args.verbosity === "synthesis" || args.verbosity === "both") {
      // ... synthesis LLM call ...
    }

    const envelope = buildRecallResponse({
      memories: ranked,
      verbosity: args.verbosity,
      synthesis,
      // D-02: suggestions activated for the synthesis-discoverability triad
      ...(args.verbosity === "chunks" ? {
        suggestions: { actions: ["Set verbosity: 'synthesis' to add a summary of these memories."] },
      } : {}),
    });
    return wrapMcpContent(trimToBudget(envelope));
  } catch (err) { throw mapToMcpError(err); }
});
```

**Pattern to extend — `forget` (current tools.ts:285–309)** — add Vectorize cascade. Per 05-RESEARCH.md "Pattern 3 Partial-failure story (a)", do Vectorize delete FIRST:
```typescript
// === Phase 5 AI-08 addition: Vectorize-first per partial-failure recommendation ===
await vectorizeDelete(env, props.workspace_id, [args.id]);
const { blocks_deleted, relations_deleted } = await stub.deleteBlock({ /* ... existing ... */ });
```

**Conventions to honor:**
- The `SENTINEL-DD-RT-PHASE-03-TOOLS-TS` comment at line 121 MUST stay intact — tools.test.ts asserts its presence.
- `args.workspace_id` MUST NOT appear in production code; the structural test will fail (per `tools.ts:46–52` threat-model JSDoc).
- The `prettier-ignore` `// prettier-ignore` line above each `server.registerTool(...)` MUST stay so verifier grep matches `server.registerTool("<name>"` on a single line.

---

### `packages/mcp-server/src/envelope.ts` (MODIFY — extend `buildRecallResponse`)

**Analog:** Itself — `packages/mcp-server/src/envelope.ts` lines 169–207 (current `buildRecallResponse`).

**Pattern to extend** — additive only (input arg list grows; existing branches preserved):
```typescript
// envelope.ts:169–207 — extend the input shape (additive) and add a META_GAPS entry.

export function buildRecallResponse(input: {
  memories: LexicalSearchHit[];
  verbosity: "synthesis" | "chunks" | "both";
  synthesis?: string | null;         // NEW Phase 5
  suggestions?: { actions: string[] }; // NEW Phase 5 — D-02
}): EngramResponse<RecallResult> {
  const chunksField = input.verbosity === "synthesis" ? {} : { chunks: input.memories.map(/* ... */) };
  const lastUpdated = input.memories.length > 0
    ? Math.max(...input.memories.map((m) => m.created_at))
    : Date.now();

  // D-02: append the synthesis-omitted gap string on default verbosity.
  const gaps = [...META_GAPS.recall];
  if (input.verbosity === "chunks") gaps.push(META_GAPS.recallChunksOmittedSynthesis);

  return {
    result: { memories: input.memories, synthesis: input.synthesis ?? null, ...chunksField },
    context: { related: [], entities: [], conflicts: [] },
    meta: { confidence: null, coverage: null, last_updated: lastUpdated, gaps },
    ...(input.suggestions !== undefined ? { suggestions: { ...input.suggestions, queries: [] } } : {}),
  };
}
```

**META_GAPS additions** (envelope.ts:69–80) — append, do not modify existing:
```typescript
// Add new byte-frozen strings:
export const META_GAPS = {
  // ... existing entries kept verbatim ...
  recallChunksOmittedSynthesis:
    "Synthesis omitted — re-call with verbosity: 'synthesis' or 'both' to add an LLM summary.",
  truncationOver1800Chars:
    "Content over 1,800 chars truncated for embedding; full content stored in SQLite but only the first ~512 tokens are semantically searchable.",
  coldStorageDemotion:
    "Memory scored < 0.4 memorability — moved to cold-storage. Pass include_cold: true to recall (v0.2).",
} as const;
```

**Conventions to honor:**
- META_GAPS strings are byte-frozen — `__snapshots__/envelope.test.ts.snap` will need update via `vitest -u` after the diff lands; planner should call this out explicitly.
- The existing `meta.gaps: string[]` typing means new entries can be string-pushed into the array per-call; the README shape doesn't need to change.

---

### `packages/mcp-server/src/schemas.ts` (MODIFY — `verbosity` default)

**Analog:** Itself — `packages/mcp-server/src/schemas.ts` line 66.

**Single-line diff** (D-01):
```typescript
// BEFORE (schemas.ts:65–66):
// // D-03 + spike-findings-engram §1: default flipped to "both" (BORDERLINE gate)
// verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("both"),

// AFTER (Phase 5 D-01):
// // D-01 (Phase 5): default flipped to "chunks" — synthesis is opt-in per recall-latency budget.
// // Phase 4 D-03 (was "both"); supersession noted in spike-findings-engram/SKILL.md per D-05.
verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("chunks"),
```

**Conventions to honor:**
- Comment line MUST be updated alongside the default (mirrors existing pattern of leaving rationale next to the code).
- The enum shape (`["synthesis", "chunks", "both"]`) MUST NOT change — Phase 4 hand-off lock per `04-PHASE-5-HANDOFF.md`.

---

### `packages/mcp-server/wrangler.jsonc` (MODIFY — add `ai` + `vectorize` bindings)

**Analog:** Itself — `packages/mcp-server/wrangler.jsonc` (the durable_objects + kv_namespaces additive arrays at lines 13–29).

**Additive shape**:
```jsonc
{
  // existing keys preserved exactly ...
  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "engram-memories" },
  ],
  "durable_objects": { /* unchanged */ },
  "kv_namespaces": [ /* unchanged */ ],
  "migrations": [ /* unchanged — NO new entry; cold_storage is a SQLite migration, NOT a DO migration */ ],
}
```

**Conventions to honor:**
- Comma-trailing JSONC formatting matches the existing file (jsonc allows it; planner must preserve).
- Bindings array order in the file: typically `ai`, `vectorize`, then `durable_objects`/`kv_namespaces`. Match existing alphabetical-ish order or leave bindings near top per Cloudflare docs convention.

---

### `packages/mcp-server/wrangler.test.jsonc` (MODIFY — add `ai` + `vectorize` test bindings)

**Analog:** Itself — `packages/mcp-server/wrangler.test.jsonc` (lines 47–53, the durable_objects bindings + migrations array).

**Additive shape** — same as production wrangler.jsonc, but the planner may consider `remote: true` for the Vectorize binding so integration tests hit real Cloudflare (per 05-RESEARCH.md §"Test Mocking Pattern"):
```jsonc
{
  "$schema": "...",
  "name": "engram-mcp-server-test",
  "main": "src/index.ts",
  "ai": { "binding": "AI" },  // unit tests use vi.spyOn; integration tests opt into real AI via env
  "vectorize": [
    // For real-binding integration tests (AI-02 namespace isolation, AI-08 round-trip):
    // { "binding": "VECTORIZE", "index_name": "engram-memories", "remote": true }
    { "binding": "VECTORIZE", "index_name": "engram-memories" },
  ],
  "durable_objects": { /* unchanged */ },
  "migrations": [ /* unchanged */ ],
}
```

---

### `packages/mcp-server/src/__tests__/envelope.test.ts` (MODIFY — verbosity-parameterized per D-03)

**Analog:** Itself — `packages/mcp-server/src/__tests__/envelope.test.ts` lines 90–119 (existing verbosity-branching test pattern).

**Extension shape** (D-03):
```typescript
// envelope.test.ts:90–119 — extend with the AI-input parameterization:

describe("buildRecallResponse — D-01 default flip + D-02 discoverability triad", () => {
  it("default verbosity 'chunks' → synthesis null, suggestions.actions present, meta.gaps includes opt-in hint", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "chunks" });
    expect(envelope.result.synthesis).toBeNull();
    expect(envelope.meta.gaps).toContain(META_GAPS.recallChunksOmittedSynthesis);
    expect(envelope.suggestions?.actions).toContain(
      "Set verbosity: 'synthesis' to add a summary of these memories.",
    );
  });

  it("verbosity='synthesis' → synthesis populated when input.synthesis provided, suggestions absent", () => {
    const envelope = buildRecallResponse({ memories: [], verbosity: "synthesis", synthesis: "Summary here" });
    expect(envelope.result.synthesis).toBe("Summary here");
    expect(envelope.meta.gaps).not.toContain(META_GAPS.recallChunksOmittedSynthesis);
    expect(envelope.suggestions).toBeUndefined();
  });

  it("verbosity='both' → synthesis populated AND chunks present AND no opt-in gap", () => { /* ... */ });
});
```

**Conventions to honor:**
- The existing snapshot test at lines 152–158 (`META_GAPS byte-determinism`) WILL fail after the META_GAPS additions; planner must run `vitest -u` and commit the snapshot update.
- The "suggestions field omission" describe block (lines 165–189) needs the recall it() block weakened: default verbosity now PRESENT-with-actions; only verbosity ∈ {synthesis, both} keeps it absent.

---

### `packages/mcp-server/src/__tests__/tools-integration.test.ts` (MODIFY — AI-08 round-trip)

**Analog:** Itself — `packages/mcp-server/src/__tests__/tools-integration.test.ts` lines 237–265 (TOL-04 remember→forget→recall pattern).

**Extension shape** (5-second sleep for Vectorize eventual consistency):
```typescript
// tools-integration.test.ts:237–265 — extend the existing TOL-04 it() with a sleep.

describe("AI-08: forget cascade with Vectorize delete + eventual consistency", () => {
  it("remember → forget → sleep(5s) → recall returns 0 semantic matches", async () => {
    const workspace_id = "ws-ai08-roundtrip";
    const rememberCb = captureCallback("remember", workspace_id);
    const recallCb = captureCallback("recall", workspace_id);
    const forgetCb = captureCallback("forget", workspace_id);

    const rememberResult = await rememberCb({ content: "ai08 needle to forget cascade" }, {});
    const id = (parseEnvelope(rememberResult).result as { id: string }).id;

    await forgetCb({ id }, {});

    // AI-SPEC.md §3 Pitfall 7: Vectorize delete is eventually consistent (~seconds).
    // 05-RESEARCH.md §"Pitfall 4" + AI-SPEC.md §3 Pitfall #7: allow up to 5s.
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const recallAfter = await recallCb({ query: "needle to forget cascade", verbosity: "chunks" }, {});
    const memories = (parseEnvelope(recallAfter).result as { memories: unknown[] }).memories;
    expect(memories.length).toBe(0);
  });
});
```

---

### `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (MODIFY — Vectorize Prong C)

**Analog:** Itself — `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` lines 103–166 (existing two-prong shape).

**Extension shape — add Prong C for Vectorize-side isolation**:
```typescript
// cross-workspace-pentest.test.ts:103 — extend the describe with a third it() for AI-02.

describe("TOL-07 / AI-02: cross-workspace forgery resistance (3 prongs required)", () => {
  // ... existing Prong A (line 104) and Prong B (line 131) unchanged ...

  it("AI-02 Prong C: vector upserted under workspace_A namespace NOT returned by query in workspace_B", async () => {
    // 1. Seed workspace_A via legitimate handler (upserts to Vectorize namespace="workspace_A")
    const rememberCb_A = captureCallback("remember", "workspace_A");
    await rememberCb_A({ content: "ai02-prong-c-needle vectorize isolation" }, {});

    // 2. Allow Vectorize eventual consistency (per Pitfall 7).
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    // 3. Recall in workspace_B (different namespace) — must return 0 even though vector exists in A.
    const recallCb_B = captureCallback("recall", "workspace_B");
    const result = await recallCb_B({ query: "ai02-prong-c-needle vectorize isolation", verbosity: "chunks" }, {});
    const envelope = parseEnvelope(result);
    const memories = (envelope.result as { memories: unknown[] }).memories;
    expect(memories).toEqual([]);
  });
});
```

**Conventions to honor:**
- The describe-block title MUST be updated from "two prongs" to "3 prongs" so the test report communicates the new gate.
- Re-use `captureCallback` + `parseEnvelope` helpers (lines 56–88) verbatim.

---

### `packages/triage-worker/wrangler.jsonc` (MODIFY — add `ai` + `vectorize` + `WORKSPACE` service binding)

**Analog (two-source compose):**
1. `packages/triage-worker/wrangler.jsonc` (current minimal file, lines 1–12) for the JSONC frame.
2. `packages/mcp-server/wrangler.jsonc` lines 13–18 for `durable_objects.bindings` shape.

**Composed shape**:
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-triage-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "dev": { "port": 8788 },

  "ai": { "binding": "AI" },
  "vectorize": [
    { "binding": "VECTORIZE", "index_name": "engram-memories" },
  ],
  "durable_objects": {
    "bindings": [
      // Cross-Worker DO binding: WorkspaceDO is hosted by engram-mcp-server.
      // script_name pins the source — Triage Worker reads via getAgentByName(env.WORKSPACE, workspace_id).
      { "name": "WORKSPACE", "class_name": "WorkspaceDO", "script_name": "engram-mcp-server" },
    ],
  },
  // Queue consumer block lands in Phase 6 (PIP-02 wires the producer).
  // Phase 5 only ships the consumer body; the binding declaration without
  // a consumer queue is harmless per Cloudflare docs.
}
```

**Conventions to honor:**
- `compatibility_date: "2026-05-22"` mirrors mcp-server's date exactly so both Workers compile against the same runtime version.
- The `script_name: "engram-mcp-server"` value MUST match `packages/mcp-server/wrangler.jsonc:7` `name` field exactly.
- NO `migrations` block — triage-worker does NOT host any DO class; it only consumes WORKSPACE via a service binding.

---

### `packages/triage-worker/package.json` (MODIFY — add deps)

**Analog:** `packages/mcp-server/package.json` (entire file).

**Additive diff**:
```jsonc
{
  "name": "@engram/triage-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types:gen": "wrangler types",
    "test": "vitest run",      // NEW
    "test:watch": "vitest"     // NEW
  },
  "dependencies": {
    "@engram/types": "*",
    "@engram/schema": "*",
    "zod": "^4.0.0",                          // NEW (matches mcp-server pin)
    "zod-to-json-schema": "<latest-verified>" // NEW — Wave 1 GATED on Package Legitimacy Audit checkpoint
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.16.9",  // NEW (matches mcp-server pin)
    "vitest": "^4.1.7"                              // NEW (matches mcp-server pin)
  }
}
```

**Conventions to honor:**
- Versions MUST be identical to `mcp-server/package.json:14–26` (no version drift across packages).
- Per `05-VALIDATION.md` Manual-Only Verifications + 05-RESEARCH.md §"Package Legitimacy Audit", `zod-to-json-schema` install MUST be gated on a human-verified `npm view zod-to-json-schema repository.url maintainers` checkpoint BEFORE the install task runs.

---

### `packages/workspace-do/src/schema.ts` (MODIFY — append `V2_SQL`)

**Analog:** Itself — `packages/workspace-do/src/schema.ts` lines 66–143 (the `V1_SQL` const).

**Additive shape** (append constant, do NOT modify V1_SQL):
```typescript
// schema.ts:143 — APPEND after the V1_SQL closing backtick:

/**
 * v2 migration: add `blocks.cold_storage BOOLEAN DEFAULT FALSE` column per
 * CONTEXT.md D-07 (memorability < 0.4 routes to cold-storage, NOT discard).
 *
 * Forward-only via _schema_migrations runner. Idempotent via IF NOT EXISTS
 * does NOT apply to ALTER TABLE ADD COLUMN — SQLite errors on duplicate add.
 * The MIGRATIONS runner protects against double-apply via the version check.
 */
export const V2_SQL = `
  ALTER TABLE blocks ADD COLUMN cold_storage INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_blocks_cold_storage ON blocks(cold_storage);
` as const;
```

**Conventions to honor:**
- `INTEGER NOT NULL DEFAULT 0` instead of `BOOLEAN` because SQLite has no native BOOLEAN — Phase 2 used INTEGER for timestamps and REAL for confidence; stay consistent.
- `IF NOT EXISTS` works on the index but NOT on ALTER TABLE ADD COLUMN — the migration runner's version check is the idempotency guarantee.
- `as const` matches V1_SQL's discipline (template literal frozen at compile time).

---

### `packages/workspace-do/src/migrations.ts` (MODIFY — append v2 Migration)

**Analog:** Itself — `packages/workspace-do/src/migrations.ts` lines 42–53 (the `Migration` interface + `MIGRATIONS` array).

**Additive diff**:
```typescript
// migrations.ts:40 — extend import:
import { V1_SQL, V2_SQL } from "./schema.js";

// migrations.ts:51–53 — APPEND v2 entry:
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema",  sql: V1_SQL },
  { version: 2, name: "v2_cold_storage",    sql: V2_SQL }, // Phase 5 CONTEXT.md D-07
];
```

**Conventions to honor:**
- Version numbers monotonic + gap-free. The runner (lines 55–86) walks the array in order and skips already-applied versions.
- `name` snake_case + version-prefixed for grep + log readability.

---

### `packages/workspace-do/src/queries.ts` (MODIFY — add 5 query helpers)

**Analog:** Itself — `packages/workspace-do/src/queries.ts` lines 314–442 (the 4 existing helpers: insertBlock 314–332, getBlock 345–367, lexicalSearchBlocks 389–406, deleteBlock 424–442).

**Pattern to copy verbatim** — single-row update helper shape mirrors `insertBlock`:
```typescript
// queries.ts:314–332 — insertBlock as the template for stampEmbedding + updateBlockEnrichment.

// 8. stampEmbedding — UPDATE blocks SET embedding_model, embedding_version WHERE id (STO-04 columns)
export function stampEmbedding(
  sql: SqlStorage,
  args: { block_id: string; embedding_model: string; embedding_version: number },
): void {
  const result = sql.exec(
    "UPDATE blocks SET embedding_model = ?, embedding_version = ?, updated_at = ? WHERE id = ?",
    args.embedding_model,
    args.embedding_version,
    Date.now(),
    args.block_id,
  );
  if (result.rowsWritten === 0) {
    throw new NotFoundError("block", args.block_id);
  }
}

// 9. getBlocksByIds — multi-row read by ID list (mirrors lexicalSearchBlocks shape)
export function getBlocksByIds(sql: SqlStorage, ids: string[]): Memory[] {
  if (ids.length === 0) return [];
  // Positional bindings only — Pitfall 8.
  const placeholders = ids.map(() => "?").join(", ");
  const rows = sql
    .exec(`SELECT id, type, content, summary, properties, embedding_id, embedding_model, embedding_version, scope, project_id, source, confidence, created_at, updated_at FROM blocks WHERE id IN (${placeholders}) AND cold_storage = 0`, ...ids)
    .toArray();
  return rows.map((row) => narrowBlockRow(row as Record<string, SqlStorageValue | undefined>));
}

// 10. updateBlockEnrichment — UPDATE properties + summary post-extract (AI-05 / AI-06 store-normal)
export function updateBlockEnrichment(
  sql: SqlStorage,
  args: { block_id: string; properties: Record<string, unknown>; summary: string },
): void { /* ... mirror stampEmbedding shape ... */ }

// 11. moveToInbox — INSERT inbox row + leave blocks row in place (AI-06 inbox)
export function moveToInbox(sql: SqlStorage, args: { block_id: string; entry: InboxEntry }): void {
  // Delegate to existing createInboxEntry query (lines 472–483)
}

// 12. moveToColdStorage — UPDATE blocks SET cold_storage = 1 (AI-06 cold-storage)
export function moveToColdStorage(sql: SqlStorage, args: { block_id: string }): void {
  sql.exec("UPDATE blocks SET cold_storage = 1, updated_at = ? WHERE id = ?", Date.now(), args.block_id);
}
```

**Conventions to honor:**
- Throw `NotFoundError("block", id)` on zero-row UPDATE — matches existing `getBlock` D-02 pattern (lines 352–354).
- `getBlocksByIds` EXCLUDES `cold_storage = 1` rows per CONTEXT.md D-07 (cold blocks not in default recall).
- Positional `?` only — Pitfall 8.
- Single-statement `.exec()` per helper — Pitfall 8.
- Sync return type (matches D-01 sync-only contract on every helper, lines 16–22 of file header).

---

### `packages/workspace-do/src/index.ts` (MODIFY — expose 5 new RPC methods)

**Analog:** Itself — `packages/workspace-do/src/index.ts` lines 163–206 (existing 7 methods).

**Method shape to copy verbatim** (every existing method follows this exact 3-line skeleton):
```typescript
// index.ts:163–166 — the canonical method shape (insertBlock):
insertBlock(args: { workspace_id: string; block: Memory }): void {
  this.assertOwnsWorkspace(args.workspace_id);  // STO-07 — MUST be first executable line
  insertBlockQuery(this.ctx.storage.sql, args.block);
}

// Phase 5 additions (mirror exactly):
stampEmbedding(args: {
  workspace_id: string;
  block_id: string;
  embedding_model: string;
  embedding_version: number;
}): void {
  this.assertOwnsWorkspace(args.workspace_id);
  stampEmbeddingQuery(this.ctx.storage.sql, {
    block_id: args.block_id,
    embedding_model: args.embedding_model,
    embedding_version: args.embedding_version,
  });
}

getBlocksByIds(args: { workspace_id: string; ids: string[] }): Memory[] {
  this.assertOwnsWorkspace(args.workspace_id);
  return getBlocksByIdsQuery(this.ctx.storage.sql, args.ids);
}

updateBlockEnrichment(args: {
  workspace_id: string;
  block_id: string;
  properties: Record<string, unknown>;
  summary: string;
}): void {
  this.assertOwnsWorkspace(args.workspace_id);
  updateBlockEnrichmentQuery(this.ctx.storage.sql, {
    block_id: args.block_id, properties: args.properties, summary: args.summary,
  });
}

moveToInbox(args: { workspace_id: string; block_id: string; entry: InboxEntry }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  moveToInboxQuery(this.ctx.storage.sql, { block_id: args.block_id, entry: args.entry });
}

moveToColdStorage(args: { workspace_id: string; block_id: string }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  moveToColdStorageQuery(this.ctx.storage.sql, { block_id: args.block_id });
}
```

**Import block extension** (index.ts:73–82):
```typescript
import {
  insertBlock as insertBlockQuery,
  getBlock as getBlockQuery,
  lexicalSearchBlocks as lexicalSearchBlocksQuery,
  deleteBlock as deleteBlockQuery,
  listMemoryTypes as listMemoryTypesQuery,
  createInboxEntry as createInboxEntryQuery,
  listConflicts as listConflictsQuery,
  // === Phase 5 additions ===
  stampEmbedding as stampEmbeddingQuery,
  getBlocksByIds as getBlocksByIdsQuery,
  updateBlockEnrichment as updateBlockEnrichmentQuery,
  moveToInbox as moveToInboxQuery,
  moveToColdStorage as moveToColdStorageQuery,
} from "./queries.js";
```

**Conventions to honor:**
- `assertOwnsWorkspace` is the FIRST EXECUTABLE LINE — checked by every existing method (lines 164, 169, 175, 183, 188, 193, 199). Any new method must follow.
- Rename-on-import `<name> as <name>Query` avoids shadowing — matches existing pattern (lines 74–80).
- `// prettier-ignore -- keep ... on the signature line` comment may be needed for any multi-line signature so grep verifier matches (see `listConflicts` line 197 — Phase 5 may not need this since signatures fit on one line).
- Sync method body — `void` return for writes, `T[]` / `T` for reads. Matches lines 163–206 verbatim.

---

### `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` (NEW — routing tracker)

**Analog:** `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` (entire file structure).

**Copy header schema verbatim** from `04-CF-CODE-ASSIST-USAGE.md`, swap "Phase 4" → "Phase 5", projected mix 0% → 40–60% per project CLAUDE.md. Per Plan 05-01 mandate, the tracker MUST include the **3-question checklist** per row (`~/.claude/CLAUDE.md` AI Model Routing).

---

### Doc edits (Wave 0)

| File | Pattern to copy | Diff |
|------|-----------------|------|
| `.planning/phases/05-ai-integration/05-AI-SPEC.md` | self-edit | Amend §4 contract diagram per D-04 — make explicit synthesis is skipped on default verbosity. |
| `.claude/skills/spike-findings-engram/SKILL.md` | self-edit | Append D-05 supersession note to the `<requirements>` line about `verbosity = "both"` default. |
| `CLAUDE.md` (project root) | self-edit | Amend `## Ingest Pipeline` section: remove the `< 0.4 → discard` branch; replace with `< 0.4 → cold-storage` per D-07. |

---

## Shared Patterns

### S1. Module JSDoc Header (Cross-Phase Contract Format)

**Source:** `packages/mcp-server/src/envelope.ts:1–38` + `packages/mcp-server/src/error-mapping.ts:1–43` + `packages/workspace-do/src/index.ts:1–64`.

**Apply to:** Every NEW `.ts` file in Phase 5 (vectorize-helper.ts, ai-helper.ts, hybrid-rank.ts, extract.ts, memorability.ts, schemas.ts, prompts.ts).

**Template** (compressed):
```typescript
/**
 * `<module name>` — <one-line description>.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-NN:** <what invariant this module guarantees>.
 *
 * Design notes (locked):
 * - <load-bearing decision 1>.
 * - <load-bearing decision 2>.
 *
 * Threat model (if security-relevant):
 * - **T-XX-NAME:** <mitigation summary>.
 *
 * Plan boundaries:
 * - Plan 05-NN: <what this plan ships>.
 *
 * @module @engram/<package>/<name>
 */
```

---

### S2. Named-Only Exports, No Default

**Source:** Every file in `packages/mcp-server/src/` and `packages/workspace-do/src/` (zero `export default` in the production source).

**Apply to:** Every new `.ts` module in Phase 5.

**Rationale:** consistent grep-ability of public surface; works with `verbatimModuleSyntax`.

---

### S3. Mandatory `workspace_id` Routing (Defense-in-Depth)

**Source:** `packages/mcp-server/src/tools.ts:46–52,121,154,194,215,234,243` (the SENTINEL anchor + every handler-body `props.workspace_id` read) + `packages/workspace-do/src/index.ts:139–146,163–206` (the `assertOwnsWorkspace` guard).

**Apply to:** Every Phase 5 handler change + every new DO RPC method + every Vectorize call (via `vectorize-helper.ts` mandatory arg).

**Three-layer chain:**
1. **MCP handler:** reads `workspace_id` from `props` (JWT-derived), passes to DO call AND vectorize helper.
2. **Vectorize helper:** mandatory positional `workspaceId` arg → namespace.
3. **DO method:** first executable line is `this.assertOwnsWorkspace(args.workspace_id)`.

**Test gate:** `cross-workspace-pentest.test.ts` Prongs A + B + (NEW) C asserts all three layers.

---

### S4. `mapToMcpError` Funnel in Every Handler `catch`

**Source:** `packages/mcp-server/src/error-mapping.ts:57–73` + every handler body's `} catch (err) { throw mapToMcpError(err); }` (tools.ts:220, 249, 278, 306, 332).

**Apply to:** Every Phase 5 MCP handler modification. The Triage Worker does NOT use `mapToMcpError` (it's a Queue consumer, not an MCP handler) — it uses `console.error("triage:event-name", details)` + `message.ack()` for permanent failures, `message.retry({delaySeconds})` for transient.

---

### S5. `runInDurableObject` for Real-DO Round-Trips

**Source:** `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts:140–155` + `packages/workspace-do/src/__tests__/helpers.test.ts:64–87`.

**Apply to:** Every Phase 5 integration test that needs to assert SQLite state directly (e.g., AI-08 round-trip can use the handler-level assertion + sleep, but cold_storage column writes from Triage Worker need `runInDurableObject` to read `blocks.cold_storage` directly).

**Type-coercion shim** — every test file needs the same `asWorkspaceDO` helper (helpers.test.ts:39–41) because the `runInDurableObject` callback parameter is typed as `DurableObject | Rpc.DurableObject` (constraint widening), not `WorkspaceDO`:
```typescript
function asWorkspaceDO(instance: unknown): WorkspaceDO {
  return instance as WorkspaceDO;
}
```

---

### S6. McpServer.prototype.registerTool Spy for Callback Capture

**Source:** `packages/mcp-server/src/__tests__/tools-integration.test.ts:56–86` (`captureCallback` helper) + `cross-workspace-pentest.test.ts:56–82`.

**Apply to:** Every Phase 5 integration test exercising a tool handler end-to-end. Copy `captureCallback` verbatim.

---

### S7. Single workerd Project Vitest Config (NOT multi-project)

**Source:** `packages/mcp-server/vitest.config.ts` (entire 40-line file).

**Apply to:** `packages/triage-worker/vitest.config.ts` (NEW) — copy verbatim, swap module name. Triage Worker has no `node:child_process` lint test (those live in `workspace-do/vitest.config.ts` multi-project setup).

---

### S8. `.test.jsonc` Suffix Opts Out of FND-08 Wrangler Lint

**Source:** `packages/mcp-server/wrangler.test.jsonc:7–10,15–22` (the JSDoc explaining the FND-08 lint glob bypass) + `scripts/lint-wrangler.mjs` (lint glob is `packages/*/wrangler.jsonc` literal filename).

**Apply to:** `packages/triage-worker/wrangler.test.jsonc` (NEW). Use the `.test.jsonc` suffix; do NOT modify `wrangler.jsonc` to add test-only bindings.

---

### S9. Cross-Worker Service Binding (`script_name`) for DO Reuse

**Source:** AI-SPEC.md §4 "Tool Use" row 3 — `env.WORKSPACE` in `triage-worker` points at the `WorkspaceDO` class hosted by `engram-mcp-server` via `durable_objects.bindings[].script_name = "engram-mcp-server"`.

**Apply to:** `packages/triage-worker/wrangler.jsonc` + `wrangler.test.jsonc`. The `script_name` value MUST exactly match `packages/mcp-server/wrangler.jsonc:7` `name`.

---

### S10. Frozen META_GAPS + Snapshot Lock

**Source:** `packages/mcp-server/src/envelope.ts:56–80` + `packages/mcp-server/src/__tests__/envelope.test.ts:152–158` (snapshot lock).

**Apply to:** Any new META_GAPS string (synthesis-omitted, truncation, cold-storage). Planner must call out `vitest -u` to update the snapshot AFTER the string additions land.

---

### S11. `as const` on Literal Strings + Schemas

**Source:** `packages/mcp-server/src/envelope.ts:69` (META_GAPS) + `packages/mcp-server/src/schemas.ts:46,57,71,79,86` (zod schemas) + `packages/workspace-do/src/schema.ts:66,143` (V1_SQL).

**Apply to:** EMBEDDING_MODEL, EMBEDDING_VERSION, CLASSIFIER_MODEL constants in ai-helper.ts; SYSTEM_MEMORY_TYPES array in triage schemas; SYSTEM_PROMPT in prompts.ts; V2_SQL in schema.ts.

---

### S12. Forward-Only SQLite Migrations via `_schema_migrations` Table

**Source:** `packages/workspace-do/src/migrations.ts:51–86` + `packages/workspace-do/src/schema.ts:1–63` (file header explaining why).

**Apply to:** V2 cold_storage migration. Append to MIGRATIONS array; the runner skips already-applied versions; ALTER TABLE ADD COLUMN is NOT idempotent at SQL level, but the version check in the runner guarantees single-execution.

---

## No Analog Found

Files for which no close codebase analog exists. Planner should use RESEARCH.md or AI-SPEC.md patterns instead, and gate these on `checkpoint:human-verify` tasks:

| File | Role | Data Flow | Source to use |
|------|------|-----------|---------------|
| `scripts/setup-vectorize.sh` | setup script | one-shot CLI | AI-SPEC.md §3 "Installation" + 05-RESEARCH.md §"Vectorize Provisioning" |
| `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` | test fixture | data | AI-SPEC.md §5 "Reference Dataset Spec" (20 examples, 4 buckets of 5, PII-sanitized) |
| `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` | eval config | batch | 05-RESEARCH.md §"Standard Stack — promptfoo" + Promptfoo official docs (Context7 fetch at Wave 5 implementation time) |

---

## Metadata

**Analog search scope:**
- `packages/mcp-server/src/` (all files + `__tests__/`)
- `packages/workspace-do/src/` (all files + `__tests__/`)
- `packages/triage-worker/` (minimal — pre-Phase-5 state)
- `shared/types/src/index.ts`
- `.planning/phases/04-core-tools-envelope/` (PATTERNS.md + SUMMARY structure reference)
- `.planning/phases/04-core-tools-envelope/04-PHASE-5-HANDOFF.md`
- `packages/mcp-server/wrangler.jsonc` + `wrangler.test.jsonc`
- `packages/triage-worker/wrangler.jsonc`
- `scripts/lint-wrangler.mjs` (FND-08 lint glob context)

**Files scanned:** 18 source + 8 test + 6 config = 32 files.

**Pattern extraction date:** 2026-05-28.

**Planner consumption notes:**
- Every NEW file row above includes the exact analog + a code excerpt to anchor `<read_first>` lists; the planner can write `<read_first>` blocks of the form `["packages/mcp-server/src/error-mapping.ts:1–73", "packages/mcp-server/src/envelope.ts:69–80"]` directly.
- The 12 Shared Patterns are referenced by name (S1..S12) from per-task action blocks rather than repeated inline — keep PLAN.md tasks slim.
- The 3 "No Analog Found" rows MUST trigger `checkpoint:human-verify` tasks in the plan (Vectorize CLI semantics + reference-corpus PII sanitization + Promptfoo config legitimacy).
