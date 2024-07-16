#!/bin/bash
set -euox pipefail

poetry run python index.test.py
