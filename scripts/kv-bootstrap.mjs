// scripts/kv-bootstrap.mjs
// Source: D-04 — bootstrap script for the ENGRAM_IDENTITIES KV namespace.
//
// Seeds the OAuth subject → { workspace_id, user_id } mapping into the
// Cloudflare KV namespace `ENGRAM_IDENTITIES`, which the Plan 03-04
// `/authorize` hook reads to populate the JWT `props`. v0.1 single-user
// flow: Russell observes his `sub` claim once (via dev console or the
// 403 fail-closed body printed by `/authorize` for an unknown subject),
// then runs this script with `--sub <observed-sub>` to seed the mapping.
// Subsequent OAuth flows transparently authenticate.
//
// Usage:
//   node scripts/kv-bootstrap.mjs --sub <oauth-sub> [--workspace-id <id>] [--user-id <id>] [--dry-run]
//   - --sub: REQUIRED. The OAuth subject claim observed from the first /authorize attempt.
//   - --workspace-id: defaults to "rmoore-personal".
//   - --user-id: defaults to "rmoore".
//   - --dry-run: print the planned wrangler command WITHOUT executing it
//     AND WITHOUT logging the parsed identity JSON value (T-03-KV-LEAK
//     mitigation — see threat model).
//
// Exit codes: 0 success | 1 missing required arg / --help | 2 wrangler subprocess failed.
//
// SECURITY (T-03-KV-LEAK): This script is read-only by design — it never
// reads KV values back. The identity JSON value is computed locally and
// passed straight to wrangler; it is NEVER echoed to stdout in either
// real or dry-run mode (the dry-run output deliberately redacts the JSON
// to `<identity-json-redacted>`). The `sub` key alone IS echoed because
// it has no secret content (it is the OAuth subject claim).

import { spawnSync } from "node:child_process";

const TAG = "[kv:bootstrap]";

function usage(stream) {
  stream.write(
    `${TAG} usage: node scripts/kv-bootstrap.mjs --sub <oauth-sub> [--workspace-id <id>] [--user-id <id>] [--dry-run]\n` +
      `${TAG}   --sub: REQUIRED. OAuth subject claim from first /authorize attempt.\n` +
      `${TAG}   --workspace-id: optional, default "rmoore-personal".\n` +
      `${TAG}   --user-id: optional, default "rmoore".\n` +
      `${TAG}   --dry-run: print planned wrangler command WITHOUT executing it (identity JSON redacted).\n` +
      `${TAG}   --help: print this usage and exit 1.\n` +
      `${TAG} Exit codes: 0 success | 1 missing arg / --help | 2 wrangler subprocess failed.\n`,
  );
}

const args = process.argv.slice(2);
let sub = "";
let workspaceId = "rmoore-personal";
let userId = "rmoore";
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

// Compute the identity JSON locally. NEVER echoed to stdout — see T-03-KV-LEAK.
const identityJson = JSON.stringify({ workspace_id: workspaceId, user_id: userId });

// Construct the wrangler invocation.
// Mirrors RESEARCH §Example 3: `wrangler kv key put --binding ENGRAM_IDENTITIES --remote <sub> <json>`.
const wranglerArgs = [
  "wrangler",
  "kv",
  "key",
  "put",
  "--binding",
  "ENGRAM_IDENTITIES",
  "--remote",
  sub,
  identityJson,
];

if (dryRun) {
  // Print the planned shape WITHOUT the identity JSON (T-03-KV-LEAK).
  // The `sub` is echoed (not a secret); the JSON value is redacted.
  process.stdout.write(
    `${TAG} DRY RUN: would call: npx ` +
      wranglerArgs
        .slice(0, -1) // drop the final identity JSON arg
        .map((a) => (a === sub ? sub : a))
        .join(" ") +
      ` <identity-json-redacted>\n`,
  );
  process.exit(0);
}

// Non-dry-run: spawn wrangler as a subprocess.
// `npx` is used so the locally-installed wrangler from the repo's
// `node_modules/.bin/` is resolved (the root package.json devDependency).
process.stderr.write(`${TAG} seeding ENGRAM_IDENTITIES KV: sub=${sub}\n`);
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

process.stderr.write(`${TAG} OK — seeded ENGRAM_IDENTITIES KV for sub=${sub}\n`);
process.exit(0);
