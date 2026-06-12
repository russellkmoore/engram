# Engram

## What This Is

Engram is an open-source, MCP-native second brain for AI assistants. Where Notion was built for humans to browse, Engram is built for AI to query — every MCP response is pre-processed so Claude receives synthesis, not raw data. Memory is layered (personal → team → project → org), each layer is its own Cloudflare Durable Object with SQLite, and Cloudflare Workers AI handles all the embedding/extraction/scoring work that should never burn Claude tokens.

Russell is the first user. The first integration target is his existing job-search agent. The first shared-workspace user is Devon at Black Magic Consulting, where team memory will cover engagements built with Claude Code / Linear / Astro / Cloudflare Workers (the BMC website is the reference shared-workspace scenario).

## Core Value

**Layered memory that AI queries directly via MCP — personal, team, project, and org memory exposed as the same tool surface, with all preprocessing done by cheaper models so Claude only does reasoning.**

If everything else fails, that single sentence has to remain true. Specifically:

- Anthropic shipping cross-chat memory does not invalidate Engram — Anthropic will not build team/project/org memory.
- The killer differentiator is the **same answer from Slack and from Claude**, both backed by the same layered store.
- Token efficiency is a first-class design constraint, not an optimization.

## Requirements

> **Scope note:** `/gsd:new-project` scopes the first milestone only. v0.1 (MCP Foundation) is in **Active** below. v0.2 through v1.0 are documented under [Milestone Arc](#milestone-arc) and will be scoped via `/gsd:new-milestone` when each milestone begins.

### Validated

_Phase 1: Foundation (2026-05-25):_

- Monorepo scaffolding (npm workspaces, strict TypeScript, ESLint flat, Prettier, Husky+lint-staged, dotfiles, Apache-2.0 LICENSE)
- Per-Worker `wrangler.jsonc` (no root `wrangler.toml`) with compat date 2026-05-22 + nodejs_compat
- `wrangler dev` boots each Worker (mcp-server on 8787, triage-worker on 8788)
- `shared/types` exports `MemoryEvent`, `Memory`, `Entity`, `EngramResponse<T>`, `Conflict` (plus `TimelineEvent`)
- `shared/schema/system-types.ts` exports the 7 system memory types as data
- CLAUDE.md aligned with v0.1 corrections (JSONC, two-DO topology, `McpAgent`, `search` without `format?`, ingest-worker deferred to v0.4)
- FND-08 `wrangler.jsonc` lint blocking `new_classes` DO declarations, wired into CI

_Phase 2-7: v0.1 MCP Foundation (2026-05-30):_

- ✓ Cloudflare Worker MCP server with `remember`, `recall`, `search`, `forget`, `ingest` tools — v0.1 (Phase 3-4)
- ✓ `WorkspaceDO` Durable Object owning per-workspace SQLite database — v0.1 (Phase 2)
- ✓ SQLite schema: `blocks`, `relations`, `tags`, `members`, `memory_types`, `inbox`, `conflicts` — v0.1 (Phase 2)
- ✓ System memory types seeded as data — v0.1 (Phase 2)
- ✓ `MemoryEvent` universal intake primitive — v0.1 (Phase 1 + 6)
- ✓ Triage Worker skeleton consuming `MemoryEvent` from Queue — v0.1 (Phase 5 + 6)
- ✓ Cloudflare Workers AI integration: embeddings, entity extraction, summarization, memorability scoring — v0.1 (Phase 5; classification + hybrid ranking added)
- ✓ Vectorize integration for semantic search backing `recall` and `search` — v0.1 (Phase 5; bge-base-en-v1.5, 768-dim cosine)
- ✓ OAuth-per-workspace auth via Cloudflare Workers OAuth Provider + KV identity (more flexible than JWT-per-workspace originally scoped) — v0.1 (Phase 3 + 7)
- ✓ `EngramResponse` envelope wrapping every MCP tool return — v0.1 (Phase 4)
- ✓ Wrangler deploy succeeds; MCP server reachable from Claude Desktop config via `mcp-remote` bridge — v0.1 (Phase 7)
- ✓ Russell's job-search agent can `remember()` a job posting and `recall()` it later via Claude in a new conversation — v0.1 verified via DEP-03 (Phase 7), substrate proven; Job Scout agent rewire deferred to that repo's own backlog (DEP-04 dropped from v0.1 scope)

_v0.2: Intelligence Layer (shipped 2026-06-12 — see [milestones/v0.2-ROADMAP.md](milestones/v0.2-ROADMAP.md)):_

- ✓ **Conflict-detection wiring** — `detectConflict()` live in triage via `conflict-pipeline.ts` (cosine prefilter → bounded-parallel → inbox), surfaced read-only in `recall()` via `context.conflicts[]`. Pull-based only — v0.2 (Phase 2)
- ✓ **Query expansion + RRF** — `expandQuery()` 2 paraphrases (cosine-gated, anti-HyDE), adaptive fan-out at `top1_cosine < 0.65`, RRF `k=60`, 429 fallback — v0.2 (Phase 3)
- ✓ **Synthesis path activation** — `recall(verbosity=synthesis|both)` with citation-density + cosine-hedging + single-memory rejection; zero-hallucinated-entities gate GREEN; default stays `chunks` — v0.2 (Phase 4)
- ✓ **Hybrid-rank weight tuning** — 625-config sweep, Pareto + overfit + sensitivity gates; winner beats cosine-only by +0.1095 F1; weights frozen in `shared/ai-config` — v0.2 (Phase 2)
- ✓ **bge-reranker** — integrated but **disabled by ablation** (worse than raw cosine); constant landed at weight 0.0, rationale in changelog — v0.2 (Phase 3)
- ✓ **Eval discipline** — corpus 27→100 labeled pairs, tiered vitest + `MAX_AI_CALLS=200`, CI re-embed migration audit, kitchen-sink envelope ≤7.5K-token guard — v0.2 (Phases 1, 5)

### Active (next milestone — unscoped)

**No milestone currently in flight.** v0.2 shipped + archived 2026-06-12 (audit `tech_debt`, no blockers). Scope the next milestone with `/gsd:new-milestone` — the slot is contested between **v0.3 Workspaces + Memory Types** (original arc) and the backlogged **v0.3 Identity + Surface** (consent UI + inbox UI; ROADMAP Phase 999.1). Carry-forward at deploy: EXP-11 latency SLA + INT-05 staging E2E (deploy-gated); SYN-02 passRate restoration (backlog 999.2 + 999.3).

### Out of Scope (v0.1)

- Multi-workspace / shared team / project DOs — deferred to v0.3
- `reflect`, `relate`, `export`, `conflict` MCP tools — deferred to v0.3
- Slack, Drive, or any other connectors — deferred to v0.4
- Daily digest emails, inbox UI — deferred to v0.4
- Public OSS launch, managed hosting, billing, Stripe — deferred to v1.0
- Real-time WebSocket sync — explicit anti-feature for v0.1, revisit later
- Web/desktop UI for browsing memories — Engram is MCP-first; any UI is secondary
- Mobile apps — out of scope entirely until post-v1.0

## Current State

**v0.2 Intelligence Layer shipped + archived 2026-06-12.** The intelligence layer is live on top of v0.1's substrate: hybrid-rank weights tuned against a 100-entry labeled corpus, conflict detection wired into the live triage flow and surfaced read-only in `recall()`, query expansion + RRF with adaptive routing (reranker disabled by its own ablation), and the synthesis path activated with citation/hedging grounding locks (default verbosity stays `chunks`). Milestone audit `tech_debt` — no blockers, all 5 phases Nyquist-compliant. Not yet redeployed: the two deploy-gated confirmations (EXP-11 latency SLA, INT-05 staging E2E) run at the next production deploy. 29 plans, +38.5K LOC across 5 phases (2026-06-03 → 2026-06-11).

**v0.1 MCP Foundation shipped 2026-05-30.** Both Workers (`engram-mcp-server` + `engram-triage-worker`) live on Russell's Cloudflare account. Claude Desktop connected via `mcp-remote` bridge + OAuth + KV-backed identity. Binding acceptance test (DEP-03) PASSED twice: remember in conv A → recall in fresh conv B 9+ hours later returns full structured fields. Triage Worker auto-enrichment demonstrably extracts salary/location/visa/fit-signals from job postings in production.

- **Repo:** [github.com/russellkmoore/engram](https://github.com/russellkmoore/engram) (Apache-2.0)
- **Deployed URLs:** `https://engram-mcp-server.russellkmoore.workers.dev`, `https://engram-triage-worker.russellkmoore.workers.dev` (v0.1 build live; v0.2 code merged, redeploy pending)
- **Single user:** Russell, workspace_id `russell-personal`

## Context

**Origin story.** Russell saw the opportunity while working with Claude and the Cloudflare stack at his day job. Anthropic has been adding memory primitives to Claude but they're not fully fleshed out — and crucially, Anthropic has no incentive to build team/project/org memory. Engram fills that gap. The architecture and tool surface were extracted from an ~hour-long working session with Claude before this `/gsd:new-project` run; that thinking is preserved verbatim in the repo's [CLAUDE.md](../CLAUDE.md) and is the authoritative source of truth for architecture decisions until something here supersedes it.

**Three simultaneous goals (in priority order).**

1. **Personal tool** — Russell uses it daily inside his job-search agent.
2. **Thought leadership / portfolio** — a public, well-built reference implementation of MCP-native layered memory that he can point hiring managers at.
3. **Side-business / OSS** — open core: self-hosted free forever, managed cloud at $5–20/mo.

These do not conflict, but the prioritization matters when scope cuts come up: ship to your own workflow first, polish for show second, monetize third.

**Operating principle (locked in during questioning).** "Do it RIGHT, not FAST." Russell explicitly rejected reshaping milestones around an earlier demo because foundational flaws are more damaging than a late wow-moment. Subsequent scope debates should default to depth over speed.

**Prior thinking captured.** [CLAUDE.md](../CLAUDE.md) contains the full architecture spec: tech stack, repo structure, DO hierarchy, SQLite schema, MemoryEvent ingest pipeline, MCP tool signatures, response envelope, connector interface, naming conventions, and "what goes where" routing rules. The roadmapper should treat that file as the architectural baseline. Where this PROJECT.md and CLAUDE.md disagree, this file wins for *what to build when*; CLAUDE.md wins for *how the pieces are shaped*.

**Killer demo (v0.4 north star, not v0.1).** Ask Engram a question in Slack, get the same answer Claude gives — proving that one MCP tool call traverses both personal and team memory layers. Variant: Engram detects a conflict between two memories and posts it to Slack proactively. This is the moment that has to land for the portfolio/thought-leadership goal; everything before it is plumbing.

## Constraints

- **Tech stack**: Cloudflare-native end to end (Workers, Durable Objects, Vectorize, Workers AI, Queues, R2, KV) — chosen because Russell knows it deeply, costs scale to zero, and a single platform avoids glue infra. Not negotiable for v0.1–v1.0.
- **Runtime**: Wrangler + TypeScript. npm workspaces monorepo (see [packages layout in CLAUDE.md](../CLAUDE.md#repository-structure)).
- **Interface**: MCP-first. Any human UI is a strictly secondary convenience layer and ships after the MCP surface is validated.
- **Token budget**: Every MCP response must minimize Claude tokens by pre-processing. CF AI does embeddings, chunking, extraction, summarization, dedup, conflict detection, query expansion, type inference. Claude does reasoning and user interaction. See "What Goes Where" in CLAUDE.md.
- **Tool count**: MCP surface capped at 9 tools across the full v1.0 surface — cognitive overhead constraint for Claude.
- **Auth (v0.1)**: JWT per workspace, validated at Worker, trusted by DO. Single user for v0.1 means only Russell's JWT exists.
- **Workspace isolation**: Project DOs are fully isolated (own DO instance), not partitions of TeamDO. Enables clean archive/transfer/delete with no cross-workspace coordination.
- **Memory types**: Schema-as-data — stored in the `memory_types` table, never as TypeScript classes. Enables user/community extensibility without redeploy.
- **Timeline**: v0.1 by 2026-06-07 (~2 weeks). v1.0 public launch by 2026-09-01 (~15 weeks). Russell explicitly chose depth-over-speed; treat these as aspirational, not hard deadlines.
- **Cost**: Cloudflare's pay-per-use model is what makes the business viable. Any service we'd reach for outside CF needs a strong justification.

## Project Tracking

### Linear Sync Convention

| | |
|---|---|
| **Workspace** | `blackmagicconsulting` |
| **Project** | Engram |
| **Project ID** | `a0f0e1f5-1cbc-48de-8f7a-7c8bbafc25b2` |
| **Project URL** | https://linear.app/blackmagicconsulting/project/engram-3cebc9097d0e |
| **Team** | Engram (key `ENG`) |
| **Team ID** | `1b736009-b518-4900-98f3-f5011428d26a` |
| **Lead** | russell@justblackmagic.com |

**Sync rule: Phase = Linear Issue.** GSD has no native Linear integration; Claude wires it manually inside GSD commands without per-issue confirmation. Mappings:

| GSD event | Linear action |
|---|---|
| `/gsd:plan-phase N` produces PLAN.md | Create issue in team `ENG`, link to milestone `vX.Y — Name`, state `Todo`, description = phase goal + plan summary + link to PLAN.md path |
| `/gsd:execute-phase N` begins | Update issue state → `In Progress` |
| `/gsd:execute-phase N` completes (verification passes) | Update issue state → `Done` (or `In Review` if a PR will be opened) |
| `/gsd:ship` creates PR | Append PR link to issue, transition to `In Review` until PR merges |
| Phase blocker logged | Add comment to issue, leave state as `In Progress` |
| `/gsd:complete-milestone` runs | Verify all milestone issues are `Done`; post a Linear comment with milestone summary |
| New GSD milestone scoped | Existing Linear milestone already present (v0.1 → v1.0 are pre-created); ensure phases attach to the correct one by name |

**Existing Linear milestones (all 0% — sync target):**

| Linear Milestone | Target | Maps to GSD milestone |
|---|---|---|
| v0.1 — MCP Foundation | 2026-06-07 | Current (this PROJECT.md) |
| v0.2 — Intelligence Layer | 2026-06-21 | Future |
| v0.3 — Workspaces + Memory Types | 2026-07-12 | Future |
| v0.4 — Connectors + Alerts | 2026-08-02 | Future |
| v1.0 — Public Launch | 2026-09-01 | Future |

A duplicate of this rule lives in [CLAUDE.md](../CLAUDE.md) so any future Claude session — including ones that bypass `/gsd:` — honors it.

## Milestone Arc

This is the full v0.1 → v1.0 arc carried over from CLAUDE.md. Only **v0.1** is in Active above; subsequent milestones get their own `/gsd:new-milestone` scoping pass.

| Milestone | Target | Scope |
|---|---|---|
| **v0.1 MCP Foundation** | 2026-06-07 | DO + SQLite schema, core MCP tools (`remember`, `recall`, `search`, `forget`, `ingest`), single user, no Vectorize/AI yet — or minimal stubs so the contract is right. |
| **v0.2 Intelligence Layer** | 2026-06-21 | Vectorize, CF Workers AI, full ingest pipeline (chunk, embed, score, store), conflict detection at write time. |
| **v0.3 Workspaces + Types** | 2026-07-12 | Multi-workspace, UserDO/TeamDO/ProjectDO hierarchy, member management, schema-as-data memory types, `reflect`/`relate`/`export` tools. |
| **v0.4 Connectors + Alerts** | 2026-08-02 | Slack + Drive connectors, daily digest, agentic inbox UI, conflict alerting. **Killer demo lands here.** |
| **v1.0 Public Launch** | 2026-09-01 | Managed hosting, Stripe billing, OAuth, admin UI, connector registry on R2, community memory-type packs, OSS launch + HN post. |

## Key Decisions

| Decision | Rationale | Outcome |
|---|---|---|
| Durable Objects per workspace (not D1) | Workspace isolation by default, clean archive/transfer/delete, no sharding complexity | — Pending v0.1 |
| Project DOs fully isolated, not partitions of TeamDO | Clean project lifecycle, zero cross-project data leakage | — Pending v0.3 |
| Schema-as-data memory types (not TS classes) | User and community extensibility without redeploy | — Pending v0.1 seeding |
| MemoryEvent as universal intake primitive | One pipeline serves MCP, connectors, and webhooks | — Pending v0.1 |
| CF AI for all grunt work | Token budget is a hard design constraint; Claude must not embed or extract | ✓ Good — v0.2: embeddings, query expansion, synthesis, conflict detection, memorability all on Workers AI; Claude only reasons |
| MCP tool surface capped at 9 tools | Cognitive overhead — too many tools dilute Claude's tool selection | — Pending v1.0 |
| Inbox triage layer for low-confidence captures | Avoid auto-storing noise; preserve human-in-the-loop for ambiguity | ✓ Good — v0.2: conflict contradictions written to `inbox` (`proposed_type="conflict"`), surfaced read-only; no inbox UI yet (v0.4) |
| Progressive enrichment (phase 1 immediate, phase 2/3 via Queue) | Claude never waits on the full pipeline | ✓ Good — v0.2: conflict scan runs via `ctx.waitUntil`, never blocks ingest; `remember()` still returns ~430ms p50 |
| Hybrid recall ranking + reranker-or-cosine | Vector-only ranking loses recency/type/scope signal; reranker validated by ablation, not assumed | ✓ Good — v0.2: sweep-tuned weights frozen; bge-reranker ablation said "worse than cosine" → shipped disabled (the ablation earned its keep) |
| Eval-cost budget guard (`MAX_AI_CALLS=200`) | 4 features × eval suites compound into CI bill-shock without a hard ceiling | ✓ Good — v0.2: budget guard forced disciplined serialization (RNK vs CON, EXP-07 vs EXP-08 separate sessions) |
| Open core (self-hosted free, managed $5–20/mo) | Aligns OSS legitimacy with business viability | — Pending v1.0 |
| Keep CLAUDE.md milestones, don't reshape around the v0.4 demo | Russell explicitly chose depth over speed: shipping flawed foundations damages thought-leadership goal more than a delayed wow-moment | ✓ Locked 2026-05-24 |
| Linear sync = Phase = Issue, auto-sync, milestones already exist | One issue per phase keeps board readable for solo + Devon, milestones pre-seeded match CLAUDE.md dates | ✓ Locked 2026-05-24 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted
6. **Linear**: confirm the phase's issue is `Done` (or `In Review` if PR open)

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (Russell's daily use? Devon onboarded? what feedback?)
5. Move the next milestone from "Milestone Arc" into Active and re-scope via `/gsd:new-milestone`
6. **Linear**: post milestone summary comment on the Linear milestone

---
_Last updated: 2026-06-12 — milestone v0.2 (Intelligence Layer) shipped + archived via `/gsd:complete-milestone`. All 4 net-new features validated (conflict wiring, query expansion + RRF, synthesis activation, hybrid-rank tuning); bge-reranker disabled by ablation. Audit `tech_debt` (no blockers); all 5 phases Nyquist-compliant. Deferred at close: EXP-11 + INT-05 (deploy-gated), SYN-02 (advisory override), SEED-001/002 (→ v0.4). Next: `/gsd:new-milestone` to scope v0.3._
