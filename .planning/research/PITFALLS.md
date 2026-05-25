# Domain Pitfalls — Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Researched:** 2026-05-24
**Operating principle:** "Do it RIGHT, not FAST" — pitfalls research is aggressive on purpose.
**Confidence:** HIGH for Cloudflare-stack pitfalls (verified against current official docs); MEDIUM for MCP ecosystem pitfalls (newer protocol, faster churn); HIGH for memory-product pitfalls (well-documented in RAG literature).

---

## How To Read This File

Every pitfall has:

- **Severity** — `catastrophic` (rewrite-class), `serious` (production incident), `annoying` (UX friction)
- **Warning signs** — concrete observables: error string, metric, symptom
- **Prevention** — actionable code/architecture decision, never "be careful"
- **Phase mapping** — the milestone where it must be addressed

The **v0.1 Must-Mitigate List** at the bottom is the ruthless short list — eight items max — that v0.1 cannot ship without.

---

## 1. Durable Object Pitfalls (v0.1, v0.3)

The DO-per-workspace model is load-bearing. These are the failure modes Cloudflare has documented or that the community has hit in production.

### DO-1: SQLite class election is irreversible

- **Severity:** catastrophic
- **Phase:** v0.1 (must be correct at first deploy)
- **What goes wrong:** When you define a new DO class, you opt into SQLite-backed storage in the migration config. You cannot change a non-SQLite DO into a SQLite DO later. Get this wrong and every workspace's `WorkspaceDO` has to be redeployed under a new class name with a migration script.
- **Warning signs:** Wrangler migration block lacks `new_sqlite_classes`; only has `new_classes`.
- **Prevention:** Wrangler `[[migrations]]` must use `new_sqlite_classes = ["WorkspaceDO", "UserDO", "ProjectDO"]` on first deploy. Add a deployment checklist that greps for `new_sqlite_classes` before any `wrangler deploy` of a new DO class.
- **Detection in CI:** Lint rule on `wrangler.toml` — reject merge if a new DO class appears in `new_classes`.

### DO-2: `PRAGMA user_version` not supported — schema migration footgun

- **Severity:** serious
- **Phase:** v0.1
- **What goes wrong:** Standard SQLite migration pattern (`PRAGMA user_version`) silently does nothing inside a DO. Naive migration runners will re-apply every migration on every cold start, eventually corrupting state or raising "table already exists" errors.
- **Warning signs:** Migration script uses `PRAGMA user_version`; cold-start logs show repeated `CREATE TABLE IF NOT EXISTS` calls.
- **Prevention:** Use the `durable-utils` `SQLSchemaMigrations` class (tracks executed migrations in a versioned table) OR roll your own `_schema_migrations` table queried via `SELECT MAX(version)` in the constructor before applying deltas. Initialize migrations inside `blockConcurrencyWhile()` to prevent first-request races.
- **Detection:** A migration test that loads a DO, runs migrations twice, asserts no errors.

### DO-3: `blockConcurrencyWhile()` across network I/O collapses throughput

- **Severity:** serious
- **Phase:** v0.1
- **What goes wrong:** Wrapping a `fetch()` (e.g. to Workers AI or Vectorize) in `blockConcurrencyWhile()` pins the DO to ~200 req/sec instead of ~1,000. This is the most-cited DO anti-pattern in Cloudflare's official guidance.
- **Warning signs:** Any `blockConcurrencyWhile()` body that contains `fetch`, `env.AI.run`, `env.VECTORIZE`, or KV/R2 calls.
- **Prevention:** Use `blockConcurrencyWhile()` only for synchronous initialization (schema migrations, in-memory cache hydration). For external I/O, use optimistic concurrency: read state, do the I/O, then `BEGIN TRANSACTION`-style check-and-commit.
- **Detection:** Custom lint rule (or grep) flagging `blockConcurrencyWhile.*(env\.|fetch\()`.

### DO-4: Alarm constructor TTL extension trap

- **Severity:** serious
- **Phase:** v0.2 (alarms enter when triage is scheduled), v0.4 (digest scheduler)
- **What goes wrong:** If the constructor calls `setAlarm()` unconditionally, then every wake-from-hibernation runs the constructor first, which sets a new alarm that pushes the next fire further out — the actual `alarm()` handler never runs. Object hibernates → wakes → reschedules itself → hibernates → forever.
- **Warning signs:** Digest never sends. Conflict scan never runs. Alarm timestamps in logs always move forward but never fire.
- **Prevention:** In the constructor, only call `setAlarm()` after checking `await storage.getAlarm() === null`. Make alarm handlers idempotent — they may also fire more than once.
- **Detection:** A test that creates a DO, calls `setAlarm(Date.now() + 1000)`, hibernates, wakes, verifies the alarm still fires.

### DO-5: Single-DO bottleneck at 1,000 req/sec

- **Severity:** catastrophic at scale
- **Phase:** v0.3 (when teams/projects spawn many DOs) — but the architecture decision is locked at v0.1
- **What goes wrong:** A single DO handles ~500–1,000 req/sec on a single JS thread. If a "popular" workspace (a team's TeamDO with many active members) is the hot path for all writes, it returns `Durable Object reset because its code was updated` or `too many requests queued` errors. The v0.1 architecture already places one DO per workspace, which is correct — but the temptation to add a "global" UserRegistry DO or "stats" aggregator DO must be resisted.
- **Warning signs:** Errors like `Durable Object has too much work to keep up` or `too many requests for the same object within a 10 second window`.
- **Prevention:** No global singleton DOs. Any cross-workspace aggregation goes through Queues, not synchronous DO-to-DO calls. Cross-DO fanout writes use Queues; cross-DO reads are eventually consistent.
- **Detection:** Architecture review — flag any DO whose namespace would have <10 instances.

### DO-6: In-memory state lost on eviction (no warning)

- **Severity:** annoying → serious depending on use
- **Phase:** v0.1
- **What goes wrong:** Class properties on the DO instance disappear on hibernation/eviction. Cache-only state (e.g. parsed memory_types, member roles) silently goes stale after wake-up and the next constructor call re-fetches from SQLite — but only if you remember to re-fetch. If you assumed the cache survived, you serve stale or empty data.
- **Warning signs:** First-request-after-quiet-period returns empty results; subsequent identical requests return correct data.
- **Prevention:** Treat `this.memoryTypes` etc. as caches: always populate in the constructor from SQLite (synchronously via `blockConcurrencyWhile`). Never store mutable state only in memory.
- **Detection:** Test that hibernates the DO (or uses a fresh stub) and verifies first-request correctness.

### DO-7: Forgetting to call `storage.deleteAll()` leaves DOs "alive forever"

- **Severity:** annoying → serious (cost)
- **Phase:** v0.3 (workspace deletion), v0.4 (project archival)
- **What goes wrong:** Once a DO writes anything to storage (including an alarm), the DO persists indefinitely. Deleting "all blocks" via SQL doesn't delete the DO. Workspace deletion that just `DELETE FROM blocks` leaves a zombie DO billing for its 12KB SQLite header and any future wake-ups.
- **Warning signs:** Account-level DO count keeps climbing despite users deleting workspaces; KV/DO list shows IDs not present in active workspace registry.
- **Prevention:** Workspace deletion must call `storage.deleteAll()` AND `storage.deleteAlarm()` on the DO before the DO ID is removed from the registry. Document this in the `forget`/workspace-delete code paths.
- **Detection:** Periodic reconciliation script that lists DO instances vs. active workspace registry.

### DO-8: Cross-DO calls without `await` create dangling promises

- **Severity:** serious (silent data loss)
- **Phase:** v0.3 (multi-workspace)
- **What goes wrong:** `userDO.notify(...)` without `await` silently drops the promise. Errors are swallowed. If you fire-and-forget too many calls, the runtime terminates the worker before they complete.
- **Warning signs:** No errors in logs, but downstream DOs missing expected updates. `wrangler tail` shows "Promise rejection not handled."
- **Prevention:** ESLint rule `@typescript-eslint/no-floating-promises` enabled in strict mode. Code review: every `.fetch()` / `.method()` call on a DO stub MUST be awaited or explicitly wrapped in `ctx.waitUntil()`.
- **Detection:** Lint-on-CI; runtime `unhandledRejection` capture sent to logging.

---

## 2. Workers AI Pitfalls (v0.2)

### AI-1: Embedding model dimension lock-in is permanent

- **Severity:** catastrophic
- **Phase:** v0.2 (the moment Vectorize is provisioned)
- **What goes wrong:** Vectorize indexes are immutable in dimension and distance metric. Once you create an index at 768 dimensions for `@cf/baai/bge-base-en-v1.5`, you cannot migrate to a 1024-dim or 1536-dim model without creating a new index and re-embedding the entire corpus. CF's pricing rewards smaller dimensions (billed per dimension queried), so picking dimensions is a long-term decision.
- **Warning signs:** Question like "can we upgrade to bge-large?" arises post-launch — the answer is "yes but it's a re-index and re-embed of every memory."
- **Prevention:** v0.2 phase plan must include an embedding-model selection memo with explicit dimension lock acknowledgment. Default recommendation: `@cf/baai/bge-base-en-v1.5` (768d) — middle of the cost/quality curve. Store `embedding_model` + `embedding_version` columns on `blocks` from day 1 so future re-embedding migrations can run incrementally.
- **Detection:** Schema review — `blocks` table must record which model embedded each row.

### AI-2: Rate limits are per-task-type, not per-account, and unevenly distributed

- **Severity:** serious
- **Phase:** v0.2 (when ingest goes live)
- **What goes wrong:** Workers AI default limits vary wildly: text generation 300 req/min, embeddings 3000 req/min, summarization 1500 req/min. A burst of memory captures that triggers all three (extract entity → summarize → embed) will hit the summarization or generation ceiling first. There is no documented queueing — over-limit returns errors immediately.
- **Warning signs:** HTTP 429s from `env.AI.run()` calls. Triage jobs failing in clusters.
- **Prevention:** (1) Always run Workers AI from a Queue consumer with bounded concurrency (set `max_concurrency` low — 5–10 to start). (2) Pipeline order matters: do embeddings (high quota) eagerly, but defer summarization (lower quota) to Phase 2/3 enrichment. (3) Wrap every `env.AI.run()` in retry-with-backoff. (4) Track per-task QPM in metrics so you see ceiling approach.
- **Detection:** Dashboard panel: `ai_requests_by_task_per_minute` with rate-limit threshold lines.

### AI-3: Model version drift breaks summary quality silently

- **Severity:** annoying → serious for trust
- **Phase:** v0.2
- **What goes wrong:** Cloudflare updates the model behind a name like `@cf/meta/llama-3.1-8b-instruct` over time. Summary tone, length, and faithfulness drift. Memorability scores recalibrate. Old vs new memories become inconsistent in style — making conflict detection noisier.
- **Warning signs:** User reports "the summaries look different than they used to." Memorability score distribution shifts month-over-month.
- **Prevention:** (1) Pin to versioned model names where available; otherwise log the model name + a content hash so you can detect drift retrospectively. (2) Store the summary's source model in the block row. (3) Snapshot 50 representative inputs + their summaries monthly and diff for regressions.
- **Detection:** Monthly "model drift snapshot" — automated job, manual review.

### AI-4: No documented backpressure or queueing at quota

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** Hitting the rate limit returns an error immediately. There is no graceful queue. A retry storm against Workers AI burns Queue retry budget (max 100 retries default) and can DLQ otherwise-valid messages.
- **Warning signs:** Queue DLQ filling with messages whose only failure was a 429.
- **Prevention:** Distinguish 429 from genuine failures in your consumer. On 429, call `message.retry({ delaySeconds: 30 })` instead of throwing. Throwing counts toward `max_retries`; explicit retry with delay does not consume the same way.
- **Detection:** DLQ inspection: tag messages with last error class. Alert if 429-related DLQ entries exceed 1% of throughput.

### AI-5: Cold start on rarely-used models adds latency

- **Severity:** annoying
- **Phase:** v0.2
- **What goes wrong:** First request to a less-popular model takes seconds to spin up. The "Phase 1 immediate <500ms" SLA breaks if Phase 1 touches an AI call.
- **Warning signs:** P99 of `remember()` spikes when traffic dips below baseline.
- **Prevention:** Phase 1 (the immediate return) should NOT call Workers AI synchronously. Use a cheap heuristic (length, keywords, regex type-hint) for Phase 1 and let the Queue-consumed Phase 2 do real AI work. Reserve AI in Phase 1 only for `remember()` when no Phase 2 is possible (single-shot capture without a queue path).
- **Detection:** SLO dashboard — Phase 1 P99 latency.

---

## 3. Vectorize Pitfalls (v0.2)

### VEC-1: Dimensions, distance metric, and index name are all immutable

- **Severity:** catastrophic
- **Phase:** v0.2
- **What goes wrong:** You cannot change the dimensions, distance metric (cosine/euclidean/dot-product), or rename an index after creation. Picking wrong = create new index + re-upsert everything + dual-write during cutover.
- **Warning signs:** A pre-launch debate "should we use euclidean or cosine?" without explicit lock-in.
- **Prevention:** v0.2 phase plan must include explicit ADR: dimensions, metric, name conventions. Recommended: `cosine` for text embeddings (matches `bge` model training). Naming: `engram-{env}-memories-v1` so future migrations can run as `v2` in parallel.
- **Detection:** Architecture review checklist item before v0.2 deploys.

### VEC-2: 10M vector cap per index — workspace fan-out plan needed

- **Severity:** serious at scale
- **Phase:** v0.2 (architectural), v1.0 (when scale arrives)
- **What goes wrong:** A single Vectorize index caps at 10M vectors. If chunked memories run 5 vectors per memory, that's 2M memories total — easily exceeded by a heavy team or a multi-tenant managed offering.
- **Warning signs:** Upsert errors mentioning "limit exceeded" or vector count approaching 10M.
- **Prevention:** Index-per-workspace OR index-per-shard from day 1. Namespaces inside one index (up to 50,000 on paid) can isolate workspaces under the same index, but each workspace's vectors still count toward the 10M cap. Recommended: one Vectorize index per WorkspaceDO, named with workspace_id; use index-pool of N=10–100 indexes for the managed offering with consistent hashing.
- **Detection:** Per-workspace and per-index vector count metric.

### VEC-3: Metadata indexes capped at 10 per index, 64 bytes per indexed field

- **Severity:** serious for query flexibility
- **Phase:** v0.2 (when filter design happens)
- **What goes wrong:** You can have at most 10 metadata indexes, and each indexes only the first 64 bytes of a string. If you want to filter by `project_id`, `type`, `scope`, `source`, `tags`, `author`, `created_at`, `confidence`, `expires_at`, `language` — you're already at 10 with no room. Long strings (URLs, full names) silently truncate to 64 bytes for filter purposes, causing "filter didn't match" mysteries.
- **Warning signs:** Filter returns no results despite vectors that look like they should match; URLs longer than 64 chars filtered incorrectly.
- **Prevention:** Pre-design the 10 metadata indexes during v0.2 planning. Reserve them for low-cardinality, short-string fields (`type`, `project_id`, `scope`, `source`). Use SQLite (in the DO) for high-cardinality or long-string filtering — fetch matching IDs from SQLite first, then filter Vectorize with `vector_id IN (...)`. Hash long values to 64-byte hex if they must be index keys.
- **Detection:** v0.2 schema review — list every planned filter dimension and reject if >10.

### VEC-4: Upserts are eventually consistent — "I just stored it" reads can miss

- **Severity:** serious for UX
- **Phase:** v0.2
- **What goes wrong:** "Typically a few seconds" between upsert and queryability. A user `remember()`s something, then immediately `recall()`s it — and gets nothing back. Looks like a bug.
- **Warning signs:** E2E test that captures then immediately searches and fails intermittently.
- **Prevention:** (1) Hybrid read path: `recall()` reads SQLite first (strongly consistent in the DO) for recent memories, falls back to Vectorize for semantic. (2) After `remember()` returns, the response includes the new memory id explicitly so Claude can echo it back even before Vectorize has caught up. (3) UX-level: never claim a memory is "searchable" until it's confirmed in both places — for v0.1, store the embedding in SQLite alongside the Vectorize upsert and serve semantic from SQLite for the first 30 seconds (cosine-distance compute on small N is fine).
- **Detection:** Synthetic monitor: `remember` → immediate `recall` round-trip, assert hit.

### VEC-5: Cost is per dimension queried — fat indexes get expensive

- **Severity:** annoying → serious at scale
- **Phase:** v0.2 architecturally; v1.0 financially
- **What goes wrong:** Billing = `(vectors_in_index + queries_in_period) * dimensions`. A single `recall()` against a 100K-vector, 1536-dim index = 153.6M queried dimensions. Multiply by users and queries-per-day, the bill scales sharply. Query expansion (3-4 semantic variants) multiplies this.
- **Warning signs:** Vectorize line item dominating monthly Cloudflare bill.
- **Prevention:** (1) Choose smaller embedding dimensions where quality permits (768 over 1536 unless validated otherwise). (2) Cap query expansion at 3 variants and only when initial query returns <5 results. (3) Index-per-workspace makes each query small. (4) Cache identical query→result for 30s in DO memory. (5) Track `queried_dimensions_per_workspace_per_day` from day 1 so you can attribute cost to users.
- **Detection:** Dashboard with $/workspace/day metric.

### VEC-6: `topK` cap of 50 with metadata, 100 without

- **Severity:** annoying
- **Phase:** v0.2
- **What goes wrong:** "Return all matches" patterns break. If you want to reflect across 200 memories, you need pagination or to drop metadata from the query (limiting to 100).
- **Warning signs:** `reflect()` quality dropping for topics with many memories.
- **Prevention:** Document the topK cap. For `reflect()` (v0.3), iterate: first query (topK=50), use the last result's score as a threshold, then sub-query with a refined query. OR fetch vector IDs (topK=100, no metadata) then hydrate full records from DO SQLite.
- **Detection:** N/A — design-time constraint.

### VEC-7: Empty-index queries return empty, not errors

- **Severity:** annoying
- **Phase:** v0.2
- **What goes wrong:** Querying a brand-new workspace index returns `{ matches: [] }` with no signal "this index has 0 vectors". UX may show "no results found" when the truth is "you haven't stored anything yet."
- **Warning signs:** New-user onboarding shows "no memories found" before they've stored any.
- **Prevention:** `WorkspaceDO` tracks `block_count` in a small `_meta` table. The MCP response envelope's `meta.coverage` field uses this to distinguish "0 results from a populated workspace" (coverage=high, just no match) vs "0 results from empty workspace" (coverage=0, need to capture first). This is also where `meta.gaps` shines.
- **Detection:** UX review — handle the empty-workspace state explicitly.

---

## 4. MCP Server Pitfalls (v0.1, v1.0)

### MCP-1: 25K token cap per tool response

- **Severity:** catastrophic for UX if hit
- **Phase:** v0.1
- **What goes wrong:** Claude Desktop / Claude Code enforce a 25K-token maximum for any single MCP tool response. Exceed it and the response is dropped with an error telling the user to "paginate or filter." Returning raw memory lists with even modest summaries will hit this if N is large.
- **Warning signs:** "Response exceeds maximum token limit" errors in Claude UI; tools returning successfully in tests but failing in Claude.
- **Prevention:** Every MCP response builder MUST measure its output length and truncate before returning. Conservative target: 8K tokens per response. The `EngramResponse.context.related[]` field is the dangerous one — cap at 5-10 items, each with summary only. Add a `meta.truncated: boolean` flag so Claude knows there's more. Pagination via `cursor` field.
- **Detection:** Unit test on every MCP tool: stuff response with worst-case data and assert serialized size <8K tokens (use a tokenizer).

### MCP-2: Tool descriptions truncate at 2KB

- **Severity:** serious for tool selection
- **Phase:** v0.1
- **What goes wrong:** Claude Code truncates tool descriptions at 2KB. A verbose description with full schema docs and examples gets cut mid-sentence; Claude's tool-selection prompt sees garbage at the end.
- **Warning signs:** Claude picks the wrong Engram tool for a query (`search` when `recall` would have been better). Description text in Claude Inspector shows truncation.
- **Prevention:** Keep tool description under 1.5KB. Put detail in `inputSchema.properties[].description` (per-parameter docs, less truncation pressure). Use a CI check that fails if any tool description exceeds 1500 bytes.
- **Detection:** Lint rule on tool definitions: byte-length assertions.

### MCP-3: Structured errors are misinterpreted by LLMs as data

- **Severity:** serious
- **Phase:** v0.1
- **What goes wrong:** If `remember()` returns `{ error: "workspace_full", message: "..." }` with HTTP 200, Claude reads it as a successful result with weird fields and may continue as if the memory was stored. MCP's JSON-RPC error path (`code: -32602`, etc.) gets surfaced differently — and recent SDK versions changed this behavior (unknown tools now return JSON-RPC errors instead of `{ isError: true }` in CallToolResult).
- **Warning signs:** User reports "I stored that and it said OK" but recall returns nothing.
- **Prevention:** Use MCP's standard error contracts: throw `McpError` with proper JSON-RPC codes. Don't invent ad-hoc error envelopes. For partial failures (e.g. memory stored but embedding deferred), use `meta.warnings[]` in the success envelope, not error fields. Standardize on a small enum of error codes (`workspace_full`, `rate_limited`, `validation_failed`, `unauthorized`) and document each.
- **Detection:** Integration test against Claude Desktop — verify that error cases surface as user-visible errors, not silent successes.

### MCP-4: Schema validation failures present as silent dropouts

- **Severity:** serious
- **Phase:** v0.1
- **What goes wrong:** If Claude generates a tool call with the wrong arg shape, MCP servers using strict zod schemas reject it, and Claude often interprets the rejection as "tool failed" without surfacing why. User sees nothing happen.
- **Warning signs:** Calls "succeed" from Claude's view but no DO state changes; server logs show validation errors but Claude has moved on.
- **Prevention:** (1) Use lenient input schemas with explicit `additionalProperties: true` where safe. (2) Return validation errors as well-formatted JSON-RPC error responses with the exact field name and expected type in the message. (3) Log all validation failures to a queryable store so you can find them in user feedback.
- **Detection:** Server-side metric `mcp_validation_failure_count_by_tool_by_field`.

### MCP-5: SDK version churn — protocol still evolving

- **Severity:** annoying → serious
- **Phase:** v0.1 ongoing
- **What goes wrong:** `@modelcontextprotocol/sdk` ships breaking changes regularly. Recent example: unknown tool calls now return `-32602 InvalidParams` JSON-RPC errors instead of `CallToolResult{ isError: true }`. Task config options moved between option objects. Schema export utilities renamed.
- **Warning signs:** Dependabot PR fails CI on minor version bump; type errors after `npm update`.
- **Prevention:** Pin exact SDK versions, not ranges. Read CHANGELOG before every bump. Have an integration test suite against a real MCP client (Claude Desktop in CI is hard, but the inspector CLI works). Subscribe to the MCP spec issues for the `1309` (version management) thread.
- **Detection:** Dependabot + manual review.

### MCP-6: Other MCP clients implement details differently

- **Severity:** annoying for v0.1, serious for v1.0
- **Phase:** v0.1 acknowledge; v1.0 actively test
- **What goes wrong:** Perplexity, Cursor, Antigravity, ChatGPT MCP all implement the spec with quirks. Some don't honor `inputSchema` strict mode. Some don't render `_meta` fields. Some have different tool-description budgets. Configuration locations differ (`mcpServers` vs `mcp.servers`). A tool that works perfectly in Claude Desktop may behave unpredictably elsewhere.
- **Warning signs:** Beta tester reports tool doesn't appear or returns garbled responses in non-Claude client.
- **Prevention:** v1.0 launch checklist: smoke test in Claude Desktop, Claude Code, Cursor, and ChatGPT-with-MCP minimum. Document known per-client quirks in the README. Don't rely on optional MCP fields (resources, prompts) for core functionality in v0.1.
- **Detection:** v1.0-gated cross-client test matrix.

### MCP-7: "Pre-fetched context" makes responses huge

- **Severity:** serious
- **Phase:** v0.1
- **What goes wrong:** The `EngramResponse` envelope philosophy is "return synthesis + adjacent context." But `context.related[]` + `context.entities[]` + `context.timeline[]` can balloon to thousands of tokens easily. Pair with `suggestions.queries[]` and you've blown the 25K cap on a single `recall()`.
- **Warning signs:** Response sizes climbing as feature set grows.
- **Prevention:** Per-section caps: `result` ≤ 5K tokens, each `context.*` ≤ 1K tokens, total response ≤ 8K. Each item in `related[]` is a compact `{ id, summary, score }` triple — full details require a follow-up `search` by id. The envelope philosophy is "synthesis first, optional context second" — not "dump everything."
- **Detection:** Per-section length asserts in unit tests.

---

## 5. Multi-Tenant Memory Pitfalls (v0.3)

### MT-1: Workspace ID poisoning via JWT trust

- **Severity:** catastrophic (security)
- **Phase:** v0.1 (auth pattern established), v0.3 (multi-workspace bites)
- **What goes wrong:** The CLAUDE.md auth pattern says "DO trusts workspace_id from Worker." If a Worker bug allows a JWT for workspace A to be served against workspace B's DO ID, every memory in B is exposed. The DO has no second check.
- **Warning signs:** Auth bug in Worker; mismatched JWT/DO-id pair in logs.
- **Prevention:** Defense in depth — DO ALSO verifies that the workspace_id passed by the Worker matches the DO's own `state.id.name` (since DOs are named by workspace_id, this check is trivial). Adds 1 SQL query per request worth of safety. Document this as required in every DO method.
- **Detection:** Penetration test: craft request with workspace_a JWT but workspace_b DO id, verify rejection.

### MT-2: Vectorize cross-tenant leakage via shared index

- **Severity:** catastrophic (security)
- **Phase:** v0.3 (when teams arrive)
- **What goes wrong:** If multiple workspaces share a Vectorize index (for cost), a missing or mistyped metadata filter on `workspace_id` returns vectors from other tenants. Cosine-similar memories from your neighbor's workspace pollute your `recall()`.
- **Warning signs:** Test where workspace A queries and gets a vector ID that doesn't exist in workspace A's DO.
- **Prevention:** Index-per-workspace from v0.3 onward (Cloudflare allows 50K indexes per paid account). Cost trade-off is real but security trade-off wins. If shared indexes are unavoidable for cost, build a result-filtering layer in the MCP server that drops any vector whose returned `workspace_id` metadata doesn't match the caller's — never trust the filter to be applied correctly upstream.
- **Detection:** Integration test: workspace A vs B with deliberately cosine-similar content; assert zero crossover.

### MT-3: Shared "team memory" trust model — poisoning teammates

- **Severity:** serious
- **Phase:** v0.3, v0.4 (when Devon onboards as second user)
- **What goes wrong:** Anyone in a TeamDO with editor role can `remember()` something that becomes "team truth." Malicious or careless teammates can poison the team's memory ("our customer's name is X" — wrong). RAG poisoning research shows even small adversarial inputs heavily skew retrieval.
- **Warning signs:** Devon recalls something they "know is wrong" — but it's been in team memory for weeks.
- **Prevention:** (1) Track `created_by` on every block. (2) Conflict detection (v0.2+) must surface "this contradicts an earlier team consensus." (3) Audit log: every write visible to all team members in the Inbox/UI. (4) For v1.0: role distinction — "submitter" (proposes to team memory, requires approval) vs "editor" (writes directly). (5) For the killer demo, scope memory writes to personal first, promote to team explicitly.
- **Detection:** Conflict-detection precision metric; audit log review.

### MT-4: Identity resolution across data sources is wrong by default

- **Severity:** serious
- **Phase:** v0.4 (when Slack/Drive connectors land)
- **What goes wrong:** "Russell Moore" in Slack, "russellkmoore@mac.com" in Drive, "russell" in MCP — three different entity records. Or worse: two people named "John" merged into one. Bad merges are hard to detect because the data still looks coherent.
- **Warning signs:** `entities[]` returns duplicates or wrong-merged records; Russell asks about "John" and gets info about two different Johns.
- **Prevention:** Identity resolution is a Phase 3 (slow async) job, never Phase 1. Track `entity_id` + `source_identifiers[]` (each: source, raw_value, confidence) on entity records. Never merge below confidence 0.95. Surface "possible duplicates" to user for confirmation. Provide a `relate(id_a, id_b, "same_as")` MCP tool for explicit merge.
- **Detection:** Manual review of merged entities monthly.

### MT-5: GDPR deletion / right-to-be-forgotten cascade

- **Severity:** serious (compliance)
- **Phase:** v0.3, v1.0 (managed offering)
- **What goes wrong:** User asks to delete their data. Workspace SQLite is easy. Vectorize vectors — must enumerate by metadata filter and delete. R2 exports — must enumerate by user. KV session caches — separate sweep. Miss one and you're still holding "deleted" data.
- **Warning signs:** Post-deletion `recall()` returns vectors from a deleted workspace.
- **Prevention:** Write a `purgeWorkspace(workspace_id)` function in v0.3 (even before it has a UI). It must: (1) `storage.deleteAll()` on the DO, (2) delete all Vectorize vectors with `workspace_id == X`, (3) delete R2 export objects by prefix, (4) delete KV session entries. Test it with a real workspace before v1.0 launch. Document the function as a required step for closing an account.
- **Detection:** Integration test that deletes a workspace and verifies zero data remains in any store.

---

## 6. Ingest Pipeline Pitfalls (v0.2)

### IP-1: Queue at-least-once delivery → duplicate memories

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** Cloudflare Queues are at-least-once. Same `MemoryEvent` may arrive at the triage worker 2+ times. Without idempotency, you get duplicate blocks, duplicate embeddings (= wasted AI cost), duplicate Vectorize vectors. Conflict detection then "detects" these as conflicts with themselves.
- **Warning signs:** Block table has identical content twice; Vectorize index size growing faster than memory creation rate.
- **Prevention:** `MemoryEvent.id` is the idempotency key. On consume: `INSERT OR IGNORE INTO blocks (id, ...)` — if id already present, ack and exit. Also: track `processed_event_ids` in a small table (with TTL) for fast dedup before doing AI work. Cost of dedup check (1 SQL lookup) << cost of duplicate AI processing.
- **Detection:** Unit test: deliver same MemoryEvent twice, assert one block.

### IP-2: Use `message.ack()` per message, not batch-throw on partial failure

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** A batch of 10 MemoryEvents — message 7 fails. Throwing from the consumer redelivers ALL 10. Messages 1-6 are reprocessed (= duplicate memories per IP-1). Messages 8-10 retry too.
- **Warning signs:** Single-event failures causing widespread reprocessing; queue depth spikes after one bad event.
- **Prevention:** Call `message.ack()` after each successful event in the batch. Call `message.retry({ delaySeconds })` for the specific failures. Never throw from the consumer handler unless you genuinely want the entire batch redelivered. Distinguish "transient" (retry with delay) vs "poison" (ack + send to a dead-letter table for human review).
- **Detection:** Metric `queue_messages_redelivered_per_event_count` — should average ≤1.05.

### IP-3: Chunking that splits semantic boundaries silently

- **Severity:** annoying → serious for recall quality
- **Phase:** v0.2
- **What goes wrong:** Naive 512-token chunking splits a job posting in the middle of the responsibilities list. Recall on "what does this role require" returns the chunk WITHOUT responsibilities. User gets wrong answer with full confidence.
- **Warning signs:** `recall()` returns relevant memory but the chunk shown is the boring middle part.
- **Prevention:** (1) Use semantic-aware chunkers (paragraph breaks, list-item boundaries, code blocks). (2) 50-token overlap as the CLAUDE.md design specifies — but verify overlap actually preserves entity context. (3) Store the full original content in `blocks.content` and embed chunks separately; on retrieval, return parent content along with the matched chunk. (4) Test chunking on representative docs (job posting, meeting notes, technical doc, Slack thread).
- **Detection:** Test fixture of 10 representative documents → chunked output → assert key entities appear in every chunk that mentions them.

### IP-4: Summarization that hallucinates (extracts facts not in source)

- **Severity:** serious for trust
- **Phase:** v0.2
- **What goes wrong:** LLMs make up details when summarizing. "John Smith at Acme" becomes "John Smith, CTO at Acme" because the model assumed. Stored as memory, this becomes "team truth."
- **Warning signs:** Summaries contain titles, dates, numbers not in the source. User reports "I never said that."
- **Prevention:** (1) Use extractive summarization for fact-bearing fields (regex/NER for emails, names, dates). (2) Generative summarization for prose only, with explicit "summarize without adding new facts" prompt. (3) Store the raw `content` alongside `summary` — `recall()` returns summary, but `reflect()` and conflict detection use raw. (4) Confidence scoring: if the summary contains an entity not present in raw content (string match), drop the summary and use raw.
- **Detection:** Spot-check 50 summaries monthly; entity-extraction-vs-source diff job.

### IP-5: Memorability threshold drift over model versions

- **Severity:** annoying → serious
- **Phase:** v0.2
- **What goes wrong:** v0.2 sets 0.8 threshold for auto-store based on one model's scoring distribution. Model updates → distribution shifts. Suddenly everything scores 0.6 (all in inbox) or 0.9 (inbox empty, noise stored).
- **Warning signs:** Inbox fill rate changes dramatically without traffic change.
- **Prevention:** (1) Store `memorability_score` AND `memorability_model_version` on every block. (2) Threshold is a per-workspace config, not a global constant. (3) Monthly: recompute distribution and adjust threshold. (4) Default thresholds: start aggressive (0.85 auto-store, 0.5 inbox) and relax based on user feedback.
- **Detection:** Dashboard: weekly histogram of memorability scores; alert on distribution shift.

### IP-6: "Stuck in inbox forever" — no triage UI in v0.1/v0.2

- **Severity:** serious for UX
- **Phase:** v0.2 (inbox exists but no UI until v0.4)
- **What goes wrong:** v0.2 writes low-confidence memories to inbox. There's no UI until v0.4. Users have no way to triage. Inbox grows unboundedly; "should-have-been-stored" memories are invisible to recall.
- **Warning signs:** Inbox row count climbing weeks after launch.
- **Prevention:** Even before the v0.4 UI, expose inbox via MCP: an `inbox()` tool (counts toward 9-tool budget — or fold into `search` with a `scope: "inbox"` filter). Russell can review via Claude. Also: items in inbox >30 days auto-promote or auto-discard based on whether they had a near-match query in that period (= someone tried to recall this, escalate).
- **Detection:** Inbox age histogram dashboard.

### IP-7: Partial-failure visibility — Phase 2/3 fail silently

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** `remember()` returns success on Phase 1 (heuristic store). Phase 2 (embedding + Vectorize upsert) fails. The block exists in SQL but is invisible to `recall()`. User thinks it was stored; it's effectively lost.
- **Warning signs:** `blocks` rows with `embedding_id IS NULL` after 5 minutes; user reports "I stored this, why can't I find it?"
- **Prevention:** (1) Track `ingest_status` on every block (`phase_1_stored`, `phase_2_embedded`, `phase_3_resolved`, `failed`). (2) A scheduled DO alarm reprocesses any block stuck in `phase_1_stored` for >5 minutes. (3) `recall()` warns in `meta.warnings` if results omit pending-ingest blocks. (4) Dead-letter table for blocks that failed N times — visible via inbox or `conflict()` tool.
- **Detection:** Dashboard: blocks-by-ingest-status histogram with alert on stuck-block count >threshold.

---

## 7. Memory Product Pitfalls (v0.2, v0.3, v0.4)

### MP-1: False recalls — confidently returning wrong info

- **Severity:** catastrophic for trust
- **Phase:** v0.2 (semantic search lands)
- **What goes wrong:** Vectorize returns the cosine-nearest result, even if score is low. `recall("when did I apply to Stripe?")` returns a memory about Square because they're semantically close. Claude trusts it. User gets a confidently-wrong answer.
- **Warning signs:** Real user reports "Engram told me the wrong date."
- **Prevention:** (1) Hard threshold: `score < 0.7` → drop result entirely or surface with explicit "low confidence" flag. (2) Two-stage retrieval (recall → rerank with cross-encoder where feasible). (3) `meta.confidence` in the envelope reflects min score of returned matches. (4) For factual queries (dates, numbers, names), require an exact or near-exact match in `blocks.properties` not just embedding similarity. (5) Reflect tool returns explicit "I don't have evidence for this" when coverage is low.
- **Detection:** Manual eval set: 50 queries with known correct answers; track precision@1.

### MP-2: Conflict detection that cries wolf

- **Severity:** serious for UX
- **Phase:** v0.2 (conflict detection lands)
- **What goes wrong:** Naive conflict detection flags "Russell uses TypeScript" vs "Russell uses Python" as a conflict (they're not — both are true at different times/contexts). User gets pestered with false conflicts, learns to ignore them, misses real ones.
- **Warning signs:** User dismisses >50% of surfaced conflicts.
- **Prevention:** (1) Conflict severity classification: only `high` surfaces proactively, `medium` shown on recall, `low` logged only. (2) Time-aware: "X applied to Stripe" + "X works at Stripe" is not a conflict, it's a timeline. (3) Property-level rather than text-level: only flag conflicts when same memory_type + same key fields disagree. (4) Track user dismissal patterns; auto-tune severity by example. (5) Provide `conflict(passive=true)` so users opt in rather than getting pinged.
- **Detection:** Conflict acceptance rate metric (acted on / surfaced).

### MP-3: Memory grows so large it becomes unusable

- **Severity:** serious for long-term users
- **Phase:** v0.3 (post-MVP usage), v1.0 (long-term users)
- **What goes wrong:** Two years of memories = thousands of blocks. `recall()` returns relevant but stale results ("we used to use Postgres") that no longer reflect current reality. User loses trust because "Engram doesn't know what's current."
- **Warning signs:** Recall results consistently include outdated memories ahead of fresh ones.
- **Prevention:** (1) Recency boost in ranking (decay factor on `score` based on `created_at`). (2) Explicit "stale" lifecycle: blocks unused for 6 months get `archived = true`, excluded from default recall, retrievable via explicit query. (3) `expires` field on `remember()` for known-temporary info (interview dates, deadlines). (4) Periodic auto-summarization: collapse 10 related memories from 6 months ago into 1 synthesized summary, archive originals. (5) Conflict resolution that lets newer memory supersede older.
- **Detection:** Per-workspace block count + average block age; UX metric of recall result freshness.

### MP-4: "Everything looks like a nail" — over-storing

- **Severity:** serious (signal-to-noise)
- **Phase:** v0.2 onward
- **What goes wrong:** A `remember()` tool that's too eager captures every utterance. Quick aside ("the weather is nice") becomes a permanent memory. Noise drowns out signal.
- **Warning signs:** Block table growing linearly with conversation length; useful recall harder over time.
- **Prevention:** (1) Memorability threshold (the inbox/discard split). (2) Default behavior: NOT every conversation is remembered. `remember()` is opt-in by the user or Claude's explicit decision. (3) Tool description for `remember()` emphasizes "use sparingly — for facts you'll want to recall later, not for chat." (4) Inbox is the safety net for "maybe."
- **Detection:** Block-per-conversation ratio; user feedback on noise.

### MP-5: Cannot cleanly forget

- **Severity:** serious
- **Phase:** v0.1 (`forget` is in the v0.1 surface)
- **What goes wrong:** `forget(id)` deletes from SQLite but the Vectorize vector lingers (returns stale results). Cascade deletion of related blocks is hard to bound. Forgetting one block may orphan relations.
- **Warning signs:** Forgotten content reappears in recall; relations table has dangling foreign keys.
- **Prevention:** `forget()` is transactional across stores: SQL delete + Vectorize delete + relations cleanup. Must be idempotent (re-runs are safe). For `cascade: true`, traverse relations once, build delete set, delete atomically. Test the round-trip: store → forget → recall returns zero.
- **Detection:** Integration test: store, forget, recall — assert empty.

### MP-6: Memory type version sprawl

- **Severity:** annoying → serious
- **Phase:** v0.3 (schema-as-data lands)
- **What goes wrong:** User creates `job_application_v2` (different fields). Old blocks reference v1. Queries that filter by `type = "job_application"` miss v2 (or vice versa). Community-installed types collide with user-created ones.
- **Warning signs:** Recall filters returning surprising subsets; tool errors "unknown memory type."
- **Prevention:** (1) Memory types have an explicit `name` (stable) + `version` (monotonic). Queries default to `type.name`, not `type.id`. (2) Schema migrations between versions are first-class (define field rename / type change rules). (3) Namespace: `system:job_application` vs `user:russell:job_application` vs `community:bmc:engagement` — prevent collision. (4) Reserve `v0.1` types as `system:*` only; user types come in v0.3 with the namespace already enforced.
- **Detection:** Audit query: blocks whose type doesn't exist in memory_types table.

---

## 8. MCP Ecosystem Pitfalls (v1.0)

### ECO-1: Tool surface that's too verbose for selection

- **Severity:** serious
- **Phase:** v0.1 (limit established)
- **What goes wrong:** CLAUDE.md correctly caps the surface at 9 tools. But each tool's description, examples, and schema also enters Claude's tool-selection prompt every turn. A 9-tool surface where each description is 1.5KB = ~13.5KB just in tool definitions, every turn, in every conversation that has Engram connected.
- **Warning signs:** User reports Claude is "slow to pick the right Engram tool" or "ignores Engram in favor of built-ins."
- **Prevention:** Audit total tool-definition byte budget. Target: full 9-tool surface fits in <8KB total. Use shared `$ref` schemas for repeated types (Memory, Entity). Trim examples — 1 example per tool, not 5.
- **Detection:** CI byte-budget check across all tool definitions.

### ECO-2: Missing standard tools users expect

- **Severity:** annoying
- **Phase:** v1.0
- **What goes wrong:** Users expect `list_*`, `get_*` style tools that MCP-aware AI clients reach for. Engram only exposes verbs. Claude (or Cursor) may try to call `list_memories` and fail.
- **Warning signs:** User reports Claude saying "I don't see a way to list your memories."
- **Prevention:** Either add `list` capability into `search` (filter-less search returns recent N), or accept this as a positioning trade-off and document it in the README. The 9-tool cap matters more than common-pattern matching — but write the cap into the README so users know.
- **Detection:** User feedback.

### ECO-3: MCP spec breaking changes mid-roadmap

- **Severity:** serious
- **Phase:** ongoing
- **What goes wrong:** MCP is young. Spec version management is itself an open issue (SEP-1309). A protocol revision between v0.4 and v1.0 could require changes to the server and break older clients.
- **Warning signs:** New spec version released; SDK majors.
- **Prevention:** (1) Implement spec version negotiation properly (`initialize` handshake). (2) Maintain a compatibility matrix in the README. (3) Subscribe to modelcontextprotocol/modelcontextprotocol issues. (4) Don't over-implement experimental spec features.
- **Detection:** Active monitoring of MCP repo + monthly SDK review.

---

## 9. Open-Source / Thought-Leadership Pitfalls (v1.0)

### OSS-1: Confusing setup story = no adopters

- **Severity:** serious (for thought-leadership goal)
- **Phase:** v1.0
- **What goes wrong:** Self-hosted setup requires CF account, Workers, DOs, Vectorize, AI binding, Queues, R2, KV, JWT keys, deployments. Even a Cloudflare expert needs an hour. New user gives up at step 3.
- **Warning signs:** GitHub issues about setup; low fork-to-clone ratio.
- **Prevention:** Single `wrangler.toml` at the repo root that binds everything. A `setup.sh` script that uses `wrangler` to create namespaces / indexes / queues on the user's account. A "Deploy to Cloudflare" button. README in three tiers: "5-minute quick start," "real deployment," "production." Recorded demo video on the README.
- **Detection:** Time-to-first-successful-remember metric from a clean clone.

### OSS-2: Killer demo doesn't reproduce for others

- **Severity:** catastrophic (for portfolio goal)
- **Phase:** v0.4 (the demo lands), v1.0 (the launch)
- **What goes wrong:** The v0.4 Slack-+-Claude-same-answer demo works on Russell's Cloudflare account but requires custom Slack app, OAuth setup, Drive credentials, Engram secrets. Reviewers can't reproduce, so the story rings hollow.
- **Warning signs:** Demo video uploaded but no community follow-up reproductions.
- **Prevention:** Two versions of the demo. (1) Public, no-setup hosted instance with seeded sample data — link from the README. (2) DIY for the brave with full setup docs. The hosted version is the killer demo; the DIY is the proof.
- **Detection:** Hosted demo uptime + traffic.

### OSS-3: License choice locks future business model

- **Severity:** serious
- **Phase:** v1.0
- **What goes wrong:** Pick MIT → competitors can fork and offer competing managed service with no obligation. Pick AGPL → AGPL is a non-starter for many enterprise users; adoption slows. Pick Apache → like MIT but with patent grant (slightly safer). Each is permanent for the published version.
- **Warning signs:** Decision made hastily before v1.0 launch.
- **Prevention:** For open-core with planned managed offering: **Apache 2.0** for the core (matches CF's own ecosystem positioning, patent grant protects you, broad enterprise adoption) PLUS clear CLA (contributor license agreement) so you retain re-licensing rights for future dual licensing. AGPL is a tempting "moat" but the literature shows enterprise rejection is severe. Document the choice + rationale in the repo before launch.
- **Detection:** N/A — design-time decision.

### OSS-4: Security holes in self-hosted mode

- **Severity:** catastrophic for trust
- **Phase:** v1.0
- **What goes wrong:** Default JWT secret in `wrangler.toml`. README's example uses `JWT_SECRET=changeme`. Some users deploy without changing it. Their workspace is reachable by anyone who knows the URL pattern.
- **Warning signs:** Reports of unauthorized access; secret-scanning bots flagging the repo.
- **Prevention:** (1) Setup script generates random JWT secret on first deploy. (2) Worker refuses to start if `JWT_SECRET` is unset or matches a known-default list. (3) Security checklist in README before going public. (4) Encourage Cloudflare Access in front of the MCP endpoint.
- **Detection:** Periodic scan of public GitHub forks for default secrets.

### OSS-5: Positioning collision with Anthropic / Notion / Mem

- **Severity:** annoying → serious
- **Phase:** v1.0 launch
- **What goes wrong:** Anthropic ships cross-chat memory; Engram's pitch sounds like "Anthropic's thing but worse." Or Notion ships an MCP server; "isn't this just Notion?" Or Mem.ai pivots to AI memory and grabs the SEO term first.
- **Warning signs:** Launch post comments dominated by "isn't this just X?"
- **Prevention:** Lead with the layered-memory + same-answer-across-clients story. That's the unique angle no competitor will replicate: Anthropic won't build team/org memory; Notion won't pre-process for AI tokens; Mem won't be open-source. Repeat this positioning in every doc, video, and post. Don't let the launch story drift to "second brain" generic.
- **Detection:** Pre-launch positioning review by Devon or another outside reader.

---

## 10. Cost Pitfalls (v0.2 onward)

### COST-1: Runaway DO requests from chatty Workers

- **Severity:** serious
- **Phase:** v0.2 (when ingest hits volume)
- **What goes wrong:** A bug in the triage worker loops a Workspace DO via `fetch()` thousands of times for one MemoryEvent. Each call is a billable DO request. Bill spikes overnight.
- **Warning signs:** DO request graph shows orders-of-magnitude spike disconnected from user activity.
- **Prevention:** (1) Configure Worker `cpu_ms` limits in wrangler.toml to cap per-invocation cost. (2) DO method-level rate limiting (max N calls per workspace per minute) — built into the DO itself, not just Worker layer. (3) Per-workspace daily request budget alerts in Cloudflare dashboard.
- **Detection:** Cloudflare billing alerts at 1.5x baseline.

### COST-2: Vectorize query cost surprise from query expansion

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** "Expand query to 3-4 variants" sounds harmless until you do the math: 4 variants × 768 dimensions × number of vectors in index × queries per day. A 100K-vector workspace querying 100 times/day = 100k × 768 × 4 × 100 = 30B queried dimensions/day per workspace.
- **Warning signs:** Vectorize cost line item growing faster than user base.
- **Prevention:** (1) Cap expansion at 3 variants AND only when initial query has <5 results. (2) Cache identical query → vector mappings for 60 seconds. (3) Dimensions choice matters: 768 over 1536 cuts cost in half. (4) Per-workspace `queried_dimensions_per_day` metric attributed for chargeback (= managed-offering pricing input).
- **Detection:** Cost-per-workspace dashboard.

### COST-3: Workers AI retry loops burn budget

- **Severity:** serious
- **Phase:** v0.2
- **What goes wrong:** A poison message that always fails AI extraction retries 100 times (Queue default). Each retry calls Workers AI. Each AI call costs Neurons. 100 retries × 100 messages = 10,000 wasted AI calls.
- **Warning signs:** Neuron spend disproportionate to memory creation rate.
- **Prevention:** Configure consumer with `max_retries: 3` (override default 100). After 3 fails, send to DLQ for manual review. Track AI Neuron consumption per memory_event in metrics — if any single event exceeds 5x median, investigate.
- **Detection:** Neurons-per-memory ratio alert.

### COST-4: R2 export bandwidth on large exports

- **Severity:** annoying
- **Phase:** v0.3 (export tool lands)
- **What goes wrong:** R2 egress is free to Cloudflare, but if exports go to external storage or are downloaded heavily, that's bandwidth. A user exporting their entire history as XLSX = multi-MB file × multiple downloads.
- **Warning signs:** R2 egress line item growing.
- **Prevention:** Signed URLs with short TTL (1 hour). Aggregate exports rather than per-record (one XLSX, not one file per memory). Rate-limit export tool calls.
- **Detection:** R2 dashboard.

### COST-5: KV write amplification from session tracking

- **Severity:** annoying
- **Phase:** v0.1 (if KV is used for sessions)
- **What goes wrong:** KV is cheap to read, expensive to write (compared to its read cost). If session state is written on every MCP tool call, writes scale linearly with traffic. KV operations have a daily write quota on free tier.
- **Warning signs:** KV write count climbing fast; quota warnings.
- **Prevention:** KV only for slowly-changing config (workspace metadata, AI model selection per workspace). Session/auth state in DO storage or short-lived JWT-only (no server-side write). Per-tool-call writes go to DO SQLite, not KV.
- **Detection:** KV write counter — should grow much slower than DO request counter.

---

## Phase-Specific Warning Summary

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| v0.1 — DO + SQLite | DO-1 (SQLite class election) | Wrangler `new_sqlite_classes` from day 1 |
| v0.1 — Schema migrations | DO-2 (no `PRAGMA user_version`) | Use `durable-utils` migration class |
| v0.1 — MCP tool surface | MCP-1, MCP-2, MCP-7 (size limits) | Byte-budget tests on every tool |
| v0.1 — Auth | MT-1 (DO workspace_id trust) | Defense-in-depth: DO re-verifies |
| v0.1 — `forget` tool | MP-5 (cannot cleanly forget) | Transactional delete across stores (when Vectorize lands) |
| v0.2 — Vectorize index creation | VEC-1, VEC-2, VEC-3 | ADR with explicit dimensions + metadata index plan |
| v0.2 — Embedding model | AI-1 (dimension lock-in) | Record model+version on every block |
| v0.2 — Workers AI usage | AI-2, AI-4 (rate limits) | Queue-based, bounded concurrency, 429-aware retry |
| v0.2 — Queue consumer | IP-1, IP-2 (idempotency) | `INSERT OR IGNORE`, per-message ack |
| v0.2 — Phase 2 ingest | IP-7 (silent failures) | `ingest_status` column, stuck-block reprocessor |
| v0.2 — Conflict + recall | MP-1, MP-2 (false recall, false conflicts) | Score thresholds, severity classes, eval set |
| v0.3 — Multi-workspace | MT-2 (Vectorize cross-tenant) | Index-per-workspace |
| v0.3 — Team memory | MT-3, MT-4 (poisoning, identity) | Audit log, conflict surfacing, explicit merges |
| v0.3 — Workspace deletion | MT-5 (GDPR cascade) | `purgeWorkspace()` function from v0.3 |
| v0.3 — Memory types | MP-6 (version sprawl) | Namespaced names + monotonic versions |
| v0.4 — Connectors | IP-3, IP-4 (chunking, hallucination) | Semantic chunking, extractive for facts |
| v0.4 — Killer demo | OSS-2 (reproducibility) | Hosted public demo + DIY docs |
| v1.0 — License + launch | OSS-3, OSS-4 (license, default secrets) | Apache 2.0 + CLA, setup script |
| v1.0 — Other MCP clients | MCP-6, ECO-2 (client quirks) | Cross-client test matrix |

---

## v0.1 MUST-MITIGATE LIST (Ruthless 8)

The eight things v0.1 absolutely cannot ship without addressing. Anything else is deferrable; these are foundation-class.

1. **DO-1: SQLite class election** — Wrangler `[[migrations]]` MUST use `new_sqlite_classes` for `WorkspaceDO`, `UserDO`, `ProjectDO`. Lint rule on wrangler.toml in CI. Catastrophic, irreversible if missed at first deploy.

2. **DO-2: Schema migration without `PRAGMA user_version`** — Use `durable-utils` `SQLSchemaMigrations` or hand-roll a `_schema_migrations` table. Hibernation-replay safety must be tested.

3. **DO-3: No `blockConcurrencyWhile()` across I/O** — Lint rule + code review. This single mistake collapses throughput 5x and is easy to introduce.

4. **MT-1: DO workspace_id defense-in-depth** — DO verifies that the workspace_id passed by the Worker matches its own `state.id.name`. Authentication can never be trusted only at the edge.

5. **MCP-1 + MCP-7: Response size budgets** — Every MCP tool has a unit test that asserts serialized response stays under 8K tokens with worst-case data. The `EngramResponse.context` fields are the biggest risk.

6. **MCP-3 + MCP-4: Error response shape** — Use `McpError` with JSON-RPC error codes. Validation failures return structured errors that Claude actually surfaces. Integration test in Claude Desktop verifies user-visible failure on bad input.

7. **MP-5: `forget` is transactional and complete** — Even before Vectorize lands in v0.2, the `forget` contract must be airtight. Once Vectorize is added in v0.2, extend `forget` to delete vectors too — but the v0.1 contract must already promise "after `forget`, the data is gone everywhere."

8. **AI-1 preparation: `embedding_model` + `embedding_version` columns** — Add these columns to `blocks` in v0.1 even though embeddings don't land until v0.2. Once the schema exists, future re-embedding migrations are a SQL `UPDATE WHERE`. Without it, dimension lock-in is permanent.

Notably **NOT** on this list (defer to v0.2+):

- VEC-1 (Vectorize dimension choice) — Vectorize itself is v0.2
- AI-2 (rate limits) — Workers AI integration is v0.2
- IP-1 (Queue idempotency) — Queues land in v0.2
- MT-2 (Vectorize cross-tenant) — multi-tenant is v0.3
- OSS-3 (license) — public OSS is v1.0

---

## Sources

### Cloudflare official docs (HIGH confidence)

- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Durable Objects FAQs](https://developers.cloudflare.com/durable-objects/reference/faq/)
- [Access Durable Objects Storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Durable Objects Troubleshooting](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)
- [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers AI Limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- [Vectorize Limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Vectorize Metadata Filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)
- [Building Vectorize blog post](https://blog.cloudflare.com/building-vectorize-a-distributed-vector-database-on-cloudflare-developer-platform/)
- [Queues Delivery Guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Queues Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Queues Consumer Concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)

### MCP ecosystem (MEDIUM confidence — spec churning)

- [Model Context Protocol Docs](https://modelcontextprotocol.io/docs/develop/build-server)
- [TypeScript SDK Releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- [MCP Token Overhead — MindStudio](https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead)
- [Claude Code MCP Optimization — Scott Spence](https://scottspence.com/posts/optimising-mcp-server-context-usage-in-claude-code)
- [MCP Limitations — Medium](https://medium.com/@ckekula/model-context-protocol-mcp-and-its-limitations-4d3c2561b206)
- [Tool Calling Without Composition — Hackteam](https://hackteam.io/blog/tool-calling-is-broken-without-mcp-server-composition/)
- [Cross-Client MCP Comparison](https://dev.to/darkmavis1980/understanding-mcp-servers-across-different-platforms-claude-desktop-vs-vs-code-vs-cursor-4opk)

### RAG / memory research (HIGH confidence — academic)

- [RAG Recall Problem — buduroiu.com](https://buduroiu.com/blog/rag-llm-recall-problem/)
- [Towards Robust RAG Under Adversarial Poisoning](https://arxiv.org/pdf/2412.16708)
- [Benchmarking Poisoning Attacks against RAG](https://arxiv.org/pdf/2505.18543)
- [Semantic Illusion: Embedding Hallucination Limits](https://arxiv.org/pdf/2512.15068)

### Embedding model upgrade strategies (HIGH confidence)

- [Different Embedding Models, Different Spaces — Gary Stafford](https://medium.com/data-science-collective/different-embedding-models-different-spaces-the-hidden-cost-of-model-upgrades-899db24ad233)
- [Drift-Adapter Paper](https://arxiv.org/pdf/2509.23471)
- [Embedding Portability and Versioning — Mixpeek](https://mixpeek.com/guides/embedding-portability-versioning)

### Open source licensing (MEDIUM confidence)

- [AGPL is a non-starter — Open Core Ventures](https://www.opencoreventures.com/blog/agpl-license-is-a-non-starter-for-most-companies)
- [OSS Licensing Comparison 2026 — OSSAlt](https://ossalt.com/guides/oss-licensing-guide-mit-apache-agpl-2026)
- [AGPL or MIT decision guide — Monetizely](https://www.getmonetizely.com/articles/should-you-license-your-open-source-saas-under-agpl-or-mit-a-decision-guide-for-founders)
