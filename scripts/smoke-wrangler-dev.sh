#!/usr/bin/env bash
# scripts/smoke-wrangler-dev.sh
# FND-03 acceptance: boots a Worker under wrangler dev and verifies it responds HTTP 200.
#
# Usage: ./scripts/smoke-wrangler-dev.sh [path/to/wrangler.jsonc] [port]
#   Default config: packages/mcp-server/wrangler.jsonc
#   Default port:   8787
#
# The script boots wrangler dev in the background, polls localhost on the chosen
# port until it responds (or until a 30 s deadline), then exits 0/1.
#
# Portability note: avoids GNU `timeout` (not present on stock macOS). Uses a
# trap-based kill of the background wrangler PID instead, plus a poll loop in
# place of a fixed sleep — both reasons covered in REVIEW-FIX WR-02 and WR-03.
set -euo pipefail

# Resolve repo root from script location so this works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONFIG="${1:-packages/mcp-server/wrangler.jsonc}"
PORT="${2:-8787}"

# If CONFIG is a relative path, resolve it from REPO_ROOT.
if [[ "${CONFIG}" != /* ]]; then
  CONFIG="${REPO_ROOT}/${CONFIG}"
fi

echo "[smoke:wrangler-dev] Booting Worker with config: ${CONFIG}"
echo "[smoke:wrangler-dev] Repo root: ${REPO_ROOT}"
echo "[smoke:wrangler-dev] Port:      ${PORT}"

cd "${REPO_ROOT}"

# Boot wrangler dev in the background. Trap-based kill replaces GNU `timeout`
# (which is absent from stock macOS) so the script is portable across Linux + macOS.
npx wrangler dev --config "${CONFIG}" --port "${PORT}" &
WRANGLER_PID=$!
trap 'kill ${WRANGLER_PID} 2>/dev/null || true; wait ${WRANGLER_PID} 2>/dev/null || true' EXIT

echo "[smoke:wrangler-dev] Wrangler PID: ${WRANGLER_PID} — polling http://localhost:${PORT}..."

# Poll until ready or until DEADLINE seconds elapse. This replaces a fixed
# `sleep 8`, which was brittle on cold-cache CI runners (false-negative flake)
# and wasteful on fast ones.
DEADLINE=$((SECONDS + 30))
RESULT=1
while (( SECONDS < DEADLINE )); do
  if curl -sf "http://localhost:${PORT}" >/dev/null 2>&1; then
    RESULT=0
    break
  fi
  sleep 1
done

if [[ "${RESULT}" -eq 0 ]]; then
  # One more curl with output, now that we know the Worker is up, for log clarity.
  curl -sf "http://localhost:${PORT}" || true
  echo ""
  echo "[smoke:wrangler-dev] PASS — Worker responded with HTTP 200."
else
  echo "[smoke:wrangler-dev] FAIL — Worker did not respond within 30s."
fi

exit "${RESULT}"
