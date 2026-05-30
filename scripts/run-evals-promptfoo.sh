#!/usr/bin/env bash
# scripts/run-evals-promptfoo.sh
# ENG-9 wrapper: promptfoo exits 0 even on "Aborting scan" (target unreachable).
# The predeploy gate needs a non-zero exit on those cases or the eval is theatre.
# This wrapper:
#   1. Runs promptfoo, tees output so the user sees the normal table
#   2. Captures stderr/stdout, greps for promptfoo's abort sentinels
#   3. Exits non-zero on abort even if promptfoo itself exited 0
#
# Run: `npm run evals:promptfoo`
# Env required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
# Exit codes: 0 = all promptfoo tests passed | 1 = scan aborted (target down) | other = promptfoo's own exit

set -uo pipefail

LOG=$(mktemp -t engram-evals-promptfoo.XXXXXX.log)
trap 'rm -f "$LOG"' EXIT

# Allow override of the config path; default to the AI-05 Triage Worker config.
CONFIG="${PROMPTFOO_CONFIG:-packages/triage-worker/evals/triage-extraction.promptfoo.yaml}"

npx promptfoo eval -c "$CONFIG" 2>&1 | tee "$LOG"
PROMPTFOO_EXIT=${PIPESTATUS[0]}

# Promptfoo's own exit takes precedence — if it exited non-zero, propagate.
if [ "$PROMPTFOO_EXIT" -ne 0 ]; then
  echo ""
  echo "[evals:promptfoo] promptfoo exited $PROMPTFOO_EXIT — predeploy gate FAILED"
  exit "$PROMPTFOO_EXIT"
fi

# Catch promptfoo's "abort scan" condition which exits 0 but means no eval ran.
# These sentinels are reported in v0.121.x when the target is unreachable
# (404 / 401 / 403 / network error) — see ENG-9 for context.
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

# Also catch the case where promptfoo ran but every test failed (0 passed AND 0 errors).
# This shouldn't normally happen — defensive belt-and-suspenders.
if grep -qE "^  0 passed \(0%\)" "$LOG" && ! grep -qE "Aborting scan|Scan stopped" "$LOG"; then
  echo ""
  echo "[evals:promptfoo] FAIL — 0 tests passed but no abort signal. Check assertions."
  exit 1
fi

echo ""
echo "[evals:promptfoo] OK — predeploy gate passed."
exit 0
