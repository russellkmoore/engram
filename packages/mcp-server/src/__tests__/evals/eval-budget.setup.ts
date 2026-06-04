/**
 * Eval-budget setup file — MAX_AI_CALLS=200 cost ceiling (PRE-02).
 *
 * PURPOSE
 * -------
 * This file is loaded via `setupFiles` in the `eval` vitest project. It wraps
 * `env.AI.run` and `env.VECTORIZE.query` with a shared counter that THROWS
 * (not skips) when the call count exceeds MAX_AI_CALLS. This is the primary
 * defense against runaway eval suites billing neurons indefinitely.
 *
 * CONTRACT — DO NOT CHANGE THESE RULES
 * -------------------------------------
 * (a) MAX_AI_CALLS = 200 is a LITERAL constant in source. Do NOT make it
 *     env-configurable. A future env-var-readable override would defeat
 *     the contract — anyone could bump it silently in CI. The number 200 must
 *     appear in source so the grep in PRE-02's acceptance criteria catches it.
 *     (RESEARCH §Anti-Patterns: "Inflating MAX_AI_CALLS when tests fail".)
 *
 * (b) Counter discipline depends on the vitest project config:
 *       isolate: false   — prevents per-file counter reset
 *       maxWorkers: 1    — keeps the module in one process (Pitfall 3)
 *     These flags live in packages/mcp-server/vitest.config.ts eval project.
 *     Do NOT remove them.
 *
 * (c) The `afterAll` Workers Analytics Engine write is defense-in-depth. If the
 *     in-process counter is somehow bypassed (e.g., test directly calls the
 *     underlying binding without going through the spy), the post-run Analytics
 *     Engine aggregate caught by `scripts/eval-budget-summary.mjs` provides a
 *     ground-truth check.
 *
 * USAGE
 * -----
 * This file is shared between mcp-server and triage-worker eval projects.
 * triage-worker's vitest.config.ts references it via relative path:
 *   ../mcp-server/src/__tests__/evals/eval-budget.setup.ts
 *
 * @module eval-budget.setup
 * @requirement PRE-02
 */
import { beforeAll, afterAll, vi } from "vitest";
import { env } from "cloudflare:workers";

// ──────────────────────────────────────────────────────────────────────────────
// Budget constants — DO NOT make env-configurable (see CONTRACT above)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_AI_CALLS = 200;
let aiCallCount = 0;

// ──────────────────────────────────────────────────────────────────────────────
// Exported state accessor — allows unit tests to introspect counter value
// ──────────────────────────────────────────────────────────────────────────────

export const evalBudgetState = {
  get aiCallCount(): number {
    return aiCallCount;
  },
  get MAX_AI_CALLS(): number {
    return MAX_AI_CALLS;
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Budget guard — beforeAll wraps env.AI.run + env.VECTORIZE.query
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the budget-exceeded error message.
 * Using String() instead of template literal to satisfy restrict-template-expressions.
 */
function budgetExceededMsg(callNum: number): string {
  return (
    "[eval-budget] MAX_AI_CALLS exceeded (" +
    String(MAX_AI_CALLS) +
    ") — call " +
    String(callNum) +
    " was rejected. Tighten the eval; do NOT raise the cap. " +
    "(PRE-02 v0.2 contract — run: " +
    (process.env.GITHUB_RUN_ID ?? "local") +
    ")"
  );
}

beforeAll(() => {
  // Wrap env.AI.run — increment counter before delegating to real binding
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realAiRun = env.AI.run.bind(env.AI) as (...a: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(env.AI, "run").mockImplementation(async (...args: any[]) => {
    aiCallCount++;
    if (aiCallCount > MAX_AI_CALLS) {
      throw new Error(budgetExceededMsg(aiCallCount));
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return
    return realAiRun(...args);
  });

  // Wrap env.VECTORIZE.query — increment the SAME shared counter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realVecQuery = env.VECTORIZE.query.bind(env.VECTORIZE) as (...a: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(env.VECTORIZE, "query").mockImplementation(async (...args: any[]) => {
    aiCallCount++;
    if (aiCallCount > MAX_AI_CALLS) {
      throw new Error(budgetExceededMsg(aiCallCount));
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return
    return realVecQuery(...args);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Post-run Analytics Engine write — defense-in-depth aggregate (see CONTRACT c)
// ──────────────────────────────────────────────────────────────────────────────

afterAll(() => {
  // Restore spies so subsequent test teardown doesn't see wrapped bindings
  vi.restoreAllMocks();

  // Write the final call count to the Workers Analytics Engine dataset if
  // the EVAL_BUDGET_AE binding is available (CI only — non-CI runs skip
  // silently). This provides a ground-truth post-run aggregate that
  // `scripts/eval-budget-summary.mjs` reads via the GraphQL Analytics API.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const ae = (env as any).EVAL_BUDGET_AE as AnalyticsEngineDataset | undefined;
  if (ae?.writeDataPoint) {
    try {
      ae.writeDataPoint({
        blobs: ["eval-budget"],
        doubles: [aiCallCount],
        indexes: [process.env.GITHUB_RUN_ID ?? "local"],
      });
    } catch {
      // Non-fatal: in-process counter is the primary gate; AE write is
      // defense-in-depth. A transient AE write failure should not fail the test.
    }
  }
});
