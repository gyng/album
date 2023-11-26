#!/bin/bash
set -euox pipefail

poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" &&
    poetry run python index.py index --glob "../src/public/data/albums/**/*.JPG" --dbpath "search.sqlite" &&
    poetry run python index.py search --query "burger" --dbpath "search.sqlite" &&
    cp search.sqlite ../src/public/search.sqlite
