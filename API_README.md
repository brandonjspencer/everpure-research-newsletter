# Everpure Parsed Data API

This API sits on top of the normalized JSON emitted by the Everpure build pipeline.

## Run locally

```bash
python everpure_api.py --data-dir ./output serve --host 127.0.0.1 --port 8000
```

## Endpoints

- `GET /health`
- `GET /metadata`
- `GET /decks`
- `GET /deck-summary`
- `GET /deck-details`
- `GET /deck-details/<file_id>`
- `GET /deck-content`
- `GET /deck-content/<file_id>`
- `GET /weeks?since=YYYY-MM-DD&until=YYYY-MM-DD&q=...&deck_id=...&section_family=...`
- `GET /weeks/<record_id-or-date>`
- `GET /findings?since=YYYY-MM-DD&until=YYYY-MM-DD&group=findings&q=...`
- `GET /summary?since=YYYY-MM-DD&until=YYYY-MM-DD`

## Build a newsletter pack

```bash
python everpure_api.py \
  --data-dir ./output \
  build-pack \
  --since 2026-01-10 \
  --until 2026-04-10 \
  --out ./output/newsletter_pack_90d.json
```
