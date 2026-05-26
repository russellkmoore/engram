/**
 * Vitest pool configuration for @engram/workspace-do.
 *
 * This package mixes two flavors of test:
 *
 * 1. **workerd-pool tests** — every file under `src/__tests__/` that exercises
 *    the live `WorkspaceDO` instance. They run inside the real Cloudflare
 *    workerd runtime via `@cloudflare/vitest-pool-workers`, NOT a Node/jsdom
 *    emulation. This matters because:
 *      - SQLite semantics (`storage.sql.exec(...)`, `.one()`, `.toArray()`)
 *        come from workerd directly — no shim. Tests catch real cursor/binding
 *        bugs.
 *      - `blockConcurrencyWhile` actually blocks delivery during the test, so
 *        the STO-09 hibernation-replay test exercises the real cold-start path.
 *      - `runInDurableObject(stub, (instance, state) => ...)` from
 *        "cloudflare:test" exposes the live DO instance and storage — the only
 *        way to satisfy STO-08 without mocking.
 *
 * 2. **node-pool tests** — the STO-10 lint self-test
 *    (`blockconcurrency-lint.test.ts`). This test must call
 *    `node:child_process.spawnSync` to invoke `scripts/lint-blockconcurrency.mjs`
 *    in a subprocess and assert the script's exit-code contract. `spawnSync`
 *    is **not implemented** in workerd (unenv stubs it to a thrown
 *    `notImplemented` error — verified locally at
 *    `node_modules/unenv/dist/runtime/node/child_process.mjs`), so this single
 *    test file must run under Vitest's default Node pool, NOT the workerd
 *    pool.
 *
 * The split is implemented via `projects` (Vitest v4 multi-project mode). The
 * `lint` project includes ONLY the lint self-test and has no `cloudflareTest`
 * plugin; the `workerd` project includes every other test file and uses
 * `cloudflareTest` against `wrangler.test.jsonc`.
 *
 * The workerd pool resolves the WORKSPACE DO binding from `wrangler.test.jsonc`
 * (NOT the production wrangler.jsonc, which the FND-08 lint scans). Per
 * PATTERNS.md §10, the test config exists outside the FND-08 lint glob
 * (`packages/*\/wrangler.jsonc` literal — not `*.jsonc`).
 *
 * @module @engram/workspace-do/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Workerd-pool project: every test file under src/__tests__/ EXCEPT
        // the STO-10 lint subprocess self-test. Runs inside workerd via the
        // cloudflareTest plugin against wrangler.test.jsonc.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
          }),
        ],
        test: {
          name: "workerd",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["src/__tests__/blockconcurrency-lint.test.ts"],
        },
      },
      {
        // Node-pool project: ONLY the STO-10 lint subprocess self-test.
        // Default Vitest pool (Node) — gives us node:child_process.spawnSync
        // which is required to subprocess the lint script and assert its
        // exit codes. The cloudflareTest plugin is intentionally NOT loaded
        // for this project.
        test: {
          name: "lint",
          include: ["src/__tests__/blockconcurrency-lint.test.ts"],
        },
      },
    ],
  },
});
