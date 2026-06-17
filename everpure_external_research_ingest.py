#!/usr/bin/env python3
"""Fetch richer external research evidence linked from Google Slides decks.

This script is intentionally conservative and non-opinionated. It discovers links
embedded in fetched Google Slides metadata, classifies them, fetches Google
Sheets/Data Comparison sources when Google OAuth permits it, and writes
structured artifacts that can enrich downstream evidence packs.

It does not fetch Helio content yet. Helio links are inventoried only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests

from everpure_deck_ingest import load_json, write_json
from everpure_google_fetch import resolve_access_token

SHEETS_META_URL = "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
SHEETS_VALUES_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range_name}"
)
DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{file_id}/export"

# Transient HTTP statuses that should be RETRIED against the Sheets API rather
# than triggering a (lossy, first-tab-only) Drive CSV fallback.
TRANSIENT_HTTP_STATUSES = frozenset({429, 500, 502, 503, 504})
# Number of attempts (initial + retries) for transient Sheets API errors.
SHEETS_API_RETRY_ATTEMPTS = int(os.environ.get("EXTERNAL_EVIDENCE_SHEETS_API_RETRIES", "3"))
SHEETS_API_RETRY_BACKOFF_SECONDS = float(
    os.environ.get("EXTERNAL_EVIDENCE_SHEETS_API_BACKOFF", "1.5")
)

GOOGLE_SHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")
GOOGLE_DOC_ID_RE = re.compile(r"/document/d/([a-zA-Z0-9_-]+)")
GOOGLE_SLIDES_ID_RE = re.compile(r"/presentation/d/([a-zA-Z0-9_-]+)")
URL_RE = re.compile(r"https?://[^\s)\]>'\"]+")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b")

KEY_SIGNAL_RE = re.compile(
    r"\b(?:winner|won|preferred|preference|selected|success|successful|task|frequency|score|rate|rating|"
    r"clarity|clear|unclear|comprehension|understand|confidence|trust|sentiment|engagement|clicked|click|"
    r"first click|lift|increase|decrease|improved|reduced|friction|quote|why|because|recommendation|finding)\b",
    re.I,
)

CONCEPT_HINTS = [
    ("events", "Events Page"),
    ("event", "Events Page"),
    ("homepage ai", "Homepage AI Messaging"),
    ("ai messaging", "Homepage AI Messaging"),
    ("ai summary", "AI Summary"),
    ("summary", "AI Summary"),
    ("pathfinder", "Pathfinder CTA Labels"),
    ("cta", "Pathfinder CTA Labels"),
    ("webinar", "Webinar Registration Page"),
    ("this book", "Reader Filter: This Book"),
    ("filter", "Reader Filter: This Book"),
    ("virtualization", "Virtualization Campaign"),
    ("knowledge", "Knowledge Portal"),
    ("support", "Support Taxonomy"),
    ("evergreen", "Evergreen Rebrand"),
    ("platform", "Platform Redesign"),
]


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def redact_text(text: Any, limit: Optional[int] = None) -> str:
    cleaned = EMAIL_RE.sub("[email]", normalize_space(text))
    if limit is not None:
        return cleaned[:limit]
    return cleaned


def clean_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return url
    parsed = urlparse(url)
    if parsed.netloc in {"www.google.com", "google.com"} and parsed.path == "/url":
        q = parse_qs(parsed.query).get("q")
        if q and q[0]:
            return unquote(q[0])
    return url


def domain_for(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower().replace("www.", "")
    except Exception:
        return ""


def classify_url(url: str, link_text: str = "") -> str:
    d = domain_for(url)
    text = (link_text or "").lower()
    if "docs.google.com" in d and "/spreadsheets/" in url:
        return "google_sheet"
    if "docs.google.com" in d and "/document/" in url:
        return "google_doc"
    if "docs.google.com" in d and "/presentation/" in url:
        return "google_slides"
    if "helio" in d and "/report/" in url:
        return "helio_report"
    if "helio" in d and ("/share/compare/" in url or "compare" in url):
        return "helio_compare"
    if "helio" in d:
        return "helio"
    if "figma.com" in d:
        return "figma"
    if "notion" in d:
        return "notion"
    if "data comparison" in text:
        return "data_comparison_unknown"
    return "other"


def extract_google_id(url: str, source_type: str) -> Optional[str]:
    if source_type == "google_sheet":
        m = GOOGLE_SHEET_ID_RE.search(url)
    elif source_type == "google_doc":
        m = GOOGLE_DOC_ID_RE.search(url)
    elif source_type == "google_slides":
        m = GOOGLE_SLIDES_ID_RE.search(url)
    else:
        return None
    return m.group(1) if m else None


def extract_gid(url: str) -> Optional[str]:
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if qs.get("gid"):
        return qs["gid"][0]
    frag = parsed.fragment or ""
    if "gid=" in frag:
        frag_qs = parse_qs(frag.replace("#", ""))
        if frag_qs.get("gid"):
            return frag_qs["gid"][0]
    return None


def extract_shape_text(element: Dict[str, Any]) -> str:
    parts: List[str] = []
    text_elements = ((element.get("shape") or {}).get("text") or {}).get("textElements") or []
    for te in text_elements:
        run = te.get("textRun") or {}
        content = run.get("content")
        if content:
            parts.append(content)
    return normalize_space("".join(parts))


def slide_text_excerpt(slide: Dict[str, Any], limit: int = 260) -> str:
    texts = []
    for element in slide.get("pageElements") or []:
        txt = extract_shape_text(element)
        if txt:
            texts.append(txt)
    return normalize_space(" | ".join(texts))[:limit]


def collect_link_runs_from_element(element: Dict[str, Any]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    text_elements = ((element.get("shape") or {}).get("text") or {}).get("textElements") or []
    for te in text_elements:
        run = te.get("textRun") or {}
        content = normalize_space(run.get("content") or "")
        style = run.get("style") or {}
        link = style.get("link") or {}
        url = link.get("url")
        if url:
            out.append((url, content))
    return out


def walk_for_link_urls(obj: Any, out: List[str]) -> None:
    if obj is None:
        return
    if isinstance(obj, str):
        for m in URL_RE.finditer(obj):
            out.append(m.group(0))
        return
    if isinstance(obj, list):
        for item in obj:
            walk_for_link_urls(item, out)
        return
    if isinstance(obj, dict):
        link = obj.get("link")
        if isinstance(link, dict) and isinstance(link.get("url"), str):
            out.append(link["url"])
        if isinstance(obj.get("url"), str) and any(
            k in obj for k in ("link", "title", "description")
        ):
            out.append(obj["url"])
        for value in obj.values():
            walk_for_link_urls(value, out)


def associated_map(deck_details: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {d.get("file_id"): d for d in deck_details if d.get("file_id")}


def make_link_id(deck_id: str, slide_number: int, url: str, text: str) -> str:
    raw = f"{deck_id}|{slide_number}|{url}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def infer_concepts(text: str) -> List[str]:
    lower = (text or "").lower()
    out = []
    for needle, label in CONCEPT_HINTS:
        if needle in lower and label not in out:
            out.append(label)
    return out[:4]


def extract_links_from_metadata(meta_path: Path, deck_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        meta = load_json(meta_path)
    except Exception as exc:
        return [{"file_id": meta_path.stem, "error": f"metadata_load_failed:{exc}"}]

    deck_id = meta_path.stem
    deck_title = (
        meta.get("title") or deck_info.get("title") or deck_info.get("canonical_url") or deck_id
    )
    slides = meta.get("slides") or []
    records: List[Dict[str, Any]] = []
    seen = set()

    for idx, slide in enumerate(slides, start=1):
        slide_id = slide.get("objectId")
        slide_excerpt = slide_text_excerpt(slide)
        for element in slide.get("pageElements") or []:
            element_text = extract_shape_text(element)
            generic_urls: List[str] = []
            for raw_url, link_text in collect_link_runs_from_element(element):
                target_url = clean_url(raw_url)
                key = (idx, target_url, link_text)
                if key in seen:
                    continue
                seen.add(key)
                source_type = classify_url(target_url, link_text)
                concept_context = " ".join([deck_title, slide_excerpt, link_text, element_text])
                records.append(
                    {
                        "link_id": make_link_id(deck_id, idx, target_url, link_text),
                        "deck_file_id": deck_id,
                        "deck_title": normalize_space(deck_title),
                        "slide_number": idx,
                        "slide_object_id": slide_id,
                        "link_text": normalize_space(link_text)
                        or normalize_space(element_text)[:120],
                        "slide_text_excerpt": slide_excerpt,
                        "raw_url": raw_url,
                        "target_url": target_url,
                        "domain": domain_for(target_url),
                        "source_type": source_type,
                        "google_file_id": extract_google_id(target_url, source_type),
                        "google_gid": extract_gid(target_url),
                        "associated_weeks": deck_info.get("associated_weeks", []),
                        "associated_record_ids": deck_info.get("associated_record_ids", []),
                        "inferred_concepts": infer_concepts(concept_context),
                    }
                )
            walk_for_link_urls(element, generic_urls)
            for raw_url in generic_urls:
                target_url = clean_url(raw_url)
                key = (idx, target_url, "")
                if key in seen:
                    continue
                seen.add(key)
                source_type = classify_url(target_url, "")
                concept_context = " ".join([deck_title, slide_excerpt, element_text])
                records.append(
                    {
                        "link_id": make_link_id(deck_id, idx, target_url, ""),
                        "deck_file_id": deck_id,
                        "deck_title": normalize_space(deck_title),
                        "slide_number": idx,
                        "slide_object_id": slide_id,
                        "link_text": "",
                        "slide_text_excerpt": slide_excerpt,
                        "raw_url": raw_url,
                        "target_url": target_url,
                        "domain": domain_for(target_url),
                        "source_type": source_type,
                        "google_file_id": extract_google_id(target_url, source_type),
                        "google_gid": extract_gid(target_url),
                        "associated_weeks": deck_info.get("associated_weeks", []),
                        "associated_record_ids": deck_info.get("associated_record_ids", []),
                        "inferred_concepts": infer_concepts(concept_context),
                    }
                )
    return records


def dedupe_links(links: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for link in links:
        if link.get("error"):
            out.append(link)
            continue
        key = (
            link.get("deck_file_id"),
            link.get("slide_number"),
            link.get("target_url"),
            link.get("link_text"),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(link)
    return out


def summarize_links(links: List[Dict[str, Any]]) -> Dict[str, Any]:
    source_types = Counter(l.get("source_type", "unknown") for l in links if not l.get("error"))
    domains = Counter(l.get("domain", "") for l in links if not l.get("error"))
    deck_counts = Counter(l.get("deck_file_id", "unknown") for l in links if not l.get("error"))
    return {
        "deck_metadata_count": len(deck_counts),
        "link_count": len([l for l in links if not l.get("error")]),
        "error_count": len([l for l in links if l.get("error")]),
        "by_source_type": dict(source_types.most_common()),
        "by_domain": dict(domains.most_common(25)),
        "links_by_deck": dict(deck_counts.most_common()),
    }


def col_name(n: int) -> str:
    out = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out or "A"


def extract_numbers(text: str, limit: int = 80) -> List[str]:
    return list(dict.fromkeys(NUMBER_RE.findall(text or "")))[:limit]


def row_has_signal(row_text: str) -> bool:
    if not row_text:
        return False
    if KEY_SIGNAL_RE.search(row_text):
        return True
    if "%" in row_text:
        return True
    nums = NUMBER_RE.findall(row_text)
    return len(nums) >= 2


def score_row(row: List[str], header_terms: str = "") -> int:
    row_text = " | ".join(normalize_space(c) for c in row if normalize_space(c))
    score = 0
    if KEY_SIGNAL_RE.search(row_text):
        score += 5
    if "%" in row_text:
        score += 4
    score += min(len(NUMBER_RE.findall(row_text)), 5)
    if any(
        term in row_text.lower()
        for term in ["winner", "preferred", "quote", "summary", "finding", "recommend"]
    ):
        score += 3
    if header_terms and any(t in row_text.lower() for t in header_terms.split()[:10]):
        score += 1
    return score


def summarize_values(values: List[List[Any]], max_notable_rows: int = 10) -> Dict[str, Any]:
    rows = [
        [redact_text(cell, limit=240) for cell in row]
        for row in values
        if any(normalize_space(c) for c in row)
    ]
    headers = rows[0] if rows else []
    body = rows[1:] if len(rows) > 1 else []
    header_terms = " ".join(h.lower() for h in headers if h)
    ranked = sorted(body, key=lambda r: score_row(r, header_terms), reverse=True)
    notable = []
    for row in ranked:
        if score_row(row, header_terms) <= 0 and len(notable) >= 3:
            continue
        row_text = " | ".join(c for c in row if c)
        if not row_text:
            continue
        notable.append(row[:18])
        if len(notable) >= max_notable_rows:
            break
    joined = "\n".join(" | ".join(row) for row in rows[:80])
    return {
        "row_count_sampled": len(rows),
        "column_count_sampled": max((len(r) for r in rows), default=0),
        "headers": headers[:24],
        "numeric_values": extract_numbers(joined),
        "text_excerpt": redact_text(joined, limit=2500),
        "notable_rows": notable,
    }


def sheet_range(title: str, max_rows: int, max_columns: int) -> str:
    safe_title = str(title or "Sheet1").replace("'", "''")
    return f"'{safe_title}'!A1:{col_name(max_columns)}{max_rows}"


def get_json(session: requests.Session, url: str, **kwargs: Any) -> Dict[str, Any]:
    resp = session.get(url, timeout=60, **kwargs)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Pure helpers for Sheets-capture decisions (unit-tested in tests/test_sheets_capture.py)
# ---------------------------------------------------------------------------


def http_status_from_exc(exc: BaseException) -> Optional[int]:
    """Best-effort extraction of an HTTP status code from a requests error.

    Returns None for non-HTTP failures (timeouts, connection errors, ...).
    """
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if isinstance(code, int):
            return code
    return None


def should_fall_back_to_csv(status_code: Optional[int], reason: str = "") -> bool:
    """Decide whether a Sheets API failure justifies the lossy Drive CSV fallback.

    Only return True when the Sheets API is genuinely UNAVAILABLE for the project:
      * HTTP 403 whose reason indicates the API is disabled (SERVICE_DISABLED /
        accessNotConfigured / "has not been used"/"is disabled"), or
      * HTTP 404 of the API itself (accessNotConfigured surfaced as 404).

    Transient errors (429, 5xx, timeouts → status_code None) must NOT fall back;
    they should be retried and, failing that, recorded as a hard error.
    A plain 403 (per-tab permission / sharing) is NOT an API-disabled signal and
    must not silently degrade to a first-tab CSV.
    """
    if status_code is None:
        return False
    if status_code in TRANSIENT_HTTP_STATUSES:
        return False
    reason_l = (reason or "").lower()
    api_disabled_markers = (
        "service_disabled",
        "accessnotconfigured",
        "has not been used",
        "is disabled",
        "api has not been used",
        "enable it by visiting",
    )
    if status_code in (403, 404) and any(m in reason_l for m in api_disabled_markers):
        return True
    return False


def is_transient_status(status_code: Optional[int]) -> bool:
    """True for statuses/timeouts that warrant a retry of the Sheets API."""
    if status_code is None:
        # No HTTP status → network/timeout class error: treat as transient.
        return True
    return status_code in TRANSIENT_HTTP_STATUSES


def tab_selection(meta: Dict[str, Any], gid: Optional[str]) -> Dict[str, Any]:
    """Select which tabs of a spreadsheet to read.

    Returns a dict with:
      * "selected": list of sheet objects to read
      * "sheet_count": total number of tabs in the spreadsheet
      * "requested_gid_not_found": True when a gid was given but matched no tab
      * "requested_gid": the gid that was requested (when applicable)

    Behavior:
      * gid given + matches a tab → that single tab.
      * gid given + matches NO tab → empty selection + requested_gid_not_found
        (does NOT silently read other tabs).
      * no gid → ALL tabs.
    """
    sheets = meta.get("sheets") or []
    result: Dict[str, Any] = {
        "selected": [],
        "sheet_count": len(sheets),
        "requested_gid_not_found": False,
    }
    if gid not in (None, ""):
        result["requested_gid"] = gid
        for s in sheets:
            props = s.get("properties") or {}
            if str(props.get("sheetId")) == str(gid):
                result["selected"] = [s]
                return result
        # gid was requested but matched nothing: do not fall back to other tabs.
        result["requested_gid_not_found"] = True
        return result
    # No gid: read every tab.
    result["selected"] = list(sheets)
    return result


def flag_truncation(
    grid_properties: Dict[str, Any], max_rows: int, max_columns: int
) -> Dict[str, Any]:
    """Compare a tab's true grid size against the row/column caps.

    Returns flags + true totals so the summary can surface silent truncation.
    """
    total_rows = grid_properties.get("rowCount")
    total_columns = grid_properties.get("columnCount")
    row_truncated = isinstance(total_rows, int) and total_rows > max_rows
    column_truncated = isinstance(total_columns, int) and total_columns > max_columns
    return {
        "total_row_count": total_rows,
        "total_column_count": total_columns,
        "row_truncated": bool(row_truncated),
        "column_truncated": bool(column_truncated),
    }


def fetch_sheet_via_sheets_api(
    session: requests.Session,
    spreadsheet_id: str,
    gid: Optional[str],
    max_rows: int,
    max_columns: int,
    max_sheets_per_file: int,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    meta = get_json(
        session,
        SHEETS_META_URL.format(spreadsheet_id=spreadsheet_id),
        params={
            "fields": "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))"
        },
    )

    selection = tab_selection(meta, gid)
    selected = selection["selected"]
    sheet_count = selection["sheet_count"]

    fetch_meta: Dict[str, Any] = {
        "spreadsheet_title": ((meta.get("properties") or {}).get("title") or ""),
        "sheet_count": sheet_count,
        "method": "sheets_api",
        "requested_gid": gid,
        "requested_gid_not_found": selection["requested_gid_not_found"],
        "sheets_truncated": False,
    }

    # Default behavior: read ALL selected tabs. Keep an optional safety cap that,
    # when exceeded, surfaces sheets_truncated=True + the true sheet_count rather
    # than silently dropping tabs. A non-positive cap means "no cap".
    if max_sheets_per_file and max_sheets_per_file > 0 and len(selected) > max_sheets_per_file:
        fetch_meta["sheets_truncated"] = True
        selected = selected[:max_sheets_per_file]

    fetch_meta["selected_sheet_count"] = len(selected)

    out = []
    for s in selected:
        props = s.get("properties") or {}
        title = props.get("title") or "Sheet1"
        grid = props.get("gridProperties") or {}
        range_name = sheet_range(title, max_rows=max_rows, max_columns=max_columns)
        encoded_range = quote(range_name, safe="")
        values = (
            get_json(
                session,
                SHEETS_VALUES_URL.format(spreadsheet_id=spreadsheet_id, range_name=encoded_range),
                params={"majorDimension": "ROWS"},
            ).get("values")
            or []
        )
        summary = summarize_values(values)
        summary.update(
            {
                "sheet_id": props.get("sheetId"),
                "sheet_title": title,
                "range": range_name,
            }
        )
        summary.update(flag_truncation(grid, max_rows=max_rows, max_columns=max_columns))
        out.append(summary)
    return out, fetch_meta


def fetch_sheet_via_drive_export(
    session: requests.Session,
    spreadsheet_id: str,
    max_rows: int,
    max_columns: int,
    gid_requested: bool = False,
    known_sheet_count: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Last-resort CSV export. Serializes ONLY the first tab and cannot honor a gid.

    When the spreadsheet has more than one tab, or a gid was requested, this is a
    LOSSY capture: the resulting summary is flagged truncated_to_first_tab=True
    (and gid_ignored=True when a gid was requested) so it is never mistaken for a
    complete multi-tab capture.
    """
    resp = session.get(
        DRIVE_EXPORT_URL.format(file_id=spreadsheet_id),
        params={"mimeType": "text/csv"},
        timeout=90,
    )
    resp.raise_for_status()
    reader = csv.reader(io.StringIO(resp.text))
    values = []
    for row in reader:
        values.append(row[:max_columns])
        if len(values) >= max_rows:
            break

    multi_tab = bool(known_sheet_count and known_sheet_count > 1)
    truncated_to_first_tab = multi_tab or bool(gid_requested)
    gid_ignored = bool(gid_requested)

    summary = summarize_values(values)
    summary.update(
        {
            "sheet_id": None,
            "sheet_title": "Drive CSV export",
            "range": f"A1:{col_name(max_columns)}{max_rows}",
            "truncated_to_first_tab": truncated_to_first_tab,
            "gid_ignored": gid_ignored,
        }
    )
    return [summary], {
        "method": "drive_csv_export",
        "spreadsheet_title": "",
        "sheet_count": known_sheet_count,
        "selected_sheet_count": 1,
        "truncated_to_first_tab": truncated_to_first_tab,
        "gid_ignored": gid_ignored,
    }


def fetch_spreadsheet_with_policy(
    session: requests.Session,
    spreadsheet_id: str,
    gid: Optional[str],
    max_rows: int,
    max_columns: int,
    max_sheets_per_file: int,
    retry_attempts: int = SHEETS_API_RETRY_ATTEMPTS,
    backoff_seconds: float = SHEETS_API_RETRY_BACKOFF_SECONDS,
    sleep_fn: Any = time.sleep,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Fetch a spreadsheet via the Sheets API, with a narrow, visible CSV fallback.

    Policy:
      * Primary path is the Sheets API (authorized by the existing drive.readonly
        scope). No new OAuth scope is added.
      * Transient errors (429, 5xx, timeouts) are RETRIED up to retry_attempts
        with a short linear backoff.
      * Only an API-DISABLED signal (should_fall_back_to_csv) triggers the lossy
        Drive CSV export, which is flagged truncated_to_first_tab / gid_ignored
        when it loses tabs.
      * Any other failure (or exhausted transient retries) is re-raised as a HARD
        error so the caller records status="error" rather than a silent success.
    """
    gid_requested = gid not in (None, "")
    last_exc: Optional[BaseException] = None
    for attempt in range(1, max(1, retry_attempts) + 1):
        try:
            sheets, fetch_meta = fetch_sheet_via_sheets_api(
                session=session,
                spreadsheet_id=spreadsheet_id,
                gid=gid,
                max_rows=max_rows,
                max_columns=max_columns,
                max_sheets_per_file=max_sheets_per_file,
            )
            fetch_meta["sheets_api_attempts"] = attempt
            return sheets, fetch_meta
        except Exception as exc:
            last_exc = exc
            status_code = http_status_from_exc(exc)
            reason = str(exc)

            # API genuinely unavailable for the project → narrow CSV fallback.
            # The Sheets metadata is unreachable here (the API is disabled), and
            # Drive metadata does not expose a tab count, so sheet_count is
            # unknown; flag truncation conservatively based on gid_requested.
            if should_fall_back_to_csv(status_code, reason):
                sheets, fetch_meta = fetch_sheet_via_drive_export(
                    session=session,
                    spreadsheet_id=spreadsheet_id,
                    max_rows=max_rows,
                    max_columns=max_columns,
                    gid_requested=gid_requested,
                    known_sheet_count=None,
                )
                fetch_meta["sheets_api_error"] = f"{exc.__class__.__name__}:{exc}"
                fetch_meta["fallback_reason"] = "sheets_api_disabled"
                return sheets, fetch_meta

            # Transient → retry (unless we've used our last attempt).
            if is_transient_status(status_code) and attempt < max(1, retry_attempts):
                sleep_fn(backoff_seconds * attempt)
                continue

            # Hard error: do NOT silently fall back to a first-tab CSV.
            raise

    # All retries exhausted on a transient error: surface a hard error.
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("fetch_spreadsheet_with_policy: no attempt was made")


def render_evidence_text(record: Dict[str, Any]) -> str:
    parts = []
    title = record.get("deck_title") or "linked research deck"
    slide = record.get("slide_number")
    link_text = record.get("link_text") or "Data comparison"
    parts.append(f"External research evidence linked from {title}, slide {slide}: {link_text}.")
    if record.get("inferred_concepts"):
        parts.append("Related concepts: " + ", ".join(record["inferred_concepts"]) + ".")
    if record.get("slide_text_excerpt"):
        parts.append("Slide context: " + record["slide_text_excerpt"] + ".")
    for sheet in record.get("sheets", [])[:5]:
        parts.append(f"Sheet: {sheet.get('sheet_title') or 'Untitled'}.")
        headers = [h for h in sheet.get("headers", []) if h]
        if headers:
            parts.append("Headers: " + " | ".join(headers[:12]) + ".")
        nums = sheet.get("numeric_values") or []
        if nums:
            parts.append("Numbers observed: " + ", ".join(nums[:20]) + ".")
        notable_rows = sheet.get("notable_rows") or []
        if notable_rows:
            row_texts = []
            for row in notable_rows[:6]:
                row_text = " | ".join(cell for cell in row if cell)
                if row_text:
                    row_texts.append(row_text)
            if row_texts:
                parts.append("Notable evidence rows: " + " // ".join(row_texts) + ".")
    return redact_text(" ".join(parts), limit=6000)


def degradation_flags(sheets: List[Dict[str, Any]], fetch_meta: Dict[str, Any]) -> Dict[str, Any]:
    """Roll up per-sheet + fetch-level degradation into status-artifact flags."""
    truncated_to_first_tab = bool(fetch_meta.get("truncated_to_first_tab")) or any(
        s.get("truncated_to_first_tab") for s in sheets
    )
    gid_ignored = bool(fetch_meta.get("gid_ignored")) or any(s.get("gid_ignored") for s in sheets)
    return {
        "truncated_to_first_tab": truncated_to_first_tab,
        "gid_ignored": gid_ignored,
        "requested_gid_not_found": bool(fetch_meta.get("requested_gid_not_found")),
        "sheets_truncated": bool(fetch_meta.get("sheets_truncated")),
        "row_truncated": any(s.get("row_truncated") for s in sheets),
        "column_truncated": any(s.get("column_truncated") for s in sheets),
        "degraded": bool(
            truncated_to_first_tab
            or gid_ignored
            or fetch_meta.get("requested_gid_not_found")
            or fetch_meta.get("sheets_truncated")
            or any(s.get("row_truncated") for s in sheets)
            or any(s.get("column_truncated") for s in sheets)
        ),
    }


def build_sheet_records(
    links: List[Dict[str, Any]],
    access_token: str,
    max_fetches: int,
    max_rows: int,
    max_columns: int,
    max_sheets_per_file: int,
    strict: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {access_token}"})
    statuses: List[Dict[str, Any]] = []
    evidence: List[Dict[str, Any]] = []
    unique: Dict[Tuple[str, Optional[str]], List[Dict[str, Any]]] = defaultdict(list)
    for link in links:
        if link.get("source_type") != "google_sheet":
            continue
        spreadsheet_id = link.get("google_file_id")
        if not spreadsheet_id:
            continue
        unique[(spreadsheet_id, link.get("google_gid"))].append(link)

    for idx, ((spreadsheet_id, gid), refs) in enumerate(unique.items()):
        if idx >= max_fetches:
            for ref in refs:
                statuses.append(
                    {
                        "status": "skipped_limit",
                        "spreadsheet_id": spreadsheet_id,
                        "gid": gid,
                        "link_id": ref.get("link_id"),
                        "source_url": ref.get("target_url"),
                    }
                )
            continue

        primary = refs[0]
        status: Dict[str, Any] = {
            "spreadsheet_id": spreadsheet_id,
            "gid": gid,
            "source_url": primary.get("target_url"),
            "source_type": "google_sheet",
            "deck_file_id": primary.get("deck_file_id"),
            "slide_number": primary.get("slide_number"),
            "link_text": primary.get("link_text"),
            "linked_from_count": len(refs),
        }
        try:
            # Sheets API is primary; CSV fallback is narrow + visible. Transient
            # errors are retried inside fetch_spreadsheet_with_policy; a hard
            # failure raises and is recorded as status="error" below.
            sheets, fetch_meta = fetch_spreadsheet_with_policy(
                session=session,
                spreadsheet_id=spreadsheet_id,
                gid=gid,
                max_rows=max_rows,
                max_columns=max_columns,
                max_sheets_per_file=max_sheets_per_file,
            )
            flags = degradation_flags(sheets, fetch_meta)
            status.update(
                {
                    "status": "success",
                    "method": fetch_meta.get("method"),
                    "spreadsheet_title": fetch_meta.get("spreadsheet_title"),
                    "sheet_count": fetch_meta.get("sheet_count"),
                    "selected_sheet_count": fetch_meta.get("selected_sheet_count"),
                    "sheets_api_attempts": fetch_meta.get("sheets_api_attempts"),
                    "sheets_api_error": fetch_meta.get("sheets_api_error"),
                    "fallback_reason": fetch_meta.get("fallback_reason"),
                    "numeric_value_count": sum(len(s.get("numeric_values") or []) for s in sheets),
                    "notable_row_count": sum(len(s.get("notable_rows") or []) for s in sheets),
                    **flags,
                }
            )
            if strict and flags["degraded"]:
                raise RuntimeError(
                    "degraded_sheet_capture: "
                    + ", ".join(k for k, v in flags.items() if v and k != "degraded")
                )
            record = {
                "source_type": "google_sheet_data_comparison",
                "spreadsheet_id": spreadsheet_id,
                "gid": gid,
                "source_url": primary.get("target_url"),
                "deck_file_id": primary.get("deck_file_id"),
                "deck_title": primary.get("deck_title"),
                "slide_number": primary.get("slide_number"),
                "link_text": primary.get("link_text"),
                "slide_text_excerpt": primary.get("slide_text_excerpt"),
                "associated_weeks": primary.get("associated_weeks", []),
                "associated_record_ids": primary.get("associated_record_ids", []),
                "inferred_concepts": sorted(
                    {c for ref in refs for c in (ref.get("inferred_concepts") or [])}
                ),
                "linked_from": [
                    {
                        "link_id": ref.get("link_id"),
                        "deck_file_id": ref.get("deck_file_id"),
                        "slide_number": ref.get("slide_number"),
                        "link_text": ref.get("link_text"),
                        "slide_text_excerpt": ref.get("slide_text_excerpt"),
                    }
                    for ref in refs[:12]
                ],
                "fetch_meta": fetch_meta,
                "sheets": sheets,
            }
            record["evidence_text"] = render_evidence_text(record)
            evidence.append(record)
        except Exception as exc:
            status.update(
                {
                    "status": "error",
                    "error": f"{exc.__class__.__name__}:{exc}",
                }
            )
        statuses.append(status)
    return statuses, evidence


def flatten_deck_content(raw: Any) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)], None
    if isinstance(raw, dict):
        for key in ("items", "decks", "deck_content", "deckContents", "entries"):
            if isinstance(raw.get(key), list):
                return [x for x in raw[key] if isinstance(x, dict)], key
    return [], None


def augment_deck_content(data_dir: Path, evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
    candidates = [data_dir / "deck_content.json", data_dir / "deck-content.json"]
    raw = []
    source_path = candidates[0]
    for p in candidates:
        if p.exists():
            raw = load_json(p)
            source_path = p
            break
    items, container_key = flatten_deck_content(raw)
    by_file: Dict[str, Dict[str, Any]] = {}
    for item in items:
        fid = item.get("file_id") or item.get("deck_file_id") or item.get("id")
        if fid and fid not in by_file:
            by_file[fid] = item

    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for rec in evidence:
        if rec.get("deck_file_id") and rec.get("evidence_text"):
            grouped[rec["deck_file_id"]].append(rec)

    for fid, recs in grouped.items():
        text = "\n\n".join(r.get("evidence_text", "") for r in recs if r.get("evidence_text"))
        if not text:
            continue
        if fid in by_file:
            item = by_file[fid]
            existing = normalize_space(item.get("external_research_evidence_text") or "")
            item["external_research_evidence_text"] = normalize_space(
                (existing + "\n\n" + text).strip()
            )
            item["external_research_evidence_count"] = len(recs)
        else:
            item = {
                "file_id": fid,
                "deck_file_id": fid,
                "title": recs[0].get("deck_title") or fid,
                "text": text,
                "external_research_evidence_text": text,
                "external_research_evidence_count": len(recs),
                "source_type": "external_research_evidence",
            }
            items.append(item)
            by_file[fid] = item

    if isinstance(raw, dict) and container_key:
        raw[container_key] = items
        updated = raw
    else:
        updated = items
    write_json(data_dir / "deck_content.json", updated)
    write_json(data_dir / "deck-content.json", updated)
    return {
        "deck_content_items": len(items),
        "augmented_deck_count": len(grouped),
        "source_path": str(source_path),
    }


def write_aliases(data_dir: Path, name: str, payload: Any) -> None:
    write_json(data_dir / name, payload)
    write_json(data_dir / name.replace("_", "-"), payload)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fetch external research evidence linked from Google Slides decks"
    )
    ap.add_argument("--data-dir", required=True, help="Directory containing deck_details.json")
    ap.add_argument(
        "--artifact-dir",
        required=True,
        help="Directory containing fetched Slides metadata JSON files",
    )
    ap.add_argument("--access-token", default=None)
    ap.add_argument("--client-id", default=None)
    ap.add_argument("--client-secret", default=None)
    ap.add_argument("--refresh-token", default=None)
    ap.add_argument("--service-account-json", default=None)
    ap.add_argument("--subject", default=None)
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Accepted for build compatibility; link discovery uses local metadata files",
    )
    ap.add_argument(
        "--max-google-sheet-fetches",
        type=int,
        default=int(os.environ.get("EXTERNAL_EVIDENCE_SHEET_FETCH_LIMIT", "20")),
    )
    ap.add_argument(
        "--max-rows", type=int, default=int(os.environ.get("EXTERNAL_EVIDENCE_MAX_ROWS", "200"))
    )
    ap.add_argument(
        "--max-columns",
        type=int,
        # Raised from 26 to cover real multi-attribute comparison sheets.
        default=int(os.environ.get("EXTERNAL_EVIDENCE_MAX_COLUMNS", "52")),
    )
    ap.add_argument(
        "--max-sheets-per-file",
        type=int,
        # Safety cap only; <=0 means "no cap, fetch all tabs". When a positive
        # cap is exceeded the status artifact carries sheets_truncated=true.
        default=int(os.environ.get("EXTERNAL_EVIDENCE_MAX_SHEETS_PER_FILE", "0")),
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        default=os.environ.get("EXTERNAL_EVIDENCE_STRICT", "0") == "1",
        help="Treat degraded/truncated sheet captures as errors (default: non-blocking, flags only).",
    )
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    artifact_dir = Path(args.artifact_dir)
    deck_details = (
        load_json(data_dir / "deck_details.json")
        if (data_dir / "deck_details.json").exists()
        else []
    )
    by_deck = associated_map(deck_details)

    links: List[Dict[str, Any]] = []
    for meta_path in sorted(artifact_dir.glob("*.json")):
        if meta_path.name.startswith("google_fetch_manifest"):
            continue
        deck_info = by_deck.get(meta_path.stem, {})
        links.extend(extract_links_from_metadata(meta_path, deck_info))
    links = dedupe_links(links)

    access_token = resolve_access_token(args)
    statuses, evidence = build_sheet_records(
        links=links,
        access_token=access_token,
        max_fetches=args.max_google_sheet_fetches,
        max_rows=args.max_rows,
        max_columns=args.max_columns,
        max_sheets_per_file=args.max_sheets_per_file,
        strict=args.strict,
    )
    augment_summary = augment_deck_content(data_dir, evidence)

    link_payload = {
        "generated_at": utc_now(),
        "artifact_dir": str(artifact_dir),
        "summary": summarize_links(links),
        "links": links,
    }
    status_payload = {
        "generated_at": utc_now(),
        "summary": {
            "google_sheet_link_count": len(
                [l for l in links if l.get("source_type") == "google_sheet"]
            ),
            "helio_link_count": len(
                [l for l in links if str(l.get("source_type", "")).startswith("helio")]
            ),
            "attempted_count": len([s for s in statuses if s.get("status") != "skipped_limit"]),
            "success_count": len([s for s in statuses if s.get("status") == "success"]),
            "error_count": len([s for s in statuses if s.get("status") == "error"]),
            "skipped_limit_count": len([s for s in statuses if s.get("status") == "skipped_limit"]),
            "degraded_count": len([s for s in statuses if s.get("degraded")]),
            "truncated_to_first_tab_count": len(
                [s for s in statuses if s.get("truncated_to_first_tab")]
            ),
            "requested_gid_not_found_count": len(
                [s for s in statuses if s.get("requested_gid_not_found")]
            ),
        },
        "fetches": statuses,
    }
    evidence_payload = {
        "generated_at": utc_now(),
        "source": "deck_link_google_sheet_ingest",
        "note": "Google Sheets/Data Comparison evidence linked from Slides decks. Helio links are inventoried in deck_links.json but not fetched.",
        "evidence_count": len(evidence),
        "evidence": evidence,
    }
    summary_payload = {
        "generated_at": utc_now(),
        "summary": {
            **status_payload["summary"],
            "evidence_count": len(evidence),
            **augment_summary,
        },
        "top_sources": [
            {
                "deck_title": e.get("deck_title"),
                "slide_number": e.get("slide_number"),
                "link_text": e.get("link_text"),
                "inferred_concepts": e.get("inferred_concepts", []),
                "sheet_count": len(e.get("sheets", [])),
            }
            for e in evidence[:20]
        ],
    }

    write_aliases(data_dir, "deck_links.json", link_payload)
    write_aliases(data_dir, "deck_link_fetch_status.json", status_payload)
    write_aliases(data_dir, "external_research_evidence.json", evidence_payload)
    write_aliases(data_dir, "external_research_evidence_summary.json", summary_payload)

    print(
        json.dumps(
            {
                "link_summary": link_payload["summary"],
                "fetch_summary": status_payload["summary"],
                "augmentation": augment_summary,
                "outputs": [
                    str(data_dir / "deck_links.json"),
                    str(data_dir / "deck_link_fetch_status.json"),
                    str(data_dir / "external_research_evidence.json"),
                    str(data_dir / "external_research_evidence_summary.json"),
                    str(data_dir / "deck_content.json"),
                ],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
