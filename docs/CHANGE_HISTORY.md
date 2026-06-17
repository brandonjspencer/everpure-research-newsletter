# Change History (Distilled)

> This file consolidates ~45 individual `*_PATCH_README.md` / `*_README.md` notes that
> previously lived in the repo root (a ChatGPT-era workflow artifact). It captures **why**
> the code looks the way it does. The original per-patch files were removed in the
> Claude Code transition; their content is preserved here. Component/usage docs live in
> [ARCHITECTURE.md](ARCHITECTURE.md); operating procedure lives in [OPERATIONS.md](OPERATIONS.md).

---

## Source ingestion & Notion fallback

The pipeline ingests a Notion "Everpure" page and normalizes it to JSON, with progressively hardened fallback behavior added over time.

- The original parser (`everpure_parser.py`) parses a **saved Notion HTML export** (not a live page) into `metadata.json`, `weeks.json`, `decks.json`, `summary.json`, `manifest.json`. Each weekly record carries `record_id`, `week_date`, `section_family`, `deck`, `content_groups` (findings, testing_concepts, in_process, initiatives_on_deck, weekly_progress, needs, next_steps, other), with nested bullets preserved via `children` + `level`.
- `everpure_refresh.py` added a live-fetch layer that pulls from a public Notion URL or a local HTML snapshot, regenerating the JSON plus `newsletter_pack_90d.json` and `refresh_manifest.json`. It tries `requests` first in `auto` mode and **falls back to Playwright** when the HTML lacks enough Notion block markers (Notion often returns a thin shell over plain HTTP).
- **Notion fetch fallback:** the monthly GitHub Actions build became resilient to transient Notion failures — if the live fetch fails, `everpure_refresh.py` reuses existing parsed outputs in `publish/data`, records `source_fallback: existing_outputs` in the refresh manifest with the original error, and lets the build complete so downstream steps still run.
- **Source snapshot fallback:** inserted a committed `data/Everpure.html` snapshot as a middle tier — live fetch first, then the committed snapshot, then existing parsed outputs. This stops the build from silently reusing stale data when a fresher manual export is available. Status markers: `source_fetch_method` = `playwright`/`requests` (live), `local_html_fallback` (snapshot), or `fallback_existing_outputs` (reused outputs).
- **Source snapshot validation:** the build now validates `data/Everpure.html` before trusting it — the snapshot is accepted only if it parses into **at least one weekly record and a latest source date**; otherwise it falls back to existing outputs rather than deploying a blank/empty newsletter.

## Deck pipelines & Google fetch

A parallel pipeline ingests the Google Slides decks linked from the Notion page.

- `everpure_deck_ingest.py` normalizes decks → `deck_details.json` (one record per unique deck), `deck_week_map.json` (file_id → weeks), `deck_summary.json` (coverage stats). Accepts local artifacts named by Google file ID (`.pdf/.pptx/.txt/.json/.html`).
- `everpure_deck_content_ingest.py` extracts text from exported deck PDFs → `deck_content.json`, `deck_content_summary.json`.
- `everpure_google_fetch.py` pulls Slides metadata + PDF/PPTX exports into `deck_artifacts/` via OAuth access token, service-account JSON, or domain-wide delegation (`--subject`). Requires `drive.readonly` scope. `run_google_fetch.sh` wraps the full local fetch (metadata + PDFs → linkage refresh → PDF ingest) with `LIMIT`, `MODE=pptx/pdf`, and `SKIP_META` knobs.

## External research evidence (deck links → Google Sheets)

A multi-phase effort to mine the research links embedded _inside_ the decks.

- **Deck link smoke test** (`everpure_deck_link_smoke.py`): after Slides fetch, reads `deck_artifacts/` metadata, extracts hyperlinks from text runs/shapes/images, resolves Google redirect URLs, and classifies them (`google_sheet`, `google_doc`, `google_slides`, `helio_report`, `helio_compare`, `helio`, `figma`, `notion`, `other`). Smoke-tests Google Sheet/Data Comparison links via Drive CSV export using the same OAuth token; **inventories Helio links without fetching them**. Writes `deck_links.json`, `deck_link_fetch_status.json`, `external_research_evidence_smoke.json` (+ hyphenated aliases). Stores conservative summaries by default (headers, row/col counts, numeric values, short redacted excerpt) — no full raw CSVs; `EXTERNAL_EVIDENCE_SMOKE_INCLUDE_ROWS=1` adds up to 5 redacted sample rows for diagnostics.
- **External research evidence ingest** (`everpure_external_research_ingest.py`): the production version — fetches the classified Google Sheets, samples headers/rows/percentages/scores/ratings/quotes, writes `external_research_evidence.json` (+ summary + aliases), and **augments `deck_content.json`** so the evidence-pack builder can use linked-sheet evidence. Runs after deck fetch + PDF ingest and **before** `build_evidence_packs.js`. Does not fetch Helio; non-blocking on inaccessible sheets unless `EXTERNAL_EVIDENCE_STRICT=1`. Tunable via `EXTERNAL_EVIDENCE_SHEET_FETCH_LIMIT`, `_MAX_ROWS`, `_MAX_COLUMNS`, `_MAX_SHEETS_PER_FILE`.
- **External evidence plumbing:** added `netlify/merge_external_evidence_packs.js` to conservatively match external sheet signals back to concept packs (by concept title/ID, inferred concepts, deck titles, link text, topic aliases) and merge them into all four evidence-pack files, emitting an `external_research_evidence_match_report.json`. Also added `netlify/external_evidence_observability.js` to inject counts (deck_link_count, google_sheet_link_count, helio_link_count, matched/unmatched external evidence, etc.) into `status.json`, `api/status.json`, and the index HTML pages. This patch defined the canonical build order (see ARCHITECTURE.md).

## Evidence packs & concept evidence (the deterministic "stage-1 substrate")

A deterministic intermediate layer was built so the human/AI "stage-2" synthesis would stop hallucinating or reusing generic proof points.

- **Evidence packs** (`netlify/build_evidence_packs.js`): emits `evidence_packs.json` / `evidence_packs_default_30d.json` (+ hyphenated aliases). Each pack: `concept_id`, `concept_title`, `weeks_seen`, `source_refs`, `raw_finding_excerpts`, `supporting_numbers`, `comparison_cues`, `behavioral_signals`, `deck_refs`, `rule_based_status`, `rule_based_next_step`, `rule_based_confidence`. Explicitly an auditable substrate — did **not** replace newsletter output.
- **Evidence cleanup** (`netlify/clean_evidence_signals.js`): strips deck boilerplate/OCR junk and prioritizes lines with concrete patterns (percentages; uplift/increase/drop/decrease; comprehension/sentiment/engagement/clicks/conversion/frequency; winner/preferred/clearer/more credible/more engaging). Writes `clean_supporting_signals` / `clean_key_numbers` back into the pack files; synthesis should prefer these and suppress generic `UX Metrics ● …` lines.
- **Concept evidence** (`netlify/build_concept_evidence.js`): emits `concept_evidence_default_30d.json` (+ hyphenated alias) — a per-concept record with matched evidence lines, matched numbers, a summary hint, a next-step hint, confidence, and decision status. Intended as a stronger stage-1 substrate for the manual stage-2 pass. Runs after evidence cleanup, before `fix_static_aliases.js`.

## Default newsletter content evolution (API-driven era → stage-2 writer era)

The default monthly "exec/strategic 30-day" brief went through a long content-quality arc. **Early changes edited the live API logic** (`netlify/functions/api.js`); **later the team deliberately stopped touching the API** and moved to post-generation rewriting.

- **Decision-grade** (edits `api.js`): added explicit ship/iterate/watch decision logic, confidence levels, a dedicated comparison-tests section, and "not enough confidence to ship" language. Kept Netlify + GitHub Pages compatibility.
- **Finding clarity** (edits `api.js`): downgraded comparison/baseline/multi-variation threads out of "validated findings" unless a plain-language outcome exists; rewrote comparison copy to state "variants compared, no winner stated yet"; tightened strategic-theme language.
- **Actionable next steps** (edits `api.js`): reframed from abstract implications to explicit next steps; standardized default section titles (What the research surfaced / Comparison tests worth acting on / What is still in motion / What we should do next); made each concept answer what-we-saw / what-evidence / what-next / decision-confidence; removed "leadership implications" positioning.
- **Next-steps evidence** (edits `api.js`): added plain-English `finding_statement` fields, stronger evidence snapshots, and a `next_actions` section replacing the implications section.
- **Strict proof-point filter** (edits `api.js` **and** `build.sh`): made the default brief prefer concept-scoped evidence from `concept_evidence_default_30d.json` and only promote a concept to lead findings when it has a strong proof point. Critically, **reordered the build** so static newsletter generation runs _after_ evidence packs / clean evidence / concept evidence (previously the newsletter was generated before the substrate existed).
- **Refine default** (`netlify/refine_default_newsletter.js`): the pivot to post-generation refinement — a safer pattern that does **not** touch the API; it reads `concept-evidence-default-30d` and rewrites the static `default.json/.md/.html`, promoting strong-proof concepts and demoting weak ones to "What is still in motion."
- **Output cleanup:** via `refine_default_newsletter.js` + `generate_static_newsletters.js`, de-duplicated the "What we should do next" list, removed public editorial/debug recommendation blocks and generic deck-backed evidence, and re-rendered the default files from the concept-evidence layer; expanded homepage/`api`/`newsletter` discovery links.
- **Bottom fix / bottom cleanup** (`netlify/fix_default_bottom.js`): a small post-gen step (run after `refine_default_newsletter.js`, before `fix_static_aliases.js`) that more aggressively de-dupes the final "What we should do next" list, merges near-duplicate Knowledge Portal items in "What is still in motion," and strips any editorial/debug blocks from public JSON.

## Stage-2 default writer (current-cycle, content-first)

Once the deterministic substrate existed, a hand-authored "stage-2" writer took over the current month's default brief, overwriting static outputs post-build. Files touched: `newsletter/default.{json,md,html}` and `api/newsletter-default.{json,md}`.

- **Stage-2 default current** (`netlify/render_stage2_default_current.js`): introduced the manual content-first writer; does not change ingestion or API logic, only overwrites the default static outputs.
- **Tighten v1 & v2:** shortened/sharpened proof points, added explicit decision criteria to comparison tests, reframed work-in-motion as unresolved questions, and avoided duplicated bottom-rollup language.

## On-brand presentation & typography (default writer HTML)

The default brief's HTML was restyled to match an uploaded **Figma Make** newsletter design — all via `render_stage2_default_current.js`, deliberately avoiding a new React/Vite build path.

- **On-brand presentation:** ported the Figma Make design language into the stage-2 HTML writer — dark split masthead, editorial stats grid, orange summary band, numbered findings dispatch layout, dark comparison section, mint unresolved section, cream next-actions section, on-brand palette/type. JSON + MD outputs preserved.
- **On-brand exact match:** aligned section titles to the uploaded component (Research Findings / Meaningful Comparisons / What Is Still Unresolved / Recommended Actions) and renamed surfaced-finding sublabels from `Proof point` / `What we should do next` to `Evidence` / `Direction`.
- **Comparisons layout:** switched Meaningful Comparisons from side-by-side cards to the same vertical editorial dispatch layout as Research Findings, keeping dark section styling.
- **Familjen font:** switched the default presentation font to Familjen Grotesk loaded from Google Fonts.
- **Source-link placement & wording:** iteratively positioned a subtle "Source deck" link per module (ending up inline at the end of each module's opening summary paragraph), standardized confidence copy to `Low/Medium/High confidence`, replaced the first unresolved card's scope-only heading with a workstream title + scope line (`Design & UX feedback` / `Homepage · Landing · Reader · Search · Header`), and removed internal concept-number references in favor of reader-facing "Findings suggest" / "Evidence suggests."

## Stage-2 marketing activity log

A second artifact — the marketing-focused "activity log 30d" — got its own current-cycle writer (`netlify/render_stage2_marketing_current.js`), overwriting `newsletter/marketing-activity-30d.{json,md,html}` and `api/newsletter-marketing-activity-30d.{json,md}`. None of these touch ingestion, evidence packs, concept evidence, or the default brief.

- **Marketing current:** added the writer, focused on cadence, throughput, active workstreams, repeated threads, and comparison work in flight.
- **Render fix / cleanup / polish:** fixed the artifact to render proper HTML instead of markdown-like preformatted text, removed internal editorial/debug blocks from the public artifact, corrected the nested JSON `defaults` to `marketing / detailed`, and clarified deck-count labels.
- **Grouping:** grouped child-page feedback under parent workstreams, suppressed one-mention items from repeated threads, collapsed event comparison variants into one comparison track, and relabeled the snapshot deck as "site-corpus deck coverage."

## Issue archive / freeze

A freeze layer was added so approved monthly issues become immutable, repo-tracked snapshots.

- **Issue archive** (`netlify/publish_issue_archives.js` + `netlify/freeze_issue_snapshot.js`): `publish_issue_archives.js` copies repo-tracked `issues/` and `history/` into `publish/` every build and generates `publish/issues/index.html` + `publish/data/issues.json`. `freeze_issue_snapshot.js` freezes the current approved issue from `publish/` into repo-tracked `issues/YYYY-MM/` + `history/`, writing `issues/YYYY-MM/issue_manifest.json`. Freeze is a **manual post-approval step** (`node netlify/freeze_issue_snapshot.js . 2026-04`) followed by committing `issues/` and `history/`.
- **v2 fix:** fixed an `issue_count` / `issueCount` variable mismatch in `publish_issue_archives.js` that was failing the build, and added `/issues/index.html` + `/data/issues.json` to homepage/discovery links in `generate_static_newsletters.js`.

## Discovery, routing & deployment plumbing

- **Netlify routes:** added stable named API routes (`/api/newsletter-default[.md]`, `/api/newsletter-marketing-activity-30d[.md]`), a richer `/api/status` with discovery links, and per-build static artifacts under `/newsletter/`. Touched `api.js`, `build.sh`, `generate_static_newsletters.js`.
- **Filename aliases** (`netlify/fix_static_aliases.js`): publishes hyphenated aliases (e.g. `deck-content.json`) alongside underscore files because the site/review workflow expected hyphenated names; updates homepage links to the hyphenated paths. Runs near the end of the build.
- **GitHub Pages relative links:** changed generated static links from root-relative (`/newsletter/default.html`) to relative (`newsletter/default.html`) so they work under the GitHub Pages project subpath `/<repo-name>/` (and on Netlify).
- **AI context export** (`scripts/export_ai_context.sh`): a read-only ZIP exporter used when ChatGPT needed repo visibility but the GitHub app was blocked by admin policy. Bundles source, build scripts, generated artifacts, archives, email artifacts, and a manifest with git state; excludes `.git`, `node_modules`, `.env`, OS junk, caches, ZIPs, and key/cert patterns. (Less central now that Claude Code works directly from the local checkout, but retained.)

## Deployment consolidation — GitHub Pages only

- The project deploys via `.github/workflows/deploy-pages.yml` (builds `publish/` and uploads it to GitHub Pages). The earlier **Netlify** integration was removed: deleted `netlify.toml` and the `netlify dev` script.
- `netlify/functions/api.js` was **not** deleted — the build imports its `handler` to render the static API JSON mirror — so it was moved to `netlify/api.js` (a build-time render module, not a serverless function) and the `require` in `generate_static_newsletters.js` was updated. `netlify/functions/trigger-build.js` (a Netlify build-hook trigger, used by nothing in the build) was removed.
- The `netlify/` directory name is retained for now (it holds the build pipeline) to avoid a churny path rename across `build.sh`, the workflow, and docs.
