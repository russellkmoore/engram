# Phase 6: Async Pipeline — Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 16 (12 EDIT, 1 NEW script, 2 NEW/EXTEND test, 1 NEW test directory)
**Analogs found:** 16 / 16 (100% in-repo coverage — character is contract-integration, all analogs are sibling surfaces in the same files)

> **Note on character.** Phase 6 is a **contract-integration phase** (Queue contract + WorkspaceDO RPC contract + producer wiring). Almost every EDIT is a surgical addition to an existing file; the analog is the existing surface in that very file. The "closest analog" column reflects that — most rows point to the same file at adjacent lines.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/workspace-do/src/schema.ts` (EDIT — append `V3_SQL`) | schema-DDL | one-shot DDL | same file, `V2_SQL` lines 182–185 | exact |
| `packages/workspace-do/src/migrations.ts` (EDIT — append v3 row to `MIGRATIONS`) | config | one-shot DDL | same file, v2 entry line 56 | exact |
| `packages/workspace-do/src/queries.ts` (EDIT — 3 UPDATEs amended + `markIngestFailed` new) | data-access helper | request-response (sync DO SQL) | same file, `updateBlockEnrichment` lines 596–616 / `stampEmbedding` lines 540–554 | exact |
| `packages/workspace-do/src/index.ts` (EDIT — add `markIngestFailed` RPC) | DO RPC method | request-response (DO method) | same file, `updateBlockEnrichment` lines 257–271 / `stampEmbedding` lines 226–238 | exact |
| `packages/triage-worker/wrangler.jsonc` (EDIT — add `queues.consumers[]`) | wrangler config | event-driven (queue consumer binding) | same file, `durable_objects.bindings` lines 20–24 placeholder comment | exact |
| `packages/triage-worker/src/index.ts` (EDIT — try/catch + `markIngestFailed` + attempts pre-emption) | queue consumer | event-driven (queue → DO RPC) | same file, existing `queue(batch, env)` lines 90–227 | exact |
| `packages/triage-worker/src/extract.ts` (EDIT — post-retry-budget catch → `markIngestFailed`) | AI gateway | request-response w/ retry | same file, Zod-fail permanent branch lines 184–198 | exact |
| `packages/mcp-server/wrangler.jsonc` (EDIT — add `queues.producers[]`) | wrangler config | event-driven (queue producer binding) | same file, `analytics_engine_datasets` line 15 + `durable_objects` lines 16–21 | exact |
| `packages/mcp-server/src/tools.ts` `remember()` (EDIT — append `ctx.waitUntil(INGEST_QUEUE.send)`) | MCP tool handler | request-response + fan-out | same file, lines 373–378 final Analytics Engine write inside try-block | exact |
| `packages/mcp-server/src/tools.ts` `ingest()` (EDIT — retarget comment per D-02) | comment touch-up | n/a | same file, lines 628–652 existing comment | exact |
| `scripts/setup-queue.sh` (NEW) | provisioning script | one-shot CLI | `scripts/setup-vectorize.sh` lines 1–65 | exact |
| `packages/workspace-do/src/__tests__/schema.test.ts` (EXTEND — v3 column assertions) | introspection test | request-response | same file, v2 `cold_storage` describe lines 102–124 | exact |
| `packages/triage-worker/src/__tests__/queue-integration.test.ts` (NEW — replay-twice idempotency + ingest_status lifecycle + cold-storage/inbox orthogonality) | integration test | event-driven | `packages/triage-worker/src/__tests__/extract.test.ts` lines 41–131 (vi.fn message harness) + `packages/mcp-server/src/__tests__/tools-integration.test.ts` lines 39–110 (`runInDurableObject` real-DO harness) | role-match (combine two existing test shapes) |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` (EXTEND — latency: `remember()` returns before consumer runs) | integration test | request-response | same file, lines 482–509 `p50 latency` it.skip block | exact |
| `.planning/ROADMAP.md` (EDIT — PIP-04 footnote) | doc | n/a | (doc touch-up; no code analog) | n/a |
| `.planning/REQUIREMENTS.md` (EDIT — PIP-04 line footnote) | doc | n/a | (doc touch-up; no code analog) | n/a |
| `.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md` (EDIT — annotation) | doc | n/a | (doc touch-up; no code analog) | n/a |

---

## Pattern Assignments

### 1. `packages/workspace-do/src/schema.ts` — append `V3_SQL`

**Analog:** same file, `V2_SQL` block (lines 145–185) — Phase 5 D-07 cold-storage migration. **Identical shape**: tagged-template `as const` export with multi-statement DDL, ALTER TABLE ADD COLUMN, paired index, doc-block listing cross-plan contract.

**Pattern to copy — V2_SQL template (lines 182–185):**

```typescript
export const V2_SQL = `
  ALTER TABLE blocks ADD COLUMN cold_storage INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_blocks_cold_storage ON blocks(cold_storage);
` as const;
```

**V3 application — append after V2_SQL:**

```typescript
export const V3_SQL = `
  ALTER TABLE blocks ADD COLUMN ingest_status TEXT NOT NULL DEFAULT 'pending';
  CREATE INDEX IF NOT EXISTS idx_blocks_ingest_status ON blocks(ingest_status);
` as const;
```

**Doc-block contract to mirror (lines 145–181):**
- Header sentence: requirement reference (Phase 6 D-03 instead of Phase 5 D-07).
- Design notes section listing: forward-only runner idempotency, ALTER TABLE NOT idempotent at SQL layer (version check is the guarantee), DEFAULT value rationale, INDEX rationale.
- Cross-plan contract section: who appends to MIGRATIONS, who reads the column.
- `@module` JSDoc tag matching `@module @engram/workspace-do/schema`.

---

### 2. `packages/workspace-do/src/migrations.ts` — append v3 entry

**Analog:** same file, v2 entry line 56. Identical inline-comment + object-literal shape.

**Pattern to copy (lines 51–57):**

```typescript
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "v1_initial_schema", sql: V1_SQL },
  // Phase 5 D-07: cold-storage routing (NOT discard — cardinal-sin clause).
  // ALTER TABLE ADD COLUMN is NOT idempotent at SQL layer; the version check
  // in the _schema_migrations table is the idempotency guarantee.
  { version: 2, name: "v2_cold_storage", sql: V2_SQL },
];
```

**V3 application — add `V3_SQL` to the import + append the entry:**

```typescript
import { V1_SQL, V2_SQL, V3_SQL } from "./schema.js";   // amend line 40

// ... append to MIGRATIONS array:
  // Phase 6 D-03: ingest_status column tracks per-block enrichment state
  // (pending → enriched | failed). Forward-only via _schema_migrations runner.
  { version: 3, name: "v3_ingest_status", sql: V3_SQL },
```

**Runner unchanged.** `runMigrations(sql)` lines 59–90 needs zero edits — its `for (const m of MIGRATIONS)` loop applies any not-yet-applied entry automatically.

---

### 3. `packages/workspace-do/src/queries.ts` — amend 3 UPDATE statements + add `markIngestFailed`

#### 3a. Amend `updateBlockEnrichment` (lines 596–616)

**Existing pattern:**

```typescript
export function updateBlockEnrichment(
  sql: SqlStorage,
  args: {
    block_id: string;
    properties: Record<string, unknown>;
    summary: string;
    confidence: number;
  },
): void {
  const result = sql.exec(
    "UPDATE blocks SET properties = ?, summary = ?, confidence = ?, updated_at = ? WHERE id = ?",
    JSON.stringify(args.properties),
    args.summary,
    args.confidence,
    Date.now(),
    args.block_id,
  );
  if (result.rowsWritten === 0) {
    throw new NotFoundError("block", args.block_id);
  }
}
```

**Phase 6 amendment — append `ingest_status = 'enriched'` to the SET clause (no new binding — literal value):**

```typescript
  const result = sql.exec(
    "UPDATE blocks SET properties = ?, summary = ?, confidence = ?, ingest_status = 'enriched', updated_at = ? WHERE id = ?",
    JSON.stringify(args.properties),
    args.summary,
    args.confidence,
    Date.now(),
    args.block_id,
  );
```

#### 3b. Amend `moveToColdStorage` (lines 675–697)

**Existing pattern:** `cold_storage = 1` already in SET; append `ingest_status = 'enriched'` next to it (D-03 orthogonality: `cold-storage=1` AND `ingest_status=enriched` always co-occur, never `cold-storage=1 + failed`):

```typescript
  const result = sql.exec(
    "UPDATE blocks SET cold_storage = 1, ingest_status = 'enriched', properties = COALESCE(?, properties), summary = COALESCE(?, summary), confidence = COALESCE(?, confidence), updated_at = ? WHERE id = ?",
    propertiesJson,
    args.summary ?? null,
    args.confidence ?? null,
    Date.now(),
    args.block_id,
  );
```

#### 3c. Amend `moveToInbox` (lines 631–654) — TWO changes

**Existing pattern (lines 631–654):** delegates to `createInboxEntry`. The block UPDATE for `ingest_status` is NOT in `moveToInbox` today — it must be added (otherwise the block stays `pending` after inbox routing). The `INSERT OR IGNORE` change goes in `createInboxEntry` (line 472–483).

**Change 3c-i — add explicit block status UPDATE in `moveToInbox`:**

```typescript
export function moveToInbox(
  sql: SqlStorage,
  args: { block_id: string; entry: { ... } },
): void {
  const inboxEntry: InboxEntry = { ... };          // unchanged
  createInboxEntry(sql, inboxEntry);                // unchanged
  // Phase 6 D-03: mark the source block as enriched once the inbox row lands.
  // Belt-and-suspenders with createInboxEntry's INSERT OR IGNORE: even on a
  // duplicate Queue delivery (same block_id), the second UPDATE is idempotent.
  const result = sql.exec(
    "UPDATE blocks SET ingest_status = 'enriched', updated_at = ? WHERE id = ?",
    Date.now(),
    args.block_id,
  );
  if (result.rowsWritten === 0) {
    throw new NotFoundError("block", args.block_id);
  }
}
```

**Change 3c-ii — amend `createInboxEntry` (line 474) to `INSERT OR IGNORE`:**

Current line:

```typescript
  sql.exec(
    "INSERT INTO inbox (id, content, proposed_type, proposed_properties, memorability_score, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    entry.id, ...
  );
```

Amended (one-word change — `INSERT` → `INSERT OR IGNORE`):

```typescript
  sql.exec(
    "INSERT OR IGNORE INTO inbox (id, content, proposed_type, proposed_properties, memorability_score, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    entry.id, ...
  );
```

Rationale (CONTEXT.md Claude's Discretion §"Idempotency on duplicate Queue delivery"): inbox.id == block.id, so duplicate Queue delivery would otherwise raise UNIQUE constraint failure. `OR IGNORE` makes the second insert a no-op.

#### 3d. Add new `markIngestFailed` helper (after `moveToColdStorage`, ~line 698)

**Analog:** `stampEmbedding` (lines 540–554) — single-arg-object signature, single-statement UPDATE, throw NotFoundError on `rowsWritten === 0`. Plus `moveToColdStorage`'s COALESCE pattern for the `properties` overwrite-or-merge decision (but here we want OVERWRITE with the error info, not COALESCE).

**New helper:**

```typescript
// ---------------------------------------------------------------------------
// 13. markIngestFailed — permanent enrichment failure (PIP-05 / D-03)
// ---------------------------------------------------------------------------

/**
 * Marks a block as permanently failed enrichment. Called by the Triage Worker
 * after the retry budget exhausts (Zod parse fail attempts >= 2, non-retryable
 * AI errors, or DO-RPC failure after Queue retry budget).
 *
 * Writes `ingest_status = 'failed'` AND replaces `properties` with
 * `{error: reason, failed_at: <ms>}` for observability. The original
 * properties (if any) are intentionally overwritten — at the failed state
 * there is no useful enrichment to preserve, and the error info is the only
 * useful payload for v0.2 inbox UI "broken memories" surface.
 *
 * Throws `NotFoundError("block", args.block_id)` on zero `rowsWritten`.
 *
 * @requirement PIP-05 / D-03
 */
export function markIngestFailed(
  sql: SqlStorage,
  args: { block_id: string; reason: string },
): void {
  const properties = JSON.stringify({ error: args.reason, failed_at: Date.now() });
  const result = sql.exec(
    "UPDATE blocks SET ingest_status = 'failed', properties = ?, updated_at = ? WHERE id = ?",
    properties,
    Date.now(),
    args.block_id,
  );
  if (result.rowsWritten === 0) {
    throw new NotFoundError("block", args.block_id);
  }
}
```

**Shared invariants to honor (file doc-block lines 1–91):**
- Sync helper (D-01). NO `async` / `await` inside.
- Throw on miss for single-row UPDATEs (D-02).
- Positional `?` bindings only (workerd SQLite has no named params).
- Single-statement `.exec()` only (Pitfall 8).
- `JSON.stringify` at the helper boundary (D-03).

---

### 4. `packages/workspace-do/src/index.ts` — add `markIngestFailed` RPC method

**Analog:** `stampEmbedding` RPC method (lines 226–238) AND `updateBlockEnrichment` RPC (lines 257–271). Both established Phase 5 patterns:
1. First executable line is `this.assertOwnsWorkspace(args.workspace_id)` (STO-07).
2. Delegate to renamed-import helper in `./queries.js`.
3. Signature: `args: { workspace_id: string; ...rest }`.

**Pattern to copy — `stampEmbedding` (lines 226–238):**

```typescript
/**
 * Records `embedding_model` + `embedding_version` on a block after Vectorize
 * upsert completes. The block must exist; throws NotFoundError on miss.
 *
 * @requirement AI-03
 */
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
```

**Phase 6 application:**

1. Amend import block (lines 73–86) to add `markIngestFailed as markIngestFailedQuery`:

```typescript
import {
  insertBlock as insertBlockQuery,
  // ... existing imports ...
  moveToColdStorage as moveToColdStorageQuery,
  markIngestFailed as markIngestFailedQuery,        // NEW
} from "./queries.js";
```

2. Append the RPC method (after `moveToColdStorage`, ~line 320):

```typescript
/**
 * Marks a block as permanently failed enrichment (PIP-05). Called by the
 * Triage Worker after retry budget exhausts. Writes `ingest_status = 'failed'`
 * and overwrites properties with {error: reason, failed_at: <ms>} for
 * observability. Throws NotFoundError if the block does not exist.
 *
 * @requirement PIP-05 / D-03
 */
markIngestFailed(args: {
  workspace_id: string;
  block_id: string;
  reason: string;
}): void {
  this.assertOwnsWorkspace(args.workspace_id);
  markIngestFailedQuery(this.ctx.storage.sql, {
    block_id: args.block_id,
    reason: args.reason,
  });
}
```

**Cross-cutting auth pattern (file lines 144–151) — applies to every new RPC unconditionally:**

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

---

### 5. `packages/triage-worker/wrangler.jsonc` — add `queues.consumers[]`

**Analog:** same file, the existing `durable_objects.bindings` block (lines 20–24) and the `analytics_engine_datasets` declaration (line 27). The placeholder comment at lines 28–30 explicitly marks this as the Phase 6 wiring site.

**Pattern to copy — sibling binding shape:**

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "WORKSPACE", "class_name": "WorkspaceDO", "script_name": "engram-mcp-server" },
  ],
},
"analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "engram_ai_analytics" }],
// Queue consumer block lands in Phase 6 PIP-01.
```

**Phase 6 application — append the consumer block per CONTEXT.md "Claude's Discretion → Cloudflare Queues consumer config":**

```jsonc
"queues": {
  "consumers": [
    {
      "queue": "engram-ingest",
      "max_batch_size": 10,           // sequential processing — see triage-worker/src/index.ts Design notes
      "max_batch_timeout": 5,         // seconds — interactive remember() latency expectation
      "max_retries": 3,               // Triage Worker pre-empts on attempts >= 2 — see D-03
    },
  ],
},
```

> **No `dead_letter_queue` field.** Per D-03, the failure surface is `blocks.ingest_status = 'failed'` (SQLite) + Workers Analytics Engine + console.error. The Triage Worker's `attempts >= max_retries - 1` pre-emption is what prevents silent drop on retry exhaustion.

---

### 6. `packages/triage-worker/src/index.ts` — try/catch around DO-RPC switch + attempts pre-emption

**Analog:** same file's existing `queue(batch, env)` handler (lines 90–227) — sequential `for...of` loop, memoized `wsTag`, `extractAndScore` call that may return `null`, `switch (decision)` on memorability, Analytics Engine write per message, `message.ack()` at loop tail.

**Existing pattern — DO-RPC switch (lines 138–215) plus tail-ack (line 224):**

```typescript
switch (decision) {
  case "store-normal":
    await (stub as unknown as { updateBlockEnrichment: (...) => Promise<void> })
      .updateBlockEnrichment({ workspace_id: event.workspace_id, block_id: event.id, ... });
    break;
  case "inbox":
    await (stub as unknown as { moveToInbox: (...) => Promise<void> })
      .moveToInbox({ ... });
    break;
  case "cold-storage":
    await (stub as unknown as { moveToColdStorage: (...) => Promise<void> })
      .moveToColdStorage({ ... });
    break;
}
writeAnalytics(env, { blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "success"], ... });
message.ack();
```

**Phase 6 application — wrap the switch in try/catch + add attempts pre-emption before `extractAndScore`:**

```typescript
// Phase 6 PIP-05 / CONTEXT.md "Claude's Discretion → Queues consumer config":
// pre-empt the silent-drop-on-retry-exhaustion failure mode. The Queues runtime
// silently acks at attempts === max_retries; we mark failed + ack ourselves on
// the LAST allowed attempt (max_retries === 3 → pre-empt at attempts >= 2).
const attempts = (message as { attempts?: number }).attempts ?? 0;
const isLastAttempt = attempts >= 2;          // wrangler.jsonc max_retries: 3, 0-indexed attempts

const parsed = await extractAndScore(env, event, { ... }, wsTag);
if (parsed === null) continue;                // unchanged

const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id));
const decision = routeByMemorability(parsed.memorability);
const rpcStart = Date.now();

try {
  switch (decision) {
    // ... existing 3 cases unchanged ...
  }
  writeAnalytics(env, {
    blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "success"],
    doubles: [Date.now() - rpcStart, 0, 0, 0],
    indexes: [ANALYTICS_ENV_TAG],
  });
  message.ack();
} catch (err) {
  // Phase 6 PIP-05: DO RPC throw — assertOwnsWorkspace mismatch, NotFoundError
  // (block deleted between sync write and queue consume), workerd SQLite drift,
  // or cross-Worker DO outage. On the LAST allowed attempt, mark failed + ack
  // ourselves so the Queues runtime does NOT silently drop on retry exhaustion.
  const reason = err instanceof Error ? err.message : String(err);
  console.error("triage:do-rpc-failed", {
    id: event.id, decision, attempts, reason,
  });
  writeAnalytics(env, {
    blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "throw"],
    doubles: [Date.now() - rpcStart, 0, attempts, 1],
    indexes: [ANALYTICS_ENV_TAG],
  });
  if (isLastAttempt) {
    // Pre-empt silent drop. markIngestFailed is itself a DO RPC — if IT throws
    // we have no recourse, so we fall through to message.ack() unconditionally.
    try {
      await (stub as unknown as {
        markIngestFailed: (args: { workspace_id: string; block_id: string; reason: string }) => Promise<void>;
      }).markIngestFailed({
        workspace_id: event.workspace_id,
        block_id: event.id,
        reason: `do-rpc-${decision}: ${reason}`,
      });
      writeAnalytics(env, {
        blobs: ["triage-worker", `ingest-failed-do-rpc-${decision}`, wsTag, "marked"],
        doubles: [0, 0, attempts, 1],
        indexes: [ANALYTICS_ENV_TAG],
      });
    } catch (markErr) {
      console.error("triage:mark-failed-also-threw", {
        id: event.id, reason: markErr instanceof Error ? markErr.message : String(markErr),
      });
    }
    message.ack();
  } else {
    // Retry budget remains — let Queues runtime retry per max_retries config.
    message.retry({ delaySeconds: 30 });
  }
}
```

**Cross-cutting patterns from this file to honor unchanged:**
- Sequential `for...of` over `Promise.all` (Design notes lines 21–24 — 429 risk).
- `wsTag` memoized per-message (line 98 — avoids re-hashing).
- `(stub as unknown as { method: (...) => Promise<void> })` cast for cross-Worker DO RPC (RESEARCH Assumption A6, line 27).

---

### 7. `packages/triage-worker/src/extract.ts` — post-retry-budget catch → `markIngestFailed`

**Analog:** same file's existing Zod-fail permanent branch (lines 184–198) — already a "permanent failure" code path that calls `console.error` + `writeAnalytics(...ack-permanent)` + `message.ack()`. Phase 6 only needs to inject the `markIngestFailed` RPC call between `writeAnalytics` and `message.ack`.

**Existing pattern (lines 184–198) — Zod parse permanent fail:**

```typescript
// Second failure (attempts >= 2) — permanent failure. Ack + log.
// PIP-05 DLQ-equivalent: the message is removed from the queue and logged
// for offline analysis.
console.error("triage:zod-parse-failed-permanent", {
  id: event.id, attempts: message.attempts,
  issueCount: parsed.error.issues.length,
  firstIssue: parsed.error.issues[0],
  sample: JSON.stringify(candidate).slice(0, 500),
});
writeAnalytics(env, {
  blobs: ["triage-worker", "zod-parse-fail", wsTag, "ack-permanent"],
  doubles: [aiLatency, event.content.length, message.attempts, 0],
  indexes: [ANALYTICS_ENV_TAG],
});
message.ack();
return null;
```

**Phase 6 amendment.** The challenge: `extract.ts` does NOT currently have access to `env.WORKSPACE` (its `env` parameter is typed `{ AI: Ai; ANALYTICS?: AnalyticsEngineDataset }` — line 80). Two options for the planner:

- **Option A (recommended).** Widen the `env` parameter type to include `WORKSPACE` (and pass it from `index.ts`), then call `markIngestFailed` inline before `message.ack()`. Minimal-diff option.
- **Option B.** Return a discriminated union (`{ kind: "permanent-fail"; reason: string }`) from `extractAndScore`, let the `index.ts` `queue()` loop dispatch the `markIngestFailed` call. Cleaner separation but a bigger refactor.

The CONTEXT.md Wave 3 description ("Triage Worker permanent-failure path in `extract.ts` (after retry budget exhausts, call `markIngestFailed` + `message.ack()`)") implies Option A. Planner picks; both honor PIP-05.

**Option A amended block — inject between `writeAnalytics` and `message.ack`:**

```typescript
// Widen the env type at the function signature:
export async function extractAndScore(
  env: {
    AI: Ai;
    ANALYTICS?: AnalyticsEngineDataset;
    WORKSPACE: DurableObjectNamespace;       // NEW — needed for markIngestFailed RPC
  },
  ...
)

// Inside the permanent-fail branch, BEFORE the existing message.ack() call:
const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id));
try {
  await (stub as unknown as {
    markIngestFailed: (args: { workspace_id: string; block_id: string; reason: string }) => Promise<void>;
  }).markIngestFailed({
    workspace_id: event.workspace_id,
    block_id: event.id,
    reason: `zod-parse-fail: ${parsed.error.issues[0]?.message ?? "unknown"}`,
  });
  writeAnalytics(env, {
    blobs: ["triage-worker", "ingest-failed-zod-parse", wsTag, "marked"],
    doubles: [aiLatency, event.content.length, message.attempts, 1],
    indexes: [ANALYTICS_ENV_TAG],
  });
} catch (markErr) {
  // markIngestFailed RPC itself failed — log + continue to ack (don't infinitely retry).
  console.error("triage:mark-failed-also-threw-from-zod", {
    id: event.id, reason: markErr instanceof Error ? markErr.message : String(markErr),
  });
}
message.ack();              // existing — unchanged
return null;
```

**Also apply** to the non-429 throw catch arm (lines 123–130) — currently `throw err` bubbles the error to the Queue runtime; Phase 6 should detect non-retryable errors on the last attempt and call `markIngestFailed` before re-throwing (so the SQLite surface records the failure). Planner refines.

---

### 8. `packages/mcp-server/wrangler.jsonc` — add `queues.producers[]` binding

**Analog:** same file, sibling binding shape (lines 13–21). Pattern: top-level service-binding key with array of `{ binding, ... }` objects.

**Pattern to copy:**

```jsonc
"ai": { "binding": "AI" },
"vectorize": [{ "binding": "VECTORIZE", "index_name": "engram-memories" }],
"analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "engram_ai_analytics" }],
"durable_objects": {
  "bindings": [ ... ],
},
```

**Phase 6 application — append between `analytics_engine_datasets` and `durable_objects`:**

```jsonc
"queues": {
  "producers": [{ "binding": "INGEST_QUEUE", "queue": "engram-ingest" }],
},
```

The `Env` interface for `mcp-server` (if explicitly declared anywhere — check `src/index.ts`) gets `INGEST_QUEUE: Queue<MemoryEvent>`. Otherwise the cast pattern in `tools.ts` line 250 (`(env as any).WORKSPACE`) is the precedent for accessing untyped bindings:

```typescript
const ingestQueue = (env as { INGEST_QUEUE: Queue<MemoryEvent> }).INGEST_QUEUE;
```

---

### 9. `packages/mcp-server/src/tools.ts` `remember()` — append MemoryEvent + `ctx.waitUntil(INGEST_QUEUE.send(...))`

**Analog:** same file lines 257–392 — the established `remember()` handler shape. The insertion point is **after** the Analytics Engine "vectorize-upsert success" write (line 374–378) and **before** the truncation-gap calculation (line 382) — i.e., inside the try-block, after all sync side effects succeed, before the envelope return.

**Existing pattern — the tail of the try-block (lines 360–392):**

```typescript
const upsertStart = Date.now();
await vectorizeUpsert(env, props.workspace_id, [{
  id, values: vector,
  metadata: { type: block.type ?? "", scope: block.scope, created_at: block.created_at },
}]);
writeAnalytics(env, {
  blobs: ["mcp-server", "vectorize-upsert", wsTag, "success"],
  doubles: [Date.now() - upsertStart, 768, 0, 0],
  indexes: [ANALYTICS_ENV_TAG],
});
// === End Phase 5 AI-03 additions ===

// Surface truncation in meta.gaps if content was truncated for embedding.
const extraGaps = truncated ? [META_GAPS.truncationOver1800Chars] : [];
const envelope = buildRememberResponse({ ... });
```

**Phase 6 insertion — between the `vectorize-upsert success` writeAnalytics and the `extraGaps` line:**

```typescript
// === Phase 6 PIP-02: enqueue async enrichment ===
// MemoryEvent assembly per CONTEXT.md Claude's Discretion §"MemoryEvent payload contents".
// `id: id` (same UUID as the SQLite row — A11/IP-1 idempotency hook).
// `workspace_id: props.workspace_id` — ALWAYS from props, NEVER from args (MCP-05 / MT-1).
// `source: args.source ?? "mcp:claude"` — mirrors block.source write above.
const memoryEvent: MemoryEvent = {
  id,
  source: args.source ?? "mcp:claude",
  content: args.content,                  // raw user content, NOT truncated embed input
  workspace_id: props.workspace_id,        // from props (defense-in-depth)
  timestamp: now,                          // matches block.created_at
  ...(args.type !== undefined && { hint: args.type }),
  ...(props.user_id !== undefined && { context: { user_id: props.user_id } }),
};
// ctx.waitUntil so remember() returns before the Queue send resolves. Fire-and-
// forget by design: if INGEST_QUEUE.send fails (Cloudflare outage), the block
// sits at ingest_status='pending' indefinitely (D-03 known limitation; v0.2
// stuck-pending sweep Cron Worker addresses).
const queueSendStart = Date.now();
ctx.waitUntil(
  (async () => {
    try {
      await (env as { INGEST_QUEUE: Queue<MemoryEvent> }).INGEST_QUEUE.send(memoryEvent);
      writeAnalytics(env, {
        blobs: ["mcp-server", "queue-send", wsTag, "success"],
        doubles: [Date.now() - queueSendStart, 1, 0, 0],
        indexes: [ANALYTICS_ENV_TAG],
      });
    } catch (queueErr) {
      console.error("mcp-server:queue-send-failed", {
        id, reason: queueErr instanceof Error ? queueErr.message : String(queueErr),
      });
      writeAnalytics(env, {
        blobs: ["mcp-server", "queue-send", wsTag, "throw"],
        doubles: [Date.now() - queueSendStart, 1, 0, 1],
        indexes: [ANALYTICS_ENV_TAG],
      });
    }
  })(),
);
// === End Phase 6 additions ===
```

**Two requirements for the planner:**
1. Add `ctx` to the handler's signature. The MCP SDK registerTool callback's `extra` parameter (second arg) carries `ctx` — verify against `@modelcontextprotocol/sdk/server/mcp.d.ts` for the exact accessor. If `ctx` is not on the SDK extra, fall back to `env.WAITUNTIL` (Cloudflare Workers don't expose `ctx` cleanly inside the McpAgent SDK adapter — Planner verifies; may need to thread it through a class field on `EngramMcp`).
2. Import `MemoryEvent` from `@engram/types` at the top of the file alongside the existing `import type { Memory } from "@engram/types"`.

---

### 10. `packages/mcp-server/src/tools.ts` `ingest()` — retarget Phase-6-handoff comment per D-02

**Analog:** same file lines 628–652. The existing comment block embeds two Phase 6 references that are now historically inaccurate per D-02.

**Existing pattern (lines 628–629, 643):**

```typescript
// ingest(source, type?, project?, priority?, threshold?)
/* eslint-disable @typescript-eslint/require-await -- D-05: ingest has no await in v0.1; async is kept so Phase 6 adds ctx.waitUntil(env.INGEST_QUEUE.send(...)) as a one-line diff */
// ...
      // Route-by-DO-id check (TOL-07 Prong A). Phase 6 will use the resolved stub to call ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent)) — D-05 swap is one-line.
```

**Phase 6 retargeting — substitute "Phase 6" with "v0.4 connectors":**

```typescript
// ingest(source, type?, project?, priority?, threshold?)
/* eslint-disable @typescript-eslint/require-await -- D-05: ingest has no await in v0.1; async is kept so v0.4 connectors (Slack channel ingestion, Google Drive polling) add the Queue producer body — Phase 6 left ingest as a stub per Phase 6 CONTEXT.md D-02 */
// ...
      // Route-by-DO-id check (TOL-07 Prong A). v0.4 connectors will use the resolved stub to call ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent)) — Phase 6 CONTEXT.md D-02 deferred this body to v0.4.
```

No behavior change. No new code. Pure doc touch-up.

---

### 11. `scripts/setup-queue.sh` (NEW)

**Analog:** `scripts/setup-vectorize.sh` (lines 1–65). Idempotent CLI provisioning script with `set -euo pipefail`, pre-check via `wrangler ... get`, create-only-if-absent. Mirrors Cloudflare wrangler-cli's lack of native idempotency on `create` subcommands.

**Pattern to copy (lines 1–45):**

```bash
#!/usr/bin/env bash
# AI-01: Idempotent Vectorize index provisioning for Engram.
# ...
set -euo pipefail

INDEX_NAME="engram-memories"
PRESET="@cf/baai/bge-base-en-v1.5"

echo "=== Engram Vectorize Setup ==="
# ...

# --- Idempotency precheck: only create if the index does not already exist ---
if npx wrangler vectorize get "${INDEX_NAME}" >/dev/null 2>&1; then
  echo "[skip] Index '${INDEX_NAME}' already exists — no-op."
else
  echo "[create] Creating Vectorize index '${INDEX_NAME}' with preset ${PRESET}..."
  npx wrangler vectorize create "${INDEX_NAME}" \
    --preset="${PRESET}" \
    --description="Engram v0.1 — single global index, namespace per workspace"
  echo "[ok] Index created."
fi
```

**Phase 6 application — `scripts/setup-queue.sh`:**

```bash
#!/usr/bin/env bash
# PIP-01: Idempotent Cloudflare Queue provisioning for Engram.
#
# Re-running this script is a no-op — it prechecks via `wrangler queues list`
# (or `wrangler queues info`) before issuing `create`. The queue is a producer
# for `mcp-server` and a consumer for `triage-worker`; see CONTEXT.md
# §"Claude's Discretion → Cloudflare Queues consumer config" for the consumer
# retry budget.
#
# WARNING: NEVER run `wrangler queues delete engram-ingest` in production.
# Deleting the queue destroys all in-flight MemoryEvents (at-least-once delivery
# guarantee assumes the queue exists). See A11/IP-1 mitigation in PIP-04.
#
# Usage:
#   bash scripts/setup-queue.sh    # direct
#   npm run setup:queue            # via npm script (planner adds if appropriate)

set -euo pipefail

QUEUE_NAME="engram-ingest"

echo "=== Engram Queue Setup ==="
echo "Queue: ${QUEUE_NAME}"
echo ""

# --- Idempotency precheck: only create if the queue does not already exist ---
# wrangler queues create is NOT natively idempotent (second run errors with
# "queue already exists"). wrangler queues info exits 0 if found, non-zero
# otherwise. (Planner verifies the exact wrangler v4 subcommand against
# https://developers.cloudflare.com/queues/ — the analog used `vectorize get`
# which is the same shape.)
if npx wrangler queues info "${QUEUE_NAME}" >/dev/null 2>&1; then
  echo "[skip] Queue '${QUEUE_NAME}' already exists — no-op."
else
  echo "[create] Creating Cloudflare Queue '${QUEUE_NAME}'..."
  npx wrangler queues create "${QUEUE_NAME}"
  echo "[ok] Queue created."
fi

echo ""
echo "=== Queue setup complete ==="
```

> Planner verification gate: confirm `wrangler queues info <name>` is the right precheck subcommand against the current wrangler v4 CLI. If `queues info` doesn't exist, the analog of `vectorize get` is `queues list | grep "${QUEUE_NAME}"`.

---

### 12. `packages/workspace-do/src/__tests__/schema.test.ts` — extend with v3 column assertions

**Analog:** same file, the `cold_storage` describe block (lines 102–124). Identical shape: `runInDurableObject` with a unique workspace name, PRAGMA introspection, column-presence + type + default-value assertions.

**Pattern to copy (lines 102–124):**

```typescript
describe("blocks cold_storage column (D-07 / v2)", () => {
  it("includes cold_storage INTEGER DEFAULT 0 added by v2 migration", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-cold-storage-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      const cols = state.storage.sql
        .exec("PRAGMA table_info(blocks)")
        .toArray()
        .map((c) => ({
          name: c.name as string,
          type: c.type as string,
          notnull: c.notnull as number,
          dflt_value: c.dflt_value,
        }));

      const coldStorage = cols.find((c) => c.name === "cold_storage");
      expect(coldStorage).toBeDefined();
      expect(coldStorage?.type.toUpperCase()).toBe("INTEGER");
      expect(coldStorage?.dflt_value).toBe("0");
    });
  });
});
```

**Phase 6 amendment.** Two changes:

1. **Update existing `_schema_migrations` test (lines 56–78)** — expect 3 rows instead of 2:

```typescript
expect(rows.length).toBe(3);                  // was 2
// ... existing v1 + v2 assertions ...
const v3 = rows[2];
expect(v3).toBeDefined();
expect(v3?.version).toBe(3);
expect(v3?.name).toBe("v3_ingest_status");
expect(typeof v3?.applied_at).toBe("number");
```

2. **Add new describe block — v3 `ingest_status` column:**

```typescript
describe("blocks ingest_status column (D-03 / v3)", () => {
  it("includes ingest_status TEXT NOT NULL DEFAULT 'pending' added by v3 migration", async () => {
    const id = env.WORKSPACE.idFromName("ws-schema-ingest-status-test");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (_inst, state) => {
      const cols = state.storage.sql
        .exec("PRAGMA table_info(blocks)")
        .toArray()
        .map((c) => ({
          name: c.name as string,
          type: c.type as string,
          notnull: c.notnull as number,
          dflt_value: c.dflt_value,
        }));

      const ingestStatus = cols.find((c) => c.name === "ingest_status");
      expect(ingestStatus).toBeDefined();
      expect(ingestStatus?.type.toUpperCase()).toBe("TEXT");
      expect(ingestStatus?.notnull).toBe(1);
      // SQLite quotes string defaults — match the quoted form workerd emits.
      expect(ingestStatus?.dflt_value).toBe("'pending'");

      // Also assert the supporting index exists.
      const indexes = state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'blocks'")
        .toArray()
        .map((r) => r.name as string);
      expect(indexes).toContain("idx_blocks_ingest_status");
    });
  });
});
```

---

### 13. `packages/triage-worker/src/__tests__/queue-integration.test.ts` (NEW)

**Analog combination — two existing shapes:**

- **Mock-message harness** from `packages/triage-worker/src/__tests__/extract.test.ts` (lines 41–131): `vi.fn()` for `retry`/`ack`, `attempts: number`, `baseEvent: MemoryEvent`.
- **Real-DO harness** from `packages/mcp-server/src/__tests__/tools-integration.test.ts` (lines 39–110): `runInDurableObject` + `env.WORKSPACE.idFromName(...)` for real SQLite state assertions + `Object.defineProperty` patching of env bindings for AI/VECTORIZE.

**Tests to ship (per CONTEXT.md Wave 4):**

1. **Replay-twice idempotency** — invoke the queue handler twice with the same `MemoryEvent.id`; assert:
   - exactly one row in `blocks` (because the sync write already happened in `remember()`)
   - exactly one row in `inbox` if the path is inbox (proves `INSERT OR IGNORE`)
   - `blocks.ingest_status === 'enriched'` after both runs (UPDATE idempotent)
   - exactly one Vectorize entry in the mock state Map

2. **ingest_status lifecycle** — three sub-tests:
   - `pending → enriched` on memorability > 0.8 success path
   - `pending → enriched` on memorability 0.4–0.8 inbox path
   - `pending → failed` on Zod-fail-attempts>=2 + `markIngestFailed` called

3. **Cold-storage + enriched orthogonality** — memorability < 0.4 message produces `cold_storage = 1 AND ingest_status = 'enriched'`; no `failed` co-occurrence ever (negative assertion).

4. **`markIngestFailed` observability** — assert console.error called AND `writeAnalytics` saw `["triage-worker", /^ingest-failed-/, ..., "marked"]`.

**Pattern from extract.test.ts (lines 41–63) — vi.fn message mock:**

```typescript
const message = {
  retry: vi.fn(),
  ack: vi.fn(),
  attempts: 1,
  body: baseEvent,
} as unknown as Parameters<typeof extractAndScore>[2];

const mockEnv = {
  AI: { run: async () => ({ ... }) },
} as unknown as Parameters<typeof extractAndScore>[0];
```

**Pattern from tools-integration.test.ts — `runInDurableObject` for SQLite-state assertion (analogous shape):**

```typescript
const id = env.WORKSPACE.idFromName(workspaceId);
const stub = env.WORKSPACE.get(id);
await runInDurableObject(stub, (_inst, state) => {
  const row = state.storage.sql
    .exec("SELECT ingest_status FROM blocks WHERE id = ?", blockId)
    .toArray()[0];
  expect(row?.ingest_status).toBe("enriched");
});
```

**Combined test skeleton:**

```typescript
/**
 * Phase 6 PIP-01..06 — Queue consumer integration tests.
 *
 * Asserts: replay-twice idempotency, ingest_status lifecycle, cold-storage +
 * enriched orthogonality, markIngestFailed observability.
 *
 * Test harness pattern: `extract.test.ts` (vi.fn message mock) + `tools-
 * integration.test.ts` (runInDurableObject for real SQLite assertions).
 *
 * @module @engram/triage-worker/__tests__/queue-integration
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect, vi } from "vitest";
import handler from "../index.js";   // the default-exported { queue } object

describe("PIP-01..06 queue handler integration", () => {
  it("replay-twice produces exactly one inbox row (idempotency)", async () => { ... });
  it("memorability > 0.8 transitions ingest_status pending → enriched", async () => { ... });
  it("memorability 0.4–0.8 transitions pending → enriched + writes inbox", async () => { ... });
  it("memorability < 0.4 transitions pending → enriched AND sets cold_storage=1", async () => { ... });
  it("Zod parse failure attempts>=2 sets ingest_status = 'failed'", async () => { ... });
  it("DO RPC failure at attempts=2 calls markIngestFailed + acks (no silent drop)", async () => { ... });
});
```

> **Test infrastructure caveat** (CONTEXT.md Claude's Discretion §"Test infrastructure"). Wrangler's local Queue emulator coverage in `wrangler@4` may be thin; the analog `extract.test.ts` already uses in-process `vi.fn` message mocks. The integration tests above can follow the same in-process-mock strategy (call `handler.queue({ messages: [...] }, env)` directly), no Queue emulator needed — the Queue is just the delivery mechanism, the test exercises the consumer body and the DO RPCs it issues.

---

### 14. `packages/mcp-server/src/__tests__/tools-integration.test.ts` — extend with latency test

**Analog:** same file's existing `it.skip("p50 latency under 400ms for default-verbosity (chunks) recall", ...)` block (lines 482–509). Same `Date.now()` + `latencies.sort()` + `Math.floor(...)` pattern.

**Pattern to copy (lines 497–509):**

```typescript
const latencies: number[] = [];
for (let i = 0; i < 10; i++) {
  const start = Date.now();
  await recallCb({ query: `find topic-${String(i % 3)} content`, verbosity: "chunks" }, {});
  latencies.push(Date.now() - start);
}
latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length / 2)];
console.log(`AI-04 default recall p50: ${String(p50)}ms (latencies: ${latencies.join(", ")}ms)`);
expect(p50).toBeLessThan(400);
```

**Phase 6 application — assert `remember()` returns BEFORE the Queue consumer processes the message:**

```typescript
describe("PIP-02: remember() returns before async enrichment completes", () => {
  it("remember() resolves before INGEST_QUEUE.send awaited (waitUntil decouples)", async () => {
    const ws = "ws-pip02-latency";
    const rememberCb = captureCallback("remember", ws);

    // Patch INGEST_QUEUE.send to record when it's actually invoked relative to
    // when remember() resolves. The waitUntil pattern means remember() returns
    // BEFORE the inner await env.INGEST_QUEUE.send(...) completes.
    let queueSendInvokedAt: number | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).INGEST_QUEUE = {
      send: async (_evt: unknown) => {
        await new Promise((r) => setTimeout(r, 200));   // simulate 200ms queue latency
        queueSendInvokedAt = Date.now();
      },
    };

    const rememberStart = Date.now();
    await rememberCb({ content: "PIP-02 latency probe" }, {});
    const rememberDuration = Date.now() - rememberStart;

    // remember() should return in well under 200ms — the queue.send latency
    // does NOT block the response (ctx.waitUntil decouples).
    expect(rememberDuration).toBeLessThan(150);
    // queueSendInvokedAt may still be null at this point — that's the proof.

    // Optional: wait for the waitUntil promise to settle and assert it ran.
    await new Promise((r) => setTimeout(r, 500));
    expect(queueSendInvokedAt).not.toBeNull();
  });
});
```

---

### 15–17. Doc touch-ups (no code analogs)

- **`.planning/ROADMAP.md`** PIP-04 success criterion: strike "and conflict detection against existing memories in the workspace"; append footnote `(conflict detection deferred to v0.2 — see CONTEXT.md D-01)`.
- **`.planning/REQUIREMENTS.md`** PIP-04 line: same edit.
- **`.planning/todos/pending/2026-05-26-phase-6-validate-conflict-detection-precision.md`**: append paragraph `> Validation gate moves to v0.2 per Phase 6 CONTEXT.md D-01. v0.1 ships entity extraction + summarization + memorability scoring only.`

---

## Shared Patterns

### Pattern A — Sync helper / async wrapper (Phase 2 D-01)

**Source:** `packages/workspace-do/src/queries.ts` doc-block lines 17–22; `packages/workspace-do/src/index.ts` instance methods.
**Apply to:** new `markIngestFailed` query helper (sync `void` return) wrapped by RPC method on `WorkspaceDO` class.

```typescript
// queries.ts — sync helper
export function markIngestFailed(sql: SqlStorage, args: { ... }): void { ... }

// index.ts — async-compatible RPC method (Cloudflare DO RPC contract handles the async boundary)
markIngestFailed(args: { workspace_id: string; ... }): void {
  this.assertOwnsWorkspace(args.workspace_id);
  markIngestFailedQuery(this.ctx.storage.sql, { ... });
}
```

### Pattern B — `assertOwnsWorkspace` first executable line (STO-07)

**Source:** `packages/workspace-do/src/index.ts` lines 144–151 (definition) + every RPC method (call site).
**Apply to:** every new RPC method in Phase 6 (`markIngestFailed`).

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

### Pattern C — `workspace_id` ALWAYS from props, NEVER from args (MCP-05 / MT-1)

**Source:** `packages/mcp-server/src/tools.ts` lines 230–231 comment + every handler's `insertBlock({ workspace_id: props.workspace_id, ... })` call (e.g., line 291).
**Apply to:** the new MemoryEvent assembly in `remember()` (`workspace_id: props.workspace_id`); the new `markIngestFailed` RPC call (`workspace_id: event.workspace_id` — sourced from the Queue message body, which the producer populated from `props.workspace_id`).

### Pattern D — Analytics Engine write per AI/DO-RPC op (Phase 5 §"Production monitoring")

**Source:** `packages/triage-worker/src/analytics.ts` lines 86–103 + every call site (e.g., `index.ts` lines 217–221).
**Apply to:** every new `markIngestFailed` call site (`blobs: ["triage-worker", "ingest-failed-{reason-tag}", wsTag, "marked"]`) AND every new `queue-send` call site in `tools.ts` `remember()` (`blobs: ["mcp-server", "queue-send", wsTag, "success" | "throw"]`).

**Schema (locked — AI-SPEC.md §7):** `blobs[0..3] = worker, op-kind, workspace-tag, outcome`; `doubles[0..3] = latency-ms, input-length, retry-count, success-false-flag`; `indexes[0] = environment-tag` (always `"engram-prod"`).

### Pattern E — Cross-Worker DO RPC stub cast (RESEARCH Assumption A6)

**Source:** `packages/triage-worker/src/index.ts` lines 134, 141–157 — `env.WORKSPACE.get(env.WORKSPACE.idFromName(...))` + `(stub as unknown as { method: (args) => Promise<void> }).method(...)`.
**Apply to:** every new RPC invocation in Phase 6 (`markIngestFailed` from both `extract.ts` permanent-fail branch and `index.ts` catch branch).

```typescript
const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id));
await (stub as unknown as {
  markIngestFailed: (args: { workspace_id: string; block_id: string; reason: string }) => Promise<void>;
}).markIngestFailed({ workspace_id: event.workspace_id, block_id: event.id, reason });
```

### Pattern F — Sequential message processing (Phase 5 Design note)

**Source:** `packages/triage-worker/src/index.ts` lines 21–24, 91–92.
**Apply to:** all new code paths in `queue(batch, env)`. The try/catch wrap around the DO-RPC switch stays inside the same `for...of` loop — sequential ordering is preserved, the catch does not parallelize.

### Pattern G — `ctx.waitUntil` for fire-and-forget side effects

**Source:** No existing call in this codebase — Phase 6 introduces the pattern at the `remember()` Queue-send call site. **Cloudflare docs** (CONTEXT.md canonical refs): `ctx.waitUntil(promise)` extends the Worker invocation lifetime so the promise resolves AFTER the response is returned. Required to decouple sync `remember()` response from async Queue enqueue.

**Apply to:** `packages/mcp-server/src/tools.ts` `remember()` only. Inside the waitUntil callback, wrap the `INGEST_QUEUE.send` in try/catch + console.error + writeAnalytics on failure — the fire-and-forget semantic means we cannot let the inner throw propagate.

### Pattern H — Forward-only migration with idempotent column add (Phase 5 D-07)

**Source:** `packages/workspace-do/src/schema.ts` lines 145–185 + `packages/workspace-do/src/migrations.ts` lines 53–56.
**Apply to:** v3 `ingest_status` migration. `ALTER TABLE ADD COLUMN` is NOT idempotent at SQL layer; the `_schema_migrations` version-check is the idempotency guarantee. `CREATE INDEX IF NOT EXISTS` is naturally idempotent.

### Pattern I — `INSERT OR IGNORE` for at-least-once consumer idempotency

**Source:** New for Phase 6 (no prior `OR IGNORE` in the codebase). **CLAUDE.md §"Idempotency on duplicate Queue delivery"** + A11/IP-1 mandate. Existing `createInboxEntry` (queries.ts line 472–483) gets the one-word amendment.
**Apply to:** `createInboxEntry` only. UPDATEs are naturally idempotent; only INSERTs need the `OR IGNORE` clause.

### Pattern J — Doc-block + JSDoc convention

**Source:** every file in `packages/workspace-do/src/` and `packages/triage-worker/src/` opens with a multi-paragraph `/** ... */` doc-block covering cross-phase contract, design notes, and `@module` tag.
**Apply to:** the new `markIngestFailed` helper + RPC method + the new `queue-integration.test.ts` file. Tone and structure match analog files.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| (none) | — | — | All Phase 6 surfaces have in-repo analogs. The contract-integration character means every EDIT touches an existing file or extends an existing test shape; the one NEW script (`setup-queue.sh`) mirrors `setup-vectorize.sh` exactly. |

**Soft caveat — `ctx.waitUntil`** has no existing call site in this codebase. Pattern G above sources from Cloudflare docs (CONTEXT.md canonical refs §"Cloudflare official docs"). Planner verifies the exact `ctx` accessor inside the McpAgent SDK adapter — it may not be exposed directly on the `registerTool` callback's `extra` arg and may need to be threaded through a class field on `EngramMcp`.

---

## Metadata

**Analog search scope:** `packages/workspace-do/src/`, `packages/triage-worker/src/`, `packages/mcp-server/src/`, `shared/types/src/`, `scripts/`, `.planning/phases/05-ai-integration/`.
**Files scanned:** 12 (8 reads of analog source files, 4 reads of analog test/config files).
**Pattern extraction date:** 2026-05-29.
**Phase character:** contract-integration (Queue + WorkspaceDO RPC + producer-site coordination). Expected cf-code-assist routing share: <20% per CONTEXT.md Claude's Discretion §"No cf-code-assist routing tracker for Phase 6."
