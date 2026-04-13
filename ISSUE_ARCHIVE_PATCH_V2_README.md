# Everpure Issue Archive Patch v2

This patch fixes the archive publisher logging bug and adds archive discovery links to the GitHub Pages homepage and discovery lists.

What it includes:
- `netlify/publish_issue_archives.js`
  - fixes the `issue_count` / `issueCount` variable mismatch that caused the build failure
- `netlify/generate_static_newsletters.js`
  - adds `/issues/index.html` and `/data/issues.json` to homepage/discovery links

Apply by copying both files into the repo, then committing and pushing.
