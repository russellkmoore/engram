// scripts/lint-blockconcurrency.mjs
// STO-10: forbid asynchronous I/O inside `blockConcurrencyWhile(async () => { ... })`
// blocks in any TypeScript source under `packages/workspace-do/src/`.
//
// Why: Cloudflare Durable Objects' `blockConcurrencyWhile()` blocks ALL request
// delivery while its callback is awaiting. Any I/O inside the block (env.* RPC,
// fetch, Workers AI, ctx.storage.transaction, dynamic import) creates a
// throughput cliff and a 30-second-eviction risk under load. This script
// enforces the rule statically at commit time (lint-staged) and in CI.
//
// Forbidden tokens inside the block (per 02-CONTEXT.md D-10): env., fetch(,
// await this.ai, await ctx.storage.transaction(, await import(, await this.env.
// Allowed inside the block: synchronous `storage.sql.exec(...)`, synchronous
// JS, `console.log`.
//
// Implementation note (per 02-CONTEXT.md D-09 + 02-PATTERNS.md §1): the script
// mirrors `scripts/lint-wrangler.mjs` structurally — same dual-mode dispatch,
// same exit-code matrix (0/1/2), same `[lint:blockconcurrency]` tag prefix on
// every log line, same `fast-glob` for the no-arg full-scan. No AST parser
// (ts-morph) — a balance-counted brace match against the call site is
// sufficient at v0.1 scale.
//
// Usage: node scripts/lint-blockconcurrency.mjs [file...]
//   - No args: globs packages/workspace-do/src/**/*.ts (production full-scan mode used by CI).
//   - With args: lints exactly the given files (lint-staged per-file mode, fixture invocations).
// Exit codes: 0 clean | 1 violation | 2 no files matched (full-scan canary only).

import { readFileSync } from "node:fs";
import fg from "fast-glob";

const FORBIDDEN_TOKENS = [
  "env.",
  "fetch(",
  "await this.ai",
  "await ctx.storage.transaction(",
  "await import(",
  "await this.env",
];
const SCAN_GLOB = "packages/workspace-do/src/**/*.ts";

// Match `blockConcurrencyWhile(<whitespace> async <whitespace> ( ... ) <ws> => <ws> {`
// OR `blockConcurrencyWhile(<ws> async <ws> function <ident?> ( ... ) <ws> {`.
// The `{` at the end of the match is the OPENING brace of the block body — the
// balance-counted scan begins from the character immediately after this brace.
// This is deliberately simple (no string-literal/comment escaping in the
// matcher itself); the extracted block body is comment-stripped before the
// token check (T-02-07-01 mitigation).
const BLOCK_HEAD_REGEX =
  /blockConcurrencyWhile\(\s*async\s*(?:\([^)]*\)|function[^{]*)\s*(?:=>\s*)?\{/g;

/**
 * Extract every `blockConcurrencyWhile(async () => { ... })` block body from
 * the source text via balance-counted brace matching.
 *
 * @param {string} text
 * @returns {{ body: string, lineStart: number }[]}
 */
function extractBlocks(text) {
  const blocks = [];
  const re = new RegExp(BLOCK_HEAD_REGEX.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    // Position just after the opening `{` of the block body.
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) {
      // Unbalanced — skip this match (malformed source; tsc will surface it).
      continue;
    }
    const body = text.slice(bodyStart, i);
    const lineStart = text.slice(0, m.index).split("\n").length;
    blocks.push({ body, lineStart });
  }
  return blocks;
}

/**
 * Strip `// line comments` and `/* block comments *\/` from text. Used to
 * sanitize a block body before scanning for forbidden tokens — a doc comment
 * referencing `env.AI` (e.g., "do not call env.AI here") must not trigger a
 * false positive (T-02-07-01 mitigation).
 *
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

let violations = 0;

const positionalArgs = process.argv.slice(2);
const files = [];

if (positionalArgs.length > 0) {
  // Positional-arg mode: lint exactly the given files (lint-staged per-file, fixture invocations).
  // If a file is missing or unreadable, treat as a violation (exit 1) — not the exit-2 canary.
  for (const file of positionalArgs) {
    files.push(file);
  }
} else {
  // No-arg full-scan mode: glob packages/workspace-do/src/**/*.ts (production CI scan).
  // Exit 2 if no files found — canary against accidental packages/workspace-do/src/ rename.
  // Use fast-glob (stable API) instead of node:fs/promises glob (experimental in Node 22).
  // Fixtures live at packages/workspace-do/__fixtures__/ (OUTSIDE the src/ glob) per
  // PATTERNS.md §17 drift mitigation — they are NOT picked up here.
  const matched = await fg(SCAN_GLOB);
  for (const file of matched) {
    files.push(file);
  }

  if (files.length === 0) {
    console.error(
      `[lint:blockconcurrency] No source files found — did packages/workspace-do/src/ get renamed? ` +
        `(glob: ${SCAN_GLOB})`,
    );
    process.exit(2);
  }
}

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`[lint:blockconcurrency] ${file} — could not read file: ${err.message}`);
    violations++;
    continue;
  }

  const blocks = extractBlocks(text);
  for (const { body, lineStart } of blocks) {
    const cleanedBody = stripComments(body);
    for (const token of FORBIDDEN_TOKENS) {
      if (cleanedBody.includes(token)) {
        console.error(
          `[lint:blockconcurrency] ${file}:${lineStart} blockConcurrencyWhile block contains ` +
            `forbidden token '${token}' (Pitfall 1: async I/O inside the bootstrap block ` +
            `blocks ALL request delivery — see 02-CONTEXT.md D-10).`,
        );
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n[lint:blockconcurrency] FAIL — ${violations} violation(s) found.`);
  process.exit(1);
}

console.log(`[lint:blockconcurrency] OK — checked ${files.length} file(s).`);
