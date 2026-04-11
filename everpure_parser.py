#!/usr/bin/env python3
import argparse
import json
import os
import re
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

DATE_RE = re.compile(r'^📌\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})$')
SLIDES_ID_RE = re.compile(r'/presentation/d/([a-zA-Z0-9_-]+)')
GROUP_MAP = {
    'findings': 'findings',
    'finding': 'findings',
    'testing concepts': 'testing_concepts',
    'testing concept': 'testing_concepts',
    'in process': 'in_process',
    'initiatives on deck': 'initiatives_on_deck',
    'weekly progress': 'weekly_progress',
    'needs': 'needs',
    'next steps': 'next_steps',
    'source files': 'source_files',
    'program goals': 'program_goals',
    'audience': 'audience',
}
MAJOR_SECTION_HEADERS = {
    'weekly rundown', 'weekly findings', 'weekly product design cycle', 'previous weeks', 'on demand'
}
CONTAINER_TYPES = {'column_list', 'column'}
IGNORED_TYPES = CONTAINER_TYPES | {'divider'}


def normalize_space(text: str) -> str:
    text = text.replace('\xa0', ' ')
    text = re.sub(r'\s+', ' ', text or '').strip()
    return text


def slugify(text: str) -> str:
    text = normalize_space(text).lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    text = re.sub(r'_+', '_', text).strip('_')
    return text or 'unknown'


def block_type(block) -> str:
    for cls in block.get('class', []):
        if cls.startswith('notion-') and cls.endswith('-block'):
            return cls[len('notion-'):-len('-block')]
    return 'unknown'


def direct_leaf_text(block) -> str:
    leaf = block.find(attrs={'data-content-editable-leaf': True})
    if leaf:
        return normalize_space(leaf.get_text(' ', strip=True))
    return ''


def extract_list_level(block) -> int:
    pb = block.find(class_='pseudoBefore')
    if not pb:
        return 1
    style = pb.get('style', '')
    m = re.search(r'--pseudoBefore--content:\s*"([^"]+)"', style)
    bullet = m.group(1) if m else '•'
    return {'•': 1, '◦': 2, '▪': 3}.get(bullet, 1)


def extract_links(block) -> List[Dict[str, str]]:
    links = []
    for a in block.find_all('a', href=True):
        href = a.get('href')
        label = normalize_space(a.get_text(' ', strip=True)) or href
        links.append({'label': label, 'url': href})
    return links


def extract_images(block) -> List[Dict[str, str]]:
    out = []
    for img in block.find_all('img'):
        src = img.get('src')
        alt = img.get('alt') or ''
        if src:
            out.append({'src': src, 'alt': alt})
    return out


def is_date_heading(text: str) -> Optional[datetime]:
    m = DATE_RE.match(text)
    if not m:
        return None
    return datetime.strptime(m.group(1), '%B %d, %Y')


def extract_slides_info(url: str) -> Optional[Dict[str, str]]:
    m = SLIDES_ID_RE.search(url or '')
    if not m:
        return None
    return {'url': url, 'file_id': m.group(1)}


def new_week_record(dt: datetime, raw_label: str, family: str, page_title: str) -> Dict[str, Any]:
    return {
        'record_id': f"{slugify(page_title)}_{dt.strftime('%Y_%m_%d')}",
        'source_page_title': page_title,
        'source_type': 'notion_html',
        'week_date': dt.strftime('%Y-%m-%d'),
        'section_family': family,
        'week_label_raw': raw_label,
        'deck': None,
        'images': [],
        'content_groups': {
            'findings': [],
            'testing_concepts': [],
            'in_process': [],
            'initiatives_on_deck': [],
            'weekly_progress': [],
            'needs': [],
            'next_steps': [],
            'other': [],
        },
        'linked_pages': [],
        'linked_files': [],
        'toggles': [],
    }


def default_metadata(page_title: str) -> Dict[str, Any]:
    return {
        'page_title': page_title,
        'source_files': [],
        'linked_pages': [],
        'program_context': {
            'program_goals': [],
            'audience': [],
            'notes': [],
        },
        'raw_sections': OrderedDict(),
    }


def dedupe_dict_list(items: List[Dict[str, Any]], keys: Tuple[str, ...]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for item in items:
        sig = tuple(item.get(k) for k in keys)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(item)
    return out


def add_bullet_item(group_list: List[Dict[str, Any]], text: str, level: int):
    item = {'text': text, 'level': level, 'children': []}
    if level <= 1 or not group_list:
        group_list.append(item)
        return

    # Find parent with nearest smaller level.
    stack = []
    def walk(items):
        for it in items:
            stack.append(it)
            yield it
            yield from walk(it.get('children', []))
    parent = None
    for existing in walk(group_list):
        if existing.get('level', 1) < level:
            parent = existing
    if parent is None:
        group_list.append(item)
    else:
        parent.setdefault('children', []).append(item)


def flatten_bullets(items: List[Dict[str, Any]]) -> List[str]:
    out = []
    for item in items:
        out.append(item['text'])
        out.extend(flatten_bullets(item.get('children', [])))
    return out


def parse_html(html: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, 'html.parser')
    page_title = normalize_space(soup.title.get_text(' ', strip=True)) if soup.title else 'Untitled'
    metadata = default_metadata(page_title)
    records: List[Dict[str, Any]] = []
    decks: List[Dict[str, str]] = []

    current_family = 'intro'
    current_group: Optional[str] = None
    current_week: Optional[Dict[str, Any]] = None
    current_metadata_section: Optional[str] = None
    seen_record_ids = set()

    blocks = soup.find_all(attrs={'data-block-id': True})
    for block in blocks:
        btype = block_type(block)
        if btype in IGNORED_TYPES:
            continue

        text = direct_leaf_text(block)
        links = extract_links(block)
        images = extract_images(block)

        # Family changes via top-level h2 header blocks.
        if btype == 'header' and text:
            current_family = slugify(text)
            current_group = None
            current_metadata_section = GROUP_MAP.get(text.lower().rstrip(':'), slugify(text))
            continue

        # Start of weekly record.
        if btype == 'sub_header' and text:
            dt = is_date_heading(text)
            if dt:
                current_week = new_week_record(dt, text, current_family, page_title)
                if current_week['record_id'] not in seen_record_ids:
                    records.append(current_week)
                    seen_record_ids.add(current_week['record_id'])
                current_group = None
                current_metadata_section = None
                continue
            else:
                # Non-date subheaders can still mark metadata or family shifts.
                normalized = text.strip().rstrip(':').lower()
                mapped = GROUP_MAP.get(normalized)
                if normalized in MAJOR_SECTION_HEADERS:
                    current_family = slugify(text)
                    current_group = None
                    current_metadata_section = None
                    continue
                if current_week is None:
                    current_metadata_section = mapped or slugify(text)
                else:
                    # Treat only known content-group headings as subgroup headings within weeks.
                    if mapped in {'findings','testing_concepts','in_process','initiatives_on_deck','weekly_progress','needs','next_steps'}:
                        current_group = mapped
                    else:
                        current_group = None
                continue

        if current_week is None:
            # Intro / metadata parsing.
            if btype == 'text' and text:
                normalized = text.strip().rstrip(':').lower()
                mapped = GROUP_MAP.get(normalized)
                if mapped in {'source_files', 'program_goals', 'audience'}:
                    current_metadata_section = mapped
                    continue

                if current_metadata_section == 'source_files':
                    for link in links:
                        url = link['url']
                        item = {'label': link['label'], 'url': url}
                        host = urlparse(url).netloc.lower()
                        if 'notion.site' in host or 'notion.so' in host:
                            metadata['linked_pages'].append({'title': link['label'], 'url': url})
                        else:
                            metadata['source_files'].append(item)
                elif current_metadata_section == 'audience' and text:
                    metadata['program_context']['audience'].append(text)
                elif current_metadata_section == 'program_goals' and text:
                    metadata['program_context']['program_goals'].append(text)
                else:
                    metadata['program_context']['notes'].append(text)
                continue

            if btype == 'page' and links:
                for link in links:
                    metadata['linked_pages'].append({'title': link['label'], 'url': link['url']})
                continue

            if btype == 'toggle' and text:
                metadata['program_context']['notes'].append(f"Toggle: {text}")
                continue

            continue

        # Weekly record parsing.
        if images:
            current_week['images'].extend(images)

        if btype == 'text' and links:
            for link in links:
                slide = extract_slides_info(link['url'])
                if slide and current_week['deck'] is None:
                    current_week['deck'] = slide
                    decks.append(slide)
                else:
                    host = urlparse(link['url']).netloc.lower()
                    if 'notion.site' in host or 'notion.so' in host:
                        current_week['linked_pages'].append({'title': link['label'], 'url': link['url']})
                    else:
                        current_week['linked_files'].append({'label': link['label'], 'url': link['url']})

        if btype == 'page' and links:
            for link in links:
                current_week['linked_pages'].append({'title': link['label'], 'url': link['url']})
            continue

        if btype == 'toggle' and text:
            current_week['toggles'].append({'title': text, 'expanded': False, 'children_present': False})
            continue

        if btype == 'text' and text:
            normalized = text.strip().rstrip(':').lower()
            mapped = GROUP_MAP.get(normalized)
            if mapped in current_week['content_groups']:
                current_group = mapped
            else:
                only_link_text = bool(links) and normalize_space(' '.join(l['label'] for l in links)) == text.replace('🧠 ','').replace('👉 ','').strip()
                if current_group:
                    current_week['content_groups'][current_group].append({'text': text, 'level': 0, 'children': []})
                elif not only_link_text:
                    current_week['content_groups']['other'].append({'text': text, 'level': 0, 'children': []})
            continue

        if btype == 'bulleted_list' and text:
            group = current_group or 'other'
            add_bullet_item(current_week['content_groups'][group], text, extract_list_level(block))
            continue

        if btype == 'callout' and text:
            current_week['content_groups']['other'].append({'text': text, 'level': 0, 'children': []})
            continue

    # Cleanup and derived outputs.
    for rec in records:
        rec['images'] = dedupe_dict_list(rec['images'], ('src', 'alt'))
        rec['linked_pages'] = dedupe_dict_list(rec['linked_pages'], ('title', 'url'))
        rec['linked_files'] = dedupe_dict_list(rec['linked_files'], ('label', 'url'))

    metadata['source_files'] = dedupe_dict_list(metadata['source_files'], ('label', 'url'))
    metadata['linked_pages'] = dedupe_dict_list(metadata['linked_pages'], ('title', 'url'))
    decks = dedupe_dict_list(decks, ('file_id', 'url'))

    summary = {
        'page_title': page_title,
        'weekly_record_count': len(records),
        'deck_count': len(decks),
        'date_range': {
            'min': min((r['week_date'] for r in records), default=None),
            'max': max((r['week_date'] for r in records), default=None),
        },
    }

    return {
        'metadata': metadata,
        'weeks': records,
        'decks': decks,
        'summary': summary,
    }


def main():
    ap = argparse.ArgumentParser(description='Parse Everpure Notion HTML export into normalized JSON.')
    ap.add_argument('html_path', help='Path to the exported Notion HTML file')
    ap.add_argument('--output-dir', default=None, help='Directory to write JSON outputs')
    args = ap.parse_args()

    with open(args.html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    result = parse_html(html)

    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)
        for key in ('metadata', 'weeks', 'decks', 'summary'):
            path = os.path.join(args.output_dir, f'{key}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(result[key], f, indent=2, ensure_ascii=False)
        manifest = {
            'html_source': os.path.abspath(args.html_path),
            'outputs': {k: os.path.join(os.path.abspath(args.output_dir), f'{k}.json') for k in ('metadata','weeks','decks','summary')},
        }
        with open(os.path.join(args.output_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
