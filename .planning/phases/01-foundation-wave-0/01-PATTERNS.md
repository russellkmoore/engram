# Phase 1: Foundation (Wave 0) — Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 10 new/extended deliverables
**Analogs found:** 9 / 10 (one file — `eval-budget-summary.mjs` — has only a tangential analog and is partial-match)

> Phase 1 is a *process/foundation* phase. Every deliverable extends an existing in-repo shape; nothing is greenfield. The single weakest match (`eval-budget-summary.mjs` GraphQL Analytics caller) borrows its CLI skeleton from `scripts/kv-bootstrap.mjs` but the GraphQL fetch body has no prior analog in-repo.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/audit/embedding-version-audit.ts` (NEW) | utility/admin-script | request-response (REST → DO) | `scripts/kv-bootstrap.mjs` + `scripts/lint-wrangler.mjs` | role-match (different runtime — `.ts` not `.mjs` — but the CLI / arg-parse / exit-code / `spawnSync wrangler` shape carries forward) |
| `packages/workspace-do/src/index.ts` (EXTEND — add `assertAllBlocksAtV2()` RPC) | DO admin RPC method | CRUD (single SELECT COUNT) | `markIngestFailed` RPC at `packages/workspace-do/src/index.ts:358-364` and `stampEmbedding` RPC at `packages/workspace-do/src/index.ts:227+` | exact (same DO class, same RPC shape) |
| `packages/workspace-do/src/queries.ts` (EXTEND — add `countStaleEmbeddings` helper) | DB helper | CRUD (single SELECT COUNT) | `stampEmbedding` helper at `packages/workspace-do/src/queries.ts:548-562` | exact (same file, same export shape, same `SqlStorage` arg pattern) |
| `packages/workspace-do/src/__tests__/embedding-version-audit.test.ts` (NEW) | DO unit test | request-response (test → DO RPC) | `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:1-67` (captureCallback) — but a DO-direct test is closer to existing workspace-do unit tests | role-match |
| `packages/mcp-server/vitest.config.ts` (EXTEND — add 3rd `eval` project) | test config | event-driven (test runner) | `packages/mcp-server/vitest.config.ts:35-100` (existing two-project shape) | exact (extending the same file) |
| `packages/triage-worker/vitest.config.ts` (EXTEND — convert single-project → multi-project + `eval`) | test config | event-driven | `packages/mcp-server/vitest.config.ts:35-100` | role-match (triage-worker is currently single-project; mcp-server pattern is the template) |
| `packages/workspace-do/vitest.config.ts` (OPTIONAL EXTEND — add eval project if any DO-level evals appear) | test config | event-driven | `packages/workspace-do/vitest.config.ts:44-75` | exact (extending the same file) |
| `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` (NEW) | test setup file | event-driven (vi.spyOn wrapper) | `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:37-67` (the `captureCallback` + `vi.spyOn` pattern) | role-match (the spy-and-wrap discipline carries forward; the budget-counter overflow throw is new) |
| `.github/workflows/ci.yml` (EXTEND — add audit job + eval-tier env wiring) | CI config | event-driven | `.github/workflows/ci.yml:98-120` (existing `Test (Vitest)` step) + `.github/workflows/evals.yml:39-73` (existing eval-secrets gating) | exact (extending the same file) + role-match (evals.yml is the secrets-gating template) |
| `scripts/eval-budget-summary.mjs` (NEW) | utility/reporting script | request-response (GraphQL fetch) | `scripts/kv-bootstrap.mjs:1-80` (CLI skeleton, `--dry-run` flag, exit codes); GraphQL fetch body has no in-repo analog | role-match (CLI skeleton only) |
| `.planning/evals/recall-corpus.json` (NEW) | data fixture | (none — static JSON consumed by tests) | `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` + `real-corpus.json` | role-match (existing shape is a bare array; new shape wraps the array in a header object with `corpus_version` / `train_count` / `split` per entry) |
| `.planning/research/v0.2-INTEGRATION-MATRIX.md` (NEW) | planning artifact | (none — prose) | `.planning/research/v0.2-SUMMARY.md` (markdown table convention) | role-match (no exact precedent for an integration matrix; v0.2-SUMMARY is the closest stylistic analog for table-driven planning prose) |
| `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` (NEW) | planning artifact / routing tracker | (none — append-only log) | `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` | exact (canonical instance; copy verbatim with phase number / scope / stop-trigger swap) |

---

## Pattern Assignments

### `scripts/audit/embedding-version-audit.ts` (utility/admin-script, REST → DO request-response)

**Primary analog:** `scripts/kv-bootstrap.mjs` (CLI skeleton, exit codes, arg parsing, `spawnSync wrangler` fallback)
**Secondary analog:** `scripts/lint-wrangler.mjs` (positional-arg vs full-scan mode, fixture invocation pattern)
**Output runtime:** TypeScript (matches research §"Architecture" — Phase 5 has set the precedent for `.ts` admin scripts; mjs is fine but `.ts` is the v0.2 convention)

**File header / module comment pattern** (from `scripts/kv-bootstrap.mjs:1-40`):

```javascript
// scripts/audit/embedding-version-audit.ts
// Source: PRE-01 (v0.2 Phase 1 catastrophic-severity gate)
//
// Verifies that ZERO blocks in ANY workspace carry a stale embedding stamp
// (NULL, embedding_version < 2, or embedding_model != '@cf/qwen/qwen3-embedding-0.6b').
// Exits 1 on any non-zero count; the CI workflow consumes the exit code.
//
// Usage:
//   node --import tsx scripts/audit/embedding-version-audit.ts [--dry-run] [--workspace <id>]
//
//   --dry-run:    OPTIONAL. Print the planned Cloudflare API calls WITHOUT executing.
//   --workspace:  OPTIONAL. Override the auto-enumeration to audit a single workspace_id.
//
// Exit codes: 0 clean | 1 stale rows found | 2 wrangler / CF API subprocess failed.
//
// Requires env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WORKSPACE_NAMESPACE_ID
```

**Arg parsing + early validation** (from `scripts/kv-bootstrap.mjs:55-80`):
```javascript
const TAG = "[audit:embedding-version]";
const args = process.argv.slice(2);
let dryRun = false;
let workspaceOverride = "";
let showHelp = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--workspace") workspaceOverride = args[++i] ?? "";
  else if (a === "--help" || a === "-h") showHelp = true;
}
if (showHelp) { usage(process.stdout); process.exit(1); }
```

**Subprocess pattern + secrets discipline** (from `scripts/kv-bootstrap.mjs` — `spawnSync` + 0o600 tmp; **DO NOT** echo the bearer token):
- Read `CLOUDFLARE_API_TOKEN` from env only.
- Pass it as the `Authorization: Bearer …` HTTP header inside the script.
- NEVER pass the token as a positional argv element (would leak to `/proc/<pid>/cmdline`).
- Never `console.log` the token — even on error paths.

**Cross-workspace enumeration** (from RESEARCH.md §"Example 3" — Cloudflare DO Namespace List API):
```bash
GET https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/durable_objects/namespaces/$NS_ID/objects?limit=1000
Authorization: Bearer $CLOUDFLARE_API_TOKEN
# Pagination via `cursor` query param; loop until result_info.cursor is null.
```

**Notes:**
- KEEP VERBATIM: CLI exit-code contract (0/1/2 from `kv-bootstrap.mjs`), header comment style with `[audit:embedding-version]` tag prefix, `--dry-run` flag semantics, secrets-redaction discipline.
- ADAPT: switch from `.mjs` to `.ts` to match Phase 5's TypeScript-script precedent. Use `tsx` runner. Use native `fetch` instead of `spawnSync wrangler` (wrangler does NOT expose the DO Namespace List API as a CLI command; direct REST is required).
- ADAPT: validate the namespace list shape with `zod` (already in tree under `@engram/mcp-server` deps; can `import { z } from "zod"` from the workspace if you make this script live inside `packages/mcp-server/scripts/` — alternatively keep it at `scripts/audit/` and do hand-rolled shape assertions).
- NEW: aggregate per-workspace `count_stale` into a summary table and `process.exit(1)` if any > 0.

---

### `packages/workspace-do/src/index.ts` — `assertAllBlocksAtV2()` admin RPC (extend)

**Analog:** `markIngestFailed` at `packages/workspace-do/src/index.ts:340-364` and `stampEmbedding` at `packages/workspace-do/src/index.ts:227+` (Phase 5 AI-03 pattern)

**Existing RPC shape to mirror exactly** (lines 358-364):
```typescript
  /**
   * Marks a block as permanently failed enrichment (PIP-05). ...
   *
   * STO-07: assertOwnsWorkspace is the FIRST EXECUTABLE LINE — the Triage
   * Worker passes `event.workspace_id` from the Queue message body, ...
   *
   * @requirement PIP-05 / D-03
   */
  markIngestFailed(args: { workspace_id: string; block_id: string; reason: string }): void {
    this.assertOwnsWorkspace(args.workspace_id);
    markIngestFailedQuery(this.ctx.storage.sql, {
      block_id: args.block_id,
      reason: args.reason,
    });
  }
```

**Adapted shape for PRE-01:**
```typescript
  /**
   * Returns a count of blocks whose embedding stamp predates the ENG-25
   * qwen3 cutover (NULL stamp OR embedding_version < 2 OR embedding_model
   * != EMBEDDING_MODEL). A non-zero count means the workspace has rows
   * whose Vectorize vectors live in a different embedding space than the
   * current index — silent recall corruption.
   *
   * Admin-only — invoked from `scripts/audit/embedding-version-audit.ts`
   * via the WorkspaceDO RPC stub; NOT registered as an MCP tool.
   *
   * @requirement PRE-01 (v0.2)
   */
  assertAllBlocksAtV2(args: { workspace_id: string }): { workspace_id: string; count_stale: number } {
    this.assertOwnsWorkspace(args.workspace_id);
    const count = countStaleEmbeddingsQuery(this.ctx.storage.sql);
    return { workspace_id: args.workspace_id, count_stale: count };
  }
```

**Notes:**
- KEEP VERBATIM: `this.assertOwnsWorkspace(args.workspace_id)` as the FIRST executable line (STO-07 / T-05-01-STO07 discipline — applies to every RPC on this class without exception).
- KEEP VERBATIM: `@requirement PRE-01` JSDoc tag style; method body is delegate-to-`queries.ts` only (no inline SQL).
- ADAPT: the method must return a structured object (`{ workspace_id, count_stale }`) so the CI audit script can aggregate across workspaces. `markIngestFailed` returns void; this RPC returns data.
- SECURITY: NEVER register this method in `registerTools()` (mcp-server). The threat-model row in RESEARCH §V13 explicitly disqualifies MCP exposure. Verify via the `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` pattern extended with a "Prong C" assertion (RPC is unreachable via JWT-derived tool surface).

---

### `packages/workspace-do/src/queries.ts` — `countStaleEmbeddingsQuery` helper (extend)

**Analog:** `stampEmbedding` helper at lines 548-562:

```typescript
/**
 * Updates `embedding_model` and `embedding_version` on an existing block after
 * Vectorize upsert completes. ... Single-statement single-binding exec (Pitfall 8).
 *
 * @requirement AI-03
 */
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
```

**Adapted shape for PRE-01** (read-only single-statement count, no IN-clause):
```typescript
import { EMBEDDING_MODEL } from "@engram/ai-config";  // existing dependency in workspace-do

/**
 * Counts blocks whose embedding stamp predates the ENG-25 cutover.
 *
 * SQL semantics: `NULL < 2` evaluates to NULL (not TRUE), so the naive
 * `WHERE embedding_version < 2` clause would SILENTLY MISS NULL-stamped rows.
 * The three-arm OR is mandatory.
 *
 * Returns a non-negative integer; throws nothing (count never NotFound).
 *
 * @requirement PRE-01
 */
export function countStaleEmbeddings(sql: SqlStorage): number {
  const row = sql
    .exec(
      "SELECT COUNT(*) AS n FROM blocks WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?",
      EMBEDDING_MODEL,
    )
    .one() as { n: number };
  return row.n;
}
```

**Notes:**
- KEEP VERBATIM: positional `?` placeholders (no string interpolation, no named params) — this is the `Pitfall 8` discipline cited in every existing query helper at the top of `queries.ts`.
- KEEP VERBATIM: the `EMBEDDING_MODEL` constant imported from `@engram/ai-config` — DO NOT re-declare the string literal in this file (single-source-of-truth invariant from ENG-25).
- ADAPT: read-only, no `rowsWritten` check needed (a count query always returns one row).
- CRITICAL: the SQL `WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?` clause is **load-bearing**. The NULL arm is the cardinal-sin defense. See RESEARCH §"Pitfall 1: Cardinal-sin clause violation".

---

### `packages/workspace-do/src/__tests__/embedding-version-audit.test.ts` (NEW unit test)

**Analog for test structure:** Existing workspace-do unit tests under `packages/workspace-do/src/__tests__/*.test.ts` (the directory exists per the listing above; specific files include defense-in-depth tests, STO-* tests). Pattern: `runInDurableObject` from `cloudflare:test` plus seeded SQL + RPC invocation + assertion.

**Pattern excerpt** (Pattern shape from RESEARCH §Standard Stack — `cloudflare:test` `runInDurableObject` API):

```typescript
import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";

describe("PRE-01 — assertAllBlocksAtV2", () => {
  it("returns 0 for a clean workspace", async () => {
    const id = env.WORKSPACE.idFromName("ws-clean");
    const stub = env.WORKSPACE.get(id);
    const result = await stub.assertAllBlocksAtV2({ workspace_id: "ws-clean" });
    expect(result.count_stale).toBe(0);
  });

  it("catches NULL embedding_version (cardinal-sin defense)", async () => {
    const id = env.WORKSPACE.idFromName("ws-null-stamp");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      // seed one block with NULL stamps — this is exactly what insertBlock
      // writes today before stampEmbedding runs
      state.storage.sql.exec(
        "INSERT INTO blocks (id, type, content, embedding_version, embedding_model, scope, source, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, 'personal', 'test', ?, ?)",
        "blk-stale-1", "research_note", "x", Date.now(), Date.now(),
      );
    });
    const result = await stub.assertAllBlocksAtV2({ workspace_id: "ws-null-stamp" });
    expect(result.count_stale).toBe(1);
  });

  it("catches wrong-model embedding_model", async () => {
    const id = env.WORKSPACE.idFromName("ws-wrong-model");
    const stub = env.WORKSPACE.get(id);
    await runInDurableObject(stub, (instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO blocks (id, type, content, embedding_version, embedding_model, scope, source, created_at, updated_at) VALUES (?, ?, ?, 2, '@cf/baai/bge-base-en-v1.5', 'personal', 'test', ?, ?)",
        "blk-stale-2", "research_note", "x", Date.now(), Date.now(),
      );
    });
    const result = await stub.assertAllBlocksAtV2({ workspace_id: "ws-wrong-model" });
    expect(result.count_stale).toBe(1);
  });
});
```

**Notes:**
- KEEP VERBATIM: `import { env, runInDurableObject } from "cloudflare:test"` — this is the only sanctioned API for seeding state inside a workerd-hosted DO test.
- KEEP VERBATIM: per-test unique workspace name via `idFromName(...)`. Per-file isolation is the workerd-pool default (RESEARCH Pitfall 3), so distinct names prevent cross-test contamination within the same file.
- ADAPT: the seed `INSERT` mirrors the column order in `insertBlock` at `queries.ts:316` — keep the column order identical to avoid drift if Phase 5 changes the table shape.
- TEST PLACEMENT: lives in `packages/workspace-do/src/__tests__/` so it runs in the existing `workerd` project of `workspace-do/vitest.config.ts` (no new project needed for this test — it's a unit test, not an eval).

---

### `packages/mcp-server/vitest.config.ts` — add 3rd `eval` project (extend)

**Analog:** the existing two-project shape in the same file (`packages/mcp-server/vitest.config.ts:35-100`):

```typescript
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // workerd project — every test EXCEPT lint-no-direct-vectorize + eval
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            "src/__tests__/lint-no-direct-vectorize.test.ts",
            "src/__tests__/evals/recall-f1.eval.test.ts",
          ],
        },
      },
      {
        // Node-pool lint project (unchanged)
        test: {
          name: "lint-node",
          include: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
    ],
  },
});
```

**Adapted shape for PRE-02** (add a third `eval` project, exclude `*.eval.test.ts` from `workerd`):
```typescript
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const hasEvalCreds =
  process.env.CLOUDFLARE_API_TOKEN !== undefined &&
  process.env.CLOUDFLARE_ACCOUNT_ID !== undefined;

export default defineConfig({
  test: {
    projects: [
      {
        // workerd unit + integration project (existing)
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            "src/__tests__/lint-no-direct-vectorize.test.ts",
            "src/__tests__/**/*.eval.test.ts",  // NEW — eval tier owns these
          ],
        },
      },
      {
        // lint-node project (existing — unchanged)
        test: {
          name: "lint-node",
          include: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
      {
        // NEW — eval project, gated on CF creds (Pitfall 2 fail-loud at CI layer)
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "eval",
          include: hasEvalCreds ? ["src/__tests__/**/*.eval.test.ts"] : [],
          setupFiles: ["./src/__tests__/evals/eval-budget.setup.ts"],
          // Pitfall 3: shared budget across files requires non-isolation.
          isolate: false,
          poolOptions: {
            workers: { singleWorker: true },
          },
        },
      },
    ],
  },
});
```

**Notes:**
- KEEP VERBATIM: the existing `workerd` and `lint-node` project blocks. The only change to `workerd` is **adding** `"src/__tests__/**/*.eval.test.ts"` to its exclude list (and **removing** the bespoke `src/__tests__/evals/recall-f1.eval.test.ts` line at `vitest.config.ts:78` — the new glob subsumes it).
- KEEP VERBATIM: the `cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })` plugin invocation in the new `eval` project — same wrangler config as the workerd project, same remote-bindings semantics.
- ADAPT: `isolate: false` + `singleWorker: true` is the Pitfall 3 mitigation (shared budget counter across files). If this conflicts with workerd-pool semantics, the fallback is the post-hoc Analytics Engine aggregation described in RESEARCH §Pitfall 3 — discuss-phase decision.
- ADAPT: the `hasEvalCreds` gate makes the eval project a **soft local skip** (no tests = no error locally). The CI layer in `ci.yml` is responsible for the loud-fail when creds are expected but missing.

---

### `packages/triage-worker/vitest.config.ts` — convert single-project → multi-project (extend)

**Analog:** `packages/mcp-server/vitest.config.ts` post-PRE-02 (the file we just specified above).

**Current state** (`packages/triage-worker/vitest.config.ts:20-48`):
```typescript
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "src/__tests__/evals/memorability-calibration.eval.test.ts",
      "src/__tests__/evals/conflict-precision.eval.test.ts",
    ],
  },
});
```

**Adapted shape:**
- Convert from single top-level `plugins[]` + `test{}` shape to the `projects: [...]` shape.
- Project 1 = `workerd` (existing tests minus `*.eval.test.ts`).
- Project 2 = `eval` (gated on CF creds, includes the two currently-excluded `*.eval.test.ts` files, loads `eval-budget.setup.ts`).

**Notes:**
- KEEP VERBATIM: the existing comment block at lines 28-46 explaining WHY memorability-calibration + conflict-precision were excluded. The exclusion **moves** from the `workerd` project to becoming inclusions in the `eval` project — the constraints (remote bindings, cost-gate) still apply but the eval tier is the right home.
- ADAPT: the `eval-budget.setup.ts` must live somewhere shared. Recommendation: keep one canonical copy under `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` and have triage-worker's vitest config reference it via a relative path (`../../../mcp-server/src/__tests__/evals/eval-budget.setup.ts`). Alternative: a small shim file inside `packages/triage-worker/src/__tests__/evals/eval-budget.setup.ts` that re-exports.

---

### `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` (NEW)

**Analog for spy-and-wrap pattern:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:37-67` (`vi.spyOn(McpServer.prototype, "registerTool")` plus `try/finally spy.mockRestore()`).

**Adapted shape:**
```typescript
import { beforeAll, vi } from "vitest";
import { env } from "cloudflare:workers";

const MAX_AI_CALLS = 200;
let callCount = 0;

beforeAll(() => {
  const realAiRun = env.AI.run.bind(env.AI);
  vi.spyOn(env.AI, "run").mockImplementation(async (...args: Parameters<typeof env.AI.run>) => {
    if (++callCount > MAX_AI_CALLS) {
      throw new Error(
        `[eval-budget] MAX_AI_CALLS exceeded: ${callCount} > ${MAX_AI_CALLS}. ` +
          `Tighten the eval, do not raise the cap. (PRE-02 v0.2 contract.)`,
      );
    }
    return realAiRun(...args);
  });

  const realVecQuery = env.VECTORIZE.query.bind(env.VECTORIZE);
  vi.spyOn(env.VECTORIZE, "query").mockImplementation(
    async (...args: Parameters<typeof env.VECTORIZE.query>) => {
      if (++callCount > MAX_AI_CALLS) {
        throw new Error(`[eval-budget] MAX_AI_CALLS exceeded …`);
      }
      return realVecQuery(...args);
    },
  );
});
```

**Notes:**
- KEEP VERBATIM: the `vi.spyOn(env.AI, "run").mockImplementation((...) => { … return real(...) })` pattern. The `recall-f1.eval.test.ts` already establishes that `vi.spyOn` is the sanctioned wrap mechanism for workerd-pool tests.
- KEEP VERBATIM: the `import { env } from "cloudflare:workers"` line (CITED in RESEARCH §Standard Stack — Workerd built-in for bindings access inside tests).
- ADAPT: the budget number `200` is the **contract**; do NOT make it env-configurable. RESEARCH §"Anti-Patterns" explicitly calls out "Inflating MAX_AI_CALLS when tests fail" as an anti-pattern.
- ADAPT: `++callCount` is shared by both spy bodies — the counter increments on AI **or** Vectorize calls. If the discuss-phase decides to split into two budgets (AI vs Vectorize), refactor into two counters.

---

### `.github/workflows/ci.yml` — extend with audit job + eval-tier wiring

**Primary analog:** existing `Test (Vitest) — all workspaces` step at `.github/workflows/ci.yml:98-120`:
```yaml
- name: Test (Vitest) — all workspaces
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
      echo "::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets are not configured."
      echo "::error::Add via Settings → Secrets and variables → Actions. Token needs Workers:Edit + Workers AI:Read + Vectorize:Read scopes."
      exit 1
    fi
    npm test
```

**Secondary analog (lint negative-fixture pattern):** `ci.yml:43-49`:
```yaml
- name: Lint blockConcurrencyWhile — negative fixture must fail (STO-10)
  run: |
    if node scripts/lint-blockconcurrency.mjs packages/workspace-do/__fixtures__/bad-blockconcurrency.ts; then
      echo "STO-10 regression: bad fixture did not trigger lint failure"
      exit 1
    fi
    echo "STO-10 negative fixture correctly failed."
```

**Adapted shape for PRE-01 audit job:**
```yaml
- name: PRE-01 — Embedding-version migration audit (all workspaces)
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    WORKSPACE_NAMESPACE_ID: ${{ secrets.WORKSPACE_NAMESPACE_ID }}
  run: |
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] || [ -z "${WORKSPACE_NAMESPACE_ID:-}" ]; then
      echo "::error::PRE-01 audit requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WORKSPACE_NAMESPACE_ID."
      exit 1
    fi
    npx tsx scripts/audit/embedding-version-audit.ts
```

**Adapted shape for PRE-02 eval-tier step** (separate step so the secrets gate fails loud per Pitfall 2):
```yaml
- name: PRE-02 — Eval tier (Vitest --project=eval, MAX_AI_CALLS=200)
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
      echo "::error::EVAL TIER SKIPPED — missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID. Failing loud per PRE-02 Pitfall 2."
      exit 1
    fi
    npm run test:eval --workspaces --if-present
```

**Notes:**
- KEEP VERBATIM: the `if [ -z "${CF_*:-}" ]; then echo "::error::..." ; exit 1; fi` fail-loud pattern at lines 115-119. RESEARCH §"Pitfall 2: Eval tier silently skipping" makes this mandatory.
- KEEP VERBATIM: the `env:` block hoisting at the **step level** (not inline in `if:` conditions). RESEARCH §"Pitfall 7: CI workflow loses env vars when re-running" makes this mandatory.
- ADAPT: audit job runs on every PR (`pull_request: branches: [main]`). Eval-tier step may stay PR-gated OR move to nightly via `.github/workflows/evals.yml` extension — discuss-phase decision; recommendation is PR-gated for the *budget overflow* assertion (fast feedback) and nightly for the *neuron summary* (cost).
- NEW: the `WORKSPACE_NAMESPACE_ID` secret has to be provisioned manually — capture this as a CHECKPOINT in the plan.

---

### `scripts/eval-budget-summary.mjs` (NEW)

**Partial analog:** `scripts/kv-bootstrap.mjs:1-80` for CLI skeleton + `--dry-run` flag + secrets redaction. The GraphQL fetch body has no in-repo analog (this is the file with the weakest match — execute against the verbatim RESEARCH §"Example 4" GraphQL query).

**CLI skeleton (carry forward verbatim from kv-bootstrap.mjs):**
```javascript
// scripts/eval-budget-summary.mjs
// PRE-02 daily neuron-consumption summary — reads Cloudflare GraphQL Analytics
// API `aiInferenceAdaptive` dataset at account level, outputs markdown summary
// (stdout) and exit-code 1 if total neurons over the window exceed the budget.
//
// Usage: node scripts/eval-budget-summary.mjs [--dry-run] [--window 24h]
// Exit codes: 0 within budget | 1 over budget | 2 API/network failure.

import { argv, exit, stdout, stderr } from "node:process";

const TAG = "[eval:budget-summary]";
const args = argv.slice(2);
let dryRun = false;
let windowSpec = "24h";
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--window") windowSpec = args[++i] ?? "24h";
}
```

**GraphQL fetch body** (from RESEARCH §"Example 4" — verbatim):
```javascript
const query = `
  query NeuronUsage($accountTag: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        aiInferenceAdaptiveGroups(
          limit: 1000
          filter: { datetime_geq: $start, datetime_leq: $end }
        ) {
          sum { requests tokensInput tokensOutput }
          dimensions { modelName datetime }
        }
      }
    }
  }
`;

const resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query,
    variables: { accountTag: process.env.CLOUDFLARE_ACCOUNT_ID, start, end },
  }),
});
```

**Notes:**
- KEEP VERBATIM: the GraphQL query string from RESEARCH §"Example 4" — it's the cited Cloudflare docs example.
- KEEP VERBATIM: the secrets discipline from `kv-bootstrap.mjs` — token from env only, never echoed.
- ADAPT: `.mjs` (not `.ts`) because this is a tiny reporting script with no shared types; matches `kv-bootstrap.mjs` precedent. (If a future phase needs shared GraphQL types, refactor to `.ts`.)
- ADAPT: output is a markdown table (Russell reads it; can be pasted into Linear comment).
- UNCERTAINTY: per RESEARCH §A5 (Assumptions), the `aiInferenceAdaptive` dataset may not surface for non-AI-Gateway Workers AI usage. The script should detect zero-rows-returned and emit a warning rather than report "0 neurons."

---

### `.planning/evals/recall-corpus.json` (NEW)

**Analog:** `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` (20 entries, bare array) + `real-corpus.json` (27 entries, bare array).

**Existing entry shape** (`reference-corpus.json:2-26`):
```json
{
  "id": "ref-001",
  "bucket": "critical-path",
  "memory_type": "job_application",
  "original_content": "I applied to REDACTED-CDN-CORP today...",
  "paraphrased_query": "what's the most recent role I applied for at a CDN company",
  "intended_memory_id": "ref-001",
  "expected_classified_type": "job_application",
  "expected_entities": [...],
  "expected_extracted_fields": {...},
  "labeled_by": "russell",
  "labeled_at": 1748390400000,
  "known_failure_pattern": null
}
```

**Adapted shape for PRE-03** (wraps the array in a header object, adds `split` per entry, adds `expected_top_3_block_ids`, reserves `expected_synthesis: null`):
```jsonc
{
  "corpus_version": "v0.2.1",
  "sweep_date": "2026-06-XX",
  "embedding_model": "@cf/qwen/qwen3-embedding-0.6b",
  "total_entries": 100,
  "train_count": 70,
  "validate_count": 30,
  "split_ratio": "70/30",
  "split_strategy": "stratified by bucket",
  "sources": {
    "v0.1_production_recall_logs": 35,
    "ingested_notion_drive_snippets": 30,
    "carried_forward_reference_corpus": 20,
    "carried_forward_real_corpus": 15
  },
  "buckets": {
    "critical-path":  { "count": 40, "description": "queries Russell actually asks" },
    "extraction":     { "count": 25, "description": "expected-entity recall" },
    "known-failure":  { "count": 20, "description": "queries v0.1 missed" },
    "edge":           { "count": 15, "description": "empty / one-word / very-long" }
  },
  "entries": [
    {
      "id": "rc-001",
      "bucket": "critical-path",
      "memory_type": "job_application",
      "query": "what's the most recent role I applied for at a CDN company",
      "expected_top_3_block_ids": ["blk-eval-001", "blk-eval-002", "blk-eval-003"],
      "split": "train",
      "labeled_by": "russell",
      "labeled_at": 1748390400000,
      "expected_synthesis": null
    }
  ]
}
```

**Notes:**
- KEEP VERBATIM: the bucket vocabulary (`critical-path` / `known-failure` / `extraction` / `edge`) from `reference-corpus.json` — the existing `recall-f1.eval.test.ts:26-35` `CorpusEntry` type union depends on this.
- KEEP VERBATIM: `labeled_by` = literal string `"russell"` (RESEARCH §"Security → eval corpus poisoning" makes this a tamper-resistance signal).
- ADAPT: the entry shape **drops** `original_content` + `expected_entities` + `expected_extracted_fields` from the existing shape — those fields belong in the source fixtures, not the recall-eval corpus. The new corpus is purely `query → expected_top_3_block_ids` (the BEIR qrels analog).
- ADAPT: `intended_memory_id` (singular, existing) becomes `expected_top_3_block_ids` (array of 3, new) — see RESEARCH §A6 for the staged migration plan that keeps `recall-f1.eval.test.ts` working until Phase 2 RNK retargets it.
- ADAPT: `block_ids` MUST reference a dedicated `eval-fixtures` workspace (Pitfall 4). Document this in the corpus header `"sources"` field.

---

### `.planning/research/v0.2-INTEGRATION-MATRIX.md` (NEW)

**Analog:** `.planning/research/v0.2-SUMMARY.md` (stylistic — markdown table prose convention).

**Adapted shape** (from RESEARCH §"Pattern 4: Integration Matrix"):
```markdown
# v0.2 Integration Matrix

> Phase 1 PRE-04. Drives Phase 5 INT-04 "zero untested cross-feature combinations" close-out criterion.

| Feature Pairing | Covering Plan | Test File | Status | Notes |
|---|---|---|---|---|
| RNK × CON | 02-XX | `packages/mcp-server/src/__tests__/integration/rank-with-conflicts.test.ts` | pending | RNK weights must not drift when `context.conflicts` is populated |
| RNK × EXP | 03-XX | `packages/mcp-server/src/__tests__/integration/rank-with-expansion.test.ts` | pending | weights tuned on single-query path; verify they still hold on expanded |
| EXP × SYN | 04-XX | `packages/mcp-server/src/__tests__/integration/expansion-then-synth.test.ts` | pending | synthesis input mix changes when expansion broadens recall |
| CON × SYN | 04-XX | `packages/mcp-server/src/__tests__/integration/synth-with-conflicts.test.ts` | pending | synthesis prompt should NOT collapse contradictory inputs into a confident merge |
| Kitchen-sink | 05-XX | `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` | pending | INT-01 — 10 conflicts + 50 entities + verbosity=synthesis ≤ 8K tokens |

## Footer rule

Every plan in Phases 2..5 MUST either (a) land a test that closes a `pending`
cell, or (b) document why no integration test is needed (e.g., features are
truly orthogonal). Plan-checker enforces this.
```

**Notes:**
- KEEP VERBATIM: the cell vocabulary (`tested` / `pending` / `out-of-scope`) — Phase 5's `/gsd:verify-work 5` will grep these literal strings.
- KEEP VERBATIM: the footer rule prose (it is the enforcement contract for plan-checker).
- ADAPT: cell `Covering Plan` starts at `0N-XX` placeholders; downstream phases overwrite with real plan IDs (e.g., `02-04`).
- ADAPT: row vocabulary uses the v0.2 feature short-codes (RNK / CON / EXP / SYN) consistent with REQUIREMENTS.md.

---

### `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` (NEW)

**Analog (CANONICAL — copy verbatim with header swap):** `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`

**Sections to copy verbatim** (with phase-number / scope / stop-trigger adjustments):
1. **Header block** (lines 1-8 of the Phase 5 file) — adapt scope statement to Phase 1's expected mix (<10% per RESEARCH §"Phase character heuristic"):
   ```markdown
   # Phase 1 — cf-code-assist Routing Tracker

   > Tracks every code-generation decision during Phase 1 execution.
   >
   > **Scope:** Active for Phase 1 execution only. Stop tracking once
   > `/gsd:verify-work 1` returns PASSED.
   >
   > **Why it matters:** Phase 1 is a *foundation phase* (test infra + CI gates +
   > corpus labeling). Expected routing mix: <10% cf-code-assist. Most tasks are
   > small (<50 lines), cross-file (CI workflow + script + vitest config), or
   > pure prose (corpus labeling, integration matrix). The tracker still runs to
   > validate the heuristic empirically.
   ```
2. **Instructions for the executor** (lines 11-24 of the Phase 5 file) — copy verbatim.
3. **3-Question Checklist** (lines 27-37 of the Phase 5 file) — copy verbatim (this is the heart of the routing discipline).
4. **Routing Log table header** (lines 41-45 of the Phase 5 file) — copy verbatim (columns: `Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved`). Seed row is "_seed_ … _Tracking starts at execute-phase kickoff_".
5. **End-of-Phase Summary** (lines 88-end of the Phase 5 file) — copy structure verbatim, leave values as `_TBD_` until `/gsd:verify-work 1` passes.

**Secondary reference (Phase 4 closed post-mortem):** `.planning/milestones/v0.1-phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` lines 62-110 — this is the post-mortem template Phase 1's `End-of-Phase Summary` should mirror in tone (honest categories: `Clear missed opportunities` / `Partial misses` / `Legitimately Claude` / `Not applicable`).

**Notes:**
- KEEP VERBATIM: every line of the Phase 5 file's sections 2-4 (Instructions, 3-Question Checklist, Routing Log table header). The reproducibility across phases is the whole point of the pattern.
- KEEP VERBATIM: the seed row literally — `| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |` — Phase 4 / Phase 5 both use this exact placeholder.
- ADAPT: phase number throughout (5 → 1).
- ADAPT: scope statement (Phase 5 was "AI Integration"; Phase 1 is "foundation"; expected routing mix changes from 40–60% to <10%).
- ADAPT: stop-trigger references `/gsd:verify-work 1` (not `5`).
- DO NOT adapt the Phase 4 post-mortem prose — that's an artifact of Phase 4's specific routing failures. Phase 1's End-of-Phase Summary will fill in its own honest categorization at phase close.

---

## Shared Patterns

### Project instructions header (every PLAN.md must reference)
**Source:** `CLAUDE.md` (project root)
**Apply to:** All Phase 1 plans
**Rule:** Every PLAN.md must start with the boilerplate line "Project instructions: Read ./CLAUDE.md" so spawned gsd-executor subagents inherit the Phase 5 CF-CODE-ASSIST tracker convention. The PRE-05 tracker scaffold extends this — Phase 1's executor must append to `01-CF-CODE-ASSIST-USAGE.md`, not Phase 5's.

### STO-07 / assertOwnsWorkspace discipline
**Source:** `packages/workspace-do/src/index.ts:145-152`
**Apply to:** Every new RPC method on `WorkspaceDO` (PRE-01 `assertAllBlocksAtV2`)
**Rule:** `this.assertOwnsWorkspace(args.workspace_id)` is the FIRST executable line. No exceptions. RESEARCH §"Security → V4 / V13" cites this for the admin RPC threat model.

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

### Secrets discipline (CI + scripts)
**Source:** `.github/workflows/ci.yml:111-119` + `scripts/kv-bootstrap.mjs` §"SECURITY (T-03-KV-LEAK)"
**Apply to:** PRE-01 audit script, PRE-02 eval-budget script, ci.yml extensions
**Rule:**
1. Tokens read from env only; never `console.log`.
2. Tokens never positional argv; never `set -x` in shell scripts.
3. Workflow-level `env:` block hoisting (not `if:`-conditional access) — RESEARCH §Pitfall 7.
4. Fail loud on missing creds with `::error::` annotations (not silent skip) — RESEARCH §Pitfall 2.

### EMBEDDING_MODEL single source of truth
**Source:** `shared/ai-config/src/index.ts:62,82` (referenced in PRE-01 query helper)
**Apply to:** `queries.ts:countStaleEmbeddings`, eval-corpus header (`"embedding_model": "@cf/qwen/qwen3-embedding-0.6b"`)
**Rule:** NEVER re-declare the string literal `"@cf/qwen/qwen3-embedding-0.6b"` in source code. Always `import { EMBEDDING_MODEL } from "@engram/ai-config"`. Drift = silent corruption. The corpus header is the one exception (it's data, not code) — but it MUST match the `EMBEDDING_MODEL` constant by exact string equality, verified at parse time in PRE-03 unit tests.

### `cloudflareTest` plugin invocation
**Source:** `packages/mcp-server/vitest.config.ts:41-45` and `packages/workspace-do/vitest.config.ts:51-55`
**Apply to:** Every vitest project that needs workerd bindings (workerd project + new eval project)
**Rule:**
```typescript
plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
```
Always reference `./wrangler.test.jsonc` (NOT `./wrangler.jsonc`). The `.test.jsonc` suffix is what excludes the file from the FND-08 production-wrangler lint glob.

### Vitest project-tier convention
**Source:** `packages/mcp-server/vitest.config.ts` and `packages/workspace-do/vitest.config.ts`
**Apply to:** All three packages
**Rule:** Project names are stable identifiers consumed by CLI (`--project=workerd`, `--project=lint-node`, `--project=lint`, NEW `--project=eval`). When extending: new projects appended to the end of the `projects: [...]` array, existing projects unchanged.

### File-locking discipline for parallel tracker appends
**Source:** RESEARCH §"Pitfall 6: Tracker file overwritten by parallel sub-agents"
**Apply to:** `01-CF-CODE-ASSIST-USAGE.md`
**Rule:** Append rows in a single `Edit` operation with explicit `oldString` matching the preceding row + the seed comment. Never use multiple parallel `Edit`s to the same tracker file. Phase 4 / Phase 5 followed this discipline successfully.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 1 deliverable has at least a role-match analog in-repo. The weakest match is `scripts/eval-budget-summary.mjs` (CLI skeleton borrowed from `kv-bootstrap.mjs`; GraphQL body lifted verbatim from RESEARCH §"Example 4"); no file is genuinely greenfield. |

---

## Metadata

**Analog search scope:**
- `packages/mcp-server/src/` (tests, vitest config, eval harness, fixtures)
- `packages/workspace-do/src/` (DO RPC methods, queries, vitest config, schema)
- `packages/triage-worker/src/` (vitest config, eval fixtures)
- `scripts/` (lint-*, kv-bootstrap, smoke-*, run-evals-promptfoo)
- `.github/workflows/` (ci.yml, evals.yml)
- `.planning/research/` (v0.2-SUMMARY style; markdown table convention)
- `.planning/milestones/v0.1-phases/04-core-tools-envelope/` and `05-ai-integration/` (CF-CODE-ASSIST-USAGE.md canonical instances)
- `.planning/evals/` (target dir for new corpus — currently empty)
- `shared/ai-config/src/index.ts` (EMBEDDING_MODEL constant)

**Files scanned:** ~25 source files + 4 planning artifacts
**Pattern extraction date:** 2026-06-02

## PATTERN MAPPING COMPLETE

**Phase:** 1 - Foundation (Wave 0)
**Files classified:** 13 (including 2 optional extends)
**Analogs found:** 12 exact/role-match / 13 total — 1 partial (`eval-budget-summary.mjs` CLI skeleton only)

### Coverage
- Files with exact analog: 6 (workspace-do RPC extension, queries.ts helper extension, mcp-server vitest.config extension, workspace-do vitest.config optional, ci.yml extension, 01-CF-CODE-ASSIST-USAGE.md canonical copy)
- Files with role-match analog: 6 (audit script, audit unit test, triage-worker vitest reshape, eval-budget setup file, recall-corpus.json shape, integration matrix prose)
- Files with partial / no analog: 1 (eval-budget-summary.mjs — GraphQL body lifted from RESEARCH §Example 4)

### Key Patterns Identified
- All Phase 1 deliverables extend existing in-repo shapes — no greenfield files.
- The vitest multi-project shape (mcp-server, workspace-do) is the canonical template for the new `eval` tier; the third project simply appends.
- The CF-CODE-ASSIST tracker is a copy-and-rename operation against the Phase 5 v0.1 canonical instance (lines 1-45 cover header + instructions + 3-question checklist + table header verbatim).
- The DO admin RPC pattern (`assertOwnsWorkspace` + delegate-to-`queries.ts`) is exact for PRE-01 — `markIngestFailed` and `stampEmbedding` are direct precedents.
- The catastrophic-severity SQL clause `embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?` is load-bearing — the three-arm OR (with NULL first) is the cardinal-sin defense and MUST be byte-faithful.
- CI workflow extensions follow the existing fail-loud pattern at `ci.yml:115-119` — the secrets gate must echo `::error::` and `exit 1`, not silently skip.

### File Created
`/Users/rmoore/Workspaces/engram/.planning/phases/01-foundation-wave-0/01-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns by file:line in PLAN.md action sections.
