Everpure Netlify deployment package

What this package does
- Runs the existing Python refresh and deck-ingestion pipeline during Netlify builds
- Publishes normalized JSON into publish/data
- Exposes API endpoints through Netlify Functions
- Supports an optional protected trigger endpoint that calls a Netlify build hook

Core environment variables
- SOURCE_URL
  Public Notion URL. If omitted, the build falls back to data/Everpure.html.
- GOOGLE_ACCESS_TOKEN
  Optional Google OAuth bearer token for deck PDF and metadata fetches.
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
- If GOOGLE_ACCESS_TOKEN is omitted, the site still builds from the Notion HTML snapshot or live SOURCE_URL.
