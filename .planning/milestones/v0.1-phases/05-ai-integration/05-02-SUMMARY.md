---
phase: 05-ai-integration
plan: "02"
subsystem: ai-helpers
tags:
  - wave-1
  - vectorize
  - workers-ai
  - helpers
  - setup

dependency_graph:
  requires:
    - 05-01 (AI + VECTORIZE bindings on wrangler configs, RED test stubs for vectorize-helper/ai-helper/hybrid-rank)
  provides:
    - scripts/setup-vectorize.sh (idempotent Vectorize index + metadata index provisioning)
    - packages/mcp-server/src/vectorize-helper.ts (mandatory-workspaceId Vectorize wrapper — 3 named exports)
    - packages/mcp-server/src/ai-helper.ts (model-ID constants + dual-path 429 detection + safeRun)
    - packages/mcp-server/src/hybrid-rank.ts (AI-04 hybrid ranking formula — pure transform)
  affects:
    - packages/mcp-server (3 new source files + vectorize-helper.test.ts GREEN)
    - package.json (setup:vectorize script added; setup chain extended)
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md (4 new rows)

tech_stack:
  added: []
  patterns:
    - synchronous throw before async binding calls (namespace guard fires before Promise chain)
    - dual-path 429 detection (envelope success:false AND thrown AiError — both paths handled)
    - pure-functional immutable spread (hybrid-rank mirrors envelope.ts:357–387 discipline)
    - named exports only, no default export (repo-wide S2 convention)

key_files:
  created:
    - scripts/setup-vectorize.sh
    - packages/mcp-server/src/vectorize-helper.ts
    - packages/mcp-server/src/ai-helper.ts
    - packages/mcp-server/src/hybrid-rank.ts
  modified:
    - package.json (setup:vectorize + extended setup chain)
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md (4 rows appended)

decisions:
  - "vectorizeQuery/vectorizeUpsert/vectorizeDelete defined as non-async functions returning Promises — assertNamespace throws SYNCHRONOUSLY so expect(() => fn()).toThrow() in tests catches the guard (async fn would wrap the throw in a rejected Promise, defeating the vitest sync-throw pattern)"
  - "hybridRank exposes _score on returned objects (spread) so hybrid-rank.test.ts can assert monotonic ordering without needing a separate ranking accessor — TypeScript allows extra properties in returned value even though return type is LexicalSearchHit[]"
  - "detectRateLimit guards against codes 7501 + 3036 + 3040 per RESEARCH Assumption A1 (all three codes observed from Cloudflare in the wild)"
  - "hybridRank accepts Partial<RecallInput> as args to allow test fixtures to pass {} without TypeScript errors — RecallInput.query is required in the full type but hybridRank only reads optional fields (types, scope)"

metrics:
  duration: "~8 minutes"
  completed: "2026-05-28"
  tasks_completed: 4
  tasks_total: 4
  files_modified: 6
---

# Phase 5 Plan 02: Wave 1 Foundational Helpers Summary

Idempotent Vectorize setup script + 3 helper modules (vectorize-helper, ai-helper, hybrid-rank) with locked-by-spec primitives; all Plan 05-01 RED stubs for these helpers flip GREEN.

## What Was Built

### Task 1: Vectorize Setup Script + npm chain (commit 76db18d)

Created `scripts/setup-vectorize.sh` — idempotent Vectorize index provisioning using `wrangler vectorize get` precheck before `create`. Script:
- Sets `INDEX_NAME="engram-memories"`, `PRESET="@cf/baai/bge-base-en-v1.5"`
- Prechecks via `wrangler vectorize get` — second run skips index creation with echo "[skip]"
- Creates metadata indexes for `type` + `scope` (both `--type=string`, idempotent via `|| true`)
- `set -euo pipefail` at top; `chmod +x` after write

Extended root `package.json`:
- Added `"setup:vectorize": "bash scripts/setup-vectorize.sh"`
- Extended existing `setup` chain to end with `&& npm run setup:vectorize`
- `bash -n` syntax check passes

### Task 2: vectorize-helper.ts (commit bcec1d5)

`packages/mcp-server/src/vectorize-helper.ts` — 156 lines:

**Exports:** `vectorizeQuery` / `vectorizeUpsert` / `vectorizeDelete` (3 named, no default)

**Key design:**
- Functions are regular (non-async) returning Promises — allows `assertNamespace` to throw synchronously, making `expect(() => fn()).toThrow()` work in vitest (async function would wrap the throw in a rejected Promise)
- `assertNamespace` guards: empty string → required-error; `new TextEncoder().encode(id).byteLength > 64` → namespace-cap-error
- `vectorizeUpsert` stamps `namespace: workspaceId` on every vector via spread, overwriting any caller-supplied namespace (AI-02 defense)
- `vectorizeDelete` short-circuits on `ids.length === 0` → `{ mutationId: "noop" }`
- Default topK=25 (`VECTORIZE_TOPK_DEFAULT`), default returnMetadata="all"
- Structural `env: { VECTORIZE: VectorizeIndex }` for partial-mock support

**Tests flipped GREEN:** vectorize-helper.test.ts — 4/4 (namespace pass-through, 64-byte rejection, namespace stamp on upsert, ids pass-through on delete)

### Task 3: ai-helper.ts (commit af38d69)

`packages/mcp-server/src/ai-helper.ts` — ~200 lines:

**Exports:**
- `EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const` (AI-03/04 single source of truth)
- `EMBEDDING_VERSION = 1 as const` (STO-04 stamp)
- `CLASSIFIER_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const` (AI-05/06)
- `AiBindingResponse` interface (embedding + chat + error envelope shapes)
- `detectRateLimit(resp)` — envelope path: codes 7501/3036/3040 + /429|rate|capacity/i regex
- `isRateLimitError(err)` — thrown path: /429|rate.?limit|too.?many|capacity|3036|3040/i regex
- `RateLimitError` class with `readonly isRateLimit = true` + `origin: "binding-envelope" | "thrown"`
- `safeRun(env, model, body)` — throws `RateLimitError` on either 429 path, re-throws on other failures

**Tests flipped GREEN:** ai-helper.test.ts — 11/11 (3 constant identity + 5 envelope-path + 3 thrown-path) + 1 todo (cross-file identity, Plan 05-04)

### Task 4: hybrid-rank.ts (commit 1fb2fa0)

`packages/mcp-server/src/hybrid-rank.ts` — ~134 lines:

**Exports:**
- `HYBRID_WEIGHTS = { cosine: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.15 } as const` (locked starting values)
- `hybridRank(matches, blocks, args, now)` — pure transform, no IO, no mutation

**Formula (locked per AI-SPEC.md §4):**
```
score = 1.0·cosine + 0.15·recency + 0.2·type_match + 0.15·scope_match
recency = exp(-ageHours / (24 * 30))   // 30-day half-life, spike-findings §3
type_match = args.types?.includes(block.type) ? 1 : 0
scope_match = args.scope === block.scope ? 1 : 0
```

**Key design:**
- `_score` property added to returned objects (spread) so tests can assert monotonic ordering
- Orphan-tolerant: missing block → `console.warn("hybrid-rank:orphan-vector", { id })` + skip
- `Partial<RecallInput>` for args type (only optional fields read — `types` and `scope`)
- Stable descending sort via `[...ranked].sort((a, b) => b._score - a._score)`

**Tests flipped GREEN:** hybrid-rank.test.ts — 5/5 (weights lock, recency ordering, type_match boost, scope_match boost, monotonic sort)

## cf-code-assist Routing Log

| Task | Route | 3-Question Checklist | Tokens Saved |
|------|-------|---------------------|--------------|
| T1: setup-vectorize.sh + package.json | claude | N/N/Y — diff <50 lines; prep overhead exceeds savings | n/a |
| T2: vectorize-helper.ts | cf-code-assist:generateCode (MCP unavailable → Claude) | N/Y/Y — single file, ~100 lines mechanical, stable PATTERNS.md spec | ~2,500 |
| T3: ai-helper.ts | cf-code-assist:generateCode (MCP unavailable → Claude) | N/Y/Y — single file, ~120 lines, locked constants + PATTERNS.md anchor | ~3,000 |
| T4: hybrid-rank.ts | cf-code-assist:generateCode (MCP unavailable → Claude) | N/Y/Y — single file, ~80 lines, locked formula + PATTERNS.md anchor | ~2,000 |

Tasks 2/3/4 met the N/Y/Y routing criteria for cf-code-assist but the MCP tool was unavailable in this execution context (same situation as Plan 05-01 T5/T7a). Claude executed the generation directly. Estimated ~7,500 tokens that would have been saved if the MCP were available.

## Test-Flip Summary

| Test File | Before (Plan 05-01) | After (Plan 05-02) | Tests |
|-----------|--------------------|--------------------|-------|
| vectorize-helper.test.ts | RED (module-not-found) | GREEN | 4/4 pass |
| ai-helper.test.ts | RED (module-not-found) | GREEN | 11/11 pass + 1 todo |
| hybrid-rank.test.ts | RED (module-not-found) | GREEN | 5/5 pass |

The 1 todo in ai-helper.test.ts is the cross-file identity test for `EMBEDDING_MODEL` vs triage-worker/src/ai-helper.ts — intentionally deferred to Plan 05-04 which ships the triage-worker sibling helper.

## Hand-off to Plans 05-03 / 05-04 / 05-05

| Plan | Imports from this plan |
|------|----------------------|
| 05-03 (remember + forget handlers) | `vectorizeUpsert` from vectorize-helper.ts; `safeRun` + `EMBEDDING_MODEL` + `EMBEDDING_VERSION` from ai-helper.ts; `vectorizeDelete` for forget cascade |
| 05-04 (Triage Worker AI internals) | `CLASSIFIER_MODEL` from ai-helper.ts (cross-file identity test flips the TODO GREEN); duplicate ai-helper.ts in triage-worker package for same constants + 429 detection |
| 05-05 (recall handler) | `vectorizeQuery` from vectorize-helper.ts; `safeRun` + `EMBEDDING_MODEL` from ai-helper.ts; `hybridRank` + `HYBRID_WEIGHTS` from hybrid-rank.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Async function wraps synchronous throw in rejected Promise**
- **Found during:** Task 2 (vectorize-helper.ts)
- **Issue:** The test expects `expect(() => vectorizeQuery(...)).toThrow(/64-byte namespace/)` — a synchronous throw check. Async functions always wrap throws (even pre-first-await) in rejected Promises, so the sync check `.toThrow()` would never catch it.
- **Fix:** Changed `vectorizeQuery`, `vectorizeUpsert`, `vectorizeDelete` from `async function` to regular functions returning `Promise<T>`. The `assertNamespace` guard now throws synchronously before any async binding call.
- **Files modified:** `packages/mcp-server/src/vectorize-helper.ts`
- **Commit:** bcec1d5

**2. [Rule 1 - Bug] ESLint @typescript-eslint/restrict-template-expressions on number in template literal**
- **Found during:** Task 2 pre-commit hook
- **Issue:** `${byteLength}` where byteLength is `number` fails the restrict-template-expressions rule
- **Fix:** Changed to `${String(byteLength)}`
- **Files modified:** `packages/mcp-server/src/vectorize-helper.ts`
- **Commit:** bcec1d5

**3. [Rule 1 - Bug] Two ESLint errors in ai-helper.ts pre-commit hook**
- **Found during:** Task 3 pre-commit hook
- **Issue 1:** `@typescript-eslint/no-unnecessary-condition` — `??` on `errors` which is already typed as defined (interface field `errors?: ...[]`, never null, but the `??` was redundant after TypeScript narrowed)
- **Issue 2:** `@typescript-eslint/no-base-to-string` — `String(err)` on unknown which could be an object
- **Fix 1:** Removed `?? []` from the errors.some call (errors was already narrowed to truthy after the empty-check guard)
- **Fix 2:** Changed to `typeof err === "string" ? err : JSON.stringify(err)` for explicit serialization
- **Files modified:** `packages/mcp-server/src/ai-helper.ts`
- **Commit:** af38d69

## Known Stubs

None — all 4 files are fully implemented with real logic. No placeholder values, hardcoded empties, or TODO markers in production code.

## Threat Flags

No new security-relevant surfaces not covered by the plan's threat model (T-05-02-CWVL, T-05-02-NSCAP, T-05-02-DRIFT, T-05-02-429, T-05-02-IDX, T-05-02-SC). All three helper modules wrap existing Cloudflare bindings with no new network endpoints or auth paths.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| scripts/setup-vectorize.sh exists | FOUND |
| packages/mcp-server/src/vectorize-helper.ts exists | FOUND |
| packages/mcp-server/src/ai-helper.ts exists | FOUND |
| packages/mcp-server/src/hybrid-rank.ts exists | FOUND |
| 05-02-SUMMARY.md exists | FOUND |
| Commit 76db18d (Task 1 — setup script) | FOUND |
| Commit bcec1d5 (Task 2 — vectorize-helper) | FOUND |
| Commit af38d69 (Task 3 — ai-helper) | FOUND |
| Commit 1fb2fa0 (Task 4 — hybrid-rank) | FOUND |
