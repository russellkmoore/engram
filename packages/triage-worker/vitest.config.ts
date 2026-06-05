/**
 * Vitest pool configuration for @engram/triage-worker.
 *
 * **PRE-02 update (v0.2 Phase 1):** converted from single-project to
 * multi-project mode to add the `eval` tier alongside the existing `workerd`
 * project. Mirrors the shape established in `packages/mcp-server/vitest.config.ts`.
 *
 * Two projects:
 *
 * 1. **workerd project** — every test under `src/__tests__/` EXCEPT eval files.
 *    Runs inside Cloudflare workerd via `@cloudflare/vitest-pool-workers`
 *    against `wrangler.test.jsonc`. AI, VECTORIZE, and WORKSPACE DO bindings
 *    resolved from the test config, not production wrangler.jsonc.
 *
 * 2. **eval project** — `*.eval.test.ts` files (gated on CF creds). Uses the
 *    shared `eval-budget.setup.ts` counter from mcp-server to enforce the
 *    MAX_AI_CALLS=200 ceiling across all eval files (Pitfall 3 defense:
 *    isolate:false prevents per-file counter reset).
 *
 * The two previously-excluded eval files (memorability-calibration +
 * conflict-precision) move from the workerd exclude list into the eval project's
 * include glob. The constraints (remote bindings, cost-gate, it.skip until
 * fixtures land) still apply — but the eval tier is the correct home for them.
 *
 * @module @engram/triage-worker/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// hasEvalCreds: eval project is gated on CF creds; counter discipline per
// RESEARCH §Pitfall 3 — without both vars, the eval project is excluded
// entirely so local runs without creds skip cleanly (no silent failure).
const hasEvalCreds = !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;

export default defineConfig({
  test: {
    projects: [
      {
        // Workerd project: every test under src/__tests__/ EXCEPT eval files.
        // The eval project below owns *.eval.test.ts.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
          }),
        ],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            // PRE-02: eval tier owns all *.eval.test.ts files.
            // The ENG-20 and ENG-16 files previously excluded here are now
            // included by the eval project — their it.skip guards and
            // remote-bindings constraints remain unchanged; only the project
            // assignment changes.
            "src/__tests__/**/*.eval.test.ts",
          ],
        },
      },
      // eval project: gated on CF creds; counter discipline per RESEARCH §Pitfall 3
      // — DO NOT remove isolate:false. Without it, each eval file gets a fresh
      // budget counter and a multi-file run silently burns 5×200=1000 AI calls.
      //
      // eval.test.ts files in scope:
      //   - memorability-calibration.eval.test.ts (ENG-20: it.skip until fixtures land)
      //   - conflict-precision.eval.test.ts       (ENG-16: it.skip until fixtures land)
      //
      // setupFiles: shared counter from mcp-server — one canonical copy so both
      // packages use the same MAX_AI_CALLS=200 ceiling and Analytics Engine write.
      ...(hasEvalCreds
        ? [
            {
              plugins: [
                cloudflareTest({
                  wrangler: { configPath: "./wrangler.test.jsonc" },
                }),
              ],
              test: {
                name: "eval",
                include: ["src/__tests__/**/*.eval.test.ts"],
                setupFiles: ["../mcp-server/src/__tests__/evals/eval-budget.setup.ts"],
                isolate: false,
                // singleWorker: @cloudflare/vitest-pool-workers v0.16.x does not
                // expose singleWorker as a ProjectConfig property. The equivalent
                // Pitfall 3 defense is isolate:false + maxWorkers:1.
                maxWorkers: 1,
                // Required by vitest 4.1+: projects with differing maxWorkers
                // need unique sequence.groupOrder, else vitest aborts the run.
                // Default (other projects) is 0 — eval gets 1.
                sequence: { groupOrder: 1 },
              },
            },
          ]
        : []),
    ],
  },
});
