#!/usr/bin/env python3
"""One-shot probe of the Helio public API to learn its response shape.

Helio's public REST API (helio.app, Enterprise) is documented for *which*
endpoints exist (`GET /api/public/tests`, `GET /api/public/tests/:id`) but NOT
for the JSON they return. Before we build a parser for it, run this once with
your own keys to capture the real shape. It prints a redacted *skeleton* (field
names, types, tiny samples) — never your API keys, and it truncates long strings
so you are not pasting all 100 participant responses.

Usage (keys never leave your machine; nothing is written to disk):

    HELIO_APP_ID=xxxx HELIO_API_TOKEN=yyyy \\
        python3 scripts/helio_api_probe.py [TEST_ID]

TEST_ID defaults to the known June EDC report id. Paste the printed skeleton
back into the chat — it is safe to share (no keys, samples truncated).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import requests

API_BASE = "https://my.helio.app/api/public"
DEFAULT_TEST_ID = "01KSV38T74ZYR3V9E19E6JYJMC"

# Cap how much we print so the pasted output stays small and PII-light.
MAX_STR = 80
MAX_LIST_SAMPLE = 2
MAX_DEPTH = 6


def skeleton(obj: Any, depth: int = 0) -> Any:
    """Structural skeleton: keys + types + short samples, no bulk data."""
    if depth >= MAX_DEPTH:
        return "…(max depth)"
    if isinstance(obj, dict):
        return {k: skeleton(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        head = [skeleton(v, depth + 1) for v in obj[:MAX_LIST_SAMPLE]]
        return {"<list len>": len(obj), "<sample>": head}
    if isinstance(obj, str):
        s = obj if len(obj) <= MAX_STR else obj[:MAX_STR] + f"…(+{len(obj) - MAX_STR})"
        return f"str: {s!r}"
    if isinstance(obj, bool):
        return f"bool: {obj}"
    if isinstance(obj, (int, float)):
        # Numbers are the data we want (scores/percentages) — show them.
        return f"num: {obj}"
    if obj is None:
        return "null"
    return f"{type(obj).__name__}"


def call(session: requests.Session, url: str) -> None:
    print(f"\n=== GET {url} ===")
    try:
        resp = session.get(url, timeout=60)
    except Exception as exc:  # noqa: BLE001 - probe is best-effort
        print(f"  request error: {exc.__class__.__name__}: {exc}")
        return
    print(f"  status: {resp.status_code}  content-type: {resp.headers.get('content-type')}")
    if resp.status_code != 200:
        print(f"  body (first 300 chars): {resp.text[:300]!r}")
        return
    try:
        data = resp.json()
    except ValueError:
        print(f"  non-JSON body (first 300 chars): {resp.text[:300]!r}")
        return
    print("  shape:")
    print(json.dumps(skeleton(data), indent=2, ensure_ascii=False)[:6000])


def main() -> int:
    app_id = os.environ.get("HELIO_APP_ID", "").strip()
    token = os.environ.get("HELIO_API_TOKEN", "").strip()
    if not app_id or not token:
        print("Set HELIO_APP_ID and HELIO_API_TOKEN in the environment first.", file=sys.stderr)
        return 2

    test_id = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEST_ID).strip()

    session = requests.Session()
    # Send the documented headers; the official Ruby gem also mirrors the token
    # as a Bearer Authorization header, so include it for the widest compatibility.
    session.headers.update(
        {
            "X-API-ID": app_id,
            "X-API-TOKEN": token,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
    )

    print("Probing Helio public API (keys redacted; samples truncated)…")
    call(session, f"{API_BASE}/tests")
    call(session, f"{API_BASE}/tests/{test_id}")
    print("\nDone. The output above is safe to paste back (no keys; values truncated).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
