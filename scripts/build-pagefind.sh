#!/usr/bin/env bash
# Run Pagefind against whichever output directory Astro produced.
# - Static build → dist/
# - Cloudflare adapter build → dist/client/
set -euo pipefail

if [ -f dist/client/index.html ]; then
  SITE=dist/client
elif [ -f dist/index.html ]; then
  SITE=dist
else
  echo "build-pagefind: no built site found (no index.html in dist/ or dist/client/)" >&2
  exit 1
fi

echo "build-pagefind: indexing $SITE"
pnpm exec pagefind --site "$SITE" --output-subdir pagefind
