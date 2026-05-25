#!/usr/bin/env bash
# scripts/smoke-install.sh
# FND-01 acceptance: verifies a fresh-clone npm install produces a working monorepo
# workspace tree with @engram/* package symlinks.
#
# Usage: ./scripts/smoke-install.sh
#
# NOTE: In Wave 1 (before Plan 04 lands shared packages), this script exits non-zero
# because node_modules/@engram/* symlinks do not exist yet. CI does not invoke this
# script until Plan 06 wires it after Wave 2 completes.
set -euo pipefail

# Resolve repo root from script location so this works regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[smoke:install] Running fresh-clone install smoke test..."
echo "[smoke:install] Repo root: ${REPO_ROOT}"

cd "${REPO_ROOT}"

echo "[smoke:install] Removing node_modules..."
rm -rf node_modules

echo "[smoke:install] Running npm install..."
npm install

echo "[smoke:install] Checking for @engram/* workspace symlinks..."
if ls -d node_modules/@engram/* >/dev/null 2>&1; then
  ENGRAM_PKGS=$(ls -d node_modules/@engram/* | xargs -I {} basename {})
  echo "[smoke:install] PASS — @engram/* symlinks found:"
  echo "${ENGRAM_PKGS}" | while IFS= read -r pkg; do echo "  @engram/${pkg}"; done
  exit 0
else
  echo "[smoke:install] FAIL — no node_modules/@engram/* symlinks found."
  echo "  This is expected in Wave 1 before shared packages exist (Plan 04+)."
  echo "  Re-run after Wave 2 completes or verify that shared packages are installed."
  exit 1
fi
