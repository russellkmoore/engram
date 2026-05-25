// packages/workspace-do/__fixtures__/good-blockconcurrency.ts
//
// POSITIVE lint fixture — pure synchronous storage.sql.exec(...) inside the
// blockConcurrencyWhile bootstrap block, no I/O, no env.* access, no
// dynamic imports. This is the only shape STO-10 permits inside the block:
// synchronous DDL/seed work that establishes the per-DO SQLite schema before
// any request reaches a handler.
//
// The STO-10 lint script (scripts/lint-blockconcurrency.mjs — landing in Plan
// 02-06) MUST exit 0 against this file. The CI workflow asserts this via a
// dedicated positive-fixture step that mirrors the FND-08 pattern; the
// blockconcurrency-lint.test.ts self-test asserts it via subprocess spawn.
//
// This file lives in `packages/workspace-do/__fixtures__/` (OUTSIDE `src/`)
// per PATTERNS.md §17 drift mitigation — see bad-blockconcurrency.ts header
// for the full rationale.
import { DurableObject } from "cloudflare:workers";

// `DurableObject<unknown>` keeps the fixture from depending on the generated
// `Cloudflare.Env` type — see bad-blockconcurrency.ts header for the full
// rationale.
export class GoodDO extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    /* eslint-disable @typescript-eslint/require-await -- The whole POINT of
       this fixture is that the async callback has NO await — pure synchronous
       sql.exec inside blockConcurrencyWhile is the allowed shape per STO-10.
       The disable spans only this constructor block. */
    void ctx.blockConcurrencyWhile(async () => {
      // ALLOWED: synchronous storage.sql.exec() establishes the schema before
      // request delivery. No `await`, no `env.`, no `fetch(`, no
      // `await import(`. The STO-10 lint must not flag this body.
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS noop (id TEXT PRIMARY KEY)");
    });
    /* eslint-enable @typescript-eslint/require-await */
  }
}
