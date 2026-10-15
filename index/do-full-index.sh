#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

SOURCE_DB="search.sqlite"
STAGING_DB="search.staging.sqlite"
CORE_OUTPUT="../src/public/search.sqlite"
EMBEDDINGS_OUTPUT="../src/public/search-embeddings.sqlite"
GLOB="../albums/**/*.jpg"

exec 9>"/tmp/photo-gallery-index-workflow.lock"
if ! flock -n 9; then
  echo "Another full indexing workflow is already running." >&2
  exit 1
fi

uv run python index.py prepare-staging --source "$SOURCE_DB" --staging "$STAGING_DB"

uv run --extra inference python index.py index \
  --glob "$GLOB" \
  --dbpath "$STAGING_DB" \
  --model-profile gemma2-hybrid --embedding-batch-size 4
uv run python index.py prune --glob "$GLOB" --dbpath "$STAGING_DB"
uv run python index.py weather --dbpath "$STAGING_DB" || echo "Weather enrichment unavailable; retaining indexed photo data."
uv run python index.py validate \
  --glob "$GLOB" \
  --dbpath "$STAGING_DB" \
  --model-profile gemma2-hybrid

uv run python index.py retire-legacy-embeddings --dbpath "$STAGING_DB"

uv run python index.py publish \
  --dbpath "$STAGING_DB" \
  --core-output "$CORE_OUTPUT" \
  --embeddings-output "$EMBEDDINGS_OUTPUT"

mv "$STAGING_DB" "$SOURCE_DB"
rm -f "$STAGING_DB-wal" "$STAGING_DB-shm"
