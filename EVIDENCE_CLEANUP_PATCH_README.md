# Everpure Evidence Cleanup Patch

This patch improves the build so the default newsletter uses the new evidence packs more effectively.

## What it does

1. Adds a `clean_evidence_signals.js` helper that:
   - removes obvious deck boilerplate and repeated OCR junk
   - prioritizes lines containing concrete evidence patterns such as:
     - percentages
     - uplift / increase / drop / decrease
     - comprehension / sentiment / engagement / clicks / conversion / frequency
     - winner / preferred / clearer / more credible / more engaging
   - writes cleaned evidence outputs back into:
     - `publish/data/evidence_packs.json`
     - `publish/data/evidence_packs_default_30d.json`
     - hyphenated aliases if they exist

2. Updates the newsletter synthesis expectations:
   - prefer `clean_supporting_signals`
   - prefer `clean_key_numbers`
   - suppress generic lines like `UX Metrics ● ...`

## Install

Copy the file into the repo:

```bash
cp ~/Desktop/everpure-evidence-cleanup/everpure_evidence_cleanup_patch/netlify/clean_evidence_signals.js ~/everpure-research-newsletter/netlify/
```

Then add this line in `netlify/build.sh` **after** the evidence-pack build step and **before** newsletter/static output finalization if possible:

```bash
node "$ROOT/netlify/clean_evidence_signals.js" "$ROOT/publish"
```

If the current build script generates newsletters before evidence packs are cleaned, move newsletter generation to run after the clean step.

## Commit

```bash
git add netlify/clean_evidence_signals.js netlify/build.sh EVIDENCE_CLEANUP_PATCH_README.md
git commit -m "Clean evidence-pack signals before newsletter synthesis"
git push
```
