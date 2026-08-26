# Email distribution (Google Apps Script)

One consolidated, **batched** sender for the Everpure Research Roundup and ad-hoc UX-tip emails —
replacing the three older scripts (issue broadcast, test/review, UX-tip). Sending stays on your
Google Workspace account; this just version-controls the script and removes the recipient cap.

## Why batching (the 50-recipient fix)

The old scripts put **every recipient into one message's BCC**, which hits Gmail's per-message
recipient limit (~50, stricter with external addresses). Your Workspace **daily** quota is ~1,500,
so `Code.gs` sends in **batches of `BATCH_SIZE`** (default 45) with a short pause between — scaling
comfortably to ~500 while staying well under the daily quota. It also dedupes, validates, and skips
anyone on the suppression tab.

## One-time setup

1. Install clasp and sign in (interactive, uses your Google account):
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
2. Point clasp at your Apps Script project: from `appsscript/`, copy `.clasp.json.example` to
   `.clasp.json` (gitignored) and paste your script id (Apps Script editor → **Project Settings →
   IDs → Script ID**), **or** `clasp clone <scriptId>` into this folder.
3. Push the code: `cd appsscript && clasp push` (that's where `.clasp.json` lives, with
   `rootDir: "."`). The push writes `appsscript.json`'s scopes, so Apps Script may prompt you to
   re-authorize on the next run — that's expected.
4. In the Apps Script editor → **Project Settings → Script Properties**, set these (they live in
   Apps Script, **never in the repo**, so the recipient sheet id and Drive ids stay private):

   | Property                | Example / meaning                                                           |
   | ----------------------- | --------------------------------------------------------------------------- |
   | `RECIPIENTS_SHEET_ID`   | Drive id of the recipients spreadsheet (has the PII list)                   |
   | `ISSUE_EMAIL_FOLDER_ID` | Drive **folder** id holding issue email HTML — newest `.html` is auto-used  |
   | `UXTIP_EMAIL_FOLDER_ID` | Drive **folder** id holding UX-tip email HTML — newest `.html` is auto-used |
   | `ISSUE_SUBJECT`         | _optional fallback_ — subject normally rides in the email (see below)       |
   | `UXTIP_SUBJECT`         | _optional fallback_ — same, for UX-tip emails                               |
   | `REPLY_TO`              | your address (also gets a copy of each batch for visibility)                |
   | `REVIEWERS`             | comma-separated reviewer addresses for **test** mode                        |
   | `UNSUBSCRIBE_URL`       | optional: link/mailto added as an unsubscribe footer                        |

   **Subject resolution:** the subject is read from the email HTML's
   `<meta name="subject" content="…">` tag, so it ships with each issue and needs **no monthly
   Script Property edit**. `ISSUE_SUBJECT` / `UXTIP_SUBJECT` are used only as a fallback when an
   email has no such tag. `dryRunIssue` logs the resolved `Subject:` so you can confirm it before
   sending.

   **Email HTML resolution:** by default the script auto-picks the **newest `.html`** in the
   configured folder (`ISSUE_EMAIL_FOLDER_ID` / `UXTIP_EMAIL_FOLDER_ID`), so there's no per-issue
   file id to update — just drop the new email HTML in the folder. To pin an exact file instead,
   set `ISSUE_HTML_FILE_ID` / `UXTIP_HTML_FILE_ID` (these override the folder). Narrow the match
   with `ISSUE_HTML_PATTERN` / `UXTIP_HTML_PATTERN` (a case-insensitive filename substring) if a
   folder holds more than one kind of `.html`.

   Optional overrides (sensible defaults in `Code.gs`): `RECIPIENTS_TAB` (`Recipients`),
   `EMAIL_HEADER` (`email`), `ACTIVE_HEADER` (`active`), `SUPPRESSION_TAB` (`Unsubscribed`),
   `BATCH_SIZE` (`45`), `BATCH_PAUSE_MS` (`1200`), `FROM_NAME`, `TRACKING_BASE_URL` (see
   "Engagement tracking" below).

   > These folders/files live in the **Pulse-Web-SEO** shared drive under
   > **`01 Tools & Plugins`**. Drive **ids are stable across moves**, so relocating folders there
   > does not change any of these property values — just keep your access to the shared drive (the
   > script reads them as you).

## Running

Always preview first:

| Function                                               | What it does                                               |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `dryRunIssue`                                          | Logs recipient count + sample + batches, **sends nothing** |
| `sendIssueTest`                                        | Issue email to `REVIEWERS` only                            |
| `sendIssueBroadcast`                                   | Issue email to the full active list (batched)              |
| `dryRunUxTip` / `sendUxTipTest` / `sendUxTipBroadcast` | same, for a UX tip                                         |

Run from the Apps Script editor, or `clasp run <function>` (needs the Apps Script API enabled and
an API-executable deployment). The `/new-issue` skill (Phase 6) drives this as
**render → test-send (approval gate) → broadcast (approval gate)**.

## Recipients sheet & suppression

- Recipients tab: columns `email` and `active` (truthy = `true/yes/y/1`). Matches the existing sheet.
- Suppression: add an `Unsubscribed` tab with an `email` column; broadcasts skip those addresses.
- Monthly: drop the new frozen issue email HTML into the `ISSUE_EMAIL_FOLDER_ID` folder — the
  script auto-uses the newest `.html`, so there's nothing else to update. Then `dryRunIssue` →
  `sendIssueTest` → `sendIssueBroadcast`.

## Engagement tracking (opens + clicks, opt-in)

Off by default — `send_()` behaves exactly as the batched/BCC description above until you opt in.
Once `TRACKING_BASE_URL` is set, it switches to **one `MailApp.sendEmail()` call per recipient**
instead (required for a personalized open pixel + per-recipient click links — a shared BCC body
can't carry that), still respecting `BATCH_SIZE`/`BATCH_PAUSE_MS` as a pacing pause between sends.

1. **Add a `token` column** to the Recipients tab (header exactly `token`, any position). This is a
   stable, opaque per-recipient id — not the email address — so it can sit safely in a mail-scanner-
   visible URL. Run `ensureRecipientTokens()` once from the Apps Script editor to backfill it for
   every existing row (harmless to re-run later for newly added recipients).
2. **Deploy the Web App**: Apps Script editor → **Deploy → New deployment → Web app** → execute as
   **Me**, access **Anyone**. Copy the deployed `/exec` URL into the `TRACKING_BASE_URL` Script
   Property. No new OAuth scope is needed — the sheet writes below reuse the existing `spreadsheets`
   scope.
3. **Tag CTAs you want click-tracked** with `data-track-id="some-short-id"` in the source email HTML
   (see `docs/handoff/research_roundup_email_template.html`) — untagged links are left untouched and
   simply aren't tracked. At send time, `extractTrackedLinks_()` records each tagged link's real
   destination against the issue id (parsed from the email's own `/issues/YYYY-MM/…` link — no
   separate issue-id placeholder needed), and `personalizeHtml_()` rewrites that recipient's copy to
   route through the Web App, plus appends a 1×1 open-tracking pixel before `</body>`.
4. **New sheet tabs** (auto-created on first use): `EmailEvents` (one row per open/click:
   `timestamp, event, token, issue, link`), `TrackedLinks` (`issue, link_id, url` — the server-side
   lookup table `doGet` redirects through; **a raw destination URL is never accepted as a request
   parameter**, only ever a `link_id` resolved against this table, to avoid an open-redirect on a
   public unauthenticated endpoint). Both are as private as the Recipients spreadsheet itself.
5. **`buildEngagementSummary()`** (run manually, or wire to a time-driven trigger) rebuilds an
   `EngagementSummary` tab — one row per issue: recipients, unique opens, unique clicks, open/click
   rate, top-clicked link. Recipient counts come from `sent` events logged at send time, not the
   _current_ Recipients list, so past issues' rates don't drift as the list changes size. This
   summary sheet is where **per-recipient "who opened/clicked" detail stays private** — transcribe
   only the aggregate numbers into `netlify/content/email_engagement.json` for the public,
   password-gated `/analytics/` page (see the site's `CLAUDE.md` "Dashboard signals" section).

**Platform limitation:** Apps Script's `doGet` can only return `HtmlOutput`/`TextOutput` — there's no
image mimetype available, so the open pixel's _response_ can't actually be a GIF. That doesn't
affect tracking: the GET request itself is what gets logged, before any response is built. The `<img>`
tag just renders as broken/blank in the recipient's client, which is invisible since it's a 1×1
`display:none` pixel anyway.

**Verify before a real broadcast:** `dryRunIssue` first, then `sendIssueTest` to `REVIEWERS` only —
open that test email, click a tracked link, and confirm rows land in `EmailEvents` — before ever
running `sendIssueBroadcast`.

## Scaling notes

- ~500 internal + a few external is fine on Workspace. If the list grows past the daily quota or
  the external share grows, move to multi-day batching or a dedicated email service (deliverability,
  one-click unsubscribe, analytics).
- A true one-click `List-Unsubscribe` header needs the advanced Gmail API (raw MIME); the footer
  link + suppression tab here is the low-lift path for a small external slice.
