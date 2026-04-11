Everpure Actionable Next Steps Patch

This patch makes the default monthly newsletter more concrete and action-oriented.

What changes:
- reframes the exec issue from abstract implications to explicit next steps
- updates section titles so the default issue reads as:
  - What the research surfaced
  - Comparison tests worth acting on
  - What is still in motion
  - What we should do next
- adds evidence snapshots to called-out concepts
- surfaces key synthesis signals when deck text includes usable quantitative or outcome-oriented language
- makes each major concept answer:
  - what we saw
  - what evidence supports it
  - what we should do next
  - decision / confidence
- removes generic "leadership implications" positioning from the main markdown output

Copy into the repo:
- netlify/functions/api.js

Then commit and push:
  git add netlify/functions/api.js
  git commit -m "Make default newsletter more actionable and evidence-led"
  git push
