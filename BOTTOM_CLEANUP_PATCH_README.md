This micro-patch cleans the remaining bottom-of-page issues in the default newsletter.

What it changes
- de-duplicates the final "What we should do next" list more aggressively
- merges near-duplicate Knowledge Portal items in "What is still in motion"
- keeps the rest of the default issue structure unchanged

How to apply
1. Copy netlify/refine_default_newsletter.js into your repo at netlify/refine_default_newsletter.js
2. Commit and push
3. Let GitHub Pages rebuild
