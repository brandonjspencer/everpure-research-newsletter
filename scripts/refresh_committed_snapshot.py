#!/usr/bin/env python3
"""Refresh the committed Notion snapshot from a successful live build.

The committed ``data/Everpure.html`` is the source-of-truth *fallback* the CI
build parses when a live Notion fetch fails (see ``netlify/build.sh``). If it is
never updated it slowly drifts from the live page, so a fallback build silently
serves stale content.

This script keeps the snapshot fresh: after a build, it reads the refresh
manifest and — **only when the build used a live fetch that produced a non-empty
result** — copies the freshly-fetched HTML over ``data/Everpure.html``. The
caller (the Pages workflow) then commits the file *iff* git reports it changed,
with a ``[skip ci]`` message so the commit does not re-trigger the build.

It is intentionally best-effort: any unexpected condition prints a warning and
exits 0 (a snapshot-refresh problem must never fail a deploy). It writes the
destination but never runs git — committing is the workflow's job.

Live fetch methods (worth committing): ``notion_api`` / ``playwright`` /
``requests``. Fallback tiers (``local_html_fallback`` /
``fallback_existing_outputs`` / ``local_html``) are skipped — re-committing the
snapshot over itself, or over reused stale outputs, is pointless or wrong.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Fetch tiers that represent a fresh pull from the live Notion page. Mirrors the
# methods produced by everpure_refresh.NotionFetcher.fetch().
LIVE_FETCH_METHODS = {"notion_api", "playwright", "requests"}

# A rendered snapshot must carry Notion block markers to be parser-usable; guard
# against committing an error page or truncated body.
BLOCK_HINT = "data-block-id"
MIN_HTML_BYTES = 1000


def _load_manifest(manifest_path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"refresh-snapshot: no manifest at {manifest_path}; skipping.")
        return None
    except (ValueError, OSError) as exc:
        print(f"::warning::refresh-snapshot: could not read manifest {manifest_path}: {exc}")
        return None


def _locate_fetched_html(source: Dict[str, Any], raw_dir: Path) -> Optional[Path]:
    """Return the freshly-fetched HTML file, or None if it cannot be found."""
    recorded = source.get("source_html_path")
    if recorded:
        candidate = Path(recorded)
        if candidate.is_file():
            return candidate
    # Fall back to the newest snapshot in the raw dir (timestamped filenames sort
    # chronologically) in case the recorded path is relative/stale.
    if raw_dir.is_dir():
        snapshots = sorted(raw_dir.glob("everpure_snapshot_*.html"))
        if snapshots:
            return snapshots[-1]
    return None


def refresh_snapshot(manifest_path: Path, dest_path: Path, raw_dir: Path) -> str:
    """Copy the live-fetched HTML over ``dest_path`` when the build was live.

    Returns a short status string: ``updated`` / ``unchanged`` / ``skipped:...``.
    Never raises for an expected condition — the snapshot refresh is best-effort.
    """
    manifest = _load_manifest(manifest_path)
    if manifest is None:
        return "skipped: no manifest"

    source = manifest.get("source") or {}
    method = source.get("fetch_method")
    if method not in LIVE_FETCH_METHODS:
        print(f"refresh-snapshot: fetch_method={method!r} is not a live fetch; leaving snapshot.")
        return f"skipped: non-live fetch ({method})"

    record_count = manifest.get("record_count") or 0
    if not isinstance(record_count, int) or record_count <= 0:
        print(
            f"::warning::refresh-snapshot: live fetch but record_count={record_count!r}; leaving snapshot."
        )
        return "skipped: empty result"

    fetched = _locate_fetched_html(source, raw_dir)
    if fetched is None:
        print(
            "::warning::refresh-snapshot: live fetch but no fetched HTML file found; leaving snapshot."
        )
        return "skipped: html not found"

    try:
        new_html = fetched.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"::warning::refresh-snapshot: could not read {fetched}: {exc}; leaving snapshot.")
        return "skipped: html unreadable"

    if len(new_html) < MIN_HTML_BYTES or BLOCK_HINT not in new_html:
        print(
            f"::warning::refresh-snapshot: fetched HTML failed sanity check "
            f"(len={len(new_html)}, has_blocks={BLOCK_HINT in new_html}); leaving snapshot."
        )
        return "skipped: failed sanity check"

    existing = dest_path.read_text(encoding="utf-8") if dest_path.is_file() else None
    if existing == new_html:
        print(f"refresh-snapshot: snapshot already current ({record_count} records, via {method}).")
        return "unchanged"

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    dest_path.write_text(new_html, encoding="utf-8")
    print(f"refresh-snapshot: updated {dest_path} ({record_count} records, via {method}).")
    return "updated"


def cli() -> int:
    ap = argparse.ArgumentParser(
        description="Refresh the committed Notion snapshot from a live build"
    )
    ap.add_argument(
        "--manifest",
        default="publish/data/refresh_manifest.json",
        help="Path to refresh_manifest.json produced by the build",
    )
    ap.add_argument(
        "--dest",
        default="data/Everpure.html",
        help="Committed snapshot to refresh",
    )
    ap.add_argument(
        "--raw-dir",
        default="raw",
        help="Directory holding fetched everpure_snapshot_*.html files",
    )
    args = ap.parse_args()

    status = refresh_snapshot(Path(args.manifest), Path(args.dest), Path(args.raw_dir))
    # Always succeed: a snapshot-refresh issue must not fail the deploy. The
    # workflow decides whether to commit based on git's view of the file.
    print(f"RESULT: {status}")
    return 0


if __name__ == "__main__":
    sys.exit(cli())
