#!/usr/bin/env bash
# AI-01: Idempotent Vectorize index provisioning for Engram.
#
# Re-running this script is a no-op — it prechecks via `wrangler vectorize get`
# before issuing `create`. The dimensions + metric below MUST match the
# EMBEDDING_MODEL chosen in `shared/ai-config/src/index.ts` (ENG-25 single
# source of truth) — they are the runtime contract between the embedding
# model's output and the Vectorize index's expected shape.
#
# Current config (must match @engram/ai-config):
#   EMBEDDING_MODEL       @cf/qwen/qwen3-embedding-0.6b
#   EMBEDDING_DIMS        1024
#   VECTORIZE_INDEX_NAME  engram-memories
#   metric                cosine
#
# WARNING: NEVER run `wrangler vectorize delete engram-memories` in
# production. Deleting the index destroys all vectors and forces a full re-
# embed of every workspace memory. See AI-SPEC.md §3 Pitfall 8 + threat model
# T-05-02-IDX.
#
# ENG-25 one-time migration (2026-06-02): the index was deleted + recreated
# with 1024 dims / cosine to match the qwen3-embedding-0.6b swap. No name
# change because the only embeddings were test runs (no migration baggage).
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

# Keep these in sync with @engram/ai-config constants.
INDEX_NAME="engram-memories"
DIMENSIONS=1024
METRIC="cosine"
EMBEDDING_MODEL_HINT="@cf/qwen/qwen3-embedding-0.6b"

echo "=== Engram Vectorize Setup ==="
echo "Index:      ${INDEX_NAME}"
echo "Dimensions: ${DIMENSIONS} (matches ${EMBEDDING_MODEL_HINT})"
echo "Metric:     ${METRIC}"
echo ""

# --- Idempotency precheck: only create if the index does not already exist ---
# wrangler vectorize create is NOT natively idempotent (second run errors out).
# wrangler vectorize get exits 0 if the index exists, non-zero if not found.
if npx wrangler vectorize get "${INDEX_NAME}" >/dev/null 2>&1; then
  echo "[skip] Index '${INDEX_NAME}' already exists — no-op."
else
  # qwen3-embedding-0.6b is not in wrangler's --preset enum yet, so use
  # explicit --dimensions + --metric instead. Mirror identical values in
  # @engram/ai-config (EMBEDDING_DIMS, plus implicit cosine metric).
  echo "[create] Creating Vectorize index '${INDEX_NAME}' (${DIMENSIONS}-dim, ${METRIC})..."
  npx wrangler vectorize create "${INDEX_NAME}" \
    --dimensions="${DIMENSIONS}" \
    --metric="${METRIC}" \
    --description="Engram v0.1 — qwen3-embedding-0.6b, namespace per workspace (ENG-25)"
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
