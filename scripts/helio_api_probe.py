#!/usr/bin/env python3
"""One-shot probe of the Helio public API to learn its response shape.

Helio's public REST API (helio.app, Enterprise) is documented for *which*
endpoints exist (`GET /api/public/tests`, `GET /api/public/tests/:id`) but NOT
for the JSON they return. Before we build a parser for it, run this once with
your own keys to capture the real shape. It prints a redacted *skeleton* (field
names, types, tiny samples) — never your API keys, and it truncates long strings
so you are not pasting all 100 participant responses.

Networking goes through **curl** (subprocess), not Python's `ssl`, because the
local venv Python is linked against an old LibreSSL that Cloudflare-fronted hosts
reject (TLSV1_ALERT_PROTOCOL_VERSION). System curl negotiates modern TLS fine.

Usage (keys never leave your machine; nothing is written to disk):

    HELIO_APP_ID=xxxx HELIO_API_TOKEN=yyyy \\
        python3 scripts/helio_api_probe.py [TEST_ID]

TEST_ID defaults to the known June EDC report id. Paste the printed skeleton
back into the chat — it is safe to share (no keys, samples truncated).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from typing import Any, List, Tuple

API_BASE = "https://my.helio.app/api/public"
DEFAULT_TEST_ID = "01KSV38T74ZYR3V9E19E6JYJMC"

# Cap how much we print so the pasted output stays small and PII-light.
MAX_STR = 80
MAX_LIST_SAMPLE = 2
MAX_DEPTH = 6

# Keys whose *locations* we want to find in the (large) test-detail response —
# this is where the scores / per-question metrics / open responses live.
INTEREST = re.compile(
    r"score|result|metric|sentiment|common|distribut|aggregat|percent|rating|insight|answer|choice|response|word|nps|summary",
    re.I,
)


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


def _sample(value: Any) -> str:
    if isinstance(value, dict):
        return f"{{dict keys: {list(value.keys())[:10]}}}"
    if isinstance(value, list):
        head = f" first={_sample(value[0])}" if value else ""
        return f"[list len {len(value)}]{head}"
    if isinstance(value, bool):
        return f"bool: {value}"
    if isinstance(value, (int, float)):
        return f"num: {value}"
    if isinstance(value, str):
        s = value if len(value) <= MAX_STR else value[:MAX_STR] + f"…(+{len(value) - MAX_STR})"
        return f"str: {s!r}"
    return "null" if value is None else type(value).__name__


def find_paths(
    obj: Any, pattern: re.Pattern, path: str = "", acc: List = None, seen: set = None
) -> List[Tuple[str, str]]:
    """Walk the tree; report unique key-paths whose key matches `pattern`, with a
    one-line sample. List indices collapse to [] so 100 responses → one path."""
    if acc is None:
        acc, seen = [], set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            kp = f"{path}.{key}" if path else key
            if pattern.search(key):
                norm = re.sub(r"\[\d+\]", "[]", kp)
                if norm not in seen:
                    seen.add(norm)
                    acc.append((norm, _sample(value)))
            find_paths(value, pattern, kp, acc, seen)
    elif isinstance(obj, list):
        for i, value in enumerate(obj[:3]):
            find_paths(value, pattern, f"{path}[{i}]", acc, seen)
    return acc


def curl_json(url: str, app_id: str, token: str) -> Tuple[str, str, str]:
    """Fetch via curl. Headers go in a temp config file so the keys never appear
    in the process args (`ps`). Returns (status_code, body, stderr)."""
    cfg = tempfile.NamedTemporaryFile("w", suffix=".curlcfg", delete=False)
    try:
        cfg.write(f'header = "X-API-ID: {app_id}"\n')
        cfg.write(f'header = "X-API-TOKEN: {token}"\n')
        cfg.write(f'header = "Authorization: Bearer {token}"\n')
        cfg.write('header = "Accept: application/json"\n')
        cfg.close()
        os.chmod(cfg.name, 0o600)
        proc = subprocess.run(
            ["curl", "-sS", "-K", cfg.name, "-w", "\n%{http_code}", url],
            capture_output=True,
            text=True,
            timeout=90,
        )
    finally:
        try:
            os.unlink(cfg.name)
        except OSError:
            pass
    out = proc.stdout
    if "\n" in out:
        body, _, code = out.rpartition("\n")
    else:
        body, code = "", out
    return code.strip(), body, proc.stderr.strip()


def call(url: str, app_id: str, token: str, find: bool = False) -> None:
    print(f"\n=== GET {url} ===")
    code, body, err = curl_json(url, app_id, token)
    if not code:
        print(f"  curl failed: {err or 'no response'}")
        return
    print(f"  status: {code}  (body {len(body)} bytes)")
    if code != "200":
        print(f"  body (first 300 chars): {body[:300]!r}")
        return
    try:
        data = json.loads(body)
    except ValueError:
        print(f"  non-JSON body (first 300 chars): {body[:300]!r}")
        return

    if not find:
        print("  shape:")
        print(json.dumps(skeleton(data), indent=2, ensure_ascii=False)[:6000])
        return

    # Detail endpoint: locate where the data lives instead of dumping it all.
    top = data.get("test") if isinstance(data, dict) and "test" in data else data
    print(
        f"  top-level keys: {list(data.keys()) if isinstance(data, dict) else type(data).__name__}"
    )
    if isinstance(top, dict):
        print(f"  test keys ({len(top)}): {list(top.keys())}")
    print("  interesting paths (key matches score/result/metric/response/…):")
    for pth, sample in find_paths(data, INTEREST):
        print(f"    {pth} = {sample}")


def main() -> int:
    app_id = os.environ.get("HELIO_APP_ID", "").strip()
    token = os.environ.get("HELIO_API_TOKEN", "").strip()
    if not app_id or not token or app_id.startswith("your-") or token.startswith("your-"):
        print(
            "Set HELIO_APP_ID and HELIO_API_TOKEN to your REAL Helio keys first "
            "(the placeholders were not replaced).",
            file=sys.stderr,
        )
        return 2

    test_id = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEST_ID).strip()

    print("Probing Helio public API via curl (keys redacted; samples truncated)…")
    call(f"{API_BASE}/tests", app_id, token)
    call(f"{API_BASE}/tests/{test_id}", app_id, token, find=True)

    # The base /tests/:id returns config only. Probe whether responses / results /
    # scores are reachable via a sub-path or query param (the internal app used
    # ?expand=true and /responses). Whichever returns 200 with non-count data wins.
    print("\n--- Candidate endpoints for response/score data ---")
    for suffix in (
        f"/tests/{test_id}/responses",
        f"/tests/{test_id}/results",
        f"/tests/{test_id}/insights",
        f"/tests/{test_id}/sections",
        f"/tests/{test_id}?expand=responses",
        f"/tests/{test_id}?include=responses,results",
        f"/responses?test_id={test_id}",
    ):
        call(f"{API_BASE}{suffix}", app_id, token, find=True)

    print("\nDone. The output above is safe to paste back (no keys; values truncated).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
