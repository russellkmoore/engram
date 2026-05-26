#!/usr/bin/env node
// Spike 001 runner. POSTs every sample to the local wrangler-dev endpoint and
// scores extraction precision/recall vs hand-coded ground truth.
//
// Run AFTER `wrangler dev` has been started (port 8901 — see wrangler.jsonc):
//   $ wrangler dev --config wrangler.jsonc       # in one terminal
//   $ node scripts/run-spike.mjs                 # in another
//
// Or use the convenience target documented in README.md "How to Run".

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENDPOINT = process.env.SPIKE_ENDPOINT ?? "http://127.0.0.1:8901/extract";

const BUCKETS = [
  { id: "job_application", file: "samples/job-application.json" },
  { id: "decision_log", file: "samples/decision-log.json" },
  { id: "research_note", file: "samples/research-note.json" },
];

// ---------------------------------------------------------------------------
// Field comparators
// ---------------------------------------------------------------------------

function norm(s) {
  if (s == null) return "";
  return String(s).toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

function fuzzyEq(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
  // substring containment in either direction
  if (na.includes(nb) || nb.includes(na)) return true;
  // token overlap >= 0.6
  const ta = new Set(na.split(/[\s/,:;()-]+/).filter((t) => t.length > 1));
  const tb = new Set(nb.split(/[\s/,:;()-]+/).filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return false;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union >= 0.6;
}

function urlEq(a, b) {
  if (a == null || b == null) return a === b;
  const stripA = String(a).replace(/\/+$/, "").toLowerCase();
  const stripB = String(b).replace(/\/+$/, "").toLowerCase();
  return stripA === stripB || fuzzyEq(stripA, stripB);
}

function tagsEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const sa = new Set(a.map(norm).filter(Boolean));
  const sb = new Set(b.map(norm).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return true;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union > 0 ? inter / union >= 0.6 : false;
}

// Field comparator dispatch.
const COMPARATORS = {
  job_application: {
    company: fuzzyEq,
    role: fuzzyEq,
    salary_range: fuzzyEq,
    applied_date: fuzzyEq,
    source: fuzzyEq,
    url: urlEq,
  },
  decision_log: {
    decision: fuzzyEq,
    rationale: fuzzyEq,
    owner: fuzzyEq,
    date: fuzzyEq,
    project: fuzzyEq,
  },
  research_note: {
    title: fuzzyEq,
    topic: fuzzyEq,
    source_url: urlEq,
    summary: fuzzyEq,
    tags: tagsEq,
  },
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function isMissing(v) {
  return v == null || (Array.isArray(v) && v.length === 0) || v === "";
}

function scoreSample(bucket, expected, extracted) {
  const comparators = COMPARATORS[bucket];
  const fieldScores = {};
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0;
  for (const [field, cmp] of Object.entries(comparators)) {
    const ev = expected?.[field];
    const xv = extracted?.[field];
    const expectedMissing = isMissing(ev);
    const extractedMissing = isMissing(xv);
    let verdict;
    if (expectedMissing && extractedMissing) {
      verdict = "TN";
      tn++;
    } else if (expectedMissing && !extractedMissing) {
      verdict = "FP";
      fp++;
    } else if (!expectedMissing && extractedMissing) {
      verdict = "FN";
      fn++;
    } else {
      // both present — check match
      const match = cmp(ev, xv);
      if (match) {
        verdict = "TP";
        tp++;
      } else {
        // partial credit: extracted something but wrong value — counts as
        // BOTH a FP (wrong value) AND a FN (missed truth). Half-credit approach
        // would weaken the signal; precision/recall stay strict.
        verdict = "MISMATCH";
        fp++;
        fn++;
      }
    }
    fieldScores[field] = { expected: ev, extracted: xv, verdict };
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1, fieldScores };
}

// ---------------------------------------------------------------------------
// Per-sample runner
// ---------------------------------------------------------------------------

async function callExtract(bucket, content) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: bucket, content }),
  });
  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${await res.text()}` };
  }
  return await res.json();
}

async function runBucket(bucket, file) {
  const path = resolve(ROOT, file);
  const samples = JSON.parse(await readFile(path, "utf8"));
  const results = [];
  for (const sample of samples) {
    process.stdout.write(`  ${sample.id} ... `);
    const t0 = Date.now();
    const out = await callExtract(bucket, sample.content);
    const elapsed = Date.now() - t0;
    if (out.error) {
      console.log(`ERROR (${elapsed}ms): ${out.error}`);
      results.push({
        id: sample.id,
        bucket,
        content: sample.content,
        expected: sample.expected,
        extracted: null,
        error: out.error,
        elapsed_ms: elapsed,
      });
      continue;
    }
    const extracted = out.extracted;
    const score = scoreSample(bucket, sample.expected, extracted);
    console.log(
      `P=${(score.precision * 100).toFixed(0)}% R=${(score.recall * 100).toFixed(0)}% F1=${(score.f1 * 100).toFixed(0)}% (${elapsed}ms)`,
    );
    results.push({
      id: sample.id,
      bucket,
      content: sample.content,
      expected: sample.expected,
      extracted,
      score,
      elapsed_ms: elapsed,
      worker_elapsed_ms: out.elapsed_ms,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregate(results) {
  const byBucket = {};
  let total_tp = 0,
    total_fp = 0,
    total_fn = 0,
    total_tn = 0;
  let errored = 0;
  for (const r of results) {
    if (!r.score) {
      errored++;
      continue;
    }
    const bucket = (byBucket[r.bucket] ??= { tp: 0, fp: 0, fn: 0, tn: 0, n: 0 });
    bucket.tp += r.score.tp;
    bucket.fp += r.score.fp;
    bucket.fn += r.score.fn;
    bucket.tn += r.score.tn;
    bucket.n++;
    total_tp += r.score.tp;
    total_fp += r.score.fp;
    total_fn += r.score.fn;
    total_tn += r.score.tn;
  }
  for (const [k, v] of Object.entries(byBucket)) {
    v.precision = v.tp + v.fp === 0 ? 1 : v.tp / (v.tp + v.fp);
    v.recall = v.tp + v.fn === 0 ? 1 : v.tp / (v.tp + v.fn);
    v.f1 =
      v.precision + v.recall === 0 ? 0 : (2 * v.precision * v.recall) / (v.precision + v.recall);
    byBucket[k] = v;
  }
  const overall = {
    tp: total_tp,
    fp: total_fp,
    fn: total_fn,
    tn: total_tn,
    errored,
    precision: total_tp + total_fp === 0 ? 1 : total_tp / (total_tp + total_fp),
    recall: total_tp + total_fn === 0 ? 1 : total_tp / (total_tp + total_fn),
  };
  overall.f1 =
    overall.precision + overall.recall === 0
      ? 0
      : (2 * overall.precision * overall.recall) / (overall.precision + overall.recall);
  return { byBucket, overall };
}

// ---------------------------------------------------------------------------
// Decision gate
// ---------------------------------------------------------------------------

function decideGate(metric) {
  if (metric >= 0.9) {
    return {
      gate: "PASS",
      verdict: "VALIDATED",
      message:
        "Synthetic-recalibrated gate met (≥90%). Synthesis-only envelope contract survives; verbosity default stays 'synthesis'.",
    };
  }
  if (metric >= 0.75) {
    return {
      gate: "BORDERLINE",
      verdict: "PARTIAL",
      message:
        "Synthetic-recalibrated borderline (75-90%). Synthesis-only thesis is fragile; flip verbosity default to 'both' (raw chunks always returned alongside synthesis).",
    };
  }
  return {
    gate: "FAIL",
    verdict: "INVALIDATED",
    message:
      "Below the synthetic-recalibrated floor (<75%). Re-open envelope architecture before Phase 4 planning resumes.",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Spike 001 — extraction precision/recall`);
  console.log(`Endpoint: ${ENDPOINT}\n`);
  const allResults = [];
  for (const { id, file } of BUCKETS) {
    console.log(`### ${id}`);
    const bucketResults = await runBucket(id, file);
    allResults.push(...bucketResults);
    console.log();
  }
  const agg = aggregate(allResults);
  const gate = decideGate(agg.overall.f1);

  console.log(
    `\nOverall: P=${(agg.overall.precision * 100).toFixed(1)}%  R=${(agg.overall.recall * 100).toFixed(1)}%  F1=${(agg.overall.f1 * 100).toFixed(1)}%  errors=${agg.overall.errored}`,
  );
  for (const [k, v] of Object.entries(agg.byBucket)) {
    console.log(
      `  ${k.padEnd(18)} P=${(v.precision * 100).toFixed(1)}%  R=${(v.recall * 100).toFixed(1)}%  F1=${(v.f1 * 100).toFixed(1)}%  (n=${v.n})`,
    );
  }
  console.log(`\nDecision gate: ${gate.gate} — ${gate.verdict}`);
  console.log(`  ${gate.message}`);

  const out = {
    spike: "001-extraction-precision-recall",
    endpoint: ENDPOINT,
    timestamp: new Date().toISOString(),
    samples: allResults,
    aggregate: agg,
    gate,
  };
  const outPath = resolve(ROOT, "results/results.json");
  await writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);

  // Simple HTML viewer
  const html = renderHtml(out);
  const htmlPath = resolve(ROOT, "results/results.html");
  await writeFile(htmlPath, html);
  console.log(`Viewer: ${htmlPath}`);
}

function renderHtml(out) {
  const rowsBySample = out.samples
    .map((r) => {
      const score = r.score
        ? `P=${(r.score.precision * 100).toFixed(0)}% R=${(r.score.recall * 100).toFixed(0)}% F1=${(r.score.f1 * 100).toFixed(0)}%`
        : `<span style="color:#b91c1c">ERROR</span>`;
      const fields = r.score
        ? Object.entries(r.score.fieldScores)
            .map(([f, v]) => {
              const color =
                v.verdict === "TP"
                  ? "#16a34a"
                  : v.verdict === "TN"
                    ? "#94a3b8"
                    : v.verdict === "FP" || v.verdict === "FN" || v.verdict === "MISMATCH"
                      ? "#dc2626"
                      : "#475569";
              const expected = JSON.stringify(v.expected);
              const extracted = JSON.stringify(v.extracted);
              return `<tr><td>${f}</td><td><span style="color:${color}">${v.verdict}</span></td><td><code>${expected}</code></td><td><code>${extracted}</code></td></tr>`;
            })
            .join("")
        : `<tr><td colspan="4" style="color:#b91c1c">${r.error}</td></tr>`;
      return `<details><summary><strong>${r.id}</strong> (${r.bucket}) — ${score} — ${r.elapsed_ms}ms</summary>
        <div style="padding:8px 16px;background:#f8fafc">
          <p style="font-style:italic;color:#475569">${r.content.replace(/</g, "&lt;")}</p>
          <table style="border-collapse:collapse;width:100%">
            <thead><tr><th style="text-align:left">Field</th><th style="text-align:left">Verdict</th><th style="text-align:left">Expected</th><th style="text-align:left">Extracted</th></tr></thead>
            <tbody>${fields}</tbody>
          </table>
        </div>
      </details>`;
    })
    .join("");

  const byBucket = Object.entries(out.aggregate.byBucket)
    .map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v.n}</td><td>${(v.precision * 100).toFixed(1)}%</td><td>${(v.recall * 100).toFixed(1)}%</td><td>${(v.f1 * 100).toFixed(1)}%</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Spike 001 results</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#0f172a}
h1{margin-bottom:0}.gate{padding:1rem;border-radius:8px;margin:1rem 0}
.PASS{background:#dcfce7;border:1px solid #16a34a}
.BORDERLINE{background:#fef9c3;border:1px solid #ca8a04}
.FAIL{background:#fee2e2;border:1px solid #dc2626}
table{border-collapse:collapse;margin:1rem 0}
th,td{border:1px solid #e2e8f0;padding:6px 12px;font-size:14px}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px}
details{margin:8px 0;border:1px solid #e2e8f0;border-radius:6px}
summary{padding:8px 12px;cursor:pointer;background:#f8fafc}</style>
</head><body>
<h1>Spike 001 — Extraction Precision / Recall</h1>
<p style="color:#64748b">Workers AI <code>@cf/meta/llama-3.1-8b-instruct</code> · JSON-schema response_format · ${out.timestamp}</p>
<div class="gate ${out.gate.gate}">
  <strong>${out.gate.gate} — ${out.gate.verdict}</strong>
  <p>Overall: P=${(out.aggregate.overall.precision * 100).toFixed(1)}% · R=${(out.aggregate.overall.recall * 100).toFixed(1)}% · F1=${(out.aggregate.overall.f1 * 100).toFixed(1)}%</p>
  <p>${out.gate.message}</p>
</div>
<h2>Per-bucket</h2>
<table><thead><tr><th>Bucket</th><th>N</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>${byBucket}</tbody></table>
<h2>Per-sample (click to expand)</h2>
${rowsBySample}
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
