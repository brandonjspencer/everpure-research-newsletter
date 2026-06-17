"""Tests for scripts/check_build_freshness.check_freshness.

The freshness gate must distinguish a live, clean build (safe to draft) from a
fallback build (stale risk) and from degraded linked-sheet capture, so the
new-issue skill can hard-stop on the unsafe tiers.
"""

import json
from pathlib import Path

from scripts.check_build_freshness import check_freshness


def _write(data_dir: Path, *, method, deck=None):
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "refresh_manifest.json").write_text(
        json.dumps(
            {
                "record_count": 56,
                "date_range": {"min": "2026-05-13", "max": "2026-06-11"},
                "source": {"fetch_method": method},
            }
        ),
        encoding="utf-8",
    )
    if deck is not None:
        (data_dir / "deck_link_fetch_status.json").write_text(json.dumps(deck), encoding="utf-8")


def test_live_clean(tmp_path):
    _write(
        tmp_path,
        method="notion_api",
        deck={
            "degraded_count": 0,
            "truncated_to_first_tab_count": 0,
            "requested_gid_not_found_count": 0,
        },
    )
    r = check_freshness(tmp_path)
    assert r["status"] == "live_clean" and r["exit"] == 0


def test_fallback_tier_stops(tmp_path):
    _write(tmp_path, method="local_html_fallback")
    r = check_freshness(tmp_path)
    assert r["status"] == "fallback" and r["exit"] == 1


def test_existing_outputs_fallback_stops(tmp_path):
    _write(tmp_path, method="fallback_existing_outputs")
    assert check_freshness(tmp_path)["exit"] == 1


def test_live_but_degraded_capture(tmp_path):
    _write(
        tmp_path,
        method="notion_api",
        deck={
            "degraded_count": 2,
            "truncated_to_first_tab_count": 0,
            "requested_gid_not_found_count": 1,
        },
    )
    r = check_freshness(tmp_path)
    assert r["status"] == "live_degraded" and r["exit"] == 3


def test_no_manifest(tmp_path):
    r = check_freshness(tmp_path)
    assert r["status"] == "no_manifest" and r["exit"] == 2
