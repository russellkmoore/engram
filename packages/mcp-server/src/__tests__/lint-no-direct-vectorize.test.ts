/**
 * AI-02 lint gate: no direct `env.VECTORIZE.*` access outside vectorize-helper.ts.
 *
 * Defense-in-depth enforcement (T-05-02-CWVL mitigation from Plan 05-02). The
 * vectorize-helper.ts module is the ONLY sanctioned entry point for Vectorize
 * calls inside packages/mcp-server. This grep gate catches any future contributor
 * who adds a direct `env.VECTORIZE.query()` / `.upsert()` / `.deleteByIds()` call
 * in production source, ensuring the mandatory `workspaceId` positional argument
 * (AI-02 compile-time defense) cannot be bypassed.
 *
 * Design notes:
 * - Pure-unit test: reads source files from disk. No env binding needed.
 * - Runs on every PR in CI — does not require Cloudflare credentials.
 * - Comment-stripping is mandatory per the planner CRITICAL RULES: grep gates
 *   on unfiltered files are forbidden because a comment referencing the pattern
 *   (e.g., JSDoc examples or threat model references) would produce a false positive.
 * - Excludes `vectorize-helper.ts` itself (it is the authorised call site).
 * - Excludes `__tests__/` directory (test mocks may reference the pattern).
 *
 * @module @engram/mcp-server/__tests__/lint-no-direct-vectorize
 */
// packages/mcp-server/src/__tests__/lint-no-direct-vectorize.test.ts
// Source: 05-03-PLAN.md Task 4 + 05-PATTERNS.md §lint-gate
//
// Runs in the lint-node pool (Vitest Node pool, not workerd) — node:fs is well-typed
// there. A prior `eslint-disable` covering @typescript-eslint/no-unsafe-* was removed
// after PR #1's workers-types migration narrowed the type graph enough that the rules
// no longer fire.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// SRC_ROOT resolves to packages/mcp-server/src/ (the parent of __tests__).
const SRC_ROOT = resolve(import.meta.dirname, "..");
const HELPER_FILE = resolve(SRC_ROOT, "vectorize-helper.ts");
const TEST_DIR = resolve(SRC_ROOT, "__tests__");

/**
 * Recursively walk `dir` and return all `.ts` files, excluding:
 * - The authorized call site (`vectorize-helper.ts`)
 * - The `__tests__/` directory (test mocks may reference the binding)
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Skip __tests__ — test files may mock or reference the binding.
      if (full === TEST_DIR) continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".ts") && full !== HELPER_FILE) {
      out.push(full);
    }
  }
  return out;
}

describe("AI-02 lint gate: no direct env.VECTORIZE.* outside vectorize-helper.ts", () => {
  it("no production source under packages/mcp-server/src/ (excluding vectorize-helper.ts + __tests__) calls env.VECTORIZE.{query|upsert|deleteByIds|insert|queryById|getByIds}", () => {
    const offenders: { file: string; matches: string[] }[] = [];

    for (const file of walk(SRC_ROOT)) {
      // Strip comments before grepping to avoid false positives from:
      //   - Single-line `//` comments (threat model refs, inline notes)
      //   - Block `/** */` and `/* */` comments (JSDoc examples, @param descriptions)
      // Two-pass approach:
      //   1. Remove block comments (non-greedy `[\s\S]*?`) before splitting by line.
      //   2. Remove single-line `//` comment lines after splitting.
      const raw = readFileSync(file, "utf8");
      // Pass 1: strip block comments (/** ... */ and /* ... */)
      const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      // Pass 2: strip single-line comment lines
      const content = noBlockComments
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");

      const matches = [
        ...content.matchAll(
          /env\.VECTORIZE\.(query|upsert|deleteByIds|insert|queryById|getByIds)/g,
        ),
      ];
      if (matches.length > 0) {
        offenders.push({ file, matches: matches.map((m) => m[0]) });
      }
    }

    // Report offenders with file paths and matched call sites for actionability.
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:\n    ${o.matches.join(", ")}`).join("\n");
      throw new Error(
        `Direct env.VECTORIZE.* calls found in production source — ` +
          `use vectorize-helper.ts instead (AI-02 defense-in-depth):\n${report}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
