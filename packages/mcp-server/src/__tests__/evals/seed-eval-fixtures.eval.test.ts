/**
 * One-time seeding test for the "eval-fixtures" Vectorize namespace.
 *
 * Seeds ef-001..ef-120 fixture blocks (from .planning/evals/eval-fixtures-seed.json)
 * into the Vectorize index under namespace "eval-fixtures". Run ONCE before
 * running the recall-ranking.eval.test.ts 625-config sweep.
 *
 * This test is intentionally NOT wired into the default eval suite. Run it
 * manually when the eval workspace needs (re)seeding:
 *
 *   cd packages/mcp-server
 *   npm run test:eval -- seed-eval-fixtures.eval.test.ts
 *
 * Budget: 120 AI.run calls (1 embed per block) + 120 VECTORIZE.upsert calls
 * (upsert is NOT counted by eval-budget.setup.ts — only VECTORIZE.query is counted).
 * Real AI budget: 120 < 200 (within MAX_AI_CALLS limit).
 *
 * Idempotent: re-running will re-embed and re-upsert the same vectors.
 *
 * @module seed-eval-fixtures
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { EMBEDDING_MODEL } from "@engram/ai-config";

// Loaded as a build-time JSON import (Vite bundles it; fs.readFileSync fails in workerd).
import seedJson from "../../../../../.planning/evals/eval-fixtures-seed.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Creds guard (mirrors recall-ranking.eval.test.ts pattern)
// ---------------------------------------------------------------------------

function hasEvalCreds(): boolean {
  if (process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID) return true;
  // Workerd isolates process.env from the host shell. If env.AI is bound
  // (real remote binding present), treat that as evidence creds are available.
  try {
    return typeof (env as { AI?: unknown }).AI !== "undefined";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seed test
// ---------------------------------------------------------------------------

const seed = seedJson;
const EVAL_WORKSPACE = "eval-fixtures";

describe("seed-eval-fixtures: one-time workspace setup (requires eval creds)", () => {
  it(`embeds and upserts ${String(seed.memories.length)} fixture blocks into Vectorize namespace "${EVAL_WORKSPACE}"`, async () => {
    if (!hasEvalCreds()) {
      console.log("[SEED] No CF creds — skipping eval fixture seeding");
      return;
    }

    console.log(
      `[SEED] Seeding ${String(seed.memories.length)} fixture blocks into namespace "${EVAL_WORKSPACE}"...`,
    );

    let seeded = 0;
    let failed = 0;

    for (const fixture of seed.memories) {
      try {
        // Embed the fixture content (1 AI call per block).
        const embedResult = await env.AI.run(EMBEDDING_MODEL as "@cf/qwen/qwen3-embedding-0.6b", {
          text: [fixture.content],
        });
        const vector = (embedResult as { data: number[][] }).data[0];
        if (!vector || vector.length === 0) {
          console.warn(`[SEED] dim mismatch on fixture ${fixture.id} — skipping`);
          failed++;
          continue;
        }

        // Upsert to Vectorize (NOT counted by eval-budget.setup.ts — only query is tracked).
        await env.VECTORIZE.upsert([
          {
            id: fixture.id,
            values: vector,
            namespace: EVAL_WORKSPACE,
            metadata: {
              type: fixture.type,
              scope: "personal",
              created_at: Date.now(),
            },
          },
        ]);

        seeded++;
        if (seeded % 20 === 0) {
          console.log(`[SEED] Progress: ${String(seeded)}/${String(seed.memories.length)}`);
        }
      } catch (err) {
        console.warn(
          `[SEED] Failed on fixture ${fixture.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }

    console.log(
      `[SEED] Done. Seeded: ${String(seeded)} / Failed: ${String(failed)} / Total: ${String(seed.memories.length)}`,
    );

    // Vectorize mutations are async — they may not be immediately queryable.
    // Wait 30s for consistency propagation before asserting.
    console.log("[SEED] Waiting 30s for Vectorize index consistency propagation...");
    await new Promise((r) => setTimeout(r, 30_000));

    // Spot-check: verify a sample of seeded IDs are queryable.
    const sampleId = seed.memories[0]?.id;
    if (sampleId !== undefined) {
      const check = await env.VECTORIZE.getByIds([sampleId]);
      const found = check.filter((v) => v.id === sampleId).length;
      console.log(`[SEED] Spot-check ${sampleId}: ${found > 0 ? "FOUND" : "NOT FOUND"}`);
    }

    // Assert most blocks were seeded (allow up to 10% failure for transient errors).
    expect(seeded).toBeGreaterThanOrEqual(Math.floor(seed.memories.length * 0.9));
    expect(failed).toBeLessThanOrEqual(Math.floor(seed.memories.length * 0.1));
  }, 600_000); // 10 minutes: 120 blocks × ~2s embed = ~240s + wait
});
