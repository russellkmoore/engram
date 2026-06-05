# Phase 2: Recall Quality Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in `02-CONTEXT.md` — this log preserves the discussion that produced them.

**Date:** 2026-06-05
**Phase:** 02-recall-quality-baseline
**Mode:** discuss (default, no `--auto` / `--all` / `--text` / `--batch` / `--analyze` / `--power`)
**Areas discussed:** Grid search axis + values (RNK), Hybrid-rank key naming (Phase 3 forward-compat), Conflict-pipeline neighbor query strategy (CON), Eval corpus single-source-of-truth (RNK eval wiring)
**Areas skipped:** None — user selected all 4 candidate gray areas.

---

## Pre-discussion analysis

### Gray areas surfaced by scout + REQUIREMENTS/ROADMAP analysis

12 candidate gray areas were considered; 4 were presented as having multiple defensible options that genuinely change implementation. The other 8 were either already locked by REQUIREMENTS/ROADMAP success criteria (e.g., "ctx.waitUntil after updateBlockEnrichment" = CON-03 verbatim) or fell under Claude's discretion (e.g., test naming).

### Locked-pre-discussion (carried forward to CONTEXT.md without re-asking)

- Grid: 4 weights × 5 values = 625 configs (RNK-01)
- Pareto front by F1+MRR+top-1 (RNK-02)
- Train→validate gap <10pp (RNK-03)
- F1 ≥ v0.1 baseline 0.83 (RNK-06)
- Conflict prefilter cosine ≥0.7, top-K=3 (CON-02)
- Dupe guard ≥0.92, >180d → severity="low" (CON-06)
- Per-write conflict budget = 3 (CON-07)
- Conflicts → inbox table only, `conflicts` table reserved for v0.3 (CON-04)
- `ctx.waitUntil()` after `updateBlockEnrichment` in store-normal branch (CON-03)
- No proactive notifications, anywhere (CON-08)
- Land RNK before CON in commit order (parallel-track risk note)

### Carried forward from Phase 1 (Foundation)

- 100-entry labeled corpus at `.planning/evals/recall-corpus.json` exists (PRE-03 ✓)
- Vitest `eval` tier with MAX_AI_CALLS=200 guard exists (PRE-02 ✓)
- Integration matrix at `.planning/research/v0.2-INTEGRATION-MATRIX.md` (PRE-04 ✓)
- cf-code-assist routing tracker pattern at `01-CF-CODE-ASSIST-USAGE.md` (PRE-05 ✓)
- Embedding-version audit gates against qwen3-embedding-0.6b (PRE-01 ✓)

---

## Discussion turns

### Turn 1 — Area selection (multiSelect)

**Question:** Phase 2 has these genuine implementation gray areas. Which do you want to discuss?

**Options presented:**
1. Grid search axis + value choice (RNK)
2. Hybrid-rank weight key naming (Phase 3 forward-compat)
3. Conflict-pipeline neighbor query strategy (CON)
4. Eval corpus single-source-of-truth (RNK eval wiring)

**User selection:** All 4.

---

### Turn 2 — Area 1: Grid search axis + value choice (RNK-01..04)

**Question:** What 5-value grid per weight? (PITFALLS HR-3 is the weight-stability gate; HR-2 is reward-hacking on F1 alone.)

**Options presented:**
1. **Symmetric around current defaults** — cosine ∈ {0.6, 0.8, 1.0, 1.2, 1.5}, recency ∈ {0.05, 0.1, 0.15, 0.2, 0.3}, type_match ∈ {0.1, 0.15, 0.2, 0.25, 0.35}, scope_match ∈ {0.05, 0.1, 0.15, 0.2, 0.3}. Defaults at center (index 2); RNK-04 ±0.05 sensitivity maps to adjacent grid neighbors.
2. **Uniform {0, 0.05, 0.1, 0.2, 0.3} from zero** for all 4 weights. Exposes the cosine=0 tail; all-zeros config nonsensical (drop).
3. **Log-spaced centered on defaults** — better order-of-magnitude coverage but awkward to defend in changelog.

**User selection:** Symmetric around current defaults.

**Captured as:** D-01, D-02 in CONTEXT.md. RNK-04 sensitivity analysis can reuse sweep output rather than running a separate ±0.05 perturbation pass — adjacent grid neighbors ARE the perturbations.

---

### Turn 3 — Area 2: Hybrid-rank weight key naming (Phase 3 forward-compat)

**Question:** Which key naming approach for Phase 2's HYBRID_WEIGHTS commit?

**Options presented:**
1. **Stay `cosine` in Phase 2; Phase 3 renames** — clean per-workstream history, values-only diff in Phase 2.
2. **Rename to `rerank` now in Phase 2** — one ai-config structural change, but `rerank` weight populated by raw cosine for one milestone is a footgun.
3. **Introduce both keys, deprecate `cosine` in Phase 3** — two-name temporary state, worst-of-both.

**User selection:** Rename to `rerank` now in Phase 2.

**Captured as:** D-05, D-06, D-07 in CONTEXT.md. The footgun is mitigated by a MANDATORY load-bearing audit comment (D-06) that spells out the cross-phase contract verbatim. The audit comment is treated as part of the contract, not a code comment afterthought.

---

### Turn 4 — Area 3: Conflict-pipeline neighbor query strategy (CON-02)

**Question:** How should `conflict-pipeline.ts` get its top-K same-type same-workspace neighbors?

**Options presented:**
1. **Inline Vectorize query in conflict-pipeline.ts** — smallest diff; filter shape duplicated across files.
2. **Factor out shared helper in `shared/vectorize-utils`** — single contract, monorepo build-order cost.
3. **Helper inside triage-worker only** — no shared-package churn, drift risk vs Phase 3 query-expansion.

**User selection:** Factor out shared helper in `shared/vectorize-utils`.

**Captured as:** D-08 in CONTEXT.md.

---

### Turn 5 — Area 3 follow-up: Scope of `shared/vectorize-utils`

**Question:** What's the scope of `shared/vectorize-utils` in Phase 2?

**Options presented:**
1. **Just `vectorizeNeighbors` — minimum viable shared** — keeps mcp-server's recall-path `vectorizeQuery` in place; minimal recall-path regression risk.
2. **Extract both `vectorizeNeighbors` + `vectorizeQuery`** — one home for all Vectorize wrappers; recall-path refactor lands in Phase 2.

**User selection:** Extract both.

**Captured as:** D-09, D-10 in CONTEXT.md. The implication — RNK workstream now includes a real recall-path refactor (mcp-server `tools.ts` imports from `shared/vectorize-utils`) — is explicit in D-09 so the planner sizes the RNK plan appropriately.

---

### Turn 6 — Area 4: Eval corpus single-source-of-truth

**Question:** Where does the Phase 2 weight-sweep eval read the corpus from, and what happens to the existing 27/20-entry fixtures?

**Options presented:**
1. Read directly from `.planning/evals/recall-corpus.json`; deprecate old fixtures.
2. Vendor into fixtures dir; deprecate old fixtures.
3. Read directly from .planning; KEEP old fixtures as smoke-test backup.
4. Vendor into fixtures dir; KEEP old fixtures as smoke-test backup.

**User response:** "unsure what the difference would be, Claude can decide best path" → deferred to Claude's discretion.

**Claude's resolution:** Selected option 4 (vendor + keep old fixtures). Rationale:

- **Vitest discipline favors package-local fixtures.** Cross-tree relative paths from `packages/mcp-server/src/__tests__/evals/` to `.planning/evals/` break under CI cwd changes and confuse the workerd-pool resolver. Vendoring into the package eliminates this class of failure.
- **RNK-06 baseline preservation.** RNK-06's gate is "F1 ≥ v0.1 baseline (0.8254 on 27-entry corpus)." Keeping `real-corpus.json` + the existing `recall-f1.eval.test.ts` running gives a direct apples-to-apples regression check; deleting it loses that signal. The 27 entries are Russell's manual labels from v0.1 production logs — the closest thing to a known-good baseline.
- **Sync script is generation-routable.** `scripts/sync-eval-corpus.mjs` is a ~5-line file copy with a header comment — clean cf-code-assist `generateCode` shape (logged in D-19's routing-tracker seeds).

**Captured as:** D-11, D-12, D-13, D-14, D-15 in CONTEXT.md. D-15 adds a small-N caveat surfacing logic to the RNK-06 gate.

---

## Cross-cutting decisions added without explicit Q&A

These emerged from analysis during the discussion and were captured because the planner needs them:

- **D-16:** RNK lands before CON in main (already implied by ROADMAP's parallel-track note; made operational for the planner).
- **D-17:** Two Linear sub-issues under Phase 2 ENG issue (RNK + CON) per ROADMAP's "sub-issues if scope warrants" — both workstreams meet that bar.
- **D-18:** CON-01 prompt re-eval failure procedure → STOP + blocker + `--replan-section`. Operational definition of REQUIREMENTS CON-01's "planning re-opens the prompt."
- **D-19:** Phase 2 cf-code-assist routing tracker scaffolded at `02-CF-CODE-ASSIST-USAGE.md` per Phase 1 PRE-05 pattern. Specific task-shape seeds listed.
- **D-20:** Conflict-pipeline observability via Analytics Engine `writeDataPoint` (activates the existing stub binding) + GraphQL nightly summary extension. Defends CON-07's 4s p99 budget.
- **D-21:** `docs/hybrid-rank-changelog.md` row schema spelled out so RNK-07 has a concrete artifact contract (and future rows have a stable shape).

---

## Specifics surfaced during discussion

- **Audit comment as contract** (D-06) — Russell hadn't explicitly asked for it but the cross-phase footgun of "rerank weight tuned against raw cosine" is severe enough that the audit comment is load-bearing. Spelled out verbatim in CONTEXT.md.
- **30-pair vs 50-pair conflict eval** — ROADMAP §"Phase 2 Success Criteria #4" says "50-pair" but REQUIREMENTS CON-01 says "30-pair" and the live fixture `_meta.target_size = 30` is READY. Phase 2 follows the fixture and CON-01 (30 pairs). ROADMAP wording is stale.

---

## Deferred ideas

None surfaced during this discussion that aren't already captured in REQUIREMENTS / ROADMAP / CONTEXT.md `<deferred>` section.

---

## Process notes

- **Discussion length:** 1 area-selection turn + 5 deep-dive turns = 6 AskUserQuestion calls total. Default-mode budget allows up to 16 (4 areas × 4 turns each); kept tight because most ROADMAP success criteria were already operational locks.
- **Sub-agent usage:** 1 `Explore` agent scout pass (~300 lines compact codebase report). No `gsd-assumptions-analyzer` or other deep-codebase agents needed.
- **No `--analyze` overlay used** — the trade-off tables were embedded directly in option descriptions per the user's deliberate-informed decision profile.
