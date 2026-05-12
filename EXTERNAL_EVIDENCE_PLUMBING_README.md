# External Evidence Plumbing Patch

This patch connects the new deck-link / external-research evidence layer to the rest of the Research Roundup build.

## What it adds

### `netlify/merge_external_evidence_packs.js`

Reads `publish/data/external_research_evidence.json` and merges useful Google Sheet / Data Comparison signals into:

- `evidence_packs.json`
- `evidence-packs.json`
- `evidence_packs_default_30d.json`
- `evidence-packs-default-30d.json`

It does this conservatively by matching external evidence back to existing concept packs using concept titles, IDs, inferred concepts, deck titles, link text, and common topic aliases.

It adds fields such as:

- `external_evidence_count`
- `external_evidence_refs`
- `supporting_signals`
- `key_synthesis_signals`
- `supporting_numbers`
- `evidence_snapshot_rule_based`
- `external_evidence_merge_status`

It also writes:

- `publish/data/external_research_evidence_match_report.json`
- `publish/data/external-research-evidence-match-report.json`

### `netlify/external_evidence_observability.js`

Adds external evidence visibility after the static site is generated.

It updates:

- `publish/status.json`
- `publish/api/status.json`
- `publish/index.html`
- `publish/api/index.html`
- `publish/newsletter/index.html`

It adds counts such as:

- `deck_link_count`
- `google_sheet_link_count`
- `helio_link_count`
- `external_evidence_count`
- `external_sheet_success_count`
- `external_sheet_failure_count`
- `matched_external_evidence_count`
- `unmatched_external_evidence_count`
- `evidence_pack_external_match_count`

## Build order

The patch updates `netlify/build.sh` so the flow becomes:

1. Fetch Notion and deck artifacts.
2. Fetch Google Slides and external evidence.
3. Build evidence packs.
4. Merge external evidence into evidence packs.
5. Clean evidence signals.
6. Build concept evidence.
7. Generate static newsletter/site artifacts.
8. Add external evidence observability to status and discovery pages.

## Review URLs after deploy

Use cachebusters:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/status.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/external_research_evidence.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/external_research_evidence_match_report.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/evidence_packs_default_30d.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/concept_evidence_default_30d.json?cb=TIMESTAMP
```
