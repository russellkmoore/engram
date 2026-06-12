# Roadmap: Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Updated:** 2026-06-12 (v0.2 Intelligence Layer shipped + archived)

> Per-milestone archives live in `.planning/milestones/`. This file is the rolling project view. No milestone is currently in flight — scope the next one with `/gsd:new-milestone`.

## Milestones

- ✅ **v0.1 MCP Foundation** — Phases 1-7 (shipped 2026-05-30) — see [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Intelligence Layer** — Phases 1-5 (shipped 2026-06-12) — see [milestones/v0.2-ROADMAP.md](milestones/v0.2-ROADMAP.md)
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

<!-- markdownlint-disable MD033 -->
<details>
<summary>✅ v0.2 Intelligence Layer (Phases 1-5) — SHIPPED 2026-06-12</summary>

- [x] **Phase 1: Foundation (Wave 0)** — re-embed audit, tiered tests, eval-corpus 27→100, integration matrix (completed 2026-06-04)
- [x] **Phase 2: Recall Quality Baseline** — hybrid-rank weight tuning + conflict-detection wiring (completed 2026-06-08)
- [x] **Phase 3: Query Expansion + Reranker** — multi-query + RRF + bge-reranker (disabled by ablation) with adaptive routing (completed 2026-06-08)
- [x] **Phase 4: Synthesis Activation Eval** — `verbosity=synthesis|both` with LLM-judge faithfulness gate; default stays `chunks` (completed 2026-06-10)
- [x] **Phase 5: Integration Kitchen Sink** — cross-feature integration tests + envelope budget audit + extended cross-workspace pentest (completed 2026-06-11)

Audit: `tech_debt` (no blockers); all 5 phases Nyquist-compliant. Deferred at close: EXP-11 + INT-05 (deploy-gated), SYN-02 (advisory override).

Full details: [milestones/v0.2-ROADMAP.md](milestones/v0.2-ROADMAP.md)

</details>
<!-- markdownlint-enable MD033 -->

### 📋 v0.3 Workspaces + Memory Types (Planned)

Target ship: 2026-07-12. Anticipated focus:

- UserDO/TeamDO/ProjectDO hierarchy
- Cross-layer recall fan-out (ENG-17 — SEED-001 design work)
- Member management
- `reflect` / `relate` / `forget(cascade)` / `export` / `conflict` MCP tools (completes the 9-tool surface)
- User-defined memory types
- bge-reranker enabling decision if v0.2 ablation said `rerank=0`
- Hybrid-rank re-tune against the larger v0.3 corpus
- Synthesis `verbosity` default flip discussion using v0.2 analytics

### 📋 v0.4 Connectors + Alerts (Planned)

Target ship: 2026-08-02. Anticipated focus:

- Slack + Drive connectors (server-side fetch + publish to `engram-ingest` Queue)
- `ingest-worker` package returns as connector orchestration layer
- `ingest()` MCP tool body fills in (URL-fetch path)
- Daily digest
- Inbox UI (read + write surface for v0.2's conflict suggestions and memorability inbox)
- Killer demo: same answer from Slack + from Claude, both backed by layered store
- Connector cost + throughput model (ENG-18 — SEED-002 prerequisite)

### 📋 v1.0 Public Launch (Planned)

Target ship: 2026-09-01. Managed hosting, Stripe billing, OAuth, admin UI, connector registry, OSS launch. `engram-conflicts` Queue if multi-tenant volume justifies separating async stages.

## Backlog

> Unsequenced ideas captured for future planning. Promote with `/gsd:review-backlog` when ready to slot into a milestone.

### Phase 999.1: v0.3 Identity + Surface milestone — consent UI + inbox UI + minimal admin (BACKLOG)

**Goal:** Replace the terminal-side `kv:bootstrap` dance with a real browser-based sign-in flow so a second user can connect Engram via Claude Desktop Custom Connectors without ever cloning the repo. Consolidates UI work currently scattered across milestones (consent UI undefined; inbox UI is a v0.4 one-line item that's already late since v0.2 conflict suggestions land in the inbox table with no human-readable surface; memory browser absent; admin is a v1.0 wave-hand mention).

**Requirements:** TBD — open scope decisions to resolve at `/gsd:new-milestone` time:

1. Tight scope (auth + inbox only, ~3 weeks) vs wide scope (auth + inbox + memory browser + minimal admin, ~5 weeks).
2. Upstream auth provider — Cloudflare Email Routing magic links / GitHub OAuth upstream / Google OAuth.
3. Whether the admin surface includes the eval-budget dashboard (would consolidate `scripts/eval-budget-summary.mjs`) or stays workspace+identity-only.

**Plans:** 0 plans

**Predecessors already shipped (v0.1):**

- `@cloudflare/workers-oauth-provider` OAuth Resource Server pattern ([packages/mcp-server/src/index.ts:121-128](../packages/mcp-server/src/index.ts#L121-L128))
- KV-backed identity records ([packages/mcp-server/src/oauth.ts:197-284](../packages/mcp-server/src/oauth.ts#L197-L284))
- `kv:bootstrap-interactive` terminal helper (`scripts/kv-bootstrap-interactive.mjs`)

**Promise in code:** [packages/mcp-server/src/oauth.ts:223-228](../packages/mcp-server/src/oauth.ts#L223-L228) reads "v0.2 will replace this with a real consent UI" — that promise slipped when v0.2 scope became the Intelligence Layer. Original deferral rationale + post-v0.1 reversal: [RETROSPECTIVE.md:28](RETROSPECTIVE.md#L28), [.planning/proposals/ENG-11-first-run-auth-flow-DESIGN.md](proposals/ENG-11-first-run-auth-flow-DESIGN.md).

**Proposed milestone slot:** insert between current v0.2 and current v0.3, pushing Workspaces+Memory Types → v0.4, Connectors+Alerts → v0.5. v1.0 target stays 2026-09-01.

Plans:

- [ ] TBD (promote with `/gsd:review-backlog` when ready)

### Phase 999.2: D-09 all-uncited synthesis floor (BACKLOG)

**Goal:** Fix the synthesis-availability bug surfaced by the Phase 4 eval gate (04-04). `dropUncitedSentences` (D-09) empties a synthesis entirely when the model produces a faithful-but-uncited summary (no "memory N" markers → no `[blk-id]` citations → every sentence dropped). Observed ~40% empty on the curated synthesis corpus. The faithfulness is fine (zero hallucinated entities); only availability suffers.

**Proposed fix:** add an all-uncited floor — when `dropUncitedSentences` would drop *every* sentence, keep the synthesis (optionally apply the low-confidence hedge prefix) rather than returning empty. Compatible with existing 04-01 unit tests (they cover mixed cited/uncited, not all-uncited). Faithfulness-preserving.

**Source:** [packages/mcp-server/src/tools.ts dropUncitedSentences](../packages/mcp-server/src/tools.ts), Phase 4 04-04-SUMMARY.md "Known behavior".

Plans:

- [ ] TBD (promote with `/gsd:review-backlog` when ready)

### Phase 999.3: Synthesis faithfulness LLM-judge robustness (BACKLOG)

**Goal:** Reduce LLM-judge noise so the SYN-02 faithfulness *rate* can be restored as a hard gate (currently advisory/logged per the 04-04 recalibration). The judge mis-scores claims that cite multiple memories collectively (observed false-negative where a claim present in `blk-052` was marked unsupported because it was attributed to `[blk-050]/[blk-051]/[blk-052]` together).

**Proposed fix:** larger eval N (more curated cases) and/or a refined judge rubric for collective citations; then re-promote `passRate >= 0.90` to a hard `expect()`. The zero-hallucinated-entities hard gate already holds.

**Source:** Phase 4 04-04-SUMMARY.md "Known behavior", `synthesis-fidelity.eval.test.ts`.

Plans:

- [ ] TBD (promote with `/gsd:review-backlog` when ready)

## Progress

| Milestone | Phases | Status | Shipped |
| --------- | ------ | ------------ | ----------- |
| v0.1 MCP Foundation | 1-7 (44 plans) | ✅ Shipped | 2026-05-30 |
| v0.2 Intelligence Layer | 1-5 (29 plans) | ✅ Shipped | 2026-06-12 |
| v0.3 Workspaces + Memory Types | TBD | 📋 Planned | — |
| v0.4 Connectors + Alerts | TBD | 📋 Planned | — |
| v1.0 Public Launch | TBD | 📋 Planned | — |

## Linear Sync Convention

Per CLAUDE.md "Linear Workflow" — one ENG issue per phase, auto-synced at `/gsd:plan-phase` start (→ Todo) and `/gsd:execute-phase` start (→ In Progress). All v0.2 issues map to the existing Linear milestone "v0.2 — Intelligence Layer".

Between `/gsd:plan-phase` and `/gsd:execute-phase`, Claude creates per-plan Linear issues (one issue per plan, sub-issues per atomic chunk if scope warrants). Lightweight, judged per-plan, no skill needed — per the post-v0.1 workflow tweak captured in STATE.md decision 6.

---

_Per-milestone roadmaps with full phase details for completed milestones live in `.planning/milestones/`._
_v0.2 roadmap created 2026-06-02 by `/gsd:new-milestone`. Source-of-truth research synthesis: [research/v0.2-SUMMARY.md](research/v0.2-SUMMARY.md). Requirements: [REQUIREMENTS.md](REQUIREMENTS.md)._
