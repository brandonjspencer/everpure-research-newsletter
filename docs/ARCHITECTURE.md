# Architecture

The Everpure Research Newsletter Builder is a **hybrid Python + Node.js static-site
generator**. It turns a 30-day research cycle (tracked in Notion, with linked Google
Slides decks) into a leadership-ready monthly **Research Roundup**, published to GitHub
Pages and distributed by email.

The guiding principle: **deterministic build outputs are the evidence substrate; manual /
AI-assisted synthesis must not invent certainty beyond what the evidence supports.**

---

## Pipeline at a glance

```
Notion "Everpure" page  ──┐
(saved HTML or live URL)  │   Python ingestion            Node post-processing
                          ▼                                ▼
                  everpure_refresh.py  ──► publish/data/*.json ──► build_evidence_packs.js
Google Slides decks  ──►  everpure_google_fetch.py            ──► merge_external_evidence_packs.js
(linked from Notion)      everpure_deck_ingest.py             ──► clean_evidence_signals.js
                          everpure_deck_content_ingest.py     ──► build_concept_evidence.js
                          everpure_external_research_ingest.py──► generate_static_newsletters.js
                                                              ──► refine_default_newsletter.js
                                                              ──► render_stage2_*_current.js
                                                              ──► publish_issue_archives.js
                                                              ──► fix_static_aliases.js
                                                              ▼
                                                       publish/  ──► GitHub Pages
```

There are **two layers of output**:

1. **Stage-1 (deterministic substrate)** — parsed JSON, evidence packs, concept evidence.
   Auditable, rule-based, never invents certainty.
2. **Stage-2 (editorial synthesis)** — hand-authored / AI-assisted writers that rewrite the
   _static_ `newsletter/*` artifacts from the stage-1 substrate. They do **not** touch
   ingestion or the live API.

---

## Two build entry points

| Script             | Context               | Output dir      | Source                                                                       |
| ------------------ | --------------------- | --------------- | ---------------------------------------------------------------------------- |
| `run_all.sh`       | **Local dev**         | `output/`       | Always parses the committed `data/Everpure.html` snapshot                    |
| `netlify/build.sh` | **CI / GitHub Pages** | `publish/data/` | Live Notion fetch → committed snapshot → existing outputs (layered fallback) |

`netlify/build.sh` is the production orchestrator invoked by
`.github/workflows/deploy-pages.yml`. It installs Python deps, optionally fetches live
Notion + Google data (when secrets are present), runs the full Python → Node pipeline, and
leaves the deployable site in `publish/`.

After the build, the Pages workflow runs `scripts/refresh_committed_snapshot.py` to keep the
committed `data/Everpure.html` fallback fresh: on a **live** fetch
(`notion_api`/`playwright`/`requests`) that returned records, it overwrites the snapshot with
the freshly-fetched HTML and commits it **only if it changed**, using a `[skip ci]` message so
the commit doesn't re-trigger the build. Fallback tiers leave the snapshot untouched. See
[OPERATIONS.md](OPERATIONS.md) "Committed snapshot auto-refresh".

> **Generated outputs are not committed.** `publish/` (except `publish/index.html`) and
> `output/` legacy sample data are rebuilt fresh; CI uploads `publish/` as the Pages
> artifact. See `.gitignore`.

---

## Canonical build order (critical invariants)

The ordering below is enforced by `netlify/build.sh`. Several steps were broken in the past
by reordering — keep them in this sequence:

1. Fetch Notion source + normalize → `publish/data/*.json` (`everpure_refresh.py`)
2. Fetch Google Slides decks + ingest deck metadata/PDF text
   (`everpure_google_fetch.py`, `everpure_deck_ingest.py`, `everpure_deck_content_ingest.py`)
3. **External research ingest** (`everpure_external_research_ingest.py`) — runs _after_ deck
   fetch + PDF ingest and _before_ evidence packs, because it appends linked-sheet evidence
   to `deck_content.json`.
   - **Helio ingest** (`everpure_helio_ingest.py`) — runs in the same slot, _after_ external
     ingest (it reads the `deck_links.json` that step writes) and _before_ evidence packs.
     Fetches the deck-linked Helio compare share pages (Tier A; no auth) and enriches them with
     sample size + question count from the public test-config API (Tier B-lite;
     `HELIO_APP_ID`/`HELIO_API_TOKEN`), appending the signals into
     `external_research_evidence.json` so the merge step picks them up. Non-blocking.
4. `build_evidence_packs.js`
5. `merge_external_evidence_packs.js`
6. `clean_evidence_signals.js`
7. `build_concept_evidence.js`
   - `build_trends.js` — roll the committed history (+ current Helio metrics) into `trends.json`.
8. `generate_static_newsletters.js` — **must run after** evidence packs / clean evidence /
   concept evidence so the default brief can use the deterministic substrate.
9. `external_evidence_observability.js`
10. `refine_default_newsletter.js` → `fix_default_bottom.js`
11. `render_stage2_default_current.js`, `render_stage2_marketing_current.js`
12. `publish_issue_archives.js`
13. `fix_static_aliases.js` (near the very end, after static artifacts exist)
14. `render_trends_dashboard.js` — writes the homepage `publish/index.html`; **must run after**
    `generate_static_newsletters.js` + `external_evidence_observability.js` (which write/inject
    `index.html`) so the dashboard is the final homepage.
15. `render_sitemap.js` — **dead last**, so it scans every page that shipped.

---

## Component reference

### Python — ingestion & normalization (repo root)

- **`everpure_parser.py`** — First-pass parser. `python everpure_parser.py <Everpure.html> --output-dir <dir>` → `metadata/weeks/decks/summary/manifest.json`. Parses a **saved Notion HTML export**, not a live page; collapsed Notion toggles appear as placeholders.
- **`everpure_refresh.py`** — Refresh pipeline. Refreshes parsed JSON from a public Notion URL (`--source-url`) or local snapshot (`--html-path`), plus `newsletter_pack_90d.json` and `refresh_manifest.json`. Fetch order is **`notion_api` → Playwright → `requests`** (with retries); the JSON API is the robust primary. Records `source_fetch_method` / `source_fallback` markers.
- **`everpure_notion_api.py`** — Notion public JSON-API fetcher. Paginates `/api/v3/loadPageChunk` (cursor loop, retries/backoff on 429/5xx) into the full block recordMap, then renders it into the rendered-DOM HTML (`data-block-id` / `notion-<type>-block` / leaf text / bullet glyphs) that `everpure_parser.py` already consumes — no browser. Far more reliable than Playwright; falls back to it only if the API result is thin.
- **`everpure_api.py`** — Read API over the normalized JSON. `python everpure_api.py --data-dir ./output serve --port 8000`. Endpoints: `/health`, `/metadata`, `/weeks` (filters: `since/until/q/deck_id/section_family`), `/weeks/<id-or-date>`, `/findings`, `/summary`, `/decks`, `/deck-summary`, `/deck-details[/<file_id>]`, `/deck-content[/<file_id>]`. Also `build-pack` subcommand for the 90-day newsletter pack.
- **`everpure_deck_ingest.py`** — Normalizes decks → `deck_details.json`, `deck_week_map.json`, `deck_summary.json`. Accepts local artifacts named by Google file ID.
- **`everpure_deck_content_ingest.py`** — Extracts text from exported deck PDFs → `deck_content.json`, `deck_content_summary.json`.
- **`everpure_google_fetch.py`** — Fetches Slides metadata + PDF/PPTX exports into `deck_artifacts/` via OAuth access token, service-account JSON, or domain-wide delegation (`--subject`). Requires `drive.readonly` scope. Wrapped locally by `run_google_fetch.sh` (`LIMIT`, `MODE`, `SKIP_META`).
- **`everpure_deck_link_smoke.py`** — Smoke test: extracts/classifies hyperlinks from deck metadata, resolves Google redirects, smoke-tests Sheet/Data-Comparison links via Drive CSV export, inventories Helio links without fetching. Writes `deck_links.json`, `deck_link_fetch_status.json`, `external_research_evidence_smoke.json`.
- **`everpure_external_research_ingest.py`** — Production external-evidence ingest: fetches classified Google Sheets, samples signals, augments `deck_content.json`, writes `external_research_evidence.json`. Non-blocking unless `EXTERNAL_EVIDENCE_STRICT=1`.
- **`everpure_helio_ingest.py`** — Fetches deck-linked **Helio** evidence the Sheet ingest only inventories. **Tier A** (live): parses the public `glare-playground.../share/compare/<id>` share pages (Next.js RSC `self.__next_f` payload) into per-metric comparison signals (Engagement/Expectations/Comprehension/Intent/Sentiment, score + qualitative label per variant) and discovers the `my.helio.app/report/<id>` deep links. **Tier B-lite**: enriches those signals with sample size (n) + question count from the Enterprise public API (`GET /tests/:id`, `X-API-ID`/`X-API-TOKEN` from `HELIO_APP_ID`/`HELIO_API_TOKEN`). The public API serves test **config only** — its per-response/score route (`/tests/:id/responses`) 504s on Helio's origin and the rest 406 — so per-question scores / open-text responses are **not fetchable** there (probe: `scripts/helio_api_probe.py`); deep data needs the private app API or a manual export. Appends signals into `external_research_evidence.json`; augments `deck_content.json`; writes `helio_evidence.json` + `helio_fetch_status.json`. Non-blocking.

### Node — evidence & rendering (`netlify/`)

> The directory is named `netlify/` for historical reasons. The project deploys to
> **GitHub Pages only** — the Netlify integration, `netlify.toml`, and serverless functions
> were removed; what remains is the static build pipeline.

- **`build.sh`** — The orchestrator (see build order above).
- **`build_evidence_packs.js`** — Emits `evidence_packs.json` / `evidence_packs_default_30d.json`: the auditable, rule-based evidence substrate per concept.
- **`merge_external_evidence_packs.js`** — Matches external Sheet signals back to concept packs and merges them into the four evidence-pack files (+ match report).
- **`clean_evidence_signals.js`** — Strips deck boilerplate/OCR junk; prioritizes concrete metric lines; writes `clean_supporting_signals` / `clean_key_numbers`.
- **`build_concept_evidence.js`** — Emits `concept_evidence_default_30d.json`: per-concept matched evidence, numbers, summary/next-step hints, confidence, decision status. The strongest stage-1 substrate.
- **`build_trends.js`** — Rolls the committed longitudinal record (`history/concept_evidence/*`, `issues/*/default.json`, `history/helio/*` + the current `helio_evidence.json`) into `publish/data/trends.json`: per-cycle research outcomes (confidence/decision/strength/findings), per-concept trajectories, the Helio UX-metric time series, and respondent quotes. The repo _is_ the database — versioned, diffable, auditable. Exports `buildTrends` for tests.
- **`dashboard_theme.js`** — Single source of the branded theme shared by all human-facing pages: light/dark CSS variables (`[data-theme]`, with a no-flash head init that respects OS preference + persists to localStorage), the collapsible hover-expand icon sidebar (`sidebar(active, prefix)` — relative links via `prefix`), and inline SVG icons. Exports `brandCss`/`sidebar`/`themeInit`/`docHead`.
- **`render_trends_dashboard.js`** — Renders the trends dashboard, which **is the site homepage** (`publish/index.html`), from `trends.json`: shared theme + sidebar + hand-rolled SVG charts whose fills are CSS variables (so they follow light/dark). No chart lib, no React/Vite. Must be the **last** writer of `index.html` (see build order). Footer links to the published issues.
- **`render_sitemap.js`** — Renders a branded, comprehensive sitemap (`publish/sitemap/index.html`) by **scanning the built `publish/` tree**, so it lists every page + API/data artifact that actually shipped and can't drift. Runs last.
- **`generate_static_newsletters.js`** — Generates the per-build static `newsletter/*` artifacts + discovery links.
- **`refine_default_newsletter.js`** / **`fix_default_bottom.js`** — Post-generation refinement of `default.{json,md,html}` (promote strong-proof concepts, de-dupe "What we should do next", strip debug blocks). Does **not** touch the API.
- **`render_stage2_default_current.js`** — Hand-authored current-cycle writer for the default brief (also holds the on-brand "Figma Make" HTML design). Touches only `newsletter/default.*` + `api/newsletter-default.*`.
- **`render_stage2_marketing_current.js`** — Current-cycle writer for the marketing "activity log 30d" artifact (the "Research activity log"). Touches only `newsletter/marketing-activity-30d.*` + `api/newsletter-marketing-activity-30d.*`; its HTML shell uses the shared `dashboard_theme.js` (sidebar + light/dark), but its data-driven content is unchanged.
- **`external_evidence_observability.js`** — Injects external-evidence counts into `status.json`, `api/status.json`, and index HTML.
- **`publish_issue_archives.js`** — Copies repo-tracked `issues/` + `history/` into `publish/`, generates `publish/issues/index.html` (branded via `dashboard_theme.js`) + `publish/data/issues.json`.
- **`freeze_issue_snapshot.js`** — Manual post-approval freeze of the current issue into repo-tracked `issues/YYYY-MM/` + `history/`. See [OPERATIONS.md](OPERATIONS.md).
- **`fix_static_aliases.js`** — Publishes hyphenated aliases (`deck-content.json`) alongside underscore files; updates homepage links.
- **`fix_default_bottom.js`** — see above.
- **`api.js`** — Build-time API render module: `generate_static_newsletters.js` imports its `handler` to emit the static API JSON mirror. Formerly a Netlify Function (`netlify/functions/api.js`), now build-only — there is no serverless runtime. **Avoid editing** — prefer post-generation static rewriting (see CHANGE_HISTORY.md).

---

## Directory layout

```
data/Everpure.html          Committed Notion HTML snapshot (source-of-truth fallback)
everpure_*.py               Python ingestion/normalization/API scripts
netlify/                    Node build pipeline: build.sh orchestrator, evidence builders,
                            renderers, and api.js (build-time API render module)
output/                     Local sample outputs from run_all.sh (legacy, committed)
publish/                    Deployable site — REBUILT in CI (generated, gitignored)
  publish/index.html        Hand-maintained landing page (TRACKED)
issues/YYYY-MM/             Frozen, immutable monthly issue archives (committed)
history/                    Per-month history snapshots (committed)
emails/                     Email HTML artifacts for distribution (committed)
scripts/                    export_ai_context.sh, refresh_committed_snapshot.py, helpers
docs/                       This documentation; docs/handoff/ holds canonical context
.github/workflows/          CI (ci.yml) + GitHub Pages deploy (deploy-pages.yml)
```

---

## Data artifacts (selected)

| Artifact                                      | Produced by                             | Meaning                                                     |
| --------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `weeks.json`, `summary.json`, `metadata.json` | parser/refresh                          | Normalized weekly research records                          |
| `refresh_manifest.json`                       | refresh                                 | Source freshness + fallback markers (`source_fetch_method`) |
| `deck_content.json`                           | deck content ingest (+ external ingest) | Extracted deck text + linked-sheet evidence                 |
| `evidence_packs*.json`                        | `build_evidence_packs.js`               | Rule-based per-concept evidence substrate                   |
| `concept_evidence_default_30d.json`           | `build_concept_evidence.js`             | Strongest stage-1 substrate for synthesis                   |
| `newsletter/default.{json,md,html}`           | stage-2 default writer                  | The exec/strategic 30-day brief                             |
| `newsletter/marketing-activity-30d.*`         | stage-2 marketing writer                | Marketing activity log                                      |
| `status.json`                                 | observability                           | Live build/evidence counts                                  |

For the full provenance of every design decision, see [CHANGE_HISTORY.md](CHANGE_HISTORY.md).
