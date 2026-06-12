---
phase: 03-query-expansion-reranker
plan: "02"
subsystem: mcp-server
tags: [query-expansion, zod-gate, anti-HyDE, similarity-gate, cosine, EXP-01, EXP-02, EXP-09, EXP-12]
dependency_graph:
  requires:
    - "@engram/ai-config QUERY_EXPANSION_MODEL + EMBEDDING_MODEL + sanitizeJsonSchemaForWorkersAI"
    - "packages/mcp-server/src/ai-helper.ts safeRun"
  provides:
    - expandQuery(env, query) → [original, p1, p2] (EXP-01) — consumed by Wave 2 recall() adaptive routing
    - keepVariantsAboveGate(env, queryVector, variants, gate) → string[] (EXP-02) — consumed by Wave 2 recall()
    - ExpansionOutput zod schema — compile-time contract for expansion model output
    - EXPANSION_SYSTEM_PROMPT — anti-HyDE + entity-preservation rules (EXP-09/EXP-12)
    - EXPANSION_JSON_SCHEMA — derived Workers AI response_format schema
  affects:
    - packages/mcp-server/src/tools.ts (Wave 2 will import expandQuery + keepVariantsAboveGate)
tech_stack:
  added: []
  patterns:
    - zod-gated AI call (z.toJSONSchema → sanitizeJsonSchemaForWorkersAI → safeRun → safeParse — ENG-21)
    - TDD RED/GREEN with workerd vitest pool + vi.mock for safeRun
    - degrade-to-single-query on zod gate failure (not retry/ack machinery — EXP-01)
    - parallel Promise.all embedding for cosine gate (EXP-02)
    - local pure cosine helper (dot / (‖a‖·‖b‖))
key_files:
  created:
    - packages/mcp-server/src/query-expansion.ts
    - packages/mcp-server/src/__tests__/query-expansion.test.ts
  modified: []
decisions:
  - "expandQuery re-throws errors (including RateLimitError) rather than silently degrading — lets recall()'s catch apply EXP-10 single-query fallback + meta.gaps note (per plan spec)"
  - "keepVariantsAboveGate accepts pre-computed queryVector parameter so the original is never re-embedded (reuse discipline, caller controls the one embedding round-trip)"
  - "local cosine helper defined in query-expansion.ts — hybrid-rank.ts exports no cosine helper; adding one would require a separate commit + review; the local function is 8 lines and pure"
  - "zod-to-json-schema string removed from comments (ENG-21 warning reworded to avoid false-positive grep count)"
metrics:
  duration: ~5 minutes
  completed: 2026-06-08
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 3 Plan 2: Query Expansion Module (expandQuery + keepVariantsAboveGate) Summary

Zod-gated query rewriter module: `expandQuery` anchors the original at variant[0] (QE-7), degrades to single-query on zod gate failure, re-throws errors for EXP-10 recall() fallback. `keepVariantsAboveGate` enforces the 0.85 cosine similarity gate silently, always keeps variant[0].

## What Was Built

### Task 1 — ExpansionOutput schema, EXPANSION_SYSTEM_PROMPT, EXPANSION_JSON_SCHEMA, expandQuery (EXP-01, EXP-09)

`packages/mcp-server/src/query-expansion.ts` exports:

**`ExpansionOutput`** — zod schema with `.length(2)` hard cap (the variant cap — original is prepended in code, never requested from the model):
```typescript
export const ExpansionOutput = z.object({
  paraphrases: z.array(z.string().min(1).max(400)).length(2),
});
```

**`EXPANSION_JSON_SCHEMA`** — derived via the exact 3-step pipeline from `triage-worker/src/schemas.ts:131-138`:
1. `z.toJSONSchema(ExpansionOutput)` — native zod@4 (NOT zod-to-json-schema@3.x — ENG-21)
2. Destructure-strip `$schema`
3. `sanitizeJsonSchemaForWorkersAI()` — strips `propertyNames` → avoids Scout error 3030

**`EXPANSION_SYSTEM_PROMPT`** — encodes three non-negotiable rules:
1. Anti-HyDE (EXP-09): "Each rewrite MUST be a real search query, NOT a hypothetical answer or fabricated document — never invent facts (NO HyDE)."
2. Named-entity preservation (EXP-12): "Preserve every named entity (people, companies, products, dates) from the original query verbatim in BOTH rewrites."
3. Vary phrasing/synonyms only.

**`expandQuery(env, originalQuery): Promise<string[]>`**:
- Calls `safeRun(env, QUERY_EXPANSION_MODEL, { messages, response_format, temperature: 0.4, max_tokens: 256 })`
- Unwraps `response` field (JSON.parse if string — handles Workers AI chat wrapping)
- `ExpansionOutput.safeParse(candidate)` — gate failure → returns `[originalQuery]`
- Gate success → returns `[originalQuery, ...parsed.data.paraphrases]` (QE-7: original anchored at [0])
- Thrown errors (incl. RateLimitError) re-throw to caller for EXP-10 handling

### Task 2 — keepVariantsAboveGate (EXP-02)

**`keepVariantsAboveGate(env, queryVector, variants, gate = 0.85): Promise<string[]>`**:
- `variants[0]` (original) is ALWAYS kept, never embedded against itself
- For each paraphrase: `safeRun(env, EMBEDDING_MODEL, { text: [paraphrase] })` → `data[0]` vector → cosine against provided `queryVector`
- Paraphrases embedded in parallel via `Promise.all`
- Below-gate paraphrases dropped SILENTLY (no throw, no log noise — QE-2)
- Local `cosine(a, b)` pure helper: `dot / (‖a‖·‖b‖)` — no external dependency

### Tests

`packages/mcp-server/src/__tests__/query-expansion.test.ts` — 14 tests, all creds-free (vi.mock on ai-helper):

**expandQuery (5 tests):**
- Anchor: `result[0] === originalQuery` and `result.length === 3` ✓
- Zod gate degrade (3 paraphrases): returns `[originalQuery]` length 1 ✓
- Zod gate degrade (non-string): returns `[originalQuery]` ✓
- String unwrap: JSON.parse of `response` string produces 3-element array ✓
- Anti-HyDE: `EXPANSION_SYSTEM_PROMPT` contains hypothetical/fabricat/never invent + named entities rules ✓

**ExpansionOutput schema (5 tests):**
- Accepts exactly 2 paraphrases ✓
- Rejects 1 paraphrase ✓
- Rejects 3 paraphrases (.length(2) hard cap) ✓
- Rejects non-string elements ✓
- Rejects empty strings (min(1)) ✓

**keepVariantsAboveGate (4 tests):**
- Keep cosine 0.90 ≥ 0.85 ✓
- Drop cosine 0.80 < 0.85 silently (no throw) ✓
- Original survives alone (safeRun never called for variants[0]) ✓
- Mixed: [original, high(0.90), low(0.80)] → [original, high] ✓

## Verification

```
cd packages/mcp-server && npx vitest run query-expansion   → 14 passed ✓
cd packages/mcp-server && npm test                         → 17 test files, 149 passed, 2 skipped (no regression) ✓
grep -c "\.length(2)" packages/mcp-server/src/query-expansion.ts  → 3 (schema + docs) ✓
grep -c "z.toJSONSchema" packages/mcp-server/src/query-expansion.ts → 4 ✓
grep -c "zod-to-json-schema" packages/mcp-server/src/query-expansion.ts → 0 ✓
grep -c "env.AI.run" packages/mcp-server/src/query-expansion.ts → 0 ✓
grep -iE "hypothetical|fabricat|never invent|HyDE" EXPANSION_SYSTEM_PROMPT → matches ✓
```

## Deviations from Plan

**1. [Rule 1 - Bug] TDD RED commit initially blocked by ESLint non-null assertions**
- **Found during:** Task 1 TDD RED commit + Task implementation
- **Issue:** `a[0]! * b[0]!` in test cosine helper and `variants[0]!` in implementation triggered `@typescript-eslint/no-non-null-assertion` rule
- **Fix:** Replaced `!` assertions with `?? 0` (test helper) and `?? ""` (implementation return)
- **Files modified:** `query-expansion.test.ts` (line 175), `query-expansion.ts` (line 224)
- **Commits:** Fixed before respective RED and GREEN commits

**2. [Rule 3 - Blocking] Test assertion for "drop without throw" used lambda capture that didn't bind**
- **Found during:** Task 2 first GREEN run
- **Issue:** `await expect(async () => { result = await keepVariantsAboveGate(...) }).not.toThrow()` — vitest's `not.toThrow()` doesn't propagate the async result; `result` stayed `undefined`
- **Fix:** Replaced with direct `const result = await keepVariantsAboveGate(...)` — if it throws the test itself fails (equivalent assertion)
- **Files modified:** `query-expansion.test.ts`
- **Commit:** Fixed before RED commit

## Threat Surface Scan

T-03-02 (prompt injection via user query): MITIGATED — expansion output is zod-gated, consumed only as search variants, never as instructions. Verified: model output flows to Vectorize queries only.

T-03-03 (expansion drift pulling off-topic content): MITIGATED — 0.85 cosine gate enforced by `keepVariantsAboveGate` + original anchored at [0].

T-03-04 (HyDE/fabrication regression): MITIGATED — explicit anti-HyDE rule in `EXPANSION_SYSTEM_PROMPT`; string-content unit test asserts presence.

T-03-SC (npm install surface): CONFIRMED ZERO — no new packages. zod is pre-existing.

## Known Stubs

None. Both `expandQuery` and `keepVariantsAboveGate` are complete and testable. Wave 2 wires them into `recall()`.

## Self-Check: PASSED

- `packages/mcp-server/src/query-expansion.ts` — FOUND
- `packages/mcp-server/src/__tests__/query-expansion.test.ts` — FOUND
- commit 72cb46b — FOUND (`test(03-02): add failing tests...`)
- commit 938d4a7 — FOUND (`feat(03-02): query-expansion module...`)
