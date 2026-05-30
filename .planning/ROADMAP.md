# Roadmap: Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Updated:** 2026-05-30 (v0.1 milestone shipped)

> Per-milestone roadmaps live in `.planning/milestones/`. This file is the rolling project view.

## Milestones

- ✅ **v0.1 MCP Foundation** — Phases 1-7 (shipped 2026-05-30) — see [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- 📋 **v0.2 Intelligence Layer** — target 2026-06-21 (planned)
- 📋 **v0.3 Workspaces + Memory Types** — target 2026-07-12 (planned)
- 📋 **v0.4 Connectors + Alerts** — target 2026-08-02 (planned)
- 📋 **v1.0 Public Launch** — target 2026-09-01 (planned)

## Phases

<!-- markdownlint-disable MD033 -- collapsible <details> required for GitHub render of completed milestones -->
<details>
<summary>✅ v0.1 MCP Foundation (Phases 1-7) — SHIPPED 2026-05-30</summary>

- [x] **Phase 1: Foundation** — completed 2026-05-25 (6/6 plans)
- [x] **Phase 2: WorkspaceDO + SQLite** — completed 2026-05-26 (9/9 plans)
- [x] **Phase 3: MCP Server Scaffold** — completed 2026-05-26 (6/6 plans)
- [x] **Phase 4: Core Tools + Envelope** — completed 2026-05-27 (7/7 plans)
- [x] **Phase 5: AI Integration** — completed 2026-05-28 (7/7 plans)
- [x] **Phase 6: Async Pipeline** — completed 2026-05-29 (5/5 plans)
- [x] **Phase 7: Deploy + Acceptance** — completed 2026-05-30 (4/4 plans)

Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)

</details>
<!-- markdownlint-enable MD033 -->

### 📋 v0.2 Intelligence Layer (Planned)

Target ship: 2026-06-21. Will be scoped via `/gsd:new-milestone v0.2`. Anticipated focus areas (from PROJECT.md + Phase 7 follow-ups):

- Semantic conflict detection upgrade (validates ENG-16 precision gate first)
- Query expansion (CF AI rewrites the query into 3-4 semantic variants before Vectorize search)
- Embedding upgrade-path validation
- Better first-run auth flow (ENG-11 — pulled forward from v0.4)
- Recall envelope `type` field fix (ENG-8)
- Promptfoo eval gate tightening (ENG-9) + wire into CI (ENG-10)
- Close out Phase 5 deferred eval gates (ENG-20 — AI-04 / AI-05 / AI-06 with real corpus)

### 📋 v0.3 Workspaces + Memory Types (Planned)

Target ship: 2026-07-12. Anticipated focus:

- UserDO/TeamDO/ProjectDO hierarchy
- Cross-layer recall fan-out (ENG-17 — SEED-001 design work)
- Member management
- `reflect` / `relate` / `export` MCP tools
- User-defined memory types

### 📋 v0.4 Connectors + Alerts (Planned)

Target ship: 2026-08-02. Anticipated focus:

- Slack + Drive connectors (server-side fetch + publish to `engram-ingest` Queue)
- `ingest-worker` package returns as connector orchestration layer
- `ingest()` MCP tool body fills in (URL-fetch path)
- Daily digest
- Inbox UI
- `conflict` MCP tool (after v0.2 precision validation)
- Killer demo: same answer from Slack + from Claude, both backed by layered store
- Connector cost + throughput model (ENG-18 — SEED-002 prerequisite)

### 📋 v1.0 Public Launch (Planned)

Target ship: 2026-09-01. Managed hosting, Stripe billing, OAuth, admin UI, connector registry, OSS launch.

## Progress

| Milestone | Phases | Status | Shipped |
| --------- | ------ | ------------ | ----------- |
| v0.1 MCP Foundation | 1-7 (44 plans) | ✅ Shipped | 2026-05-30 |
| v0.2 Intelligence Layer | TBD | 📋 Planned | — |
| v0.3 Workspaces + Memory Types | TBD | 📋 Planned | — |
| v0.4 Connectors + Alerts | TBD | 📋 Planned | — |
| v1.0 Public Launch | TBD | 📋 Planned | — |

---

_Per-milestone roadmaps with full phase details live in `.planning/milestones/`._
_Tracked deferrals: 14 Linear issues (ENG-7..20). See `STATE.md` `## Deferred Items` or Linear project [Engram](https://linear.app/blackmagicconsulting/project/engram-3cebc9097d0e)._
