"""Unit tests for the Helio compare-page ingest (Tier A).

These cover the PURE parsing/compose helpers plus the fetch orchestration with a
fake session, so no live Helio request is made. The fixture reproduces the real
Next.js RSC payload shape (escaped JSON: a metric row is
`"label":"<Metric>","values":{...}` and each value is
`"<takeId>":{"score":<n>,"label":"<qual>"}`, plus a take-id → report-url map).
"""

import json

import everpure_helio_ingest as helio

BASELINE_TAKE = "01KSV38T74FNAZ53B0J1WSD7CS"
V1_TAKE = "01KT2PM6W0EE0XQNZ4ZV6B4BT7"
BASELINE_REPORT = "01KSV38T74ZYR3V9E19E6JYJMC"
V1_REPORT = "01KT2PM6W0GG124FKQ5MVQVRQX"
BASELINE_ASSET = "01KSV3HRB98T9BXPC6JQYE64XW"
V1_ASSET = "01KT2PQDDQYVZJYYGW3R3MGACA"
COMPARE_URL = "https://glare-playground.helio.app/share/compare/cmpznw53v000004l14u8ct0e8"


def _escaped_payload() -> str:
    """Build a realistic escaped-RSC compare payload (\" like the live page)."""
    clean = json.dumps(
        {
            "name": "191 EDC Success Blueprint Baseline vs 191 EDC Page V1",
            "rows": [
                {
                    "rowId": "ux_engagement_0",
                    "metricType": "ux_metric",
                    "label": "Engagement",
                    "values": {
                        BASELINE_TAKE: {"score": 52, "label": "Avg", "responseCount": 100},
                        V1_TAKE: {"score": 68, "label": "Avg", "responseCount": 100},
                    },
                },
                {
                    "rowId": "ux_sentiment_0",
                    "metricType": "ux_metric",
                    "label": "Sentiment",
                    "values": {
                        BASELINE_TAKE: {
                            "score": 26,
                            "label": "very negative",
                            "responseCount": 100,
                        },
                        V1_TAKE: {"score": 44, "label": "negative", "responseCount": 100},
                    },
                },
            ],
            "links": {
                BASELINE_TAKE: f"https://my.helio.app/report/{BASELINE_REPORT}?section_id=x",
                V1_TAKE: f"https://my.helio.app/report/{V1_REPORT}?section_id=y",
            },
            "testThumbnails": {
                BASELINE_TAKE: f"https://assets.helio.app/asset/{BASELINE_ASSET}/medium_base.png?Expires=1&Signature=ab",
                V1_TAKE: f"https://assets.helio.app/asset/{V1_ASSET}/medium_v1.jpg?Expires=1&Signature=cd",
            },
            "testImages": {
                BASELINE_TAKE: f"https://assets.helio.app/asset/{BASELINE_ASSET}/base.png?Expires=1&Signature=ef",
                V1_TAKE: f"https://assets.helio.app/asset/{V1_ASSET}/v1.jpg?Expires=1&Signature=gh",
            },
        },
        separators=(",", ":"),  # live RSC payload is compact (no spaces)
    )
    escaped = clean.replace('"', '\\"')
    return f'<script>self.__next_f.push([1,"{escaped}"])</script>'


def test_unescape_payload_round_trips_quotes_and_amp():
    out = helio._unescape_payload('a\\"b\\u0026c')
    assert out == 'a"b&c'
    # Asset URLs in the payload escape their slashes as \\u002F — decode them so
    # the thumbnail regex sees a real https:// URL.
    assert (
        helio._unescape_payload("https:\\u002F\\u002Fassets.helio.app")
        == "https://assets.helio.app"
    )


def test_parse_compare_html_thumbnail_is_none_without_asset_maps():
    payload = (
        '<script>self.__next_f.push([1,"'
        + (
            '{\\"name\\":\\"A vs B\\",'
            '\\"links\\":{\\"'
            + BASELINE_TAKE
            + '\\":\\"https://my.helio.app/report/'
            + BASELINE_REPORT
            + '\\"},'
            '\\"rows\\":[{\\"label\\":\\"Engagement\\",\\"values\\":{\\"'
            + BASELINE_TAKE
            + '\\":{\\"score\\":50,\\"label\\":\\"Avg\\"}}}]}'
        )
        + '"])</script>'
    )
    parsed = helio.parse_compare_html(payload)
    assert parsed["variants"][0]["thumbnail"] is None


def test_parse_compare_html_extracts_title_variants_metrics():
    parsed = helio.parse_compare_html(_escaped_payload())

    assert parsed["comparison_title"] == "191 EDC Success Blueprint Baseline vs 191 EDC Page V1"

    # Variants map take -> report id, baseline first, named from the title, with
    # the medium screenshot thumbnail attached (preferred over the full image).
    assert parsed["variants"][0] == {
        "take_id": BASELINE_TAKE,
        "report_id": BASELINE_REPORT,
        "name": "191 EDC Success Blueprint Baseline",
        "thumbnail": (
            f"https://assets.helio.app/asset/{BASELINE_ASSET}/medium_base.png?Expires=1&Signature=ab"
        ),
    }
    assert parsed["variants"][1]["report_id"] == V1_REPORT
    assert parsed["variants"][1]["name"] == "191 EDC Page V1"
    assert "medium_v1.jpg" in parsed["variants"][1]["thumbnail"]
    assert parsed["report_ids"] == [BASELINE_REPORT, V1_REPORT]

    metrics = {m["label"]: m for m in parsed["metrics"]}
    assert set(metrics) == {"Engagement", "Sentiment"}
    sentiment = metrics["Sentiment"]["values"]
    assert sentiment[0] == {
        "take_id": BASELINE_TAKE,
        "name": "191 EDC Success Blueprint Baseline",
        "score": 26,
        "qual_label": "very negative",
    }
    assert sentiment[1]["score"] == 44 and sentiment[1]["qual_label"] == "negative"


def test_compose_signals_orders_sentiment_before_engagement():
    parsed = helio.parse_compare_html(_escaped_payload())
    signals = helio.compose_compare_signals(parsed)

    assert signals[0].startswith("Helio comparison — 191 EDC")
    # METRIC_ORDER puts sentiment ahead of engagement.
    sentiment_idx = next(i for i, s in enumerate(signals) if s.startswith("Sentiment:"))
    engagement_idx = next(i for i, s in enumerate(signals) if s.startswith("Engagement:"))
    assert sentiment_idx < engagement_idx
    assert "26% (very negative)" in signals[sentiment_idx]
    assert "44% (negative)" in signals[sentiment_idx]
    assert "191 EDC Page V1 44%" in signals[sentiment_idx]


def test_helio_compare_links_filters_and_annotates():
    links = [
        {"source_type": "google_sheet", "target_url": "https://docs.google.com/spreadsheets/d/x"},
        {
            "source_type": "helio_report",
            "target_url": f"https://my.helio.app/report/{BASELINE_REPORT}",
        },
        {"source_type": "helio_compare", "target_url": COMPARE_URL},
        {"source_type": "helio_compare", "target_url": "https://no-id.example.com/share"},
        {"error": "boom", "source_type": "helio_compare"},
    ]
    out = helio.helio_compare_links(links)
    assert len(out) == 1
    assert out[0]["helio_compare_id"] == "cmpznw53v000004l14u8ct0e8"


def test_compare_evidence_record_is_clean_and_typed():
    parsed = helio.parse_compare_html(_escaped_payload())
    link = {
        "source_type": "helio_compare",
        "target_url": COMPARE_URL,
        "helio_compare_id": "cmpznw53v000004l14u8ct0e8",
        "deck_file_id": "deck123",
        "deck_title": "ZURB Executive Brief",
        "slide_number": 4,
        "inferred_concepts": ["Events Page"],
        "associated_weeks": ["2026-06-01"],
    }
    rec = helio.compare_evidence_record(link, parsed)
    assert rec["source_type"] == "helio_compare"
    assert rec["report_ids"] == [BASELINE_REPORT, V1_REPORT]
    assert rec["deck_file_id"] == "deck123"
    assert rec["inferred_concepts"] == ["Events Page"]
    # evidence_text carries the deltas and no raw ULIDs / URLs.
    assert "Sentiment" in rec["evidence_text"]
    assert "helio.app" not in rec["evidence_text"]
    assert BASELINE_REPORT not in rec["evidence_text"]


class _FakeResp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class _FakeSession:
    def __init__(self, text):
        self._text = text
        self.headers = {}
        self.calls = []

    def get(self, url, timeout=None):
        self.calls.append(url)
        return _FakeResp(self._text)


def test_fetch_compare_pages_success():
    links = [{"source_type": "helio_compare", "target_url": COMPARE_URL, "deck_file_id": "d1"}]
    session = _FakeSession(_escaped_payload())
    statuses, evidence = helio.fetch_compare_pages(links, max_fetches=12, session=session)

    assert session.calls == [COMPARE_URL]
    assert len(evidence) == 1
    assert statuses[0]["status"] == "success"
    assert statuses[0]["metric_count"] == 2
    assert statuses[0]["report_ids"] == [BASELINE_REPORT, V1_REPORT]


def test_fetch_compare_pages_respects_limit():
    links = [
        {"source_type": "helio_compare", "target_url": COMPARE_URL + "?a", "deck_file_id": "d1"},
    ]
    # Two distinct compare ids so one is skipped at limit=0... use limit boundary.
    statuses, evidence = helio.fetch_compare_pages(
        links, max_fetches=0, session=_FakeSession(_escaped_payload())
    )
    assert evidence == []
    assert statuses[0]["status"] == "skipped_limit"


def test_merge_into_external_evidence_appends(tmp_path):
    seed = {"evidence": [{"source_type": "google_sheet_data_comparison"}], "evidence_count": 1}
    (tmp_path / "external_research_evidence.json").write_text(json.dumps(seed), encoding="utf-8")

    helio_records = [{"source_type": "helio_compare", "evidence_text": "Sentiment 26% to 44%."}]
    added = helio.merge_into_external_evidence(tmp_path, helio_records)

    assert added == 1
    merged = json.loads((tmp_path / "external_research_evidence.json").read_text(encoding="utf-8"))
    assert merged["evidence_count"] == 2
    assert merged["evidence"][-1]["source_type"] == "helio_compare"
    # Hyphenated alias is also written.
    assert (tmp_path / "external-research-evidence.json").exists()


def test_discovered_report_ids_dedupes_in_order():
    evidence = [
        {"report_ids": [BASELINE_REPORT, V1_REPORT]},
        {"report_ids": [V1_REPORT, "01KZZZZZZZZZZZZZZZZZZZZZZZZ"]},
    ]
    assert helio.discovered_report_ids(evidence) == [
        BASELINE_REPORT,
        V1_REPORT,
        "01KZZZZZZZZZZZZZZZZZZZZZZZZ",
    ]


# ---- Tier B-lite: config / integrity via the public API --------------------


class _FakeApiResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeApiSession:
    """Maps report-id -> (status_code, payload). Records requested URLs."""

    def __init__(self, by_id):
        self._by_id = by_id
        self.headers = {}
        self.calls = []

    def get(self, url, timeout=None):
        self.calls.append(url)
        rid = url.rstrip("/").rsplit("/", 1)[-1]
        status, payload = self._by_id.get(rid, (404, {}))
        return _FakeApiResp(status, payload)


def _test_config_payload(n=100, sections=8, spammed=7):
    return {
        "test": {
            "enroll_responses_count": n,
            "open_responses_count": 0,
            "spammed_responses_count": spammed,
            "flagged_participants_count": 28,
            "sections": [{"id": i} for i in range(sections)],
        }
    }


def test_fetch_test_config_parses_provenance():
    session = _FakeApiSession({BASELINE_REPORT: (200, _test_config_payload(n=100, sections=8))})
    cfg = helio.fetch_test_config(session, BASELINE_REPORT)
    assert cfg["found"] is True
    assert cfg["responses_count"] == 100
    assert cfg["section_count"] == 8
    assert cfg["spammed_responses_count"] == 7


def test_fetch_test_config_non_200_is_not_found():
    session = _FakeApiSession({BASELINE_REPORT: (504, {})})
    cfg = helio.fetch_test_config(session, BASELINE_REPORT)
    assert cfg["found"] is False
    assert cfg["status_code"] == 504


def test_enrich_with_report_config_attaches_provenance_and_n():
    parsed = helio.parse_compare_html(_escaped_payload())
    rec = helio.compare_evidence_record(
        {"source_type": "helio_compare", "target_url": COMPARE_URL}, parsed
    )
    evidence = [rec]
    session = _FakeApiSession(
        {
            BASELINE_REPORT: (200, _test_config_payload(n=100, sections=8)),
            V1_REPORT: (200, _test_config_payload(n=98, sections=8)),
        }
    )
    configs, statuses = helio.enrich_with_report_config(
        evidence, "app", "tok", max_fetches=12, session=session
    )

    assert {s["status"] for s in statuses} == {"success"}
    assert len(rec["report_configs"]) == 2
    # Sample size folds into the headline signal (max across variants) → backs confidence.
    assert "(n=100)" in rec["signals"][0]
    assert "(n=100)" in rec["evidence_text"]


def test_enrich_records_errors_for_unresolved_reports():
    parsed = helio.parse_compare_html(_escaped_payload())
    rec = helio.compare_evidence_record(
        {"source_type": "helio_compare", "target_url": COMPARE_URL}, parsed
    )
    session = _FakeApiSession({BASELINE_REPORT: (504, {}), V1_REPORT: (504, {})})
    _configs, statuses = helio.enrich_with_report_config(
        [rec], "app", "tok", max_fetches=12, session=session
    )
    assert [s["status"] for s in statuses] == ["error", "error"]
    assert "report_configs" not in rec  # nothing attached when none resolve
