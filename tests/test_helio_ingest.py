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


def test_parse_compare_html_names_variants_and_title_from_screens_when_untitled():
    # No "<A> vs B" title — variant names and the derived title come from the actual
    # screenshot filenames (ground truth) rather than generic "Variant N".
    clean = json.dumps(
        {
            "rows": [
                {
                    "label": "Comprehension",
                    "values": {
                        BASELINE_TAKE: {"score": 60, "label": "Good"},
                        V1_TAKE: {"score": 64, "label": "Good"},
                    },
                }
            ],
            "links": {
                BASELINE_TAKE: f"https://my.helio.app/report/{BASELINE_REPORT}",
                V1_TAKE: f"https://my.helio.app/report/{V1_REPORT}",
            },
            "testThumbnails": {
                BASELINE_TAKE: f"https://assets.helio.app/asset/{BASELINE_ASSET}/medium_2_-_VMware_Platform_Guides.png?Expires=1&Signature=a",
                V1_TAKE: f"https://assets.helio.app/asset/{V1_ASSET}/medium_3b_-_Book_filter_default.jpg?Expires=1&Signature=b",
            },
        },
        separators=(",", ":"),
    )
    parsed = helio.parse_compare_html(
        f'<script>self.__next_f.push([1,"{clean.replace(chr(34), chr(92) + chr(34))}"])</script>'
    )
    assert parsed["comparison_title"] == ""
    assert [v["name"] for v in parsed["variants"]] == [
        "VMware Platform Guides",
        "Book Filter Default",
    ]
    assert parsed["derived_title"] == "VMware Platform Guides vs Book Filter Default"


def test_screen_from_asset_cleans_slug_and_fixes_known_typo():
    base = "https://assets.helio.app/asset/01KSWS2SSMGRXJ65ZKF2PGKBDC/"
    # Number/index prefixes stripped; casing of CamelCase tokens preserved.
    assert (
        helio._screen_from_asset(base + "2_-_VMware_Platform_Guides.png")
        == "VMware Platform Guides"
    )
    # Known Helio filename typo corrected for display.
    assert (
        helio._screen_from_asset(base + "medium_Accelerate_Overview_Pate.jpg?Expires=1")
        == "Accelerate Overview Page"
    )


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


# ---- Tier B (deep): UX metrics + verbatim quotes via /tests/:id/report --------


def test_to_number_coerces_common_forms():
    assert helio._to_number("78%") == 78.0
    assert helio._to_number("78.5 %") == 78.5
    assert helio._to_number(68) == 68.0
    assert helio._to_number("n/a") is None
    assert helio._to_number(True) is None  # bools are not scores


def test_norm_metric_label_matches_variants():
    assert helio._norm_metric_label("Overall UX Score") == "overall ux"
    assert helio._norm_metric_label("Comprehension") == "comprehension"
    assert helio._norm_metric_label("Sentiment %") == "sentiment"


def test_coerce_report_metrics_tolerates_shapes():
    # list of metric objects (label/name/metric + score/value/average)
    assert helio._coerce_report_metrics(
        [
            {"label": "Comprehension", "score": 78},
            {"name": "Sentiment", "value": "52%"},
            {"metric": "Overall UX", "average": 64.0},
            {"label": "no-score"},  # dropped
        ]
    ) == [
        {"label": "Comprehension", "score": 78},
        {"label": "Sentiment", "score": 52},
        {"label": "Overall UX", "score": 64},
    ]
    # metric -> number map
    assert helio._coerce_report_metrics({"comprehension": 78, "sentiment": 52}) == [
        {"label": "comprehension", "score": 78},
        {"label": "sentiment", "score": 52},
    ]
    # metric -> object map: KEY is the metric name, inner "label" is qualitative
    assert helio._coerce_report_metrics({"Comprehension": {"score": 78, "label": "High"}}) == [
        {"label": "Comprehension", "score": 78}
    ]
    # numeric-index keys fall back to the inner name
    assert helio._coerce_report_metrics({"0": {"name": "Intent", "score": 40}}) == [
        {"label": "Intent", "score": 40}
    ]
    # one nesting layer is unwrapped
    assert helio._coerce_report_metrics({"ux_metrics": [{"label": "Intent", "score": 40}]}) == [
        {"label": "Intent", "score": 40}
    ]
    # garbage never raises
    assert helio._coerce_report_metrics("nope") == []
    assert helio._coerce_report_metrics(None) == []


def test_harvest_report_quotes_cleans_and_dedupes():
    node = [
        {"section_responses": [{"answer": "I couldn't tell what the page was for."}]},
        {"merged_explanations": ["The labels confused me at first.", "Looks good"]},
        {"answer": "https://example.com/x"},  # URL dropped
        {"answer": "I couldn't tell what the page was for."},  # dup dropped
        {"unrelated": "Some descriptive caption not under a text key"},  # not a quote field
    ]
    quotes = helio._harvest_report_quotes(node)
    assert "I couldn't tell what the page was for." in quotes
    assert "The labels confused me at first." in quotes
    assert "Looks good" not in quotes  # too short
    assert all(not q.startswith("http") for q in quotes)
    assert quotes.count("I couldn't tell what the page was for.") == 1
    assert "Some descriptive caption not under a text key" not in quotes


class _FakeReportResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload == "__bad__":
            raise ValueError("not json")
        return self._payload


class _FakeReportSession:
    """Maps test-id -> (status_code, payload) for GET /tests/:id/report.

    Accepts `params` (the real report call passes include/limit) and records
    the requested URLs + params so tests can assert on them.
    """

    def __init__(self, by_id):
        self._by_id = by_id
        self.headers = {}
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        tid = url.split("/tests/")[1].split("/")[0]
        status, payload = self._by_id.get(tid, (404, {}))
        return _FakeReportResp(status, payload)


def _report_payload(comp, sent, quotes, wrap=None):
    body = {
        "ux_metrics": [
            {"label": "Comprehension", "score": comp},
            {"label": "Sentiment", "score": sent},
            {"label": "Overall UX", "score": 61},
        ],
        "questions_responses": [{"section_responses": [{"answer": q}]} for q in quotes],
    }
    return {wrap: body} if wrap else body


def test_fetch_test_report_success_and_include_params():
    session = _FakeReportSession(
        {BASELINE_REPORT: (200, _report_payload(78, 40, ["I was unsure what to do here."]))}
    )
    rep = helio.fetch_test_report(session, BASELINE_REPORT)
    assert rep["found"] is True
    assert {m["label"] for m in rep["ux_metrics"]} == {"Comprehension", "Sentiment", "Overall UX"}
    assert rep["quotes"] == ["I was unsure what to do here."]
    # The documented include set + a response limit are requested.
    _url, params = session.calls[0]
    assert params["include"] == helio.REPORT_INCLUDE
    assert "limit" in params


def test_fetch_test_report_unwraps_report_or_data_envelope():
    for wrap in ("report", "data"):
        session = _FakeReportSession(
            {
                BASELINE_REPORT: (
                    200,
                    _report_payload(70, 50, ["It felt confusing to me."], wrap=wrap),
                )
            }
        )
        rep = helio.fetch_test_report(session, BASELINE_REPORT)
        assert rep["found"] is True
        assert rep["quotes"] == ["It felt confusing to me."]
        assert {m["label"] for m in rep["ux_metrics"]} >= {"Comprehension", "Sentiment"}


def test_fetch_test_report_unknown_shape_invents_nothing():
    # A 200 with no ux_metrics/questions_responses must NOT mine stray numbers/text.
    session = _FakeReportSession({BASELINE_REPORT: (200, {"weird": {"x": 1}, "other_count": 2})})
    rep = helio.fetch_test_report(session, BASELINE_REPORT)
    assert rep["found"] is True
    assert rep["ux_metrics"] == [] and rep["quotes"] == []
    assert "other_count" in rep["top_keys"]  # recorded for shape refinement


def test_fetch_test_report_degrades_on_404_and_bad_json():
    session = _FakeReportSession({BASELINE_REPORT: (504, {})})
    assert helio.fetch_test_report(session, BASELINE_REPORT)["found"] is False
    session2 = _FakeReportSession({BASELINE_REPORT: (200, "__bad__")})
    rep = helio.fetch_test_report(session2, BASELINE_REPORT)
    assert rep["found"] is False and rep["error"] == "non_json"


def test_enrich_with_report_data_gap_fills_metrics_and_harvests_quotes():
    parsed = helio.parse_compare_html(_escaped_payload())  # scraped Engagement + Sentiment
    rec = helio.compare_evidence_record(
        {"source_type": "helio_compare", "target_url": COMPARE_URL}, parsed
    )
    session = _FakeReportSession(
        {
            BASELINE_REPORT: (200, _report_payload(78, 99, ["I couldn't find the pricing."])),
            V1_REPORT: (200, _report_payload(81, 99, ["The header made me hesitate."])),
        }
    )
    reports, statuses = helio.enrich_with_report_data(
        [rec], "app", "tok", max_fetches=12, session=session
    )
    assert {s["status"] for s in statuses} == {"success"}
    assert all("top_keys" in s for s in statuses)

    labels = {m["label"]: {v["take_id"]: v["score"] for v in m["values"]} for m in rec["metrics"]}
    # Comprehension/Overall UX were absent from the scrape → gap-filled from the API.
    assert labels["Comprehension"] == {BASELINE_TAKE: 78, V1_TAKE: 81}
    assert "Overall UX" in labels
    # Sentiment was already scraped (26 / 44) → the API's 99 must NOT overwrite it.
    assert labels["Sentiment"][BASELINE_TAKE] == 26
    assert labels["Sentiment"][V1_TAKE] == 44
    # Per-variant raw API metrics attached as provenance.
    assert rec["variants"][0]["report_metrics"]["Comprehension"] == 78
    # Verbatims collected + folded (wrapped) into evidence_text for the JS harvesters.
    assert "I couldn't find the pricing." in rec["respondent_quotes"]
    assert "The header made me hesitate." in rec["respondent_quotes"]
    assert '"I couldn\'t find the pricing."' in rec["evidence_text"]


def test_enrich_with_report_data_is_nonblocking_and_respects_limit():
    parsed = helio.parse_compare_html(_escaped_payload())
    rec = helio.compare_evidence_record(
        {"source_type": "helio_compare", "target_url": COMPARE_URL}, parsed
    )
    # First id resolves; second is skipped by the fetch limit.
    session = _FakeReportSession(
        {BASELINE_REPORT: (200, _report_payload(70, 60, ["It wasn't clear to me."]))}
    )
    _reports, statuses = helio.enrich_with_report_data(
        [rec], "app", "tok", max_fetches=1, session=session
    )
    assert statuses[0]["status"] == "success"
    assert statuses[1]["status"] == "skipped_limit"

    # All ids 404 → no metrics gap-filled, no quotes, nothing raised.
    rec2 = helio.compare_evidence_record(
        {"source_type": "helio_compare", "target_url": COMPARE_URL}, parsed
    )
    before = {m["label"]: len(m["values"]) for m in rec2["metrics"]}
    session2 = _FakeReportSession({})  # everything 404s
    _r, st = helio.enrich_with_report_data([rec2], "app", "tok", max_fetches=12, session=session2)
    assert [s["status"] for s in st] == ["error", "error"]
    assert "respondent_quotes" not in rec2
    assert {m["label"]: len(m["values"]) for m in rec2["metrics"]} == before


# ---- Live-shape refinements (deploy 2026-06-18 revealed these) ----------------


def test_coerce_report_metrics_recurses_into_nested_breakdown():
    # Live shape: ux_metrics carries a top-level overall_score PLUS a per-metric
    # breakdown nested under an arbitrary sub-key (list of {label, score}).
    ux = {
        "overall_score": 56,
        "breakdown": [
            {"label": "Engagement", "score": 52},
            {"label": "Comprehension", "score": 78},
            {"name": "Sentiment", "value": 40},
        ],
    }
    got = {m["label"]: m["score"] for m in helio._coerce_report_metrics(ux)}
    assert got == {"overall_score": 56, "Engagement": 52, "Comprehension": 78, "Sentiment": 40}
    # Also a per-metric breakdown as a nested dict-of-objects under a sub-key.
    ux2 = {"overall_score": 60, "scores": {"Engagement": {"score": 50}, "Intent": {"score": 33}}}
    got2 = {m["label"]: m["score"] for m in helio._coerce_report_metrics(ux2)}
    assert got2 == {"overall_score": 60, "Engagement": 50, "Intent": 33}


def test_coerce_report_metrics_uses_metric_type_not_qualitative_label():
    # The live report ux_metrics shape (observed 2026-06-18 via report_deep[].shape):
    # overall_score + a `breakdown` list whose items carry BOTH the real name
    # (metric_type) and a qualitative `label` ("Avg"/"High"). The metric name must be
    # metric_type, never the qualitative label, and nested calc arrays are ignored.
    ux = {
        "overall_score": 56,
        "breakdown": [
            {"metric_type": "engagement", "score": 52, "label": "Avg", "section_id": 1},
            {"metric_type": "comprehension", "score": 72, "label": "High", "section_id": 2},
            {"metric_type": "sentiment", "score": 26, "label": "very negative", "section_id": 3},
        ],
        "ux_metrics_breakdown": [
            {
                "metric_type": "intent",
                "score": 58,
                "score_label": "Avg",
                "calculation_breakdown": [1, 2, 3],
            },
        ],
    }
    got = {m["label"]: m["score"] for m in helio._coerce_report_metrics(ux)}
    assert got == {
        "overall_score": 56,
        "engagement": 52,
        "comprehension": 72,
        "sentiment": 26,
        "intent": 58,
    }
    # No qualitative descriptors leaked in as metric names.
    assert not any(lab in got for lab in ("Avg", "High", "very negative"))


def test_coerce_report_metrics_does_not_invent_metrics_from_nested_counts():
    # A nested non-metric number (sample size / response count) must NOT become a
    # "metric" — only top-level bare numbers + labeled objects are metrics.
    ux = {
        "overall_score": 56,
        "sample": {"size": 100},  # nested count — must be ignored
        "breakdown": [{"label": "Engagement", "score": 52}],
    }
    got = {m["label"]: m["score"] for m in helio._coerce_report_metrics(ux)}
    assert got == {"overall_score": 56, "Engagement": 52}


def test_harvest_report_quotes_drops_question_prompts():
    prompt = (
        "After reviewing this page for 10 seconds, in your own words, "
        "please explain what you believe this page is about?"
    )
    qr = [
        {"question": prompt, "section_responses": [{"answer": "It is a cloud data platform."}]},
        {
            "question": prompt,
            "section_responses": [{"answer": "Helps you assess enterprise data."}],
        },
        {
            "question": prompt,
            "section_responses": [{"answer": "I'm honestly not sure what it does."}],
        },
        # A prompt leaking under an answer-ish "text" key, repeated across responses.
        {"text": prompt, "answer": "A genuinely unique participant answer here."},
        {"text": prompt, "answer": "Another distinct participant response here."},
        {"text": prompt, "answer": "Yet a third unique participant response."},
    ]
    quotes = helio._harvest_report_quotes(qr)
    # The prompt is dropped three ways (question key skip + repetition + phrase deny);
    # real answers survive.
    assert prompt not in quotes
    assert not any("please explain" in q for q in quotes)
    assert "It is a cloud data platform." in quotes
    assert "A genuinely unique participant answer here." in quotes


def test_harvest_report_quotes_phrase_denylist_catches_singleton_prompt():
    # A prompt that appears only once still gets rejected by the question-stem pattern.
    node = [{"answer": "On a scale of 1 to 5, how easy was this task to complete?"}]
    assert helio._harvest_report_quotes(node) == []


def test_shape_skeleton_is_pii_safe():
    sk = helio._shape_skeleton(
        {
            "ux_metrics": {
                "overall_score": 56,
                "breakdown": [{"label": "Engagement", "score": 52}],
            },
            "questions_responses": [
                {"answer": "reach me at jane.doe@example.com — this is a long verbatim answer"}
            ],
        }
    )
    # Numbers become type names; strings become short, email-redacted samples.
    assert sk["ux_metrics"]["overall_score"] == "int"
    assert sk["ux_metrics"]["breakdown"]["__list_len__"] == 1
    sample = sk["questions_responses"]["0"]["answer"]
    assert "@" not in sample  # email redacted
    assert len(sample) <= 50  # truncated
