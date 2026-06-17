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
2. Point clasp at your Apps Script project: copy `.clasp.json.example` to `.clasp.json` (gitignored)
   and paste your script id, **or** `clasp clone <scriptId>` into this folder.
3. Push the code: `clasp push` (run from the repo root, or `cd appsscript`).
4. In the Apps Script editor → **Project Settings → Script Properties**, set these (they live in
   Apps Script, **never in the repo**, so the recipient sheet id and Drive ids stay private):

   | Property                | Example / meaning                                                           |
   | ----------------------- | --------------------------------------------------------------------------- |
   | `RECIPIENTS_SHEET_ID`   | Drive id of the recipients spreadsheet (has the PII list)                   |
   | `ISSUE_EMAIL_FOLDER_ID` | Drive **folder** id holding issue email HTML — newest `.html` is auto-used  |
   | `UXTIP_EMAIL_FOLDER_ID` | Drive **folder** id holding UX-tip email HTML — newest `.html` is auto-used |
   | `ISSUE_SUBJECT`         | e.g. `Everpure Research Roundup — June 2026 Issue`                          |
   | `UXTIP_SUBJECT`         | e.g. `Everpure UX Tip — …`                                                  |
   | `REPLY_TO`              | your address (also gets a copy of each batch for visibility)                |
   | `REVIEWERS`             | comma-separated reviewer addresses for **test** mode                        |
   | `UNSUBSCRIBE_URL`       | optional: link/mailto added as an unsubscribe footer                        |

   **Email HTML resolution:** by default the script auto-picks the **newest `.html`** in the
   configured folder (`ISSUE_EMAIL_FOLDER_ID` / `UXTIP_EMAIL_FOLDER_ID`), so there's no per-issue
   file id to update — just drop the new email HTML in the folder. To pin an exact file instead,
   set `ISSUE_HTML_FILE_ID` / `UXTIP_HTML_FILE_ID` (these override the folder). Narrow the match
   with `ISSUE_HTML_PATTERN` / `UXTIP_HTML_PATTERN` (a case-insensitive filename substring) if a
   folder holds more than one kind of `.html`.

   Optional overrides (sensible defaults in `Code.gs`): `RECIPIENTS_TAB` (`Recipients`),
   `EMAIL_HEADER` (`email`), `ACTIVE_HEADER` (`active`), `SUPPRESSION_TAB` (`Unsubscribed`),
   `BATCH_SIZE` (`45`), `BATCH_PAUSE_MS` (`1200`), `FROM_NAME`.

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

## Scaling notes

- ~500 internal + a few external is fine on Workspace. If the list grows past the daily quota or
  the external share grows, move to multi-day batching or a dedicated email service (deliverability,
  one-click unsubscribe, analytics).
- A true one-click `List-Unsubscribe` header needs the advanced Gmail API (raw MIME); the footer
  link + suppression tab here is the low-lift path for a small external slice.
