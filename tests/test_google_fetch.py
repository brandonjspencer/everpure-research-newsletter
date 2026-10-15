"""Deck selection under GOOGLE_FETCH_LIMIT."""

import argparse

import everpure_google_fetch as gf


def _args(limit=None, file_id=None):
    return argparse.Namespace(limit=limit, file_id=file_id)


DECKS = [
    {"file_id": "10-old", "associated_weeks": ["2025-01-23"]},
    {"file_id": "1hxh-mid", "associated_weeks": ["2026-02-26", "2025-12-11"]},
    {"file_id": "1pctd-newest", "associated_weeks": ["2026-10-15"]},
    {"file_id": "1s2I-recent", "associated_weeks": ["2026-09-24"]},
    {"file_id": "1zz-no-weeks", "associated_weeks": []},
]


def test_limit_keeps_most_recent_decks_not_alphabetical_head():
    ids = gf.selected_file_ids(_args(limit=3), DECKS)
    assert set(ids) == {"1pctd-newest", "1s2I-recent", "1hxh-mid"}
    # Original (file id) order is preserved for the kept decks.
    assert ids == ["1hxh-mid", "1pctd-newest", "1s2I-recent"]


def test_no_limit_returns_all_in_original_order():
    assert gf.selected_file_ids(_args(), DECKS) == [d["file_id"] for d in DECKS]


def test_explicit_file_ids_win():
    assert gf.selected_file_ids(_args(limit=1, file_id=["x"]), DECKS) == ["x"]
