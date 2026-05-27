---
phase: "04"
plan: "04"
subsystem: "mcp-server"
tags: ["tests", "TOL-07", "MCP-08", "cross-workspace", "token-budget", "pentest", "D-10"]
dependency_graph:
  requires:
    - "04-01: cross-workspace-pentest.test.ts + token-budget.test.ts RED scaffolds"
    - "04-02: envelope.ts (buildRecallResponse + trimToBudget)"
    - "04-03: tools.ts live handler bodies (remember/recall/search/forget/ingest)"
    - "Phase 2: WorkspaceDO.assertOwnsWorkspace (STO-07)"
  provides:
    - "cross-workspace-pentest.test.ts: live TOL-07 two-prong behavioral proof"
    - "Prong A: data isolation by DO routing (captureCallback through live handlers)"
    - "Prong B: active assertOwnsWorkspace regression lock (runInDurableObject mirror of defense-in-depth.test.ts:180-228)"
    - "token-budget.test.ts: live MCP-08 worst-case trim + description-size + adversarial proof"
    - "captureToolRegistrations helper at file scope in token-budget.test.ts"
    - "Negative-fixture sanity: un-trimmed envelope > 8,000 tokens adversarial lock"
  affects:
    - "Plan 04-05: Wave 3 complete; only TOL-08 smoke + DEP-05 README amendment remains"
    - "Phase 5: T-04-WSF + T-04-DOS mitigations now behaviorally proven"
tech_stack:
  added: []
  patterns:
    - "captureCallback spy for handler routing isolation test (Prong A)"
    - "runInDurableObject + asWorkspaceDO shim for direct DO method invocation (Prong B)"
    - "captureToolRegistrations spy for tool registration inspection"
    - "gpt-tokenizer/encoding/cl100k_base (Pitfall 6: specific path, not barrel)"
    - "TextEncoder.encode().byteLength (workerd-native, not Buffer.byteLength)"
key_files:
  created: []
  modified:
    - "packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts — Prong A/B live bodies + asWorkspaceDO shim"
    - "packages/mcp-server/src/__tests__/token-budget.test.ts — captureToolRegistrations + adversarial test"
    - ".planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md — Plan 04 tracking rows"
decisions:
  - "Prong A optional reinforcement assertion added: legit recall from workspace_A returns ≥1 memory, ruling out false-positive pass from silent remember failure"
  - "Prong B uses asWorkspaceDO shim at file scope (mirrors defense-in-depth.test.ts:55-61) instead of raw InstanceType<typeof WorkspaceDO> cast in body"
  - "Prong B message-shape lock-in adds Workspace mismatch check (mirrors defense-in-depth.test.ts:222-227) completing the MT-1/STO-07 regression lock"
  - "token-budget.test.ts captureToolRegistrations named to distinguish from tools.test.ts captureRegistrations (grep-namespace isolation)"
  - "Adversarial test inlines worst-case fixture (does not reuse buildWorstCaseMemories) per plan instruction — self-contained it() blocks"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-27"
  tasks_completed: 6
  tasks_total: 6
  files_changed: 3
  insertions: 112
  deletions: 30
---

# Phase 4 Plan 04: TOL-07 + MCP-08 Live Assertions Summary

Phase 4 plan 04 replaces Plan 04-01 RED scaffolds in `cross-workspace-pentest.test.ts` and `token-budget.test.ts` with LIVE assertion bodies that exercise the production code shipped by Plans 04-02 (envelope.ts) and 04-03 (live tool handler bodies). This plan delivers the BEHAVIORAL proof of TOL-07 (cross-workspace isolation) and MCP-08 (8K-token + 1.5KB-description budgets).

## One-liner

TOL-07 two-prong behavioral proof (captureCallback routing isolation + runInDurableObject assertOwnsWorkspace regression lock) and MCP-08 adversarial verification (worst-case trim ≤ 7,500 tokens, 5 descriptions ≤ 1,500 bytes, un-trimmed > 8,000 token lock), bringing the full mcp-server suite to 90/90 GREEN.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 04-01 | Add asWorkspaceDO shim; Prong A reinforcement assertion (legit recall ≥1 memory) | `fda78ad` | cross-workspace-pentest.test.ts |
| 04-02 | Prong B: Workspace mismatch message-shape lock-in (mirrors defense-in-depth.test.ts:222-227) | `fda78ad` | cross-workspace-pentest.test.ts |
| 04-03 | Worst-case recall test was already GREEN from Plan 04-01/02; verified 7,500 token cap holds | `cb2299b` | token-budget.test.ts (no change needed) |
| 04-04 | Add captureToolRegistrations helper; refactor description-size it() + toHaveLength(5) | `cb2299b` | token-budget.test.ts |
| 04-05 | Add adversarial negative-fixture sanity test: un-trimmed envelope > 8,000 tokens | `cb2299b` | token-budget.test.ts |
| 04-06 | Full suite verification: 90/90 GREEN, structural invariants intact | `cb2299b` | — |

## File: packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts

### Prong A (data isolation by DO routing)

- Seeds `workspace_A` via the live `remember` handler: `captureCallback("remember", "workspace_A")`
- Invokes `recall` with FORGED `props.workspace_id="workspace_B"`: `captureCallback("recall", "workspace_B")`
- Asserts `envelope.result.memories === []`: data isolation holds via `workspaceNs.get(idFromName(props.workspace_id))` routing — the forged props cause the handler to address a DIFFERENT DO instance, so workspace_A's data is unreachable regardless of `assertOwnsWorkspace`.
- **Optional reinforcement assertion**: legit recall via `captureCallback("recall", "workspace_A")` returns ≥1 memory — confirms the seed actually landed, preventing false-positive pass from silent remember failure.

### Prong B (active assertOwnsWorkspace backstop)

- Uses `runInDurableObject(stubA, ...)` to call `lexicalSearchBlocks` directly on the `workspace_A` DO stub with `workspace_id: "workspace_B"` (FORGED arg).
- `asWorkspaceDO(instance)` shim at file scope narrows the instance type (mirrors `defense-in-depth.test.ts:55-61`).
- Asserts the sync throw is `instanceof McpError`, `code === ErrorCode.InvalidRequest = -32600`.
- **Message-shape lock-in** (mirrors `defense-in-depth.test.ts:222-227`):
  - `msg.toContain("Workspace mismatch")` — locks the error prefix
  - `msg.toContain("workspace_A")` — locks the DO's bound workspace ID in the message
  - `msg.toContain("workspace_B")` — locks the forged claim in the message

### Mechanism note

Both prongs use try/catch (NOT `.rejects.toThrow()`) because DO methods are SYNCHRONOUS — the `runInDurableObject` callback is async but `instance.lexicalSearchBlocks(...)` throws synchronously (per `defense-in-depth.test.ts` JSDoc at lines 36-41).

## File: packages/mcp-server/src/__tests__/token-budget.test.ts

### Worst-case recall test (Tasks 04-03)

The worst-case trim test was already GREEN from Plan 04-01/02. Verified:
- 25 `LexicalSearchHit` rows × `content: "x".repeat(4_000)` + `summary: "y".repeat(1_000)`
- `buildRecallResponse({ memories, verbosity: "synthesis" })` + `trimToBudget(envelope)`
- Post-trim: `encode(JSON.stringify(trimmed)).length <= 7_500` — passes
- D-10 invariants preserved: `trimmed.meta` defined, `meta.gaps.length > 0`, `context.conflicts` intact

### Description-size test (Task 04-04)

Refactored to use `captureToolRegistrations()` helper at file scope:
- `expect(registrations).toHaveLength(5)` — sanity check (5 tools registered)
- Per registration: `new TextEncoder().encode(description).byteLength <= 1_500`
- Non-empty check: `description.length > 0` — prevents vacuous pass
- Max observed description byte length: all 5 descriptions well under 1,500 bytes

### Adversarial proof test (Task 04-05)

New `it()` block in a separate `describe` block:
- Builds the same 25 × 4KB × 1KB fixture inline (self-contained per plan convention)
- `encode(JSON.stringify(envelope)).length > 8_000` — proves the fixture is genuinely adversarial
- Observed token count: > 8,000 cl100k_base tokens (worst-case without trim)
- Lock comment: "If this assertion ever fails, the worst-case test is no longer load-bearing"

### captureToolRegistrations helper

Named `captureToolRegistrations` (not `captureRegistrations`) to avoid grep-namespace collision with `tools.test.ts`'s helper if both files are ever co-loaded in a test-helper extraction.

## Test State After Plan 04

| File | State | Tests |
|------|-------|-------|
| `cross-workspace-pentest.test.ts` | GREEN | 2/2 (Prong A + Prong B) |
| `token-budget.test.ts` | GREEN | 6/6 (worst-case + remember + ref-identity + D-10 invariants + description-size + adversarial) |
| `envelope.test.ts` | GREEN | 13/13 — no regression |
| `tools-integration.test.ts` | GREEN | 8/8 — no regression |
| `tools.test.ts` | GREEN | 13/13 — no regression |
| `schemas.test.ts` | GREEN | 24/24 — no regression |
| `error-mapping.test.ts` | GREEN | 10/10 — no regression |
| **Total** | **90/90 GREEN** | +1 new test vs Plan 03 baseline (adversarial proof) |

## Structural Invariants Verified (Task 04-06)

- `grep -c "SENTINEL-DD-RT-PHASE-03-TOOLS-TS" packages/mcp-server/src/tools.ts` = 1
- `grep -v non-comment packages/mcp-server/src/tools.ts | grep -c "args.workspace_id"` = 0
- `grep -v non-comment packages/mcp-server/src/schemas.ts | grep -c "workspace_id"` = 0

## Deviations from Plan

### Pre-existing state discovery

The Plan 04-01 scaffolds were not as RED as expected. When execution began:
- `cross-workspace-pentest.test.ts` already had live Prong A + Prong B bodies that were GREEN (2/2).
- `token-budget.test.ts` already had 5/5 tests GREEN including a live description-size assertion (inline spy pattern).

The plan's tasks were adapted to add the specific acceptance-criteria elements that were missing:
1. `asWorkspaceDO` shim at file scope (was absent)
2. Prong B `toContain("Workspace mismatch")` message-shape lock-in (was absent)
3. Prong A optional reinforcement assertion (was absent)
4. `captureToolRegistrations` helper at file scope (description-size used inline spy, not helper)
5. `toHaveLength(5)` sanity assertion (was absent)
6. Adversarial negative-fixture sanity test (was absent entirely)

All these additions were made cleanly. The pre-existing GREEN tests were preserved intact.

## Threat Model Coverage

| Threat | Status | Evidence |
|--------|--------|----------|
| T-04-WSF Prong A | Behaviorally proven | captureCallback routing test: forged workspace_B returns [] memories |
| T-04-WSF Prong B | Behaviorally proven | runInDurableObject assertOwnsWorkspace regression lock: McpError(InvalidRequest) + Workspace mismatch message |
| T-04-DOS (token) | Behaviorally proven | worst-case 25×4KB+1KB envelope trims to ≤ 7,500 cl100k_base tokens |
| T-04-DOS (description) | Behaviorally proven | 5 descriptions all ≤ 1,500 UTF-8 bytes via TextEncoder |
| T-04-RED-VS-LIVE | Mitigated | Adversarial fixture proves worst-case test is load-bearing (> 8,000 tokens raw) |
| T-04-DD-RT | Intact | SENTINEL + args.workspace_id ban + schemas.ts ban all verified |

## CF-Code-Assist Routing Log

Both code-producing tasks were routed to `claude` due to multi-file security reasoning requirements:
- Task 04-01/02: needed defense-in-depth.test.ts:180-228 pattern, RESEARCH §Pattern 4 two-prong design, and WorkspaceDO.assertOwnsWorkspace message contract simultaneously
- Task 04-04/05: needed PLAN.md D-10 spec, tools.ts registration surface, gpt-tokenizer path, TextEncoder pattern, and envelope.ts behavior across files

See `.planning/phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md` for the full table.

## Hand-off to Plan 04-05

Wave 3 is GREEN. Plan 04-05 (the final plan in Phase 4) covers:
- TOL-08: local smoke test via MCP Inspector or equivalent
- DEP-05: README amendment with v0.1 setup instructions
- Phase 5 hand-off note

All Wave 0/1/2/3 tests are GREEN (90/90). No regressions. Production-code structural invariants intact.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced.

This plan only modified test files (`cross-workspace-pentest.test.ts`, `token-budget.test.ts`). No production code was touched. No new trust-boundary crossings.

No threat flags to add.

## Known Stubs

None introduced by this plan. The pre-existing honest stubs from Plans 04-02/04-03 are documented in those plans' SUMMARY files.

## Self-Check: PASSED

- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — FOUND (157 lines, 2 passing tests)
- `packages/mcp-server/src/__tests__/token-budget.test.ts` — FOUND (233 lines, 6 passing tests)
- Commit `fda78ad` — FOUND (cross-workspace-pentest changes)
- Commit `cb2299b` — FOUND (token-budget + CF tracking changes)
- Full suite 90/90 GREEN — CONFIRMED
- `grep -c "function asWorkspaceDO" cross-workspace-pentest.test.ts` = 1 — CONFIRMED
- `grep -c "toContain(\"Workspace mismatch\")"` = 1 — CONFIRMED
- `grep -c "captureToolRegistrations"` ≥ 1 — CONFIRMED
- `grep -c "adversarial\|WITHOUT trimToBudget"` ≥ 1 — CONFIRMED
- `grep -c "toBeGreaterThan(8_000)"` = 1 — CONFIRMED
- SENTINEL-DD-RT-PHASE-03-TOOLS-TS in tools.ts = 1 — CONFIRMED
