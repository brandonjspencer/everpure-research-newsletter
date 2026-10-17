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

1. Sign in to clasp (interactive, uses your Google account). Run it through `npx` — no global
   install needed (a global `npm install -g` can hit EACCES on `/usr/local/lib`):
   ```bash
   npx @google/clasp login
   ```
2. Point clasp at your Apps Script project: from `appsscript/`, copy `.clasp.json.example` to
   `.clasp.json` (gitignored) and paste your script id (Apps Script editor → **Project Settings →
   IDs → Script ID**), **or** `npx @google/clasp clone <scriptId>` into this folder.
3. Push the code: `cd appsscript && npx @google/clasp push` (that's where `.clasp.json` lives,
   with `rootDir: "."`). clasp 3 asks before overwriting the remote manifest on every push and
   skips the push if it can't ask (no terminal) — add `--force` there, which is safe because
   `appsscript.json` in the repo mirrors the deployed one, including its `webapp` block. The push
   writes `appsscript.json`'s scopes, so Apps Script may prompt you to re-authorize on the next run —
   that's expected.
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
   `BATCH_SIZE` (`45`), `BATCH_PAUSE_MS` (`1200`), `FROM_NAME`, `GA_MEASUREMENT_ID` /
   `TRACKING_BASE_URL` (see "Engagement tracking" below).

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
Once on, it switches to **one `MailApp.sendEmail()` call per recipient** (a personalized body can't
ride in a shared BCC batch), still pacing with `BATCH_SIZE`/`BATCH_PAUSE_MS`. There are two modes;
**GA4 wins if both are configured.**

Either way, recipients need a token and CTAs need a tag:

1. **Add a `token` column** to the Recipients tab (header exactly `token`, any position). This is a
   stable, opaque per-recipient id — not the email address — so it can sit safely in a URL. Run
   `ensureRecipientTokens()` once from the Apps Script editor to backfill it for every existing row
   (harmless to re-run later for newly added recipients). Test sends synthesize a `test-…` token per
   reviewer.
2. **Tag CTAs you want click-tracked** with `data-track-id="some-short-id"` in the source email HTML
   (see `docs/handoff/research_roundup_email_template.html`) — untagged links are left untouched and
   simply aren't tracked. The issue id comes from the email's own `/issues/YYYY-MM/…` link.

### GA4 mode (preferred) — `GA_MEASUREMENT_ID`

Set the `GA_MEASUREMENT_ID` Script Property to the site's GA4 id (the same id as `GA_MEASUREMENT_ID`
in `netlify/dashboard_theme.js`). Then `personalizeGaHtml_()` writes each recipient's copy:

- **Clicks:** every tagged link keeps its real destination and gains `utm_content=<link id>` and
  `rid=<token>`. The site's GA4 tag records the full URL as `page_location`, so the visit, the CTA,
  and the token all land in GA4. Nothing sits in the click path — no redirect, no sign-in — so
  external recipients get straight through. Frozen issues already carry the GA4 tag, so this needs no
  site change.
- **Opens:** a 1×1 `email_open` hit to GA4's collection endpoint (`google-analytics.com/g/collect`,
  the one gtag.js uses) with client id = the token and `page_location` =
  `<site>/email/YYYY-MM/open?rid=<token>` (a synthetic path, so opens never count toward the issue
  page's users). GA4 documents no GET endpoint for email, so this is best-effort — though a Gmail
  test send on 2026-10-16 confirmed the hit gets through Gmail's image proxy and is counted. Apple
  Mail pre-loads images (false opens), Gmail caches after the first open (no repeat opens), and
  Outlook often blocks images. **Treat open counts as directional.**
- **Test sends** add GA4's debug flag (`_dbg=1`) to the open hit. Check for it in **Realtime
  overview → Event count by Event name** — DebugView doesn't list these hits.
- `EmailEvents` still gets one `sent` row per recipient, so `buildEngagementSummary()` keeps each
  issue's recipient count; opens and clicks live in GA4, not the sheet.

**Reading it** (GA4 → Explore → Free form): dimensions `Event name`, `Page location`, and
`Session manual ad content` (the CTA); filter `Page location` contains `rid=`. Clicks are
`page_view`s on `/issues/YYYY-MM/…`; opens are `email_open`s on `/email/YYYY-MM/open`. Match tokens to
people only in the private Recipients sheet — the URL and GA4 only ever see the opaque token (GA4's
terms forbid sending emails or names). Transcribe **aggregate numbers only** into
`netlify/content/email_engagement.json` for the password-gated `/analytics/` page (see the site's
`CLAUDE.md`). Caveats: a forwarded email credits the original recipient; tracker blockers undercount.

### Web App mode (legacy) — `TRACKING_BASE_URL`

Links and the open pixel route through the script's own `doGet()`, which logs to `EmailEvents` and
redirects. **This needs the Web App's access set to "Anyone", which the Pure Storage Workspace doesn't
offer** — the deployment is "Anyone within Pure Storage" (`webapp.access: DOMAIN`), so every click
hits a Google sign-in unless the browser is already signed in to a Pure account, external recipients
can't get through at all, and the open pixel never logs (Gmail's image proxy is anonymous). Kept for
reference; use GA4 mode. Setup was: **Deploy → New deployment → Web app** → execute as **Me**, access
**Anyone**, then copy the `/exec` URL into `TRACKING_BASE_URL`. At send time `extractTrackedLinks_()`
records each tagged link's destination in `TrackedLinks` (`issue, link_id, url` — the lookup table
`doGet` redirects through; **a raw destination URL is never accepted as a request parameter**, to
avoid an open redirect on a public endpoint), and `personalizeHtml_()` rewrites the links to the Web
App plus appends a 1×1 pixel. `buildEngagementSummary()` rebuilds `EngagementSummary` (recipients,
unique opens/clicks, rates, top link) from `EmailEvents`. Apps Script can't return an image mimetype,
so the pixel's response is an empty text body — invisible, since the `<img>` is `display:none`.

**Verify before a real broadcast:** `dryRunIssue` first — it logs the tracking mode, the issue id, and
the tracked link ids — then `sendIssueTest` to `REVIEWERS` only. In GA4 mode: open the test email in
Gmail and look for `email_open` in GA4 **Realtime overview** (Event count by Event name), then click
a link and confirm the address carries `utm_content` and `rid` and Realtime shows the page view. Only
then run `sendIssueBroadcast`.

## Scaling notes

- ~500 internal + a few external is fine on Workspace. If the list grows past the daily quota or
  the external share grows, move to multi-day batching or a dedicated email service (deliverability,
  one-click unsubscribe, analytics).
- A true one-click `List-Unsubscribe` header needs the advanced Gmail API (raw MIME); the footer
  link + suppression tab here is the low-lift path for a small external slice.
