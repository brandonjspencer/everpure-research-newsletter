"""Tests for the Notion public-API fetch + recordMap-to-HTML renderer.

No network: the render/parse path uses a committed 974-block fixture, and the
pagination/retry path uses a fake session that simulates loadPageChunk chunks
(including a 429 that is retried).
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

import everpure_notion_api as api
from everpure_parser import is_date_heading, parse_html

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "notion_recordmap.json"
PAGE_ID = "1ef2e6d8-924e-4c3c-827a-8aa850802295"
SOURCE_URL = "https://majestic-carbon-753.notion.site/Everpure-1ef2e6d8924e4c3c827a8aa850802295"


def _load_blocks() -> Dict[str, Any]:
    with FIXTURE.open(encoding="utf-8") as f:
        return json.load(f)["block"]


# ---------------------------------------------------------------------------
# page_id_from_url
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "url",
    [
        SOURCE_URL,
        SOURCE_URL + "?pvs=4",
        "https://foo.notion.site/1ef2e6d8924e4c3c827a8aa850802295",
        "https://foo.notion.site/Everpure-1ef2e6d8-924e-4c3c-827a-8aa850802295/",
    ],
)
def test_page_id_from_url(url):
    assert api.page_id_from_url(url) == PAGE_ID


def test_page_id_from_url_rejects_garbage():
    with pytest.raises(api.NotionApiError):
        api.page_id_from_url("https://example.com/not-a-notion-page")


# ---------------------------------------------------------------------------
# is_date_heading
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "text",
    ["📌 July 30, 2026", "📌 Jul 30, 2026"],
)
def test_is_date_heading_accepts_full_and_abbreviated_month(text):
    dt = is_date_heading(text)
    assert dt is not None
    assert (dt.year, dt.month, dt.day) == (2026, 7, 30)


def test_is_date_heading_rejects_non_date_text():
    assert is_date_heading("📌 not a date") is None
    assert is_date_heading("just some text") is None


# ---------------------------------------------------------------------------
# render fixture -> parse (the real contract)
# ---------------------------------------------------------------------------
def test_render_fixture_parses_into_weeks_and_decks():
    blocks = _load_blocks()
    html = api.record_map_to_html(blocks, PAGE_ID)

    # Sanity: the rendered HTML carries the parser's structural hooks.
    assert html.startswith("<!doctype html>")
    assert "data-block-id" in html
    assert "data-content-editable-leaf" in html

    result = parse_html(html)
    summary = result["summary"]

    assert summary["page_title"] == "Everpure"
    assert summary["weekly_record_count"] >= 50
    assert summary["deck_count"] >= 20
    assert summary["date_range"]["max"] is not None

    # A sampled week (the most recent) should carry parsed content.
    latest = max(result["weeks"], key=lambda w: w["week_date"])
    assert any(latest["content_groups"][group] for group in latest["content_groups"])


def test_render_emits_pseudo_before_for_lists():
    blocks = _load_blocks()
    html = api.record_map_to_html(blocks, PAGE_ID)
    assert "pseudoBefore" in html
    assert '--pseudoBefore--content: "•"' in html  # at least one level-1 bullet


# ---------------------------------------------------------------------------
# pagination + retry (fake session, no network)
# ---------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, status_code: int, payload: Optional[Dict[str, Any]] = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.headers: Dict[str, str] = {}
        self.text = json.dumps(self._payload)

    def json(self) -> Dict[str, Any]:
        return self._payload


class _FakeSession:
    """Serves a scripted sequence of loadPageChunk responses.

    The script: chunk 0 -> 429 (retried), then chunk 0 succeeds (cursor has a
    non-empty stack), chunk 1 succeeds (empty stack -> stop). Each successful
    chunk contributes its own blocks so the caller's merge can be verified.
    """

    def __init__(self):
        self.calls: List[Dict[str, Any]] = []
        chunk0 = {
            "recordMap": {"block": {"a": {"value": {"value": {"id": "a", "type": "text"}}}}},
            "cursor": {"stack": [["block", PAGE_ID, 1]]},
        }
        chunk1 = {
            "recordMap": {"block": {"b": {"value": {"value": {"id": "b", "type": "text"}}}}},
            "cursor": {"stack": []},
        }
        self._script = [
            _FakeResponse(429),  # retried
            _FakeResponse(200, chunk0),
            _FakeResponse(200, chunk1),
        ]

    def post(self, endpoint, json=None, headers=None, timeout=None):  # noqa: A002
        self.calls.append({"endpoint": endpoint, "body": json})
        return self._script.pop(0)

    def close(self):
        pass


def test_fetch_record_map_paginates_and_retries(monkeypatch):
    sleeps: List[float] = []
    monkeypatch.setattr(api.time, "sleep", lambda s: sleeps.append(s))

    session = _FakeSession()
    blocks = api.fetch_record_map(SOURCE_URL, session=session, backoff=0.01)

    # Merged across both successful chunks.
    assert set(blocks.keys()) == {"a", "b"}

    # One retry (the 429) + two successful chunk posts = 3 posts total.
    assert len(session.calls) == 3
    assert len(sleeps) == 1  # only the 429 slept

    # Endpoint and chunk pagination wired correctly.
    assert session.calls[0]["endpoint"].endswith("/api/v3/loadPageChunk")
    assert session.calls[0]["body"]["pageId"] == PAGE_ID
    assert session.calls[1]["body"]["chunkNumber"] == 0
    assert session.calls[2]["body"]["chunkNumber"] == 1
    assert session.calls[2]["body"]["cursor"]["stack"] == [["block", PAGE_ID, 1]]


def test_fetch_record_map_raises_on_empty(monkeypatch):
    class _EmptySession:
        def post(self, endpoint, json=None, headers=None, timeout=None):  # noqa: A002
            return _FakeResponse(200, {"recordMap": {"block": {}}, "cursor": {"stack": []}})

        def close(self):
            pass

    with pytest.raises(api.NotionApiError):
        api.fetch_record_map(SOURCE_URL, session=_EmptySession())
