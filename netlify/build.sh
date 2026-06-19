#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/publish/data"
RAW="$ROOT/raw"
ARTIFACTS="$ROOT/deck_artifacts"
mkdir -p "$OUT" "$RAW" "$ARTIFACTS" "$ROOT/publish/newsletter" "$ROOT/publish/api"

python3 -m pip install --disable-pip-version-check -r "$ROOT/requirements.txt"

if [ -n "${SOURCE_URL:-}" ]; then
  # A browser-download hiccup must not abort the whole deploy: on failure, degrade
  # to the requests fetch + committed-snapshot/existing fallback handled below.
  if ! python3 -m playwright install chromium; then
    echo "::warning::playwright browser install failed; relying on requests fetch + snapshot/existing fallback"
  fi

  set +e
  NOTION_FETCH_METHOD="${NOTION_FETCH_METHOD:-auto}" \
  ALLOW_SOURCE_FALLBACK=0 \
    python3 "$ROOT/everpure_refresh.py" \
      --source-url "$SOURCE_URL" \
      --output-dir "$OUT" \
      --raw-dir "$RAW"
  REFRESH_STATUS=$?
  set -e

  if [ "$REFRESH_STATUS" -ne 0 ]; then
    if [ -f "$ROOT/data/Everpure.html" ]; then
      echo "::warning::Live Notion fetch failed; validating committed data/Everpure.html source snapshot."

      SNAP_OUT="$(mktemp -d)"

      set +e
      python3 "$ROOT/everpure_refresh.py" \
        --html-path "$ROOT/data/Everpure.html" \
        --output-dir "$SNAP_OUT"
      SNAP_STATUS=$?
      set -e

      SNAP_OK=0
      if [ "$SNAP_STATUS" -eq 0 ]; then
        SNAP_OK=$(python3 - "$SNAP_OUT" <<'PY_CHECK'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
weeks_path = out / "weeks.json"
decks_path = out / "decks.json"
summary_path = out / "summary.json"

try:
    weeks = json.loads(weeks_path.read_text(encoding="utf-8")) if weeks_path.exists() else []
    decks = json.loads(decks_path.read_text(encoding="utf-8")) if decks_path.exists() else []
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
except Exception:
    print("0")
    raise SystemExit(0)

date_range = summary.get("date_range", {}) if isinstance(summary, dict) else {}
latest = date_range.get("max")

if isinstance(weeks, list) and len(weeks) > 0 and latest:
    print("1")
else:
    print("0")
PY_CHECK
)
      fi

      if [ "$SNAP_OK" = "1" ]; then
        echo "Local source snapshot parsed successfully; using it for this build."
        rm -rf "$OUT"
        mkdir -p "$OUT"
        cp -R "$SNAP_OUT"/. "$OUT"/

        OUT_PATH="$OUT" python3 - <<'PY_MARK'
import json
import os
from pathlib import Path

manifest_path = Path(os.environ["OUT_PATH"]) / "refresh_manifest.json"
data = json.loads(manifest_path.read_text(encoding="utf-8"))
source = data.setdefault("source", {})
source["fetch_method"] = "local_html_fallback"
source["source_fallback"] = "local_html_snapshot"
source["fallback_warning"] = "Live Notion fetch failed; build used committed data/Everpure.html snapshot after validation."
manifest_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
PY_MARK
      else
        echo "::warning::data/Everpure.html exists but parsed into zero usable weeks; falling back to existing parsed outputs."

        NOTION_FETCH_METHOD="${NOTION_FETCH_METHOD:-auto}" \
        ALLOW_SOURCE_FALLBACK=1 \
          python3 "$ROOT/everpure_refresh.py" \
            --source-url "$SOURCE_URL" \
            --output-dir "$OUT" \
            --raw-dir "$RAW"
      fi
    else
      echo "::warning::Live Notion fetch failed and data/Everpure.html was not found; falling back to existing parsed outputs."

      NOTION_FETCH_METHOD="${NOTION_FETCH_METHOD:-auto}" \
      ALLOW_SOURCE_FALLBACK=1 \
        python3 "$ROOT/everpure_refresh.py" \
          --source-url "$SOURCE_URL" \
          --output-dir "$OUT" \
          --raw-dir "$RAW"
    fi
  fi
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

  if [ -f "$ROOT/everpure_deck_link_smoke.py" ]; then
    python3 "$ROOT/everpure_deck_link_smoke.py" "${FETCH_ARGS[@]}" || echo "Deck link smoke test failed; continuing main build."
  fi
fi

if compgen -G "$ARTIFACTS/*.pdf" > /dev/null; then
  python3 "$ROOT/everpure_deck_content_ingest.py" \
    --data-dir "$OUT" \
    --pdf-dir "$ARTIFACTS"
fi

if [ -f "$ROOT/everpure_external_research_ingest.py" ]; then
  if [ ${#FETCH_ARGS[@]} -gt 0 ]; then
    if [ "${EXTERNAL_EVIDENCE_STRICT:-0}" = "1" ]; then
      python3 "$ROOT/everpure_external_research_ingest.py" "${FETCH_ARGS[@]}"
    else
      python3 "$ROOT/everpure_external_research_ingest.py" "${FETCH_ARGS[@]}" || echo "External research evidence ingest failed; continuing."
    fi
  else
    echo "Skipping external research evidence ingest because Google credentials are not available."
  fi
fi

# Helio evidence ingest runs AFTER the external ingest (it reads the deck_links.json
# that step writes) and BEFORE evidence packs. Tier A (compare share pages) needs no
# auth; Tier B (report API) uses HELIO_APP_ID/HELIO_API_TOKEN from the environment.
if [ -f "$ROOT/everpure_helio_ingest.py" ] && [ -f "$OUT/deck_links.json" ]; then
  python3 "$ROOT/everpure_helio_ingest.py" --data-dir "$OUT" || echo "Helio evidence ingest failed; continuing."
fi

if [ -f "$ROOT/netlify/build_evidence_packs.js" ]; then
  node "$ROOT/netlify/build_evidence_packs.js" "$ROOT/publish"
fi
if [ -f "$ROOT/netlify/merge_external_evidence_packs.js" ]; then
  node "$ROOT/netlify/merge_external_evidence_packs.js" "$ROOT/publish"
fi


if [ -f "$ROOT/netlify/clean_evidence_signals.js" ]; then
  node "$ROOT/netlify/clean_evidence_signals.js" "$ROOT/publish"
fi

if [ -f "$ROOT/netlify/build_concept_evidence.js" ]; then
  node "$ROOT/netlify/build_concept_evidence.js" "$ROOT/publish"
fi

# Roll the committed longitudinal record (history/ + issues/) plus the current
# Helio metrics into publish/data/trends.json for the static trends dashboard.
if [ -f "$ROOT/netlify/build_trends.js" ]; then
  node "$ROOT/netlify/build_trends.js" "$ROOT"
fi

node "$ROOT/netlify/generate_static_newsletters.js"
# Pre-render the classic API endpoints (api.js routes) as static JSON for Pages.
if [ -f "$ROOT/netlify/build_api_endpoints.js" ]; then
  node "$ROOT/netlify/build_api_endpoints.js"
fi
if [ -f "$ROOT/netlify/external_evidence_observability.js" ]; then
  node "$ROOT/netlify/external_evidence_observability.js" "$ROOT/publish"
fi

node "$ROOT/netlify/refine_default_newsletter.js" "$ROOT/publish"
node "$ROOT/netlify/fix_default_bottom.js" "$ROOT/publish"

node "$ROOT/netlify/render_stage2_default_current.js" "$ROOT/publish"
node "$ROOT/netlify/render_stage2_marketing_current.js" "$ROOT/publish"
node "$ROOT/netlify/publish_issue_archives.js" "$ROOT"
if [ -f "$ROOT/netlify/fix_static_aliases.js" ]; then
  node "$ROOT/netlify/fix_static_aliases.js" "$ROOT/publish"
fi

# Localize Helio thumbnails into the committed WebP cache and rewrite trends.json to
# the local copies BEFORE the dashboard renders (so it emits local paths, not the
# expiring signed URLs). Best-effort/non-blocking; the CI workflow commits new cache
# files back to main so they survive Helio's signed-URL expiry.
if [ -f "$ROOT/scripts/cache_helio_thumbnails.py" ]; then
  python3 "$ROOT/scripts/cache_helio_thumbnails.py" --root "$ROOT" || echo "Thumbnail cache step failed; continuing."
fi

# Dashboard is the site homepage, so it must be the LAST writer of publish/index.html
# (generate_static_newsletters.js + external_evidence_observability.js write/inject it
# earlier). The sitemap runs dead last so it scans every page that shipped.
if [ -f "$ROOT/netlify/render_trends_dashboard.js" ]; then
  node "$ROOT/netlify/render_trends_dashboard.js" "$ROOT"
fi
if [ -f "$ROOT/netlify/render_sitemap.js" ]; then
  node "$ROOT/netlify/render_sitemap.js" "$ROOT"
fi

touch "$ROOT/publish/.nojekyll"
