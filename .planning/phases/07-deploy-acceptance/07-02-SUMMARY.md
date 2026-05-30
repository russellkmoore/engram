---
phase: 07-deploy-acceptance
plan: 02
subsystem: docs
tags: [readme, docs, deploy, oauth-bootstrap, troubleshooting, getting-started, cross-link]

# Dependency graph
requires:
  - phase: 03-mcp-server-scaffold
    provides: "`packages/mcp-server/README.md` — Phase 3 over-delivered (448 lines) containing the OAuth bootstrap walkthrough, Claude Desktop config snippets, and Troubleshooting source content that Plan 07-02 hoists + adapts for the root README"
  - phase: 03-mcp-server-scaffold
    provides: "`packages/mcp-server/src/oauth.ts:201` — literal 403 body `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` quoted verbatim in root README Step 4 (single source of truth — appears EXACTLY ONCE in the new README)"
  - phase: 07-deploy-acceptance
    provides: "Plan 07-01 npm script names (`npm run setup`, `npm run deploy`, `npm run deploy:mcp`, `npm run deploy:triage`, `npm run kv:bootstrap`) — referenced verbatim throughout the new root README sections"
  - phase: 05-ai-integration
    provides: "`packages/triage-worker/wrangler.jsonc:20-22` — cross-Worker DO binding `script_name: \"engram-mcp-server\"` is the runtime invariant the §Deploy section documents (defense-in-depth with Plan 07-01's npm script chain)"
provides:
  - "Root `README.md` linear walkthrough from clean clone to working Claude Desktop integration — Russell now, Devon eventually (per CONTEXT.md PROJECT.md audience tier)"
  - "Inline OAuth bootstrap walkthrough as Step 4 (D-02 — NOT in Troubleshooting); literal 403 body verbatim from oauth.ts:201; mcp-remote@0.1.38 dated rollback marker per RESEARCH §`mcp-remote pinning`"
  - "Root README §Deploy reference section documenting all three npm scripts (`npm run deploy` / `deploy:mcp` / `deploy:triage`) with the cross-Worker DO deploy-order invariant + literal `Could not find a Worker with the name \"engram-mcp-server\"` error string for grep-discoverability"
  - "Root README §Troubleshooting with planner-triaged subset (6 entries — KEEP: FND-08 migration + engine-strict; PROMOTE from RESEARCH Pitfalls: KV IDs, stale JWT, close-vs-quit, eval-gate flake; EXCLUDE: bootstrap-403 per D-02)"
  - "Root README §Reference with DOWN-links to per-package READMEs + SIDEWAYS links to CLAUDE.md (no `.planning/` cross-links per PATTERNS §`README cross-linking depth`)"
affects:
  - .planning/phases/07-deploy-acceptance/07-03-PLAN.md (HUMAN-UAT skeleton — references README §Getting Started Step 4 as the acceptance-test prerequisite the operator follows)
  - .planning/phases/07-deploy-acceptance/07-04-PLAN.md (deploy execution — operator literally follows the new §Deploy section)

# Tech tracking
tech-stack:
  added: [] # Zero new packages — docs-only plan
  patterns:
    - "Hoist + adapt (not from-scratch authoring) — root README delta sources 80% of its content from `packages/mcp-server/README.md:110-217` (OAuth + Claude Desktop config) and `packages/mcp-server/README.md:341-422` (Troubleshooting source). Tone shifted from `you are a developer iterating` to `you just installed, here is what you are about to see` per CONTEXT.md D-02"
    - "Source-of-truth single-occurrence invariant — the literal 403 body `Unknown OAuth subject: ${sub}. Bootstrap via npm run kv:bootstrap.` appears EXACTLY ONCE in the README (only in Step 4 per D-02). Troubleshooting explicitly EXCLUDES the bootstrap-403 entry — duplicating would split source-of-truth and create drift risk when the source string changes in oauth.ts"
    - "Defense-in-depth cross-Worker DO deploy-order encoding — the §Deploy section documents BOTH (a) the chained order in `npm run deploy` (mcp-server before triage-worker) AND (b) the literal `Could not find a Worker with the name \"engram-mcp-server\"` wrangler error as the symptom of getting it wrong. If a user runs `deploy:triage` directly without `deploy:mcp`, the error message itself is their grep hint into the README"
    - "Dated rollback marker for community-maintained dependency — the Claude Desktop config snippet carries `<!-- tested with mcp-remote@0.1.38 on Claude Desktop 2026-05-29 -->` per RESEARCH §`mcp-remote pinning`. If a future mcp-remote release breaks the bootstrap flow, the dated comment anchors the known-good version. v0.4+ owns the swap to native Streamable HTTP per CONTEXT.md Deferred Ideas"
    - "ASCII-only placeholders in all snippets — `<your-subdomain>`, `<some-long-string>`, `<pick-an-identifier-for-your-workspace>`, `<pick-an-identifier-for-yourself>` per CONTEXT.md Security gate explicit requirement. NO real OAuth `sub` values, NO real workspace IDs, NO real Cloudflare subdomain interpolated into example commands (T-07-02-LEAK mitigation)"

key-files:
  created:
    - ".planning/phases/07-deploy-acceptance/07-02-SUMMARY.md — this file"
  modified:
    - "README.md — root README. Lines 95-187 restructured (Status section refresh + Getting Started numbered Steps 1-4); lines 189-277 added (new ## Deploy + ## Troubleshooting + ## Reference H2 sections); lines 279-590 (Tool Surface (v0.1) through License) BYTE-IDENTICAL to baseline (verified via MD5 of the line-279-onwards region against the pre-plan commit 35e9c60). Total delta: 443 → 590 lines (+147 lines, within CONTEXT.md Claude's Discretion estimate of ~100-150)"

key-decisions:
  - "Literal 403 body interpolation form chosen: `Unknown OAuth subject: <some-long-string>. Bootstrap via npm run kv:bootstrap.` — runtime `${sub}` value replaced with placeholder `<some-long-string>` (not omitted, not `${sub}`, not a real value). Rationale: matches the source-of-truth byte string per PATTERNS §`Literal-string preservation` (grep-discoverable from the error message); uses ASCII placeholder per T-07-02-LEAK mitigation; the runtime `${sub}` template literal is a TypeScript syntax artifact not visible to end users so reproducing it would mislead readers."
  - "Step 2 Deploy structure: kept as a short H3 inside Getting Started (4 lines pointing at the ## Deploy H2) per PATTERNS Q1 reconciliation — `the H3 is the linear walkthrough; the H2 is the complete reference`. This matches the per-package README's `First-Time Setup (H2 narrative) vs Troubleshooting (H2 reference)` pattern."
  - "Troubleshooting triage executed per PATTERNS Q2 + Q3: KEEP 2 entries from per-package README (FND-08 migration + engine-strict), PROMOTE 4 entries from RESEARCH Common Pitfalls 2/3/4/6 (KV ID placeholders, stale JWT cache, close-vs-quit Claude Desktop, eval-gate flake), DROP 2 Inspector-internal entries (Protected resource mismatch, Stream closed mid-session — per-package README owns them), EXCLUDE 1 entry (bootstrap-403 — lives inline in Step 4 per D-02). Final count: 6 entries."
  - "Reference section depth: DOWN-links to per-package READMEs + SIDEWAYS to CLAUDE.md only; NO links into `.planning/` per PATTERNS §`README cross-linking depth` — the internal GSD planning surface is not appropriate for the user-facing root README."
  - "No source code changes. This plan modified ONLY README.md. The literal 403 string in `packages/mcp-server/src/oauth.ts:201` was QUOTED, not modified; per-package README was READ as a source, not edited; npm scripts in package.json were REFERENCED by name, not edited (Plan 07-01 created them)."

patterns-established:
  - "Source-of-truth single-occurrence invariant for literal error strings — when documenting a runtime error message in user-facing docs, quote it EXACTLY ONCE in the most contextually-relevant section (here: inline in Step 4 where the user sees it), and cross-link from other sections that mention it. Do NOT duplicate the literal string in Troubleshooting + a walkthrough section — duplication = drift risk when the source-of-truth string changes."
  - "Hoist-and-adapt root README delta — when a Phase N has produced an over-delivered per-package README that contains user-facing onboarding content beyond its developer-facing scope, the user-facing 80% can be HOISTED to the root README with a tone shift, leaving the per-package README as the developer-facing detail reference. Cross-link DOWN from root to per-package + SIDEWAYS to CLAUDE.md; never link from root into `.planning/`."
  - "Defense-in-depth runtime invariants encoded in BOTH code AND docs — the cross-Worker DO deploy-order is enforced by Plan 07-01's `npm run deploy` script chain AND documented in the §Deploy section with the literal wrangler error string. If a user bypasses the wrapper script, the error message is their grep hint into the docs. Future invariants that span code + docs should follow this pattern."

requirements-completed: [DEP-02, DEP-05]

# Metrics
duration: ~25min
completed: 2026-05-29
tasks_completed: 2
files_changed: 1 (README.md)
commits: 2
commits_list:
  - hash: 4eb058d
    message: "docs(07-02): restructure root README Getting Started into numbered Steps 1-4"
  - hash: 98ccb42
    message: "docs(07-02): add Deploy / Troubleshooting / Reference H2 sections to root README"
---

# Phase 7 Plan 02: Root README Hoist + Deploy Reference Summary

**Root README restructured into linear walkthrough (Steps 1-4) with OAuth bootstrap inline at Step 4 per D-02, new H2 reference sections (Deploy / Troubleshooting / Reference) inserted between Getting Started and Tool Surface (v0.1), and all of Tool Surface through License preserved byte-identically. 443 → 590 lines (+147, within the CONTEXT.md ~100-150 estimate).**

## Performance

- **Duration:** ~25 minutes
- **Started:** 2026-05-29 (worktree spawn)
- **Completed:** 2026-05-29
- **Tasks:** 2 (both `type="auto" tdd="false"` — docs-only hoist + insert)
- **Files modified:** 1 (`README.md`)
- **Lines added:** +147 net (443 baseline → 590 final)
- **Lines deleted:** ~30 (during Step 1 Install replacement of the original "Install and run" snippet)

## Accomplishments

- **D-02 OAuth bootstrap UX shipped inline:** Step 4 walks the user through the 403 → `npm run kv:bootstrap` → restart flow with the literal 403 body quoted verbatim from `packages/mcp-server/src/oauth.ts:201`. The error message itself becomes the user's grep hint into the README.
- **D-08 Deploy reference shipped:** §Deploy documents all three Plan 07-01 npm scripts (`npm run deploy` / `deploy:mcp` / `deploy:triage`) with the cross-Worker DO deploy-order invariant encoded as BOTH the chained order AND the literal wrangler error string (`Could not find a Worker with the name "engram-mcp-server"`).
- **Troubleshooting triaged + hoisted:** 6 entries selected per PATTERNS Q2 + Q3 triage (KEEP 2 from per-package + PROMOTE 4 from RESEARCH Common Pitfalls; DROP 2 Inspector-internal; EXCLUDE 1 bootstrap-403 per D-02).
- **mcp-remote rollback marker in place:** `<!-- tested with mcp-remote@0.1.38 on Claude Desktop 2026-05-29 -->` in the Step 3 config snippet anchors the known-good community-maintained dependency version per RESEARCH §`mcp-remote pinning`.
- **Tool Surface preservation verified:** the line-279-onwards region (Tool Surface (v0.1) through License) MD5-matches the pre-plan baseline (commit 35e9c60) — `6d4b12be93192a07eb663b559791f919` on both. Phase 7 did NOT touch the Phase 4 tool docs.
- **Zero source code changes:** the literal 403 body in oauth.ts:201 was QUOTED, not modified; the per-package README was READ as a hoist source, not edited; the npm scripts were REFERENCED by name (Plan 07-01 created them).

## Task Commits

Each task was committed atomically:

1. **Task 1: Restructure root README §Getting Started into numbered Steps 1-4 (D-02 + PATTERNS Q1)** — `4eb058d` (docs). Files: `README.md` (Status section refresh + Getting Started restructure with Steps 1-4 including hoisted Step 3 Claude Desktop config + hoisted Step 4 OAuth bootstrap walkthrough).
2. **Task 2: Add new H2 sections — ## Deploy, ## Troubleshooting, ## Reference — between Getting Started and Tool Surface** — `98ccb42` (docs). Files: `README.md` (three new H2 sections inserted as a single coherent block between Step 4 and Tool Surface (v0.1)).

**Plan metadata commit:** to be created after this SUMMARY is written.

## Files Created/Modified

### Modified

- **`README.md`** — root README. Heading layout (line numbers post-edit):
  - Line 13: `## Why Engram` (UNCHANGED)
  - Line 25: `## Architecture` (UNCHANGED)
  - Line 79: `## Tech Stack` (UNCHANGED)
  - Line 95: `## Status` (REFRESHED — bumped from `Foundation scaffolding (Phase 1) complete. Working on WorkspaceDO + SQLite schema (Phase 2).` to `Phases 1-6 complete (Foundation → WorkspaceDO + SQLite → MCP Server Scaffold → Core Tools + Envelope → AI Integration → Async Pipeline). Phase 7 (Deploy + Acceptance) is the active phase.`)
  - Line 105: `## Getting Started` (RESTRUCTURED — see numbered H3s below)
  - Line 107: `### Prerequisites` (UNCHANGED — kept as unnumbered preamble per PATTERNS Q1 reconciliation)
  - Line 112: `### 1. Install` (RENAMED from `### Install and run`; chains `npm run setup`)
  - Line 129: `### 2. Deploy` (NEW — short H3 cross-linking to `## Deploy` H2)
  - Line 137: `### 3. Configure Claude Desktop` (NEW — hoisted from per-package README:173-200; includes dated `mcp-remote@0.1.38` rollback marker)
  - Line 164: `### 4. First tool call (the OAuth bootstrap)` (NEW — hoisted from per-package README:110-169; quotes literal 403 body verbatim)
  - Line 189: `## Deploy` (NEW — full deploy reference per D-08; documents 3 npm scripts + eval-gate failure handling + deploy-order invariant)
  - Line 228: `## Troubleshooting` (NEW — 6 triaged entries; excludes bootstrap-403 per D-02)
  - Line 268: `## Reference` (NEW — down-links to per-package READMEs + sideways to CLAUDE.md)
  - Line 279: `## Tool Surface (v0.1)` (UNCHANGED — byte-identical preservation verified via MD5)
  - Line 582: `## Architecture Deep Dive` (UNCHANGED)
  - Line 588: `## License` (UNCHANGED)

### Created

- **`.planning/phases/07-deploy-acceptance/07-02-SUMMARY.md`** — this file.

## Decisions Made

See `key-decisions` in frontmatter. Five decisions documented inline above; the most consequential is the **source-of-truth single-occurrence invariant** for the literal 403 body — it appears EXACTLY ONCE in the README (in Step 4), with the Troubleshooting section explicitly EXCLUDING the bootstrap-403 entry per D-02. This eliminates drift risk when the source string in `packages/mcp-server/src/oauth.ts:201` changes in a future phase.

## Deviations from Plan

None - plan executed exactly as written.

Both tasks were `type="auto" tdd="false"` docs-only edits with explicit per-line action steps. Acceptance criteria for each task passed on first invocation of the verification script; plan-level invariants (literal-string occurrence count, deploy-order error string presence, section ordering, byte-identical preservation of Tool Surface through License) all PASS.

## Issues Encountered

### Edit-tool path-resolution anomaly (Task 1, recovered cleanly)

The first invocation of the Edit tool against `README.md` (using the project-root relative-style absolute path `/Users/rmoore/Workspaces/engram/README.md` resolved by my context) returned `file updated successfully` but the change did NOT persist to disk in the worktree (`/Users/rmoore/Workspaces/engram/.claude/worktrees/agent-a13d4d8b859c0b066/README.md`). Bash `grep`/`md5`/`sed` confirmed the on-disk content was still the baseline. Recovery:

1. Diagnosed via `md5 README.md` (worktree) vs `md5 /Users/rmoore/Workspaces/engram/README.md` (main repo) — different hashes proved two different files.
2. Re-issued the Edit using the explicit worktree-absolute path `/Users/rmoore/Workspaces/engram/.claude/worktrees/agent-a13d4d8b859c0b066/README.md` — change persisted correctly (MD5 changed from baseline `7045d322203122fffbdcbaa6f1c6f2bd` to post-Task-1 hash).
3. All subsequent edits used the explicit worktree-absolute path; both Task 1 and Task 2 verified via `node -e "..."` reading the relative-path `README.md` from the worktree cwd before committing.

Lesson: in worktree-isolated executor agents, prefer explicit worktree-absolute paths for Edit tool invocations over project-root paths that may resolve through the main repo's filesystem (this is the documented `worktree-path-safety` concern in the agent definition, but I encountered it via the Edit tool's path-resolution behavior rather than via Bash `cd`-drift). The `<absolute-path safety>` assertion in the agent definition's commit protocol caught it implicitly by computing `WT_ROOT = $(git rev-parse --show-toplevel)` from inside the worktree. Documented here for traceability — no data loss; final on-disk state is correct and verified.

### Pre-commit hook side effects (prettier --write)

Both commits triggered `lint-staged` running `prettier --write` on `README.md`. Verification:
- Task 1 commit: prettier ran, no semantic change. Post-commit invariant check (all required substrings present) PASSED.
- Task 2 commit: prettier ran, no semantic change. Post-commit invariant check + Tool Surface MD5 preservation check both PASSED.

Both runs idempotent. Documented for traceability — not a deviation.

## Verification Results

### Per-task automated checks (from PLAN.md)

- **Task 1** `node -e "<plan-script>"` → `Task 1 OK` (all 11 required substrings present; Tool Surface + License preserved; no accidental deletions).
- **Task 2** `node -e "<plan-script>"` → `Task 2 OK` (3 new H2 headings exactly once each; deploy-order precondition + `Could not find a Worker` error string present; `Unknown OAuth subject` appears EXACTLY ONCE per D-02 invariant; section order Step 4 → Deploy → Troubleshooting → Reference → Tool Surface correct).

### Plan-level verification (`<verification>` block, items 1-4)

1. **README structural integrity:**
   - `grep -c "^## " README.md` → **11** (original 8 + 3 new). PASS.
   - 4 numbered step H3s present (`### 1. Install`, `### 2. Deploy`, `### 3. Configure Claude Desktop`, `### 4. First tool call (the OAuth bootstrap)`). PASS.
   - File parses as valid Markdown (no orphaned fenced-code-block tags; prettier ran clean during pre-commit hook on both commits — would have failed loudly on any malformed markdown). PASS.

2. **Source-of-truth invariants:**
   - `grep -c "Unknown OAuth subject" README.md` → **1**. PASS (D-02 invariant).
   - `grep -c "mcp-remote@0.1.38" README.md` → **1** (>=1 required). PASS.
   - `grep -c "engram-mcp-server" README.md` → **4** (>=2 required: Step 3 config snippet + Deploy section precondition note + 2 additional Deploy section mentions). PASS.

3. **Cross-link integrity:**
   - All `./packages/mcp-server/README.md` links target the existing file (verified `ls packages/mcp-server/README.md` — 448 lines, present). PASS.
   - All `./CLAUDE.md` links target the existing file (verified `ls CLAUDE.md` — present at repo root). PASS.
   - `grep -c "(.planning/" README.md` → **1** (only the existing `.planning/ROADMAP.md` link in the Status section; no NEW `.planning/` cross-links introduced by Plan 07-02). PASS.

4. **Preservation:**
   - Tool Surface (v0.1) through License byte-identical to pre-plan baseline. Verified via `md5` of the `^## Tool Surface (v0.1)$` through end-of-file region: current `6d4b12be93192a07eb663b559791f919`, baseline (commit 35e9c60) `6d4b12be93192a07eb663b559791f919`. PASS.

### Final source-of-truth invariant table (post-prettier, both commits)

| Invariant | Required | Actual | Status |
|-----------|----------|--------|--------|
| `Unknown OAuth subject` (literal 403 body) | exactly 1 | 1 | PASS |
| `mcp-remote@0.1.38` (dated rollback marker) | >=1 | 1 | PASS |
| `Could not find a Worker` (deploy-order error) | >=1 | 1 | PASS |
| `2026-05-29` (dated marker) | >=1 | 1 | PASS |
| `Fully quit Claude Desktop` (Pitfall 4 mitigation) | 2 (Step 3 + Step 4) | 2 | PASS |
| `rm -rf ~/.mcp-auth/` (Pitfall 3 cache clear) | 1 | 1 | PASS |
| `--engine-strict=false` (lint-staged engine fallback) | 1 | 1 | PASS |
| `Phases 1-6 complete` (Status section refresh) | 1 | 1 | PASS |
| `## Tool Surface (v0.1)` (preserved heading) | 1 | 1 | PASS |
| `## License` (preserved heading) | 1 | 1 | PASS |

## CF-Code-Assist Routing Log

Per CONTEXT.md `<output>` instruction (the most likely `generateDocs` candidate in the phase) + `~/.claude/CLAUDE.md` 3-question checklist:

### Plan 07-02 (both tasks) — Root README hoist + Deploy reference

- **3-question checklist:**
  1. **Is the SYNTHESIS step itself cross-file?** No — both tasks edit a single file (`README.md`). Reading the per-package README + oauth.ts as hoist sources counts as multi-file READING, which does not disqualify cf-code-assist per CONTEXT.md routing posture.
  2. **Is the diff > ~50 lines of mechanical code?** Yes — net +147 lines. Above the 50-line threshold.
  3. **Is there a stable template/spec to anchor on?** Yes — PATTERNS.md provided exact section structures + the source paragraphs to hoist; CONTEXT.md D-02 + D-08 specified the section ordering; oauth.ts:201 provided the verbatim literal string.
- **Answer: N/Y/Y → cf-code-assist candidate per global checklist.**
- **Route chosen: Claude (Edit tool).**
- **Rationale:** This was a textbook executor's-call situation per CONTEXT.md `<output>` ("README is high-touch user-facing content that benefits from Claude's tone calibration and cross-link verification — executor's call whether to route or hand-author"). Chose Claude because:
  1. **Tone calibration:** the D-02 tone shift from `you are a developer iterating` (per-package source) to `you just installed, here is what you are about to see` (root audience) required judgment calls about voice, framing of the 403 as expected (not an error), and the precise hedging language around the cross-Worker DO precondition.
  2. **Cross-link verification:** the §Reference section's down-links to per-package README anchors (`#first-time-setup-one-shot`, `#smoke-test-mcp-inspector`, `#oauth-flow-under-the-hood`) and CLAUDE.md anchors (`#mcp-tool-surface`, `#architecture`, `#tech-stack`) required verifying anchor existence in the target files — easier in Claude's native context than packaging the target ToC into a cf-code-assist `context` parameter.
  3. **Single-occurrence invariant enforcement:** the D-02 `Unknown OAuth subject` must-appear-exactly-once invariant required careful cross-section coordination (Step 4 includes the literal; Troubleshooting must NOT include it; if a future executor regenerated Troubleshooting via cf-code-assist, the model might helpfully add a `### 403 Unknown OAuth subject` entry by analogy with the other Troubleshooting entries — defeating the source-of-truth invariant).
- **Token economics:** the diff was large enough (~150 lines) that cf-code-assist context-prep overhead would have been amortized, but the per-edit Claude latency was acceptable given the editorial-judgment density.

**Phase 7 routing posture so far:** 0/4 cf-code-assist across Plans 07-01 + 07-02 (2/2 Claude in Plan 07-01 per surgical wrapper-script edits; 2/2 Claude in Plan 07-02 per editorial-judgment density). Matches the CONTEXT.md projection ("Realistic projection: 0-2 routes across the phase") for an operational/documentation phase. Plans 07-03 (HUMAN-UAT skeleton) and 07-04 (deploy execution) are unlikely to shift the mix — HUMAN-UAT is short structured Markdown (under 50-line threshold) and deploy execution is interactive operator workflow with no code generation.

## Next Plan Readiness

- **Plan 07-03 (HUMAN-UAT skeleton) can begin.** It can reference the now-shipped README sections as the operator-facing prerequisite the acceptance-test runner follows.
- **Plan 07-04 (deploy execution) can begin.** The operator literally follows the new §Deploy section; the §Troubleshooting section is the gap-closure surface if anything fails.
- **No new blockers introduced.** The Plan 07-01 deferred-items list (TS2688 + 29 ESLint errors in `packages/mcp-server/src/**`) is unchanged — Plan 07-02 modified ONLY `README.md` and did not touch any source files.
- **README ready for first-time deployer.** Russell (now) and Devon (eventually) can follow the root README linearly from clean clone to working Claude Desktop integration without consulting any other artifact per CONTEXT.md `<must_haves><truths>` first item.

## Self-Check: PASSED

- `README.md` exists, 590 lines, contains the 4 numbered H3 Steps + 3 new H2 sections + literal 403 body quoted exactly once. FOUND.
- `.planning/phases/07-deploy-acceptance/07-02-SUMMARY.md` exists (this file). FOUND.
- Commit `4eb058d` exists in `git log --all` (`docs(07-02): restructure root README Getting Started into numbered Steps 1-4`). FOUND.
- Commit `98ccb42` exists in `git log --all` (`docs(07-02): add Deploy / Troubleshooting / Reference H2 sections to root README`). FOUND.
- `.planning/STATE.md` NOT modified (orchestrator-owned per plan instructions). CONFIRMED.
- `.planning/ROADMAP.md` NOT modified (orchestrator-owned per plan instructions). CONFIRMED.
- NO source code files modified (`oauth.ts`, `wrangler.jsonc`, `package.json`, any `*.ts` — all untouched). CONFIRMED via `git diff --name-only 35e9c60 HEAD` returning only `README.md`.
- Tool Surface (v0.1) through License preserved byte-identically (MD5 `6d4b12be93192a07eb663b559791f919` on both current and baseline). CONFIRMED.

---
*Phase: 07-deploy-acceptance*
*Plan: 02*
*Completed: 2026-05-29*
