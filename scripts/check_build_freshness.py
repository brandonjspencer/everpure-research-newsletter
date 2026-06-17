#!/usr/bin/env python3
"""Build-freshness gate for the monthly new-issue ritual.

A green build is **not** proof the source data is fresh (see OPERATIONS.md
"Verify build freshness"). Before any editorial synthesis, this reports which
source tier produced the build and whether linked-sheet capture degraded, and
exits non-zero when the build is not safe to treat as current — so the
`/new-issue` skill can hard-pause instead of drafting on stale data.

Exit codes:
  0  live fetch (notion_api/playwright/requests), no capture degradation
  3  live fetch, but linked-sheet capture degraded (investigate, then proceed)
  1  fallback tier (committed snapshot or reused outputs) — do NOT treat as current
  2  no manifest found (build missing or incomplete)
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

LIVE_FETCH_METHODS = {"notion_api", "playwright", "requests"}


def _load(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return None


def check_freshness(data_dir: Path) -> Dict[str, Any]:
    manifest = _load(data_dir / "refresh_manifest.json")
    if manifest is None:
        return {"status": "no_manifest", "exit": 2}

    source = manifest.get("source") or {}
    method = source.get("fetch_method")
    fallback = source.get("source_fallback")
    record_count = manifest.get("record_count")
    date_range = manifest.get("date_range") or {}

    # deck_link_fetch_status.json lives alongside the data, or one level up.
    deck = (
        _load(data_dir / "deck_link_fetch_status.json")
        or _load(data_dir.parent / "deck_link_fetch_status.json")
        or {}
    )
    degraded = int(deck.get("degraded_count") or 0)
    truncated = int(deck.get("truncated_to_first_tab_count") or 0)
    gid_missing = int(deck.get("requested_gid_not_found_count") or 0)

    # Helio capture (compare share pages + report API). A failed/empty Helio fetch
    # is a degradation signal, the same way a degraded sheet capture is.
    helio = (
        _load(data_dir / "helio_fetch_status.json")
        or _load(data_dir.parent / "helio_fetch_status.json")
        or {}
    )
    helio_summary = helio.get("summary") or {}
    helio_errors = int(helio_summary.get("error_count") or 0)
    helio_empty = int(helio_summary.get("empty_count") or 0)

    capture_degraded = degraded + truncated + gid_missing + helio_errors + helio_empty

    live = method in LIVE_FETCH_METHODS
    if not live:
        status, code = "fallback", 1
    elif capture_degraded:
        status, code = "live_degraded", 3
    else:
        status, code = "live_clean", 0

    return {
        "status": status,
        "exit": code,
        "fetch_method": method,
        "source_fallback": fallback,
        "record_count": record_count,
        "date_range": date_range,
        "deck_capture": {
            "degraded_count": degraded,
            "truncated_to_first_tab_count": truncated,
            "requested_gid_not_found_count": gid_missing,
        },
        "helio_capture": {
            "error_count": helio_errors,
            "empty_count": helio_empty,
            "evidence_count": int(helio_summary.get("evidence_count") or 0),
            "tier_b_report_api": helio_summary.get("tier_b_report_api"),
        },
    }


def _print_human(result: Dict[str, Any]) -> None:
    status = result["status"]
    if status == "no_manifest":
        print("❌ No refresh_manifest.json — run a build first (bash netlify/build.sh).")
        return
    dr = result.get("date_range") or {}
    print(f"fetch_method : {result.get('fetch_method')!r}")
    if result.get("source_fallback"):
        print(f"fallback     : {result['source_fallback']!r}")
    print(f"record_count : {result.get('record_count')}")
    print(f"date_range   : {dr.get('min')} … {dr.get('max')}")
    dc = result["deck_capture"]
    print(
        "deck_capture : "
        f"degraded={dc['degraded_count']} "
        f"truncated_to_first_tab={dc['truncated_to_first_tab_count']} "
        f"gid_not_found={dc['requested_gid_not_found_count']}"
    )
    hc = result.get("helio_capture") or {}
    print(
        "helio_capture: "
        f"evidence={hc.get('evidence_count', 0)} "
        f"errors={hc.get('error_count', 0)} "
        f"empty={hc.get('empty_count', 0)} "
        f"report_api={hc.get('tier_b_report_api')}"
    )
    if status == "live_clean":
        print("✅ Live fetch, clean capture — safe to draft.")
    elif status == "live_degraded":
        print(
            "⚠️  Live fetch, but linked-sheet capture degraded — investigate before relying on it."
        )
    elif status == "fallback":
        print(
            "⛔ Fallback tier (not a live fetch) — do NOT treat as current. Obtain a fresh build."
        )


def cli() -> int:
    ap = argparse.ArgumentParser(
        description="Report build source freshness for the new-issue ritual"
    )
    ap.add_argument("--data-dir", default="publish/data", help="Build data dir (publish/data)")
    ap.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = ap.parse_args()

    result = check_freshness(Path(args.data_dir))
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        _print_human(result)
        print(f"FRESHNESS: {result['status']}")
    return int(result["exit"])


if __name__ == "__main__":
    sys.exit(cli())
