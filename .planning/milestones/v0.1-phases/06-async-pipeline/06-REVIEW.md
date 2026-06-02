---
phase: 06-async-pipeline
reviewed: 2026-05-29T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts
  - packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts
  - packages/mcp-server/src/__tests__/token-budget.test.ts
  - packages/mcp-server/src/__tests__/tools-integration.test.ts
  - packages/mcp-server/src/__tests__/tools.test.ts
  - packages/mcp-server/src/index.ts
  - packages/mcp-server/src/tools.ts
  - packages/mcp-server/wrangler.jsonc
  - packages/triage-worker/package.json
  - packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts
  - packages/triage-worker/src/__tests__/extract.test.ts
  - packages/triage-worker/src/__tests__/test-worker-entry.ts
  - packages/triage-worker/src/extract.ts
  - packages/triage-worker/src/index.ts
  - packages/triage-worker/wrangler.jsonc
  - packages/triage-worker/wrangler.test.jsonc
  - packages/workspace-do/src/__tests__/defense-in-depth.test.ts
  - packages/workspace-do/src/__tests__/helpers.test.ts
  - packages/workspace-do/src/__tests__/hibernation.test.ts
  - packages/workspace-do/src/__tests__/schema.test.ts
  - packages/workspace-do/src/index.ts
  - packages/workspace-do/src/migrations.ts
  - packages/workspace-do/src/queries.ts
  - packages/workspace-do/src/schema.ts
  - scripts/setup-queue.sh
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-05-29T00:00:00Z
**Depth:** standard
**Files Reviewed:** 24 (1 referenced — `queue-integration.test.ts` — was read for B1 verification but not in explicit `files:` list)
**Status:** issues_found

## Summary

The Phase 6 async-pipeline implementation is architecturally sound: the v3 migration is forward-only and idempotent, the `markIngestFailed` RPC is correctly STO-07-guarded, the producer side honors B3 (lazy `env.INGEST_QUEUE` dereference inside `remember()`), B2 (`ctxOverride` parameter wiring), and B1 (seed-block + `vi.spyOn` for DO-RPC failure assertion). The pending → enriched/failed lifecycle is atomic with the enrichment UPDATEs and the `INSERT OR IGNORE` on `inbox.id` correctly enforces IP-1 idempotency for at-least-once delivery.

However, the review surfaced one Critical issue (batch-wide poisoning via re-thrown non-429 AI errors on early attempts) and several Warnings centered on the new permanent-failure path: the `markIngestFailed` reason field embeds unsanitized upstream error strings into a SQLite-persisted JSON column (visible to the v0.2 inbox-UI), `extract.ts` uses a manual `>= 2` last-attempt check that drifts from `wrangler.jsonc max_retries=3` if either side changes, and the queue handler swallows any error from `await workspaceTag()` by letting it escape and crash the whole batch.

The Phase 6 locked decisions (D-01 deferred conflict detection, D-02 ingest() stays a stub, D-03 no DLQ queue) are honored — no regressions detected on those axes.

---

## Critical Issues

### CR-01: Re-thrown non-429 AI error on `attempts < 2` poisons the entire batch

**File:** `packages/triage-worker/src/extract.ts:176` (re-throw) + `packages/triage-worker/src/index.ts:90-122` (no try/catch wrapping `extractAndScore`)

**Issue:**
`extract.ts` line 176 explicitly re-throws any non-429 error from `env.AI.run` when `attempts < 2` ("let the Queue runtime's max_retries machinery apply"). However, the caller in `index.ts` does **not** wrap `await extractAndScore(...)` in a try/catch — the throw propagates out of the `for...of` loop, terminating the `queue()` handler with an unhandled rejection.

Per Cloudflare Queues semantics, when a consumer handler throws/rejects, **the entire batch is retried** (max_batch_size=10 per `wrangler.jsonc`). Messages that were already successfully `ack()`-ed earlier in the same batch loop iteration ARE redelivered (their ack is rolled back as part of the batch retry). This means:

1. A single transient AI error (e.g., 5xx upstream, JSON parse on the binding envelope before Zod even runs) on message 7 of 10 will cause messages 1–6 (already routed, status='enriched') to be redelivered and re-processed.
2. Re-processing surfaces the IP-1 idempotency guards (INSERT OR IGNORE on inbox, idempotent UPDATEs) but the moderate-cost path is **duplicate Workers AI calls + duplicate Vectorize writes**, which can amplify a transient outage into rate-limit cascades.
3. This violates the Phase 6 PIP-05 design intent ("pre-empt the silent-drop-on-retry-exhaustion failure mode") because the explicit pre-emption on `attempts >= 2` does not cover the early-attempt batch-poisoning path.

The B3 comment in extract.ts:133 acknowledges "let the Queues runtime's max_retries machinery apply" as a design choice, but the per-message-isolation invariant from the index.ts comment ("Sequential processing — for...of not Promise.all") only protects against intra-message races, not against per-message error propagation.

**Fix:**
Wrap the `extractAndScore` call in `index.ts` with a per-message try/catch that consumes the retry slot via `message.retry({delaySeconds: 30})` on early attempts and acks (with `markIngestFailed`) on the last attempt — mirroring the pattern already implemented for the DO-RPC failure path at index.ts:234-285:

```typescript
let parsed: TriageOutput | null;
try {
  parsed = await extractAndScore(env, event, { /* ... */ }, wsTag);
} catch (err) {
  // Mirror the DO-RPC catch logic — extractAndScore re-throws non-429 on early attempts.
  const reason = err instanceof Error ? err.message : String(err);
  console.error("triage:extract-threw", { id: event.id, attempts, reason });
  const isLastAttempt = attempts >= 2;
  if (isLastAttempt) {
    try {
      await (stub as unknown as { markIngestFailed: /* ... */ }).markIngestFailed({
        workspace_id: event.workspace_id,
        block_id: event.id,
        reason: `extract-throw: ${reason}`,
      });
    } catch (markErr) { /* log + fall through */ }
    message.ack();
  } else {
    message.retry({ delaySeconds: 30 });
  }
  continue;
}
```

This also removes the duplication of the last-attempt-markIngestFailed logic between extract.ts (lines 144-176) and the new wrapper — consolidating both into a single index.ts handler is cleaner. Alternatively, change extract.ts to NEVER re-throw and always handle the early-attempt branch internally via `message.retry({delaySeconds: 30})`.

---

## Warnings

### WR-01: `markIngestFailed` reason field is unsanitized and embeds upstream error strings into a SQLite-persisted JSON column

**File:** `packages/workspace-do/src/queries.ts:760-774`; written from `packages/triage-worker/src/extract.ts:159, 264` and `packages/triage-worker/src/index.ts:268`

**Issue:**
`markIngestFailed(args.reason)` is `JSON.stringify`-d into `blocks.properties` (line 764). The reason value is constructed via:

- `extract.ts:159`: `` `ai-throw-non-429: ${err instanceof Error ? err.message : String(err)}` ``
- `extract.ts:264`: `` `zod-parse-fail: ${parsed.error.issues[0]?.message ?? "unknown"}` ``
- `index.ts:268`: `` `do-rpc-${decision}: ${reason}` ``

The upstream `err.message` strings come from (a) Workers AI inference errors, (b) Zod validation issues which can contain field paths and values, and (c) DO-RPC throws including the McpError-formatted `Workspace mismatch: DO bound to 'X' but request claims 'Y'`. In the Workspace mismatch case, the persisted JSON would contain **two workspace IDs** — the legitimate one and the forged claim — leaking both into a row that the v0.2 inbox UI is designed to surface to the user.

Because `JSON.stringify` correctly escapes quotes/braces, there's no SQL injection risk (the value flows through a positional `?` binding anyway). The risk is **information disclosure** when a future inbox-UI renders `blocks.properties.error` directly to a Markdown panel or to AI tooling that re-emits the contents.

Additionally, there is no length cap — an AI error message can be arbitrarily long (model providers occasionally return multi-KB error payloads), so a single failed block can bloat `blocks.properties` with megabytes of error text, increasing per-DO storage cost and breaking the 7,500-token envelope budget if `recall()` ever surfaces a failed block.

**Fix:**
Cap and sanitize the reason at the `markIngestFailed` boundary:

```typescript
export function markIngestFailed(
  sql: SqlStorage,
  args: { block_id: string; reason: string },
): void {
  // Cap reason at 500 chars + strip control characters to keep the v0.2 inbox-UI
  // surface bounded. Defense-in-depth — call sites should already use static
  // prefixes, but bound the worst case here.
  const safeReason = args.reason.slice(0, 500).replace(/[ -]/g, "");
  const properties = JSON.stringify({ error: safeReason, failed_at: Date.now() });
  // ... existing SQL ...
}
```

Also consider stripping the workspace-mismatch detail from McpError messages before they reach `markIngestFailed` — though this is a partial-failure mode that only triggers when the producer-side workspace_id is forged, the DO-RPC catch in index.ts:240 directly uses `err.message` without filtering.

---

### WR-02: Manual `attempts >= 2` last-attempt check drifts from `wrangler.jsonc max_retries=3` if either side changes

**File:** `packages/triage-worker/src/index.ts:140` + `packages/triage-worker/src/extract.ts:144, 210` (3 hard-coded `>= 2` checks)

**Issue:**
Three sites compute "is this the last allowed attempt" via `attempts >= 2` (0-indexed → attempt 3 of 3 max_retries). The constant `2` is unexplained at the call sites (the comment lives only on index.ts:138-140) and not derived from the wrangler config. If a future change raises `max_retries` to 5 in `triage-worker/wrangler.jsonc` (e.g., to be more tolerant of CF AI flakiness), the pre-emption logic will fire 3 attempts too early — flipping blocks to `ingest_status='failed'` after only 3 of 5 allowed retries.

The reverse failure (lowering `max_retries` to 1 while leaving `attempts >= 2` in code) means `isLastAttempt` is never true and the silent-drop-on-retry-exhaustion bug PIP-05 was designed to prevent re-emerges.

**Fix:**
Extract `MAX_RETRIES` and `LAST_ATTEMPT_INDEX = MAX_RETRIES - 1` to a shared constant module that the wrangler config-loader can read (or at minimum, a `// LINKED TO wrangler.jsonc max_retries=3` comment + a single-source-of-truth constant in `index.ts`). The Zod-permanent-fail path also has its own `< 2` / `>= 2` checks (`message.attempts < 2`) that should derive from the same constant. Currently the magic 2 appears in:

- `packages/triage-worker/src/index.ts:140`
- `packages/triage-worker/src/extract.ts:144`
- `packages/triage-worker/src/extract.ts:210`

Consolidating to one named constant prevents three places from drifting independently.

---

### WR-03: `await workspaceTag(event.workspace_id)` is unwrapped — failure crashes the entire batch

**File:** `packages/triage-worker/src/index.ts:98`

**Issue:**
`workspaceTag` calls `crypto.subtle.digest("SHA-256", ...)` per `analytics.ts:61`. While Web Crypto's SHA-256 is extremely robust, any thrown error (e.g., workerd shutdown mid-batch, transient runtime error, the TextEncoder failing on an oddly-encoded workspace_id) bubbles out of the `for...of` loop and triggers the same batch-poisoning behavior as CR-01.

Beyond that, this is the first `await` in the loop iteration — so a thrown workspaceTag does not produce any ack/retry signal at all. The message would be retried as part of the batch but with **no observability** in `console.error` or in `writeAnalytics` (both happen later in the iteration after wsTag is computed).

**Fix:**
Wrap in try/catch and fall back to a sentinel tag so the analytics path stays observable while the rest of the iteration proceeds:

```typescript
let wsTag: string;
try {
  wsTag = await workspaceTag(event.workspace_id);
} catch (tagErr) {
  console.warn("triage:workspaceTag-failed", { id: event.id, err: String(tagErr) });
  wsTag = "tag-error";
}
```

---

### WR-04: `markIngestFailed` overwrites `properties` — loses any prior enrichment context

**File:** `packages/workspace-do/src/queries.ts:760-774`

**Issue:**
The JSDoc at line 738-742 acknowledges this is intentional ("The original properties (if any) are intentionally OVERWRITTEN, not COALESCE-merged") because "at the failed state there is no useful enrichment to preserve, and the error info is the only useful payload for v0.2 inbox UI 'broken memories' surface."

However: if the failure happens AFTER `updateBlockEnrichment` has already written enriched properties (e.g., a Zod failure on a retry of a successful enrichment, or a hypothetical future code path where enrichment + cold-storage interleave), the user permanently loses the previously-stored AI enrichment. The retry-twice idempotency design says replays are safe, but this UPDATE is destructive on the second-call path if the second call fails after the first succeeded.

In Phase 6's current code paths this is unreachable (every call site that reaches `markIngestFailed` is on the permanent-fail branch, not on a retry-after-success branch). But the helper exposes a footgun for v0.2 connectors that may legitimately retry enrichment.

**Fix:**
Add the comment and code path as a TODO for v0.2 — store the error payload in a separate `blocks.failure_info` column (added via a v4 migration) rather than overwriting `properties`. For Phase 6, the current behavior is acceptable; the warning is to surface the design tension for the v0.2 inbox-UI work.

Alternatively, COALESCE the prior properties into the new JSON:

```typescript
const properties = JSON.stringify({
  error: safeReason,
  failed_at: Date.now(),
  prior_properties: /* read existing row.properties and parse */ null,
});
```

—but this requires a SELECT-before-UPDATE which breaks the single-statement atomicity guarantee.

---

### WR-05: `JSON.parse` inside `markIngestFailed` would not be a problem — but the `properties` column lacks a per-call invariant check

**File:** `packages/workspace-do/src/queries.ts:760-774` + downstream consumers (none in Phase 6, but v0.2 will consume)

**Issue:**
The `markIngestFailed` helper writes `JSON.stringify({error, failed_at})` to `blocks.properties`, but the type column `properties Record<string, unknown> | null` (per `Memory`) makes no distinction between "enriched properties" and "failure metadata." A v0.2 consumer that reads `block.properties.company` (after a failed enrichment) gets `undefined` instead of failing fast, masking the failure.

A `discriminated union` via the inclusion of an `error: string` key is the implicit convention but isn't documented in the `Memory` type. The narrow helper `narrowBlockRow` (queries.ts:150-199) doesn't surface this.

**Fix:**
Document the convention explicitly on the `Memory.properties` JSDoc + (preferably) add an `ingest_status` field to `Memory` in `shared/types/src/index.ts` so v0.2 code can branch on `block.ingest_status === 'failed'` before reading `properties`. The schema already enforces NOT NULL on the SQLite column; widening the TS type is a no-op at runtime but blocks future bugs at compile time.

---

### WR-06: `recall()` / `lexicalSearchBlocks` does not exclude `ingest_status='failed'` rows

**File:** `packages/workspace-do/src/queries.ts:389-406` (`lexicalSearchBlocks`) + `tools.ts:548` (`getBlocksByIds` is invoked from `recall()`)

**Issue:**
`getBlocksByIds` (queries.ts:580-590) filters `cold_storage = 0` to exclude cold rows from `recall()`. But neither `getBlocksByIds` nor `lexicalSearchBlocks` filters out `ingest_status = 'failed'` rows. The result: a block whose enrichment permanently failed (memorability/classification/extraction never ran) but which has lexical content present is still surfaced by `search()` and (because the row also exists in Vectorize after `vectorizeUpsert`) by `recall()`. The user sees a "memory" that is half-formed — raw content with `summary=null`, `properties={error: '...', failed_at: ...}`, and `confidence=null`.

This contradicts the Phase 6 design intent ("v0.2 inbox UI 'broken memories' surface") — failed blocks should only be surfaced via the explicit broken-memories view, not folded into normal recall results.

**Fix:**
Add `AND ingest_status != 'failed'` to the WHERE clause of `getBlocksByIds` (queries.ts:585) and `lexicalSearchBlocks` (queries.ts:397). Mirror the `cold_storage = 0` design — both filters are defense-in-depth even though Vectorize never indexes failed blocks (and never WILL index them as long as the upsert is on the sync remember-path before queue dispatch).

Wait — the upsert IS already on the sync path (tools.ts:369), which means **failed blocks DO have vectors in Vectorize** because the upsert ran before triage even fired. This makes the issue more material: a failed block will appear in semantic recall results until Vectorize is also cleaned up. Either:
1. Add a sweep job in v0.2 to call `vectorizeDelete` on every block that transitions to `ingest_status='failed'`, or
2. Add the SQL filter as above so `getBlocksByIds` excludes failed blocks at hydration time even when Vectorize returns the match.

Option (2) is the cheaper and more immediate fix.

---

## Info

### IN-01: `setup-queue.sh` precheck uses `>/dev/null 2>&1` — silent failures hide auth issues

**File:** `scripts/setup-queue.sh:39`

**Issue:**
The `wrangler queues info` precheck swallows both stdout and stderr. A failed Cloudflare auth (e.g., expired session token) returns non-zero from `wrangler queues info`, so the script proceeds to `wrangler queues create` which also fails — but the user sees only the second error, not the original "not authenticated" message that would have made the root cause obvious.

**Fix:**
Echo a hint when entering the create branch ("If create fails with auth error, run `npx wrangler login` first") or stash stderr to a tempfile and surface it conditionally.

---

### IN-02: `tools.ts:257` uses `(env as any).WORKSPACE` cast — type widening loses safety until `wrangler types` runs

**File:** `packages/mcp-server/src/tools.ts:256-257`

**Issue:**
The `// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access` cast widens `env.WORKSPACE` to `DurableObjectNamespace<WorkspaceDO>`. Same pattern appears at line 415 for `INGEST_QUEUE`. These casts are necessary until `worker-configuration.d.ts` is regenerated, but they also hide drift: if the wrangler binding name changes (e.g., `INGEST_QUEUE` → `INGEST_Q`), the cast silently produces `undefined` at runtime and the `if (ingestQueue === undefined)` branch becomes the always-taken path — silently dropping queue messages.

**Fix:**
Add a one-time CI check (or a `tsc --noEmit` post-`wrangler types` step) that validates the binding names. Or use a runtime assertion at module load:

```typescript
const ingestQueue = (env as { INGEST_QUEUE?: Queue<MemoryEvent> }).INGEST_QUEUE;
// Existing fallback is correct for test envs; document the production-side check.
```

The current code's `console.warn` on missing binding is reasonable but classify it more sharply — production-env missing should be `console.error` so it triggers Cloudflare Worker observability alerts, not just a warn.

---

### IN-03: `lexicalSearchBlocks` defaults limit=50 but `search()` MCP tool passes through `args.limit` without a clamp

**File:** `packages/workspace-do/src/queries.ts:389-406` + `packages/mcp-server/src/tools.ts:639-643`

**Issue:**
`lexicalSearchBlocks(sql, query, limit = 50)` and `search()` passes `args.limit` if defined. The Zod schema for `SearchInputSchema` is not in scope of this review, but if it does not clamp `limit` to a sane upper bound (e.g., 100), a malicious caller could request `limit: 1_000_000` and force the DO to materialize a million rows.

Not in Phase 6 scope to fix (the schema lives in Phase 4), but worth flagging since Phase 6 changes added related infrastructure.

**Fix:** Verify `SearchInputSchema.limit` has a `.max(100)` or similar bound — if absent, add one in a follow-up.

---

### IN-04: `markIngestFailed` JSDoc says "fall through to ack() so the message still exits the queue" — but the caller's behavior matters

**File:** `packages/workspace-do/src/queries.ts:749-754`

**Issue:**
The JSDoc states the contract is "Triage Worker catches the throw and falls through to `message.ack()`" — but a future caller (e.g., a Phase 7 admin tool that calls `markIngestFailed` directly via WorkspaceDO RPC outside the Queue consumer) inherits this contract obligation without knowing it.

**Fix:**
Move the "caller must ack" detail OUT of the helper's JSDoc and into the call sites (extract.ts:271-275 already has the right wrapper try/catch). Reword the JSDoc to "throws NotFoundError; callers are responsible for graceful handling" — without coupling to the Queue specifically.

---

### IN-05: `extract.ts:96` default `wsTag = "test-ws"` masks production analytics dimension when called without wsTag

**File:** `packages/triage-worker/src/extract.ts:96`

**Issue:**
The default parameter `wsTag = "test-ws"` is documented as "Tests that don't exercise the analytics path can omit this" — but if a production caller (current: only `index.ts:115` which DOES pass wsTag; future: a connector worker that forgets to pass it) ever calls `extractAndScore` without supplying wsTag, **all analytics events for that workspace will be tagged `test-ws`**, polluting the production Workers Analytics Engine dataset and breaking per-workspace dashboards.

**Fix:**
Either (a) remove the default and make the parameter required, surfacing the omission as a TS error, or (b) compute `wsTag` lazily inside `extractAndScore` when not supplied (call `workspaceTag(event.workspace_id)` internally). Option (a) is preferred because it makes the cost (one SHA-256 per message) explicit at the call site.

---

_Reviewed: 2026-05-29T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
