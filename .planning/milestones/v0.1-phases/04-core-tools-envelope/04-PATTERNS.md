# Phase 4: Core Tools + Envelope — Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 14 (1 new prod module, 5 modified prod files, 4 new tests, 2 extended tests, 1 docs append, 1 optional script)
**Analogs found:** 14 / 14
**Search scope:** `packages/mcp-server/src/`, `packages/workspace-do/src/`, `shared/types/src/`, `scripts/`, repo root.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/envelope.ts` (NEW) | helper module | transform (input → typed `EngramResponse<T>`) | `packages/mcp-server/src/error-mapping.ts` | file-shape match (sibling thin-helper module); inline analogs for envelope shape from `shared/types/src/index.ts` |
| `packages/mcp-server/src/tools.ts` (MODIFY bodies) | handler | request-response over DO RPC | `packages/workspace-do/src/index.ts` (sync method delegation pattern) + the in-file Phase-4-ready comment block (`tools.ts:131-149`) | exact (the canonical skeleton lives in this same file) |
| `packages/mcp-server/src/schemas.ts` (MODIFY: extend) | type / validation | input validation | itself (Phase 3 canonical zod pattern — additive diff only) | exact |
| `packages/mcp-server/package.json` (MODIFY: add dep) | config | n/a | itself + `package.json` workspace conventions | exact |
| `shared/types/src/index.ts` (MODIFY: widen `meta` fields) | type | type contract | itself (existing `EngramResponse<T>` interface; widen `confidence` and `coverage` to `number \| null`) | exact |
| `README.md` (MODIFY: append "Tool surface (v0.1)") | docs | n/a | itself (existing `##` H2 section layout) | exact |
| `packages/mcp-server/src/__tests__/envelope.test.ts` (NEW) | test (unit) | structural assertion | `packages/mcp-server/src/__tests__/schemas.test.ts` (per-schema structural invariant pattern) | role-match (both: pure-data assertions on a typed builder, no DO runtime) |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` (NEW) | test (integration) | DO round-trip | `packages/workspace-do/src/__tests__/helpers.test.ts` (`runInDurableObject` + `idFromName` round-trip pattern) | exact |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (NEW) | test (integration / security) | two-DO penetration | `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` (negative-path STO-07 assertions) + `packages/mcp-server/src/__tests__/tools.test.ts` (McpServer.prototype.registerTool spy for the second prong) | exact (combines two existing patterns — one per prong) |
| `packages/mcp-server/src/__tests__/token-budget.test.ts` (NEW) | test (unit) | worst-case fixture + tokenization | `packages/mcp-server/src/__tests__/error-mapping.test.ts` (regex-locked, regex-shape assertions with byte/length math) | role-match (both: byte-deterministic assertions over a transform) |
| `packages/mcp-server/src/__tests__/tools.test.ts` (EXTEND) | test (unit) | callback assertion | itself — current MethodNotFound shape is the inversion; happy-path replaces the negative-path block | exact (same file, swap negative for positive) |
| `packages/mcp-server/src/__tests__/error-mapping.test.ts` (EXTEND) | test (unit) | regression lock | itself — add a row for `NotFoundError → InvalidParams` and a sanitize regression case | exact |
| `scripts/smoke-job-agent.mjs` (NEW, OPTIONAL) | script (smoke) | external CLI / wrangler dev | `scripts/smoke-wrangler-dev.sh` (boot wrangler dev + curl-poll pattern) | role-match (research prefers `npx @modelcontextprotocol/inspector` recorded as `04-MCP-INSPECTOR-SMOKE.md` artifact; this file may not ship) |

---

## Pattern Assignments

### `packages/mcp-server/src/envelope.ts` (NEW — helper / transform)

**Analog (file shape):** `packages/mcp-server/src/error-mapping.ts`
**Analog (envelope contract):** `shared/types/src/index.ts:190-238`

**Why this analog:** `envelope.ts` is a sibling "thin handler helper" module to `error-mapping.ts` — same scope (imported by every tool handler), same shape (named-export-only, file-local helpers, no default export, no side effects). `error-mapping.ts` is the canonical template for how Phase 3 ships a single-purpose helper module the Phase 4 handlers consume.

**File-shape pattern (copy from `error-mapping.ts:1-92`):**
- Module-level JSDoc with `Cross-phase contract`, `Design notes (locked)`, `Threat model` headings.
- `// packages/mcp-server/src/envelope.ts` / `// Source: ...` source-comment block right under the JSDoc.
- ONE public named export (`mapToMcpError` for error-mapping; envelope.ts will have ~7 public named exports: 5 `buildXResponse` builders + `trimToBudget` + `wrapMcpContent` and a `META_GAPS` const).
- File-local helpers (NOT exported) — the `sanitize()` pattern at `error-mapping.ts:85-92`. Envelope's `countTokens()`, `dropMemoryField()`, `dropLastMemory()`, `hasMemories()`, `memoryCount()` follow the same pattern.

**File-header excerpt to copy verbatim (lines 1-46 of `error-mapping.ts`):**
```typescript
/**
 * `<name>` — <one-line purpose>.
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 pass-through:** ...
 * - **Phase 3 D-09 ...:** ...
 * - **Phase 4 (TOL-01..05):** ...
 *
 * Design notes (locked):
 * - <one bullet per pinned decision>
 *
 * Threat model:
 * - **T-03-LEAK (Information Disclosure)** — mitigated by ...
 *
 * @module @engram/mcp-server/envelope
 */
// packages/mcp-server/src/envelope.ts
// Source: 04-CONTEXT.md D-04/D-06/D-07/D-08/D-10 + spike-findings-engram skill.
```

**Envelope contract reference (`shared/types/src/index.ts:190-238`):**
```typescript
export interface EngramResponse<T> {
  result: T;
  context: {
    related: Memory[];
    entities: Entity[];
    timeline?: TimelineEvent[];
    conflicts?: Conflict[];
  };
  meta: {
    confidence: number;            // ← Phase 4 widens to `number | null`
    coverage: number;              // ← Phase 4 widens to `number | null`
    last_updated: number;
    gaps: string[];
  };
  suggestions?: {
    actions: string[];
    queries: string[];
  };
}
```

**Builder shape (from research §Pattern 2, lifted into the analog file format):**
```typescript
// Frozen const — every honest-stub null field has a corresponding string
// in META_GAPS so MCP-08 fixtures can reproduce exact byte counts.
export const META_GAPS = {
  remember: [
    "AI classification lands in Phase 5. classified_type echoes args.type when supplied.",
    "Conflict detection lands in Phase 5 (semantic similarity via Vectorize).",
  ],
  recall: [
    "AI synthesis lands in Phase 5 (Vectorize + Workers AI). Phase 4 returns lexical (LIKE) matches only.",
  ],
  search: ["Lexical (LIKE) backing — semantic search lands in Phase 5."],
  ingest: ["Async enrichment pipeline lands in Phase 6 — job is recorded but not yet processed."],
  forget: [],
} as const;

export function buildRememberResponse(
  result: { id: string; classified_type: string | null },
): EngramResponse<RememberResult> {
  return {
    result: {
      id: result.id,
      classified_type: result.classified_type,
      extracted_fields: {},           // D-06
      confidence: null,               // D-06
    },
    context: { related: [], entities: [], conflicts: [] }, // D-08
    meta: {
      confidence: null,               // requires shared/types widen (see deviation)
      coverage: null,                 // requires shared/types widen
      last_updated: Date.now(),
      gaps: [...META_GAPS.remember],
    },
    // suggestions: omitted entirely (D-04 leaves it absent, NOT present-with-undefined)
  };
}
```

**Post-trim algorithm pattern (D-10):**
```typescript
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
const BUDGET = 7500;

export function trimToBudget<T>(envelope: EngramResponse<T>): EngramResponse<T> {
  if (countTokens(envelope) <= BUDGET) return envelope;
  // Step 1: drop result.memories[i].content
  // Step 2: drop result.memories[i].summary
  // Step 3: drop trailing memories
  // INVARIANT: never drop meta, never drop context.conflicts, never drop result.id on remember
}

function countTokens(env: unknown): number {
  return encode(JSON.stringify(env)).length;
}
```

**MCP wrapper helper (Pitfall 7 — research §Common Pitfalls):**
```typescript
export function wrapMcpContent<T>(envelope: EngramResponse<T>): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
}
```

**Deviations from analog:**
- `error-mapping.ts` has ONE public export; `envelope.ts` has ~7 (5 builders + `trimToBudget` + `wrapMcpContent` + `META_GAPS`). The export-discipline pattern (named-only, no default) survives; the count grows.
- `META_GAPS` is a `const`-asserted record exported at module scope — a new pattern not present in `error-mapping.ts`. The byte-determinism contract (D-10 paragraph 3) requires it be frozen at v0.1.

---

### `packages/mcp-server/src/tools.ts` (MODIFY — handler bodies)

**Analog:** the Phase-4-ready comment block IN THIS FILE at `tools.ts:131-149` — Phase 3 ships the canonical skeleton in comments; Phase 4 literally diffs callback bodies against it.

**Body skeleton (verbatim from `tools.ts:131-149`):**
```typescript
async (args, _extra) => {
  const props = getProps();
  if (props === undefined) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Missing authentication context",
    );
  }
  try {
    const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
    stub.insertBlock({
      workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args
      block: { /* ...derived from args... */ },
    });
    return { content: [{ type: "text", text: "..." }] };
  } catch (err) {
    throw mapToMcpError(err);  // src/error-mapping.ts
  }
}
```

**Tool-to-method mapping (verbatim from `tools.ts:118-127`):**
```
remember → insertBlock({ workspace_id, block })
recall   → lexicalSearchBlocks({ workspace_id, query, limit? })
search   → lexicalSearchBlocks({ workspace_id, query, limit? }) + structured filters
forget   → deleteBlock({ workspace_id, id, cascade? })
ingest   → (no DO method — synthetic accepted contract per D-05)
```

**Imports to add at top of file (currently the file imports only `McpError` + `ErrorCode` + `McpServer` type + schemas + `EngramProps` type):**
```typescript
import { getAgentByName } from "agents";
import { mapToMcpError } from "./error-mapping.js";
import {
  buildRememberResponse,
  buildRecallResponse,
  buildSearchResponse,
  buildForgetResponse,
  buildIngestResponse,
  trimToBudget,
  wrapMcpContent,
} from "./envelope.js";
import type { Memory } from "@engram/types";
```

**Load-bearing invariants Phase 4 MUST NOT remove:**
1. `SENTINEL-DD-RT-PHASE-03-TOOLS-TS` comment at `tools.ts:109` — `tools.test.ts:147-155` asserts its presence.
2. The `// prettier-ignore` comments above every `server.registerTool("name"` call (so grep for `server.registerTool(\s*"<name>"` matches single-line per tool).
3. NEVER read `args.workspace_id` outside `//` comment lines — `tools.test.ts:166-182` strips comment lines and asserts the remainder does NOT match `/args\.workspace_id/`.

**Canonical `remember` body (Pattern 1 from research):**
```typescript
async (args) => {
  const props = getProps();
  if (props === undefined) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context");
  }
  try {
    const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
    const id = crypto.randomUUID();
    const now = Date.now();
    const block: Memory = {
      id, type: args.type ?? "research_note", content: args.content,
      summary: null, properties: null, embedding_id: null,
      scope: "personal", project_id: args.project ?? null,
      source: args.source ?? "mcp:claude",
      confidence: null, created_at: now, updated_at: now,
    };
    stub.insertBlock({ workspace_id: props.workspace_id, block });
    const envelope = buildRememberResponse({ id, classified_type: args.type ?? null });
    return wrapMcpContent(trimToBudget(envelope));
  } catch (err) {
    throw mapToMcpError(err);
  }
}
```

**Deviations from analog:**
- The Phase 3 stubs throw on line 1 of every callback — Phase 4 replaces each body with the 6-8 line skeleton above. The `async ()` keyword (line 177 etc.) stays; the `_args` parameter becomes `args` (no underscore — now consumed). The `eslint-disable @typescript-eslint/require-await` block (lines 158-164) becomes UNNECESSARY because the new bodies are real async — leaving the disable in is harmless but the planner may remove it for cleanliness.
- `void getProps; void _env;` (lines 237-238) becomes UNNECESSARY — both are consumed now. Remove these two lines.

---

### `packages/mcp-server/src/schemas.ts` (MODIFY — additive diff per D-03 + D-10)

**Analog:** itself — current schema is the canonical zod pattern. Phase 4 changes are purely additive (one new field on Recall, tighter `max()` on two limits).

**Current `RecallInputSchema` (lines 57-65 — preserve byte-stable order):**
```typescript
export const RecallInputSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  project: z.string().optional(),
  scope: z.enum(["personal", "project", "org"]).optional(),
  limit: z.number().int().positive().max(100).optional(),   // ← tighten max to 25 (D-10)
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});
```

**Phase 4 diff (insert `verbosity` per D-03; tighten `limit`):**
```typescript
export const RecallInputSchema = z.object({
  query: z.string().min(1),
  types: z.array(z.string()).optional(),
  project: z.string().optional(),
  scope: z.enum(["personal", "project", "org"]).optional(),
  limit: z.number().int().positive().max(25).optional(),    // D-10 (was max(100))
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  verbosity: z.enum(["synthesis", "chunks", "both"]).optional().default("both"),
  // ↑ default flipped to "both" per spike-findings-engram §1 (BORDERLINE gate)
});
```

**Phase 4 diff to `SearchInputSchema` (lines 69-72 — add `limit`):**
```typescript
export const SearchInputSchema = z.object({
  query: z.string().min(1),
  filters: z.record(z.string(), z.unknown()).optional(),
  limit: z.number().int().positive().max(25).optional(),    // D-10 (new field — Phase 3 had no limit)
});
```

**Load-bearing invariant (header comment lines 37-41) MUST stay byte-stable:**
```typescript
// CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
// NONE of these schemas declares a `workspace_id` field. ...
```
`schemas.test.ts:69-81` asserts `Object.keys(schema.shape).indexOf('workspace_id') === -1` per schema — Phase 4 additive changes preserve this trivially.

**Deviations from analog:** none — purely additive. The structural defense-in-depth invariant survives unchanged.

---

### `packages/mcp-server/package.json` (MODIFY — add `gpt-tokenizer`)

**Analog:** itself — existing dependencies list is the format template.

**Current shape (lines 13-25):**
```json
"dependencies": {
  "agents": "^0.13.2",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@cloudflare/workers-oauth-provider": "0.7.0",
  "zod": "^4.0.0",
  "@engram/types": "*",
  "@engram/schema": "*",
  "@engram/workspace-do": "*"
},
```

**Phase 4 diff (insert one line — keep alphabetical-ish ordering relative to `zod`):**
```json
"dependencies": {
  "agents": "^0.13.2",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@cloudflare/workers-oauth-provider": "0.7.0",
  "gpt-tokenizer": "^3.4.0",
  "zod": "^4.0.0",
  ...
}
```

**Install command:** `npm install --workspace=@engram/mcp-server gpt-tokenizer`

**Deviations from analog:** the planner MUST insert a `checkpoint:human-verify` task BEFORE the install per the Package Legitimacy Audit fallback (slopcheck was unavailable at research time — research A1).

---

### `shared/types/src/index.ts` (MODIFY — widen `meta.confidence` and `meta.coverage`)

**Analog:** itself — existing `EngramResponse<T>` interface is the contract.

**Current shape (lines 211-222):**
```typescript
meta: {
  confidence: number;     // ← widen to number | null
  coverage: number;       // ← widen to number | null
  last_updated: number;
  gaps: string[];
};
```

**Phase 4 diff (research Open Question 2 RECOMMENDED resolution):**
```typescript
meta: {
  /**
   * Engram's confidence in the result accuracy (0–1), or `null` when no AI
   * scoring has run for this result (v0.1 honest-stub posture — D-04).
   * Phase 5 populates with real Vectorize-derived numbers.
   */
  confidence: number | null;
  /**
   * Completeness signal (0–1), or `null` when AI coverage estimation has not
   * yet been wired (v0.1 honest-stub). Phase 5 / v0.2 populates.
   */
  coverage: number | null;
  last_updated: number;
  gaps: string[];
};
```

**Optional new field per D-07 — `recall.result.chunks`:** Planner decides whether to add a `RecallResult` type with optional `chunks?: ChunkExcerpt[]` to `shared/types/src/index.ts` OR put it in a new `packages/mcp-server/src/result-types.ts` (research §Recommended Project Structure suggests the latter). Either choice is consistent with the existing types-package conventions.

**Deviations from analog:** the existing fields are non-nullable; widening to `| null` is breaking ONLY for code that reads these values and assumes non-null. Phase 3 ships no consumer of `EngramResponse.meta.*`, so this is safe.

---

### `README.md` (MODIFY — append "Tool surface (v0.1)" section)

**Analog:** itself — existing `## H2` sections (`## Why Engram`, `## Architecture`, `## Tech Stack`, `## Status`, `## Getting Started`, `## Architecture Deep Dive`, `## License`).

**Where to insert:** between `## Getting Started` (line 105) and `## Architecture Deep Dive` (line 132) — i.e., new section `## Tool Surface (v0.1)` placed between them.

**Section contents (per DEP-05 carry-forward + honest-stubs posture):**
- One subsection per tool: request shape (from `schemas.ts`) + honest-stub response notes.
- Mention `verbosity` default flip on `recall`.
- Note `meta.confidence` / `meta.coverage` are `null` in v0.1.
- Note Phase 5 populates synthesis / entities / conflicts.

**Pattern from existing `## Tech Stack` section (lines 79-94):** table-driven with concise rows. Apply the same format to the tool surface.

**Deviations from analog:** none — purely additive markdown.

---

### `packages/mcp-server/src/__tests__/envelope.test.ts` (NEW — TOL-06)

**Analog:** `packages/mcp-server/src/__tests__/schemas.test.ts`

**Why this analog:** Both are pure-data unit tests over a typed module (no DO runtime, no `runInDurableObject`, no `cloudflare:test` import). Both assert structural invariants of an exported surface; envelope.test.ts will assert "every builder returns an object with `result` + `context` + `meta` keys; `context.related/entities` are arrays; `meta.last_updated` is a number; `META_GAPS` strings are byte-stable" — same shape as schemas.test.ts's "every schema has no `workspace_id` field".

**File-header pattern to copy (`schemas.test.ts:1-26`):**
```typescript
/**
 * GREEN — `packages/mcp-server/src/<filename>.ts` (<purpose>).
 *
 * Wave 1/2 (Plan 04-NN) turn-up: <strategy>.
 *
 * Layout: <N> describe blocks
 *   - <block 1 name>: <count> cases
 *   - <block 2 name>: <count> cases
 *   ...
 *
 * Total: <N> assertions.
 *
 * @module @engram/mcp-server/__tests__/<filename>
 */
import { describe, it, expect } from "vitest";
```

**Per-builder structural-invariant pattern (lifted from `schemas.test.ts:37-82`):**
```typescript
describe("envelope builders (TOL-06: every response has all envelope fields PRESENT)", () => {
  it("buildRememberResponse returns EngramResponse with result + context + meta", () => {
    const env = buildRememberResponse({ id: "abc", classified_type: null });
    expect(env).toHaveProperty("result");
    expect(env).toHaveProperty("context.related");
    expect(env).toHaveProperty("context.entities");
    expect(env).toHaveProperty("context.conflicts");
    expect(env).toHaveProperty("meta.last_updated");
    expect(env.context.conflicts).toEqual([]); // D-08
    expect(env.result.extracted_fields).toEqual({}); // D-06
    expect(env.result.confidence).toBeNull(); // D-06
    expect(env.meta.confidence).toBeNull(); // D-06
    expect(env.meta.gaps).toContain(META_GAPS.remember[0]); // byte-deterministic
  });
  // ... similar for recall, search, forget, ingest
});

describe("META_GAPS byte-determinism (D-10 fixture stability)", () => {
  it("strings are frozen at v0.1 — snapshot lock", () => {
    expect(META_GAPS).toMatchSnapshot();
  });
});
```

**Deviations from analog:** `schemas.test.ts` does NOT use `runInDurableObject` — envelope.test.ts also does NOT need it. This is purely a workerd-pool-compatible unit test of typed function outputs.

---

### `packages/mcp-server/src/__tests__/tools-integration.test.ts` (NEW — TOL-01..05 round-trip)

**Analog:** `packages/workspace-do/src/__tests__/helpers.test.ts:63-272`

**Why this analog:** Phase 2 ships the canonical `runInDurableObject` + `idFromName` + `asWorkspaceDO` round-trip pattern. Phase 4's integration test reuses this for the data plane AND adds the McpServer-spy trick from `tools.test.ts` to capture the tool callback and invoke it with a manual `getProps()` returning `{ workspace_id, user_id }`.

**Imports to copy (`helpers.test.ts:21-29`):**
```typescript
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "../tools.js";
```

**Callback-capture pattern (lifted from `tools.test.ts:67-84`):**
```typescript
function captureCallback(toolName: string, workspace_id: string, user_id = "u-test") {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTools(server, () => ({ workspace_id, user_id }), env as unknown as Env);
    const call = spy.mock.calls.find(([name]) => name === toolName);
    if (!call) throw new Error(`registration for '${toolName}' not captured`);
    return call[2] as (args: unknown, extra: unknown) => Promise<unknown>;
  } finally {
    spy.mockRestore();
  }
}
```

**Round-trip test pattern (combine `helpers.test.ts:133-173` cascade pattern + callback-capture):**
```typescript
it("TOL-04: remember → forget → recall returns zero matches", async () => {
  const workspace_id = "ws-integration-round-trip";
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(workspace_id));
  // Phase 4 handlers route through getAgentByName which resolves the same DO.

  const rememberCb = captureCallback("remember", workspace_id);
  const recallCb = captureCallback("recall", workspace_id);
  const forgetCb = captureCallback("forget", workspace_id);

  // 1. remember a block
  const rememberResult = await rememberCb(
    { content: "needle to find" },
    {},
  ) as { content: [{ type: "text"; text: string }] };
  const rememberEnv = JSON.parse(rememberResult.content[0].text);
  const id = rememberEnv.result.id;

  // 2. recall finds it
  const recallResult = await recallCb({ query: "needle" }, {}) as { content: [{ type: "text"; text: string }] };
  const recallEnv = JSON.parse(recallResult.content[0].text);
  expect(recallEnv.result.memories.length).toBeGreaterThan(0);

  // 3. forget removes it
  await forgetCb({ id }, {});

  // 4. recall now returns zero
  const recallAfter = await recallCb({ query: "needle" }, {}) as { content: [{ type: "text"; text: string }] };
  const recallAfterEnv = JSON.parse(recallAfter.content[0].text);
  expect(recallAfterEnv.result.memories.length).toBe(0);
});
```

**Deviations from analog:**
- `helpers.test.ts` calls DO methods directly via `runInDurableObject` — `tools-integration.test.ts` invokes tool callbacks (which then call `getAgentByName(...)` → DO method). The data plane resolves to the same DO because `getAgentByName(env.WORKSPACE, "ws-integration-round-trip")` and `env.WORKSPACE.idFromName("ws-integration-round-trip")` route to the same instance.
- `helpers.test.ts` uses sync DO method calls inside `runInDurableObject`'s sync-callable region; `tools-integration.test.ts` uses fully-async tool callbacks. Both patterns are supported by the same pool.

---

### `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` (NEW — TOL-07)

**Analog (Prong A — data-isolation):** `packages/workspace-do/src/__tests__/helpers.test.ts` (idFromName + DO addressing).
**Analog (Prong B — active `assertOwnsWorkspace` firing):** `packages/workspace-do/src/__tests__/defense-in-depth.test.ts:180-228` (negative-path STO-07 assertions).

**Why two analogs:** The two-pronged proof in research §Pattern 4 requires both (a) showing that data does not leak when the handler routes by `props.workspace_id` (the route-by-DO-id check) AND (b) showing that even if a caller bypasses the handler and forges the workspace_id arg, `assertOwnsWorkspace` still fires. Each prong has a different existing analog.

**Prong A pattern (route-by-DO-id — adapt `helpers.test.ts:64-87`):**
```typescript
it("TOL-07 Prong A: forged props.workspace_id routes to wrong DO (data isolation)", async () => {
  // 1. Seed workspace_A via the legitimate handler path (props.workspace_id="A")
  const rememberCb_A = captureCallback("remember", "workspace_A");
  await rememberCb_A({ content: "secret in A" }, {});

  // 2. Try to recall from "A" using FORGED props.workspace_id="B"
  const recallCb_B = captureCallback("recall", "workspace_B");
  const result = await recallCb_B({ query: "secret" }, {}) as { content: [{ type: "text"; text: string }] };
  const envelope = JSON.parse(result.content[0].text);

  // The handler routed to DO of workspace_B (empty) — data isolation holds
  // even if assertOwnsWorkspace didn't exist.
  expect(envelope.result.memories).toEqual([]);
});
```

**Prong B pattern (active assertion — verbatim shape from `defense-in-depth.test.ts:180-197`):**
```typescript
it("TOL-07 Prong B: direct DO call with forged workspace_id throws InvalidRequest", async () => {
  const stubA = env.WORKSPACE.get(env.WORKSPACE.idFromName("workspace_A"));
  await runInDurableObject(stubA, (instance) => {
    let caught: unknown = undefined;
    try {
      (instance as unknown as WorkspaceDO).lexicalSearchBlocks({
        workspace_id: "workspace_B",   // forged
        query: "anything",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidRequest);
    expect((caught as McpError).message).toContain("workspace_A");
    expect((caught as McpError).message).toContain("workspace_B");
  });
});
```

**Deviations from analog:**
- Prong A is novel: the existing `helpers.test.ts` always uses a matching `workspace_id`. Prong A intentionally MISMATCHES the DO's name vs the handler's `props.workspace_id` arg — the test asserts the MISMATCH is harmless because the handler routes to a different DO.
- Prong B is a verbatim port of `defense-in-depth.test.ts`'s mismatch test BUT crossed with the tool-handler harness. The simplest implementation is to invoke `instance.lexicalSearchBlocks(...)` directly (not via the handler) — the analog at lines 180-197 is exactly this shape.

---

### `packages/mcp-server/src/__tests__/token-budget.test.ts` (NEW — MCP-08)

**Analog:** `packages/mcp-server/src/__tests__/error-mapping.test.ts`

**Why this analog:** Both are byte-deterministic unit tests over a transform. `error-mapping.test.ts:83-95` shows the canonical "compute length, assert under threshold" pattern (used there for the 500-char sanitize cap).

**Length-assertion pattern (lifted from `error-mapping.test.ts:88-95`):**
```typescript
const longMessage = "x".repeat(2000);
const input = new Error(longMessage);
const output = mapToMcpError(input);
const prefix = `MCP error ${ErrorCode.InternalError}: `;
expect(output.message.startsWith(prefix)).toBe(true);
const payload = output.message.slice(prefix.length);
expect(payload.length).toBeLessThanOrEqual(500);
```

**MCP-08 application (token-count instead of char-count):**
```typescript
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { buildRecallResponse, trimToBudget } from "../envelope.js";

describe("MCP-08: token-budget post-trim ≤ 7,500", () => {
  it("worst-case recall envelope (25 hits × 4KB content) trims under 7,500 tokens", () => {
    // Build worst-case fixture matching D-10's specification:
    const worstCaseMemories = Array.from({ length: 25 }, (_, i) => ({
      id: `blk-${i}`,
      type: "research_note",
      content: "x".repeat(4_000),   // 4KB content
      summary: "y".repeat(1_000),   // 1KB summary
      properties: null, embedding_id: null,
      scope: "personal" as const, project_id: null,
      source: "mcp:test", confidence: 0.9,
      created_at: Date.now(), updated_at: Date.now(),
      snippet: null, match_column: null, score: null,
    }));
    const envelope = buildRecallResponse({ memories: worstCaseMemories, verbosity: "synthesis" });
    const trimmed = trimToBudget(envelope);
    const tokenCount = encode(JSON.stringify(trimmed)).length;
    expect(tokenCount).toBeLessThanOrEqual(7_500);
  });

  it("MCP-08: every tool description ≤ 1,500 bytes (UTF-8)", () => {
    // Capture descriptions via the McpServer.prototype.registerTool spy
    // (same pattern as tools.test.ts:67-84).
    const spy = vi.spyOn(McpServer.prototype, "registerTool");
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTools(server, () => undefined, {} as Env);
    const descs = spy.mock.calls.map(([, config]) => (config as { description?: string }).description ?? "");
    spy.mockRestore();
    for (const d of descs) {
      expect(new TextEncoder().encode(d).byteLength).toBeLessThanOrEqual(1_500);
    }
  });
});
```

**Deviations from analog:**
- `error-mapping.test.ts` uses `.length` on a string (character count). `token-budget.test.ts` uses `encode(JSON.stringify(...)).length` (BPE token count). The "compute → assert under threshold" structure is identical; the metric differs.
- The MCP-08 description-size assertion uses `new TextEncoder().encode(desc).byteLength` per research Anti-Patterns (workerd-native; do NOT use `Buffer.byteLength`).

---

### `packages/mcp-server/src/__tests__/tools.test.ts` (EXTEND — happy-path assertions per tool)

**Analog:** itself — current file (lines 108-140) tests the Phase 3 negative path (MethodNotFound stubs).

**Current pattern (`tools.test.ts:108-140`):**
```typescript
describe("MethodNotFound stubs (D-05 phase-pinned messages)", () => {
  it.each([
    ["remember", "TOL-01"], ["recall", "TOL-02"], ["search", "TOL-03"],
    ["forget", "TOL-04"], ["ingest", "TOL-05"],
  ])("%s throws McpError(MethodNotFound) with 'Phase 3' + '%s' message", async (toolName, tolId) => {
    const calls = captureRegistrations();
    const match = calls.find((c) => c.name === toolName);
    // ...
    expect((caught as McpError).code).toBe(ErrorCode.MethodNotFound);
    expect((caught as McpError).message).toContain("Phase 3");
    expect((caught as McpError).message).toContain("Phase 4");
    expect((caught as McpError).message).toContain(tolId);
  });
});
```

**Phase 4 replacement — invert from MethodNotFound to happy-path:**
```typescript
describe("Phase 4 happy-path callbacks (TOL-01..05)", () => {
  it.each([
    ["remember", { content: "hello" }],
    ["recall",   { query: "x" }],
    ["search",   { query: "x" }],
    ["forget",   { id: "nonexistent" }],
    ["ingest",   { source: "https://example.com" }],
  ])("%s callback returns wrapped EngramResponse envelope", async (toolName, args) => {
    // Capture callback with a real props injection
    const cb = captureCallback(toolName, "ws-happy-path");
    const result = await cb(args, {}) as { content: [{ type: "text"; text: string }] };
    expect(result).toHaveProperty("content");
    const env = JSON.parse(result.content[0].text);
    expect(env).toHaveProperty("result");
    expect(env).toHaveProperty("context");
    expect(env).toHaveProperty("meta");
  });
});
```

**Load-bearing elements that MUST survive Phase 4 edits:**
- The DD-RT sentinel-anchor test (`tools.test.ts:147-155`) — keeps the structural read-the-live-source contract.
- The `args.workspace_id` negative-presence test (`tools.test.ts:166-182`) — Phase 4 production code does NOT reference `args.workspace_id` so this stays GREEN automatically.
- The registration-shape test (`tools.test.ts:90-106`) — stays unchanged; Phase 4 keeps registration shapes byte-stable.

**Deviations from analog:** the MethodNotFound block (lines 108-140) is REMOVED and replaced with the happy-path block above. The McpError-MethodNotFound assertions become contradictory once the bodies are real.

---

### `packages/mcp-server/src/__tests__/error-mapping.test.ts` (EXTEND — regression locks)

**Analog:** itself — the existing tests at lines 32-95 are the canonical pattern. Phase 4 ADDS rows; nothing is removed.

**Phase 4 additions (per "Wave 0 Gaps" in VALIDATION):**

```typescript
describe("Phase 4 regression locks", () => {
  it("mapToMcpError(new NotFoundError('block', 'x')) returns McpError(InvalidParams)", () => {
    // This row likely already exists at lines 39-47 — confirm and tighten.
    const result = mapToMcpError(new NotFoundError("block", "x"));
    expect(result.code).toBe(ErrorCode.InvalidParams);
    expect(result.code).toBe(-32602);
  });

  it("mapToMcpError sanitizes /Users/... paths (T-03-LEAK regression lock)", () => {
    // Likely exists at lines 68-73 — confirm coverage is the regression
    // intent (the test is asserting Phase 4 handlers will never leak paths
    // when wrapping DO exceptions).
    const out = mapToMcpError(new Error("/Users/secret/path/file.ts"));
    expect(out.message).not.toContain("/Users/");
  });
});
```

**Deviations from analog:** none — pure additions. The existing 7 cases cover the surface; Phase 4 just makes explicit that these are LOCKED regressions for Phase 4 handler safety.

---

### `scripts/smoke-job-agent.mjs` (NEW, OPTIONAL — TOL-08 smoke)

**Analog:** `scripts/smoke-wrangler-dev.sh`

**Why this analog:** Same role (boot `wrangler dev` + verify health), same scope (smoke-only, not unit-tested), same directory. Research §Open Question 4 RECOMMENDS using `npx @modelcontextprotocol/inspector` recorded as `04-MCP-INSPECTOR-SMOKE.md` instead of writing a node script — meaning this file MAY NOT SHIP. If the planner chooses to write the script, the analog below is the file-shape template.

**Pattern (`smoke-wrangler-dev.sh:1-65`):**
- Header: `#!/usr/bin/env bash` (this script is `.sh`; the new one is `.mjs` so use `#!/usr/bin/env node`).
- Lead comment block with `Usage:` line and portability notes.
- `set -euo pipefail` equivalent in node = `process.exit(1)` on error.
- Background wrangler boot + curl poll loop pattern.

**Lift the boot-and-poll structure (`smoke-wrangler-dev.sh:37-54`):**
```bash
npx wrangler dev --config "${CONFIG}" --port "${PORT}" &
WRANGLER_PID=$!
trap 'kill ${WRANGLER_PID} 2>/dev/null || true' EXIT
DEADLINE=$((SECONDS + 30))
while (( SECONDS < DEADLINE )); do
  if curl -sf "http://localhost:${PORT}" >/dev/null 2>&1; then ... break; fi
  sleep 1
done
```

**Node port of the same shape (if planner chooses to write the script):**
```javascript
#!/usr/bin/env node
// scripts/smoke-job-agent.mjs
// TOL-08 smoke: wrangler dev + MCP round-trip via @modelcontextprotocol/sdk client.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const wrangler = spawn("npx", ["wrangler", "dev", "--port", "8787"], { stdio: "inherit" });
process.on("exit", () => wrangler.kill());
// ... poll until ready ... then exercise remember → recall → forget
```

**Deviations from analog:** the smoke-wrangler-dev.sh script verifies HTTP 200; smoke-job-agent.mjs must additionally exercise an MCP tool round-trip. Research RECOMMENDS the simpler MCP Inspector path — recorded as a `.md` artifact (mirror Phase 3's `03-MCP-INSPECTOR-SMOKE.md`).

---

## Shared Patterns

### S1. Module JSDoc Header (Cross-Phase Contract Format)

**Source:** `packages/mcp-server/src/error-mapping.ts:1-39`
**Apply to:** every new prod file (`envelope.ts`) and every new test file (`envelope.test.ts`, `tools-integration.test.ts`, `cross-workspace-pentest.test.ts`, `token-budget.test.ts`).

```typescript
/**
 * `<symbol>` — <one-line purpose>.
 *
 * Cross-phase contract:
 * - **Phase 2 STO-07 ...:** <how this file interacts with Phase 2>
 * - **Phase 3 D-NN ...:** <how this file interacts with Phase 3>
 * - **Phase 4 (TOL-0N):** <what this file ships>
 *
 * Design notes (locked):
 * - <pinned-decision bullet 1>
 * - <pinned-decision bullet 2>
 *
 * Threat model:
 * - **T-04-XX (<STRIDE-category>)** — mitigated by <how>
 *
 * @module @engram/<package>/<filename>
 */
```

### S2. Named-Only Exports, No Default

**Source:** every existing file under `packages/mcp-server/src/` and `packages/workspace-do/src/`.
**Apply to:** `envelope.ts` (5 builders + `trimToBudget` + `wrapMcpContent` + `META_GAPS` — all named).

**Anti-pattern:** `export default ...`. The repo-wide convention is named exports for tree-shake-friendliness and explicit-import-site readability.

### S3. `// Source: ...` Provenance Comment

**Source:** `packages/mcp-server/src/tools.ts:67-68`, `packages/mcp-server/src/error-mapping.ts:40-43`, `packages/workspace-do/src/queries.ts` (top of every helper).

```typescript
// packages/mcp-server/src/envelope.ts
// Source: 04-CONTEXT.md D-04/D-06/D-07/D-08/D-10 + spike-findings-engram §"meta.gaps is load-bearing".
```

Apply to every new prod file: lets reviewers trace each module back to the locked decision that prescribed it.

### S4. Defense-in-Depth Invariant Read-from-Props

**Source:** `tools.ts:111-117` + `tools.ts:142` (comment) + structural test at `tools.test.ts:166-182`.

```typescript
// Defense-in-depth (T-03-DD-RT / MCP-05 / Phase 2 STO-07):
//   The workspace_id is ALWAYS sourced from `props.workspace_id` (JWT-
//   derived), NEVER from args (tool input).
stub.<method>({
  workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args
  ...
});
```

Apply to all 5 Phase 4 tool handler bodies. CI breaks if violated.

### S5. Single `await getAgentByName(...)` Per Handler

**Source:** `tools.ts:131-149` comment block + research §Pitfall 1.

```typescript
const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);  // ← ONE await
stub.insertBlock({ workspace_id: props.workspace_id, block });          // ← sync RPC call (NO await)
```

Apply to all 5 handlers. If a handler has zero `await`s, the stub call will fail at runtime (`stub.insertBlock is not a function` on the unresolved Promise). If a handler has two `await`s, the second is wasted (the DO RPC layer auto-marshals).

### S6. McpServer.prototype.registerTool Spy for Callback Capture

**Source:** `packages/mcp-server/src/__tests__/tools.test.ts:67-84`.

```typescript
function captureRegistrations(): RegisteredToolCall[] {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    registerTools(server, () => undefined, {} as unknown as Env);
    return spy.mock.calls.map(/* ... */);
  } finally {
    spy.mockRestore();
  }
}
```

Apply to: `tools-integration.test.ts`, `cross-workspace-pentest.test.ts` (Prong A), `token-budget.test.ts` (description-size case), and the extended `tools.test.ts` happy-path block. The pattern lets tests invoke handler callbacks directly without going through the MCP transport / OAuth bridge.

### S7. `runInDurableObject` for Real-DO Round-Trips

**Source:** `packages/workspace-do/src/__tests__/helpers.test.ts:21-30, 64-87`.

```typescript
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";

const workspace_id = "ws-<test-name>";
const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(workspace_id));
await runInDurableObject(stub, (instance) => {
  const ws = asWorkspaceDO(instance);
  // ... sync DO method calls inside ...
});

function asWorkspaceDO(instance: unknown): WorkspaceDO {
  return instance as WorkspaceDO;
}
```

Apply to: `cross-workspace-pentest.test.ts` Prong B. Optionally also `tools-integration.test.ts` if the integration test wants to set up state via direct DO calls before invoking the handler.

### S8. `mapToMcpError` Funnel in Every Handler `catch`

**Source:** `packages/mcp-server/src/error-mapping.ts:57-73` + `tools.ts:146-148` (Phase-4-ready comment).

```typescript
try {
  // ... handler body ...
} catch (err) {
  throw mapToMcpError(err);
}
```

Apply to all 5 Phase 4 handler bodies. No ad-hoc `{ error: "..." }` envelopes; no inline `new McpError(...)` constructions outside the centralized funnel; never re-throw raw `Error` instances.

---

## No Analog Found

| File | Role | Why No Direct Analog |
|------|------|---------------------|
| (none) | — | Every Phase 4 file maps to at least one existing analog. The closest "no analog" case is `envelope.ts`, but its file-shape analog (`error-mapping.ts`) and contract analog (`shared/types/src/index.ts` `EngramResponse<T>`) together give a complete pattern. |

---

## Metadata

**Analog search scope:**
- `packages/mcp-server/src/` (5 prod files + 5 test files)
- `packages/workspace-do/src/` (queries.ts, errors.ts, types.ts, index.ts, 4 test files)
- `shared/types/src/index.ts`
- `scripts/` (5 .sh + .mjs files)
- Repo-root `README.md`, `package.json`

**Files scanned:** 24 (every file `git ls-files` returns under the scope directories that matches the new-file role profiles).

**Pattern extraction date:** 2026-05-26

**Confidence:** HIGH — every analog is verified via direct Read, every line number cited resolves under `git ls-files`, every code excerpt is byte-stable against the live source.

---

*Phase: 04-core-tools-envelope*
*Pattern map produced 2026-05-26 by gsd-pattern-mapper*
