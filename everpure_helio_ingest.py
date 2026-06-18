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
    REST API (Enterprise; `X-API-ID`/`X-API-TOKEN`). Built in a follow-up once the
    response shape is confirmed against live keys (scripts/helio_api_probe.py).

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
from collections import defaultdict
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

# Public REST API base (Enterprise; X-API-ID / X-API-TOKEN). Probed 2026-06: it
# serves test CONFIG only (GET /tests, GET /tests/:id). The per-response/score
# route GET /tests/:id/responses TIMES OUT on Helio's origin (504) regardless of
# pagination or section scoping, and /results /insights /sections return 406. So
# deep response/score data is NOT fetchable via the public API today — Tier B is
# limited to config/integrity provenance (sample size + question count). Revisit
# if Helio fixes /responses or publishes API docs. Deep data otherwise needs the
# private app API (session auth) or a manual export.
HELIO_API_BASE = "https://my.helio.app/api/public"

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
    for idx, (take_id, report_id) in enumerate(report_map):
        name = names[idx] if idx < len(names) else f"Variant {idx + 1}"
        take_name[take_id] = name
        variants.append(
            {
                "take_id": take_id,
                "report_id": report_id,
                "name": name,
                "thumbnail": thumbs.get(take_id) or fulls.get(take_id) or None,
            }
        )

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
    # from the public API (config only). Non-blocking; skipped without keys.
    config_statuses: List[Dict[str, Any]] = []
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
        },
    )

    print(json.dumps({"helio_summary": summary, "augmentation": augment_summary}, indent=2))


if __name__ == "__main__":
    main()
