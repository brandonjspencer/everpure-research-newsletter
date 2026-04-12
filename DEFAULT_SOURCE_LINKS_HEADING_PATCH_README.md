# Everpure default brief source-links and unresolved-heading patch

This patch updates only the current-cycle stage-2 default brief writer.

What it changes:
- adds subtle `Source deck` links to each Research Findings and Meaningful Comparisons module
- standardizes confidence copy to `Medium confidence` / `High confidence` / `Low confidence`
- changes the first unresolved card from a scope-only heading to a clearer workstream title plus scope line:
  - `Design & UX feedback`
  - `Homepage · Landing · Reader · Search · Header`

It only replaces:
- `netlify/render_stage2_default_current.js`
