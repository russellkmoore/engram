/**
 * Vitest pool configuration for @engram/workspace-do.
 *
 * Runs all tests under packages/workspace-do/src/__tests__/ inside the real
 * Cloudflare workerd runtime via @cloudflare/vitest-pool-workers, NOT a
 * Node/jsdom emulation. This matters because:
 *
 * - SQLite semantics (`storage.sql.exec(...)`, `.one()`, `.toArray()`) come
 *   from workerd directly — no shim. Tests catch real cursor/binding bugs.
 * - `blockConcurrencyWhile` actually blocks delivery during the test, so the
 *   STO-09 hibernation-replay test exercises the real cold-start path.
 * - `runInDurableObject(stub, (instance, state) => ...)` from "cloudflare:test"
 *   exposes the live DO instance and storage — the only way to satisfy STO-08
 *   without mocking.
 *
 * The pool resolves the WORKSPACE DO binding from `wrangler.test.jsonc` (NOT
 * the production wrangler.jsonc, which the FND-08 lint scans). Per PATTERNS.md
 * §10, the test config exists outside the FND-08 lint glob
 * (`packages/*\/wrangler.jsonc` literal — not `*.jsonc`).
 *
 * Use `defineProject` (NOT `defineConfig`) — it is the workspace-friendly
 * variant per the Cloudflare-maintained
 * fixtures/vitest-pool-workers-examples/durable-objects/ reference.
 *
 * @module @engram/workspace-do/vitest.config
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
});
