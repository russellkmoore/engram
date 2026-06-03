---
phase: 1
slug: foundation-wave-0
mode: chunked-outline
created: 2026-06-02
plan_count: 5
wave_count: 3
---

# Phase 1 — Plan Outline Manifest

> Chunked-mode outline. Per-plan PLAN.md files will be produced by separate planner spawns, one plan at a time, each reading this manifest plus their assigned row's source artifacts (REQUIREMENTS.md / RESEARCH.md / PATTERNS.md / VALIDATION.md).

## Plan Manifest

| Plan ID | Objective | Wave | Depends On | Requirements |
|---------|-----------|------|------------|--------------|
| 01-01 | Migration audit: `scripts/audit/embedding-version-audit.ts` + `WorkspaceDO.assertAllBlocksAtV2()` admin RPC + `countStaleEmbeddings` query helper + `.github/workflows/ci.yml` audit job. NULL-trap SQL `WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?` is non-negotiable (Pitfall 1 cardinal-sin defense). Cross-workspace enumeration via Cloudflare DO Namespace List API; per-workspace RPC call; exit 1 on any non-zero count_stale. | 1 | — | PRE-01 |
| 01-02 | Tiered vitest config (`unit` / `integration` / `eval` projects) in `packages/mcp-server/vitest.config.ts` + `packages/triage-worker/vitest.config.ts` + optional `packages/workspace-do/vitest.config.ts`. Eval project gated on `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` with `hasEvalCreds` ternary; `setupFiles: ["./src/__tests__/evals/eval-budget.setup.ts"]` wraps `env.AI.run` + `env.VECTORIZE.query` with shared MAX_AI_CALLS=200 counter (`isolate: false` + `singleWorker: true` per Pitfall 3); fail-loud CI step (Pitfall 2/7); `scripts/eval-budget-summary.mjs` GraphQL Analytics caller for daily neuron-summary. | 2 | 01-01 | PRE-02 |
| 01-03 | Integration matrix `.planning/research/v0.2-INTEGRATION-MATRIX.md` enumerating cross-feature E2E targets (RNK × CON, RNK × EXP, EXP × SYN, CON × SYN, kitchen-sink, adaptive-routing × cosine-edge). Markdown table with columns `Feature Pairing | Covering Plan | Test File | Status | Notes`; cells start as `pending` with `0N-XX` placeholders; cell vocabulary `tested / pending / out-of-scope` (Phase 5 INT-04 will grep these literals); footer rule binds Phases 2..5 plans to close pending cells. | 2 | 01-01 | PRE-04 |
| 01-04 | CF code-assist tracker scaffold `.planning/phases/01-foundation-wave-0/01-CF-CODE-ASSIST-USAGE.md` — verbatim copy of canonical Phase 5 v0.1 instance (`.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`) sections 2-4 (Instructions, 3-Question Checklist, Routing Log table header + seed row). Swap phase number 5→1, scope statement to "foundation phase, expected <10% cf-code-assist mix", stop-trigger to `/gsd:verify-work 1`. End-of-Phase Summary left as `_TBD_` until verify-work passes. NOTE: REQUIREMENTS.md PRE-05 path `.planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md` is speculative; actual phase dir is `.planning/phases/01-foundation-wave-0/` — the plan targets the actual dir. | 2 | 01-01 | PRE-05 |
| 01-05 | Eval corpus expansion `.planning/evals/recall-corpus.json` from 47 → ≥100 entries with 70/30 stratified-by-bucket train/validate split. Header object wraps entries with `corpus_version`, `embedding_model: "@cf/qwen/qwen3-embedding-0.6b"` (verified equal to `EMBEDDING_MODEL` constant), `sources`, `buckets`; per-entry shape `{ id, bucket, query, expected_top_3_block_ids, split, labeled_by, labeled_at, expected_synthesis: null }`. Sources: v0.1 production recall logs (35), ingested Notion/Drive snippets (30), carried-forward reference-corpus (20) + real-corpus (15). `block_ids` reference dedicated `eval-fixtures` workspace (Pitfall 4 drift defense). Russell's manual labeling (~3-4 hours) is the critical-path checkpoint. | 3 | 01-01, 01-02 | PRE-03 |

## Wave Structure

- **Wave 1** (no deps): 01-01 (migration audit gates everything downstream — clean blocks must be asserted before any eval/corpus work runs against potentially-corrupt vector data)
- **Wave 2** (depends on 01-01): 01-02 (tiered tests), 01-03 (integration matrix), 01-04 (cf-code-assist tracker) — all three are parallel-trackable (no shared files; 01-02 touches `packages/*/vitest.config.ts` + `.github/workflows/ci.yml` + `scripts/`, 01-03 touches `.planning/research/`, 01-04 touches `.planning/phases/01-foundation-wave-0/`)
- **Wave 3** (depends on 01-01 + 01-02): 01-05 (corpus expansion — requires clean blocks from 01-01 AND the eval tier from 01-02 to validate the corpus shape via row-count + split-ratio assertions)

## Requirement Coverage Audit

| Requirement | Covered By | Cross-Plan? |
|-------------|------------|-------------|
| PRE-01 | 01-01 | No |
| PRE-02 | 01-02 | No |
| PRE-03 | 01-05 | No |
| PRE-04 | 01-03 | No |
| PRE-05 | 01-04 | No |

All 5 phase requirement IDs covered. No requirement crosses multiple plans (each is 1:1 with a plan), so no duplicate `Requirements` column entries needed.

## Plan-Level Notes for Per-Plan Spawns

### 01-01 (PRE-01 Migration Audit)

- Per RESEARCH §"Pattern 1" and PATTERNS.md `scripts/audit/embedding-version-audit.ts` row: use TypeScript (`.ts` not `.mjs`) via `tsx`, native `fetch` (NOT `spawnSync wrangler` — DO Namespace List API has no wrangler CLI surface).
- `WorkspaceDO.assertAllBlocksAtV2()` RPC: `this.assertOwnsWorkspace(args.workspace_id)` MUST be FIRST executable line (STO-07 discipline). Delegate to `countStaleEmbeddings` query helper in `queries.ts`.
- SQL clause `WHERE embedding_version IS NULL OR embedding_version < 2 OR embedding_model != ?` is byte-load-bearing (cardinal-sin defense). Plan must include a unit test (`packages/workspace-do/src/__tests__/embedding-version-audit.test.ts`) that seeds NULL-stamped + wrong-model fixtures via `runInDurableObject` and asserts `count_stale > 0`.
- `EMBEDDING_MODEL` imported from `@engram/ai-config` — NEVER inline the literal string `"@cf/qwen/qwen3-embedding-0.6b"`.
- CI job: hoist `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` + `WORKSPACE_NAMESPACE_ID` to step-level `env:` block (Pitfall 7); fail-loud `::error::` on missing secrets (Pitfall 2).
- NEW secret `WORKSPACE_NAMESPACE_ID` requires a `checkpoint:human-action` task — Russell must provision it in GitHub repo settings.
- Audit script secrets discipline: token from env only, never `console.log`, never positional argv.

### 01-02 (PRE-02 Tiered Vitest)

- DEPENDS ON 01-01: the eval tier exists to run the corpus eval (PRE-03 in Wave 3) which requires clean blocks asserted by PRE-01. If 01-01's audit surfaces non-zero stale rows, 01-02's eval tier may run against corrupt data; the dep ordering prevents this.
- `MAX_AI_CALLS = 200` is the contract — NOT env-configurable. Anti-pattern: "inflate the cap when tests fail" is explicit in RESEARCH §"Anti-Patterns".
- `isolate: false` + `singleWorker: true` shares the counter across files (Pitfall 3). If workerd-pool semantics reject this combo, fallback is post-hoc Workers Analytics Engine aggregation per RESEARCH §Pitfall 3 — this is a discuss-phase fork; the plan should default to (a) and document the fallback path.
- `triage-worker/vitest.config.ts` is currently single-project; convert to multi-project using `mcp-server/vitest.config.ts` shape as the template (PATTERNS.md confirms this).
- `eval-budget.setup.ts` lives canonically in `packages/mcp-server/src/__tests__/evals/`; triage-worker references via relative path OR a re-export shim.
- `scripts/eval-budget-summary.mjs` borrows CLI skeleton from `scripts/kv-bootstrap.mjs`; GraphQL fetch body is verbatim from RESEARCH §"Example 4". `.mjs` not `.ts` (matches `kv-bootstrap.mjs` precedent for tiny reporting scripts with no shared types).
- `aiInferenceAdaptive` dataset may not surface for non-AI-Gateway Workers AI usage (RESEARCH §A5) — script emits warning on zero-rows-returned, NOT "0 neurons" silently.

### 01-03 (PRE-04 Integration Matrix)

- Pure prose deliverable; no code. Markdown table with vocabulary `tested / pending / out-of-scope` (Phase 5 `/gsd:verify-work 5` greps these literals).
- Cell `Covering Plan` starts as placeholders `0N-XX`; Phase 2/3/4/5 PLAN.md files overwrite with real IDs.
- Footer rule prose IS the plan-checker enforcement contract — keep verbatim from PATTERNS.md.
- No `assertOwnsWorkspace` / RPC / SQL — this is planning artifact only.

### 01-04 (PRE-05 CF-Code-Assist Tracker)

- Copy-and-rename operation against `.planning/milestones/v0.1-phases/05-ai-integration/05-CF-CODE-ASSIST-USAGE.md`. Sections 2-4 (Instructions, 3-Question Checklist, Routing Log table header + seed row) are byte-verbatim.
- Header adapted: phase 5 → 1, scope "AI Integration" → "foundation phase", expected routing mix "40-60%" → "<10%", stop-trigger `/gsd:verify-work 5` → `/gsd:verify-work 1`.
- Seed row literal: `| _seed_ | _(no rows yet — first executor task appends below this line)_ | _n/a_ | _n/a_ | _Tracking starts at execute-phase kickoff_ | _n/a_ |`.
- End-of-Phase Summary section structure copied; values stay as `_TBD_` until `/gsd:verify-work 1` passes.
- **Path discrepancy:** REQUIREMENTS.md PRE-05 (line 23) references `.planning/phases/01-foundation/01-CF-CODE-ASSIST-USAGE.md` which does NOT match the actual phase dir `.planning/phases/01-foundation-wave-0/`. The plan targets the ACTUAL dir; the per-plan spawn should call this out in the plan's `<action>` so reviewers know the requirement-spec drift is intentional (real dir > speculative reference).
- File-locking discipline for parallel tracker appends (Pitfall 6): single `Edit` operation with explicit `oldString` matching preceding row + seed comment; NEVER parallel `Edit`s.

### 01-05 (PRE-03 Eval Corpus Expansion)

- DEPENDS ON 01-01: corpus block IDs reference an `eval-fixtures` workspace; that workspace must contain clean-stamped (qwen3 1024d) blocks. 01-01 asserts that's true.
- DEPENDS ON 01-02: the eval tier must exist for the corpus row-count + split-ratio assertions to run automatically. Plan-checker rejects PRE-03 close-out if eval tier isn't green.
- Russell's manual labeling (~3-4 hours, ~50 net-new queries + intended block IDs) is the gating critical path. Plan MUST include a `checkpoint:human-action` (or `checkpoint:human-verify` if Claude pre-labels and Russell reviews) — REQUIREMENTS.md ROADMAP risk note calls this out explicitly.
- Schema preserves bucket vocabulary `critical-path / known-failure / extraction / edge` from existing `reference-corpus.json` (the `CorpusEntry` type union in `recall-f1.eval.test.ts:26-35` depends on this).
- Per-entry `expected_synthesis: null` field is RESERVED for Phase 4 SYN-01 augmentation — landing it now prevents a schema migration later.
- Schema migration safety: PATTERNS.md §A6 notes the existing `recall-f1.eval.test.ts` consumes `intended_memory_id` (singular); the new `expected_top_3_block_ids` (array of 3) is a breaking change. Staged migration is a Wave 3 sub-task or a Phase 2 RNK-01 prerequisite — the plan must document which.
- `labeled_by: "russell"` literal is tamper-resistance signal (RESEARCH §Security).
- Corpus header `embedding_model` string MUST match `EMBEDDING_MODEL` constant by exact equality, verified at parse time in a corpus-schema unit test.

## Validation Strategy Alignment

Per `01-VALIDATION.md` Wave 0 Requirements:

- 01-02 closes "Tiered vitest config" + "MAX_AI_CALLS=200 counter wrapper" requirements.
- 01-01 closes "Migration audit script" requirement.
- 01-05 closes "recall-corpus.json schema validator" requirement (the schema validator unit test ships alongside the corpus file).
- `nyquist_compliant: true` will be set in `01-VALIDATION.md` frontmatter once all per-plan spawns complete and per-task verification rows are populated.

## OUTLINE COMPLETE

**Plan count:** 5
**Wave count:** 3
**Output path:** `.planning/phases/01-foundation-wave-0/01-PLAN-OUTLINE.md`
