# Concept-specific Evidence Matching Patch

This patch adds a deterministic concept-evidence layer so the newsletter stops reusing generic or cross-concept proof points.

It creates:
- `publish/data/concept_evidence_default_30d.json`
- `publish/data/concept-evidence-default-30d.json`

Each concept record includes:
- concept metadata
- matched evidence lines
- matched numbers
- a summary hint
- a next-step hint
- confidence and decision status

## Add to build

Add this line to `netlify/build.sh` **after** the evidence cleanup step and **before** `fix_static_aliases.js`:

```bash
node "$ROOT/netlify/build_concept_evidence.js" "$ROOT/publish"
```

## Purpose

This file becomes a stronger stage-1 substrate for the manual stage-2 synthesis pass in chat.
