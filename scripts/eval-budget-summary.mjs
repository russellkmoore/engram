// scripts/eval-budget-summary.mjs
// PRE-02 daily neuron-consumption summary — reads the Cloudflare GraphQL
// Analytics API `aiInferenceAdaptive` dataset at account level and prints
// a markdown table of neuron consumption to stdout.
//
// Usage:
//   node scripts/eval-budget-summary.mjs [--since <ISO8601>] [--help]
//
//   --since <ISO8601>:  OPTIONAL. Start of the reporting window (default: 24h ago).
//   --help / -h:        Print this usage and exit 0.
//
// Exit codes: 0 success | 1 GraphQL / parse error | 2 missing required env var.
//
// Required env:
//   CLOUDFLARE_API_TOKEN   — Workers AI:Read scope sufficient (read-only GraphQL)
//   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account ID
//
// SECURITY: CLOUDFLARE_API_TOKEN is read from env only; NEVER printed to stdout
// or stderr. No `set -x` equivalent. The script performs only a read-only GraphQL
// query (no mutations, no PII). See threat-model T-01-02 in 01-02-PLAN.md.
//
// Source: PRE-02 (v0.2 Phase 1 eval-budget discipline)

import { argv, exit, stdout, stderr } from "node:process";

const TAG = "[eval-budget-summary]";

// ──────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ──────────────────────────────────────────────────────────────────────────────

const args = argv.slice(2);
let sinceOverride = "";
let showHelp = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--since") {
    sinceOverride = args[++i] ?? "";
  } else if (a === "--help" || a === "-h") {
    showHelp = true;
  }
}

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/eval-budget-summary.mjs [--since <ISO8601>] [--help]\n` +
      `${TAG}   --since <ISO8601>:  OPTIONAL. Start of the reporting window. Default: 24h ago.\n` +
      `${TAG}   --help / -h:        Print this usage and exit 0.\n` +
      `${TAG}\n` +
      `${TAG} Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID\n` +
      `${TAG} Exit codes: 0 success | 1 GraphQL/parse error | 2 missing env var\n`,
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
// Time window construction
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
