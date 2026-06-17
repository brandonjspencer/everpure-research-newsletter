#!/usr/bin/env python3
"""Scaffold an editable per-issue content draft from a rendered build.

The stage-2 renderer auto-composes EVIDENCE, respondent quotes, and fallback
finding statements from the substrate when `netlify/content/default-current.json`
has no per-topic override. This script inverts a rendered `newsletter/default.json`
back into the content-override shape (`default-<YYYY-MM>.json`) so an editor
starts from those auto-composed values and refines in place, rather than from a
blank file. It also prints a review worksheet (the five questions every issue
must answer).

It never overwrites an existing draft unless `--force` is passed. The emitted
keys mirror the renderer's `topicKey()` (rendered titles are already canonical,
so a plain normalization matches); the `/new-issue` skill verifies by
re-rendering with the draft and diffing.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

DEFAULT_COMPARISON = {
    "statement_template": "{title} is best treated as a narrowed comparison problem: the next decision should protect the clearest user behavior rather than reopen broad creative exploration.",
    "decision_criteria": "Choose the strongest direction based on first-glance comprehension, clarity of the next step, user confidence, and whether the page helps visitors complete the intended task.",
}


def topic_key(title: str) -> str:
    raw = (title or "").lower()
    if "book filter" in raw or "this book" in raw:
        return "this_book_filter"
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", raw))


def _load(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return fallback


def build_content(rendered: Dict[str, Any], base: Dict[str, Any]) -> Dict[str, Any]:
    findings: List[Dict[str, Any]] = rendered.get("surfaced_findings") or []
    unresolved: List[Dict[str, Any]] = rendered.get("unresolved_questions") or []
    comparisons: List[Dict[str, Any]] = rendered.get("comparison_tests") or []

    topics: Dict[str, Any] = {}
    for f in findings:
        topic = {
            "finding_statement": f.get("finding_statement", ""),
            "proof_point": f.get("proof_point", ""),
            "next_step": f.get("next_step", ""),
        }
        if f.get("respondent_quote"):
            # Keep the quote between proof_point and next_step for readability.
            topic = {
                "finding_statement": topic["finding_statement"],
                "proof_point": topic["proof_point"],
                "respondent_quote": f["respondent_quote"],
                "next_step": topic["next_step"],
            }
        topics[topic_key(f.get("title", ""))] = topic

    for q in unresolved:
        topics.setdefault(topic_key(q.get("title", "")), {})["unresolved"] = {
            "scope": q.get("scope", ""),
            "question": q.get("question", ""),
        }

    for c in comparisons:
        topics.setdefault(topic_key(c.get("title", "")), {})["comparison"] = {
            "finding_statement": c.get("finding_statement", ""),
            "decision_criteria": c.get("decision_criteria", ""),
            "next_step": c.get("next_step", ""),
        }

    return {
        "note": rendered.get("note") or base.get("note", ""),
        "comparison_defaults": base.get("comparison_defaults") or DEFAULT_COMPARISON,
        "selection": {
            "findings_preferred_order": [f.get("title", "") for f in findings],
            "unresolved_preferred_order": [q.get("title", "") for q in unresolved],
        },
        "topics": topics,
    }


def _worksheet(rendered: Dict[str, Any], month: str, out_path: Path) -> str:
    lines = [f"# Issue draft worksheet — {month}", ""]
    lines.append(f"Draft content written to: {out_path}")
    lines.append("Refine each field, then have the /new-issue skill re-render and freeze.")
    lines.append("")
    for f in rendered.get("surfaced_findings") or []:
        lines.append(f"## {f.get('title')}  ({f.get('confidence', '?')} confidence)")
        lines.append(f"- Finding : {f.get('finding_statement', '')}")
        lines.append(f"- Evidence: {f.get('proof_point', '')}")
        if f.get("respondent_quote"):
            lines.append(f"- Quote   : “{f['respondent_quote']}”")
        lines.append(f"- Next    : {f.get('next_step', '')}")
        lines.append("")
    lines.append("## Every issue must answer")
    for q in (
        "What did we learn?",
        "Why does it matter?",
        "How confident are we (and is the label evidence-backed)?",
        "What still needs clarity?",
        "What should happen next?",
    ):
        lines.append(f"- [ ] {q}")
    return "\n".join(lines)


def cli() -> int:
    ap = argparse.ArgumentParser(
        description="Scaffold a per-issue content draft from a rendered build"
    )
    ap.add_argument("--month", required=True, help="Issue month, YYYY-MM")
    ap.add_argument(
        "--rendered",
        default="publish/newsletter/default.json",
        help="Rendered stage-2 default brief to invert",
    )
    ap.add_argument(
        "--base",
        default="netlify/content/default-current.json",
        help="Existing content file to inherit note/comparison_defaults from",
    )
    ap.add_argument(
        "--out",
        default=None,
        help="Output draft path (default netlify/content/default-<month>.json)",
    )
    ap.add_argument("--force", action="store_true", help="Overwrite an existing draft")
    args = ap.parse_args()

    if not re.match(r"^\d{4}-\d{2}$", args.month):
        print("error: --month must be YYYY-MM", file=sys.stderr)
        return 2

    rendered = _load(Path(args.rendered), None)
    if rendered is None:
        print(
            f"error: could not read rendered brief at {args.rendered} (run a build first)",
            file=sys.stderr,
        )
        return 2
    base = _load(Path(args.base), {}) or {}

    out_path = (
        Path(args.out) if args.out else Path("netlify/content") / f"default-{args.month}.json"
    )
    if out_path.exists() and not args.force:
        print(f"error: {out_path} already exists; pass --force to overwrite", file=sys.stderr)
        return 2

    content = build_content(rendered, base)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(content, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(_worksheet(rendered, args.month, out_path))
    print(f"\nRESULT: wrote {out_path} ({len(content['topics'])} topics)")
    return 0


if __name__ == "__main__":
    sys.exit(cli())
