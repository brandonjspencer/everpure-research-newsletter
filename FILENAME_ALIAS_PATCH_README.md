# Everpure filename alias patch

This patch fixes GitHub Pages static artifact filename mismatches by publishing hyphenated aliases alongside underscore-based JSON files.

## What it fixes

The build was publishing `data/deck_content.json`, but the site and review workflow expected `data/deck-content.json`.

This patch:
- copies `deck_content.json` to `deck-content.json`
- also creates a few other hyphenated aliases for consistency
- updates static homepage/index links to point at the hyphenated `deck-content.json` path

## How to apply

1. Copy `netlify/fix_static_aliases.js` into your repo under `netlify/`.
2. Update `netlify/build.sh` and add this near the end, after static artifacts are generated:

```bash
node netlify/fix_static_aliases.js publish
```

3. Commit and push.
