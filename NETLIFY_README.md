Everpure Netlify deployment package

What this package does
- Runs the existing Python refresh and deck-ingestion pipeline during Netlify builds
- Publishes normalized JSON into publish/data
- Exposes API endpoints through Netlify Functions
- Supports an optional protected trigger endpoint that calls a Netlify build hook

Core environment variables
- SOURCE_URL
  Public Notion URL. If omitted, the build falls back to data/Everpure.html.
- GOOGLE_CLIENT_ID
  Preferred for stable Google auth. OAuth client ID used with refresh-token flow.
- GOOGLE_CLIENT_SECRET
  Preferred for stable Google auth. OAuth client secret used with refresh-token flow.
- GOOGLE_REFRESH_TOKEN
  Preferred for stable Google auth. OAuth refresh token used to mint a fresh access token during each build.
- GOOGLE_ACCESS_TOKEN
  Legacy fallback only. Short-lived bearer token.
- GOOGLE_FETCH_LIMIT
  Optional integer to limit deck fetch count during testing.
- NETLIFY_BUILD_HOOK_URL
  Optional build hook URL used by the trigger-build function.
- REFRESH_TRIGGER_SECRET
  Shared secret required to call /admin/trigger-build.

Deploy steps
1. Push this folder to a Git repository.
2. Create a new Netlify site from that repository.
3. In Site configuration, set the build command to the value from netlify.toml or leave it as-is.
4. Add the environment variables you want to use.
5. Deploy the site.

Useful endpoints after deploy
- /api/health
- /api/metadata
- /api/weeks
- /api/findings
- /api/summary
- /api/decks
- /api/deck-summary
- /api/deck-details
- /api/deck-content

Manual build trigger
- Configure NETLIFY_BUILD_HOOK_URL and REFRESH_TRIGGER_SECRET.
- Then call:
  /admin/trigger-build?secret=YOUR_SECRET

Local notes
- The build step installs Python dependencies from requirements.txt.
- If Google refresh-token credentials are present, the build exchanges them for a fresh access token automatically.
- If GOOGLE_ACCESS_TOKEN is omitted and refresh-token credentials are absent, the site still builds from the Notion HTML snapshot or live SOURCE_URL.
