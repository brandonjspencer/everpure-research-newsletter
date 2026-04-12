# Everpure stage-2 marketing grouping patch

This patch replaces only the current-cycle marketing stage-2 writer.

It tightens semantic grouping in the marketing activity log by:
- grouping child page feedback under parent workstreams
- suppressing one-mention items from repeated research threads
- collapsing event comparison variants into one comparison track
- clarifying the snapshot deck label as site-corpus deck coverage

## Files
- `netlify/render_stage2_marketing_current.js`

## Apply
Copy the replacement script into `netlify/`, commit, and push.
