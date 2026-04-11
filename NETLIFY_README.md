# Netlify freshness patch

This patch updates the API function to:
- send explicit no-store headers on every `/api/*` response
- expose freshness details in response headers
- add a `/api/status` endpoint for quick verification of the latest dataset
- include `_meta` freshness info on object-shaped responses like `/api/health` and `/api/summary`

## New response headers
- `Cache-Control: no-store, max-age=0, must-revalidate`
- `CDN-Cache-Control: no-store`
- `Netlify-CDN-Cache-Control: no-store`
- `Netlify-Vary: query`
- `X-Generated-At`
- `X-Source-Fetched-At`
- `X-Latest-Week-Date`
- `X-Week-Count`
- `X-Deck-Content-Count`
- `X-Build-Id`
- `X-Deploy-Id`

## Quick verification
Open:
- `/api/status`
- `/api/summary?ts=<unique-value>`
- `/api/weeks?ts=<unique-value>`

Using a unique `ts` query string is a convenient cache-busting check.


Newsletter endpoints:
- /api/newsletter?window=30d
- /api/newsletter?window=90d
- /api/newsletter.md?window=90d
- /api/newsletter?window=90d&format=markdown

Freshness check:
- /api/status?ts=<unique-value>
- use a unique query string when validating fresh deploy data
