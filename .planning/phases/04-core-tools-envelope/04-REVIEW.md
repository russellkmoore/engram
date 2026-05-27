---
phase: 04-core-tools-envelope
reviewed: 2026-05-27T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/mcp-server/package.json
  - packages/mcp-server/src/envelope.ts
  - packages/mcp-server/src/result-types.ts
  - packages/mcp-server/src/schemas.ts
  - packages/mcp-server/src/tools.ts
  - packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts
  - packages/mcp-server/src/__tests__/envelope.test.ts
  - packages/mcp-server/src/__tests__/error-mapping.test.ts
  - packages/mcp-server/src/__tests__/schemas.test.ts
  - packages/mcp-server/src/__tests__/token-budget.test.ts
  - packages/mcp-server/src/__tests__/tools-integration.test.ts
  - packages/mcp-server/src/__tests__/tools.test.ts
  - packages/workspace-do/src/queries.ts
  - packages/workspace-do/src/__tests__/helpers.test.ts
  - shared/types/src/index.ts
  - README.md
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-27
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 4 ships the 5 live MCP tool handlers, the honest-stub `EngramResponse<T>` envelope builders, and the security-critical TOL-07 cross-workspace pen-test + MCP-08 token-budget proofs. The defense-in-depth structural contract (no `workspace_id` in schemas; sourced from `props.workspace_id` only) holds. Token budget post-trim, error mapping with secret/path sanitization, and the active `assertOwnsWorkspace` backstop are all proven by tests.

However, the implementation has one BLOCKER-class behavioral defect — the `remember` handler silently writes a different value to SQLite than it echoes back in the response envelope, breaking the read-your-writes contract clients rely on. Six WARNING-class issues stem from a consistent pattern: schema-accepted input parameters are silently dropped without a single visible signal to the client. A user calling `recall({query: "x", scope: "project", since: "2026-01-01"})` receives results from ALL scopes across ALL time — with no error, no `meta.gaps` entry naming the dropped filter, and no `suggestions` flag. The `META_GAPS` strings (frozen byte-for-byte for fixture stability) cannot warn about these because they pre-date the deviation fix.

Test coverage gaps: `forget({cascade: false})` is never exercised. The cross-workspace Prong A test passes for the wrong reason (a fresh DO returning empty is indistinguishable from a defended forgery attempt — the active defense is only proven by Prong B).

## Critical Issues

### CR-01: `remember` handler stores `type: "research_note"` but echoes `classified_type: null` — read-your-writes broken

**File:** `packages/mcp-server/src/tools.ts:200-218`
**Issue:** The handler defaults the SQLite `type` column to `"research_note"` when `args.type` is absent (line 202: `type: args.type ?? "research_note"`), but the response envelope echoes `classified_type: args.type ?? null` (line 218). A client calling `remember({content: "x"})` receives:

```json
{ "result": { "classified_type": null, ... } }
```

…but a subsequent `recall({query: "x"})` returns the same memory with `type: "research_note"`. The client's local model of what was stored does not match what is in the DO. This is a correctness bug, not a style issue:

1. Clients that assume `classified_type` reflects the stored type will misroute future operations (filtering, projection, deletion-by-type).
2. Data integrity inspectors counting `null`-typed memories will see zero (because no row is actually NULL-typed) while clients see `null` everywhere — silent divergence.
3. The "honest stub" promise in `META_GAPS.remember` ("`classified_type` echoes `args.type` when supplied") is violated for the no-type case — the storage uses a hardcoded type that is never disclosed.

**Fix:** Pick one source of truth and apply it everywhere. Two options:

Option A — store `null` until Phase 5 classifies (matches the honest-stub promise):
```typescript
// tools.ts:200-218
const block: Memory = {
  id,
  type: args.type ?? null,  // requires widening Memory.type to `string | null`
  // ...
};
await stub.insertBlock({ workspace_id: props.workspace_id, block });
const envelope = buildRememberResponse({ id, classified_type: args.type ?? null });
```

Option B — store and echo the same fallback (and document the default in META_GAPS):
```typescript
const stored_type = args.type ?? "research_note";
const block: Memory = { id, type: stored_type, ... };
await stub.insertBlock({ workspace_id: props.workspace_id, block });
const envelope = buildRememberResponse({ id, classified_type: stored_type });
```

Option A is correct per the design principle ("honest stubs — no AI classification ran in v0.1"). Option B requires a META_GAPS string update (which is byte-frozen — would need a coordinated bump).

## Warnings

### WR-01: `forget` defaults `cascade: true` — destructive default contradicts least-surprise

**File:** `packages/mcp-server/src/tools.ts:302`
**Issue:** The handler sets `cascade: args.cascade ?? true`. A client calling `forget({id: "abc"})` will delete every relation row referencing `abc` as `from_id` or `to_id` — without explicitly asking for cascade. The schema (`ForgetInputSchema`) declares `cascade?: boolean` with no default, so the omitted-cascade contract should be the safe non-destructive path. The README's `forget` description does not document the default. CLAUDE.md spec writes `forget(id, cascade?)` without specifying default behavior. Defaulting to destructive cascade increases blast radius for typo-ed deletes and accidental scripted bulk operations.

**Fix:** Default to non-cascade and require explicit opt-in:
```typescript
// tools.ts:299-303
const { blocks_deleted, relations_deleted } = await stub.deleteBlock({
  workspace_id: props.workspace_id,
  id: args.id,
  cascade: args.cascade ?? false,  // safe default; opt-in to relations cascade
});
```
If cascade-by-default is intentional, document it in the README `forget` section, in `META_GAPS.forget`, and add a test (`forget({id, cascade: false})`) asserting relations are NOT touched.

### WR-02: `recall` silently drops `types`, `project`, `scope`, `since`, `until` — privacy/correctness risk

**File:** `packages/mcp-server/src/tools.ts:230-252`
**Issue:** The schema (`RecallInputSchema`) accepts five filter fields — `types`, `project`, `scope`, `since`, `until`. The handler reads ONLY `query`, `limit`, and `verbosity`. A client calling `recall({query: "salary", scope: "personal", since: "2026-01-01"})` receives memories from ALL scopes across ALL time — including org-shared scope and pre-2026 entries the user expected to be filtered out. There is no `meta.gaps` entry warning about each dropped field; the only signal is `META_GAPS.recall[0]` which says "Phase 5 hybrid ranking handles these" — but a security-conscious user reading the result envelope sees no per-filter acknowledgment.

The comment on line 240 ("not yet filtered by v0.1 DO method") is accurate but invisible to clients. Three concrete failure modes:

1. **Privacy:** a personal-scope filter is ignored, exposing org-scope memories to a query that expected personal-only.
2. **Correctness:** time-windowed queries return out-of-window data — the client trusts the filter and may take action on stale results.
3. **Forward incompatibility:** any client that ships using these fields in v0.1 will see behavior change in Phase 5 without a version bump.

**Fix (pick one):**
- (Preferred) Reject filters that v0.1 cannot honor. Tighten the schema to omit unsupported fields in v0.1, then re-add them in Phase 5 with backing implementation. Clients see Zod validation errors immediately.
- Append per-field warnings to `meta.gaps` when any of those fields is non-empty: `"Filter 'scope' ignored in v0.1 (lexical-only search)."` This requires un-freezing META_GAPS — coordinate with the byte-determinism snapshot.

### WR-03: `search` silently drops `filters` — same defect as WR-02

**File:** `packages/mcp-server/src/tools.ts:259-281`
**Issue:** The `SearchInputSchema` accepts `filters: z.record(z.string(), z.unknown()).optional()`. The handler reads ONLY `query` and `limit`. Client calls `search({query: "foo", filters: {type: "job_application"}})` and receives results from all types, including the very type the filter excluded. Same privacy/correctness/forward-compat risk as WR-02.

**Fix:** Same options as WR-02 — schema rejection or explicit `meta.gaps` per-filter warning.

### WR-04: `META_GAPS.recall` claims "LIKE matches only" but backing is `instr()` substring search

**File:** `packages/mcp-server/src/envelope.ts:74-76`
**Issue:** The byte-frozen META_GAPS string for `recall` reads:
> "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only."

After the `6e20d2d` + `01a225e` deviation commits, `lexicalSearchBlocks` no longer uses LIKE — it uses SQLite's `instr()` function (literal substring search). The two have meaningfully different semantics:

| Semantic               | LIKE                                | `instr()` (v0.1 reality) |
|------------------------|-------------------------------------|--------------------------|
| Wildcard support       | `%`, `_`                            | None — literal only       |
| Case-folding           | Default ASCII collation             | Forced via `lower(...)`   |
| Empty-pattern behavior | Matches all rows                    | `instr(x, "")` returns 1 (matches) |
| Pattern-length limit   | Workerd cap (the deviation trigger) | Unbounded                 |

A client (especially Claude) reasoning from this string will believe wildcards work and craft queries like `recall({query: "engin%"})` expecting "engineer"/"engineering" to match. The literal `engin%` substring will never appear in any content — zero hits, silent miss.

**Fix:** Update META_GAPS.recall to reflect the deviation:
```typescript
// envelope.ts:74-76
recall: [
  "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical substring (case-insensitive instr()) matches only — no wildcards.",
],
```
Bump the byte-determinism snapshot in `envelope.test.ts:153-158`. README's `recall` section already mentions "lexical (LIKE) matches" in `meta.gaps.example` — sync that too.

### WR-05: `tags` and `expires` accepted by `remember` schema but silently discarded

**File:** `packages/mcp-server/src/tools.ts:199-217`
**Issue:** The line 199 comment says "args.tags + args.expires accepted by schema but not yet persisted (no Memory field)". A client persisting `remember({content: "x", tags: ["urgent"], expires: "2026-12-31T00:00:00Z"})` sees a successful `result.id` and assumes the tags and expiry survived. They didn't. On the next `recall`, no tag information returns; on the expiry date, nothing is purged.

This is worse than the recall-filter case (WR-02) because:
1. `expires` carries a data-retention contract — silently dropping it could violate user GDPR/CCPA assumptions or breach team policies.
2. `tags` is a documented column in the CLAUDE.md SQLite schema (the `tags` table) — clients reasonably believe a `tags` field on `remember` writes to that table.
3. There is no `meta.gaps` entry naming these fields. META_GAPS.remember mentions classification + conflict detection only.

**Fix:** Two-part fix:
- Add explicit handling: write tags to the existing `tags` table at insertBlock time (the `tags` table exists in SQL schema; helper insertion is one statement).
- Until expires is implemented (no `expires_at` column on `blocks` yet — would need a STO-04 migration follow-up), reject `expires` at the schema level OR surface a per-call `meta.gaps` warning that the field was discarded.

### WR-06: `ingest` is a complete no-op but presents as successful — undisclosed beyond a single gap string

**File:** `packages/mcp-server/src/tools.ts:317-334`
**Issue:** The handler accepts `source`, `type`, `project`, `priority`, `threshold`, generates a UUID, builds an envelope claiming `status: "accepted"`, and returns. No Queue side-effect, no DB write, no inbox entry. `META_GAPS.ingest[0]` mentions "job is recorded but not yet processed" — but the truth is the job is NOT recorded anywhere. The job_id is fresh and untraceable.

A client polling for the job by id will never find it. A user calling `ingest({source: "https://example.com/important-doc"})` will believe the URL is queued; in v0.1 nothing happens at all.

The line 327 expression `void workspaceNs.get(workspaceNs.idFromName(props.workspace_id))` resolves a DO stub and discards it — this performs no real work besides triggering DO instance creation on first call. Comment says "Route-by-DO-id check (TOL-07 Prong A)" but a discarded stub does not write anywhere, so Prong A's data-isolation premise (a forged workspace_id routes data to a different DO) is moot here — there is no data being routed.

**Fix:** Be honest. Two options:
- (Preferred) Persist the job request — write a row to `inbox` or a new `ingest_jobs` table so the `job_id` is real and pollable in Phase 6. Update META_GAPS to: `"Async enrichment is queued (job_id is persistent). Phase 6 wires the Queue side-effect."`
- Update META_GAPS to: `"v0.1 stub: job_id is NOT persisted and async enrichment is NOT scheduled. Phase 6 wires both."` This is harsher but truthful.

### WR-07: `dropMemoryField` corrupts non-string field types when force-set to `null`

**File:** `packages/mcp-server/src/envelope.ts:357-371`
**Issue:** `dropMemoryField` accepts `field: "content" | "summary"` and sets each memory's `[field]: null`. The `Memory` interface already declares `content: string | null` and `summary: string | null`, so the type assignment is sound. But the helper is generic over `T extends { memories: LexicalSearchHit[] }` and a future caller could pass any field name (the literal union is the only guardrail). If a caller drops, say, `created_at` (a `number` field) to `null`, the runtime type contract breaks and downstream consumers expecting `number` would crash.

This is not exploitable today (`trimToBudget` only ever passes `"content"` and `"summary"`), but the helper signature does not enforce the safety property at the type level. Defensive programming would constrain `field` to keys whose value type already includes `null`.

**Fix:** Constrain the generic so only nullable keys are accepted:
```typescript
function dropMemoryField<
  M extends LexicalSearchHit,
  K extends { [P in keyof M]: null extends M[P] ? P : never }[keyof M],
>(envelope: EngramResponse<{ memories: M[] }>, field: K): EngramResponse<{ memories: M[] }> { ... }
```
Or accept the runtime invariant and tighten the union literal at the call sites only.

## Info

### IN-01: Cross-workspace pentest Prong A is tautological — passes whether defense exists or not

**File:** `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts:104-129`
**Issue:** Prong A seeds workspace_A with "secret data", then calls `recall({query: "secret"})` with forged `props.workspace_id: "workspace_B"`. The assertion `expect(memories).toEqual([])` passes because workspace_B is a fresh DO with no data — NOT because any active defense fired. If `assertOwnsWorkspace` were deleted and the handler still routed by `props.workspace_id`, this test would still pass. Only Prong B exercises active defense.

The "optional reinforcement" block (lines 124-129) confirms workspace_A actually has the data, which proves the seed worked — but it does NOT prove forgery is blocked. The test claim "data isolation by routing" is technically true (different DOs → different SQLite stores) but the test does not distinguish between "routing isolation works" and "routing isolation + a fresh DO are both empty for the wrong reasons".

**Fix:** Strengthen the test by routing the SAME DO (same workspace_id at the route layer) but forging the workspace_id ARG passed inside the DO method. That is essentially Prong B already. Alternatively, accept Prong B as the only load-bearing test and re-label Prong A as a routing-smoke test, not a security proof. Update the JSDoc claim "two-pronged proof" accordingly.

### IN-02: `forget({cascade: false})` has no test coverage

**File:** `packages/mcp-server/src/__tests__/tools-integration.test.ts:239-273`
**Issue:** TOL-04b verifies `cascade: true` removes relations. No test verifies `cascade: false` PRESERVES them. The helper code path is exercised in `helpers.test.ts:159-199` (cascade=true default), but the cascade=false branch in `deleteBlock` (queries.ts:432-440) and the `cascade: args.cascade ?? true` defaulting in tools.ts:302 are untested through the handler boundary. Given WR-01's destructive-default concern, this gap matters.

**Fix:** Add a test:
```typescript
it("TOL-04c: forget with cascade=false preserves relation rows", async () => {
  // seed block + relation, call forgetCb({id, cascade: false}), assert relations_deleted === 0
  // assert relation row still present via raw SQL
});
```

### IN-03: `buildSearchResponse` accepts unused `count` parameter — dead in signature

**File:** `packages/mcp-server/src/envelope.ts:228-252`
**Issue:** The input type accepts `count?: number` but the implementation always sets `result.count = input.memories.length`. The optional param is documented as "forward compatibility" but a caller passing `count: 999` against `memories.length === 1` would have their value silently overwritten. Misleading public surface — readers seeing `count?` expect it to be honored.

**Fix:** Either remove `count?: number` from the signature, or honor it (allowing the caller to express paginated totals that differ from memories.length). The current state is the worst of both worlds.

### IN-04: `buildForgetResponse` accepts unused `id?` parameter

**File:** `packages/mcp-server/src/envelope.ts:272-294`
**Issue:** Same defect class as IN-03 — `id?: string` is accepted but never read. `ForgetResult` interface does not include `id`. Dead parameter in the public surface.

**Fix:** Remove `id?: string` from the input type or echo it into the result (with a corresponding `ForgetResult.id?: string`).

### IN-05: `@typescript-eslint/await-thenable` disable comments mislabel cause

**File:** `packages/mcp-server/src/tools.ts:241, 270`
**Issue:** The comment "DO stub methods return Promise<T> at runtime via Cloudflare RPC layer even though declared sync" is technically accurate but misleading on causality. The DO methods themselves ARE declared sync; the Cloudflare RPC layer wraps them in Promises at the stub boundary. The TypeScript declarations on `DurableObjectStub<T>` do not currently model this wrapping (the cast on line 174 to `DurableObjectNamespace<WorkspaceDO>` doesn't promote sync return types to Promises). A future contributor reading the comment might delete the `await` thinking the comment is just noise — and then the RPC Promise leaks unawaited.

**Fix:** Sharpen the comment:
```typescript
// eslint-disable-next-line @typescript-eslint/await-thenable -- workerd's RPC layer
//   wraps sync DO methods in Promise<T> at the stub boundary. The TS types on
//   DurableObjectStub<T> do not reflect this wrapping, so the await looks superfluous
//   to the linter. Removing the await leaves an unsettled Promise — DO NOT remove.
```

### IN-06: README's `recall` JSON example shows `result.synthesis: null` and `chunks` together — clarify the verbosity contract

**File:** `README.md:217-235`
**Issue:** The JSON example shows both `synthesis` (null) and `chunks` populated in a single response. This is correct for the default `verbosity: "both"` path. But a reader skimming the example sees both fields and might infer all responses contain `chunks` — when in fact `verbosity: "synthesis"` OMITS the `chunks` key entirely (envelope.ts:173-184). The README text below the example (lines 237-239) clarifies, but the example precedes the clarification and is what most readers will copy/paste from.

**Fix:** Either show TWO examples (verbosity=synthesis vs verbosity=both) with explicit "chunks key absent" notation, or add a one-line comment INSIDE the example: `// "chunks" key omitted when verbosity === "synthesis"`.

---

_Reviewed: 2026-05-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
