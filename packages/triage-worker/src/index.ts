/**
 * Engram Triage Worker — Queue consumer entry point.
 *
 * Consumes `MemoryEvent` messages from the `engram-ingest` Cloudflare Queue,
 * calls `extractAndScore` to classify + score each event via Workers AI, then
 * routes by memorability to the appropriate WorkspaceDO RPC method.
 *
 * Cross-phase contract:
 * - **Phase 5 AI-05/06/07:** consumer body ships here. Extract logic lives in
 *   `extract.ts`; routing predicate lives in `memorability.ts`.
 * - **Phase 6 PIP-01:** the Queue consumer binding (`queues.consumers[]`) is wired
 *   in `wrangler.jsonc` by Phase 6. Until then, the consumer body is reachable
 *   ONLY via test invocation (extract.test.ts covers extractAndScore directly).
 * - **Phase 6 PIP-02:** the producer (`mcp-server/src/tools.ts` `remember()` handler
 *   `ctx.waitUntil(env.INGEST_QUEUE.send(memoryEvent))`) is also Phase 6. Phase 5's
 *   `remember()` (Plan 05-03) does NOT send Queue messages.
 * - **CONTEXT.md D-07 (cardinal-sin clause):** `<0.4` memorability routes to
 *   `moveToColdStorage`, NEVER `discardWithLog`.
 *
 * Design notes:
 * - Sequential message processing (`for...of` not `Promise.all`) is intentional
 *   for v0.1 single-user volume. Parallel `env.AI.run` calls without a concurrency
 *   cap will trigger 429s in the second half of any large batch (RESEARCH §"Async-
 *   First Design" Pitfall 1). Revisit at v1.0 when Queue volume grows.
 * - `(stub as any).methodName(...)` is required because `env.WORKSPACE` is typed
 *   as `DurableObjectNamespace` (general); the actual method surface is on
 *   `WorkspaceDO` in the mcp-server package. Plan 05-07's v0.2 hand-off may
 *   introduce a shared `@engram/workspace-do` type re-export to recover type safety.
 * - RESEARCH Assumption A6: triage-worker uses the raw DO stub form
 *   (`env.WORKSPACE.get(env.WORKSPACE.idFromName(...))`) instead of `getAgentByName`
 *   because triage-worker does not import the `agents` SDK package.
 *
 * @module @engram/triage-worker
 */
import type {
  Ai,
  DurableObjectNamespace,
  VectorizeIndex,
  AnalyticsEngineDataset,
  MessageBatch,
  Message,
} from "@cloudflare/workers-types";
import type { MemoryEvent } from "@engram/types";
import { extractAndScore } from "./extract.js";
import { routeByMemorability } from "./memorability.js";
import { writeAnalytics, workspaceTag } from "./analytics.js";

const ANALYTICS_ENV_TAG = "engram-prod" as const;

// ---------------------------------------------------------------------------
// Env — Worker binding interface
// ---------------------------------------------------------------------------

/**
 * Worker environment bindings for the Triage Worker.
 *
 * All bindings are declared in `packages/triage-worker/wrangler.jsonc`.
 * The `WORKSPACE` cross-Worker DO binding (`script_name = "engram-mcp-server"`)
 * was added in Plan 05-01 Task 2.
 */
export interface Env {
  /** Workers AI binding — used by `extractAndScore` for entity extraction. */
  AI: Ai;
  /** Vectorize binding — reserved for future v0.2 vector search in Triage. */
  VECTORIZE: VectorizeIndex;
  /**
   * Cross-Worker DO binding reaching `WorkspaceDO` in the mcp-server package.
   * Wrangler config: `script_name = "engram-mcp-server"`, `class_name = "WorkspaceDO"`.
   */
  WORKSPACE: DurableObjectNamespace;
  /**
   * Workers Analytics Engine dataset — stub binding.
   * Plan 05-07 wires `writeDataPoint` calls at the triage:ai-429-* + triage:zod-* log sites.
   */
  ANALYTICS?: AnalyticsEngineDataset;
}

// ---------------------------------------------------------------------------
// Queue consumer default export
// ---------------------------------------------------------------------------

export default {
  /**
   * Queue consumer handler. Called by the Cloudflare Queues runtime when the
   * `engram-ingest` queue has messages ready.
   *
   * @param batch - The message batch from the Queue.
   * @param env - Worker environment bindings.
   */
  async queue(batch: MessageBatch<MemoryEvent>, env: Env): Promise<void> {
    // Sequential processing (see Design notes above re: 429 risk with Promise.all).
    for (const message of batch.messages as Message<MemoryEvent>[]) {
      const event = message.body;

      // Memoize workspaceTag per-message: SHA-256 is called once here and
      // reused by every writeAnalytics call within this message processing
      // (extract.ts + the DO-RPC switch below).
      const wsTag = await workspaceTag(event.workspace_id);

      // extractAndScore handles its own retry/ack on 429 and Zod failures.
      // Returns null when it called retry or ack itself — caller must skip.
      const parsed = await extractAndScore(
        env,
        event,
        {
          attempts: (message as { attempts?: number }).attempts,
          ack: () => {
            message.ack();
          },
          retry: (opts: { delaySeconds: number }) => {
            message.retry(opts);
          },
          body: event,
        },
        wsTag,
      );

      if (parsed === null) {
        // extractAndScore called retry or ack — skip this message.
        continue;
      }

      // -----------------------------------------------------------------------
      // Route by memorability → WorkspaceDO RPC
      //
      // CONTEXT.md §"Claude's Discretion" Triage Worker → WorkspaceDO auth:
      // workspace_id arrives from MemoryEvent (producer puts it there);
      // STO-07 verifies at the DO boundary.
      //
      // RESEARCH Assumption A6: triage-worker uses raw DO stub form instead of
      // `getAgentByName` because triage-worker does not import the `agents` SDK.
      // -----------------------------------------------------------------------

      // Phase 6 PIP-05 / CONTEXT.md "Claude's Discretion → Queues consumer config":
      // pre-empt the silent-drop-on-retry-exhaustion failure mode. The Queues runtime
      // silently acks at attempts === max_retries; we mark failed + ack ourselves on
      // the LAST allowed attempt (wrangler.jsonc max_retries=3, 0-indexed attempts
      // → pre-empt at attempts >= 2).
      const attempts = (message as { attempts?: number }).attempts ?? 0;
      const isLastAttempt = attempts >= 2;

      const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(event.workspace_id));
      const decision = routeByMemorability(parsed.memorability);
      const rpcStart = Date.now();

      try {
        switch (decision) {
          case "store-normal":
            // memorability > 0.8 — store with enrichment directly
            await (
              stub as unknown as {
                updateBlockEnrichment: (args: {
                  workspace_id: string;
                  block_id: string;
                  properties: Record<string, unknown>;
                  summary: string;
                  confidence: number;
                }) => Promise<void>;
              }
            ).updateBlockEnrichment({
              workspace_id: event.workspace_id,
              block_id: event.id,
              properties: parsed.extracted_fields,
              summary: parsed.summary,
              confidence: parsed.confidence,
            });
            break;

          case "inbox":
            // memorability 0.4–0.8 — stage for human review
            await (
              stub as unknown as {
                moveToInbox: (args: {
                  workspace_id: string;
                  block_id: string;
                  entry: {
                    content: string;
                    proposed_type: string;
                    proposed_properties: Record<string, unknown>;
                    memorability_score: number;
                    source: string;
                  };
                }) => Promise<void>;
              }
            ).moveToInbox({
              workspace_id: event.workspace_id,
              block_id: event.id,
              entry: {
                content: event.content,
                proposed_type: parsed.classified_type,
                proposed_properties: parsed.extracted_fields,
                memorability_score: parsed.memorability,
                source: event.source,
              },
            });
            break;

          case "cold-storage":
            // memorability < 0.4 — CONTEXT.md D-07 cardinal-sin clause:
            // NEVER discardWithLog. moveToColdStorage preserves the block in
            // SQLite forever (no TTL in v0.1); cold blocks are excluded from
            // default recall() results.
            await (
              stub as unknown as {
                moveToColdStorage: (args: {
                  workspace_id: string;
                  block_id: string;
                  properties?: Record<string, unknown>;
                  summary?: string;
                  confidence?: number;
                  memorability: number;
                }) => Promise<void>;
              }
            ).moveToColdStorage({
              workspace_id: event.workspace_id,
              block_id: event.id,
              properties: parsed.extracted_fields,
              summary: parsed.summary,
              confidence: parsed.confidence,
              memorability: parsed.memorability,
            });
            break;
        }

        // Analytics: one DO RPC datapoint per message, distinguishable by decision.
        writeAnalytics(env, {
          blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "success"],
          doubles: [Date.now() - rpcStart, 0, 0, 0],
          indexes: [ANALYTICS_ENV_TAG],
        });

        // Message was successfully processed — acknowledge it.
        message.ack();
      } catch (err) {
        // Phase 6 PIP-05: DO RPC threw — assertOwnsWorkspace mismatch,
        // NotFoundError (block deleted between sync write and queue consume),
        // workerd SQLite drift, or cross-Worker DO outage. On the LAST allowed
        // attempt, mark failed + ack ourselves so the Queues runtime does NOT
        // silently drop on retry exhaustion. Otherwise consume one retry slot.
        const reason = err instanceof Error ? err.message : String(err);
        console.error("triage:do-rpc-failed", {
          id: event.id,
          decision,
          attempts,
          reason,
        });
        writeAnalytics(env, {
          blobs: ["triage-worker", `do-rpc-${decision}`, wsTag, "throw"],
          doubles: [Date.now() - rpcStart, 0, attempts, 1],
          indexes: [ANALYTICS_ENV_TAG],
        });

        if (isLastAttempt) {
          // markIngestFailed is itself a DO RPC — if IT throws we have no
          // recourse and must still ack. Wrap in inner try/catch.
          try {
            await (
              stub as unknown as {
                markIngestFailed: (args: {
                  workspace_id: string;
                  block_id: string;
                  reason: string;
                }) => Promise<void>;
              }
            ).markIngestFailed({
              workspace_id: event.workspace_id,
              block_id: event.id,
              reason: `do-rpc-${decision}: ${reason}`,
            });
            writeAnalytics(env, {
              blobs: ["triage-worker", `ingest-failed-do-rpc-${decision}`, wsTag, "marked"],
              doubles: [0, 0, attempts, 1],
              indexes: [ANALYTICS_ENV_TAG],
            });
          } catch (markErr) {
            console.error("triage:mark-failed-also-threw", {
              id: event.id,
              reason: markErr instanceof Error ? markErr.message : String(markErr),
            });
          }
          message.ack();
        } else {
          // Retry budget remains — let Queues runtime retry per max_retries config.
          message.retry({ delaySeconds: 30 });
        }
      }
    }
  },
};
