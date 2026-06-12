# Phase 5: Integration Kitchen Sink - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify that all 4 v0.2 features — hybrid-rank (Phase 2), conflict-detection wiring (Phase 2), query-expansion + bge-reranker (Phase 3), and synthesis activation (Phase 4) — **compose cleanly under the v0.1 envelope contract**. This is the last gate before v0.2 milestone close.

The phase delivers verification artifacts, not new capability:
- `v02-kitchen-sink.test.ts` worst-case envelope-budget integration test (INT-01)
- Backward-compat proof that the v0.1 envelope contract still holds (INT-02)
- Extended cross-workspace pentest covering the 4 new v0.2 code paths (INT-03)
- `.planning/research/v0.2-INTEGRATION-MATRIX.md` driven to zero `pending` rows (INT-04)
- End-to-end smoke: `remember → recall(verbosity="synthesis") → conflict-surfacing` (INT-05)

**Out of phase boundary (locked):**
- Fixing synthesis availability (999.2 D-09 all-uncited floor) — backlog, not Phase 5.
- LLM-judge robustness (999.3) — backlog, not Phase 5.
- Flipping `verbosity` default `"chunks" → "both"` — v0.3 (D-7 lock).
- Any new MCP tool, feature, or behavior change. Phase 5 proves composition; it does not change what composes.

</domain>

<decisions>
## Implementation Decisions

### Matrix closure (INT-04)

- **D-01:** **Audit-first, then fill + scope.** The plan's first step audits each of the 6 `INTEGRATION-MATRIX.md` rows against existing tests. Rows with real existing coverage → set Status `tested` and point the Test File column at the proven file (e.g. `recall-conflicts.test.ts` for the CON×recall envelope path). Genuine gaps → author a focused integration test. Genuinely-redundant or non-existent-path rows → mark `out-of-scope` with a **written, defensible reason** in the Notes column. No redundant tests; honest scoping.
- **D-02:** **Bias toward testing over scoping-out.** The `adaptive-routing × cosine-edge` row maps to **real v0.2 code** (EXP-03 `top1_cosine < 0.65` adaptive routing + EXP-10 429 retry fallback) — the "Phase 5 AI integration" wording is only the v0.1 provenance of the 429 logic, not evidence the path is stale. Treat it as a legitimate gap. A row is marked `out-of-scope` only when the audit proves the code path is genuinely absent or already covered elsewhere — never to avoid writing a test.
- **D-03:** **Matrix status vocabulary is fixed** — only `tested` / `pending` / `out-of-scope`, matched as literals by the INT-04 grep gate. Every status edit uses those exact tokens. Every `tested` row MUST have a non-empty Test File cell that resolves to a file on disk (`/gsd:verify-work 5` asserts `grep -c "pending" == 0` AND `test -f <Test File>` for each `tested` row).

### INT-01 envelope budget

- **D-04:** **Reuse the existing token-budget harness.** Use `gpt-tokenizer/encoding/cl100k_base` + `trimToBudget` (the same harness as `token-budget.test.ts`). Build the INT-01 worst-case fixture: **10 conflicts + 50 entities + `verbosity="synthesis"`** in one `recall()` envelope.
- **D-05:** **Assert post-trim ≤ budget AND content preservation.** (a) Post-trim serialized envelope ≤ **7,500** cl100k tokens — hold the stricter production budget that `trimToBudget` already enforces, NOT the looser 8K requirement ceiling. (b) Trim **preserves `result.synthesis` and at least the high-severity `context.conflicts[]` entries** — it must shed chunk bulk, not the new high-value v0.2 fields. This is the assertion that gives INT-01 teeth; a bare ≤8K post-trim check is trivially true and tests nothing.
- **D-06:** **Pre-trim blow-out is expected and acceptable.** `trimToBudget` is designed to absorb an over-budget worst case. INT-01 does NOT assert pre-trim size and does NOT require a `meta.gaps` truncation note — the guarantee under test is post-trim budget + content preservation (D-05).

### INT-03 cross-workspace pentest shape

- **D-07:** **Extend `cross-workspace-pentest.test.ts`** (do not fragment into per-path files). Add the 3 mcp-server paths — expanded-query Vectorize fan-out, reranker, synthesis — as new **Prong-A-style** cases: a forged `props.workspace_id` makes the path operate on a DIFFERENT DO / Vectorize namespace, so foreign-workspace data is unreachable. Mocked, PR-time.
- **D-08:** **Mirror the Prong C discipline.** Real-creds Vectorize-namespace assertions stay `it.skip` at PR-time (need `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) and run nightly against real Cloudflare — exactly as the existing Prong C does.
- **D-09:** **Do NOT duplicate Prong B per path.** The generic `assertOwnsWorkspace` forge-arg DO-call backstop already proves the forge-arg threat once; re-proving it per path is high effort, near-zero marginal assurance.
- **D-10:** **Conflict-pipeline write path gets its own triage-worker isolation case.** That path lives in `packages/triage-worker` (a different Worker), so its isolation proof belongs in the triage-worker package: assert the conflict/inbox write targets the correct workspace DO (routed by `workspace_id`, not a forgeable arg).
- **D-11:** **Expanded-query namespace assertion.** For the expanded-query path specifically, assert that **all** query variants in the multi-query fan-out resolve against the *same* workspace-scoped Vectorize namespace — a variant query must not leak into another workspace's namespace.

### Claude's Discretion

- **INT-02 (envelope backward-compat)** — not deep-dived; straightforward. Run the existing `envelope.test.ts` + its snapshot; existing field **presence and shape must be preserved**. Add non-breaking shape assertions for `context.conflicts[]` (undefined→omit per CON-05 D-08) and the optional `result.synthesis` string. A snapshot update that covers **only genuinely-new optional fields** is acceptable and is NOT a v0.1-contract break — a break is changing/removing an existing field.
- **INT-05 (e2e smoke)** — not selected for discussion; the criterion conflates local `wrangler dev` boot with "deployed staging." Default resolution for the planner/researcher: split into **(a)** an automated programmatic smoke — local `wrangler dev` boot of both Workers + scripted `remember → recall(verbosity="synthesis") → conflict-surfacing-in-recall`, CI-runnable — and **(b)** a documented one-time manual run against deployed staging at milestone close (needs real deploy + creds, NOT a PR-blocking gate). Planner confirms whether staging is reachable; if not, the manual half becomes a documented ritual in the verify-work checklist.
- Exact worst-case fixture construction (builder helper vs inline) and the kitchen-sink suite's location (default `src/__tests__/integration/`).

</decisions>

<specifics>
## Specific Ideas

- "Do it RIGHT, not FAST" (PROJECT.md operating principle) governs this gate: prefer an honest audit + real coverage over either redundant box-ticking tests or convenient out-of-scope markings.
- The value of INT-01 is **content preservation under trim**, not the token number. Russell's trust killer is a response that fits the budget by silently dropping the synthesis or the conflicts — exactly the value the v0.2 features add.
- The integration matrix is the discipline that catches what "I tested each feature in isolation" misses (Risk Note INT-6). Reranker output × conflict-surfacing × synthesis × adaptive-routing-not-firing is the kind of combination only the composed kitchen-sink path exercises.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase requirements + risk notes
- `.planning/ROADMAP.md` § "Phase 5: Integration Kitchen Sink" — INT-01..INT-05 success criteria + Risk Notes (INT-4 envelope-budget upper bound, INT-6 cross-feature combinations, cross-workspace pentest debt).
- `.planning/REQUIREMENTS.md` lines 76–80 — INT-01..INT-05 verbatim requirement text.

### INT-04 closure gate (the matrix)
- `.planning/research/v0.2-INTEGRATION-MATRIX.md` — PRE-04 matrix: 6 cross-feature rows, fixed status vocabulary (`tested`/`pending`/`out-of-scope`), and the binding Closure Rule the `/gsd:verify-work 5` grep gate enforces.

### INT-01 budget harness (reuse)
- `packages/mcp-server/src/__tests__/token-budget.test.ts` — `gpt-tokenizer/encoding/cl100k_base` import, `trimToBudget`, `buildWorstCaseMemories`, ≤7,500 post-trim pattern. The harness D-04/D-05 reuse.

### INT-02 envelope contract
- `packages/mcp-server/src/__tests__/envelope.test.ts` + `__snapshots__/envelope.test.ts.snap` — the v0.1 envelope builder contract (TOL-06 all-fields-present, D-07 verbosity shapes, suggestions omission). Must still pass.

### INT-03 pentest pattern (extend)
- `packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts` — TOL-07 two-prong (`captureCallback` Prong A routing-isolation + `runInDurableObject` Prong B forge-arg backstop) + skipped Prong C real-creds. The file D-07/D-08/D-09 extend.
- `packages/mcp-server/src/__tests__/integration/recall-conflicts.test.ts` — existing CON-05 `context.conflicts[]` coverage; primary input to the D-01 matrix audit.

### Pipeline + config under test
- `packages/mcp-server/src/tools.ts` — `recall()` handler (composes expansion → RRF → bge-reranker → `hybridRank` → conflict-surfacing → synthesis → `buildRecallResponse` → `trimToBudget`); the integration surface.
- `packages/triage-worker/src/conflict-pipeline.ts` + `packages/triage-worker/src/index.ts` — `ctx.waitUntil(conflictPipeline(...))` inbox write (INT-03 D-10 path).
- `shared/ai-config/src/index.ts` — `HYBRID_WEIGHTS`, `MIN_COSINE_THRESHOLD`, `RERANKER_MODEL`, `SYNTHESIS_MODEL`, `JUDGE_MODEL`, `ADAPTIVE_TOP1_THRESHOLD` constants the composed pipeline uses.
- `packages/mcp-server/vitest.config.ts` — multi-project tiering (workerd pool vs lint-node pool vs creds-gated eval project); determines where new tests run.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `token-budget.test.ts`: cl100k_base encoder import + `buildWorstCaseMemories` + `trimToBudget` assertion shape — INT-01 builds directly on this.
- `cross-workspace-pentest.test.ts`: `captureCallback(tool, workspace_id)` (Prong A) + `runInDurableObject` forge-arg (Prong B) + `it.skip` real-creds (Prong C) — INT-03 extends in place.
- `integration/recall-conflicts.test.ts`: the integration-test directory convention + CON-05 envelope assertions — matrix-audit input and the home for new kitchen-sink cases.
- `envelope.test.ts` + snapshot: envelope-builder contract assertions — INT-02 runs these unchanged.

### Established Patterns
- Multi-project vitest: workerd pool (most tests) + lint-node pool (node:fs grep gates) + creds-gated `eval` project (`hasEvalCreds`). New tests default to the workerd pool.
- `trimToBudget` returns the SAME reference when already under budget (no copy) — assertions can rely on it.
- CON-05 envelope discipline: `context.conflicts` undefined→`[]` (D-08), empty→omit key (T-02-08-05).
- Vectorize isolation is by **namespace = workspace_id**; DO routing is by `props.workspace_id`, never by a request arg — the invariant every INT-03 prong asserts.

### Integration Points
- `recall()` in `tools.ts` is the single composition point where all 4 features meet — the kitchen-sink fixture drives it end to end.
- `conflictPipeline(...)` in triage-worker writes to `inbox` via `ctx.waitUntil` after `updateBlockEnrichment` — the INT-03 D-10 isolation target (separate Worker).

</code_context>

<deferred>
## Deferred Ideas

- **Phase 999.2 — D-09 all-uncited synthesis floor.** Fixes synthesis going empty when a faithful-but-uncited summary has every sentence dropped (~40% empty on the curated corpus). Backlog; NOT Phase 5 — Phase 5 verifies composition, it does not change synthesis availability.
- **Phase 999.3 — LLM-judge robustness.** Reduce judge noise to re-promote the SYN-02 faithfulness *rate* to a hard gate. Backlog; NOT Phase 5.
- **`verbosity` default flip to `"both"`** — v0.3, gated on SYN-09 analytics (D-7 architectural lock).

</deferred>

---

*Phase: 05-integration-kitchen-sink*
*Context gathered: 2026-06-10*
