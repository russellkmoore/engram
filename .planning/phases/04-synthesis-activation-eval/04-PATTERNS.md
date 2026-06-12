# Phase 4: Synthesis Activation Eval - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/mcp-server/src/__tests__/evals/synthesis-fidelity.eval.test.ts` | test (eval) | request-response (AI judge loop) | `recall-latency.eval.test.ts` | exact — same eval tier, percentile pattern, creds guard |
| `packages/mcp-server/src/__tests__/synthesis-postprocess.test.ts` | test (unit) | transform | `query-expansion.test.ts` + `recall.test.ts` | exact — vi.mock pattern, creds-free workerd unit |
| `packages/mcp-server/src/__tests__/synthesis-preflight.test.ts` | test (unit) | transform | `query-expansion.test.ts` | exact — same creds-free throw-behavior unit structure |
| post-processor helpers (in `tools.ts` or extracted) | utility | transform | `tools.ts` lines 139–166 (`trimRankedForSynthesis`, `formatBlocksForSynthesis`) | exact — file-local helpers, same `LexicalSearchHit[]` input type |
| `packages/mcp-server/src/tools.ts` synthesis block (~793–845) | controller | request-response | `tools.ts` synthesis block itself — hardening existing scaffold | self (modify) |
| `shared/ai-config/src/index.ts` | config | — | `shared/ai-config/src/index.ts` — `SYNTHESIS_MODEL`, `EXPANSION_CHALLENGER_MODEL` patterns | exact — same constant declaration shape |
| `.planning/evals/recall-corpus.json` (augmentation) | config/data | — | `.planning/evals/recall-corpus.json` existing structure | self (augment) |
| `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` | config/data | — | existing `recall-corpus-v2.json` | self (sync) |
| `scripts/sync-eval-corpus.mjs` (extension) or `scripts/generate-synthesis-captions.mjs` | utility (script) | batch | `scripts/sync-eval-corpus.mjs` | exact — same ESM CLI shape |
| `.planning/phases/04-synthesis-activation-eval/04-CF-CODE-ASSIST-USAGE.md` | config/doc | — | `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` | exact — copy template |

---

## Pattern Assignments

### `synthesis-fidelity.eval.test.ts` (eval test, request-response / AI judge loop)

**Primary analog:** `packages/mcp-server/src/__tests__/evals/recall-latency.eval.test.ts`
**Secondary analog:** `packages/mcp-server/src/__tests__/evals/recall-f1.eval.test.ts`

**File-header docblock pattern** (from `recall-latency.eval.test.ts` lines 1–59):
```typescript
/**
 * SYN-01 / SYN-02 / SYN-04 synthesis fidelity eval
 * — LLM judge faithfulness gate (≥90%) + latency gate (p99 ≤ 8s logged)
 *
 * BLOCKS phase on: SYN-02 faithfulness ≥ 90%, zero hallucinated entities.
 *
 * Budget: 30 validate-split entries × 3 calls (embed + synthesis + judge) = 90 calls ≤ MAX_AI_CALLS=200.
 * [...]
 * @requirement SYN-01, SYN-02, SYN-04
 */
```

**Imports pattern** (from `recall-latency.eval.test.ts` lines 61–77):
```typescript
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { JUDGE_MODEL, SYNTHESIS_MODEL } from "@engram/ai-config";
import { safeRun } from "../../ai-helper.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
// Build-time JSON import — workerd cannot fs.readFileSync host-filesystem paths.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };
```

**Query-cap constant pattern** (from `recall-latency.eval.test.ts` lines 83–88):
```typescript
/**
 * Maximum entries to run through the judge in this eval session.
 * Budget: 30 × 3 calls (embed + synthesis + judge) = 90 calls (≤200 ceiling).
 * Cap at the full 30-entry validate split per D-08.
 */
const SYNTHESIS_FIDELITY_QUERY_CAP = 30;
```

**Budget-constants + creds-guard pattern** (from `recall-latency.eval.test.ts` lines 103–175):
```typescript
const P50_BUDGET_MS = 5000;
const P99_BUDGET_MS = 8000;
const LOCAL_HANG_CEILING_MS = 20_000; // same pattern as EXP-11

function hasEvalCreds(): boolean {
  if (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID) return true;
  try {
    return typeof (env as { AI?: unknown }).AI !== "undefined";
  } catch {
    return false;
  }
}
```

**Percentile helper** (from `recall-latency.eval.test.ts` lines 155–162 — copy verbatim):
```typescript
function computePercentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sortedMs.length) - 1, 0),
    sortedMs.length - 1,
  );
  return sortedMs[idx] ?? 0;
}
```

**Percentile-helper unit check block pattern** (from `recall-latency.eval.test.ts` lines 187–208):
```typescript
describe("SYN-04 percentile helper sanity (no creds required)", () => {
  it("computePercentile returns correct p50 and p99 for a known sequence", () => {
    const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(computePercentile(sorted, 50)).toBe(500);
    expect(computePercentile(sorted, 99)).toBe(1000);
  });
  it("computePercentile handles empty array gracefully", () => {
    expect(computePercentile([], 50)).toBe(0);
  });
});
```

**Judge-call + Zod-gated verdict pattern** (from `shared/ai-config/src/index.ts` lines 273–288 + `recall-ranking.eval.test.ts` safeRun usage):
```typescript
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
  zodToJsonSchema(JudgeVerdict, { target: "openApi3", $refStrategy: "none" }),
);

const judgeResp = await safeRun(env, JUDGE_MODEL, {
  messages: [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: buildJudgeUserMessage(synthesis, sourceMemories) },
  ],
  temperature: 0.1,
  max_tokens: 512,
  response_format: { type: "json_schema", json_schema: JUDGE_JSON_SCHEMA },
});
const parsed = JudgeVerdict.safeParse(judgeResp.response);
```
Note: `sanitizeJsonSchemaForWorkersAI` strips `propertyNames` (error 3030 workaround — source at `shared/ai-config/src/index.ts` lines 273–288).

**Eval entry loop + creds guard inside test body pattern** (from `recall-latency.eval.test.ts` lines 215–383):
```typescript
describe("SYN-02 faithfulness gate (≥90%) + SYN-04 latency — creds required", () => {
  it("judge pass rate ≥ 90%; zero hallucinated entities; p99 ≤ LOCAL_HANG_CEILING_MS", async () => {
    if (!hasEvalCreds()) {
      console.log("[SKIP] No CF creds detected — skipping synthesis fidelity eval");
      return;
    }
    const validateEntries = corpus.entries.filter((e) => e.split === "validate").slice(0, SYNTHESIS_FIDELITY_QUERY_CAP);
    // ... judge loop
    expect(passCount / total).toBeGreaterThanOrEqual(0.9);     // SYN-02 gate
    expect(zeroPct).toBe(1.0);                                  // zero hallucinated entities
    expect(p99).toBeLessThanOrEqual(LOCAL_HANG_CEILING_MS);     // SYN-04 hang guard
  }, 10 * 60 * 1000); // 10-minute timeout
});
```

**captureCallback helper pattern** (from `recall-f1.eval.test.ts` lines 94–124 — used to invoke `recall()` through the registered tool):
```typescript
function captureCallback(
  toolName: string,
  workspace_id: string,
): (args: unknown, extra: unknown) => Promise<unknown> {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-eval", version: "0.0.1" });
    registerTools(server, () => ({ workspace_id, user_id: "u-eval" }), env,
      () => ({ waitUntil: (p: Promise<unknown>) => { void p; } }) as unknown as DurableObjectState,
    );
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [string, unknown, (args: unknown, extra: unknown) => Promise<unknown>];
      if (callName === toolName) return callCb;
    }
    throw new Error(`registration for '${toolName}' not captured`);
  } finally {
    spy.mockRestore();
  }
}
```

---

### `synthesis-postprocess.test.ts` (unit test, transform — SYN-03/SYN-06/SYN-07)

**Primary analog:** `packages/mcp-server/src/__tests__/query-expansion.test.ts`

**vi.mock hoisting pattern** (from `query-expansion.test.ts` lines 22–44 and `recall.test.ts` lines 23–75):
```typescript
// vi.mock declarations MUST be hoisted BEFORE any imports.
vi.mock("../ai-helper.js", () => ({
  safeRun: vi.fn(),
  CLASSIFIER_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct",
  // ... other needed re-exports
}));
vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("test-workspace-tag"),
}));
```
(See `recall.test.ts` lines 70–74 for the analytics mock — needed for any test that invokes code paths touching `writeAnalytics`.)

**Import order after mocks** (from `query-expansion.test.ts` lines 37–43):
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
// module under test — imported AFTER vi.mock declarations
import { mapPositionsToCitationIds, dropUncitedSentences, applyHedgePrefix } from "../tools.js";
// or if extracted: from "../synthesis-postprocess.js"
```

**Minimal env mock for creds-free tests** (from `query-expansion.test.ts` line 44):
```typescript
// Minimal env mock — safeRun is mocked so AI is never called directly.
const mockEnv = { AI: {} as Ai };
```

**beforeEach clearAllMocks pattern** (from `query-expansion.test.ts` lines 48–50):
```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

**Structured describe/it with Test-N anchor labels** (from `query-expansion.test.ts` line 50):
```typescript
describe("mapPositionsToCitationIds (D-02 deterministic mapping)", () => {
  it("Test 1 (anchor): replaces 'memory 1' with [block_id] for first ranked item", () => {
    // ...
  });
  it("Test 2 (out-of-range, D-03): leaves citation string intact when N > rankedList.length", () => {
    // ...
  });
});
```

---

### `synthesis-preflight.test.ts` (unit test, transform — SYN-05)

**Primary analog:** `packages/mcp-server/src/__tests__/query-expansion.test.ts`

Same hoisting + import pattern as `synthesis-postprocess.test.ts`. Key test structure:

```typescript
describe("trimRankedForSynthesis SYN-05 preflight (no creds required)", () => {
  it("throws when all memories exceed 6K token budget (SYN-05 hard assert)", () => {
    const oversizedMemory = makeLexicalSearchHit("m-1", "x".repeat(6001 * 4 + 1));
    // The throw propagates inside the synthesis try-block in tools.ts.
    expect(() => trimRankedForSynthesis([oversizedMemory], 6000)).toThrow(
      "synthesis-preflight: all memories exceed 6K token budget",
    );
  });

  it("returns trimmed list with meta.gaps note when partial truncation occurs", () => {
    // ...
  });
});
```

---

### Post-processor helpers in `tools.ts` (file-local utility, transform — D-02/D-03/D-09/SYN-06)

**Primary analog:** `tools.ts` lines 139–166 (`trimRankedForSynthesis`, `formatBlocksForSynthesis`) — the existing file-local helper pattern.

**File-local helper declaration pattern** (from `tools.ts` lines 135–166):
```typescript
/**
 * JSDoc describing what this helper does and which requirement it satisfies.
 */
function trimRankedForSynthesis(
  memories: LexicalSearchHit[],
  maxTokens: number,
): LexicalSearchHit[] {
  const charBudget = maxTokens * 4;
  let used = 0;
  const out: LexicalSearchHit[] = [];
  for (const m of memories) {
    const cost = (m.summary?.length ?? 0) + (m.content?.length ?? 0);
    if (used + cost > charBudget) break;
    out.push(m);
    used += cost;
  }
  return out;
}
```

New post-processor helpers follow the same shape: file-local (not exported), typed against `LexicalSearchHit[]`, pure-function transforms. The four new helpers run in this order (per RESEARCH.md §Architecture Patterns, Pitfall 3):

1. `applyHedgePrefix(synthesis, lowConfidence)` — SYN-06
2. `mapPositionsToCitationIds(synthesis, trimmedForSynth)` — D-02
3. `guardOutOfRangeCitations(synthesis, count)` — D-03 (operates on position numbers BEFORE they become IDs — run immediately after D-02 map is applied at sentence level, or before D-02 as a position-number check)
4. `dropUncitedSentences(synthesis, opts)` — D-09

**SYN-06 hedge-prefix pattern** (from `04-RESEARCH.md` Pattern section):
```typescript
// lowConfidence computed BEFORE safeRun from trimmedForSynth cosine scores:
const cosineScores = trimmedForSynth.map((m) => m.score ?? 0);
const minCosine = Math.min(...cosineScores);
const lowConfidence = minCosine < 0.7;

// Applied AFTER safeRun, BEFORE mapPositionsToCitationIds:
if (synthesis && lowConfidence) {
  synthesis =
    "Note: the following is based on loosely-matched memories and may be incomplete. " +
    synthesis;
}
```

**D-02 position→id mapping pattern** (from `04-RESEARCH.md` Pattern 3):
```typescript
function mapPositionsToCitationIds(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
): string {
  let result = synthesis;
  for (let i = 0; i < trimmedForSynth.length; i++) {
    const position = i + 1;
    const blockId = trimmedForSynth[i]!.id;
    result = result.replace(
      new RegExp(`memory ${position}(?=\\b|[^0-9])`, "gi"),
      `[${blockId}]`,
    );
  }
  return result;
}
```

**D-09 sentence-drop pattern** (from `04-RESEARCH.md` Pattern 4):
```typescript
function dropUncitedSentences(
  synthesis: string,
  trimmedForSynth: LexicalSearchHit[],
  opts: { lowConfidenceHedge?: boolean } = {},
): string {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const segments = [...segmenter.segment(synthesis)];
  const CITATION_RE = /\[[^\]]+\]/;
  const GAP_ACK_RE = /\b(no information|not found|unable to|unclear|gap|don't have)\b/i;
  const kept: string[] = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]!;
    const sentence = seg.segment.trim();
    if (!sentence) continue;
    const isFirstAndHedge = opts.lowConfidenceHedge && idx === 0;
    const isGapAck = GAP_ACK_RE.test(sentence);
    if (isFirstAndHedge || isGapAck || CITATION_RE.test(sentence)) {
      kept.push(seg.segment);
    }
  }
  return kept.join("").trim();
}
```
Fallback if `Intl.Segmenter` is absent: split on `/(?<=[.!?])\s+(?=[A-Z])/`.

---

### `tools.ts` synthesis block modification (~793–845) (controller, request-response — SYN-05/SYN-06/SYN-07/D-02/D-03/D-09/SYN-09)

**Primary analog:** `tools.ts` lines 793–845 (the existing synthesis block being hardened).

**Existing synthesis scaffold** (from `tools.ts` lines 793–834):
```typescript
// === D-01: synthesis is OPT-IN — skipped on default verbosity="chunks" ===
let synthesis: string | null = null;
if (args.verbosity === "synthesis" || args.verbosity === "both") {
  const trimmedForSynth = trimRankedForSynthesis(ranked, 6000);
  const synthStart = Date.now();
  const synthInput = formatBlocksForSynthesis(trimmedForSynth, args.query);
  try {
    const synthResp = await safeRun(env, CLASSIFIER_MODEL, {
      messages: [
        { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: synthInput },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });
    synthesis = typeof synthResp.response === "string" ? synthResp.response : null;

    writeAnalytics(env, {
      blobs: ["mcp-server", CLASSIFIER_MODEL, wsTag, "success"],
      doubles: [Date.now() - synthStart, synthInput.length, 0, 0],
      indexes: [ANALYTICS_ENV_TAG],
    });
  } catch (synthErr) {
    // honest-stubs posture — synthesis=null, meta.gaps surfaces failure
    console.warn("recall:synthesis-failed", { synthErr });
    const synthOutcome =
      synthErr != null && typeof synthErr === "object" && "isRateLimit" in synthErr
        ? "retry-429"
        : "synthesis-failed";
    writeAnalytics(env, {
      blobs: ["mcp-server", CLASSIFIER_MODEL, wsTag, synthOutcome],
      doubles: [Date.now() - synthStart, 0, 0, synthOutcome === "retry-429" ? 1 : 0],
      indexes: [ANALYTICS_ENV_TAG],
    });
    synthesis = null;
  }
}
```

**Integration order for new code** (Phase 4 insertions relative to above):
1. **Before** `trimRankedForSynthesis` call: SYN-07 single-memory guard (check `ranked.length < 2`, push to `meta.gaps`, skip `if` block).
2. **After** `trimRankedForSynthesis` call: SYN-05 hard assert (if `trimmedForSynth.length === 0`, throw inside the `try` block so the `catch` surfaces via honest-stubs).
3. **Before** `safeRun` call: compute `lowConfidence` flag from `minCosine < 0.7`.
4. **After** `safeRun` returns, inside `try`, BEFORE `writeAnalytics`: apply `applyHedgePrefix` → `mapPositionsToCitationIds` → `dropUncitedSentences` on the `synthesis` string.
5. **Both `writeAnalytics` calls**: apply SYN-09 blob/double changes (see SYN-09 pattern below).

**SYN-09 analytics blob/double change** (both call sites at `tools.ts` lines 813–831):
```typescript
// Success path — SYN-09 changes:
writeAnalytics(env, {
  blobs: ["mcp-server", "synthesis", wsTag, "success"],     // blobs[1]: CLASSIFIER_MODEL → "synthesis"
  doubles: [
    Date.now() - synthStart,                                 // doubles[0]: latency_ms (unchanged)
    Math.ceil(synthInput.length / 4),                        // doubles[1]: char count → estimated token count
    0,
    0,
  ],
  indexes: [ANALYTICS_ENV_TAG],
});

// Failure path — SYN-09 changes:
writeAnalytics(env, {
  blobs: ["mcp-server", "synthesis", wsTag, synthOutcome],  // blobs[1]: CLASSIFIER_MODEL → "synthesis"
  doubles: [
    Date.now() - synthStart,
    0,
    0,
    synthOutcome === "retry-429" ? 1 : 0,
  ],
  indexes: [ANALYTICS_ENV_TAG],
});
```

**`writeAnalytics` function signature** (from `packages/mcp-server/src/analytics.ts` lines 80–97):
```typescript
export function writeAnalytics(
  env: { ANALYTICS?: AnalyticsEngineDataset },
  datapoint: AnalyticsDataPoint,  // { blobs: [s,s,s,s], doubles: [n,n,n,n], indexes: [s] }
): void {
  if (env.ANALYTICS === undefined) return; // dev / tests — no-op silently
  try {
    env.ANALYTICS.writeDataPoint({ blobs: [...datapoint.blobs], doubles: [...datapoint.doubles], indexes: [...datapoint.indexes] });
  } catch (err) {
    console.warn("analytics:write-failed", { err: err instanceof Error ? err.message : String(err) });
  }
}
```

---

### `shared/ai-config/src/index.ts` modification (config — add `JUDGE_MODEL`)

**Primary analog:** `shared/ai-config/src/index.ts` lines 99–110 (`EXPANSION_CHALLENGER_MODEL` — the existing eval-only constant pattern).

**Eval-only constant declaration pattern** (from `shared/ai-config/src/index.ts` lines 99–110):
```typescript
/**
 * A/B challenger model for EXP-08 query-expansion recall comparison.
 *
 * EVAL-ONLY CONSTANT — do NOT use in production code. Scout (`QUERY_EXPANSION_MODEL`)
 * stays the default for query expansion. This constant is imported only by
 * `query-expansion-recall.eval.test.ts` [...]
 */
export const EXPANSION_CHALLENGER_MODEL = "@cf/meta/llama-3.2-3b-instruct" as const;
```

**New constant to add** (pattern copy of above):
```typescript
/**
 * LLM judge model for `synthesis-fidelity.eval.test.ts` faithfulness gate (SYN-02).
 *
 * EVAL-ONLY CONSTANT — do NOT call in the production recall() path. The judge
 * is invoked exclusively inside the eval harness to assess synthesis faithfulness
 * against source memories. Using a larger model than SYNTHESIS_MODEL (Scout)
 * is required — Scout-judging-Scout is self-lenient (D-04).
 *
 * Model confirmed active on CF catalog 2026-06-09. Do not substitute
 * `@cf/meta/llama-3.1-70b-instruct` — deprecated 2026-05-30.
 */
export const JUDGE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
```

Insert AFTER the `EXPANSION_CHALLENGER_MODEL` block (lines 110) and BEFORE the role-named aliases section (line 219). The docblock must include the "EVAL-ONLY CONSTANT — do NOT call in production" warning verbatim (matches the `EXPANSION_CHALLENGER_MODEL` docblock tone).

---

### `.planning/evals/recall-corpus.json` augmentation (data — SYN-01)

**Primary analog:** Existing `.planning/evals/recall-corpus.json` entry structure (lines 33–49).

**Corpus entry shape with `expected_synthesis` filled** (current null field → string for validate-split entries):
```json
{
  "id": "rcv2-002",
  "bucket": "critical-path",
  "query": "which recruiter from the fintech meetup keeps reaching out about backend work",
  "expected_top_3_block_ids": ["ef-002", "ef-054", "ef-008"],
  "expected_args": { "types": ["contact"] },
  "split": "validate",
  "labeled_by": "ai-cross-validated-extended:...",
  "labeled_at": "2026-06-04T00:00:00Z",
  "expected_synthesis": "Based on memory 1, Sarah Chen from Fintech Connect has been reaching out about backend engineering roles..."
}
```

Only the 30 `"split": "validate"` entries are augmented. Train entries keep `"expected_synthesis": null`.

---

### `packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json` (data — sync)

**Primary analog:** Existing `recall-corpus-v2.json` — the vendored copy of the corpus.

**Sentinel field pattern** (from `scripts/sync-eval-corpus.mjs` lines 98–106):
```json
{
  "_auto_synced_from": ".planning/evals/recall-corpus.json",
  "corpus_version": 2,
  ...
}
```
The `_auto_synced_from` sentinel field must appear first. Never edit this file directly — always edit `.planning/evals/recall-corpus.json` and re-run `scripts/sync-eval-corpus.mjs`.

**CorpusEntry interface in eval tests — add `expected_synthesis` field** (from `recall-f1.eval.test.ts` lines 53–62, extend):
```typescript
interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: string | null;  // null for train; string for validate after SYN-01 augmentation
}
```

---

### `scripts/generate-synthesis-captions.mjs` (utility script, batch — SYN-01/D-07/D-08)

**Primary analog:** `scripts/sync-eval-corpus.mjs` (entire file, 178 lines).

**ESM CLI structure pattern** (from `scripts/sync-eval-corpus.mjs` lines 1–50):
```javascript
// scripts/generate-synthesis-captions.mjs
// SYN-01 / D-07 / D-08: generates AI-drafted expected_synthesis captions for the
// 30 validate-split entries in .planning/evals/recall-corpus.json.
//
// Usage:
//   node scripts/generate-synthesis-captions.mjs [--dry-run] [--help]
//
// Exit codes:
//   0 success
//   1 generation error
//   2 source file missing

import { argv, exit, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TAG = "[generate-synthesis-captions]";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CORPUS_PATH = resolve(REPO_ROOT, ".planning/evals/recall-corpus.json");
```

**Arg-parse + usage() pattern** (from `sync-eval-corpus.mjs` lines 44–71):
```javascript
const args = argv.slice(2);
let dryRun = false;
for (const a of args) {
  if (a === "--dry-run") dryRun = true;
  else if (a === "--help" || a === "-h") { usage(stdout); exit(0); }
}
function usage(stream) {
  stream.write(`${TAG} usage: node scripts/generate-synthesis-captions.mjs [--dry-run]\n`);
}
```

**Sync script extension (alternative):** If `sync-eval-corpus.mjs` is extended rather than creating a companion script, the new mode follows the `--check` mode shape (lines 117–160): add a `--generate-captions` flag that augments corpus entries before the sync write.

---

### `.planning/phases/04-synthesis-activation-eval/04-CF-CODE-ASSIST-USAGE.md` (tracker doc — D-10)

**Primary analog:** `.planning/phases/02-recall-quality-baseline/02-CF-CODE-ASSIST-USAGE.md` — copy the entire header (lines 1–38), substitute Phase 4 text.

**Table header to copy** (from `02-CF-CODE-ASSIST-USAGE.md` lines 15–22):
```markdown
| Task | Artifact | Route | Checklist (Q1/Q2/Q3) | Reason | Approx tokens saved |
|------|----------|-------|----------------------|--------|---------------------|
```

**3-question checklist block to copy verbatim** (from `02-CF-CODE-ASSIST-USAGE.md` lines 27–36):
```markdown
1. **Is the SYNTHESIS step itself cross-file?** ...
2. **Is the diff >50 lines of mechanical code?** ...
3. **Is there a stable template/spec/sentinel to anchor the generation on?** ...
```

---

## Shared Patterns

### `safeRun` — Workers AI call wrapper
**Source:** `packages/mcp-server/src/ai-helper.ts` lines 224–245
**Apply to:** `synthesis-fidelity.eval.test.ts` (judge call), `tools.ts` synthesis block (generator call already uses it)

```typescript
export async function safeRun(
  env: { AI: Ai },
  model: string,
  body: Record<string, unknown>,
): Promise<AiBindingResponse> {
  // throws RateLimitError on 429 (both thrown + binding-envelope paths)
  // throws original error on non-429 failure
  // returns raw binding response on success
}
```
The judge call in `synthesis-fidelity.eval.test.ts` uses the same `safeRun` + `try/catch` honest-stubs pattern that the synthesis block already uses in `tools.ts`.

### `sanitizeJsonSchemaForWorkersAI` — CF JSON Mode schema sanitizer
**Source:** `shared/ai-config/src/index.ts` lines 273–288
**Apply to:** `synthesis-fidelity.eval.test.ts` (judge verdict schema passed to `response_format`)

Strips `propertyNames` keyword (CF error 3030 workaround). Import as:
```typescript
import { sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";
```

### eval-budget.setup.ts budget guard
**Source:** `packages/mcp-server/src/__tests__/evals/eval-budget.setup.ts` lines 47–110
**Apply to:** `synthesis-fidelity.eval.test.ts` — guard is automatically applied via `setupFiles` in `vitest.config.ts`

Key discipline: `MAX_AI_CALLS = 200` is a LITERAL constant. The `synthesis-fidelity.eval.test.ts` test file does NOT need to reference `eval-budget.setup.ts` directly — it's auto-loaded by the `eval` vitest project's `setupFiles` config. Budget math for this eval: 30 entries × 3 calls = 90 (within ceiling). If adaptive query expansion fires during `recall()`, budget impact can reach ~8 calls/entry × 30 = 240 — disable expansion or call synthesis path directly.

### `writeAnalytics` signature + ANALYTICS_ENV_TAG
**Source:** `packages/mcp-server/src/analytics.ts` lines 80–97; `tools.ts` line 172 (ANALYTICS_ENV_TAG)
**Apply to:** `tools.ts` synthesis block SYN-09 modification

The function is fire-and-forget and no-ops silently in test environments. Pattern: always spread the arrays (`[...datapoint.blobs]`). The `ANALYTICS_ENV_TAG = "engram-prod" as const` is declared at `tools.ts` line 172.

### Honest-stubs posture (synthesis=null + meta.gaps)
**Source:** `tools.ts` lines 818–833 (existing synthesis catch block)
**Apply to:** SYN-05 preflight throw (inside the `try`, caught by existing `catch`), SYN-07 single-memory guard (push to `envelope.meta.gaps` before the `if` block)

```typescript
// SYN-07 — insert BEFORE `if (args.verbosity === ...)`:
if (ranked.length < 2) {
  (envelope.meta.gaps as string[]).push("synthesis skipped: only one source");
  // synthesis stays null — fall through to buildRecallResponse
}
```

The `meta.gaps` array already exists on the envelope via `buildRecallResponse`; append to it after envelope construction for post-synthesis gaps (per `tools.ts` lines 853–859 pattern — `queryWasTruncated` and `expansionUnavailable` gap appends).

### vi.mock analytics stub
**Source:** `packages/mcp-server/src/__tests__/recall.test.ts` lines 70–74
**Apply to:** `synthesis-postprocess.test.ts`, `synthesis-preflight.test.ts`

```typescript
vi.mock("../analytics.js", () => ({
  writeAnalytics: vi.fn(),
  workspaceTag: vi.fn().mockResolvedValue("test-workspace-tag"),
}));
```
Required in any test file that imports from `tools.ts` (since `tools.ts` imports `analytics.js`).

### Corpus split selection
**Source:** `recall-f1.eval.test.ts` lines 83–88
**Apply to:** `synthesis-fidelity.eval.test.ts`

```typescript
const EVAL_SPLIT = (process.env.EVAL_SPLIT ?? "validate") as "train" | "validate" | "all";
// Note: synthesis fidelity eval defaults to "validate" (not "train") per D-08.
function selectEntries(split: "train" | "validate" | "all"): CorpusEntry[] {
  if (split === "all") return corpus.entries;
  return corpus.entries.filter((e) => e.split === split);
}
```

### Corpus import (build-time JSON, not fs.readFileSync)
**Source:** `recall-f1.eval.test.ts` line 51; `recall-latency.eval.test.ts` line 77
**Apply to:** All new eval test files

```typescript
// Build-time JSON import — workerd cannot fs.readFileSync host-filesystem paths.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };
```

---

## No Analog Found

All files in this phase have close analogs. No entries.

---

## Metadata

**Analog search scope:** `packages/mcp-server/src/`, `shared/ai-config/src/`, `scripts/`, `.planning/evals/`, `.planning/phases/02-*`
**Files scanned:** 14 source files read directly
**Pattern extraction date:** 2026-06-09
