#!/usr/bin/env python3
"""Extract linked research sources from Google Slides decks and smoke-test Google Sheet access.

This script is intentionally conservative. It discovers links embedded in fetched Google
Slides metadata, classifies them, and smoke-tests Google Sheet/Data Comparison links using
Drive export with the same OAuth token used for deck fetching. It does not fetch Helio data;
Helio links are inventoried for follow-up.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

import requests

from everpure_deck_ingest import load_json, write_json
from everpure_google_fetch import resolve_access_token

DRIVE_EXPORT_URL = "https://www.googleapis.com/drive/v3/files/{file_id}/export"
GOOGLE_SHEET_ID_RE = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")
GOOGLE_DOC_ID_RE = re.compile(r"/document/d/([a-zA-Z0-9_-]+)")
GOOGLE_SLIDES_ID_RE = re.compile(r"/presentation/d/([a-zA-Z0-9_-]+)")
URL_RE = re.compile(r"https?://[^\s)\]>'\"]+")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


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


def extract_shape_text(element: Dict[str, Any]) -> str:
    parts: List[str] = []
    text_elements = (((element.get("shape") or {}).get("text") or {}).get("textElements") or [])
    for te in text_elements:
        run = te.get("textRun") or {}
        content = run.get("content")
        if content:
            parts.append(content)
    return normalize_space("".join(parts))


def slide_text_excerpt(slide: Dict[str, Any], limit: int = 220) -> str:
    texts = []
    for element in slide.get("pageElements") or []:
        txt = extract_shape_text(element)
        if txt:
            texts.append(txt)
    return normalize_space(" | ".join(texts))[:limit]


def collect_link_runs_from_element(element: Dict[str, Any]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    text_elements = (((element.get("shape") or {}).get("text") or {}).get("textElements") or [])
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
        if isinstance(obj.get("url"), str) and any(k in obj for k in ("link", "title", "description")):
            out.append(obj["url"])
        for value in obj.values():
            walk_for_link_urls(value, out)


def associated_map(deck_details: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {d.get("file_id"): d for d in deck_details if d.get("file_id")}


def link_id(deck_id: str, slide_number: int, url: str, text: str) -> str:
    raw = f"{deck_id}|{slide_number}|{url}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def extract_links_from_metadata(meta_path: Path, deck_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        meta = load_json(meta_path)
    except Exception as exc:
        return [{
            "file_id": meta_path.stem,
            "error": f"metadata_load_failed:{exc}",
        }]

    deck_id = meta_path.stem
    deck_title = meta.get("title") or deck_info.get("title") or deck_info.get("canonical_url") or deck_id
    slides = meta.get("slides") or []
    records: List[Dict[str, Any]] = []
    seen = set()

    for idx, slide in enumerate(slides, start=1):
        slide_id = slide.get("objectId")
        slide_excerpt = slide_text_excerpt(slide)
        generic_urls: List[str] = []

        for element in slide.get("pageElements") or []:
            element_text = extract_shape_text(element)
            for raw_url, link_text in collect_link_runs_from_element(element):
                target_url = clean_url(raw_url)
                key = (idx, target_url, link_text)
                if key in seen:
                    continue
                seen.add(key)
                source_type = classify_url(target_url, link_text)
                records.append({
                    "link_id": link_id(deck_id, idx, target_url, link_text),
                    "deck_file_id": deck_id,
                    "deck_title": normalize_space(deck_title),
                    "slide_number": idx,
                    "slide_object_id": slide_id,
                    "link_text": normalize_space(link_text) or normalize_space(element_text)[:120],
                    "slide_text_excerpt": slide_excerpt,
                    "raw_url": raw_url,
                    "target_url": target_url,
                    "domain": domain_for(target_url),
                    "source_type": source_type,
                    "google_file_id": extract_google_id(target_url, source_type),
                    "google_gid": extract_gid(target_url),
                    "associated_weeks": deck_info.get("associated_weeks", []),
                    "associated_record_ids": deck_info.get("associated_record_ids", []),
                })

            walk_for_link_urls(element, generic_urls)

        for raw_url in generic_urls:
            target_url = clean_url(raw_url)
            key = (idx, target_url, "")
            if key in seen:
                continue
            seen.add(key)
            source_type = classify_url(target_url, "")
            records.append({
                "link_id": link_id(deck_id, idx, target_url, ""),
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
            })

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


def redact_text(text: str, limit: int = 180) -> str:
    cleaned = EMAIL_RE.sub("[email]", normalize_space(text))
    return cleaned[:limit]


def extract_numbers_from_text(text: str, limit: int = 40) -> List[str]:
    matches = re.findall(r"\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b", text or "")
    return list(dict.fromkeys(matches))[:limit]


def fetch_google_sheet_csv(session: requests.Session, spreadsheet_id: str, timeout: int = 60) -> Tuple[int, str, str]:
    params = {"mimeType": "text/csv"}
    resp = session.get(DRIVE_EXPORT_URL.format(file_id=spreadsheet_id), params=params, timeout=timeout)
    return resp.status_code, resp.text, resp.headers.get("content-type", "")


def summarize_csv(csv_text: str, include_rows: bool, max_rows: int, max_columns: int) -> Dict[str, Any]:
    rows: List[List[str]] = []
    reader = csv.reader(io.StringIO(csv_text))
    for row in reader:
        rows.append(row[:max_columns])
        if len(rows) >= max_rows:
            break

    headers = [normalize_space(c)[:120] for c in rows[0]] if rows else []
    body = rows[1:] if len(rows) > 1 else []
    joined = "\n".join(" | ".join(row) for row in rows)
    summary = {
        "sampled_row_count": len(rows),
        "sampled_column_count": max((len(r) for r in rows), default=0),
        "headers": headers,
        "numeric_values": extract_numbers_from_text(joined),
        "text_excerpt": redact_text(joined, limit=1200),
    }
    if include_rows:
        summary["sample_rows"] = [
            [redact_text(cell, limit=120) for cell in row]
            for row in body[: min(5, len(body))]
        ]
    return summary


def smoke_fetch_google_sheets(
    links: List[Dict[str, Any]],
    access_token: str,
    max_fetches: int,
    include_rows: bool,
    max_rows: int,
    max_columns: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {access_token}"})
    fetches: List[Dict[str, Any]] = []
    evidence: List[Dict[str, Any]] = []
    attempted = 0
    seen_sheets = set()

    for link in links:
        if link.get("source_type") != "google_sheet":
            continue
        spreadsheet_id = link.get("google_file_id")
        if not spreadsheet_id or spreadsheet_id in seen_sheets:
            continue
        if attempted >= max_fetches:
            fetches.append({
                "link_id": link.get("link_id"),
                "source_type": "google_sheet",
                "status": "skipped_limit",
                "spreadsheet_id": spreadsheet_id,
                "source_url": link.get("target_url"),
            })
            continue
        seen_sheets.add(spreadsheet_id)
        attempted += 1
        fetch: Dict[str, Any] = {
            "link_id": link.get("link_id"),
            "source_type": "google_sheet",
            "spreadsheet_id": spreadsheet_id,
            "source_url": link.get("target_url"),
            "deck_file_id": link.get("deck_file_id"),
            "slide_number": link.get("slide_number"),
            "link_text": link.get("link_text"),
        }
        try:
            status_code, body, content_type = fetch_google_sheet_csv(session, spreadsheet_id)
            fetch["http_status"] = status_code
            fetch["content_type"] = content_type
            if status_code >= 400:
                fetch["status"] = "error"
                fetch["error"] = redact_text(body, limit=500)
            else:
                csv_summary = summarize_csv(body, include_rows=include_rows, max_rows=max_rows, max_columns=max_columns)
                fetch["status"] = "success"
                fetch.update(csv_summary)
                evidence.append({
                    "source_type": "google_sheet_csv_smoke",
                    "link_id": link.get("link_id"),
                    "deck_file_id": link.get("deck_file_id"),
                    "deck_title": link.get("deck_title"),
                    "slide_number": link.get("slide_number"),
                    "link_text": link.get("link_text"),
                    "source_url": link.get("target_url"),
                    "associated_weeks": link.get("associated_weeks", []),
                    "associated_record_ids": link.get("associated_record_ids", []),
                    "headers": csv_summary.get("headers", []),
                    "numeric_values": csv_summary.get("numeric_values", []),
                    "text_excerpt": csv_summary.get("text_excerpt", ""),
                    "sampled_row_count": csv_summary.get("sampled_row_count", 0),
                    "sampled_column_count": csv_summary.get("sampled_column_count", 0),
                })
        except Exception as exc:
            fetch["status"] = "error"
            fetch["error"] = f"{exc.__class__.__name__}:{exc}"
        fetches.append(fetch)

    return fetches, evidence


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


def write_aliases(data_dir: Path, name: str, payload: Any) -> None:
    write_json(data_dir / name, payload)
    write_json(data_dir / name.replace("_", "-"), payload)


def cli() -> None:
    ap = argparse.ArgumentParser(description="Discover evidence links inside fetched Google Slides metadata and smoke-test Google Sheet access")
    ap.add_argument("--data-dir", required=True, help="Directory containing deck_details.json")
    ap.add_argument("--artifact-dir", required=True, help="Directory containing fetched Slides metadata JSON files")
    ap.add_argument("--access-token", default=None, help="OAuth bearer token with Drive/Slides read scopes")
    ap.add_argument("--client-id", default=None, help="OAuth client ID used with refresh-token flow")
    ap.add_argument("--client-secret", default=None, help="OAuth client secret used with refresh-token flow")
    ap.add_argument("--refresh-token", default=None, help="OAuth refresh token used to mint a fresh access token")
    ap.add_argument("--service-account-json", default=None, help="Path to service account JSON for server-to-server auth")
    ap.add_argument("--subject", default=None, help="Optional user email for domain-wide delegation impersonation")
    ap.add_argument("--limit", type=int, default=None, help="Accepted for build compatibility; link extraction uses all local metadata files")
    ap.add_argument("--max-google-sheet-fetches", type=int, default=int(os.environ.get("EXTERNAL_EVIDENCE_SHEET_FETCH_LIMIT", "8")))
    ap.add_argument("--max-rows", type=int, default=int(os.environ.get("EXTERNAL_EVIDENCE_SMOKE_MAX_ROWS", "40")))
    ap.add_argument("--max-columns", type=int, default=int(os.environ.get("EXTERNAL_EVIDENCE_SMOKE_MAX_COLUMNS", "16")))
    ap.add_argument("--include-rows", action="store_true", default=os.environ.get("EXTERNAL_EVIDENCE_SMOKE_INCLUDE_ROWS", "0") == "1", help="Store up to five redacted sample rows. Off by default.")
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    artifact_dir = Path(args.artifact_dir)
    deck_details = load_json(data_dir / "deck_details.json") if (data_dir / "deck_details.json").exists() else []
    by_deck = associated_map(deck_details)

    links: List[Dict[str, Any]] = []
    for meta_path in sorted(artifact_dir.glob("*.json")):
        if meta_path.name.startswith("google_fetch_manifest"):
            continue
        deck_info = by_deck.get(meta_path.stem, {})
        links.extend(extract_links_from_metadata(meta_path, deck_info))
    links = dedupe_links(links)

    link_payload = {
        "generated_at": utc_now(),
        "artifact_dir": str(artifact_dir),
        "summary": summarize_links(links),
        "links": links,
    }

    fetches: List[Dict[str, Any]] = []
    evidence: List[Dict[str, Any]] = []
    try:
        access_token = resolve_access_token(args)
        fetches, evidence = smoke_fetch_google_sheets(
            links=links,
            access_token=access_token,
            max_fetches=args.max_google_sheet_fetches,
            include_rows=args.include_rows,
            max_rows=args.max_rows,
            max_columns=args.max_columns,
        )
    except Exception as exc:
        fetches.append({
            "status": "auth_or_fetch_setup_error",
            "error": f"{exc.__class__.__name__}:{exc}",
        })

    fetch_status = {
        "generated_at": utc_now(),
        "summary": {
            "attempted_count": len([f for f in fetches if f.get("status") not in {"skipped_limit"}]),
            "success_count": len([f for f in fetches if f.get("status") == "success"]),
            "error_count": len([f for f in fetches if str(f.get("status", "")).startswith("error") or f.get("status") == "auth_or_fetch_setup_error"]),
            "skipped_limit_count": len([f for f in fetches if f.get("status") == "skipped_limit"]),
            "google_sheet_link_count": len([l for l in links if l.get("source_type") == "google_sheet"]),
            "helio_link_count": len([l for l in links if str(l.get("source_type", "")).startswith("helio")]),
        },
        "fetches": fetches,
    }

    evidence_payload = {
        "generated_at": utc_now(),
        "source": "deck_link_smoke",
        "note": "Discovery artifact. Google Sheet rows are summarized conservatively; Helio links are inventoried but not fetched.",
        "evidence_count": len(evidence),
        "evidence": evidence,
    }

    write_aliases(data_dir, "deck_links.json", link_payload)
    write_aliases(data_dir, "deck_link_fetch_status.json", fetch_status)
    write_aliases(data_dir, "external_research_evidence_smoke.json", evidence_payload)

    print(json.dumps({
        "deck_link_count": link_payload["summary"]["link_count"],
        "by_source_type": link_payload["summary"].get("by_source_type", {}),
        "sheet_fetch_summary": fetch_status["summary"],
        "outputs": [
            str(data_dir / "deck_links.json"),
            str(data_dir / "deck_link_fetch_status.json"),
            str(data_dir / "external_research_evidence_smoke.json"),
        ],
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cli()
