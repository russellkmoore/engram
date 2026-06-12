#!/usr/bin/env bash
# scripts/smoke-kitchen-sink.sh
# INT-05a acceptance: automated end-to-end smoke for the v0.2 kitchen-sink path.
#
# Exercises the full composed recall() pipeline:
#   remember → recall(verbosity="synthesis") → conflict-surfacing-in-recall
#
# This is CI-runnable without real Cloudflare bindings. The v02-kitchen-sink.test.ts
# integration suite is the programmatic smoke for the pipeline composition — it drives
# tools.ts recall() end-to-end with deterministic mocks (no real AI/Vectorize calls).
# The wrangler dev boot checks confirm both Workers start cleanly.
#
# Usage:
#   bash scripts/smoke-kitchen-sink.sh
#
# Exit codes:
#   0 — all gates passed (INT-05a PASS)
#   1 — one or more gates failed
#
# INT-05b (manual staging ritual at milestone close) is NOT automated here.
# See the verify-work checklist for the manual deploy + Claude Desktop smoke steps.
#
# Portability note: same set -euo pipefail policy as smoke-wrangler-dev.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo ""
echo "========================================="
echo " INT-05a: Kitchen-Sink Automated Smoke"
echo "========================================="
echo ""

OVERALL_RESULT=0

# ---------------------------------------------------------------------------
# Gate 1: mcp-server local boot (binding-mode=local, http mode)
# ---------------------------------------------------------------------------
echo "[int-05a] Gate 1: mcp-server local boot (binding-mode=local)..."
if bash "${SCRIPT_DIR}/smoke-wrangler-dev.sh" \
    packages/mcp-server/wrangler.jsonc 8787 http local; then
  echo "[int-05a] Gate 1: PASS"
else
  echo "[int-05a] Gate 1: FAIL — mcp-server did not boot cleanly"
  OVERALL_RESULT=1
fi
echo ""

# ---------------------------------------------------------------------------
# Gate 2: triage-worker local boot (binding-mode=local, boot mode)
# ---------------------------------------------------------------------------
echo "[int-05a] Gate 2: triage-worker local boot (binding-mode=local)..."
if bash "${SCRIPT_DIR}/smoke-wrangler-dev.sh" \
    packages/triage-worker/wrangler.jsonc 8788 boot local; then
  echo "[int-05a] Gate 2: PASS"
else
  echo "[int-05a] Gate 2: FAIL — triage-worker did not boot cleanly"
  OVERALL_RESULT=1
fi
echo ""

# ---------------------------------------------------------------------------
# Gate 3: remember → recall(verbosity="synthesis") → conflict-surfacing sequence
#
# The v02-kitchen-sink.test.ts integration suite is the programmatic smoke for
# this path. It drives tools.ts recall() end-to-end without mocking hybridRank,
# generateSynthesis, or expandQuery — the exact composition the INT-05a criterion
# requires. All 6 describe blocks assert: envelope parses, synthesis field present,
# conflicts surfaced when seeded. Uses the workerd pool (no real bindings needed).
# ---------------------------------------------------------------------------
echo "[int-05a] Gate 3: remember→recall(synthesis)→conflict-surfacing via v02-kitchen-sink.test.ts..."
cd "${REPO_ROOT}"
if npm test --workspace=packages/mcp-server -- \
    --run --project=workerd \
    --reporter=verbose \
    "v02-kitchen-sink" 2>&1; then
  echo ""
  echo "[int-05a] Gate 3: PASS"
else
  echo ""
  echo "[int-05a] Gate 3: FAIL — kitchen-sink integration suite failed"
  OVERALL_RESULT=1
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "========================================="
if [[ "${OVERALL_RESULT}" -eq 0 ]]; then
  echo " INT-05a: ALL GATES PASSED"
else
  echo " INT-05a: ONE OR MORE GATES FAILED (see above)"
fi
echo "========================================="
echo ""

exit "${OVERALL_RESULT}"
