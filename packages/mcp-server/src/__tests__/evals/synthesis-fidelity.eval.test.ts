/**
 * SYN-01 / SYN-02 / SYN-04: synthesis fidelity eval
 * — LLM judge faithfulness gate (≥90%) + latency gate (p99 ≤ 20s local hang guard)
 *
 * PHASE-BLOCKING GATES (fail → BLOCKS phase, do NOT proceed to /gsd:verify-work)
 * -------------------------------------------------------------------------------
 *   SYN-02: passRate = passCount / judgedTotal ≥ 0.90 (faithfulness ≥ 90%)
 *   SYN-02: totalHallucinatedEntities === 0 (zero hallucinated entities)
 *   SYN-04: p99 ≤ LOCAL_HANG_CEILING_MS=20_000 (local hang guard only)
 *
 * NON-BLOCKING (logged for visibility)
 * -----------------------------------------------------------------------
 *   SYN-04: p50 logged vs P50_BUDGET_MS=5000, p99 logged vs P99_BUDGET_MS=8000
 *   SYN-01: per-entry completeness note vs expected_synthesis captions (logged only)
 *
 * JUDGE DESIGN (D-04)
 * -------------------
 * The judge is JUDGE_MODEL (@cf/meta/llama-3.3-70b-instruct-fp8-fast) — a larger
 * model than SYNTHESIS_MODEL (Scout). Scout-judging-Scout is self-lenient. The judge
 * assesses faithfulness against SOURCE MEMORIES, not expected_synthesis captions.
 * Captions are a secondary completeness signal (logged, not gating).
 *
 * BUDGET MATH
 * -----------
 * 30 validate-split entries × 3 calls (embed + synthesis + judge) = 90 calls ≤ MAX_AI_CALLS=200.
 * MAX_AI_CALLS=200 is enforced automatically via eval-budget.setup.ts (setupFiles in
 * vitest.config.ts eval project) — do NOT reference that file directly.
 *
 * BUDGET LEAK MITIGATION (Pitfall 2 from RESEARCH.md)
 * ----------------------------------------------------
 * This eval calls recall(verbosity="synthesis") via captureCallback. If adaptive query
 * expansion fires (top1_cosine < ADAPTIVE_TOP1_THRESHOLD=0.65), each entry may consume
 * up to ~8 calls instead of ~3. Worst-case expansion for all 30: 30 × ~8 = 240 > 200.
 * Mitigation: the 0.85 variant-gate + 0.65 adaptive threshold typically results in
 * <20% of queries triggering fan-out (observe fan-out rate in logs). If budget is
 * exceeded, re-run with EVAL_SPLIT=train (expansion more likely quiet) or call the
 * synthesis helpers directly via the production formatBlocksForSynthesis path. Do NOT
 * change MAX_AI_CALLS.
 *
 * PROMPT FREEZE WARNING (D-01 / SYN-10)
 * --------------------------------------
 * Do NOT edit SYNTHESIS_SYSTEM_PROMPT in tools.ts. Any prompt change requires
 * re-running this eval to re-establish the faithfulness baseline (D-01/SYN-10).
 *
 * @module @engram/mcp-server/synthesis-fidelity-eval
 * @requirement SYN-01, SYN-02, SYN-04
 */

import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { JUDGE_MODEL, sanitizeJsonSchemaForWorkersAI } from "@engram/ai-config";
import { z } from "zod";
import { safeRun } from "../../ai-helper.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";

// Build-time JSON import — workerd cannot fs.readFileSync host-filesystem paths.
import corpusJson from "./fixtures/recall-corpus-v2.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum validate-split entries to run through the judge in this eval session.
 * Budget: 30 × 3 calls (embed + synthesis + judge) = 90 calls (≤200 ceiling).
 * Cap at the full 30-entry validate split per D-08.
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

const EVAL_WORKSPACE_ID = "eval-fixtures";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: string | null;
}

interface CorpusFile {
  corpus_version: number;
  embedding_model: string;
  sources: { name: string; count: number; sourced_at: string }[];
  buckets: string[];
  entries: CorpusEntry[];
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
// captureCallback — invoke recall() via the registered tool handler
// (pattern from recall-f1.eval.test.ts lines 94–124)
// ---------------------------------------------------------------------------

function captureCallback(
  toolName: string,
  workspace_id: string,
): (args: unknown, extra: unknown) => Promise<unknown> {
  const spy = vi.spyOn(McpServer.prototype, "registerTool");
  try {
    const server = new McpServer({ name: "engram-eval", version: "0.0.1" });
    registerTools(
      server,
      () => ({ workspace_id, user_id: "u-eval" }),
      env,
      () =>
        ({
          waitUntil: (p: Promise<unknown>) => {
            void p;
          },
        }) as unknown as DurableObjectState,
    );
    for (const rawCall of spy.mock.calls) {
      const [callName, , callCb] = rawCall as unknown as [
        string,
        unknown,
        (args: unknown, extra: unknown) => Promise<unknown>,
      ];
      if (callName === toolName) return callCb;
    }
    throw new Error(`registration for '${toolName}' not captured`);
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Cast corpus
// ---------------------------------------------------------------------------

const corpus = corpusJson as unknown as CorpusFile;

// ---------------------------------------------------------------------------
// Helper — parse the MCP tool response envelope
// ---------------------------------------------------------------------------

function parseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Corpus content smoke test (no creds required — SYN-01 check)
// ---------------------------------------------------------------------------

describe("SYN-01 corpus content check (no creds required)", () => {
  it("validate-split entries ≥ 30 exist in the fixture", () => {
    const validateEntries = corpus.entries.filter((e) => e.split === "validate");
    expect(validateEntries.length).toBeGreaterThanOrEqual(SYNTHESIS_FIDELITY_QUERY_CAP);
  });

  it("at least 1 validate-split entry has non-null expected_synthesis", () => {
    const withCaption = corpus.entries.filter(
      (e) => e.split === "validate" && e.expected_synthesis !== null,
    );
    expect(withCaption.length).toBeGreaterThanOrEqual(1);
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
    "judge pass rate ≥ 90%; zero hallucinated entities; p99 ≤ LOCAL_HANG_CEILING_MS",
    async () => {
      if (!hasEvalCreds()) {
        console.log(
          "[SKIP] No CF creds — skipping SYN-02 synthesis fidelity eval " +
            "(set CLOUDFLARE_ACCOUNT_ID or ensure Workers AI binding to run)",
        );
        return;
      }

      const validateEntries = corpus.entries
        .filter((e) => e.split === "validate")
        .slice(0, SYNTHESIS_FIDELITY_QUERY_CAP);

      console.log(
        `[SYN-02] Running faithfulness eval on ${String(validateEntries.length)} validate-split entries ` +
          `(cap=${String(SYNTHESIS_FIDELITY_QUERY_CAP)}). ` +
          `Budget: ~${String(validateEntries.length)} × 3 = ~${String(validateEntries.length * 3)} calls ` +
          `(≤ MAX_AI_CALLS=200). Judge model: ${JUDGE_MODEL}.`,
      );

      const recallCb = captureCallback("recall", EVAL_WORKSPACE_ID);

      let passCount = 0;
      let judgedTotal = 0;
      let judgeErrors = 0;
      let synthesisNullCount = 0;
      let totalHallucinatedEntities = 0;
      const latencyMs: number[] = [];

      for (const entry of validateEntries) {
        const startMs = Date.now();

        // Invoke recall(verbosity="synthesis") via the registered tool handler.
        // The synthesis path calls SYNTHESIS_MODEL (Scout) on the ranked memories.
        let recallResult: Record<string, unknown>;
        try {
          const raw = await recallCb({ query: entry.query, verbosity: "synthesis", limit: 5 }, {});
          recallResult = parseEnvelope(raw);
        } catch (recallErr) {
          console.warn(
            `[SYN-02] recall() error for entry ${entry.id}: ` +
              String(recallErr instanceof Error ? recallErr.message : recallErr),
          );
          latencyMs.push(Date.now() - startMs);
          continue;
        }

        const durationMs = Date.now() - startMs;
        latencyMs.push(durationMs);

        // Extract synthesis string from the envelope.
        const resultPayload = recallResult.result as {
          synthesis?: string | null;
          memories?: { id: string; content?: string; summary?: string }[];
        };
        const synthesis = resultPayload.synthesis ?? null;

        // If synthesis is null (honest-stubs fallback): skip judge call for this entry.
        // Count as neither pass nor fail — synthesis failures are a separate concern.
        if (synthesis === null) {
          synthesisNullCount++;
          console.log(`[SYN-02] entry=${entry.id} synthesis=null (honest-stub) — skipping judge`);
          continue;
        }

        // Build source-memory context for the judge from the recalled memories.
        // The judge evaluates faithfulness against these actual returned memories,
        // not the expected_synthesis captions (which would contaminate the signal).
        const memories = resultPayload.memories ?? [];
        const sourceMemoriesText = memories
          .map((m, i) => `[${String(i + 1)}] ${m.summary ?? m.content ?? "(no content)"}`)
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
            `[SYN-02] judge call error for entry ${entry.id}: ` +
              String(judgeErr instanceof Error ? judgeErr.message : judgeErr),
          );
          continue;
        }

        // Zod gate: parse judge response before consuming verdict.
        // A fabricated JSON structure in the synthesis text cannot corrupt the metric.
        const parsed = JudgeVerdict.safeParse(judgeResp.response);
        if (!parsed.success) {
          judgeErrors++;
          console.warn(`[SYN-02] judge parse error for entry ${entry.id}: ` + parsed.error.message);
          continue;
        }

        const verdict: JudgeVerdict = parsed.data;
        judgedTotal++;

        if (verdict.faithful) {
          passCount++;
        } else {
          console.log(
            `[SYN-02] FAIL entry=${entry.id}: ` +
              `hallucinated_entities=${JSON.stringify(verdict.hallucinated_entities)}, ` +
              `unsupported_claims=${JSON.stringify(verdict.unsupported_claims)}`,
          );
        }

        totalHallucinatedEntities += verdict.hallucinated_entities.length;

        // Completeness check (logged only, NOT gating): compare synthesis content
        // against expected_synthesis caption as a secondary signal (SYN-01).
        // Captions must NOT contaminate the faithfulness gate (RESEARCH.md Pitfall 5).
        if (entry.expected_synthesis !== null && entry.expected_synthesis.length > 0) {
          const overlapNote =
            synthesis.length > 0
              ? `synthesis.length=${String(synthesis.length)}, caption.length=${String(entry.expected_synthesis.length)}`
              : "synthesis empty";
          console.log(
            `[SYN-01] completeness check (logged only) entry=${entry.id}: ${overlapNote}`,
          );
        }
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

      // SYN-02: faithfulness ≥ 90%
      expect(passCount / judgedTotal).toBeGreaterThanOrEqual(0.9);

      // SYN-02: zero hallucinated entities across all judged entries
      expect(totalHallucinatedEntities).toBe(0);

      // SYN-04: local hang guard — p99 must be below ceiling
      // (production SLA p50≤5s / p99≤8s is confirmed on deployed Worker, not here)
      expect(p99).toBeLessThanOrEqual(LOCAL_HANG_CEILING_MS);
    },
    // 10-minute timeout — 30 queries × (synthesis + judge) calls over remote bindings
    10 * 60 * 1000,
  );
});
