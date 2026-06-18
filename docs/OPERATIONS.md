# Operations Runbook

How to run the monthly Research Roundup safely. Treat this builder as a
**production-adjacent internal publishing system**: optimize for safe, repeatable monthly
operation over clever one-off fixes. Preserve the separation between evidence ingestion,
editorial synthesis, archive freeze, and email distribution.

The canonical, longer-form context lives in [`handoff/`](handoff/) — especially
`EVERPURE_RESEARCH_NEWSLETTER_CLAUDE_CODE_HANDOFF.md` and
`everpure_project_context_handoff_v9.md`.

---

## Secrets policy (read first)

- **Never** paste credentials, OAuth refresh tokens, client secrets, `.env` values, private
  keys, or recipient spreadsheets into chat or code comments.
- Google deck fetch requires an OAuth token with scope
  `https://www.googleapis.com/auth/drive.readonly`.
- The Pages deploy (`deploy-pages.yml`) reads these GitHub Actions **secrets**: `SOURCE_URL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — and the **variable**
  `GOOGLE_FETCH_LIMIT`. The Notion source is a public page fetched via `SOURCE_URL`; no Notion
  API token or database id is used. `GOOGLE_REFRESH_TOKEN` should be a long-lived token from a
  published OAuth app — see [Google auth](#google-auth-one-time-setup-not-a-monthly-chore);
  rotating it monthly is a symptom, not the routine.
- `scripts/export_ai_context.sh` is read-only and excludes secrets/keys/certs; verify the
  manifest inside the ZIP before sharing.

---

## Google auth (one-time setup, not a monthly chore)

The deck fetch needs a Google OAuth credential with `drive.readonly` (+ `presentations.readonly`).
**If you are re-minting the refresh token every month, the OAuth app is almost certainly still in
"Testing" mode** — refresh tokens for testing-mode apps expire in ~7 days. The fix is a one-time
setup, after which the token persists.

**Recommended (no code, durable):** publish the OAuth app.

1. GCP Console → APIs & Services → **OAuth consent screen**.
2. Set **User type = Internal** if the project lives in Pure's Workspace org (Internal apps skip
   Google verification and their tokens don't expire) — **or** click **Publish app** to move it
   from "Testing" to "In production".
3. Mint **one** new refresh token (OAuth 2.0 Playground, scopes `drive.readonly` +
   `presentations.readonly`) and set it as the `GOOGLE_REFRESH_TOKEN` Actions secret.
4. It now persists indefinitely (until revoked, password change, ~6 months unused, or >50 live
   tokens for the client). No monthly rotation.

**If expiry still recurs** (e.g. a Workspace admin policy enforces short OAuth token lifetimes),
switch to a **service account** — already supported by `everpure_google_fetch.py`
(`--service-account-json`, plus domain-wide delegation via `--subject`). Create a service account,
store its JSON key as a GitHub secret, wire it into `build.sh`'s fetch args, and either use DWD or
share the deck Drive folder with the service-account email. Service accounts don't use refresh
tokens, so nothing expires. (A third option, no stored secret at all: GitHub OIDC → Workload
Identity Federation, exporting a short-lived `GOOGLE_ACCESS_TOKEN`, which `build.sh` already consumes.)

---

## Monthly new-issue ritual

> The **`/new-issue` skill** (`.claude/skills/new-issue/SKILL.md`) runs this entire ritual
> end-to-end with the freshness gate and two approval gates (before freeze, before send) built
> in, using `scripts/check_build_freshness.py` and `scripts/scaffold_issue_content.py`. The steps
> below are what it automates — and the manual fallback if you run it by hand.

Do **not** start a new issue with editorial synthesis or code patching. Start with build
verification.

1. Remind the user not to paste credentials/tokens into chat.
2. Confirm Google auth is healthy. With a published OAuth app (see above) there is **no monthly
   token rotation** — only re-check `GOOGLE_REFRESH_TOKEN` if a build's deck fetch fails on auth.
3. Trigger a build (push to `main`, `workflow_dispatch`, or the weekly cron). With no
   GitHub CLI: `git commit --allow-empty -m "Run monthly build" && git push`.
4. **Verify build freshness before synthesis** (see below).
5. Only after the build is fresh, run the agent / QC sequence.

### Verify build freshness

A green build is **not** proof the source data is fresh. Before drafting:

- Check the source tier — read `source.fetch_method` in `publish/data/refresh_manifest.json`
  (surfaced as the flat `source_fetch_method` in live `status.json`):
  - `notion_api` → live fetch via the Notion JSON API (the robust primary)
  - `playwright`/`requests` → live fetch via headless browser / HTTP (fallbacks)
  - `local_html_fallback` → committed `data/Everpure.html` snapshot was used
  - `fallback_existing_outputs` (`source.source_fallback: existing_outputs`) → stale reused outputs
- If a fallback was used and the issue needs new Notion entries, obtain a fresh HTML snapshot
  or rerun once Notion is reachable. **Do not ship a fallback build as if it were current.**
- Always cache-bust live artifact checks: append `?cb=<timestamp>` to GitHub Pages URLs.
- Check linked-spreadsheet capture in `deck_link_fetch_status.json`: `degraded_count`,
  `truncated_to_first_tab_count`, `requested_gid_not_found_count`, and per-sheet
  `row_truncated` / `column_truncated` flags. Non-zero means a linked Google Sheet's evidence
  is incomplete (a tab, gid, or rows/columns were dropped) — investigate before relying on it.
- Check Helio capture in `helio_fetch_status.json` (`summary`): `evidence_count`, `error_count`,
  `empty_count`, `discovered_report_ids`, and `tier_b_report_api` (`configured`/`absent`).
  `check_build_freshness.py` rolls Helio `error_count` + `empty_count` into the same
  `live_degraded` (exit 3) signal as degraded sheets, so a Helio hiccup is visible at the gate.

Key artifacts to inspect: `status.json`, `weeks.json`, `evidence_packs_default_30d.json`,
`concept_evidence_default_30d.json`, `deck_content.json`, `helio_evidence.json`,
`newsletter/default.json`, `newsletter/default.html`.

### Helio evidence (compare pages + report API)

The decks link to ZURB **Helio** sources. `everpure_helio_ingest.py` fetches them (the Google-Sheet
ingest only inventories them):

- **Tier A — compare share pages** (`glare-playground.../share/compare/<id>`): public, no auth. We
  parse the per-metric comparison (Engagement/Expectations/Comprehension/Intent/Sentiment, score +
  qualitative label per variant) into evidence signals and discover the `my.helio.app/report/<id>`
  deep links. Capped by `HELIO_FETCH_LIMIT` (default 12).
- **Tier B-lite — report config / integrity** via the Helio Enterprise **public API**
  (`X-API-ID`/`X-API-TOKEN`, from `HELIO_APP_ID`/`HELIO_API_TOKEN`). For each discovered report id
  it fetches `GET /tests/:id` and attaches **sample size (n) + question count** as provenance,
  folding n into the headline signal so it backs the confidence label.
- **Tier B (deep) — UX metrics + verbatim quotes** via the AI-friendly report endpoint Helio
  published (docs 2026-06): `GET /tests/:id/report?include=ux_metrics,questions_summary,questions_responses`.
  For each discovered variant report id it parses:
  - **per-variant UX-metric scores** → **gap-fills** the scraped Tier-A `metrics[]` (never overwrites
    a compare-page score; adds metrics/variants the scrape lacked). This is what populates the
    dashboard's **Comprehension & Sentiment** sparklines, which the compare page often omits.
  - **verbatim participant answers** (`questions_responses`) → `respondent_quotes[]` on the record,
    with a wrapped copy folded into `evidence_text` so the existing quote harvesters surface them in
    the dashboard quote rotator (and, via concept matching, in the issues).

  **History note.** This route was unreachable when probed 2026-06 (`/tests/:id/responses` 504'd,
  `/results` `/insights` `/sections` 406'd). Helio's published docs added the purpose-built
  `/tests/:id/report` endpoint, which serves the deep data the old routes couldn't. The
  include-section JSON shape isn't documented field-by-field, so the parser is **defensive** and
  records the observed top-level keys in `helio_fetch_status.json` (`report_deep[].top_keys`) for
  refinement after the first live run. To re-probe the surface with live keys:

  ```bash
  HELIO_APP_ID=… HELIO_API_TOKEN=… python3 scripts/helio_api_probe.py [TEST_ID]
  ```

  It prints a redacted skeleton (no keys; values truncated) — safe to share.

All tiers are **non-blocking**: a Helio failure (any 404/406/504/timeout/empty) is recorded in
`helio_fetch_status.json` and degrades gracefully (deep → config-only → Tier A), never aborting the
deploy.

### Dashboard signals (Voice + UX — re-curate monthly)

The trends dashboard surfaces two curated "signal" layers on top of the deterministic charts. Both
are **committed data, not code** — hand-edited JSON the build reads — and both should be **re-curated
each cycle when fresh findings land** (the `/new-issue` skill calls this out; see its "Dashboard
signals" step). The principle is the repo's: the math is computed and deterministic; the _editorial
read_ is curated and never invents certainty beyond the evidence.

- **`netlify/content/voice_of_user.json`** — the qualitative layer. The most compelling **real**
  verbatim for each significant research pattern, each labeled with its signal + topic. Replaces the
  randomly-harvested quote pool in the "Voice of the user" rotator when present (else the rotator
  falls back to the harvested pool). Quotes are participant words verbatim — never paraphrase/edit.
- **`netlify/content/ux_signals.json`** — the quantitative layer. The directional **read** of a
  Helio comparison's scores, rendered beneath that comparison's chart in "Helio UX metrics". Each
  entry has a `match` (a comparison's `compare_id`, or a case-insensitive **substring of its
  displayed title** — title only, so a shared inferred concept can't cross-match), a `signal`
  sentence, and optional `read` tag + one-line `recommendation`. Cite real scores; stay directional.

  Alongside each curated signal the renderer **always computes a deterministic "Frontrunner" line**
  from the same scores the bars show — which variant leads, its average lift vs. the baseline (the
  `…Baseline`-named variant, else the first; `overall_score` is excluded from the mean as a
  roll-up), how many metrics it tops, and the biggest mover. When the baseline outscores every
  variant it reads "**still leads — variants regressed**" (e.g. the Pathfinder CTA relabels). A
  comparison with **no** curated entry still shows the frontrunner line + a **computed fallback
  signal**; if `ux_signals.json` is absent/empty, every comparison falls back that way. Single-screen
  records (no head-to-head) show a "Single screen" note instead of a frontrunner.

**Monthly re-curation (the repeatable process):** after a fresh live build (Helio scores + verbatims
refreshed), comb the current `publish/data/helio_evidence.json` for the cycle's meaningful patterns —
which variant won/regressed, where comprehension/sentiment moved, what users said in their own words —
and update the two files to feature the most compelling, evidence-backed signal per concept. Rebuild
(`build_trends.js` → `render_trends_dashboard.js`, both run by `netlify/build.sh`) and eyeball the
homepage. This keeps the dashboard's signals current as the concepts under test evolve.

### Committed snapshot auto-refresh

To keep the `local_html_fallback` tier from drifting stale, the Pages build refreshes the
committed `data/Everpure.html` snapshot automatically. After a build,
`scripts/refresh_committed_snapshot.py` reads `refresh_manifest.json` and — **only when the
build used a live fetch (`notion_api`/`playwright`/`requests`) that returned a non-empty
result** — overwrites `data/Everpure.html` with the freshly-fetched HTML. The workflow then
commits it **only if it changed**, with a `[skip ci]` message so the commit does not
re-trigger the build (or CI). Fallback tiers never overwrite the snapshot.

What this means in practice:

- The snapshot tracks the live page within one build cycle (weekly cron + any push/dispatch),
  so a future fallback build serves near-current content instead of a months-old page.
- Expect an occasional `chore: refresh committed Notion snapshot [skip ci]` commit on `main`
  authored by `github-actions[bot]`. No content commit means Notion was unchanged.
- The committed HTML is the **notion_api-rendered** shape (parser-ready), not a raw browser
  dump — this is intentional and matches the primary fetch path.
- It is best-effort: a refresh problem prints a warning and **never fails the deploy**.

---

## Agent / QC sequence (before freeze or email)

Run after a deterministic build is live and before freezing/emailing. Prompts:
[`handoff/everpure_minimum_agent_suite_combined.md`](handoff/everpure_minimum_agent_suite_combined.md)
and [`handoff/everpure_research_roundup_quality_control_agent.md`](handoff/everpure_research_roundup_quality_control_agent.md).

1. **Evidence Integrity Agent** — verifies freshness and evidence strength.
2. **Research Synthesis Agent** — converts evidence into reader-facing findings.
3. **Reader Value Agent** — checks that stakeholders/leaders understand why it matters.
4. **Section Role & Redundancy Agent** — each section has a distinct role, no repeated copy.
5. **Email Adaptation Agent** — the approved issue works as an email artifact.
6. **Quality Control Agent** — final gate before freeze and send.

Every issue must answer: **What did we learn? Why does it matter? How confident are we?
What still needs clarity? What should happen next?**

---

## Editorial rules (must survive future edits)

- Public title is **Research Roundup**; copy is evidence-led and reader-facing.
- Public copy must **not** explain internal pipeline mechanics, build steps, archive
  mechanics, deck extraction, or publishing operations.
- Research Findings describe what the research taught us, not the build process.
- Confidence labels are exactly `Low confidence` / `Medium confidence` / `High confidence`
  and must reflect the evidence substrate. Reserve **High confidence** for corroborated
  evidence — not mere stakeholder preference.
- Comparison/baseline/multi-variation threads are **not** "validated findings" unless a
  plain-language outcome exists; otherwise say "variants were compared but no winner is
  stated yet." Frame comparisons as narrowed decision problems with explicit winning criteria.
- Recommended actions are ordered by decision urgency.
- No internal concept-number references in public copy — use "Findings suggest" / "Evidence
  suggests." In the on-brand layout, finding sublabels are `Evidence` / `Direction`.
- Synthesis should prefer `clean_supporting_signals` / `clean_key_numbers` and suppress
  generic lines like `UX Metrics ● …`.
- Public artifacts must not contain internal editorial/debug recommendation blocks.

### Editing the default brief's copy (data, not code)

The default brief's per-issue editorial copy lives in `netlify/content/default-current.json` —
finding statements, next steps, unresolved questions, comparison framing, per-topic confidence
overrides, section ordering, and the closing note. **Edit that JSON to change an issue; no code
change is needed.** Topics are keyed by the renderer's `topicKey()` value; any absent field
falls back to a generic default in `render_stage2_default_current.js`, and a per-month copy can
be selected with `STAGE2_CONTENT_FILE=netlify/content/default-2026-07.json`. Confidence is now
data-driven (`confidence_override`) — do **not** reintroduce a hardcoded `"high"` in the renderer.

The **EVIDENCE** column is `proof_point`. When a topic has no `proof_point` override, the
renderer auto-composes one from the concept-evidence substrate (`text_utils.composeEvidenceSummary`):
it splits off pipeline scaffolding, repairs PDF ligatures, prefers concrete signals (quotes,
metrics, observations) over the finding restatement, joins distinct signals, and caps length
(~295 chars). For a leadership-ready, length-consistent line, set an explicit `proof_point`
per topic (aim ~250 chars, ceiling ~295) — that always wins over the auto-composed fallback.
Keep EVIDENCE a _surfaced signal_, not a paraphrase of the finding.

A topic may also carry a `respondent_quote` — a verbatim participant quote rendered after the
finding summary (before the source-deck link), labeled "Respondent quote:". Set it per topic for
a vetted quote; otherwise the renderer auto-pulls a genuine quote (`text_utils.extractRespondentQuote`)
and shows nothing when none qualifies. Use **only real participant words** — never a CTA label
(e.g. "Watch a Demo"), product tagline, or analyst paraphrase. Omit the field for topics without
a compelling quote.

---

## Archive freeze workflow

When the user approves an issue, freeze it into a dated, immutable archive:

```bash
node netlify/freeze_issue_snapshot.js . 2026-06     # freezes current issue → issues/2026-06/
git add issues/2026-06 history emails/research_roundup_issueNN_email_monthYYYY.html
git commit -m "Freeze Issue NN and add email artifact"
git push
```

- Freeze preserves approved content, evidence snapshot, history entry, and email artifact.
- Once frozen, the archive is **immutable** and republished verbatim on every build. Do not
  edit a frozen archive unless the user explicitly asks for a corrected archive.
- After freeze, **all email CTAs must point to the frozen archive** `/issues/YYYY-MM/default.html`,
  never the mutable latest `/newsletter/default.html`.

---

## Email artifact rules

The email HTML is a **separate artifact** from the web renderer (keep it isolated unless the
user asks to merge). Start from
[`handoff/research_roundup_email_template.html`](handoff/research_roundup_email_template.html)
(includes the latest mobile fixes); current artifacts live in `emails/`.

- CTA links point to the **frozen archive** issue.
- Include a Zscaler authentication note for internal access.
- Include the `#research-and-discovery` Slack feedback link when requested.
- Test in Gmail **desktop and phone** before send.
- Watch the small breakpoint for **horizontal scroll** (stat-row borders, fixed-width
  tables). On small screens the outer shell should have zero background padding and render
  full width.
- Email stats need not mirror every web-section count; keep the email send-ready and focused.

### Apps Script / spreadsheet sending

Sending runs in **Google Apps Script** under the user's Workspace account (not the GitHub Pages
pipeline). The single consolidated, version-controlled sender lives in
[`appsscript/`](../appsscript/README.md) — it replaces the three older scripts (issue broadcast,
test/review, UX-tip) with one parameterized by **type** (issue | uxtip) × **mode** (test |
broadcast).

- **No 50-recipient cap.** The old scripts put every recipient in one message's BCC, hitting
  Gmail's per-message limit. The consolidated script **batches** (default 45/message, paused) and
  scales to ~500 within the ~1,500/day Workspace quota. It dedupes, validates, and skips the
  suppression tab.
- Instance values (recipient sheet id, HTML file ids, reviewers, from/reply-to) live in **Script
  Properties**, never in the repo.
- Always `dryRun*` → `send*Test` (reviewers) → **approval** → `send*Broadcast`.
- The spreadsheet tab name matters; "no sheet found" → verify the tab/columns (`email`, `active`).
- The email link must be the saved frozen issue, not the latest page.
- Test-send before final distribution.

### Slack announcement (#research-and-discovery)

After the freeze PR has merged and the site has deployed, post a short announcement to the
**#research-and-discovery** channel that mirrors the email — the headline takeaway plus a link to
the issue (`/new-issue` Phase 7).

- Link to the **frozen archive** issue
  (`https://brandonjspencer.github.io/everpure-research-newsletter/issues/YYYY-MM/default.html`),
  never the mutable `/newsletter/default.html` — same rule as the email CTA.
- Keep it concise and evidence-honest; lead with the cycle's headline finding from the frozen
  executive summary.
- Posting is outward-facing: **get explicit approval before posting** (treat it like the email
  broadcast). Post via the Slack connector, or draft it for the user to send.

---

## High-risk areas

- **Stage-2 renderer patching:** avoid reintroducing hardcoded Issue 01 copy.
- **Generated artifacts:** do not commit generated `publish/` files (they are gitignored).
- **Confidence labels:** never inflate confidence without evidence.
- **Email links:** never point distribution email to mutable `/newsletter/default.html`.
- **Mobile email layout:** test the small breakpoint for horizontal scroll.
- **Auth:** never ask the user to paste secrets, tokens, `.env` files, or credentials.
- **Build freshness:** cache-bust live checks before interpreting content.
- **API logic:** prefer post-generation static rewriting over editing the build-time API render module (`netlify/api.js`); there is no live/serverless API (GitHub Pages only).

---

## Source priority order (when sources disagree)

1. Fresh deterministic build artifacts from GitHub Pages.
2. Approved frozen issue archive (for already-sent issues).
3. Current repository source files.
4. The handoff package in [`handoff/`](handoff/).
5. Older conversation notes or assumptions.
