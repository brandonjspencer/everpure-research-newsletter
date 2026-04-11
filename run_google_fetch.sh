#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/output}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT_DIR/deck_artifacts}"
LIMIT="${LIMIT:-0}"
MODE="${MODE:-pdf}"
SKIP_META="${SKIP_META:-0}"

ARGS=(
  "$ROOT_DIR/everpure_google_fetch.py"
  --data-dir "$DATA_DIR"
  --artifact-dir "$ARTIFACT_DIR"
)

if [[ -n "${ACCESS_TOKEN:-}" ]]; then
  ARGS+=(--access-token "$ACCESS_TOKEN")
elif [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" && -n "${GOOGLE_REFRESH_TOKEN:-}" ]]; then
  ARGS+=(
    --client-id "$GOOGLE_CLIENT_ID"
    --client-secret "$GOOGLE_CLIENT_SECRET"
    --refresh-token "$GOOGLE_REFRESH_TOKEN"
  )
else
  echo "Provide either ACCESS_TOKEN or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN"
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"

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

python3 "${ARGS[@]}"

if [[ -f "$ROOT_DIR/everpure_deck_content_ingest.py" ]]; then
  python3 "$ROOT_DIR/everpure_deck_content_ingest.py" \
    --data-dir "$DATA_DIR" \
    --pdf-dir "$ARTIFACT_DIR"
fi

echo "Done. Check:"
echo "  $DATA_DIR/google_fetch_manifest.json"
echo "  $DATA_DIR/deck_content.json"
echo "  $DATA_DIR/deck_content_summary.json"
