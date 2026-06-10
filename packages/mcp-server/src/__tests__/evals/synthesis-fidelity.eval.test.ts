/**
 * SYN-01 / SYN-02 / SYN-04: synthesis fidelity eval
 * — LLM judge faithfulness gate (≥90%) + latency gate (p99 ≤ 20s local hang guard)
 *
 * PHASE-BLOCKING GATES (fail → BLOCKS phase, do NOT proceed to /gsd:verify-work)
 * -------------------------------------------------------------------------------
 *   SYN-02: judgedTotal ≥ 25 (guards against silent NaN when synthesis broke for most cases)
 *   SYN-02: passRate = passCount / judgedTotal ≥ 0.90 (faithfulness ≥ 90%)
 *   SYN-02: totalHallucinatedEntities === 0 (zero hallucinated entities)
 *   SYN-04: p99 ≤ LOCAL_HANG_CEILING_MS=20_000 (local hang guard only)
 *
 * NON-BLOCKING (logged for visibility)
 * -----------------------------------------------------------------------
 *   SYN-04: p50 logged vs P50_BUDGET_MS=5000, p99 logged vs P99_BUDGET_MS=8000
 *   SYN-01: per-entry completeness note (logged only — captions not a hard gate per D-06/D-07)
 *
 * JUDGE DESIGN (D-04)
 * -------------------
 * The judge is JUDGE_MODEL (@cf/meta/llama-3.3-70b-instruct-fp8-fast) — a larger
 * model than SYNTHESIS_MODEL (Scout). Scout-judging-Scout is self-lenient. The judge
 * assesses faithfulness against SOURCE MEMORIES (the original_content fixtures),
 * not expected_synthesis captions. Captions are a secondary completeness signal
 * (logged, not gating).
 *
 * EVAL APPROACH: DIRECT generateSynthesis() PATH (GAP-FIX)
 * ---------------------------------------------------------
 * The previous approach drove recall() via captureCallback against the "eval-fixtures"
 * workspace. That workspace has orphan Vectorize vectors but NO seeded SQLite block
 * content — contentless hits → honest-stub synthesis=null → passRate 0/0 = NaN
 * (RESEARCH.md Pitfall 2: call synthesis path directly without the full recall() handler).
 *
 * This rewrite drives generateSynthesis() DIRECTLY on content-bearing fixtures:
 *   - reference-corpus.json (20 entries) + real-corpus.json (27 entries) = 47 total
 *   - Each eval case builds a ranked set of 3 consecutive entries (score=0.8, ≥0.7
 *     so lowConfidence hedge stays off for a clean faithfulness measurement)
 *   - No Vectorize, no workspace seeding, no query expansion budget leak
 *
 * BUDGET MATH
 * -----------
 * 30 eval cases × (1 synthesis + 1 judge) = 60 AI calls ≤ MAX_AI_CALLS=200.
 * MAX_AI_CALLS=200 is enforced automatically via eval-budget.setup.ts (setupFiles in
 * vitest.config.ts eval project) — do NOT reference that file directly.
 *
 * PROMPT FREEZE WARNING (D-01 / SYN-10)
 * --------------------------------------
 * Do NOT edit SYNTHESIS_SYSTEM_PROMPT in tools.ts. Any prompt change requires
 * re-running this eval to re-establish the faithfulness baseline (D-01/SYN-10).
 *
 * @module @engram/mcp-server/synthesis-fidelity-eval
 * @requirement SYN-01, SYN-02, SYN-04
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { JUDGE_MODEL, sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";
import { z } from "zod";
import { safeRun } from "../../ai-helper.js";
import { generateSynthesis } from "../../tools.js";
import type { LexicalSearchHit } from "@engram/workspace-do";

// Build-time JSON imports — workerd cannot fs.readFileSync host-filesystem paths.
import referenceCorpusJson from "./fixtures/reference-corpus.json" with { type: "json" };
import realCorpusJson from "./fixtures/real-corpus.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum eval cases to run through the judge in this eval session.
 * Budget: 30 cases × 2 calls (synthesis + judge) = 60 calls (≤200 ceiling).
 * Cap at 30, drawn from the merged reference+real corpus (47 total entries).
 */
const SYNTHESIS_FIDELITY_QUERY_CAP = 30;

/**
 * SYN-04 production-SLA budgets (milliseconds). These are EDGE targets for the
 * deployed Worker — measured via Analytics Engine 'mcp-server' latency blobs.
 * Local eval runs dev→remote-Cloudflare, so actual timings are network-bound
 * (500ms–1s per call). We LOG against these budgets for visibility but only
 * hard-assert the hang-guard ceiling below.
 */
const P50_BUDGET_MS = 5000;

/** SYN-04 p99 production-SLA budget (milliseconds) — logged, not locally asserted. */
const P99_BUDGET_MS = 8000;

/**
 * Local hang-guard ceiling. The only HARD latency assertion this local eval makes.
 * A p99 above this means the pipeline is genuinely hung/broken (not just slow network).
 */
const LOCAL_HANG_CEILING_MS = 20_000;

// ---------------------------------------------------------------------------
// Corpus entry types
// ---------------------------------------------------------------------------

interface ReferenceEntry {
  id: string;
  bucket: string;
  memory_type: string;
  original_content: string;
  paraphrased_query: string;
  intended_memory_id: string;
  expected_classified_type: string;
  labeled_by: string;
  labeled_at: number;
  known_failure_pattern: string | null;
}

interface RealEntry {
  id: string;
  bucket: string;
  memory_type: string;
  original_content: string;
  paraphrased_query: string;
  intended_memory_id: string;
  expected_classified_type: string;
  known_failure_pattern: string | null;
}

// Combined shape used internally
interface FlatEntry {
  id: string;
  original_content: string;
  paraphrased_query: string;
  memory_type: string;
}

// ---------------------------------------------------------------------------
// Judge verdict schema (Zod-gated per RESEARCH.md Pattern 1 + V5 ASVS)
// Malformed judge responses cannot corrupt the faithfulness metric.
// ---------------------------------------------------------------------------

const JudgeVerdict = z.object({
  faithful: z.boolean(),
  hallucinated_entities: z.array(z.string()),
  unsupported_claims: z.array(z.string()),
});
type JudgeVerdict = z.infer<typeof JudgeVerdict>;

// z.toJSONSchema() — native zod@4 (NOT the third-party zod-to-json-schema@3.x — ENG-21)
// Destructure-strip $schema (saves request bytes), then sanitize for Workers AI error 3030.
const JUDGE_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(JudgeVerdict);
  void $schema;
  return sanitizeJsonSchemaForWorkersAI(schema);
})();

// ---------------------------------------------------------------------------
// Judge system prompt (faithfulness rubric — D-04, Claude's discretion per plan)
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `You are a faithfulness judge for a memory recall system. Given a synthesis paragraph and the source memories it was generated from, determine whether the synthesis is faithful.

A synthesis is FAITHFUL if and only if:
- Every factual claim traces to at least one supplied source memory
- No entity names, dates, companies, roles, or numeric values appear that are absent from ALL source memories
- Paraphrasing is acceptable; fabrication is not

Return a JSON object with:
  "faithful": true if ALL claims are traceable to source memories; false if ANY claim lacks support
  "hallucinated_entities": list of entity names/values in the synthesis that do NOT appear in any source memory (empty list if none)
  "unsupported_claims": list of synthesis sentences or clauses with no source memory support (empty list if none)

Source memories are provided as numbered blocks. Treat each numbered block as the ground truth.`;

// ---------------------------------------------------------------------------
// buildJudgeUserMessage — formats synthesis + source memories for judge user turn
// ---------------------------------------------------------------------------

function buildJudgeUserMessage(synthesis: string, sourceMemories: string): string {
  return (
    "Source memories:\n" +
    sourceMemories +
    "\n\n---\n\nSynthesis to evaluate:\n" +
    synthesis +
    "\n\n---\n\nIs this synthesis faithful to the source memories above? Return your verdict as JSON."
  );
}

// ---------------------------------------------------------------------------
// Percentile computation (verbatim copy from recall-latency.eval.test.ts lines 155–162)
//
// Method: sort samples ascending, then pick index = ceil(p/100 * n) − 1.
// Clamp to [0, n−1] for safety. Same P-tile method as CON-07.
// ---------------------------------------------------------------------------

function computePercentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sortedMs.length) - 1, 0),
    sortedMs.length - 1,
  );
  return sortedMs[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Creds guard (verbatim copy from recall-latency.eval.test.ts lines 168–175)
// ---------------------------------------------------------------------------

function hasEvalCreds(): boolean {
  if (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID) return true;
  try {
    return typeof (env as { AI?: unknown }).AI !== "undefined";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build flat corpus from reference + real fixtures
// ---------------------------------------------------------------------------

const referenceEntries: FlatEntry[] = (referenceCorpusJson as unknown as ReferenceEntry[]).map(
  (e) => ({
    id: e.id,
    original_content: e.original_content,
    paraphrased_query: e.paraphrased_query,
    memory_type: e.memory_type,
  }),
);

const realEntries: FlatEntry[] = (realCorpusJson as unknown as RealEntry[]).map((e) => ({
  id: e.id,
  original_content: e.original_content,
  paraphrased_query: e.paraphrased_query,
  memory_type: e.memory_type,
}));

const allEntries: FlatEntry[] = [...referenceEntries, ...realEntries];

// ---------------------------------------------------------------------------
// Helper: build a LexicalSearchHit-shaped ranked set from 3 consecutive entries
// ---------------------------------------------------------------------------

function buildRankedSet(entries: FlatEntry[], startIdx: number, count = 3): LexicalSearchHit[] {
  const result: LexicalSearchHit[] = [];
  for (let i = 0; i < count; i++) {
    const entry = entries[(startIdx + i) % entries.length];
    if (entry === undefined) continue;
    result.push({
      // Memory fields
      id: entry.id,
      type: entry.memory_type,
      content: entry.original_content,
      summary: entry.original_content.slice(0, 200),
      properties: null,
      embedding_id: null,
      scope: "personal",
      project_id: null,
      source: "eval-fixture",
      confidence: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      // LexicalSearchHit fields
      snippet: null,
      match_column: null,
      // score >= 0.7 so lowConfidence hedge stays off — clean faithfulness measurement
      score: 0.8,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Corpus content smoke test (no creds required — SYN-01 check)
// ---------------------------------------------------------------------------

describe("SYN-01 corpus content check (no creds required)", () => {
  it("combined reference + real corpus has ≥30 entries with non-empty original_content", () => {
    const contentful = allEntries.filter((e) => e.original_content.length > 0);
    expect(contentful.length).toBeGreaterThanOrEqual(SYNTHESIS_FIDELITY_QUERY_CAP);
  });

  it("combined corpus total is ≥30 entries", () => {
    expect(allEntries.length).toBeGreaterThanOrEqual(SYNTHESIS_FIDELITY_QUERY_CAP);
  });

  it("reference-corpus has expected fields (id, original_content, paraphrased_query)", () => {
    const first = referenceEntries[0];
    if (first === undefined) throw new Error("reference corpus is empty");
    expect(typeof first.id).toBe("string");
    expect(typeof first.original_content).toBe("string");
    expect(typeof first.paraphrased_query).toBe("string");
    expect(first.original_content.length).toBeGreaterThan(0);
  });

  it("real-corpus has expected fields (id, original_content, paraphrased_query)", () => {
    const first = realEntries[0];
    if (first === undefined) throw new Error("real corpus is empty");
    expect(typeof first.id).toBe("string");
    expect(typeof first.original_content).toBe("string");
    expect(typeof first.paraphrased_query).toBe("string");
    expect(first.original_content.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computePercentile sanity checks (no creds required — SYN-04 helper)
// ---------------------------------------------------------------------------

describe("SYN-04 percentile helper sanity (no creds required)", () => {
  it("computePercentile returns correct p50 and p99 for a known sequence", () => {
    const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    // p50 of 10 values: ceil(0.5 * 10) - 1 = ceil(5) - 1 = 4 → sorted[4] = 500
    expect(computePercentile(sorted, 50)).toBe(500);
    // p99 of 10 values: ceil(0.99 * 10) - 1 = ceil(9.9) - 1 = 9 → sorted[9] = 1000
    expect(computePercentile(sorted, 99)).toBe(1000);
  });

  it("computePercentile handles empty array gracefully", () => {
    expect(computePercentile([], 50)).toBe(0);
    expect(computePercentile([], 99)).toBe(0);
  });

  it("SYN-04 budget constants are correct", () => {
    expect(P50_BUDGET_MS).toBe(5000);
    expect(P99_BUDGET_MS).toBe(8000);
    expect(LOCAL_HANG_CEILING_MS).toBe(20_000);
  });

  it("SYNTHESIS_FIDELITY_QUERY_CAP is 30", () => {
    expect(SYNTHESIS_FIDELITY_QUERY_CAP).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// SYN-02 faithfulness gate + SYN-04 latency gate (creds required)
// ---------------------------------------------------------------------------

describe("SYN-02 faithfulness gate (≥90%) + SYN-04 latency — creds required", () => {
  it(
    "judge pass rate ≥ 90%; zero hallucinated entities; judgedTotal ≥ 25; p99 ≤ LOCAL_HANG_CEILING_MS",
    async () => {
      if (!hasEvalCreds()) {
        console.log(
          "[SKIP] No CF creds — skipping SYN-02 synthesis fidelity eval " +
            "(set CLOUDFLARE_ACCOUNT_ID or ensure Workers AI binding to run)",
        );
        return;
      }

      // Cap at SYNTHESIS_FIDELITY_QUERY_CAP — each case is one eval entry from allEntries.
      // Budget: 30 × (1 synthesis + 1 judge) = 60 AI calls ≤ MAX_AI_CALLS=200.
      const evalCases = allEntries.slice(0, SYNTHESIS_FIDELITY_QUERY_CAP);

      console.log(
        `[SYN-02] Running faithfulness eval on ${String(evalCases.length)} cases ` +
          `(cap=${String(SYNTHESIS_FIDELITY_QUERY_CAP)}). ` +
          `Budget: ~${String(evalCases.length)} × 2 = ~${String(evalCases.length * 2)} calls ` +
          `(≤ MAX_AI_CALLS=200). Judge model: ${JUDGE_MODEL}. ` +
          `Fixture source: reference-corpus (${String(referenceEntries.length)}) + ` +
          `real-corpus (${String(realEntries.length)}) = ${String(allEntries.length)} total entries.`,
      );

      let passCount = 0;
      let judgedTotal = 0;
      let judgeErrors = 0;
      let synthesisNullCount = 0;
      let totalHallucinatedEntities = 0;
      const latencyMs: number[] = [];

      for (let i = 0; i < evalCases.length; i++) {
        const entry = evalCases[i];
        if (entry === undefined) continue;

        // Build a ranked set of 3 consecutive entries (wrapping) for synthesis input.
        // score=0.8 (≥0.7) keeps lowConfidence hedge off for a clean faithfulness measurement.
        const rankedSet = buildRankedSet(allEntries, i, 3);

        const startMs = Date.now();

        // Drive generateSynthesis() DIRECTLY — no recall(), no Vectorize, no workspace.
        // This avoids: orphan-vector contentless-hit problem + query expansion budget leak.
        const synthResult = await generateSynthesis(env, rankedSet, entry.paraphrased_query);
        const durationMs = Date.now() - startMs;
        latencyMs.push(durationMs);

        const { synthesis } = synthResult;

        // If synthesis is null (honest-stubs fallback): skip judge call for this case.
        // Count as neither pass nor fail — synthesis failures are a separate concern.
        if (synthesis === null || synthesis.trim() === "") {
          synthesisNullCount++;
          console.log(
            `[SYN-02] case=${entry.id} (i=${String(i)}) synthesis=null/empty — skipping judge. ` +
              `gaps=${JSON.stringify(synthResult.gaps)}`,
          );
          continue;
        }

        // Build source-memory context for the judge from the ranked set.
        // The judge evaluates faithfulness against these actual content-bearing fixtures,
        // not the expected_synthesis captions (which would contaminate the signal — Pitfall 5).
        // Use synthInput from generateSynthesis (the formatted block text passed to the model).
        const sourceMemoriesText = rankedSet
          .map((m, idx) => `[${String(idx + 1)}] ${m.summary ?? m.content ?? "(no content)"}`)
          .join("\n");

        // Judge call: JUDGE_MODEL assesses faithfulness vs source memories.
        let judgeResp: { response?: unknown };
        try {
          judgeResp = await safeRun(env, JUDGE_MODEL, {
            messages: [
              { role: "system", content: JUDGE_SYSTEM_PROMPT },
              {
                role: "user",
                content: buildJudgeUserMessage(synthesis, sourceMemoriesText),
              },
            ],
            temperature: 0.1,
            max_tokens: 512,
            response_format: {
              type: "json_schema",
              json_schema: JUDGE_JSON_SCHEMA,
            },
          });
        } catch (judgeErr) {
          // Judge call failed (e.g., rate limit, network): count as judge-error.
          // Do NOT count as faithfulness fail — malformed/missing response cannot
          // corrupt the metric (V5 ASVS security gate).
          judgeErrors++;
          console.warn(
            `[SYN-02] judge call error for case=${entry.id}: ` +
              String(judgeErr instanceof Error ? judgeErr.message : judgeErr),
          );
          continue;
        }

        // Zod gate: parse judge response before consuming verdict.
        // A fabricated JSON structure in the synthesis text cannot corrupt the metric.
        const parsed = JudgeVerdict.safeParse(judgeResp.response);
        if (!parsed.success) {
          judgeErrors++;
          console.warn(`[SYN-02] judge parse error for case=${entry.id}: ` + parsed.error.message);
          continue;
        }

        const verdict: JudgeVerdict = parsed.data;
        judgedTotal++;

        if (verdict.faithful) {
          passCount++;
        } else {
          console.log(
            `[SYN-02] FAIL case=${entry.id}: ` +
              `hallucinated_entities=${JSON.stringify(verdict.hallucinated_entities)}, ` +
              `unsupported_claims=${JSON.stringify(verdict.unsupported_claims)}`,
          );
        }

        totalHallucinatedEntities += verdict.hallucinated_entities.length;

        // Completeness check (logged only, NOT gating):
        // These fixtures don't have expected_synthesis captions, but log synthesis length
        // for diagnostics (SYN-01 secondary signal intent).
        console.log(
          `[SYN-01] case=${entry.id} (i=${String(i)}): ` +
            `faithful=${String(verdict.faithful)}, ` +
            `synthesis.length=${String(synthesis.length)}, ` +
            `hallucinatedEntities=${String(verdict.hallucinated_entities.length)}`,
        );
      }

      // ---------------------------------------------------------------------------
      // Compute p50 / p99 (mirrors eval-budget-summary.mjs percentile method)
      // ---------------------------------------------------------------------------

      const sorted = [...latencyMs].sort((a, b) => a - b);
      const p50 = computePercentile(sorted, 50);
      const p99 = computePercentile(sorted, 99);
      const passRate = judgedTotal > 0 ? passCount / judgedTotal : 0;

      console.log(
        `[SYN-02] Results: judged=${String(judgedTotal)}, ` +
          `passed=${String(passCount)}, ` +
          `judgeErrors=${String(judgeErrors)}, ` +
          `synthesisNull=${String(synthesisNullCount)}, ` +
          `passRate=${passRate.toFixed(4)} (gate ≥0.90), ` +
          `totalHallucinatedEntities=${String(totalHallucinatedEntities)} (gate =0)`,
      );
      console.log(
        `[SYN-04] Latency: n=${String(sorted.length)}, ` +
          `p50=${String(p50)}ms (budget ≤${String(P50_BUDGET_MS)}ms), ` +
          `p99=${String(p99)}ms (budget ≤${String(P99_BUDGET_MS)}ms, ` +
          `hard-guard ≤${String(LOCAL_HANG_CEILING_MS)}ms).`,
      );
      console.log(
        `[SYN-04] SMOKE TEST NOTE — these are dev→remote-Cloudflare timings (network-bound). ` +
          `The p50≤${String(P50_BUDGET_MS)}/p99≤${String(P99_BUDGET_MS)}ms SLA is confirmed on ` +
          `the deployed Worker via Analytics Engine 'mcp-server' latency blobs.`,
      );

      // ---------------------------------------------------------------------------
      // Hard gates (phase-blocking — BLOCKS /gsd:verify-work if these fail)
      // ---------------------------------------------------------------------------

      // NEW gate: prevent silent NaN passing — synthesis must have worked for most cases.
      // If judgedTotal < 25, the synthesis path is broken (not a faithfulness issue).
      expect(judgedTotal).toBeGreaterThanOrEqual(25);

      // SYN-02: faithfulness ≥ 90%
      expect(passCount / judgedTotal).toBeGreaterThanOrEqual(0.9);

      // SYN-02: zero hallucinated entities across all judged entries
      expect(totalHallucinatedEntities).toBe(0);

      // SYN-04: local hang guard — p99 must be below ceiling
      // (production SLA p50≤5s / p99≤8s is confirmed on deployed Worker, not here)
      expect(p99).toBeLessThanOrEqual(LOCAL_HANG_CEILING_MS);
    },
    // 10-minute timeout — 30 cases × (synthesis + judge) calls over remote bindings
    10 * 60 * 1000,
  );
});
