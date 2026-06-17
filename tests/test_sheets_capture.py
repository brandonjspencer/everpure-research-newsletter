"""Unit tests for the multi-tab Google Sheets capture logic.

These cover the PURE decision helpers (error classification, tab selection,
truncation flagging) plus the retry/fallback orchestration in
everpure_external_research_ingest.fetch_spreadsheet_with_policy, exercised with
a fake session so no live Google API is required.
"""

import pytest
import requests

import everpure_external_research_ingest as ingest

# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


def make_http_error(status_code, message="boom"):
    err = requests.HTTPError(message)
    resp = requests.Response()
    resp.status_code = status_code
    err.response = resp
    return err


class FakeSession:
    """Minimal session that serves the Drive CSV export endpoint for tests."""

    def __init__(self, csv_text=""):
        self._csv_text = csv_text
        self.export_calls = 0
        self.headers = {}

    def get(self, url, **kwargs):
        if "/export" in url:
            self.export_calls += 1
            return _FakeResponse(text=self._csv_text, status_code=200)
        raise AssertionError(f"Unexpected get() to {url}")


class _FakeResponse:
    def __init__(self, text="", status_code=200, json_payload=None):
        self.text = text
        self.status_code = status_code
        self._json = json_payload or {}
        self.headers = {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise make_http_error(self.status_code)

    def json(self):
        return self._json


# ---------------------------------------------------------------------------
# should_fall_back_to_csv
# ---------------------------------------------------------------------------


def test_fallback_only_for_api_disabled_403():
    assert ingest.should_fall_back_to_csv(403, "Sheets API has not been used in project")
    assert ingest.should_fall_back_to_csv(403, "SERVICE_DISABLED")
    assert ingest.should_fall_back_to_csv(404, "accessNotConfigured: enable it by visiting ...")


def test_no_fallback_for_plain_403_permission():
    # A sharing/permission 403 is NOT an API-disabled signal.
    assert ingest.should_fall_back_to_csv(403, "The caller does not have permission") is False


def test_no_fallback_for_transient_errors():
    assert ingest.should_fall_back_to_csv(429, "rateLimitExceeded") is False
    for code in (500, 502, 503, 504):
        assert ingest.should_fall_back_to_csv(code, "backendError") is False


def test_no_fallback_for_timeout_none_status():
    assert ingest.should_fall_back_to_csv(None, "ReadTimeout") is False


def test_is_transient_status():
    assert ingest.is_transient_status(None) is True  # timeouts / connection errors
    assert ingest.is_transient_status(429) is True
    assert ingest.is_transient_status(503) is True
    assert ingest.is_transient_status(403) is False
    assert ingest.is_transient_status(200) is False


# ---------------------------------------------------------------------------
# tab_selection
# ---------------------------------------------------------------------------


def _meta_with_tabs(*tabs):
    return {
        "properties": {"title": "Data Comparison"},
        "sheets": [
            {
                "properties": {
                    "sheetId": sid,
                    "title": title,
                    "gridProperties": {"rowCount": rows, "columnCount": cols},
                }
            }
            for (sid, title, rows, cols) in tabs
        ],
    }


def test_tab_selection_no_gid_selects_all_tabs():
    meta = _meta_with_tabs(
        (0, "Summary", 10, 5),
        (123, "Concept A", 20, 8),
        (456, "Concept B", 30, 12),
    )
    sel = ingest.tab_selection(meta, gid=None)
    assert sel["sheet_count"] == 3
    assert len(sel["selected"]) == 3
    assert sel["requested_gid_not_found"] is False


def test_tab_selection_gid_match_selects_single_tab():
    meta = _meta_with_tabs((0, "Summary", 10, 5), (123, "Concept A", 20, 8))
    sel = ingest.tab_selection(meta, gid="123")
    assert len(sel["selected"]) == 1
    assert (sel["selected"][0]["properties"]["title"]) == "Concept A"
    assert sel["requested_gid_not_found"] is False


def test_tab_selection_gid_not_found_marks_flag_and_reads_nothing():
    meta = _meta_with_tabs((0, "Summary", 10, 5), (123, "Concept A", 20, 8))
    sel = ingest.tab_selection(meta, gid="999")
    assert sel["selected"] == []
    assert sel["requested_gid_not_found"] is True
    assert sel["requested_gid"] == "999"
    assert sel["sheet_count"] == 2


# ---------------------------------------------------------------------------
# flag_truncation
# ---------------------------------------------------------------------------


def test_flag_truncation_flags_rows_and_columns():
    flags = ingest.flag_truncation(
        {"rowCount": 500, "columnCount": 80}, max_rows=200, max_columns=52
    )
    assert flags["row_truncated"] is True
    assert flags["column_truncated"] is True
    assert flags["total_row_count"] == 500
    assert flags["total_column_count"] == 80


def test_flag_truncation_no_flags_when_within_caps():
    flags = ingest.flag_truncation(
        {"rowCount": 40, "columnCount": 12}, max_rows=200, max_columns=52
    )
    assert flags["row_truncated"] is False
    assert flags["column_truncated"] is False


def test_flag_truncation_handles_missing_grid_props():
    flags = ingest.flag_truncation({}, max_rows=200, max_columns=52)
    assert flags["row_truncated"] is False
    assert flags["column_truncated"] is False
    assert flags["total_row_count"] is None


# ---------------------------------------------------------------------------
# fetch_sheet_via_sheets_api — wired with a monkeypatched get_json
# ---------------------------------------------------------------------------


def _patch_get_json(monkeypatch, meta, values_by_title):
    def fake_get_json(session, url, **kwargs):
        if url.endswith("/values/") or "/values/" in url:
            # Decode the range to find the title between quotes.
            for title, values in values_by_title.items():
                if ingest.quote(f"'{title}'", safe="") in url or title in url:
                    return {"values": values}
            return {"values": []}
        return meta

    monkeypatch.setattr(ingest, "get_json", fake_get_json)


def test_sheets_api_no_gid_reads_all_tabs(monkeypatch):
    meta = _meta_with_tabs(
        (0, "Summary", 300, 10),
        (123, "Concept A", 20, 8),
    )
    _patch_get_json(
        monkeypatch,
        meta,
        {"Summary": [["h1", "h2"], ["a", "b"]], "Concept A": [["x"], ["y"]]},
    )
    sheets, fetch_meta = ingest.fetch_sheet_via_sheets_api(
        session=object(),
        spreadsheet_id="SID",
        gid=None,
        max_rows=200,
        max_columns=52,
        max_sheets_per_file=0,
    )
    assert fetch_meta["method"] == "sheets_api"
    assert fetch_meta["sheet_count"] == 2
    assert fetch_meta["selected_sheet_count"] == 2
    assert len(sheets) == 2
    # Summary tab has 300 rows -> row_truncated should be set.
    summary_tab = next(s for s in sheets if s["sheet_title"] == "Summary")
    assert summary_tab["row_truncated"] is True
    assert summary_tab["total_row_count"] == 300


def test_sheets_api_gid_not_found_records_marker(monkeypatch):
    meta = _meta_with_tabs((0, "Summary", 10, 5))
    _patch_get_json(monkeypatch, meta, {"Summary": [["h"]]})
    sheets, fetch_meta = ingest.fetch_sheet_via_sheets_api(
        session=object(),
        spreadsheet_id="SID",
        gid="999",
        max_rows=200,
        max_columns=52,
        max_sheets_per_file=0,
    )
    assert fetch_meta["requested_gid_not_found"] is True
    assert sheets == []  # did not silently read other tabs


def test_sheets_api_safety_cap_sets_sheets_truncated(monkeypatch):
    meta = _meta_with_tabs((0, "A", 5, 5), (1, "B", 5, 5), (2, "C", 5, 5))
    _patch_get_json(monkeypatch, meta, {"A": [["1"]], "B": [["2"]], "C": [["3"]]})
    sheets, fetch_meta = ingest.fetch_sheet_via_sheets_api(
        session=object(),
        spreadsheet_id="SID",
        gid=None,
        max_rows=200,
        max_columns=52,
        max_sheets_per_file=2,
    )
    assert fetch_meta["sheets_truncated"] is True
    assert fetch_meta["sheet_count"] == 3
    assert len(sheets) == 2


# ---------------------------------------------------------------------------
# fetch_spreadsheet_with_policy — retry + narrow fallback
# ---------------------------------------------------------------------------


def test_policy_retries_transient_then_succeeds(monkeypatch):
    calls = {"n": 0}

    def flaky(**kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise make_http_error(503)
        return [{"sheet_title": "Summary"}], {"method": "sheets_api"}

    monkeypatch.setattr(ingest, "fetch_sheet_via_sheets_api", flaky)
    sleeps = []
    sheets, fetch_meta = ingest.fetch_spreadsheet_with_policy(
        session=object(),
        spreadsheet_id="SID",
        gid=None,
        max_rows=200,
        max_columns=52,
        max_sheets_per_file=0,
        retry_attempts=3,
        backoff_seconds=0.01,
        sleep_fn=lambda s: sleeps.append(s),
    )
    assert fetch_meta["method"] == "sheets_api"
    assert fetch_meta["sheets_api_attempts"] == 3
    assert calls["n"] == 3
    assert len(sleeps) == 2  # retried twice before success


def test_policy_hard_error_on_exhausted_transient(monkeypatch):
    def always_503(**kwargs):
        raise make_http_error(503)

    monkeypatch.setattr(ingest, "fetch_sheet_via_sheets_api", always_503)
    with pytest.raises(requests.HTTPError):
        ingest.fetch_spreadsheet_with_policy(
            session=object(),
            spreadsheet_id="SID",
            gid=None,
            max_rows=200,
            max_columns=52,
            max_sheets_per_file=0,
            retry_attempts=2,
            backoff_seconds=0.0,
            sleep_fn=lambda s: None,
        )


def test_policy_hard_error_on_429_does_not_fall_back(monkeypatch):
    def always_429(**kwargs):
        raise make_http_error(429)

    export_used = {"n": 0}

    def fake_export(**kwargs):
        export_used["n"] += 1
        return [{}], {"method": "drive_csv_export"}

    monkeypatch.setattr(ingest, "fetch_sheet_via_sheets_api", always_429)
    monkeypatch.setattr(ingest, "fetch_sheet_via_drive_export", fake_export)
    with pytest.raises(requests.HTTPError):
        ingest.fetch_spreadsheet_with_policy(
            session=object(),
            spreadsheet_id="SID",
            gid=None,
            max_rows=200,
            max_columns=52,
            max_sheets_per_file=0,
            retry_attempts=2,
            backoff_seconds=0.0,
            sleep_fn=lambda s: None,
        )
    assert export_used["n"] == 0  # never silently fell back to first-tab CSV


def test_policy_falls_back_to_csv_only_when_api_disabled(monkeypatch):
    def api_disabled(**kwargs):
        raise make_http_error(
            403, "Google Sheets API has not been used in project; SERVICE_DISABLED"
        )

    captured = {}

    def fake_export(
        session, spreadsheet_id, max_rows, max_columns, gid_requested, known_sheet_count
    ):
        captured["gid_requested"] = gid_requested
        summary = {
            "sheet_title": "Drive CSV export",
            "truncated_to_first_tab": gid_requested,
            "gid_ignored": gid_requested,
        }
        return [summary], {
            "method": "drive_csv_export",
            "truncated_to_first_tab": gid_requested,
            "gid_ignored": gid_requested,
        }

    monkeypatch.setattr(ingest, "fetch_sheet_via_sheets_api", api_disabled)
    monkeypatch.setattr(ingest, "fetch_sheet_via_drive_export", fake_export)
    sheets, fetch_meta = ingest.fetch_spreadsheet_with_policy(
        session=object(),
        spreadsheet_id="SID",
        gid="42",
        max_rows=200,
        max_columns=52,
        max_sheets_per_file=0,
        retry_attempts=2,
        backoff_seconds=0.0,
        sleep_fn=lambda s: None,
    )
    assert fetch_meta["method"] == "drive_csv_export"
    assert fetch_meta["fallback_reason"] == "sheets_api_disabled"
    assert captured["gid_requested"] is True
    assert fetch_meta["gid_ignored"] is True  # gid was requested -> flagged


# ---------------------------------------------------------------------------
# fetch_sheet_via_drive_export — flags
# ---------------------------------------------------------------------------


def test_drive_export_flags_multi_tab_and_gid():
    session = FakeSession(csv_text="a,b\n1,2\n")
    sheets, fetch_meta = ingest.fetch_sheet_via_drive_export(
        session=session,
        spreadsheet_id="SID",
        max_rows=200,
        max_columns=52,
        gid_requested=True,
        known_sheet_count=3,
    )
    assert sheets[0]["truncated_to_first_tab"] is True
    assert sheets[0]["gid_ignored"] is True
    assert fetch_meta["truncated_to_first_tab"] is True


def test_drive_export_single_tab_no_gid_not_flagged():
    session = FakeSession(csv_text="a,b\n1,2\n")
    sheets, fetch_meta = ingest.fetch_sheet_via_drive_export(
        session=session,
        spreadsheet_id="SID",
        max_rows=200,
        max_columns=52,
        gid_requested=False,
        known_sheet_count=1,
    )
    assert sheets[0]["truncated_to_first_tab"] is False
    assert sheets[0]["gid_ignored"] is False


# ---------------------------------------------------------------------------
# degradation_flags rollup
# ---------------------------------------------------------------------------


def test_degradation_flags_rollup():
    sheets = [
        {"row_truncated": True, "column_truncated": False},
        {"row_truncated": False, "column_truncated": True},
    ]
    flags = ingest.degradation_flags(sheets, {"sheets_truncated": True})
    assert flags["row_truncated"] is True
    assert flags["column_truncated"] is True
    assert flags["sheets_truncated"] is True
    assert flags["degraded"] is True


def test_degradation_flags_clean_capture():
    sheets = [{"row_truncated": False, "column_truncated": False}]
    flags = ingest.degradation_flags(sheets, {"method": "sheets_api"})
    assert flags["degraded"] is False
