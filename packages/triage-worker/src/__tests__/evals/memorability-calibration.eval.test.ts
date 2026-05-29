/**
 * AI-06 memorability calibration eval — distribution band check.
 *
 * AI-SPEC.md §5 dimension #5 gate: over the 20-example reference corpus,
 * the routed-memorability distribution must land in the 60/30/10 ± 10pp band:
 *   - store-normal:  [0.5, 0.7]
 *   - inbox:         [0.2, 0.4]
 *   - cold-storage:  [0.0, 0.2]
 *
 * Failure mode this guards against: the SYSTEM_PROMPT rubric drifts so that
 * almost everything scores >0.8 (store-normal) or <0.4 (cold-storage), and
 * the inbox tier dies. Either failure breaks Russell's "remember THIS, not
 * everything" promise to the user.
 *
 * Mitigation when this fails: re-engineer the SYSTEM_PROMPT memorability
 * rubric — NEVER change the thresholds (which are public contract per
 * CLAUDE.md `## Ingest Pipeline`).
 *
 * Requires real Workers AI bindings (`remote: true`). PR CI: `it.skip` to
 * avoid neuron cost. Nightly CI: removes `.skip` and runs against the real
 * llama-3.1-8b-instruct.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import refCorpus from "../../../../mcp-server/src/__tests__/evals/fixtures/reference-corpus.json";
import { extractAndScore, type Message } from "../../extract.js";
import { routeByMemorability, type RouteDecision } from "../../memorability.js";
import type { MemoryEvent } from "@engram/types";

interface CorpusEntry {
  id: string;
  bucket: string;
  memory_type: string;
  original_content: string;
}

describe("AI-06 memorability calibration (60/30/10 ±10pp band over reference corpus)", () => {
  it.skip("score distribution falls in 60/30/10 ±10pp split (store-normal / inbox / cold-storage)", async () => {
    const counts: Record<RouteDecision, number> = {
      "store-normal": 0,
      inbox: 0,
      "cold-storage": 0,
    };

    for (const ex of refCorpus as CorpusEntry[]) {
      // Skip the empty-content edge case (ref-016): extractAndScore would
      // return null and the entry doesn't count toward the calibration.
      if (ex.original_content.trim().length === 0) continue;

      const event: MemoryEvent = {
        id: ex.id,
        source: "eval:memorability-calibration",
        content: ex.original_content,
        workspace_id: "ws-calibration",
        timestamp: Date.now(),
      };
      const message: Message = {
        attempts: 1,
        body: event,
        ack: () => {
          /* no-op for eval */
        },
        retry: () => {
          /* no-op for eval */
        },
      };

      const parsed = await extractAndScore(
        env as unknown as Parameters<typeof extractAndScore>[0],
        event,
        message,
      );
      if (parsed === null) continue; // 429 retry or Zod parse-fail permanent — not part of distribution

      counts[routeByMemorability(parsed.memorability)]++;
    }

    const total = counts["store-normal"] + counts.inbox + counts["cold-storage"];
    if (total === 0) {
      throw new Error("All entries failed extractAndScore; cannot compute calibration");
    }
    const pStore = counts["store-normal"] / total;
    const pInbox = counts.inbox / total;
    const pCold = counts["cold-storage"] / total;
    console.log(
      `AI-06 distribution (N=${String(total)}): store=${pStore.toFixed(2)}, inbox=${pInbox.toFixed(2)}, cold=${pCold.toFixed(2)}`,
    );
    console.log(
      "  Target: 60/30/10 ± 10pp → store [0.5, 0.7] / inbox [0.2, 0.4] / cold [0.0, 0.2]",
    );

    expect(pStore).toBeGreaterThanOrEqual(0.5);
    expect(pStore).toBeLessThanOrEqual(0.7);
    expect(pInbox).toBeGreaterThanOrEqual(0.2);
    expect(pInbox).toBeLessThanOrEqual(0.4);
    expect(pCold).toBeGreaterThanOrEqual(0);
    expect(pCold).toBeLessThanOrEqual(0.2);
  }, 600_000);
});
