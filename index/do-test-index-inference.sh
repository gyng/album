#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

INDEX_RUN_MODEL_INFERENCE=1 uv run --extra inference python index.test.py TestMain.test_analyse_image_worker_with_janus
