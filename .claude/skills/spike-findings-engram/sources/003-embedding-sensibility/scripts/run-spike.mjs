#!/usr/bin/env node
// Spike 003 runner. Reuses spike 001's sample corpus, embeds all 30 samples
// via the Worker, computes the pairwise cosine similarity matrix, and
// partitions into intra-bucket vs inter-bucket pairs.
//
// Decision gate:
//   PASS:       mean(intra) − mean(inter) ≥ 0.10 AND IQR overlap is null
//   BORDERLINE: 0.05 ≤ delta < 0.10  OR  IQR overlap is non-null but separable
//   FAIL:       delta < 0.05  OR  intra mean ≤ inter mean
//
// Run AFTER `wrangler dev` has been started on port 8903.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SHARED_SAMPLES = resolve(ROOT, "../001-extraction-precision-recall/samples");
const ENDPOINT = process.env.SPIKE_ENDPOINT ?? "http://127.0.0.1:8903/embed";

const BUCKETS = [
  { id: "job_application", file: "job-application.json" },
  { id: "decision_log", file: "decision-log.json" },
  { id: "research_note", file: "research-note.json" },
];

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function cosine(a, b) {
  if (a.length !== b.length) throw new Error(`dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function mean(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function quantile(sortedXs, q) {
  if (sortedXs.length === 0) return 0;
  const pos = (sortedXs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedXs[lo];
  return sortedXs[lo] + (sortedXs[hi] - sortedXs[lo]) * (pos - lo);
}

function summarize(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    mean: mean(xs),
    min: sorted[0] ?? 0,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Embedding fetch
// ---------------------------------------------------------------------------

async function embed(texts) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Spike 003 — embedding sensibility`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Shared samples: ${SHARED_SAMPLES}\n`);

  // Load all samples into one ordered array (preserving bucket assignment)
  const items = [];
  for (const { id, file } of BUCKETS) {
    const samples = JSON.parse(await readFile(resolve(SHARED_SAMPLES, file), "utf8"));
    for (const s of samples) items.push({ id: s.id, bucket: id, content: s.content });
  }
  console.log(`Embedding ${items.length} samples in one batched call...`);
  const t0 = Date.now();
  const response = await embed(items.map((i) => i.content));
  const elapsed = Date.now() - t0;
  console.log(`  dim=${response.dim} elapsed=${elapsed}ms worker=${response.elapsed_ms}ms\n`);

  if (response.embeddings.length !== items.length) {
    throw new Error(`expected ${items.length} embeddings, got ${response.embeddings.length}`);
  }

  // Pairwise cosine across all N×(N-1)/2 pairs (30 choose 2 = 435 pairs)
  const intra = []; // same bucket
  const inter = []; // different bucket
  const pairs = []; // for the viewer
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = cosine(response.embeddings[i], response.embeddings[j]);
      const sameBucket = items[i].bucket === items[j].bucket;
      const rec = {
        a: items[i].id,
        b: items[j].id,
        bucketA: items[i].bucket,
        bucketB: items[j].bucket,
        sameBucket,
        cosine: sim,
      };
      pairs.push(rec);
      if (sameBucket) intra.push(sim);
      else inter.push(sim);
    }
  }
  const intraStats = summarize(intra);
  const interStats = summarize(inter);
  const delta = intraStats.mean - interStats.mean;
  const iqrOverlap = interStats.p75 > intraStats.p25; // true means overlap exists

  // Per-bucket intra stats
  const byBucket = {};
  for (const b of BUCKETS) {
    const sims = pairs.filter((p) => p.sameBucket && p.bucketA === b.id).map((p) => p.cosine);
    byBucket[b.id] = summarize(sims);
  }

  // Decision gate
  const gate = decideGate(delta, iqrOverlap, intraStats, interStats);

  console.log(`Intra-bucket cosine (${intra.length} pairs):`);
  printStats(intraStats);
  console.log(`\nInter-bucket cosine (${inter.length} pairs):`);
  printStats(interStats);
  console.log(`\nDelta (intra.mean − inter.mean): ${delta.toFixed(4)}`);
  console.log(
    `IQR overlap: ${iqrOverlap ? "yes (inter.p75 > intra.p25)" : "no (clean separation)"}`,
  );
  console.log(`\nPer-bucket intra-cosine:`);
  for (const [k, v] of Object.entries(byBucket)) {
    console.log(
      `  ${k.padEnd(18)} mean=${v.mean.toFixed(4)}  median=${v.median.toFixed(4)}  range=[${v.min.toFixed(3)}, ${v.max.toFixed(3)}]`,
    );
  }
  console.log(`\nDecision gate: ${gate.gate} — ${gate.verdict}`);
  console.log(`  ${gate.message}`);

  const out = {
    spike: "003-embedding-sensibility",
    endpoint: ENDPOINT,
    timestamp: new Date().toISOString(),
    dim: response.dim,
    samples: items,
    pairs,
    aggregate: {
      intra: intraStats,
      inter: interStats,
      delta,
      iqrOverlap,
      byBucket,
    },
    gate,
  };
  await writeFile(resolve(ROOT, "results/results.json"), JSON.stringify(out, null, 2));
  await writeFile(resolve(ROOT, "results/results.html"), renderHtml(out));
  console.log(`\nResults: ${resolve(ROOT, "results/results.json")}`);
  console.log(`Viewer:  ${resolve(ROOT, "results/results.html")}`);
}

function decideGate(delta, iqrOverlap, intraStats, interStats) {
  const cleanSeparation = !iqrOverlap;
  if (delta >= 0.1 && cleanSeparation) {
    return {
      gate: "PASS",
      verdict: "VALIDATED",
      message:
        "Mean delta ≥ 0.10 AND IQR overlap is null. Embeddings cluster intra-bucket cleanly; bge-base-en-v1.5 is fit for Engram's recall ranking.",
    };
  }
  if (delta >= 0.1) {
    return {
      gate: "BORDERLINE",
      verdict: "PARTIAL",
      message: `Mean delta ${delta.toFixed(4)} ≥ 0.10 but IQR overlaps (inter.p75=${interStats.p75.toFixed(3)} > intra.p25=${intraStats.p25.toFixed(3)}). Bucket boundaries are fuzzy at the edges — hybrid ranking (vector + recency + type filter) may be required to disambiguate near-boundary recalls.`,
    };
  }
  if (delta >= 0.05) {
    return {
      gate: "BORDERLINE",
      verdict: "PARTIAL",
      message: `Mean delta ${delta.toFixed(4)} (0.05-0.10). Embeddings discriminate buckets but signal is weaker than expected — hybrid ranking required.`,
    };
  }
  return {
    gate: "FAIL",
    verdict: "INVALIDATED",
    message: `Mean delta ${delta.toFixed(4)} < 0.05 — embeddings do not separate buckets reliably. Phase 5 ranking strategy needs rework (consider larger model, query expansion, or hybrid retrieval).`,
  };
}

function printStats(s) {
  console.log(
    `  n=${s.n}  mean=${s.mean.toFixed(4)}  median=${s.median.toFixed(4)}  IQR=[${s.p25.toFixed(4)}, ${s.p75.toFixed(4)}]  range=[${s.min.toFixed(4)}, ${s.max.toFixed(4)}]`,
  );
}

function renderHtml(out) {
  const stats = [
    { label: "Intra-bucket (same bucket)", s: out.aggregate.intra, color: "#16a34a" },
    { label: "Inter-bucket (different bucket)", s: out.aggregate.inter, color: "#dc2626" },
  ];
  const statRows = stats
    .map(
      (x) => `<tr style="color:${x.color}">
      <td>${x.label}</td><td>${x.s.n}</td>
      <td>${x.s.mean.toFixed(4)}</td>
      <td>${x.s.median.toFixed(4)}</td>
      <td>[${x.s.p25.toFixed(3)}, ${x.s.p75.toFixed(3)}]</td>
      <td>[${x.s.min.toFixed(3)}, ${x.s.max.toFixed(3)}]</td>
    </tr>`,
    )
    .join("");
  const bucketRows = Object.entries(out.aggregate.byBucket)
    .map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v.n}</td><td>${v.mean.toFixed(4)}</td><td>${v.median.toFixed(4)}</td><td>[${v.p25.toFixed(3)}, ${v.p75.toFixed(3)}]</td></tr>`,
    )
    .join("");

  // Top-10 closest-but-different-bucket pairs (the false-positive risk)
  const tricky = [...out.pairs]
    .filter((p) => !p.sameBucket)
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, 10)
    .map(
      (p) =>
        `<tr><td>${p.a} (${p.bucketA})</td><td>${p.b} (${p.bucketB})</td><td>${p.cosine.toFixed(4)}</td></tr>`,
    )
    .join("");

  // Bottom-10 lowest intra-bucket pairs (the false-negative risk)
  const fragile = [...out.pairs]
    .filter((p) => p.sameBucket)
    .sort((a, b) => a.cosine - b.cosine)
    .slice(0, 10)
    .map(
      (p) =>
        `<tr><td>${p.a}</td><td>${p.b}</td><td>${p.bucketA}</td><td>${p.cosine.toFixed(4)}</td></tr>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Spike 003 results</title>
<style>body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#0f172a}
.gate{padding:1rem;border-radius:8px;margin:1rem 0}
.PASS{background:#dcfce7;border:1px solid #16a34a}
.BORDERLINE{background:#fef9c3;border:1px solid #ca8a04}
.FAIL{background:#fee2e2;border:1px solid #dc2626}
table{border-collapse:collapse;margin:1rem 0;width:100%}
th,td{border:1px solid #e2e8f0;padding:6px 12px;font-size:14px;text-align:left}</style></head><body>
<h1>Spike 003 — Embedding Sensibility</h1>
<p style="color:#64748b">Workers AI <code>@cf/baai/bge-base-en-v1.5</code> (${out.dim}d, cosine) · ${out.timestamp}</p>
<div class="gate ${out.gate.gate}">
  <strong>${out.gate.gate} — ${out.gate.verdict}</strong>
  <p>Delta (intra.mean − inter.mean): <code>${out.aggregate.delta.toFixed(4)}</code> · IQR overlap: ${out.aggregate.iqrOverlap ? "yes" : "no"}</p>
  <p>${out.gate.message}</p>
</div>
<h2>Distribution stats</h2>
<table><thead><tr><th>Population</th><th>N</th><th>Mean</th><th>Median</th><th>IQR</th><th>Range</th></tr></thead><tbody>${statRows}</tbody></table>
<h2>Per-bucket intra-cosine</h2>
<table><thead><tr><th>Bucket</th><th>N pairs</th><th>Mean</th><th>Median</th><th>IQR</th></tr></thead><tbody>${bucketRows}</tbody></table>
<h2>Top-10 closest cross-bucket pairs (the false-positive risk surface)</h2>
<table><thead><tr><th>Sample A</th><th>Sample B</th><th>Cosine</th></tr></thead><tbody>${tricky}</tbody></table>
<h2>Bottom-10 weakest intra-bucket pairs (the false-negative risk surface)</h2>
<table><thead><tr><th>Sample A</th><th>Sample B</th><th>Bucket</th><th>Cosine</th></tr></thead><tbody>${fragile}</tbody></table>
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
