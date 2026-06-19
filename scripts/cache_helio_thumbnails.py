#!/usr/bin/env python3
"""Localize Helio thumbnails into a committed cache so they survive URL expiry.

Helio thumbnail URLs are **time-signed** (``?Expires=…``, ~1y validity). Once a
signature lapses the image 403s and the dashboard's hover-screenshot is lost (see
the expiry backfill in ``netlify/build_trends.js``). That backfill only helps
while *some* compare page still has a live signature; this script removes the
dependence on Helio entirely.

It downloads each still-valid thumbnail **once** into a committed,
content-addressed cache — ``assets/helio_thumbnails/<asset-id>.webp`` — compresses
it to WebP, and rewrites ``publish/data/trends.json`` to reference the local copy
(served from ``publish/data/thumbnails/``). The cache key is the **Helio asset
ULID** from the URL path (``/asset/<ULID>/…``), which is stable across re-signs,
so a cached asset is reused regardless of the current URL's expiry. Once captured,
a thumbnail is never lost. The CI Pages workflow commits new cache files back to
``main`` (alongside the Notion snapshot), making the cache durable.

Best-effort and **non-blocking**: a missing Pillow, a failed download, or an
unparseable URL leaves the original reference untouched (the dashboard's ``img``
``onerror`` fallback still applies) and never raises to the caller. Relative local
paths survive the GitHub Pages ``/<repo>/`` subpath (resolved against the homepage
at the site root).

Run: ``python3 scripts/cache_helio_thumbnails.py --root .`` (build.sh runs it
between build_trends.js and render_trends_dashboard.js).
"""

import argparse
import io
import json
import re
import shutil
import sys
from pathlib import Path

# Helio asset id (ULID, Crockford base32) from the signed URL path. Stable across
# re-signs, so it dedupes the same screen across compare pages and survives expiry.
ASSET_RE = re.compile(r"/asset/([0-9A-Za-z]+)")
CACHE_SUBDIR = ("assets", "helio_thumbnails")  # committed (NOT under publish/)
PUBLISH_SUBDIR = ("publish", "data", "thumbnails")  # served copy (gitignored)
REL_PREFIX = "data/thumbnails"  # relative to publish/index.html (the site root)
MAX_WIDTH = 600  # downscale only; Helio "medium" thumbnails are ~280px wide
WEBP_QUALITY = 80
HTTP_TIMEOUT = 20


def asset_id(url):
    """The Helio asset ULID from a thumbnail URL, or None if it doesn't match."""
    m = ASSET_RE.search(str(url or ""))
    return m.group(1) if m else None


def _default_fetch(url):
    import requests

    resp = requests.get(url, timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    return resp.content


def _compress_to_webp(raw, dest):
    """Write ``raw`` image bytes to ``dest`` as a size-capped WebP. Raises on bad input."""
    from PIL import Image

    im = Image.open(io.BytesIO(raw))
    im = im.convert("RGB")  # screenshots: drop alpha, normalize mode for WebP
    w, h = im.size
    if w > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, max(1, round(h * MAX_WIDTH / w))))
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)


def localize_thumbnails(root, fetch=_default_fetch, log=print):
    """Cache + localize every Helio thumbnail referenced by trends.json.

    Returns a stats dict: cached (reused), downloaded (newly fetched), failed,
    skipped (no parseable asset id). Mutates trends.json in place when anything
    resolved to a local copy.
    """
    root = Path(root)
    stats = {"cached": 0, "downloaded": 0, "failed": 0, "skipped": 0}
    trends_path = root.joinpath("publish", "data", "trends.json")
    if not trends_path.exists():
        log("cache_helio_thumbnails: no trends.json; skipping.")
        return stats
    try:
        trends = json.loads(trends_path.read_text("utf-8"))
    except Exception as exc:  # pragma: no cover - defensive
        log(f"cache_helio_thumbnails: unreadable trends.json ({exc}); skipping.")
        return stats

    cache_dir = root.joinpath(*CACHE_SUBDIR)
    publish_dir = root.joinpath(*PUBLISH_SUBDIR)
    rows = trends.get("helio_metrics") or []

    url_to_local = {}
    for row in rows:
        url = row.get("thumbnail") if isinstance(row, dict) else None
        if not isinstance(url, str) or not url.startswith("http") or url in url_to_local:
            continue
        aid = asset_id(url)
        if not aid:
            stats["skipped"] += 1
            continue
        rel = f"{REL_PREFIX}/{aid}.webp"
        dest = cache_dir.joinpath(f"{aid}.webp")
        if dest.exists():
            # Already captured — reuse regardless of the URL's (possibly lapsed) expiry.
            url_to_local[url] = rel
            stats["cached"] += 1
            continue
        try:
            _compress_to_webp(fetch(url), dest)
            url_to_local[url] = rel
            stats["downloaded"] += 1
        except Exception as exc:
            # Expired/unreachable URL with nothing cached yet → leave the original
            # reference; the dashboard's onerror still degrades gracefully.
            log(f"cache_helio_thumbnails: could not cache {aid}: {exc}")
            stats["failed"] += 1

    if url_to_local:
        changed = False
        for row in rows:
            url = row.get("thumbnail") if isinstance(row, dict) else None
            if isinstance(url, str) and url in url_to_local:
                row["thumbnail"] = url_to_local[url]
                changed = True
        if changed:
            trends_path.write_text(json.dumps(trends, indent=2, ensure_ascii=False) + "\n", "utf-8")
        # Copy the referenced cache files into the served (gitignored) publish dir.
        publish_dir.mkdir(parents=True, exist_ok=True)
        for rel in set(url_to_local.values()):
            name = rel.rsplit("/", 1)[-1]
            src = cache_dir.joinpath(name)
            if src.exists():
                shutil.copy2(src, publish_dir.joinpath(name))

    log(f"cache_helio_thumbnails: {stats}")
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=".", help="Repo root (default: cwd)")
    args = ap.parse_args()
    try:
        localize_thumbnails(Path(args.root))
    except Exception as exc:  # pragma: no cover - never fail a deploy
        print(f"cache_helio_thumbnails: unexpected error ({exc}); continuing.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
