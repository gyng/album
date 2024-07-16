#!/bin/bash
set -euox pipefail

poetry run python index.py index --glob "../src/test/fixtures/*.jpg" --dbpath "testexists.sqlite"
