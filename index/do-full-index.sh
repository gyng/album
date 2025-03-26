#!/bin/bash
set -euox pipefail

uv run index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" &&
    uv run index.py prune --glob "../albums/**/*.jpg" --dbpath "search.sqlite" &&
    uv run index.py search --query "burger" --dbpath "search.sqlite" &&
    cp search.sqlite ../src/public/search.sqlite
