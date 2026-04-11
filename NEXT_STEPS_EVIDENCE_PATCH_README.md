# Everpure next-steps and evidence patch

This patch makes the default monthly newsletter more specific and action-oriented.

## What changed
- Replaces vague finding language with plain-English `finding_statement` fields where possible.
- Adds stronger evidence snapshots and supporting signals.
- Adds explicit next actions for validated findings, comparison tests, and active workstreams.
- Replaces the old implications-style section with a `next_actions` section in the newsletter output.
- Updates markdown rendering to emphasize findings, evidence, key signals, next steps, and confidence.

## Files
- `netlify/functions/api.js`
