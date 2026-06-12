/**
 * ENG-16 conflict-detection precision eval — v0.2 prep gate.
 *
 * Validates the precision of `detectConflict` on a labeled corpus of 50
 * memory pairs spanning the discrimination boundary:
 *   - 25 genuine contradictions
 *   - 15 benign updates
 *   - 10 unrelated pairs (control set)
 *
 * Precision = TP / (TP + FP), where:
 *   TP — labeled "contradiction" AND detector said is_conflict=true
 *   FP — labeled NOT contradiction (benign_update OR unrelated) AND
 *        detector said is_conflict=true
 *
 * False positives erode user trust faster than missed conflicts — this gate
 * exists because every `is_conflict=true` surfaces a UI prompt to the user
 * in v0.2+ (and a Slack alert in v0.4). One bad alert per day is worse than
 * silently missing a real contradiction.
 *
 * DECISION GATE (per ENG-16 issue spec):
 *   precision >= 0.90  → ship per-write conflict scanning in v0.2 as designed
 *   precision >= 0.70  → ship as low-confidence "suggestions" (no auto-alert;
 *                        surface in inbox UI only)
 *   precision <  0.70  → defer per-write entirely; batch-scan nightly with
 *                        human review
 *
 * Fixture: `./fixtures/conflict-pairs.json`. Currently 9 synthetic seed pairs
 * — the test will RUN but the result is NOT a validation gate signal until
 * Russell populates the file with the 50 real labeled pairs. The console
 * report flags this explicitly so a contributor running the eval can't
 * mistake a 100%-on-9-seeds result for a passing gate.
 *
 * Requires real Workers AI bindings (`remote: true` via vitest-pool-workers).
 * PR CI: `it.skip` to avoid neuron cost (~$0.01 per pair on
 * llama-3.1-8b-instruct). To run locally:
 *   1. Replace `it.skip` with `it` below.
 *   2. From repo root: `cd packages/triage-worker && npm test -- conflict-precision`
 *
 * @module @engram/triage-worker/__tests__/evals/conflict-precision
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";

import { detectConflict } from "../../conflict-detection.js";
import fixture from "./fixtures/conflict-pairs.json";

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

type LabeledCategory = "contradiction" | "benign_update" | "unrelated";

interface LabeledPair {
  id: string;
  category: LabeledCategory;
  memory_a: string;
  memory_b: string;
  note?: string;
}

interface ConflictFixture {
  _meta: {
    target_size: number;
    current_size: number;
    status: string;
  };
  pairs: LabeledPair[];
}

const typedFixture = fixture as ConflictFixture;

// ---------------------------------------------------------------------------
// Decision-gate thresholds (LOCKED per ENG-16 issue spec; do not adjust here)
// ---------------------------------------------------------------------------

const SHIP_PRECISION_THRESHOLD = 0.9;
const SUGGEST_PRECISION_THRESHOLD = 0.7;

/** v0.2 CON-01 ship gate per CONTEXT.md D-18 — pull-only inbox surface lowers the precision bar from 0.9 to 0.85. */
const V02_SHIP_PRECISION_THRESHOLD = 0.85;
/** v0.2 CON-01 ship gate per CONTEXT.md D-18 — explicit recall floor. */
const V02_SHIP_RECALL_THRESHOLD = 0.9;

type Verdict = "ship-per-write" | "ship-as-suggestions" | "defer-to-batch";

function decisionFor(precision: number): Verdict {
  if (precision >= SHIP_PRECISION_THRESHOLD) return "ship-per-write";
  if (precision >= SUGGEST_PRECISION_THRESHOLD) return "ship-as-suggestions";
  return "defer-to-batch";
}

// ---------------------------------------------------------------------------
// The eval
// ---------------------------------------------------------------------------

describe("ENG-16 conflict-detection precision (validation gate for v0.2 per-write scanning)", () => {
  it("meets the v0.2 per-write precision gate on the labeled corpus", async () => {
    const pairs = typedFixture.pairs;
    const target = typedFixture._meta.target_size;
    const isFullCorpus = pairs.length >= target;

    if (!isFullCorpus) {
      console.log(
        `[ENG-16] SEED RUN — fixture has ${String(pairs.length)}/${String(target)} pairs. ` +
          "Result is NOT a validation gate signal. Populate fixtures/conflict-pairs.json " +
          "to the target split (25 contradiction / 15 benign_update / 10 unrelated) for the real gate.",
      );
    }

    let tp = 0; // labeled contradiction, detector said is_conflict=true
    let fp = 0; // labeled NOT contradiction, detector said is_conflict=true
    let tn = 0; // labeled NOT contradiction, detector said is_conflict=false
    let fn = 0; // labeled contradiction, detector said is_conflict=false
    let nulls = 0; // detector failed (threw or zod-parse-failed)
    const failures: {
      id: string;
      labeled: LabeledCategory;
      predicted: LabeledCategory | "FAIL";
      reason?: string;
    }[] = [];

    for (const pair of pairs) {
      const out = await detectConflict(env, pair.memory_a, pair.memory_b);

      if (out === null) {
        nulls++;
        failures.push({ id: pair.id, labeled: pair.category, predicted: "FAIL" });
        continue;
      }

      const labeledIsConflict = pair.category === "contradiction";
      if (labeledIsConflict && out.is_conflict) tp++;
      else if (!labeledIsConflict && out.is_conflict) fp++;
      else if (!labeledIsConflict && !out.is_conflict) tn++;
      else fn++;

      if (labeledIsConflict !== out.is_conflict) {
        failures.push({
          id: pair.id,
          labeled: pair.category,
          predicted: out.category,
          reason: out.reason,
        });
      }
    }

    const denominator = tp + fp;
    const precision = denominator === 0 ? 1 : tp / denominator;
    const recallDenominator = tp + fn;
    const recall = recallDenominator === 0 ? 1 : tp / recallDenominator;

    console.log(
      `[ENG-16] confusion matrix (N=${String(pairs.length)}, AI-failures=${String(nulls)}): ` +
        `TP=${String(tp)} FP=${String(fp)} TN=${String(tn)} FN=${String(fn)}`,
    );
    console.log(
      `[ENG-16] precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} ` +
        `verdict=${decisionFor(precision)}`,
    );
    if (failures.length > 0) {
      console.log("[ENG-16] misclassifications + AI failures:");
      for (const f of failures) {
        console.log(
          `  - ${f.id}: labeled=${f.labeled} predicted=${f.predicted}` +
            (f.reason ? ` reason="${f.reason}"` : ""),
        );
      }
    }

    // Hard gate only fires on the full corpus. Seed runs report metrics but
    // do not assert — otherwise a 9-seed run could falsely "pass" the v0.2
    // gate that requires 30 labeled pairs.
    console.log(
      `[CON-01] v0.2 gate: precision=${precision.toFixed(3)} (≥ 0.85? ${precision >= V02_SHIP_PRECISION_THRESHOLD ? "YES" : "NO"}); ` +
        `recall=${recall.toFixed(3)} (≥ 0.90? ${recall >= V02_SHIP_RECALL_THRESHOLD ? "YES" : "NO"}); ` +
        `final verdict=${precision >= V02_SHIP_PRECISION_THRESHOLD && recall >= V02_SHIP_RECALL_THRESHOLD ? "PASS — proceed with Plan 02-05+" : "FAIL — STOP per D-18"}`,
    );
    if (isFullCorpus) {
      // v0.2 CON-01 hard gate per D-18:
      // - precision ≥ V02_SHIP_PRECISION_THRESHOLD (0.85)
      // - recall ≥ V02_SHIP_RECALL_THRESHOLD (0.90)
      // - On failure: STOP, Linear blocker, /gsd:plan-phase 2 --replan-section conflict-prompt
      //   (CONTEXT.md D-18: the executor MUST NOT silently retune the prompt)
      expect(
        precision,
        `CON-01 precision gate: ${precision.toFixed(3)} < 0.85 → STOP per D-18`,
      ).toBeGreaterThanOrEqual(V02_SHIP_PRECISION_THRESHOLD);
      expect(
        recall,
        `CON-01 recall gate: ${recall.toFixed(3)} < 0.90 → STOP per D-18`,
      ).toBeGreaterThanOrEqual(V02_SHIP_RECALL_THRESHOLD);
    } else {
      // On seed runs, only assert that the harness produced SOMETHING — at
      // least one classification, not all-AI-failures.
      expect(nulls).toBeLessThan(pairs.length);
    }
  }, 600_000);
});
