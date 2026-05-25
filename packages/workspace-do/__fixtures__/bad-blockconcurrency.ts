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

// `DurableObject<unknown>` keeps the fixture from depending on the generated
// `Cloudflare.Env` type — this fixture file isn't expected to compile against
// a real wrangler config, it only exercises the STO-10 lint script's regex
// against the bad pattern. PATTERNS.md §12 calls for `env: unknown` and the
// `<unknown>` generic carries that intent through to the base class.
export class BadDO extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      // VIOLATION: env.* + await is forbidden inside the bootstrap block.
      // The STO-10 lint script must extract the blockConcurrencyWhile block
      // body and flag the `env.` access + the `await` together.
      await (env as { AI: { run: (m: string) => Promise<unknown> } }).AI.run(
        "@cf/baai/bge-base-en-v1.5",
      );
    });
  }
}
