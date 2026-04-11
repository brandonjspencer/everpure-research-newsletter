#!/usr/bin/env python3
import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from everpure_parser import parse_html  # type: ignore
from everpure_api import build_newsletter_pack, EverpureStore  # type: ignore

NOTION_BLOCK_HINT = 'data-block-id'
DEFAULT_UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/123.0.0.0 Safari/537.36'
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class FetchError(RuntimeError):
    pass


class NotionFetcher:
    def __init__(self, timeout: int = 45):
        self.timeout = timeout

    def fetch(self, url: str, method: str = 'auto') -> Dict[str, Any]:
        method = method.lower()
        attempts = []

        # For hosted environments, browser rendering is usually the reliable path.
        ordered_methods = []
        if method == 'auto':
            ordered_methods = ['playwright', 'requests']
        else:
            ordered_methods = [method]

        for candidate in ordered_methods:
            if candidate == 'requests':
                try:
                    html = self._fetch_requests(url)
                    attempts.append('requests')
                    if self._looks_like_rendered_notion(html):
                        return {'html': html, 'method': 'requests', 'attempts': attempts}
                    attempts.append('requests_unrendered')
                except Exception as exc:
                    attempts.append(f'requests_failed:{exc.__class__.__name__}:{exc}')
                    if method == 'requests':
                        raise
            elif candidate == 'playwright':
                try:
                    html = self._fetch_playwright(url)
                    attempts.append('playwright')
                    if self._looks_like_rendered_notion(html):
                        return {'html': html, 'method': 'playwright', 'attempts': attempts}
                    attempts.append('playwright_unrendered')
                except Exception as exc:
                    attempts.append(f'playwright_failed:{exc.__class__.__name__}:{exc}')
                    if method == 'playwright':
                        raise
            else:
                raise FetchError(f'Unsupported fetch method: {candidate}')

        raise FetchError('Unable to fetch a rendered Notion page. Attempts: ' + ', '.join(attempts))

    def _fetch_requests(self, url: str) -> str:
        headers = {
            'User-Agent': DEFAULT_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        }
        resp = requests.get(url, headers=headers, timeout=self.timeout)
        resp.raise_for_status()
        return resp.text

    def _fetch_playwright(self, url: str) -> str:
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except Exception as exc:
            raise FetchError('Playwright is not installed. Install with: pip install playwright && python -m playwright install chromium') from exc

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=DEFAULT_UA,
                viewport={'width': 1440, 'height': 2200},
                java_script_enabled=True,
                locale='en-US',
            )
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded', timeout=self.timeout * 1000)
            page.wait_for_timeout(4000)
            try:
                page.wait_for_selector(f'[{NOTION_BLOCK_HINT}]', timeout=25000)
            except Exception:
                page.wait_for_timeout(5000)
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            page.wait_for_timeout(2000)
            html = page.content()
            context.close()
            browser.close()
            return html

    @staticmethod
    def _looks_like_rendered_notion(html: str) -> bool:
        block_count = html.count(NOTION_BLOCK_HINT)
        return block_count >= 20 and ('Weekly Rundown' in html or '📌' in html or 'View Findings Deck' in html)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def read_text(path: Path) -> str:
    with path.open('r', encoding='utf-8') as f:
        return f.read()


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
    fetch_meta: Dict[str, Any] = {'source_url': source_url, 'source_html_path': None, 'fetch_method': None, 'fetched_at': utc_now()}

    if html_path is not None:
        html = read_text(html_path)
        source_html_path = html_path
        fetch_meta['source_html_path'] = str(html_path)
        fetch_meta['fetch_method'] = 'local_html'
    elif source_url:
        fetcher = NotionFetcher()
        fetched = fetcher.fetch(source_url, method=fetch_method)
        html = fetched['html']
        fetch_meta['fetch_method'] = fetched['method']
        fetch_meta['fetch_attempts'] = fetched.get('attempts', [])
        if raw_dir is not None:
            raw_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            source_html_path = raw_dir / f'everpure_snapshot_{ts}.html'
            source_html_path.write_text(html, encoding='utf-8')
            fetch_meta['source_html_path'] = str(source_html_path)
    else:
        raise ValueError('Provide either source_url or html_path')

    parsed = parse_html(html)
    output_dir.mkdir(parents=True, exist_ok=True)
    for key in ('metadata', 'weeks', 'decks', 'summary'):
        write_json(output_dir / f'{key}.json', parsed[key])

    if until is None:
        until = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    if since is None:
        since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime('%Y-%m-%d')

    store = EverpureStore(str(output_dir))
    newsletter_pack = build_newsletter_pack(store, since=since, until=until)
    write_json(output_dir / 'newsletter_pack_90d.json', newsletter_pack)

    manifest = {
        'generated_at': utc_now(),
        'source': fetch_meta,
        'outputs': {
            key: str((output_dir / f'{key}.json').resolve())
            for key in ('metadata', 'weeks', 'decks', 'summary')
        },
        'newsletter_pack_90d': str((output_dir / 'newsletter_pack_90d.json').resolve()),
        'record_count': len(parsed['weeks']),
        'deck_count': len(parsed['decks']),
        'date_range': parsed['summary'].get('date_range', {}),
    }
    write_json(output_dir / 'refresh_manifest.json', manifest)
    return manifest


def cli() -> None:
    ap = argparse.ArgumentParser(description='Fetch and refresh Everpure Notion-derived JSON outputs')
    ap.add_argument('--source-url', default=None, help='Public Notion URL to fetch')
    ap.add_argument('--html-path', default=None, help='Use an existing HTML snapshot instead of fetching')
    ap.add_argument('--output-dir', default='/mnt/data/everpure_parsed', help='Directory for normalized outputs')
    ap.add_argument('--raw-dir', default='/mnt/data/everpure_raw', help='Directory for fetched HTML snapshots')
    ap.add_argument('--since', default=None, help='Newsletter pack start date (YYYY-MM-DD)')
    ap.add_argument('--until', default=None, help='Newsletter pack end date (YYYY-MM-DD)')
    ap.add_argument('--fetch-method', default=os.environ.get('NOTION_FETCH_METHOD', 'auto'), choices=['auto', 'requests', 'playwright'], help='Fetcher backend')
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


if __name__ == '__main__':
    cli()
