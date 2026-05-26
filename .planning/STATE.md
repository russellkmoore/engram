---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 02 complete
last_updated: "2026-05-26T06:35:39.804Z"
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 21
  completed_plans: 15
  percent: 29
---

# Project State: Engram

> **Project memory.** Updated by GSD commands at phase/plan transitions. Always reflects "where am I and what's next."

## Project Reference

- **Project:** Engram (MCP-native second brain for AI assistants, Cloudflare end-to-end)
- **Core Value:** Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.
- **Current Milestone:** v0.1 — MCP Foundation (Linear target 2026-06-07)
- **Mode:** standard (Horizontal Layers)
- **Operating principle:** "Do it RIGHT, not FAST" (depth over speed; foundational flaws are more damaging than late wow-moments).
- **Repo:** `/Users/rmoore/Workspaces/engram`
- **Planning dir:** `/Users/rmoore/Workspaces/engram/.planning`

## Current Focus

**v0.1 — MCP Foundation.** Russell's first-user use case is his existing job-search agent. The single user-facing acceptance test is: `remember` a job posting in conversation A → `recall` it in conversation B (different chat) 1+ hour later, with extracted fields intact. Russell uses Engram daily for at least 3 consecutive working days post-deploy before v0.1 closes.

## Current Position

Phase: 03 (mcp-server-scaffold) — EXECUTING
Plan: 1 of 6
| Field | Value |
|---|---|
| **Milestone** | v0.1 — MCP Foundation |
| **Phase** | Phase 1 — Foundation (ready to plan) |
| **Plan** | none yet — `/gsd:plan-phase 1` to begin |
| **Status** | Roadmap complete; awaiting plan-phase for P1 |
| **Phases total** | 7 |
| **Phases complete** | 0 / 7 |
| **Requirements total (v0.1)** | 54 |
| **Requirements mapped to phases** | 54 / 54 (100%) |
| **Progress** | `[░░░░░░░░░░░░░░░░░░░░] 0%` |

## Phase Status

| Phase | Name                  | Status            | Linear                                           |
| ----- | --------------------- | ----------------- | ------------------------------------------------ |
| 1     | Foundation            | **Ready to plan** | Not yet created (created at `/gsd:plan-phase 1`) |
| 2     | WorkspaceDO + SQLite  | Pending           | —                                                |
| 3     | MCP Server Scaffold   | Pending           | —                                                |
| 4     | Core Tools + Envelope | Pending           | —                                                |
| 5     | AI Integration        | Pending           | —                                                |
| 6     | Async Pipeline        | Pending           | —                                                |
| 7     | Deploy + Acceptance   | Pending           | —                                                |

## Performance Metrics

- **Sessions to date:** 1 (roadmap)
- **Phases completed:** 0
- **Plans completed:** 0
- **Blockers raised:** 0
- **Decision log entries:** see PROJECT.md "Key Decisions" + research SUMMARY.md §6 + §7

## Accumulated Context

### Decisions (carried into v0.1)

From PROJECT.md + research SUMMARY.md §6 + Russell's overrides:

1. **AI stays in v0.1.** Russell overrode research recommendation (which suggested deferring Vectorize + Workers AI to v0.2 for a leaner critical path). v0.1 ships with semantic `recall`, not just SQL `LIKE`. Phase 5 (AI Integration) is the dedicated phase for this work.
2. **All other research corrections C2–C9 locked.** Two DO classes per Worker (`EngramMcp` session DO + `WorkspaceDO` durable store); `wrangler.jsonc` not `.toml`; `ingest-worker` package deferred to v0.4; direct RPC for sync writes + Queue for async enrichment; `search` has no `format?` parameter; `agents/mcp` `McpAgent` is the MCP host (not raw SDK); Apache-2.0 LICENSE placeholder at first commit; `bge-base-en-v1.5` (768d, cosine) for embeddings.
3. **Eight must-mitigate items.** See SUMMARY.md §7 + the Risk Notes on every phase in ROADMAP.md. Non-negotiable for v0.1: `new_sqlite_classes`, schema migrations without `PRAGMA user_version`, no `blockConcurrencyWhile()` across I/O, DO defense-in-depth on workspace_id, MCP response size budgets (<8K tokens), `McpError` shape (not ad-hoc envelopes), transactional `forget` across SQLite + Vectorize, `embedding_model` + `embedding_version` columns on `blocks` from day 1.
4. **Horizontal Layers, not user-story slices.** Each phase enables the next via the dependency graph from ARCHITECTURE.md §"Build-Order Dependencies": types/config → storage → MCP scaffold → tools → AI → async pipeline → deploy.
5. **Linear sync rule.** Phase = Linear Issue, auto-sync. Team `ENG`, milestone "v0.1 — MCP Foundation" (already exists, 0%). `/gsd:plan-phase N` creates the issue; `/gsd:execute-phase` updates state; `/gsd:ship` attaches PR.

### Open TODOs (for the roadmapper handoff)

- Run `/gsd:plan-phase 1` to begin Foundation work and create the first Linear issue.
- During P1, FND-07 must update CLAUDE.md to reflect the corrected baseline (JSONC, two-DO topology, `McpAgent`, `search` without `format?`, `ingest-worker` deferred). Other phases assume this edit has happened.
- Tokenizer choice for MCP-08 response-size assertions is open: probably `gpt-tokenizer` (portability) or `tiktoken` (Claude-fidelity). Decide during P4 plan-phase.
- `durable-utils` `SQLSchemaMigrations` API surface needs version pinning during P2 plan-phase (recommended in PITFALLS DO-2; not version-pinned in STACK.md).

### Open Blockers

None.

## Session Continuity

### Where to resume after a context reset

1. Re-read this STATE.md.
2. Re-read PROJECT.md (project context + locked decisions).
3. Re-read ROADMAP.md (phase structure + success criteria).
4. Re-read REQUIREMENTS.md (especially the Traceability section for phase mapping).
5. Re-read the research SUMMARY.md §5 (phase rationale), §6 (corrections), and §7 (must-mitigate items) when planning or executing any phase.

### Last update

- **2026-05-24:** Roadmap created. 7 phases, 54/54 v0.1 requirements mapped, no orphans. Phase 1 (Foundation) marked ready to plan.

---

_State initialized: 2026-05-24 by GSD roadmapper_
