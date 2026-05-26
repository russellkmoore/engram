/**
 * Ambient declaration augmenting the global `Cloudflare.Env` interface with
 * the WORKSPACE DurableObjectNamespace binding that `wrangler.test.jsonc`
 * exposes to tests at runtime.
 *
 * **Why this file exists:** `@cloudflare/workers-types/experimental` declares
 * `Cloudflare.Env` as an empty interface meant to be augmented by the
 * wrangler-generated `worker-configuration.d.ts`. Per-Worker packages like
 * `packages/mcp-server/` generate that file via `wrangler types`; the generated
 * file populates the bindings into `Cloudflare.Env` so `env.WORKSPACE` is typed.
 *
 * `packages/workspace-do/` is intentionally library-only (no `wrangler dev` or
 * `wrangler deploy` scripts — Phase 1 D-10). Its sole wrangler config is
 * `wrangler.test.jsonc` which exists ONLY to give the
 * `@cloudflare/vitest-pool-workers` plugin a DO binding to resolve at test
 * time. Generating a `worker-configuration.d.ts` from `wrangler.test.jsonc`
 * via `wrangler types` requires a `compatibility_date` in the config, but
 * the design intent (`wrangler.test.jsonc` header comment) is to OMIT
 * `compatibility_date` so the test pool always picks up the latest workerd —
 * adding one would freeze the test runtime to a specific date that may drift
 * from production.
 *
 * **The minimal-augmentation approach** declares the single binding the test
 * pool exposes (WORKSPACE → DurableObjectNamespace<WorkspaceDO>) so test
 * files can use `env.WORKSPACE.idFromName(...)` with the correct types. The
 * shape mirrors what `wrangler types` would have generated against the
 * test config — same `__BaseEnv_Env`-style augmentation, but hand-written
 * because the codegen requires a config detail the design forbids.
 *
 * Scope: this file lives in `src/__tests__/` so it ONLY augments the type
 * surface seen by test files, not by production code under `src/`. The
 * `WorkspaceDO` class itself uses `env: unknown` for its constructor and
 * never touches `Cloudflare.Env` — this augmentation is for the test
 * infrastructure's `import { env } from "cloudflare:workers"` consumers.
 *
 * @see packages/workspace-do/wrangler.test.jsonc — the runtime binding source
 * @see packages/mcp-server/worker-configuration.d.ts — the codegen analog for
 *      a "real" Worker package
 */
import type { WorkspaceDO } from "../index.js";

declare global {
  // The augmentation pattern mirrors mcp-server's generated worker-configuration.d.ts:
  // a base interface holds the bindings and `Cloudflare.Env extends` it. We do not
  // re-export the type — global augmentation needs no export to take effect.
  interface __WorkspaceDoTestEnv {
    WORKSPACE: DurableObjectNamespace<WorkspaceDO>;
  }
  namespace Cloudflare {
    // Augments the empty `Cloudflare.Env` from
    // @cloudflare/workers-types/experimental (~line 14287) so the test-pool's
    // `import { env } from "cloudflare:workers"` returns a typed env with
    // the WORKSPACE binding present.
    //
    // The empty-supertype-extension is required here: this is the documented
    // wrangler-types augmentation pattern (see mcp-server's generated
    // worker-configuration.d.ts at the top of the file — exact same shape).
    // The eslint rule fires a false positive on this pattern; disabling it
    // narrowly is the canonical resolution.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Augmentation pattern; mirrors wrangler-generated worker-configuration.d.ts.
    interface Env extends __WorkspaceDoTestEnv {}
  }
}

export {};
