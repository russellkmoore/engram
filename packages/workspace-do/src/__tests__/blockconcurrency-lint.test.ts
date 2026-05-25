/**
 * STO-10 self-test stubs — sanity-check `scripts/lint-blockconcurrency.mjs`
 * via subprocess invocation against the good/bad fixtures.
 *
 * RED scaffold for Plan 02-06 (lint script). The two fixture-driven cases
 * verify the script itself (NOT just an in-process equivalent) — proves the
 * exit-code contract that CI relies on.
 *
 * Fixtures live at `packages/workspace-do/__fixtures__/{bad,good}-blockconcurrency.ts`
 * (NOT under `src/__tests__/fixtures/`) — see PATTERNS.md §17 drift mitigation.
 * If the fixtures lived under `src/__tests__/fixtures/`, the STO-10 lint glob
 * (`packages/workspace-do/src/**\/*.ts`) would self-match the bad fixture and
 * fail every CI run with a false positive.
 *
 * The third case (exit-code 2 no-arg canary) is left as a TODO — it requires
 * a temp-directory shim that's harder than the value it provides; the CI
 * workflow exercises the full-scan glob naturally, so it would surface there
 * if the canary ever broke.
 *
 * @module @engram/workspace-do/__tests__/blockconcurrency-lint
 */
import { describe, it, expect } from "vitest";

// Wave-0 NOTE: implementation imports resolved in Plan 02-06.
//   import { spawnSync } from "node:child_process";
//
//   const SCRIPT = "scripts/lint-blockconcurrency.mjs";

describe("scripts/lint-blockconcurrency.mjs self-test (STO-10)", () => {
  it.skip("exits 0 on the good fixture (STO-10 — Plan 02-06)", () => {
    // const r = spawnSync("node", [
    //   SCRIPT,
    //   "packages/workspace-do/__fixtures__/good-blockconcurrency.ts",
    // ]);
    // expect(r.status).toBe(0);
    expect.fail("not yet implemented — Plan 02-06");
  });

  it.skip("exits 1 on the bad fixture (STO-10 — Plan 02-06)", () => {
    // const r = spawnSync("node", [
    //   SCRIPT,
    //   "packages/workspace-do/__fixtures__/bad-blockconcurrency.ts",
    // ]);
    // expect(r.status).toBe(1);
    expect.fail("not yet implemented — Plan 02-06");
  });

  it.skip("exits 2 in no-arg mode when the glob matches nothing — deferred to CI", () => {
    // The exit-code-2 canary is hard to exercise cleanly inside vitest-pool-workers
    // (the subprocess cwd may not be the repo root, and we'd need a temp-directory
    // shim to relocate `packages/`). The CI workflow naturally exercises the
    // no-arg full-scan and would surface a broken canary there.
    //
    // Left as a documented gap. Plan 02-06 may delete this `it.skip` if CI
    // coverage is deemed sufficient.
    expect.fail("deferred — CI exercises the no-arg canary path");
  });
});
