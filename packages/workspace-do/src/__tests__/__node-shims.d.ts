/**
 * Ambient Node built-in type shims, scoped to `src/__tests__/`.
 *
 * **Why this file exists:** the STO-10 self-test
 * (`blockconcurrency-lint.test.ts`) must call `node:child_process.spawnSync`
 * to subprocess `scripts/lint-blockconcurrency.mjs` and assert exit codes.
 * That test runs under the `lint` vitest project's default Node pool — never
 * workerd (see `vitest.config.ts`). But the workspace tsconfig sets
 * `types: ["@cloudflare/workers-types/experimental"]`, which deliberately
 * excludes `@types/node` so production code can't accidentally reach for Node
 * APIs that workerd doesn't ship.
 *
 * **Why not add `@types/node`:** Phase 2 RESEARCH §"Standard Stack" pins the
 * dep budget at `@cloudflare/vitest-pool-workers` + `vitest` only — no other
 * additions. Adding a ~5MB types package solely to describe three subprocess
 * helpers would (a) burn the budget on essentially zero value and (b) expose
 * node-only types to every workerd test file (raising the risk that someone
 * accidentally writes a test calling `fs.readFileSync` and gets a green
 * typecheck even though it would crash inside workerd).
 *
 * **The minimal-shim approach** keeps node types out of the global namespace
 * but lets the one test file that genuinely needs them type-check cleanly.
 * `import.meta.url` is ambiently added to the `ImportMeta` interface — vitest
 * provides it at runtime; the workers-types lib doesn't.
 *
 * If a second Node-pool test file ever lands and needs broader node types,
 * revisit this trade-off: at that point installing `@types/node` (scoped to
 * the `lint` vitest project via a per-project tsconfig) becomes the cleaner
 * answer.
 *
 * @see vitest.config.ts — multi-project routing (workerd vs lint pools)
 * @see Phase 2 RESEARCH §Standard Stack — dep budget rationale
 */

declare module "node:child_process" {
  export interface SpawnSyncReturns {
    status: number | null;
    stdout: { toString(): string } | null;
    stderr: { toString(): string } | null;
  }
  export function spawnSync(
    command: string,
    args?: readonly string[],
    options?: { cwd?: string },
  ): SpawnSyncReturns;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:path" {
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
}

interface ImportMeta {
  readonly url: string;
}
