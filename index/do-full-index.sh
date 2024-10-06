#!/bin/bash
set -euox pipefail

poetry run python index.py index --glob "../albums/**/*.jpg" --dbpath "search.sqlite" &&
    poetry run python index.py prune --glob "../albums/**/*.jpg" --dbpath "search.sqlite" &&
    poetry run python index.py search --query "burger" --dbpath "search.sqlite" &&
    cp search.sqlite ../src/public/search.sqlite
