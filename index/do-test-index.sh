#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

uv run python index.test.py
uv run python weather.test.py
uv run python clip_timeline.test.py

uv run python media_embedding.test.py
