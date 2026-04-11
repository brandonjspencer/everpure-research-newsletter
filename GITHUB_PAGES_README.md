# GitHub Pages relative-links patch

This patch fixes GitHub Pages project-site navigation by changing generated static links from root-relative paths like `/newsletter/default.html` to relative paths like `newsletter/default.html`.

Why this matters:
- GitHub Pages project sites live under `/<repo-name>/`
- root-relative links skip that repo path and 404
- relative links work on both GitHub Pages and Netlify

Files updated:
- `netlify/generate_static_newsletters.js`
