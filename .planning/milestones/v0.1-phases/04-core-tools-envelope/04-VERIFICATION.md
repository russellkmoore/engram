---
phase: 04-core-tools-envelope
verified: 2026-05-27T14:46:17Z
re_verified: 2026-05-27T08:52:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 1
overrides:
  - id: TOL-08
    truth: "TOL-08 smoke has verifiable evidence (raw JSON capture or independent replay capability)"
    original_status: partial
    override_status: accepted
    accepted_by: rmoore
    accepted_at: "2026-05-27"
    rationale: >
      AC-01..AC-12 were verbally confirmed by the runner (Russell Moore) during the live
      MCP Inspector smoke on 2026-05-27. The smoke ran cleanly after two code-deviation
      fixes (commits 6e20d2d + 01a225e). Raw per-call JSON capture was elected to be
      skipped for time reasons. The verbal confirmation is accepted as sufficient evidence
      for Phase 4 closure given: (a) the smoke was executed by the workspace owner, not a
      third party; (b) the two deviations found and fixed during the smoke validate that a
      genuine live run occurred (a fabricated report would not surface workerd SQLite
      LIKE-pattern-length bugs); (c) future smokes (Phase 5 recall semantic upgrade, Phase
      7 DEP-04 Russell-agent reconfig) are required to capture raw JSON and will establish
      the evidence standard going forward.
    forward_note: >
      Phase 5 and Phase 7 DEP-04 smokes MUST capture raw JSON inline in their smoke
      artifacts. This override should not be used as a precedent for skipping JSON capture
      in future phases.
re_verification:
  previous_status: gaps_found
  previous_score: 8/10
  gaps_closed:
    - "remember() returns classified_type that matches what was stored in the blocks table (CR-01 BLOCKER — closed by Plan 04-06 commits 6e58f65 + 03d6031)"
    - "TOL-08 smoke has verifiable evidence (WARNING — closed by Plan 04-07 formal override, commit 16d60cb)"
  gaps_remaining: []
  regressions:
    - "tsc -b --noEmit reports 2 TS2352 errors in test files (env cast). Pre-existing before 04-06; present in commit 63fc0e5 which predates gap-closure plans. Not a regression introduced by 04-06 or 04-07. Tests run GREEN under vitest (91 mcp-server + 26 workspace-do)."
deferred:
  - truth: "recall() performs semantic search via Vectorize (TOL-02 REQUIREMENTS.md wording)"
    addressed_in: "Phase 5"
    evidence: "ROADMAP Phase 4 SC-2 explicitly scopes: 'recall backing is LIKE-based; semantic upgrade lands in P5.' Phase 5 goal: 'recall() performs semantic search and hydrates from SQLite.' Requirements TOL-02 describes the full v0.1 end-state, not Phase 4's scope."

  - truth: "remember() context.conflicts populated when lexical overlap is detected (ROADMAP SC-1)"
    addressed_in: "Phase 5"
    evidence: "CONTEXT.md D-08 explicitly resolves this: 'context.conflicts is empty in v0.1 — SC#1's when lexical overlap is detected is vacuously satisfied (no overlap detected because no detection runs). Phase 5 / AI-02 populates this field.' D-08 was a pre-approved design decision."

  - truth: "forget() deletes Vectorize vectors transactionally (REQUIREMENTS TOL-04)"
    addressed_in: "Phase 5"
    evidence: "ROADMAP Phase 4 SC-4: 'The forget contract already promises Vectorize vectors will be deleted too — implementation extends in P5.' AI-08 in Phase 5 handles Vectorize vector deletion."

  - truth: "tags and expires fields on remember() are persisted (REQUIREMENTS TOL-01)"
    addressed_in: "Phase 5"
    evidence: "tools.ts line 199 comment: 'args.tags + args.expires accepted by schema but not yet persisted (no Memory field).' CLAUDE.md SQLite schema shows a tags table — full tag persistence is a Phase 5/later concern. Phase 4 plan explicitly notes this in Known Stubs."
---

# Phase 4: Core Tools + Envelope Verification Report

**Phase Goal:** The five v0.1 tools work end-to-end against the WorkspaceDO using the lexical (SQL `LIKE`) backing, every response is wrapped in the `EngramResponse` envelope, failures use `McpError` with proper JSON-RPC codes, response sizes stay under the 8K-token budget, `forget` is transactional and complete, and cross-workspace penetration testing confirms the JWT-to-DO defense holds.
**Verified:** 2026-05-27T14:46:17Z
**Re-verified:** 2026-05-27T08:52:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plans 04-06 + 04-07)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Five tools work end-to-end via lexical (instr()) backing | VERIFIED | tools-integration.test.ts 91/91 GREEN (up from 90); TOL-01..05 round-trips pass; instr() backing confirmed in queries.ts |
| 2 | Every response wraps in EngramResponse envelope | VERIFIED | envelope.ts exports 5 builders; envelope.test.ts GREEN; every handler calls wrapMcpContent(trimToBudget(envelope)) |
| 3 | Failures use McpError with proper JSON-RPC codes | VERIFIED | error-mapping.ts routes NotFoundError→-32602, pass-through McpError, fallback -32603; error-mapping.test.ts 10/10 GREEN |
| 4 | Response sizes stay under 8K-token budget | VERIFIED | token-budget.test.ts 6/6 GREEN; worst-case 25×4KB fixture trims to ≤7500 cl100k_base tokens |
| 5 | forget is transactional and complete (SQL layer) | VERIFIED | queries.ts deleteBlock removes blocks row then conditionally removes relations rows; TOL-04 round-trip GREEN; cascade=true wired |
| 6 | Cross-workspace JWT-to-DO defense holds | VERIFIED | cross-workspace-pentest.test.ts Prong A + Prong B GREEN; SENTINEL-DD-RT-PHASE-03-TOOLS-TS preserved |
| 7 | classified_type echoes args.type consistently (CR-01) | VERIFIED | Plan 04-06 commits 6e58f65 + 03d6031: tools.ts line 202 now stores `args.type ?? null`; line 218 echoes `args.type ?? null` — both null, no divergence. narrowBlockRow null-tolerant guard in queries.ts (line 158). blocks.type column relaxed to TEXT (no NOT NULL). TOL-01-CR01 round-trip test (tools-integration.test.ts line 125) asserts classified_type === null AND recalled block.type === null. |
| 8 | MCP-07: bad input → InvalidParams, missing auth → InvalidRequest | VERIFIED | All 5 handlers throw McpError(InvalidRequest) on missing auth; mapToMcpError funnels all other errors through proper codes |
| 9 | MCP-08: per-tool description ≤ 1.5KB | VERIFIED | token-budget.test.ts captureToolRegistrations confirms 5 registrations, all descriptions pass TextEncoder().encode().byteLength ≤ 1500 |
| 10 | TOL-08: integration smoke passes | PASSED (override) | AC-01..AC-12 verbally confirmed; override accepted by rmoore 2026-05-27; override entry in frontmatter and 04-MCP-INSPECTOR-SMOKE.md §Verification Override |

**Score:** 10/10 truths verified (9 directly + 1 accepted via override)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | recall() semantic search via Vectorize (TOL-02 REQUIREMENTS full text) | Phase 5 | ROADMAP Phase 4 SC-2: "recall backing is LIKE-based; semantic upgrade lands in P5" |
| 2 | remember() context.conflicts populated on lexical overlap (ROADMAP SC-1) | Phase 5 | CONTEXT.md D-08: "context.conflicts is empty in v0.1 — SC#1 is vacuously satisfied. Phase 5 / AI-02 populates this field." |
| 3 | forget() Vectorize vector deletion (REQUIREMENTS TOL-04, AI-08) | Phase 5 | ROADMAP Phase 4 SC-4: "implementation extends in P5" |
| 4 | tags and expires persistence on remember() | Phase 5+ | tools.ts Known Stubs; no Memory.tags field in v0.1 schema |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `packages/mcp-server/src/envelope.ts` | 8 named exports, honest-stub builders | VERIFIED | 487 lines, 8 exports confirmed; all builders verified substantive with real logic |
| `packages/mcp-server/src/tools.ts` | 5 live async handler bodies | VERIFIED | 337 lines; all 5 handlers call WorkspaceDO via workspaceNs.get(idFromName()) + build envelope + wrap; line 202 stores `args.type ?? null` (CR-01 closed) |
| `packages/mcp-server/src/result-types.ts` | 6 typed result interfaces | VERIFIED | RememberResult, RecallResult, RecallChunk, SearchResult, ForgetResult, IngestResult confirmed |
| `packages/mcp-server/src/schemas.ts` | verbosity enum + limit≤25 | VERIFIED | RecallInputSchema.verbosity z.enum(["synthesis","chunks","both"]).default("both"); both limit fields .max(25) |
| `shared/types/src/index.ts` | Memory.type widened to string\|null | VERIFIED | Line 69: `type: string | null` — widened by Plan 04-06 commit 6e58f65; JSDoc documents null semantics and D-06 honest-stub contract |
| `packages/workspace-do/src/queries.ts` | narrowBlockRow null-tolerant | VERIFIED | Lines 158-160: `if (type !== null && typeof type !== "string") { throw ... }` — null passes through; return satisfies Memory (string \| null) |
| `packages/workspace-do/src/schema.ts` | blocks.type nullable | VERIFIED | Line 69: `type TEXT` (no NOT NULL constraint) — relaxed by Plan 04-06 commit 03d6031 |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` | TOL-01-CR01 round-trip test present | VERIFIED | Lines 125-151: asserts (a) classified_type === null in remember response, (b) recalled memory.type === null |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` | TOL-07 two-prong behavioral proof | VERIFIED | Prong A + Prong B it() blocks confirmed; asWorkspaceDO shim at file scope; Workspace mismatch message-shape lock |
| `packages/mcp-server/src/__tests__/token-budget.test.ts` | MCP-08 worst-case + description-size + adversarial | VERIFIED | captureToolRegistrations helper confirmed; adversarial > 8000 token lock confirmed; 6/6 GREEN |
| `.planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md` | TOL-08 smoke artifact with Verification Override subsection | VERIFIED | status: resolved; AC-01..AC-12 ticked; ### Verification Override subsection added by Plan 04-07 commit 34f8fad |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tools.ts` | `envelope.ts` | `import { build*Response, trimToBudget, wrapMcpContent }` | WIRED | Lines 73-80 confirmed; all 5 handlers call builders |
| `tools.ts` | `@engram/workspace-do` | `workspaceNs.get(idFromName(props.workspace_id))` | WIRED | All 5 handlers route to WorkspaceDO via DO namespace |
| `tools.ts` | `schemas.ts` | `import { *InputSchema }` + `.shape` in registerTool | WIRED | Lines 84-93 confirmed; all 5 schemas wired as registerTool inputSchema |
| `envelope.ts` | `gpt-tokenizer/encoding/cl100k_base` | `import { encode }` | WIRED | Line 42 confirmed; countTokens() uses encode() for trimToBudget |
| `cross-workspace-pentest.test.ts` | WorkspaceDO assertOwnsWorkspace | `runInDurableObject` + forged workspace_id arg | WIRED | Prong B confirmed; McpError(InvalidRequest) thrown with Workspace mismatch message |
| `token-budget.test.ts` | `gpt-tokenizer/encoding/cl100k_base` | `import { encode }` | WIRED | Line 44 confirmed |
| `tools.ts (remember)` | `queries.ts (narrowBlockRow)` | `insertBlock → block.type=null → narrowBlockRow null-tolerant guard` | WIRED | Plan 04-06: both `tools.ts` and `queries.ts` updated atomically; null type passes through without throwing; TOL-01-CR01 test confirms round-trip |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|-------------|--------|-------------------|--------|
| `tools.ts remember handler` | `block` (Memory) | `args.content`, `args.type ?? null`, `crypto.randomUUID()` | Yes — writes to WorkspaceDO SQLite; blocks.type = null for bare calls | FLOWING (CR-01 resolved: stored type and echoed classified_type both null) |
| `tools.ts recall handler` | `memories` | `stub.lexicalSearchBlocks({workspace_id, query, limit?})` | Yes — reads from WorkspaceDO SQLite via instr() query | FLOWING |
| `tools.ts search handler` | `memories` | `stub.lexicalSearchBlocks({workspace_id, query, limit?})` | Yes — same instr() path | FLOWING |
| `tools.ts forget handler` | `{blocks_deleted, relations_deleted}` | `stub.deleteBlock({workspace_id, id, cascade?})` | Yes — deletes from blocks + relations | FLOWING |
| `tools.ts ingest handler` | `job_id` | `crypto.randomUUID()` (no DO write) | No — job_id is ephemeral, not persisted | HOLLOW (intentional D-05 honest stub; Phase 6 scope) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (91 mcp-server + 26 workspace-do) | `npm run test --workspaces --if-present` | 91 passed + 26 passed (1 skipped) = 117 total | PASS |
| TOL-01-CR01 bare-remember round-trip | `npx vitest run src/__tests__/tools-integration.test.ts -t "TOL-01-CR01"` (covered in test suite) | GREEN within 91/91 | PASS |
| TOL-04 remember→forget→recall=0 round-trip | `npx vitest run src/__tests__/tools-integration.test.ts -t "TOL-04"` (covered in test suite) | GREEN within 91/91 | PASS |
| TOL-07 cross-workspace Prong A + B | `npx vitest run src/__tests__/cross-workspace-pentest.test.ts` (covered in test suite) | 2/2 GREEN | PASS |
| MCP-08 worst-case token trim | `npx vitest run src/__tests__/token-budget.test.ts` (covered in test suite) | 6/6 GREEN | PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes found. The PLAN/SUMMARY docs reference `04-MCP-INSPECTOR-SMOKE.md` as the TOL-08 evidence artifact, which is a manual smoke procedure, not a runnable script. The smoke was executed by Russell on 2026-05-27 and accepted via override.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| MCP Inspector local smoke | Manual execution by runner (Russell), wrangler dev | Verbal PASS; AC-01..AC-12 confirmed; override accepted by rmoore 2026-05-27 | PASSED (override) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TOL-01 | 04-01..04-03, 04-06 | remember() writes to blocks, returns EngramResponse with id/classified_type/extracted_fields/confidence | VERIFIED | CR-01 closed: stored type and echoed classified_type both null for bare calls; TOL-01-CR01 round-trip test GREEN (commit 03d6031) |
| TOL-02 | 04-01..04-03 | recall() returns EngramResponse with memories/synthesis + meta.gaps (lexical backing, P5 Vectorize) | VERIFIED | tools-integration.test.ts TOL-02 GREEN; verbosity branches confirmed; instr() backing per deviation |
| TOL-03 | 04-01..04-03 | search() no format? param, returns memories+count | VERIFIED | SearchInputSchema has no format field; buildSearchResponse confirmed |
| TOL-04 | 04-01..04-03 | forget() deletes block + relations transactionally; round-trip returns zero | VERIFIED | deleteBlock two-statement cascade confirmed; TOL-04 round-trip test GREEN; cascade=true wired at line 302 |
| TOL-05 | 04-01..04-03 | ingest() returns EngramResponse{status: accepted, job_id} | VERIFIED | buildIngestResponse confirmed; D-05 honest stub; Phase 6 Queue wiring deferred |
| TOL-06 | 04-01..04-02 | Every tool response has all envelope fields present (even null/empty) | VERIFIED | envelope.test.ts 13/13 GREEN; all 5 builders return result+context+meta; suggestions absent per D-04 |
| TOL-07 | 04-01..04-04 | Cross-workspace penetration test; STO-07 fires on direct DO forgery | VERIFIED | cross-workspace-pentest.test.ts 2/2 GREEN; Prong A + Prong B confirmed |
| TOL-08 | 04-05, 04-07 | Integration smoke test passes (local MCP Inspector) | PASSED (override) | AC-01..AC-12 verbally confirmed; override accepted by rmoore; recorded in frontmatter overrides[] and 04-MCP-INSPECTOR-SMOKE.md §Verification Override |
| MCP-07 | 04-01, 04-03 | Tool failures throw McpError with correct JSON-RPC codes | VERIFIED | error-mapping.ts confirmed; all 5 handlers have throw mapToMcpError(err); error-mapping.test.ts 10/10 GREEN |
| MCP-08 | 04-01..04-04 | Serialized success responses ≤8K tokens; tool descriptions ≤1.5KB | VERIFIED | token-budget.test.ts 6/6 GREEN; worst-case 25×4KB trims to ≤7500 tokens; adversarial proof that fixture is genuinely over-budget pre-trim |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/mcp-server/src/envelope.ts` | 75 | META_GAPS.recall says "LIKE matches only" but instr() is the actual backing (WR-04) | WARNING | Claude/clients reasoning from this string may craft wildcard queries (e.g., "engin%") expecting LIKE semantics; literal substring behavior silently returns zero hits |
| `packages/mcp-server/src/tools.ts` | 302 | cascade defaults to `true` — destructive default (WR-01) | WARNING | Bare forget({id}) deletes all relation rows; least-surprise principle expects non-destructive default |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` | 140 | `env as Record<string, unknown>` cast (TS2352) | INFO | Pre-existing tsc error (present before 04-06); tests run GREEN under vitest; not a regression |
| `packages/mcp-server/src/__tests__/tools-integration.test.ts` | 282 | `env as Record<string, unknown>` cast (TS2352) | INFO | Pre-existing tsc error (present before 04-06); tests run GREEN under vitest; not a regression |

No `TBD`, `FIXME`, or `XXX` debt markers found in any Phase 4 production files.

CR-01 BLOCKER from initial verification is CLOSED. WR-04 and WR-01 remain as non-blocking warnings; they were present at initial verification and are not new.

### Human Verification Required

None — all gaps resolved. TOL-08 accepted via formal override. No items requiring human testing remain open.

### Gaps Summary

No gaps. All 10 must-haves verified (9 directly + 1 accepted via formal override by rmoore).

**CR-01 CLOSED:** Plan 04-06 (commits 6e58f65 + 03d6031) resolved the read-your-writes mismatch. `tools.ts` now stores `args.type ?? null` (line 202). `Memory.type` widened to `string | null` in `shared/types/src/index.ts`. `narrowBlockRow` in `queries.ts` relaxed to accept null type column. `blocks.type` column relaxed from `TEXT NOT NULL` to `TEXT` in `schema.ts`. `TOL-01-CR01` round-trip regression test added to `tools-integration.test.ts` (lines 125-151) asserts both `classified_type === null` in the remember envelope AND `type === null` on the recalled block. Full suite: 117 tests GREEN (91 mcp-server + 26 workspace-do).

**TOL-08 CLOSED (override):** Plan 04-07 (commits 16d60cb + 34f8fad) formally recorded the verbal-acceptance decision in `04-VERIFICATION.md` frontmatter `overrides[]` and added a `### Verification Override` subsection to `04-MCP-INSPECTOR-SMOKE.md` cross-referencing the override and setting the Phase 5 / Phase 7 raw JSON capture forward requirement.

---

_Initially verified: 2026-05-27T14:46:17Z_
_Re-verified: 2026-05-27T08:52:00Z_
_Verifier: Claude (gsd-verifier)_
