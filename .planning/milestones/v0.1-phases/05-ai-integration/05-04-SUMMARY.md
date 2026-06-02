---
phase: 05-ai-integration
plan: "04"
subsystem: triage-worker
tags:
  - wave-2b
  - ai-05
  - ai-06
  - ai-07
  - triage-worker
  - schemas
  - prompts
  - memorability
  - queue-consumer

dependency_graph:
  requires:
    - 05-01 (triage-worker vitest harness, wrangler bindings, extract.test.ts RED stubs, DO RPC methods)
    - 05-02 (mcp-server/src/ai-helper.ts — sibling file copied verbatim as the byte-identical source)
  provides:
    - packages/triage-worker/src/ai-helper.ts (model constants + dual-path 429 detection)
    - packages/triage-worker/src/schemas.ts (TriageOutput Zod schema + TRIAGE_JSON_SCHEMA)
    - packages/triage-worker/src/prompts.ts (byte-frozen SYSTEM_PROMPT — 5 drop categories)
    - packages/triage-worker/src/memorability.ts (routeByMemorability — cold-storage NOT discard)
    - packages/triage-worker/src/extract.ts (extractAndScore — dual-path 429 + Zod gate + retry)
    - packages/triage-worker/src/index.ts (Queue consumer default export + memorability routing)
    - packages/mcp-server/src/__tests__/ai-helper-identity.test.ts (cross-file equality gate)
    - CF-code-assist routing rows for 05-04 tasks
  affects:
    - packages/triage-worker (6 source files — 5 new, 1 rewritten)
    - packages/mcp-server (ai-helper.test.ts updated, ai-helper-identity.test.ts NEW, vitest.config.ts extended)
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md (8 rows appended)

tech_stack:
  added:
    - zod-to-json-schema@^3.25.2 (packages/triage-worker) — AUDITED by Russell 2026-05-28
  patterns:
    - dual-path 429 detection (envelope success:false AND thrown AiError — both paths handled)
    - Zod safeParse gate at LLM boundary (one retry at 5s, then ack+log DLQ-equiv)
    - byte-frozen SYSTEM_PROMPT as const (prompt engineering discipline per AI-SPEC.md)
    - zodToJsonSchema(TriageOutput, { target: "openApi3", $refStrategy: "none" }) for response_format
    - cross-file identity test in lint-node pool (node:fs readFileSync — workerd pool cannot cross-package read)
    - sequential for-loop (not Promise.all) in queue consumer (429-safe for v0.1 single-user)
    - CONTEXT.md D-07 enforcement: cold-storage return in memorability.ts + moveToColdStorage in index.ts

key_files:
  created:
    - packages/triage-worker/src/ai-helper.ts (236 lines)
    - packages/triage-worker/src/schemas.ts (123 lines)
    - packages/triage-worker/src/prompts.ts (60 lines)
    - packages/triage-worker/src/memorability.ts (58 lines)
    - packages/triage-worker/src/extract.ts (167 lines)
    - packages/mcp-server/src/__tests__/ai-helper-identity.test.ts (69 lines)
  modified:
    - packages/triage-worker/src/index.ts (rewritten from 5-line stub to 206-line consumer)
    - packages/triage-worker/package.json (added zod-to-json-schema@^3.25.2)
    - packages/mcp-server/src/__tests__/ai-helper.test.ts (it.todo → it.skip with lint-node pool redirect)
    - packages/mcp-server/vitest.config.ts (added ai-helper-identity.test.ts to lint-node pool)
    - .planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md (8 rows appended)

decisions:
  - "Cross-file identity test placed in lint-node pool (ai-helper-identity.test.ts), not workerd pool — workerd runtime's readAll syscall cannot resolve cross-package paths; node:fs readFileSync works correctly in the Node pool (same solution as lint-no-direct-vectorize.test.ts)"
  - "ai-helper.test.ts cross-file it.todo → it.skip with redirect comment; the actual identity assertions live in ai-helper-identity.test.ts (lint-node pool) with 4 assertions all passing"
  - "index.ts sequential for-loop over batch.messages (not Promise.all) — parallel env.AI.run without concurrency cap triggers 429s in large batches; sequential is correct for v0.1 single-user volume"
  - "Type cast (stub as unknown as {...}).method() for cross-Worker DO RPC calls — env.WORKSPACE is typed as DurableObjectNamespace (general); WorkspaceDO RPC methods are not in its type surface; Plan 05-07 v0.2 may introduce @engram/workspace-do type re-export"
  - "Message type aliased locally in extract.ts (not imported from cloudflare:workers-types) — the subset interface is sufficient for the test mock shape and avoids a cloudflare:workers-types import that would require wrangler types to have been run"

metrics:
  duration: "~14 minutes"
  completed: "2026-05-28"
  tasks_completed: 5
  tasks_total: 5
  files_modified: 11
---

# Phase 5 Plan 04: Wave 2b Triage Worker AI Internals Summary

Triage Worker AI internals shipped: ai-helper sibling, Zod schemas + JSON schema derivation, byte-frozen SYSTEM_PROMPT with 5-drop-category spec, memorability routing (cold-storage NOT discard per D-07), extractAndScore with dual-path 429 + Zod gate, and Queue consumer entry. All 4 Plan 05-01 RED stubs in extract.test.ts flip GREEN. Cross-file model-constant identity gate passes (AI-SPEC.md §5 dimension #2).

## What Was Built

### Task 1: zod-to-json-schema install (commit d9abbf2)

Package audit APPROVED by Russell 2026-05-28: StefanTerdell/zod-to-json-schema, ~4.5 years old, ~2.6k stars, canonical Zod→JSON-schema library.

- Added `"zod-to-json-schema": "^3.25.2"` to `packages/triage-worker/package.json` dependencies
- Installed in workspace node_modules (version 3.25.2)

### Task 2: ai-helper.ts sibling + cross-file identity test (commit 65d64f3)

`packages/triage-worker/src/ai-helper.ts` — 236 lines, byte-identical model constants to mcp-server's ai-helper.ts:
- `EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const`
- `EMBEDDING_VERSION = 1 as const`
- `CLASSIFIER_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const`
- `detectRateLimit`, `isRateLimitError`, `safeRun`, `RateLimitError` — same 429 detection logic

**Cross-file identity gate** (`packages/mcp-server/src/__tests__/ai-helper-identity.test.ts`):
- 4 assertions in the lint-node pool using `node:fs readFileSync`
- Reads `triage-worker/src/ai-helper.ts` and asserts each constant literal matches mcp-server's
- All 4 PASS; any future drift fails at PR-time CI

**Deviation (Rule 1):** Cross-file identity test placed in a new `ai-helper-identity.test.ts` (lint-node pool) rather than inlined in `ai-helper.test.ts` (workerd pool) — workerd's `readAll` syscall cannot resolve cross-package file paths. Same solution as `lint-no-direct-vectorize.test.ts`. Test name in `ai-helper.test.ts` converted to `it.skip` with redirect comment.

### Task 3: schemas.ts + prompts.ts + memorability.ts (commit c8c3b44)

**schemas.ts** — 123 lines, 9 named exports:
- `SYSTEM_MEMORY_TYPES` as const tuple (7 types)
- `Entity` Zod schema (name: min 1/max 200; type: person|company|role|date|url)
- `TriageOutput` Zod schema (6 fields with validation bounds)
- `type TriageOutput` (z.infer alias)
- `TRIAGE_JSON_SCHEMA` = zodToJsonSchema(TriageOutput, { target: "openApi3", $refStrategy: "none" })

**prompts.ts** — 60 lines, 1 export:
- `SYSTEM_PROMPT as const` — byte-frozen, ~550 tokens
- Covers all 5 drop categories from spike-findings §6: dates, sources, technical identifiers, numeric values, decision-rejection naming
- Memorability rubric inline: >0.8/0.4–0.8/<0.4 bands with concrete examples

**memorability.ts** — 58 lines, 2 exports:
- `RouteDecision` type: "store-normal" | "inbox" | "cold-storage"
- `routeByMemorability(score)` — pure predicate, returns `"cold-storage"` NOT `"discard"` per CONTEXT.md D-07 cardinal-sin clause
- JSDoc explicitly names D-07, threshold lock (0.8 and 0.4), and Plan 05-06 calibration dependency

### Task 4: extract.ts extractAndScore (commit b7d533a)

`packages/triage-worker/src/extract.ts` — 167 lines, 2 exports (`Message` interface + `extractAndScore`):
- `env.AI.run(CLASSIFIER_MODEL, { messages, response_format: { type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA }, temperature: 0.2, max_tokens: 1024 })`
- AI-07 dual-path #1: `try/catch` around AI call → `isRateLimitError(err)` → `message.retry({ delaySeconds: 30 })`
- AI-07 dual-path #2: `detectRateLimit(aiResp)` on envelope → `message.retry({ delaySeconds: 30 })`
- Zod gate: `TriageOutput.safeParse(candidate)` — `attempts < 2` → retry(5s); `attempts >= 2` → ack+error-log
- Workers AI `response` field unwrap: `(aiResp as { response?: unknown }).response ?? aiResp`

**Plan 05-01 RED stubs flip GREEN** — all 4 `it()` blocks in `extract.test.ts`:
- AI-07 dual-path #1: thrown AiError(429) → retry(30s) PASS
- AI-07 dual-path #2: envelope {success:false, errors:[{code:7501}]} → retry(30s) PASS
- AI-05 Zod parse fail + attempts<2 → retry(5s) PASS
- AI-05 Zod parse fail + attempts>=2 → ack (permanent failure DLQ-equiv) PASS

### Task 5: index.ts Queue consumer (commit 0ce1a3d)

`packages/triage-worker/src/index.ts` — 206 lines (rewritten from 5-line stub):
- `Env` interface: AI + VECTORIZE + WORKSPACE + ANALYTICS? (all bindings from Plan 05-01 wrangler.jsonc)
- `default { queue(batch, env) }` — Cloudflare Queue consumer
- Sequential for-loop (429-safe for v0.1 single-user volume)
- `extractAndScore` → null-check → continue; else `routeByMemorability` → 3-way switch
- `store-normal` → `stub.updateBlockEnrichment(...)` 
- `inbox` → `stub.moveToInbox(...)` 
- `cold-storage` → `stub.moveToColdStorage(...)` (NOT discardWithLog — D-07 enforced)
- DO stub: `env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id))`

## Package Legitimacy Audit Decision

**APPROVED** — zod-to-json-schema@^3.25.2

Russell verified 2026-05-28 via `npm view` + GitHub repository inspection:
- Repository: git+https://github.com/StefanTerdell/zod-to-json-schema.git
- Maintainer: stefan-terdell (npm) = StefanTerdell (GitHub) — same account
- First published: 2021-02-24 (~4.5 years old at approval date)
- Stars: ~2.6k (well-known in the Zod ecosystem — canonical conversion library)
- Version installed: 3.25.2

## Cross-File Identity Test Results

| Assertion | Status |
|-----------|--------|
| mcp-server EMBEDDING_MODEL prerequisite check | PASS |
| EMBEDDING_MODEL literal identity (mcp-server = triage-worker) | PASS |
| EMBEDDING_VERSION numeric literal identity | PASS |
| CLASSIFIER_MODEL literal identity | PASS |

Both files contain `EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const`, `EMBEDDING_VERSION = 1 as const`, and `CLASSIFIER_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const`.

## Plan 05-01 extract.test.ts Status

All 4 RED stubs flip GREEN:
- "AI-07 dual-path #1: thrown AiError(429) triggers message.retry({delaySeconds: 30})" — PASS
- "AI-07 dual-path #2: envelope {success:false, errors:[{code:7501}]} triggers message.retry" — PASS
- "AI-05: Zod parse fail + attempts<2 → message.retry({delaySeconds: 5})" — PASS
- "AI-05: Zod parse fail + attempts>=2 → message.ack (permanent failure, DLQ-equivalent)" — PASS

## D-07 Cardinal-Sin Clause Compliance

| File | Check | Status |
|------|-------|--------|
| memorability.ts | returns `"cold-storage"` (NOT `"discard"`) | PASS |
| memorability.ts | `"cold-storage"` string present | PASS |
| memorability.ts | comments reference D-07 explicitly | PASS |
| index.ts | `moveToColdStorage` call present | PASS |
| index.ts | `discardWithLog` not called | PASS |
| index.ts | D-07 referenced in code comments | PASS |

## Phase 6 Hand-Off Notes

1. **Queue consumer binding** — `packages/triage-worker/wrangler.jsonc` needs `queues.consumers[]` entry naming the `engram-ingest` queue. Phase 6 PIP-01 owns this. Until then, the consumer body in `index.ts` is unreachable from real Queue messages (only via test invocation of `extractAndScore` directly).

2. **Queue producer** — `packages/mcp-server/src/tools.ts` `remember()` handler needs `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))` after the embed+upsert path. Phase 6 PIP-02 owns this. Plan 05-03's `remember()` does NOT send Queue messages.

3. **INGEST_QUEUE binding** — `packages/mcp-server/wrangler.jsonc` needs `queues.producers[]` entry. Phase 6 PIP-03 owns this.

When Phase 6 wires all three, the full triage pipeline (remember → Queue → Triage Worker → WorkspaceDO) becomes end-to-end functional.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-file identity test in lint-node pool instead of workerd pool**
- **Found during:** Task 2 — workerd runtime's `readAll` syscall fails for cross-package `node:fs` reads
- **Issue:** `@cloudflare/vitest-pool-workers` workerd runtime doesn't implement `readAll` for paths outside the Worker bundle; `readFileSync` from `node:fs` fails with `ENOENT` even when the file exists
- **Fix:** Created `ai-helper-identity.test.ts` in the lint-node pool (same pattern as `lint-no-direct-vectorize.test.ts`); converted `ai-helper.test.ts` cross-file `it.todo` to `it.skip` with redirect comment; added `ai-helper-identity.test.ts` to `vitest.config.ts` lint-node includes
- **Files modified:** `ai-helper-identity.test.ts` (new), `ai-helper.test.ts` (skip update), `vitest.config.ts` (lint-node include)
- **Commit:** 65d64f3

## cf-code-assist Routing (05-04)

| Task | Route | Q1/Q2/Q3 | Approx Tokens Saved |
|------|-------|-----------|---------------------|
| T1: package.json zod-to-json-schema install | claude | N/N/N | n/a (audit step) |
| T2: ai-helper.ts + identity test + vitest.config.ts | claude | Y/N/N | n/a (cross-file invariants) |
| T3-schemas: schemas.ts (TriageOutput + TRIAGE_JSON_SCHEMA) | cf-code-assist:generateTypes (unavailable → Claude) | N/Y/Y | ~2,500 |
| T3-prompts: prompts.ts (SYSTEM_PROMPT byte-frozen) | claude | N/N/Y | n/a (load-bearing prose) |
| T3-memorability: memorability.ts (pure predicate) | claude | N/N/Y | n/a (<50 lines) |
| T4: extract.ts (extractAndScore) | cf-code-assist:generateCode (unavailable → Claude) | N/Y/Y | ~3,500 |
| T5: index.ts (Queue consumer) | cf-code-assist:generateWorkerBoilerplate (unavailable → Claude) | N/Y/Y | ~4,000 |

**Plan 05-04 routing: 0/7 to cf-code-assist (all executed by Claude — MCP unavailable in execution context). Intended routes: 3/7 (T3-schemas, T4, T5). Missed tokens: ~10,000 est.**

## Known Stubs

None — all 6 triage-worker source files implement their full v0.1 behavior. The Queue consumer (`index.ts`) is complete but unreachable end-to-end until Phase 6 wires the Queue producer + consumer binding (documented in Phase 6 Hand-Off Notes above).

## Threat Surface Scan

No new security surfaces introduced beyond those in the Plan 05-04 threat model:
- Workers AI calls go through dual-path 429 detection (T-05-04-429 mitigated)
- Zod gate at LLM boundary (T-05-04-ZOD mitigated)
- cold-storage routing (T-05-04-DISCARD mitigated — D-07 enforced)
- Cross-Worker DO RPC via workspace_id (T-05-04-AUTH tracked — STO-07 verifies at DO boundary)

## Self-Check: PASSED

**Files verified:**
- FOUND: packages/triage-worker/src/ai-helper.ts
- FOUND: packages/triage-worker/src/schemas.ts
- FOUND: packages/triage-worker/src/prompts.ts
- FOUND: packages/triage-worker/src/memorability.ts
- FOUND: packages/triage-worker/src/extract.ts
- FOUND: packages/triage-worker/src/index.ts
- FOUND: packages/mcp-server/src/__tests__/ai-helper-identity.test.ts
- FOUND: .planning/phases/05-ai-integration/05-04-SUMMARY.md

**Commits verified:**
- d9abbf2: chore(05-04): install zod-to-json-schema@^3.25.2 in triage-worker
- 65d64f3: feat(05-04): ai-helper.ts sibling in triage-worker + cross-file identity test
- c8c3b44: feat(05-04): triage-worker schemas, prompts, memorability primitives
- b7d533a: feat(05-04): extract.ts extractAndScore with dual-path 429 + Zod gate + retry policy
- 0ce1a3d: feat(05-04): index.ts Queue consumer entry — memorability routing to WorkspaceDO RPC
