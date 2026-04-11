# Everpure Netlify patch: newsletter quality defaults

This patch upgrades the newsletter synthesis layer in two ways:

1. Sets the practical default issue to:
   - `window=30d`
   - `audience=exec`
   - `tone=strategic`

2. Adds a marketing-friendly activity-log preset:
   - `preset=marketing_activity_30d`

## Primary endpoints

### Default monthly leadership brief
- `/api/newsletter?ts=<unique>`
- `/api/newsletter.md?ts=<unique>`

These now default to a 30-day executive strategic issue if window/audience/tone are omitted.

### Explicit executive monthly combination
- `/api/newsletter?window=30d&audience=exec&tone=strategic&ts=<unique>`

### Marketing activity log preset
- `/api/newsletter?preset=marketing_activity_30d&ts=<unique>`
- `/api/newsletter.md?preset=marketing_activity_30d&ts=<unique>`

This variant emphasizes cadence, weekly activity, and volume of testing over strategic compression.

## Important

Always use a unique `ts` query string when checking the deployed API.
