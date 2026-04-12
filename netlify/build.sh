#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/publish/data"
RAW="$ROOT/raw"
ARTIFACTS="$ROOT/deck_artifacts"
mkdir -p "$OUT" "$RAW" "$ARTIFACTS" "$ROOT/publish/newsletter" "$ROOT/publish/api"

python3 -m pip install --disable-pip-version-check -r "$ROOT/requirements.txt"

if [ -n "${SOURCE_URL:-}" ]; then
  python3 -m playwright install chromium
  NOTION_FETCH_METHOD="${NOTION_FETCH_METHOD:-playwright}" \
    python3 "$ROOT/everpure_refresh.py" \
      --source-url "$SOURCE_URL" \
      --output-dir "$OUT" \
      --raw-dir "$RAW"
else
  python3 "$ROOT/everpure_refresh.py" \
    --html-path "$ROOT/data/Everpure.html" \
    --output-dir "$OUT"
fi

python3 "$ROOT/everpure_deck_ingest.py" \
  --data-dir "$OUT" \
  --local-artifact-dir "$ARTIFACTS"

FETCH_ARGS=()
if [ -n "${GOOGLE_ACCESS_TOKEN:-}" ]; then
  FETCH_ARGS+=(--access-token "$GOOGLE_ACCESS_TOKEN")
elif [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ] && [ -n "${GOOGLE_REFRESH_TOKEN:-}" ]; then
  FETCH_ARGS+=(
    --client-id "$GOOGLE_CLIENT_ID"
    --client-secret "$GOOGLE_CLIENT_SECRET"
    --refresh-token "$GOOGLE_REFRESH_TOKEN"
  )
fi

if [ ${#FETCH_ARGS[@]} -gt 0 ]; then
  FETCH_ARGS+=(
    --data-dir "$OUT"
    --artifact-dir "$ARTIFACTS"
  )
  if [ -n "${GOOGLE_FETCH_LIMIT:-}" ]; then
    FETCH_ARGS+=(--limit "$GOOGLE_FETCH_LIMIT")
  fi
  python3 "$ROOT/everpure_google_fetch.py" "${FETCH_ARGS[@]}"
fi

if compgen -G "$ARTIFACTS/*.pdf" > /dev/null; then
  python3 "$ROOT/everpure_deck_content_ingest.py" \
    --data-dir "$OUT" \
    --pdf-dir "$ARTIFACTS"
fi

if [ -f "$ROOT/netlify/build_evidence_packs.js" ]; then
  node "$ROOT/netlify/build_evidence_packs.js" "$ROOT/publish"
fi

if [ -f "$ROOT/netlify/clean_evidence_signals.js" ]; then
  node "$ROOT/netlify/clean_evidence_signals.js" "$ROOT/publish"
fi

if [ -f "$ROOT/netlify/build_concept_evidence.js" ]; then
  node "$ROOT/netlify/build_concept_evidence.js" "$ROOT/publish"
fi

node "$ROOT/netlify/generate_static_newsletters.js"
node "$ROOT/netlify/refine_default_newsletter.js" "$ROOT/publish"
node "$ROOT/netlify/fix_default_bottom.js" "$ROOT/publish"

node "$ROOT/netlify/render_stage2_default_current.js" "$ROOT/publish"
node "$ROOT/netlify/render_stage2_marketing_current.js" "$ROOT/publish"
node "$ROOT/netlify/publish_issue_archives.js" "$ROOT"
if [ -f "$ROOT/netlify/fix_static_aliases.js" ]; then
  node "$ROOT/netlify/fix_static_aliases.js" "$ROOT/publish"
fi

touch "$ROOT/publish/.nojekyll"
