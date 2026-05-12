# Deck Link Smoke Test

This patch adds a deterministic smoke test for research links embedded inside fetched Google Slides decks.

## What it does

During the GitHub/Netlify build, after Google Slides artifacts are fetched, the new script:

1. Reads the saved Google Slides metadata JSON files from `deck_artifacts/`.
2. Extracts hyperlinks from text runs, shapes, images, and other linked objects.
3. Resolves Google redirect URLs to their final targets.
4. Classifies links by source type:
   - `google_sheet`
   - `google_doc`
   - `google_slides`
   - `helio_report`
   - `helio_compare`
   - `helio`
   - `figma`
   - `notion`
   - `other`
5. Smoke-tests Google Sheet/Data Comparison links using Drive CSV export and the same OAuth token used for deck fetching.
6. Inventories Helio links without fetching Helio content.

## Outputs

The build writes these files into `publish/data/`:

- `deck_links.json`
- `deck-links.json`
- `deck_link_fetch_status.json`
- `deck-link-fetch-status.json`
- `external_research_evidence_smoke.json`
- `external-research-evidence-smoke.json`

## Privacy and scope

This is a discovery/smoke-test layer, not a full evidence-ingestion layer yet. It stores conservative summaries of Google Sheet content by default:

- headers
- sampled row/column counts
- numeric values found in the sampled CSV
- a short redacted text excerpt

It does not store full raw CSVs by default. To include up to five redacted sample rows during a diagnostic run, set:

```bash
EXTERNAL_EVIDENCE_SMOKE_INCLUDE_ROWS=1
```

## Environment controls

```bash
EXTERNAL_EVIDENCE_SHEET_FETCH_LIMIT=8
EXTERNAL_EVIDENCE_SMOKE_MAX_ROWS=40
EXTERNAL_EVIDENCE_SMOKE_MAX_COLUMNS=16
EXTERNAL_EVIDENCE_SMOKE_INCLUDE_ROWS=0
```

## How to review after a build

Use cache-busted URLs:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/data/deck_links.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/deck_link_fetch_status.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/external_research_evidence_smoke.json?cb=TIMESTAMP
```

Pass criteria for the smoke test:

- `deck_links.json` shows Google Sheet/Data Comparison links and Helio links.
- `deck_link_fetch_status.json` shows at least one successful Google Sheet fetch if the linked sheets are accessible to the OAuth account.
- `external_research_evidence_smoke.json` includes useful headers, numbers, and short excerpts from accessible data-comparison sheets.
- Helio links are classified but not fetched.

## Next likely phase

After one build, inspect the new artifacts and decide whether to merge Google Sheet evidence into `build_evidence_packs.js`. Helio ingestion should remain a separate phase until we know whether the shared Helio URLs expose accessible report data in GitHub Actions.
