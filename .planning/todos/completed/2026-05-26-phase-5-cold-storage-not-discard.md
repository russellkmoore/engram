---
created: 2026-05-26T06:27:31.049Z
title: "Phase 5: Replace memorability<0.4 discard with cold-storage bucket"
area: database
phase_target: "05-ai-integration"
files:
  - CLAUDE.md
  - packages/triage-worker/
  - packages/workspace-do/src/schema.ts
---

## Problem

CLAUDE.md `## Ingest Pipeline` step 5 currently specifies:

> CF AI: score memorability (0-1)
>   > 0.8  → store automatically
>   0.4-0.8 → inbox for review
>   < 0.4  → **discard**

Silently losing something a user wanted to keep, based on a small model's score, is the cardinal sin of a memory product. It will destroy trust faster than any other failure mode. The Workers AI scorer is unproven; calibration drift between model versions is likely; a single under-scored entry can be a job offer email, a key decision, or a deadline.

Phase 5 is where Triage Worker actually runs `env.AI.run('@cf/meta/llama-3.1-8b-instruct', ...)` and routes by memorability score (per ROADMAP Phase 5 success criterion #5). This is the moment the discard rule becomes real code.

## Solution

Default to cold-storage, never hard-discard — at least until the scorer is empirically proven on real Engram data.

Concrete changes:

1. **Schema:** Add `blocks.cold_storage BOOLEAN DEFAULT FALSE` (or a separate `cold_blocks` table — TBD during Phase 5 planning). Cold-stored entries:
   - Are excluded from default `recall()` results
   - Are NOT indexed in Vectorize (cost savings — embedding skipped)
   - Are queryable via an explicit `include_cold: true` parameter or a separate `recall_cold()` tool
   - Have a 90-day TTL (configurable via `expires` from the MemoryEvent if user-set; default 90d if scorer-driven)

2. **Triage Worker:** Update memorability routing:
   - `> 0.8` → store normally (Vectorize + indexed)
   - `0.4–0.8` → write to `inbox` for human review
   - `< 0.4` → write to cold-storage (NOT discard) with a log line and `meta.demoted_reason: "memorability<0.4"`

3. **Inbox UI (v0.2):** Surface cold-storage items as a "Demoted" tab so users can manually promote back if the scorer was wrong.

4. **CLAUDE.md:** Update the Ingest Pipeline section to remove the "discard" branch.

Cheap insurance against the cardinal sin. Cost: a column, a query path, a routing change in triage. Done in Phase 5 alongside the AI integration that introduces the risk.

## Rationale

Architectural critique from 2026-05-25 conversation: "memorability < 0.4 → discard is the cardinal sin of a memory product. Silently losing something a user wanted to keep, based on a small model's score, will destroy trust faster than any other failure. Default to inbox/cold-storage, never hard-discard — at least until the scorer is proven."

---

## Closure (2026-05-30, ENG-14 audit)

**Status:** Resolved by Phase 5 D-07. Audit confirmed all asks shipped:

- `blocks.cold_storage` column added via v2 migration (`packages/workspace-do/src/schema.ts:146`)
- v2 entry in `MIGRATIONS` runner (`packages/workspace-do/src/migrations.ts`)
- `moveToColdStorage(workspace_id, block_id)` helper added (`packages/workspace-do/src/queries.ts:699`); ONLY writer of `cold_storage = 1`
- Triage Worker routes `memorability < 0.4` to `moveToColdStorage`, NEVER discard (`packages/triage-worker/src/index.ts:17` cardinal-sin comment)
- `routeByMemorability` predicate in `packages/triage-worker/src/memorability.ts` handles the routing
- CLAUDE.md `## Ingest Pipeline` step 5 reflects cold-storage routing (NEVER discard)
- Zero `discard*` calls in production code paths (verified by grep)

The "cardinal sin" of silently losing user data is structurally prevented.
