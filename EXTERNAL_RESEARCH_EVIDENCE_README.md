# External Research Evidence Ingest

This patch adds a deterministic enrichment step for research evidence linked from Google Slides decks.

## What it does

- Reads fetched Google Slides metadata from `deck_artifacts/*.json`.
- Extracts embedded links from slide text runs and other metadata fields.
- Classifies links by source type: Google Sheets/Data Comparison, Google Docs, Helio reports/compare links, Figma, Notion, etc.
- Fetches Google Sheets/Data Comparison sources using the same Google OAuth credentials used for deck fetching.
- Samples headers, notable rows, percentages, scores, ratings, quotes, and other research-signal rows.
- Writes structured artifacts into `publish/data/`.
- Augments `deck_content.json` so the existing evidence-pack builder can use the richer linked-sheet evidence.

## What it does not do yet

- It does not fetch Helio report content. Helio links are inventoried only.
- It does not make the build fail if a linked sheet is inaccessible. Failures are recorded in fetch-status artifacts.
- It does not store secrets or ask for secrets in the repo.

## New artifacts

- `publish/data/deck_links.json`
- `publish/data/deck-link-fetch-status.json`
- `publish/data/deck_link_fetch_status.json`
- `publish/data/external_research_evidence.json`
- `publish/data/external-research-evidence.json`
- `publish/data/external_research_evidence_summary.json`
- `publish/data/external-research-evidence-summary.json`

## Build position

The script runs after Google deck fetch + PDF deck-content ingest, and before `netlify/build_evidence_packs.js`. This lets linked Google Sheet evidence be appended to `deck_content.json` before evidence packs are built.

## Useful environment variables

- `EXTERNAL_EVIDENCE_SHEET_FETCH_LIMIT` default `20`
- `EXTERNAL_EVIDENCE_MAX_ROWS` default `80`
- `EXTERNAL_EVIDENCE_MAX_COLUMNS` default `26`
- `EXTERNAL_EVIDENCE_MAX_SHEETS_PER_FILE` default `5`
- `EXTERNAL_EVIDENCE_STRICT` default `0`; set to `1` to make failures block the build
