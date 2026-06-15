# Notion Fetch Fallback

This patch makes the monthly build resilient to temporary Notion rendering failures in GitHub Actions.

## Behavior

1. The build still tries to fetch the live Notion source first.
2. If the live fetch fails, `everpure_refresh.py` reuses the existing parsed source outputs in `publish/data` when they are available.
3. The refresh manifest records `source_fallback: existing_outputs` and includes the original fetch error.
4. The build completes so downstream deck fetch, evidence pack generation, and stage-2 rendering can still run.

## Important

A fallback build is not proof that the source data is fresh. Before drafting a new issue, check `publish/data/refresh_manifest.json` or live `status.json` for the source fallback marker and verify the latest week/date range.

If fallback was used and the issue must include new Notion entries, obtain a fresh HTML snapshot manually or rerun once Notion is available.
