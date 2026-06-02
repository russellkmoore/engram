---
phase: 06-async-pipeline
plan: 04
subsystem: async-pipeline
tags: [queue, producer, consumer, mcp-server, triage-worker, pip-02, pip-03, pip-05, ctx-waituntil, mark-ingest-failed]

# Dependency graph
requires:
  - phase: 06-async-pipeline
    provides: "INGEST_QUEUE producer binding + registerTools getCtx accessor (06-02) AND markIngestFailed RPC + helper on WorkspaceDO (06-03)"
provides:
  - "remember() handler now assembles a MemoryEvent and fires getCtx().waitUntil(INGEST_QUEUE.send(...)) after Vectorize upsert succeeds — PIP-02 + PIP-03"
  - "ingest() honest-stub stays in place; Phase-6-handoff comments retargeted to v0.4 connectors per D-02"
  - "extract.ts permanent-fail branches (Zod-permanent attempts>=2; non-429-throw last-attempt) call markIngestFailed before ack — PIP-05"
  - "index.ts queue handler wraps the 3-case DO-RPC switch in try/catch; on catch + attempts>=2 calls markIngestFailed + ack (pre-empts silent retry-exhaustion drop); on catch + attempts<2 calls retry({delaySeconds:30}) — PIP-05"
affects:
  - packages/mcp-server/src/tools.ts
  - packages/triage-worker/src/extract.ts
  - packages/triage-worker/src/index.ts
  - packages/triage-worker/src/__tests__/extract.test.ts (1 new test + 4 mock-env widenings)
  - packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts (Rule 3 cast fix)

# Tech tracking
tech-stack:
  added: [] # Pure plumbing — no new dependencies
  patterns:
    - "Pattern G — ctx.waitUntil for fire-and-forget side effects (PATTERNS.md §G; new to this codebase). Used by remember() to decouple the response path from the Queue send latency."
    - "Lazy binding dereference (B3 fix) — env.INGEST_QUEUE read INSIDE the handler body on every invocation, NOT closure-captured at registerTools entry. Diverges from the workspaceNs closure-capture pattern by design."
    - "Inner try/catch around every markIngestFailed RPC call — guards against the failure-of-failure case (NotFoundError or McpError from STO-07) so the message still exits the queue. No infinite retries."
    - "Attempts pre-emption — Triage Worker checks (message.attempts ?? 0) >= 2 before letting an error bubble to the Queues runtime. The runtime silently acks at retry exhaustion; we pre-empt with markIngestFailed + ack ourselves."

key-files:
  created: []
  modified:
    - "packages/mcp-server/src/tools.ts — +69 lines: MemoryEvent assembly + lazy INGEST_QUEUE dereference + getCtx().waitUntil(...) IIFE + two writeAnalytics call sites + ingest() comment retarget (D-02)"
    - "packages/triage-worker/src/extract.ts — widened env type to include WORKSPACE: DurableObjectNamespace; injected markIngestFailed call into Zod-permanent-fail branch (between writeAnalytics and ack); injected markIngestFailed call into non-429 throw branch on isLastAttempt (with ack + return null instead of re-throw on last attempt)"
    - "packages/triage-worker/src/index.ts — wrapped DO-RPC switch in try/catch + attempts pre-emption (markIngestFailed + ack on last attempt; retry({delaySeconds:30}) on earlier attempts)"
    - "packages/triage-worker/src/__tests__/extract.test.ts — added makeWorkspaceStub() helper; widened 4 mockEnv literals with WORKSPACE binding; added 1 new PIP-05 test asserting markIngestFailed-before-ack ordering"
    - "packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts — Rule 3 cast fix (eval-test env cast was too narrow after env-type widening; removed unused Ai import)"

key-decisions:
  - "B3 fix landed exactly per plan: env.INGEST_QUEUE is dereferenced LAZILY inside the remember() handler body via `const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;` immediately preceded by the literal `// Phase 6 B3 fix: dereference env.INGEST_QUEUE INSIDE the handler body, NOT at registerTools entry.` This is a deliberate departure from the workspaceNs closure-capture pattern (line 258) and is what makes the PIP-02 latency test in Plan 06-05 Task 2 work (test patches env.INGEST_QUEUE AFTER registerTools has run)."
  - "MemoryEvent.context is always populated (not a conditional spread). The plan suggested `...(props.user_id !== undefined && { context: { user_id: props.user_id } })`, but EngramProps.user_id is typed as `string` (non-optional), making the conditional unnecessary — eslint's no-unnecessary-condition rule rejected the conditional spread. Replaced with unconditional `context: { user_id: props.user_id }`. Semantics identical because the runtime check could never have been false."
  - "extract.ts widened env type via Option A (recommended by PATTERNS.md §7). The signature now declares `WORKSPACE: DurableObjectNamespace` so the permanent-fail branches can call markIngestFailed inline. The caller (index.ts queue handler) already had env.WORKSPACE on its Env interface — passing the full env satisfied the widened type with zero changes at the call site."
  - "Lazy-dereference null-skip pattern. When env.INGEST_QUEUE is undefined (test envs that didn't mock the binding — i.e., every existing TOL-* test), the handler logs `console.warn('mcp-server:INGEST_QUEUE binding absent — queue-send skipped ...')` and proceeds. This keeps the entire pre-existing tools-integration.test.ts suite GREEN without modification while still wiring the Queue path for production."
  - "Inner try/catch around every markIngestFailed call. Three call sites (Zod-permanent in extract.ts; non-429-last-attempt in extract.ts; DO-RPC catch in index.ts) each wrap the markIngestFailed RPC in its own try/catch. The fall-through path on inner-catch is always 'log secondary failure + ack' — guarantees the message exits the queue even in the failure-of-failure case."
  - "Pre-emption threshold of attempts >= 2 (third/last attempt under max_retries=3). The Queues runtime silently acks at attempts === max_retries; the pre-emption fires one attempt earlier so the SQLite surface flips to 'failed' before the runtime would release the message."

patterns-established:
  - "Pattern G (ctx.waitUntil fire-and-forget) — first usage in this codebase; lives in remember() Queue-send call site. The IIFE-wrapped await inside waitUntil is the canonical shape because (a) waitUntil takes a Promise, not a function, and (b) the inner try/catch must be inside the awaited body so uncaught throws don't escape to the silent-in-response-path failure mode."
  - "Lazy env binding pattern divergence — env.INGEST_QUEUE = lazy (B3 fix); env.WORKSPACE = closure-captured (existing workspaceNs). The lazy form is forward-compatible with test-time env patches AND any future runtime rebinding; the closure form is appropriate for stable bindings whose identity does not change. Documented inline in tools.ts."

requirements-completed: [PIP-02, PIP-03, PIP-04, PIP-05]

# Metrics
duration: ~30min
completed: 2026-05-29
tasks_completed: 3
files_changed: 5 (3 source + 2 tests)
commits: 3
commits_list:
  - hash: 673f779
    message: "feat(06-04): wire remember() Queue producer + ingest() comment retarget (PIP-02/03/D-02)"
  - hash: 277c2d2
    message: "feat(06-04): wire extract.ts permanent-fail branches to markIngestFailed (PIP-05)"
  - hash: 7c87a08
    message: "feat(06-04): wrap DO-RPC switch in try/catch + attempts pre-emption + markIngestFailed (PIP-05)"
---

# Phase 6 Plan 04: End-to-End Async Pipeline Wiring Summary

**The full async pipeline is now connected at runtime: `remember() → Queue → Triage Worker → DO RPC → ingest_status='enriched'` on success; `Queue → Triage Worker → markIngestFailed → ingest_status='failed'` on permanent failure. No silent drops on retry exhaustion.**

## Performance

- **Duration:** ~30 minutes
- **Started:** 2026-05-29T13:35:00Z (approx — worktree setup)
- **Completed:** 2026-05-29T13:46:00Z
- **Tasks:** 3
- **Files modified:** 5 (3 source + 2 tests, including 1 Rule 3 eval-test cast fix)
- **Lines added:** ~280 (mostly in extract.ts catch arms + index.ts try/catch wrap + 1 new test)

## What Shipped

### Task 1 — `tools.ts` `remember()` MemoryEvent assembly + `getCtx().waitUntil(INGEST_QUEUE.send)` + `ingest()` comment retarget (commit `673f779`)

The `remember()` handler now appends a Phase 6 PIP-02 block between the Vectorize-upsert `writeAnalytics` call and the `extraGaps` calculation. The block has three logical parts:

1. **MemoryEvent assembly** — `const memoryEvent: MemoryEvent = { id, source, content, workspace_id, timestamp, context, ...hint }` populated per CONTEXT.md §"MemoryEvent payload contents":
   - `id` = the SAME UUID minted at line 281 (`crypto.randomUUID()`) — A11/IP-1 idempotency hook
   - `source` = `args.source ?? "mcp:claude"` (mirrors block.source above)
   - `content` = `args.content` (raw user content, NOT the truncated `contentForEmbed`)
   - `workspace_id` = `props.workspace_id` (MCP-05 / MT-1: ALWAYS from props, NEVER from args)
   - `timestamp` = `now` (same Date.now() used in block.created_at)
   - `context` = `{ user_id: props.user_id }` (unconditional — EngramProps.user_id is non-optional)
   - `hint` = `args.type` via conditional spread (strict exactOptionalPropertyTypes)

2. **Lazy INGEST_QUEUE dereference (B3 fix)** — `const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;` immediately preceded by the literal comment marker:

```typescript
// Phase 6 B3 fix: dereference env.INGEST_QUEUE INSIDE the handler body, NOT at
// registerTools entry. This is a deliberate departure from the workspaceNs
// closure-capture pattern above — required so test-time env.INGEST_QUEUE patches
// (PIP-02 latency test in Plan 06-05 Task 2) take effect, and forward-compatible
// with any future runtime rebinding. The per-invocation property-lookup cost is
// negligible.
const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;
```

This is the verbatim invariant the plan-checker B3 iteration mandated. `grep -B2 "INGEST_QUEUE" packages/mcp-server/src/tools.ts | grep -q "B3 fix"` passes.

3. **getCtx().waitUntil with inner try/catch** — when `ingestQueue !== undefined`, the handler fires `getCtx().waitUntil((async () => { try { await ingestQueue.send(memoryEvent); writeAnalytics(...success); } catch (queueErr) { console.error(...); writeAnalytics(...throw); } })());`. When `ingestQueue === undefined` (test envs without the binding mock), the handler logs `console.warn('mcp-server:INGEST_QUEUE binding absent — queue-send skipped (likely test env without 06-02 binding mock)')` and proceeds. This keeps every pre-existing TOL-* test GREEN without modification.

The `ingest()` honest-stub comments at lines 637 and 651 were retargeted from "Phase 6 adds" to "v0.4 connectors" per D-02 — no behavior change to `ingest()`.

Removed the `void getCtx;` placeholder that 06-02 had added (getCtx is now actually consumed).

### Task 2 — `extract.ts` widened env + `markIngestFailed` in permanent-fail branches (commit `277c2d2`)

The `extractAndScore` env parameter type was widened from `{ AI: Ai; ANALYTICS?: AnalyticsEngineDataset }` to also include `WORKSPACE: DurableObjectNamespace`. The caller (`index.ts` `queue` handler) already had WORKSPACE on its `Env` interface — passing the full env satisfied the widened type without code change at the call site.

Two permanent-fail branches now call `markIngestFailed` before acking:

**Zod-permanent-fail (attempts >= 2)** — between the existing `writeAnalytics(...ack-permanent)` and `message.ack()`, the handler now resolves the DO stub via `env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id))` and calls `markIngestFailed({workspace_id, block_id, reason: 'zod-parse-fail: ' + parsed.error.issues[0]?.message})`. On success, `writeAnalytics(blobs: ["triage-worker", "ingest-failed-zod-parse", wsTag, "marked"])`. On inner-catch (markIngestFailed itself throws), `console.error("triage:mark-failed-also-threw-from-zod", ...)` and fall through to ack.

**Non-429 throw on last attempt** — `const isLastAttempt = (message.attempts ?? 0) >= 2;` inserted before the `throw err`. On `isLastAttempt`, the handler resolves the same DO stub, calls `markIngestFailed({reason: 'ai-throw-non-429: ' + err.message})`, writes `writeAnalytics(blobs: [..., "ingest-failed-ai-throw", ..., "marked"])`, then `message.ack(); return null;` (pre-empts silent drop instead of re-throwing). On non-last attempts, the existing `throw err` keeps the Queue runtime retry budget intact.

**Test infrastructure:**
- New `makeWorkspaceStub()` helper that yields a fake `WORKSPACE` namespace with `markIngestFailed` as a `vi.fn().mockResolvedValue(undefined)`. Tests can inspect `mockMarkIngestFailed` to assert call order/args.
- All 4 pre-existing `mockEnv` literals extended with the `WORKSPACE` binding stub.
- 1 new PIP-05 test: asserts `markIngestFailed` is called BEFORE `ack` on Zod-permanent-fail, with `reason` prefix `'zod-parse-fail:'`. Uses `mock.invocationCallOrder` for ordering proof.
- Stale `no-unsafe-*` eslint-disable block removed from the test-file header (extract.ts has existed since Phase 5; the RED-era disable is no longer needed).

### Task 3 — `index.ts` queue handler try/catch around DO-RPC switch + attempts pre-emption (commit `7c87a08`)

The 3-case DO-RPC switch (`store-normal` / `inbox` / `cold-storage`) plus the tail success-write `writeAnalytics + message.ack()` are now wrapped in `try { ... } catch (err) { ... }`. Computed BEFORE the switch:

```typescript
const attempts = (message as { attempts?: number }).attempts ?? 0;
const isLastAttempt = attempts >= 2;
```

On catch:
- `console.error("triage:do-rpc-failed", { id, decision, attempts, reason })`
- `writeAnalytics(blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "throw"], doubles: [Date.now() - rpcStart, 0, attempts, 1])`
- **If `isLastAttempt`**: inner try/catch around `markIngestFailed({reason: 'do-rpc-' + decision + ': ' + reason})`. On success, `writeAnalytics(blobs: [..., `ingest-failed-do-rpc-${decision}`, ..., "marked"])`. On inner-catch (markIngestFailed itself throws), `console.error("triage:mark-failed-also-threw", ...)`. After the inner block, ALWAYS `message.ack()` (pre-empts silent drop).
- **Else (retry budget remains)**: `message.retry({ delaySeconds: 30 })`.

Sequential `for...of` ordering is preserved — the try/catch lives inside the loop body, not around the loop. The stub resolution, `rpcStart`, and `wsTag` memoization all stay unchanged outside the try.

## Latency Invariant (PIP-02)

`getCtx().waitUntil(promise)` extends the Worker invocation lifetime so the promise resolves AFTER the response is returned. The `remember()` handler schedules the IIFE-wrapped `INGEST_QUEUE.send` via `waitUntil` and then immediately proceeds to build + return the response envelope. The inner `await ingestQueue.send(memoryEvent)` resolves AFTER the response is sent to the client. This is exactly what the Plan 06-05 PIP-02 latency test will assert: `remember()` resolves in well under the queue-send latency (target <150ms vs simulated 200ms queue latency).

The B3 lazy-dereference is what makes this test reach the live code path — closure-capturing INGEST_QUEUE at registerTools entry would leave the test patch invisible (the patched `env.INGEST_QUEUE` would never be read).

## All markIngestFailed Call Sites Wrap Their RPCs in Try/Catch

The three permanent-failure-marking RPCs all follow the same inner-try/catch pattern:

| Location | Branch | reason prefix | Inner-catch log |
|----------|--------|---------------|-----------------|
| extract.ts | Zod-permanent (attempts>=2) | `zod-parse-fail:` | `triage:mark-failed-also-threw-from-zod` |
| extract.ts | non-429-throw last-attempt | `ai-throw-non-429:` | `triage:mark-failed-also-threw-from-ai-throw` |
| index.ts | DO-RPC catch last-attempt | `do-rpc-${decision}:` | `triage:mark-failed-also-threw` |

In every case, the fall-through path on inner-catch is "log + ack" (no infinite-retry). This guarantees the message exits the queue even when the failure-marking attempt itself fails (NotFoundError if the block was deleted between producer and consumer, McpError if STO-07 fires).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MemoryEvent.context is unconditional, not conditional spread**

- **Found during:** Task 1 lint-staged commit hook.
- **Issue:** The plan's CONTEXT.md / patterns spec called for `...(props.user_id !== undefined && { context: { user_id: props.user_id } })`. eslint's `@typescript-eslint/no-unnecessary-condition` rule rejected this because `EngramProps.user_id` is typed as `string` (non-optional) — the runtime check could never have been false.
- **Fix:** Replaced with unconditional `context: { user_id: props.user_id }`. Semantics identical.
- **Files modified:** `packages/mcp-server/src/tools.ts`
- **Commit:** `673f779`

**2. [Rule 3 - Blocking] Fixed eval-test cast that broke after env-type widening**

- **Found during:** Task 2 tsc verification gate.
- **Issue:** Widening `extractAndScore`'s env type to include `WORKSPACE: DurableObjectNamespace` broke `memorability-calibration.eval.test.ts` line 69, which had a narrow cast `env as unknown as { AI: Ai }`. The eval test only exercises the AI path, but the type system now requires the wider shape.
- **Fix:** Replaced the narrow cast with `env as unknown as Parameters<typeof extractAndScore>[0]` so the cast tracks the function signature. Removed the now-unused `import type { Ai } from "@cloudflare/workers-types"`.
- **Files modified:** `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts`
- **Commit:** `277c2d2`
- **Why in-scope:** The plan's `<verify>` block requires `tsc --noEmit` to exit clean against the package; the eval-test cast was a Task 2 side-effect.

**3. [Rule 1 - Bug] eslint non-null-assertion rule collision in Task 2 new test**

- **Found during:** Task 2 lint-staged commit hook.
- **Issue:** The new PIP-05 ordering test used `expect(markOrder as number).toBeLessThan(ackOrder as number)`. The codebase's eslint config rejects both `!` non-null assertions AND `as number` casts (via `non-nullable-type-assertion-style`). The two rules box out the obvious shorthand patterns.
- **Fix:** Use `if (markOrder === undefined || ackOrder === undefined) throw new Error(...)` to narrow the type, then `expect(markOrder).toBeLessThan(ackOrder)` works on the narrowed `number` type. Verbose but lint-clean.
- **Files modified:** `packages/triage-worker/src/__tests__/extract.test.ts`
- **Commit:** `277c2d2`

**4. [Process] Cleaned up stale `no-unsafe-*` eslint-disable block in extract.test.ts**

- **Found during:** Task 2 lint output flagged 3 "Unused eslint-disable directive" warnings on the test-file header.
- **Issue:** The header had `/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */` from when the file was RED (extract.ts didn't exist yet — Phase 5 ago). The `no-unsafe-*` rules are no longer triggered now that extract.ts exists.
- **Fix:** Reduced the disable block to just `@typescript-eslint/require-await` (the mock `AI.run` callbacks are async-for-type-compatibility). Updated the rationale comment.
- **Files modified:** `packages/triage-worker/src/__tests__/extract.test.ts`
- **Commit:** `277c2d2`
- **Scope check:** The test file was already in scope for Task 2 (I had to extend the 4 mockEnv literals + add a new test). The stale-disable cleanup was a one-line touch in the same hunk.

### Out-of-Scope Pre-Existing Issues (Documented, Not Fixed)

**21 pre-existing TypeScript errors in mcp-server** (= 06-02 baseline, unchanged):
- `cross-workspace-pentest.test.ts:217` — TS2352 Env → Record cast
- `envelope.test.ts:233/248/259` — TS2352 same pattern
- `hybrid-rank.test.ts:123/126` — TS2345 RankableMemory[] → LexicalSearchHit[]
- `tools-integration.test.ts:423` — TS2352 same pattern
- `vectorize-helper.test.ts:46/65` — TS2740 / TS2353
- `tools.ts:108` — TS1355 const-assertion drift
- `tools.ts:312/313/315/338/346` — TS18047 block.content possibly null
- `tools.ts:330/498/564` — TS2345 Env → { AI } type drift
- `tools.ts:528` — TS2379 exactOptionalPropertyTypes
- `vectorize-helper.ts:131/155` — TS2352 VectorizeVectorMutation cast

**2 pre-existing TypeScript errors in triage-worker** (= baseline, unchanged):
- `index.ts:105` — TS2379 exactOptionalPropertyTypes on the inline message mock object
- `schemas.ts:120` — TS2345 ZodObject assignability

All flagged in 06-02's SUMMARY.md `## Out-of-Scope Discoveries (Not Fixed)` and remain in scope for a future cleanup plan. Total error count is unchanged before vs after this plan.

## Carry-forward for Plan 06-05

Plan 06-05 ships the integration test file (`packages/triage-worker/src/__tests__/queue-integration.test.ts`) that exercises ALL THREE failure paths end-to-end:

1. **Replay-twice idempotency** — invoke the queue handler twice with the same `MemoryEvent.id`; assert exactly one block, one inbox row, one Vectorize entry, `ingest_status='enriched'` after both.
2. **ingest_status lifecycle** — `pending → enriched` on memorability>0.8 success; `pending → enriched` on memorability 0.4–0.8 inbox; `pending → failed` on Zod-fail-attempts>=2 (exercises this plan's Task 2 extract.ts branch).
3. **Cold-storage + enriched orthogonality** — memorability<0.4 produces `cold_storage=1 AND ingest_status='enriched'`; never `failed`.
4. **DO-RPC catch branch (NEW for Plan 06-05)** — force a DO RPC throw at attempts=2 and assert `markIngestFailed + ack` were called (exercises this plan's Task 3 index.ts catch path).

Plan 06-05 Task 2 ships the PIP-02 latency test: patches `env.INGEST_QUEUE.send` with a 200ms-sleep stub; asserts `remember()` resolves in <150ms; waits for the waitUntil promise to settle and asserts the patched send did eventually fire. The B3 lazy-dereference shipped in THIS plan (Task 1) is what makes that test reach the patched code path.

## Self-Check: PASSED

**Files created:**
- `[FOUND]` `.planning/phases/06-async-pipeline/06-04-SUMMARY.md` (this file — about to commit)

**Commits exist:**
- `[FOUND]` `673f779` — `feat(06-04): wire remember() Queue producer + ingest() comment retarget (PIP-02/03/D-02)`
- `[FOUND]` `277c2d2` — `feat(06-04): wire extract.ts permanent-fail branches to markIngestFailed (PIP-05)`
- `[FOUND]` `7c87a08` — `feat(06-04): wrap DO-RPC switch in try/catch + attempts pre-emption + markIngestFailed (PIP-05)`

**Plan-level verification gates (per PLAN.md `<verification>`):**

- `[PASS]` `cd packages/mcp-server && npx tsc --noEmit` → 21 errors (= baseline; zero introduced)
- `[PASS]` `cd packages/triage-worker && npx tsc --noEmit` → 2 errors (= baseline; zero introduced)
- `[PASS]` `cd packages/mcp-server && npx vitest run --exclude='**/evals/**'` → 125 passed | 5 skipped (no regression)
- `[PASS]` `cd packages/triage-worker && npx vitest run --exclude='**/evals/**'` → 5 passed (4 baseline + 1 new PIP-05)
- `[PASS]` `cd packages/workspace-do && npx vitest run` → 37 passed | 1 skipped (no regression)
- `[PASS]` `grep -q "memoryEvent: MemoryEvent" packages/mcp-server/src/tools.ts`
- `[PASS]` `grep -q "getCtx()\.waitUntil" packages/mcp-server/src/tools.ts`
- `[PASS]` `grep -c "markIngestFailed" packages/triage-worker/src/index.ts` → 3 (>= 2 required)
- `[PASS]` `grep -c "markIngestFailed" packages/triage-worker/src/extract.ts` → 7 (>= 2 required)
- `[PASS]` `grep -q "isLastAttempt" packages/triage-worker/src/index.ts`
- `[PASS]` `! grep -q "Phase 6 adds ctx.waitUntil(env.INGEST_QUEUE.send" packages/mcp-server/src/tools.ts`
- `[PASS]` `grep -B2 "INGEST_QUEUE" packages/mcp-server/src/tools.ts | grep -q "B3 fix"` (B3 sanity)

## Threat Surface Scan

Reviewed all files touched in this plan against the `<threat_model>` in PLAN.md:

- **T-06-04-QPAYLOAD** (Tampering on MemoryEvent payload) — MITIGATED. All fields server-composed: `id = crypto.randomUUID()` (block id), `workspace_id = props.workspace_id` (JWT-derived), `content/source/type` are zod-validated by registerTool inputSchema, `timestamp = Date.now()`. No client-injectable field reaches the Queue payload. Verified by `workspace_id: props\.workspace_id` grep gate.
- **T-06-04-SILENT-DROP** (Repudiation on retry exhaustion) — MITIGATED. Both extract.ts permanent-fail branches AND the index.ts DO-RPC catch path pre-empt on `attempts >= 2` by calling markIngestFailed + ack. Three call sites, all wrapped in inner try/catch with appropriate `console.error` fall-through. `grep -c markIngestFailed` returns 3 in index.ts and 7 in extract.ts.
- **T-06-04-INFINITE-RETRY** (DoS via markIngestFailed itself throwing) — MITIGATED. Every markIngestFailed call site has its own inner try/catch with `console.error` + fall-through-to-ack. NotFoundError (block deleted via forget()) and McpError (STO-07 fires) cannot loop the message.
- **T-06-04-WAITUNTIL-LEAK** (Information disclosure via silent waitUntil throw) — MITIGATED. The inner `INGEST_QUEUE.send` is wrapped in try/catch + `console.error('mcp-server:queue-send-failed', ...)` + `writeAnalytics(blobs: [..., 'queue-send', wsTag, 'throw'])` — every failure is observable in Workers logs AND Analytics Engine.
- **T-06-04-LATENCY-REGRESSION** (DoS via blocking response on queue send) — MITIGATED. The `getCtx().waitUntil(...)` pattern returns the IIFE Promise immediately to the runtime; the inner `await INGEST_QUEUE.send` resolves AFTER the response is sent. Behavioral verification is Plan 06-05's PIP-02 latency test.
- **T-06-04-COMMENT-DRIFT** (Repudiation via stale ingest() handler comment) — MITIGATED. Both comments (lines 637, 651) retargeted from "Phase 6" to "v0.4 connectors". Negative grep assertion (`! grep -q "Phase 6 adds ctx.waitUntil(env.INGEST_QUEUE.send"`) PASSES.
- **T-06-04-CLOSURE-STALE-BINDING** (Tampering via INGEST_QUEUE closure capture) — MITIGATED (B3 fix). env.INGEST_QUEUE is dereferenced LAZILY inside the remember() handler body via the documented `// Phase 6 B3 fix:` comment marker. Closure-capture pattern reserved for env.WORKSPACE (durable). Sanity gate `grep -B2 "INGEST_QUEUE" packages/mcp-server/src/tools.ts | grep -q "B3 fix"` PASSES.

No new security-relevant surface introduced beyond what the threat model anticipated. No threat flags to surface.

## TypeScript Drift Note (for v0.2 cleanup pass)

Both packages have pre-existing tsc errors that this plan did not touch. The biggest cluster is the `Env` type drift between bundled `@cloudflare/workers-types` and `node_modules` versions (visible as TS2345 on `safeRun(env, ...)` calls in tools.ts — the bundled `Ai<AiModels>` parameter doesn't accept the wider `Env` type). A v0.2 cleanup pass should:

1. Run `wrangler types` and commit the generated `worker-configuration.d.ts` (currently gitignored).
2. Remove `@cloudflare/workers-types` from tsconfig.json `types` (the Cloudflare team has deprecated the package in favor of `wrangler types`).
3. Single-source the `Env` interface so all helpers (`safeRun`, `vectorizeUpsert`, etc.) accept it directly.

This would also clean up the 4 existing test-file `as unknown as` casts in the `Env → Record<string, unknown>` pattern.

## Status: PASSED

All in-scope success criteria met. 3 task commits + SUMMARY.md commit (next). End-to-end async pipeline is wired and behaviorally complete; the integration test that exercises all three failure paths lands in Plan 06-05.

## Next Phase Readiness

- **06-05 (Wave 4 — integration tests):** can now write `queue-integration.test.ts` against the live code paths. The PIP-02 latency test (Task 2 of 06-05) can patch `env.INGEST_QUEUE.send` and rely on the B3 lazy dereference shipped here. The replay-twice + ingest_status lifecycle + orthogonality tests can rely on the markIngestFailed call sites shipped here in extract.ts + index.ts.
- **06-06 / 06-07:** Phase 6 SUMMARY.md + Phase 7 hand-off can proceed once 06-05 passes — the end-to-end "remember a job posting in conversation A → recall it in conversation B" Phase 7 acceptance test now has a working async enrichment path.

---

*Phase: 06-async-pipeline*
*Completed: 2026-05-29*
