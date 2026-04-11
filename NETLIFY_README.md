This patch improves discovery and stability for reviewing newsletter outputs in future chats.

What it adds:
- stable named API routes:
  - /api/newsletter-default
  - /api/newsletter-default.md
  - /api/newsletter-marketing-activity-30d
  - /api/newsletter-marketing-activity-30d.md
- richer /api/status output with discovery links for both API routes and static artifacts
- static newsletter artifacts generated during every build:
  - /newsletter/default.json
  - /newsletter/default.md
  - /newsletter/default.html
  - /newsletter/marketing-activity-30d.json
  - /newsletter/marketing-activity-30d.md
  - /newsletter/marketing-activity-30d.html
- refreshed homepage links so the current outputs are easy to find without manually pasting query-string URLs

Files to replace in the repo:
- netlify/functions/api.js
- netlify/build.sh
- netlify/generate_static_newsletters.js
- NETLIFY_README.md

After deploy, the easiest routes to review are:
- /api/status?ts=...
- /api/newsletter-default?ts=...
- /api/newsletter-default.md?ts=...
- /api/newsletter-marketing-activity-30d?ts=...
- /api/newsletter-marketing-activity-30d.md?ts=...
- /newsletter/
