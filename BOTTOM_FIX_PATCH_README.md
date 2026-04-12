This patch adds a very small post-generation cleanup step for the default newsletter.

What it does:
- deduplicates the final "What we should do next" list
- merges near-duplicate Knowledge Portal entries in "What is still in motion"
- removes any editorial recommendation/debug blocks from the public JSON if present

Add this line to netlify/build.sh after refine_default_newsletter.js and before fix_static_aliases.js:

node "$ROOT/netlify/fix_default_bottom.js" "$ROOT/publish"
