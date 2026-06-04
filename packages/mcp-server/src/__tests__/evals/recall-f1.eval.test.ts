/**
 * v0.2 recall F1 eval — over the canonical 100-entry recall-corpus.json.
 *
 * BLOCKS AI-04 closure per the spike-findings carry-forward gate
 * (04-PHASE-5-HANDOFF.md §"Real-Corpus Validation Gate") and per
 * AI-SPEC.md §5 dimension #1 (F1 ≥ 0.75 PASS bar).
 *
 * Split-aware: reads EVAL_SPLIT env var ("train" | "validate" | "all").
 * Default: "train". Milestone-close gate uses "validate".
 *
 * Fail-fast guard: asserts corpus.embedding_model matches the EMBEDDING_MODEL
 * constant before running any F1 scoring — prevents stale labels from a
 * previous model version silently contaminating results.
 *
 * Requires real Workers AI + Vectorize bindings (`remote: true`
 * in `wrangler.test.jsonc`). PR CI: `it.skip` with TODO note. Nightly
 * CI: removes `.skip` and runs against the real bindings.
 *
 * Diagnostic: per-example PASS/FAIL is logged to console so the
 * per-example column in milestone eval reports can be populated.
 *
 * PRE-03 reference: .planning/evals/recall-corpus.json (v0.2 canonical corpus)
 *
 * --- DEPRECATED v0.2 (PRE-03): reference-corpus.json and real-corpus.json ---
 * The two legacy corpus files below are no longer read by this test.
 * They are retained in fixtures/ because:
 *   - packages/triage-worker/evals/load-fixtures.mjs references reference-corpus.json
 *   - packages/triage-worker/src/__tests__/evals/memorability-calibration.eval.test.ts
 *     imports reference-corpus.json
 * Do not delete those files until the triage-worker references are updated.
 * ---
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import { EMBEDDING_MODEL } from "../../ai-helper.js";

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

// Path: packages/mcp-server/src/__tests__/evals/ → repo root → .planning/evals/
// import.meta.dirname is the directory of this file (available in Node ≥22 / vitest).
// Five levels up reaches the monorepo root.
const CORPUS_PATH = resolve(
  import.meta.dirname,
  "../../../../..",
  ".planning/evals/recall-corpus.json",
);

interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  query: string;
  expected_top_3_block_ids: [string, string, string];
  split: "train" | "validate";
  labeled_by: string;
  labeled_at: string;
  expected_synthesis: null;
}

interface CorpusFile {
  corpus_version: number;
  embedding_model: string;
  sources: { name: string; count: number; sourced_at: string }[];
  buckets: string[];
  entries: CorpusEntry[];
}

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as CorpusFile;

// ---------------------------------------------------------------------------
// Split-aware entry selection
// ---------------------------------------------------------------------------
//
// EVAL_SPLIT controls which entries are included in the F1 run:
//   "train"    — development eval (default); use during active tuning
//   "validate" — sequestered milestone-close gate; do not use until milestone gate
//   "all"      — both splits combined; useful for corpus-health diagnostics

const EVAL_SPLIT = (process.env.EVAL_SPLIT ?? "train") as "train" | "validate" | "all";

function selectEntries(split: "train" | "validate" | "all"): CorpusEntry[] {
  if (split === "all") return corpus.entries;
  return corpus.entries.filter((e) => e.split === split);
}

// ---------------------------------------------------------------------------
// Helpers
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

function parseEnvelope(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: "text"; text: string }] };
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

async function runF1Eval(
  entries: CorpusEntry[],
  workspace: string,
): Promise<{ f1: number; precision: number; recall: number; perExample: string[] }> {
  const rememberCb = captureCallback("remember", workspace);
  const recallCb = captureCallback("recall", workspace);

  // Phase 1 corpus uses expected_top_3_block_ids referencing the eval-fixtures
  // workspace (stable opaque IDs). We ingest corpus queries via remember() and
  // then check whether recall() surfaces the expected block IDs.
  //
  // NOTE: the idMap approach from the original v0.1 harness mapped corpus entry
  // id → ingest-time block id. With v0.2's pre-labeled expected_top_3_block_ids,
  // the expected IDs are already stable. The F1 harness checks whether at least
  // one of the 3 expected IDs appears in the recall results.

  const idMap = new Map<string, string[]>();
  for (const ex of entries) {
    if (ex.query.trim().length === 0) continue; // skip empty-query entries
    const res = parseEnvelope(await rememberCb({ content: ex.query, type: "research_note" }, {}));
    const blockId = (res.result as { id?: string }).id;
    if (blockId) idMap.set(ex.id, [blockId, ...ex.expected_top_3_block_ids]);
    // DIAGNOSTIC: print first 2 remember() responses
    if (idMap.size <= 2) {
      console.log(`[DIAG] remember(${ex.id}) →`, JSON.stringify(res).slice(0, 400));
    }
  }
  console.log(
    `[DIAG] idMap size after ingest: ${String(idMap.size)} / corpus ${String(entries.length)}`,
  );

  // ENG-20 AI-04: async pipeline wait (triage queue + Vectorize indexing)
  const ASYNC_PIPELINE_WAIT_MS = 180_000;
  console.log(
    `[DIAG] waiting ${String(ASYNC_PIPELINE_WAIT_MS / 1000)}s for triage queue + Vectorize indexing...`,
  );
  await new Promise((r) => setTimeout(r, ASYNC_PIPELINE_WAIT_MS));

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const perExample: string[] = [];

  let queryCount = 0;
  for (const ex of entries) {
    if (ex.query.trim().length === 0) continue; // match ingest-loop guard (WR-01)
    const result = parseEnvelope(
      await recallCb({ query: ex.query, verbosity: "chunks", limit: 5 }, {}),
    );
    const memories = ((result.result as { memories?: { id: string }[] }).memories ?? []).slice(
      0,
      5,
    );
    const expectedIds = ex.expected_top_3_block_ids;
    const isHit = memories.some((m) => expectedIds.includes(m.id));
    // DIAGNOSTIC: print first 3 recall responses
    if (queryCount < 3) {
      console.log(
        `[DIAG] recall("${ex.query.slice(0, 50)}") expected=${JSON.stringify(expectedIds)}`,
      );
      console.log(
        `[DIAG]   memories.length=${String(memories.length)}, ids=${JSON.stringify(memories.map((m) => m.id))}`,
      );
      console.log(
        `[DIAG]   full envelope keys: ${JSON.stringify(Object.keys(result.result as object))}`,
      );
      console.log(
        `[DIAG]   meta: ${JSON.stringify((result as { meta?: unknown }).meta).slice(0, 200)}`,
      );
    }
    queryCount++;
    if (isHit) {
      truePositives++;
      perExample.push(`PASS ${ex.id} (${ex.bucket}): ${ex.query.slice(0, 60)}`);
    } else if (memories.length > 0) {
      // Returned results but none were relevant — standard precision@k miss.
      // Previously this counted every non-matching result individually, mixing
      // per-result FP with per-query FN and producing a non-standard metric.
      falsePositives++;
      perExample.push(`FAIL ${ex.id} (${ex.bucket}): ${ex.query.slice(0, 60)}`);
    } else {
      // Returned nothing — true miss (no recall).
      falseNegatives++;
      perExample.push(`FAIL ${ex.id} (${ex.bucket}): ${ex.query.slice(0, 60)}`);
    }
  }

  const precision =
    truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { f1, precision, recall, perExample };
}

// ---------------------------------------------------------------------------
// Creds guard — mirrors eval-budget.setup.ts hasEvalCreds pattern
// ---------------------------------------------------------------------------

function hasEvalCreds(): boolean {
  // Real eval requires wrangler auth + CF bindings (Workers AI + Vectorize).
  // Presence of CLOUDFLARE_ACCOUNT_ID is a reliable proxy.
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID);
}

// ---------------------------------------------------------------------------
// Pre-flight: assert corpus embedding_model matches EMBEDDING_MODEL constant
// ---------------------------------------------------------------------------

describe("PRE-03 corpus sanity (always runs — no creds required)", () => {
  it("corpus.embedding_model matches the EMBEDDING_MODEL constant", () => {
    // Fail-fast: if this assertion fails, the corpus was labeled against a
    // different model and F1 scores below are meaningless.
    expect(corpus.embedding_model).toBe(EMBEDDING_MODEL);
  });

  it("corpus has ≥100 entries", () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("all entries have split ∈ {train, validate}", () => {
    const validSplits = new Set<string>(["train", "validate"]);
    const invalid = corpus.entries.filter((e) => !validSplits.has(e.split));
    expect(invalid).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F1 eval — split-aware
// ---------------------------------------------------------------------------

const evalEntries = selectEntries(EVAL_SPLIT);

describe(`AI-04 recall F1 — ${EVAL_SPLIT} split (${String(evalEntries.length)} entries — BLOCKS AI-04 closure if F1 < 0.75)`, () => {
  // hasEvalCreds() guard (inside the test body) handles environments without
  // Cloudflare credentials — it short-circuits with a console.log and returns
  // early so no AI tokens are burned. it.skip was removed because it caused
  // the CI eval-suite job to always exit 0 vacuously (the F1 gate never ran).
  it(`F1 ≥ 0.75 across ${String(evalEntries.length)} ${EVAL_SPLIT}-split entries`, async () => {
    if (!hasEvalCreds()) {
      console.log("[SKIP] No CF creds detected — skipping F1 eval");
      return;
    }

    const workspace = `ws-eval-f1-${EVAL_SPLIT}`;
    const { f1, precision, recall, perExample } = await runF1Eval(evalEntries, workspace);
    console.log(
      `AI-04 ${EVAL_SPLIT}-split F1: ${f1.toFixed(4)} (precision: ${precision.toFixed(4)}, recall: ${recall.toFixed(4)})`,
    );
    for (const line of perExample) console.log(`  ${line}`);
    expect(f1).toBeGreaterThanOrEqual(0.75);
  }, 600_000);
});
