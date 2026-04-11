#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$BASE_DIR/output"
ARTIFACT_DIR="$BASE_DIR/deck_artifacts"
mkdir -p "$OUT_DIR" "$ARTIFACT_DIR"
python "$BASE_DIR/everpure_parser.py" "$BASE_DIR/data/Everpure.html" --output-dir "$OUT_DIR"
python "$BASE_DIR/everpure_deck_ingest.py" --data-dir "$OUT_DIR" --local-artifact-dir "$ARTIFACT_DIR"
python "$BASE_DIR/everpure_deck_content_ingest.py" --data-dir "$OUT_DIR" --pdf-dir "$ARTIFACT_DIR"
python "$BASE_DIR/everpure_refresh.py" --html-path "$BASE_DIR/data/Everpure.html" --output-dir "$OUT_DIR"
echo "Build complete. Outputs are in: $OUT_DIR"
echo "Optional next step: use everpure_google_fetch.py to pull actual deck PDFs/PPTX files into $ARTIFACT_DIR"
