"""Smoke test for the Python ingestion path.

Runs everpure_refresh.py against the committed Notion HTML snapshot (the same
fallback path CI validates in netlify/build.sh) and asserts the normalized
outputs are present and well-formed.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "Everpure.html"


def test_refresh_parses_committed_snapshot(tmp_path):
    assert SNAPSHOT.exists(), "committed source snapshot data/Everpure.html is missing"

    out_dir = tmp_path / "out"
    out_dir.mkdir()

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "everpure_refresh.py"),
            "--html-path",
            str(SNAPSHOT),
            "--output-dir",
            str(out_dir),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"refresh exited {result.returncode}\nSTDERR:\n{result.stderr}"

    weeks_path = out_dir / "weeks.json"
    summary_path = out_dir / "summary.json"
    assert weeks_path.exists(), "weeks.json was not produced"
    assert summary_path.exists(), "summary.json was not produced"

    weeks = json.loads(weeks_path.read_text(encoding="utf-8"))
    assert isinstance(weeks, list) and len(weeks) > 0, "expected at least one weekly record"

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    latest = summary.get("date_range", {}).get("max")
    assert latest, "summary.json should report a latest source date (date_range.max)"


def test_weekly_records_have_expected_shape(tmp_path):
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    subprocess.run(
        [
            sys.executable,
            str(ROOT / "everpure_refresh.py"),
            "--html-path",
            str(SNAPSHOT),
            "--output-dir",
            str(out_dir),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    weeks = json.loads((out_dir / "weeks.json").read_text(encoding="utf-8"))
    first = weeks[0]
    assert "week_date" in first, "weekly records should carry a week_date"
    assert "content_groups" in first, "weekly records should carry content_groups"
