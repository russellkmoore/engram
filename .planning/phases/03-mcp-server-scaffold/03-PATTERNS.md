# Phase 3: MCP Server Scaffold — Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 10 CREATE + 3 MODIFY = 13 file decisions
**Analogs found:** 13 / 13
- **In-repo analogs (high-leverage):** 8 — every config/test-harness file has a Phase 1 or Phase 2 sibling that should be mirrored byte-for-byte where possible.
- **In-repo + external supplement:** 3 — `index.ts`, `tools.ts`, `error-mapping.ts` start from in-repo Phase 1/2 stubs but the bodies follow `03-RESEARCH.md §Patterns 1–5` (`@cloudflare/workers-oauth-provider` + `agents/mcp` integration).
- **External only (no in-repo analog yet):** 2 — `oauth.ts` (no OAuth wiring exists anywhere in repo) and `README.md` (DEP-05 OAuth + mcp-remote setup is wholly new content).

---

## Phase 3 Special Note

Phase 3 is **structurally a "wire two libraries together" phase** — the heavy infrastructure (TS toolchain, vitest pool, wrangler.jsonc conventions, FND-08 lint, defense-in-depth contract) all landed in Phases 1–2. The planner should preferentially copy in-repo Phase 1/2 patterns rather than re-derive from `03-RESEARCH.md`.

The five places where Phase 1/2 has **no analog** and the planner must follow `03-RESEARCH.md` instead:

| Novelty | What to follow instead |
|---------|-----------------------|
| `src/oauth.ts` — OAuthProvider `defaultHandler` with `/authorize` + KV lookup | `03-RESEARCH.md §Pattern 3` (verbatim ~60-line example) |
| `src/index.ts` body — `OAuthProvider` default export + `EngramMcp.serve("/mcp")` | `03-RESEARCH.md §Pattern 1 + Pattern 2` (verbatim ~30 + ~15-line examples) |
| `src/tools.ts` — 5 `server.registerTool(name, { inputSchema }, cb)` stubs throwing `McpError(MethodNotFound)` | `03-RESEARCH.md §Pattern 4` (verbatim ~90-line example) + Phase 4-ready comment block from §Pattern 5 |
| `src/schemas.ts` — 5 zod schemas matching `@engram/types` shapes, **NO `workspace_id` field** | `03-RESEARCH.md §Example 1` (verbatim ~50-line example) |
| `README.md` — DEP-05 OAuth flow + `mcp-remote` setup + MCP Inspector smoke | `03-RESEARCH.md §Example 4` (Claude Desktop config) + §Pattern 7 (Inspector smoke) — no in-repo README is content-similar |

Everything else (the vitest config, the wrangler.test.jsonc, the wrangler.jsonc v2 migration entry, the package.json deps additions, the test file structure) is a **direct mirror** of an existing Phase 2 file in `packages/workspace-do/`.

---

## File Classification

### CREATE (10 files)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/mcp-server/src/schemas.ts` | type/data — zod schema constants | data/config (sync) | `shared/schema/src/system-types.ts` (data-as-constants module style); zod content from `03-RESEARCH.md §Example 1` | role-match (in-repo style) + external verbatim (content) |
| `packages/mcp-server/src/tools.ts` | tool registration table | request-response (stub) | `03-RESEARCH.md §Pattern 4` (no in-repo analog — registerTool API is novel) | external verbatim |
| `packages/mcp-server/src/oauth.ts` | OAuth `defaultHandler` Worker fetch handler | request-response (HTTP, KV lookup) | `03-RESEARCH.md §Pattern 3` (no in-repo analog — first OAuth wiring in the repo) | external verbatim |
| `packages/mcp-server/src/error-mapping.ts` | error converter (exception → McpError) | exception transform (sync) | `packages/workspace-do/src/errors.ts` (sibling: small single-purpose module with focused JSDoc) + `03-RESEARCH.md §Example 2` (function body) | role-match (style) + external (body) |
| `packages/mcp-server/wrangler.test.jsonc` | test-only wrangler config | test infra (config) | `packages/workspace-do/wrangler.test.jsonc` (sibling — exact-template) | **exact-template** — mirror byte-for-byte with binding swaps |
| `packages/mcp-server/vitest.config.ts` | vitest pool config | test infra (config) | `packages/workspace-do/vitest.config.ts` (sibling — exact-template; can simplify to single workerd project — no node-pool tests needed) | **exact-template** |
| `packages/mcp-server/test/schemas.test.ts` (or `src/__tests__/schemas.test.ts`) | zod-schema-shape unit test | test (structural) | `packages/workspace-do/src/__tests__/seeding.test.ts` (sibling: `describe`/`it` + import shape) | role-match (test structure) |
| `packages/mcp-server/test/tools.test.ts` | MethodNotFound stub-handler test | test (assertion on thrown McpError) | `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` (sibling: try/catch + `instanceof McpError` + `code === ErrorCode.X` shape — the canonical "assert McpError thrown" pattern in this repo) | **exact-template** for the McpError assertion shape |
| `packages/mcp-server/test/oauth.test.ts` | KV-lookup props plumbing test | test (mock/contract) | `packages/workspace-do/src/__tests__/helpers.test.ts` (sibling: workerd-pool test using `runInDurableObject` + `env`) — but the OAuth `/authorize` flow may need an HTTP-level test against the `defaultHandler.fetch` interface | partial — test structure mirrors, the OAuthProvider mock surface is novel |
| `packages/mcp-server/test/index.test.ts` | integration: McpAgent + OAuthProvider wiring | test (HTTP + workerd) | `packages/workspace-do/src/__tests__/schema.test.ts` (sibling: minimal cold-start assertion shape) — but the assertion target (tool listing via MCP) is novel | partial |
| `packages/mcp-server/README.md` | DEP-05 setup docs | docs | `README.md` (root — only README in repo; provides ToC + Getting Started + status section style) + `03-RESEARCH.md §Example 4` (Claude Desktop config snippet) + §Pattern 7 (MCP Inspector smoke) | partial — overall style from root README, content is wholly new |
| `scripts/kv-bootstrap.mjs` | one-shot ENGRAM_IDENTITIES KV seeder | script (CLI) | `scripts/smoke-wrangler-dev.sh` (sibling — but it's bash, not mjs); `scripts/lint-wrangler.mjs` (sibling for `.mjs` style: shebang-less, `import` ESM, `process.argv.slice(2)`, exit-code matrix) | partial — script structure from lint-wrangler.mjs; content (wrangler kv CLI call) is novel |

### MODIFY (3 files)

| Modified File | Change | Closest Analog (existing form) |
|---------------|--------|--------------------------------|
| `packages/mcp-server/src/index.ts` | REPLACE Phase 1 stub body with `EngramMcp` registering tools + `OAuthProvider` default export | Current Phase 1 stub (this file) shows the import shape + class skeleton; `03-RESEARCH.md §Pattern 1 + §Pattern 2` provides the new body |
| `packages/mcp-server/wrangler.jsonc` | ADD v2 migration entry + `OAUTH_KV` + `ENGRAM_IDENTITIES` KV bindings; remove Phase 1 "deferred to v2" JSDoc | Current `packages/mcp-server/wrangler.jsonc` v1 entry is the in-place template; `03-RESEARCH.md §Pattern 6` documents the v2 entry shape; `packages/workspace-do/wrangler.test.jsonc` lines 33-36 show the `new_sqlite_classes` array format |
| `packages/mcp-server/package.json` | ADD `@cloudflare/workers-oauth-provider@0.7.0` + `zod@^4`; ADD test scripts + devDeps | `packages/workspace-do/package.json` (sibling — already has `vitest` + `@cloudflare/vitest-pool-workers` devDeps + `"test": "vitest run"` script) — copy that block verbatim |
| `package.json` (root, optional) | ADD `kv:bootstrap` workspace script | Existing root `package.json` scripts block — mirror the `dev:mcp` / `lint:wrangler` patterns |

---

## Pattern Assignments

### 1. `packages/mcp-server/src/schemas.ts` (NEW — type/data, zod constants)

**Analog (style):** `shared/schema/src/system-types.ts` — sibling data-as-constants module exporting an array of fully-typed records. The convention is: top-of-file JSDoc explaining purpose + cross-phase contract notes, named exports for each schema, `z.infer` type aliases alongside each schema export.

**Body source:** `03-RESEARCH.md §Code Examples → Example 1` (lines 731–794) — copy verbatim, including the **CRITICAL DEFENSE-IN-DEPTH CONTRACT** header comment. This header is load-bearing for STO-07 / MCP-05 — a future contributor adding `workspace_id` to any schema below breaks the defense-in-depth invariant.

**Mandatory header comment** (verbatim from RESEARCH.md):

```typescript
// packages/mcp-server/src/schemas.ts
// Source: D-06 — single source of truth for tool input shapes.
//         The zod schemas mirror @engram/types shapes where possible.
//
// CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
// NONE of these schemas declares a `workspace_id` field. The workspace
// is derived from the JWT's `this.props.workspace_id` at the handler level,
// NEVER from tool input. A future contributor adding `workspace_id` to any
// schema below is breaking the defense-in-depth invariant.

import { z } from "zod";
```

**Schema shape (5 schemas, all exported individually + as `z.infer` types):** `RememberInputSchema`, `RecallInputSchema`, `SearchInputSchema`, `ForgetInputSchema`, `IngestInputSchema`. See RESEARCH.md §Example 1 lines 749–793 for verbatim definitions.

**Rationale for analog choice:** `shared/schema/src/system-types.ts` is the only in-repo module that exports "schema-as-data" — a parallel to schemas-as-zod-constants. The style (top-of-file JSDoc, ordered exports, type aliases per export) is reused for consistency across data-constant modules.

---

### 2. `packages/mcp-server/src/tools.ts` (NEW — tool registration, stub handlers)

**Analog:** No in-repo precedent. `03-RESEARCH.md §Pattern 4` (lines 412–521) is the verbatim source.

**Critical structure to copy verbatim:**

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  RememberInputSchema, RecallInputSchema, SearchInputSchema,
  ForgetInputSchema, IngestInputSchema,
} from "./schemas.js";
import type { EngramProps } from "./index.js";

export function registerTools(
  server: McpServer,
  getProps: () => EngramProps | undefined,
  _env: Env,
): void {
  server.registerTool(
    "remember",
    {
      description: "Store a memory in the user's workspace. ...",
      inputSchema: RememberInputSchema.shape,
    },
    async (_args, _extra) => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "remember not implemented in Phase 3 — ships in Phase 4 (TOL-01)",
      );
    },
  );
  // ... 4 more identical-shape registrations ...
  void getProps;  // suppress unused-var until Phase 4 fills handlers
}
```

**Mandatory Phase-4-ready comment block above the stubs** (from `03-RESEARCH.md §Pattern 5`, lines 523–552):

```typescript
// Documented above the stubs in tools.ts.
// Source: VERIFIED against node_modules/agents/dist/.../getAgentByName signature
//         (returns Promise<DurableObjectStub<T>> — MUST be awaited)
//
// Phase-4-ready handler shape for `remember` (others mirror this):
//
//   async (args, _extra) => {
//     const props = getProps();
//     if (props === undefined) {
//       throw new McpError(ErrorCode.InvalidRequest, "Missing authentication context");
//     }
//     try {
//       const stub = await getAgentByName(env.WORKSPACE, props.workspace_id);
//       stub.insertBlock({
//         workspace_id: props.workspace_id,  // ALWAYS from props, NEVER from args
//         block: { ...derived from args... },
//       });
//       return { content: [{ type: "text", text: "..." }] };
//     } catch (err) {
//       throw mapToMcpError(err);  // src/error-mapping.ts
//     }
//   }
```

**WorkspaceDO method signatures Phase 4 will route to** — extracted from `packages/workspace-do/src/index.ts` lines 163–206:

```typescript
insertBlock(args: { workspace_id: string; block: Memory }): void
getBlock(args: { workspace_id: string; id: string }): Memory
lexicalSearchBlocks(args: { workspace_id: string; query: string; limit?: number }): LexicalSearchHit[]
deleteBlock(args: { workspace_id: string; id: string; cascade?: boolean }): { blocks_deleted: number; relations_deleted: number }
listMemoryTypes(args: { workspace_id: string }): MemoryType[]
createInboxEntry(args: { workspace_id: string; entry: InboxEntry }): void
listConflicts(args: { workspace_id: string; resolved?: boolean; limit?: number }): Conflict[]
```

**Critical: Every method takes `args` whose first field is `workspace_id: string`.** Phase 3 stubs do not call these, but the Phase-4-ready comment must document the contract verbatim so Phase 4's diff-against-this-shape pattern works.

**Rationale for analog choice:** No in-repo file registers MCP tools. Pattern 4 in RESEARCH.md is the verified source (against `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`).

---

### 3. `packages/mcp-server/src/oauth.ts` (NEW — OAuth defaultHandler)

**Analog:** No in-repo precedent. `03-RESEARCH.md §Pattern 3` (lines 324–410) is the verbatim source.

**Critical structure to copy verbatim:**

```typescript
import type { ExportedHandler } from "@cloudflare/workers-types";

interface IdentityRecord {
  workspace_id: string;
  user_id: string;
}

export const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    // /  → project info JSON (no auth) — D-08
    if (url.pathname === "/") { ... }

    // /health → status JSON (no auth) — D-08
    if (url.pathname === "/health") { ... }

    // /authorize → KV lookup + completeAuthorization (D-04)
    if (url.pathname === "/authorize") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
      const sub = oauthReqInfo.clientId;  // v0.1 simplification — see Open Question 3
      const raw = await env.ENGRAM_IDENTITIES.get(sub);
      if (raw === null) {
        return new Response(`Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.`, { status: 403 });
      }
      const identity = JSON.parse(raw) as IdentityRecord;
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: identity.user_id,
        metadata: { label: "engram-v0.1" },
        scope: ["mcp:tools"],
        props: {
          workspace_id: identity.workspace_id,
          user_id: identity.user_id,
        },
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

**Env interface fields** (the Phase 3 final shape — see `03-CONTEXT.md` "Claude's Discretion → Worker `Env` interface shape"):

| Field | Type | Source |
|-------|------|--------|
| `WORKSPACE` | `DurableObjectNamespace<WorkspaceDO>` | wrangler.jsonc `durable_objects.bindings` |
| `MCP_OBJECT` | `DurableObjectNamespace<EngramMcp>` | wrangler.jsonc `durable_objects.bindings` |
| `ENGRAM_IDENTITIES` | `KVNamespace` | wrangler.jsonc `kv_namespaces` (added in this phase) |
| `OAUTH_KV` | `KVNamespace` | wrangler.jsonc `kv_namespaces` (added in this phase) |
| `OAUTH_PROVIDER` | `OAuthHelpers` | library-injected at runtime |
| `COOKIE_ENCRYPTION_KEY` | `string` | `wrangler secret put` (NEVER in wrangler.jsonc) |

**Open Questions to address during execution** (from RESEARCH.md §Open Questions 1, 3, 6): the `sub` claim's source for `mcp-remote`'s dynamic-registered client is unverified. Wave 0 must run `/authorize` once and observe the actual `sub` value before the KV bootstrap script is meaningful.

**Rationale for analog choice:** OAuth wiring is wholly new to the repo. The RESEARCH.md example is verified against the `@cloudflare/workers-oauth-provider` README.

---

### 4. `packages/mcp-server/src/error-mapping.ts` (NEW — exception → McpError)

**Analog (style):** `packages/workspace-do/src/errors.ts` (lines 1–37) — sibling small single-purpose module with concentrated top-of-file JSDoc. Same conventions: explicit cross-phase contract notes in JSDoc, named exports only, no default export.

**Body source:** `03-RESEARCH.md §Code Examples → Example 2` (lines 796–832) — copy verbatim.

**Mandatory body structure:**

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { NotFoundError } from "@engram/workspace-do";

export function mapToMcpError(err: unknown): McpError {
  // Pass through McpError unchanged (e.g., assertOwnsWorkspace's McpError(InvalidRequest)).
  if (err instanceof McpError) return err;

  // NotFoundError → InvalidParams (-32602)
  if (err instanceof NotFoundError) {
    return new McpError(ErrorCode.InvalidParams, err.message);
  }

  // Anything else → InternalError (-32603) with sanitized message.
  const message = err instanceof Error ? err.message : "Internal error";
  return new McpError(ErrorCode.InternalError, sanitize(message));
}

function sanitize(message: string): string {
  return message
    .replace(/\/Users\/[^\s]+/g, "<path>")
    .replace(/[a-f0-9]{32,}/g, "<hex>")
    .slice(0, 500);
}
```

**JSDoc style to mirror from `packages/workspace-do/src/errors.ts`:**

```typescript
/**
 * `mapToMcpError` — single exception → McpError converter for all tool handlers.
 *
 * Cross-phase contract: ...
 *
 * Design notes (locked):
 * - Pass-through preserves `assertOwnsWorkspace`'s McpError(-32600 InvalidRequest)
 *   from Phase 2 STO-07 unchanged.
 * - NotFoundError → InvalidParams (-32602) per Phase 3 D-09 error-mapping convention.
 * - Anything else → InternalError (-32603) sanitized (no stack traces, no DB internals).
 *
 * @module @engram/mcp-server/error-mapping
 */
```

**Rationale for analog choice:** `errors.ts` is the closest in-repo precedent for "small single-purpose error-domain module exported from a Worker package". The JSDoc style (load-bearing pin → cross-phase contract → design notes) is the established repo idiom.

---

### 5. `packages/mcp-server/wrangler.test.jsonc` (NEW — test-only wrangler config)

**Analog:** `packages/workspace-do/wrangler.test.jsonc` (lines 1–40) — **exact-template**, mirror byte-for-byte with binding swaps.

**Source file header to mirror (with one update):**

```jsonc
// packages/mcp-server/wrangler.test.jsonc
//
// TEST-ONLY Wrangler config used by @cloudflare/vitest-pool-workers to resolve
// MCP_OBJECT and WORKSPACE bindings inside test runs. This file is NOT used by
// `wrangler dev` or `wrangler deploy` — those use packages/mcp-server/wrangler.jsonc.
//
// Why a separate file (not a shared `wrangler.jsonc`):
//   1. The FND-08 lint glob is `packages/*/wrangler.jsonc` (literal filename —
//      see scripts/lint-wrangler.mjs line 37). The `.test.jsonc` suffix means
//      this file is NOT linted, by design.
//   2. Tests don't need the OAUTH_KV / ENGRAM_IDENTITIES KV bindings unless a
//      specific test exercises the /authorize KV flow (see oauth.test.ts —
//      may use `--unsafe.bindings` for KV mocks or test-only IDs).
//   3. `compatibility_date` is intentionally omitted — pool infers latest.
//
// FND-08 invariant: this file uses `new_sqlite_classes` (NOT `new_classes`).
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "engram-mcp-server-test",
  "main": "src/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "MCP_OBJECT", "class_name": "EngramMcp" },
      { "name": "WORKSPACE", "class_name": "WorkspaceDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["WorkspaceDO"] },
    { "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }
  ]
}
```

**Key differences from workspace-do's `wrangler.test.jsonc`:**

1. **Two DO bindings** (`MCP_OBJECT` + `WORKSPACE`) instead of one — because mcp-server hosts both.
2. **Two migrations** (v1 declares `WorkspaceDO`, v2 declares `EngramMcp`) — mirrors production wrangler.jsonc layout.
3. **KV bindings** for `OAUTH_KV` and `ENGRAM_IDENTITIES` may be optional or use test-only IDs depending on whether `oauth.test.ts` actually exercises the KV path.

**Rationale for analog choice:** `wrangler.test.jsonc` was newly introduced in Phase 2 (Plan 02-04 wave 0); the structure is established and the lint-glob-exclusion design rationale is documented in the comment header. The mcp-server version is a direct copy with binding swaps.

---

### 6. `packages/mcp-server/vitest.config.ts` (NEW — vitest pool config)

**Analog:** `packages/workspace-do/vitest.config.ts` (lines 1–76) — **exact-template** with simplification: Phase 3 needs only the **workerd** project (no node-pool tests like the STO-10 lint subprocess test).

**Simplified single-project shape:**

```typescript
/**
 * Vitest pool configuration for @engram/mcp-server.
 *
 * Single workerd project — every test under src/__tests__/ runs inside the
 * Cloudflare workerd runtime via @cloudflare/vitest-pool-workers. Unlike
 * @engram/workspace-do, there are NO node-pool subprocess tests (no lint
 * self-test for Phase 3).
 *
 * @module @engram/mcp-server/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
      }),
    ],
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

**Compare against `packages/workspace-do/vitest.config.ts:42-75` — that file uses `projects: [...]` because it has a node-pool lint test. Phase 3 collapses that to a flat config since all tests run in workerd.**

**Rationale for analog choice:** workspace-do's vitest.config.ts is the canonical in-repo vitest config. It runs `@cloudflare/vitest-pool-workers` against `wrangler.test.jsonc` — the exact pattern Phase 3 needs. The simplification (drop the `projects` wrapper) is the only adjustment.

---

### 7. Test files: `test/*.test.ts` (NEW, 4 files)

**Common pattern — copy these structural imports from `packages/workspace-do/src/__tests__/defense-in-depth.test.ts` lines 44–61:**

```typescript
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Type-coercion shim if a DO is exercised — same pattern as Phase 2.
function asEngramMcp(instance: unknown): EngramMcp {
  return instance as EngramMcp;
}
```

**Canonical "assert McpError thrown" shape (mirror from `defense-in-depth.test.ts:180–197`):**

```typescript
it("throws McpError(MethodNotFound) for stub handler", async () => {
  let caught: unknown = undefined;
  try {
    // invoke the tool stub somehow ...
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(McpError);
  expect((caught as McpError).code).toBe(ErrorCode.MethodNotFound);
  expect((caught as McpError).message).toContain("Phase 3");
  expect((caught as McpError).message).toContain("Phase 4");
});
```

**Per-file purpose:**

| File | Source pattern | Validates |
|------|----------------|-----------|
| `schemas.test.ts` | RESEARCH.md §Validation Architecture; structural assertion (no DO needed) | All 5 schemas parse valid input; structural check: `Object.keys(schema.shape).indexOf('workspace_id') === -1` for all 5 (MCP-05 defense-in-depth structural contract) |
| `tools.test.ts` | `defense-in-depth.test.ts:180–197` for the McpError shape; `helpers.test.ts:64–87` for the `runInDurableObject` shell | All 5 tools registered with the right name + zod schema; all 5 throw `McpError(MethodNotFound)` with phase-pinned message |
| `oauth.test.ts` | RESEARCH.md §Validation Architecture line 989 (MCP-04 mock); no perfect in-repo analog because OAuth flow is new | KV lookup contract: with KV entry present, `defaultHandler.fetch('/authorize')` calls `completeAuthorization` with the right `props`; with no entry, returns 403 |
| `index.test.ts` | `schema.test.ts:56–72` for cold-start assertion pattern + `helpers.test.ts` for the workerd shell | EngramMcp.init() registers exactly 5 tools by name; `server.listTools()` returns `[remember, recall, search, forget, ingest]` |

**Note on test path:** RESEARCH.md uses `src/__tests__/` (matching Phase 2 convention); the prompt mentions `test/` (top-level). The planner should match the **Phase 2 convention** (`src/__tests__/`) for consistency — the FND lint globs and tsconfig `include` are already set up for that path.

**Rationale for analog choice:** Phase 2's test suite is the only in-repo precedent for vitest + workerd-pool tests. The `try/catch` + `instanceof McpError` + `.code === ErrorCode.X` triplet in `defense-in-depth.test.ts` is the established "assert McpError thrown" shape — Phase 3's tool stub tests mirror it exactly with `MethodNotFound` swapped in for `InvalidRequest`.

---

### 8. `packages/mcp-server/README.md` (NEW — DEP-05 setup docs)

**Analog (style):** `README.md` (root, repo top-level — `/Users/rmoore/Workspaces/engram/README.md`). Mirror these sections:

| Root README section | mcp-server README section | Lines to mirror |
|---------------------|---------------------------|-----------------|
| `## Why Engram` | `## What This Worker Does` (1-paragraph) | lines 13–21 (paragraph + key inversion) |
| `## Tech Stack` table | (omit — covered in root README) | — |
| `## Status` | `## Phase Status` | lines 95–101 (milestone + roadmap link) |
| `## Getting Started → Prerequisites` | `## Prerequisites` | lines 107–110 (Node + npm + Cloudflare account) |
| `## Getting Started → Install and run` | `## Local Development` | lines 114–128 (`npm run dev:mcp` shape) |

**Content sources (new):**

| Section | Source |
|---------|--------|
| OAuth flow overview | `03-RESEARCH.md §Architecture → System Architecture Diagram` (lines 154–238) — copy the ASCII flow chart |
| Claude Desktop config | `03-RESEARCH.md §Example 4` (lines 862–891) — verbatim production + local-dev JSON snippets |
| MCP Inspector smoke | `03-RESEARCH.md §Pattern 7` (lines 596–622) — verbatim two-terminal shell session |
| KV bootstrap | `03-RESEARCH.md §Example 3` (lines 834–860) — verbatim instructions referencing `npm run kv:bootstrap` |
| `wrangler secret put COOKIE_ENCRYPTION_KEY` | RESEARCH.md §Pattern 6 (line 594) — single-line setup step |

**Rationale for analog choice:** The root README is the only README in the repo (Phases 1–2 added no package-level READMEs). DEP-05 requires a setup README; mirroring the root README's section structure keeps the repo voice consistent. The novel content (OAuth flow, mcp-remote setup, MCP Inspector smoke) comes from RESEARCH.md verbatim.

---

### 9. `scripts/kv-bootstrap.mjs` (NEW — KV seeder)

**Analog:** `scripts/lint-wrangler.mjs` (lines 1–92) — for the `.mjs` script style: shebang-less, ESM `import`, `process.argv.slice(2)` for args, exit-code matrix (0/1/2), `[tag:name]` prefixed log lines.

**Source pattern to mirror (script header):**

```javascript
// scripts/kv-bootstrap.mjs
// Source: D-04 — bootstrap script for ENGRAM_IDENTITIES KV namespace.
//
// Seeds Russell's OAuth subject → { workspace_id, user_id } mapping into KV
// so the OAuth /authorize hook can resolve props for v0.1 single-user flow.
//
// Usage: node scripts/kv-bootstrap.mjs --sub <oauth-sub> [--workspace-id <id>] [--user-id <id>]
//   - --sub: REQUIRED. The OAuth subject claim observed from first /authorize attempt.
//   - --workspace-id: defaults to "rmoore-personal"
//   - --user-id: defaults to "rmoore"
// Exit codes: 0 success | 1 missing arg | 2 wrangler kv put failed.

import { spawnSync } from "node:child_process";

// ... arg parsing mirroring lint-wrangler.mjs:24-49 ...
```

**Body content source:** `03-RESEARCH.md §Code Examples → Example 3` (lines 834–860) — the `npx wrangler kv key put` shell call gets wrapped in `child_process.spawnSync` for the .mjs version.

**Compare against `lint-wrangler.mjs:14`'s exit-code matrix comment:** `// Exit codes: 0 clean | 1 violation | 2 no files matched (full-scan canary only).` Mirror that documentation pattern.

**Rationale for analog choice:** `lint-wrangler.mjs` is the canonical in-repo `.mjs` script style. Its dual-mode CLI dispatch, JSDoc-style usage block, exit-code matrix, and `[tag]` log prefix are the established repo convention.

**Alternative:** Bash script (mirroring `scripts/smoke-wrangler-dev.sh`). Pick `.mjs` because Phase 3 has no other `.sh` additions and the lint-wrangler.mjs style is the more modern in-repo convention. Decide during planning.

---

### 10. `packages/mcp-server/src/index.ts` (MODIFY — REPLACE Phase 1 stub)

**Analog (existing form to replace):** Current `packages/mcp-server/src/index.ts` (lines 1–59) — Phase 1 stub. Three structural elements to preserve from the stub:

1. **Imports of `McpAgent` from `agents/mcp` and `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`** (lines 3–4) — keep verbatim.
2. **Export `class EngramMcp extends McpAgent`** with abstract `server` + `init()` (lines 17–27) — replace body, keep class shape.
3. **`export { WorkspaceDO } from "@engram/workspace-do"`** (line 30) — keep verbatim; wrangler's `WORKSPACE` binding resolves through this re-export.

**Three structural elements to REMOVE:**

1. **Phase 1 type-witness `Phase1Pong` interface + import comments** (lines 33–47) — Phase 3 replaces these with the real `EngramProps` interface (Pattern 1).
2. **No-op `init()` body** (lines 24–26) — Phase 3 calls `registerTools(this.server, () => this.props, this.env)` (Pattern 4).
3. **`export default { fetch() { ... } }`** (lines 49–58) — Phase 3 replaces with `export default new OAuthProvider({ ... })` (Pattern 2).

**Body source:** `03-RESEARCH.md §Pattern 1 (lines 261–296)` + `§Pattern 2 (lines 298–322)` — copy verbatim, combine into one file.

**Final file shape:**

```typescript
// packages/mcp-server/src/index.ts
// Phase 3: EngramMcp + OAuthProvider integration.
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import { registerTools } from "./tools.js";
import { defaultHandler } from "./oauth.js";

export interface EngramProps extends Record<string, unknown> {
  workspace_id: string;
  user_id: string;
}

export class EngramMcp extends McpAgent<Env, unknown, EngramProps> {
  server = new McpServer({ name: "engram-mcp-server", version: "0.1.0" });

  async init(): Promise<void> {
    registerTools(this.server, () => this.props, this.env);
  }
}

export { WorkspaceDO } from "@engram/workspace-do";

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: EngramMcp.serve("/mcp", { binding: "MCP_OBJECT" }),
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
```

**Rationale for analog choice:** The current `index.ts` is the Phase 1 sibling — it tells you EXACTLY what shape to start from. The body source is RESEARCH.md Patterns 1+2 (verified against installed `node_modules/`).

---

### 11. `packages/mcp-server/wrangler.jsonc` (MODIFY — add v2 + KV bindings)

**Analog (existing form to modify):** Current `packages/mcp-server/wrangler.jsonc` (lines 1–30) — Phase 1 v1 migration with deferred-to-v2 JSDoc.

**Three changes** (D-09 + RESEARCH.md §Pattern 6):

1. **REMOVE the "deferred to v2" JSDoc** at lines 22–26 (per D-09 acceptance criteria).
2. **ADD v2 migration entry** after the v1 entry:
   ```jsonc
   { "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }
   ```
3. **ADD `kv_namespaces` block** with two bindings:
   ```jsonc
   "kv_namespaces": [
     { "binding": "OAUTH_KV", "id": "<id-from-wrangler-kv-namespace-create>" },
     { "binding": "ENGRAM_IDENTITIES", "id": "<id-from-wrangler-kv-namespace-create>" }
   ]
   ```

**Final file shape:** `03-RESEARCH.md §Pattern 6` (lines 560–591) — copy verbatim.

**FND-08 lint constraint:** `scripts/lint-wrangler.mjs:75-83` checks that no `migration[i].new_classes` array is present. The v2 entry uses `new_sqlite_classes` (line 588 of RESEARCH.md example) — passes the lint by construction. **Verify `npm run lint:wrangler` exits 0 after the edit.**

**Wave 0 prerequisite:** `wrangler kv namespace create OAUTH_KV` and `wrangler kv namespace create ENGRAM_IDENTITIES` must run first (against the production Cloudflare account) to obtain the IDs. Document this in DEP-05 README (Pattern 8).

**`COOKIE_ENCRYPTION_KEY` secret:** NOT declared in wrangler.jsonc (would leak via the JSONC file). Set via `wrangler secret put COOKIE_ENCRYPTION_KEY` and read from `env.COOKIE_ENCRYPTION_KEY` at runtime. Document in README.

**Rationale for analog choice:** The current wrangler.jsonc is the in-place template. The Phase 2 D-07 forward-note explicitly told Phase 3 to add the v2 entry; D-09 ratifies the shape; Pattern 6 in RESEARCH.md gives the verbatim final state.

---

### 12. `packages/mcp-server/package.json` (MODIFY — add deps + test scripts)

**Analog (for test scripts + devDeps):** `packages/workspace-do/package.json` (lines 1–28) — sibling Worker package that ALREADY has vitest + `@cloudflare/vitest-pool-workers` + `"test": "vitest run"`.

**Block to copy from workspace-do/package.json:**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.16.9",
    "vitest": "^4.1.7"
  }
}
```

**Two production deps to ADD** (per RESEARCH.md Standard Stack):

```json
{
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "0.7.0",
    "zod": "^4"
  }
}
```

**Version pinning:** RESEARCH.md Pitfall 6 + Open Question A6 recommend **exact-pin `@cloudflare/workers-oauth-provider@0.7.0`** (not `^0.7.0`) because it's a pre-1.0 library. `zod@^4` is fine — Standard Schema interface keeps it forward-compatible.

**Final merged file** preserves the Phase 1 `dependencies` (agents, MCP SDK, @engram/* workspaces) and adds the new fields above.

**Rationale for analog choice:** workspace-do is the only Worker package in the repo with a vitest setup. Its package.json scripts + devDeps are the established pattern. Production deps come from RESEARCH.md verbatim with version pinning per pitfall guidance.

---

### 13. `package.json` (root, OPTIONAL — add kv:bootstrap script)

**Analog:** Current `package.json` (root) scripts block — see `npm run lint:wrangler` line 18, `npm run dev:mcp` line 24.

**Pattern to mirror:**

```json
{
  "scripts": {
    "lint:wrangler": "node scripts/lint-wrangler.mjs",
    "kv:bootstrap": "node scripts/kv-bootstrap.mjs"
  }
}
```

**Rationale:** Optional — depends on whether the planner decides to expose `kv:bootstrap` as a top-level `npm run` target. Lint and lint:blockconcurrency are exposed this way; following suit keeps the script discovery surface consistent.

---

## Shared Patterns

### A. Strict TypeScript posture (all new `.ts` files)

**Source:** `tsconfig.base.json` (referenced from `packages/mcp-server/tsconfig.json:2` and `packages/workspace-do/tsconfig.json:2`).

**Constraints to honor (from Phase 1 D-07 + Phase 2 D-01):**

| Constraint | Implication for Phase 3 |
|------------|-------------------------|
| `verbatimModuleSyntax` | Use `import type { ... }` for type-only imports; use `.js` extension on relative imports (already established) |
| `exactOptionalPropertyTypes` | Never pass `{ field: undefined }` to APIs typed as `{ field?: T }`. Build args conditionally — see `packages/workspace-do/src/index.ts:198-205` for the established pattern |
| `noUncheckedIndexedAccess` | `array[0]?.field` is the safe shape; raw `array[0].field` will not compile |
| TS-source `exports` (no build step) | All `.ts` files are consumed as-is via `exports.default = "./src/index.ts"`. No `dist/`, no `tsc -b --build` output |

**Source for the established `exactOptionalPropertyTypes` workaround** (`packages/workspace-do/src/index.ts:198–205`):

```typescript
// Build opts conditionally so we only pass defined keys — strict
// exactOptionalPropertyTypes forbids `{ key: undefined }` literals.
const opts: { resolved?: boolean; limit?: number } = {};
if (args.resolved !== undefined) opts.resolved = args.resolved;
if (args.limit !== undefined) opts.limit = args.limit;
```

Apply this in `oauth.ts` (`completeAuthorization` call) and `index.ts` (`OAuthProvider` constructor) if either uses optional fields. See `03-RESEARCH.md` for which fields are optional.

---

### B. JSDoc style for new modules

**Source:** `packages/workspace-do/src/index.ts:1–64` (the canonical multi-paragraph JSDoc) + `packages/workspace-do/src/errors.ts:1–27` (the minimal single-purpose JSDoc).

**Required sections at the top of every new `.ts` file:**

1. **One-line summary** describing the module's role
2. **Cross-phase contract notes** — what does this file's contract owe to Phase 1/2 (existing), or owe to Phase 4 (future)?
3. **Design notes (locked)** — load-bearing decisions with rationale (e.g., "no `cause: unknown` field", "throw on miss for single-row reads")
4. **Plan boundaries** — which plan in this phase owns which method (Phase 2 used this; Phase 3 may or may not, depending on plan decomposition)
5. **`@module` tag** at the end

**Example header for `schemas.ts`** (apply the same shape across all Phase 3 new files):

```typescript
/**
 * Zod input schemas for the 5 v0.1 MCP tools.
 *
 * Single source of truth (D-06) — Phase 4 handler bodies import these for
 * type-only checks, but DO NOT call `.parse()` (the SDK auto-validates via
 * `registerTool({ inputSchema }, cb)`).
 *
 * CRITICAL DEFENSE-IN-DEPTH CONTRACT (MCP-05 / Phase 2 STO-07):
 * NONE of these schemas declares a `workspace_id` field. The workspace
 * is derived from the JWT's `this.props.workspace_id` at the handler layer,
 * NEVER from tool input.
 *
 * Design notes (locked):
 * - Hand-written, no zod-to-ts / ts-to-zod (D-06 + Phase 1 D-07 — no build step).
 * - `z.infer<typeof X>` aliases for callers needing the parsed-output type.
 *
 * @module @engram/mcp-server/schemas
 */
```

---

### C. McpError convention (production + test code)

**Source for "throw McpError":** `packages/workspace-do/src/index.ts:139–146`.

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

**Source for "catch + assert McpError in tests":** `packages/workspace-do/src/__tests__/defense-in-depth.test.ts:180–197`.

```typescript
let caught: unknown = undefined;
try {
  ws.listMemoryTypes({ workspace_id: "ws-bob" });
} catch (err) {
  caught = err;
}
expect(caught).toBeInstanceOf(McpError);
expect((caught as McpError).code).toBe(ErrorCode.InvalidRequest);
expect((caught as McpError).message).toContain("ws-alice");
expect((caught as McpError).message).toContain("ws-bob");
```

**Apply to ALL Phase 3 tool handler tests** (`tools.test.ts`). The error message must contain "Phase 3" AND "Phase 4" (the phase-pinned message from D-05).

---

### D. Cloudflare workerd test shell (workerd-pool tests)

**Source:** `packages/workspace-do/src/__tests__/helpers.test.ts:64–87`.

```typescript
it("describe behavior X", async () => {
  const workspace_id = "ws-...";  // OR for Phase 3 MCP tests: a session name
  const id = env.WORKSPACE.idFromName(workspace_id);  // OR env.MCP_OBJECT.idFromName(sessionName)
  const stub = env.WORKSPACE.get(id);
  await runInDurableObject(stub, (instance, state) => {
    const ws = asWorkspaceDO(instance);
    // ... assertions ...
  });
});
```

**Apply to:** `tools.test.ts`, `oauth.test.ts`, `index.test.ts` if those tests need to exercise the live `EngramMcp` DO (the `MCP_OBJECT` binding declared in wrangler.test.jsonc).

**`schemas.test.ts` does NOT use this shell** — it's a pure unit test asserting `Object.keys(schema.shape).indexOf('workspace_id') === -1` for each of the 5 schemas. No DO needed.

---

### E. `.test.jsonc` excluded from FND-08 lint

**Source:** `scripts/lint-wrangler.mjs:37` — `fg("packages/*/wrangler.jsonc")` glob is literal `wrangler.jsonc`, not `*.jsonc`. The `.test.jsonc` suffix is the established convention for "test-only config that bypasses the FND-08 lint".

**Apply to:** `packages/mcp-server/wrangler.test.jsonc` — by naming convention, the lint will not match it. **No code change to `lint-wrangler.mjs` is needed in Phase 3.**

The Phase 2 `wrangler.test.jsonc` header documents this design rationale in lines 1–25 — copy the same explanatory block into Phase 3's `wrangler.test.jsonc`.

---

### F. Cross-package imports use `@engram/*` workspace alias

**Source:** Existing `packages/mcp-server/src/index.ts:8–12` — `import type { ... } from "@engram/types"`, `import { SYSTEM_TYPES } from "@engram/schema"`, and `export { WorkspaceDO } from "@engram/workspace-do"`.

**Apply to Phase 3 imports:**

| File | Import | From |
|------|--------|------|
| `tools.ts` | type-only `EngramProps` | `./index.js` |
| `tools.ts` | `RememberInputSchema` etc. | `./schemas.js` |
| `error-mapping.ts` | `NotFoundError` | `@engram/workspace-do` |
| `oauth.ts` | `OAuthHelpers` type | `@cloudflare/workers-oauth-provider` |
| `index.ts` | `WorkspaceDO` re-export | `@engram/workspace-do` |

The `.js` extension on relative imports is mandatory (`verbatimModuleSyntax`); workspace alias imports don't use the extension.

---

## No Analog Found

Files with **no close in-repo match**. The planner uses RESEARCH.md verbatim instead.

| File | Role | Data Flow | Why No Analog |
|------|------|-----------|---------------|
| `packages/mcp-server/src/oauth.ts` | OAuth defaultHandler | request-response (HTTP + KV) | No OAuth wiring exists anywhere in repo; first instance of `@cloudflare/workers-oauth-provider`. Use `03-RESEARCH.md §Pattern 3` (lines 324–410) verbatim. |
| `packages/mcp-server/src/tools.ts` | MCP tool registration | request-response (stub throws) | No MCP tool registration exists in repo; first instance of `McpServer.registerTool`. Use `03-RESEARCH.md §Pattern 4` (lines 412–521) verbatim. |
| `packages/mcp-server/README.md` | DEP-05 setup docs | docs | No package-level README in any package directory; only root `/README.md`. Style mirrors root; content from RESEARCH.md §Pattern 7 + §Example 4. |

---

## Metadata

**Analog search scope:**
- `/Users/rmoore/Workspaces/engram/packages/mcp-server/` (Phase 1 stub + wrangler.jsonc + package.json + tsconfig.json)
- `/Users/rmoore/Workspaces/engram/packages/workspace-do/` (Phase 2 full implementation — every file inspected)
- `/Users/rmoore/Workspaces/engram/scripts/` (all 4 scripts: 2 lint, 2 smoke)
- `/Users/rmoore/Workspaces/engram/shared/types/` and `shared/schema/` (referenced by RESEARCH.md for canonical shapes)
- `/Users/rmoore/Workspaces/engram/README.md` (root, only README in repo)
- `/Users/rmoore/Workspaces/engram/.planning/phases/01-foundation/01-PATTERNS.md` and `02-workspacedo-sqlite/02-PATTERNS.md` (style reference for this document)

**Files scanned:** 18 source/config/test files inspected directly; ~30 referenced via grep/glob.

**Cross-phase contracts inherited:**
- **STO-07 / MCP-05 defense-in-depth** — zod schemas MUST NOT declare `workspace_id`; tool handlers pass `args.workspace_id: this.props.workspace_id`. Inherited from `packages/workspace-do/src/index.ts:139–146` (`assertOwnsWorkspace` guard) and verified in `__tests__/defense-in-depth.test.ts`.
- **FND-08 wrangler lint** — `new_sqlite_classes` only, never `new_classes`. Enforced by `scripts/lint-wrangler.mjs`; Phase 3's v2 migration entry passes by construction.
- **TS-source / no-build-step** — Phase 1 D-07 + Phase 2 D-01. All `.ts` files are consumed via `exports.default = "./src/index.ts"`. No `dist/`.
- **Workerd-pool test shell** — Phase 2's `runInDurableObject` + `env.WORKSPACE.idFromName(...)` + `env.WORKSPACE.get(id)` shape, applied to `env.MCP_OBJECT` for tests that exercise the `EngramMcp` DO.

**Pattern extraction date:** 2026-05-25

---

*Phase: 03-mcp-server-scaffold*
*Pattern mapping completed: 2026-05-25*
