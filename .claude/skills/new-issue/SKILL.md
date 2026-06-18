---
name: new-issue
description: >-
  Author a new monthly Everpure Research Roundup end-to-end: verify build
  freshness, scaffold an editable editorial draft, run the QC agent suite,
  freeze the approved issue, prepare the distribution email, and post a Slack
  announcement to #research-and-discovery — with explicit approval gates before
  freezing, before the email send, and before the Slack post. Use when the user
  wants to start, draft, build, QC, freeze, send, or announce a new monthly issue
  / Research Roundup.
---

# New monthly issue (Research Roundup)

Drives the monthly ritual in [docs/OPERATIONS.md](../../../docs/OPERATIONS.md) as a single,
ordered, guardrailed flow. **Follow the phases in order. Do not skip the freshness gate, and
stop at each approval gate until the user explicitly approves.**

## Prime directives (never violate)

- **Freshness before synthesis.** A green build ≠ fresh data. Never draft, freeze, or email off
  a fallback-tier build. (Phase 1 enforces this.)
- **Three human approval gates:** before **freeze** (Phase 5), before the **email send** (Phase 6),
  and before the **Slack post** (Phase 7). Never freeze, send, or post without explicit
  "approved/yes." Posting to Slack is outward-facing — treat it like the email send.
- **No secrets.** Never ask the user to paste tokens, `.env`, or credentials into chat. Builds
  read secrets from the environment / CI.
- **Frozen issues are immutable.** Once `issues/YYYY-MM/` exists, never edit it except on an
  explicit "fix the frozen archive" request.
- **Confidence = evidence-readiness**, exactly `Low/Medium/High confidence`. Reserve **High** for
  corroborated evidence, never preference.
- **EVIDENCE is a surfaced signal; respondent quotes are real participant words only** — never a
  CTA label, tagline, or paraphrase.

## Inputs

- Target issue month `YYYY-MM` (ask if not given). Below, write it as `$MONTH`.

---

## Phase 0 — Pre-flight

1. Remind the user (one line) not to paste credentials/tokens.
2. Confirm `$MONTH` and that this is a new issue (not editing a frozen one).
3. `git checkout main && git pull --ff-only` so you build from current `main` (the committed
   snapshot auto-refreshes on live CI builds).

## Phase 1 — Build + freshness gate (hard stop on fallback)

1. Produce `publish/` by running the full pipeline:
   ```bash
   bash netlify/build.sh
   ```
   - It reads `SOURCE_URL` (Notion) and, for decks, `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`
     from the environment. **Without Google creds it skips deck fetch**, so deck-derived
     evidence will be thin — for a real issue, run where those secrets are available, or trigger
     a CI deploy first (`gh workflow run "Deploy static site to GitHub Pages" --ref main`) so the
     committed snapshot is fresh, then rebuild.
2. Gate on source freshness:
   ```bash
   python3 scripts/check_build_freshness.py --data-dir publish/data
   ```
   - Exit `0` live+clean → proceed. Exit `3` live but linked-sheet capture degraded → tell the
     user what degraded, ask whether to proceed. Exit `1` **fallback tier** or `2` no manifest →
     **STOP**, report it, and do not draft until a fresh build is obtained.
3. Report the tier, record count, and date range before moving on.
4. **Re-curate the dashboard signals** off this fresh build — see [Dashboard signals
   (monthly re-curation)](#dashboard-signals-monthly-re-curation) below. Do this now, while the
   cycle's Helio scores + verbatims are in front of you.

## Phase 2 — Scaffold the editorial draft

1. Scaffold an editable per-month content file from the rendered build:
   ```bash
   python3 scripts/scaffold_issue_content.py --month $MONTH
   ```
   Writes `netlify/content/default-$MONTH.json` (pre-filled with the auto-composed finding
   statements, EVIDENCE, verified respondent quotes, next steps, unresolved questions, ordering)
   and prints a review worksheet. It will not overwrite an existing draft without `--force`.
2. Re-render against the draft and confirm it reproduces the build (keys correct):
   ```bash
   STAGE2_CONTENT_FILE=netlify/content/default-$MONTH.json node netlify/render_stage2_default_current.js publish
   ```
3. Work through the draft with the user, refining copy in `default-$MONTH.json` (this is **data,
   not code** — see OPERATIONS.md "Editing the default brief's copy"). Re-render after edits.
   Keep EVIDENCE concrete (~250 chars, ceiling ~295), confidence labels evidence-backed, and
   respondent quotes verbatim-real (drop any that aren't a participant's own words).

## Phase 3 — QC agent pass

Run the QC sequence using the prompts in
[docs/handoff/everpure_minimum_agent_suite_combined.md](../../../docs/handoff/everpure_minimum_agent_suite_combined.md)
and [docs/handoff/everpure_research_roundup_quality_control_agent.md](../../../docs/handoff/everpure_research_roundup_quality_control_agent.md):
Evidence Integrity → Research Synthesis → Reader Value → Section Role & Redundancy →
Email Adaptation → Quality Control. Surface every flag; fix in `default-$MONTH.json` and
re-render. Do not advance with unresolved QC blockers.

## Phase 4 — Review checklist ▶ APPROVAL GATE 1

Present the rendered preview (`publish/newsletter/default.html`) and confirm the issue answers:
**What did we learn? Why does it matter? How confident are we (evidence-backed)? What still needs
clarity? What should happen next?** List anything still rough. **Ask the user to approve the
issue for freeze. Do not proceed to Phase 5 without explicit approval.**

## Phase 5 — Freeze (only after approval)

1. Promote the approved draft to the file the build uses by default, archiving the prior current:
   - If a different month's copy is in `netlify/content/default-current.json`, copy it to
     `netlify/content/default-<prev-month>.json` first, then copy `default-$MONTH.json` over
     `default-current.json`. (This keeps the per-month record and makes the freeze build use the
     approved copy.)
2. Rebuild so `publish/` reflects the approved copy: `bash netlify/build.sh`.
3. Freeze:
   ```bash
   node netlify/freeze_issue_snapshot.js . $MONTH
   ```
   Writes `issues/$MONTH/` + `history/*/$MONTH.json` + `issue_manifest.json`.
4. Commit on a branch and open a PR (never push generated `publish/`):
   ```bash
   git checkout -b freeze/$MONTH
   git add issues/$MONTH history netlify/content/default-current.json netlify/content/default-$MONTH.json
   git commit -m "Freeze Research Roundup $MONTH"
   ```
   Run `make check`, push, open the PR, and confirm CI is green. Merging republishes the frozen
   archive on the next deploy.

## Phase 6 — Distribution email ▶ APPROVAL GATE 2

1. Build the email from [docs/handoff/research_roundup_email_template.html](../../../docs/handoff/research_roundup_email_template.html)
   (latest mobile fixes), populated from the **frozen** `issues/$MONTH/default.*`. Save as
   `emails/research_roundup_issueNN_email_<month><year>.html`.
2. **CTAs must point to the frozen archive** `/issues/$MONTH/default.html` — never the mutable
   `/newsletter/default.html`. Include the Zscaler authentication note and the
   `#research-and-discovery` Slack feedback link.
3. Test in Gmail desktop **and** phone; watch the small breakpoint for horizontal scroll.
4. Send via the consolidated Apps Script in [`appsscript/`](../../../appsscript/README.md) (the
   user runs it under their own Google auth — you never send). It is **batched**, so there is no
   50-recipient cap. Sequence:
   - Put the approved email HTML in the issue email **folder** (`ISSUE_EMAIL_FOLDER_ID`). If the
     Drive connector is available you can create it there directly (`text/html`, no Google-Doc
     conversion); otherwise the user drops it in. The script auto-uses the **newest `.html`** in
     that folder — no file-id to update.
   - **Preview**: `dryRunIssue` — confirm the email-HTML file picked, recipient count, batch
     count, and remaining quota.
   - **Test**: `sendIssueTest` (goes to `REVIEWERS` only) — review in Gmail desktop + phone.
   - **Ask the user to approve the broadcast. Do not broadcast without explicit approval.**
   - **Broadcast**: `sendIssueBroadcast` (full active list, batched, suppression-filtered).
   - UX-tip emails use `dryRunUxTip` / `sendUxTipTest` / `sendUxTipBroadcast`.

## Phase 7 — Slack announcement ▶ APPROVAL GATE 3

Post a short announcement to the **#research-and-discovery** Slack channel that mirrors the email —
the headline takeaway plus a link to the issue. Post it **after the freeze PR has merged and the
site has deployed**, so the link resolves (same timing and same frozen target as the email CTA).

1. Compose the post in Slack mrkdwn — concise and in the email's spirit (lead with the learning;
   never invent certainty beyond the evidence):
   - Title: `:mag: *Research Roundup — <Month Year> (Issue NN)* is live`
   - 1–2 sentences on the cycle's headline finding, drawn from the **frozen** issue's executive
     summary.
   - The issue link — the **frozen** published archive, never the mutable newsletter:
     `https://brandonjspencer.github.io/everpure-research-newsletter/issues/$MONTH/default.html`
   - A one-line invite to reply in-thread with questions/feedback.
2. Present the exact text. **Ask the user to approve posting it. Do not post without explicit
   approval** (posting is both "send a message" and "publish public content").
3. Post to `#research-and-discovery` via the Slack connector — `slack_send_message` (resolve the
   channel id with `slack_search_channels` first if needed). Prefer `slack_send_message_draft` if
   the user would rather send it themselves; if no Slack connector is available, hand the user the
   formatted text to paste.

---

## Dashboard signals (monthly re-curation)

Runs once per cycle, off the **fresh** Phase-1 build (`publish/data/helio_evidence.json` has the
cycle's Helio scores + verbatims). The homepage trends dashboard carries two curated signal layers —
both **committed data, not code** — that should be refreshed as the concepts under test evolve. The
charts and the variant **frontrunner** line are computed deterministically; these files are the
**editorial read** on top, and must never invent certainty beyond the evidence. Full reference:
[OPERATIONS.md → Dashboard signals](../../../docs/OPERATIONS.md#dashboard-signals-voice--ux--re-curate-monthly).

1. **UX signals** — `netlify/content/ux_signals.json`. Comb this cycle's Helio comparisons for the
   meaningful read of each: which variant **won or regressed**, where comprehension/sentiment moved,
   the biggest mover. Write one `signal` per concept worth flagging (with an optional `read` tag +
   one-line `recommendation`), matched by `compare_id` or a substring of the comparison's displayed
   title. Cite real scores. Comparisons you don't curate still show the computed frontrunner + a
   computed fallback signal, so curate where there's a _story_, not everywhere.
2. **Voice signals** — `netlify/content/voice_of_user.json`. Comb the cycle's verbatims for the most
   compelling **real** quote representing each significant pattern; label each with its `signal` +
   `topic`. Participant words verbatim — never paraphrase or edit.
3. **Rebuild + eyeball:** `node netlify/build_trends.js . && node netlify/render_trends_dashboard.js .`
   then open `publish/index.html` — confirm the frontrunner lines, UX signals, and quote rotator read
   correctly. (A full `bash netlify/build.sh` also does this; these two commands are the fast path.)
4. These files are committed with the freeze PR (Phase 5) like any other content change.

---

## Reference

- Runbook & editorial rules: [docs/OPERATIONS.md](../../../docs/OPERATIONS.md)
- Pipeline & components: [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)
- Email send (batched, version-controlled): [appsscript/README.md](../../../appsscript/README.md)
- Helpers: `scripts/check_build_freshness.py`, `scripts/scaffold_issue_content.py`,
  `netlify/freeze_issue_snapshot.js`
