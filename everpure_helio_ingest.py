#!/usr/bin/env python3
"""Fetch Helio research evidence linked from the decks.

The Slides decks link to ZURB **Helio** sources that the Google-Sheet ingest only
*inventories* (see everpure_external_research_ingest.py). This module fetches them:

  * **Tier A — compare share pages** (`glare-playground.helio.app/share/compare/<id>`):
    public, no auth. The page server-streams a Next.js RSC payload (`self.__next_f`)
    carrying the per-metric comparison (Engagement / Expectations / Comprehension /
    Intent / Sentiment, each with a score + qualitative label per variant) and the
    `my.helio.app/report/<report_id>` deep links for each variant. We parse that into
    concrete evidence signals and discover the report ids for Tier B.

  * **Tier B — report detail** (`my.helio.app/report/<id>`): behind the Helio public
    REST API (Enterprise; `X-API-ID`/`X-API-TOKEN`). Two parts:
      - *config/integrity* via `GET /tests/:id` (sample size, section/spam/flag counts);
      - *deep report data* via `GET /tests/:id/report?include=ux_metrics,questions_summary,
        questions_responses` — the AI-friendly report endpoint Helio published (docs 2026-06).
        We parse per-variant UX-metric scores (gap-filling the scraped Tier-A metrics) and
        harvest verbatim participant quotes into the evidence substrate.

Output: appends `helio_*` evidence records into `external_research_evidence.json`
(so the existing merge_external_evidence_packs.js consumes them unchanged), augments
`deck_content.json`, and writes `helio_evidence.json` + `helio_fetch_status.json`.

This is non-blocking by default: per-link fetch failures are recorded as status
rows, not raised, so a Helio hiccup never aborts the deploy.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from everpure_deck_ingest import load_json
from everpure_external_research_ingest import (
    augment_deck_content,
    normalize_space,
    redact_text,
    utc_now,
    write_aliases,
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Public REST API base (Enterprise; X-API-ID / X-API-TOKEN). Historically (probed
# 2026-06) only test CONFIG was reachable: GET /tests/:id worked, but the
# per-response route GET /tests/:id/responses 504'd and /results /insights /sections
# returned 406. Helio has since published API docs (2026-06) exposing a purpose-built
# AI-friendly report endpoint — GET /tests/:id/report?include=... — which serves the
# deep data the old routes couldn't. We now fetch it (Tier B), still NON-BLOCKING:
# any 404/406/504/timeout/empty per id degrades to the config-only provenance, never
# aborting the deploy. The exact include-section JSON shape is parsed defensively and
# the observed top-level keys are recorded in helio_fetch_status.json for refinement.
HELIO_API_BASE = "https://my.helio.app/api/public"

# Deep report data we request from GET /tests/:id/report. The endpoint returns only
# the sections named here; this set covers UX-metric scores + verbatim participant
# answers (questions_responses) without pulling the heavier journey/demographic cuts.
REPORT_INCLUDE = "ux_metrics,questions_summary,questions_responses"
# Cap responses pulled per test (endpoint max is 500); quotes are deduped after.
REPORT_RESPONSE_LIMIT = 200

# Free-text answer fields, at any nesting depth, that may carry a participant verbatim.
QUOTE_TEXT_KEYS = {
    "answer",
    "answer_text",
    "text",
    "value",
    "response",
    "response_text",
    "explanation",
    "explanations",
    "merged_explanations",
    "comment",
    "comments",
    "body",
    "content",
    "open_ended",
    "free_text",
    "verbatim",
}
# Keys whose numeric value is a UX-metric score (checked in order of preference).
METRIC_SCORE_KEYS = ("score", "value", "percent", "percentage", "average", "avg", "result", "mean")
# Keys that NAME a UX metric, in priority order. `metric_type`/`metric`/`name` carry
# the real metric name (engagement/comprehension/…); `label` is checked LAST because in
# the live report breakdown it holds a qualitative descriptor ("Avg", "High", "negative"),
# not the metric name — preferring it produced junk metrics labeled "Low"/"Excellent".
METRIC_LABEL_KEYS = ("metric_type", "metric", "name", "type", "key", "title", "label")

# Keys that hold a QUESTION prompt / option label rather than a participant answer —
# never harvest a verbatim from these (the prompt repeats once per response and would
# otherwise read as a "quote"). Distinct from QUOTE_TEXT_KEYS (the answer fields).
QUESTION_KEYS = {
    "question",
    "question_text",
    "prompt",
    "label",
    "title",
    "headline",
    "instruction",
    "instructions",
    "section_title",
    "name",
    "option",
    "options",
    "choices",
}
# Survey-question stems — strong signal a candidate is a prompt, not a participant
# answer (catches a prompt that slips through under an answer-ish key like "text").
QUESTION_PROMPT_RE = re.compile(
    r"\b("
    r"in your own words"
    r"|please (?:explain|describe|tell us|select|choose|rate|list|specify|elaborate)"
    r"|after (?:reviewing|looking at|viewing|reading)"
    r"|on a scale"
    r"|which of the following"
    r"|select all that apply"
    r"|how (?:likely|satisfied|easy|difficult|would you|much|many|often|confident)"
    r"|what (?:is|are|was|were|do|did|would) (?:your|you)"
    r"|rate (?:the|your|how)"
    r"|to what extent"
    r"|based on (?:what|the|your)"
    r"|for this (?:task|question|page|screen|prototype)"
    r")\b",
    re.I,
)
# A candidate appearing at least this many times across responses is a repeated
# prompt/label, not a unique participant answer.
QUOTE_REPEAT_DROP = 3

# Helio test/report/take ids are 26-char Crockford-style ULIDs (0-9 A-Z).
COMPARE_ID_RE = re.compile(r"/share/compare/([A-Za-z0-9]+)")

# In the (escaped) RSC payload a metric row is `"label":"<Metric>","values":{...}`
# and each per-variant value is `"<takeId>":{"score":<n>,"label":"<qualitative>"`.
# The live payload is compact (no spaces); we tolerate optional whitespace anyway.
ROW_RE = re.compile(r'"label":\s*"([^"]+)"\s*,\s*"values":\s*\{')
ENTRY_RE = re.compile(
    r'"([0-9A-Z]{26})":\s*\{\s*"score":\s*(-?\d+(?:\.\d+)?)\s*,\s*"label":\s*"([^"]*)"'
)
REPORT_MAP_RE = re.compile(r'"([0-9A-Z]{26})":\s*"https://my\.helio\.app/report/([0-9A-Z]{26})')
# Comparison title is the "<A> vs <B>" name carried in the page metadata.
TITLE_RE = re.compile(r'"(?:name|title)":\s*"([^"]*\bvs\b[^"]*)"', re.I)
# Per-variant screenshots live in two take_id->asset-URL maps: `testThumbnails`
# (medium previews) and `testImages` (full size). The asset URLs are time-signed
# (?Expires=&Signature=), so a fresh build re-fetches fresh ones each cycle.
THUMB_MAP_RE = re.compile(r'"testThumbnails":\s*\{([^{}]*)\}')
IMAGE_MAP_RE = re.compile(r'"testImages":\s*\{([^{}]*)\}')
ASSET_PAIR_RE = re.compile(
    r'"([0-9A-Z]{26})"\s*:\s*"(https://assets\.helio\.app/asset/[^"]+?\.(?:png|jpe?g|webp)[^"]*)"'
)

# Metrics worth surfacing, in the order we want them to read.
METRIC_ORDER = [
    "overall ux",
    "test score",
    "sentiment",
    "engagement",
    "comprehension",
    "expectations",
    "intent",
]


def _unescape_payload(html: str) -> str:
    """Unescape just enough of the RSC payload to run JSON-ish regexes over it."""
    return (
        html.replace('\\"', '"')
        .replace("\\u0026", "&")
        .replace("\\u003c", "<")
        .replace("\\u003e", ">")
        .replace("\\n", " ")
        .replace("\\/", "/")
        .replace("\\u002F", "/")
    )


def _asset_map(text: str, block_re: re.Pattern[str]) -> Dict[str, str]:
    """Parse a `{"<take_id>":"<assets.helio.app URL>"}` map into take_id -> URL."""
    out: Dict[str, str] = {}
    for block in block_re.findall(text):
        for take_id, url in ASSET_PAIR_RE.findall(block):
            out.setdefault(take_id, url)
    return out


# .../asset/<id>/<slug>.<ext> — the slug is the screen's filename, our ground-truth
# name for that variant (e.g. "2_-_VMware_Platform_Guides" -> "VMware Platform Guides").
ASSET_SLUG_RE = re.compile(r"/asset/[A-Z0-9]+/(?:medium_)?([^/?\"]+?)\.(?:png|jpe?g|webp)")

# Typos baked into Helio screen filenames (authored in Helio) → corrected for display.
SCREEN_NAME_FIXES = {
    "Accelerate Overview Pate": "Accelerate Overview Page",
}


def _screen_from_asset(url: str) -> str:
    """Derive a human screen name from a Helio asset URL's filename slug."""
    m = ASSET_SLUG_RE.search(url or "")
    if not m:
        return ""
    slug = re.sub(r"^\d+[a-z]?[\s_-]+", "", m.group(1))  # drop leading "2_-_", "191-"
    slug = re.sub(r"[_-]+", " ", slug).strip()
    # Capitalize all-lowercase words; leave existing casing (VMware, CTA) intact.
    name = " ".join(w[:1].upper() + w[1:] if w.islower() else w for w in slug.split())
    return SCREEN_NAME_FIXES.get(name, name)


def parse_compare_html(html: str) -> Dict[str, Any]:
    """Parse a Helio compare share page into a structured comparison.

    Returns: {comparison_title, variants[{take_id, report_id, name, thumbnail}],
    report_ids[], metrics[{label, values[{take_id, score, qual_label}]}]}. The
    thumbnail is the variant's (time-signed) Helio screenshot URL, or None. Pure;
    unit-tested.
    """
    text = _unescape_payload(html)

    title_match = TITLE_RE.search(text)
    comparison_title = normalize_space(title_match.group(1)) if title_match else ""
    names = [normalize_space(n) for n in re.split(r"\bvs\b", comparison_title, flags=re.I)]
    names = [n for n in names if n]

    # take_id -> report_id, preserving first-seen order (baseline first).
    report_map: List[Tuple[str, str]] = []
    seen_takes = set()
    for take_id, report_id in REPORT_MAP_RE.findall(text):
        if take_id in seen_takes:
            continue
        seen_takes.add(take_id)
        report_map.append((take_id, report_id))

    # take_id -> screenshot URL (prefer the medium thumbnail, fall back to full).
    thumbs = _asset_map(text, THUMB_MAP_RE)
    fulls = _asset_map(text, IMAGE_MAP_RE)

    take_name: Dict[str, str] = {}
    variants: List[Dict[str, Any]] = []
    screens: List[str] = []
    for idx, (take_id, report_id) in enumerate(report_map):
        thumb = thumbs.get(take_id) or fulls.get(take_id) or None
        screen = _screen_from_asset(thumb or "")
        # Name from the compare title ("<A> vs <B>"); else the screenshot's own name;
        # else a generic placeholder. The screen name is ground truth for the page.
        name = (names[idx] if idx < len(names) else "") or screen or f"Variant {idx + 1}"
        take_name[take_id] = name
        if screen and screen not in screens:
            screens.append(screen)
        variants.append(
            {
                "take_id": take_id,
                "report_id": report_id,
                "name": name,
                "thumbnail": thumb,
            }
        )
    # A title derived from the actual compared screens — used downstream when the
    # page carries no "<A> vs <B>" title, so the label reflects the real page rather
    # than a (sometimes wrong) slide-inferred concept.
    derived_title = " vs ".join(screens[:2])

    metrics: List[Dict[str, Any]] = []
    rows = list(ROW_RE.finditer(text))
    for i, match in enumerate(rows):
        label = normalize_space(match.group(1))
        seg_end = rows[i + 1].start() if i + 1 < len(rows) else min(len(text), match.end() + 800)
        segment = text[match.end() : seg_end]
        values = []
        for take_id, score, qual in ENTRY_RE.findall(segment):
            values.append(
                {
                    "take_id": take_id,
                    "name": take_name.get(take_id, ""),
                    "score": float(score) if "." in score else int(score),
                    "qual_label": normalize_space(qual),
                }
            )
        if values:
            metrics.append({"label": label, "values": values})

    return {
        "comparison_title": comparison_title,
        "derived_title": derived_title,
        "variants": variants,
        "report_ids": [report_id for _, report_id in report_map],
        "metrics": metrics,
    }


def _fmt_score(score: Any) -> str:
    if isinstance(score, float) and score.is_integer():
        score = int(score)
    return f"{score}%"


def compose_compare_signals(parsed: Dict[str, Any], limit: int = 8) -> List[str]:
    """Turn a parsed comparison into concrete, leadership-readable evidence lines."""
    signals: List[str] = []
    title = parsed.get("comparison_title")
    metrics = parsed.get("metrics") or []

    if title:
        signals.append(f"Helio comparison — {title}.")

    ordered = sorted(
        metrics,
        key=lambda m: (
            METRIC_ORDER.index(m["label"].lower())
            if m["label"].lower() in METRIC_ORDER
            else len(METRIC_ORDER)
        ),
    )
    for metric in ordered:
        vals = metric.get("values") or []
        if len(vals) < 2:
            if len(vals) == 1:
                v = vals[0]
                signals.append(
                    f"{metric['label']}: {v.get('name') or 'variant'} "
                    f"{_fmt_score(v['score'])} ({v['qual_label']})."
                )
            continue
        first, second = vals[0], vals[1]
        a_name = first.get("name") or "Baseline"
        b_name = second.get("name") or "Variant"
        signals.append(
            f"{metric['label']}: {a_name} {_fmt_score(first['score'])} ({first['qual_label']}) "
            f"vs {b_name} {_fmt_score(second['score'])} ({second['qual_label']})."
        )
        if len(signals) >= limit:
            break
    return signals[:limit]


def compare_evidence_record(link: Dict[str, Any], parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Build an external-evidence record (consumed by merge_external_evidence_packs.js)."""
    signals = compose_compare_signals(parsed)
    record = {
        "source_type": "helio_compare",
        "source_url": link.get("target_url"),
        "compare_id": link.get("helio_compare_id"),
        "report_ids": parsed.get("report_ids", []),
        "comparison_title": parsed.get("comparison_title"),
        "derived_title": parsed.get("derived_title"),
        "deck_file_id": link.get("deck_file_id"),
        "deck_title": link.get("deck_title"),
        "slide_number": link.get("slide_number"),
        "link_text": link.get("link_text"),
        "slide_text_excerpt": link.get("slide_text_excerpt"),
        "associated_weeks": link.get("associated_weeks", []),
        "associated_record_ids": link.get("associated_record_ids", []),
        "inferred_concepts": link.get("inferred_concepts", []),
        "variants": parsed.get("variants", []),
        "metrics": parsed.get("metrics", []),
        "signals": signals,
    }
    record["evidence_text"] = redact_text(" ".join(signals), limit=6000)
    return record


def helio_compare_links(links: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pull helio_compare links from deck_links, annotating the compare id."""
    out = []
    for link in links:
        if link.get("error"):
            continue
        if link.get("source_type") != "helio_compare":
            continue
        url = link.get("target_url") or ""
        m = COMPARE_ID_RE.search(url)
        if not m:
            continue
        annotated = dict(link)
        annotated["helio_compare_id"] = m.group(1)
        out.append(annotated)
    return out


def fetch_compare_pages(
    links: List[Dict[str, Any]],
    max_fetches: int,
    session: Optional[requests.Session] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch + parse each unique compare page. Returns (statuses, evidence)."""
    session = session or requests.Session()
    session.headers.setdefault("User-Agent", USER_AGENT)

    by_id: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for link in helio_compare_links(links):
        by_id[link["helio_compare_id"]].append(link)

    statuses: List[Dict[str, Any]] = []
    evidence: List[Dict[str, Any]] = []
    for idx, (compare_id, refs) in enumerate(by_id.items()):
        primary = refs[0]
        status: Dict[str, Any] = {
            "source_type": "helio_compare",
            "compare_id": compare_id,
            "source_url": primary.get("target_url"),
            "deck_file_id": primary.get("deck_file_id"),
            "slide_number": primary.get("slide_number"),
            "linked_from_count": len(refs),
        }
        if idx >= max_fetches:
            status["status"] = "skipped_limit"
            statuses.append(status)
            continue
        try:
            resp = session.get(primary["target_url"], timeout=60)
            resp.raise_for_status()
            parsed = parse_compare_html(resp.text)
            record = compare_evidence_record(primary, parsed)
            evidence.append(record)
            status.update(
                {
                    "status": "success",
                    "comparison_title": parsed.get("comparison_title"),
                    "metric_count": len(parsed.get("metrics", [])),
                    "report_ids": parsed.get("report_ids", []),
                    "signal_count": len(record.get("signals", [])),
                }
            )
            if not parsed.get("metrics"):
                status["status"] = "empty"
                status["warning"] = "no metrics parsed from compare payload"
        except Exception as exc:  # noqa: BLE001 - non-blocking ingest
            status.update({"status": "error", "error": f"{exc.__class__.__name__}:{exc}"})
        statuses.append(status)
    return statuses, evidence


def merge_into_external_evidence(data_dir: Path, helio_records: List[Dict[str, Any]]) -> int:
    """Append Helio evidence into external_research_evidence.json so the JS merge sees it."""
    if not helio_records:
        return 0
    candidates = [
        data_dir / "external_research_evidence.json",
        data_dir / "external-research-evidence.json",
    ]
    payload: Dict[str, Any] = {}
    for path in candidates:
        if path.exists():
            loaded = load_json(path)
            if isinstance(loaded, dict):
                payload = loaded
            break
    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        evidence = []
    evidence.extend(helio_records)
    payload["evidence"] = evidence
    payload["evidence_count"] = len(evidence)
    payload.setdefault("generated_at", utc_now())
    payload["note"] = normalize_space(
        (payload.get("note") or "")
        + " Includes Helio compare/report evidence fetched by everpure_helio_ingest.py."
    )
    write_aliases(data_dir, "external_research_evidence.json", payload)
    return len(helio_records)


def discovered_report_ids(evidence: List[Dict[str, Any]]) -> List[str]:
    seen: List[str] = []
    for rec in evidence:
        for rid in rec.get("report_ids", []):
            if rid not in seen:
                seen.append(rid)
    return seen


# ---------------------------------------------------------------------------
# Tier B-lite — test config / integrity via the public API (the only part that
# works). Attaches sample size + question count as provenance to the compare
# evidence; it does NOT (cannot) fetch per-response/score data.
# ---------------------------------------------------------------------------


def helio_api_session(app_id: str, token: str) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "X-API-ID": app_id,
            "X-API-TOKEN": token,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
    )
    return session


def fetch_test_config(
    session: requests.Session, report_id: str, timeout: int = 60
) -> Dict[str, Any]:
    """GET /tests/:id → provenance (sample size, question count, integrity counts).

    Config only; the public API can't serve per-response/score data. Pure-ish:
    a `session` double makes this unit-testable without a live call.
    """
    url = f"{HELIO_API_BASE}/tests/{report_id}"
    try:
        resp = session.get(url, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - non-blocking ingest
        return {"report_id": report_id, "found": False, "error": f"{exc.__class__.__name__}:{exc}"}
    if getattr(resp, "status_code", None) != 200:
        return {"report_id": report_id, "found": False, "status_code": resp.status_code}
    try:
        test = (resp.json() or {}).get("test") or {}
    except ValueError:
        return {"report_id": report_id, "found": False, "error": "non_json"}
    n = (
        test.get("enroll_responses_count")
        or test.get("open_responses_count")
        or test.get("customer_list_responses_count")
    )
    return {
        "report_id": report_id,
        "found": True,
        "responses_count": n,
        "section_count": len(test.get("sections") or []),
        "spammed_responses_count": test.get("spammed_responses_count"),
        "flagged_participants_count": test.get("flagged_participants_count"),
    }


def enrich_with_report_config(
    evidence: List[Dict[str, Any]],
    app_id: str,
    token: str,
    max_fetches: int,
    session: Optional[requests.Session] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch /tests/:id config for each discovered report id and attach it as
    provenance (n + question count) to the compare records, folding the sample
    size into the headline signal so it backs the confidence label."""
    report_ids = discovered_report_ids(evidence)
    if not report_ids:
        return {}, []
    session = session or helio_api_session(app_id, token)

    configs: Dict[str, Dict[str, Any]] = {}
    statuses: List[Dict[str, Any]] = []
    for idx, rid in enumerate(report_ids):
        if idx >= max_fetches:
            statuses.append({"report_id": rid, "status": "skipped_limit"})
            continue
        cfg = fetch_test_config(session, rid)
        configs[rid] = cfg
        statuses.append(
            {
                "report_id": rid,
                "status": "success" if cfg.get("found") else "error",
                "responses_count": cfg.get("responses_count"),
                "section_count": cfg.get("section_count"),
                "status_code": cfg.get("status_code"),
                "error": cfg.get("error"),
            }
        )

    for rec in evidence:
        found = [
            configs[r]
            for r in rec.get("report_ids", [])
            if r in configs and configs[r].get("found")
        ]
        if not found:
            continue
        rec["report_configs"] = found
        ns = [c.get("responses_count") for c in found if c.get("responses_count")]
        n = max(ns) if ns else None
        signals = rec.get("signals") or []
        if n and signals and "n=" not in signals[0]:
            signals[0] = (signals[0].rstrip(".") + f" (n={n}).") if signals[0] else signals[0]
            rec["signals"] = signals
            rec["evidence_text"] = redact_text(" ".join(signals), limit=6000)
    return configs, statuses


# ---------------------------------------------------------------------------
# Tier B (deep) — UX metrics + verbatim quotes via GET /tests/:id/report.
# The include-section shapes aren't documented field-by-field, so every parser
# here is shape-tolerant and total: unknown input yields empty, never raises.
# ---------------------------------------------------------------------------


def _to_number(val: Any) -> Optional[float]:
    """Coerce 78 / 78.5 / "78" / "78%" / "78.0 %" → float; None if not numeric."""
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        m = re.search(r"-?\d+(?:\.\d+)?", val)
        if m:
            try:
                return float(m.group(0))
            except ValueError:
                return None
    return None


def _num_or_int(val: float) -> Any:
    """Render a whole-number float as an int so scores read 68 not 68.0."""
    return int(val) if float(val).is_integer() else val


def _norm_metric_label(label: str) -> str:
    """Normalize a metric label for matching ('Overall UX Score' ↔ 'overall ux')."""
    s = normalize_space(label).lower()
    s = re.sub(r"[%]", "", s)
    s = re.sub(r"\b(score|metric|rating|average|avg)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _coerce_report_metrics(node: Any, _depth: int = 0) -> List[Dict[str, Any]]:
    """Pull [{label, score}] from a ux_metrics node, tolerant of list/dict shapes.

    Handles: a list of metric objects ({label/name, score/value/percent}); a
    metric→number map ({"comprehension": 78}); a metric→object map
    ({"comprehension": {"score": 78}}); and one level of {metrics|data|ux_metrics}
    wrapping. Deduped by normalized label, first value wins.
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()

    def _emit(label: Any, score: Any) -> None:
        lab = normalize_space(label)
        num = _to_number(score)
        if not lab or num is None:
            return
        key = _norm_metric_label(lab)
        if not key or key in seen:
            return
        seen.add(key)
        out.append({"label": lab, "score": _num_or_int(num)})

    if isinstance(node, list):
        for item in node:
            if isinstance(item, dict):
                label = next((item[k] for k in METRIC_LABEL_KEYS if item.get(k)), None)
                score = next(
                    (item[k] for k in METRIC_SCORE_KEYS if _to_number(item.get(k)) is not None),
                    None,
                )
                _emit(label, score)
    elif isinstance(node, dict):
        # Unwrap a single nesting layer (e.g. {"ux_metrics": {...}}).
        if _depth == 0:
            for wrap in ("ux_metrics", "metrics", "data", "results"):
                if isinstance(node.get(wrap), (list, dict)):
                    nested = _coerce_report_metrics(node[wrap], _depth + 1)
                    for m in nested:
                        _emit(m["label"], m["score"])
            if out:
                return out
        for label, val in node.items():
            if _to_number(val) is not None:
                # A bare number is a metric only at the TOP level, where the key is
                # the metric name (e.g. overall_score). Deeper bare numbers are
                # counts/ids (responseCount, sample size) — never emit them, or
                # recursion would manufacture junk "metrics".
                if _depth == 0:
                    _emit(label, val)
            elif isinstance(val, dict):
                direct = next(
                    (val[k] for k in METRIC_SCORE_KEYS if _to_number(val.get(k)) is not None),
                    None,
                )
                if direct is not None:
                    # A metric→object map: the KEY is the metric name; the inner
                    # `label` is usually a qualitative descriptor (High/Positive),
                    # so only fall back to an inner name when the key is an index/id.
                    key_str = str(label)
                    use_key = bool(re.search(r"[A-Za-z]", key_str)) and not re.fullmatch(
                        r"(?:metric|item|row)?[_-]?\d+", key_str.strip().lower()
                    )
                    name = key_str if use_key else (val.get("metric") or val.get("name") or key_str)
                    _emit(name, direct)
                elif _depth < 4:
                    # No score directly on this object — recurse one level deeper
                    # (the per-metric breakdown may be nested under an arbitrary key).
                    for m in _coerce_report_metrics(val, _depth + 1):
                        _emit(m["label"], m["score"])
            elif isinstance(val, list) and _depth < 4:
                # A per-metric breakdown array under an arbitrary sub-key (e.g.
                # ux_metrics = {"overall_score": 56, "<breakdown>": [{label, score}…]}).
                for m in _coerce_report_metrics(val, _depth + 1):
                    _emit(m["label"], m["score"])
    return out


def _clean_verbatim(raw: str) -> str:
    """Normalize one candidate verbatim; '' if it isn't usable participant text."""
    s = normalize_space(raw)
    # Strip a single layer of wrapping quotes so we don't double-wrap later.
    s = re.sub(r"""^[\s"“”']+""", "", s)
    s = re.sub(r"""[\s"“”']+$""", "", s)
    if len(s) < 15 or len(s) > 400:
        return ""
    if " " not in s:  # single token — a label/option, not a sentence
        return ""
    if not re.search(r"[A-Za-z]", s):
        return ""
    if re.match(r"^https?://", s):
        return ""
    return s


def _harvest_report_quotes(node: Any, limit: int = 60) -> List[str]:
    """Walk a report payload collecting deduped, prompt-free participant verbatims.

    Harvests strings under QUOTE_TEXT_KEYS (the answer fields) at any depth, but
    drops survey QUESTION prompts three ways: (1) it never descends into QUESTION_KEYS
    fields (question/label/prompt/title/…); (2) it rejects candidates matching a
    question-stem pattern that slips through under an answer-ish key; and (3) it drops
    any candidate that repeats across responses (a prompt repeats once per response;
    a real answer is ~unique). Quality filtering for first-person voice / CTA rejection
    is left to the JS harvester downstream. Pure; unit-tested.
    """
    # Pass 1 — collect every cleaned candidate WITH repetition, skipping prompt fields.
    raw_candidates: List[str] = []

    def _walk(n: Any, under_text_key: bool) -> None:
        if isinstance(n, str):
            if under_text_key:
                cleaned = _clean_verbatim(n)
                if cleaned:
                    raw_candidates.append(cleaned)
        elif isinstance(n, list):
            for v in n:
                _walk(v, under_text_key)
        elif isinstance(n, dict):
            for k, v in n.items():
                kl = str(k).lower()
                if kl in QUESTION_KEYS:
                    continue  # never harvest a question prompt / option label
                _walk(v, under_text_key or kl in QUOTE_TEXT_KEYS)

    _walk(node, False)

    # Pass 2 — drop repeated prompts + question-stem matches, then dedupe.
    counts = Counter(raw_candidates)
    out: List[str] = []
    seen: set = set()
    for cand in raw_candidates:
        if len(out) >= limit:
            break
        if counts[cand] >= QUOTE_REPEAT_DROP:
            continue  # a prompt/label repeated across responses, not an answer
        if QUESTION_PROMPT_RE.search(cand):
            continue
        key = re.sub(r"[^a-z0-9]+", " ", cand.lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        out.append(cand)
    return out[:limit]


def _shape_skeleton(node: Any, depth: int = 0, max_depth: int = 5) -> Any:
    """PII-safe structural skeleton of a JSON node: keys + nesting preserved, lists
    collapsed to their first element + length, string leaves replaced by a short
    email-redacted 50-char sample. Recorded once per build (first successful report)
    in helio_fetch_status.json so the live include-section shape is visible without a
    live key — used to refine the metric/quote parsers when Helio changes shape."""
    if depth >= max_depth:
        return "…"
    if isinstance(node, dict):
        return {
            str(k): _shape_skeleton(v, depth + 1, max_depth) for k, v in list(node.items())[:30]
        }
    if isinstance(node, list):
        return {
            "__list_len__": len(node),
            "0": _shape_skeleton(node[0], depth + 1, max_depth) if node else None,
        }
    if isinstance(node, str):
        return redact_text(node)[:50]
    return type(node).__name__


def fetch_test_report(
    session: requests.Session,
    test_id: str,
    include: str = REPORT_INCLUDE,
    limit: int = REPORT_RESPONSE_LIMIT,
    timeout: int = 90,
) -> Dict[str, Any]:
    """GET /tests/:id/report → {found, ux_metrics:[{label,score}], quotes:[...], top_keys}.

    Non-blocking and shape-tolerant: any transport error or non-200 returns
    {found: False, ...}; an unexpected JSON shape yields empty metrics/quotes
    (with top_keys recorded) rather than raising. A `session` double makes this
    unit-testable without a live call.
    """
    url = f"{HELIO_API_BASE}/tests/{test_id}/report"
    params = {"include": include, "limit": str(limit)}
    try:
        resp = session.get(url, params=params, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - non-blocking ingest
        return {"report_id": test_id, "found": False, "error": f"{exc.__class__.__name__}:{exc}"}
    if getattr(resp, "status_code", None) != 200:
        return {"report_id": test_id, "found": False, "status_code": resp.status_code}
    try:
        payload = resp.json()
    except ValueError:
        return {"report_id": test_id, "found": False, "error": "non_json"}
    if not isinstance(payload, dict):
        return {"report_id": test_id, "found": False, "error": "non_object"}
    # Some APIs wrap the body in {"report": {...}} or {"data": {...}}.
    body = payload
    for wrap in ("report", "data"):
        if isinstance(payload.get(wrap), dict):
            body = payload[wrap]
            break
    # Only read the explicit documented sections — never fall back to the whole
    # body, or a stray numeric field (e.g. a response count) reads as a "metric".
    ux_node = body.get("ux_metrics")
    metrics = _coerce_report_metrics(ux_node) if ux_node is not None else []
    resp_node = body.get("questions_responses")
    if resp_node is None:
        resp_node = body.get("responses")
    quotes = _harvest_report_quotes(resp_node) if resp_node is not None else []
    return {
        "report_id": test_id,
        "found": True,
        "ux_metrics": metrics,
        "quotes": quotes,
        "top_keys": sorted(body.keys())[:25],
        "shape": _shape_skeleton(body),
    }


def _attach_report_metrics(
    rec: Dict[str, Any], take_id: str, name: str, metrics: List[Dict]
) -> int:
    """Gap-fill rec['metrics'] from one variant's API metrics. Never overwrites a
    scraped (Tier-A) score; adds missing per-variant values and missing metric
    rows. Returns how many values were added."""
    rows = rec.setdefault("metrics", [])
    by_norm = {_norm_metric_label(r.get("label", "")): r for r in rows}
    added = 0
    for m in metrics:
        norm = _norm_metric_label(m["label"])
        if not norm:
            continue
        row = by_norm.get(norm)
        if row is None:
            row = {"label": m["label"], "values": []}
            rows.append(row)
            by_norm[norm] = row
        values = row.setdefault("values", [])
        existing = next((v for v in values if v.get("take_id") == take_id), None)
        if existing is None:
            values.append(
                {
                    "take_id": take_id,
                    "name": name,
                    "score": m["score"],
                    "qual_label": "",
                    "source": "report_api",
                }
            )
            added += 1
        elif not isinstance(existing.get("score"), (int, float)):
            existing["score"] = m["score"]
            existing.setdefault("source", "report_api")
            added += 1
    return added


def _fold_quotes_into_evidence(rec: Dict[str, Any], quotes: List[str]) -> None:
    """Store clean verbatims on the record and append a wrapped form to
    evidence_text so the existing JS quote harvesters (dashboard pool + concept
    → issue extraction) surface them with no downstream changes."""
    if not quotes:
        return
    rec["respondent_quotes"] = quotes
    # Only quotes within the JS harvester's 200-char window are wrapped (others
    # stay in respondent_quotes for the inference pass); cap to keep text bounded.
    wrapped = " ".join(f'"{q}"' for q in quotes if len(q) <= 200)[:4000]
    if wrapped:
        base = rec.get("evidence_text") or ""
        rec["evidence_text"] = redact_text(f"{base} {wrapped}".strip(), limit=8000)


def enrich_with_report_data(
    evidence: List[Dict[str, Any]],
    app_id: str,
    token: str,
    max_fetches: int,
    session: Optional[requests.Session] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch GET /tests/:id/report for each discovered variant report id and attach
    its UX-metric scores (gap-filling rec['metrics']) and verbatim participant
    quotes (rec['respondent_quotes'] + folded into evidence_text). Returns
    (report_id -> parsed report, status rows)."""
    report_ids = discovered_report_ids(evidence)
    if not report_ids:
        return {}, []
    session = session or helio_api_session(app_id, token)

    reports: Dict[str, Dict[str, Any]] = {}
    statuses: List[Dict[str, Any]] = []
    shape_recorded = False
    for idx, rid in enumerate(report_ids):
        if idx >= max_fetches:
            statuses.append({"report_id": rid, "status": "skipped_limit"})
            continue
        rep = fetch_test_report(session, rid)
        reports[rid] = rep
        row: Dict[str, Any] = {
            "report_id": rid,
            "status": "success" if rep.get("found") else "error",
            "metric_count": len(rep.get("ux_metrics") or []),
            "quote_count": len(rep.get("quotes") or []),
            "status_code": rep.get("status_code"),
            "error": rep.get("error"),
            "top_keys": rep.get("top_keys"),
        }
        # Record the live include-section shape once (first success) for refinement.
        if rep.get("found") and not shape_recorded:
            row["shape"] = rep.get("shape")
            shape_recorded = True
        statuses.append(row)

    for rec in evidence:
        variants = rec.get("variants") or []
        rec_quotes: List[str] = []
        seen_q: set = set()
        metrics_added = 0
        for v in variants:
            rep = reports.get(v.get("report_id"))
            if not rep or not rep.get("found"):
                continue
            ux = rep.get("ux_metrics") or []
            if ux:
                v["report_metrics"] = {m["label"]: m["score"] for m in ux}
                metrics_added += _attach_report_metrics(
                    rec, v.get("take_id"), v.get("name") or "", ux
                )
            for q in rep.get("quotes") or []:
                key = re.sub(r"[^a-z0-9]+", " ", q.lower()).strip()
                if key in seen_q:
                    continue
                seen_q.add(key)
                rec_quotes.append(q)
        if rec_quotes:
            _fold_quotes_into_evidence(rec, rec_quotes)
        if metrics_added:
            rec["report_metrics_added"] = metrics_added
    return reports, statuses


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch Helio evidence linked from the decks")
    ap.add_argument("--data-dir", required=True, help="Build data dir (has deck_links.json)")
    ap.add_argument("--artifact-dir", default=None, help="Unused; accepted for build compatibility")
    ap.add_argument(
        "--max-helio-fetches",
        type=int,
        default=int(os.environ.get("HELIO_FETCH_LIMIT", "12")),
    )
    # Tier B-lite (report config / integrity) uses these public-API keys. The
    # public API can't serve per-response/score data (see HELIO_API_BASE note).
    ap.add_argument("--helio-app-id", default=os.environ.get("HELIO_APP_ID"))
    ap.add_argument("--helio-api-token", default=os.environ.get("HELIO_API_TOKEN"))
    args, _unknown = ap.parse_known_args()

    data_dir = Path(args.data_dir)
    link_payload = (
        load_json(data_dir / "deck_links.json") if (data_dir / "deck_links.json").exists() else {}
    )
    links = link_payload.get("links", []) if isinstance(link_payload, dict) else []

    statuses, evidence = fetch_compare_pages(links, max_fetches=args.max_helio_fetches)

    # Tier B-lite: enrich the compare evidence with sample size + question count
    # from the public API (config). Non-blocking; skipped without keys.
    config_statuses: List[Dict[str, Any]] = []
    report_statuses: List[Dict[str, Any]] = []
    has_keys = bool(args.helio_app_id and args.helio_api_token)
    if has_keys and evidence:
        try:
            _configs, config_statuses = enrich_with_report_config(
                evidence,
                args.helio_app_id,
                args.helio_api_token,
                max_fetches=args.max_helio_fetches,
            )
        except Exception as exc:  # noqa: BLE001 - non-blocking ingest
            config_statuses = [{"status": "error", "error": f"{exc.__class__.__name__}:{exc}"}]
        # Tier B (deep): UX-metric scores + verbatim quotes via /tests/:id/report.
        try:
            _reports, report_statuses = enrich_with_report_data(
                evidence,
                args.helio_app_id,
                args.helio_api_token,
                max_fetches=args.max_helio_fetches,
            )
        except Exception as exc:  # noqa: BLE001 - non-blocking ingest
            report_statuses = [{"status": "error", "error": f"{exc.__class__.__name__}:{exc}"}]

    merged = merge_into_external_evidence(data_dir, evidence)
    augment_summary = augment_deck_content(data_dir, evidence) if evidence else {}

    report_ids = discovered_report_ids(evidence)
    summary = {
        "helio_compare_link_count": len(helio_compare_links(links)),
        "attempted_count": len(
            [s for s in statuses if s.get("status") not in (None, "skipped_limit")]
        ),
        "success_count": len([s for s in statuses if s.get("status") == "success"]),
        "empty_count": len([s for s in statuses if s.get("status") == "empty"]),
        "error_count": len([s for s in statuses if s.get("status") == "error"]),
        "skipped_limit_count": len([s for s in statuses if s.get("status") == "skipped_limit"]),
        "evidence_count": len(evidence),
        "merged_into_external_evidence": merged,
        "discovered_report_ids": report_ids,
        "tier_b_report_api": "configured" if has_keys else "absent",
        "report_config_attempted": len(
            [s for s in config_statuses if s.get("status") != "skipped_limit"]
        ),
        "report_config_success_count": len(
            [s for s in config_statuses if s.get("status") == "success"]
        ),
        "report_config_error_count": len(
            [s for s in config_statuses if s.get("status") == "error"]
        ),
        "report_deep_attempted": len(
            [s for s in report_statuses if s.get("status") != "skipped_limit"]
        ),
        "report_deep_success_count": len(
            [s for s in report_statuses if s.get("status") == "success"]
        ),
        "report_deep_error_count": len([s for s in report_statuses if s.get("status") == "error"]),
        "report_metric_values_added": sum(rec.get("report_metrics_added", 0) for rec in evidence),
        "respondent_quotes_harvested": sum(
            len(rec.get("respondent_quotes") or []) for rec in evidence
        ),
    }

    write_aliases(
        data_dir,
        "helio_evidence.json",
        {"generated_at": utc_now(), "evidence_count": len(evidence), "evidence": evidence},
    )
    write_aliases(
        data_dir,
        "helio_fetch_status.json",
        {
            "generated_at": utc_now(),
            "summary": summary,
            "fetches": statuses,
            "report_config": config_statuses,
            "report_deep": report_statuses,
        },
    )

    print(json.dumps({"helio_summary": summary, "augmentation": augment_summary}, indent=2))


if __name__ == "__main__":
    main()
