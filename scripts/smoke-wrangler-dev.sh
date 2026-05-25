#!/usr/bin/env bash
# scripts/smoke-wrangler-dev.sh
# FND-03 acceptance: boots a Worker under wrangler dev and verifies it responds HTTP 200.
#
# Usage: ./scripts/smoke-wrangler-dev.sh [path/to/wrangler.jsonc]
#   Default config: packages/mcp-server/wrangler.jsonc
#
# The script boots wrangler dev in the background, waits 8 seconds for startup,
# then curls localhost:8787. On success exits 0; otherwise exits non-zero.
set -euo pipefail

# Resolve repo root from script location so this works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONFIG="${1:-packages/mcp-server/wrangler.jsonc}"

# If CONFIG is a relative path, resolve it from REPO_ROOT.
if [[ "${CONFIG}" != /* ]]; then
  CONFIG="${REPO_ROOT}/${CONFIG}"
fi

echo "[smoke:wrangler-dev] Booting Worker with config: ${CONFIG}"
echo "[smoke:wrangler-dev] Repo root: ${REPO_ROOT}"

cd "${REPO_ROOT}"

# Boot wrangler dev in the background with a 15-second timeout.
timeout 15 npx wrangler dev --config "${CONFIG}" --port 8787 &
WRANGLER_PID=$!

echo "[smoke:wrangler-dev] Wrangler PID: ${WRANGLER_PID} — waiting 8s for startup..."
sleep 8

echo "[smoke:wrangler-dev] Checking http://localhost:8787..."
if curl -sf http://localhost:8787; then
  echo ""
  echo "[smoke:wrangler-dev] PASS — Worker responded with HTTP 200."
  RESULT=0
else
  echo "[smoke:wrangler-dev] FAIL — Worker did not respond with HTTP 200."
  RESULT=1
fi

# Send SIGTERM to the background wrangler process.
kill %1 2>/dev/null || true
wait "${WRANGLER_PID}" 2>/dev/null || true

exit "${RESULT}"
