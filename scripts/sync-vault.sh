#!/usr/bin/env bash
# Sync the editing vault into the in-repo content/ snapshot.
# Source of truth lives at $VAULT (default: ~/Vault-jsbooks).
# After running this, commit the changes in content/ to deploy.

set -euo pipefail
VAULT="${VAULT:-$HOME/Vault-jsbooks}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/content"

if [ ! -d "$VAULT" ]; then
  echo "vault not found: $VAULT" >&2
  exit 1
fi

mkdir -p "$DEST"
for sub in scripture people places dosu terms dates; do
  if [ -d "$VAULT/$sub" ]; then
    rsync -a --delete "$VAULT/$sub/" "$DEST/$sub/"
    echo "  $sub: $(find "$DEST/$sub" -type f | wc -l) files"
  fi
done
echo "vault → $DEST sync complete"
