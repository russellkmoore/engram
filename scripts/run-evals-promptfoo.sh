#!/usr/bin/env bash
# scripts/run-evals-promptfoo.sh
# ENG-9 wrapper: promptfoo exits 0 even on "Aborting scan" (target unreachable).
# The predeploy gate needs a non-zero exit on those cases or the eval is theatre.
# ENG-20 followup: also gate on a 90% pass-rate threshold instead of strict
# all-or-nothing exit propagation — the corpus deliberately includes adversarial
# fixtures (prompt injection, empty content) expected to fail, so the threshold
# must absorb 1-2 expected failures without tanking the gate.
#
# Run: `npm run evals:promptfoo`
# Env required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
# Exit codes: 0 = pass rate >= 90% | 1 = scan aborted or pass rate < 90%

set -uo pipefail

LOG=$(mktemp -t engram-evals-promptfoo.XXXXXX.log)
trap 'rm -f "$LOG"' EXIT

# Allow override of the config path; default to the AI-05 Triage Worker config.
CONFIG="${PROMPTFOO_CONFIG:-packages/triage-worker/evals/triage-extraction.promptfoo.yaml}"

# Threshold: 90% pass rate (>=18/20 on the current 20-fixture corpus).
# See YAML footer for rationale (adversarial fixtures absorbed).
THRESHOLD=90

npx promptfoo eval -c "$CONFIG" 2>&1 | tee "$LOG"
PROMPTFOO_EXIT=${PIPESTATUS[0]}

# Catch genuine abort cases first — these are non-recoverable. Sentinels are
# reported in v0.121.x when the target is unreachable (404 / 401 / 403 /
# network error) — see ENG-9 for context.
if grep -qE "Aborting scan|Scan stopped|Target is unavailable" "$LOG"; then
  echo ""
  echo "[evals:promptfoo] FAIL — promptfoo scan aborted (target unreachable)."
  echo "  Most likely causes:"
  echo "    - CLOUDFLARE_API_TOKEN missing the Workers AI:Read scope"
  echo "    - CLOUDFLARE_ACCOUNT_ID does not match the deployed account"
  echo "    - Model name @cf/meta/llama-3.1-8b-instruct deprecated by Cloudflare"
  echo "  Verify with: curl -X POST \"https://api.cloudflare.com/client/v4/accounts/\$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.1-8b-instruct\" \\"
  echo "                  -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" -H \"Content-Type: application/json\" \\"
  echo "                  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}'"
  exit 1
fi

# ENG-20 followup: extract pass rate from promptfoo summary block. promptfoo's
# output ends with one of:
#   Results:
#     ✓ N passed (P%)       <- with checkmark prefix when N > 0
#     N passed (P%)         <- plain when N == 0
#     ✗ M failed (Q%)       <- with X-mark when M > 0
#     M failed (Q%)         <- plain when M == 0
#     0 errors (0%)
# Regex tolerates any optional non-digit prefix (whitespace, ✓, ✗) so it
# matches both checkmark-prefixed and plain rows.
PASS_LINE=$(grep -E "[0-9]+ passed \([0-9]+%\)" "$LOG" | tail -1)
if [ -z "$PASS_LINE" ]; then
  echo ""
  echo "[evals:promptfoo] FAIL — could not parse pass-rate from promptfoo output."
  echo "  promptfoo exit: $PROMPTFOO_EXIT. Expected '  N passed (P%)' line."
  echo "  Output format may have changed (promptfoo version bump?)."
  exit 1
fi
PASS_PCT=$(echo "$PASS_LINE" | grep -oE "\([0-9]+%\)" | grep -oE "[0-9]+")

if [ -z "$PASS_PCT" ] || [ "$PASS_PCT" -lt "$THRESHOLD" ]; then
  echo ""
  echo "[evals:promptfoo] FAIL — pass rate ${PASS_PCT:-?}% < ${THRESHOLD}% threshold."
  echo "  Pass line: $PASS_LINE"
  echo "  promptfoo exit: $PROMPTFOO_EXIT"
  exit 1
fi

echo ""
echo "[evals:promptfoo] OK — pass rate ${PASS_PCT}% >= ${THRESHOLD}% threshold. Gate passed."
exit 0
