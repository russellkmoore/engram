---
phase: 01-foundation-wave-0
verified: 2026-06-04T08:01:18Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Spot-check 10 random validate-split corpus entries for semantic relevance"
    expected: "Each entry's query meaningfully retrieves the 3 block IDs listed in expected_top_3_block_ids when run against the eval-fixtures workspace"
    why_human: "Block IDs point to eval-fixtures-seed.json memories but cannot be queried without running a live Vectorize instance. Semantic coherence of labels requires human judgment."
  - test: "Confirm WORKSPACE_NAMESPACE_ID and ENGRAM_ADMIN_AUDIT_TOKEN secrets are set in GitHub Actions"
    expected: "gh secret list shows both WORKSPACE_NAMESPACE_ID and ENGRAM_ADMIN_AUDIT_TOKEN present"
    why_human: "GitHub Actions secrets are not visible in the codebase. User confirmed 'done' during execution but the verifier cannot observe the external secret store."
  - test: "Run CI migration audit step end-to-end against a deployed workspace"
    expected: "scripts/audit/embedding-version-audit.ts exits 0 with all workspaces reporting count_stale=0"
    why_human: "Requires live Cloudflare API credentials, deployed mcp-server, and a production WorkspaceDO namespace — none available in verification environment."
---

# Phase 1: Foundation (Wave 0) Verification Report

**Phase Goal:** Pre-flight checks pass and the eval corpus is large enough to make every downstream gate statistically meaningful. No feature code ships in this phase — it sets the testing discipline and unblocks Phase 2.
**Verified:** 2026-06-04T08:01:18Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Migration audit CI step exists, enforces NULL-trap SQL, exits loud on missing secrets, blocks on stale count (PRE-01) | VERIFIED | `grep -cF "Migration audit (PRE-01)" ci.yml` = 1; `grep -cE "::error::.*WORKSPACE_NAMESPACE_ID" ci.yml` = 1; fork-safety gate present; `countStaleEmbeddings` uses three-arm NULL-trap SQL confirmed in queries.ts |
| 2 | Tiered vitest eval project exists in mcp-server + triage-worker; MAX_AI_CALLS=200 ceiling enforced; daily neuron summary available (PRE-02) | VERIFIED | `name: "eval"` + `hasEvalCreds` + `isolate: false` in both configs; `MAX_AI_CALLS = 200` literal in eval-budget.setup.ts; `aiInferenceAdaptive` in eval-budget-summary.mjs; eval-suite CI job with `needs: [build]`, fork-safety, fail-loud |
| 3 | recall-corpus.json has ≥100 labeled query→expected_top_3_block_ids pairs with 70/30 stratified split (PRE-03) | VERIFIED | entries.length=100; 70 train / 30 validate; per-bucket ratios: critical-path=70%, edge=71%, extraction=70%, known-failure=66% (all within 60-80% tolerance); expected_synthesis=null on all 100; no ef-PENDING-LABEL placeholders; all block IDs reference eval-fixtures-seed.json (0 orphaned IDs) |
| 4 | v0.2 integration matrix exists with 6 pairings, pending status, closure-rule footer (PRE-04) | VERIFIED | File at `.planning/research/v0.2-INTEGRATION-MATRIX.md`; exactly 6 pairings via regex; all Status cells = `pending`; `## Closure Rule` present; `verify-work 5` referenced 3 times |
| 5 | CF code-assist routing tracker scaffolded with 3-question checklist, <10% scope statement, correct stop trigger (PRE-05) | VERIFIED | File at `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md`; header = `# Phase 1 — cf-code-assist Routing Tracker (v0.2 milestone)`; `Stop logging when /gsd:verify-work 1 passes`; `<10%` scope; `## 3-Question Checklist`; `## End-of-Phase Summary` stub; HTML comment noting path discrepancy |

**Score: 5/5 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/workspace-do/src/queries.ts` | countStaleEmbeddings with three-arm NULL-trap SQL | VERIFIED | `embedding_version IS NULL OR embedding_version < 2 OR embedding_model` confirmed; `export.*countStaleEmbeddings` confirmed; no COALESCE masking; runtime narrowing via `.toArray()` + `typeof n !== "number"` check (CR-04 fix) |
| `packages/workspace-do/src/index.ts` | assertAllBlocksAtV2 admin RPC, gated, not in registerTools | VERIFIED | Method defined at line 385; `this.assertOwnsWorkspace(args.workspace_id)` is first executable line (line 389); `admin-only: not registered as an MCP tool (PRE-01)` comment present; NOT in registerTools (negative grep confirmed) |
| `scripts/audit/embedding-version-audit.ts` | Cross-workspace audit via DO Namespace List API | VERIFIED | `WORKSPACE_NAMESPACE_ID`, `assertAllBlocksAtV2`, `result_info` (pagination) all present; `--help` exits 0; missing `CLOUDFLARE_API_TOKEN` exits 2; no token echo in source |
| `.github/workflows/ci.yml` | CI audit step + eval-suite job | VERIFIED | `Migration audit (PRE-01)` step present; `eval-suite` job with `needs: [build]`; both jobs have fork-safety gate; fail-loud `::error::` on missing secrets |
| `packages/mcp-server/vitest.config.ts` | eval project with hasEvalCreds gate | VERIFIED | `name: "eval"`, `hasEvalCreds` (3 occurrences), `isolate: false` (3 occurrences) confirmed |
| `packages/triage-worker/vitest.config.ts` | eval project mirroring mcp-server shape | VERIFIED | `name: "eval"`, `hasEvalCreds` (3 occurrences), `isolate: false` (4 occurrences) confirmed |
| `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` | MAX_AI_CALLS=200 counter with AI.run + VECTORIZE.query wrappers | VERIFIED | `MAX_AI_CALLS = 200` (2 occurrences); `MAX_AI_CALLS exceeded` throw message; `env.AI.run` (4), `env.VECTORIZE.query` (4); no `process.env.MAX_AI_CALLS` override; `writeDataPoint` for AE defense-in-depth |
| `scripts/eval-budget-summary.mjs` | GraphQL neuron-summary caller | VERIFIED | `aiInferenceAdaptive` present; `[eval-budget-summary]` log tag; `--help` exits 0; missing creds exits 2; ISO 8601 validation on `--since` (WR-04 fix) |
| `.planning/research/v0.2-INTEGRATION-MATRIX.md` | 6-pairing integration matrix with closure rule | VERIFIED | 6 pairings confirmed; all Status cells = `pending`; `## Closure Rule` present; `verify-work 5` referenced 3× |
| `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` | CF routing tracker scaffold | VERIFIED | All acceptance criteria confirmed (header, checklist, log, stop-trigger, scope, summary stub, path note) |
| `.planning/evals/recall-corpus.json` | ≥100 entries, header-object schema, v2, 70/30 split | VERIFIED | 100 entries; `corpus_version: 2`; `embedding_model: "@cf/qwen/qwen3-embedding-0.6b"`; 70 train / 30 validate; all per-bucket ratios in 60-80%; no placeholders; all 100 entries labeled via `ai-cross-validated*` |
| `.planning/evals/eval-fixtures-seed.json` | ≥100 unique-id memories | VERIFIED | `workspace: "eval-fixtures"`; 120 memories; 120 unique IDs; all block IDs in corpus reference this file (0 orphaned) |
| `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | Updated to header-object schema | VERIFIED | `recall-corpus.json` reference; `corpus.entries` access; `EMBEDDING_MODEL` guard; `EVAL_SPLIT` support; `it.skip` removed (CR-02 fix) — appears only in comments explaining the fix |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/audit/embedding-version-audit.ts` | `packages/mcp-server/src/oauth.ts` (admin endpoint) | `POST /__admin/embedding-audit?workspace_id=` | WIRED | Script uses HTTP transport to admin endpoint (deviation from plan's DO RPC — documented in SUMMARY-01 as RULE 2 deviation; `assertAllBlocksAtV2` is called server-side) |
| `packages/mcp-server/src/oauth.ts` (admin endpoint) | `packages/workspace-do/src/index.ts` (assertAllBlocksAtV2) | `env.WORKSPACE.get(...).assertAllBlocksAtV2(...)` | WIRED | Endpoint proxies to DO admin RPC; confirmed by SUMMARY-01 |
| `packages/workspace-do/src/index.ts` (assertAllBlocksAtV2) | `packages/workspace-do/src/queries.ts` (countStaleEmbeddings) | `countStaleEmbeddingsQuery(this.ctx.storage.sql, EMBEDDING_MODEL)` at line 390 | WIRED | Confirmed in source at index.ts:390 |
| `.github/workflows/ci.yml` | `scripts/audit/embedding-version-audit.ts` | `npm run audit:migration` | WIRED | `audit:migration` in ci.yml confirmed; `"audit:migration"` in package.json scripts confirmed |
| `packages/mcp-server/vitest.config.ts` (eval project) | `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` | `setupFiles: ['./src/__tests__/evals/eval-budget.setup.ts']` | WIRED | Confirmed by SUMMARY-02 |
| `.github/workflows/ci.yml` (eval-suite) | `npm run test:eval` | step invocation | WIRED | `test:eval` in ci.yml and package.json confirmed |
| `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | `.planning/evals/recall-corpus.json` | `fs.readFile` + `JSON.parse`; access via `corpus.entries` | WIRED | `recall-corpus.json` and `corpus.entries` both confirmed in test file |

---

### Data-Flow Trace (Level 4)

Phase 1 delivers no components that render dynamic data to end users. Artifacts are test infrastructure, planning documents, and CI scripts. Level 4 trace is not applicable.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Audit script --help exits 0 | `node_modules/.bin/tsx scripts/audit/embedding-version-audit.ts --help` | Prints usage; EXIT: 0 | PASS |
| Audit script exits 2 on missing CLOUDFLARE_API_TOKEN | `CLOUDFLARE_API_TOKEN= node_modules/.bin/tsx scripts/audit/embedding-version-audit.ts` | `[audit] FATAL: CLOUDFLARE_API_TOKEN missing`; EXIT: 2 | PASS |
| eval-budget-summary.mjs --help exits 0 | `node scripts/eval-budget-summary.mjs --help` | Prints usage; EXIT: 0 | PASS |
| eval-budget-summary.mjs exits 2 on missing creds | `CLOUDFLARE_API_TOKEN= node scripts/eval-budget-summary.mjs` | `FATAL: CLOUDFLARE_API_TOKEN missing`; EXIT: 2 | PASS |
| Corpus has 100 entries with no placeholders | `jq '[.entries[] | select(.expected_top_3_block_ids | any(. == "ef-PENDING-LABEL"))] | length' recall-corpus.json` | 0 | PASS |
| All corpus block IDs exist in eval-fixtures | jq cross-ref check | 0 orphaned IDs across all 300 block ID slots | PASS |
| TypeScript compiles clean | `npx tsc -b --noEmit` | Exit 0; no output | PASS |

---

### Probe Execution

No probes declared in PLAN files. No conventional `scripts/*/tests/probe-*.sh` files exist in the repo. Skipped.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|------------|-------------|--------|---------|
| PRE-01 | 01-01 | Embedding-version migration audit; NULL-trap SQL; CI gate | SATISFIED | countStaleEmbeddings with three-arm SQL; assertAllBlocksAtV2 admin RPC; audit script; CI step with fail-loud + fork-safety |
| PRE-02 | 01-02 | Tiered vitest with eval tier; MAX_AI_CALLS≤200; daily neuron summary | SATISFIED | eval projects in both packages; eval-budget.setup.ts; eval-budget-summary.mjs; eval-suite CI job |
| PRE-03 | 01-05 | Eval corpus 27→≥100 labeled pairs; 70/30 split | SATISFIED | 100 entries; fully labeled via AI cross-validation; 70/30 stratified split; all block IDs valid |
| PRE-04 | 01-03 | v0.2 integration matrix with 6 pairings and closure rule | SATISFIED | v0.2-INTEGRATION-MATRIX.md with all 6 pairings; closure rule footer |
| PRE-05 | 01-04 | CF code-assist routing tracker scaffold | SATISFIED | 01-CF-CODE-ASSIST-USAGE.md at actual phase dir with all required sections |

**Note on PRE-05 path:** ROADMAP Success Criterion #5 and REQUIREMENTS.md cite `.planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md`. The actual file lives at `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md`. This discrepancy was known before execution (the phase slug was finalized after REQUIREMENTS.md was written), is explicitly documented in an HTML comment in the tracker file, and acknowledged in PLAN-04 and SUMMARY-04. The file at the actual path fully satisfies the requirement's intent. No BLOCKER.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` | 16 | Stale comment: "PR CI: `it.skip` with TODO note" — `it.skip` was removed by CR-02 fix; the comment no longer reflects reality | Info | No runtime impact; comment is contradicted by the correct explanation at line 269. Not a TBD/FIXME/XXX marker — no blocker. |
| `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` (and `packages/triage-worker/vitest.config.ts`) | — | `test:unit` → `--project=unit` and `test:integration` → `--project=integration` resolve to zero projects (vitest project names are `workerd` and `lint-node`). Acknowledged deviation in SUMMARY-02. | Warning | `npm run test:unit` and `npm run test:integration` are no-ops today. `npm run test:eval` (the PRE-02 goal) works correctly. The fix requires renaming vitest projects — not in Phase 1 scope. |

No TBD/FIXME/XXX markers found in any phase-modified file.

---

### Code Review Findings (all fixed)

All 4 critical and 5 warning findings from `01-REVIEW.md` were fixed in `01-REVIEW-FIX.md` (status: `all_fixed`, 9/9 fixed):

| Finding | Commit | Status |
|---------|--------|--------|
| CR-01: Timing-oracle token comparison → WebCrypto HMAC | 5d25c66 | Fixed + verified |
| CR-02: `it.skip` on F1 gate → removed | c32e97a | Fixed + verified |
| CR-03: `eval-suite` missing `needs: [build]` | f8ffcd5 | Fixed + verified |
| CR-04: Unchecked `as` cast in countStaleEmbeddings → runtime narrowing | 30d4b68 | Fixed + verified |
| WR-01: Inconsistent empty-query guard | b2e0746 | Fixed + verified |
| WR-02: Non-standard F1 precision metric → per-query standard precision@k | 0203ffa | Fixed + verified |
| WR-03: `--workspace` silent empty arg | 400e3d3 | Fixed + verified |
| WR-04: `--since` no ISO 8601 validation | a5bdc13 | Fixed + verified |
| WR-05: Fragile closure mutation in STO-07 test | 8985f34 | Fixed + verified |

**Note on WR-02:** The F1 precision metric was changed from per-result to per-query (standard binary precision@k). The 0.75 F1 threshold may need recalibration once real evals run against the live Vectorize + reranker path. This is a known-pending follow-up, not a phase failure — it is explicitly flagged in SUMMARY-02 as "requires human verification (logic change to metric calculation)."

---

### Human Verification Required

#### 1. Corpus Label Quality Spot-Check

**Test:** Select 10 random entries from the `validate` split in `.planning/evals/recall-corpus.json`. For each, read the `query` and the 3 entries in `expected_top_3_block_ids`, then look up those IDs in `.planning/evals/eval-fixtures-seed.json` to read the memory content. Assess whether the memories are semantically relevant to the query.

**Expected:** At least 8 of 10 entries should show plausible semantic relevance — the query should plausibly retrieve the referenced memories in a well-functioning semantic search system.

**Why human:** The AI cross-validation labeling policy (T-03-AUTO amended) auto-accepts entries where Sonnet and Opus agree, but neither model is the system under test (qwen3-embedding-0.6b). The labelers used semantic reasoning not embeddings. Ground-truth quality requires a human check that the labels make sense from a retrieval standpoint.

#### 2. GitHub Actions Secrets Confirmation

**Test:** Run `gh secret list` in the Engram repo and confirm both `WORKSPACE_NAMESPACE_ID` and `ENGRAM_ADMIN_AUDIT_TOKEN` are listed.

**Expected:** Both secrets appear in `gh secret list` output.

**Why human:** GitHub Actions secrets are not visible in the codebase. The user confirmed "done" during Plan 01-01 Task 4 checkpoint, but this cannot be verified programmatically from the file system. The CI audit step will silently fail-loud and abort without these secrets.

#### 3. CI Migration Audit End-to-End

**Test:** Push a commit to a branch, open a PR, and observe the `migration-audit` CI step in GitHub Actions.

**Expected:** The step runs `npm run audit:migration`, passes secret-presence checks, calls the `/__admin/embedding-audit` endpoint, and exits 0 (or 1 if any workspace has stale rows, triggering a merge block).

**Why human:** Requires a live deployed mcp-server Worker, a provisioned WorkspaceDO namespace, and the two GitHub Actions secrets. Cannot be verified without an active CI run.

---

### Gaps Summary

No blocking gaps were found. All 5 phase must-haves are VERIFIED with codebase evidence. All code review findings (4 critical, 5 warning) are fixed and committed. The phase goal — "pre-flight checks pass and the eval corpus is large enough to make every downstream gate statistically meaningful" — is achieved in the codebase.

The `status: human_needed` reflects three items requiring human observation:
1. Corpus label quality requires semantic judgment (routine for any labeled eval corpus)
2. GitHub Actions secrets cannot be observed from the file system
3. End-to-end CI audit requires a live deployment

These are inherent operational verifications, not code deficiencies. The `test:unit` / `test:integration` no-op issue is an acknowledged deviation logged in SUMMARY-02 and does not affect Phase 2 readiness (which depends on `test:eval` and the corpus, both fully functional).

---

_Verified: 2026-06-04T08:01:18Z_
_Verifier: Claude (gsd-verifier)_
