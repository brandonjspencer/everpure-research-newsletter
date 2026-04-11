#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import jwt
import requests

from everpure_deck_ingest import build_deck_details, load_json, write_json

TOKEN_URL = 'https://oauth2.googleapis.com/token'
SLIDES_GET_URL = 'https://slides.googleapis.com/v1/presentations/{file_id}'
DRIVE_EXPORT_URL = 'https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType={mime}'
SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/presentations.readonly',
]
EXPORT_MIME_TYPES = {
    'pdf': 'application/pdf',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


class GoogleAuthError(RuntimeError):
    pass


class GoogleDeckFetcher:
    def __init__(self, access_token: str):
        self.session = requests.Session()
        self.session.headers.update({'Authorization': f'Bearer {access_token}'})

    def fetch_slides_metadata(self, file_id: str) -> Dict[str, Any]:
        resp = self.session.get(SLIDES_GET_URL.format(file_id=file_id), timeout=60)
        resp.raise_for_status()
        return resp.json()

    def export_deck(self, file_id: str, export_kind: str) -> bytes:
        mime = quote(EXPORT_MIME_TYPES[export_kind], safe='')
        resp = self.session.get(DRIVE_EXPORT_URL.format(file_id=file_id, mime=mime), timeout=120)
        resp.raise_for_status()
        return resp.content


def issue_service_account_token(service_account_json: Path, subject: Optional[str] = None) -> str:
    info = load_json(service_account_json)
    now = int(time.time())
    payload = {
        'iss': info['client_email'],
        'scope': ' '.join(SCOPES),
        'aud': info.get('token_uri', TOKEN_URL),
        'iat': now,
        'exp': now + 3600,
    }
    if subject:
        payload['sub'] = subject
    assertion = jwt.encode(payload, info['private_key'], algorithm='RS256')
    resp = requests.post(
        info.get('token_uri', TOKEN_URL),
        data={
            'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion': assertion,
        },
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()
    access_token = body.get('access_token')
    if not access_token:
        raise GoogleAuthError(f'No access_token in response: {body}')
    return access_token


def resolve_access_token(args: argparse.Namespace) -> str:
    if args.access_token:
        return args.access_token
    if args.service_account_json:
        return issue_service_account_token(Path(args.service_account_json), subject=args.subject)
    raise GoogleAuthError('Provide either --access-token or --service-account-json')


def selected_file_ids(args: argparse.Namespace, deck_details: List[Dict[str, Any]]) -> List[str]:
    if args.file_id:
        return args.file_id
    ids = [d['file_id'] for d in deck_details]
    if args.limit:
        ids = ids[:args.limit]
    return ids


def save_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as f:
        f.write(data)


def fetch_and_save(
    deck_details: List[Dict[str, Any]],
    weeks: List[Dict[str, Any]],
    data_dir: Path,
    artifact_dir: Path,
    file_ids: List[str],
    fetch_pdf: bool,
    fetch_pptx: bool,
    fetch_meta: bool,
    access_token: str,
) -> Dict[str, Any]:
    fetcher = GoogleDeckFetcher(access_token)
    results: List[Dict[str, Any]] = []

    for file_id in file_ids:
        item: Dict[str, Any] = {'file_id': file_id, 'saved': {}, 'errors': []}
        try:
            if fetch_meta:
                meta = fetcher.fetch_slides_metadata(file_id)
                meta_path = artifact_dir / f'{file_id}.json'
                write_json(meta_path, meta)
                item['saved']['meta'] = str(meta_path)
        except Exception as exc:
            item['errors'].append(f'meta:{exc}')

        if fetch_pdf:
            try:
                pdf_bytes = fetcher.export_deck(file_id, 'pdf')
                pdf_path = artifact_dir / f'{file_id}.pdf'
                save_bytes(pdf_path, pdf_bytes)
                item['saved']['pdf'] = str(pdf_path)
            except Exception as exc:
                item['errors'].append(f'pdf:{exc}')

        if fetch_pptx:
            try:
                pptx_bytes = fetcher.export_deck(file_id, 'pptx')
                pptx_path = artifact_dir / f'{file_id}.pptx'
                save_bytes(pptx_path, pptx_bytes)
                item['saved']['pptx'] = str(pptx_path)
            except Exception as exc:
                item['errors'].append(f'pptx:{exc}')

        results.append(item)

    refreshed = build_deck_details(weeks=weeks, decks=[{'file_id': d['file_id'], 'url': d.get('canonical_url')} for d in deck_details], local_artifact_dir=artifact_dir)
    write_json(data_dir / 'deck_details.json', refreshed['deck_details'])
    write_json(data_dir / 'deck_week_map.json', refreshed['deck_week_map'])
    write_json(data_dir / 'deck_summary.json', refreshed['summary'])

    manifest = {
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'artifact_dir': str(artifact_dir),
        'requested_file_ids': file_ids,
        'results': results,
        'summary': {
            'requested_count': len(file_ids),
            'success_count': sum(1 for r in results if r['saved']),
            'error_count': sum(1 for r in results if r['errors']),
            'pdf_saved_count': sum(1 for r in results if 'pdf' in r['saved']),
            'pptx_saved_count': sum(1 for r in results if 'pptx' in r['saved']),
            'meta_saved_count': sum(1 for r in results if 'meta' in r['saved']),
        },
    }
    write_json(data_dir / 'google_fetch_manifest.json', manifest)
    return manifest


def cli() -> None:
    ap = argparse.ArgumentParser(description='Fetch Google Slides deck artifacts using OAuth access token or service account')
    ap.add_argument('--data-dir', default='/mnt/data/everpure_parsed', help='Directory containing deck_details.json and weeks.json')
    ap.add_argument('--artifact-dir', default='/mnt/data/everpure_raw/decks', help='Directory to store downloaded artifacts named <file_id>.<ext>')
    ap.add_argument('--file-id', action='append', help='Specific Google file ID to fetch. Repeat flag to fetch multiple.')
    ap.add_argument('--limit', type=int, default=None, help='Limit number of deck IDs when fetching from deck_details.json')
    ap.add_argument('--pdf-only', action='store_true', help='Fetch PDF export only')
    ap.add_argument('--pptx-only', action='store_true', help='Fetch PPTX export only')
    ap.add_argument('--skip-meta', action='store_true', help='Skip Slides metadata fetch')
    ap.add_argument('--access-token', default=None, help='OAuth bearer token with Drive/Slides read scopes')
    ap.add_argument('--service-account-json', default=None, help='Path to service account JSON for server-to-server auth')
    ap.add_argument('--subject', default=None, help='Optional user email for domain-wide delegation impersonation')
    args = ap.parse_args()

    if args.pdf_only and args.pptx_only:
        raise SystemExit('Choose only one of --pdf-only or --pptx-only, or neither for both')

    data_dir = Path(args.data_dir)
    artifact_dir = Path(args.artifact_dir)
    deck_details = load_json(data_dir / 'deck_details.json')
    weeks = load_json(data_dir / 'weeks.json')
    file_ids = selected_file_ids(args, deck_details)
    access_token = resolve_access_token(args)

    manifest = fetch_and_save(
        deck_details=deck_details,
        weeks=weeks,
        data_dir=data_dir,
        artifact_dir=artifact_dir,
        file_ids=file_ids,
        fetch_pdf=not args.pptx_only,
        fetch_pptx=not args.pdf_only,
        fetch_meta=not args.skip_meta,
        access_token=access_token,
    )
    print(json.dumps(manifest['summary'], indent=2, ensure_ascii=False))


if __name__ == '__main__':
    cli()
