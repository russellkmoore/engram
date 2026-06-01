/**
 * AI-04 recall F1 eval — over the 20-example reference corpus.
 *
 * BLOCKS AI-04 closure per the spike-findings carry-forward gate
 * (04-PHASE-5-HANDOFF.md §"Real-Corpus Validation Gate") and per
 * AI-SPEC.md §5 dimension #1 (F1 ≥ 0.75 PASS bar).
 *
 * Two describe blocks:
 *  1. Synthetic 20-example reference corpus (Plan 05-06 Task 2)
 *  2. Russell's sanitized real corpus (Plan 05-06 Task 4 — added when real-corpus.json lands)
 *
 * Both require real Workers AI + Vectorize bindings (`remote: true`
 * in `wrangler.test.jsonc`). PR CI: `it.skip` with TODO note. Nightly
 * CI: removes `.skip` and runs against the real bindings.
 *
 * Diagnostic: per-example PASS/FAIL is logged to console so the
 * 05-REAL-CORPUS-RESULTS.md per-example column can be populated.
 */
import { describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../tools.js";
import refCorpus from "./fixtures/reference-corpus.json";
import realCorpus from "./fixtures/real-corpus.json";

interface CorpusEntry {
  id: string;
  bucket: "critical-path" | "known-failure" | "extraction" | "edge";
  memory_type: string;
  original_content: string;
  paraphrased_query: string | null;
  intended_memory_id: string;
  expected_classified_type: string;
  known_failure_pattern: string | null;
}

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
  corpus: CorpusEntry[],
  workspace: string,
): Promise<{ f1: number; precision: number; recall: number; perExample: string[] }> {
  const rememberCb = captureCallback("remember", workspace);
  const recallCb = captureCallback("recall", workspace);

  const idMap = new Map<string, string>();
  for (const ex of corpus) {
    if (ex.original_content.trim().length === 0) continue; // skip empty-content edge
    const res = parseEnvelope(
      await rememberCb({ content: ex.original_content, type: ex.expected_classified_type }, {}),
    );
    const blockId = (res.result as { id?: string }).id;
    if (blockId) idMap.set(ex.id, blockId);
    // DIAGNOSTIC (ENG-20 AI-04): print first 2 remember() responses to see id + meta shape
    if (idMap.size <= 2) {
      console.log(`[DIAG] remember(${ex.id}) →`, JSON.stringify(res).slice(0, 400));
    }
  }
  console.log(
    `[DIAG] idMap size after ingest: ${String(idMap.size)} / corpus ${String(corpus.length)}`,
  );

  // ENG-20 AI-04: the deployed triage-worker consumes engram-ingest, runs the
  // classifier + embedder + upserts to Vectorize. Each message takes ~5-10s
  // (AI inference + embed + Vectorize write). For 19 messages, allow up to
  // 180s for the queue to drain AND for Vectorize's eventual-consistency
  // window to close. This is the cost of running an end-to-end eval against
  // the real async pipeline.
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
  for (const ex of corpus) {
    if (!ex.paraphrased_query) continue; // edge cases without paraphrase are not part of F1
    const result = parseEnvelope(
      await recallCb({ query: ex.paraphrased_query, verbosity: "chunks", limit: 5 }, {}),
    );
    const memories = ((result.result as { memories?: { id: string }[] }).memories ?? []).slice(
      0,
      5,
    );
    const expectedBlockId = idMap.get(ex.intended_memory_id);
    const isHit = expectedBlockId !== undefined && memories.some((m) => m.id === expectedBlockId);
    // DIAGNOSTIC (ENG-20 AI-04): print first 3 recall responses with FULL memory shape
    if (queryCount < 3) {
      console.log(
        `[DIAG] recall("${ex.paraphrased_query.slice(0, 50)}") expected blockId=${String(expectedBlockId)}`,
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
      perExample.push(`PASS ${ex.id} (${ex.bucket}): ${ex.paraphrased_query.slice(0, 60)}`);
    } else {
      falseNegatives++;
      perExample.push(
        `FAIL ${ex.id} (${ex.bucket}): ${ex.paraphrased_query.slice(0, 60)}${ex.known_failure_pattern ? ` [${ex.known_failure_pattern}]` : ""}`,
      );
    }
    falsePositives += memories.filter(
      (m) => expectedBlockId === undefined || m.id !== expectedBlockId,
    ).length;
  }

  const precision =
    truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { f1, precision, recall, perExample };
}

describe("AI-04 recall F1 — reference corpus (BLOCKS AI-04 closure if F1 < 0.75)", () => {
  // Nightly CI removes `.skip` to enable real-binding execution.
  // PR CI keeps `.skip` to avoid neuron + Vectorize cost on every PR.
  it.skip("F1 ≥ 0.75 across the 20-example reference corpus", async () => {
    const { f1, precision, recall, perExample } = await runF1Eval(
      refCorpus as CorpusEntry[],
      "ws-eval-f1-ref",
    );
    console.log(
      `AI-04 reference-corpus F1: ${f1.toFixed(4)} (precision: ${precision.toFixed(4)}, recall: ${recall.toFixed(4)})`,
    );
    for (const line of perExample) console.log(`  ${line}`);
    expect(f1).toBeGreaterThanOrEqual(0.75);
  }, 600_000);
});

// ENG-20 carry-forward gate: real corpus assembled from Russell's URL set
// (job-search sources fetched + sanitized to REDACTED-X-CORP convention).
// Same wrangler-auth + .env + pipeline-wait requirements as the reference
// corpus block above.
describe("AI-04 recall F1 — REAL CORPUS (carry-forward gate — BLOCKS AI-04 marked-done if F1 < 0.75)", () => {
  it.skip("F1 ≥ 0.75 on Russell's sanitized job-search corpus", async () => {
    const { f1, precision, recall, perExample } = await runF1Eval(
      realCorpus as CorpusEntry[],
      "ws-eval-f1-real",
    );
    console.log(
      `AI-04 real-corpus F1: ${f1.toFixed(4)} (precision: ${precision.toFixed(4)}, recall: ${recall.toFixed(4)})`,
    );
    for (const line of perExample) console.log(`  ${line}`);
    expect(f1).toBeGreaterThanOrEqual(0.75);
  }, 600_000);
});
