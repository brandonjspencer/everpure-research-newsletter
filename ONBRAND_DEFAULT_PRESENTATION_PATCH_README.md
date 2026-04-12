Everpure On-Brand Default Newsletter Presentation Patch

What this patch does
- Replaces the current-cycle stage-2 default brief HTML presentation with an on-brand layout inspired by the uploaded Figma Make newsletter design.
- Preserves the current JSON and Markdown outputs for the default brief.
- Keeps the existing build pipeline intact by updating only `netlify/render_stage2_default_current.js`.

Why this approach
- The uploaded Figma Make file is a React/Vite project.
- The current repo publishes static artifacts through the existing build scripts.
- The safest integration is to port the design language into the stage-2 HTML writer instead of introducing a new React build path.

Design elements carried over
- dark split masthead
- editorial stats grid
- orange summary band
- numbered findings dispatch layout
- dark comparison section
- mint unresolved-questions section
- cream next-actions section
- on-brand color palette and typography treatment

Apply
1. Copy `netlify/render_stage2_default_current.js` into the repo's `netlify/` directory.
2. Commit and push.
3. Let the existing build run.

Expected result
- `newsletter/default.html` renders with the on-brand newsletter presentation.
- `newsletter/default.json` and `newsletter/default.md` continue to publish as before.
