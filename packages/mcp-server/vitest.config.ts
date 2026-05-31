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

export default defineConfig({
  test: {
    projects: [
      {
        // Workerd-pool project: every test file under src/__tests__/ EXCEPT
        // the AI-02 lint-no-direct-vectorize grep gate (needs node:fs).
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
            // ai-helper-identity.test.ts uses node:fs readFileSync for cross-package reads;
            // workerd runtime does not support this. Runs in lint-node pool below.
            "src/__tests__/ai-helper-identity.test.ts",
            // embedding-consistency.test.ts (Plan 05-06 Task 3 — AI-SPEC §5 dimension #2)
            // also reads triage-worker/src/ai-helper.ts via node:fs.
            "src/__tests__/evals/embedding-consistency.test.ts",
            // ENG-20 (CI): recall-f1 needs remote-mode wrangler bindings (real
            // Vectorize + AI). cloudflare-vitest-pool tries to open a remote
            // proxy session at file-load time, which fails in CI because that
            // path requires interactive `wrangler login` OAuth — not satisfiable
            // by CLOUDFLARE_API_TOKEN alone. Tests inside are currently
            // `it.skip` (real-corpus fixtures haven't landed), so excluding the
            // file loses zero coverage. When ENG-20 closes (fixtures land +
            // .skip removed), re-include here AND grow a separate CI surface
            // that can run it — e.g. a nightly job on a runner where
            // `wrangler login` is feasible, or a CF Workers Builds gate where
            // the binding is native.
            "src/__tests__/evals/recall-f1.eval.test.ts",
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
            // Cross-file model-constant identity test (AI-SPEC.md §5 dimension #2).
            // Reads triage-worker/src/ai-helper.ts via node:fs — cannot run in workerd pool.
            "src/__tests__/ai-helper-identity.test.ts",
            // Plan 05-06 Task 3 dedicated AI-SPEC §5 dimension #2 eval framing.
            "src/__tests__/evals/embedding-consistency.test.ts",
          ],
        },
      },
    ],
  },
});
