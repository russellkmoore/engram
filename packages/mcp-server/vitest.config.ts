/**
 * Vitest pool configuration for @engram/mcp-server.
 *
 * Single workerd project — every test under `src/__tests__/` runs inside the
 * real Cloudflare workerd runtime via `@cloudflare/vitest-pool-workers`.
 *
 * Simplification vs `packages/workspace-do/vitest.config.ts`: that package
 * uses Vitest v4 multi-project mode to split a workerd project from a node
 * subprocess project (the STO-10 lint self-test needs
 * `node:child_process.spawnSync`, which workerd does not implement). Phase 3
 * has no equivalent subprocess test; ALL Phase 3 tests run in workerd. The
 * `projects: [...]` wrapper is therefore intentionally absent here.
 *
 * `cloudflareTest()` returns a `Vite.Plugin` and is placed at the top-level
 * `plugins` array of the Vite config (NOT inside `test:`). In workspace-do's
 * multi-project setup it sits at the project level, which is structurally
 * equivalent because each project is itself a Vite config.
 *
 * The workerd pool resolves both `MCP_OBJECT` (→ `EngramMcp`) and `WORKSPACE`
 * (→ `WorkspaceDO`) DO bindings from `wrangler.test.jsonc`, not the
 * production `wrangler.jsonc`. The `.test.jsonc` suffix excludes the file
 * from the FND-08 lint glob (`packages/* /wrangler.jsonc`, literal filename)
 * by design.
 *
 * @module @engram/mcp-server/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
