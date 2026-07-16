#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EMBED_DB="${1:-search.sqlite}"
OUTPUT_DB="${2:-../src/public/search-embeddings.sqlite}"
STAGING_DB="${EMBED_DB}.staging"
GLOB="../albums/**/*.jpg"

exec 9>"/tmp/photo-gallery-index-workflow.lock"
if ! flock -n 9; then
  echo "Another embeddings indexing workflow is already running." >&2
  exit 1
fi

if [[ -f "$STAGING_DB" ]]; then
  echo "Resuming existing staging database: $STAGING_DB"
elif [[ -f "$EMBED_DB" ]]; then
  cp "$EMBED_DB" "$STAGING_DB"
fi

uv run --extra inference python index.py index \
  --glob "$GLOB" \
  --dbpath "$STAGING_DB" \
  --model-profile siglip2
uv run python index.py prune --glob "$GLOB" --dbpath "$STAGING_DB"
uv run python index.py validate \
  --glob "$GLOB" \
  --dbpath "$STAGING_DB" \
  --model-profile siglip2
uv run python index.py publish \
  --dbpath "$STAGING_DB" \
  --embeddings-output "$OUTPUT_DB"

mv "$STAGING_DB" "$EMBED_DB"
rm -f "$STAGING_DB-wal" "$STAGING_DB-shm"
