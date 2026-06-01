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
    exclude: [
      // ENG-20 (CI): memorability-calibration needs remote-mode wrangler
      // bindings (real AI). cloudflare-vitest-pool tries to open a remote
      // proxy session at file-load time, which fails in CI because that path
      // requires interactive `wrangler login` OAuth — not satisfiable by
      // CLOUDFLARE_API_TOKEN alone. Tests inside are currently `it.skip`
      // (real-corpus fixtures haven't landed), so excluding the file loses
      // zero coverage. When ENG-20 closes (fixtures land + .skip removed),
      // re-include AND grow a separate CI surface that can run it — see the
      // mirror exclude in packages/mcp-server/vitest.config.ts for the
      // recommended pattern.
      "src/__tests__/evals/memorability-calibration.eval.test.ts",
      // ENG-16 (CI): conflict-precision is the v0.2 prep gate for per-write
      // conflict detection. Same remote-bindings + cost-gate constraints as
      // memorability-calibration — `it.skip` until Russell's 50 labeled
      // pairs land in fixtures/conflict-pairs.json, then re-include alongside
      // the dedicated nightly-eval CI surface.
      "src/__tests__/evals/conflict-precision.eval.test.ts",
    ],
  },
});
