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

// Shape of one item in the CF DO Namespace List API response.
//
// IMPORTANT: this endpoint returns the internal hex DO id (the SHA-256-ish
// hash produced by `idFromName(workspace_id)`) — NOT the original
// `workspace_id`. The hash is one-way; you cannot recover the workspace_id
// from the hex. The earlier audit-script revision incorrectly assumed a
// `name` field was present and looped forever on the pagination cursor.
//
// `hasStoredData` is `true` for DOs that have actually been initialized
// (i.e. have a non-empty SQLite store). Ephemeral pre-binding instances —
// if any — would be `false`; the audit script ignores them.
interface DoInstance {
  id: string;
  hasStoredData?: boolean;
}

// Cloudflare returns `cursor: ""` (empty string), `null`, OR omits the
// field entirely on the final page depending on which API surface and
// year you ask. Treat `null | "" | undefined` as "no more pages". The
// `?` on cursor lets the runtime check for `undefined` typecheck cleanly.
interface DoListPage {
  result: DoInstance[];
  result_info: {
    count: number;
    cursor?: string | null;
  };
  success: boolean;
  errors: { code: number; message: string }[] | null;
}

// Belt-and-suspenders pagination cap. The page size is 1000 instances, so
// 100 pages = 100,000 workspaces — well above any plausible single-account
// scale and far below an infinite loop. If we ever hit this, the script
// will exit 2 with a clear error instead of running until CI timeout.
const MAX_PAGES = 100;

async function listDurableObjectIds(): Promise<string[]> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/durable_objects/namespaces/${NS_ID}/objects`;
  const ids: string[] = [];
  let cursor: string | null = null;
  let pageNumber = 0;

  // Pagination: loop until cursor is null/empty/undefined OR the page
  // returns zero results (defense against APIs that hand back a stale
  // non-null cursor on the empty trailing page). The `done` flag drives
  // termination; `do {} while (true)` would lint as a constant condition.
  let done = false;
  while (!done) {
    pageNumber += 1;
    if (pageNumber > MAX_PAGES) {
      stderr.write(
        `${TAG} FATAL: pagination exceeded ${String(MAX_PAGES)} pages — suspected runaway. Last cursor: '${cursor ?? "(null)"}'.\n`,
      );
      process.exit(2);
    }

    const url = new URL(base);
    url.searchParams.set("limit", "1000");
    if (cursor !== null && cursor !== "") url.searchParams.set("cursor", cursor);

    if (dryRun) {
      stdout.write(`${TAG} [dry-run] GET ${url.toString()}\n`);
      done = true;
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
      const errSummary = (page.errors ?? [])
        .map((e) => `${String(e.code)}: ${e.message}`)
        .join("; ");
      stderr.write(`${TAG} FATAL: DO Namespace List API error: ${errSummary}\n`);
      process.exit(2);
    }

    // Per-page progress: visible in CI logs so a future runaway is obvious.
    stdout.write(
      `${TAG} page ${String(pageNumber)}: ${String(page.result.length)} instances, cursor=${cursor === null ? "(initial)" : cursor === "" ? "(empty)" : "(set)"}\n`,
    );

    for (const instance of page.result) {
      // Skip instances with no stored data — they have nothing to audit.
      // (This filter was previously `instance.name !== null` against a
      // field that doesn't exist on this endpoint; replaced with the
      // semantically correct `hasStoredData` check.)
      if (instance.hasStoredData !== false) {
        ids.push(instance.id);
      }
    }

    // Terminate on null, empty, or undefined cursor. Belt-and-suspenders:
    // also terminate if the page returned zero results — covers any future
    // API quirk where a non-null cursor still means "end of stream."
    const next = page.result_info.cursor;
    if (next === null || next === "" || next === undefined || page.result.length === 0) {
      done = true;
    } else {
      cursor = next;
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Per-DO audit RPC via /__admin/embedding-audit
// ---------------------------------------------------------------------------
//
// The enumeration path (--workspace omitted) collects internal hex DO ids
// from the Cloudflare DO Namespace List API and posts each as `do_id` to
// the Worker. The new-shape response includes `workspace_name` for
// debugging (populated when the DO is currently warm and was originally
// addressed by name; null otherwise).
//
// The single-workspace path (--workspace <name>) keeps using `workspace_id`
// — the Worker's legacy path with the assertOwnsWorkspace guard.

interface AuditResultByDoId {
  do_id: string;
  workspace_name: string | null;
  count_stale: number;
}

interface AuditResultByWorkspaceId {
  workspace_id: string;
  count_stale: number;
}

// Normalized internal shape — the reporter doesn't care which lookup path
// produced the result. `label` is what we show in the summary table.
interface AuditResult {
  label: string; // do_id (hex) OR workspace_id (name), depending on path
  workspace_name: string | null;
  count_stale: number;
}

async function auditByDoId(doId: string): Promise<AuditResult> {
  const url = `${ADMIN_WORKER_URL}/__admin/embedding-audit?do_id=${encodeURIComponent(doId)}`;

  if (dryRun) {
    stdout.write(
      `${TAG} [dry-run] POST ${ADMIN_WORKER_URL}/__admin/embedding-audit?do_id=${doId}\n`,
    );
    return { label: doId, workspace_name: null, count_stale: 0 };
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "X-Engram-Admin-Token": ADMIN_AUDIT_TOKEN },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    stderr.write(
      `${TAG} ERROR: audit RPC for DO '${doId}' failed: ${reason}. Check that ${ADMIN_WORKER_URL} is deployed with the do_id endpoint and responding.\n`,
    );
    process.exit(2);
  }

  if (!resp.ok) {
    stderr.write(
      `${TAG} ERROR: audit RPC for DO '${doId}' returned ${String(resp.status)} ${resp.statusText}\n`,
    );
    process.exit(2);
  }

  const payload = (await resp.json()) as AuditResultByDoId;
  return {
    label: payload.do_id,
    workspace_name: payload.workspace_name,
    count_stale: payload.count_stale,
  };
}

async function auditByWorkspaceId(workspaceId: string): Promise<AuditResult> {
  const url = `${ADMIN_WORKER_URL}/__admin/embedding-audit?workspace_id=${encodeURIComponent(workspaceId)}`;

  if (dryRun) {
    stdout.write(
      `${TAG} [dry-run] POST ${ADMIN_WORKER_URL}/__admin/embedding-audit?workspace_id=${workspaceId}\n`,
    );
    return { label: workspaceId, workspace_name: workspaceId, count_stale: 0 };
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "X-Engram-Admin-Token": ADMIN_AUDIT_TOKEN },
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

  const payload = (await resp.json()) as AuditResultByWorkspaceId;
  return {
    label: payload.workspace_id,
    workspace_name: payload.workspace_id,
    count_stale: payload.count_stale,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  stdout.write(`${TAG} PRE-01 embedding-version migration audit starting\n`);

  const results: AuditResult[] = [];

  if (workspaceOverride) {
    // --workspace <name>: legacy path — single named workspace.
    stdout.write(`${TAG} Single-workspace mode: auditing '${workspaceOverride}'\n`);
    const result = await auditByWorkspaceId(workspaceOverride);
    results.push(result);
  } else {
    // Enumeration path — list DOs by internal hex id, fan out per DO.
    stdout.write(`${TAG} Enumerating all WorkspaceDO instances via DO Namespace List API...\n`);
    const doIds = await listDurableObjectIds();
    if (dryRun) {
      stdout.write(
        `${TAG} [dry-run] Would audit ${String(doIds.length)} DO(s) from namespace ${NS_ID}\n`,
      );
      process.exit(0);
    }
    stdout.write(`${TAG} Found ${String(doIds.length)} DO instance(s) with stored data\n`);

    if (doIds.length === 0) {
      stdout.write(`${TAG} No DOs found — exiting clean (0)\n`);
      process.exit(0);
    }

    for (const doId of doIds) {
      const result = await auditByDoId(doId);
      results.push(result);
    }
  }

  // Tally and report
  const stale = results.filter((r) => r.count_stale > 0);
  const totalStale = results.reduce((sum, r) => sum + r.count_stale, 0);

  // Markdown summary table (stdout — CI step captures this as output)
  stdout.write("\n## PRE-01 Embedding-Version Audit Results\n\n");
  stdout.write("| identifier | workspace_name | count_stale |\n");
  stdout.write("|---|---|---|\n");
  for (const r of results) {
    stdout.write(
      `| ${r.label} | ${r.workspace_name ?? "(unknown)"} | ${String(r.count_stale)} |\n`,
    );
  }
  stdout.write(
    `\n**Total stale blocks:** ${String(totalStale)} across ${String(stale.length)} DO(s)\n\n`,
  );

  if (stale.length > 0) {
    stderr.write(
      `${TAG} FAIL: ${String(totalStale)} stale embedding(s) found across ${String(stale.length)} DO(s):\n`,
    );
    for (const r of stale) {
      // T-01-02: only log identifier + count — never block content
      stderr.write(
        `${TAG}   id=${r.label} workspace_name=${r.workspace_name ?? "(unknown)"} count_stale=${String(r.count_stale)}\n`,
      );
    }
    stderr.write(
      `${TAG} Re-embed stale blocks before v0.2 recall goes live (see PRE-01 remediation steps).\n`,
    );
    process.exit(1);
  }

  stdout.write(`${TAG} PASS: all ${String(results.length)} DO(s) report count_stale=0\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  // T-01-02: catch-all must not echo env vars — message is caller-controlled
  const message = err instanceof Error ? err.message : "unknown error";
  stderr.write(`${TAG} FATAL: unexpected error: ${message}\n`);
  process.exit(2);
});
