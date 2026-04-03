#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Starting music importer server on http://localhost:8765"
python server.py
