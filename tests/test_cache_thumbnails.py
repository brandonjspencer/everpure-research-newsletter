"""Unit tests for the committed Helio thumbnail cache (scripts/cache_helio_thumbnails.py).

The fetch is injected so no live request is made: a fake fetch returns real PNG
bytes (compressed by Pillow), and the cache-reuse path asserts no fetch happens.
"""

import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cache_helio_thumbnails as cht  # noqa: E402


def _png_bytes(w=300, h=200):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 100, 50)).save(buf, "PNG")
    return buf.getvalue()


def _write_trends(root, thumbs):
    p = root / "publish" / "data" / "trends.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = [{"test_id": f"t{i}", "thumbnail": t} for i, t in enumerate(thumbs)]
    p.write_text(json.dumps({"helio_metrics": rows}), "utf-8")
    return p


def _quiet(*_a, **_k):
    pass


def test_asset_id_extracts_ulid_or_none():
    assert (
        cht.asset_id("https://assets.helio.app/asset/01ABCXYZ/medium_x.png?Expires=1") == "01ABCXYZ"
    )
    assert cht.asset_id("https://example.com/no-asset.png") is None
    assert cht.asset_id(None) is None


def test_download_compresses_and_localizes(tmp_path):
    url = "https://assets.helio.app/asset/01AAA/medium_x.png?Expires=1&Signature=z"
    trends = _write_trends(tmp_path, [url])
    stats = cht.localize_thumbnails(tmp_path, fetch=lambda _u: _png_bytes(), log=_quiet)
    assert stats["downloaded"] == 1 and stats["failed"] == 0
    # Committed cache + served copy both written, as WebP.
    cached = tmp_path / "assets" / "helio_thumbnails" / "01AAA.webp"
    served = tmp_path / "publish" / "data" / "thumbnails" / "01AAA.webp"
    assert cached.exists() and served.exists()
    assert Image.open(cached).format == "WEBP"
    # trends.json rewritten to the local relative path.
    assert (
        json.loads(trends.read_text())["helio_metrics"][0]["thumbnail"]
        == "data/thumbnails/01AAA.webp"
    )


def test_cached_asset_is_reused_without_fetching(tmp_path):
    # A previously-cached asset must be reused even when its URL has expired — the
    # whole point: no fetch, survives expiry.
    aid = "01BBB"
    cache = tmp_path / "assets" / "helio_thumbnails"
    cache.mkdir(parents=True)
    Image.new("RGB", (10, 10), (0, 0, 0)).save(cache / f"{aid}.webp", "WEBP")
    url = f"https://assets.helio.app/asset/{aid}/m.png?Expires=1"
    trends = _write_trends(tmp_path, [url])

    def boom(_u):
        raise AssertionError("must not fetch an already-cached asset")

    stats = cht.localize_thumbnails(tmp_path, fetch=boom, log=_quiet)
    assert stats["cached"] == 1 and stats["downloaded"] == 0
    assert (
        json.loads(trends.read_text())["helio_metrics"][0]["thumbnail"]
        == f"data/thumbnails/{aid}.webp"
    )


def test_failed_fetch_leaves_url_untouched(tmp_path):
    url = "https://assets.helio.app/asset/01CCC/m.png?Expires=1"
    trends = _write_trends(tmp_path, [url])

    def boom(_u):
        raise RuntimeError("403 expired")

    stats = cht.localize_thumbnails(tmp_path, fetch=boom, log=_quiet)
    assert stats["failed"] == 1
    # Original reference preserved → render still tries it + onerror fallback applies.
    assert json.loads(trends.read_text())["helio_metrics"][0]["thumbnail"] == url


def test_unparseable_url_is_skipped(tmp_path):
    url = "https://example.com/no-asset-id.png"
    trends = _write_trends(tmp_path, [url])
    stats = cht.localize_thumbnails(tmp_path, fetch=lambda _u: _png_bytes(), log=_quiet)
    assert stats["skipped"] == 1 and stats["downloaded"] == 0
    assert json.loads(trends.read_text())["helio_metrics"][0]["thumbnail"] == url


def test_missing_trends_is_a_noop(tmp_path):
    stats = cht.localize_thumbnails(tmp_path, fetch=lambda _u: _png_bytes(), log=_quiet)
    assert stats == {"cached": 0, "downloaded": 0, "failed": 0, "skipped": 0}
