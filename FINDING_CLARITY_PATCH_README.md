This patch makes the default 30d + exec + strategic newsletter more specific and less generic.

Changes:
- Downgrades comparison-style threads like baselines and multi-variation tests out of "validated findings" unless a plain-language outcome is available
- Rewrites comparison sections to say what is actually known, e.g. that variants were compared but no winner is stated yet
- Tightens strategic theme language so it describes what the research is surfacing, not just that a signal exists
- Keeps the default monthly issue focused on what is actionable now versus what still needs another iteration

Replace:
- netlify/functions/api.js

Then commit and push. GitHub Pages should regenerate the static newsletter outputs automatically on the next successful Actions run.
