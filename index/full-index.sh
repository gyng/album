#!/bin/bash
set -euox pipefail

poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" && cp search.sqlite ../src/public/search.sqlite
