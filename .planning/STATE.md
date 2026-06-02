---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: Intelligence Layer
status: planning
last_updated: "2026-06-02T09:30:00.000Z"
last_activity: 2026-06-02 — Milestone v0.2 started; requirements being defined
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
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

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-02 — Milestone v0.2 started

## Phase Status

To be populated by the roadmapper once requirements are defined. v0.2 phase numbering resets to **Phase 1** (per `--reset-phase-numbers`-equivalent choice at milestone start; v0.1's phases 1-7 are archived in `milestones/v0.1-phases/`).

## Performance Metrics

- **Sessions to date:** 0 (milestone just started)
- **Phases completed:** 0
- **Plans completed:** 0
- **Blockers raised:** 0
- **Decision log entries:** see PROJECT.md "Key Decisions"

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

- Run `/gsd:plan-phase 1` to begin v0.2 Phase 1 work once requirements + roadmap land.
- Decide during v0.2 planning: which of the 4 features lands first? Conflict-detection wiring is the most directly user-visible; query expansion has the largest recall-quality upside; synthesis activates a dormant code path; hybrid-rank tuning is precision-engineering work.

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

- **2026-06-02:** Milestone v0.2 (Intelligence Layer) started. v0.1 phase directories archived to `milestones/v0.1-phases/`. Phase numbering reset; v0.2 starts at Phase 1.

---

_State updated: 2026-06-02 by /gsd:new-milestone_

## Operator Next Steps

- Define v0.2 requirements (next workflow step).
- Run the roadmapper to produce v0.2 phase structure.
- Begin Phase 1 with /gsd:plan-phase 1.
