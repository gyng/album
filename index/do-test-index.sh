#!/bin/bash
set -euox pipefail

cd "$(dirname "$0")"

uv run python index.test.py
