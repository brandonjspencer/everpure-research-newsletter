#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import pdfplumber
from pypdf import PdfReader


PDF_EXTENSIONS = ('.pdf',)


def load_json(path: Path) -> Any:
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def extract_text_pypdf(pdf_path: Path) -> List[Dict[str, Any]]:
    pages: List[Dict[str, Any]] = []
    reader = PdfReader(str(pdf_path))
    for idx, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ''
        pages.append({
            'page_number': idx,
            'text': text,
            'char_count': len(text),
            'method': 'pypdf',
        })
    return pages


def extract_text_pdfplumber(pdf_path: Path) -> List[Dict[str, Any]]:
    pages: List[Dict[str, Any]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ''
            pages.append({
                'page_number': idx,
                'text': text,
                'char_count': len(text),
                'method': 'pdfplumber',
            })
    return pages


def extract_pdf_text(pdf_path: Path) -> Dict[str, Any]:
    try:
        pages = extract_text_pypdf(pdf_path)
        if sum(p['char_count'] for p in pages) == 0:
            raise ValueError('pypdf_empty_text')
        method = 'pypdf'
    except Exception:
        pages = extract_text_pdfplumber(pdf_path)
        method = 'pdfplumber'

    full_text = '\n\n'.join(page['text'] for page in pages if page['text'])
    return {
        'pages': pages,
        'page_count': len(pages),
        'total_chars': len(full_text),
        'full_text': full_text,
        'text_excerpt': full_text[:2000],
        'extraction_method': method,
    }


def normalize_deck_content(
    deck_details: List[Dict[str, Any]],
    pdf_dir: Path,
) -> Dict[str, Any]:
    records: List[Dict[str, Any]] = []
    missing: List[str] = []

    deck_map = {d['file_id']: d for d in deck_details}
    for file_id, deck in sorted(deck_map.items()):
        pdf_path = pdf_dir / f'{file_id}.pdf'
        if not pdf_path.exists():
            missing.append(file_id)
            continue
        extracted = extract_pdf_text(pdf_path)
        records.append({
            'file_id': file_id,
            'source_type': 'pdf',
            'pdf_path': str(pdf_path),
            'canonical_url': deck.get('canonical_url'),
            'associated_weeks': deck.get('associated_weeks', []),
            'associated_record_ids': deck.get('associated_record_ids', []),
            'slide_hints': deck.get('slide_hints', []),
            **extracted,
        })

    summary = {
        'deck_count': len(deck_details),
        'ingested_pdf_count': len(records),
        'missing_pdf_count': len(missing),
        'missing_pdf_file_ids': missing,
        'total_page_count': sum(r['page_count'] for r in records),
        'total_char_count': sum(r['total_chars'] for r in records),
    }
    return {
        'deck_content': records,
        'summary': summary,
    }


def cli() -> None:
    ap = argparse.ArgumentParser(description='Ingest exported deck PDFs into normalized text content')
    ap.add_argument('--data-dir', default='/mnt/data/everpure_parsed', help='Directory containing deck_details.json')
    ap.add_argument('--pdf-dir', required=True, help='Directory containing deck PDFs named <file_id>.pdf')
    ap.add_argument('--out-content', default=None, help='Optional explicit output path for deck_content.json')
    ap.add_argument('--out-summary', default=None, help='Optional explicit output path for deck_content_summary.json')
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    pdf_dir = Path(args.pdf_dir)
    deck_details = load_json(data_dir / 'deck_details.json')
    result = normalize_deck_content(deck_details, pdf_dir)

    out_content = Path(args.out_content) if args.out_content else data_dir / 'deck_content.json'
    out_summary = Path(args.out_summary) if args.out_summary else data_dir / 'deck_content_summary.json'
    write_json(out_content, result['deck_content'])
    write_json(out_summary, result['summary'])
    print(json.dumps(result['summary'], indent=2, ensure_ascii=False))


if __name__ == '__main__':
    cli()
