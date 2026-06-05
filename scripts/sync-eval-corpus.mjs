// scripts/sync-eval-corpus.mjs
// D-13: copies .planning/evals/recall-corpus.json →
// packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json so the
// vendored fixture stays in sync with the authoritative editing surface (D-11).
// D-12: vendored fixture is the byte-stable test input — never edit it directly;
// edit `.planning/evals/recall-corpus.json` and re-run this script.
//
// Usage:
//   node scripts/sync-eval-corpus.mjs [--check] [--help]
//
//   --check:        OPTIONAL. CI guard mode — exit 1 if files differ instead of
//                   overwriting. No filesystem writes.
//   --help / -h:    Print this usage and exit 0.
//
// Exit codes:
//   0 success (default mode: synced; --check mode: in sync)
//   1 drift detected (--check mode only)
//   2 source file missing
//
// Source: Phase 2 D-13 (corpus sync). Mirrors scripts/eval-budget-summary.mjs
// CLI shape (TAG, arg-parse, usage(), exit codes). No Cloudflare creds required
// — this is a pure local filesystem copy.

import { argv, exit, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TAG = "[sync-eval-corpus]";

// ──────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ──────────────────────────────────────────────────────────────────────────────

const args = argv.slice(2);
let checkOnly = false;
let showHelp = false;

for (const a of args) {
  if (a === "--check") {
    checkOnly = true;
  } else if (a === "--help" || a === "-h") {
    showHelp = true;
  }
}

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/sync-eval-corpus.mjs [--check] [--help]\n` +
      `${TAG}   --check:     CI guard — exit 1 if files differ instead of overwriting.\n` +
      `${TAG}   --help / -h: Print this usage and exit 0.\n` +
      `${TAG}\n` +
      `${TAG} Source: .planning/evals/recall-corpus.json (authoritative)\n` +
      `${TAG} Target: packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json (vendored)\n` +
      `${TAG} Exit codes: 0 success | 1 drift (--check mode) | 2 source missing\n`,
  );
}

if (showHelp) {
  usage(stdout);
  exit(0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Path resolution (mirrors .planning/evals/apply-split.mjs: import.meta.url →
// __dirname → repo-rooted paths, no env vars needed).
// ──────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SOURCE_PATH = resolve(REPO_ROOT, ".planning/evals/recall-corpus.json");
const TARGET_PATH = resolve(
  REPO_ROOT,
  "packages/mcp-server/src/__tests__/evals/fixtures/recall-corpus-v2.json",
);

// ──────────────────────────────────────────────────────────────────────────────
// Source check
// ──────────────────────────────────────────────────────────────────────────────

if (!existsSync(SOURCE_PATH)) {
  stderr.write(`${TAG} ERROR: source file missing: ${SOURCE_PATH}\n`);
  exit(2);
}

const sourceRaw = readFileSync(SOURCE_PATH, "utf8");
const sourceObj = JSON.parse(sourceRaw);

// Attach the sentinel field at the top of the wrapper. JSON does not support
// comments — the sentinel field is the convention per Plan 02-01 PATTERNS.md
// §"recall-corpus-v2.json" and is documented for the drift-check threat model
// (T-02-01-03). Reorder so it appears first in the JSON output for visibility.
const vendoredObj = {
  _auto_synced_from: ".planning/evals/recall-corpus.json",
  ...sourceObj,
};

// Canonical serialization: 2-space indent, trailing newline. This is what the
// target file must equal byte-for-byte under --check.
const vendoredSerialized = JSON.stringify(vendoredObj, null, 2) + "\n";

// ──────────────────────────────────────────────────────────────────────────────
// Mode: --check (CI drift detection) or default (write)
// ──────────────────────────────────────────────────────────────────────────────

if (checkOnly) {
  if (!existsSync(TARGET_PATH)) {
    stderr.write(
      `${TAG} DRIFT: target file does not exist yet: ${TARGET_PATH}\n` +
        `${TAG} Run \`node scripts/sync-eval-corpus.mjs\` (without --check) to create it.\n`,
    );
    exit(1);
  }
  const targetRaw = readFileSync(TARGET_PATH, "utf8");
  if (targetRaw === vendoredSerialized) {
    stdout.write(`${TAG} in sync: ${TARGET_PATH}\n`);
    exit(0);
  }
  stderr.write(
    `${TAG} DRIFT: target differs from source-derived expected content.\n` +
      `${TAG}   source: ${SOURCE_PATH}\n` +
      `${TAG}   target: ${TARGET_PATH}\n` +
      `${TAG} Re-run \`node scripts/sync-eval-corpus.mjs\` (without --check) to regenerate.\n`,
  );
  exit(1);
}

writeFileSync(TARGET_PATH, vendoredSerialized, "utf8");
stdout.write(`${TAG} wrote: ${TARGET_PATH}\n`);
exit(0);
