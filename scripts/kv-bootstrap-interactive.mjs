#!/usr/bin/env node
// scripts/kv-bootstrap-interactive.mjs
//
// ENG-11: interactive first-run auth bootstrap. Replaces the original 8-step
// manual dance (CONTEXT.md D-01) with ~5 steps for a fresh OSS user:
//
//   1. Run `npm run kv:bootstrap-interactive`
//   2. Confirm or override the auto-suggested workspace_id / user_id prompts
//   3. Restart Claude Desktop
//   4. Trigger any Engram tool in Claude Desktop (triggers the 403)
//   5. Paste the error text back into this script (sub extracted via regex)
//
// What the script automates that was previously manual:
//   - Detects the deployed Worker URL via `wrangler deployments list`
//   - Derives default workspace_id / user_id from `git config user.email`
//     (per the ENG-11 design analysis, §6 question 4 — Russell-confirmed)
//   - Merges the Engram MCP entry into claude_desktop_config.json with a
//     timestamped .bak backup (per Russell's ENG-11 question-1 answer:
//     "direct edit with backup + merge"). Preserves all existing mcpServers
//     so the user does NOT wipe Context7 / other MCPs (the exact failure
//     mode that bit Russell during Phase 7).
//   - Calls the existing `kv:bootstrap` script (kept per ENG-11 question-3
//     answer: "complement, keep both") for the actual KV write — single
//     source of truth for the T-03-KV-LEAK security model.
//   - Polls KV for propagation so the user doesn't have to retry on
//     eventual-consistency lag.
//
// SECURITY: Inherits all kv-bootstrap.mjs guarantees (T-03-KV-LEAK: identity
// JSON never on process table, never echoed). This script adds:
//   - claude_desktop_config.json is read once, merged in memory, written with
//     0o600 perms on the .bak file (config file itself uses original perms).
//   - The Engram URL is the only thing added; never reads/modifies any other
//     mcpServers entry or top-level config field.
//   - Sub value is echoed in script output (not secret per kv-bootstrap.mjs
//     comment) but the identity JSON it maps to is not.
//
// Usage:
//   npm run kv:bootstrap-interactive
//   npm run kv:bootstrap-interactive -- --worker-url https://my.workers.dev
//   npm run kv:bootstrap-interactive -- --skip-config-edit  # only do KV write
//   npm run kv:bootstrap-interactive -- --dry-run           # no writes anywhere

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, platform } from "node:process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MCP_SERVER_DIR = join(REPO_ROOT, "packages", "mcp-server");
const KV_BOOTSTRAP_SCRIPT = join(__dirname, "kv-bootstrap.mjs");

const TAG = "[kv:bootstrap-interactive]";

// ---------------------------------------------------------------------------
// CLI ARG PARSING
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cli = { workerUrl: "", workspaceId: "", userId: "", skipConfigEdit: false, dryRun: false };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case "--worker-url":
      cli.workerUrl = args[++i] ?? "";
      break;
    case "--workspace-id":
      cli.workspaceId = args[++i] ?? "";
      break;
    case "--user-id":
      cli.userId = args[++i] ?? "";
      break;
    case "--skip-config-edit":
      cli.skipConfigEdit = true;
      break;
    case "--dry-run":
      cli.dryRun = true;
      break;
    case "--help":
    case "-h":
      printUsage();
      process.exit(0);
      break; // unreachable; satisfies eslint no-fallthrough
    default:
      process.stderr.write(`${TAG} unknown argument: ${arg}\n`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  process.stdout.write(
    `${TAG} usage: npm run kv:bootstrap-interactive [-- <options>]\n` +
      `${TAG}   --worker-url <url>      Override auto-detected deployed Worker URL\n` +
      `${TAG}   --workspace-id <id>     Skip prompt, use this workspace_id\n` +
      `${TAG}   --user-id <id>          Skip prompt, use this user_id\n` +
      `${TAG}   --skip-config-edit      Don't touch claude_desktop_config.json (KV write only)\n` +
      `${TAG}   --dry-run               Plan-only; no writes to KV or config files\n` +
      `${TAG}   --help, -h              Print this and exit 0\n`,
  );
}

// ---------------------------------------------------------------------------
// PLATFORM-SPECIFIC PATHS
// ---------------------------------------------------------------------------

function claudeDesktopConfigPath() {
  const home = homedir();
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  }
  // linux / other — Claude Desktop is officially Mac/Windows only; this is a
  // best-effort path for users on Linux who installed Claude via flatpak/AppImage.
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`${TAG} ERROR: ${msg}\n`);
}

function getGitEmail() {
  // Read `git config user.email` for default workspace_id / user_id derivation.
  // ENG-11 question-2 answer: "derive from git config user.email".
  const result = spawnSync("git", ["config", "user.email"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    return null;
  }
  return result.stdout.trim();
}

function emailToSlug(email) {
  if (!email) return null;
  // Convert "russell.k.moore@mac.com" → "russell-k-moore-mac-com" then take
  // local-part for compact slug → "russell-k-moore". Lowercase, alphanumeric
  // + hyphen only, max 50 chars (KV key sanity).
  const localPart = email.split("@")[0] ?? email;
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function detectWorkerUrl() {
  // Try `wrangler deployments list` to find the deployed engram-mcp-server URL.
  // Falls back to null on any failure — caller prompts.
  const result = spawnSync(
    "npx",
    ["wrangler", "deployments", "list", "--name", "engram-mcp-server"],
    { encoding: "utf8", cwd: MCP_SERVER_DIR },
  );
  if (result.status !== 0) return null;
  // Wrangler output varies by version; look for any *.workers.dev URL.
  const match = result.stdout.match(/(https:\/\/[a-z0-9.-]+\.workers\.dev)/i);
  return match ? match[1] : null;
}

function extractSubFromErrorText(text) {
  // Pull the sub value out of `Unknown OAuth subject: <sub>. Bootstrap via npm run kv:bootstrap.`
  // Sub is an opaque token (mcp-remote dynamic-registered client_id) —
  // characters typically [a-zA-Z0-9_-] per Phase 3 / MCP-09 smoke evidence
  // ("rJkmmoWYMRb5fW6Q"). Strict regex prevents accidental capture of trailing
  // text like the period after the sub.
  const match = text.match(/Unknown OAuth subject:\s*([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Allow the user to paste JUST the sub if they prefer — accept any line
  // that's purely [a-zA-Z0-9_-]+ with length ≥ 8 (matches typical sub shape).
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^[a-zA-Z0-9_-]{8,}$/.test(line)) return line;
  }
  return null;
}

async function prompt(rl, question, defaultValue) {
  const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  const answer = (await rl.question(display)).trim();
  return answer || defaultValue || "";
}

// ---------------------------------------------------------------------------
// CONFIG MERGE
// ---------------------------------------------------------------------------

function mergeEngramIntoConfig(configPath, workerUrl) {
  // Read existing config (or {} if missing), preserve all top-level keys and
  // all existing mcpServers, and add/overwrite the "engram" entry only.
  //
  // Backup strategy: timestamped .bak.<unix-ms> file alongside the original.
  // Never delete prior backups. .bak files use 0o600 perms (owner-only) to
  // protect any secrets the user may have inlined into other mcpServers.
  //
  // Returns { changed: boolean, backupPath: string|null, action: string }.
  const fresh = { mcpServers: {} };
  let original = fresh;
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf8");
      original = JSON.parse(raw);
      if (!original || typeof original !== "object") {
        throw new Error("config file did not parse as a JSON object");
      }
      if (!original.mcpServers || typeof original.mcpServers !== "object") {
        original.mcpServers = {};
      }
    } catch (e) {
      throw new Error(`failed to read ${configPath}: ${e.message}`);
    }
  }

  // Determine what the merged Engram entry should look like. mcp-remote is
  // the v0.1 transport per Phase 7 deploy: it handles the OAuth dance and
  // proxies MCP traffic to the deployed Worker.
  const engramEntry = {
    command: "npx",
    args: ["mcp-remote", `${workerUrl}/mcp`],
  };

  // Detect if already present + identical → no-op, no backup needed.
  const existing = original.mcpServers?.engram;
  const identical =
    existing &&
    existing.command === engramEntry.command &&
    Array.isArray(existing.args) &&
    existing.args.length === engramEntry.args.length &&
    existing.args.every((a, i) => a === engramEntry.args[i]);
  if (identical) {
    return { changed: false, backupPath: null, action: "no-op (engram entry already present)" };
  }

  // Plan the merge.
  const merged = {
    ...original,
    mcpServers: { ...original.mcpServers, engram: engramEntry },
  };

  if (cli.dryRun) {
    return {
      changed: true,
      backupPath: null,
      action: `dry-run: would write engram entry pointing at ${workerUrl}/mcp`,
    };
  }

  // Backup the existing file (only if it existed) before writing the merged version.
  let backupPath = null;
  if (existsSync(configPath)) {
    backupPath = `${configPath}.bak.${Date.now()}`;
    copyFileSync(configPath, backupPath);
    // Tighten backup perms — if the original config had relaxed perms we
    // intentionally tighten the backup since it's a frozen snapshot.
    try {
      chmodSync(backupPath, 0o600); // best-effort, no-op on win32
    } catch {
      /* best-effort */
    }
  }

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n");
  return {
    changed: true,
    backupPath,
    action: existing
      ? `replaced existing engram entry → ${workerUrl}/mcp`
      : `added engram entry → ${workerUrl}/mcp`,
  };
}

// ---------------------------------------------------------------------------
// KV BOOTSTRAP DELEGATION
// ---------------------------------------------------------------------------

function callKvBootstrap({ sub, workspaceId, userId }) {
  // Delegate the actual KV write to the existing kv-bootstrap.mjs which has
  // the T-03-KV-LEAK security guarantees (temp file + 0o600 perms + never
  // echoes identity JSON). This is the "complement, keep both" pattern per
  // ENG-11 question-3 answer.
  const scriptArgs = [
    KV_BOOTSTRAP_SCRIPT,
    "--sub",
    sub,
    "--workspace-id",
    workspaceId,
    "--user-id",
    userId,
  ];
  if (cli.dryRun) scriptArgs.push("--dry-run");
  const result = spawnSync("node", scriptArgs, {
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`kv-bootstrap.mjs exited ${result.status}`);
  }
}

// ---------------------------------------------------------------------------
// KV PROPAGATION POLLING
// ---------------------------------------------------------------------------

async function pollKvForSub(sub, { timeoutMs = 30_000, intervalMs = 2_000 } = {}) {
  // After kv-bootstrap writes, Cloudflare's eventually-consistent KV may take
  // a few seconds to propagate the new key. Poll `wrangler kv key get` until
  // we see ANY non-empty value, then return.
  //
  // SECURITY: We don't print the value — only confirm it's non-empty. The
  // identity JSON stays secret per T-03-KV-LEAK posture. The sub IS echoed
  // because it's not secret (it's the OAuth client_id, known to the requester).
  if (cli.dryRun) {
    log("dry-run: skipping KV propagation poll");
    return true;
  }
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const result = spawnSync(
      "npx",
      ["wrangler", "kv", "key", "get", "--binding=ENGRAM_IDENTITIES", "--remote", sub],
      { encoding: "utf8", cwd: MCP_SERVER_DIR },
    );
    if (result.status === 0 && result.stdout.trim().length > 0) {
      log(
        `KV propagation OK after ${attempt} ${attempt === 1 ? "attempt" : "attempts"} (~${Math.round((Date.now() - startedAt) / 1000)}s)`,
      );
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// MAIN FLOW
// ---------------------------------------------------------------------------

async function main() {
  const rl = createInterface({ input, output });
  try {
    log("Engram first-run interactive bootstrap (ENG-11)");
    log("");

    // ----- Step 1: Worker URL -----
    let workerUrl = cli.workerUrl;
    if (!workerUrl) {
      const detected = detectWorkerUrl();
      workerUrl = await prompt(rl, "Deployed Worker URL", detected ?? "");
      if (!workerUrl) {
        err("Worker URL is required. Deploy first via `npm run deploy`, then re-run.");
        process.exit(1);
      }
    }
    // Normalize: strip trailing slash, strip /mcp suffix (we add it).
    workerUrl = workerUrl.replace(/\/+$/, "").replace(/\/mcp$/, "");
    log(`Worker URL: ${workerUrl}`);

    // ----- Step 2: Defaults from git -----
    const email = getGitEmail();
    const slug = emailToSlug(email);
    if (slug) {
      log(`Detected git user.email: ${email} → default IDs derived from "${slug}"`);
    } else {
      log("Could not read git user.email; you'll need to type IDs manually.");
    }

    // ----- Step 3: Prompt for workspace_id / user_id -----
    const defaultWorkspaceId = slug ? `${slug}-personal` : "";
    const defaultUserId = slug ?? "";
    const workspaceId = cli.workspaceId || (await prompt(rl, "Workspace ID", defaultWorkspaceId));
    const userId = cli.userId || (await prompt(rl, "User ID", defaultUserId));
    if (!workspaceId || !userId) {
      err("workspace_id and user_id are required.");
      process.exit(1);
    }
    log(`workspace_id=${workspaceId} user_id=${userId}`);
    log("");

    // ----- Step 4: Merge claude_desktop_config.json -----
    if (cli.skipConfigEdit) {
      log("--skip-config-edit set; not touching claude_desktop_config.json");
    } else {
      const configPath = claudeDesktopConfigPath();
      log(`Updating Claude Desktop config: ${configPath}`);
      try {
        const result = mergeEngramIntoConfig(configPath, workerUrl);
        log(`  ${result.action}`);
        if (result.backupPath) {
          log(`  backup: ${result.backupPath}`);
        }
      } catch (e) {
        err(`config merge failed: ${e.message}`);
        err(
          "You can re-run with --skip-config-edit to do the KV write only, then edit the config manually.",
        );
        process.exit(1);
      }
    }
    log("");

    // ----- Step 5: Prompt user to trigger 403 then paste error -----
    log("Now do the following IN ORDER:");
    log("  1. Restart Claude Desktop (fully quit + reopen)");
    log("  2. Click any Engram tool in a new conversation (e.g. ask Claude to use 'recall')");
    log("  3. Copy the resulting error message and paste it below");
    log("");
    log("The error will look like:");
    log("  Unknown OAuth subject: <some-token>. Bootstrap via npm run kv:bootstrap.");
    log("");
    log("Paste the error message (or just the sub token) and press Enter on a blank line:");
    const pasted = await readMultilineUntilBlank(rl);
    const sub = extractSubFromErrorText(pasted);
    if (!sub) {
      err("Could not find an OAuth sub in the pasted text.");
      err("Expected text matching: 'Unknown OAuth subject: <sub>'");
      err("Or paste just the sub token on its own line.");
      process.exit(1);
    }
    log(`Extracted sub: ${sub}`);
    log("");

    // ----- Step 6: Delegate to existing kv:bootstrap -----
    log("Writing identity mapping to KV via kv-bootstrap.mjs ...");
    try {
      callKvBootstrap({ sub, workspaceId, userId });
    } catch (e) {
      err(`kv-bootstrap failed: ${e.message}`);
      process.exit(2);
    }
    log("");

    // ----- Step 7: Poll for propagation -----
    log("Waiting for KV propagation (Cloudflare KV is eventually consistent) ...");
    const propagated = await pollKvForSub(sub);
    if (!propagated) {
      log("Timed out waiting for KV propagation after 30s. The write probably succeeded;");
      log("just give it another 10-30s and retry the Engram tool. If it still fails,");
      log(
        "re-run this script and check `wrangler kv key get --binding=ENGRAM_IDENTITIES --remote <sub>` manually.",
      );
    }
    log("");

    // ----- Done -----
    log("BOOTSTRAP COMPLETE.");
    log("");
    log("Next: trigger any Engram tool in Claude Desktop again. It should now work.");
    log("(No restart needed — KV is read on every /authorize call.)");
  } finally {
    rl.close();
  }
}

async function readMultilineUntilBlank(rl) {
  // Read lines from stdin until we hit a blank line; return the joined buffer.
  // This lets the user paste a multi-line error block (typical for mcp-remote
  // wrapping the 403 in additional context).
  const lines = [];
  while (true) {
    const line = await rl.question("");
    if (line.trim() === "" && lines.length > 0) break;
    lines.push(line);
  }
  return lines.join("\n");
}

main().catch((e) => {
  err(`unexpected error: ${e.message}`);
  process.exit(99);
});
