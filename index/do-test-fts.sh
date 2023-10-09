#!/bin/bash
set -euox pipefail

poetry run python index.py index --glob "../src/public/data/albums/test-simple/*.jpg" --dbpath "testfts.sqlite" &&
    poetry run python index.py search --query "mac" --dbpath "testfts.sqlite"
