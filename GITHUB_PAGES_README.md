# GitHub Pages dual-deploy patch

This patch adds a free static deployment path with GitHub Pages while preserving Netlify compatibility in the same repository.

## What it adds

- `.github/workflows/deploy-pages.yml`
  - deploys the built `publish/` directory to GitHub Pages
  - runs on push to `main`
  - supports manual runs
  - supports a weekly scheduled refresh

- updated `netlify/build.sh`
  - remains Netlify-compatible
  - also produces static artifacts suitable for GitHub Pages
  - writes `.nojekyll`

- updated `netlify/generate_static_newsletters.js`
  - generates static newsletter files under `/newsletter/`
  - generates static discovery files like `/status.json`
  - generates a static API mirror under `/api/`

## GitHub setup

In GitHub repository settings:

1. Open **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**

## Required GitHub secrets

Add these under **Settings → Secrets and variables → Actions**:

- `SOURCE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

## Optional GitHub variable

Under **Variables**, add:

- `GOOGLE_FETCH_LIMIT` = `17`

## Resulting static outputs

After a successful Pages deployment, these will be available:

- `/`
- `/status.json`
- `/newsletter/default.html`
- `/newsletter/default.md`
- `/newsletter/default.json`
- `/newsletter/marketing-activity-30d.html`
- `/newsletter/marketing-activity-30d.md`
- `/newsletter/marketing-activity-30d.json`
- `/api/status.json`
- `/api/newsletter-default.json`
- `/api/newsletter-default.md`
- `/api/newsletter-marketing-activity-30d.json`
- `/api/newsletter-marketing-activity-30d.md`

## Netlify compatibility

This patch does not remove Netlify support.

- `netlify.toml` remains valid
- `netlify/build.sh` is still the shared build entry point
- when Netlify credits are restored, the same repo can continue deploying there
