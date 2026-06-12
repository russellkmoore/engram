// scripts/eval-budget-summary.mjs
// PRE-02 daily neuron-consumption summary — reads the Cloudflare GraphQL
// Analytics API `aiInferenceAdaptive` dataset at account level and prints
// a markdown table of neuron consumption to stdout.
//
// Usage:
//   node scripts/eval-budget-summary.mjs [--since <ISO8601>] [--conflict-pipeline-p99] [--help]
//
//   --since <ISO8601>:          OPTIONAL. Start of the reporting window (default: 24h ago).
//                               Only applies to the nightly-summary mode.
//   --conflict-pipeline-p99:   Run the CON-07 p99 budget check against the Analytics Engine
//                               SQL API. Queries conflict-pipeline latency data (D-20 schema)
//                               from the last 24h and reports against the 4s p99 budget.
//   --help / -h:                Print this usage and exit 0.
//
// Exit codes (nightly-summary mode): 0 success | 1 GraphQL/parse error | 2 missing env var.
//
// Exit codes (--conflict-pipeline-p99 mode):
//   0 — PASS: sample_count > 0 AND p99 < 4000ms (CON-07 budget met)
//   1 — FAIL: sample_count > 0 AND p99 >= 4000ms (CON-07 budget breach)
//   2 — HTTP error or unparseable response from Analytics Engine SQL API
//   3 — Insufficient data: sample_count = 0 (early in production lifecycle; soft warn)
//
// Required env:
//   CLOUDFLARE_API_TOKEN   — Workers AI:Read scope sufficient (read-only GraphQL + AE SQL API)
//   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account ID
//
// SECURITY: CLOUDFLARE_API_TOKEN is read from env only; NEVER printed to stdout
// or stderr. No `set -x` equivalent. The script performs only read-only queries
// (no mutations, no PII). See threat-model T-01-02 in 01-02-PLAN.md and
// T-02-09-01..04 in 02-09-PLAN.md.
//
// Source: PRE-02 (v0.2 Phase 1 eval-budget discipline); extended by Plan 02-09 (CON-07 p99 budget loop)

import { argv, exit, stdout, stderr } from "node:process";

const TAG = "[eval-budget-summary]";

// ──────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ──────────────────────────────────────────────────────────────────────────────

const args = argv.slice(2);
let sinceOverride = "";
let showHelp = false;
let mode = "nightly-summary"; // default — preserve existing behavior

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--since") {
    sinceOverride = args[++i] ?? "";
  } else if (a === "--conflict-pipeline-p99") {
    mode = "conflict-pipeline-p99";
  } else if (a === "--help" || a === "-h") {
    showHelp = true;
  }
}

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/eval-budget-summary.mjs [--since <ISO8601>] [--conflict-pipeline-p99] [--help]\n` +
      `${TAG}   --since <ISO8601>:          OPTIONAL. Start of the reporting window (nightly-summary mode only). Default: 24h ago.\n` +
      `${TAG}   --conflict-pipeline-p99:   Query Analytics Engine SQL API for conflict-pipeline p99 latency (CON-07 budget).\n` +
      `${TAG}   --help / -h:                Print this usage and exit 0.\n` +
      `${TAG}\n` +
      `${TAG} Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID\n` +
      `${TAG} Exit codes (nightly-summary): 0 success | 1 GraphQL/parse error | 2 missing env var\n` +
      `${TAG} Exit codes (--conflict-pipeline-p99): 0 PASS | 1 budget breach (p99>=4000ms) | 2 HTTP/parse error | 3 insufficient data\n`,
  );
}

if (showHelp) {
  usage(stdout);
  exit(0);
}

// Validate --since value before hitting the API (WR-04): a malformed date
// produces a confusing "HTTP 400" GraphQL error with no indication the input
// was the cause. Fail loudly here with a clear usage error instead.
if (sinceOverride) {
  const parsed = new Date(sinceOverride);
  if (isNaN(parsed.getTime())) {
    stderr.write(
      `${TAG} FATAL: --since value '${sinceOverride}' is not a valid ISO 8601 datetime.\n`,
    );
    usage(stderr);
    exit(2);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Env validation — fail loud with exit 2 on missing creds
// ──────────────────────────────────────────────────────────────────────────────

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!CLOUDFLARE_API_TOKEN) {
  stderr.write(`${TAG} FATAL: CLOUDFLARE_API_TOKEN missing — set via env before running.\n`);
  exit(2);
}

if (!CLOUDFLARE_ACCOUNT_ID) {
  stderr.write(`${TAG} FATAL: CLOUDFLARE_ACCOUNT_ID missing — set via env before running.\n`);
  exit(2);
}

// ──────────────────────────────────────────────────────────────────────────────
// Mode dispatch
// ──────────────────────────────────────────────────────────────────────────────

if (mode === "conflict-pipeline-p99") {
  await runConflictPipelineP99Mode();
  // runConflictPipelineP99Mode always calls exit() internally — this line is
  // a safety fallback in case of an unexpected code path.
  exit(0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Nightly-summary mode (default) — Time window construction
// ──────────────────────────────────────────────────────────────────────────────

const now = new Date();
const endTime = now.toISOString();
const startTime = sinceOverride
  ? sinceOverride
  : new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

stderr.write(`${TAG} window: ${startTime} → ${endTime}\n`);

// ──────────────────────────────────────────────────────────────────────────────
// Cloudflare GraphQL Analytics — aiInferenceAdaptive dataset
// Source: RESEARCH §Example 4 (v0.2 Phase 1 01-RESEARCH.md)
// ──────────────────────────────────────────────────────────────────────────────

const query = `
  query NeuronUsage($accountTag: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        aiInferenceAdaptiveGroups(
          limit: 1000
          filter: { datetime_geq: $start, datetime_leq: $end }
        ) {
          sum { requests tokensInput tokensOutput }
          dimensions { modelName datetime }
        }
      }
    }
  }
`;

let resp;
try {
  resp = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: CLOUDFLARE_ACCOUNT_ID,
        start: startTime,
        end: endTime,
      },
    }),
  });
} catch (err) {
  stderr.write(`${TAG} FATAL: network error — ${String(err)}\n`);
  exit(1);
}

if (!resp.ok) {
  stderr.write(`${TAG} FATAL: GraphQL request failed — HTTP ${String(resp.status)}\n`);
  exit(1);
}

let body;
try {
  body = await resp.json();
} catch (err) {
  stderr.write(`${TAG} FATAL: failed to parse GraphQL response — ${String(err)}\n`);
  exit(1);
}

// ──────────────────────────────────────────────────────────────────────────────
// Parse response and build markdown table
// ──────────────────────────────────────────────────────────────────────────────

const groups = body?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];

if (!Array.isArray(groups)) {
  stderr.write(`${TAG} ERROR: unexpected response shape — check Cloudflare GraphQL API status.\n`);
  exit(1);
}

if (groups.length === 0) {
  stderr.write(
    `${TAG} WARNING: no aiInferenceAdaptive data for this window. ` +
      `The dataset may not surface for Workers AI usage outside of AI Gateway. ` +
      `If eval tests ran, verify the EVAL_BUDGET_AE Analytics Engine binding is wired.\n`,
  );
  stdout.write(`\n${TAG} No data found for window ${startTime} → ${endTime}\n`);
  exit(0);
}

// Aggregate by model and date
const rows = groups.map((g) => {
  const model = String(g?.dimensions?.modelName ?? "unknown");
  const datetime = String(g?.dimensions?.datetime ?? "unknown");
  const totalNeurons = Number(g?.sum?.tokensInput ?? 0) + Number(g?.sum?.tokensOutput ?? 0);
  const requests = Number(g?.sum?.requests ?? 0);
  const avgNeurons = requests > 0 ? Math.round(totalNeurons / requests) : 0;
  return { model, datetime, totalNeurons, requests, avgNeurons };
});

// Print markdown table to stdout
stdout.write(`\n## Eval Budget Summary — ${startTime} → ${endTime}\n\n`);
stdout.write(`| Date | Model | Total Neurons | AI Calls | Avg neurons/call |\n`);
stdout.write(`|------|-------|--------------|----------|------------------|\n`);
for (const row of rows) {
  stdout.write(
    `| ${row.datetime} | ${row.model} | ${String(row.totalNeurons)} | ${String(row.requests)} | ${String(row.avgNeurons)} |\n`,
  );
}

// Compute totals
const totalNeurons = rows.reduce((s, r) => s + r.totalNeurons, 0);
const totalCalls = rows.reduce((s, r) => s + r.requests, 0);
const overallAvg = totalCalls > 0 ? Math.round(totalNeurons / totalCalls) : 0;
stdout.write(
  `| **TOTAL** | | **${String(totalNeurons)}** | **${String(totalCalls)}** | **${String(overallAvg)}** |\n\n`,
);

stderr.write(`${TAG} Done. ${String(rows.length)} model/day group(s) found.\n`);
exit(0);

// ──────────────────────────────────────────────────────────────────────────────
// --conflict-pipeline-p99 mode (CON-07 p99 budget loop)
// Plan 02-09: closes CON-07 observability by querying Analytics Engine SQL API
// for D-20 data points emitted by conflict-pipeline.ts (Plan 02-06).
//
// D-20 schema (byte-frozen per AI-SPEC.md §7 — confirmed from conflict-pipeline.ts):
//   blob1  = "conflict-pipeline"   (filter key)
//   blob2  = <verdict>             (contradiction|benign_update|unrelated|skipped-dupe|error)
//   blob3  = <wsTag>               (sha256-prefix of workspace_id)
//   blob4  = "ok" | "failed"
//   double1 = latency_ms           (Date.now() - start)
//   double2 = neighbors_examined
//   double3 = 0 (reserved)
//   double4 = error_flag           (1 if verdict="error", else 0)
//
// CON-07 budget: p99(double1) MUST be < 4000ms.
// Auth: same CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env vars as nightly-summary mode.
// ──────────────────────────────────────────────────────────────────────────────

async function runConflictPipelineP99Mode() {
  // CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID already validated above.

  const sql = [
    "SELECT",
    "  quantileTDigest(0.50)(double1) AS p50,",
    "  quantileTDigest(0.95)(double1) AS p95,",
    "  quantileTDigest(0.99)(double1) AS p99,",
    "  COUNT(*) AS sample_count,",
    "  SUM(double2) AS total_neighbors_examined",
    "FROM engram_ai_analytics",
    "WHERE blob1 = 'conflict-pipeline'",
    "  AND timestamp > NOW() - INTERVAL '24' HOUR",
  ].join("\n");

  stderr.write(`${TAG} [conflict-pipeline-p99] querying Analytics Engine SQL API (last 24h)...\n`);

  let aeResp;
  try {
    aeResp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "text/plain",
        },
        body: sql,
      },
    );
  } catch (err) {
    stderr.write(
      `${TAG} [conflict-pipeline-p99] FATAL: network error querying Analytics Engine SQL API — ${String(err)}\n`,
    );
    exit(2);
  }

  if (!aeResp.ok) {
    // Sanitize: do NOT log the response body (may contain account-level metadata).
    // T-02-09-01: never echo API token or account-metadata back to the terminal.
    stderr.write(
      `${TAG} [conflict-pipeline-p99] FATAL: Analytics Engine SQL API returned HTTP ${String(aeResp.status)}. ` +
        `Verify CLOUDFLARE_API_TOKEN has Analytics Engine Read scope and CLOUDFLARE_ACCOUNT_ID is correct.\n`,
    );
    exit(2);
  }

  let aeBody;
  try {
    aeBody = await aeResp.json();
  } catch (err) {
    stderr.write(
      `${TAG} [conflict-pipeline-p99] FATAL: failed to parse Analytics Engine SQL API response — ${String(err)}\n`,
    );
    exit(2);
  }

  // The AE SQL API returns: { meta: [...], data: [{ p50, p95, p99, sample_count, total_neighbors_examined }], rows: 1, ... }
  // Defensive: also handle older surface { result: [...] } shape.
  const dataArray = Array.isArray(aeBody?.data)
    ? aeBody.data
    : Array.isArray(aeBody?.result)
      ? aeBody.result
      : null;

  if (!dataArray) {
    stderr.write(
      `${TAG} [conflict-pipeline-p99] FATAL: unexpected Analytics Engine SQL API response shape ` +
        `(expected data[] or result[] array).\n`,
    );
    exit(2);
  }

  const row = dataArray[0];

  if (!row) {
    stderr.write(
      `${TAG} [conflict-pipeline-p99] FATAL: Analytics Engine SQL API returned no rows.\n`,
    );
    exit(2);
  }

  const sampleCount = Number(row.sample_count ?? 0);

  if (sampleCount === 0) {
    // Exit 3: insufficient data — early in production lifecycle, not a hard failure.
    stdout.write(
      `\n${TAG} [conflict-pipeline-p99] CON-07 budget check: INSUFFICIENT DATA\n` +
        `${TAG}   No conflict-pipeline data points found in the last 24h.\n` +
        `${TAG}   This is expected early in the production lifecycle before any blocks are stored.\n` +
        `${TAG}   Re-run after conflict-pipeline.ts has processed at least one block.\n`,
    );
    stderr.write(`${TAG} [conflict-pipeline-p99] exiting 3 (insufficient data).\n`);
    exit(3);
  }

  const p50 = Number(row.p50 ?? 0);
  const p95 = Number(row.p95 ?? 0);
  const p99 = Number(row.p99 ?? 0);
  const totalNeighbors = Number(row.total_neighbors_examined ?? 0);

  // CON-07 budget: p99(latency_ms) MUST be < 4000ms.
  const CON07_BUDGET_MS = 4000;
  const budgetResult = p99 < CON07_BUDGET_MS ? "PASS" : "FAIL";

  stdout.write(
    `\n${TAG} conflict-pipeline async-branch latency over last 24h (via Analytics Engine SQL API):\n` +
      `${TAG}   sample_count = ${String(sampleCount)}\n` +
      `${TAG}   p50 = ${p50.toFixed(0)}ms, p95 = ${p95.toFixed(0)}ms, p99 = ${p99.toFixed(0)}ms\n` +
      `${TAG}   total neighbors examined (sanity) = ${String(totalNeighbors)}\n` +
      `${TAG}   CON-07 budget: p99 < ${String(CON07_BUDGET_MS)}ms — ${budgetResult}\n`,
  );

  if (budgetResult === "PASS") {
    stderr.write(`${TAG} [conflict-pipeline-p99] CON-07 p99 budget check PASSED.\n`);
    exit(0);
  } else {
    stderr.write(
      `${TAG} [conflict-pipeline-p99] CON-07 p99 budget check FAILED — ` +
        `p99=${p99.toFixed(0)}ms exceeds ${String(CON07_BUDGET_MS)}ms threshold.\n`,
    );
    exit(1);
  }
}
