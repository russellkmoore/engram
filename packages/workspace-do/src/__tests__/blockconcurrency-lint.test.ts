/**
 * STO-10 self-test — sanity-check `scripts/lint-blockconcurrency.mjs` via
 * subprocess invocation against the good/bad fixtures.
 *
 * These tests subprocess the actual Node script (NOT an in-process
 * equivalent), proving the exit-code contract that CI relies on. The Node
 * pool is required because `node:child_process.spawnSync` is **not
 * implemented** in workerd (unenv stubs it as `notImplemented`); see
 * `vitest.config.ts` for the multi-project config that routes this single
 * file to the default Node pool while keeping every other test under
 * `src/__tests__/` in the workerd pool.
 *
 * Fixtures live at `packages/workspace-do/__fixtures__/{bad,good}-blockconcurrency.ts`
 * (NOT under `src/__tests__/fixtures/`) per PATTERNS.md §17 drift mitigation.
 * If the fixtures lived under `src/__tests__/fixtures/`, the STO-10 lint glob
 * (`packages/workspace-do/src/**\/*.ts`) would self-match the bad fixture and
 * fail every CI run with a false positive.
 *
 * Open Question O4 (deferred): the exit-code-2 no-arg canary test is hard to
 * exercise cleanly from inside vitest (it requires a temp-directory shim to
 * relocate `packages/`). The CI workflow (Plan 02-08) exercises the full-scan
 * no-arg path naturally — a broken canary would surface there. The
 * `it.skip` placeholder below documents the gap.
 *
 * @module @engram/workspace-do/__tests__/blockconcurrency-lint
 */
import { describe, it, expect } from "vitest";
// Minimal local typings for the Node built-ins used by this self-test. We
// deliberately do NOT depend on `@types/node` here — Phase 2 RESEARCH locks the
// dep budget to `@cloudflare/vitest-pool-workers` + `vitest` only, and the base
// tsconfig sets `types: ["@cloudflare/workers-types/experimental"]` which
// excludes node types globally. Rather than pull in a 5MB types package to
// describe three subprocess-spawning helpers, we ambient-declare just the
// surface this file needs. The shims live in `__node-shims.d.ts` alongside
// this file — see that file's header for the rationale. Runtime is Node:
// this file runs only under the `lint` vitest project's default Node pool,
// never workerd (see vitest.config.ts for the two-project routing).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Compute repo root from `import.meta.url`. This file lives at
// `packages/workspace-do/src/__tests__/blockconcurrency-lint.test.ts` — four
// directory levels below the repo root. Using a cwd-independent absolute path
// means the test passes whether vitest is run from the repo root, the
// workspace-do package, or anywhere else.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRIPT = resolve(REPO_ROOT, "scripts/lint-blockconcurrency.mjs");

describe("scripts/lint-blockconcurrency.mjs (STO-10 self-test)", () => {
  it("exits 0 on the good fixture (pure sync sql.exec inside the block)", () => {
    const r = spawnSync(
      "node",
      [SCRIPT, "packages/workspace-do/__fixtures__/good-blockconcurrency.ts"],
      { cwd: REPO_ROOT },
    );
    if (r.status !== 0) {
      // Surface stdout/stderr in vitest's failure output so the cause is
      // obvious without re-running manually.
      console.log("[lint subprocess stdout]\n", r.stdout?.toString() ?? "(none)");
      console.log("[lint subprocess stderr]\n", r.stderr?.toString() ?? "(none)");
    }
    expect(r.status).toBe(0);
  });

  it("exits 1 on the bad fixture (await env.AI.run inside the block)", () => {
    const r = spawnSync(
      "node",
      [SCRIPT, "packages/workspace-do/__fixtures__/bad-blockconcurrency.ts"],
      { cwd: REPO_ROOT },
    );
    if (r.status !== 1) {
      console.log("[lint subprocess stdout]\n", r.stdout?.toString() ?? "(none)");
      console.log("[lint subprocess stderr]\n", r.stderr?.toString() ?? "(none)");
    }
    expect(r.status).toBe(1);
    // The stderr should mention the forbidden token — sanity-check the
    // diagnostic shape so a future refactor that silently drops the violation
    // detail surfaces here too.
    const stderr = r.stderr?.toString() ?? "";
    expect(stderr).toMatch(/forbidden token 'env\.'/);
  });

  it("exits 0 on the production WorkspaceDO source (real constructor body)", () => {
    // Proves the production constructor in packages/workspace-do/src/index.ts
    // passes the STO-10 lint. As Phase 2 fills the constructor (Plan 02-04),
    // this test guards against regression — any forbidden token sneaking
    // into the blockConcurrencyWhile body fails this test.
    const r = spawnSync("node", [SCRIPT, "packages/workspace-do/src/index.ts"], {
      cwd: REPO_ROOT,
    });
    if (r.status !== 0) {
      console.log("[lint subprocess stdout]\n", r.stdout?.toString() ?? "(none)");
      console.log("[lint subprocess stderr]\n", r.stderr?.toString() ?? "(none)");
    }
    expect(r.status).toBe(0);
  });

  // Open Question O4: exit-code-2 no-arg canary test is deferred to the CI
  // workflow's negative-fixture step in Plan 02-08. From inside vitest,
  // simulating an empty glob requires a temp-directory shim that adds
  // complexity for marginal value — CI exercises the canary path via the
  // full no-arg run when packages/workspace-do/src/ contains files (the
  // negative direction is implicit).
  it.skip("exits 2 in no-arg mode when the glob matches nothing — deferred to CI (Plan 02-08)", () => {
    expect.fail("deferred — CI exercises the no-arg canary path");
  });
});
