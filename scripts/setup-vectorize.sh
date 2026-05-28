#!/usr/bin/env bash
# AI-01: Idempotent Vectorize index provisioning for Engram.
#
# Re-running this script is a no-op — it prechecks via `wrangler vectorize get`
# before issuing `create`. The index preset (@cf/baai/bge-base-en-v1.5) locks
# dimensions=768 + metric=cosine PERMANENTLY at creation time.
#
# WARNING: NEVER run `wrangler vectorize delete engram-memories` in production.
# Deleting the index destroys all vectors and forces a full re-embed of every
# workspace memory. See AI-SPEC.md §3 Pitfall 8 + threat model T-05-02-IDX.
#
# Metadata indexes:
#   - type  (string) — enables typed recalls via args.types filter (Pitfall 9)
#   - scope (string) — enables scope-scoped recalls via args.scope filter
#
# Both metadata indexes MUST be created before the first filtered query lands
# (Pitfall 9 mitigation). This script creates them if absent; they are no-ops
# if already present (wrangler returns success on duplicate creation).
#
# Usage:
#   bash scripts/setup-vectorize.sh        # direct
#   npm run setup:vectorize                # via npm script

set -euo pipefail

INDEX_NAME="engram-memories"
PRESET="@cf/baai/bge-base-en-v1.5"

echo "=== Engram Vectorize Setup ==="
echo "Index: ${INDEX_NAME}"
echo "Preset: ${PRESET}"
echo ""

# --- Idempotency precheck: only create if the index does not already exist ---
# wrangler vectorize create is NOT natively idempotent (second run errors out).
# wrangler vectorize get exits 0 if the index exists, non-zero if not found.
if npx wrangler vectorize get "${INDEX_NAME}" >/dev/null 2>&1; then
  echo "[skip] Index '${INDEX_NAME}' already exists — no-op."
else
  echo "[create] Creating Vectorize index '${INDEX_NAME}' with preset ${PRESET}..."
  npx wrangler vectorize create "${INDEX_NAME}" \
    --preset="${PRESET}" \
    --description="Engram v0.1 — single global index, namespace per workspace"
  echo "[ok] Index created."
fi

echo ""
echo "--- Metadata indexes ---"

# Metadata indexes are idempotent via wrangler's own behaviour (returns success
# on duplicate). Using '|| true' here to tolerate versions that do error on dup.

echo "[upsert] Ensuring metadata index: property-name=type (string)..."
npx wrangler vectorize create-metadata-index "${INDEX_NAME}" \
  --property-name=type \
  --type=string || true

echo "[upsert] Ensuring metadata index: property-name=scope (string)..."
npx wrangler vectorize create-metadata-index "${INDEX_NAME}" \
  --property-name=scope \
  --type=string || true

echo ""
echo "=== Vectorize setup complete ==="
