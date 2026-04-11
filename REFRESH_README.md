# Everpure Refresh Pipeline

This layer refreshes the parsed JSON from either:
- a public Notion URL, or
- a local HTML snapshot.

## Files
- `/mnt/data/everpure_refresh.py` — fetch + refresh pipeline
- `/mnt/data/everpure_raw/` — optional fetched HTML snapshots
- `/mnt/data/everpure_parsed/refresh_manifest.json` — most recent refresh manifest

## Refresh from a public Notion URL

```bash
python /mnt/data/everpure_refresh.py \
  --source-url 'https://majestic-carbon-753.notion.site/Everpure-1ef2e6d8924e4c3c827a8aa850802295?pvs=143' \
  --output-dir /mnt/data/everpure_parsed \
  --raw-dir /mnt/data/everpure_raw
```

## Force Playwright rendering

Use this if a plain HTTP fetch only returns a thin Notion shell.

```bash
python /mnt/data/everpure_refresh.py \
  --source-url 'https://majestic-carbon-753.notion.site/Everpure-1ef2e6d8924e4c3c827a8aa850802295?pvs=143' \
  --fetch-method playwright
```

## Refresh from an existing HTML snapshot

```bash
python /mnt/data/everpure_refresh.py \
  --html-path /mnt/data/Everpure.html \
  --output-dir /mnt/data/everpure_parsed
```

## Outputs

Each refresh regenerates:
- `metadata.json`
- `weeks.json`
- `decks.json`
- `summary.json`
- `newsletter_pack_90d.json`
- `refresh_manifest.json`

## Notes

- `requests` is attempted first in `auto` mode.
- If the HTML does not contain enough Notion block markers, the pipeline falls back to Playwright.
- Playwright may need to be installed separately:

```bash
pip install playwright
playwright install chromium
```
