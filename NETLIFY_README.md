This refinement patch improves the default monthly newsletter issue for the live Everpure Netlify deployment.

What it changes:
- keeps the default issue settings at `30d + exec + strategic`
- reduces internal concept IDs in the executive narrative while preserving source references
- replaces the generic fallback theme label with a clearer executive-friendly label
- filters deck-backed evidence more aggressively so boilerplate is less likely to appear as supporting insight
- keeps the `marketing_activity_30d` preset for the marketing cadence/activity-log use case

After deploying, test with unique query strings:
- `/api/newsletter?ts=...`
- `/api/newsletter.md?ts=...`
- `/api/newsletter?preset=marketing_activity_30d&ts=...`
- `/api/newsletter.md?preset=marketing_activity_30d&ts=...`
