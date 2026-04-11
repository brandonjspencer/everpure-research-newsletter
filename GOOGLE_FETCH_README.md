# Google deck fetch: local run

This package can fetch Google Slides deck artifacts locally using a short-lived OAuth access token.

## Requirements
- Python 3.10+
- Internet access from your machine
- An OAuth access token with:
  - `https://www.googleapis.com/auth/drive.readonly`

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run the full local fetch

```bash
export ACCESS_TOKEN='ya29...'
./run_google_fetch.sh
```

That will:
1. Fetch deck metadata and PDF exports into `deck_artifacts/`
2. Refresh deck linkage outputs in `output/`
3. Ingest downloaded PDFs into `deck_content.json`

## Useful variants

Fetch only the first 2 decks:

```bash
export ACCESS_TOKEN='ya29...'
LIMIT=2 ./run_google_fetch.sh
```

Fetch PPTX instead of PDF:

```bash
export ACCESS_TOKEN='ya29...'
MODE=pptx ./run_google_fetch.sh
```

Skip Slides metadata and fetch PDFs only:

```bash
export ACCESS_TOKEN='ya29...'
SKIP_META=1 MODE=pdf ./run_google_fetch.sh
```

## Outputs
- `output/google_fetch_manifest.json`
- `output/deck_details.json`
- `output/deck_week_map.json`
- `output/deck_summary.json`
- `output/deck_content.json`
- `output/deck_content_summary.json`
