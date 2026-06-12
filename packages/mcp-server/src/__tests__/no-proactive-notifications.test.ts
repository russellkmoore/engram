/**
 * CON-08 lint gate: no proactive notification primitives anywhere in mcp-server source.
 *
 * Defense-in-depth enforcement (T-02-08-03 mitigation from Plan 02-08). The
 * Engram v0.2 architectural invariant (CON-08) is: conflicts are PULL-ONLY /
 * PASSIVE — they surface in the recall envelope only because the caller asked.
 * NEVER pushed, alerted, or sent proactively.
 *
 * This grep gate catches any future contributor who introduces an email,
 * webhook, push-notification, or similar proactive delivery primitive in
 * production source, ensuring the CON-08 invariant cannot be violated by
 * accident across refactors.
 *
 * Mirrors `lint-no-direct-vectorize.test.ts` byte-for-byte where possible
 * (same walk + readFileSync + comment-strip + assert pattern per PATTERNS.md
 * §"Cross-cutting (optional grep gates)").
 *
 * Design notes:
 * - Pure-unit test: reads source files from disk. No env binding needed.
 * - Runs on every PR in CI — does not require Cloudflare credentials.
 * - Comment-stripping is mandatory: a comment referencing the pattern
 *   (e.g., JSDoc references to "WEBHOOK" in threat model docs or
 *   CON-08 architectural notes) must NOT trigger a false positive.
 * - Excludes `__tests__/` directory: test files may reference forbidden
 *   tokens in documentation comments explaining what NOT to do (e.g., this
 *   test's own JSDoc, or recall-conflicts.test.ts's CON-08 explanation).
 *
 * @module @engram/mcp-server/__tests__/no-proactive-notifications
 */
// packages/mcp-server/src/__tests__/no-proactive-notifications.test.ts
// Source: 02-08-PLAN.md Task 3 + lint-no-direct-vectorize.test.ts (CANONICAL ANALOG)
//
// Runs in the lint-node pool (Vitest Node pool, not workerd) — node:fs is
// well-typed there. Mirrors the lint-no-direct-vectorize.test.ts pool choice.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// SRC_ROOT resolves to packages/mcp-server/src/ (the parent of __tests__).
const SRC_ROOT = resolve(import.meta.dirname, "..");
const TEST_DIR = resolve(SRC_ROOT, "__tests__");

/**
 * Recursively walk `dir` and return all `.ts` files, excluding:
 * - The `__tests__/` directory (test files may reference the tokens in
 *   documentation comments explaining what NOT to do — e.g., the
 *   no-proactive-notifications.test.ts JSDoc itself, or recall-conflicts.test.ts)
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Skip __tests__ — test files may document forbidden patterns as examples.
      if (full === TEST_DIR) continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * CON-08 forbidden notification primitives (case-insensitive match).
 *
 * These patterns are banned in production mcp-server source. Any occurrence
 * outside comments indicates a proactive notification primitive was introduced,
 * violating the CON-08 pull-only invariant (ENG-16 ship-as-suggestions verdict).
 *
 * Pattern rationale:
 * - `EMAIL` / `MAILGUN` / `SENDGRID` — outbound email delivery
 * - `WEBHOOK` — push-to-external-endpoint
 * - `PUSH_NOTIFICATION` — device push
 * - `NOTIFY_USER` — named proactive-notification function pattern
 * - `SLACK` — direct Slack message (connector is ingest-only in v0.4, not send)
 * - `TWILIO` — SMS delivery
 */
const FORBIDDEN_PATTERNS =
  /\b(EMAIL|MAILGUN|SENDGRID|WEBHOOK|PUSH_NOTIFICATION|NOTIFY_USER|SLACK|TWILIO)\b/i;

describe("CON-08 lint gate: no proactive notification primitives in mcp-server source", () => {
  it("no production source under packages/mcp-server/src/ (excluding __tests__) references EMAIL, WEBHOOK, PUSH_NOTIFICATION, SLACK, NOTIFY_USER, MAILGUN, SENDGRID, or TWILIO", () => {
    const offenders: { file: string; matches: string[] }[] = [];

    for (const file of walk(SRC_ROOT)) {
      // Strip comments before grepping to avoid false positives from:
      //   - Single-line `//` comments (threat model refs, CON-08 notes, inline docs)
      //   - Block `/** */` and `/* */` comments (JSDoc examples, architectural notes)
      // Two-pass approach (mirrors lint-no-direct-vectorize.test.ts):
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

      const matches = [...content.matchAll(new RegExp(FORBIDDEN_PATTERNS.source, "gi"))];
      if (matches.length > 0) {
        offenders.push({ file, matches: matches.map((m) => m[0]) });
      }
    }

    // Report offenders with file paths and matched call sites for actionability.
    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:\n    ${o.matches.join(", ")}`).join("\n");
      throw new Error(
        `Proactive notification primitive found in production mcp-server source — ` +
          `CON-08 violation (pull-only architectural invariant broken):\n${report}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
