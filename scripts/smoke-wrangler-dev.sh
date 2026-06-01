#!/usr/bin/env bash
# scripts/smoke-wrangler-dev.sh
# FND-03 acceptance: boots a Worker under wrangler dev and verifies either
#   (a) HTTP 200 response (default mode — for Workers with a `fetch()` handler), or
#   (b) wrangler stays alive past a startup window (boot mode — for queue-only
#       Workers that have no `fetch()` handler and so cannot serve HTTP).
#
# Usage: ./scripts/smoke-wrangler-dev.sh [path/to/wrangler.jsonc] [port] [mode]
#   Default config: packages/mcp-server/wrangler.jsonc
#   Default port:   8787
#   Default mode:   http   (poll until HTTP 200 or timeout)
#                   boot   (wait STARTUP_WINDOW seconds, then verify wrangler PID alive)
#
# The script boots wrangler dev in the background, runs the chosen check, then exits 0/1.
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
MODE="${3:-http}"

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
#
# `--local`: this smoke test only verifies the Worker boots + responds HTTP 200.
# Remote bindings (env.AI in particular) require interactive `wrangler login`
# OAuth that GitHub Actions cannot satisfy with CLOUDFLARE_API_TOKEN alone, so
# wrangler dev in remote mode aborts before serving requests. Local mode stubs
# those bindings out, which is the correct level of fidelity for FND-03's "did
# the Worker boot at all" smoke. Production-fidelity testing of the AI binding
# itself belongs in a separate CI surface with full wrangler-auth coverage —
# tracked in Linear (filed alongside the PR that introduces this flag).
npx wrangler dev --config "${CONFIG}" --port "${PORT}" --local &
WRANGLER_PID=$!
trap 'kill ${WRANGLER_PID} 2>/dev/null || true; wait ${WRANGLER_PID} 2>/dev/null || true' EXIT

echo "[smoke:wrangler-dev] Wrangler PID: ${WRANGLER_PID} — mode=${MODE}"

RESULT=1
case "${MODE}" in
  http)
    # Poll until ready or until DEADLINE seconds elapse. This replaces a fixed
    # `sleep 8`, which was brittle on cold-cache CI runners (false-negative flake)
    # and wasteful on fast ones.
    echo "[smoke:wrangler-dev] Polling http://localhost:${PORT}..."
    DEADLINE=$((SECONDS + 30))
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
    ;;
  boot)
    # Boot mode: verify the Worker module loads cleanly and wrangler stays alive
    # past the startup window. Used for queue-only Workers (triage-worker) that
    # export only `queue()` and have no `fetch()` handler — polling HTTP would
    # always fail because there is no fetch handler to dispatch the request.
    #
    # Signal: a syntax error or unresolved import in the Worker source causes
    # wrangler to crash within the first few seconds. Surviving the window means
    # the module at least loaded.
    STARTUP_WINDOW=10
    echo "[smoke:wrangler-dev] Waiting ${STARTUP_WINDOW}s for boot, then verifying PID alive..."
    sleep "${STARTUP_WINDOW}"
    if kill -0 "${WRANGLER_PID}" 2>/dev/null; then
      RESULT=0
      echo "[smoke:wrangler-dev] PASS — wrangler still running after ${STARTUP_WINDOW}s (Worker booted cleanly)."
    else
      echo "[smoke:wrangler-dev] FAIL — wrangler exited during startup window (Worker failed to boot)."
    fi
    ;;
  *)
    echo "[smoke:wrangler-dev] FAIL — unknown mode '${MODE}'. Expected 'http' or 'boot'."
    ;;
esac

exit "${RESULT}"
