/**
 * Cross-file model-constant identity test (AI-SPEC.md §5 dimension #2).
 *
 * Asserts that `triage-worker/src/ai-helper.ts` contains BYTE-IDENTICAL model
 * constant literals to `mcp-server/src/ai-helper.ts`. This is the AI-SPEC.md
 * §5 dimension #2 identity-check gate — if the two files drift, embedding/query
 * model mismatch silently destroys recall quality (Critical Failure Mode #2).
 *
 * Runs in the **lint-node pool** (not workerd) because it uses `node:fs`
 * `readFileSync` to read the sibling package source file. The workerd runtime
 * does not implement the `readAll` syscall needed for cross-package reads.
 *
 * The workerd-pool `ai-helper.test.ts` marks this case as `it.skip` and
 * defers to this file.
 *
 * @module @engram/mcp-server/__tests__/ai-helper-identity
 */
// Runs in the lint-node pool (Vitest Node pool, not workerd) — node:fs is well-typed
// there. A prior `eslint-disable` covering @typescript-eslint/no-unsafe-* was removed
// after PR #1's workers-types migration narrowed the type graph enough that the rules
// no longer fire.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const __dirname = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

// Read this package's ai-helper.ts to extract the locked constants.
const mcpAiHelperRaw = readFileSync(resolve(__dirname, "../ai-helper.ts"), "utf8");

// Read the sibling triage-worker ai-helper.ts.
// Path: packages/mcp-server/src/__tests__/ → ../../../../ = worktree root
//       then packages/triage-worker/src/ai-helper.ts
const triageAiHelperRaw = readFileSync(
  resolve(__dirname, "../../../../packages/triage-worker/src/ai-helper.ts"),
  "utf8",
);

// Extract the constant values from the mcp-server file to assert identity.
const embeddingModelMatch = /EMBEDDING_MODEL = "([^"]+)" as const/.exec(mcpAiHelperRaw);
const embeddingVersionMatch = /EMBEDDING_VERSION = (\d+) as const/.exec(mcpAiHelperRaw);
const classifierModelMatch = /CLASSIFIER_MODEL = "([^"]+)" as const/.exec(mcpAiHelperRaw);

const EMBEDDING_MODEL = embeddingModelMatch?.[1] ?? "";
const EMBEDDING_VERSION = embeddingVersionMatch?.[1] ?? "";
const CLASSIFIER_MODEL = classifierModelMatch?.[1] ?? "";

describe("AI-SPEC.md §5 dimension #2: model identity across mcp-server and triage-worker", () => {
  it("mcp-server ai-helper.ts exports EMBEDDING_MODEL constant (prerequisite check)", () => {
    // Verify we successfully extracted the value from mcp-server — if this fails,
    // the mcp-server file may have been refactored to break the regex.
    expect(EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
  });

  it("EMBEDDING_MODEL string literal matches between mcp-server and triage-worker ai-helper", () => {
    expect(triageAiHelperRaw).toContain(`EMBEDDING_MODEL = "${EMBEDDING_MODEL}" as const`);
  });

  it("EMBEDDING_VERSION numeric literal matches between mcp-server and triage-worker ai-helper", () => {
    expect(triageAiHelperRaw).toContain(`EMBEDDING_VERSION = ${EMBEDDING_VERSION} as const`);
  });

  it("CLASSIFIER_MODEL string literal matches between mcp-server and triage-worker ai-helper", () => {
    expect(triageAiHelperRaw).toContain(`CLASSIFIER_MODEL = "${CLASSIFIER_MODEL}" as const`);
  });
});
