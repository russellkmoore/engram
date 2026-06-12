# Requirements: Engram — v0.3 Identity + Surface

**Defined:** 2026-06-12
**Core Value:** Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.

> **Milestone focus.** v0.3 adds Engram's first human-facing surface on top of the validated MCP backend (v0.1) and intelligence layer (v0.2): a browser sign-in flow that converges with the existing MCP OAuth identity, plus UI surfaces for the data the backend already produces (inbox, memory browser, admin). Wide scope, four surfaces. The connection experience follows the **Linear pattern** — adding the Engram connector in Claude Desktop triggers an in-browser OAuth consent/sign-in that auto-provisions the workspace, with **no terminal**.

> **Locked stack (from `.planning/research/v0.3-SUMMARY.md`):** separate `engram-web` Worker on Workers Static Assets · Hono JSX + HTMX (SSR-primary) · Tailwind v4 standalone CLI + Radix primitives · signed-cookie + KV session · magic-link tokens in KV (single-use, ≤15-min TTL, POST-gate confirm) · outbound email via Cloudflare Email Service `send_email` binding (Resend documented fallback) · browser→data via direct WorkspaceDO RPC (thin JSON BFF), **not** the synthesis-first `EngramResponse` envelope.

## Prerequisites (gate Phase 1 — resolve before auth code)

| # | Prerequisite | Why it gates | Fallback |
|---|--------------|--------------|----------|
| PRE-A | CF Email Service beta access confirmed on Russell's account | Outbound magic-link email | Resend (stable, free tier) |
| PRE-B | A custom domain registered in CF DNS usable as the magic-link `from` sender | `*.workers.dev` may not qualify as a sender domain | Register/verify a domain |
| PRE-C | `@cloudflare/vite-plugin` pinned ≥ 1.6.0 | CVE-2025-59427 leaks `.dev.vars`/`.env` to the dev network | Pin/upgrade before first UI build |
| PRE-D | Claude Desktop's exact OAuth-on-connector-add surface verified empirically | Confirms the Linear-pattern flow lands; informs the consent-screen contract | If it doesn't surface cleanly, fall back to a web-initiated "connect" flow (QR/polling) |

## v1 Requirements (v0.3 scope)

> **Open-core seam discipline (locked 2026-06-12).** `engram-web` is built as the **product surface only** (Apache-2.0) — no marketing, signup funnel, or billing. The commercial layer ships at v1.0 in a separate **private `engram-cloud` repo** that consumes `engram-web`. v0.3 plants the seams so that's an add, not a rewrite: workspace provisioning is a single modular function the auth path calls (v1.0's billing-gated path wraps it), and a `DEPLOYMENT_MODE` (`self-hosted` | `cloud`) notion sits alongside `REGISTRATION_MODE` (AUTH-08) as the gate for future cloud-only concerns. `engram-web` must never depend on commercial code.

### WEB — Frontend Foundation (cross-cutting)

- [ ] **WEB-01**: A new isolated `engram-web` Worker package serves the UI via Workers Static Assets, deployed independently of `engram-mcp-server` (hot-path isolation preserved).
- [ ] **WEB-02**: The app shell is built with Hono JSX + HTMX (SSR-primary), styled with Tailwind v4 (standalone CLI build) and Radix headless primitives — a design-conscious, accessible baseline.
- [ ] **WEB-03**: A browser session is established as a signed cookie (`HttpOnly; Secure; SameSite`) backed by a KV session record (`ENGRAM_SESSIONS`) with TTL; no per-request KV identity lookup on the hot path.
- [ ] **WEB-04**: Authenticated routes are gated server-side (`run_worker_first` for `/auth/*`), and the SPA/static-assets navigation-fallback gotcha that would swallow auth callbacks is handled.

### AUTH — Identity & Consent (the Linear pattern)

- [ ] **AUTH-01**: Adding the Engram connector in Claude Desktop triggers an in-browser OAuth consent/sign-in screen (replacing the v0.1 auto-approve stub in `mcp-server`'s `defaultHandler`) — no terminal, no manual `kv:bootstrap`.
- [ ] **AUTH-02**: A user proves identity via a magic link: enter email → emailed link → **POST-gate confirmation page** → verified. Tokens are single-use, ≤15-min TTL, stored in `ENGRAM_MAGIC_TOKENS` KV; the flow resists email enumeration, open-redirect, and mail-scanner pre-fetch consumption.
- [ ] **AUTH-03**: First successful sign-in **for an authorized email (owner or invited — see AUTH-08/09)** auto-provisions the workspace (replaces manual `kv:bootstrap`), including a workspace-name picker so the workspace gets a human name rather than an email-derived slug.
- [ ] **AUTH-04**: The web magic-link session and the Claude Desktop MCP OAuth `sub` converge on **one** `ENGRAM_IDENTITIES` record (identity-convergence invariant); the design is locked in a written decision document before any auth Worker code is written.
- [ ] **AUTH-05**: A returning user (existing identity record) verifies their link, skips bootstrap, and lands on the dashboard.
- [ ] **AUTH-06**: After connecting, the user sees a success surface with the exact `claude_desktop_config.json` snippet and a **one-click copy** control (prevents the v0.1 config-wipe).
- [ ] **AUTH-07**: Magic-link email is sent via the Cloudflare Email Service `send_email` binding (Resend fallback), from a verified CF-DNS sender domain, with SPF/DKIM/DMARC aligned for deliverability.
- [ ] **AUTH-08**: Registration is **invite-only by default**, controlled by a `REGISTRATION_MODE` config (`"invite"` | `"open"`, default `"invite"`). In invite mode, a magic-link sign-in succeeds only for the owner (AUTH-09) or an email with a pending invite (ADMIN-02); unknown emails are declined without provisioning. `"open"` mode (self-service for the future managed tier / self-hosters) is config-gated and off by default.
- [ ] **AUTH-09**: An `ENGRAM_OWNER_EMAIL` config var implicitly authorizes the operator. The owner's first magic-link sign-in provisions the owner workspace and marks them owner — **fully replacing `kv:bootstrap`** with zero terminal steps after deploy. Solves the fresh-deploy chicken-and-egg without an invite.
- [ ] **AUTH-10**: The login-email endpoint is rate-limited (per-email + per-IP) to bound outbound-email cost and abuse, regardless of registration mode.

### INBOX — Review Surface

- [ ] **INBOX-01**: An inbox list shows unresolved items newest-first, with an unreviewed-count badge in the nav.
- [ ] **INBOX-02**: Each low-confidence item card shows summary, proposed type, memorability score, and source (read from existing `inbox` rows).
- [ ] **INBOX-03**: A user can accept a low-confidence item — promoting it to `blocks` — with edit-before-accept to correct the type and proposed fields.
- [ ] **INBOX-04**: A user can reject a low-confidence item, marking it resolved via the cold-storage/soft-delete path (never hard-discarded — honors the "cardinal sin" rule).
- [ ] **INBOX-05**: Conflicts render as a side-by-side Memory A vs Memory B pair with the human-readable `description` and a severity badge.
- [ ] **INBOX-06**: A user can resolve a conflict via Keep A / Keep B / Keep Both, updating `conflicts.resolved_at` (and `forget()`-ing the rejected memory where applicable).
- [ ] **INBOX-07**: An "All caught up" empty state renders when there are no unresolved inbox items and no unresolved conflicts.
- [ ] **INBOX-08**: A "Why was this flagged?" expandable surface shows the memorability score + source signal behind each item _(differentiator)_.

### BROWSE — Memory Browser (read-only)

- [ ] **BROWSE-01**: A paginated memory list shows type, summary, scope, source, confidence, and created date.
- [ ] **BROWSE-02**: A text search matches over `blocks.content` + `blocks.summary` (SQLite LIKE/FTS5).
- [ ] **BROWSE-03**: The list can be filtered by memory type, scope, date range, and tag.
- [ ] **BROWSE-04**: A detail view shows full content (with summary-vs-raw toggle), the typed properties panel, tags (AI + user), related memories from the `relations` graph, and confidence + source badges.
- [ ] **BROWSE-05**: A user can delete a single memory (mapped to the existing `forget()` path). The browser is otherwise read-only (no inline edit/re-embed in v0.3).
- [ ] **BROWSE-06**: The search bar can run a semantic search against the existing `recall()` Vectorize backend, not just SQLite text match — validating the recall path through a human surface _(differentiator)_.

### ADMIN — Admin & Eval-Budget Dashboard

- [ ] **ADMIN-01**: A connected-users list shows the `ENGRAM_IDENTITIES` records (user_id, workspace_id).
- [ ] **ADMIN-02**: An admin can invite a user by entering their email — sending a magic link with a pre-created workspace slot (reuses the AUTH magic-link flow).
- [ ] **ADMIN-03**: An eval-budget table reports Workers-AI neuron spend over the last 7d/30d (productizes `scripts/eval-budget-summary.mjs`), querying Analytics Engine via a server-side proxy using a scoped `CF_API_TOKEN` secret (never exposed to the browser).
- [ ] **ADMIN-04**: The dashboard shows current-month neuron total + estimated cost and the remaining daily free-tier headroom.
- [ ] **ADMIN-05**: The dashboard shows a per-model neuron breakdown (which models cost the most) _(differentiator)_.
- [ ] **ADMIN-06**: The dashboard renders a spend-over-time chart (daily neuron spend, inline SVG/Canvas — no Grafana) _(differentiator)_.

## Future Requirements (deferred)

### v0.4 (Workspaces + Memory Types — moved from original v0.3)

- **WS-**: Multi-workspace, UserDO/TeamDO/ProjectDO hierarchy, member management.
- **WS-**: Schema-as-data memory type editor (create/edit custom types) — surfaced in the browser at v0.4.
- **WS-**: `reflect` / `relate` / `export` MCP tools.
- **SEED-001**: Cross-layer recall fan-out across UserDO + TeamDO + ProjectDO (the killer-demo substrate) — triggers at v0.4 workspace planning.
- Inbox UI extras deferred from v0.3: inline filters (type/source/score), bulk accept/reject, undo (5-s window).
- Memory browser extras deferred: entity highlight in summary (needs per-block entity storage check), full knowledge-graph visualization, inline edit + re-embed path.
- Notification emails for new inbox items (→ v0.4 daily digest).

### v0.5 (Connectors + Alerts — moved from original v0.4)

- Slack + Drive connectors, daily digest, conflict alerting. **SEED-002** (connector cost/throughput model) triggers here.

## Out of Scope (v0.3)

Explicitly excluded — anti-features confirmed by research, deferred with reasoning.

| Feature | Reason |
|---------|--------|
| Role-based access control (owner/editor/viewer) | `members` exists but v0.3 has 2 users; all are owners — RBAC is v0.4 team work |
| Billing / Stripe | 0 paying customers; record spend now, bill at v1.0 |
| Multi-tenant / cross-workspace admin | Single account; workspaces are DO-isolated — v1.0 managed cloud |
| Audit / security event log | Auditing is theatre at 2 users — v1.0 (SOC2) |
| Inline memory editing in the browser | Editing AI-extracted properties breaks embedding consistency; needs re-embed path — v0.4 |
| Full knowledge-graph visualization | A product in itself (D3/Cytoscape); related-memories list suffices — v0.4 |
| Memory-type schema editor | Belongs with multi-workspace schema-as-data work — v0.4 |
| Export from the UI | `export()` MCP tool is v0.4; Claude can call it now |
| Real-time auto-refresh / WebSocket sync | Explicit project anti-feature; manual refresh suffices |
| AI-suggested merge text for conflicts | Violates "CF AI for grunt work, not Claude" — human writes merged text |
| mcp-remote deep-link auto-open into Claude Desktop | Subsumed by the standard OAuth-on-connector-add flow (AUTH-01); the deep-link hack is high-risk and unnecessary |
| Grafana / AI Gateway dashboard integration | Enormous overhead for 2 users; inline chart suffices |
| Cost-alert threshold; workspace-reset button | Deferred differentiators — revisit if the need is felt |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WEB-01..04 | Phase 1 (Auth + Session Foundation) | Pending |
| AUTH-01..10 | Phase 1 (Auth + Session Foundation) | Pending |
| INBOX-01..08 | Phase 3 (Inbox UI) | Pending |
| BROWSE-01..06 | Phase 4 (Memory Browser) | Pending |
| ADMIN-01..06 | Phase 5 (Admin + Eval-Budget) | Pending |

> **Phase 2 (WorkspaceDO RPC Layer)** has no standalone UI requirements — it builds the data methods (`listInbox`, `acceptInboxItem`, `rejectInboxItem`, `listBlocks`, `getBlock`, `listMembers`, neuron-spend proxy) that Phases 3–5 consume. Its coverage is traced through the surfaces that depend on it.

**Coverage:**
- v0.3 requirements: 34 total (WEB 4, AUTH 10, INBOX 8, BROWSE 6, ADMIN 6)
- Mapped to phases: 34 ✓ (Phase 1: 14 · Phase 3: 8 · Phase 4: 6 · Phase 5: 6; Phase 2 = supporting data layer)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-12 via `/gsd:new-milestone`*
*Last updated: 2026-06-12 after initial definition*
