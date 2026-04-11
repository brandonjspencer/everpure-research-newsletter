#!/usr/bin/env python3
import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs

SLIDES_ID_RE = re.compile(r'/presentation/d/([a-zA-Z0-9_-]+)')
SLIDE_HINT_RE = re.compile(r'slide=id\.([A-Za-z0-9_]+)')


def load_json(path: Path) -> Any:
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def extract_file_id(url: str) -> Optional[str]:
    if not url:
        return None
    m = SLIDES_ID_RE.search(url)
    return m.group(1) if m else None


def extract_slide_hint(url: str) -> Optional[str]:
    if not url:
        return None
    m = SLIDE_HINT_RE.search(url)
    if m:
        return m.group(1)
    frag = urlparse(url).fragment or ''
    if frag.startswith('slide=id.'):
        return frag.split('slide=id.', 1)[1]
    qs = parse_qs(urlparse(url).query)
    slide = qs.get('slide')
    if slide and slide[0].startswith('id.'):
        return slide[0][3:]
    return None


def canonical_deck_url(url: str, file_id: Optional[str] = None) -> Optional[str]:
    fid = file_id or extract_file_id(url)
    if not fid:
        return None
    return f'https://docs.google.com/presentation/d/{fid}/edit'


def infer_local_artifacts(file_id: str, local_artifact_dir: Optional[Path]) -> Dict[str, str]:
    artifacts: Dict[str, str] = {}
    if local_artifact_dir is None or not local_artifact_dir.exists():
        return artifacts
    for ext in ('pdf', 'pptx', 'txt', 'json', 'html'):
        candidate = local_artifact_dir / f'{file_id}.{ext}'
        if candidate.exists():
            artifacts[ext] = str(candidate)
    return artifacts


def build_deck_details(
    weeks: List[Dict[str, Any]],
    decks: List[Dict[str, str]],
    local_artifact_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    by_file: Dict[str, Dict[str, Any]] = {}

    # Seed from decks.json
    for deck in decks:
        fid = deck.get('file_id') or extract_file_id(deck.get('url', ''))
        if not fid:
            continue
        rec = by_file.setdefault(fid, {
            'file_id': fid,
            'canonical_url': canonical_deck_url(deck.get('url', ''), fid),
            'urls': [],
            'slide_hints': [],
            'associated_weeks': [],
            'associated_record_ids': [],
            'section_families': [],
            'counts_by_group': defaultdict(int),
            'local_artifacts': {},
            'artifact_status': 'missing',
        })
        url = deck.get('url')
        if url and url not in rec['urls']:
            rec['urls'].append(url)
        hint = extract_slide_hint(url or '')
        if hint and hint not in rec['slide_hints']:
            rec['slide_hints'].append(hint)

    # Enrich from weeks.json
    for week in weeks:
        deck = week.get('deck') or {}
        fid = deck.get('file_id') or extract_file_id(deck.get('url', ''))
        if not fid:
            continue
        rec = by_file.setdefault(fid, {
            'file_id': fid,
            'canonical_url': canonical_deck_url(deck.get('url', ''), fid),
            'urls': [],
            'slide_hints': [],
            'associated_weeks': [],
            'associated_record_ids': [],
            'section_families': [],
            'counts_by_group': defaultdict(int),
            'local_artifacts': {},
            'artifact_status': 'missing',
        })
        url = deck.get('url')
        if url and url not in rec['urls']:
            rec['urls'].append(url)
        hint = extract_slide_hint(url or '')
        if hint and hint not in rec['slide_hints']:
            rec['slide_hints'].append(hint)
        if week.get('week_date') and week['week_date'] not in rec['associated_weeks']:
            rec['associated_weeks'].append(week['week_date'])
        if week.get('record_id') and week['record_id'] not in rec['associated_record_ids']:
            rec['associated_record_ids'].append(week['record_id'])
        if week.get('section_family') and week['section_family'] not in rec['section_families']:
            rec['section_families'].append(week['section_family'])
        for group, items in (week.get('content_groups') or {}).items():
            rec['counts_by_group'][group] += len(items or [])

    # Finalize
    details: List[Dict[str, Any]] = []
    deck_week_map: Dict[str, List[Dict[str, str]]] = {}
    for fid, rec in sorted(by_file.items(), key=lambda kv: kv[0]):
        artifacts = infer_local_artifacts(fid, local_artifact_dir)
        rec['local_artifacts'] = artifacts
        if 'pdf' in artifacts:
            rec['artifact_status'] = 'local_pdf'
        elif artifacts:
            rec['artifact_status'] = 'local_artifact'
        rec['associated_weeks'].sort(reverse=True)
        rec['associated_record_ids'].sort(reverse=True)
        rec['section_families'].sort()
        rec['counts_by_group'] = dict(sorted(rec['counts_by_group'].items()))
        rec['week_count'] = len(rec['associated_weeks'])
        rec['url_count'] = len(rec['urls'])
        details.append(rec)
        deck_week_map[fid] = [
            {'week_date': w, 'record_id': rid}
            for w, rid in zip(rec['associated_weeks'], rec['associated_record_ids'])
        ]

    summary = {
        'deck_count': len(details),
        'deck_ids': [d['file_id'] for d in details],
        'with_local_artifacts': sum(1 for d in details if d['artifact_status'] != 'missing'),
        'with_local_pdfs': sum(1 for d in details if d['artifact_status'] == 'local_pdf'),
        'max_week_associations': max((d['week_count'] for d in details), default=0),
    }
    return {
        'deck_details': details,
        'deck_week_map': deck_week_map,
        'summary': summary,
    }


def cli() -> None:
    ap = argparse.ArgumentParser(description='Build normalized deck metadata from Everpure parsed outputs')
    ap.add_argument('--data-dir', default='/mnt/data/everpure_parsed', help='Directory containing weeks.json and decks.json')
    ap.add_argument('--local-artifact-dir', default=None, help='Optional directory of local deck artifacts named by file_id, such as <file_id>.pdf')
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    weeks = load_json(data_dir / 'weeks.json')
    decks = load_json(data_dir / 'decks.json')
    result = build_deck_details(
        weeks=weeks,
        decks=decks,
        local_artifact_dir=Path(args.local_artifact_dir) if args.local_artifact_dir else None,
    )
    write_json(data_dir / 'deck_details.json', result['deck_details'])
    write_json(data_dir / 'deck_week_map.json', result['deck_week_map'])
    write_json(data_dir / 'deck_summary.json', result['summary'])
    print(json.dumps(result['summary'], indent=2, ensure_ascii=False))


if __name__ == '__main__':
    cli()
