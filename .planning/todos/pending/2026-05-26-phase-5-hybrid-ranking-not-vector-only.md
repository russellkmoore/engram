---
created: 2026-05-26T06:27:31.049Z
title: "Phase 5: Implement hybrid ranking (vector + recency + type + scope) instead of vector-only"
area: database
phase_target: "05-ai-integration"
files:
  - CLAUDE.md
  - packages/workspace-do/src/queries.ts
  - packages/mcp-server/src/tools.ts
---

## Problem

CLAUDE.md `## What Goes Where` table currently states "Semantic ranking → Vectorize". The principle "Vectorize ranks, never Claude" leans too hard on pure cosine similarity. For memory retrieval specifically, vector similarity is a *weak* ranker — recency, type, scope, and explicit relations matter at least as much as raw semantic proximity in many cases:

- Recall("what did we decide about auth?") — the *most recent* `decision_log` entry should win even if an older `research_note` is more semantically similar
- Recall("Slack thread about onboarding") — `type: meeting_note` and `source: connector:slack` should rank above a `research_note` with higher cosine score
- Recall in a multi-workspace context — `scope: project` matches should beat `scope: personal` when the user is in a project context

The Engram schema already has every signal needed for hybrid ranking:
- `blocks.tags` (user + AI applied)
- `blocks.relations` (explicit knowledge graph edges)
- `blocks.scope` (personal | project | org)
- `blocks.project_id`
- `blocks.type` (memory type)
- `blocks.created_at` / `updated_at`
- `blocks.confidence` (CF AI classification confidence)

Phase 5 success criterion #4 says: "`recall()` embeds the query via the same model, queries Vectorize top-K within the workspace namespace, hydrates the matching block records from SQLite, and returns ranked semantic results." This is currently spec'd as Vectorize-ranked only.

## Solution

Implement hybrid ranking as the default in Phase 5's `recall()` and `reflect()`:

```
final_score = (w_vec * cosine_similarity)
            + (w_recency * exp(-age_days / half_life))
            + (w_type * type_boost[memory_type])
            + (w_scope * scope_match_boost)
            + (w_relation * has_explicit_relation_to_query_entities)
```

Suggested starting weights (tunable):
- `w_vec = 0.5` — vector score remains the dominant signal
- `w_recency = 0.25` — half-life of 14 days
- `w_type = 0.10` — boost decision_log / meeting_note in "what did we decide" queries (detected by query intent classification)
- `w_scope = 0.10` — boost in-scope memories
- `w_relation = 0.05` — small boost for explicit graph relations

Vectorize still does the top-K candidate fetch (e.g., top-50). The hybrid re-rank runs in the WorkspaceDO query layer against the K hydrated rows. Negligible latency cost; massive quality improvement.

Update CLAUDE.md `## What Goes Where` to:
- Semantic candidate fetch → Vectorize
- Hybrid re-rank (vector + recency + type + scope + relations) → WorkspaceDO query layer
- Reasoning + synthesis → Claude

## Rationale

Architectural critique from 2026-05-25 conversation: "Pure cosine similarity is a weak ranker for memory — recency, type, scope, and explicit relations all matter more than raw semantic proximity in many cases. You have the pieces (tags, relations, structured props) but the stated principle ignores them. You want hybrid ranking with recency decay, not vector-score-as-truth."
