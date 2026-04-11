#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/output}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_DIR/deck_artifacts}"
LIMIT="${LIMIT:-0}"
MODE="${MODE:-pdf}"
SKIP_META="${SKIP_META:-0}"

if [[ -z "${ACCESS_TOKEN:-}" ]]; then
  echo "ACCESS_TOKEN is required"
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

ARGS=(
  "$ROOT_DIR/everpure_google_fetch.py"
  --data-dir "$DATA_DIR"
  --artifact-dir "$ARTIFACT_DIR"
  --access-token "$ACCESS_TOKEN"
)

if [[ "$MODE" == "pdf" ]]; then
  ARGS+=(--pdf-only)
elif [[ "$MODE" == "pptx" ]]; then
  ARGS+=(--pptx-only)
fi

if [[ "$SKIP_META" == "1" ]]; then
  ARGS+=(--skip-meta)
fi

if [[ "$LIMIT" != "0" ]]; then
  ARGS+=(--limit "$LIMIT")
fi

python "${ARGS[@]}"

if [[ -f "$ROOT_DIR/everpure_deck_content_ingest.py" ]]; then
  python "$ROOT_DIR/everpure_deck_content_ingest.py" \
    --data-dir "$DATA_DIR" \
    --artifact-dir "$ARTIFACT_DIR"
fi

echo "Done. Check:"
echo "  $DATA_DIR/google_fetch_manifest.json"
echo "  $DATA_DIR/deck_content.json"
echo "  $DATA_DIR/deck_content_summary.json"
