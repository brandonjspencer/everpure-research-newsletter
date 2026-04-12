This patch replaces only netlify/render_stage2_marketing_current.js.

Purpose:
- Render the marketing activity log as a proper HTML page instead of markdown-like preformatted text
- Remove internal editorial/debug sections from the public artifact
- Correct the nested defaults metadata to marketing / detailed
- Keep the content focused on cadence, throughput, weekly activity, repeated threads, and comparisons in flight

No build.sh changes are required if the repo already calls:
  node "$ROOT/netlify/render_stage2_marketing_current.js" "$ROOT/publish"
