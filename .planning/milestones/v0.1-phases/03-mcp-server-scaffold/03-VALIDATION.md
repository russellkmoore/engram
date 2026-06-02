---
phase: 03
slug: mcp-server-scaffold
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x + `@cloudflare/vitest-pool-workers` (Phase 1 toolchain) |
| **Config file** | `packages/mcp-server/vitest.config.ts` (Wave 0 creates) + `packages/mcp-server/wrangler.test.jsonc` (Wave 0 creates) |
| **Quick run command** | `npm run test --workspace=packages/mcp-server` |
| **Full suite command** | `npm run test` (root — runs all workspaces) + `npm run lint:wrangler` |
| **Estimated runtime** | ~15s (quick), ~30s (full suite incl. all workspaces + lints) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test --workspace=packages/mcp-server` (quick command)
- **After every plan wave:** Run `npm run test` + `npm run lint:wrangler` (full suite command)
- **Before `/gsd:verify-work`:** Full suite must be green; MCP Inspector manual smoke (MCP-09) must also be performed
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Filled in by planner using task IDs from PLAN.md files. Wave 0 (W0) tasks build the test scaffolding itself; later waves consume it.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | (infra) | — | N/A | unit-scaffold | `npm run test --workspace=packages/mcp-server` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | (infra) | — | N/A | unit-scaffold | `npm run test --workspace=packages/mcp-server` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | MCP-06 | T-03-DD-IN (defense-in-depth — schemas MUST NOT accept `workspace_id`) | Tool input schemas reject any field named `workspace_id` | unit | `npm run test --workspace=packages/mcp-server -- schemas` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | MCP-05 | T-03-DD-RT (defense-in-depth — routing MUST use `this.props.workspace_id`) | Tool stub calls `getAgentByName(env.WORKSPACE, this.props.workspace_id)`; never reads `args.workspace_id` | unit | `npm run test --workspace=packages/mcp-server -- tools` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | MCP-06 | — | Tool stubs throw `McpError(MethodNotFound)` with Phase 4 pointer | unit | `npm run test --workspace=packages/mcp-server -- tools` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | MCP-04 | T-03-JWT (unauthenticated request must reject) | OAuth provider rejects requests missing/invalid bearer JWT with structured JSON-RPC error | unit | `npm run test --workspace=packages/mcp-server -- oauth` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 2 | MCP-04 | T-03-PROPS (props MUST come from JWT, not request body) | `props.workspace_id` + `props.user_id` are populated only from validated JWT via `authorize` hook reading `ENGRAM_IDENTITIES` KV | unit | `npm run test --workspace=packages/mcp-server -- oauth` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 3 | MCP-01, MCP-02 | — | Worker default export is `OAuthProvider`; `/mcp` mounts `EngramMcp.serve("/mcp")` via `apiHandler` | unit + lint | `npm run test --workspace=packages/mcp-server -- index` + `npm run lint:wrangler` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 3 | MCP-03 | — | `wrangler.jsonc › migrations[]` contains `{ "tag": "v2", "new_sqlite_classes": ["EngramMcp"] }` AND v1 still contains `WorkspaceDO` | lint | `npm run lint:wrangler` | ✅ | ⬜ pending |
| 03-05-03 | 05 | 3 | MCP-03 | — | `wrangler deploy --dry-run` exits 0 | cli | `npx wrangler deploy --dry-run --workspace=packages/mcp-server` | ✅ | ⬜ pending |
| 03-06-01 | 06 | 4 | (DEP-05) | — | DEP-05 README documents `mcp-remote` + Claude Desktop config snippet + `npm run kv:bootstrap` flow + MCP Inspector smoke steps | doc-assertion | `grep -q "mcp-remote" packages/mcp-server/README.md && grep -q "ENGRAM_IDENTITIES" packages/mcp-server/README.md` | ❌ W0 | ⬜ pending |
| 03-06-02 | 06 | 4 | MCP-09 | — | MCP Inspector lists all 5 tools by name against local `wrangler dev` | manual | (manual smoke — see Manual-Only Verifications) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Note:** The threat references above (T-03-DD-IN, T-03-DD-RT, T-03-JWT, T-03-PROPS) are placeholder IDs that the planner will reconcile against PLAN.md `<threat_model>` blocks. The defense-in-depth threats are inherited from Phase 2 STO-07 (the MT-1 irreversible decision) — Phase 3 plans must restate them in their threat models since the new attack surface is the tool input boundary.

---

## Wave 0 Requirements

- [ ] `packages/mcp-server/vitest.config.ts` — vitest configuration using `@cloudflare/vitest-pool-workers`, points at `packages/mcp-server/wrangler.test.jsonc`
- [ ] `packages/mcp-server/wrangler.test.jsonc` — test-only wrangler config (separate from production `wrangler.jsonc`) with `ENGRAM_IDENTITIES` KV preview + OAuth provider KV preview bindings, mirroring the Phase 2 test-config pattern
- [ ] `packages/mcp-server/test/schemas.test.ts` — RED test stubs asserting D-06 zod input schemas exist + defense-in-depth (no `workspace_id` field accepted in any input schema)
- [ ] `packages/mcp-server/test/tools.test.ts` — RED test stubs asserting all 5 stub handlers throw `McpError(MethodNotFound)` with the phase-pinned message + assert the routing helper passes `this.props.workspace_id` not `args.workspace_id`
- [ ] `packages/mcp-server/test/oauth.test.ts` — RED test stubs asserting OAuth provider rejects unauthenticated `/mcp` requests + `authorize` hook reads `ENGRAM_IDENTITIES` KV by `sub` claim and populates `props.{workspace_id, user_id}`
- [ ] `packages/mcp-server/test/index.test.ts` — RED test stubs asserting default export is the `OAuthProvider` instance (not `EngramMcp` directly) and `/health` + `/` routes respond without auth

*No new framework install — Phase 1 already wired vitest + `@cloudflare/vitest-pool-workers` for `packages/workspace-do`. Phase 3 reuses the same setup, mirroring the Phase 2 test config.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP Inspector connects to local `wrangler dev` and lists all 5 tools (`remember`, `recall`, `search`, `forget`, `ingest`) by name; clicking each returns the `MethodNotFound` Phase 4 pointer | MCP-09 | Inspector spawns its own browser UI and requires a live OAuth handshake; D-08 Claude's Discretion accepts manual smoke for v0.1 (CI integration deferred to v0.2 only if regressions appear) | 1. `npm run dev --workspace=packages/mcp-server` (`wrangler dev` on :8787). 2. In a separate terminal: `npx @modelcontextprotocol/inspector`. 3. Set transport to "Streamable HTTP", URL to `http://localhost:8787/mcp`. 4. Complete the OAuth dance (browser opens `/authorize`; auto-approves Russell's `sub` from `ENGRAM_IDENTITIES`). 5. Confirm Inspector "Tools" tab shows all 5 by name. 6. Call any tool; expect `MethodNotFound` with message containing the Phase 4 / TOL-0N pointer. |
| First-token mcp-remote flow from Claude Desktop | DEP-02 (D-03 updated) | Requires Claude Desktop app + real browser auth dance; v0.1 single-user UX validation | 1. Add the `mcp-remote https://engram-mcp.workers.dev/mcp` snippet from DEP-05 README to Claude Desktop's MCP config. 2. Restart Claude Desktop. 3. Ask Claude to call `remember`; browser opens `/authorize`. 4. Confirm token is cached locally by `mcp-remote`. 5. Confirm the `MethodNotFound` Phase 4 pointer is returned in the Claude Desktop UI. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify command OR explicit manual-only entry above
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (verified by ordering Wave 0 RED tests before Wave 1+ implementation)
- [ ] Wave 0 covers all MISSING references (vitest config, test wrangler config, 4 RED test files)
- [ ] No watch-mode flags (all commands use one-shot `vitest run` semantics)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (toggled by planner once PLAN.md task IDs are wired into the verification map)

**Approval:** pending
