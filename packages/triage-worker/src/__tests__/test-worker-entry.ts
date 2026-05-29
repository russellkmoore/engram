/**
 * TEST-ONLY entry for the triage-worker test pool.
 *
 * This file is the `main` referenced by `packages/triage-worker/wrangler.test.jsonc`.
 * It is NOT used by `wrangler dev` or `wrangler deploy` (those use `src/index.ts`).
 *
 * Why a separate test entry:
 * - The integration tests in `queue-integration.test.ts` need a REAL `WORKSPACE`
 *   Durable Object binding so `runInDurableObject(...)` can assert against actual
 *   SQLite state. The production triage-worker uses a CROSS-WORKER DO binding
 *   (`script_name = "engram-mcp-server"`); miniflare cannot resolve cross-Worker
 *   `script_name` references — it has no external Worker registry.
 * - The workaround is to expose `WorkspaceDO` as a SAME-Worker class in the test
 *   pool. That requires the class to be exported from the entry file the test
 *   pool bundles (otherwise wrangler/miniflare cannot find the class to mount).
 * - Re-exporting `WorkspaceDO` from `src/index.ts` (the production entry) would
 *   force a class to be present in the production bundle that the production
 *   wrangler.jsonc does NOT declare a binding for — `wrangler deploy` would
 *   fail with "exported Durable Object class has no binding".
 * - Keeping the re-export in a test-only entry preserves the production bundle
 *   shape while giving the test pool a same-Worker DO it can mount.
 *
 * The default-exported `handler` is re-exported verbatim so direct calls to
 * `import handler from "../index.js"` in the test files continue to work (the
 * test files use the source path, not the wrangler entry).
 *
 * @module @engram/triage-worker/__tests__/test-worker-entry
 */
export { WorkspaceDO } from "@engram/workspace-do";
export { default } from "../index.js";
