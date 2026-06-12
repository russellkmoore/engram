# Phase 4: Synthesis Activation Eval - Research

**Researched:** 2026-06-09
**Domain:** LLM-judge eval gate, citation post-processing, Workers AI model availability
**Confidence:** HIGH (judge model confirmed via Context7 + official CF docs; eval harness verified from source)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Keep `SYNTHESIS_SYSTEM_PROMPT` byte-frozen. The model cites memories by position. Do NOT edit the prompt.
- **D-02:** Convert position → `[memory_id]` in post-processing, deterministically from `ranked[i]` ↔ "memory i+1".
- **D-03:** Out-of-range citation guard: citation "memory N" where N exceeds supplied count → sentence dropped.
- **D-04:** Judge with a LARGER Workers AI model than the generator (Scout). Target: `@cf/meta/llama-3.3-70b-instruct` or strongest available workerd-compatible CF judge. Researcher confirms current availability.
- **D-05:** Eval framework = extend the existing vitest `.eval.test.ts` harness. New file: `synthesis-fidelity.eval.test.ts` in `__tests__/evals/`. Runs under `MAX_AI_CALLS ≤ 200` budget guard (PRE-02). NOT promptfoo.
- **D-06:** Judge is LLM-as-judge against SOURCE MEMORIES (SYN-02). Gate does NOT depend on `expected_synthesis` captions.
- **D-07:** `expected_synthesis` captions are AI-drafted, no human review. Feed only secondary completeness signal, never the hard faithfulness gate.
- **D-08:** Caption coverage at planner/researcher's discretion within D-07 constraint. Default: 30-entry validate split.
- **D-09:** Drop uncited sentences EXCEPT (a) cosine-<0.7 leading hedge sentence (SYN-06) and (b) gap-acknowledgment sentences. Soft-flag-only is rejected.
- **D-10:** Create `04-CF-CODE-ASSIST-USAGE.md` with 3-question-checklist columns. Every code-producing task appends one row.

### Claude's Discretion

- Exact judge prompt / faithfulness rubric wording (researcher drafts below — must encode "trace every claim to a source memory; zero fabricated entities").
- Caption-generation model + exact coverage count within D-07/D-08.
- Where the position→id post-processor lives (file-local helper in `tools.ts` vs extracted), provided it runs before `buildRecallResponse`.
- Token-count estimation method for the 6K preflight (the scaffold uses ~4 chars/token; refine if needed).

### Deferred Ideas (OUT OF SCOPE)

- Flip `verbosity` default to `"both"` — v0.3.
- Specialize `SYNTHESIS_MODEL` to a frontier/long-context model — v0.3+.
- promptfoo adoption as a broader eval harness — reconsider when eval count grows beyond vitest-custom.
- Human-reviewed `expected_synthesis` captions — if completeness signal proves too noisy, a review pass becomes a v0.3 quality task.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYN-01 | `synthesis-fidelity.eval.test.ts` scores synthesis outputs across corpus augmented with `expected_synthesis` captions | Corpus structure confirmed; all 100 entries have `expected_synthesis: null` awaiting caption fill; 30 validate-split entries targeted per D-08 |
| SYN-02 | LLM-judge faithfulness pass rate ≥ 90%; zero hallucinated entities | Judge model confirmed: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; JSON mode verified; rubric pattern documented |
| SYN-03 | Citation density ≥ 1 `[memory_id]` marker per 80 chars; drop uncited sentences | D-02 position→id mapping; `Intl.Segmenter` available in workerd for sentence segmentation |
| SYN-04 | p50 ≤ 5s, p99 ≤ 8s for `recall(verbosity="synthesis"/"both")` | Latency eval pattern mirrored from `recall-latency.eval.test.ts`; percentile method documented |
| SYN-05 | Pre-flight: serialized context ≤ 6K tokens; over-budget truncated with `meta.gaps` note | ~4 chars/token heuristic confirmed as project standard; `trimRankedForSynthesis` already implements drop-trailing strategy; assertion must THROW |
| SYN-06 | Cosine-aware hedging: synthesis opens with hedge when `min(cosine) < 0.7` | Branch lives in synthesis block after `safeRun` call; low-confidence path adds hedge prefix to synthesis string |
| SYN-07 | Single-memory synthesis rejected; return chunk with `meta.gaps = ["synthesis skipped: only one source"]` | Guard added before the synthesis `if` block; check `trimmedForSynth.length < 2` |
| SYN-08 | `verbosity` default stays `"chunks"` — OUT OF SCOPE | No action required; existing default preserved |
| SYN-09 | Analytics blob extension: `blobs[1]="synthesis"`, `doubles[0]=latency_ms`, `doubles[1]=token_count` | Existing schema documented; cross-file change to all `writeAnalytics` callers in synthesis block — Claude work per D-10 |
| SYN-10 | `SYNTHESIS_MODEL` stays aliased to Scout. `SYNTHESIS_SYSTEM_PROMPT` byte-frozen | Confirmed: prompt is `as const` at line 132 of `tools.ts`; any prompt change requires full eval re-run |
</phase_requirements>

---

## Summary

Phase 4 promotes an already-scaffolded `verbosity=synthesis|both` branch in `recall()` from "implemented but unvalidated" to "shipped behind an LLM-judge eval gate." All synthesis infrastructure exists in `packages/mcp-server/src/tools.ts` (lines 114–166 helpers, 793–834 synthesis block). This phase's work is: (1) add a faithfulness eval driven by a 70B CF judge, (2) wire citation post-processing (position→`[memory_id]` + uncited-sentence drop), (3) harden the 6K token preflight to throw rather than log, (4) add single-memory rejection and cosine-aware hedging, (5) extend analytics blobs for synthesis telemetry, and (6) augment the eval corpus with AI-drafted `expected_synthesis` captions for the secondary completeness signal.

The single most critical research finding is the judge model correction: `@cf/meta/llama-3.3-70b-instruct` (without the `-fp8-fast` suffix, as D-04 targets) does NOT exist on Cloudflare's catalog. The correct available model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — which IS in the JSON mode supported list, has a 24K-token context window, and is confirmed workerd-compatible via `env.AI.run()`. The legacy `@cf/meta/llama-3.1-70b-instruct` was deprecated on 2026-05-30 and MUST NOT be used.

The existing vitest `eval` tier infrastructure is mature and directly reusable: `eval-budget.setup.ts` wraps `env.AI.run` + `env.VECTORIZE.query` with the 200-call ceiling; the percentile computation pattern from `recall-latency.eval.test.ts` is the canonical model for SYN-04; the `scripts/sync-eval-corpus.mjs` + vendored fixture discipline from Phase 2 D-11..D-14 is the pattern for SYN-01 corpus augmentation.

**Primary recommendation:** Use `@cf/meta/llama-3.3-70b-instruct-fp8-fast` as the judge model. Wire it via `safeRun(env, JUDGE_MODEL, { messages, response_format: { type: "json_schema", json_schema: ... } })` using the existing `safeRun` abstraction and a Zod-derived judge verdict schema. Budget: 1 judge call per eval corpus entry = 30 calls for the validate split (within 200-call ceiling).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Synthesis generation | API / MCP Worker (`mcp-server`) | Workers AI binding (`env.AI`) | Already implemented in `tools.ts` synthesis block; opt-in only |
| Citation post-processing | API / MCP Worker (`mcp-server`, file-local helper) | — | D-02 mapping is deterministic string transform from `ranked[]`; lives between `safeRun` return and `buildRecallResponse` call |
| LLM-judge eval | Eval harness (vitest `eval` tier) | Workers AI binding (`env.AI`, judge model) | Eval-only — never runs in production; uses existing `eval-budget.setup.ts` budget guard |
| Token preflight assertion | API / MCP Worker (`mcp-server`, `trimRankedForSynthesis`) | — | Harden existing helper to throw; ~4 chars/token heuristic is the project-standard method |
| Analytics telemetry | API / MCP Worker (`mcp-server`, `writeAnalytics`) | Analytics Engine binding | Blob layout change is cross-file; Claude work per D-10 |
| Corpus caption generation | Offline script (`scripts/`) | Workers AI (caption model) | AI-drafted, committed to corpus; no human review per D-07 |

---

## Standard Stack

### Core (no new packages — all existing project infrastructure)

| Component | Version / ID | Purpose | How Used |
|-----------|-------------|---------|----------|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Current GA | LLM judge for faithfulness eval | Called via `env.AI.run(JUDGE_MODEL, { messages, response_format })` in `synthesis-fidelity.eval.test.ts` |
| `@cf/meta/llama-4-scout-17b-16e-instruct` (Scout) | Current GA | Synthesis generator (stays alias) | `SYNTHESIS_MODEL` = `INGESTION_CLASSIFIER_MODEL` per SYN-10 |
| `vitest` | 4.1.8 (project) | Eval harness | `eval` tier, `synthesis-fidelity.eval.test.ts` |
| `@cloudflare/vitest-pool-workers` | 0.16.14 (project) | workerd pool for eval | Real `env.AI.run` calls against CF AI |
| `zod` | project version | Judge verdict schema derivation | `z.object({ faithful: z.boolean(), ... })` → `zodToJsonSchema` → `response_format.json_schema` |
| `Intl.Segmenter` | V8 built-in (workerd) | Sentence segmentation for citation density check | `new Intl.Segmenter('en', {granularity:'sentence'})` — confirmed available in Node 22 V8; [ASSUMED] available in current workerd (V8-weekly-stable; no explicit CF docs confirmation, but sentence segmenter is ES2022 standard) |

### No New npm Packages Required

This phase operates entirely within existing project dependencies. The judge model is a Workers AI binding call (no SDK install needed). Zod is already a project dependency.

---

## Package Legitimacy Audit

> No NEW npm packages are installed in this phase. All dependencies are existing project infrastructure. Cloudflare Workers AI model IDs (`@cf/meta/...`) are runtime binding identifiers, not npm packages — slopcheck does not apply to them. Their legitimacy is confirmed via the official Cloudflare Workers AI catalog.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
recall(query, verbosity="synthesis"|"both")
  │
  ├── trimRankedForSynthesis(ranked, 6000)          [SYN-05: token preflight — throw if ALL memories exceed budget]
  │     └── charBudget = maxTokens × 4 (~4 chars/token heuristic)
  │     └── drop-trailing-first strategy
  │     └── if trimmedForSynth.length === 0 → throw Error("synthesis-context-overflow")  [SYN-05 hard assert]
  │
  ├── SYN-07 single-memory guard
  │     └── if trimmedForSynth.length < 2 → synthesis=null, meta.gaps += ["synthesis skipped: only one source"]
  │
  ├── SYN-06 cosine-aware hedge flag
  │     └── lowConfidence = min(cosine over trimmedForSynth) < 0.7
  │
  ├── formatBlocksForSynthesis(trimmedForSynth, query)  [existing helper, unchanged]
  │     └── "memory 1", "memory 2", ... positional format
  │
  ├── env.AI.run(SYNTHESIS_MODEL, { messages: [system, user], temperature:0.3, max_tokens:1024 })
  │     └── safeRun wrapper (existing ai-helper.ts abstraction)
  │     └── catch → synthesis=null, meta.gaps surfaced
  │
  ├── POST-PROCESSING (NEW — between safeRun return and buildRecallResponse)
  │     ├── applyHedgePrefix(synthesis, lowConfidence)    [SYN-06]
  │     ├── mapPositionsToCitationIds(synthesis, trimmedForSynth)  [D-02: "memory 1" → [blockId]]
  │     ├── guardOutOfRangeCitations(synthesis, trimmedForSynth.length)  [D-03: drop sentence if N > count]
  │     └── dropUncitedSentences(synthesis, { allowHedge, allowGapAck })  [D-09: Intl.Segmenter loop]
  │
  ├── writeAnalytics(env, { blobs:[..., "synthesis", ...], doubles:[latency, tokenCount, 0, 0] })  [SYN-09]
  │
  └── buildRecallResponse({ ..., synthesis, ... })
```

```
synthesis-fidelity.eval.test.ts  (NEW — eval tier)
  │
  ├── Load validate-split corpus entries (30 entries, expected_synthesis captions if available)
  ├── For each entry:
  │     ├── Invoke real recall(verbosity="synthesis") against seeded Vectorize fixtures
  │     ├── Extract synthesis string from response
  │     ├── Call JUDGE_MODEL with faithfulness rubric prompt + synthesis + source memories
  │     │     └── Response: { faithful: bool, hallucinated_entities: string[], unsupported_claims: string[] }
  │     ├── Assert: faithful === true → PASS; increment pass_count
  │     ├── Assert: hallucinated_entities.length === 0  [SYN-02 zero-hallucination gate]
  │     └── Log per-entry verdict
  ├── Assert: pass_count / total >= 0.90  [SYN-02: ≥90% faithfulness gate, BLOCKS phase]
  ├── Log latency samples → computePercentile for p50 / p99  [SYN-04]
  └── Assert: p99 <= 8000ms  [SYN-04: p99 ≤ 8s gate; p50 ≤ 5s logged but local-latency caveat applies]
```

### Recommended File Changes

```
packages/mcp-server/src/
  tools.ts                          # Add SYN-05 throw, SYN-07 guard, SYN-06 hedge, D-02 post-processor,
                                    # D-03 out-of-range guard, D-09 sentence drop, SYN-09 analytics changes
  __tests__/evals/
    synthesis-fidelity.eval.test.ts # NEW — judge-call loop, faithfulness gate, latency gate
    fixtures/
      recall-corpus-v2.json         # Updated — expected_synthesis captions added (30 validate entries)
shared/ai-config/src/index.ts       # NEW constant: JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
scripts/
  sync-eval-corpus.mjs              # Extend to copy caption-augmented corpus (D-08 pattern mirror)
.planning/evals/recall-corpus.json  # Add expected_synthesis captions to validate-split entries
.planning/phases/04-synthesis-activation-eval/
  04-CF-CODE-ASSIST-USAGE.md        # NEW (D-10 tracker)
```

### Pattern 1: Judge Call with Zod-Gated Verdict (SYN-02)

```typescript
// Source: CF JSON Mode docs + existing project safeRun pattern (tools.ts)
// Judge verdict schema — derives json_schema via zodToJsonSchema
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";

const JudgeVerdict = z.object({
  faithful: z.boolean(),
  hallucinated_entities: z.array(z.string()),
  unsupported_claims: z.array(z.string()),
});
type JudgeVerdict = z.infer<typeof JudgeVerdict>;

const JUDGE_JSON_SCHEMA = sanitizeJsonSchemaForWorkersAI(
  zodToJsonSchema(JudgeVerdict, { target: "openApi3", $refStrategy: "none" })
);

// Judge call (in synthesis-fidelity.eval.test.ts)
const judgeResp = await safeRun(env, JUDGE_MODEL, {
  messages: [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: buildJudgeUserMessage(synthesis, sourceMemories) },
  ],
  temperature: 0.1,  // low temp for deterministic judgment
  max_tokens: 512,
  response_format: { type: "json_schema", json_schema: JUDGE_JSON_SCHEMA },
});
const parsed = JudgeVerdict.safeParse(judgeResp.response);
```

**Note:** Use `sanitizeJsonSchemaForWorkersAI` (existing export from `@engram/ai-config`) to strip `propertyNames` before passing to `response_format`. This is the project's established workaround for Workers AI error 3030. [VERIFIED: source code at `shared/ai-config/src/index.ts` lines 273-288]

### Pattern 2: Judge System Prompt (faithfulness rubric — Claude's discretion per D-04)

```text
You are a faithfulness judge for a memory recall system. Given a synthesis paragraph and the source memories it was generated from, determine whether the synthesis is faithful.

A synthesis is FAITHFUL if and only if:
- Every factual claim traces to at least one supplied source memory
- No entity names, dates, companies, roles, or numeric values appear that are absent from ALL source memories
- Paraphrasing is acceptable; fabrication is not

Return a JSON object with:
  "faithful": true if ALL claims are traceable to source memories; false if ANY claim lacks support
  "hallucinated_entities": list of entity names/values in the synthesis that do NOT appear in any source memory (empty list if none)
  "unsupported_claims": list of synthesis sentences or clauses with no source memory support (empty list if none)

Source memories are provided as numbered blocks. Treat each numbered block as the ground truth.
```

### Pattern 3: Position → `[memory_id]` Post-Processor (D-02)

```typescript
// Source: CONTEXT.md D-02 deterministic mapping
// Runs on synthesis string AFTER safeRun, BEFORE buildRecallResponse.
// trimmedForSynth[i] corresponds to "memory i+1" in the synthesis text.
function mapPositionsToCitationIds(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
): string {
  let result = synthesis;
  for (let i = 0; i < trimmedForSynth.length; i++) {
    const position = i + 1;
    const blockId = trimmedForSynth[i]!.id;
    // Replace "memory N" (case-insensitive) with [block_id]
    result = result.replace(
      new RegExp(`memory ${position}(?=\\b|[^0-9])`, "gi"),
      `[${blockId}]`,
    );
  }
  return result;
}
```

### Pattern 4: Uncited-Sentence Drop (D-09) with Intl.Segmenter

```typescript
// Source: CONTEXT.md D-09; Intl.Segmenter ES2022 standard
// CONFIRMED available in Node 22 V8 (tested locally). [ASSUMED] available in workerd
// (workerd tracks Chrome-stable V8, which has had Intl.Segmenter since V8 v10.7 / Chrome 107).
function dropUncitedSentences(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
  opts: { lowConfidenceHedge?: boolean } = {},
): string {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const segments = [...segmenter.segment(synthesis)];
  const CITATION_RE = /\[[^\]]+\]/; // matches [block_id]
  const GAP_ACK_RE = /\b(no information|not found|unable to|unclear|gap|don't have)\b/i;

  const kept: string[] = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]!;
    const sentence = seg.segment.trim();
    if (!sentence) continue;
    // D-09 exceptions: first sentence if lowConfidenceHedge; any gap-acknowledgment sentence
    const isFirstAndHedge = opts.lowConfidenceHedge && idx === 0;
    const isGapAck = GAP_ACK_RE.test(sentence);
    if (isFirstAndHedge || isGapAck || CITATION_RE.test(sentence)) {
      kept.push(seg.segment);
    }
    // else: drop — no citation, not a hedge, not a gap acknowledgment
  }
  return kept.join("").trim();
}
```

**Fallback (if Intl.Segmenter absent in workerd):** Split on `/(?<=[.!?])\s+/` regex. Regex fallback is less accurate with abbreviations ("Dr. Smith") but adequate for the 2-4 sentence synthesis outputs Scout produces. [ASSUMED] — Intl.Segmenter is the primary; regex is the backup.

### Pattern 5: Latency Percentile (mirror of recall-latency.eval.test.ts)

```typescript
// Source: packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts lines 155-162
function computePercentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sortedMs.length) - 1, 0),
    sortedMs.length - 1,
  );
  return sortedMs[idx] ?? 0;
}
// SYN-04: log p50, hard-assert p99 ≤ 8000ms
// Note: same local-latency caveat as EXP-11 — dev machine→CF edge network dominates.
// SYN-04 local hard assertion must use 20_000ms (same LOCAL_HANG_CEILING pattern) for CI;
// production p50/p99 confirmed via Analytics Engine blobs.
```

### Anti-Patterns to Avoid

- **Soft-flagging uncited sentences (D-09 locked):** Must drop, not warn. Any soft-flag-only implementation fails SYN-03's real gate requirement.
- **Scout-judging-Scout:** Using `SYNTHESIS_MODEL` (Scout) as both generator and judge is self-lenient. Judge MUST be `@cf/meta/llama-3.3-70b-instruct-fp8-fast` per D-04.
- **Editing `SYNTHESIS_SYSTEM_PROMPT`:** Any change to the prompt invalidates the eval baseline and costs a full eval re-run. Document this cost prominently in the plan as a Risk Note.
- **Fabricating `expected_synthesis` captions via training data:** Captions MUST be generated by running the caption-generation script against a real frontier model (not inferred from training data). Fake captions poison the completeness metric.
- **Inflating `MAX_AI_CALLS` when budget runs tight:** Per `eval-budget.setup.ts` CONTRACT section — the literal 200 must appear in source. Budget the eval per the call-count formula instead.
- **Calling judge inside production recall path:** The judge is eval-only. Never wire it into the production `tools.ts` synthesis block.

---

## Research Answers to Critical Questions

### Q1: D-04 Judge Model Availability (HIGHEST PRIORITY)

**CONFIRMED FINDING:** `@cf/meta/llama-3.3-70b-instruct` (the D-04 target ID, without suffix) does NOT exist on Cloudflare's Workers AI catalog.

**Correct model to use:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

| Property | Value | Source |
|----------|-------|--------|
| Exact ID | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | [VERIFIED: CF docs] |
| Context window | 24,000 tokens | [VERIFIED: CF model page] |
| JSON mode (`response_format: {type:"json_schema"}`) | YES — listed in CF JSON Mode supported-models | [VERIFIED: CF JSON Mode docs] |
| Workerd-compatible (`env.AI.run()`) | YES — TypeScript examples use `env.AI.run(...)` | [VERIFIED: CF docs] |
| Pricing | $0.29/M input tokens, $2.25/M output tokens | [CITED: developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast] |
| Deprecation status | Active (not deprecated) | [VERIFIED: CF changelog — only llama-3.1-70b deprecated 2026-05-30] |

**DO NOT use `@cf/meta/llama-3.1-70b-instruct`** — deprecated 2026-05-30 per CF changelog.

**Fallback judge models (strongest-first, if fp8-fast becomes unavailable):**

| Fallback | ID | Context Window | JSON Mode | Notes |
|----------|-----|---------------|-----------|-------|
| 1st | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | 80,000 tokens | YES (CF JSON Mode list) | 32B reasoning model; larger context than 70B fp8-fast; higher per-token cost ($0.50/$4.88 per M) |
| 2nd | `@cf/meta/llama-3.1-70b-instruct` | 24,000 tokens | YES (CF JSON Mode list) | **DEPRECATED 2026-05-30 — emergency fallback only** |

[CITED: developers.cloudflare.com/workers-ai/features/json-mode, developers.cloudflare.com/workers-ai/changelog]

**Planner action:** Add constant `JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const` to `shared/ai-config/src/index.ts`. Add JSDoc comment: "EVAL-ONLY — do NOT call in production path."

### Q2: LLM-as-Judge Faithfulness Rubric Pattern

**Recommended verdict shape** (pointwise, single-pass, JSON-structured):

```typescript
// Zod schema for judge verdict
const JudgeVerdict = z.object({
  faithful: z.boolean(),            // PASS gate: true iff all claims trace to a source memory
  hallucinated_entities: z.array(z.string()),  // zero-tolerance gate: must be []
  unsupported_claims: z.array(z.string()),     // informational (not a hard gate — used for debugging)
});
```

**Why pointwise, not pairwise:** Pairwise comparison (synthesis A vs B) is used for preference ranking, not factual grounding. For faithfulness-against-sources, pointwise is the correct pattern — the judge scores each synthesis independently against the source memories. [CITED: labelyourdata.com/articles/llm-as-a-judge, comet.com structured-generation-llm-judge]

**Why single-pass, not two-step:** The two-step approach (candidate generation + verification) improves HaluBench accuracy from 56% → 68%, but the Scout synthesis outputs are short (2-4 sentences) and the source memories are numbered and explicit. Single-pass with a strong 70B judge is sufficient. Reserve two-step for v0.3 `reflect()` deep synthesis if fidelity falls short. [CITED: comet.com blog post]

**Key rubric elements for this domain:**
- Check entity names against source memories (person names, company names, role titles — the spike-002 5-drop-categories domain)
- Check dates (spike-002 finding: dates are the highest-frequency drop category)
- Check numeric values (salaries, durations, version numbers)
- Paraphrasing is ALLOWED; fabrication is not
- Citation markers (`[memory_id]`) are already in the synthesis by the time the judge sees it — they help the judge trace claims

[CITED: spike-findings-engram/references/engram-response-synthesis-contract.md §6]

### Q3: Token-Count Estimation for 6K Preflight (SYN-05)

**Confirmed project standard:** ~4 chars/token. This is already the `trimRankedForSynthesis` implementation (`charBudget = maxTokens * 4`). [VERIFIED: tools.ts line 143]

**Is a real tokenizer worth the dependency?** No. Rationale:
- Scout (llama-4-scout) uses the LLaMA tokenizer, which averages ~4 chars/token on English prose — the project heuristic is correct
- A real tokenizer (`@dqbd/tiktoken`, `tokenizers`) adds bundle weight and compilation complexity on workerd
- The 6K budget has a ~20% safety margin over the nominal limit — the heuristic imprecision (±10-15%) is absorbed by the margin
- The assert should THROW (Risk Note SY-3): `if (trimmedForSynth.length === 0) throw new Error("synthesis-preflight: all memories exceed 6K token budget")`

**[ASSUMED]** that Scout's tokenizer averages ~4 chars/token. This is consistent with the project's existing usage and spike-002 findings, but not verified by running a tokenizer count against the actual model vocabulary.

**Enhancement for SYN-05:** The current `trimRankedForSynthesis` silently returns an empty array if even the first memory exceeds the budget. The phase must harden this to: (a) return the first memory truncated to charBudget if the array would be empty, OR (b) throw a hard assertion (per SY-3). Decision is Claude's discretion — throwing is the SY-3 literal; truncating-to-first is more graceful. Recommend the `meta.gaps` note on truncation regardless.

### Q4: Citation Post-Processing — Intl.Segmenter in workerd

**Intl.Segmenter availability:**
- Confirmed available in Node.js 22 V8 (tested locally — produces correct sentence segments)
- workerd tracks Chrome-stable V8 releases on a weekly cadence; `Intl.Segmenter` shipped in V8 v10.7 (Chrome 107, October 2022)
- [ASSUMED] available in current workerd. No explicit CF docs confirmation found, but workerd's V8 version is far past the introduction point. Risk level: LOW.
- Fallback: regex `/(?<=[.!?])\s+(?=[A-Z])/` splits on sentence-ending punctuation. Less accurate on "Dr. Smith" or multi-sentence numbers, but synthesis is 2-4 sentences where abbreviation edge cases are rare.

**Citation density check (SYN-03):** After `dropUncitedSentences`, verify total `[memory_id]` marker count divided by synthesis char count ≥ 1/80. If below threshold: treat as a per-entry eval failure (logged, not a phase-blocking assertion — the drop pass already enforced the per-sentence gate; density check is a diagnostic).

### Q5: Latency Contract Validation (SYN-04) — Mirroring recall-latency.eval.test.ts

**Percentile method (canonical project pattern):**
```typescript
// From recall-latency.eval.test.ts lines 155-162 — same method for SYN-04
sort(latencySamples); // ascending
const p50 = computePercentile(sorted, 50);
const p99 = computePercentile(sorted, 99);
```
[VERIFIED: source file read]

**Local-latency caveat (same as EXP-11):** Dev-machine → CF edge network dominates timing (500ms–1s per call). Local eval runs measure network-bound latency, not production co-located latency. Per `recall-latency.eval.test.ts` pattern:
- Log p50/p99 against the SYN-04 budget (5s / 8s) for visibility
- Hard-assert only a hang-guard ceiling (e.g., 20,000ms p99) locally
- Production SYN-04 confirmation: inspect Analytics Engine `blobs[1]="synthesis"` latency blobs from the deployed Worker

**Budget math for synthesis eval:**
- Per-entry eval cost: 1 recall AI call (embed + Vectorize) + 1 synthesis AI call (Scout) + 1 judge AI call (70B fp8-fast) ≈ 3 AI calls
- 30 validate-split entries × 3 = 90 calls — within 200-call ceiling (PRE-02)
- If synthesis fails early (null) for some entries, judge call is skipped → actual call count < 90

**QUERY_CAP recommendation:** Cap at 30 entries (full validate split) — budget allows it. Add a `SYNTHESIS_FIDELITY_QUERY_CAP = 30` constant analogous to `LATENCY_QUERY_CAP = 20`.

### Q6: Vitest Eval Harness Extension (D-05)

**Exact vitest eval tier configuration** (from `vitest.config.ts`, confirmed):

```typescript
// The eval project is gated on CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
// Config properties:
{
  name: "eval",
  include: ["src/__tests__/**/*.eval.test.ts"],   // glob picks up synthesis-fidelity.eval.test.ts automatically
  setupFiles: ["./src/__tests__/evals/eval-budget.setup.ts"],  // wraps env.AI.run + env.VECTORIZE.query with 200-call ceiling
  isolate: false,        // MANDATORY — prevents per-file counter reset
  maxWorkers: 1,         // MANDATORY — single process for counter integrity
  sequence: { groupOrder: 1 },
}
```

**Key discipline from `eval-budget.setup.ts` CONTRACT:**
- `MAX_AI_CALLS = 200` is a LITERAL constant — do NOT make env-configurable
- Counter wraps BOTH `env.AI.run` AND `env.VECTORIZE.query` (both count against budget)
- THROW when exceeded (not skip, not log)
- Post-run Analytics Engine write is defense-in-depth aggregate

**`scripts/eval-budget-summary.mjs` reuse:** The script has a `--conflict-pipeline-p99` mode pattern that queries Analytics Engine for latency blobs. A new `--synthesis-p99` mode can be added analogously for SYN-04 production confirmation. However, this is a discretionary enhancement — the PHASE 4 gate uses the in-test assertion.

**Scaffold pattern for `synthesis-fidelity.eval.test.ts`:**

```typescript
/**
 * SYN-01 / SYN-02 / SYN-04 synthesis fidelity eval
 * — LLM judge faithfulness gate (≥90%) + latency gate (p99 ≤ 8s logged)
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { JUDGE_MODEL, SYNTHESIS_MODEL } from "@engram/ai-config";
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import { safeRun } from "../../ai-helper.js";
// ... judge schema, JUDGE_SYSTEM_PROMPT, helpers
```

The file follows the same `it.skip` / credential-gate pattern as `recall-f1.eval.test.ts`.

### Q7: Corpus Caption Augmentation (SYN-01, D-07/D-08)

**Corpus structure confirmed:**
- File: `.planning/evals/recall-corpus.json`
- 100 entries, all with `"expected_synthesis": null`
- Validate split: 30 entries (`"split": "validate"`)
- Train split: 70 entries

**D-08 decision: caption the 30-entry validate split** (consistent with held-out discipline; matches the eval loop target).

**Caption generation approach (D-07 — AI-drafted, no human review):**
- Run `recall(verbosity="synthesis")` against each validate-split query using a frontier model (Scout or larger)
- Or: write a one-off `scripts/generate-synthesis-captions.mjs` that calls `env.AI.run(SYNTHESIS_MODEL, ...)` for each validate-split entry
- Output: augmented corpus JSON with `expected_synthesis: "string"` for validate entries, `null` for train entries
- Commit augmented corpus to `.planning/evals/recall-corpus.json` + sync to `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json`

**Mirror D-11..D-14 pattern:**
- `scripts/sync-eval-corpus.mjs` already exists — extend or create a companion `scripts/generate-synthesis-captions.mjs`
- Vendored fixture at `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — already synced by `pretest:eval` npm script
- Top-of-file comment in vendored fixture: "auto-synced from .planning/evals/recall-corpus.json — edit source, not this copy"

**Secondary signal only (D-06 + D-07):** The `expected_synthesis` captions feed a completeness check ("did synthesis surface what a good answer should cover?") — this is a logged metric, NOT a phase-blocking gate. The hard gates are: faithfulness ≥ 90% (against source memories) + zero hallucinated entities. Both are caption-independent.

### Q8: Analytics Blob Extension (SYN-09)

**Current `writeAnalytics` calls in synthesis block** (lines 813-831 of `tools.ts`):

| Call site | Current blobs | Current doubles |
|-----------|---------------|-----------------|
| Success path | `["mcp-server", CLASSIFIER_MODEL, wsTag, "success"]` | `[Date.now()-synthStart, synthInput.length, 0, 0]` |
| Failure path | `["mcp-server", CLASSIFIER_MODEL, wsTag, synthOutcome]` | `[Date.now()-synthStart, 0, 0, retry?1:0]` |

**SYN-09 required changes** (must reconcile with AI-SPEC §7 schema):

| Field | Current | SYN-09 Target | Notes |
|-------|---------|---------------|-------|
| `blobs[1]` | `CLASSIFIER_MODEL` (model ID string) | `"synthesis"` | Operation-kind discriminator; enables SQL filter on synthesis-specific rows |
| `doubles[0]` | `Date.now()-synthStart` (latency_ms) | same | No change |
| `doubles[1]` | `synthInput.length` (char count) | `tokenCount` (estimated: `Math.ceil(synthInput.length / 4)`) | Better unit for the AE SQL queries |
| `doubles[2]` | `0` (retry count) | `0` | No change |
| `doubles[3]` | `0` (binding-failure flag) | retry-429 ? 1 : 0 | No change |

**Cross-file impact:** Every `writeAnalytics` caller in the synthesis block must be updated consistently. The existing `ANALYTICS_ENV_TAG` constant and `writeAnalytics` helper are unchanged. This is Claude work per D-10 (synthesis = cross-file consistency invariant on blob indices).

**Note:** The AI-SPEC §7 schema says `blobs[1]` = "operation kind" (e.g., model ID or `"vectorize-query"`). Changing from model ID to `"synthesis"` is a schema evolution — both are valid operation-kind discriminators. The SQL query that separates synthesis rows from embedding rows uses `blob2 = 'synthesis'` after this change.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-structured judge verdict | Custom JSON extraction/parsing | Zod schema + `sanitizeJsonSchemaForWorkersAI` + `response_format.json_schema` | Existing project pattern (AI-05 in triage-worker). The `sanitizeJsonSchemaForWorkersAI` helper is already written for the CF Workers AI quirk that rejects `propertyNames`. |
| Sentence segmentation | Regex-only sentence splitter | `Intl.Segmenter` (primary) + regex fallback | Built-in V8 API; handles abbreviation edge cases that naive regex misses |
| Percentile computation | Custom math | Mirror `computePercentile` from `recall-latency.eval.test.ts` | Same pattern already in the codebase and covers the CON-07/EXP-11 patterns |
| Budget guard | New eval counter | Re-use `eval-budget.setup.ts` + 200-call `MAX_AI_CALLS` literal | The setup file already wraps `env.AI.run` and `env.VECTORIZE.query`; adding another eval file uses the same guard automatically |
| 429 detection in judge call | Custom error-checking | `safeRun` wrapper (existing `ai-helper.ts`) | Already handles the Workers AI `{success:false, errors:[{code:7501}]}` envelope pattern |

---

## Common Pitfalls

### Pitfall 1: Judge Model ID Typo / Using Deprecated Model

**What goes wrong:** Using `@cf/meta/llama-3.3-70b-instruct` (without `-fp8-fast`) silently fails — model does not exist. Using `@cf/meta/llama-3.1-70b-instruct` returns a deprecation error after 2026-05-30.
**Why it happens:** D-04 CONTEXT.md says "target: `@cf/meta/llama-3.3-70b-instruct`" — the actual catalog ID has the `-fp8-fast` suffix.
**How to avoid:** Planner hard-codes `@cf/meta/llama-3.3-70b-instruct-fp8-fast` in the `JUDGE_MODEL` constant. Add a Wave 0 task to verify the model responds before the eval loop runs.
**Warning signs:** `safeRun` returns `{success: false}` or a model-not-found error on first judge call.

### Pitfall 2: Budget Exhaustion on 30-Entry Eval × Judge Call

**What goes wrong:** 30 entries × 3 calls (embed + synthesis + judge) = 90 calls. If recall also triggers query expansion (EXP-03 fan-out), up to 5 additional calls per entry → 30 × 8 = 240 calls > 200 ceiling.
**Why it happens:** `recall(verbosity="synthesis")` in the eval will fire expansion if `top1_cosine < 0.65` — the adaptive routing is live.
**How to avoid:** Disable query expansion in the synthesis eval run (pass a flag or use `verbosity="synthesis"` with a direct call that bypasses expansion). Alternatively: call synthesis path directly without the full `recall()` handler (generate synthesis independently of the recall pipeline). Planner should document the call-count budget math in the plan.
**Warning signs:** `eval-budget.setup.ts` throws `[eval-budget] MAX_AI_CALLS exceeded` during the eval run.

### Pitfall 3: Out-of-Range Citation Guard Drops Too Aggressively

**What goes wrong:** If the synthesis says "memory 1 and memory 2" but only 1 memory was supplied (SYN-07 should have caught this upstream), the D-03 guard drops both references. If the guard runs before D-02 position→id mapping, it uses wrong index math.
**Why it happens:** Order dependency: D-03 must run AFTER D-02 (position→id) OR before mapping while still comparing against the count, not the IDs.
**How to avoid:** Apply guards in this order: (1) SYN-07 single-memory rejection, (2) D-02 position→id mapping, (3) D-03 out-of-range guard (now operates on position numbers before they become IDs), (4) D-09 sentence drop.

### Pitfall 4: `SYNTHESIS_SYSTEM_PROMPT` Byte-Freeze Violation

**What goes wrong:** A plan task "improves" the synthesis prompt for SYN-06 hedging by editing `SYNTHESIS_SYSTEM_PROMPT`. This breaks the spike-findings §6 byte-stable contract AND requires a full eval re-run to re-establish the ≥90% baseline.
**Why it happens:** SYN-06 hedging looks like a prompt feature, but D-01 locks the prompt.
**How to avoid:** SYN-06 hedging is implemented as a POST-PROCESSING prefix added to the `synthesis` string AFTER the `safeRun` call — NOT as a prompt change. The hedge language is appended by the post-processor when `lowConfidence === true`.

### Pitfall 5: Expected_Synthesis Captions Contaminating the Hard Gate

**What goes wrong:** A task uses `expected_synthesis` captions as ground truth for the faithfulness judge (checking synthesis against captions instead of source memories).
**Why it happens:** The captions look like ground truth. D-06 explicitly prohibits this.
**How to avoid:** The judge prompt references ONLY the numbered source-memory blocks. Captions are passed to a separate completeness-check function, never to the faithfulness judge.

### Pitfall 6: Intl.Segmenter Unavailable in workerd

**What goes wrong:** `new Intl.Segmenter(...)` throws `ReferenceError: Intl.Segmenter is not defined` in the workerd test pool.
**Why it happens:** [ASSUMED] availability — not explicitly confirmed in CF docs.
**How to avoid:** Wrap Intl.Segmenter usage in a try/catch with the regex fallback. A Wave 0 unit test should verify Segmenter works in the workerd pool before the full eval runs.

---

## Code Examples

### Full writeAnalytics SYN-09 Change

```typescript
// Source: tools.ts synthesis block (lines 813-831) — SYN-09 modification
// blobs[1] changes from CLASSIFIER_MODEL to "synthesis"
// doubles[1] changes from char count to estimated token count

// Success path:
writeAnalytics(env, {
  blobs: ["mcp-server", "synthesis", wsTag, "success"],   // blobs[1]="synthesis" (SYN-09)
  doubles: [
    Date.now() - synthStart,                               // doubles[0]: latency_ms
    Math.ceil(synthInput.length / 4),                      // doubles[1]: token_count (SYN-09)
    0,
    0,
  ],
  indexes: [ANALYTICS_ENV_TAG],
});

// Failure path:
writeAnalytics(env, {
  blobs: ["mcp-server", "synthesis", wsTag, synthOutcome], // blobs[1]="synthesis" (SYN-09)
  doubles: [
    Date.now() - synthStart,
    0,
    0,
    synthOutcome === "retry-429" ? 1 : 0,
  ],
  indexes: [ANALYTICS_ENV_TAG],
});
```

### SYN-07 Single-Memory Rejection

```typescript
// Source: CONTEXT.md SYN-07; insert BEFORE synthesis if-block in tools.ts
if (trimmedForSynth.length < 2) {
  // SYN-07: single-memory synthesis is not useful; return chunk directly
  const synGap = "synthesis skipped: only one source";
  // synthesis stays null; meta.gaps will include this message via buildRecallResponse
  // The existing gaps mechanism handles surfacing this to callers
  (envelope.meta.gaps as string[]).push(synGap);
  // skip the synthesis AI call entirely
}
```

### SYN-06 Cosine-Aware Hedge Application

```typescript
// Source: CONTEXT.md SYN-06; runs AFTER safeRun, BEFORE mapPositionsToCitationIds
// lowConfidence is computed before safeRun call from ranked[] cosine scores
const cosineScores = trimmedForSynth.map((m) => m.score ?? 0);
const minCosine = Math.min(...cosineScores);
const lowConfidence = minCosine < 0.7;

// After safeRun:
if (synthesis && lowConfidence) {
  synthesis = "Note: the following is based on loosely-matched memories and may be incomplete. " + synthesis;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@cf/meta/llama-3.1-70b-instruct` for large CF judge | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 2026-05-30 (3.1-70b deprecated) | Newer model, same 24K context, confirmed JSON mode support |
| Pointwise judge without structured output | Pointwise judge + `response_format.json_schema` | ES2023 / CF JSON Mode GA | Eliminates manual JSON parsing, gates verdict at Zod layer |

**Deprecated / outdated:**
- `@cf/meta/llama-3.1-70b-instruct`: deprecated 2026-05-30. Do not use in new code.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Intl.Segmenter` is available in the current workerd V8 (sentence granularity works in `@cloudflare/vitest-pool-workers` eval pool) | Q4, Pattern 4, Pitfall 6 | Sentence-drop post-processor falls back to regex splitter; cite-density check degrades slightly on abbreviation edge cases in 2-4 sentence outputs |
| A2 | Scout (llama-4-scout-17b) tokenizer averages ~4 chars/token on English prose used in Engram memories | Q3 / SYN-05 | Token preflight could over-count (safe — truncates more aggressively) or under-count (unsafe — allows context overrun). Under-count risk: ~10-15%; synthesis prompt has 24K context headroom so actual overflow is unlikely |
| A3 | Caption-generation model (to be chosen by planner) produces syntheses that are representative enough to serve as secondary completeness signals | Q7 / SYN-01 / D-07 | Noisy completeness metric; per D-07 this is explicitly acceptable — captions are secondary, not blocking |
| A4 | `safeRun` correctly handles `@cf/meta/llama-3.3-70b-instruct-fp8-fast` responses in the same `{response: <object>}` shape as Scout | Pattern 1 / Code Examples | Judge call fails silently or returns malformed shape; mitigation: verify in Wave 0 smoke test |

**If table is empty:** All claims were verified or cited — see individual [ASSUMED] tags above.

---

## Open Questions

1. **Single-memory threshold (SYN-07 edge case)**
   - What we know: SYN-07 rejects synthesis when only 1 memory is supplied after `trimRankedForSynthesis`.
   - What's unclear: Should the threshold be `< 2` (standard) or `< 3` (conservative)? Scout produces reasonable 2-memory syntheses based on spike-002 findings.
   - Recommendation: Use `< 2` (single-memory only) per the literal requirement. A 2-memory synthesis is a valid retrieval result.

2. **Caption model for expected_synthesis generation (D-08 discretion)**
   - What we know: AI-drafted, no human review (D-07). Model unspecified in CONTEXT.md.
   - What's unclear: Use Scout (faster, cheaper, in-platform) or a frontier model (higher caption quality)?
   - Recommendation: Use Scout via a one-off offline script. The captions are secondary-signal only; Scout quality is sufficient for completeness scoring. Avoids API egress to non-CF models.

3. **Hedge prefix wording (SYN-06, Claude's discretion per CONTEXT.md)**
   - What we know: Synthesis opens with explicit hedging language when `min(cosine) < 0.7`.
   - What's unclear: Exact hedge string — affects token count and readability.
   - Recommendation: `"Note: the following is based on loosely-matched memories and may be incomplete. "` — brief, matches the honest-stubs posture, and is easily identified by the D-09 exemption logic.

4. **Whether to truncate-to-first-memory or throw when ALL memories exceed 6K budget (SYN-05)**
   - What we know: SY-3 says "assertion must THROW"; but an empty truncation result is better served by returning a meta.gaps note than crashing `recall()`.
   - What's unclear: Is "throw" in SY-3 a JS `throw` (crashing the synthesis block) or a `meta.gaps` surface + null synthesis?
   - Recommendation: Throw inside the `try` block that already catches synthesis errors (lines 801-833 of tools.ts). The `catch` handler sets `synthesis = null` and surfaces `meta.gaps` — so the "throw" propagates through the existing honest-stubs recovery path without crashing the entire `recall()` call.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CLOUDFLARE_API_TOKEN | `eval` tier (eval-budget.setup.ts guard) | Assumed (same as phases 1-3) | — | Skip eval tier (CI gated) |
| CLOUDFLARE_ACCOUNT_ID | `eval` tier | Assumed | — | Skip eval tier |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | SYN-02 judge | Confirmed GA | Current | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` (fallback) |
| `vitest` | `eval` tier | 4.1.8 | 4.1.8 | — |
| `@cloudflare/vitest-pool-workers` | `eval` tier | 0.16.14 | 0.16.14 | — |
| `Intl.Segmenter` | Citation post-processor | [ASSUMED] via V8 in workerd | V8 built-in | Regex sentence splitter |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `Intl.Segmenter` → regex splitter (acceptable quality for 2-4 sentence outputs).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.8 |
| Config file | `packages/mcp-server/vitest.config.ts` (multi-project, eval project gated on CF creds) |
| Quick run command | `cd packages/mcp-server && npm run test:eval -- synthesis-fidelity` |
| Full suite command | `cd packages/mcp-server && npm run test:eval` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYN-01 | Corpus has `expected_synthesis` captions for validate split | eval (corpus content check) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ Wave 0 |
| SYN-02 | LLM-judge faithfulness ≥ 90%; zero hallucinated entities | eval (AI) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ Wave 0 |
| SYN-03 | Citation density ≥ 1 marker/80 chars; uncited sentences dropped | unit (post-processor) | `vitest run synthesis-postprocess.test.ts` | ❌ Wave 0 |
| SYN-04 | p50 ≤ 5s, p99 ≤ 8s (logged; local hang-guard hard-assert) | eval (latency) | `vitest run synthesis-fidelity.eval.test.ts` | ❌ Wave 0 |
| SYN-05 | Pre-flight throws when all memories exceed 6K token budget | unit | `vitest run synthesis-preflight.test.ts` | ❌ Wave 0 |
| SYN-06 | Cosine-aware hedge prefix applied when min cosine < 0.7 | unit | `vitest run synthesis-postprocess.test.ts` | ❌ Wave 0 |
| SYN-07 | Single-memory synthesis rejected with `meta.gaps` note | unit | `vitest run synthesis-postprocess.test.ts` | ❌ Wave 0 |
| SYN-08 | `verbosity` default remains `"chunks"` (regression guard) | unit | existing `tools.test.ts` schema default test | ✅ (existing) |
| SYN-09 | Analytics blobs: `blobs[1]="synthesis"`, `doubles[1]=token_count` | unit | `vitest run analytics-schema.test.ts` or extend existing analytics test | ❌ Wave 0 |
| SYN-10 | `SYNTHESIS_SYSTEM_PROMPT` byte-frozen; `SYNTHESIS_MODEL` = Scout alias | unit (grep/identity) | existing model-identity tests | ✅ (existing constant identity) |

### Sampling Rate

- **Per task commit:** `cd packages/mcp-server && npx vitest run --project workerd` (unit tests)
- **Per wave merge:** `cd packages/mcp-server && npm run test:eval -- synthesis-fidelity` (eval gate)
- **Phase gate:** Full eval suite green + SYN-02 ≥ 90% + SYN-05 throw + SYN-07 unit pass before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/mcp-server/src/__tests__/evals/synthesis-fidelity.eval.test.ts` — covers SYN-01, SYN-02, SYN-04
- [ ] `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts` — covers SYN-03, SYN-06, SYN-07 (unit tests for post-processing functions; runs in workerd pool without AI calls)
- [ ] `packages/mcp-server/src/__tests__/synthesis-preflight.test.ts` — covers SYN-05 throw behavior
- [ ] `.planning/evals/recall-corpus.json` caption augmentation — `expected_synthesis` filled for 30 validate entries
- [ ] `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` — synced after augmentation
- [ ] `shared/ai-config/src/index.ts` — `JUDGE_MODEL` constant added
- [ ] `.planning/phases/04-synthesis-activation-eval/04-CF-CODE-ASSIST-USAGE.md` — scaffolded (D-10)

---

## Security Domain

> `security_enforcement` is absent from config.json — treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | Partial | Existing `workspace_id` isolation; eval uses `"eval-fixtures"` namespace |
| V5 Input Validation | Yes | Zod gate on judge verdict (`JudgeVerdict.safeParse`) before consuming output |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Judge prompt injection via synthesis text | Tampering | Judge prompt wraps synthesis in explicit delimiters; verdict is Zod-parsed (not evaluated) |
| Cross-workspace data leak via eval fixtures | Information Disclosure | Eval uses fixed `"eval-fixtures"` workspace namespace (same isolation pattern as existing evals) |
| Analytics token leakage | Information Disclosure | `CLOUDFLARE_API_TOKEN` never printed to stdout/stderr — same pattern as `eval-budget-summary.mjs` CONTRACT |

---

## Sources

### Primary (HIGH confidence)

- Context7 `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` — JSON Mode supported models list (llama-3.3-70b-instruct-fp8-fast confirmed), llama-3.1-70b-instruct parameters
- `https://developers.cloudflare.com/workers-ai/features/json-mode/` — exact supported model list
- `https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/` — context window (24K), workerd `env.AI.run()` usage
- `https://developers.cloudflare.com/workers-ai/changelog/` — llama-3.1-70b-instruct deprecation 2026-05-30
- Project source: `packages/mcp-server/src/tools.ts` lines 114-166, 793-834 (synthesis scaffold read)
- Project source: `packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts` (percentile pattern)
- Project source: `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` (200-call budget guard)
- Project source: `packages/mcp-server/vitest.config.ts` (eval tier config)
- Project source: `shared/ai-config/src/index.ts` (SYNTHESIS_MODEL alias, sanitizeJsonSchemaForWorkersAI)
- Project source: `.planning/evals/recall-corpus.json` (100 entries, all expected_synthesis null)
- Project source: `.planning/milestones/v0.1-phases/05-ai-integration/05-AI-SPEC.md` §7 (Analytics schema)
- Project source: `.claude/skills/spike-findings-engram/references/engram-response-synthesis-contract.md` (5-drop-categories, byte-frozen prompt authority)

### Secondary (MEDIUM confidence)

- `https://www.comet.com/site/blog/structured-generation-llm-as-a-judge/` — multi-step judge pattern; JSON verdict shape for hallucination detection
- `https://labelyourdata.com/articles/llm-as-a-judge` — pointwise vs pairwise judge guidance; faithfulness rubric pattern

### Tertiary (LOW confidence)

- WebSearch: Intl.Segmenter in workerd — no explicit CF docs confirmation found; [ASSUMED] from V8 version tracking

---

## Metadata

**Confidence breakdown:**
- Judge model confirmation: HIGH — confirmed via Context7 + official CF docs + changelog; ID corrected from CONTEXT.md target
- Standard stack: HIGH — all existing project infrastructure; no new packages
- Architecture patterns: HIGH — verified from source code read
- Pitfalls: HIGH — derived from codebase read + locked CONTEXT.md decisions
- Intl.Segmenter in workerd: LOW — assumed from V8 standard; explicit confirmation not found in CF docs

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (30-day stable; Workers AI model catalog changes infrequently)
