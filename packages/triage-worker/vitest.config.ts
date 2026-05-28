/**
 * Vitest pool configuration for @engram/triage-worker.
 *
 * Single workerd project — every test under `src/__tests__/` runs inside the
 * real Cloudflare workerd runtime via `@cloudflare/vitest-pool-workers`.
 *
 * Mirrors `packages/mcp-server/vitest.config.ts` exactly (single workerd
 * project, no multi-project split — triage-worker has no subprocess tests
 * that would require a node project). The `cloudflareTest()` plugin is placed
 * at the top-level `plugins` array of the Vite config per the workerd pool
 * convention. The pool resolves AI, VECTORIZE, and WORKSPACE DO bindings from
 * `wrangler.test.jsonc`, not the production `wrangler.jsonc`. The `.test.jsonc`
 * suffix excludes the file from the FND-08 lint glob.
 *
 * @module @engram/triage-worker/vitest.config
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
