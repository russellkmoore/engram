/**
 * apply-split.mjs — Deterministic 70/30 stratified-by-bucket train/validate split
 *
 * Seed: 0x01054042 (Phase 01-05 + corpus v2)
 * Algorithm: Seeded Mulberry32 PRNG → Fisher-Yates shuffle per bucket
 * Assignment: floor(0.7 * N) → train, remainder → validate
 *
 * Idempotent: re-running produces identical assignments.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(__dirname, "recall-corpus.json");

// Mulberry32 PRNG — fast, seeded, deterministic
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle using the provided rng
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SEED = 0x01054042;
const BUCKETS = ["critical-path", "known-failure", "extraction", "edge"];
const TRAIN_RATIO = 0.7;

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

// Group entries by bucket, preserving original order per bucket
const byBucket = {};
for (const bucket of BUCKETS) {
  byBucket[bucket] = corpus.entries.filter((e) => e.bucket === bucket);
}

// Apply stratified split per bucket
const splitMap = new Map(); // entry id → "train" | "validate"
const stats = [];

for (const bucket of BUCKETS) {
  const entries = byBucket[bucket];
  const n = entries.length;

  if (n < 4) {
    // Too small to split meaningfully — all go to train
    console.warn(`⚠ Bucket "${bucket}" has only ${n} entries (<4) — assigning all to train`);
    for (const e of entries) splitMap.set(e.id, "train");
    stats.push({ bucket, n, train: n, validate: 0, trainPct: 100 });
    continue;
  }

  // Seed: combine the global seed with a per-bucket hash so each bucket
  // has independent shuffle order (prevents correlation between buckets)
  const bucketHash = bucket.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = mulberry32((SEED + bucketHash) >>> 0);
  const shuffled = shuffle(entries, rng);

  // Use round() instead of floor() for small buckets where floor() would push
  // the train% below the 60% lower bound (e.g., floor(0.7*7) = 4 = 57%).
  // Math.round(0.7 * n) keeps the ratio closest to 70% within integer constraints.
  const trainCount = Math.round(TRAIN_RATIO * n);
  const validateCount = n - trainCount;

  shuffled.slice(0, trainCount).forEach((e) => splitMap.set(e.id, "train"));
  shuffled.slice(trainCount).forEach((e) => splitMap.set(e.id, "validate"));

  const trainPct = Math.round((trainCount / n) * 100);
  stats.push({ bucket, n, train: trainCount, validate: validateCount, trainPct });
}

// Apply splits to corpus entries (preserve original ordering of entries array)
for (const entry of corpus.entries) {
  const split = splitMap.get(entry.id);
  if (!split) throw new Error(`No split assigned for entry ${entry.id}`);
  entry.split = split;
}

// Summary
const totalTrain = corpus.entries.filter((e) => e.split === "train").length;
const totalValidate = corpus.entries.filter((e) => e.split === "validate").length;

console.log("\n=== Stratified split summary ===");
for (const s of stats) {
  console.log(
    `  ${s.bucket.padEnd(16)} n=${s.n}  train=${s.train} (${s.trainPct}%)  validate=${s.validate}`,
  );
}
console.log(
  `  ${"TOTAL".padEnd(16)} n=${corpus.entries.length}  train=${totalTrain}  validate=${totalValidate}`,
);

// Validation
if (totalTrain < 65 || totalTrain > 75) {
  throw new Error(`Train count ${totalTrain} outside 65-75 range`);
}
if (totalValidate < 25 || totalValidate > 35) {
  throw new Error(`Validate count ${totalValidate} outside 25-35 range`);
}

// Per-bucket ratio validation (60/40 to 80/20)
for (const s of stats) {
  if (s.n >= 4) {
    const trainPct = s.trainPct;
    if (trainPct < 60 || trainPct > 80) {
      throw new Error(`Bucket "${s.bucket}" train% ${trainPct} outside 60-80% range`);
    }
  }
}

writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2));
console.log(`\n✓ Wrote updated corpus to ${CORPUS_PATH}`);
