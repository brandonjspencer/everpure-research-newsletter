# Everpure Evidence Pack Patch

This patch adds a deterministic evidence-pack generation layer for the newsletter build.

## What it adds

The new script generates these static artifacts into `publish/data/`:

- `evidence_packs.json`
- `evidence-packs.json`
- `evidence_packs_default_30d.json`
- `evidence-packs-default-30d.json`

These files are designed to act as the deterministic substrate for the stage-2 ChatGPT synthesis pass.

## Apply the patch

1. Copy `netlify/build_evidence_packs.js` into the repo's `netlify/` directory.
2. Update `netlify/build.sh` to run:

```bash
node "$ROOT/netlify/build_evidence_packs.js" "$ROOT/publish"
```

Place it after the deck-content/static newsletter generation steps and before any static alias fix step.

## Output shape

Each evidence pack includes:
- `concept_id`
- `concept_title`
- `weeks_seen`
- `source_refs`
- `raw_finding_excerpts`
- `supporting_numbers`
- `comparison_cues`
- `behavioral_signals`
- `deck_refs`
- `rule_based_status`
- `rule_based_next_step`
- `rule_based_confidence`

## Purpose

This patch does not replace the newsletter output yet. It creates a cleaner, auditable intermediate layer that can be used for stronger stage-2 synthesis in future builds.
