---
phase: 04-core-tools-envelope
verified: 2026-05-27T14:46:17Z
status: gaps_found
score: 8/10 must-haves verified
overrides_applied: 0
gaps:
  - truth: "remember() returns classified_type that matches what was stored in the blocks table"
    status: failed
    reason: "CR-01 confirmed in code: tools.ts line 202 stores `args.type ?? 'research_note'` but line 218 echoes `args.type ?? null`. When args.type is omitted, SQLite stores 'research_note' but the envelope returns classified_type: null. This breaks the read-your-writes contract for the no-type call path."
    artifacts:
      - path: "packages/mcp-server/src/tools.ts"
        issue: "Line 202: `type: args.type ?? 'research_note'` vs line 218: `classified_type: args.type ?? null` — diverge when args.type is undefined"
    missing:
      - "Pick one source of truth: either store null (Option A, matches honest-stub promise) or store and echo 'research_note' (Option B, requires META_GAPS update). Integration test must assert classified_type === stored type after a bare remember({content: 'x'}) call."

  - truth: "TOL-08 smoke has verifiable evidence (raw JSON capture or independent replay capability)"
    status: partial
    reason: "The AC-01..AC-12 checklist was verbally confirmed by the runner (Russell) but raw per-call JSON was explicitly not captured. The artifact documents 'runner elected to skip the JSON capture for time reasons.' The smoke ran and passed, but no independently-replayable evidence exists in the artifact. A verifier cannot independently confirm AC-05..AC-11 without re-running."
    artifacts:
      - path: ".planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md"
        issue: "### Raw JSON capture section states: 'Not recorded inline in this commit.' AC checklist is self-reported by the runner."
    missing:
      - "Either: (a) re-run smoke and capture raw JSON inline in 04-MCP-INSPECTOR-SMOKE.md, or (b) accept the verbal confirmation and add an explicit override with accepted_by + accepted_at in this VERIFICATION.md."

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

human_verification:
  - test: "Verify classified_type read-your-writes contract with bare remember() call"
    expected: "After remember({content: 'x'}) with no type argument, classified_type in envelope should match whatever type is stored in the blocks table (either both null or both 'research_note')"
    why_human: "The integration tests only assert envelope shape, not the stored SQLite value. Resolving CR-01 requires a decision (Option A vs Option B) that affects META_GAPS byte-frozen strings and the snapshot lock in envelope.test.ts."

  - test: "Confirm TOL-08 smoke evidence is acceptable or re-run to capture JSON"
    expected: "Either: the raw JSON for all 4 smoke calls is captured in 04-MCP-INSPECTOR-SMOKE.md, OR the team accepts the verbal AC-01..AC-12 confirmation as sufficient evidence for Phase 4 closure"
    why_human: "Raw JSON was deliberately not captured. Whether verbal confirmation by the runner suffices for TOL-08 closure is a project policy decision, not something a code verifier can resolve."
---

# Phase 4: Core Tools + Envelope Verification Report

**Phase Goal:** The five v0.1 tools work end-to-end against the WorkspaceDO using the lexical (SQL `LIKE`) backing, every response is wrapped in the `EngramResponse` envelope, failures use `McpError` with proper JSON-RPC codes, response sizes stay under the 8K-token budget, `forget` is transactional and complete, and cross-workspace penetration testing confirms the JWT-to-DO defense holds.
**Verified:** 2026-05-27T14:46:17Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Five tools work end-to-end via lexical (instr()) backing | VERIFIED | tools-integration.test.ts 8/8 GREEN; TOL-01..05 round-trips pass; instr() backing confirmed in queries.ts lines 379-407 after 01a225e deviation fix |
| 2 | Every response wraps in EngramResponse envelope | VERIFIED | envelope.ts exports 5 builders; envelope.test.ts 13/13 GREEN; every handler calls wrapMcpContent(trimToBudget(envelope)) |
| 3 | Failures use McpError with proper JSON-RPC codes | VERIFIED | error-mapping.ts routes NotFoundError→-32602, pass-through McpError, fallback -32603; error-mapping.test.ts 10/10 GREEN; all 5 handlers have throw mapToMcpError(err) |
| 4 | Response sizes stay under 8K-token budget | VERIFIED | token-budget.test.ts 6/6 GREEN; worst-case 25×4KB fixture trims to ≤7500 cl100k_base tokens; all 5 tool descriptions ≤1500 UTF-8 bytes |
| 5 | forget is transactional and complete (SQL layer) | VERIFIED | queries.ts deleteBlock removes blocks row then conditionally removes relations rows; tools-integration.test.ts TOL-04 round-trip (remember→forget→recall=0) GREEN; cascade=true wired at line 302 |
| 6 | Cross-workspace JWT-to-DO defense holds | VERIFIED | cross-workspace-pentest.test.ts Prong A + Prong B both GREEN; SENTINEL-DD-RT-PHASE-03-TOOLS-TS preserved; no args.workspace_id in non-comment production code |
| 7 | classified_type echoes args.type consistently | FAILED | CR-01: tools.ts line 202 stores `args.type ?? 'research_note'` but line 218 echoes `args.type ?? null`. When args.type is omitted: stored type = 'research_note', echoed classified_type = null. Divergence confirmed; tests only assert envelope shape, not stored value. |
| 8 | MCP-07: bad input → InvalidParams, missing auth → InvalidRequest | VERIFIED | All 5 handlers throw McpError(InvalidRequest) on missing auth; mapToMcpError funnels all other errors through proper codes; error-mapping regression locks GREEN |
| 9 | MCP-08: per-tool description ≤ 1.5KB | VERIFIED | token-budget.test.ts captureToolRegistrations confirms 5 registrations, all descriptions pass TextEncoder().encode().byteLength ≤ 1500 |
| 10 | TOL-08: integration smoke passes with independently verifiable evidence | UNCERTAIN | AC-01..AC-12 checklist was verbally confirmed by runner; raw per-call JSON was deliberately not captured. The smoke ran and the cycle completed. Evidence is self-reported, not independently replayable from the artifact. |

**Score:** 8/10 truths verified (1 FAILED, 1 UNCERTAIN)

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
| `packages/mcp-server/src/tools.ts` | 5 live async handler bodies | VERIFIED | 337 lines; all 5 handlers call WorkspaceDO via workspaceNs.get(idFromName()) + build envelope + wrap |
| `packages/mcp-server/src/result-types.ts` | 6 typed result interfaces | VERIFIED | 8.9KB; RememberResult, RecallResult, RecallChunk, SearchResult, ForgetResult, IngestResult confirmed |
| `packages/mcp-server/src/schemas.ts` | verbosity enum + limit≤25 | VERIFIED | RecallInputSchema.verbosity z.enum(["synthesis","chunks","both"]).default("both"); both limit fields .max(25) |
| `shared/types/src/index.ts` | confidence + coverage widened to number\|null | VERIFIED | Lines 217, 222 confirmed: `confidence: number \| null`, `coverage: number \| null` |
| `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` | TOL-07 two-prong behavioral proof | VERIFIED | Prong A + Prong B it() blocks confirmed; asWorkspaceDO shim at file scope; Workspace mismatch message-shape lock |
| `packages/mcp-server/src/__tests__/token-budget.test.ts` | MCP-08 worst-case + description-size + adversarial | VERIFIED | captureToolRegistrations helper confirmed; adversarial > 8000 token lock confirmed; 6/6 GREEN |
| `.planning/phases/04-core-tools-envelope/04-MCP-INSPECTOR-SMOKE.md` | TOL-08 smoke artifact | PARTIAL | status: resolved; AC-01..AC-12 ticked; raw JSON not captured |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tools.ts` | `envelope.ts` | `import { build*Response, trimToBudget, wrapMcpContent }` | WIRED | Lines 73-80 confirmed; all 5 handlers call builders |
| `tools.ts` | `@engram/workspace-do` | `workspaceNs.get(idFromName(props.workspace_id))` | WIRED | All 5 handlers route to WorkspaceDO via DO namespace |
| `tools.ts` | `schemas.ts` | `import { *InputSchema }` + `.shape` in registerTool | WIRED | Lines 84-93 confirmed; all 5 schemas wired as registerTool inputSchema |
| `envelope.ts` | `gpt-tokenizer/encoding/cl100k_base` | `import { encode }` | WIRED | Line 42 confirmed; countTokens() uses encode() for trimToBudget |
| `cross-workspace-pentest.test.ts` | WorkspaceDO assertOwnsWorkspace | `runInDurableObject` + forged workspace_id arg | WIRED | Prong B confirmed; McpError(InvalidRequest) thrown with Workspace mismatch message |
| `token-budget.test.ts` | `gpt-tokenizer/encoding/cl100k_base` | `import { encode }` | WIRED | Line 44 confirmed (gpt-tokenizer/encoding/cl100k_base, NOT barrel) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|-------------|--------|-------------------|--------|
| `tools.ts remember handler` | `block` (Memory) | `args.content`, `args.type ?? "research_note"`, `crypto.randomUUID()` | Yes — writes to WorkspaceDO SQLite | FLOWING (with CR-01 divergence on classified_type echo) |
| `tools.ts recall handler` | `memories` | `stub.lexicalSearchBlocks({workspace_id, query, limit?})` | Yes — reads from WorkspaceDO SQLite via instr() query | FLOWING |
| `tools.ts search handler` | `memories` | `stub.lexicalSearchBlocks({workspace_id, query, limit?})` | Yes — same instr() path | FLOWING |
| `tools.ts forget handler` | `{blocks_deleted, relations_deleted}` | `stub.deleteBlock({workspace_id, id, cascade?})` | Yes — deletes from blocks + relations | FLOWING |
| `tools.ts ingest handler` | `job_id` | `crypto.randomUUID()` (no DO write) | No — job_id is ephemeral, not persisted | HOLLOW (intentional D-05 honest stub; Phase 6 scope) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (90 mcp-server + 26 workspace-do) | `npm run test --workspaces --if-present` | 90 passed + 26 passed (1 skipped) = 116 total | PASS |
| TOL-04 remember→forget→recall=0 round-trip | `npx vitest run src/__tests__/tools-integration.test.ts -t "TOL-04"` (covered in test suite) | GREEN within 90/90 | PASS |
| TOL-07 cross-workspace Prong A + B | `npx vitest run src/__tests__/cross-workspace-pentest.test.ts` (covered in test suite) | 2/2 GREEN | PASS |
| MCP-08 worst-case token trim | `npx vitest run src/__tests__/token-budget.test.ts` (covered in test suite) | 6/6 GREEN | PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes found. The PLAN/SUMMARY docs reference `04-MCP-INSPECTOR-SMOKE.md` as the TOL-08 evidence artifact, which is a manual smoke procedure, not a runnable script. The smoke was executed by Russell on 2026-05-27.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| MCP Inspector local smoke | Manual execution by runner (Russell), wrangler dev | Verbal PASS; AC-01..AC-12 self-reported; raw JSON not captured | PARTIAL — no independently verifiable artifact |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TOL-01 | 04-01..04-03 | remember() writes to blocks, returns EngramResponse with id/classified_type/extracted_fields/confidence | PARTIAL | Writes confirmed; envelope shape verified; CR-01: classified_type echo diverges from stored type on no-type path |
| TOL-02 | 04-01..04-03 | recall() returns EngramResponse with memories/synthesis + meta.gaps (lexical backing, P5 Vectorize) | VERIFIED | tools-integration.test.ts TOL-02 GREEN; verbosity branches confirmed; instr() backing per deviation |
| TOL-03 | 04-01..04-03 | search() no format? param, returns memories+count | VERIFIED | SearchInputSchema has no format field; buildSearchResponse confirmed |
| TOL-04 | 04-01..04-03 | forget() deletes block + relations transactionally; round-trip returns zero | VERIFIED | deleteBlock two-statement cascade confirmed; TOL-04 round-trip test GREEN; non-atomic pair is documented v0.1 acceptance |
| TOL-05 | 04-01..04-03 | ingest() returns EngramResponse{status: accepted, job_id} | VERIFIED | buildIngestResponse confirmed; D-05 honest stub; Phase 6 Queue wiring deferred |
| TOL-06 | 04-01..04-02 | Every tool response has all envelope fields present (even null/empty) | VERIFIED | envelope.test.ts 13/13 GREEN; all 5 builders return result+context+meta; suggestions absent per D-04 |
| TOL-07 | 04-01..04-04 | Cross-workspace penetration test; STO-07 fires on direct DO forgery | VERIFIED | cross-workspace-pentest.test.ts 2/2 GREEN; Prong A + Prong B confirmed |
| TOL-08 | 04-05 | Integration smoke test passes (local MCP Inspector) | UNCERTAIN | AC-01..AC-12 verbally confirmed; raw JSON not captured; smoke ran on 2026-05-27 per runner's report |
| MCP-07 | 04-01, 04-03 | Tool failures throw McpError with correct JSON-RPC codes | VERIFIED | error-mapping.ts confirmed; all 5 handlers have throw mapToMcpError(err); error-mapping.test.ts 10/10 GREEN |
| MCP-08 | 04-01..04-04 | Serialized success responses ≤8K tokens; tool descriptions ≤1.5KB | VERIFIED | token-budget.test.ts 6/6 GREEN; worst-case 25×4KB trims to ≤7500 tokens; adversarial proof that fixture is genuinely over-budget pre-trim |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/mcp-server/src/tools.ts` | 202 vs 218 | Divergent store vs echo: `args.type ?? "research_note"` stored, `args.type ?? null` echoed | BLOCKER (CR-01) | Breaks read-your-writes contract for bare remember() calls without type argument; clients cannot trust classified_type reflects stored type |
| `packages/mcp-server/src/envelope.ts` | 75 | META_GAPS.recall says "LIKE matches only" but instr() is the actual backing (WR-04) | WARNING | Claude/clients reasoning from this string may craft wildcard queries (e.g., "engin%") expecting LIKE semantics; literal substring behavior silently returns zero hits |
| `packages/mcp-server/src/tools.ts` | 302 | cascade defaults to `true` — destructive default (WR-01) | WARNING | Bare forget({id}) deletes all relation rows; least-surprise principle expects non-destructive default |

No `TBD`, `FIXME`, or `XXX` debt markers found in any Phase 4 production files.

### Human Verification Required

#### 1. CR-01: Resolve classified_type read-your-writes divergence

**Test:** Call `remember({content: "test"})` without a type argument. Then query the blocks table directly to read the stored `type` column value. Compare against `classified_type` in the returned envelope.
**Expected:** Both should be the same value — either both `null` (Option A: honest stub matches Phase 5 classification intent) or both `"research_note"` (Option B: deterministic default disclosed to client). Currently they differ.
**Why human:** The fix requires a design decision (Option A vs B) that cascades to the byte-frozen `META_GAPS.remember` snapshot lock in `envelope.test.ts`. Option A requires widening `Memory.type` to `string | null`. Option B requires a coordinated META_GAPS string update. Neither can be chosen by the verifier alone.

#### 2. TOL-08 smoke evidence decision

**Test:** Review the 04-MCP-INSPECTOR-SMOKE.md artifact and decide whether the verbal AC-01..AC-12 confirmation by the runner is sufficient evidence for Phase 4 TOL-08 closure, or whether a re-run with raw JSON capture is required.
**Expected:** Either: (a) raw JSON for all 4 smoke calls appended to 04-MCP-INSPECTOR-SMOKE.md from a re-run, OR (b) an explicit acceptance entry in VERIFICATION.md frontmatter `overrides:` confirming verbal confirmation is adequate.
**Why human:** The smoke was run by the developer (Russell) and the results are self-reported. No independent party can confirm the AC assertions without raw evidence. Whether self-reported smoke evidence meets the project's quality bar is a policy call.

### Gaps Summary

**Gap 1 (BLOCKER — CR-01):** The `remember` handler has a split identity: SQLite stores `args.type ?? "research_note"` but the envelope echoes `args.type ?? null`. For any `remember()` call without an explicit `type` argument, the stored type in the database is `"research_note"` while every client sees `classified_type: null` in the response. A subsequent `recall()` or `search()` returning the same block will show `type: "research_note"` in the memory object — contradicting the `classified_type: null` the client saw at write time. This breaks the read-your-writes contract that clients depend on to build accurate mental models of their stored data.

The code review (04-REVIEW.md) independently identified this as CR-01 BLOCKER. The integration test at tools-integration.test.ts:111 asserts `classified_type` is null — which is consistent with the current buggy behavior. No test exercises the round-trip to confirm that what is echoed matches what can be read back.

**Gap 2 (WARNING — TOL-08 evidence):** The TOL-08 smoke completed (status: resolved) and the runner verbally confirmed all 12 acceptance criteria. However, raw per-call JSON was deliberately not captured in the artifact. The 04-MCP-INSPECTOR-SMOKE.md states explicitly: "Not recorded inline in this commit." This means the TOL-08 closure rests entirely on self-reported evidence. An independent verifier cannot confirm AC-05 (UUID pattern), AC-06 (exact META_GAPS strings), AC-08 (chunks present), AC-09 (synthesis null), AC-10 (blocks_deleted ≥1, meta.gaps []), or AC-11 (zero recall after forget) without re-running the smoke.

**Non-blocking notes from code review:**
- WR-04: META_GAPS.recall says "LIKE matches only" but instr() is the actual backing after the deviation commits. A Claude client reading this gap string may attempt wildcard queries that return zero hits silently.
- WR-01: forget defaults cascade=true (destructive). No explicit documentation in README or META_GAPS.
- WR-02/WR-03: recall and search silently drop schema-accepted filter fields (types, project, scope, since, until, filters) with no per-field meta.gaps warning.
- IN-01: Cross-workspace Prong A is tautological (passes because fresh DO is empty, not because active defense fired). Prong B is the load-bearing security test.

---

_Verified: 2026-05-27T14:46:17Z_
_Verifier: Claude (gsd-verifier)_
