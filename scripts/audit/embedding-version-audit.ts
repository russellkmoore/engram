// scripts/audit/embedding-version-audit.ts
// Source: PRE-01 (v0.2 Phase 1 catastrophic-severity gate)
//
// Verifies that ZERO blocks in ANY workspace carry a stale embedding stamp
// (NULL, embedding_version < 2, or embedding_model != '@cf/qwen/qwen3-embedding-0.6b').
// Exits 1 on any non-zero count_stale; the CI workflow consumes the exit code.
//
// Transport: calls `POST /__admin/embedding-audit?workspace_id=<ws>` on the
// deployed mcp-server Worker (or ADMIN_WORKER_URL env var override) with the
// X-Engram-Admin-Token header. The Worker proxies to WorkspaceDO.assertAllBlocksAtV2
// (not an MCP tool — admin-only, PRE-01 guard).
//
// Usage:
//   tsx scripts/audit/embedding-version-audit.ts [--dry-run] [--workspace <id>] [--help]
//
//   --dry-run:    OPTIONAL. Print the planned API calls WITHOUT executing them.
//   --workspace:  OPTIONAL. Audit a single workspace_id instead of enumerating all.
//   --help / -h:  Print this usage and exit 0.
//
// Exit codes: 0 clean (all count_stale = 0) | 1 stale rows found | 2 bad env / CF API error
//
// Requires env:
//   CLOUDFLARE_API_TOKEN     — Cloudflare account API token (Workers:Read scope)
//   CLOUDFLARE_ACCOUNT_ID    — Cloudflare account ID
//   WORKSPACE_NAMESPACE_ID   — WorkspaceDO namespace ID. Look up via the Cloudflare REST API:
//                              curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/durable_objects/namespaces" \
//                                -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
//                                | jq '.result[] | select(.script == "engram-mcp-server" and .class == "WorkspaceDO") | .id'
//                              (the older `wrangler durable-objects namespace list` subcommand does not exist in wrangler 4.x)
//   ENGRAM_ADMIN_AUDIT_TOKEN — Shared secret set on the mcp-server Worker via wrangler secret put
//   ADMIN_WORKER_URL         — OPTIONAL. Override the mcp-server URL (default: https://engram-mcp-server.workers.dev)
//
// SECURITY (T-01-02): This script NEVER logs CLOUDFLARE_API_TOKEN, WORKSPACE_NAMESPACE_ID,
// or ENGRAM_ADMIN_AUDIT_TOKEN. Env vars are read once and used in headers only.
// No `set -x` equivalent. No positional argv exposure of tokens.

import { stderr, stdout } from "node:process";

const TAG = "[audit]";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function usage(stream: NodeJS.WriteStream): void {
  stream.write(
    `${TAG} usage: tsx scripts/audit/embedding-version-audit.ts [--dry-run] [--workspace <id>] [--help]\n` +
      `${TAG}   --dry-run:   print planned API calls WITHOUT executing\n` +
      `${TAG}   --workspace: audit a single workspace_id (skip full enumeration)\n` +
      `${TAG}   --help / -h: print this usage and exit 0\n` +
      `${TAG} exit codes: 0 clean | 1 stale rows found | 2 bad env / CF API error\n`,
  );
}

const args = process.argv.slice(2);
let dryRun = false;
let workspaceOverride = "";
let showHelp = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") {
    dryRun = true;
  } else if (a === "--workspace") {
    const val = args[++i];
    if (!val) {
      stderr.write(`${TAG} FATAL: --workspace requires a non-empty workspace_id argument\n`);
      usage(stderr);
      process.exit(2);
    }
    workspaceOverride = val;
  } else if (a === "--help" || a === "-h") {
    showHelp = true;
  }
}

if (showHelp) {
  usage(stdout);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Env validation (exit 2 on missing — distinct from exit 1 "stale rows found")
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    stderr.write(`${TAG} FATAL: ${name} missing\n`);
    process.exit(2);
  }
  return val;
}

const CF_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN");
const CF_ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID");
const NS_ID = requireEnv("WORKSPACE_NAMESPACE_ID");
const ADMIN_AUDIT_TOKEN = requireEnv("ENGRAM_ADMIN_AUDIT_TOKEN");
const ADMIN_WORKER_URL = process.env.ADMIN_WORKER_URL ?? "https://engram-mcp-server.workers.dev";

// ---------------------------------------------------------------------------
// Cloudflare DO Namespace List API — enumerate workspace IDs
// RESEARCH §Cross-workspace enumeration
// ---------------------------------------------------------------------------

interface DoInstance {
  id: string;
  name: string | null;
}

interface DoListPage {
  result: DoInstance[];
  result_info: {
    count: number;
    cursor: string | null;
  };
  success: boolean;
  errors: { code: number; message: string }[];
}

async function listWorkspaceIds(): Promise<string[]> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/durable_objects/namespaces/${NS_ID}/objects`;
  const ids: string[] = [];
  let cursor: string | null = null;

  // Pagination: loop until result_info.cursor is null
  do {
    const url = new URL(base);
    url.searchParams.set("limit", "1000");
    if (cursor !== null) url.searchParams.set("cursor", cursor);

    if (dryRun) {
      stdout.write(`${TAG} [dry-run] GET ${url.toString()}\n`);
      break;
    }

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        headers: {
          // T-01-02: token passed as HTTP header ONLY — never logged
          Authorization: `Bearer ${CF_TOKEN}`,
          "Content-Type": "application/json",
        },
        // Defense against indefinite hang on a non-responding Cloudflare API.
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      stderr.write(`${TAG} FATAL: DO Namespace List API request failed: ${reason}\n`);
      process.exit(2);
    }

    if (!resp.ok) {
      stderr.write(
        `${TAG} FATAL: DO Namespace List API returned ${String(resp.status)} ${resp.statusText}\n`,
      );
      process.exit(2);
    }

    const page = (await resp.json()) as DoListPage;

    if (!page.success) {
      const errSummary = page.errors.map((e) => `${String(e.code)}: ${e.message}`).join("; ");
      stderr.write(`${TAG} FATAL: DO Namespace List API error: ${errSummary}\n`);
      process.exit(2);
    }

    for (const instance of page.result) {
      // Filter out unnamed instances (pre-binding ephemeral DOs — safe to skip per RESEARCH A2)
      if (instance.name !== null) {
        ids.push(instance.name);
      }
    }

    cursor = page.result_info.cursor;
  } while (cursor !== null);

  return ids;
}

// ---------------------------------------------------------------------------
// Per-workspace audit RPC via /__admin/embedding-audit
// ---------------------------------------------------------------------------

interface AuditResult {
  workspace_id: string;
  count_stale: number;
}

async function auditWorkspace(workspaceId: string): Promise<AuditResult> {
  const url = `${ADMIN_WORKER_URL}/__admin/embedding-audit?workspace_id=${encodeURIComponent(workspaceId)}`;

  if (dryRun) {
    stdout.write(
      `${TAG} [dry-run] POST ${ADMIN_WORKER_URL}/__admin/embedding-audit?workspace_id=${workspaceId}\n`,
    );
    return { workspace_id: workspaceId, count_stale: 0 };
  }

  // T-01-02: admin token passed as header ONLY — never logged.
  // 30s per-workspace timeout — without this a missing/misbehaving Worker
  // hangs the script indefinitely (CI run 26998314988 hung 33min on this).
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "X-Engram-Admin-Token": ADMIN_AUDIT_TOKEN,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    stderr.write(
      `${TAG} ERROR: audit RPC for workspace '${workspaceId}' failed: ${reason}. Check that ${ADMIN_WORKER_URL} is deployed and responding.\n`,
    );
    process.exit(2);
  }

  if (!resp.ok) {
    stderr.write(
      `${TAG} ERROR: audit RPC for workspace '${workspaceId}' returned ${String(resp.status)} ${resp.statusText}\n`,
    );
    process.exit(2);
  }

  return (await resp.json()) as AuditResult;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  stdout.write(`${TAG} PRE-01 embedding-version migration audit starting\n`);

  let workspaceIds: string[];
  if (workspaceOverride) {
    stdout.write(`${TAG} Single-workspace mode: auditing '${workspaceOverride}'\n`);
    workspaceIds = [workspaceOverride];
  } else {
    stdout.write(`${TAG} Enumerating all WorkspaceDO instances via DO Namespace List API...\n`);
    workspaceIds = await listWorkspaceIds();
    if (dryRun) {
      stdout.write(`${TAG} [dry-run] Would audit workspaces from namespace ${NS_ID}\n`);
      process.exit(0);
    }
    stdout.write(`${TAG} Found ${workspaceIds.length.toString()} workspace(s)\n`);
  }

  if (workspaceIds.length === 0) {
    stdout.write(`${TAG} No workspaces found — exiting clean (0)\n`);
    process.exit(0);
  }

  // Fan out audit RPC per workspace
  const results: AuditResult[] = [];
  for (const wsId of workspaceIds) {
    const result = await auditWorkspace(wsId);
    results.push(result);
  }

  // Tally and report
  const staleWorkspaces = results.filter((r) => r.count_stale > 0);
  const totalStale = results.reduce((sum, r) => sum + r.count_stale, 0);

  // Markdown summary table (stdout — CI step captures this as output)
  stdout.write("\n## PRE-01 Embedding-Version Audit Results\n\n");
  stdout.write("| workspace_id | count_stale |\n");
  stdout.write("|---|---|\n");
  for (const r of results) {
    stdout.write(`| ${r.workspace_id} | ${r.count_stale.toString()} |\n`);
  }
  stdout.write(
    `\n**Total stale blocks:** ${totalStale.toString()} across ${staleWorkspaces.length.toString()} workspace(s)\n\n`,
  );

  if (staleWorkspaces.length > 0) {
    stderr.write(
      `${TAG} FAIL: ${totalStale.toString()} stale embedding(s) found across ${staleWorkspaces.length.toString()} workspace(s):\n`,
    );
    for (const r of staleWorkspaces) {
      // T-01-02: only log workspace_id and count — never block content
      stderr.write(
        `${TAG}   workspace=${r.workspace_id} count_stale=${r.count_stale.toString()}\n`,
      );
    }
    stderr.write(
      `${TAG} Re-embed stale blocks before v0.2 recall goes live (see PRE-01 remediation steps).\n`,
    );
    process.exit(1);
  }

  stdout.write(
    `${TAG} PASS: all ${workspaceIds.length.toString()} workspace(s) report count_stale=0\n`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  // T-01-02: catch-all must not echo env vars — message is caller-controlled
  const message = err instanceof Error ? err.message : "unknown error";
  stderr.write(`${TAG} FATAL: unexpected error: ${message}\n`);
  process.exit(2);
});
