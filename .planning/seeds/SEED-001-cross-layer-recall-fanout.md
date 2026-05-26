---
id: SEED-001
status: dormant
planted: 2026-05-26
planted_during: Phase 3 (MCP Server Scaffold) — v0.1
trigger_when: v0.3 — Workspaces + Project DOs (before any UserDO / TeamDO / ProjectDO work begins)
scope: medium
---

# SEED-001: Cross-layer recall must fan out across UserDO + TeamDO + ProjectDO and re-rank merged results

## Why This Matters

Cross-layer recall is the crux of Engram's killer demo — one `recall()` traversing personal + team + project memory in a single call. The roadmap and CLAUDE.md describe the hierarchy:

```
UserDO          personal memories, identity, preferences
  └── TeamDO    shared team knowledge, membership
        └── ProjectDO   isolated per-project memory (own DO, not partition)
```

Project DOs are deliberately isolated (not partitions of TeamDO) — that's an architectural strength for clean archive/delete/transfer. But isolation (the strength) and unified query (the demo) are in **direct tension**.

The product question: when a user calls `recall("what did we decide about auth?")`, the request must fan out to potentially N isolated SQLite stores, query each, merge the results, re-rank across stores (where vector scores are per-namespace and not directly comparable), deduplicate cross-references, and return a single ranked list — all within the response latency budget.

This is the single hardest thing in the product. The architecture currently treats it as a given. It is not a given.

## When to Surface

**Trigger:** Run before the first phase of v0.3 — Workspaces + Project DOs is planned. Specifically: before `/gsd:plan-phase` is invoked for any phase that creates `UserDO`, `TeamDO`, or `ProjectDO` classes, or that extends `recall()` / `reflect()` to cross-DO query semantics.

This seed will surface during `/gsd:new-milestone` when v0.3 scope is being defined.

## Scope Estimate

**Medium** — A design spike (`/gsd:spike`) followed by a dedicated planning phase. Likely 1 design session + 1 implementation phase. The design questions to answer:

1. **Fan-out mechanism:** Does the MCP Worker query each DO sequentially, in parallel via `Promise.all`, or via a fan-out coordinator DO that batches? What's the failure mode when one DO is hibernating / slow?
2. **Vectorize score comparability:** Vectorize uses one global index with workspace namespaces. Are namespace-scoped cosine scores directly comparable across namespaces? Or does each DO need to return its raw vector and the MCP layer re-scores against a single query embedding?
3. **Merge + re-rank algorithm:** Round-robin? Weighted by scope (personal > project > team for personal queries)? Reciprocal rank fusion? The hybrid ranking proposal (see todo: phase-5-hybrid-ranking) applies here too.
4. **Deduplication:** When the same memory is referenced from a personal note AND a project note (e.g., via a `relation`), only return one — which one wins?
5. **Latency budget:** What's the p95 target for cross-layer recall? How many DOs can fan out before we hit the budget?
6. **Permission boundary:** When fanning out from a UserDO call, which TeamDOs / ProjectDOs is the user actually allowed to query? Where does that membership check happen?

## Breadcrumbs

- `CLAUDE.md` §"Durable Object Per Workspace" + §"DO Hierarchy" — current design
- `.planning/REQUIREMENTS.md` — v0.3 milestone "v0.3 Workspaces + Types" target 2026-07-12
- `.planning/ROADMAP.md` — v0.1 phases 1–7 only; v0.3 phases not yet planned
- `packages/workspace-do/src/queries.ts` — current single-DO query layer; the cross-DO orchestrator does NOT live here, it must live in mcp-server or a new fan-out worker
- Phase 5 success criterion #2 mentions Vectorize namespaces (`namespace = workspace_id`) — this is the foundation, but cross-namespace querying is undocumented

## Notes

Captured 2026-05-26 from architectural critique of the v0.1 design. Flagged as "the single hardest thing in the product" — should not be discovered during v0.3 implementation; needs design ahead of planning.

When this seed surfaces, run `/gsd:spike cross-layer-recall` before any v0.3 planning phase.
