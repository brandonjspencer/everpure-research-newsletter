# Everpure output cleanup patch

This patch does two things:

1. Cleans up the default static newsletter output:
- de-duplicates the `What we should do next` list
- removes public-facing editorial/debug recommendation blocks
- removes generic deck-backed evidence blocks from the public default issue
- re-renders `newsletter/default.json`, `newsletter/default.md`, and `newsletter/default.html` from the concept-evidence layer

2. Expands GitHub Pages discovery:
- homepage links to all key newsletter outputs, API mirrors, and data artifacts
- `api/index.html` includes all key mirrors and data artifacts
- `newsletter/index.html` remains the main newsletter directory

## Files included
- `netlify/refine_default_newsletter.js`
- `netlify/generate_static_newsletters.js`

## Build order note
Ensure `netlify/build.sh` runs:
1. `generate_static_newsletters.js`
2. `refine_default_newsletter.js`
3. `fix_static_aliases.js`

If the refine step is missing, add:

```bash
node "$ROOT/netlify/refine_default_newsletter.js" "$ROOT/publish"
```

right after the `generate_static_newsletters.js` step.
