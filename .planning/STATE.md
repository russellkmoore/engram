---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: Intelligence Layer
status: executing
last_updated: "2026-06-04T02:22:33.102Z"
last_activity: 2026-06-03 -- Phase 01 execution started
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 5
  completed_plans: 5
  percent: 20
---

# Project State: Engram

> **Project memory.** Updated by GSD commands at phase/plan transitions. Always reflects "where am I and what's next."

## Project Reference

- **Project:** Engram (MCP-native second brain for AI assistants, Cloudflare end-to-end)
- **Core Value:** Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.
- **Current Milestone:** v0.2 — Intelligence Layer (target 2026-06-21)
- **Mode:** standard (Horizontal Layers)
- **Operating principle:** "Do it RIGHT, not FAST" (depth over speed; foundational flaws are more damaging than late wow-moments).
- **Repo:** `/Users/rmoore/Workspaces/engram`
- **Planning dir:** `/Users/rmoore/Workspaces/engram/.planning`

## Current Focus

**v0.2 — Intelligence Layer.** Activate the intelligence layer on top of v0.1's foundation. Four net-new capabilities:

1. **Conflict-detection wiring** — ship ENG-16's `detectConflict()` scaffold into the live triage flow as low-confidence inbox suggestions (never auto-alerted).
2. **Query expansion** — CF AI rewrites each query into 3-4 semantic variants before Vectorize, then merges + deduplicates results.
3. **Synthesis path activation** — `recall(verbosity=synthesis|both)` produces a coherent narrative summary of retrieved memories.
4. **Hybrid-rank weight tuning** — Task 5.1 A/B work per AI-SPEC §4, against the diversified real-corpus from ENG-25.

All v0.1 follow-up issues (ENG-7..25) closed during post-v0.1 maintenance — this milestone is genuinely net-new intelligence-layer work, not cleanup.

## Current Position

Phase: 01 (foundation-wave-0) — EXECUTING
Plan: 5 of 5
Status: Executing Phase 01
Last activity: 2026-06-03 -- Phase 01 execution started

## Phase Status

v0.2 phase numbering resets to Phase 1. v0.1's phases 1-7 are archived under `milestones/v0.1-phases/`.

| Phase | Name                       | Requirements             | Plans | Status               |
| ----- | -------------------------- | ------------------------ | ----- | -------------------- |
| 1     | Foundation (Wave 0)        | PRE-01..05               | TBD   | Ready to plan        |
| 2     | Recall Quality Baseline    | RNK-01..07 + CON-01..08  | TBD   | Pending Phase 1      |
| 3     | Query Expansion + Reranker | EXP-01..12               | TBD   | Pending Phase 2      |
| 4     | Synthesis Activation Eval  | SYN-01..10               | TBD   | Pending Phase 3      |
| 5     | Integration Kitchen Sink   | INT-01..05               | TBD   | Pending Phases 2-4   |

See [ROADMAP.md](ROADMAP.md) for full phase detail and the build-order graph.

## Performance Metrics

- **Sessions to date:** 1
- **Phases completed:** 0 (Phase 1 in progress)
- **Plans completed:** 3 (01-01 PRE-01 Embedding-Version Guardrail, 01-02 PRE-02 Testing Harness, 01-03 PRE-04 Integration Matrix)
- **Blockers raised:** 0
- **Decision log entries:** see PROJECT.md "Key Decisions"

| Plan | Duration | Tasks | Files | Date |
|------|----------|-------|-------|------|
| 01-01 PRE-01 Embedding-Version Guardrail | ~90 min | 5 | 9 | 2026-06-03 |
| 01-02 PRE-02 Testing Harness (vitest tiers + eval-budget) | ~45 min | 6 | 6 | 2026-06-03 |
| 01-03 PRE-04 Integration Matrix (v0.2-INTEGRATION-MATRIX.md) | ~5 min | 1 | 1 | 2026-06-04 |
| Phase 01 P04 | 2 minutes | 1 tasks | 1 files |

## Accumulated Context

### Decisions carried into v0.2 (from v0.1)

All v0.1 architectural decisions remain locked. See `MILESTONES.md` "v0.1 MCP Foundation" → "Architectural decisions locked" for the full list. Key items for v0.2:

1. **Two-Worker split** (MCP + Triage) — v0.2's intelligence-layer work extends both Workers; no new Worker classes.
2. **DO-per-workspace** — v0.2 stays single-tier (one `WorkspaceDO`). Multi-tier hierarchy (UserDO + TeamDO + ProjectDO) is v0.3 work per SEED-001.
3. **MemoryEvent as universal intake primitive** — conflict-detection wiring extends the existing triage pipeline, not a new ingest path.
4. **9-tool MCP surface cap** — the 5 v0.1 tools remain the surface; v0.2 deepens `recall()` semantics without adding tools.
5. **Schema-as-data memory types** — query expansion + synthesis operate on existing memory types; no new types in v0.2.

### Decisions made today (post-v0.1 close, 2026-06-02)

From session work that closed ENG-21..25 before v0.2 planning:

1. **`@engram/ai-config` shared package** is the single source of truth for all model IDs + tuning constants. SYNTHESIS_MODEL + QUERY_EXPANSION_MODEL stubs ready to specialize in v0.2.
2. **Classifier model**: `@cf/meta/llama-4-scout-17b-16e-instruct` (multimodal-ready, future-proofs v0.4 vision via connectors).
3. **Embedding model**: `@cf/qwen/qwen3-embedding-0.6b` (1024d, 4096-token context — fixed 1800-char truncation).
4. **MIN_COSINE_THRESHOLD=0.6** in `recall()` — partial hybrid-rank tuning. v0.2 expands this into the full Task 5.1 A/B sweep.
5. **ENG-16 conflict-detection ship verdict**: `ship-as-suggestions` (precision 0.875, recall 0.933 on 30-pair corpus). Per-write auto-alert deferred — v0.2 inbox-only.
6. **Linear workflow tweak**: between `/gsd:plan-phase` and `/gsd:execute-phase`, ask Claude to create Linear issues for the plan (one issue per plan, sub-issues per atomic chunk when warranted). Lightweight, no skill needed — judged per-plan.

### Open TODOs

- Run `/gsd:plan-phase 1` to begin Phase 1 (Foundation) work. Phase 1 scope: PRE-01..05 (re-embed audit, tiered tests, corpus expansion 27 → 100+, integration matrix doc, CF-code-assist routing scaffold).
- Russell's eval-corpus labeling time (PRE-03) is the critical path for the entire milestone — 3-4 hours, ideally batched in one sitting.

### Open Blockers

None.

## Deferred Items (v0.2 inbox)

All v0.1-flagged items closed during post-v0.1 maintenance (2026-05-31 → 2026-06-02). Net carry-forward into v0.2:

- **SEED-001 (ENG-17)** — Cross-layer recall fan-out. Dormant; trigger is **v0.3** planning (Workspaces + Project DOs), not v0.2.
- **SEED-002 (ENG-18)** — Connector cost + throughput model. Dormant; trigger is **v0.4** planning (Connectors + Alerts), not v0.2.

No active deferred work to triage at v0.2 start.

## Session Continuity

### Where to resume after a context reset

1. Re-read this STATE.md.
2. Re-read PROJECT.md (project context + locked decisions, especially the Active section for v0.2 goals).
3. Re-read REQUIREMENTS.md once it lands (it's about to be created in this milestone).
4. Re-read ROADMAP.md once the roadmapper runs (it'll reflect v0.2 phases).
5. Reference MILESTONES.md "v0.1 MCP Foundation" for v0.1 architectural decisions and the 8 key accomplishments.

### Last update

- **2026-06-04:** Plan 01-03 (PRE-04 Integration Matrix) complete. `.planning/research/v0.2-INTEGRATION-MATRIX.md` created with six cross-feature pairings, byte-fixed status vocabulary (`tested | pending | out-of-scope`), and Closure Rule footer binding Phases 2..5 to update rows as integration tests land. Phase 5 INT-04 grep gate has a deterministic target.
- **2026-06-03:** Plan 01-02 (PRE-02 Testing Harness) complete. Tiered vitest configs (eval project in mcp-server + triage-worker), eval-budget.setup.ts MAX_AI_CALLS=200 ceiling, eval-budget-summary.mjs GraphQL neuron reporter, CI eval-suite job (fork-safe + fail-loud), and test:unit/integration/eval root npm scripts shipped.
- **2026-06-03:** Plan 01-01 (PRE-01 Embedding-Version Guardrail) complete. countStaleEmbeddings NULL-trap SQL, assertAllBlocksAtV2 admin RPC, cross-workspace audit script, and CI gate shipped. Checkpoint pending: Russell must add WORKSPACE_NAMESPACE_ID + ENGRAM_ADMIN_AUDIT_TOKEN secrets before CI audit runs end-to-end.
- **2026-06-02:** Milestone v0.2 (Intelligence Layer) scoped end-to-end. v0.1 phase directories archived to `milestones/v0.1-phases/`. 5 phases / 44 requirements / 4 features. Research synthesis: `research/v0.2-SUMMARY.md`. Ready for `/gsd:plan-phase 1`.

---

_State updated: 2026-06-03 by /gsd:execute-phase 01-01_

## Operator Next Steps

- Russell: add WORKSPACE_NAMESPACE_ID GitHub Actions secret (see 01-01-PLAN.md user_setup for exact commands)
- Russell: set ENGRAM_ADMIN_AUDIT_TOKEN Worker secret: `wrangler secret put ENGRAM_ADMIN_AUDIT_TOKEN` + `gh secret set ENGRAM_ADMIN_AUDIT_TOKEN --body "<same value>"`
- Run Plan 01-04 (next plan in Phase 1)

_State updated: 2026-06-04 by /gsd:execute-phase 01-03_
