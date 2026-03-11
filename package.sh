#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"

# Read version from manifest
VERSION=$(python3 -c "import json,sys; print(json.load(open('$SRC_DIR/manifest.json'))['version'])")
OUTPUT="$DIST_DIR/google-account-chooser-$VERSION.zip"

mkdir -p "$DIST_DIR"

# Remove old zip for this version if it exists
rm -f "$OUTPUT"

(cd "$SRC_DIR" && zip -r "$OUTPUT" . -x "*.DS_Store")

echo "Packaged: $OUTPUT"
