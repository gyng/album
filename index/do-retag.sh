#!/usr/bin/env bash
# Refresh GPS coordinates + geocode in the live search DB after the geotag
# companion tool writes GPS into originals — WITHOUT re-running the GPU models.
# Embeddings are unaffected, so search-embeddings.sqlite is left untouched.
#
# Usage:
#   ./do-retag.sh                 # refresh every geotagged photo in the index
#   ./do-retag.sh --match kanto   # only paths containing "kanto"
#   GEOTAG_DB=foo.sqlite ./do-retag.sh
set -euo pipefail
cd "$(dirname "$0")"
uv run python index.py update-gps --dbpath "${GEOTAG_DB:-../src/public/search.sqlite}" "$@"
