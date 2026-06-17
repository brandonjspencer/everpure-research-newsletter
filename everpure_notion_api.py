#!/usr/bin/env python3
"""Robust Notion public-API fetch for the Everpure research page.

The notion.site page renders client-side, which makes a browser-based scrape
(Playwright) brittle. Notion's public ``/api/v3/loadPageChunk`` endpoint returns
the same page as a structured ``recordMap`` of blocks with no browser required.

This module:
  * derives the page UUID from a notion.site URL,
  * paginates ``loadPageChunk`` (with retry/backoff on 429/5xx/timeouts),
  * renders the merged block map back into the rendered-DOM HTML shape that
    ``everpure_parser.parse_html`` already consumes.

Rendering contract (matches everpure_parser):
  * every block becomes
    ``<div data-block-id="{id}" class="notion-{type}-block">
        <div data-content-editable-leaf="true">{richtext}</div>{children}</div>``
  * rich text escapes segment text and wraps link segments in ``<a href=...>``,
  * images emit ``<img src=...>``,
  * bulleted/numbered lists include a ``pseudoBefore`` span carrying the bullet
    glyph for their list-nesting depth ("•" / "◦" / "▪"),
  * blocks are emitted in DFS (document) order so the parser's linear pass over
    ``find_all(attrs={"data-block-id": True})`` sees the page in reading order.
"""

import html as html_lib
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

LOAD_PAGE_CHUNK_PATH = "/api/v3/loadPageChunk"
CHUNK_LIMIT = 100
MAX_CHUNKS = 30

# List-nesting glyphs, mirrors everpure_parser.extract_list_level ({"•":1,...}).
LIST_GLYPHS = {1: "•", 2: "◦", 3: "▪"}

_HEX32_RE = re.compile(r"[0-9a-fA-F]{32}$")


class NotionApiError(RuntimeError):
    """Raised when the Notion API cannot return a usable record map."""


def page_id_from_url(url: str) -> str:
    """Return the dashed page UUID (8-4-4-4-12) from a notion.site URL.

    The id is the trailing 32 hex characters of the page path; Notion slugifies
    the title in front of it, e.g.
    ``.../Everpure-1ef2e6d8924e4c3c827a8aa850802295`` -> the last 32 hex chars.
    """
    path = urlparse(url).path or url
    # The id is the trailing 32 hex chars of the (de-dashed) path, after the
    # title slug. Strip query/trailing slash, then take the final hex run.
    candidate = path.rstrip("/").split("/")[-1].replace("-", "")
    match = _HEX32_RE.search(candidate)
    if not match:
        raise NotionApiError(f"Could not extract a Notion page id from URL: {url!r}")
    raw = match.group(0).lower()
    return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"


def _api_endpoint(url: str) -> str:
    parsed = urlparse(url)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc
    if not netloc:
        raise NotionApiError(f"URL has no host to build an API endpoint from: {url!r}")
    return f"{scheme}://{netloc}{LOAD_PAGE_CHUNK_PATH}"


def _retry_after_seconds(resp: "requests.Response", default: float) -> float:
    header = resp.headers.get("Retry-After")
    if not header:
        return default
    try:
        return float(header)
    except (TypeError, ValueError):
        return default


def _post_chunk(
    session: requests.Session,
    endpoint: str,
    page_id: str,
    chunk_number: int,
    cursor: Dict[str, Any],
    timeout: int,
    retries: int,
    backoff: float,
) -> Dict[str, Any]:
    """POST one loadPageChunk request, retrying on 429/5xx/timeouts."""
    body = {
        "pageId": page_id,
        "limit": CHUNK_LIMIT,
        "cursor": cursor,
        "chunkNumber": chunk_number,
        "verticalColumns": False,
    }
    headers = {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/json",
    }

    last_error: Optional[str] = None
    for attempt in range(retries + 1):
        wait = backoff * (2**attempt)
        try:
            resp = session.post(endpoint, json=body, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            last_error = f"{exc.__class__.__name__}: {exc}"
            if attempt < retries:
                time.sleep(wait)
                continue
            raise NotionApiError(
                f"loadPageChunk request failed for chunk {chunk_number}: {last_error}"
            ) from exc

        status = resp.status_code
        if status == 429 or status >= 500:
            last_error = f"HTTP {status}"
            if attempt < retries:
                time.sleep(_retry_after_seconds(resp, wait))
                continue
            raise NotionApiError(
                f"loadPageChunk returned {status} for chunk {chunk_number} after "
                f"{retries + 1} attempts"
            )

        if status != 200:
            raise NotionApiError(
                f"loadPageChunk returned HTTP {status} for chunk {chunk_number}: {resp.text[:200]}"
            )

        try:
            return resp.json()
        except ValueError as exc:
            last_error = f"invalid JSON: {exc}"
            if attempt < retries:
                time.sleep(wait)
                continue
            raise NotionApiError(
                f"loadPageChunk returned non-JSON body for chunk {chunk_number}"
            ) from exc

    raise NotionApiError(f"loadPageChunk exhausted retries for chunk {chunk_number}: {last_error}")


def fetch_record_map(
    url: str,
    *,
    session: Optional[requests.Session] = None,
    timeout: int = 30,
    retries: int = 3,
    backoff: float = 2.0,
) -> Dict[str, Any]:
    """Paginate loadPageChunk and return the merged ``recordMap.block`` map.

    Follows the cursor returned by each chunk (with ``chunkNumber`` incrementing)
    until ``cursor.stack`` is empty, merging every chunk's ``recordMap.block``.
    Retries with exponential backoff (honoring ``Retry-After``) on 429/5xx and
    network/timeout errors. Raises :class:`NotionApiError` on hard failure or an
    empty result.
    """
    page_id = page_id_from_url(url)
    endpoint = _api_endpoint(url)
    owns_session = session is None
    session = session or requests.Session()

    blocks: Dict[str, Any] = {}
    cursor: Dict[str, Any] = {"stack": []}
    chunk_number = 0

    try:
        for _ in range(MAX_CHUNKS):
            payload = _post_chunk(
                session=session,
                endpoint=endpoint,
                page_id=page_id,
                chunk_number=chunk_number,
                cursor=cursor,
                timeout=timeout,
                retries=retries,
                backoff=backoff,
            )
            record_map = payload.get("recordMap") or {}
            chunk_blocks = record_map.get("block") or {}
            if isinstance(chunk_blocks, dict):
                blocks.update(chunk_blocks)

            next_cursor = payload.get("cursor") or {}
            stack = next_cursor.get("stack") if isinstance(next_cursor, dict) else None
            if not stack:
                break
            cursor = next_cursor
            chunk_number += 1
        else:
            # Loop exhausted MAX_CHUNKS without an empty stack; use what we have.
            pass
    finally:
        if owns_session:
            session.close()

    if not blocks:
        raise NotionApiError(
            f"loadPageChunk returned an empty record map for page {page_id} ({url!r})"
        )
    return blocks


def _block_value(wrapper: Any) -> Optional[Dict[str, Any]]:
    """Unwrap a record-map entry to the block dict.

    Entries are double-nested (``wrapper["value"]["value"]``) in the public API;
    handle the single-nested shape defensively too.
    """
    if not isinstance(wrapper, dict):
        return None
    value = wrapper.get("value")
    if isinstance(value, dict):
        inner = value.get("value")
        if isinstance(inner, dict):
            return inner
        return value
    return None


def _render_rich_text(title: Any) -> str:
    """Render a Notion rich-text array to escaped HTML.

    Each segment is ``[text]`` or ``[text, [[deco, ...], ...]]``. A link is the
    decoration ``["a", "https://..."]``; we wrap such segments in an anchor.
    """
    if not isinstance(title, list):
        return ""
    parts: List[str] = []
    for segment in title:
        if not isinstance(segment, list) or not segment:
            continue
        text = segment[0]
        if not isinstance(text, str):
            text = "" if text is None else str(text)
        escaped = html_lib.escape(text)
        href: Optional[str] = None
        if len(segment) > 1 and isinstance(segment[1], list):
            for deco in segment[1]:
                if isinstance(deco, list) and len(deco) >= 2 and deco[0] == "a":
                    href = deco[1]
                    break
        if href:
            parts.append(f'<a href="{html_lib.escape(href, quote=True)}">{escaped}</a>')
        else:
            parts.append(escaped)
    return "".join(parts)


def _image_src(block: Dict[str, Any]) -> Optional[str]:
    fmt = block.get("format") or {}
    src = fmt.get("display_source")
    if src:
        return src
    source = (block.get("properties") or {}).get("source")
    if isinstance(source, list) and source and isinstance(source[0], list) and source[0]:
        return source[0][0]
    return None


def _page_title(blocks: Dict[str, Any], page_id: str) -> str:
    wrapper = blocks.get(page_id)
    block = _block_value(wrapper)
    if block:
        title = (block.get("properties") or {}).get("title")
        rendered = _render_rich_text(title)
        if rendered:
            return rendered
    return "Everpure"


def record_map_to_html(blocks: Dict[str, Any], page_id: str) -> str:
    """Render the merged block map into parser-compatible rendered-DOM HTML.

    DFS from the page block's ordered ``content`` so the emitted document order
    matches reading order. Each block becomes a ``data-block-id`` div carrying a
    ``data-content-editable-leaf`` div with its rich text, plus nested children.
    """
    page_block = _block_value(blocks.get(page_id))
    if not page_block:
        raise NotionApiError(f"Page block {page_id} not present in record map")

    visited: set = set()

    def render(block_id: str, list_depth: int) -> str:
        # Return this block's div (with its DFS-ordered children nested inside).
        # The parser flattens via find_all, so nesting only needs to preserve
        # document order; structural nesting keeps that order intact.
        if not isinstance(block_id, str) or block_id in visited:
            return ""
        visited.add(block_id)
        block = _block_value(blocks.get(block_id))
        if not block:
            return ""

        btype = block.get("type") or "unknown"
        props = block.get("properties") or {}
        is_list = btype in ("bulleted_list", "numbered_list")

        leaf_parts: List[str] = []
        if is_list:
            glyph = LIST_GLYPHS.get(min(max(list_depth, 1), 3), "•")
            leaf_parts.append(
                f'<span class="pseudoBefore" style=\'--pseudoBefore--content: "{glyph}"\'></span>'
            )
        leaf_parts.append(_render_rich_text(props.get("title")))
        if btype == "image":
            src = _image_src(block)
            if src:
                leaf_parts.append(f'<img src="{html_lib.escape(src, quote=True)}" alt="" />')
        leaf_html = "".join(leaf_parts)

        # Lists nest one level deeper; everything else resets to depth 1.
        child_depth = list_depth + 1 if is_list else 1
        children_html = "".join(
            render(child_id, child_depth) for child_id in (block.get("content") or [])
        )

        return (
            f'<div data-block-id="{html_lib.escape(block_id, quote=True)}" '
            f'class="notion-{html_lib.escape(btype, quote=True)}-block">'
            f'<div data-content-editable-leaf="true">{leaf_html}</div>'
            f"{children_html}</div>"
        )

    body = "".join(render(top_id, 1) for top_id in (page_block.get("content") or []))
    title = _page_title(blocks, page_id)
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        f"<title>{title}</title></head><body>{body}</body></html>"
    )
