/**
 * `conflictPipeline` — CON-02 conflict-detection orchestrator.
 *
 * Composes:
 * - `vectorizeNeighbors` (Plan 02-01) — cosine prefilter
 * - `detectConflict` (ENG-16 / Plan 02-04 — CON-01 byte-frozen, UNTOUCHED) — LLM inference
 * - `insertConflictAsInbox` RPC (Plan 02-05 / CON-04) — inbox write
 * - `writeAnalytics` (Plan 05-07 pattern) — D-20 analytics row
 *
 * Requirements satisfied:
 * - **CON-02** — orchestration: embed → cosine-prefilter (≥0.7) → dupe-skip → parallel detect → inbox writes
 * - **CON-06** — cosine-ceiling dupe filter at 0.92 (PITFALLS CD-4: near-duplicate ≠ conflict)
 * - **CON-07** — per-write budget=3 (structural cap via topK=3; `Promise.all` over ≤3; no `p-limit` needed)
 * - **CON-08** — NO notifications anywhere (architectural lock; PITFALLS CD-1); only output sinks are
 *               WorkspaceDO inbox table (via RPC) and the Analytics Engine
 * - **D-20**  — Analytics Engine schema: blobs[0]='conflict-pipeline', blobs[1]=<verdict>,
 *               blobs[2]=<wsTag>, blobs[3]=<ok|failed>;
 *               doubles[0]=latency_ms, doubles[1]=neighbors_examined, doubles[2]=0, doubles[3]=error_flag
 *
 * RESEARCH §Pitfall 6: `writeAnalytics` MUST be inside the function body (which runs inside
 * `ctx.waitUntil`). Extracting it to a sibling fire-and-forget breaks the lifetime guarantee.
 *
 * Revision log — Path A (internal embed):
 * Reconnaissance of `packages/triage-worker/src/extract.ts` and `index.ts` confirmed the
 * triage-worker does NOT compute the block embedding anywhere in the queue-consumer path
 * (`extractAndScore` only calls `CLASSIFIER_MODEL`; no `EMBEDDING_MODEL` call exists).
 * The embedding is therefore computed ONCE internally at the top of the pipeline via
 * `env.AI.run(EMBEDDING_MODEL, { text: [newBlock.content] })`. Cost: +1 AI call per
 * store-normal write (~150ms — within the CON-07 4s p99 budget). The `newBlock` shape
 * intentionally has NO `embedding` field; it is purely local to this function.
 *
 * @module @engram/triage-worker/conflict-pipeline
 */
import { detectConflict } from "./conflict-detection.js";
import { vectorizeNeighbors } from "@engram/vectorize-utils";
import { writeAnalytics, workspaceTag } from "./analytics.js";
import { EMBEDDING_MODEL } from "@engram/ai-config";
import type { InboxConflictProperties } from "@engram/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANALYTICS_ENV_TAG = "engram-prod" as const;
/** CON-02 prefilter threshold — neighbors below this cosine floor are ignored. */
const CONFLICT_COSINE_FLOOR = 0.7;
/** CON-06 (PITFALLS CD-4) — near-duplicates at or above this cosine are dupes, not conflicts. */
const CONFLICT_DUPE_CEILING = 0.92;
/** CON-07 per-write budget — topK ceiling used by Vectorize; structural concurrency cap (no p-limit needed). */
const CONFLICT_PER_WRITE_BUDGET = 3;

// ---------------------------------------------------------------------------
// Verdict type
// ---------------------------------------------------------------------------

type ConflictPipelineVerdict =
  | "contradiction"
  | "benign_update"
  | "unrelated"
  | "skipped-dupe"
  | "error";

// ---------------------------------------------------------------------------
// conflictPipeline — main export
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget conflict detection orchestrator. Called by the triage-worker
 * queue consumer via `ctx.waitUntil(conflictPipeline(env, newBlock))`.
 *
 * Errors are CAUGHT LOCALLY and logged via `console.error` — never re-thrown,
 * because a throw inside `ctx.waitUntil` marks the parent queue-consumer
 * invocation as failed (RESEARCH §Pitfall 6).
 *
 * The Analytics Engine row is emitted in `finally` so the row lands even on
 * error paths — the `verdict="error"` row is the failure signal for Plan 02-09's
 * observability script.
 *
 * @param env - Structural env with AI, VECTORIZE, WORKSPACE, and optional ANALYTICS bindings.
 * @param newBlock - The newly-written block. NO `embedding` field — the orchestrator
 *   computes the embedding internally as the first step (Revision log Path A).
 */
export async function conflictPipeline(
  env: {
    AI: Ai;
    VECTORIZE: VectorizeIndex;
    WORKSPACE: DurableObjectNamespace;
    ANALYTICS?: AnalyticsEngineDataset;
  },
  newBlock: {
    id: string;
    workspace_id: string;
    type: string;
    scope: string;
    content: string;
    created_at: number;
  },
): Promise<void> {
  const start = Date.now();
  const wsTag = await workspaceTag(newBlock.workspace_id);
  let neighborsExamined = 0;
  let verdict: ConflictPipelineVerdict = "unrelated";

  try {
    // -----------------------------------------------------------------------
    // Step 1: compute embedding internally (Path A — Revision log).
    // One AI call per store-normal write; vector is never persisted.
    // -----------------------------------------------------------------------
    const embedResp = await (
      env.AI.run as (model: string, input: { text: string[] }) => Promise<{ data: number[][] }>
    )(EMBEDDING_MODEL, { text: [newBlock.content] });

    const embedding = embedResp.data[0];
    if (!embedding || embedding.length === 0) {
      // Malformed embed response — treat as error; catch block handles analytics.
      throw new Error("conflict-pipeline: embed returned empty vector");
    }

    // -----------------------------------------------------------------------
    // Step 2: cosine prefilter (CON-02).
    // vectorizeNeighbors filters by workspace_id (namespace), type ($in),
    // scope ($eq), and threshold ≥CONFLICT_COSINE_FLOOR client-side.
    // -----------------------------------------------------------------------
    const neighbors = await vectorizeNeighbors(env, newBlock.workspace_id, embedding, {
      topK: CONFLICT_PER_WRITE_BUDGET,
      type: newBlock.type,
      scope: newBlock.scope,
      threshold: CONFLICT_COSINE_FLOOR,
    });
    neighborsExamined = neighbors.length;

    if (neighbors.length === 0) {
      verdict = "unrelated";
      return; // finally block still fires
    }

    // -----------------------------------------------------------------------
    // Step 3: cosine-ceiling dupe filter (CON-06 + PITFALLS CD-4).
    // Near-duplicates (cosine ≥ 0.92) are the SAME memory being re-written;
    // they are NOT conflicts. Dropping them prevents false positives.
    // -----------------------------------------------------------------------
    const candidates = neighbors.filter((n) => n.score < CONFLICT_DUPE_CEILING);
    if (candidates.length === 0) {
      verdict = "skipped-dupe";
      return; // finally block still fires
    }

    // -----------------------------------------------------------------------
    // Step 4: hydrate neighbor blocks (need .content for detectConflict).
    // Uses the established cross-Worker type-cast pattern from index.ts.
    // -----------------------------------------------------------------------
    const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(newBlock.workspace_id));
    const neighborBlocks = await (
      stub as unknown as {
        getBlocksByIds: (args: {
          workspace_id: string;
          ids: string[];
        }) => Promise<{ id: string; content: string; created_at: number }[]>;
      }
    ).getBlocksByIds({
      workspace_id: newBlock.workspace_id,
      ids: candidates.map((n) => n.id),
    });

    // -----------------------------------------------------------------------
    // Step 5: bounded-parallel CON-07 — Promise.all over ≤3 detectConflict calls.
    // The topK=CONFLICT_PER_WRITE_BUDGET ceiling IS the concurrency cap;
    // no p-limit needed (CON-07 analysis: 3 structural cap via Vectorize topK).
    // detectConflict is contracted to return null on AI error (never throws).
    // -----------------------------------------------------------------------
    const detections = await Promise.all(
      neighborBlocks.map((neighbor) =>
        detectConflict(env, newBlock.content, neighbor.content).then((out) => ({ neighbor, out })),
      ),
    );

    // -----------------------------------------------------------------------
    // Step 6: for category=contradiction, write to inbox (CON-04 shape).
    // Severity is NOT computed here — it is a READ-TIME computation in Plan 02-08
    // (recall handler, RESEARCH §"Pattern 6 severity computation").
    // The inbox row stores raw fields only.
    // -----------------------------------------------------------------------
    for (const { neighbor, out } of detections) {
      if (out?.category !== "contradiction") continue;

      const inboxArgs: InboxConflictProperties = {
        memory_a_id: newBlock.id,
        memory_b_id: neighbor.id,
        category: "contradiction",
        ai_confidence: out.confidence,
        description: out.reason,
      };

      await (
        stub as unknown as {
          insertConflictAsInbox: (
            args: { workspace_id: string } & InboxConflictProperties,
          ) => Promise<void>;
        }
      ).insertConflictAsInbox({ workspace_id: newBlock.workspace_id, ...inboxArgs });
    }

    // Determine final verdict — error overrides everything (handled in catch);
    // contradiction > benign_update > unrelated (default).
    verdict = detections.some((d) => d.out?.category === "contradiction")
      ? "contradiction"
      : "benign_update";
  } catch (err) {
    console.error("conflict-pipeline:failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    verdict = "error";
    // NEVER re-throw — a throw inside ctx.waitUntil marks the parent
    // queue-consumer invocation as failed (RESEARCH §Pitfall 6).
  } finally {
    // D-20 analytics: emit regardless of branch (including error).
    // Byte-frozen 4-blob / 4-double / 1-index schema per AI-SPEC.md §7.
    writeAnalytics(env, {
      blobs: ["conflict-pipeline", verdict, wsTag, verdict === "error" ? "failed" : "ok"],
      doubles: [Date.now() - start, neighborsExamined, 0, verdict === "error" ? 1 : 0],
      indexes: [ANALYTICS_ENV_TAG],
    });
  }
}
