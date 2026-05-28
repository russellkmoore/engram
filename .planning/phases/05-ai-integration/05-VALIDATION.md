---
phase: 5
slug: ai-integration
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-28
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced from `05-RESEARCH.md` §"Validation Architecture" and AI-SPEC.md §5 "Evaluation Strategy". The planner MUST honor the per-requirement test map below when emitting `<acceptance_criteria>` blocks.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^4.1.7` + `@cloudflare/vitest-pool-workers@^0.16.9` [VERIFIED via lockfile in Phase 4] |
| **Config file** | `packages/mcp-server/vitest.config.ts` (exists); `packages/triage-worker/vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `npm test --workspace=packages/<changed-package>` |
| **Full suite command** | `npm test --workspaces` |
| **Estimated runtime** | ~5–15s per workspace (unit-only); ~30–60s for `--workspaces` (unit only — integration is opt-in via `npm run test:integration`) |

---

## Sampling Rate

- **After every task commit:** Run `npm test --workspace=<changed-package>` (~5–15s, unit-only)
- **After every plan wave:** Run `npm test --workspaces` (~30–60s)
- **Before `/gsd:verify-work 5`:** `npm run evals:ci` — Vitest evals + Promptfoo full corpus; exits non-zero if F1 < 75% (AI-04) OR JSON parse rate < 95% (AI-05) OR any AI-02/AI-07/AI-08 test fails
- **Max feedback latency:** 60 seconds (full unit suite); evals deferred to Wave 5 + CI

---

## Per-Task Verification Map

> Tasks are not yet authored — planner will fill in `{N}-{plan}-{task}` IDs at PLAN.md emit time and reference the matching requirement row below. The planner MUST keep every requirement covered by ≥1 task with `<automated>` verify, and MUST NOT leave 3 consecutive tasks without an automated verify (Nyquist sampling continuity rule).

| Req ID | Phase 5 Behavior | Test Type | Automated Command | File Exists? | Status |
|--------|------------------|-----------|-------------------|--------------|--------|
| AI-01 | Vectorize index `engram-memories` created idempotently with `bge-base-en-v1.5` preset (768d cosine) | smoke | `npx wrangler vectorize get engram-memories --json \| jq '.dimensions == 768 and .metric == "cosine"'` | ❌ W0/W1 creates `scripts/setup-vectorize.sh` | ⬜ pending |
| AI-02 | Namespace isolation: vector under `ws_A` not returned by query under `ws_B` | integration (real Vectorize binding) | `npm test --workspace=packages/mcp-server -- cross-workspace-pentest` | ✅ extend existing `__tests__/cross-workspace-pentest.test.ts` | ⬜ pending |
| AI-03 | `remember()` embeds + stamps `embedding_model`/`embedding_version` + upserts to Vectorize within 430ms p50 | unit (mocked) + integration (real bindings) | `npm test --workspace=packages/mcp-server -- tools-integration` | ✅ extend existing `__tests__/tools-integration.test.ts` | ⬜ pending |
| AI-04 | `recall()` embeds query, queries Vectorize top-K, hydrates from SQLite, hybrid re-ranks; verbosity-conditional synthesis | unit + integration + eval | `npm test --workspace=packages/mcp-server -- recall-f1.eval` | ❌ W5 creates `__tests__/evals/recall-f1.eval.test.ts` | ⬜ pending |
| AI-05 | Triage Worker extracts entities via `response_format: json_schema` on `llama-3.1-8b-instruct`; ≥95% first-parse rate | unit (mocked) + eval (Promptfoo) | `npm test --workspace=packages/triage-worker -- extract` + `npx promptfoo eval -c packages/triage-worker/evals/triage-extraction.promptfoo.yaml` | ❌ W4/W5 creates | ⬜ pending |
| AI-06 | Memorability routing: >0.8 → store-normal, 0.4–0.8 → inbox, <0.4 → `cold_storage` column (NOT discard, per D-07); ±10pp band distribution | unit + eval | `npm test --workspace=packages/triage-worker -- memorability-calibration.eval` | ❌ W5 creates | ⬜ pending |
| AI-07 | 429 triggers `message.retry({delaySeconds: 30})` — covers BOTH envelope `{success:false, errors:[]}` and thrown `AiError` shapes | unit (forced 429, both paths) | `npm test --workspace=packages/triage-worker -- extract` (429 it() blocks) | ❌ W4 creates `__tests__/extract.test.ts` | ⬜ pending |
| AI-08 | `forget()` cascade: `remember → forget → sleep(5s) → recall` returns 0 matches semantically (Vectorize + SQLite) | integration (real Vectorize) | `npm test --workspace=packages/mcp-server -- tools-integration` (AI-08 it() block) | ✅ extend existing `__tests__/tools-integration.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Validation dimensions per requirement

Detailed `source-presence / behavior-assertion / integration-assertion / eval-assertion` matrix lives in `05-RESEARCH.md` §"Validation Architecture (Nyquist) — Validation dimensions per AI-NN requirement". The planner MUST translate each row into matching `<read_first>` + `<acceptance_criteria>` content per the Anti-Shallow Execution Rules. F1 ≥ 75% on the 20-example reference corpus BLOCKS AI-04 closure; JSON parse rate ≥ 95% BLOCKS AI-05 closure.

---

## Wave 0 Requirements

Test infrastructure gaps the planner MUST close before any Wave ≥1 task runs (sourced from `05-RESEARCH.md` §"Wave 0 Gaps"):

- [x] `packages/triage-worker/vitest.config.ts` — mirror `packages/mcp-server/vitest.config.ts`
- [x] `packages/triage-worker/wrangler.test.jsonc` — declare `AI`, `VECTORIZE`, and `WORKSPACE` (durable_objects.bindings) test bindings
- [x] `packages/triage-worker/package.json` devDependencies — add `vitest@^4.1.7`, `@cloudflare/vitest-pool-workers@^0.16.9`, `zod@^4.0.0` (production), `zod-to-json-schema` (production, GATED on Package Legitimacy Audit checkpoint)
- [x] `packages/mcp-server/wrangler.test.jsonc` — extend with `AI` + `VECTORIZE` bindings
- [x] `packages/mcp-server/wrangler.jsonc` — extend with `AI` + `VECTORIZE` bindings (production config)
- [x] `packages/triage-worker/wrangler.jsonc` — extend with `AI` + `VECTORIZE` + `WORKSPACE` (cross-Worker DO binding via `script_name = "engram-mcp-server"`); queue consumer block lands in Phase 6
- [x] RED test stubs (one per new helper / boundary):
  - `packages/mcp-server/__tests__/vectorize-helper.test.ts`
  - `packages/mcp-server/__tests__/ai-helper.test.ts`
  - `packages/mcp-server/__tests__/hybrid-rank.test.ts`
  - `packages/triage-worker/__tests__/extract.test.ts`
- [x] Existing-test extensions:
  - `packages/mcp-server/__tests__/envelope.test.ts` — verbosity-parameterized assertions per D-03 (default `"chunks"` does not assert `suggestions === undefined`)
  - `packages/mcp-server/__tests__/tools-integration.test.ts` — AI-08 5-second-sleep round-trip
  - `packages/mcp-server/__tests__/cross-workspace-pentest.test.ts` — Vectorize-side AI-02 isolation it() block
- [x] Schema migration v2 — `cold_storage` column on `blocks`; migration scripts in `packages/workspace-do/src/{schema.ts, migrations.ts}`
- [x] `.planning/phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` — routing tracker file per CLAUDE.md mandate (Plan 05-01 creates as first deliverable)
- [x] Doc touch-ups: `05-AI-SPEC.md` §4 diagram amendment (D-04), `CLAUDE.md` `## Ingest Pipeline` (cold-storage replacement), `.claude/skills/spike-findings-engram/SKILL.md` (D-05 verbosity note)

Wave 0 sets `wave_0_complete: true` in this file's frontmatter on completion.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-corpus F1 acceptance | AI-04 | The 10–20 real job-search corpus samples come from Russell's working set; sanitization + 4-bucket labeling is a one-time human curation step that can't be replayed by CI | Wave 5: (1) Russell selects 10–20 anonymized samples; (2) labels each against the 4-bucket reference structure; (3) commits sanitized corpus to `packages/mcp-server/__tests__/evals/fixtures/real-corpus.json`; (4) reruns `recall-f1.eval` against it; (5) writes `05-REAL-CORPUS-RESULTS.md` with F1 score |
| Package Legitimacy Audit (`zod-to-json-schema`, `promptfoo`) | AI-05 (gate before install) | `slopcheck` is not available; per CLAUDE.md these tools need human verification of `npm view <pkg> repository.url` against known maintainer accounts | Per-package: `npm view zod-to-json-schema repository.url maintainers` → confirm GitHub repo + maintainer matches a recognized account → record approval in PLAN comment → only then `npm install --save` |
| Production monitoring dashboard verification | AI-04, AI-05 (Wave 6) | Workers Analytics Engine queries are written but production data only appears after live MCP traffic | Wave 6: deploy, send 5+ real `remember` + `recall` requests, query Analytics Engine, screenshot dashboard, attach to commit |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are listed under "Wave 0 Requirements" / "Manual-Only Verifications" with explicit reason
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all `File Exists? ❌` references in the per-task table
- [x] No watch-mode flags (`vitest --watch` is forbidden in CI commands)
- [x] Feedback latency < 60s (unit suite per workspace + `--workspaces`)
- [ ] F1 gate (AI-04) and JSON parse rate gate (AI-05) wired into `npm run evals:ci` — deferred to Wave 5 (eval infrastructure not yet shipped)
- [x] `nyquist_compliant: true` flipped in this file's frontmatter at end of Wave 0
- [x] `wave_0_complete: true` flipped at end of Wave 0

**Wave 0 closed:** 2026-05-28 (Plan 05-01)

**Approval:** Wave 0 CLOSED — all Wave 0 Requirements satisfied by Plan 05-01 tasks.
