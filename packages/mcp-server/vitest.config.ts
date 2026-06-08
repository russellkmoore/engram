/**
 * Vitest pool configuration for @engram/mcp-server.
 *
 * **Phase 5 Plan 05-03 update:** switched from single-project to multi-project
 * mode to support the AI-02 lint gate (`lint-no-direct-vectorize.test.ts`).
 * That test uses `node:fs` / `readdirSync` which workerd does not implement
 * (mirrors the STO-10 pattern in workspace-do). The lint test runs in the
 * default Node pool; all other tests continue to run in workerd.
 *
 * Two projects:
 *
 * 1. **workerd-pool project** — every test under `src/__tests__/` EXCEPT the
 *    lint-no-direct-vectorize test. Runs inside Cloudflare workerd via
 *    `@cloudflare/vitest-pool-workers` against `wrangler.test.jsonc`.
 *
 * 2. **lint-node project** — ONLY `lint-no-direct-vectorize.test.ts`. Runs in
 *    the default Vitest Node pool so `node:fs` is available for the grep gate.
 *    No `cloudflareTest` plugin is loaded for this project.
 *
 * The workerd pool resolves both `MCP_OBJECT` (→ `EngramMcp`) and `WORKSPACE`
 * (→ `WorkspaceDO`) DO bindings from `wrangler.test.jsonc`, not the
 * production `wrangler.jsonc`. The `.test.jsonc` suffix excludes the file
 * from the FND-08 lint glob (`packages/*\/wrangler.jsonc`, literal filename)
 * by design.
 *
 * `cloudflareTest()` returns a `Vite.Plugin` and must be placed at the
 * project-level `plugins` array in multi-project mode (one entry per project,
 * not hoisted to the top-level Vite config).
 *
 * @module @engram/mcp-server/vitest.config
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
        // Workerd-pool project: every test file under src/__tests__/ EXCEPT
        // the AI-02 lint-no-direct-vectorize grep gate (needs node:fs) AND
        // eval files (owned by the eval project below — PRE-02).
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
          }),
        ],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: [
            "src/__tests__/lint-no-direct-vectorize.test.ts",
            // Plan 02-08 CON-08: grep gate uses node:fs — must run in lint-node pool.
            "src/__tests__/no-proactive-notifications.test.ts",
            // PRE-02: eval tier owns all *.eval.test.ts files — the glob below
            // subsumes the previously-explicit recall-f1.eval.test.ts exclusion.
            "src/__tests__/**/*.eval.test.ts",
            // ENG-25: ai-helper-identity.test.ts and embedding-consistency.test.ts
            // were the cross-file drift guards. Both were retired when model
            // constants moved to the shared `@engram/ai-config` package
            // (single source of truth — no cross-file drift possible).
            // ENG-20 AI-04: excluded from PR CI for wrangler-auth + cost.
            // Verified locally with `wrangler login` (2026-06-01):
            //   - reference-corpus (heterogeneous synthetic): F1=0.8205, P=0.73, R=0.94 (16/17)
            //   - real-corpus v1 (19 jobs only):              F1=0.3333, P=0.20, R=1.00 (19/19)
            //   - real-corpus v2 (27 incl 8 non-job):         F1=0.4779, P=0.31, R=1.00 (27/27)
            // Real-corpus F1 below 0.75 threshold but RECALL is perfect across
            // both runs — drop is corpus-homogeneity-driven precision artifact.
            // Diversification (v1 → v2) moved F1 +45% with no recall change.
            // Closing the rest of the gap to 0.75 requires either real-domain
            // diversification (truly unrelated memory types) or hybrid-rank
            // weight tuning per the issue's Task 5.1 A/B option.
            //
            // To re-run locally:
            //   1. wrangler login + populate .env with CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID
            //   2. Comment out this exclude line + flip the relevant it.skip → it
            //   3. cd packages/mcp-server && npx vitest run recall-f1.eval
            //   4. Allow ~4 min — triage queue + Vectorize indexing has a 180s wait.
            //
            // ENG-25 re-run (2026-06-02 with llama-4-scout + qwen3-embedding-0.6b
            // + MIN_COSINE_THRESHOLD=0.6 hybrid-rank tuning):
            //   - reference-corpus: F1=0.8333, P=0.79, R=0.88
            //   - real-corpus:      F1=0.8254, P=0.72, R=0.96
            // Both PASS the ≥0.75 gate; real-corpus jumped +73% vs bge-base baseline.
          ],
        },
      },
      {
        // Node-pool project: lint grep gate + cross-package identity tests.
        // Default Vitest pool (Node) — provides node:fs so the tests can walk
        // the source tree. The cloudflareTest plugin is intentionally NOT
        // loaded for this project (it would try to bind WORKSPACE DO which
        // is irrelevant for pure-grep / pure-identity tests).
        test: {
          name: "lint-node",
          include: [
            "src/__tests__/lint-no-direct-vectorize.test.ts",
            // Plan 02-08 CON-08: architectural grep gate for proactive notification
            // primitives. Mirrors lint-no-direct-vectorize shape. Runs in Node pool
            // so node:fs is available for the source-tree walk.
            "src/__tests__/no-proactive-notifications.test.ts",
            // ENG-25: ai-helper-identity + embedding-consistency files were
            // retired (cross-file drift impossible now that model IDs live
            // in the shared @engram/ai-config package).
          ],
        },
      },
      // eval project: gated on CF creds; counter discipline per RESEARCH §Pitfall 3
      // — DO NOT remove isolate:false. Without isolate:false + singleWorker:true,
      // each eval file gets a fresh budget counter and a 5-file run burns 5×200=1000
      // AI calls silently (Pitfall 3). The post-run Analytics Engine aggregate is
      // the defense-in-depth fallback; the in-process counter is the primary gate.
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
                setupFiles: ["./src/__tests__/evals/eval-budget.setup.ts"],
                isolate: false,
                // singleWorker: the @cloudflare/vitest-pool-workers v0.16.x does
                // not expose singleWorker as a ProjectConfig property. The equivalent
                // Pitfall 3 defense is isolate:false (counter not reset per-file)
                // + CI passes --maxWorkers=1 via test:eval npm script.
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
