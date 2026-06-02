# Phase 1: Foundation (Wave 0) — Research

**Researched:** 2026-06-02
**Domain:** Test infrastructure, CI gates, eval corpus methodology, embedding-version migration audit, routing tracker scaffold
**Confidence:** HIGH on PRE-01 audit pattern; HIGH on PRE-02 tier topology; HIGH on PRE-05 tracker shape (we are extending an existing artifact); MEDIUM on PRE-03 corpus methodology (Russell's labeling is the lever, schema is mechanical); MEDIUM on PRE-04 (no industry standard — invented locally)

> **Phase character (per CLAUDE.md routing heuristic):** This is a **process/foundation phase**, NOT a content-generation phase. The deliverables are: (a) one CI script + assertion, (b) vitest config edits + tier wiring, (c) a labeled JSON corpus (human labeling, not codegen), (d) two planning docs. Expected cf-code-assist routing mix: **<10%** — most diffs are <50 lines and carry cross-file invariants (vitest projects + wrangler bindings + CI workflows), or are pure prose. The Phase 5 tracker pattern still applies because PRE-05's whole job is to scaffold the next-milestone tracker, but Phase 1's OWN rows will mostly be `claude` with `N/N/Y` or `Y/N/Y` checklists.

---

## Summary

Phase 1 closes the five prerequisites that gate v0.2: a catastrophic-severity migration audit (PRE-01), a tiered vitest topology with a hard neuron-budget guard (PRE-02), a 5× expansion of the eval corpus from 47 → 100+ labeled pairs (PRE-03 — Russell's manual labeling is the critical path), an integration matrix that enumerates every cross-feature combination v0.2 must cover before close (PRE-04), and a scaffolded cf-code-assist routing tracker that mirrors the Phase 4 / Phase 5 v0.1 pattern (PRE-05).

The migration audit is the single most dangerous item in the milestone. ENG-25 (2026-06-02) swapped `bge-base-en-v1.5` (768d) → `qwen3-embedding-0.6b` (1024d) in place. The Vectorize index was deleted and recreated, so **dimension mixing is physically impossible** at the index layer — but SQLite rows still carry `embedding_model` / `embedding_version` stamps from `insertBlock`. Any v1-stamped row that survived the cutover is a silently-corrupted result waiting to surface as a recall miss. PRE-01's assertion is the only structural defense.

PRE-02 builds on the existing per-package vitest topology (already multi-project in `mcp-server` and `workspace-do` per Phase 5 `lint-no-direct-vectorize.test.ts`). We add a third project tier — `eval` — alongside `workerd` (unit/integration) and `lint-node` (Node-pool), gated by `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars. The `MAX_AI_CALLS=200/run` ceiling is enforced in-test via a per-suite counter that wraps `env.AI.run` and `env.VECTORIZE.query` calls.

PRE-03 is the largest gate by impact. Current corpus is 47 labeled entries (20 in `reference-corpus.json` + 27 in `real-corpus.json`). Target: ≥100 entries, 70/30 split → 70 train + 30 validate. Schema is already established by ENG-20/ENG-25; the additive labeling burden is ~50 net new queries + intended block IDs. Russell's manual labeling time is the gating critical path (3–4 hours).

PRE-04 invents an integration matrix locally — no industry-standard format exists. The matrix shape is `rows = features`, `cols = combinations`, `cells = test-coverage status`, designed to drive Phase 5's `INT-04` "zero untested cross-feature combinations" close-out criterion.

PRE-05 is the most prescriptive: extend the **existing** Phase 5 `05-CF-CODE-ASSIST-USAGE.md` tracker shape (Routing Log table + 3-question checklist + End-of-Phase Summary) into a new `01-CF-CODE-ASSIST-USAGE.md` for v0.2's Phase 1, and add a milestone-rollup pointer so each subsequent phase (2..5) scaffolds its own tracker on entry without re-inventing the format.

**Primary recommendation:** Sequence the plans `PRE-01 → PRE-02 → PRE-05 → PRE-04 → PRE-03`. The migration audit is cheap and gates EVERYTHING downstream; tier topology unlocks the eval-pool that PRE-03 will exercise; the routing tracker must exist before any other code-producing task runs; the integration matrix is pure prose that Russell drafts in parallel; corpus labeling is the calendared 3–4 hour blocker that everything else queues behind.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Embedding-version migration audit (PRE-01) | CI / GitHub Actions | Database / WorkspaceDO SQLite | SQL count assertion is data-tier; the gate that REJECTS the PR lives in CI. Two-tier: WorkspaceDO exposes the count via an admin RPC; CI workflow invokes it and fails on non-zero. |
| Tiered vitest config (PRE-02) | Test infrastructure (vitest projects) | Cloudflare bindings (workerd pool) | Vitest configures the projects; workerd pool resolves AI/Vectorize bindings against `wrangler.test.jsonc`. Env-var gates fan out to the GitHub Actions runner. |
| MAX_AI_CALLS=200 budget guard (PRE-02) | Test runtime (in-test counter) | Workers Analytics Engine (post-hoc verification) | In-test counter throws when exceeded — fails the suite. Analytics Engine is the audit trail Russell reads at week-end. |
| Eval corpus expansion (PRE-03) | Data / planning artifact (`.planning/evals/recall-corpus.json`) | — | The corpus is data, not code. It lives outside `packages/*/src/__tests__/evals/fixtures/` so it can serve mcp-server + triage-worker + future workers without duplication. |
| Integration matrix (PRE-04) | Planning doc (`.planning/research/v0.2-INTEGRATION-MATRIX.md`) | — | Pure planning artifact. Drives Phase 5 INT-04 close. |
| CF code-assist routing tracker (PRE-05) | Phase-local artifact (`.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md`) | — | Mirrors the established pattern from v0.1 Phase 4 / Phase 5. Scoped to one phase per file. |

---

<user_constraints>
## User Constraints (from REQUIREMENTS.md / ROADMAP.md / STATE.md)

> No CONTEXT.md exists for Phase 1 (we are pre-discuss). The "user constraints" below are extracted from REQUIREMENTS.md, ROADMAP.md, STATE.md, and CLAUDE.md as locked decisions that constrain this phase.

### Locked Decisions (from project documents)

1. **Embedding model is locked to `@cf/qwen/qwen3-embedding-0.6b` at 1024d cosine** — ENG-25 cutover (STATE.md decision 3). No model swap inside v0.2.
2. **MIN_COSINE_THRESHOLD = 0.6** — partial tune from ENG-25 (STATE.md decision 4). Full sweep is Phase 2 (RNK-01..07), NOT Phase 1.
3. **No new Workers, no new MCP tools, no new memory types** — v0.2 scope (REQUIREMENTS.md "Out of Scope"). Phase 1's deliverables MUST NOT introduce any new package or top-level binding.
4. **Inbox-only conflict surfacing — never proactive notification** (STATE.md decision 5; CON-08). Phase 1 doesn't ship conflict code but the integration matrix (PRE-04) must reflect this constraint.
5. **`verbosity` default stays `"chunks"`** (SYN-08; v0.2-SUMMARY TL;DR #5). Phase 1's matrix must NOT plan for the default flip.
6. **No new npm dependencies** (v0.2-SUMMARY convergence #5). Phase 1's deliverables MUST NOT install anything beyond what's already in `package-lock.json`.
7. **Existing v0.1 envelope contract is frozen** — INT-04 / Phase 4 D-07. PRE-04 matrix must respect this.
8. **Linear sync: one ENG issue per phase, auto-synced at `/gsd:plan-phase` start and `/gsd:execute-phase` start** (CLAUDE.md "Linear Workflow"). Phase 1 ships an ENG issue at plan-phase kickoff.

### Claude's Discretion

- Exact directory structure for the eval corpus (`.planning/evals/recall-corpus.json` vs. `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus.json` vs. a new monorepo `evals/` workspace) — REQUIREMENTS.md says `.planning/evals/recall-corpus.json` so Claude defaults there, but the executor may relocate if a cross-package test-import constraint surfaces.
- Whether the integration matrix is a markdown table, a JSON file, or both — REQUIREMENTS.md says markdown.
- Exact GitHub Actions workflow YAML for the PR check that asserts PRE-01 returns 0 — discretion on whether this is a new workflow file or an addition to an existing `ci.yml`.
- Whether the migration audit script lives in `scripts/` (alongside `setup-vectorize.sh`) or in a new `scripts/audit/` subdirectory.
- Whether the `MAX_AI_CALLS=200` counter is a global singleton vs. a per-suite hook (planner picks based on which is simpler given the existing `cloudflareTest` plugin lifecycle).

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Building any feature code (RNK, CON, EXP, SYN, INT requirements all defer to Phases 2..5).
- Re-running ENG-16's `detectConflict()` 50-pair eval (that's CON-01, owned by Phase 2).
- Generating expansion variants / reranker calls (Phase 3).
- Any synthesis-eval scaffolding beyond reserving `expected_synthesis` capture in the corpus schema (PRE-03 ships the corpus shape ready for SYN-01 to augment).
- Promptfoo configuration changes beyond noting the existing `evals:promptfoo` script wiring (Phase 4 SYN-01 owns promptfoo).
- Wiring a new `engram-conflicts` Queue or any infra change (deferred to v0.4+ per REQUIREMENTS.md "Out of Scope").

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRE-01 | Migration audit: `SELECT COUNT(*) FROM blocks WHERE embedding_version < 2 OR embedding_model != '@cf/qwen/qwen3-embedding-0.6b'` returns 0 across every workspace; assertion runs as CI step. | §"Migration Audit Architecture" — admin RPC on WorkspaceDO + CI script that enumerates workspaces via DO Namespace List API + asserts zero. Cardinal-sin defense per INT-1. |
| PRE-02 | Tiered vitest configuration: `unit` / `integration` / `eval` tiers. Integration + eval expose CF API token + account ID. Eval guards `MAX_AI_CALLS ≤ 200`/run with daily neuron-consumption summary. | §"Vitest Tier Topology" — extend existing multi-project pattern (mcp-server, workspace-do) with third `eval` project. Counter mechanism via `vi.spyOn(env.AI, "run")` global hook. Analytics Engine query via Cloudflare GraphQL Analytics API. |
| PRE-03 | `.planning/evals/recall-corpus.json` contains ≥100 labeled `query → expected_top_3_block_ids` pairs with 70/30 train/validate split. Sources: v0.1 production recall logs + ingested Notion/Drive snippets. | §"Eval Corpus Methodology" — adopts MTEB/BEIR qrels-equivalent shape adapted to the existing `reference-corpus.json` schema. Stratified split by `bucket`. Russell's labeling is the critical path. |
| PRE-04 | `.planning/research/v0.2-INTEGRATION-MATRIX.md` enumerates cross-feature combinations that must have end-to-end coverage by milestone close. | §"Integration Matrix Design" — feature × feature grid with cells noting `tested-by-plan / pending / out-of-scope`. Drives Phase 5 INT-04 close. |
| PRE-05 | `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` scaffolded with 3-question checklist columns. Every v0.2 code-producing task appends a row. | §"CF-Code-Assist Tracker Scaffold" — duplicate the existing Phase 5 v0.1 tracker shape (verified against `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`). |

</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

Extracted as directives the planner must verify compliance against:

1. **Two-Worker split — extends existing, no new Workers.** Any Phase 1 audit RPC lives on `WorkspaceDO` (mcp-server package) or as a new triage-worker helper, NOT a new package.
2. **Schema-as-data memory types — no hardcoded schema in code.** Phase 1's eval corpus must NOT introduce hardcoded memory_type fields; reference existing types from `shared/schema/`.
3. **9-tool MCP surface cap — no new tools in v0.2.** Phase 1 audit invokes via admin RPC (DO method), NOT via a new MCP tool.
4. **"If a task can be done by Cloudflare AI, it must not be done by Claude."** PRE-03 corpus labeling has no CF-AI alternative (it's domain-expert ground truth). PRE-04 matrix is meta-planning, also no CF-AI alternative. PRE-01/02/05 are config + script work where CF-AI also doesn't apply.
5. **"Engram should return insights, not data. Claude should reason, not process."** Not applicable to Phase 1 (no MCP responses ship in this phase).
6. **Phase 5 cf-code-assist routing tracker pattern is the canonical model.** PRE-05 mirrors `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` shape verbatim. Stop logging when `/gsd:verify-work 1` passes (per phase, not per milestone).
7. **Linear ENG issue per phase** — one issue created at `/gsd:plan-phase 1` start, transitioned `Todo → In Progress` at execute-phase start.

---

## Standard Stack

### Core (already in repo — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | ^3.x (per `node_modules`) | Test runner | Already standard across all three packages. [CITED: packages/mcp-server/vitest.config.ts] |
| `@cloudflare/vitest-pool-workers` | (transitive) | Workers-runtime test pool | Ships every test inside real workerd. Already used in `mcp-server`, `triage-worker`, `workspace-do`. [CITED: packages/mcp-server/vitest.config.ts:32] |
| `wrangler` | ^4.94.0 | DO Namespace List API CLI, Vectorize ops | Already in `devDependencies` (root `package.json:51`). [VERIFIED: package.json:51] |
| `gpt-tokenizer` | ^3.4.0 | (existing) token counting for envelope budget tests | Already in `mcp-server` via Phase 4 D-09. [CITED: 04-CF-CODE-ASSIST-USAGE.md row 04-01-02] |
| `@modelcontextprotocol/sdk` | (existing) | MCP server SDK | Already used. [CITED: tools.ts:69] |

### Supporting (no installs needed; native APIs)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cloudflare:test` `runInDurableObject` | (workerd built-in) | Direct DO instance access for migration audit unit test | When PRE-01 needs to seed a v1-stamped block and assert the audit catches it. [CITED: packages/workspace-do/vitest.config.ts:17-32] |
| `cloudflare:workers` `env` import | (workerd built-in) | Bindings access inside eval tests | Already standard pattern. [CITED: recall-f1.eval.test.ts:20] |
| Cloudflare GraphQL Analytics API | account-level `aiInferenceAdaptive` dataset | Neuron-consumption query for PRE-02 daily summary | Account-level query with `accountTag` filter. [CITED: developers.cloudflare.com/analytics/graphql-api/] |
| Cloudflare DO Namespace List API | `GET /accounts/$ACCOUNT_ID/workers/durable_objects/namespaces/$ID/objects` | Enumerate workspaces for PRE-01 cross-workspace audit | Standard Cloudflare REST endpoint. Paginated. [CITED: developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `eval` vitest project | Inline `describe.skipIf(!env.CLOUDFLARE_API_TOKEN, ...)` per test | Inline-skipIf doesn't enforce budget guard cleanly; project tier gives one place to wrap `env.AI.run` with the counter. |
| Cloudflare GraphQL for neuron summary | Workers Analytics Engine `writeDataPoint` in-flight + post-hoc dashboard | Already partly in place (triage-worker writes events); GraphQL is the **read** path. Both stack. |
| DO Namespace List API for cross-workspace audit | Maintain a manifest of workspace IDs in KV | KV manifest requires drift discipline (every new workspace bumps the manifest). List API is source-of-truth — paginates the actual namespace. |
| Custom JSON corpus shape | Adopt BEIR qrels format verbatim | BEIR's three-file (corpus.jsonl, queries.jsonl, qrels.tsv) shape is heavyweight for a 100-entry single-workspace eval. Extend the existing single-file `reference-corpus.json` shape with `train_split`/`validate_split` fields. |
| New `engram-conflicts` Queue | (none) | Out of scope per REQUIREMENTS.md — not Phase 1's job. |

**Installation:**

```bash
# NO npm installs in Phase 1 — v0.2 scope-locks "no new dependencies".
# The stack above is entirely existing tooling.
```

**Version verification (already in repo):**

```bash
npm ls vitest                                  # already pinned via @cloudflare/vitest-pool-workers
npm view @cloudflare/vitest-pool-workers       # verify latest known-good if questioned
```

---

## Package Legitimacy Audit

**Skipped — Phase 1 installs zero packages.** REQUIREMENTS.md `Out of Scope` and v0.2-SUMMARY convergence #5 both lock "no new npm dependencies" for v0.2. PRE-01..05 use only tooling already pinned in `package-lock.json`. If a downstream phase (2..5) needs new packages, slopcheck applies there.

---

## Architecture Patterns

### System Architecture Diagram

```
                            ┌────────────────────────────────┐
                            │   /gsd:plan-phase 1            │
                            │   creates ENG-XX Linear issue  │
                            └──────────────┬─────────────────┘
                                           │
                                           ▼
                            ┌────────────────────────────────────────┐
                            │   .planning/phases/01-foundation-wave-0/│
                            │     01-PLAN.md   (planner output)      │
                            │     01-CONTEXT.md (discuss output)     │
                            │     01-RESEARCH.md (this file)         │
                            │     01-CF-CODE-ASSIST-USAGE.md (PRE-05)│
                            └──────────────┬─────────────────────────┘
                                           │
                                           ▼
                ┌──────────────────────────────────────────────────────────────────┐
                │                  PRE-01 — Migration Audit                        │
                │                                                                  │
                │  ┌─────────────────┐    list      ┌──────────────────────────┐   │
                │  │  CI workflow    │ ─────────▶  │ Cloudflare DO Namespace  │   │
                │  │  (GitHub Action)│             │ List API                 │   │
                │  └─────────────────┘             └────────────┬─────────────┘   │
                │           │                                   │ workspace IDs   │
                │           │                                   ▼                 │
                │           │             ┌────────────────────────────────────┐  │
                │           ▼             │  For each workspace:               │  │
                │  ┌─────────────────┐    │   ┌──────────────────────────────┐ │  │
                │  │ scripts/audit/  │ ──▶│   │ stub.assertAllBlocksAtV2()   │ │  │
                │  │ embedding-      │    │   │  → SQL COUNT(*) WHERE        │ │  │
                │  │ version-audit.ts│    │   │    embedding_version < 2 OR  │ │  │
                │  └─────────────────┘    │   │    embedding_model != qwen3  │ │  │
                │           │             │   └──────────┬───────────────────┘ │  │
                │           │             │              │ count               │  │
                │           │             │              ▼                     │  │
                │           │             │     if count > 0: process exits 1  │  │
                │           │             └────────────────────────────────────┘  │
                │           ▼                                                     │
                │  fail PR check on any non-zero count                            │
                └──────────────────────────────────────────────────────────────────┘

                ┌──────────────────────────────────────────────────────────────────┐
                │                  PRE-02 — Tiered Vitest                          │
                │                                                                  │
                │  vitest.config.ts (per-package)                                  │
                │   ├── project: workerd     (unit + integration; existing)        │
                │   ├── project: lint-node   (node-pool lint gates; existing)      │
                │   └── project: eval        (NEW — gated on CF_API_TOKEN +        │
                │                            CF_ACCOUNT_ID; wraps env.AI.run +     │
                │                            env.VECTORIZE.query with budget       │
                │                            counter; throws on MAX_AI_CALLS=200)  │
                │                                                                  │
                │  scripts/eval-budget-summary.mjs                                 │
                │   └── reads Workers Analytics Engine via GraphQL Analytics API   │
                │       (account-level, aiInferenceAdaptive dataset) → daily       │
                │       neuron-consumption report                                  │
                └──────────────────────────────────────────────────────────────────┘

                ┌──────────────────────────────────────────────────────────────────┐
                │                  PRE-03 — Eval Corpus Expansion                  │
                │                                                                  │
                │  Sources                                                         │
                │   ├── v0.1 production recall logs (Workers Analytics Engine      │
                │   │     query for past 30 days of recall() inputs)               │
                │   ├── packages/mcp-server/.../reference-corpus.json (20 entries) │
                │   ├── packages/mcp-server/.../real-corpus.json      (27 entries) │
                │   └── Russell's Notion/Drive snippets already in Engram          │
                │                                                                  │
                │  Authoring                                                       │
                │   └── Russell labels each query with expected_top_3_block_ids    │
                │       (3-4 hours manual; critical path)                          │
                │                                                                  │
                │  Output                                                          │
                │   └── .planning/evals/recall-corpus.json                         │
                │       ├── header: corpus_version, sweep_date, total, train/      │
                │       │   validate ratios, source breakdown                      │
                │       └── entries[]: { id, bucket, query, expected_top_3,        │
                │           memory_type, split, labeled_by, labeled_at }           │
                └──────────────────────────────────────────────────────────────────┘

                ┌──────────────────────────────────────────────────────────────────┐
                │                  PRE-04 — Integration Matrix                     │
                │                                                                  │
                │  .planning/research/v0.2-INTEGRATION-MATRIX.md                   │
                │   └── rows: v0.2 features (RNK / CON / EXP / SYN)                │
                │       cols: feature pairings + the kitchen-sink case             │
                │       cells: { plan_id, test_file, status }                      │
                │       status: tested / pending / out-of-scope                    │
                │                                                                  │
                │  Drives Phase 5 INT-04 close-out:                                │
                │   "zero untested cross-feature combinations"                     │
                └──────────────────────────────────────────────────────────────────┘

                ┌──────────────────────────────────────────────────────────────────┐
                │                  PRE-05 — CF-Code-Assist Tracker                 │
                │                                                                  │
                │  .planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md│
                │   ├── header (Phase 1 scope, stop trigger)                       │
                │   ├── instructions (when to append rows)                         │
                │   ├── 3-question checklist (Q1: cross-file synthesis? Q2: >50    │
                │   │   lines? Q3: stable template?)                               │
                │   ├── routing log table (Task / Artifact / Route /               │
                │   │   Checklist Q1/Q2/Q3 / Reason / approx-tokens-saved)         │
                │   └── End-of-Phase Summary (filled after /gsd:verify-work 1)     │
                │                                                                  │
                │  Subsequent phases scaffold their own NN-CF-CODE-ASSIST-USAGE.md │
                │  file at /gsd:plan-phase N start (carry-forward in plan-checker) │
                └──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions only — Phase 1 doesn't touch packages/*)

```
.planning/
├── evals/
│   └── recall-corpus.json          # NEW — PRE-03 ≥100 labeled pairs
├── research/
│   ├── v0.2-INTEGRATION-MATRIX.md  # NEW — PRE-04
│   └── v0.2-SUMMARY.md             # existing (synthesis input)
└── phases/
    └── 01-foundation-wave-0/
        ├── 01-PLAN.md
        ├── 01-CONTEXT.md
        ├── 01-RESEARCH.md          # this file
        └── 01-CF-CODE-ASSIST-USAGE.md  # NEW — PRE-05 scaffold

scripts/
├── audit/                           # NEW (or scripts/embedding-version-audit.ts at root)
│   └── embedding-version-audit.ts  # NEW — PRE-01 invoked from CI
└── eval-budget-summary.mjs         # NEW — PRE-02 GraphQL Analytics API caller

.github/
└── workflows/
    └── ci.yml                       # EXTEND — add embedding-version-audit job + eval-tier-gate
```

### Pattern 1: Cross-Workspace Migration Audit (PRE-01)

**What:** A two-layer check — admin RPC on `WorkspaceDO` performs the SQL count for one workspace; CI script enumerates workspaces via the Cloudflare API and aggregates.

**When to use:** Any time stored data (SQLite, KV, Vectorize stamps) carries a version/model attribute that downstream code assumes is monotonic.

**Example:**
```typescript
// Source: scripts/audit/embedding-version-audit.ts (NEW — Phase 1 PRE-01)
//
// Verifies the catastrophic-severity v0.2 INT-1 gate:
//   SELECT COUNT(*) FROM blocks
//   WHERE embedding_version < 2 OR embedding_model != '@cf/qwen/qwen3-embedding-0.6b'
// returns 0 across EVERY workspace.

import { EMBEDDING_MODEL, EMBEDDING_DIMS } from "@engram/ai-config";

// Reads CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID + WORKSPACE_NAMESPACE_ID from env.
// Calls the Cloudflare REST API to list all DO instances in the WorkspaceDO namespace.
// For each workspace ID, invokes a new WorkspaceDO admin RPC `assertAllBlocksAtV2()`.
// Aggregates counts; exits 1 on any non-zero, prints summary table.

async function listWorkspaces(): Promise<string[]> {
  // See: developers.cloudflare.com/api/resources/durable_objects/subresources/
  //      namespaces/subresources/objects/methods/list/
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/durable_objects/namespaces/${NS_ID}/objects`;
  // Paginated via `cursor` query param; loop until result_info.cursor is null.
}

// And on the WorkspaceDO class (NEW admin RPC):
async assertAllBlocksAtV2(): Promise<{ workspace_id: string; count_stale: number }> {
  const result = this.ctx.storage.sql.exec(
    "SELECT COUNT(*) AS n FROM blocks WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?",
    EMBEDDING_MODEL,
  ).one();
  return { workspace_id: this.workspace_id, count_stale: result.n as number };
}
```

**Critical implementation notes:**
- Use `IS NULL OR embedding_version < 2` — Phase 2's `insertBlock` writes NULL until `stampEmbedding` lands (verified in `queries.ts:323`). Any block whose triage-worker enrichment failed BEFORE `stampEmbedding` ran would have NULL stamps. The audit must catch this case.
- The admin RPC is NEW. It is invoked from the CI script, not from any MCP tool. No new MCP surface area.
- For local dev: the script can fall back to `wrangler dev` + an in-process call when `CLOUDFLARE_API_TOKEN` is absent (so contributors can self-check without API access). CI uses the real API path.

### Pattern 2: Tiered Vitest with Eval Budget Guard (PRE-02)

**What:** Extend the existing multi-project `vitest.config.ts` shape (already used in `mcp-server` and `workspace-do`) with a third project `eval` that is gated on env vars AND wraps `env.AI.run` / `env.VECTORIZE.query` with a budget counter.

**When to use:** Any test tier where cost-of-execution must be bounded server-side, not just by skipIf gating.

**Example:**
```typescript
// Source: packages/mcp-server/vitest.config.ts (EXTEND — Phase 1 PRE-02)
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const hasEvalCreds =
  process.env.CLOUDFLARE_API_TOKEN !== undefined &&
  process.env.CLOUDFLARE_ACCOUNT_ID !== undefined;

export default defineConfig({
  test: {
    projects: [
      // existing workerd project (unit + integration tests)
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            "src/__tests__/lint-no-direct-vectorize.test.ts",
            "src/__tests__/**/*.eval.test.ts",   // NEW — eval tier is separate project
          ],
        },
      },
      // existing lint-node project (unchanged)
      { /* ... */ },
      // NEW eval project — only runs when CF creds present
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "eval",
          include: ["src/__tests__/**/*.eval.test.ts"],
          // hasEvalCreds gate: when env vars are missing, vitest will report
          // "no tests found" rather than blow up — CI fails closed via env-var
          // injection in the workflow file (see scripts/eval-budget-summary.mjs).
          ...(hasEvalCreds ? {} : { include: [] }),
          // Budget guard: each eval suite imports `evalBudget` from a shared
          // fixture and the fixture's beforeAll() hooks env.AI.run + env.VECTORIZE.query
          // to increment a counter; on overflow it throws + fails the suite.
          setupFiles: ["./src/__tests__/evals/eval-budget.setup.ts"],
        },
      },
    ],
  },
});
```

**Critical implementation notes:**
- The `MAX_AI_CALLS=200` counter is the load-bearing guard. Implementation: wrap `env.AI.run` and `env.VECTORIZE.query` via `vi.spyOn(env.AI, "run").mockImplementation((args) => { if (++count > 200) throw new Error("MAX_AI_CALLS exceeded"); return originalAI.run(args); })` in the `eval-budget.setup.ts` file imported by `setupFiles`. This is structurally similar to the existing `vi.spyOn` pattern in `recall-f1.eval.test.ts:38`.
- Env-var gating is **also** enforced at the CI workflow level (so locally-missing creds = silent skip, but CI-missing creds = workflow fails). Both layers exist on purpose.
- Daily neuron-consumption summary: a separate script `scripts/eval-budget-summary.mjs` runs on a Cron Action / nightly workflow and queries the Cloudflare GraphQL Analytics API `aiInferenceAdaptive` dataset at the account level with `accountTag` filter. Outputs to a markdown comment on the Linear v0.2 milestone or to a posted GitHub Action artifact.

### Pattern 3: Eval Corpus Schema (PRE-03)

**What:** Single-file JSON, MTEB/BEIR-spirit schema adapted to existing in-repo conventions, with an explicit `split: "train" | "validate"` field per entry.

**When to use:** Whenever a single team owns the corpus end-to-end and a 100-entry scale doesn't justify BEIR's three-file format.

**Example:**
```jsonc
// Source: .planning/evals/recall-corpus.json (NEW — Phase 1 PRE-03)
{
  "$schema": "./recall-corpus.schema.json",     // optional — Russell may add later
  "corpus_version": "v0.2.1",
  "sweep_date": "2026-06-XX",
  "embedding_model": "@cf/qwen/qwen3-embedding-0.6b",
  "total_entries": 100,
  "train_count": 70,
  "validate_count": 30,
  "split_ratio": "70/30",
  "split_strategy": "stratified by bucket",
  "sources": {
    "v0.1_production_recall_logs": 35,
    "ingested_notion_drive_snippets": 30,
    "carried_forward_reference_corpus": 20,
    "carried_forward_real_corpus": 15
  },
  "buckets": {
    "critical-path":  { "count": 40, "description": "queries Russell actually asks" },
    "extraction":     { "count": 25, "description": "expected-entity recall" },
    "known-failure":  { "count": 20, "description": "queries v0.1 missed" },
    "edge":           { "count": 15, "description": "empty / one-word / very-long" }
  },
  "entries": [
    {
      "id": "rc-001",
      "bucket": "critical-path",
      "memory_type": "job_application",
      "query": "what's the most recent role I applied for at a CDN company",
      "expected_top_3_block_ids": ["block-001", "block-002", "block-003"],
      "split": "train",
      "labeled_by": "russell",
      "labeled_at": 1748390400000,
      "expected_synthesis": null   // SYN-01 will populate post-hoc; reserved field
    }
    // ... 99 more
  ]
}
```

**Critical implementation notes:**
- `expected_top_3_block_ids` is the ground-truth analog to BEIR's `qrels` — three block IDs, ranked. Phase 2/3 evals consume this directly. [CITED: ar5iv.labs.arxiv.org/html/2210.07316]
- `split` is per-entry, NOT a separate file. Stratified by bucket (each bucket distributes 70/30 across train/validate) so neither split is dominated by a single bucket.
- The `expected_synthesis` field is **reserved null** for Phase 1; Phase 4 SYN-01 augments it with ground-truth captions for the LLM-judge eval. Reserving the field now means SYN-01 doesn't need a schema migration.
- `block_ids` MUST be ingested in a dedicated `eval-fixtures` workspace, NOT in Russell's personal workspace — otherwise block IDs drift every time real memories are added and the corpus rots.
- Schema is **deliberately additive** to the existing `reference-corpus.json` shape so the existing eval tests (`recall-f1.eval.test.ts`) need minimal changes.

### Pattern 4: Integration Matrix (PRE-04)

**What:** A markdown table that maps every feature pairing (and the kitchen-sink case) to a specific plan, test file, and current coverage status.

**When to use:** Any milestone where 4+ features need integration coverage AND the project lacks a standard cross-feature test plan.

**Example:**
```markdown
# v0.2 Integration Matrix

> Phase 1 PRE-04. Drives Phase 5 INT-04 "zero untested cross-feature combinations" close-out criterion.

| Feature Pairing | Covering Plan | Test File | Status | Notes |
|---|---|---|---|---|
| RNK × CON (rank stability when conflicts surface) | 02-XX | `packages/mcp-server/src/__tests__/integration/rank-with-conflicts.test.ts` | pending | RNK weights must not drift when `context.conflicts` is populated |
| RNK × EXP (rank stability under expanded query path) | 03-XX | `packages/mcp-server/src/__tests__/integration/rank-with-expansion.test.ts` | pending | weights tuned on single-query path; verify they still hold on expanded |
| EXP × SYN (synthesis quality under expansion) | 04-XX | `packages/mcp-server/src/__tests__/integration/expansion-then-synth.test.ts` | pending | synthesis input mix changes when expansion broadens recall |
| CON × SYN (synthesis acknowledges flagged conflicts) | 04-XX | `packages/mcp-server/src/__tests__/integration/synth-with-conflicts.test.ts` | pending | synthesis prompt should NOT collapse contradictory inputs into a confident merge |
| Kitchen-sink (all 4) | 05-XX | `packages/mcp-server/src/__tests__/integration/v02-kitchen-sink.test.ts` | pending | INT-01 — 10 conflicts + 50 entities + verbosity=synthesis ≤ 8K tokens |
| Adaptive routing × cosine threshold edge | 03-XX | `packages/mcp-server/src/__tests__/integration/adaptive-routing-edge.test.ts` | pending | top1_cosine=0.649 vs 0.651 boundary |
```

**Critical implementation notes:**
- The matrix must reference **plan IDs that don't exist yet** (02-XX, 03-XX, etc.). When Phase 2/3/4/5 plans land, their PLAN.md cross-links back to this matrix and updates the cell to `tested-by: 02-04` (the actual plan id).
- Phase 5's `/gsd:verify-work 5` reads this file and enforces zero `pending` rows.

### Pattern 5: CF-Code-Assist Tracker Scaffold (PRE-05)

**What:** Copy the Phase 5 v0.1 tracker shape verbatim (`.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`), adjusting only the phase number, scope statement, and stop-trigger.

**When to use:** Every phase that ships code in v0.2. PRE-05 ships Phase 1's file; Phase 2/3/4/5 plans each scaffold their own at plan-phase start (a plan-checker rule will enforce this).

**Example:** See `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` lines 1-45 for the verbatim header + instructions + 3-question checklist block. Phase 1's file replicates that, with this header:

```markdown
# Phase 1 — cf-code-assist Routing Tracker

> Tracks every code-generation decision during Phase 1 execution.
>
> **Scope:** Active for Phase 1 execution only. Stop tracking once
> `/gsd:verify-work 1` returns PASSED.
>
> **Why it matters:** Phase 1 is a *foundation phase* (test infra + CI gates +
> corpus labeling). Expected routing mix: <10% cf-code-assist. Most tasks are
> small (<50 lines), cross-file (CI workflow + script + vitest config), or
> pure prose (corpus labeling, integration matrix). The tracker still runs to
> validate the heuristic empirically.
```

### Anti-Patterns to Avoid

- **Anti-pattern: Migration audit run only at deploy time.** The audit must be **PR-gating** — running it in `npm run predeploy` only catches the problem AFTER a broken PR has already been merged. The audit lives in the `.github/workflows/ci.yml` `pull_request` job.
- **Anti-pattern: Single-file env-var gating for eval tier.** Naive `describe.skipIf` distributed across N eval files lets a budget bug ride through one file's missing skip. Wrap the AI binding once in the project's `setupFiles`.
- **Anti-pattern: Corpus stored inside `packages/*/src/__tests__/evals/fixtures/`.** That path couples the corpus lifecycle to a single package. The corpus is cross-package data; `.planning/evals/` is the correct home.
- **Anti-pattern: Build the matrix as a JSON file.** REQUIREMENTS.md says markdown. JSON would let a script auto-update cells but the matrix is meant to be Russell-readable at a glance — markdown is the right format for that use case.
- **Anti-pattern: Tracker rows logged AFTER the routing decision.** The 3-question checklist must be answered BEFORE committing the route (per `~/.claude/CLAUDE.md` AI Model Routing). Phase 5's tracker enforced this convention; Phase 1 inherits it.
- **Anti-pattern: Inflating `MAX_AI_CALLS` when tests fail with "budget exceeded".** The correct response is "the eval is over-running its budget — tighten the test, not the cap." 200 is the contract.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-workspace DO enumeration | A KV-stored manifest of workspace IDs | Cloudflare DO Namespace List API | List API is source-of-truth; KV manifest requires drift discipline. [CITED: developers.cloudflare.com/api/resources/durable_objects/...] |
| Neuron usage per CI run | Custom pre-flight counter that re-counts tokens locally | Workers Analytics Engine `writeDataPoint` + GraphQL Analytics API read | Existing path (triage-worker already writes events per v0.1 Phase 5 ANALYTICS binding). [CITED: triage-worker/src/analytics.ts] |
| Eval corpus split | Random shuffle in test code | Per-entry `split: "train" \| "validate"` field at corpus author time | Stable splits = reproducible F1 scores across runs. Test-time random split = noise. |
| 3-question routing checklist | Re-derive from CLAUDE.md every time | Copy the Phase 5 v0.1 tracker's instructions block verbatim | The Phase 5 file is the canonical instance; PRE-05 mirrors. |
| Test-runner tier discovery | Custom shell script that greps `*.eval.test.ts` files | Vitest `projects[]` config + `include` glob | Vitest already does this. [CITED: workers-sdk vitest-pool-workers-examples] |

**Key insight:** Phase 1 is a *tooling* phase — every problem in scope has an existing solution upstream (Cloudflare APIs, vitest projects, the Phase 5 tracker pattern, the BEIR qrels mental model). The temptation is to write a few extra scripts for "discoverability"; resist. The tooling is correct as-is; Phase 1 wires it in.

---

## Runtime State Inventory

> Phase 1 is partially a refactor/migration phase (PRE-01 specifically operates on legacy data). Inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `blocks.embedding_model` / `blocks.embedding_version` SQLite columns may have v1 stamps (NULL, or `embedding_model='@cf/baai/bge-base-en-v1.5'`, or `embedding_version=1`) from any block written before ENG-25's 2026-06-02 cutover. Per ENG-25 PR, the Vectorize index was destroyed/recreated, but SQLite rows are NOT migrated. | **Migration AUDIT (PRE-01).** If audit returns > 0, a separate one-off data-migration is required: re-embed each stale row with `qwen3-embedding-0.6b`, upsert to Vectorize, stamp via `stampEmbedding`. This migration is OUT OF SCOPE for Phase 1 (Phase 1 just AUDITS); if rows surface, planner adds a `checkpoint:human-verify` task to confirm Russell wants the migration sequenced before Phase 2. |
| Live service config | Cloudflare Vectorize index `engram-memories` is the live 1024d cosine index. wrangler.test.jsonc references it directly (`index_name: "engram-memories"`). | **Verify in PRE-01 audit script:** `wrangler vectorize get engram-memories --json` returns `dimensions: 1024`, `metric: "cosine"`. If not, halt. [CITED: shared/ai-config/src/index.ts:90-93] |
| OS-registered state | None — Engram is fully serverless. No Task Scheduler / launchd / systemd registrations. | None. |
| Secrets/env vars | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` already used by existing eval test infrastructure (`wrangler.test.jsonc` `remote: true`). Phase 1 adds CI-workflow injection of these for the `eval` tier and the audit script. No new secret keys. | **Code edit only** — extend `.github/workflows/ci.yml` with the same secret references. No SOPS / new secret-store key needed. |
| Build artifacts | `node_modules/` symlinks per-package (npm workspaces). `package-lock.json` at root. No stale lock files (verified via `package-lock.json` size 562KB at HEAD). | None — Phase 1 installs nothing. |

**Nothing found in category:** OS-registered state and build artifacts both verified clean — see right column.

---

## Common Pitfalls

### Pitfall 1: Cardinal-sin clause violation (PRE-01 false negative)

**What goes wrong:** The audit query uses `embedding_version < 2` and misses rows with `embedding_version IS NULL`. NULL is the default state for blocks whose triage-worker enrichment failed before `stampEmbedding` ran — common during Phase 5 development. Audit reports 0 stale rows; production silently mixes vector spaces.

**Why it happens:** SQL standard: `NULL < 2` evaluates to NULL, not TRUE. The naive `WHERE embedding_version < 2` clause skips NULLs entirely.

**How to avoid:** The audit SQL **MUST** include `IS NULL OR embedding_version < 2 OR embedding_model != ?` — three-arm OR. Test the audit against a fixture WorkspaceDO with one NULL-stamped row, assert count = 1.

**Warning signs:** Audit passes but a manual `wrangler vectorize describe engram-memories` shows `vector_count` != `blocks_count`.

### Pitfall 2: Eval tier silently skipping due to missing CF creds

**What goes wrong:** Engineer runs `npm test` locally, sees "no tests ran" for the eval tier, ships PR. CI also lacks creds (forgotten secret), green checks pass, the eval tier never ran.

**Why it happens:** `vitest --project=eval --include=[]` with empty include = no tests = exit 0. Skip-on-missing-creds is symmetric with skip-in-CI on missing-creds.

**How to avoid:** Two layers of defense — (a) vitest config emits a warning to stderr when `eval` project has empty include; (b) CI workflow uses `if: secrets.CLOUDFLARE_API_TOKEN != ''` and **fails closed** with an explicit "EVAL TIER SKIPPED — missing CF_API_TOKEN" message in the workflow log. The fail must be loud, not silent.

**Warning signs:** Eval-tier section of CI workflow logs shows zero `passed` and zero `failed` count.

### Pitfall 3: MAX_AI_CALLS counter resets per test file

**What goes wrong:** Each test file in the `eval` project gets a fresh counter (because workerd vitest pool isolates per-file storage per [vitest-pool-workers Isolation docs](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/)). The 200-call budget is enforced per-file, not per-run; running 5 eval files = 1000 calls.

**Why it happens:** Vitest's default isolation is per-file. The counter lives in the test setup and resets each file.

**How to avoid:** Either (a) use `--max-workers=1 --no-isolate` for the eval project (shared state across files); (b) accumulate the per-file counter into a workerd-external JSON sink (a Workers Analytics Engine event) and reject in the test-run AFTER counts aggregate — slower feedback but correct. Recommendation: **(a) for v0.2**, with a CI workflow step that asserts the aggregate is ≤ 200 by reading the analytics dataset POST-run.

**Warning signs:** A budget-overrun bug ships; the post-hoc Analytics Engine report shows neurons consumed >> 200's equivalent.

### Pitfall 4: Eval corpus block IDs drift

**What goes wrong:** Corpus is labeled against Russell's personal workspace block IDs. Russell adds new memories, deletes old ones; some referenced block IDs no longer exist. Eval tests start returning false negatives that are actually corpus rot.

**Why it happens:** Block IDs are workspace-internal and impermanent.

**How to avoid:** Phase 1 PRE-03 must (a) ingest the corpus's source memories into a dedicated `eval-fixtures` workspace, with deterministic IDs assigned at ingest time; (b) the corpus references THOSE IDs only; (c) the workspace is treated as immutable — any updates to corpus = a new corpus version. Document this in the `recall-corpus.json` header.

**Warning signs:** Eval F1 drops between weeks without code changes; debugging surfaces "block ID xxx not found" in recall results.

### Pitfall 5: Integration matrix grows without test files

**What goes wrong:** PRE-04 ships a matrix with 10 cells. Phase 2/3/4 each pick one feature pair; the rest stay `pending`. Phase 5 INT-04 close-out finds 7 unwritten test files; planner adds them as last-minute integration plans; quality suffers.

**Why it happens:** No explicit per-plan rule that demands updating the matrix when a new test lands.

**How to avoid:** PRE-04 matrix includes a footer rule: "Every plan in Phases 2..5 MUST either (a) land a test that closes a `pending` cell, or (b) document why no integration test is needed (e.g., features are truly orthogonal). Plan-checker enforces this."

**Warning signs:** Phase 5 INT-04 surfaces with >2 `pending` cells.

### Pitfall 6: Tracker file overwritten by parallel sub-agents

**What goes wrong:** Multiple gsd-executor sub-agents work on parallel waves in Phase 2; each appends a row to `02-CF-CODE-ASSIST-USAGE.md`. Two appends collide and one row is lost.

**Why it happens:** No file-lock discipline between sub-agents; markdown append is not atomic across workerd contexts.

**How to avoid:** PRE-05's scaffold MUST document the convention: "Append rows in a single Edit operation with explicit `oldString` matching the preceding row + the seed comment; never use multiple parallel Edits to the same tracker file." This is the same discipline that Phase 5's `05-CF-CODE-ASSIST-USAGE.md` followed.

**Warning signs:** Routing log table has gaps in task-id sequence (05-04-T3 followed by 05-04-T5 with no T4).

### Pitfall 7: CI workflow loses env vars when re-running

**What goes wrong:** GitHub Actions re-run from the UI doesn't carry repository secrets if the workflow uses `secrets.CLOUDFLARE_API_TOKEN` inside an `if:` condition without `env:` propagation. Eval tier silently passes "no tests ran" on the re-run.

**Why it happens:** Conditional secret access in `if:` doesn't propagate to nested steps.

**How to avoid:** Hoist `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` to the workflow-level `env:` block. The conditional gate becomes `if: env.CLOUDFLARE_API_TOKEN != ''`. Same pattern verified in [Cloudflare's workers-sdk vitest examples](https://github.com/cloudflare/workers-sdk/blob/main/fixtures/vitest-pool-workers-examples/basics-integration-auxiliary/vitest.config.ts).

**Warning signs:** Workflow re-run shows "EVAL TIER SKIPPED" where the original run showed passes.

---

## Code Examples

> Verified patterns from official sources + existing Engram codebase.

### Example 1: Existing multi-project vitest pattern (carry forward)

```typescript
// Source: packages/mcp-server/vitest.config.ts (Phase 5 Plan 05-03 — already in repo)
// CARRY FORWARD: Phase 1's eval-tier addition extends this same shape.
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
      {
        test: {
          name: "lint-node",
          include: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
    ],
  },
});
```

### Example 2: Existing eval test harness (template for new eval tests in Phase 2/3/4)

```typescript
// Source: packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:1-67
// REUSE: Phase 1's recall-corpus.json is consumed by tests that mirror this shape.
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import recallCorpus from "../../../../../.planning/evals/recall-corpus.json";

function captureCallback(toolName: string, workspace_id: string) {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  // ... captures the registered tool callback for direct invocation
}
```

### Example 3: Cloudflare DO Namespace List API (PRE-01 cross-workspace enumeration)

```bash
# Source: developers.cloudflare.com/api/resources/durable_objects/subresources/
#         namespaces/subresources/objects/methods/list/
# [CITED]
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/durable_objects/namespaces/$WORKSPACE_NAMESPACE_ID/objects?limit=1000" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | jq '.result[].id'

# Returns: paginated list of all DO instance IDs (workspace IDs) in the namespace.
# Cursor in result_info.cursor — loop while non-null.
```

### Example 4: GraphQL Analytics API for neuron summary

```graphql
# Source: developers.cloudflare.com/analytics/graphql-api/
# [CITED]
query NeuronUsage($accountTag: String!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      aiInferenceAdaptiveGroups(
        limit: 1000
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum {
          requests
          tokensInput
          tokensOutput
        }
        dimensions {
          modelName
          datetime
        }
      }
    }
  }
}
```

### Example 5: Existing analytics writeDataPoint (already in repo — read path is new)

```typescript
// Source: packages/triage-worker/src/analytics.ts (already in repo)
// CARRY FORWARD: PRE-02's daily summary reads what this already writes.
import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";

export function writeAnalytics(
  ANALYTICS: AnalyticsEngineDataset | undefined,
  evt: { blob: string; doubles: number[]; indexes: [string] },
): void {
  if (!ANALYTICS) return;  // graceful no-op when binding absent
  ANALYTICS.writeDataPoint({ blobs: [evt.blob], doubles: evt.doubles, indexes: evt.indexes });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `it.skip` for AI-dependent tests | Tiered vitest projects with env-var-gated `eval` project | Phase 5 Plan 05-03 (mcp-server) + Phase 1 (extend to all packages) | Cleaner CI workflow: `--project=workerd` for PR; `--project=eval` for nightly. |
| Per-package eval corpus (`reference-corpus.json` + `real-corpus.json`) | Single repo-level `.planning/evals/recall-corpus.json` with 100+ entries + split fields | Phase 1 PRE-03 (this phase) | One source of truth; cross-package consumers (mcp-server recall evals + triage-worker triage evals) reference the same file. |
| Implicit budget assumptions in eval tests | Hard `MAX_AI_CALLS=200`/run guard | Phase 1 PRE-02 | Prevents CI bill-shock; converts a soft norm to a structural test. |
| Routing-pattern tribal knowledge | Per-phase tracker file with mandatory 3-question checklist | Phase 5 v0.1 → Phase 1 v0.2 (this phase) | Audit trail; empirical validation of the routing heuristic. |

**Deprecated/outdated:**
- ENG-25 deprecated `@cf/baai/bge-base-en-v1.5` 768d embeddings → replaced with `@cf/qwen/qwen3-embedding-0.6b` 1024d. PRE-01 polices the cutover. [CITED: shared/ai-config/src/index.ts:62,82]
- `reference-corpus.json` and `real-corpus.json` are not deprecated as fixtures — PRE-03 carry-forwards their entries into the new repo-level corpus. The package-local copies stay for the existing `recall-f1.eval.test.ts` harness until Phase 2 retargets it at the new file.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Audit script can enumerate workspaces via the DO Namespace List API" `[ASSUMED]` — verified that the API exists per Cloudflare docs, but not verified that the engram-mcp-server WorkspaceDO namespace ID is discoverable from Wrangler config alone. May require a manual `wrangler durable-objects namespace list` step to find the namespace ID first. | Pattern 1 | Audit script needs a one-time bootstrap step to capture the namespace ID; documentable in PLAN.md but adds a manual setup task. |
| A2 | "Phase 1's audit only needs to consider production workspaces, not test pool workspaces" `[ASSUMED]` — test pool workspaces created via `cloudflareTest` are ephemeral and torn down per test file. They don't persist into the production DO namespace. | PRE-01 architecture | If wrong, audit may also need to filter or skip ephemeral test workspaces — adds complexity but is straightforward to address. |
| A3 | "Russell can label 50 new corpus entries in 3-4 hours" `[ASSUMED]` — ROADMAP.md states this, but no controlled time measurement was performed. Russell may discover that some queries require ingesting fresh content (Notion/Drive snippets) which adds time. | PRE-03 critical path | If labeling takes >5 hours, Phase 1 ship date slips; suggestion: stage labeling as 2 sessions of 2 hours each to bound the risk. |
| A4 | "Existing `evals:vitest` script in root package.json can be adapted to project-tier" `[ASSUMED]` — verified the script exists (`package.json:31`) but not verified it threads through `--project=eval` cleanly across the multi-package monorepo. | PRE-02 wiring | If the script needs a rewrite, Phase 1 grows by one task; acceptable. |
| A5 | "Analytics Engine `aiInferenceAdaptive` dataset surfaces per-call neuron counts at account level" `[ASSUMED]` — WebSearch confirms the dataset exists for AI Gateway, but the docs are less clear about Workers AI (non-Gateway) coverage. May need to use a different dataset name or AI Gateway routing for the read path. | PRE-02 daily summary | If dataset is wrong, the summary script needs a different query; report still ships, may take an extra discovery loop. |
| A6 | "Reference corpus + real corpus carry-forward keeps existing eval tests green" `[ASSUMED]` — the new repo-level `recall-corpus.json` has a slightly different shape (adds `split`, `expected_top_3_block_ids`). The existing `recall-f1.eval.test.ts` reads `intended_memory_id` (singular). | PRE-03 schema | A schema mismatch could break the existing eval test. Mitigation: keep the per-package corpus files unchanged in Phase 1; Phase 2's RNK plan retargets the test at the new corpus. Two-step migration. |
| A7 | "Workers Analytics Engine GraphQL read requires an API token with `analytics:read` scope" `[ASSUMED]` — standard Cloudflare token scoping, but not verified that the existing `CLOUDFLARE_API_TOKEN` used for `wrangler dev` has this scope. | PRE-02 daily summary | If scope missing, summary script fails 401 — Russell rotates the token with broader scope; one-time fix. |
| A8 | "Phase 1 file copies of the Phase 5 v0.1 tracker shape capture every needed column" `[ASSUMED]` — verified the Phase 5 file's column set (`Task / Artifact / Route / Checklist Q1/Q2/Q3 / Reason / Approx tokens saved`); if v0.2 needs an additional column (e.g., "retrospective audit verdict"), PRE-05 should add it. | PRE-05 scaffold | Minor — additive column changes are cheap. |

**If this table is empty:** N/A — there are 8 assumed claims. Each should be confirmed during `/gsd:discuss-phase 1` or noted as planner-discretion items.

---

## Open Questions

1. **Should the audit script also assert `wrangler vectorize get engram-memories --json` returns `dimensions=1024`?**
   - What we know: ENG-25 recreated the index at 1024d; INT-1 explicitly suggests this verification.
   - What's unclear: Whether this belongs in the same script as the SQLite count assertion, or as a separate `verify-vectorize-shape.sh` step in CI.
   - Recommendation: Same script, two assertions. Simpler ops, single point of failure visibility.

2. **What happens if PRE-01 finds non-zero stale rows?**
   - What we know: REQUIREMENTS.md says "audit script is idempotent and runnable as a CI assertion."
   - What's unclear: REQUIREMENTS does not specify the remediation path if rows are found. Is it a separate migration plan (deferred)? An immediate halt + manual data fix? A `checkpoint:human-verify` task in this phase?
   - Recommendation: Discuss-phase decision. Default: planner adds a contingent re-embed task gated on `checkpoint:human-verify` per Russell's call.

3. **Should the eval corpus live in `.planning/evals/` (per REQUIREMENTS) or alongside existing fixtures?**
   - What we know: REQUIREMENTS.md explicitly states `.planning/evals/recall-corpus.json`.
   - What's unclear: Existing eval tests in `packages/mcp-server/src/__tests__/evals/` import from `./fixtures/*.json` — relative paths. Moving to `.planning/evals/` requires a different import strategy (absolute path or workspace alias).
   - Recommendation: Follow REQUIREMENTS.md; cope with import path via vitest's `resolve.alias` or a small relative path (`../../../../../.planning/evals/recall-corpus.json` — works given existing layout).

4. **Does the cf-code-assist tracker need a Linear sync hook?**
   - What we know: CLAUDE.md establishes Linear sync per phase; the tracker file is a per-phase artifact.
   - What's unclear: Whether tracker rows should be summarized into the Linear issue comments at phase close, similar to how Phase 5's End-of-Phase Summary section is written.
   - Recommendation: At phase close (verify-work), post the End-of-Phase Summary as a Linear comment. No new infra; uses existing Linear MCP.

5. **What's the contract for plans 2/3/4/5 to scaffold their own NN-CF-CODE-ASSIST-USAGE.md?**
   - What we know: Phase 5 v0.1 had this pattern; Phase 1 PRE-05 mirrors. Each subsequent phase must scaffold its own.
   - What's unclear: Should the scaffolding be a plan-checker enforcement, a manual planner discipline, or a slash command?
   - Recommendation: Plan-checker enforcement — when `/gsd:plan-check N` runs (N>1), it verifies `.planning/phases/0N-*/0N-CF-CODE-ASSIST-USAGE.md` exists.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All scripts + vitest | ✓ | ≥22 per package.json:11 | — |
| npm | Workspaces + install | ✓ | ≥10 per package.json:12 | — |
| TypeScript | Audit script (.ts) | ✓ | ^5 per package.json:50 | — |
| `wrangler` CLI | Vectorize verification + DO namespace list | ✓ | ^4.94.0 per package.json:51 | curl direct against Cloudflare API |
| `mise` (Node 22.22.3 pin) | Local dev consistency | ✓ | per mise.toml (Phase 5 v0.1 introduced) | nvm / volta |
| `CLOUDFLARE_API_TOKEN` env var | PRE-01 audit + PRE-02 eval tier + PRE-02 GraphQL Analytics | ✓ (Russell has) | — | none — workflow fails closed |
| `CLOUDFLARE_ACCOUNT_ID` env var | Same | ✓ (Russell has) | — | none — workflow fails closed |
| GitHub Actions secrets storage | CI workflow env vars | ✓ (Russell can provision) | — | local-only audit fallback |
| Cloudflare GraphQL Analytics API access | PRE-02 daily summary | ✓ (standard Cloudflare account perk) | — | Workers Analytics Engine direct query as fallback |
| Cloudflare DO Namespace List API access | PRE-01 cross-workspace enumeration | ✓ (standard Cloudflare account perk) | — | manual workspace ID list in env var |
| Linear MCP server | Phase 1 ENG-XX issue creation | ✓ (already connected per CLAUDE.md) | — | manual issue creation via Linear web UI |

**Missing dependencies with no fallback:**
- None.

**Missing dependencies with fallback:**
- None — all required dependencies are present.

---

## Validation Architecture

> Phase 1 IS the testing-discipline phase. Most "validation" here is the work itself, but the deliverables themselves must have test coverage.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^3` (per `node_modules`) + `@cloudflare/vitest-pool-workers` |
| Config file | Per-package: `packages/mcp-server/vitest.config.ts`, `packages/triage-worker/vitest.config.ts`, `packages/workspace-do/vitest.config.ts` |
| Quick run command | `npm test` (root — runs all packages' tests) |
| Full suite command | `npm test --workspaces --if-present` (current) + new `npm run test:eval` after PRE-02 lands |
| Eval tier command | `npm run evals:vitest` (existing wrapper — PRE-02 may extend) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRE-01 | Audit script returns 0 stale rows in a clean workspace | unit | `cd packages/workspace-do && npm test -- assertAllBlocksAtV2` | ❌ Phase 1 Wave 0 (NEW test against new RPC) |
| PRE-01 | Audit script catches NULL embedding_version in a seeded workspace | unit | `cd packages/workspace-do && npm test -- assertAllBlocksAtV2-null-stamp` | ❌ Phase 1 Wave 0 |
| PRE-01 | Audit script catches wrong-model embedding_model | unit | `cd packages/workspace-do && npm test -- assertAllBlocksAtV2-wrong-model` | ❌ Phase 1 Wave 0 |
| PRE-01 | CI workflow fails on non-zero audit count | manual | review workflow YAML; trigger by seeding | ❌ Phase 1 Wave 0 |
| PRE-02 | Eval tier `eval-budget.setup.ts` throws at 201st AI call | unit | `cd packages/mcp-server && npm test -- eval-budget-overflow` | ❌ Phase 1 Wave 0 |
| PRE-02 | Eval tier skips locally when CF creds absent | manual | `unset CLOUDFLARE_API_TOKEN && npm run test:eval` → exits clean | ❌ Phase 1 Wave 0 |
| PRE-02 | Eval tier fails CI when CF creds expected but missing | manual | inspect workflow `if:` gate; trigger via empty-secret simulation | ❌ Phase 1 Wave 0 |
| PRE-02 | Daily neuron summary script returns parseable output | unit | `node scripts/eval-budget-summary.mjs --dry-run` → valid markdown | ❌ Phase 1 Wave 0 |
| PRE-03 | `recall-corpus.json` parses as valid JSON | unit | `jq '.' .planning/evals/recall-corpus.json > /dev/null` | ❌ Phase 1 Wave 0 |
| PRE-03 | Corpus has ≥100 entries | unit | `jq '.total_entries' .planning/evals/recall-corpus.json` → ≥100 | ❌ Phase 1 Wave 0 |
| PRE-03 | Train/validate split is 70/30 | unit | `jq '.train_count + .validate_count' / `.total_entries` → exactly 1.0 | ❌ Phase 1 Wave 0 |
| PRE-03 | Each entry has `expected_top_3_block_ids` array of length 3 | unit | `jq '.entries[] \| select(.expected_top_3_block_ids \| length != 3)'` → empty | ❌ Phase 1 Wave 0 |
| PRE-04 | Integration matrix references every v0.2 feature | manual | grep RNK / CON / EXP / SYN / INT in matrix | ❌ Phase 1 Wave 0 |
| PRE-04 | Matrix cells reference plan IDs in 02-XX..05-XX range | manual | review matrix table cells | ❌ Phase 1 Wave 0 |
| PRE-05 | Tracker file exists with all required sections | unit | `grep -E '^(## Routing Log\|## 3-Question Checklist\|## End-of-Phase Summary)' .planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` → 3 matches | ❌ Phase 1 Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` per affected package (existing convention)
- **Per wave merge:** `npm test --workspaces` (existing root command)
- **Phase gate:** `npm test --workspaces && jq '.' .planning/evals/recall-corpus.json && bash scripts/audit/embedding-version-audit.sh` (composite assertion)

### Wave 0 Gaps

- [ ] `packages/workspace-do/src/__tests__/embedding-version-audit.test.ts` — covers PRE-01 RPC unit
- [ ] `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` — covers PRE-02 budget guard fixture
- [ ] `packages/mcp-server/src/__tests__/evals/eval-budget-overflow.eval.test.ts` — covers PRE-02 overflow assertion
- [ ] `.planning/evals/recall-corpus.json` — covers PRE-03 (the deliverable IS the corpus)
- [ ] `.planning/evals/recall-corpus.schema.json` — covers PRE-03 schema validation (optional but recommended)
- [ ] `.planning/research/v0.2-INTEGRATION-MATRIX.md` — covers PRE-04 (the deliverable IS the matrix)
- [ ] `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` — covers PRE-05 (the deliverable IS the tracker scaffold)
- [ ] `scripts/audit/embedding-version-audit.ts` — covers PRE-01 cross-workspace audit
- [ ] `scripts/eval-budget-summary.mjs` — covers PRE-02 daily summary
- [ ] `.github/workflows/ci.yml` extensions — covers PRE-01 PR gate + PRE-02 eval tier env-var wiring

---

## Security Domain

> Phase 1 is a foundation phase; security implications are mostly inherited from v0.1's existing posture. Including this section per the `security_enforcement` default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 1 doesn't ship new auth surface. CI uses GitHub Actions OIDC + Cloudflare token (existing). |
| V3 Session Management | no | No new sessions. |
| V4 Access Control | yes | The new PRE-01 admin RPC (`assertAllBlocksAtV2`) on `WorkspaceDO` MUST verify caller is admin / system, NOT a regular MCP user. v0.1 pattern: workspace_id assertion. Phase 1: the audit script invokes the RPC via internal Worker-to-DO call, NOT via the MCP surface. The RPC should reject if `this.props.user_id` doesn't match a hardcoded admin allowlist OR be unreachable from the MCP tool registration. |
| V5 Input Validation | yes | Audit script parses Cloudflare API JSON; use zod (existing dep) to validate the namespace list shape before iterating. |
| V6 Cryptography | no | No new crypto. |
| V7 Error Handling | yes | Audit script must NOT log Cloudflare API tokens on error. Workflow logs must scrub secrets (GitHub Actions does this automatically for `secrets.*` references). |
| V8 Data Protection | no | No new data classification. |
| V9 Communication | yes | GraphQL Analytics API call uses HTTPS by default (Cloudflare endpoint). Audit script ditto. |
| V10 Malicious Code | no | No new packages installed. |
| V11 Business Logic | yes | The `MAX_AI_CALLS=200` is a business-logic invariant; bypass = test-cost runaway. |
| V12 File / Resource | no | No new files exposed. |
| V13 API | yes | New admin RPC. Apply the v0.1 cross-workspace pentest pattern (`packages/mcp-server/src/__tests__/cross-workspace-pentest.test.ts`) extended to assert the RPC is unreachable via JWT. |
| V14 Configuration | yes | `CLOUDFLARE_API_TOKEN` rotated regularly per Cloudflare best practice; GitHub Actions secrets storage is acceptable. |

### Known Threat Patterns for the Phase 1 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Audit RPC reachable from MCP tool registration | E (Elevation of Privilege) | RPC method not registered in `registerTools()`; called only from `scripts/audit/embedding-version-audit.ts` via Worker-to-DO RPC binding |
| Cloudflare API token leakage in CI logs | I (Information Disclosure) | GitHub Actions secret masking (automatic for `secrets.*`); avoid `set -x` in shell scripts |
| Eval budget bypass via parallel test files | T (Tampering) | Counter aggregation post-run via Workers Analytics Engine read (post-hoc verification — Pitfall 3) |
| Slopcheck bypass via PR that adds packages in a later phase | T (Tampering) | Phase 1 doesn't install packages, but a downstream phase might; the package legitimacy gate is enforced in those phases' research. |
| Eval corpus poisoning | T (Tampering) | Corpus committed to git; PR review covers; `labeled_by` field requires literal "russell" string for v0.2 entries |

---

## Sources

### Primary (HIGH confidence)

- **Engram codebase (verified at HEAD):**
  - `packages/workspace-do/src/schema.ts:66-143` — blocks table DDL with `embedding_model TEXT` + `embedding_version INTEGER` columns (PRE-01 target)
  - `packages/workspace-do/src/queries.ts:314-331` — `insertBlock` writes NULL stamps (NULL gap that PRE-01 audit must catch)
  - `packages/workspace-do/src/queries.ts:548-562` — `stampEmbedding` updates stamps after Vectorize upsert (Phase 5 AI-03 pattern)
  - `shared/ai-config/src/index.ts:62,82,90-93` — locked model + dims + index name
  - `packages/mcp-server/vitest.config.ts` — existing multi-project pattern (Phase 5 Plan 05-03)
  - `packages/workspace-do/vitest.config.ts` — existing workerd + lint-node split (Phase 5 Plan 05-01)
  - `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` — existing 20-entry corpus schema (PRE-03 starting point)
  - `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts:1-110` — existing eval harness shape
  - `packages/mcp-server/wrangler.test.jsonc` — existing remote-mode AI/Vectorize binding pattern (Phase 1 eval-tier mirrors)
  - `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md` — canonical Phase 5 v0.1 tracker (PRE-05 mirrors verbatim)
  - `.planning/milestones/v0.1-phases/04-core-tools-envelope/04-CF-CODE-ASSIST-USAGE.md:62-110` — End-of-Phase Summary post-mortem with 5 clear misses + 4 partial misses analysis (drives PRE-05 checklist enforcement)
  - `.planning/research/v0.2-PITFALLS.md:297-340` — INT-1..INT-6 verbatim (PRE-01..05 mitigation source)
  - `.planning/research/v0.2-SUMMARY.md:86-94` — Phase A.0 (Wave 0) scope locked
  - `.planning/REQUIREMENTS.md:17-23` — PRE-01..05 verbatim
  - `.planning/ROADMAP.md:52-74` — Phase 1 scope + risk notes verbatim

- **Cloudflare official docs:**
  - [Vitest integration — Cloudflare Workers docs](https://developers.cloudflare.com/workers/testing/vitest-integration/) — vitest-pool-workers patterns
  - [Configuration — Cloudflare Workers Vitest docs](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/) — `cloudflareTest()` plugin args
  - [Isolation and concurrency — Cloudflare Workers Vitest docs](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/) — per-file isolation (drives Pitfall 3)
  - [Cloudflare API — Durable Objects Namespaces Objects List](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/) — REST endpoint for cross-workspace enumeration
  - [Cloudflare GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/) — neuron usage read path
  - [Querying Workers Metrics with GraphQL](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) — account-level query pattern
  - [Get started with Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/get-started/) — `writeDataPoint` (already used in triage-worker)
  - [Vitest fails with Cloudflare Vectorize, AI bindings — GitHub Issue #7434](https://github.com/cloudflare/workers-sdk/issues/7434) — known workerd binding test issues (PRE-02 awareness)

### Secondary (MEDIUM confidence)

- [BEIR retrieval benchmark — qrels format](https://github.com/beir-cellar/beir) — drives PRE-03 schema choice (single-file adapted)
- [MTEB paper (ar5iv 2210.07316)](https://ar5iv.labs.arxiv.org/html/2210.07316) — train/validate split convention for retrieval evals
- [Workers AI · Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/) — confirms `aiGatewayRequestsAdaptiveGroups` dataset exists at account level (A5 assumption)
- [workers-sdk/fixtures/vitest-pool-workers-examples/basics-integration-auxiliary/vitest.config.ts](https://github.com/cloudflare/workers-sdk/blob/main/fixtures/vitest-pool-workers-examples/basics-integration-auxiliary/vitest.config.ts) — official Cloudflare reference for multi-project + auxiliary workers

### Tertiary (LOW confidence — verify before relying)

- [Hidden Risks of False Positives — Stamus Networks blog](https://www.stamus-networks.com/blog/the-hidden-risks-of-false-positives-how-to-prevent-alert-fatigue-in-your-organization) — cited in v0.2-PITFALLS CD-1; not phase-1-load-bearing but informs the integration-matrix coverage of CON × notification surface

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every tool is already in the repo, no new installs
- Architecture (PRE-01 audit pattern): HIGH — direct extension of existing `stampEmbedding` + `getBlocksByIds` patterns; Cloudflare DO Namespace List API is documented
- Architecture (PRE-02 tier topology): HIGH — extending an existing multi-project shape; budget counter pattern is straightforward
- Architecture (PRE-03 corpus schema): MEDIUM — schema is straightforward but the labeling time/quality is Russell-dependent
- Architecture (PRE-04 matrix): MEDIUM — no industry-standard format; invented locally with clear acceptance criteria
- Architecture (PRE-05 tracker): HIGH — direct copy of Phase 5 v0.1 file with adjusted header
- Pitfalls: HIGH — most pitfalls are corollaries of v0.1 patterns already known; the SQL NULL pitfall is hard-earned
- Security: MEDIUM — admin RPC threat model needs discuss-phase scrutiny

**Research date:** 2026-06-02
**Valid until:** 2026-06-09 (stable infrastructure; only triggers for re-research are CF API breakage or vitest-pool-workers major version)

## RESEARCH COMPLETE
