This patch adds a manual stage-2 default newsletter writer for the current 30-day Everpure brief.

It does not change ingestion or the API logic.
It overwrites only the default static outputs after generation using a content-first brief:
- publish/newsletter/default.json
- publish/newsletter/default.md
- publish/newsletter/default.html
- publish/api/newsletter-default.json
- publish/api/newsletter-default.md
