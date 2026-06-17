"""Tests for scripts/refresh_committed_snapshot.refresh_snapshot.

The committed snapshot must be refreshed only from a live, non-empty fetch and
must be left untouched on every fallback tier — otherwise a fallback build would
overwrite the source-of-truth snapshot with stale or empty content.
"""

import json
from pathlib import Path

from scripts.refresh_committed_snapshot import refresh_snapshot

# A rendered snapshot must exceed MIN_HTML_BYTES (1000) and carry the block hint.
VALID_HTML = (
    '<!doctype html><html><head><meta charset="utf-8"><title>Everpure</title></head>'
    '<body><div data-block-id="abc" class="notion-text-block">'
    '<div data-content-editable-leaf="true">Weekly Rundown</div></div>'
    + ("<!-- pad -->" * 120)
    + "</body></html>"
)


def _write_manifest(path: Path, *, method, record_count, html_path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "record_count": record_count,
                "source": {
                    "fetch_method": method,
                    "source_html_path": str(html_path) if html_path else None,
                },
            }
        ),
        encoding="utf-8",
    )


def _setup(tmp_path, *, method="notion_api", record_count=56, html=VALID_HTML, write_html=True):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir(parents=True)
    fetched = raw_dir / "everpure_snapshot_20260617T000000Z.html"
    if write_html:
        fetched.write_text(html, encoding="utf-8")
    manifest = tmp_path / "publish" / "data" / "refresh_manifest.json"
    _write_manifest(manifest, method=method, record_count=record_count, html_path=fetched)
    dest = tmp_path / "data" / "Everpure.html"
    return manifest, dest, raw_dir, fetched


def test_live_fetch_updates_snapshot(tmp_path):
    manifest, dest, raw_dir, _ = _setup(tmp_path)
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "updated"
    assert dest.read_text(encoding="utf-8") == VALID_HTML


def test_unchanged_when_identical(tmp_path):
    manifest, dest, raw_dir, _ = _setup(tmp_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(VALID_HTML, encoding="utf-8")
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "unchanged"


def test_each_fallback_tier_is_skipped(tmp_path):
    for method in ("local_html_fallback", "fallback_existing_outputs", "local_html"):
        manifest, dest, raw_dir, _ = _setup(tmp_path / method, method=method)
        status = refresh_snapshot(manifest, dest, raw_dir)
        assert status.startswith("skipped"), (method, status)
        assert not dest.exists()


def test_empty_result_is_skipped(tmp_path):
    manifest, dest, raw_dir, _ = _setup(tmp_path, record_count=0)
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "skipped: empty result"
    assert not dest.exists()


def test_missing_html_is_skipped(tmp_path):
    manifest, dest, raw_dir, _ = _setup(tmp_path, write_html=False)
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "skipped: html not found"
    assert not dest.exists()


def test_sanity_check_rejects_thin_html(tmp_path):
    manifest, dest, raw_dir, _ = _setup(tmp_path, html="<html><body>nope</body></html>")
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "skipped: failed sanity check"
    assert not dest.exists()


def test_missing_manifest_is_skipped(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    status = refresh_snapshot(tmp_path / "nope.json", tmp_path / "data" / "Everpure.html", raw_dir)
    assert status == "skipped: no manifest"


def test_falls_back_to_newest_raw_snapshot(tmp_path):
    # Recorded path is stale/missing, but a snapshot exists in the raw dir.
    manifest, dest, raw_dir, fetched = _setup(tmp_path)
    _write_manifest(
        manifest,
        method="notion_api",
        record_count=56,
        html_path=tmp_path / "raw" / "does_not_exist.html",
    )
    status = refresh_snapshot(manifest, dest, raw_dir)
    assert status == "updated"
    assert dest.read_text(encoding="utf-8") == VALID_HTML
