// scripts/kv-bootstrap.mjs
// Source: D-04 — bootstrap script for the ENGRAM_IDENTITIES KV namespace.
//
// Seeds the OAuth subject → { workspace_id, user_id } mapping into the
// Cloudflare KV namespace `ENGRAM_IDENTITIES`, which the Plan 03-04
// `/authorize` hook reads to populate the JWT `props`. v0.1 single-user
// flow: an operator observes their `sub` claim once (via dev console or
// the 403 fail-closed body printed by `/authorize` for an unknown
// subject), then runs this script with `--sub <observed-sub>` to seed
// the mapping. Subsequent OAuth flows transparently authenticate.
//
// Usage:
//   node scripts/kv-bootstrap.mjs \
//     --sub <oauth-sub> \
//     --workspace-id <id> \
//     --user-id <id> \
//     [--local] [--dry-run]
//
//   --sub:           REQUIRED. OAuth subject claim from first /authorize attempt.
//   --workspace-id:  REQUIRED. Engram workspace id to bind this sub to (WR-05).
//   --user-id:       REQUIRED. Engram user id to bind this sub to (WR-05).
//   --local:         OPTIONAL. Write to the local-mode KV backend
//                    (.wrangler/state/v3/kv/) instead of the remote namespace.
//                    Mirrors `wrangler kv key put --local` semantics; used by
//                    the pure-local `wrangler dev` Inspector smoke (WR-07/WR-08).
//   --dry-run:       OPTIONAL. Print the planned wrangler command WITHOUT
//                    executing it AND WITHOUT logging the parsed identity JSON
//                    value (T-03-KV-LEAK mitigation — see threat model).
//
// Exit codes: 0 success | 1 missing required arg / --help | 2 wrangler subprocess failed.
//
// SECURITY (T-03-KV-LEAK): This script is read-only by design — it never
// reads KV values back. The identity JSON value is written to a 0o600
// temp file and passed to wrangler via `--path`; it is NEVER passed as a
// positional CLI argument (which would leak to `ps -ef` / `/proc/<pid>/cmdline`)
// and NEVER echoed to stdout in either real or dry-run mode (the dry-run
// output redacts the JSON to `<identity-json-redacted>`). The `sub` key
// alone IS echoed because it has no secret content (it is the OAuth subject
// claim).

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAG = "[kv:bootstrap]";

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/kv-bootstrap.mjs --sub <oauth-sub> --workspace-id <id> --user-id <id> [--local] [--dry-run]\n` +
      `${TAG}   --sub:          REQUIRED. OAuth subject claim from first /authorize attempt.\n` +
      `${TAG}   --workspace-id: REQUIRED. Engram workspace id (no developer-specific default — WR-05).\n` +
      `${TAG}   --user-id:      REQUIRED. Engram user id (no developer-specific default — WR-05).\n` +
      `${TAG}   --local:        optional. Write to local-mode KV (.wrangler/state/v3/kv/) instead of remote (WR-08).\n` +
      `${TAG}   --dry-run:      optional. Print planned wrangler command WITHOUT executing it (identity JSON redacted).\n` +
      `${TAG}   --help:         print this usage and exit 1.\n` +
      `${TAG} Discoverability: See README.md "Getting Started -> Step 4: First tool call" for the end-to-end bootstrap walkthrough.\n` +
      `${TAG} Exit codes: 0 success | 1 missing arg / --help | 2 wrangler subprocess failed.\n`,
  );
}

const args = process.argv.slice(2);
let sub = "";
// WR-05: workspace-id and user-id are REQUIRED — no developer-specific
// defaults. Empty-string sentinels fail the required-arg check below.
let workspaceId = "";
let userId = "";
// WR-08: pure-local Inspector smoke (WR-07) needs local-mode KV writes.
let useLocal = false;
let dryRun = false;
let showHelp = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case "--sub":
      sub = args[++i] ?? "";
      break;
    case "--workspace-id":
      workspaceId = args[++i] ?? workspaceId;
      break;
    case "--user-id":
      userId = args[++i] ?? userId;
      break;
    case "--local":
      useLocal = true;
      break;
    case "--dry-run":
      dryRun = true;
      break;
    case "--help":
    case "-h":
      showHelp = true;
      break;
    default:
      process.stderr.write(`${TAG} unknown argument: ${arg}\n`);
      usage(process.stderr);
      process.exit(1);
  }
}

if (showHelp) {
  usage(process.stderr);
  process.exit(1);
}

if (!sub) {
  process.stderr.write(`${TAG} ERROR: --sub is required\n`);
  usage(process.stderr);
  process.exit(1);
}

// WR-05: surface missing workspace/user as a loud failure. Previously the
// script silently substituted Russell-specific defaults, which would write
// a stranger's identity record on every fresh OSS clone that forgot the flags.
if (!workspaceId || !userId) {
  process.stderr.write(`${TAG} ERROR: --workspace-id and --user-id are required (WR-05)\n`);
  usage(process.stderr);
  process.exit(1);
}

// Compute the identity JSON locally. NEVER echoed to stdout — see T-03-KV-LEAK.
const identityJson = JSON.stringify({ workspace_id: workspaceId, user_id: userId });

// WR-03 / WR-08: build the wrangler argv. We use `--path <file>` instead
// of a positional JSON argument to keep the identity value out of the
// process table (T-03-KV-LEAK process-table mitigation — `ps -ef`,
// `/proc/<pid>/cmdline`, and `ps auxww` all expose positional args of
// running processes). `--local` is forwarded when set; otherwise we
// default to `--remote` (production KV) so the existing operator
// workflow remains identical for deploys.
const modeFlag = useLocal ? "--local" : "--remote";

if (dryRun) {
  // Print the planned shape WITHOUT the identity JSON (T-03-KV-LEAK).
  // The `sub` is echoed (not a secret); the JSON value is redacted, and
  // the `--path` argument is shown as a placeholder so the operator
  // can verify the wrangler invocation shape without leaking the temp
  // path (which is randomly generated by mkdtemp and worthless to log).
  const dryRunArgs = [
    "wrangler",
    "kv",
    "key",
    "put",
    "--binding",
    "ENGRAM_IDENTITIES",
    modeFlag,
    sub,
    "--path",
    "<tmp-identity-file>",
  ];
  process.stdout.write(`${TAG} DRY RUN: would call: npx ${dryRunArgs.join(" ")}\n`);
  process.stdout.write(`${TAG} DRY RUN: identity JSON: <identity-json-redacted>\n`);
  process.exit(0);
}

// Non-dry-run: write the identity JSON to a 0o600 temp file, invoke
// wrangler with `--path`, then unlink the file. The temp directory is
// also unique-per-invocation to avoid colliding with concurrent runs.
const tmpDir = mkdtempSync(join(tmpdir(), "kv-bootstrap-"));
const tmpFile = join(tmpDir, "identity.json");
try {
  // 0o600 = owner read/write only. macOS / Linux honor this; on Windows
  // node falls back to a permissive default but the process-table leak
  // is the primary threat regardless of fs permissions.
  writeFileSync(tmpFile, identityJson, { mode: 0o600 });

  const wranglerArgs = [
    "wrangler",
    "kv",
    "key",
    "put",
    "--binding",
    "ENGRAM_IDENTITIES",
    modeFlag,
    sub,
    "--path",
    tmpFile,
  ];

  // `npx` is used so the locally-installed wrangler from the repo's
  // `node_modules/.bin/` is resolved (the root package.json devDependency).
  process.stderr.write(
    `${TAG} seeding ENGRAM_IDENTITIES KV: sub=${sub} mode=${useLocal ? "local" : "remote"}\n`,
  );
  const result = spawnSync("npx", wranglerArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });

  if (result.error) {
    process.stderr.write(`${TAG} ERROR: failed to spawn wrangler: ${result.error.message}\n`);
    process.exit(2);
  }

  if (result.status !== 0) {
    process.stderr.write(`${TAG} ERROR: wrangler exited with code ${result.status}\n`);
    process.exit(2);
  }

  process.stderr.write(
    `${TAG} OK — seeded ENGRAM_IDENTITIES KV for sub=${sub} (${useLocal ? "local" : "remote"})\n`,
  );
} finally {
  // Best-effort cleanup. If unlink fails (file already gone, fs error)
  // we still exit cleanly — the temp file mode is 0o600 so the brief
  // window of disclosure is bounded to the running operator's own UID.
  try {
    unlinkSync(tmpFile);
  } catch {
    /* best-effort */
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    /* best-effort */
  }
}

process.exit(0);
