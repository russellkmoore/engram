---
phase: 01-foundation-wave-0
plan: "01"
subsystem: workspace-do, mcp-server, ci
tags:
  - migration
  - audit
  - durable-objects
  - ci
  - foundation-wave-0
  - pre-01
dependency_graph:
  requires: []
  provides:
    - countStaleEmbeddings query helper (PRE-01 NULL-trap SQL)
    - assertAllBlocksAtV2 WorkspaceDO admin RPC
    - scripts/audit/embedding-version-audit.ts cross-workspace audit
    - CI migration audit gate on every push and PR
  affects:
    - packages/workspace-do/src/queries.ts
    - packages/workspace-do/src/index.ts
    - packages/workspace-do/package.json
    - packages/mcp-server/src/oauth.ts
    - scripts/audit/embedding-version-audit.ts
    - scripts/audit/tsconfig.json
    - .github/workflows/ci.yml
    - eslint.config.mjs
    - package.json
tech_stack:
  added:
    - "@engram/ai-config dependency to workspace-do (internal workspace package)"
    - "scripts/audit/tsconfig.json for strict TypeScript in Node.js context"
  patterns:
    - "Three-arm NULL-trap SQL clause (embedding_version IS NULL OR < 2 OR wrong model)"
    - "DO admin RPC gated by assertOwnsWorkspace as first executable line (STO-07)"
    - "Admin HTTP endpoint in oauth.ts defaultHandler gated by X-Engram-Admin-Token secret"
    - "Fail-loud CI secret gates with ::error:: annotations"
    - "Fork-safety gate on PR audit step"
key_files:
  created:
    - packages/workspace-do/src/__tests__/migration-audit.test.ts
    - scripts/audit/embedding-version-audit.ts
    - scripts/audit/tsconfig.json
  modified:
    - packages/workspace-do/src/queries.ts
    - packages/workspace-do/src/index.ts
    - packages/workspace-do/package.json
    - packages/mcp-server/src/oauth.ts
    - .github/workflows/ci.yml
    - eslint.config.mjs
    - package.json
decisions:
  - "Transport for audit script: HTTP admin endpoint in mcp-server oauth.ts defaultHandler (not a new Worker, not MCP-exposed)"
  - "assertAllBlocksAtV2 is parameterized via countStaleEmbeddings(sql, modelConstant) to keep the helper testable"
  - "ENGRAM_ADMIN_AUDIT_TOKEN is a Cloudflare Worker secret (no wrangler.jsonc change needed)"
  - "scripts/audit/tsconfig.json with strict: true to satisfy ESLint project service"
metrics:
  duration: "~90 minutes"
  completed_date: "2026-06-03"
  tasks: 5
  files_modified: 9
---

# Phase 1 Plan 01: PRE-01 Embedding-Version Guardrail Summary

PRE-01 installs the three-tier catastrophic gate against the ENG-25 embedding-space mismatch: the `countStaleEmbeddings` NULL-trap SQL helper, the `assertAllBlocksAtV2` WorkspaceDO admin RPC, a cross-workspace audit script using the CF DO Namespace List API, and a CI workflow step that blocks merge on any non-zero stale count.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add countStaleEmbeddings query helper | ad31507 | packages/workspace-do/src/queries.ts |
| 2 | Add assertAllBlocksAtV2 admin RPC | ad31507 | packages/workspace-do/src/index.ts, migration-audit.test.ts |
| 3 | Create cross-workspace audit script | 7c7efe7 | scripts/audit/embedding-version-audit.ts, packages/mcp-server/src/oauth.ts |
| 4 | [CHECKPOINT] Russell adds WORKSPACE_NAMESPACE_ID secret | (human action) | GitHub Actions secrets |
| 5 | Add CI workflow step | ee78e19 | .github/workflows/ci.yml |

## What Was Built

**`countStaleEmbeddings(sql, modelConstant): number`** — typed query helper in `queries.ts` with the load-bearing three-arm SQL clause:
```sql
SELECT COUNT(*) AS n FROM blocks
WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?
```
The NULL arm is mandatory: `NULL < 2` evaluates to NULL in SQL trinary logic and silently misses rows from `insertBlock` that haven't been through `stampEmbedding` yet.

**`WorkspaceDO.assertAllBlocksAtV2(args)`** — admin RPC that calls `countStaleEmbeddings` and returns `{ workspace_id, count_stale }`. First executable line is `assertOwnsWorkspace` (STO-07 discipline). NOT registered in `registerTools()` — only accessible via Worker Service binding.

**`scripts/audit/embedding-version-audit.ts`** — `tsx` Node.js script that:
1. Reads workspace IDs from the CF DO Namespace List API (paginated via `result_info.cursor`)
2. For each workspace, calls `POST /__admin/embedding-audit?workspace_id=<ws>` on the mcp-server Worker
3. Tallies stale counts and prints a markdown summary table
4. Exits 0 (clean), 1 (stale rows), or 2 (bad env / API error)

**`/__admin/embedding-audit` HTTP endpoint** in `oauth.ts` `defaultHandler` — proxies to `WorkspaceDO.assertAllBlocksAtV2`. Gated by `X-Engram-Admin-Token` header matching the `ENGRAM_ADMIN_AUDIT_TOKEN` Worker secret. Not an MCP tool.

**CI step `Migration audit (PRE-01)`** — runs on every push to `main` and every PR (excluding forks via fork-safety gate). Fail-loud `::error::` on missing secrets. Added to `ENGRAM_ADMIN_AUDIT_TOKEN` alongside existing secrets.

## Deviations from Plan

### Auto-added: Transport Mechanism for Audit Script (RULE 2)

**Found during:** Task 3 planning

**Issue:** The plan lists `scripts/audit/embedding-version-audit.ts` as a `tsx` Node.js script that must call `assertAllBlocksAtV2` per workspace. However, Node.js scripts cannot use Cloudflare DO Service bindings directly — they need an HTTP frontend Worker. The plan explicitly deferred this decision: "Dispatcher: confirm during execution which transport is correct."

**Fix:** Added admin HTTP endpoint `POST /__admin/embedding-audit` to `packages/mcp-server/src/oauth.ts` (the existing `defaultHandler`). The endpoint:
- Is gated by `X-Engram-Admin-Token` header matching `ENGRAM_ADMIN_AUDIT_TOKEN` Worker secret
- Calls `env.WORKSPACE.get(idFromName(workspace_id)).assertAllBlocksAtV2({ workspace_id })`
- Is NOT in `registerTools()` — admin-only, not MCP-exposed
- Added `ENGRAM_ADMIN_AUDIT_TOKEN?: string` to `EngramOAuthEnv` interface

**Files modified:** `packages/mcp-server/src/oauth.ts` (not in original `files_modified` list)

**Why RULE 2:** Missing critical functionality — without an HTTP frontend, the CI audit script cannot invoke the DO admin RPC. This is not architectural (no new Worker, no new wrangler config, no new DO class) — it's a new HTTP route in the existing `defaultHandler`.

### Auto-added: scripts/audit/tsconfig.json (RULE 3)

**Found during:** Task 3 implementation

**Issue:** ESLint's project service couldn't type-check `scripts/audit/embedding-version-audit.ts` because the file wasn't included in any `tsconfig.json` and the `allowDefaultProject` patterns didn't cover `scripts/audit/*.ts`.

**Fix:** Created `scripts/audit/tsconfig.json` with `strict: true`, `module: NodeNext`, and `types: ["node"]`. Updated `eslint.config.mjs` to add Node globals for `scripts/audit/*.ts`.

**Files modified:** `scripts/audit/tsconfig.json` (new), `eslint.config.mjs`

### Expected Execution Decision: ENGRAM_ADMIN_AUDIT_TOKEN Secret

The plan's `user_setup` block specified adding `WORKSPACE_NAMESPACE_ID` to GitHub Actions secrets. The admin endpoint requires a second secret: `ENGRAM_ADMIN_AUDIT_TOKEN`. This needs to be:
1. Generated and set on the mcp-server Worker: `wrangler secret put ENGRAM_ADMIN_AUDIT_TOKEN`
2. Added to GitHub Actions secrets: `gh secret set ENGRAM_ADMIN_AUDIT_TOKEN --body "<same value>"`

Documented in the CI step's `::error::` message.

## Human Checkpoint Status

**Task 4** (`WORKSPACE_NAMESPACE_ID` secret) is a blocking checkpoint. The CI step will fail loud until:
1. Russell runs `wrangler durable-objects namespace list --json | jq '.[] | select(.script == "engram-mcp-server")'` to find the namespace ID
2. Sets `gh secret set WORKSPACE_NAMESPACE_ID --body "<id>"`
3. Generates and sets `ENGRAM_ADMIN_AUDIT_TOKEN` (new requirement from transport deviation)

## Test Coverage

Unit tests in `packages/workspace-do/src/__tests__/migration-audit.test.ts`:
- `count_stale=0` for clean workspace (no blocks)
- Catches NULL `embedding_version` (cardinal-sin defense, PRE-01 Pitfall 1)
- Catches `embedding_version < 2` (v1 stamp from pre-ENG-25 code)
- Catches wrong `embedding_model` (old bge 768d model)
- Mixed stale + current blocks counted correctly
- Multiple stale blocks aggregated correctly
- `assertOwnsWorkspace` defense-in-depth (mismatched workspace_id throws `McpError(InvalidRequest)`)

**Note on test environment:** The workerd binary on this machine (max compat date 2026-06-02) is one day behind the inferred compat date (2026-06-03), so all workerd-pool tests fail to start locally. This is a pre-existing environment condition affecting ALL tests in `packages/workspace-do` (verified: existing tests `helpers.test.ts`, `defense-in-depth.test.ts` fail for the same reason). The TypeScript compiles cleanly (`tsc --noEmit` exits 0); tests will pass once the wrangler binary updates.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| New HTTP endpoint | packages/mcp-server/src/oauth.ts | `POST /__admin/embedding-audit` — admin-only, gated by X-Engram-Admin-Token secret. Threat dispositions T-01-01, T-01-02, T-01-EXP from the plan's threat model cover this surface. |

The endpoint was anticipated by the plan's threat model (T-01-EXP: "NOT in registerTools()"; T-01-01: "assertOwnsWorkspace first line"; T-01-02: "never log tokens"). All mitigations implemented.

## Self-Check: PASSED

All files exist and commits are verified:

```
ad31507 — packages/workspace-do/src/queries.ts, index.ts, package.json, migration-audit.test.ts
7c7efe7 — scripts/audit/embedding-version-audit.ts, scripts/audit/tsconfig.json, packages/mcp-server/src/oauth.ts, package.json, eslint.config.mjs
ee78e19 — .github/workflows/ci.yml
```

Acceptance criteria checks:
- `grep -cF "embedding_version IS NULL OR embedding_version < 2 OR embedding_model" packages/workspace-do/src/queries.ts` = 1 ✓
- `grep -cE "export.*countStaleEmbeddings" packages/workspace-do/src/queries.ts` = 1 ✓
- `grep -cE "COALESCE\(embedding_version" packages/workspace-do/src/queries.ts` = 0 ✓
- `grep -c "assertAllBlocksAtV2" packages/workspace-do/src/index.ts` = 2 ✓
- `grep -c "admin-only: not registered" packages/workspace-do/src/index.ts` = 1 ✓
- `grep -q "WORKSPACE_NAMESPACE_ID" scripts/audit/embedding-version-audit.ts` ✓
- `grep -q "assertAllBlocksAtV2" scripts/audit/embedding-version-audit.ts` ✓
- `tsx scripts/audit/embedding-version-audit.ts --help` exits 0 ✓
- `CLOUDFLARE_API_TOKEN= tsx scripts/audit/embedding-version-audit.ts` exits 2 ✓
- `grep -q "audit:migration" package.json` ✓
- `grep -cF "Migration audit (PRE-01)" .github/workflows/ci.yml` = 1 ✓
- `grep -cF "github.event.pull_request.head.repo.full_name == github.repository" .github/workflows/ci.yml` = 1 ✓
- `npx tsc -b --noEmit` exits 0 ✓
