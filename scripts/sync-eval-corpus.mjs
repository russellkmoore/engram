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
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

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

// Canonical serialization: 2-space indent, trailing newline.
// Note: the on-disk target is also prettier-formatted (we run `npx prettier --write`
// after writing). For --check mode, we compare against the prettier-canonical form
// by writing to a temp buffer and prettier-formatting it in memory.
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

  // Compute the prettier-canonical expected content by writing to a temp file and
  // running prettier --write on it (same pipeline as the default write path).
  const tmpDir = mkdtempSync(`${tmpdir()}/sync-eval-corpus-`);
  const tmpFile = resolve(tmpDir, "vendored.json");
  writeFileSync(tmpFile, vendoredSerialized, "utf8");
  try {
    execSync(`npx prettier --write "${tmpFile}"`, { stdio: "pipe" });
  } catch {
    // prettier failure: fall back to raw comparison
  }
  const expectedContent = readFileSync(tmpFile, "utf8");
  try {
    unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    /* ignore */
  }

  const targetRaw = readFileSync(TARGET_PATH, "utf8");
  if (targetRaw === expectedContent) {
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

// Run prettier on the target so the on-disk file is always in prettier-canonical
// format. This prevents the lint-staged hook from producing a diff between the
// script-generated content and the prettier-reformatted content on commit.
try {
  execSync(`npx prettier --write "${TARGET_PATH}"`, { stdio: "pipe" });
} catch {
  // prettier failure is non-fatal — the file is still written correctly.
  stderr.write(
    `${TAG} WARNING: prettier --write failed on target; file may not be prettier-canonical.\n`,
  );
}

stdout.write(`${TAG} wrote: ${TARGET_PATH}\n`);
exit(0);
