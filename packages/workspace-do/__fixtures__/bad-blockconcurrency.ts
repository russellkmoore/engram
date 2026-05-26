// packages/workspace-do/__fixtures__/bad-blockconcurrency.ts
//
// NEGATIVE lint fixture — calls `await env.AI.run(...)` inside a
// blockConcurrencyWhile block. This is the exact regression STO-10 prevents:
// any I/O inside the constructor's blockConcurrencyWhile bootstrap block
// blocks ALL request delivery and may trigger a 30-second worker eviction
// under load (Cloudflare Durable Objects best-practice — Pitfall: bootstrap
// I/O cliff).
//
// The STO-10 lint script (scripts/lint-blockconcurrency.mjs — landing in Plan
// 02-06) MUST exit 1 against this file. The CI workflow asserts this via a
// dedicated negative-fixture step that mirrors the FND-08 pattern; the
// blockconcurrency-lint.test.ts self-test asserts it via subprocess spawn.
//
// This file lives in `packages/workspace-do/__fixtures__/` (OUTSIDE `src/`)
// per PATTERNS.md §17 drift mitigation. The production STO-10 lint glob is
// `packages/workspace-do/src/**\/*.ts` — if this fixture lived under `src/`
// it would self-match the production scan and break every CI run with a
// false positive.
import { DurableObject } from "cloudflare:workers";

// Local environment type with the AI binding shape needed for the violation.
// Defined inline so the fixture is self-contained — it doesn't depend on the
// generated `Cloudflare.Env` type (PATTERNS.md §12 alignment). The parameter
// name `env` is preserved so the violation site reads as plain `env.AI.run(...)`
// and the STO-10 lint matches the literal `env.` token from D-10.
interface BadEnv {
  AI: { run: (m: string) => Promise<unknown> };
}

export class BadDO extends DurableObject<BadEnv> {
  constructor(ctx: DurableObjectState, env: BadEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      // VIOLATION: env.* + await is forbidden inside the bootstrap block.
      // The STO-10 lint script must extract the blockConcurrencyWhile block
      // body and flag the `env.` access + the `await` together.
      await env.AI.run("@cf/baai/bge-base-en-v1.5");
    });
  }
}
