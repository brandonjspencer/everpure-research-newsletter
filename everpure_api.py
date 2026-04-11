#!/usr/bin/env python3
import argparse
import json
import os
import re
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

try:
    from flask import Flask, jsonify, request
except Exception:  # pragma: no cover
    Flask = None
    jsonify = None
    request = None

GROUP_KEYS = [
    'findings',
    'testing_concepts',
    'in_process',
    'initiatives_on_deck',
    'weekly_progress',
    'needs',
    'next_steps',
    'other',
]
ITEM_ID_RE = re.compile(r'^(\d{2,4})\s*-\s*(.+)$')


def load_json(path: str) -> Any:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def maybe_load_json(path: str, default: Any) -> Any:
    if os.path.exists(path):
        return load_json(path)
    return default


class EverpureStore:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.metadata = load_json(os.path.join(data_dir, 'metadata.json'))
        self.weeks = load_json(os.path.join(data_dir, 'weeks.json'))
        self.decks = load_json(os.path.join(data_dir, 'decks.json'))
        self.summary = load_json(os.path.join(data_dir, 'summary.json'))
        self.deck_details = maybe_load_json(os.path.join(data_dir, 'deck_details.json'), [])
        self.deck_summary = maybe_load_json(os.path.join(data_dir, 'deck_summary.json'), {})
        self.deck_content = maybe_load_json(os.path.join(data_dir, 'deck_content.json'), [])
        self.deck_content_summary = maybe_load_json(os.path.join(data_dir, 'deck_content_summary.json'), {})
        self._index = {w['record_id']: w for w in self.weeks}
        self._date_index = {w['week_date']: w for w in self.weeks}
        self._deck_detail_index = {d['file_id']: d for d in self.deck_details if d.get('file_id')}
        self._deck_content_index = {d['file_id']: d for d in self.deck_content if d.get('file_id')}

    def filter_weeks(
        self,
        since: Optional[str] = None,
        until: Optional[str] = None,
        section_family: Optional[str] = None,
        deck_id: Optional[str] = None,
        query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        rows = self.weeks
        if since:
            rows = [w for w in rows if w['week_date'] >= since]
        if until:
            rows = [w for w in rows if w['week_date'] <= until]
        if section_family:
            rows = [w for w in rows if w.get('section_family') == section_family]
        if deck_id:
            rows = [w for w in rows if (w.get('deck') or {}).get('file_id') == deck_id]
        if query:
            q = query.lower()
            filtered = []
            for w in rows:
                hay = json.dumps(w, ensure_ascii=False).lower()
                if q in hay:
                    filtered.append(w)
            rows = filtered
        return rows

    def get_week(self, key: str) -> Optional[Dict[str, Any]]:
        return self._index.get(key) or self._date_index.get(key)

    def get_deck_detail(self, file_id: str) -> Optional[Dict[str, Any]]:
        return self._deck_detail_index.get(file_id)

    def get_deck_content(self, file_id: str) -> Optional[Dict[str, Any]]:
        return self._deck_content_index.get(file_id)


def flatten_items(items: Iterable[Dict[str, Any]], parent: Optional[str] = None) -> List[Dict[str, Any]]:
    out = []
    for item in items:
        text = item.get('text', '')
        row = {
            'text': text,
            'level': item.get('level', 0),
            'parent': parent,
            'identifier': None,
            'label': text,
        }
        m = ITEM_ID_RE.match(text)
        if m:
            row['identifier'] = m.group(1)
            row['label'] = m.group(2).strip()
        out.append(row)
        out.extend(flatten_items(item.get('children', []), parent=text))
    return out


def extract_findings(weeks: List[Dict[str, Any]], group: Optional[str] = None, query: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = []
    target_groups = [group] if group else GROUP_KEYS
    for week in weeks:
        for g in target_groups:
            if g not in week['content_groups']:
                continue
            for item in flatten_items(week['content_groups'][g]):
                row = deepcopy(item)
                row['week_date'] = week['week_date']
                row['record_id'] = week['record_id']
                row['group'] = g
                row['deck'] = week.get('deck')
                rows.append(row)
    if query:
        q = query.lower()
        rows = [r for r in rows if q in json.dumps(r, ensure_ascii=False).lower()]
    return rows


def build_newsletter_pack(store: EverpureStore, since: Optional[str] = None, until: Optional[str] = None) -> Dict[str, Any]:
    weeks = store.filter_weeks(since=since, until=until)
    findings = extract_findings(weeks)

    by_group = Counter(r['group'] for r in findings)
    by_id = Counter(r['identifier'] for r in findings if r.get('identifier'))
    by_label = Counter(r['label'] for r in findings if r.get('label'))
    deck_ids = sorted({(w.get('deck') or {}).get('file_id') for w in weeks if w.get('deck')})
    decks_with_content = sorted([fid for fid in deck_ids if store.get_deck_content(fid)])

    timeline = []
    for w in weeks:
        item_count = sum(len(flatten_items(w['content_groups'].get(g, []))) for g in GROUP_KEYS)
        timeline.append({
            'week_date': w['week_date'],
            'record_id': w['record_id'],
            'deck_id': (w.get('deck') or {}).get('file_id'),
            'counts': {g: len(flatten_items(w['content_groups'].get(g, []))) for g in GROUP_KEYS},
            'total_items': item_count,
        })

    recent_weeks = []
    for w in weeks[-6:]:
        deck_id = (w.get('deck') or {}).get('file_id')
        deck_content = store.get_deck_content(deck_id) if deck_id else None
        recent_weeks.append({
            'week_date': w['week_date'],
            'deck': w.get('deck'),
            'deck_excerpt': (deck_content or {}).get('text_excerpt'),
            'highlights': {
                g: [x['text'] for x in flatten_items(w['content_groups'].get(g, []))[:8]]
                for g in GROUP_KEYS if flatten_items(w['content_groups'].get(g, []))
            }
        })

    grouped_examples: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in findings:
        if row['identifier'] and len(grouped_examples[row['identifier']]) < 5:
            grouped_examples[row['identifier']].append({
                'week_date': row['week_date'],
                'group': row['group'],
                'text': row['text'],
            })

    themes = []
    for ident, count in by_id.most_common(20):
        themes.append({
            'identifier': ident,
            'count': count,
            'examples': grouped_examples.get(ident, []),
        })

    return {
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'window': {'since': since, 'until': until},
        'overview': {
            'week_count': len(weeks),
            'item_count': len(findings),
            'deck_count': len(deck_ids),
            'deck_ids': deck_ids,
            'decks_with_content_count': len(decks_with_content),
            'decks_with_content': decks_with_content,
            'date_range': {
                'min': min((w['week_date'] for w in weeks), default=None),
                'max': max((w['week_date'] for w in weeks), default=None),
            },
        },
        'group_counts': dict(by_group),
        'top_identifiers': themes,
        'top_labels': [{'label': label, 'count': count} for label, count in by_label.most_common(25)],
        'timeline': timeline,
        'recent_weeks': recent_weeks,
    }


def write_newsletter_pack(data_dir: str, since: Optional[str], until: Optional[str], out_path: str) -> Dict[str, Any]:
    store = EverpureStore(data_dir)
    pack = build_newsletter_pack(store, since=since, until=until)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(pack, f, indent=2, ensure_ascii=False)
    return pack


def create_app(data_dir: str):
    if Flask is None:
        raise RuntimeError('Flask is required to run the API. Install with: pip install flask')
    app = Flask(__name__)
    store = EverpureStore(data_dir)

    @app.get('/health')
    def health():
        return jsonify({
            'ok': True,
            'data_dir': data_dir,
            'week_count': len(store.weeks),
            'deck_count': len(store.decks),
            'deck_detail_count': len(store.deck_details),
            'deck_content_count': len(store.deck_content),
        })

    @app.get('/metadata')
    def metadata():
        return jsonify(store.metadata)

    @app.get('/decks')
    def decks():
        return jsonify(store.decks)

    @app.get('/deck-summary')
    def deck_summary():
        return jsonify({
            'deck_summary': store.deck_summary,
            'deck_content_summary': store.deck_content_summary,
        })

    @app.get('/deck-details')
    def deck_details():
        return jsonify(store.deck_details)

    @app.get('/deck-details/<file_id>')
    def deck_details_one(file_id: str):
        row = store.get_deck_detail(file_id)
        if row is None:
            return jsonify({'error': 'not_found', 'file_id': file_id}), 404
        return jsonify(row)

    @app.get('/deck-content')
    def deck_content():
        rows = store.deck_content
        file_id = request.args.get('file_id')
        q = request.args.get('q')
        if file_id:
            rows = [r for r in rows if r.get('file_id') == file_id]
        if q:
            ql = q.lower()
            rows = [r for r in rows if ql in json.dumps(r, ensure_ascii=False).lower()]
        return jsonify(rows)

    @app.get('/deck-content/<file_id>')
    def deck_content_one(file_id: str):
        row = store.get_deck_content(file_id)
        if row is None:
            return jsonify({'error': 'not_found', 'file_id': file_id}), 404
        return jsonify(row)

    @app.get('/weeks')
    def weeks():
        rows = store.filter_weeks(
            since=request.args.get('since'),
            until=request.args.get('until'),
            section_family=request.args.get('section_family'),
            deck_id=request.args.get('deck_id'),
            query=request.args.get('q'),
        )
        return jsonify(rows)

    @app.get('/weeks/<key>')
    def week(key: str):
        row = store.get_week(key)
        if row is None:
            return jsonify({'error': 'not_found', 'key': key}), 404
        return jsonify(row)

    @app.get('/findings')
    def findings():
        weeks = store.filter_weeks(
            since=request.args.get('since'),
            until=request.args.get('until'),
            section_family=request.args.get('section_family'),
            deck_id=request.args.get('deck_id'),
            query=None,
        )
        rows = extract_findings(weeks, group=request.args.get('group'), query=request.args.get('q'))
        return jsonify(rows)

    @app.get('/summary')
    def summary():
        pack = build_newsletter_pack(store, since=request.args.get('since'), until=request.args.get('until'))
        return jsonify(pack)

    return app


def cli():
    ap = argparse.ArgumentParser(description='Everpure parsed-data API and summary helpers')
    ap.add_argument('--data-dir', default='/mnt/data/everpure_parsed', help='Directory containing metadata.json, weeks.json, decks.json, summary.json')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p_pack = sub.add_parser('build-pack', help='Build a newsletter pack JSON')
    p_pack.add_argument('--since', default=None)
    p_pack.add_argument('--until', default=None)
    p_pack.add_argument('--out', required=True)

    p_serve = sub.add_parser('serve', help='Run a local HTTP API')
    p_serve.add_argument('--host', default='127.0.0.1')
    p_serve.add_argument('--port', type=int, default=8000)
    p_serve.add_argument('--debug', action='store_true')

    args = ap.parse_args()

    if args.cmd == 'build-pack':
        write_newsletter_pack(args.data_dir, args.since, args.until, args.out)
    elif args.cmd == 'serve':
        app = create_app(args.data_dir)
        app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == '__main__':
    cli()
