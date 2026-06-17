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
  - `playwright`/`requests` → live fetch (good)
  - `local_html_fallback` → committed `data/Everpure.html` snapshot was used
  - `fallback_existing_outputs` (`source.source_fallback: existing_outputs`) → stale reused outputs
- If a fallback was used and the issue needs new Notion entries, obtain a fresh HTML snapshot
  or rerun once Notion is reachable. **Do not ship a fallback build as if it were current.**
- Always cache-bust live artifact checks: append `?cb=<timestamp>` to GitHub Pages URLs.

Key artifacts to inspect: `status.json`, `weeks.json`, `evidence_packs_default_30d.json`,
`concept_evidence_default_30d.json`, `deck_content.json`, `newsletter/default.json`,
`newsletter/default.html`.

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

- The spreadsheet tab name matters; "no sheet found" → verify the tab name first.
- The email link must be the saved frozen issue, not the latest page.
- Test-send before final distribution.

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
