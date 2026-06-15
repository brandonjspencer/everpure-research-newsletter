# Source Snapshot Fallback

The GitHub Pages build still attempts the live Notion fetch first.

If the live Notion fetch fails, the build now uses the committed `data/Everpure.html` snapshot before falling back to existing parsed outputs.

This prevents a successful build from silently reusing stale parsed newsletter data when a fresher manually exported Notion snapshot is available.

Expected status behavior:
- Live fetch succeeds: `source_fetch_method` should be `playwright` or `requests`.
- Live fetch fails but snapshot exists: `source_fetch_method` should be `local_html_fallback`.
- Snapshot is missing and existing outputs are reused: `source_fetch_method` may be `fallback_existing_outputs`.
