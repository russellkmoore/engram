---
phase: 03-mcp-server-scaffold
plan: 06
subsystem: docs
tags: [mcp-server, docs, oauth-flow, mcp-inspector, manual-verification, kv-bootstrap]

# Dependency graph
requires:
  - phase: 03-mcp-server-scaffold
    plan: 05
    provides: "real OAuthProvider-wrapped default export, wrangler.jsonc v2 migration with EngramMcp in new_sqlite_classes, KV bindings (OAUTH_KV + ENGRAM_IDENTITIES) — the runtime surface the README documents and the smoke test exercises"
  - phase: 03-mcp-server-scaffold
    plan: 04
    provides: "oauth.ts /authorize KV identity lookup behavior the README's 'first 403 returns sub' procedure depends on; ENGRAM_IDENTITIES lookup format that kv-bootstrap script seeds"
  - phase: 03-mcp-server-scaffold
    plan: 01
    provides: "scripts/kv-bootstrap.mjs CLI + root `npm run kv:bootstrap` script the README documents as the chicken-and-egg unblock for first-time sub discovery"
provides:
  - "packages/mcp-server/README.md (396 lines) — DEP-05 setup documentation covering OAuth dance via mcp-remote, Claude Desktop config snippets (production + local-dev), npm run kv:bootstrap procedure, wrangler secret put COOKIE_ENCRYPTION_KEY, and the MCP Inspector two-terminal smoke procedure"
  - ".planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md — smoke-test record file in DEFERRED state pending Russell's live run"
affects: [04-core-tools-envelope, 07-deploy-acceptance, ship-v0.1]

# Tech tracking
tech-stack:
  added: []  # docs-only plan
  patterns:
    - "Setup README structure: Pre-flight → Configure → Run → Verify → Troubleshoot, with copy-pasteable shell snippets and Claude Desktop JSON snippets side-by-side for production vs local-dev"
    - "T-03-DOC-LEAK clean: README scrubbed for >=32-char hex strings, JWT-shaped strings, real KV namespace IDs; uses placeholder tokens like `<id-from-wrangler-kv-namespace-create>` and `<your-sub>` instead"

key-files:
  created:
    - packages/mcp-server/README.md
    - .planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md
  modified: []

key-decisions:
  - "MCP-09 (live MCP Inspector smoke) deferred at user request during /gsd:execute-phase 3 checkpoint on 2026-05-26. Phase 03 closes with the smoke gate tracked as an open UAT item, not failed — the README + procedure are committed and reproducible, and Russell will run the smoke and update 03-MCP-INSPECTOR-SMOKE.md in place before /gsd:ship."
  - "README chose `wrangler dev --remote` as the recommended smoke mode (vs. local-only KV) — the OAuth dance hits ENGRAM_IDENTITIES KV reads that are easier to reason about against the bootstrapped production namespace than against a fresh local KV that would force the chicken-and-egg dance every restart."

patterns-established:
  - "Non-autonomous-plan checkpoint handling for documentation-only Task 2: when the live verification step is deferred, write the smoke-record file with `status: deferred` frontmatter + a procedure block + an explicit 'before /gsd:ship' unblock marker rather than synthesizing a fake result."

requirements-completed: [MCP-09-DEFERRED, DEP-05]  # DEP-05 (README) fully done; MCP-09 documented + procedurally ready, awaiting live verification — tracked in 03-MCP-INSPECTOR-SMOKE.md.

# Metrics
duration: ~5min  # Task 1 README write + commit was done by the original executor (commit 1ad8abd, ~5min from worktree spawn to commit). Task 2 deferred → 0min execution.
completed: 2026-05-26
---

# Phase 3 Plan 06: README + MCP Inspector Smoke Summary

**Setup README documenting OAuth dance via mcp-remote, Claude Desktop config, kv:bootstrap procedure, and MCP Inspector smoke — committed. Live smoke deferred at user election; tracked as open UAT in 03-MCP-INSPECTOR-SMOKE.md.**

## Performance

- **Duration:** ~5 min for Task 1 (executor agent in worktree); Task 2 deferred (0 min execution)
- **Completed:** 2026-05-26
- **Tasks:** 1/2 fully done, 1/2 deferred-with-record
- **Files modified:** 2 (1 created by executor, 1 created by orchestrator after deferral checkpoint)

## Accomplishments

- **Task 1 (autonomous):** `packages/mcp-server/README.md` written (396 lines) covering the full v0.1 setup surface for Engram self-hosters:
  - OAuth dance via `mcp-remote` (the first-token issuance flow)
  - Claude Desktop config snippets — production (`workers.dev` URL) and local-dev (`localhost:8787`) variants side-by-side
  - One-time `npx wrangler kv namespace create` for both OAUTH_KV + ENGRAM_IDENTITIES
  - `wrangler secret put COOKIE_ENCRYPTION_KEY` step with `openssl rand -hex 32` suggestion
  - `npm run kv:bootstrap` procedure including the chicken-and-egg sub-discovery flow (Pitfall 5: first connect returns 403 with the dynamic-registered client_id as `sub`; copy it; run the bootstrap; reconnect)
  - MCP Inspector two-terminal smoke procedure (Pattern 7 from RESEARCH)
  - T-03-DOC-LEAK clean: no real hex keys, no JWT-shaped strings, no real KV namespace IDs — uses placeholder tokens
- **Task 2 (non-autonomous, deferred):** `.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md` written in DEFERRED state with:
  - Frontmatter `status: deferred`, `deferred_at: 2026-05-26`, `deferred_by: russell`
  - `target_unblock: "Before /gsd:ship for Phase 03"`
  - Full smoke procedure inline (mirrors the README; redundant on purpose so the smoke record stands alone when Russell returns to it)
  - 7-checkbox acceptance criteria (OAuth dance + 5-tool list + per-tool TOL-0N error shape)
  - Recording instructions: edit in place, flip frontmatter to `status: resolved`, append `## Smoke Run` section with date / mode / observed sub / pass-fail / deviations, commit with `test(03-06): record MCP Inspector smoke outcome (resolves MCP-09)`.

## Task Commits

1. **Task 1: Write packages/mcp-server/README.md** — `1ad8abd` (docs)
   _Committed by the original executor agent in worktree-agent-a08605cb2101fe014; merged to main via `chore: merge executor worktree (03-06 README — task 1 of 2)`._
2. **Task 2: MCP Inspector smoke** — **deferred**; record committed separately by the orchestrator after Russell's checkpoint response (see commit appended by `/gsd:execute-phase 3` tracking).

**Plan metadata:** This SUMMARY.md committed by the orchestrator with the tracking + smoke-record commits.

## Files Created/Modified

- `packages/mcp-server/README.md` — DEP-05 setup documentation (created in worktree, committed as `1ad8abd`)
- `.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md` — smoke-test record (DEFERRED status; created by orchestrator after checkpoint deferral)

## Decisions Made

- **Defer the live MCP Inspector smoke.** During the Task 2 checkpoint, Russell selected "Defer — mark as pending" via the orchestrator's AskUserQuestion. Phase 03 closes with the smoke gate tracked as an open UAT item, not failed.
- **Documentation-first deferral pattern.** Rather than spawn a continuation executor agent to "synthesize" a fake smoke result, the orchestrator wrote the smoke-record file directly with a `status: deferred` frontmatter + procedure block + explicit "before /gsd:ship" unblock marker. The smoke must be performed by Russell against a real workerd instance; nothing in the agent toolchain can substitute.
- **Recommend `wrangler dev --remote` for the smoke (in the README).** Local-only KV would force the chicken-and-egg dance every dev-server restart (since the OAUTH_KV state is lost). `--remote` hits the bootstrapped production namespaces and is easier to reason about.

## Deviations from Plan

**1. Task 2 deferred via human-action checkpoint**
- **Found during:** Task 2 (MCP Inspector smoke gate)
- **Issue:** Plan declares this task as `checkpoint:human-verify` requiring Russell to physically run `wrangler dev` + MCP Inspector against a long-lived server. The executor agent cannot perform this (no long-lived dev server, no browser UI control).
- **Resolution:** Executor emitted a structured `human-action` checkpoint to the orchestrator. Orchestrator surfaced the choice to Russell via AskUserQuestion (3 options: run now / defer / already-done). Russell chose **defer**. Orchestrator wrote 03-MCP-INSPECTOR-SMOKE.md with `status: deferred` and an inline procedure + 7-checkbox acceptance criteria so the unblock is a 10-minute self-serve step.
- **Files modified:** `.planning/phases/03-mcp-server-scaffold/03-MCP-INSPECTOR-SMOKE.md`
- **Verification:** File has `status: deferred` frontmatter; phase verifier will surface MCP-09 as an open requirement to resolve before `/gsd:ship`.
- **Committed in:** orchestrator tracking commit at end of Wave 4 (post-merge, post-SUMMARY)

**Total deviations:** 1 deferred-by-design (not a flaw — non-autonomous plan working as specified). 0 auto-fixed.
**Impact on plan:** Phase 03 structural verification still passes (build, lint, typecheck, 48/48 mcp-server tests GREEN, no Phase 2 regression). MCP-09 acceptance is documented and procedurally ready; the live verification is the single open item before Phase 03 can `/gsd:ship`.

## Issues Encountered

- **Continuation strategy:** Originally considered spawning a fresh `gsd-executor` to continue in the same worktree, but the worktree was unlocked-and-removed after the checkpoint return. Instead the orchestrator merged the Task 1 README commit, then wrote the smoke-record + SUMMARY.md directly on main. This is correct for a docs-only deferral; no source code changes needed.

## User Setup Required

**MCP Inspector smoke (MCP-09) — DEFERRED, must be performed before `/gsd:ship` for Phase 03.**

See [`03-MCP-INSPECTOR-SMOKE.md`](./03-MCP-INSPECTOR-SMOKE.md) for the full procedure. Quick reference:

1. One-time per Cloudflare account: create OAUTH_KV + ENGRAM_IDENTITIES namespaces, paste IDs into `packages/mcp-server/wrangler.jsonc`, set `COOKIE_ENCRYPTION_KEY` via `wrangler secret put`.
2. `cd packages/mcp-server && npx wrangler dev --remote` in Terminal 1.
3. `npx @modelcontextprotocol/inspector` in Terminal 2, point at `http://localhost:8787/mcp`, do OAuth dance (run `npm run kv:bootstrap -- --sub <copied-sub> ...` if 403 fires), verify Tools tab shows 5 tools each throwing `McpError -32601 MethodNotFound` with Phase-4 TOL-0N hints.
4. Edit `03-MCP-INSPECTOR-SMOKE.md` in place: flip frontmatter to `status: resolved`, add `## Smoke Run` section with date / mode / observed sub / pass-fail / deviations. Commit with `test(03-06): record MCP Inspector smoke outcome (resolves MCP-09)`.

## Next Phase Readiness

- **Phase 04 (Core Tools + Envelope)** is fully unblocked: all 5 tool stubs (`remember`, `recall`, `search`, `forget`, `ingest`) are registered with phase-pinned `McpError(MethodNotFound)` messages that Phase 4 plans will replace one-by-one. The defense-in-depth contract (`args.workspace_id: props.workspace_id`) is documented in the tools.ts Phase-4-ready comment block. The `EngramProps` interface is published, the OAuth provider mounts the defaultHandler, and the wrangler.jsonc v2 migration declares `EngramMcp` as SQLite-backed.
- **One open UAT** to close before `/gsd:ship`: MCP-09 (live MCP Inspector smoke). Tracked in 03-MCP-INSPECTOR-SMOKE.md.

---
*Phase: 03-mcp-server-scaffold*
*Completed: 2026-05-26*
