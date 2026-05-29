#!/usr/bin/env bash
# PIP-01: Idempotent Cloudflare Queue provisioning for Engram.
#
# Re-running this script is a no-op — it prechecks via `wrangler queues info`
# before issuing `create`. The queue is a producer for `mcp-server` (binding
# `INGEST_QUEUE` on packages/mcp-server/wrangler.jsonc) and a consumer for
# `triage-worker` (queues.consumers[] on packages/triage-worker/wrangler.jsonc).
# See Phase 6 CONTEXT.md §"Claude's Discretion → Cloudflare Queues consumer
# config" for the consumer retry budget (max_batch_size=10,
# max_batch_timeout=5s, max_retries=3, no DLQ per D-03).
#
# WARNING: NEVER run `wrangler queues delete engram-ingest` in production.
# Deleting the queue destroys all in-flight MemoryEvents — the at-least-once
# delivery guarantee assumes the queue exists. See A11/IP-1 mitigation
# referenced in PIP-04 + threat register T-06-02-DLQ-MISSING.
#
# Precheck choice: `wrangler queues info <name>` is available in wrangler@4
# (verified at script-write time via `npx wrangler queues --help`); it exits 0
# when the queue exists, non-zero otherwise. If a future wrangler version
# drops `info`, swap the precheck to:
#   npx wrangler queues list 2>/dev/null | grep -q "${QUEUE_NAME}"
#
# Usage:
#   bash scripts/setup-queue.sh        # direct
#   npm run setup:queue                # via npm script

set -euo pipefail

QUEUE_NAME="engram-ingest"

echo "=== Engram Queue Setup ==="
echo "Queue: ${QUEUE_NAME}"
echo ""

# --- Idempotency precheck: only create if the queue does not already exist ---
# wrangler queues create is NOT natively idempotent (second run errors with
# "queue already exists"). wrangler queues info exits 0 if found, non-zero
# otherwise.
if npx wrangler queues info "${QUEUE_NAME}" >/dev/null 2>&1; then
  echo "[skip] Queue '${QUEUE_NAME}' already exists — no-op."
else
  echo "[create] Creating Cloudflare Queue '${QUEUE_NAME}'..."
  npx wrangler queues create "${QUEUE_NAME}"
  echo "[ok] Queue created."
fi

echo ""
echo "=== Queue setup complete ==="
