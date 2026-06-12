---
phase: 02-recall-quality-baseline
plan: 03a
type: execute
wave: 3
depends_on: ["02-02"]
files_modified:
  - packages/mcp-server/src/__tests__/evals/seed-prep.ts
  - packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts
  - .planning/evals/recall-corpus.json
  - packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json
  - scripts/relabel-eval-corpus.mjs
  - .planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md
autonomous: true
requirements: []
tags:
  - rnk
  - eval
  - eval-design
  - seed-prep
  - reachability
linear_subissue: rnk
must_haves:
  truths:
    - "Recency variance is present in Vectorize metadata: the 120 ef-* fixtures carry created_at timestamps spread across 0-90 days via a deterministic exponential-decay curve (bulk in last ~14 days), NOT a single constant, so the recency component of hybridRank() produces differing scores across configs."
    - "Scope variance is present: the 120 ef-* fixtures carry scope in {personal, project} (no org) at roughly 70/30, seeded into Vectorize metadata, so the scope_match component can tune."
    - "Type/scope query labeling exists: 40-60 of the 100 corpus queries in .planning/evals/recall-corpus.json carry an optional expected_args:{types?,scope?} field (natural-intent only), synced byte-stable into recall-corpus-v2.json, so the sweep can pass real filters into hybridRank()."
    - "qwen3 reachability holds: every expected_top_3 block for the 100-entry corpus is reachable in the qwen3-embedding-0.6b Vectorize top-50 for its query; the 34 previously-unreachable corpus entries were AI-relabeled with a per-entry audit trail."
    - "real-corpus.json (27 entries) reachability pre-check ran: any unreachable intended_memory_id was relabeled with the same audit protocol, or all 27 confirmed reachable and v0.1 labels stand, so the D-15 >=0.8254 dual-corpus gate stays meaningful."
    - "Seed-prep is fully deterministic: the curve produces byte-identical relative metadata across two evaluations (created_at + scope derived purely from entry index, no PRNG, no jitter)."
  artifacts:
    - path: "packages/mcp-server/src/__tests__/evals/seed-prep.ts"
      provides: "Pure deterministic functions daysForEntry(i), createdAtForEntry(i, now), scopeForEntry(i), projectIdForEntry(i) that the seed test imports"
      contains: "daysForEntry"
      min_lines: 40
    - path: "packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts"
      provides: "Upserts 120 ef-* fixtures into Vectorize with deterministic created_at + scope metadata from seed-prep.ts (replacing the constant Date.now() / personal)"
      contains: "daysForEntry"
    - path: ".planning/evals/recall-corpus.json"
      provides: "Authoritative corpus with expected_args on 40-60 queries plus relabel audit fields on the 34 affected entries"
      contains: "expected_args"
    - path: "packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json"
      provides: "Vendored sync of the authoritative corpus (expected_args + audit fields propagated)"
      contains: "expected_args"
    - path: "scripts/relabel-eval-corpus.mjs"
      provides: "qwen3-reachability relabel script: ranks ef-* blocks by cosine per query, relabels unreachable expected_top_3, writes per-entry audit fields"
      contains: "qwen3_unreachable_original_id"
  key_links:
    - from: "packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts"
      to: "packages/mcp-server/src/__tests__/evals/seed-prep.ts"
      via: "import daysForEntry/createdAtForEntry/scopeForEntry/projectIdForEntry from ./seed-prep.js"
      pattern: "seed-prep"
    - from: "packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts"
      to: "Vectorize metadata (created_at + scope)"
      via: "env.VECTORIZE.upsert metadata uses createdAtForEntry(i, now) + scopeForEntry(i)"
      pattern: "createdAtForEntry"
    - from: "scripts/relabel-eval-corpus.mjs"
      to: ".planning/evals/recall-corpus.json"
      via: "writes relabeled expected_top_3_block_ids + audit fields"
      pattern: "original_top_3_block_ids"
    - from: ".planning/evals/recall-corpus.json"
      to: "packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json"
      via: "node scripts/sync-eval-corpus.mjs (D-13 sync)"
      pattern: "recall-corpus-v2.json"
---

<objective>
Fix the eval design so the 625-config hybrid-rank sweep (Plan 02-03) can actually tune. Plan 02-03 paused because three of four hybridRank() components were structurally constant in the eval rig: (1) every ef-* fixture was seeded with an identical created_at so recency collapses to a constant, (2) every corpus query passed args={} so type_match and scope_match are always 0, (3) 34/300 expected_top_3 blocks rank outside the qwen3-embedding-0.6b Vectorize top-50 producing an F1 coverage ceiling below the D-15 >=0.8254 honest-tuning margin. All 625 configs therefore produced identical F1=0.3619 / flip_rate=0.0000, a textbook PITFALLS HR-2 reward-hacking flatline.

This plan introduces variance into all three sources per CONTEXT.md D-22..D-33, WITHOUT touching the sweep mechanics (Plan 02-03 owns those). After this plan, the eval has demonstrable diversity along recency, scope, and type, and every expected block is qwen3-reachable.

Purpose: precondition for an honest sweep. Introduces NO new requirements (RNK-01..07 stay on Plan 02-03); this plan only fixes eval-data integrity.

Output:
- packages/mcp-server/src/__tests__/evals/seed-prep.ts -- pure deterministic timestamp + scope derivation (no PRNG, D-25)
- packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts -- upserts 120 fixtures with deterministic created_at (D-22..D-24) + scope (D-28, D-29) metadata
- .planning/evals/recall-corpus.json (+ synced recall-corpus-v2.json) -- expected_args on 40-60 queries (D-26, D-27) + relabel audit fields on the 34 affected entries (D-30, D-31, D-33)
- scripts/relabel-eval-corpus.mjs -- qwen3-reachability relabel + real-corpus.json pre-check (D-30..D-32)

Critical eval-session discipline (RESEARCH section Pitfall 3): the Vectorize re-seed in Task 1 and the reachability scan in Task 3 each run as their OWN pre-eval session, NOT bundled with Plan 02-03's sweep or Plan 02-04's conflict-precision eval. The seed upsert is ~120 embed calls; the reachability scan is ~127 query embeds (100 corpus + 27 real-corpus). Each fits under MAX_AI_CALLS=200 on its own; bundling would breach the cap.

Anti-reward-hack contract (CONTEXT specifics "Eval-design honesty is load-bearing"): this plan's must_haves assert the three diversity checks NOW hold. Any future RNK retune (v0.3) must re-verify the same three checks before claiming the weights are tuned.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/02-recall-quality-baseline/02-CONTEXT.md
@.planning/phases/02-recall-quality-baseline/02-RESEARCH.md
@.planning/phases/02-recall-quality-baseline/02-PATTERNS.md
@.planning/phases/02-recall-quality-baseline/02-01-SUMMARY.md
@.planning/phases/02-recall-quality-baseline/02-02-SUMMARY.md
@packages/mcp-server/src/hybrid-rank.ts
@packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts
@scripts/sync-eval-corpus.mjs

<interfaces>
The constant-metadata bug being fixed. seed-eval-fixtures.eval.test.ts upsert
block currently hardcodes scope + created_at for EVERY fixture (the recency +
scope flatline source):
  metadata: { type: fixture.type, scope: "personal", created_at: Date.now() }
Task 1 replaces those two fields with per-index deterministic values from seed-prep.ts.

hybridRank scoring contract (packages/mcp-server/src/hybrid-rank.ts lines 90-117):
  recency     = exp(-ageHours / (24*30))    -- 30-day half-life; needs varied block.created_at
  type_match  = args.types includes block.type ? 1 : 0   -- needs args.types AND block.type
  scope_match = args.scope === block.scope ? 1 : 0        -- needs args.scope AND block.scope in {personal,project}

recall-ranking.eval.test.ts read path (lines 434-449) ALREADY reads created_at
+ scope + type from Vectorize metadata; the broken part is the fallback
(Date.now() minus 1 day / "personal"). Once Task 1 seeds real metadata the read
path resolves to real per-block values, so no read-path edit is needed here.

Seed JSON shape (.planning/evals/eval-fixtures-seed.json):
  { workspace: "eval-fixtures", memories: [ { id:"ef-001", content, source, type } x 120 ] }
No created_at, no scope. seed-prep.ts derives both from the array index.

Corpus entry shape (.planning/evals/recall-corpus.json entries[]):
  { id:"rcv2-NNN", bucket, query, expected_top_3_block_ids:[ef-*], split,
    labeled_by, labeled_at, expected_synthesis }
Task 2 adds optional expected_args; Task 3 adds relabel audit fields.

real-corpus.json (27 entries) shape: uses intended_memory_id (single,
self-referential real-NNN) NOT expected_top_3_block_ids. A block is always
reachable against its own embedding (cosine 1.0), so D-32's pre-check should pass
for all 27, but the protocol still runs to make that explicit.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Deterministic seed-prep (recency + scope variance) + reseed Vectorize (D-22..D-25, D-28, D-29)</name>
  <files>packages/mcp-server/src/__tests__/evals/seed-prep.ts, packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts</files>
  <read_first>
    - packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts (FULL FILE; the upsert loop at lines 66-103 is what Task 1 modifies; lines 86-88 are the constant-metadata bug)
    - packages/mcp-server/src/hybrid-rank.ts lines 90-117 (recency = exp(-ageHours/(24*30)); scope_match binary on block.scope; confirms what metadata the seed must produce)
    - .planning/evals/eval-fixtures-seed.json (120 ef-* memories; confirm id/content/source/type shape and the ef-001..ef-120 ordering)
    - .planning/phases/02-recall-quality-baseline/02-CONTEXT.md sections D-22..D-25 (recency curve: exp-decay to 90d, bulk in last ~14d, deterministic, no PRNG) and D-28..D-29 (scope {personal,project}, ~70/30, optional realistic project_id slugs)
    - .planning/phases/02-recall-quality-baseline/02-PATTERNS.md (deterministic pure-function analog + Vite JSON import discipline)
  </read_first>
  <behavior>
    Declare expectations for seed-prep.ts BEFORE implementing (a co-located unit test seed-prep.test.ts, OR inline assertions in the seed test header; executor's choice, but the assertions must run in the workerd tier):

    - daysForEntry(i) is a pure exp-decay curve: daysForEntry(0) returns ~0 (most recent), daysForEntry(119) returns at most 90 (oldest), the sequence is monotonically non-decreasing in i, and the bulk (at least ~60% of indices) maps to at most 14 days. No Math.random anywhere in the module.
    - createdAtForEntry(i, now) equals now - daysForEntry(i) * 86400000 (rounded to integer ms): createdAtForEntry(0, now) is the largest (most recent), createdAtForEntry(119, now) the smallest.
    - Determinism: calling daysForEntry(i) twice for the same i returns the identical value; the full 120-element created_at array is byte-stable across two module evaluations with the same now.
    - scopeForEntry(i) in {personal, project} with the count of project entries in [0..119] landing in the 30% band (roughly 36 of 120); count of distinct project_id slugs over project entries is greater than 1.
    - scopeForEntry/projectIdForEntry are deterministic (index-derived, no PRNG); re-running yields the identical scope+slug assignment.
  </behavior>
  <action>
    Create packages/mcp-server/src/__tests__/evals/seed-prep.ts exporting four PURE deterministic functions (no Math.random, no Date.now inside the curve math; now is a parameter):
    - daysForEntry(i: number): number -- recency-skewed exponential decay per D-23. Map entry index 0..119 onto a days-ago value in [0, 90] where index 0 is most recent and index 119 is ~90 days. Use an exponential mapping so the bulk of indices land in the last ~14 days with a tail to 90d (for example 90 * (1 - exp(-i/TAU)) / (1 - exp(-119/TAU)) with TAU chosen so at least ~60% of indices fall under 14 days; TAU value is YOUR discretion within the D-23 shape constraint, document the chosen TAU + max-days clamp in a header comment). Clamp the result to [0, 90].
    - createdAtForEntry(i: number, now: number): number -- returns Math.round(now - daysForEntry(i) * 86400000).
    - scopeForEntry(i: number): personal or project -- deterministic ~70/30 split, for example assign project when i mod 10 is less than 3 (yields exactly 36/120 = 30%). NO org. Document the rule in a comment.
    - projectIdForEntry(i: number): string or null -- null when scopeForEntry(i) is personal; for project entries pick from a fixed slug array (for example engram-v0.2, job-search-2026, second-brain) via i mod slugs.length so the unique-slug COUNT is greater than 1. Slug VALUES are your discretion (they do not affect sweep math per D-29).

    Then modify packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts:
    - Import the functions: import createdAtForEntry, scopeForEntry, projectIdForEntry from ./seed-prep.js
    - Capture a single const now = Date.now() ONCE before the upsert loop (so all 120 timestamps share one anchor; re-running gives a fresh now but an identical RELATIVE distribution, which is what D-25 byte-identical-state means: same curve, same offsets).
    - In the upsert loop replace the hardcoded scope: personal, created_at: Date.now() metadata fields with per-index values keyed off the loop index i (the array index of fixture in seed.memories): scope: scopeForEntry(i), created_at: createdAtForEntry(i, now), and add project_id: projectIdForEntry(i) (if the binding rejects null metadata, omit the key when null; executor's call). Keep type: fixture.type unchanged.
    - Update the seed test header comment to note the metadata is now deterministic per seed-prep.ts (recency + scope variance) and that re-running with the same machine clock anchor reproduces the relative distribution (D-25).
    - Keep the existing 30s consistency wait + spot-check + at-least-90%-seeded assertion.

    Do NOT run the seed test in this task's verify (it needs a 10-min eval session + CF creds). Task 1 verify is compile + grep only; the actual reseed runs as its own pre-eval session (see plan-level eval-session discipline; sequence it before Task 3's reachability scan).

    Routing per D-19: seed-prep.ts is a pure-function module from a stable spec (Q1=N single-file, Q2=N ~40 LOC, Q3=Y exp-decay spec): eligible for cf-code-assist generateCode. The seed-test edit is a surgical metadata-field swap (transformCode-shaped) but small; claude is fine. Append tracker rows.
  </action>
  <verify>
    <automated>test -f packages/mcp-server/src/__tests__/evals/seed-prep.ts && grep -q 'export function daysForEntry' packages/mcp-server/src/__tests__/evals/seed-prep.ts && grep -q 'export function createdAtForEntry' packages/mcp-server/src/__tests__/evals/seed-prep.ts && grep -q 'export function scopeForEntry' packages/mcp-server/src/__tests__/evals/seed-prep.ts && grep -q 'export function projectIdForEntry' packages/mcp-server/src/__tests__/evals/seed-prep.ts && ! grep -q 'Math.random' packages/mcp-server/src/__tests__/evals/seed-prep.ts && grep -q 'createdAtForEntry' packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts && grep -q 'scopeForEntry' packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts && cd packages/mcp-server && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - seed-prep.ts exists; exports daysForEntry, createdAtForEntry, scopeForEntry, projectIdForEntry; contains NO Math.random and no PRNG (D-25).
    - daysForEntry is monotonically non-decreasing over i in [0,119], daysForEntry(0) is ~0, daysForEntry(119) is at most 90, and at least ~60% of indices map to at most 14 days (D-23 shape), verified by the co-located behavior test.
    - Two evaluations of the curve with the same now produce byte-identical created_at arrays (D-25).
    - scopeForEntry yields ~30% project (for example exactly 36/120) using only {personal, project}; NO org string appears anywhere (D-29).
    - projectIdForEntry returns null for personal entries and a slug from a fixed list (more than 1 distinct slug) for project entries (D-29).
    - seed-eval-fixtures.eval.test.ts upsert metadata uses createdAtForEntry(i, now) + scopeForEntry(i) (+ project_id); the constant created_at: Date.now() and constant scope: personal are GONE.
    - tsc --noEmit clean.
    - 02-CF-CODE-ASSIST-USAGE.md tracker rows logged (seed-prep generation route + seed-test edit route), decided BEFORE commit.
  </acceptance_criteria>
  <done>Recency + scope variance is wired deterministically into the Vectorize seed metadata; the constant-metadata flatline source (lines 86-88) is eliminated.</done>
</task>

<task type="auto">
  <name>Task 2: Label expected_args on 40-60 corpus queries + sync (D-26, D-27)</name>
  <files>.planning/evals/recall-corpus.json, packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json</files>
  <read_first>
    - .planning/evals/recall-corpus.json (FULL; authoritative editing surface per D-11; 100 entries; Task 2 adds expected_args to a natural-intent subset)
    - .planning/phases/02-recall-quality-baseline/02-CONTEXT.md sections D-26, D-27 (expected_args:{types?,scope?} optional field; natural labeling only, ~40-60% where intent makes the filter clear; over-annotation forbidden as it inflates type_match)
    - .planning/phases/02-recall-quality-baseline/02-CONTEXT.md section D-29 (scope vocabulary {personal,project}; expected_args.scope must use the same vocabulary as the seeded block scopes)
    - scripts/sync-eval-corpus.mjs (D-13 sync mechanics; Task 2 re-runs this to propagate expected_args into recall-corpus-v2.json; it injects _auto_synced_from and serializes 2-space + trailing newline)
    - .planning/evals/eval-fixtures-seed.json (fixture type values; so expected_args.types uses REAL memory-type ids like job_application, contact, research_note that actually exist on the ef-* blocks)
  </read_first>
  <action>
    Add an optional expected_args object to the natural-intent subset of the 100 corpus entries in .planning/evals/recall-corpus.json (the authoritative surface per D-11). Per D-26/D-27:
    - Field shape: expected_args with optional types (array of memory_type_id) and optional scope (personal or project); include types only when the query names/implies a type, include scope only when the query implies personal-vs-project intent.
    - Label natural only: add expected_args to between 40 and 60 of the 100 queries, the ones where a human reading the query would obviously reach for a filter. Examples: "what companies did I apply to?" maps to types job_application; "what did I research about vector search?" maps to types research_note; "my notes on the engram project" maps to scope project. Leave open/ambiguous queries (for example "what did I learn last week?") WITHOUT expected_args; args={} stays legitimate for those.
    - types values MUST be real memory-type ids present on the ef-* fixtures (job_application, contact, company, project, research_note, decision_log, meeting_note); cross-check against the seed JSON type field; do NOT invent type ids.
    - scope values MUST be in {personal, project} (D-29), never org.
    - Do NOT modify expected_top_3_block_ids in this task (Task 3 owns relabeling). Do NOT modify split, query text, or labeled_by.

    Then sync to the vendored fixture: run node scripts/sync-eval-corpus.mjs from repo root so recall-corpus-v2.json picks up the expected_args fields byte-stably (preserving the _auto_synced_from sentinel + 2-space serialization).

    Routing per D-19: this is human-judgment JSON labeling (semantic intent calls); claude authors directly, NOT cf-code-assist (Q3=N, no stable template; intent judgment is the work). The sync re-run is a pure shell invocation. Append one tracker row for the labeling step (route=claude).
  </action>
  <verify>
    <automated>node -e "const d=require('./.planning/evals/recall-corpus.json'); const n=d.entries.filter(e=>e.expected_args&&(e.expected_args.types||e.expected_args.scope)).length; if(n<40||n>60){console.error('expected_args count out of range:',n);process.exit(1);} const vt=new Set(['job_application','contact','company','project','research_note','decision_log','meeting_note']); for(const e of d.entries){if(e.expected_args&&e.expected_args.types){for(const t of e.expected_args.types){if(!vt.has(t)){console.error('invalid type',t,e.id);process.exit(1);}}} if(e.expected_args&&e.expected_args.scope&&!['personal','project'].includes(e.expected_args.scope)){console.error('invalid scope',e.expected_args.scope,e.id);process.exit(1);}} console.log('expected_args OK on',n,'entries');" && node scripts/sync-eval-corpus.mjs && node scripts/sync-eval-corpus.mjs --check && grep -q 'expected_args' packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json</automated>
  </verify>
  <acceptance_criteria>
    - .planning/evals/recall-corpus.json has expected_args on between 40 and 60 of the 100 entries (inclusive), verified by the node count check.
    - Every expected_args.types value is one of the 7 real memory-type ids; every expected_args.scope value is in {personal, project}; no org appears.
    - expected_top_3_block_ids, split, query, and labeled_by are UNCHANGED in this task.
    - node scripts/sync-eval-corpus.mjs --check passes after the sync (vendored file byte-matches source-derived content, _auto_synced_from preserved).
    - recall-corpus-v2.json contains expected_args.
    - 02-CF-CODE-ASSIST-USAGE.md tracker row logged (route=claude) for the labeling.
  </acceptance_criteria>
  <done>40-60 corpus queries carry natural-intent expected_args using real type ids + {personal,project} scope; the vendored fixture is in sync.</done>
</task>

<task type="auto">
  <name>Task 3: qwen3-reachability relabel of 34 corpus entries + real-corpus pre-check + sync (D-30, D-31, D-32, D-33)</name>
  <files>scripts/relabel-eval-corpus.mjs, .planning/evals/recall-corpus.json, packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json</files>
  <read_first>
    - .planning/phases/02-recall-quality-baseline/02-CONTEXT.md sections D-30..D-33 (relabel expected_top_3 to qwen3-reachable IDs for the 34 affected entries; pure AI relabel + audit trail, no human-in-loop; per-entry audit fields original_top_3_block_ids/relabeled_at/relabeled_reason/relabeled_by; D-32 real-corpus pre-check)
    - .planning/phases/02-recall-quality-baseline/02-CONTEXT.md specifics "AI relabeling is acceptable HERE, not everywhere" (acceptable because the original corpus is already ai-cross-validated-extended:auto-accept-tiebreak)
    - scripts/sync-eval-corpus.mjs (D-13 pattern; co-locate relabel-eval-corpus.mjs alongside per CONTEXT discretion; same arg-parse/exit-code/TAG idiom)
    - .planning/evals/recall-corpus.json (the 100 entries; the relabel target is whichever entries have an expected_top_3 block unreachable in qwen3 top-50; the blocker says 34/300 blocks across the corpus)
    - packages/mcp-server/src/__tests__/evals/fixtures/real-corpus.json (27 entries; uses intended_memory_id self-referential real-NNN; the D-32 pre-check ranks each block against its own query)
    - packages/mcp-server/src/__tests__/evals/seed-eval-fixtures.eval.test.ts (the Vectorize namespace eval-fixtures + the env.AI.run + env.VECTORIZE.query call shape the reachability scan reuses; if the script runs outside workerd it must call the Cloudflare REST API for embeddings + Vectorize query with CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID; executor picks the cleaner path)
    - .planning/evals/eval-fixtures-seed.json (the candidate pool: all 120 ef-* blocks are the relabel candidate set)
  </read_first>
  <action>
    PRECONDITION: the Task 1 reseed must have run first (its own pre-eval session) so Vectorize holds the 120 ef-* vectors with the new metadata. The reachability scan reads the SAME index.

    Create scripts/relabel-eval-corpus.mjs (mirror scripts/sync-eval-corpus.mjs CLI shape: TAG constant, arg-parse, usage(), exit codes 0 success / 1 drift-or-failure / 2 missing-source; support --check to report which entries WOULD relabel without writing, and --help). The script performs the D-31 protocol:

    Step A (corpus reachability + relabel, D-30/D-31/D-33):
    - For each of the 100 corpus entries, embed the query (qwen3-embedding-0.6b) and Vectorize-query the eval-fixtures namespace for the top-50 ef-* block ids.
    - For each entry, determine which of its expected_top_3_block_ids are MISSING from the top-50 (unreachable). The blocker reports 34 such entries.
    - For each unreachable expected id, pick the replacement: the highest-ranked semantically-relevant ef-* block from the top-50 that is not already in the entry's expected_top_3. "Semantically relevant" = same memory type as the original expected block when possible (read type from the seed JSON), else the single highest-cosine top-50 block.
    - Write the relabel into the entry: set expected_top_3_block_ids to the reachable set, and add the per-entry audit fields (D-33): original_top_3_block_ids (the pre-relabel array), relabeled_at (ISO 8601), relabeled_reason ("qwen3_unreachable_original_id"), relabeled_by ("qwen3-reachability-script-v1"). Entries with all 3 expected blocks already reachable are LEFT UNTOUCHED (no audit fields added).
    - Preserve the D-11 authoritative surface: write to .planning/evals/recall-corpus.json.

    Step B (real-corpus.json pre-check, D-32):
    - For each of the 27 real-corpus entries, embed paraphrased_query, Vectorize-query the eval-fixtures namespace top-50, and check whether intended_memory_id is present. Since real-NNN ids are self-referential they should rank #1 (cosine ~1.0); if any are unreachable, apply the SAME relabel + audit-field protocol to that entry's intended_memory_id (record original via an analogous original_intended_memory_id field). If all 27 are reachable, leave real-corpus.json UNCHANGED and log "[relabel] real-corpus: all 27 reachable, v0.1 labels stand."
    - real-corpus.json is package-local (not synced from .planning); edit it in place if relabeling is needed.

    Step C: After Step A writes the authoritative corpus, run node scripts/sync-eval-corpus.mjs to propagate the relabeled expected_top_3 + audit fields into recall-corpus-v2.json (D-13).

    Budget discipline (RESEARCH Pitfall 3): the corpus scan (~100 query embeds + 100 Vectorize queries) and the real-corpus pre-check (~27 + 27) run in ONE pre-eval session, ~127 embeds + 127 queries; both well under MAX_AI_CALLS=200 if run separately from the Plan 02-03 sweep. Do NOT bundle with the sweep or with conflict-precision.

    The executor RUNS the script once (live, against CF) to perform the actual relabel, captures the count of relabeled entries (target ~34 for the corpus; ~0 expected for real-corpus), and records it in the SUMMARY.

    Routing per D-19: relabel-eval-corpus.mjs is a single-file script from a stable spec (Q1=N, Q2=Y likely >50 LOC of embed+rank+write, Q3=Y the D-31 protocol is the template): eligible for cf-code-assist generateCode. The live RUN + result capture is claude (runtime). Append tracker rows.
  </action>
  <verify>
    <automated>test -f scripts/relabel-eval-corpus.mjs && grep -q 'qwen3_unreachable_original_id' scripts/relabel-eval-corpus.mjs && grep -q 'original_top_3_block_ids' scripts/relabel-eval-corpus.mjs && grep -q 'qwen3-reachability-script-v1' scripts/relabel-eval-corpus.mjs && node -e "const d=require('./.planning/evals/recall-corpus.json'); const r=d.entries.filter(e=>e.relabeled_at); console.log('relabeled corpus entries:',r.length); for(const e of r){if(!Array.isArray(e.original_top_3_block_ids)||!e.relabeled_reason||!e.relabeled_by){console.error('incomplete audit on',e.id);process.exit(1);} if(e.expected_top_3_block_ids.length!==3){console.error('relabel broke top-3 length on',e.id);process.exit(1);}} if(r.length===0){console.error('expected ~34 relabeled corpus entries, found 0 -- did the script run live?');process.exit(1);} console.log('audit fields OK');" && node scripts/sync-eval-corpus.mjs --check</automated>
  </verify>
  <acceptance_criteria>
    - scripts/relabel-eval-corpus.mjs exists with the D-31 protocol, --check/--help flags, and mirrors the sync-eval-corpus.mjs CLI idiom.
    - The script ran LIVE against Cloudflare; ~34 corpus entries gained relabeled expected_top_3_block_ids (the exact count is captured in the SUMMARY; non-zero is required).
    - Every relabeled corpus entry has all four D-33 audit fields: original_top_3_block_ids (array), relabeled_at (ISO), relabeled_reason ("qwen3_unreachable_original_id"), relabeled_by ("qwen3-reachability-script-v1"); expected_top_3_block_ids length stays 3.
    - Entries that were already fully reachable have NO audit fields (untouched).
    - real-corpus.json D-32 pre-check ran: either all 27 reachable (file unchanged, logged) or unreachable ones relabeled with the analogous audit protocol; the SUMMARY states which.
    - After relabel + sync, node scripts/sync-eval-corpus.mjs --check passes (recall-corpus-v2.json carries the relabeled fields).
    - Post-relabel: every expected_top_3 id across all 100 corpus entries is in its query's qwen3 top-50 (the closing reachability assertion; the script logs zero remaining unreachable).
    - 02-CF-CODE-ASSIST-USAGE.md tracker rows logged (script generation + live run).
  </acceptance_criteria>
  <done>All expected_top_3 corpus blocks are qwen3-reachable with a full per-entry audit trail; the 27-entry real-corpus is pre-checked; the D-15 >=0.8254 dual-corpus gate is once again a meaningful regression signal.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Seed test -> Workers AI (embedding) + Vectorize upsert | Eval-tier reseed runs against REAL Cloudflare bindings; ~120 embed calls + 120 upserts (upserts not counted by eval-budget) |
| Relabel script -> Workers AI + Vectorize query | ~127 query embeds + 127 Vectorize queries; reads only (no upserts); must stay under MAX_AI_CALLS=200 as its own session |
| recall-corpus.json (authoritative) -> recall-corpus-v2.json (vendored) | D-13 one-way sync; vendored file must never be hand-edited |
| Eval-design integrity | The whole point of this plan; flatlined variance is a silent reward-hack (PITFALLS HR-2) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03a-01 | Repudiation | Silent reward-hack: eval still flatlines because variance was not actually introduced | mitigate | must_haves assert the three diversity checks objectively (count of project scopes, count of expected_args, zero remaining unreachable); Plan 02-03 adds the F1-varies tunability check downstream |
| T-02-03a-02 | Tampering | Non-deterministic seed (PRNG/jitter creeps in) breaks reproducibility, regression tracking drifts | mitigate | seed-prep.ts forbidden from using Math.random (grep gate in verify); curve derives purely from index; D-25 byte-identical assertion in the behavior test |
| T-02-03a-03 | Tampering | AI relabel silently corrupts ground truth (picks an irrelevant block) | mitigate | per-entry audit trail (D-33) makes every relabel inspectable post-hoc; original ids preserved; type-aware replacement preference; acceptable only because original labeling was already ai-cross-validated (CONTEXT specifics) |
| T-02-03a-04 | Denial of Service | Reachability scan + reseed bundled into one session breaches MAX_AI_CALLS=200 | mitigate | each runs as its own pre-eval session per RESEARCH Pitfall 3; Task ordering (Task 1 reseed session, then Task 3 scan session) documented |
| T-02-03a-05 | Tampering | Over-annotation of expected_args inflates type_match signal artificially | mitigate | D-27 natural-only rule; verify gate enforces 40-60 cap (rejects both under- and over-annotation) |
</threat_model>

<verification>
- packages/mcp-server tsc --noEmit: zero errors
- seed-prep.ts has no Math.random; exports the four functions
- seed-eval-fixtures.eval.test.ts no longer hardcodes created_at: Date.now() / scope: personal
- .planning/evals/recall-corpus.json: 40-60 entries with expected_args (valid type ids + {personal,project} scope); ~34 entries with full D-33 audit fields; zero remaining qwen3-unreachable expected blocks
- node scripts/sync-eval-corpus.mjs --check: in sync (expected_args + audit fields propagated)
- real-corpus.json D-32 pre-check ran (result recorded in SUMMARY)
- 02-CF-CODE-ASSIST-USAGE.md has rows for seed-prep, seed-test edit, expected_args labeling, relabel-script generation, relabel live run
- Linear RNK sub-issue: comment that the eval-design fix landed (variance restored), unblocking the 02-03 sweep
</verification>

<success_criteria>
- Recency variance, scope variance, and type/scope query labeling all present and objectively verifiable
- Every expected_top_3 corpus block qwen3-reachable; 27-entry real-corpus pre-checked
- Seed-prep fully deterministic (no PRNG)
- D-22..D-33 fully covered by this plan
- Plan 02-03 sweep can now run on a tunable eval (its own separate session)
</success_criteria>

<output>
Create `.planning/phases/02-recall-quality-baseline/02-03a-SUMMARY.md` when done. Summary must list: the chosen daysForEntry TAU + curve constants, the scope split actually achieved (count of project entries + distinct slugs), the count of corpus queries labeled with expected_args, the count of corpus entries relabeled for reachability + sample original->new id pairs, the real-corpus.json D-32 result (all reachable vs N relabeled), confirmation the reseed + reachability scan ran as separate pre-eval sessions, and confirmation the three diversity checks hold.
</output>
