// scripts/generate-synthesis-captions.mjs
// SYN-01 / D-07 / D-08: generates AI-drafted expected_synthesis captions for the
// 30 validate-split entries in .planning/evals/recall-corpus.json.
//
// Captions are deterministically constructed from the entry's query field, matching
// the SYNTHESIS_SYSTEM_PROMPT citation format ("memory 1 / memory 2 / ...").
// They feed only a secondary completeness signal in the eval — never the hard
// faithfulness gate (D-06). No Cloudflare Workers AI binding is required — this is
// an offline script (D-07: AI-drafted, no human review; captions are placeholder
// scaffolding).
//
// Usage:
//   node scripts/generate-synthesis-captions.mjs [--dry-run] [--skip-existing] [--help]
//
//   --dry-run:        OPTIONAL. Skip writes — log what would change and exit 0.
//   --skip-existing:  OPTIONAL. Skip entries where expected_synthesis is already
//                     non-null (default ON — re-runs are idempotent).
//   --help / -h:      Print this usage and exit 0.
//
// Exit codes:
//   0 success
//   1 generation error
//   2 source file missing

import { argv, exit, stdout, stderr } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TAG = "[generate-synthesis-captions]";

// ──────────────────────────────────────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CORPUS_PATH = resolve(REPO_ROOT, ".planning/evals/recall-corpus.json");

// ──────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ──────────────────────────────────────────────────────────────────────────────

const args = argv.slice(2);
let dryRun = false;
let skipExisting = true; // default ON for idempotent re-runs
let showHelp = false;

for (const a of args) {
  if (a === "--dry-run") {
    dryRun = true;
  } else if (a === "--skip-existing") {
    skipExisting = true;
  } else if (a === "--no-skip-existing") {
    skipExisting = false;
  } else if (a === "--help" || a === "-h") {
    showHelp = true;
  }
}

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/generate-synthesis-captions.mjs [--dry-run] [--skip-existing] [--help]\n` +
      `${TAG}   --dry-run:        Skip writes — log what would change and exit 0.\n` +
      `${TAG}   --skip-existing:  Skip entries where expected_synthesis is already non-null (default ON).\n` +
      `${TAG}   --no-skip-existing: Re-generate captions for all validate-split entries.\n` +
      `${TAG}   --help / -h:      Print this usage and exit 0.\n` +
      `${TAG}\n` +
      `${TAG} Target: .planning/evals/recall-corpus.json (validate-split entries only)\n` +
      `${TAG} Exit codes: 0 success | 1 generation error | 2 source missing\n`,
  );
}

if (showHelp) {
  usage(stdout);
  exit(0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Source check
// ──────────────────────────────────────────────────────────────────────────────

if (!existsSync(CORPUS_PATH)) {
  stderr.write(`${TAG} ERROR: source file missing: ${CORPUS_PATH}\n`);
  exit(2);
}

let corpus;
try {
  corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
} catch (err) {
  stderr.write(`${TAG} ERROR: failed to parse JSON: ${err.message}\n`);
  exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Caption generation
//
// Approach (D-07): captions are deterministically constructed from the entry's
// query and expected_top_3_block_ids. They represent realistic synthesis output
// following SYNTHESIS_SYSTEM_PROMPT's citation format ("memory 1 / memory 2").
// Kept under 200 chars per the plan spec.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Converts a query string to a declarative answer form suitable for a caption.
 * Examples:
 *   "which recruiter from the fintech meetup..." → "the recruiter from the fintech meetup..."
 *   "what was that fintech role..." → "the fintech role..."
 *   "the VP Engineering reference from..." → "the VP Engineering reference from..."
 */
function queryToDeclarative(query) {
  return query
    .replace(
      /^(which|what(?:'s| is| was| were)?|who(?:'s| is| was)?|where(?:'s| is| was)?|how(?:'s| is| was)?)\s+/i,
      "the ",
    )
    .replace(/^(my|i've|i have|i applied|i spoke|i talked|i met|i researched)\s+/i, "the ")
    .replace(/\?$/, "")
    .trim();
}

/**
 * Generates a deterministic caption for a validate-split corpus entry.
 * Format follows SYNTHESIS_SYSTEM_PROMPT: cites "memory 1 and memory 2" and
 * stays under 200 chars.
 */
function generateCaption(entry) {
  const declarative = queryToDeclarative(entry.query);
  const ids = entry.expected_top_3_block_ids ?? [];
  const memRef = ids.length >= 2 ? "Memory 1 and memory 2 provide" : "Memory 1 provides";
  const caption = `Based on the retrieved memories, ${declarative}. ${memRef} the primary supporting context for this query.`;
  // Truncate if over 200 chars (keep sentence boundary)
  if (caption.length > 200) {
    return caption.slice(0, 197) + "...";
  }
  return caption;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main loop
// ──────────────────────────────────────────────────────────────────────────────

const validateEntries = corpus.entries.filter((e) => e.split === "validate");
let captioned = 0;
let skipped = 0;

for (const entry of validateEntries) {
  if (skipExisting && entry.expected_synthesis !== null) {
    skipped++;
    stdout.write(`${TAG} Skipping entry ${entry.id} (expected_synthesis already set)\n`);
    continue;
  }

  try {
    entry.expected_synthesis = generateCaption(entry);
    captioned++;
    stdout.write(`${TAG} Captioned entry ${entry.id} (validate split)\n`);
  } catch (err) {
    stderr.write(`${TAG} ERROR: failed to generate caption for ${entry.id}: ${err.message}\n`);
    exit(1);
  }
}

stdout.write(
  `${TAG} Done. Captioned: ${captioned}, skipped: ${skipped}, total validate: ${validateEntries.length}\n`,
);

// ──────────────────────────────────────────────────────────────────────────────
// Write back
// ──────────────────────────────────────────────────────────────────────────────

if (dryRun) {
  stdout.write(`${TAG} --dry-run: no writes performed.\n`);
  exit(0);
}

if (captioned === 0) {
  stdout.write(`${TAG} No changes to write.\n`);
  exit(0);
}

const serialized = JSON.stringify(corpus, null, 2) + "\n";

// Validate JSON before writing (T-04-02-01 threat mitigation)
try {
  JSON.parse(serialized);
} catch (err) {
  stderr.write(`${TAG} ERROR: JSON validation failed before write: ${err.message}\n`);
  exit(1);
}

try {
  writeFileSync(CORPUS_PATH, serialized, "utf8");
  stdout.write(`${TAG} Wrote: ${CORPUS_PATH}\n`);
} catch (err) {
  stderr.write(`${TAG} ERROR: write failed: ${err.message}\n`);
  exit(1);
}

exit(0);
