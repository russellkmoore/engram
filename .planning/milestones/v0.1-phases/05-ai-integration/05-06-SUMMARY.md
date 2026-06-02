---
phase: 05-ai-integration
plan: "06"
subsystem: evals
status: partial — Task 4 + weight tuning deferred to follow-up
tags:
  - wave-4
  - eval-harness
  - promptfoo
  - f1
  - hybrid-rank
  - ai-04
  - ai-05
  - ai-06

dependency_graph:
  requires:
    - 05-01 (wrangler bindings, RED stubs, schema migration)
    - 05-02 (vectorize-helper, ai-helper, hybrid-rank)
    - 05-03 (remember + envelope.ts contract)
    - 05-04 (triage-worker ai-helper sibling, schemas, prompts, memorability, extract)
    - 05-05 (recall semantic pipeline — recovered/cherry-picked in this plan)
  provides:
    - mise.toml — pins Node 22.22.3 for the repo
    - packages/triage-worker/package.json — adds promptfoo@^0.121.13 devDependency
    - 20-example PII-sanitized reference-corpus.json (4 buckets of 5)
    - recall-f1.eval.test.ts harness (BOTH reference + real corpus describe blocks; both it.skip until nightly CI)
    - embedding-consistency.test.ts (AI-SPEC §5 dimension #2 — 3/3 GREEN)
    - triage-extraction.promptfoo.yaml (AI-SPEC §5 dimension #4 — gated to nightly CI)
    - memorability-calibration.eval.test.ts (AI-SPEC §5 dimension #5 — it.skip until nightly CI)
    - recall-side query-length truncation warn (T-05-05-TRUNC backfill)
    - META_GAPS.recallQueryTruncated byte-frozen string
    - npm run evals:vitest / evals:promptfoo / evals:ci scripts
    - predeploy hook → npm run evals:ci
  deferred:
    - Task 4 — real-corpus.json sanitization (Russell-driven manual work)
    - Task 5.1 — hybrid-rank weight tuning A/B (depends on Task 4's real corpus)
    - AI-04 closure decision in REQUIREMENTS.md (depends on Task 4's F1 result)
    - 05-REAL-CORPUS-RESULTS.md (depends on Task 4)

verification:
  green:
    - "Task 1 — promptfoo legitimacy audit APPROVED + installed; Node bumped to 22.22.3"
    - "Task 2 — reference-corpus.json (20 entries, 4 buckets of 5) + recall-f1.eval.test.ts (compiles + it.skip GREEN)"
    - "Task 3 — embedding-consistency.test.ts 3/3 GREEN; Promptfoo YAML written; memorability-calibration.eval.test.ts compiles + it.skip GREEN"
    - "Task 5.2 — T-05-05-TRUNC backfill in recall handler; META_GAPS.recallQueryTruncated added; snapshot updated; 128/128 tests pass + 5 skipped"
    - "Task 5.4 — evals:ci wiring in root package.json; npm run evals:vitest exit 0"
  red:
    - "Task 4 — real-corpus.json NOT yet curated (manual Russell task)"
    - "Task 5.1 — hybrid-rank weight tuning NOT yet performed (depends on Task 4)"
    - "Task 5.3 — AI-08 sleep-vs-poll: SKIPPED (no flake observed in 05-05 SUMMARY)"
  deferred:
    - "Real-Vectorize F1 measurement (reference + real corpus) — nightly CI removes it.skip"
    - "Real-llama memorability distribution — nightly CI removes it.skip"
    - "Promptfoo CI run against Workers AI — requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in env"

requirements_closed:
  - AI-04: code path complete, gate ENFORCED but DEFERRED (real-corpus F1 measurement → Task 4 follow-up)
  - AI-05: code path complete, gate ENFORCED but DEFERRED (Promptfoo JSON parse rate → nightly CI)
  - AI-06: code path complete, gate ENFORCED but DEFERRED (memorability calibration → nightly CI)

incident_notes:
  - "Plan 05-05 missing-merge regression detected and corrected during Plan 05-06 Task 5: the 05-05 executor's 3 commits (1af23ed, d31b1d8, 2f09969) had been authored on worktree-agent-a1c88fcbcc7faa0db but never reached main. The 'Already up to date' message during the earlier `git merge --ff-only worktree-agent-a1c88fcbcc7faa0db` masked the failure. Cherry-picked the 3 commits onto current HEAD as 5b53921, 692f9c0, ca60602. Verified semantic recall pipeline (vectorizeQuery + hybridRank + synthesis branch) is now actually in tools.ts (5 occurrences of vectorizeQuery/hybridRank). Verified 128/128 tests pass on the recovered tree (was 125 in 05-05 SUMMARY pre-recovery — gap was 3 new tests from the 05-05 cherry-picked commits, NOT from 05-06)."

---

# Plan 05-06 Summary — Wave 4: Eval Harness (PARTIAL)

> **Status: 4 of 5 tasks complete + 1 follow-up. Plan 05-06 is partially shipped pending Russell's real-corpus sanitization (Task 4). AI-04 / AI-05 / AI-06 code paths are GREEN; their closure gates are ENFORCED but DEFERRED to nightly CI (synthetic) and to a follow-up session (real-corpus carry-forward).**

## What Shipped

### Task 1 — Promptfoo install + Node version pin (commit `54dc725`)
- Package Legitimacy Audit surfaced via AskUserQuestion; Russell APPROVED `promptfoo/promptfoo @^0.121.13` (maintainers ianw + mdangelo + justinbeckwith all match GitHub owners; ~3 years established; ~7k stars).
- Transitive deps (`lint-staged@17.0.5`, `mute-stream@4.0.0`) required Node ≥22.22.2. Bumped local Node via `mise use node@22.22.3` and committed `mise.toml` so future contributors get the same Node version on `cd` into the repo.
- 587 packages added to node_modules (promptfoo's CLI + provider stack).

### Task 2 — 20-example reference corpus + F1 harness (commit `ac4ea09`)
- `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` — 20 PII-sanitized examples per AI-SPEC.md §5 spec, 4 buckets of 5:
  - **critical-path (5):** one per type for `job_application`, `contact`, `company`, `project`, `decision_log`. Russell-anchored: `ref-001` mirrors his "applied to REDACTED-CDN-CORP for Senior SWE" anchor query.
  - **known-failure (5):** semantic over-merge (two contacts same company), recency bias, underspecified query, homonym disambiguation (apple-CORP).
  - **extraction (5):** rich entity + extracted-field coverage per type.
  - **edge (5):** empty content (single space), long-content >1,800 chars, mixed-language (English + French inline), prompt-injection, Vectorize 429 retry fixture.
- PII discipline: `REDACTED-<INDUSTRY>-CORP` / `REDACTED-CONTACT-N` placeholders; only `russellkmoore@mac.com` is a real identity.
- **Russell should spot-check the corpus content before merging the phase branch.** A few examples lean on assumptions about his job-search workflow that may or may not feel right (`ref-001`'s `~$185k` salary band; `ref-003`'s Berlin-based REDACTED-EDGE-CORP framing; `ref-014`'s "Linear archive CLI" side-project framing). Edits are encouraged; the file is human-curated.
- `recall-f1.eval.test.ts` ships the F1 harness (precision@5 + recall@5 + per-example PASS/FAIL diagnostic). Both reference-corpus and real-corpus describe blocks are `it.skip` until nightly CI removes the skip (real Workers AI + Vectorize bindings required).
- AI-SPEC.md §5 dimension #1 PASS bar: **F1 ≥ 0.75** asserted via `toBeGreaterThanOrEqual(0.75)`. F1 below bar BLOCKS AI-04 closure.

### Task 3 — 3 eval gates (commit `36c5566`)
- `embedding-consistency.test.ts` — AI-SPEC §5 dimension #2 drift guard. Reads `triage-worker/src/ai-helper.ts` via `node:fs.readFileSync` and asserts byte-identical `EMBEDDING_MODEL` / `EMBEDDING_VERSION` / `CLASSIFIER_MODEL` across packages. **3/3 GREEN.** Runs in mcp-server's `lint-node` pool (sibling to `ai-helper-identity.test.ts`).
- `triage-extraction.promptfoo.yaml` — AI-SPEC §5 dimension #4 gate. Promptfoo `https` provider posts to `https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/meta/llama-3.1-8b-instruct`; 20-example sweep from the reference corpus; `is-json` primary assertion + soft classification-accuracy metric. PASS bar: `--threshold-pass-rate 95` (≥19/20 valid JSON). **Gated to nightly CI** — local execution requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env.
- `memorability-calibration.eval.test.ts` — AI-SPEC §5 dimension #5 gate. Routes the 20-example corpus through `extractAndScore` → `routeByMemorability` and asserts the 60/30/10 ±10pp distribution band (`pStore ∈ [0.5, 0.7]`, `pInbox ∈ [0.2, 0.4]`, `pCold ∈ [0, 0.2]`). **`it.skip` until nightly CI** — requires real llama-3.1-8b-instruct bindings.
- D-07 cardinal sin enforced via `RouteDecision` type — "cold-storage" not "discard".

### Task 5 partials (commit `e888caa`)
- **T-05-05-TRUNC backfill** — recall handler now checks `args.query.length > 1800` BEFORE the embed call; embeds the truncated slice; surfaces `META_GAPS.recallQueryTruncated` in `meta.gaps` when truncation fires. Byte-frozen string in `envelope.ts` mirroring the remember()-side `truncationOver1800Chars` contract. Snapshot updated additively.
- **`evals:ci` wiring** — root `package.json` now exposes:
  - `evals:vitest` — runs in-Vitest eval gates (embedding-consistency + recall-f1 + memorability-calibration) across both workspaces
  - `evals:promptfoo` — runs the AI-05 Promptfoo gate (`--threshold-pass-rate 95`)
  - `evals:ci` — aggregates both
  - `predeploy` — hooks `evals:ci` before any deploy
- **AI-08 sleep-vs-poll sub-task: SKIPPED.** Plan 05-05 SUMMARY records no flake observed for the existing 5-second sleep, so the simple pattern stays.

### Plan 05-05 missing-merge incident (commits `5b53921`, `692f9c0`, `ca60602`)
During Task 5, discovered that Plan 05-05's 3 commits (`1af23ed` / `d31b1d8` / `2f09969`) had been authored on `worktree-agent-a1c88fcbcc7faa0db` but never landed on main. The earlier `git merge --ff-only worktree-agent-a1c88fcbcc7faa0db` reported "Already up to date" — this was misleading; the worktree-branch tip was a sibling, not an ancestor. The 05-05 SUMMARY's claim that recall used the semantic pipeline was **incorrect** at the time of writing; this plan corrects it via cherry-pick. Tests still pass (128/128 + 5 skipped); the embedding/recall path now actually uses Vectorize + hybrid-rank end-to-end.

## What's Deferred (Follow-Up Session)

### Task 4 — Real-corpus sanitization + AI-04 closure decision
Russell-driven manual work:
1. Select 10–20 real samples from the job-search agent corpus (browser bookmarks, job-board scrapes, existing notes — whatever surface he's actually been using).
2. For each: PII-redact (companies → `REDACTED-<INDUSTRY>-CORP`, contacts → `REDACTED-CONTACT-N`, salaries → round bands like `~$180k`, non-self emails → `redacted@example.com`). Label against the 4-bucket structure; write a how-Russell-would-actually-recall-this `paraphrased_query`.
3. Commit to `packages/mcp-server/src/__tests__/evals/fixtures/real-corpus.json`.
4. Extend the REAL CORPUS `describe` block in `recall-f1.eval.test.ts` (currently a placeholder no-op) with the actual import + runF1Eval call.
5. Run `npm test --workspace=packages/mcp-server -- recall-f1.eval --run` with `.skip` removed; capture the F1 metric.
6. Write `.planning/phases/05-ai-integration/05-REAL-CORPUS-RESULTS.md` per the template in Plan 05-06 §Task 4.
7. AI-04 closure decision:
   - If F1 ≥ 0.75 → tick AI-04 in `REQUIREMENTS.md` with closure note `Closed YYYY-MM-DD, F1 X.XX on real-corpus N=NN`.
   - If F1 < 0.75 → AI-04 closure BLOCKED; proceed to Task 5.1 weight tuning; re-run; reconsider closure.

### Task 5.1 — Hybrid-rank weight tuning A/B
After Task 4 produces the real-corpus F1 baseline:
1. Override `HYBRID_WEIGHTS` in a test-only context with 3 candidate tuples:
   - A: `{ cosine: 1.0, recency: 0.3, type_match: 0.2, scope_match: 0.15 }` (recency-up)
   - B: `{ cosine: 1.0, recency: 0.15, type_match: 0.4, scope_match: 0.15 }` (type-up)
   - C: `{ cosine: 1.0, recency: 0.15, type_match: 0.2, scope_match: 0.3 }` (scope-up)
2. Run `recall-f1.eval` against real-corpus for each. Capture F1.
3. Pick winner. If it beats baseline by ≥3pp F1, persist the tuned weights in `hybrid-rank.ts` with audit comment `// tuned YYYY-MM-DD against real-corpus N=NN, prev F1=X.XX → new F1=Y.YY`.
4. If no tuple beats baseline by ≥3pp, keep starting weights + `// YYYY-MM-DD A/B tested 3 tuples; no tuple beat baseline by ≥3pp; starting weights retained.`
5. Update `hybrid-rank.test.ts` assertions if tuning persisted new weights.

### What Phase 5 verification needs
Verification can mark AI-04 / AI-05 / AI-06 as "code path complete, closure deferred-to-follow-up" — that's the honest accounting. The synthesis contract (Plan 05-07) does not depend on this real-corpus work, so Plan 05-07 can ship independently. The phase as a whole closes when Task 4 + Task 5.1 land in the follow-up session.

## Files Modified (this plan)
- `mise.toml` (NEW)
- `packages/triage-worker/package.json` (+1 dep)
- `package.json` (4 new scripts)
- `package-lock.json` (587 new packages)
- `packages/mcp-server/src/tools.ts` (T-05-05-TRUNC backfill at recall pre-embed)
- `packages/mcp-server/src/envelope.ts` (META_GAPS.recallQueryTruncated)
- `packages/mcp-server/src/__tests__/__snapshots__/envelope.test.ts.snap` (additive)
- `packages/mcp-server/src/__tests__/evals/fixtures/reference-corpus.json` (NEW)
- `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts` (NEW)
- `packages/mcp-server/src/__tests__/evals/embedding-consistency.test.ts` (NEW)
- `packages/mcp-server/vitest.config.ts` (+1 file in lint-node pool include + workerd exclude)
- `packages/triage-worker/evals/triage-extraction.promptfoo.yaml` (NEW)
- `packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts` (NEW)

## Routing Tracker

Rows `05-06-T1` through `05-06-T3-mem` recorded in `05-CF-CODE-ASSIST-USAGE.md`. All routed to Claude — most because of cross-file synthesis (vitest.config.ts coordination, byte-frozen META_GAPS contract) or because MCP cf-code-assist was unavailable. Estimated savings forgone: ~5,000 tokens across T2-harness + T3-mem.

## Next Up

Plan 05-07 — production monitoring + synthesis contract handoff for Phase 6/7. Plan 05-07 is `autonomous: true` and does not depend on Task 4 / Task 5.1 follow-up work.
