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
          exclude: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
      {
        // Node-pool project: ONLY the AI-02 lint grep gate.
        // Default Vitest pool (Node) — provides node:fs so the test can walk
        // the source tree. The cloudflareTest plugin is intentionally NOT
        // loaded for this project (it would try to bind WORKSPACE DO which
        // is irrelevant for a pure-grep test).
        test: {
          name: "lint-node",
          include: ["src/__tests__/lint-no-direct-vectorize.test.ts"],
        },
      },
    ],
  },
});
