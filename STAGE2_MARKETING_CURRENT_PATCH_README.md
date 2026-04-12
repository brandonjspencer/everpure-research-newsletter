Everpure stage-2 marketing activity log patch

This patch adds a current-cycle stage-2 writer for the marketing activity log.
It rewrites only the static marketing activity outputs after the deterministic build.

Files rewritten:
- newsletter/marketing-activity-30d.json
- newsletter/marketing-activity-30d.md
- newsletter/marketing-activity-30d.html
- api/newsletter-marketing-activity-30d.json
- api/newsletter-marketing-activity-30d.md

This patch does not change ingestion, evidence packs, concept evidence, or the default exec brief.
