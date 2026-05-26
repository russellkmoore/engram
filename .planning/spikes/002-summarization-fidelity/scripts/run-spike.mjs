#!/usr/bin/env node
// Spike 002 runner. Reuses spike 001's sample corpus, asks the Worker to
// summarize each sample, then scores fact preservation against the per-sample
// load_bearing_facts list.
//
// Run AFTER `wrangler dev` has been started on port 8902:
//   $ wrangler dev --config wrangler.jsonc
//   $ node scripts/run-spike.mjs

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SHARED_SAMPLES = resolve(ROOT, "../001-extraction-precision-recall/samples");
const ENDPOINT = process.env.SPIKE_ENDPOINT ?? "http://127.0.0.1:8902/summarize";

const BUCKETS = [
  { id: "job_application", file: "job-application.json" },
  { id: "decision_log", file: "decision-log.json" },
  { id: "research_note", file: "research-note.json" },
];

// ---------------------------------------------------------------------------
// Fact-preservation comparator (case-insensitive substring + token overlap)
// ---------------------------------------------------------------------------

function norm(s) {
  if (s == null) return "";
  return String(s).toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

function factPreserved(fact, summary) {
  const nf = norm(fact);
  const ns = norm(summary);
  if (!nf || !ns) return false;
  // 1) direct substring containment
  if (ns.includes(nf)) return true;
  // 2) token overlap >= 0.6 across the fact's words against any sliding window
  //    of the summary (approximate paraphrase tolerance)
  const ft = new Set(nf.split(/[\s/,:;()-]+/).filter((t) => t.length > 1));
  if (ft.size === 0) return false;
  const st = new Set(ns.split(/[\s/,:;()-]+/).filter((t) => t.length > 1));
  if (st.size === 0) return false;
  let intersection = 0;
  for (const t of ft) if (st.has(t)) intersection++;
  // For short facts (1-2 tokens), require ALL tokens present.
  if (ft.size <= 2) return intersection === ft.size;
  // For longer facts, allow up to 1 missing token (>= ceil(n*0.6)).
  const required = Math.ceil(ft.size * 0.6);
  return intersection >= required;
}

// ---------------------------------------------------------------------------
// Scoring per sample
// ---------------------------------------------------------------------------

function scoreSample(facts, summary) {
  const factScores = facts.map((fact) => ({
    fact,
    preserved: factPreserved(fact, summary),
  }));
  const preserved = factScores.filter((f) => f.preserved).length;
  const recall = facts.length === 0 ? 1 : preserved / facts.length;
  return { facts: factScores, preserved, total: facts.length, recall };
}

// ---------------------------------------------------------------------------
// Per-bucket runner
// ---------------------------------------------------------------------------

async function callSummarize(content) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${await res.text()}` };
  return await res.json();
}

async function runBucket(bucket, file, loadBearing) {
  const samples = JSON.parse(await readFile(resolve(SHARED_SAMPLES, file), "utf8"));
  const results = [];
  for (const sample of samples) {
    process.stdout.write(`  ${sample.id} ... `);
    const facts = loadBearing[sample.id] ?? [];
    const t0 = Date.now();
    const out = await callSummarize(sample.content);
    const elapsed = Date.now() - t0;
    if (out.error) {
      console.log(`ERROR (${elapsed}ms): ${out.error}`);
      results.push({
        id: sample.id,
        bucket,
        content: sample.content,
        summary: null,
        facts,
        score: null,
        error: out.error,
        elapsed_ms: elapsed,
      });
      continue;
    }
    const score = scoreSample(facts, out.summary);
    const tag = score.recall >= 0.9 ? "✓" : score.recall >= 0.75 ? "⚠" : "✗";
    console.log(
      `${tag} R=${(score.recall * 100).toFixed(0)}% (${score.preserved}/${score.total} facts, ${elapsed}ms)`,
    );
    results.push({
      id: sample.id,
      bucket,
      content: sample.content,
      summary: out.summary,
      facts,
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
  let total_preserved = 0,
    total_facts = 0,
    errored = 0;
  for (const r of results) {
    if (!r.score) {
      errored++;
      continue;
    }
    const bucket = (byBucket[r.bucket] ??= { preserved: 0, total: 0, n: 0 });
    bucket.preserved += r.score.preserved;
    bucket.total += r.score.total;
    bucket.n++;
    total_preserved += r.score.preserved;
    total_facts += r.score.total;
  }
  for (const v of Object.values(byBucket)) {
    v.recall = v.total === 0 ? 1 : v.preserved / v.total;
  }
  const overall = {
    preserved: total_preserved,
    total: total_facts,
    errored,
    recall: total_facts === 0 ? 1 : total_preserved / total_facts,
  };
  return { byBucket, overall };
}

function decideGate(recall) {
  if (recall >= 0.9) {
    return {
      gate: "PASS",
      verdict: "VALIDATED",
      message:
        "Synthetic-recalibrated gate met (≥90% fact preservation). Summaries safely carry load-bearing facts; synthesis-only thesis survives.",
    };
  }
  if (recall >= 0.75) {
    return {
      gate: "BORDERLINE",
      verdict: "PARTIAL",
      message:
        "Synthetic-recalibrated borderline (75-90%). Summaries drop a meaningful fraction of load-bearing facts; raw_chunks-by-default becomes mandatory rather than optional.",
    };
  }
  return {
    gate: "FAIL",
    verdict: "INVALIDATED",
    message:
      "Below the synthetic-recalibrated floor (<75%). Summaries do not preserve load-bearing facts reliably — synthesis-only contract is broken; re-open envelope architecture.",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Spike 002 — summarization fidelity`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Shared samples: ${SHARED_SAMPLES}\n`);
  const loadBearing = JSON.parse(await readFile(resolve(ROOT, "load-bearing-facts.json"), "utf8"));
  const allResults = [];
  for (const { id, file } of BUCKETS) {
    console.log(`### ${id}`);
    const bucketResults = await runBucket(id, file, loadBearing);
    allResults.push(...bucketResults);
    console.log();
  }
  const agg = aggregate(allResults);
  const gate = decideGate(agg.overall.recall);

  console.log(
    `\nOverall fact-preservation: ${(agg.overall.recall * 100).toFixed(1)}%  (${agg.overall.preserved}/${agg.overall.total} facts, errors=${agg.overall.errored})`,
  );
  for (const [k, v] of Object.entries(agg.byBucket)) {
    console.log(
      `  ${k.padEnd(18)} R=${(v.recall * 100).toFixed(1)}%  (${v.preserved}/${v.total}, n=${v.n})`,
    );
  }
  console.log(`\nDecision gate: ${gate.gate} — ${gate.verdict}`);
  console.log(`  ${gate.message}`);

  const out = {
    spike: "002-summarization-fidelity",
    endpoint: ENDPOINT,
    timestamp: new Date().toISOString(),
    samples: allResults,
    aggregate: agg,
    gate,
  };
  await writeFile(resolve(ROOT, "results/results.json"), JSON.stringify(out, null, 2));
  await writeFile(resolve(ROOT, "results/results.html"), renderHtml(out));
  console.log(`\nResults: ${resolve(ROOT, "results/results.json")}`);
  console.log(`Viewer:  ${resolve(ROOT, "results/results.html")}`);
}

function renderHtml(out) {
  const rows = out.samples
    .map((r) => {
      const tag = !r.score
        ? `<span style="color:#b91c1c">ERROR</span>`
        : r.score.recall >= 0.9
          ? `<span style="color:#16a34a">✓ ${(r.score.recall * 100).toFixed(0)}%</span>`
          : r.score.recall >= 0.75
            ? `<span style="color:#ca8a04">⚠ ${(r.score.recall * 100).toFixed(0)}%</span>`
            : `<span style="color:#dc2626">✗ ${(r.score.recall * 100).toFixed(0)}%</span>`;
      const facts = r.score
        ? r.score.facts
            .map((f) => {
              const c = f.preserved ? "#16a34a" : "#dc2626";
              const sym = f.preserved ? "✓" : "✗";
              return `<li style="color:${c}">${sym} ${escapeHtml(f.fact)}</li>`;
            })
            .join("")
        : `<li style="color:#b91c1c">${escapeHtml(r.error || "n/a")}</li>`;
      return `<details><summary><strong>${r.id}</strong> (${r.bucket}) — ${tag} — ${r.elapsed_ms}ms</summary>
        <div style="padding:8px 16px;background:#f8fafc">
          <p style="font-style:italic;color:#64748b">Input: ${escapeHtml(r.content)}</p>
          <p><strong>Summary:</strong> ${escapeHtml(r.summary || "(none)")}</p>
          <p><strong>Load-bearing facts:</strong></p>
          <ul>${facts}</ul>
        </div>
      </details>`;
    })
    .join("");
  const byBucket = Object.entries(out.aggregate.byBucket)
    .map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v.n}</td><td>${v.preserved}/${v.total}</td><td>${(v.recall * 100).toFixed(1)}%</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Spike 002 results</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#0f172a}
h1{margin-bottom:0}.gate{padding:1rem;border-radius:8px;margin:1rem 0}
.PASS{background:#dcfce7;border:1px solid #16a34a}
.BORDERLINE{background:#fef9c3;border:1px solid #ca8a04}
.FAIL{background:#fee2e2;border:1px solid #dc2626}
table{border-collapse:collapse;margin:1rem 0}
th,td{border:1px solid #e2e8f0;padding:6px 12px;font-size:14px}
details{margin:8px 0;border:1px solid #e2e8f0;border-radius:6px}
summary{padding:8px 12px;cursor:pointer;background:#f8fafc}</style></head><body>
<h1>Spike 002 — Summarization Fidelity</h1>
<p style="color:#64748b">Workers AI <code>@cf/meta/llama-3.1-8b-instruct</code> · plain-text summarization · ${out.timestamp}</p>
<div class="gate ${out.gate.gate}">
  <strong>${out.gate.gate} — ${out.gate.verdict}</strong>
  <p>Overall fact preservation: ${(out.aggregate.overall.recall * 100).toFixed(1)}% (${out.aggregate.overall.preserved}/${out.aggregate.overall.total} facts)</p>
  <p>${out.gate.message}</p>
</div>
<h2>Per-bucket</h2>
<table><thead><tr><th>Bucket</th><th>N</th><th>Facts (preserved/total)</th><th>Recall</th></tr></thead><tbody>${byBucket}</tbody></table>
<h2>Per-sample</h2>${rows}
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
