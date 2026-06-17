#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from everpure_api import EverpureStore, build_newsletter_pack  # type: ignore
from everpure_notion_api import (  # type: ignore
    fetch_record_map,
    page_id_from_url,
    record_map_to_html,
)
from everpure_parser import parse_html  # type: ignore

NOTION_BLOCK_HINT = "data-block-id"
DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class FetchError(RuntimeError):
    pass


class NotionFetcher:
    def __init__(self, timeout: int = 180):
        self.timeout = timeout

    def fetch(self, url: str, method: str = "auto") -> Dict[str, Any]:
        method = (method or "auto").lower()
        attempts = []

        if method == "auto":
            ordered_methods = ["notion_api", "playwright", "requests"]
        else:
            ordered_methods = [method]

        for candidate in ordered_methods:
            if candidate == "notion_api":
                try:
                    html = self._fetch_notion_api(url)
                    attempts.append("notion_api")
                    if self._looks_like_rendered_notion(html):
                        return {"html": html, "method": "notion_api", "attempts": attempts}
                    attempts.append("notion_api_unrendered")
                except Exception as exc:
                    attempts.append(f"notion_api_failed:{exc.__class__.__name__}:{exc}")
                    if method == "notion_api":
                        raise
            elif candidate == "requests":
                try:
                    html = self._fetch_requests(url)
                    attempts.append("requests")
                    if self._looks_like_rendered_notion(html):
                        return {"html": html, "method": "requests", "attempts": attempts}
                    attempts.append("requests_unrendered")
                except Exception as exc:
                    attempts.append(f"requests_failed:{exc.__class__.__name__}:{exc}")
                    if method == "requests":
                        raise
            elif candidate == "playwright":
                try:
                    html = self._fetch_playwright(url)
                    attempts.append("playwright")
                    if self._looks_like_rendered_notion(html):
                        return {"html": html, "method": "playwright", "attempts": attempts}
                    attempts.append("playwright_unrendered")
                except Exception as exc:
                    attempts.append(f"playwright_failed:{exc.__class__.__name__}:{exc}")
                    if method == "playwright":
                        raise
            else:
                raise FetchError(f"Unsupported fetch method: {candidate}")

        raise FetchError("Unable to fetch a rendered Notion page. Attempts: " + ", ".join(attempts))

    def _fetch_notion_api(self, url: str) -> str:
        # Primary path: pull the page as structured blocks from Notion's public
        # loadPageChunk JSON API (no browser) and render into parser-ready HTML.
        # The API timeout is capped (per-request) rather than the long browser
        # timeout, since pagination already retries on 429/5xx.
        api_timeout = min(self.timeout, 30)
        blocks = fetch_record_map(url, timeout=api_timeout)
        return record_map_to_html(blocks, page_id_from_url(url))

    def _fetch_requests(self, url: str) -> str:
        headers = {
            "User-Agent": DEFAULT_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }
        resp = requests.get(url, headers=headers, timeout=self.timeout)
        resp.raise_for_status()
        return resp.text

    def _fetch_playwright(self, url: str) -> str:
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as exc:
            raise FetchError(
                "Playwright is not installed. Install with: pip install playwright && python -m playwright install chromium"
            ) from exc

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-dev-shm-usage", "--no-sandbox"],
            )
            context = browser.new_context(
                user_agent=DEFAULT_UA,
                viewport={"width": 1440, "height": 3200},
                java_script_enabled=True,
                locale="en-US",
            )
            page = context.new_page()
            page.set_default_timeout(self.timeout * 1000)

            # Reduce Notion background churn so the DOM can settle in GitHub Actions.
            try:
                page.route(
                    "**/*",
                    lambda route: (
                        route.abort()
                        if route.request.resource_type in ["image", "media", "font"]
                        else route.continue_()
                    ),
                )
            except Exception:
                pass

            try:
                # Notion is brittle in GitHub Actions when waiting for load or
                # domcontentloaded. Commit starts navigation; the selector and
                # validation checks below determine whether the content is usable.
                page.goto(url, wait_until="commit", timeout=self.timeout * 1000)
            except Exception as exc:
                if exc.__class__.__name__ != "TimeoutError":
                    context.close()
                    browser.close()
                    raise

            page.wait_for_timeout(15000)

            try:
                page.wait_for_selector(f"[{NOTION_BLOCK_HINT}]", timeout=60000)
            except Exception:
                page.wait_for_timeout(12000)

            for _ in range(8):
                try:
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                except Exception:
                    pass
                page.wait_for_timeout(2000)

            try:
                page.evaluate("window.stop && window.stop()")
            except Exception:
                pass
            page.wait_for_timeout(3000)

            html = ""
            last_exc = None

            for _ in range(6):
                try:
                    html = page.evaluate(
                        "document.documentElement ? document.documentElement.outerHTML : ''"
                    )
                    if html and len(html) > 1000:
                        break
                except Exception as exc:
                    last_exc = exc
                    page.wait_for_timeout(2500)

            if not html:
                for _ in range(4):
                    try:
                        html = page.content()
                        if html and len(html) > 1000:
                            break
                    except Exception as exc:
                        last_exc = exc
                        page.wait_for_timeout(2500)

            context.close()
            browser.close()

            if not html:
                raise FetchError(
                    f"Playwright rendered page but could not retrieve HTML content: {last_exc}"
                )

            return html

    def _looks_like_rendered_notion(self, html: str) -> bool:
        if not html:
            return False
        block_count = html.count(NOTION_BLOCK_HINT)
        has_research_hint = (
            "Weekly Rundown" in html
            or "View Findings Deck" in html
            or "Findings Deck" in html
            or "Research" in html
            or "📌" in html
        )
        return block_count >= 5 and has_research_hint


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def read_text(path: Path) -> str:
    with path.open("r", encoding="utf-8") as f:
        return f.read()


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def existing_parsed_outputs_available(output_dir: Path) -> bool:
    required = ["metadata.json", "weeks.json", "decks.json", "summary.json"]
    return all((output_dir / name).is_file() for name in required)


def build_manifest_from_existing_outputs(
    output_dir: Path,
    source_url: Optional[str],
    raw_dir: Optional[Path],
    since: Optional[str],
    until: Optional[str],
    fetch_method: str,
    fetch_error: Exception,
) -> Dict[str, Any]:
    if not existing_parsed_outputs_available(output_dir):
        raise fetch_error

    if until is None:
        until = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")

    # Rebuild the newsletter pack from the last committed/generated parsed data.
    store = EverpureStore(str(output_dir))
    newsletter_pack = build_newsletter_pack(store, since=since, until=until)
    write_json(output_dir / "newsletter_pack_90d.json", newsletter_pack)

    weeks = read_json(output_dir / "weeks.json")
    decks = read_json(output_dir / "decks.json")
    summary = read_json(output_dir / "summary.json")

    snapshot_candidates = []
    if raw_dir and raw_dir.exists():
        snapshot_candidates = sorted(raw_dir.glob("everpure_snapshot_*.html"))
    source_html_path = str(snapshot_candidates[-1].resolve()) if snapshot_candidates else None

    manifest = {
        "generated_at": utc_now(),
        "source": {
            "source_url": source_url,
            "source_html_path": source_html_path,
            "fetch_method": "fallback_existing_outputs",
            "requested_fetch_method": fetch_method,
            "fetched_at": utc_now(),
            "source_fallback": "existing_outputs",
            "fallback_reason": f"{fetch_error.__class__.__name__}: {fetch_error}",
            "fallback_warning": "Live Notion fetch failed; build reused the existing parsed source outputs committed/generated in publish/data.",
        },
        "outputs": {
            key: str((output_dir / f"{key}.json").resolve())
            for key in ("metadata", "weeks", "decks", "summary")
        },
        "newsletter_pack_90d": str((output_dir / "newsletter_pack_90d.json").resolve()),
        "record_count": len(weeks),
        "deck_count": len(decks),
        "date_range": summary.get("date_range", {}),
        "source_fallback": "existing_outputs",
    }
    write_json(output_dir / "refresh_manifest.json", manifest)
    return manifest


def refresh_pipeline(
    source_url: Optional[str],
    html_path: Optional[Path],
    output_dir: Path,
    raw_dir: Optional[Path],
    since: Optional[str],
    until: Optional[str],
    fetch_method: str,
) -> Dict[str, Any]:
    source_html_path: Optional[Path] = None
    fetch_meta: Dict[str, Any] = {
        "source_url": source_url,
        "source_html_path": None,
        "fetch_method": None,
        "fetched_at": utc_now(),
    }

    if html_path is not None:
        html = read_text(html_path)
        source_html_path = html_path
        fetch_meta["source_html_path"] = str(html_path)
        fetch_meta["fetch_method"] = "local_html"
    elif source_url:
        timeout = int(os.environ.get("NOTION_FETCH_TIMEOUT", "180"))
        allow_fallback = os.environ.get("ALLOW_SOURCE_FALLBACK", "1").lower() not in {
            "0",
            "false",
            "no",
        }
        fetcher = NotionFetcher(timeout=timeout)
        try:
            fetched = fetcher.fetch(source_url, method=fetch_method)
        except Exception as exc:
            if allow_fallback and existing_parsed_outputs_available(output_dir):
                return build_manifest_from_existing_outputs(
                    output_dir=output_dir,
                    source_url=source_url,
                    raw_dir=raw_dir,
                    since=since,
                    until=until,
                    fetch_method=fetch_method,
                    fetch_error=exc,
                )
            raise

        html = fetched["html"]
        fetch_meta["fetch_method"] = fetched["method"]
        fetch_meta["fetch_attempts"] = fetched.get("attempts", [])
        if raw_dir is not None:
            raw_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            source_html_path = raw_dir / f"everpure_snapshot_{ts}.html"
            source_html_path.write_text(html, encoding="utf-8")
            fetch_meta["source_html_path"] = str(source_html_path)
    else:
        raise ValueError("Provide either source_url or html_path")

    parsed = parse_html(html)
    output_dir.mkdir(parents=True, exist_ok=True)
    for key in ("metadata", "weeks", "decks", "summary"):
        write_json(output_dir / f"{key}.json", parsed[key])

    if until is None:
        until = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")

    store = EverpureStore(str(output_dir))
    newsletter_pack = build_newsletter_pack(store, since=since, until=until)
    write_json(output_dir / "newsletter_pack_90d.json", newsletter_pack)

    manifest = {
        "generated_at": utc_now(),
        "source": fetch_meta,
        "outputs": {
            key: str((output_dir / f"{key}.json").resolve())
            for key in ("metadata", "weeks", "decks", "summary")
        },
        "newsletter_pack_90d": str((output_dir / "newsletter_pack_90d.json").resolve()),
        "record_count": len(parsed["weeks"]),
        "deck_count": len(parsed["decks"]),
        "date_range": parsed["summary"].get("date_range", {}),
    }
    write_json(output_dir / "refresh_manifest.json", manifest)
    return manifest


def cli() -> None:
    ap = argparse.ArgumentParser(
        description="Fetch and refresh Everpure Notion-derived JSON outputs"
    )
    ap.add_argument("--source-url", default=None, help="Public Notion URL to fetch")
    ap.add_argument(
        "--html-path", default=None, help="Use an existing HTML snapshot instead of fetching"
    )
    ap.add_argument("--output-dir", default="output", help="Directory for normalized outputs")
    ap.add_argument("--raw-dir", default="raw", help="Directory for fetched HTML snapshots")
    ap.add_argument("--since", default=None, help="Newsletter pack start date (YYYY-MM-DD)")
    ap.add_argument("--until", default=None, help="Newsletter pack end date (YYYY-MM-DD)")
    ap.add_argument(
        "--fetch-method",
        default=os.environ.get("NOTION_FETCH_METHOD", "auto"),
        choices=["auto", "notion_api", "requests", "playwright"],
        help="Fetcher backend",
    )
    args = ap.parse_args()

    manifest = refresh_pipeline(
        source_url=args.source_url,
        html_path=Path(args.html_path) if args.html_path else None,
        output_dir=Path(args.output_dir),
        raw_dir=Path(args.raw_dir) if args.raw_dir else None,
        since=args.since,
        until=args.until,
        fetch_method=args.fetch_method,
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    cli()
