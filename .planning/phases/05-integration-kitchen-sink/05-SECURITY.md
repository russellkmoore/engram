---
phase: 5
slug: integration-kitchen-sink
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-11
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Phase character: test/integration-only — no new runtime code, no new dependencies,
> no new exports. Mitigations are test assertions, grep gates, and documented controls.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| forged workspace_id → tools.ts recall() | Attacker supplies a crafted workspace_id to reach another workspace's data | Cross-workspace memory content (sensitive) |
| props.workspace_id → Vectorize namespace | Isolation invariant: namespace = JWT-validated props.workspace_id, never a request/fan-out arg | Vector search scope |
| triage-worker Queue message → conflictPipeline → WorkspaceDO inbox | MemoryEvent.workspace_id must route every DO write; WORKSPACE.idFromName(newBlock.workspace_id) | Conflict/inbox records (workspace-scoped) |
| trimToBudget → MCP response envelope | Token-budget trimming must never drop security-relevant fields (high-severity conflicts, synthesis) | Conflict/synthesis payload |
| Matrix status cells → /gsd:verify-work 5 grep gate | Closure gate reads literal status tokens; vocabulary drift breaks the gate | Phase-closure signal |
| INT-05a smoke → local Workers | binding-mode=local; no real Cloudflare bindings, no secrets transmitted at PR time | None (local-only) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01-SC | Tampering | npm/pip/cargo installs | accept | No package installs — file-creation only (git scan: no manifest changes across 20 phase-05 commits) | closed |
| T-05-01-01 | Tampering | INTEGRATION-MATRIX status cells | mitigate | Vocabulary fixed to `tested`/`pending`/`out-of-scope` (v0.2-INTEGRATION-MATRIX.md:45-47); data-row scan 6/6 valid | closed |
| T-05-02-SC | Tampering | npm installs | accept | No new packages; gpt-tokenizer pre-existing dep | closed |
| T-05-02-01 | Information Disclosure | Cross-workspace fan-out | mitigate | Kitchen-sink composition tests use a distinct single workspace_id per block (v02-kitchen-sink.test.ts:297/344/384/418/469) | closed |
| T-05-02-02 | Tampering | trimToBudget drops security-relevant fields | mitigate | Content-preservation: synthesis survives (v02-kitchen-sink.test.ts:563) + high-severity conflicts survive (:567-568) | closed |
| T-05-02-03 | Tampering | Vacuous token-budget assertion | mitigate | Adversarial guard `expect(beforeTokens).toBeGreaterThan(7_500)` (:552) precedes post-trim assertion (:559) | closed |
| T-05-03-SC | Tampering | npm installs | accept | No new packages; test files only | closed |
| T-05-03-01 | Information Disclosure | Cross-ws expanded-query fan-out | mitigate | Prong-A Case 1: all fan-out variants resolve workspace_B namespace only; `toEqual([])` (cross-workspace-pentest.test.ts:217/234, D-11) | closed |
| T-05-03-02 | Information Disclosure | Cross-ws synthesis path | mitigate | Prong-A Case 3: `synthesis.toBeNull()` when workspace_B unseeded (SYN-07 guard) (cross-workspace-pentest.test.ts:268/284/287) | closed |
| T-05-03-03 | Information Disclosure | Cross-ws reranker path | mitigate | Prong-A Case 2 (RERANKER_ENABLED=false): zero workspace_A content in reranker context; `toEqual([])` (cross-workspace-pentest.test.ts:245/258) | closed |
| T-05-03-04 | Tampering | Vacuous isolation test | mitigate | Positive-control: workspace_A returns ≥1 memory after workspace_B 0-result (cross-workspace-pentest.test.ts:242/265/295) | closed |
| T-05-04-SC | Tampering | npm installs | accept | No new packages; single test file | closed |
| T-05-04-01 | Tampering | conflict-pipeline writes to wrong workspace DO | mitigate | idFromName spy (mockImplementation) asserts arg == targetWorkspaceId (conflict-pipeline-isolation.test.ts:108-110/158) | closed |
| T-05-04-02 | Information Disclosure | Conflict written to wrong inbox | mitigate | `insertConflictAsInbox` called with `objectContaining({ workspace_id: targetWorkspaceId })` (conflict-pipeline-isolation.test.ts:161-163) | closed |
| T-05-04-03 | Tampering | Vacuous routing test | mitigate | Negative-control: `idFromName .not.toHaveBeenCalledWith("ws-B")` (conflict-pipeline-isolation.test.ts:207) | closed |
| T-05-05-SC | Tampering | npm installs | accept | No new packages; matrix + bash-script edits only | closed |
| T-05-05-01 | Tampering | Matrix vocabulary drift | mitigate | Data-row grep: 6 `tested` / 0 `pending`; raw `pending` hits are prose/vocabulary only | closed |
| T-05-05-02 | Tampering | `tested` row with missing Test File (vacuous closure) | mitigate | All 6 `tested` rows reference v02-kitchen-sink.test.ts; `test -f` → EXISTS | closed |
| T-05-05-03 | Spoofing | INT-05b deployed-staging smoke bypassed | accept | INT-05b is a documented manual milestone-close ritual, not a PR gate; no staging env exists (RESEARCH §INT-05); checklist control in VERIFICATION.md:8-10,125-133 | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-01-SC, T-05-02-SC, T-05-03-SC, T-05-04-SC, T-05-05-SC | Supply-chain (no installs): phase is test/doc-only. Per-commit `git show --stat` over all 20 phase-05 commits confirmed zero package-manifest changes. No new attack surface. | Russell Moore | 2026-06-11 |
| AR-05-02 | T-05-05-03 | INT-05b deployed-staging smoke is a documented manual ritual run at milestone close, not a PR gate. No staging environment exists (confirmed RESEARCH.md §INT-05). The documented checklist in VERIFICATION.md is the accepted compensating control. | Russell Moore | 2026-06-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-11 | 18 | 18 | 0 | gsd-security-auditor (verify-mitigations mode) |

**Audit notes:**
- `register_authored_at_plan_time: true` — all 5 PLANs authored STRIDE registers at plan time; auditor ran in verify-mitigations mode (no retroactive-STRIDE scan).
- Positive/negative controls confirmed present (T-05-03-04, T-05-04-03) — isolation proofs are not vacuously true.
- Prong-B `assertOwnsWorkspace` backstop verified single-source (no duplication, D-09); Prong-C real-creds stubs are documented `it.skip` transfers to nightly CI, not silent gaps.
- No unregistered attack surface appeared during implementation.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-11
