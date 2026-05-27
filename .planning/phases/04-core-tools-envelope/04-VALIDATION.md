---
phase: 04
slug: core-tools-envelope
status: resolved
nyquist_compliant: true
wave_0_complete: true
wave_1_complete: true
wave_2_complete: true
wave_3_complete: true
wave_4_complete: true
created: 2026-05-26
resolved: 2026-05-27
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` §Validation Architecture (lines 573–702).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.7 + `@cloudflare/vitest-pool-workers` 0.16.9 |
| **Config file** | `packages/mcp-server/vitest.config.ts` (existing) + `wrangler.test.jsonc` (existing) |
| **Quick run command** | `npm run test --workspace=@engram/mcp-server` |
| **Full suite command** | `npm run test --workspaces --if-present` |
| **Estimated runtime** | ~30s quick / ~60s full |

---

## Sampling Rate

- **After every task commit:** Run `npm run test --workspace=@engram/mcp-server`
- **After every plan wave:** Run `npm run test --workspaces --if-present`
- **Before `/gsd:verify-work`:** Full suite must be green AND MCP Inspector smoke recorded as an artifact
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Concrete task IDs are assigned during plan-phase (one row per task once PLAN.md files land). This table seeds the planner with the requirement-to-test mapping derived from research §Validation Architecture.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TOL-01 | `remember()` writes block + returns EngramResponse with `id`, `classified_type`, empty `extracted_fields`, null `confidence`, empty `context.conflicts` | unit (envelope) + integration (DO) | `vitest run src/__tests__/tools-integration.test.ts -t remember` | ✅ W0 | ✅ green |
| TOL-02 | `recall()` returns lexical hits + null `synthesis` + verbosity branches + `meta.gaps` + `meta.last_updated` populated | unit + integration | `vitest run -t recall` | ✅ W0 | ✅ green |
| TOL-03 | `search()` accepts NO `format?` param + returns memories with structured filters + `result.count` | unit + integration | `vitest run -t search` | ✅ W0 | ✅ green |
| TOL-04 | `remember → forget → recall=0` round-trip; `cascade=true` removes relations rows | integration | `vitest run -t "forget round-trip"` | ✅ W0 | ✅ green |
| TOL-05 | `ingest()` returns `{status: "accepted", job_id: <UUID>}` envelope; no Queue send | unit | `vitest run -t ingest` | ✅ W0 | ✅ green |
| TOL-06 | Every tool response has all envelope fields PRESENT (even if null/empty) | unit (envelope) | `vitest run src/__tests__/envelope.test.ts` | ✅ W0 | ✅ green |
| TOL-07 | Cross-workspace forgery — `props.workspace_id=B` addressing DO of A throws `InvalidRequest` (two-pronged: data-isolation + active `assertOwnsWorkspace`) | integration | `vitest run src/__tests__/cross-workspace-pentest.test.ts` | ✅ W0 | ✅ green |
| TOL-08 | Local smoke against `wrangler dev` via MCP Inspector (preferred) or `scripts/smoke-job-agent.mjs` | manual + recorded artifact | `npx @modelcontextprotocol/inspector` | ✅ W4 | ✅ green |
| MCP-07 | Bad input → `McpError(InvalidParams)`; missing auth → `McpError(InvalidRequest)`; unknown error → `McpError(InternalError)` with sanitized message | integration | `vitest run -t "McpError shape"` | ❌ W0 (extend `error-mapping.test.ts`) | ⬜ pending |
| MCP-08 | Worst-case envelope post-trim ≤ 7,500 tokens; each tool description ≤ 1,500 bytes | unit | `vitest run src/__tests__/token-budget.test.ts` | ✅ W0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/mcp-server/src/__tests__/envelope.test.ts` — covers TOL-06 (envelope shape per tool); reads `META_GAPS` const for byte-exact assertions
- [x] `packages/mcp-server/src/__tests__/tools-integration.test.ts` — covers TOL-01/02/03/04/05 round-trips (remember → recall → forget via `runInDurableObject` on `MCP_OBJECT` DO with manual `props` injection)
- [x] `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — covers TOL-07 (forged `props.workspace_id`, both data-isolation AND `assertOwnsWorkspace` paths)
- [x] `packages/mcp-server/src/__tests__/token-budget.test.ts` — covers MCP-08 (worst-case fixture + post-trim assertion + tool-description size assertion via `new TextEncoder().encode(desc).byteLength`)
- [x] Extension to `packages/mcp-server/src/__tests__/tools.test.ts` — happy-path callback assertions per tool (current file only tests `MethodNotFound` stubs; W0 RED → W2 GREEN)
- [x] Extension to `packages/mcp-server/src/__tests__/error-mapping.test.ts` — assert `mapToMcpError(new NotFoundError("block", "x"))` returns `McpError(InvalidParams)`; assert `mapToMcpError(new Error("/Users/secret/path"))` sanitizes the path (regression lock for Phase 3 D-09 + threat T-03-LEAK)
- [x] `npm install --workspace=@engram/mcp-server gpt-tokenizer` — required for token-budget test. Planner inserts a `checkpoint:human-verify` step per the Package Legitimacy Audit fallback (D-09 + research A1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Local MCP Inspector smoke against `wrangler dev` | TOL-08 | Browser-driven OAuth bridge + interactive tool invocation cannot run headless in CI without forging tokens; recorded transcript is the artifact | 1. `wrangler dev` in `packages/mcp-server`. 2. `npx @modelcontextprotocol/inspector` → connect to local MCP. 3. Exercise `remember` → `recall` → `forget` round-trip with a job-posting fixture. 4. Capture response JSON + a screenshot, commit under `.planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md` (mirror Phase 3's pattern). |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-27 — all 5 plans complete, 116 vitest tests GREEN
(90 mcp-server + 26 workspace-do), TOL-08 LOCAL smoke resolved via
`04-MCP-INSPECTOR-SMOKE.md` `status: resolved`.
