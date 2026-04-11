Everpure build package

Contents
- Parser, refresh, API, deck-normalization, deck-PDF ingestion, and Google deck-fetch scripts
- Sample source HTML export in data/
- Current generated outputs in output/
- requirements.txt
- run_all.sh

Quick start
1. Create a virtual environment
2. Install dependencies: pip install -r requirements.txt
3. Rebuild outputs: ./run_all.sh
4. Start the API:
   python everpure_api.py --data-dir ./output serve --port 8000

Deck workflows
- Local PDFs already exported from Google Slides:
  python everpure_deck_content_ingest.py --data-dir ./output --pdf-dir ./deck_artifacts
- Google-authenticated fetch path:
  python everpure_google_fetch.py --data-dir ./output --artifact-dir ./deck_artifacts --access-token "$GOOGLE_OAUTH_ACCESS_TOKEN"

Useful endpoints
- /weeks
- /findings
- /summary
- /decks
- /deck-summary
- /deck-details
- /deck-content
