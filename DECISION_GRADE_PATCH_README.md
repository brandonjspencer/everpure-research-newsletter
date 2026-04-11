This patch upgrades the default 30d + exec + strategic newsletter to be more decision-grade.

Changes:
- Adds explicit decision logic: ship / iterate / watch
- Adds confidence levels
- Adds a dedicated comparison-tests section
- Makes the default issue clearer about when there is NOT enough confidence to ship
- Adds activity-log support fields for the marketing preset without removing Netlify or GitHub Pages compatibility

Replace:
- netlify/functions/api.js

Then commit and push. GitHub Pages and Netlify-compatible builds will regenerate the static outputs automatically on the next build.
