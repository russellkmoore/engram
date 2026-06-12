# Roadmap: Engram

**Project:** Engram (MCP-native second brain on Cloudflare)
**Updated:** 2026-06-12 (v0.3 Identity + Surface roadmap created)

> Per-milestone archives live in `.planning/milestones/`. This file is the rolling project view.

## Milestones

- ✅ **v0.1 MCP Foundation** — Phases 1-7 (shipped 2026-05-30) — see [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Intelligence Layer** — Phases 1-5 (shipped 2026-06-12) — see [milestones/v0.2-ROADMAP.md](milestones/v0.2-ROADMAP.md)
- 🚧 **v0.3 Identity + Surface** — Phases 1-5 (in flight, target 2026-07-19)
- 📋 **v0.4 Workspaces + Memory Types** — target 2026-08-09 (planned; original v0.3 scope, shifted)
- 📋 **v0.5 Connectors + Alerts** — target 2026-08-30 (planned; original v0.4, shifted)
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

### 🚧 v0.3 Identity + Surface (Active)

**Prerequisites (gate Phase 1 — must be resolved before auth code):**

| # | Prerequisite | Status (2026-06-12) | Fallback |
| --- | --- | --- | --- |
| PRE-A | CF Email Service beta access confirmed on Russell's account | ✓ RESOLVED — access confirmed, multiple email setups in place | Resend with `RESEND_API_KEY` Worker secret |
| PRE-B | Custom domain in CF DNS usable as magic-link `from` sender | ✓ RESOLVED — `engram.russellkmoore.me` | Register/verify a domain |
| PRE-C | `@cloudflare/vite-plugin` pinned ≥ 1.6.0 (CVE-2025-59427) | Handled in-phase — no frontend exists yet; pin at `engram-web` scaffold | Pin/upgrade before first UI build |
| PRE-D | Claude Desktop OAuth-on-add surface verified empirically | Handled in-phase — verify with the auth implementation in P1 | Fall back to QR/polling link-mcp flow |

- [ ] **Phase 1: Auth + Session Foundation** — `engram-web` Worker scaffold, magic-link flow, session cookies, identity convergence, link-mcp step
- [ ] **Phase 2: WorkspaceDO RPC Layer** — `listInbox`, `acceptInboxItem`, `rejectInboxItem`, `listBlocks`, `listMembers` with migration v3
- [ ] **Phase 3: Inbox UI** — inbox list, conflict pair view, accept/reject/resolve actions with full write-path security
- [ ] **Phase 4: Memory Browser** — paginated memory list, filters, text + semantic search, detail view, forget
- [ ] **Phase 5: Admin + Eval-Budget Dashboard** — identity/member management, neuron-spend analytics, invite flow

### 📋 v0.4 Workspaces + Memory Types (Planned)

Target ship: 2026-08-09. Original v0.3 scope shifted after v0.3 Identity + Surface inserted.

- UserDO/TeamDO/ProjectDO hierarchy
- Cross-layer recall fan-out (SEED-001 design work)
- Member management + RBAC
- `reflect` / `relate` / `export` / `conflict` MCP tools (completes the 9-tool surface)
- User-defined memory types (schema-as-data editor in browser)

### 📋 v0.5 Connectors + Alerts (Planned)

Target ship: 2026-08-30. Original v0.4 scope shifted.

- Slack + Drive connectors (server-side fetch + publish to `engram-ingest` Queue)
- `ingest-worker` package returns as connector orchestration layer
- Daily digest
- Killer demo: same answer from Slack + from Claude, both backed by layered store
- Connector cost + throughput model (SEED-002 prerequisite)

### 📋 v1.0 Public Launch (Planned)

Target ship: 2026-09-01. Managed hosting, Stripe billing, OAuth, admin UI, connector registry, OSS launch.

## Phase Details

### Phase 1: Auth + Session Foundation

**Goal:** A new authorized user can sign in to Engram in a browser with no terminal commands, connect Claude Desktop, and have both surfaces operating on the same workspace — with registration locked to invite-only by default
**Depends on:** Prerequisites PRE-A through PRE-D resolved
**Requirements:** WEB-01, WEB-02, WEB-03, WEB-04, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-10

**Success Criteria** (what must be TRUE):

1. Visiting `engram-web` and submitting an email triggers a magic-link email delivered from a verified CF-DNS sender domain; clicking the link lands the user on the dashboard after a POST-gate confirmation (no terminal, no `kv:bootstrap`, ML-1 + ML-2 + ML-3 mitigated)
2. A new **authorized** user's first successful sign-in auto-provisions a workspace with a human name; a returning user's sign-in skips bootstrap and lands on the dashboard
3. The web session and the Claude Desktop MCP `sub` converge on one `ENGRAM_IDENTITIES` KV record (identity-convergence invariant, AUTH-04) — Claude Desktop MCP tools work against the same workspace the browser UI shows
4. After connecting, the user sees the exact `claude_desktop_config.json` snippet with a one-click copy button (prevents the v0.1 config-wipe)
5. Unauthenticated requests to `/api/*`, `/inbox`, `/memories`, `/admin` are rejected server-side; auth callback paths survive the SPA-fallback routing (SA-1 + SA-2 mitigated)
6. Registration is invite-only by default (`REGISTRATION_MODE`): an un-invited, non-owner email is declined without provisioning; the `ENGRAM_OWNER_EMAIL` operator self-authorizes on first sign-in (replacing `kv:bootstrap`); the login-email endpoint is rate-limited per-email + per-IP (AUTH-08/09/10)

**Plans:** TBD
**UI hint**: yes

### Phase 2: WorkspaceDO RPC Layer

**Goal:** The data methods the inbox, memory browser, and admin surfaces depend on exist in `WorkspaceDO` and are hardened for production use
**Depends on:** Phase 1 (auth test harness establishes the session/workspace_id chain that unit tests exercise)
**Requirements:** (no standalone UI requirements — this phase is the data layer; all five new RPC methods are prerequisites for Phases 3, 4, 5; requirement traceability is captured via the surfaces that consume these methods: INBOX-01..08, BROWSE-01..06, ADMIN-01..02)

**Success Criteria** (what must be TRUE):

1. A unit test can call `WorkspaceDO.listInbox()` and receive a paginated result with `next_cursor` — no N-per-row calls, no unbounded queries (DU-1 mitigated)
2. `acceptInboxItem()` is idempotent — a double-call with the same `id` returns 200 both times and creates exactly one block (WP-2 mitigated)
3. `rejectInboxItem()` marks the inbox row `rejected_at` (soft-delete) and never hard-discards data (cardinal-sin rule preserved)
4. All five new DO methods have `assertOwnsWorkspace` as their first executable line, verified by tests with a mismatched `workspace_id` asserting a thrown error
5. Schema migration v3 (`+rejected_at INTEGER` on `inbox`) runs idempotently in CI

**Plans:** TBD

### Phase 3: Inbox UI

**Goal:** A user can review, accept, and resolve all items the v0.2 intelligence layer has flagged — low-confidence captures and detected conflicts — directly in the browser
**Depends on:** Phase 1 (auth gate + session), Phase 2 (`listInbox`, `acceptInboxItem`, `rejectInboxItem`)
**Requirements:** INBOX-01, INBOX-02, INBOX-03, INBOX-04, INBOX-05, INBOX-06, INBOX-07, INBOX-08

**Success Criteria** (what must be TRUE):

1. The inbox list shows unresolved items newest-first with an unreviewed-count badge; the "All caught up" empty state renders when none remain (INBOX-01, INBOX-07)
2. A user can accept a low-confidence item — with optional type/property override — and the block appears in the memory browser; pessimistic UI (no optimistic remove before API confirms, WP-4 mitigated)
3. A user can reject a low-confidence item; the rejected item goes to cold-storage soft-delete and never reappears (INBOX-04, cardinal-sin rule)
4. Conflict items render as a side-by-side Memory A vs Memory B pair with severity badge; the user can resolve via Keep A / Keep B / Keep Both, with `conflicts.resolved_at` updated (INBOX-05, INBOX-06)
5. All inbox write endpoints are CSRF-protected (`__Host-CSRF` double-submit + Origin check) and derive `workspace_id` from the session cookie exclusively — URL manipulation cannot escalate to another workspace (WP-1 + WP-3 mitigated)

**Plans:** TBD
**UI hint**: yes

### Phase 4: Memory Browser

**Goal:** A user can browse, search, and inspect all stored memories through a human-readable interface, and delete individual memories
**Depends on:** Phase 1 (auth gate + session), Phase 2 (`listBlocks`, `getBlock`)
**Requirements:** BROWSE-01, BROWSE-02, BROWSE-03, BROWSE-04, BROWSE-05, BROWSE-06

**Success Criteria** (what must be TRUE):

1. The memory list is paginated (cursor-based), shows type/summary/scope/source/confidence/date per row, and can be filtered by memory type, scope, date range, and tag (BROWSE-01, BROWSE-03)
2. A text search over `blocks.content + blocks.summary` returns matching rows; no unbounded queries — every `listBlocks` call includes a `LIMIT` clause (BROWSE-02, DU-4 mitigated)
3. The detail view shows full content with a summary/raw toggle, the typed properties panel, AI + user tags, related memories from the `relations` graph, and confidence + source badges (BROWSE-04)
4. A semantic search via the search bar routes to the existing `recall()` Vectorize backend and returns ranked results, validating the recall path through a human surface (BROWSE-06)
5. A user can delete a single memory from the detail view (mapped to the `forget()` path); the browser is otherwise read-only with no inline editing (BROWSE-05, SC-2 mitigated)

**Plans:** TBD
**UI hint**: yes

### Phase 5: Admin + Eval-Budget Dashboard

**Goal:** An admin can view connected users, invite a new user, and inspect Workers AI neuron spend over time — productizing the `eval-budget-summary.mjs` script as a live browser view
**Depends on:** Phase 1 (auth gate + session), Phase 2 (`listMembers`)
**Requirements:** ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06

**Success Criteria** (what must be TRUE):

1. The admin page shows all `ENGRAM_IDENTITIES` records (connected users) with workspace IDs (ADMIN-01)
2. An admin can invite a user by email — a magic link is sent via the Phase 1 auth flow — and the invited user can sign in with no terminal commands (ADMIN-02)
3. The eval-budget table shows Workers AI neuron spend over the last 7d and 30d, computed with `SUM(_sample_interval * double1)` — correct under Analytics Engine sampling, results KV-cached for 5 minutes (ADMIN-03, ADMIN-04, AD-1 + DU-5 mitigated)
4. The Analytics Engine API token never appears in any browser response; all neuron-spend queries are proxied server-side through the `engram-web` Worker (AD-4 mitigated)
5. The dashboard shows per-model neuron breakdown and a spend-over-time inline SVG/Canvas chart (daily granularity, timezone-correct bucketing, 90-day retention label) (ADMIN-05, ADMIN-06, AD-2 + AD-3 mitigated)

**Plans:** TBD
**UI hint**: yes

## Backlog

> Unsequenced ideas captured for future planning. Promote with `/gsd:review-backlog` when ready to slot into a milestone.

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

| Phase | Plans Complete | Status | Completed |
| --- | --- | --- | --- |
| 1. Auth + Session Foundation | 0/TBD | Not started | - |
| 2. WorkspaceDO RPC Layer | 0/TBD | Not started | - |
| 3. Inbox UI | 0/TBD | Not started | - |
| 4. Memory Browser | 0/TBD | Not started | - |
| 5. Admin + Eval-Budget Dashboard | 0/TBD | Not started | - |

| Milestone | Phases | Status | Shipped |
| --- | --- | --- | --- |
| v0.1 MCP Foundation | 1-7 (44 plans) | ✅ Shipped | 2026-05-30 |
| v0.2 Intelligence Layer | 1-5 (29 plans) | ✅ Shipped | 2026-06-12 |
| v0.3 Identity + Surface | 1-5 (TBD plans) | 🚧 In flight | — |
| v0.4 Workspaces + Memory Types | TBD | 📋 Planned | — |
| v0.5 Connectors + Alerts | TBD | 📋 Planned | — |
| v1.0 Public Launch | TBD | 📋 Planned | — |

## Linear Sync Convention

Per CLAUDE.md "Linear Workflow" — one ENG issue per phase, auto-synced at `/gsd:plan-phase` start (→ Todo) and `/gsd:execute-phase` start (→ In Progress). All v0.3 issues map to the existing Linear milestone "v0.3 — Workspaces + Memory Types" (the Linear milestone name predates the arc shift; contents map to the new Identity + Surface scope).

Between `/gsd:plan-phase` and `/gsd:execute-phase`, Claude creates per-plan Linear issues (one issue per plan, sub-issues per atomic chunk if scope warrants). Lightweight, judged per-plan, no skill needed — per the post-v0.1 workflow tweak captured in STATE.md decision 6.

---

*Per-milestone roadmaps with full phase details for completed milestones live in `.planning/milestones/`.*
*v0.3 roadmap created 2026-06-12 by `/gsd:new-milestone`. Source-of-truth research synthesis: [research/v0.3-SUMMARY.md](research/v0.3-SUMMARY.md). Requirements: [REQUIREMENTS.md](REQUIREMENTS.md).*
