# Strict proof-point filter patch

This patch does two things:

1. Updates `netlify/functions/api.js` so the default monthly newsletter prefers concept-scoped evidence from `concept_evidence_default_30d.json` and only promotes a concept into the lead findings when it has a strong proof point.
2. Updates `netlify/build.sh` so static newsletter generation happens **after** evidence packs, cleaned evidence, and concept evidence are built.

## Why this patch matters

The previous build generated the static newsletter before the evidence-pack / concept-evidence layers were built, so the GitHub Pages default brief could not fully benefit from the newer deterministic evidence substrate.

This patch fixes that ordering problem and adds a stricter proof-point gate so concepts without concept-specific proof points get downgraded to work in motion rather than promoted into the lead findings.
