// scripts/lint-wrangler.mjs
// Source: github.com/microsoft/node-jsonc-parser — Microsoft's official JSONC parser.
// Verifies every wrangler.jsonc found in packages/*/ does NOT declare any
// Durable Object class under `new_classes` in its migrations.
//
// FND-08: Cloudflare workers-sdk issue #9909 — KV-backed DOs declared via `new_classes`
// CANNOT be retroactively converted to SQLite-backed. This lint script is the durable
// defense that prevents that irreversible regression from ever reaching production.
//
// Usage: node scripts/lint-wrangler.mjs [file...]
//   - No args: globs packages/*/wrangler.jsonc (production full-scan mode used by CI).
//   - With args: lints exactly the given files (lint-staged per-file mode, fixture invocations).
// Exit codes: 0 clean | 1 violation | 2 no files matched (full-scan canary only).

import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";

const VIOLATION_KEY = "new_classes";
const REQUIRED_KEY = "new_sqlite_classes";

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
  // No-arg full-scan mode: glob packages/*/wrangler.jsonc (production CI scan).
  // Exit 2 if no files found — canary against accidental packages/ rename.
  for await (const file of glob("packages/*/wrangler.jsonc")) {
    files.push(file);
  }

  if (files.length === 0) {
    console.error(
      "[lint:wrangler] No wrangler.jsonc files found — did packages/ get renamed? " +
      "(glob: packages/*/wrangler.jsonc)"
    );
    process.exit(2);
  }
}

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`[lint:wrangler] ${file} — could not read file: ${err.message}`);
    violations++;
    continue;
  }

  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    console.error(`[lint:wrangler] ${file} — JSONC parse errors:`);
    for (const err of errors) {
      console.error(`  ${printParseErrorCode(err.error)} at offset ${err.offset}`);
    }
    violations++;
    continue;
  }

  const migrations = Array.isArray(config?.migrations) ? config.migrations : [];
  for (const [i, mig] of migrations.entries()) {
    if (Array.isArray(mig?.[VIOLATION_KEY]) && mig[VIOLATION_KEY].length > 0) {
      console.error(
        `[lint:wrangler] ${file} migration[${i}] (tag: ${mig?.tag ?? "?"}) declares ` +
        `${VIOLATION_KEY}=${JSON.stringify(mig[VIOLATION_KEY])}. ` +
        `Engram requires SQLite-backed Durable Objects only — use ${REQUIRED_KEY}.`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n[lint:wrangler] FAIL — ${violations} violation(s) found.`);
  process.exit(1);
}

console.log(`[lint:wrangler] OK — checked ${files.length} file(s).`);
