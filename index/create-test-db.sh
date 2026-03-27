#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

# Legacy fixture DB used by search/tag regression tests.
uv run python index.py index --glob "../src/test/fixtures/*.jpg" --dbpath "testexists.sqlite"

# Validate test-simple album processing path and profile wiring without full model inference.
uv run python index.py index --glob "../albums/test-simple/*.[jJ][pP][gG]" --dbpath "test-simple.sqlite" --dry-run --model-profile siglip2
