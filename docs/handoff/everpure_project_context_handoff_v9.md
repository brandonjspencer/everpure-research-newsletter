# Everpure Research Newsletter Builder — Project Context Handoff

**Version:** v9 — Issue 02 finalization, agent suite, QC workflow, AI context export process, and monthly Google refresh-token runbook

This document is intended to be uploaded as project context for future chats so a new conversation can restart without losing critical setup, architecture, deployment details, workflow expectations, operating instructions, or the current preservation plan for newsletter issues over time.

This version refreshes the prior handoff with the latest project state, including:
- the current on-brand default newsletter presentation
- the current stage-2 default-brief and marketing-log writers
- the default newsletter’s current design system decisions
- the latest cautions around stage-2 patching and build safety
- the current state of the marketing activity-log variant, which remains useful but still needs semantic grouping refinement
- the current **issue preservation and archive plan** for keeping monthly issues and cumulative evidence over time
- the fact that the **first frozen issue archive now exists for `2026-04`**
- the current **email workflow** for building, testing, and sending a roundup issue through Gmail
- the new rule that distribution email should point to the **frozen archived issue**, not the mutable latest page
- the current **Apps Script + spreadsheet-driven recipient workflow** for sending the email
- the **Issue 02 / May 2026 refresh and finalization learnings**, including the GitHub Actions build process, Google refresh-token fix, stage-2 renderer conversion away from hardcoded Issue 01 copy, confidence criteria, public-facing editorial rules, reader-value refinements, archive-freeze workflow, and email refinements for distribution
- the new **quality-control and minimum-agent operating model** for keeping future issues evidence-led, reader-facing, non-redundant, and email-safe
- the new **GitHub app workaround and AI context export workflow** for giving ChatGPT repo visibility when the ChatGPT GitHub app is blocked by company admin policy
- the new **monthly new-issue start ritual**: when the user says it is time to update/build a new issue, first walk them through the Google OAuth refresh-token rotation, dry build, cache-busted verification, and evidence-integrity checks before editorial synthesis begins



## Monthly new-issue start ritual — new in v9

This section exists because the Google refresh-token failure in Issue 02 is likely to recur. The user has set a calendar reminder before the next monthly build. When the user says anything like:

- "we need to update to a new issue"
- "let's build the next issue"
- "it's time for next month's refresh"
- "run the new issue build"
- "we need to do the refresh key again"

future ChatGPT sessions must **not** jump straight into build, editorial synthesis, or patching. Start by walking the user through the Google OAuth refresh-token rotation and verification process.

### Required assistant behavior

1. Assume the Google refresh token may be stale unless the user explicitly says they already refreshed it.
2. Remind the user not to paste secrets, tokens, client secrets, `.env` values, or credentials into chat.
3. Walk the user through generating a new Google OAuth refresh token with Google OAuth 2.0 Playground.
4. Walk the user through updating the GitHub Actions secret `GOOGLE_REFRESH_TOKEN`.
5. Trigger or guide a dry GitHub Actions build.
6. Verify the build with cache-busted live artifact checks.
7. Only then proceed into the Evidence Integrity Agent and editorial synthesis workflow.

### Google refresh-token rotation steps

When a new issue cycle begins, guide the user through this sequence.

#### Step 1 — Confirm prerequisites

The user needs:

```text
Google Cloud OAuth Client ID
Google Cloud OAuth Client Secret
Google account with access to the research decks
GitHub repo Settings access
```

Do not ask the user to paste these values into chat.

#### Step 2 — Generate a new refresh token

Use Google OAuth 2.0 Playground.

Important settings:

1. Open the gear/settings icon.
2. Enable **Use your own OAuth credentials**.
3. Enter the Google Cloud OAuth Client ID and Client Secret locally in the Playground.
4. Authorize these scopes:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/presentations.readonly
```

5. Click **Authorize APIs**.
6. Sign in with the Google account that has access to the research decks.
7. Click **Exchange authorization code for tokens**.
8. Copy the returned `refresh_token`.

Important: the refresh token should be pasted only into GitHub Actions secrets, not into ChatGPT.

#### Step 3 — Update the GitHub Actions secret

Have the user go to:

```text
https://github.com/brandonjspencer/everpure-research-newsletter/settings/secrets/actions
```

Update only:

```text
GOOGLE_REFRESH_TOKEN
```

The expected GitHub Actions secrets remain:

```text
SOURCE_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

The expected GitHub Actions variable remains:

```text
GOOGLE_FETCH_LIMIT
```

#### Step 4 — Run a dry build

If the user does not have GitHub CLI installed, use the browser:

```text
GitHub repo → Actions → deploy-pages.yml → Run workflow → main
```

Or use an empty commit:

```bash
cd ~/everpure-research-newsletter
git pull --ff-only origin main
git commit --allow-empty -m "Refresh Google token and run monthly build"
git push origin main
```

#### Step 5 — Verify the build with cache-busted artifacts

After the Action is green, verify the live status with a cachebuster:

```bash
curl -L "https://brandonjspencer.github.io/everpure-research-newsletter/status.json?cb=$(date +%s)"
```

Check that:

```text
generated_at is current
fetched_at is current
latest_week_date is inside the new issue window
record_count is nonzero
deck_count is nonzero
deck_content_count is not unexpectedly zero
```

Then review the current issue with a cachebuster:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/newsletter/default.html?cb=TIMESTAMP
```

Also review:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/newsletter/default.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/evidence_packs_default_30d.json?cb=TIMESTAMP
https://brandonjspencer.github.io/everpure-research-newsletter/data/concept_evidence_default_30d.json?cb=TIMESTAMP
```

#### Step 6 — Run the minimum agent sequence

Only after the token has been refreshed and the build is verified should the assistant proceed through the minimum agent suite:

```text
1. Evidence Integrity Agent
2. Research Synthesis Agent
3. Reader Value Agent
4. Section Role & Redundancy Agent
5. Email Adaptation Agent
```

The Quality Control Agent remains the final approval gate before freezing and emailing.

### Failure handling

If the build fails with:

```text
requests.exceptions.HTTPError: 400 Client Error: Bad Request for url: https://oauth2.googleapis.com/token
```

or references:

```text
everpure_google_fetch.py
resolve_access_token()
issue_refresh_token_access_token()
```

assume the refresh-token exchange failed. Have the user regenerate and update `GOOGLE_REFRESH_TOKEN` again. Do not troubleshoot newsletter content until the token/build issue is resolved.

If token expiration recurs repeatedly, remind the user to check whether the Google OAuth app is in Testing mode or whether admin policy is expiring refresh tokens. Keep the manual monthly refresh-token runbook as the reliable fallback.

### Important memory for future chats

The user has already set the calendar reminder. When they return next month, they may simply say "we need to update to a new issue." Treat that as the trigger to start this runbook immediately.


## May 2026 operating-system addendum — new in v8

This section captures the process hardening added after the Issue 02 finalization pass: the Research Roundup Quality Control Agent, the Minimum Agent Suite, the recommended project-source setup, and the GitHub-app workaround using an AI context export script.

### Why v8 exists

Issue 02 proved that the project can now produce a high-quality, send-ready Research Roundup, but it also showed that quality depends on more than the deterministic build succeeding.

The build can be green while the issue still has problems such as:
- stale hardcoded stage-2 copy
- label-level synthesis instead of reader-facing insight
- public copy that accidentally references the newsletter pipeline
- weak or underspecified unresolved items
- repeated language across Findings, Comparisons, and Actions
- email layout/content issues that only show up after recipient feedback

The v8 operating model adds a repeatable check-and-balance layer so every future issue can be reviewed in the same disciplined sequence.

### Active project sources to keep uploaded

For future chats, the recommended active project context sources are:

1. `everpure_project_context_handoff_v8.md`
2. `everpure_research_roundup_quality_control_agent.md`
3. `everpure_minimum_agent_suite_combined.md`
4. `research_roundup_email_template.html` when email work is in scope

Use the **combined** minimum agent suite as the canonical active source. Keep the individual agent markdown files available as editable references, but do not upload both the combined suite and every separate agent file as active sources unless needed for direct editing. Uploading both can create duplicated or conflicting retrieval.

Recommended repo/reference structure for the separate agent files:

```text
docs/agents/
  01_evidence_integrity_agent.md
  02_research_synthesis_agent.md
  03_reader_value_agent.md
  04_section_role_redundancy_agent.md
  05_email_adaptation_agent.md
```

Whenever an individual agent changes, regenerate or update the combined suite so the uploaded project source remains canonical.

### Minimum agent suite

The minimum agent suite defines the five gates that should run after a deterministic build is live and before an issue is frozen or emailed.

Run them in this order:

| Order | Agent | Primary question | Output |
|---:|---|---|---|
| 1 | Evidence Integrity Agent | Is the build fresh and is the evidence substrate strong enough to support synthesis? | Evidence readiness report |
| 2 | Research Synthesis Agent | What did the research actually teach us, and how should each item be classified? | Reader-facing issue synthesis map |
| 3 | Reader Value Agent | Would program participants, stakeholders, and leaders understand why this issue matters? | Reader-value critique and copy improvements |
| 4 | Section Role & Redundancy Agent | Does each section do a distinct job without repeating the same point? | Redundancy map and section-role fixes |
| 5 | Email Adaptation Agent | Does the approved issue work as an email artifact? | Email QA report and send-readiness checklist |

These agents should treat the deterministic build as the source-of-truth layer and ChatGPT as the manual stage-2 synthesis/refinement layer. They do not replace the build, and they do not run autonomously inside GitHub Actions.

### How the Quality Control Agent relates to the minimum agents

The **Minimum Agent Suite** is the workflow sequence. It breaks the review into specialized gates.

The **Research Roundup Quality Control Agent** is the final editorial guardrail. It should be used after synthesis and refinement, before approval, freeze, and email send.

Use the QC Agent to confirm:
- public issue copy does not mention internal pipeline/build mechanics
- Research Findings are about studies and what they revealed
- confidence labels follow the agreed rubric
- unresolved questions explain what is unclear and why it matters
- recommended actions are operational and concept-labeled
- sections do not repeat the same direction copy
- email, archive, and feedback-link requirements are satisfied

### Updated end-to-end monthly issue workflow

Use this sequence for future monthly issues:

1. Trigger or wait for the deterministic GitHub Pages build.
2. Review the live latest issue and data artifacts with cache-busting URLs.
3. Run the **Evidence Integrity Agent**.
4. If evidence is sufficient, run the **Research Synthesis Agent**.
5. Run the **Reader Value Agent** to improve context and usefulness for program participants, stakeholders, and leadership.
6. Run the **Section Role & Redundancy Agent** to ensure each section does a distinct job.
7. Apply renderer/content patches as needed.
8. Run the **Research Roundup Quality Control Agent** as the final web-issue review.
9. Freeze the approved issue into `/issues/YYYY-MM/`.
10. Run the **Email Adaptation Agent** against the approved frozen issue.
11. Test the email on Gmail desktop and phone.
12. Send through the Apps Script/Gmail workflow.
13. Capture feedback from `#research-and-discovery` and fold recurring feedback into the QC Agent, Minimum Agent Suite, and handoff.

### GitHub app blocked: repo-visibility workaround

The user’s admin blocks the ChatGPT GitHub app. Future chats must not depend on the GitHub connector being available.

The recommended workaround is a hybrid read/write loop:

1. ChatGPT reviews public GitHub Pages outputs and the public GitHub repo when possible.
2. The user exports a clean AI context ZIP from the local repo when exact source context is needed.
3. ChatGPT reviews the ZIP and returns patch bundles.
4. The user applies patches locally, validates, commits, and pushes.
5. GitHub Actions deploys to GitHub Pages.
6. ChatGPT verifies the live output with cache-busting URLs.

ChatGPT should not ask for credentials, secrets, direct repo write access, or GitHub app access to continue work.

### AI context export script

A patch was created to add a repeatable repo-context export workflow:

```text
scripts/export_ai_context.sh
AI_CONTEXT_EXPORT_README.md
```

When present in the repo, the normal export command is:

```bash
cd ~/everpure-research-newsletter
bash scripts/export_ai_context.sh
```

The script should create a timestamped ZIP on the user’s Desktop, for example:

```text
everpure-ai-context-YYYYMMDD-HHMMSS.zip
```

The export should include the files ChatGPT needs for inspection and patching, such as:
- `netlify/`
- `.github/workflows/`
- `emails/`
- `issues/`
- `history/`
- key root files such as `package.json`, `requirements.txt`, and relevant README files
- latest generated `publish/data/*.json` and newsletter outputs, when useful

The export must exclude:
- `.git/`
- `node_modules/`
- `.env` and `.env.*`
- credentials, tokens, refresh tokens, private keys, and other secrets
- local OS junk such as `.DS_Store`

If the script is not available yet, use a manual clean ZIP export from the repo root or a smaller targeted ZIP for the directories under active review.

### Patch round-trip standard

Because ChatGPT cannot push directly, future repo changes should use patch bundles.

Preferred pattern:

```bash
cd ~/everpure-research-newsletter

PATCH_DIR=/tmp/<patch-name>
rm -rf "$PATCH_DIR"
mkdir -p "$PATCH_DIR"

PATCH_ZIP=$(ls -t ~/Downloads/<patch-name>*.zip 2>/dev/null | head -n 1)
unzip -o "$PATCH_ZIP" -d "$PATCH_DIR"

# Then run the patch-specific apply command, commonly one of:
git apply "$PATCH_DIR/<patch-file>.patch"
python3 "$PATCH_DIR/<patch-folder>/apply_patch_script.py"

# Validate as appropriate:
node --check netlify/render_stage2_default_current.js

# Review only relevant diffs:
git --no-pager diff -- <specific-file-or-folder>

# Stage only intended files:
git add <specific-file-or-folder>
git commit -m "<clear commit message>"
git push origin main
```

Do not commit generated `publish/` files during normal renderer/content/email patches unless the task explicitly calls for committing generated artifacts.

### Repo visibility hierarchy for future chats

Use this order when ChatGPT needs visibility:

1. **Live GitHub Pages outputs** for issue/content review.
   - Always use cache-busting URLs.
2. **Public GitHub repo pages** for committed source-file inspection when enough context is visible publicly.
3. **AI context export ZIP** for exact local repo state and patching.
4. **Targeted ZIP** for smaller focused work, such as only `netlify/`, `emails/`, `issues/`, and `.github/workflows/`.
5. **Full clean repo ZIP** only when broad inspection is required.

The AI context export is the preferred long-term workaround because it is repeatable, avoids secrets, and does not depend on the blocked ChatGPT GitHub app.

### Updated source-of-truth hierarchy

For future work, treat the source-of-truth hierarchy as:

1. Live upstream Notion + Google Slides decks as fetched by the deterministic build.
2. Published static data artifacts on GitHub Pages, especially `status.json`, `weeks.json`, `evidence_packs_default_30d.json`, `concept_evidence_default_30d.json`, `deck_content.json`, and `newsletter/default.json`.
3. The current live rendered page, reviewed with a cache buster.
4. The repo source files, accessed via public GitHub or uploaded AI context ZIP.
5. ChatGPT-generated patches and editorial recommendations.

If these disagree, prefer the freshest deterministic build artifacts, then patch the stage-2 renderer or email artifact to align with the approved editorial direction.

### New default chat behavior

When a future chat starts, it should:

1. Confirm whether the task is about the live issue, the repo source, the email artifact, the archive, or the agent system.
2. Use GitHub Pages and cache-busted outputs first when reviewing issue quality.
3. Ask for an AI context export ZIP when code-level patching is needed and public GitHub inspection is insufficient.
4. Run or invoke the relevant minimum agent before proposing substantial content or renderer changes.
5. Keep public newsletter content separate from internal build, source, and publishing mechanics.
6. Return patch bundles rather than asking for direct repo access.

### Security and privacy reminders

- Never ask the user to paste GitHub secrets, Google OAuth refresh tokens, client secrets, `.env` files, private keys, or credentials into chat.
- If Google auth fails again, guide the user to update `GOOGLE_REFRESH_TOKEN` in GitHub repository secrets; do not ask them to reveal the token.
- AI context ZIPs should be source/context exports only and must not include secrets.
- Patches should not add secrets, hardcoded credentials, or private local paths.


## May 2026 Issue 02 finalization addendum — new in v7

This section captures what changed after the v6 handoff: the Issue 02 content pass was refined to a send-ready level, the issue was prepared for freeze, and the Issue 02 email was created and iterated based on recipient feedback.

### Issue 02 approved state

Issue 02 is now considered **approved for sending this week**. Future work should treat the May 2026 issue as ready to freeze into the dated archive rather than as an open scaffold.

The approved issue should be frozen to:
- `/issues/2026-05/default.html`
- `/issues/2026-05/default.md`
- `/issues/2026-05/default.json`
- `/issues/2026-05/marketing-activity-30d.html`
- `/issues/2026-05/marketing-activity-30d.md`
- `/issues/2026-05/marketing-activity-30d.json`
- `/issues/2026-05/issue_manifest.json`

The approved email CTA should point to:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/issues/2026-05/default.html
```

Do not send email traffic to mutable `/newsletter/default.html`.

### Issue 02 freeze workflow

A freeze bundle was created for Issue 02. Its intent was to:
- copy the approved current web issue into `issues/2026-05/`
- copy the approved marketing activity issue into `issues/2026-05/`
- copy history artifacts into `history/`
- add section anchors to the archived issue for email deep links
- add the Issue 02 email artifact at `emails/research_roundup_issue02_email_may2026.html`

Expected commit pattern after running the freeze script:

```bash
cd ~/everpure-research-newsletter

git status --short
git add issues/2026-05 history emails/research_roundup_issue02_email_may2026.html
git commit -m "Freeze Issue 02 and add email artifact"
git push origin main
```

If a future chat is unsure whether the freeze landed, check:
- `/issues/2026-05/default.html`
- `/issues/2026-05/issue_manifest.json`
- `/data/issues.json`
- `emails/research_roundup_issue02_email_may2026.html` in the repo

### Cache-busting review rule

During Issue 02 refinement, page reviews were sometimes stale because GitHub Pages/browser caching showed an older version of `/newsletter/default.html`.

When reviewing the live page, always use a cache buster:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/newsletter/default.html?cb=<timestamp>
```

Terminal checks can use:

```bash
curl -L "https://brandonjspencer.github.io/everpure-research-newsletter/newsletter/default.html?cb=$(date +%s)" | head
curl -L "https://brandonjspencer.github.io/everpure-research-newsletter/status.json?cb=$(date +%s)"
```

This is especially important before critiquing content, because the issue changed multiple times during the May refinement cycle.

### Current approved Issue 02 editorial shape

The final Issue 02 direction is reader-facing, not pipeline-facing. It is intended to be valuable to:
- research program participants
- design/content/product partners
- mid-level leadership
- executive reviewers

The current approved issue structure is:
- **Research Findings:** what the research is helping us understand
- **Meaningful Comparisons:** what decision remains and how to judge it
- **What Is Still Unresolved:** what is unclear, why it matters, and what would unblock it
- **Recommended Actions:** operational next steps tied to specific research tracks

The approved email summary/count framing uses:
- `3` Research Findings
- `3` Comparison Tests
- `5` Recommended Actions

The email intentionally omits Open Questions from the stat row, even though the web issue still includes unresolved items.

### Reader-value pass: strongest Issue 02 content lessons

The final Issue 02 pass moved away from generic evidence-pack labels and pulled forward clearer research meaning from the studies.

Current content themes to preserve:

1. **Events Page**
   - The real story is simplification and progression.
   - The stronger direction appears to be a cleaner, lighter event page structure that helps visitors understand what is available and move toward event content.
   - Avoid reducing this to “Events Page Baseline.” The reader needs to know what was learned about clarity, structure, and next-step confidence.

2. **Homepage AI Messaging**
   - The issue is not “more AI versus less AI.”
   - The stronger question is whether AI language clarifies the offer, improves credibility, or creates unnecessary abstraction.
   - Future tests should define the success criterion before adding more AI messaging.

3. **Pathfinder CTA Labels**
   - The learning is about expectation-setting and commitment friction, not label preference alone.
   - CTA evaluation should ask whether visitors understand what happens next and whether the label matches their stage of intent.

4. **Webinar Registration Page**
   - This belongs in unresolved/watch territory unless evidence clearly shows what is blocking registration.
   - The unresolved question should name the possible blockers: value clarity, form friction, offer framing, or missing content detail.

5. **Reader Filter: “This Book”**
   - This needs enough context to be understandable to readers.
   - Do not use the vague title `This Book Filter`; use `Reader Filter: “This Book”` or an equivalent label that names the UI/content context.

6. **Virtualization Campaign**
   - This should not be framed vaguely as “a real signal.”
   - Explain the possible signal: whether the campaign message is clarifying virtualization value, reaching the right audience, or creating next-step interest.
   - Keep it unresolved or as a watch item unless the signal repeats or becomes more specific.

### Public copy rules reinforced during final pass

The final pass established additional public-facing rules:

- Do **not** include parenthesized date lists like `(2026-04-09, 2026-04-16, 2026-04-30)` in evidence copy.
- Replace date lists with reader-friendly phrases like `across multiple weekly updates`, `across repeated updates`, or `in a recent update`.
- Do **not** say “the signal” without naming what signal the reader should understand.
- Unresolved items must explain what is unclear and why that uncertainty matters.
- Research Findings should never describe the newsletter, issue, cycle, renderer, build, evidence extraction, or publishing process.
- Findings must be about the studies and what they reveal about comprehension, confidence, preference, trust, friction, or progression.
- Avoid using internal concept labels as if they are insights.

### Section differentiation rule

The final Issue 02 refinements clarified that the same concept can appear in multiple sections, but each section must do a different job:

- **Findings** answer: what did we learn?
- **Comparisons** answer: what decision remains and how should we judge it?
- **Unresolved** answers: what is still unclear and what evidence would unblock the decision?
- **Actions** answer: what should the team do next?

Avoid repeating the same sentence or direction across Findings, Comparisons, and Actions.

### Recommended Actions final rules

The final action list should feel operational, not repetitive.

Rules:
- every action should have a visible concept label
- the label should be smaller than the action body
- remove secondary scope/date lines beneath the label
- actions should not repeat the `Direction` copy verbatim
- actions should explain how to operationalize the next step, such as creating a decision scorecard or defining a success criterion
- remove generated duplicate actions
- remove any action about testing the Research Roundup/newsletter itself
- remove build/archive/deck-extraction/publishing tasks from public actions

### Final layout rules added after v6

Additional layout refinements landed after v6:

- The **What Is Still Unresolved** section should use a 2-up desktop layout when there is more than one item.
- If the unresolved count is odd, the final unresolved item should span the full row as a 1-up card.
- Mobile remains single-column.
- This replaced the earlier narrower 3-up presentation, which made the unresolved copy feel cramped.
- A feedback signoff should appear near the bottom of the web issue:

```text
Have feedback on how to improve the newsletter? Share it in #research-and-discovery.
```

The channel name should link to:

```text
https://purestorage.enterprise.slack.com/archives/C03NSK4PCHJ
```

### Issue 02 email artifact and design rules

The Issue 02 email is a separate HTML artifact and should remain isolated from the web renderer.

Current intended repo path:

```text
emails/research_roundup_issue02_email_may2026.html
```

The email should point to the frozen issue archive, not the latest page:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/issues/2026-05/default.html
```

Recipient-feedback refinements for the Issue 02 email:

1. **Top bar**
   - Remove `Read Full Roundup` from the top bar.
   - Replace it with `Estimated Read · 6 min`.

2. **Hero eyebrow**
   - Use `May 2026 · Issue 02`.
   - The user originally typed May 2027 in one message, but the actual issue is May 2026. Use the real issue month/year unless the user explicitly confirms a different year.

3. **Hero date line**
   - Remove `May 2026` from the line below the heading after adding it to the eyebrow.
   - Keep the remaining cycle framing concise, such as `30-day research cycle`.

4. **Hero CTA**
   - Add a `Read Issue` CTA to the right of the hero heading when there is enough horizontal room.
   - Keep it right-aligned when side-by-side.
   - On small phone widths, stack the CTA below the heading and left-align it.
   - Current responsive rule: side-by-side/right-aligned from roughly `481–620px`; stacked/left-aligned at `480px` and below.

5. **Stats row**
   - Use three blocks:
     - `3` Research Findings
     - `3` Comparison Tests
     - `5` Recommended Actions
   - Remove `3 Open Questions` from this row.

6. **In this issue**
   - Add anchor links to the corresponding archived web sections.
   - Expected section anchors:
     - `#research-findings`
     - `#meaningful-comparisons`
     - `#what-is-still-unresolved`
     - `#recommended-actions`

7. **Executive Summary / quote module**
   - Do not present a non-quote as a quote.
   - Use a real participant quote when one is available.
   - For Issue 02, the email used the Events quote: `“Simplify it to make it more user friendly.”`
   - If no real quote is available in a future issue, remove the quote styling/module or rewrite it as a plain summary rather than a faux quotation.

### Email testing and send reminder

Before sending the Issue 02 email:
- confirm the archive URL exists and loads
- test the email in Gmail desktop
- test on a phone
- confirm the hero CTA alignment behavior
- confirm top-bar estimated-read text
- confirm section anchor links jump to the archived issue sections
- confirm all CTA links point to `/issues/2026-05/default.html`
- send through the Apps Script / Gmail workflow using the approved recipient process


## May 2026 Issue 02 refresh addendum — new in v6

This section captures the important lessons, fixes, and editorial rules established while building the second newsletter issue.

### Issue 02 build state observed during this refresh

The GitHub Pages workflow is now successfully refreshing from the live source again.

In the successful Issue 02 GitHub Actions build log, the build showed:
- `generated_at`: `2026-05-11T17:51:46Z`
- `fetched_at`: `2026-05-11T17:51:36Z`
- `record_count`: `52`
- `deck_count`: `23`
- `date_range.max`: `2026-05-07`

That means Stage 1 ingestion was current through the May 7 research update during this build cycle.

### Current Issue 02 publication status

Superseded by the v7 finalization addendum above.

Issue 02 is now treated as **approved for freeze and distribution**. The mutable latest page remains useful for iteration, but the send-ready issue should be frozen into `/issues/2026-05/` and email CTAs should point to the archived page rather than `/newsletter/default.html`.

The archive model remains:
- current builds update `latest`
- only approved monthly issues should be frozen into `/issues/YYYY-MM/`
- approved distribution email should point to the frozen archive

### GitHub Actions / local development build process

The user’s local Mac did not have GitHub CLI (`gh`) or Homebrew installed. The most reliable no-install development trigger is an empty commit from the local repo:

```bash
cd ~/everpure-research-newsletter
git status
git pull --ff-only origin main
git commit --allow-empty -m "Trigger Issue 02 scaffold build"
git push origin main
```

Then monitor the workflow in GitHub:

```text
https://github.com/brandonjspencer/everpure-research-newsletter/actions
```

This is preferable to requiring `gh` when the user’s machine does not already have GitHub CLI installed.

### Local generated-file caution

The user’s local repo may show generated or untracked files after builds, including:
- modified `publish/data/deck_content.json`
- modified `publish/data/refresh_manifest.json`
- modified `publish/data/weeks.json`
- untracked `publish/api/`
- untracked `publish/newsletter/`
- untracked alias files under `publish/data/`
- `.DS_Store`
- accidental files named like `eval "$(ssh-agent -s)"`

Do **not** commit these during renderer/content patches unless the task explicitly requires committing generated artifacts. For stage-2 renderer patches, stage only:

```bash
git add netlify/render_stage2_default_current.js
```

### Google auth failure and fix

The first May refresh failed in GitHub Actions during deck fetching:

```text
requests.exceptions.HTTPError: 400 Client Error: Bad Request for url: https://oauth2.googleapis.com/token
```

The failure happened inside:

```text
everpure_google_fetch.py
resolve_access_token()
issue_refresh_token_access_token()
```

The issue was the Google OAuth refresh-token exchange. The fix was to update the GitHub Actions secret:

```text
GOOGLE_REFRESH_TOKEN
```

The expected GitHub Actions secrets remain:
- `SOURCE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

The expected GitHub Actions variable remains:
- `GOOGLE_FETCH_LIMIT`

If this happens again:
1. Go to GitHub repo settings → Secrets and variables → Actions.
2. Update `GOOGLE_REFRESH_TOKEN`.
3. Do not paste secrets into chat.
4. Re-run the failed workflow.

If a new token is needed, use Google OAuth 2.0 Playground with the same Google Cloud OAuth client credentials and these scopes:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/presentations.readonly
```

Important: if the Google OAuth app is in Testing mode, refresh tokens may expire. If token expiration recurs, check Google Cloud OAuth publishing status and token policy.

### Stage-2 renderer lesson: preserve design, do not disable the renderer

During Issue 02, we temporarily disabled the stage-2 default renderer to stop stale Issue 01 content from overwriting the new build. That proved the renderer was also responsible for the custom on-brand visual design.

**Important rule:** do not disable `netlify/render_stage2_default_current.js` as a long-term fix. Doing so restores a generic/plain newsletter output and loses the designed Research Roundup presentation.

The correct fix is to keep the renderer enabled but make it data-aware and editorially safer.

### Stage-2 renderer issue found and fixed

The prior `netlify/render_stage2_default_current.js` contained hardcoded Issue 01 / April copy, including:
- `Issue 01`
- `Platform redesign baselines`
- `Knowledge portal naming & structure`
- `Evergreen rebrand direction`

That caused the May build to ingest fresh data but then overwrite the current default newsletter with stale April content.

The renderer was patched to preserve the custom design while reading current issue data from generated artifacts, especially:
- `publish/newsletter/default.json`
- current evidence packs when available

The renderer should now behave as a designed presentation layer over the current deterministic build rather than as a hardcoded April issue.

### Patch workflow for future chats

When ChatGPT supplies a patch ZIP, the safest application pattern is:

```bash
cd ~/everpure-research-newsletter

PATCH_DIR=/tmp/<patch-name>
rm -rf "$PATCH_DIR"
mkdir -p "$PATCH_DIR"

PATCH_ZIP=$(ls -t ~/Downloads/<patch-name>*.zip 2>/dev/null | head -n 1)

if [ -z "$PATCH_ZIP" ]; then
  echo "Patch ZIP not found in Downloads. Download the patch ZIP again, then rerun this block."
  exit 1
fi

unzip -o "$PATCH_ZIP" -d "$PATCH_DIR"

# Depending on the patch contents, either:
git apply "$PATCH_DIR/<patch-file>.patch"
# or:
python3 "$PATCH_DIR/<patch-folder>/<apply-script>.py"

node --check netlify/render_stage2_default_current.js
git --no-pager diff -- netlify/render_stage2_default_current.js

git add netlify/render_stage2_default_current.js
git commit -m "<commit message>"
git push origin main
```

Use `node --check` before committing any JavaScript renderer change.

### Confidence rubric established for Research Roundup

Confidence tags are **editorial / evidence-readiness labels**, not statistical confidence.

Use this rubric going forward:

#### High confidence = ready to decide
Use only when:
- multiple users or sessions point to the same conclusion
- the finding is backed by a source deck or clear study evidence
- the evidence shows behavior, comprehension, preference, trust, or friction rather than only stakeholder reaction
- the recommendation is specific enough to ship, iterate, or stop
- there are no major unresolved contradictions

#### Medium confidence = ready to run a decisive next round
Use when:
- the topic appears across multiple weeks, decks, or variants
- the team has narrowed the decision space
- there is enough evidence to define the next action or comparison round
- there is not enough evidence to declare a final winner or ship-ready direction

#### Low confidence = real signal, but still needs proof
Use when:
- the topic appears in the research corpus mostly as a label, workstream, or single-week signal
- the current output does not yet show what users understood, preferred, missed, trusted, or struggled with
- the right next step is clarification or better evidence, not a strong recommendation

Short form:
- **High confidence:** ready to decide
- **Medium confidence:** ready to run a decisive next round
- **Low confidence:** real signal, but still needs proof

### Confidence tag presentation rule

Confidence tags should not include a decorative dot/bullet before the label. Use the label text only:
- `High confidence`
- `Medium confidence`
- `Low confidence`

### Public-facing editorial boundary

A major Issue 02 lesson: internal build and evidence-pipeline troubleshooting must not appear as public Research Roundup content.

Public newsletter content should be about:
- what studies showed
- what users understood, missed, preferred, trusted, or struggled with
- which alternatives are ready for a decision round
- which research questions remain unresolved
- what the product/content/design teams should do next

Public newsletter content should **not** discuss:
- the newsletter itself
- “Issue 02 should...” as a recommendation to the reader
- stage-2 generation
- deck-content artifacts
- evidence substrate / evidence extraction as a public finding
- build freshness as a finding
- freezing or emailing the issue
- internal publishing readiness
- internal pipeline failures as unresolved user-facing questions

If deck content extraction is empty or concept evidence is weak, treat that as an internal production note, not a public newsletter finding.

### Research Findings editorial gate

A Research Finding must be a study-backed user or customer insight, not a process summary.

Do not promote label-only items into Research Findings.

Avoid findings such as:
- “The cycle is showing decision pressure”
- “Issue 02 should focus on decision readiness”
- “The build is fresh, but deck content is empty”
- “Deck Evidence Extraction”

Prefer findings framed as:
- “Events research is narrowing around which page structure best supports progression into event content.”
- “Homepage AI messaging still needs to prove whether it clarifies the offer or adds abstraction.”
- “Pathfinder CTA labels need to reduce commitment friction by setting clearer expectations.”

The finding should answer:
1. What was studied?
2. What did people understand, miss, prefer, trust, or struggle with?
3. What should the team do next?

### Comparison-test rules

Meaningful Comparisons should define:
- what alternatives were compared
- what the comparison is really deciding
- the winning criteria
- the next decision step

Comparison sections should not reopen broad exploration if the evidence has already narrowed the field.

### Unresolved-item rules

“What Is Still Unresolved” should contain only public-facing decision blockers.

Each unresolved item should answer:
- what decision cannot be made yet
- why that decision matters
- what evidence would unblock it

Do not include internal items like `Deck Evidence Extraction` in the public unresolved section.

If an item title is unclear, relabel it with enough reader context. For example:
- avoid: `This Book Filter`
- prefer: `Reader Filter: “This Book”`

### Recommended Actions rules

Recommended Actions should not be a single generic item when the issue has multiple findings, comparisons, or unresolved questions.

Rules established during Issue 02:
- generate actions from every Research Finding, Meaningful Comparison, and Unresolved item when possible
- each action should include a visible concept/context label so the reader knows which tested concept it relates to
- remove secondary scope lines like `3 weekly updates (2026-04-09, 2026-04-16, 2026-04-23)` from the action card UI
- reduce the size of the concept tag in the action list so it is useful but not visually dominant
- do not include actions about testing or validating the Research Roundup/newsletter itself
- do not include internal publishing, archive, deck-extraction, or build-pipeline actions in the public Recommended Actions list

Recommended action examples should look concept-specific:
- **Events Page:** Run one final decision round with success criteria tied to first-glance comprehension and progression into event content.
- **Homepage AI Messaging:** Define whether the next test is proving comprehension, credibility, or differentiation before adding more AI language.
- **Pathfinder CTA Labels:** Test labels against expectation-setting and commitment friction rather than preference alone.

### Layout rules established during Issue 02

The custom presentation should remain intact, with these refinements:
- the fourth hero stat should show the **Recommended Actions count**, not a generic `30 Day Report` metric
- when there is more than one unresolved item, use a **2-up grid** on desktop; if the count is odd, the final item spans the full row
- mobile can remain single-column
- recommended-action context tags should be smaller than the main action copy
- confidence tags should not include a leading bullet/dot

### Candidate Issue 02 research tracks observed in the May build

The May refresh surfaced or carried forward these research tracks as likely Issue 02 content candidates:
- Events Page / Events Page Baseline
- Homepage AI Messaging
- Pathfinder CTA Labels
- Webinar Registration Page
- Reader Filter: “This Book”
- Virtualization Campaign

These should be reviewed against evidence quality before being promoted into findings. Some may belong in Meaningful Comparisons or What Is Still Unresolved rather than Research Findings.

### Current evidence-quality caveat

During the Issue 02 refinement, the published/latest data showed enough record and deck discovery to build a current issue, but deck-content extraction and concept-specific evidence still needed scrutiny.

Important distinction:
- It is acceptable to use this caveat internally when deciding whether findings are strong enough.
- It should not appear as public-facing Research Roundup copy.

If deck content is empty or concept evidence is weak, the public issue should become more conservative: fewer high-confidence findings, more comparison/unresolved framing, and more concept-specific recommended actions.

### Issue 02 email status

Superseded by the v7 email addendum above.

The May/Issue 02 email has been built as a separate HTML artifact and refined based on recipient feedback. It should use the approved frozen archive URL:

```text
https://brandonjspencer.github.io/everpure-research-newsletter/issues/2026-05/default.html
```

Do not point a distribution email to mutable `/newsletter/default.html`.

## What this project is

This project is building an automated research newsletter workflow from the **Everpure UX research Notion page** and its linked **Google Slides findings decks**.

The goal is to:
- reduce manual exports and uploads
- ingest the latest weekly research updates automatically
- normalize the data into a machine-readable format
- generate newsletter-ready summaries and drafts from the live research corpus
- support both a strategic leadership brief and a marketing-oriented research activity log
- preserve a trustworthy deterministic source of truth while layering stronger synthesis and behavioral interpretation on top

## Current live system

### Primary repository
- **GitHub repo:** `https://github.com/brandonjspencer/everpure-research-newsletter`

### Current live hosting
- **GitHub Pages live site:** `https://brandonjspencer.github.io/everpure-research-newsletter/`
- GitHub Pages is the active live review surface.

### Secondary hosting path
- **Netlify site:** `https://chipper-biscochitos-923402.netlify.app/`
- **Netlify status:** currently paused due to team credit limits
- Netlify support is intentionally preserved in the repo for future use when credits are restored.

### Upstream sources
- **Primary upstream source:** public Everpure Notion page
- **Secondary upstream source:** linked Google Slides findings decks

## Current operating mode

The project is set up for **dual deploy support**:

1. **GitHub Pages** is the active free iteration path.
2. **Netlify** remains configured in the repo and can be resumed later.

Future chats should assume:
- GitHub Pages is the most reliable live review surface while Netlify is paused
- Netlify-specific files should remain in the repo
- the project should continue to support both targets rather than choosing only one

## Synthesis workflow

This project uses a **two-stage workflow** conceptually.

### Stage 1 — deterministic build layer
The repo build remains the source-of-truth layer. It should:
1. fetch the live Notion page
2. parse weekly records into normalized JSON
3. discover and dedupe Google Slides deck IDs
4. fetch deck artifacts with refresh-token-based Google auth
5. ingest deck PDFs into normalized deck-content outputs
6. build evidence-oriented intermediate artifacts
7. generate static artifacts for GitHub Pages while preserving Netlify compatibility

This stage should remain deterministic, auditable, and evidence-led.

### Stage 2 — ChatGPT / LLM synthesis layer
ChatGPT is treated as the **stage-2 synthesis pass**.

That means:
- ChatGPT reviews the built source datasets and current newsletter outputs
- ChatGPT acts like a senior UX research / behavioral synthesis lead
- ChatGPT produces refined newsletter language, structure, prioritization, presentation, and recommendation logic
- ChatGPT may hand back either:
  - a patch package for the repo, or
  - revised content / JSON / Markdown / HTML recommendations to be incorporated into the next build

### Important limitation
This stage-2 synthesis is **not autonomous inside GitHub Actions or Netlify**.
It is a **manual review-and-refinement step performed in chat** after the deterministic build is live.

### Current safer stage-2 pattern
The current safer pattern is:
- avoid broad rewrites of `netlify/functions/api.js`
- avoid piling fragile post-generation cleanup scripts onto the same output
- prefer a **content-first stage-2 writer** for the default monthly brief
- prefer similarly scoped stage-2 writers for alternate variants like the marketing activity log
- keep presentation changes localized to the relevant stage-2 writer rather than shared pipeline files whenever possible

A dedicated stage-2 writer is now being used for the default brief, and a separate stage-2 writer is being used for the marketing activity-log variant. As of the Issue 02 refresh, the default stage-2 writer should be treated as a designed presentation layer that must read current generated data rather than hardcoded issue copy.

### Practical loop for future chats
The normal loop should be:
1. user says the build is live
2. ChatGPT reviews the live built outputs
3. ChatGPT synthesizes the next pass
4. ChatGPT provides patches or revised outputs
5. user applies and deploys the next build

## What is already working

The current system already supports the following:

1. **Live Notion ingestion**
   - The build fetches the public Notion page during build/deploy.
   - The page is rendered through a browser-based path rather than a simple static HTTP fetch.
   - This is important because the Notion page is not reliably parseable through a plain fetch alone.

2. **Normalized parsing**
   - Weekly entries are extracted into normalized records.
   - Records include fields like:
     - `record_id`
     - `week_date`
     - `section_family`
     - `deck.url`
     - `deck.file_id`
     - `images`
     - `content_groups`
     - `linked_files`
     - `linked_pages`
     - `toggles`

3. **Deck discovery and deduping**
   - Google Slides links are extracted from weekly entries.
   - Decks are normalized into canonical Google file IDs.
   - Multiple weekly records can point to the same deck.

4. **Google-authenticated deck fetch**
   - The system uses a **refresh-token-based Google auth flow**, not a short-lived access token.
   - Deck PDFs and related artifacts can be pulled during build.

5. **Deck content ingestion**
   - Exported PDFs are ingested into normalized deck-content outputs.
   - Deck content is available to strengthen the newsletter synthesis layer.

6. **Newsletter synthesis outputs already exist**
   - A default monthly newsletter is generated from the live corpus.
   - A second marketing-oriented 30-day activity-log variant also exists.

7. **Static artifact publishing**
   - The build publishes static newsletter/data artifacts for GitHub Pages.
   - This reduces dependence on runtime serverless routes for the main review path.

8. **Dual deploy compatibility**
   - The repo supports GitHub Pages now.
   - Netlify configuration is still preserved.

9. **Evidence-oriented intermediate outputs are live**
   - Evidence packs are published.
   - Concept-specific evidence for the default 30-day window is published.

10. **The default newsletter now has a custom on-brand HTML presentation**
   - The default brief is no longer using only a generic static render.
   - It is now presented through a content-first stage-2 writer with an on-brand layout inspired by a Figma Make design.

11. **The first archive freeze has been completed**
   - The first monthly issue freeze is for `2026-04`.
   - The issue archive and history structure is now part of the project’s operating model.

12. **A working HTML email now exists for the approved issue**
   - The current approved email points to the archived April 2026 issue, not the rolling default page.
   - The email has already been tested through Gmail / Apps Script.
   - A mobile edge-to-edge version exists for better phone rendering.

## Default output settings

These are the default editorial assumptions for the project.

### Default monthly issue
- **window:** `30d`
- **audience:** `exec`
- **tone:** `strategic`
- **public-facing title:** `Research Roundup`

### Secondary preset
- **preset:** `marketing_activity_30d`
- Purpose: show research cadence, testing volume, and ongoing activity for marketing stakeholders

Future chats should assume the default newsletter means:
- 30-day window
- executive audience
- strategic tone
- public-facing label **Research Roundup** rather than **Leadership Brief**

unless the user explicitly asks for a different combination.

## Current editorial direction

The project has moved beyond generic synthesis.

The target is:
- less theme-only or implication-heavy writing
- more **plain-English findings**
- more **evidence snapshots**
- more **what we should do next**
- clearer distinction between:
  - what is known
  - what is directional only
  - what is still in motion
  - what is strong enough to ship versus what should iterate

### Default monthly brief should optimize for:
- meaningful insights
- decision confidence
- evidence-backed summaries
- what to do next for each called-out concept

### Marketing activity-log variant should optimize for:
- cadence
- throughput
- number of studies touched
- visible testing volume
- momentum of research operations

## Current default newsletter presentation

The default monthly brief now uses a custom on-brand stage-2 HTML presentation.

### Current design characteristics
- presentation is inspired by a **Figma Make** on-brand newsletter design provided by the user
- primary display font is **Familjen Grotesk**
- section presentation uses strong editorial formatting rather than plain article styling
- the **Research Findings** section uses a large vertical editorial layout with:
  - numbered entries
  - a confidence badge
  - large headline/body treatment
  - lower split columns labeled **Evidence** and **Direction**
- **Meaningful Comparisons** now uses a similar editorial layout to **Research Findings**, but remains in a dark-theme presentation
- the default brief uses reader-facing wording in evidence copy rather than internal concept-number phrasing
- the public title is now **Research Roundup**
- subtle **Source deck** links can appear inline within the opening summary copy of finding/comparison modules rather than in a separate floating label row

### Current default section naming
The section titles now align more closely to the on-brand design:
- **Research Findings**
- **Meaningful Comparisons**
- **What Is Still Unresolved**
- **Recommended Actions**

### Evidence wording note
The public-facing default brief should avoid internal references like “Concept 176.”
Preferred phrasing is:
- “Findings suggest…”
- “Evidence suggests…”

### Presentation safety rule
Future chats should treat the current default HTML presentation as a **presentation layer owned by `netlify/render_stage2_default_current.js`**.
Avoid moving this styling back into generic render paths unless explicitly intended. Do not disable this renderer to fix stale content; patch it so the design remains intact while the copy and counts come from current generated issue data.

## Current marketing activity-log state

The marketing activity-log variant now has its own content-first stage-2 writer.

### What is working
- it renders as a proper HTML artifact rather than broken markdown-in-HTML output
- it has consistent `marketing / detailed` metadata
- it is directionally right for a marketing audience:
  - snapshot
  - weekly activity log
  - active workstreams
  - repeated research threads
  - comparison work in flight
  - how to use this log

### What still needs refinement
The marketing log is still under active semantic refinement:
- grouping and de-duplication may still be imperfect
- repeated-thread logic can still feel too noisy
- comparison tracks may still need better clustering
- some workstream grouping may still need stronger parent-child rollup behavior

Future chats should treat the marketing activity log as **functional but still actively being polished**.

## Current live output locations

### GitHub Pages homepage
- `/`

### Static newsletter outputs
- `/newsletter/default.html`
- `/newsletter/default.md`
- `/newsletter/default.json`
- `/newsletter/marketing-activity-30d.html`
- `/newsletter/marketing-activity-30d.md`
- `/newsletter/marketing-activity-30d.json`

### Static API mirrors
- `/api/status.json`
- `/api/newsletter-default.json`
- `/api/newsletter-default.md`
- `/api/newsletter-marketing-activity-30d.json`
- `/api/newsletter-marketing-activity-30d.md`
- `/api/index.html`

### Static discovery and freshness files
- `/status.json`
- `/newsletter/index.html`
- `/api/index.html`

### Static data outputs
- `/data/weeks.json`
- `/data/summary.json`
- `/data/deck_content.json`
- `/data/deck-content.json`
- `/data/deck_details.json`
- `/data/deck_summary.json`
- `/data/deck_week_map.json`
- `/data/refresh_manifest.json`
- `/data/evidence_packs.json`
- `/data/evidence-packs.json`
- `/data/evidence_packs_default_30d.json`
- `/data/evidence-packs-default-30d.json`
- `/data/concept_evidence_default_30d.json`
- `/data/concept-evidence-default-30d.json`
- `/data/issues.json`

### Issue archive outputs
- `/issues/index.html`
- `/issues/YYYY-MM/default.html`
- `/issues/YYYY-MM/default.md`
- `/issues/YYYY-MM/default.json`
- `/issues/YYYY-MM/marketing-activity-30d.html`
- `/issues/YYYY-MM/marketing-activity-30d.md`
- `/issues/YYYY-MM/marketing-activity-30d.json`
- `/issues/YYYY-MM/issue_manifest.json`

### Current first frozen issue
- `/issues/2026-04/default.html`
- `/issues/2026-04/default.md`
- `/issues/2026-04/default.json`
- `/issues/2026-04/marketing-activity-30d.html`
- `/issues/2026-04/marketing-activity-30d.md`
- `/issues/2026-04/marketing-activity-30d.json`
- `/issues/2026-04/issue_manifest.json`

### Netlify API routes (when Netlify is active)
#### Status and freshness
- `/api/status`
- `/api/health`

#### Source data
- `/api/weeks`
- `/api/summary`
- `/api/decks`
- `/api/deck-summary`
- `/api/deck-details`
- `/api/deck-content`

#### Newsletter synthesis
- `/api/newsletter`
- `/api/newsletter.md`
- `/api/newsletter-default`
- `/api/newsletter-default.md`
- `/api/newsletter-marketing-activity-30d`
- `/api/newsletter-marketing-activity-30d.md`

**Important:** Netlify endpoint checks should include a unique `ts` query parameter during verification.

## Homepage discovery

The GitHub Pages homepage now functions as a fuller artifact directory.

It exposes direct links to:
- newsletter outputs
- static API mirrors
- key data artifacts
- evidence packs
- concept evidence
- issue archive discovery artifacts (`/issues/index.html`, `/data/issues.json`)

Future chats should use the homepage first when locating the current build outputs.

## Issue preservation and archive plan

This is the agreed long-term preservation model for the newsletter.

### 1. Keep a `latest` layer
The current working issue remains in the existing locations:
- `/newsletter/default.*`
- `/newsletter/marketing-activity-30d.*`
- `/data/...`

This is the review surface for the current cycle.

### 2. Add immutable monthly issue archives
Once a monthly issue is approved, it should be frozen into a dated folder and never overwritten.

Recommended structure:
- `/issues/YYYY-MM/default.html`
- `/issues/YYYY-MM/default.md`
- `/issues/YYYY-MM/default.json`
- `/issues/YYYY-MM/marketing-activity-30d.html`
- `/issues/YYYY-MM/marketing-activity-30d.md`
- `/issues/YYYY-MM/marketing-activity-30d.json`
- `/issues/YYYY-MM/issue_manifest.json`

### 3. Preserve cumulative evidence history
The project should also retain evidence artifacts over time so the corpus can be used for trend and pattern analysis.

Recommended structure:
- `/history/weeks/YYYY-MM.jsonl`
- `/history/evidence_packs/YYYY-MM.json`
- `/history/concept_evidence/YYYY-MM.json`
- `/history/deck_content/YYYY-MM.json`

Or equivalent append-only history files keyed by:
- `issue_month`
- `generated_at`
- `record_id`
- `week_date`
- `deck_id`
- `concept_key`
- `git_sha`

### 4. Separate working builds from published issues
Not every deploy should become an archived issue.

The intended model is:
- current builds continue to refresh the `latest` layer
- ChatGPT and the user iterate on the current issue until it is approved
- only the approved monthly issue is frozen into `/issues/YYYY-MM/...`

### 5. Add issue discovery artifacts
Recommended additions:
- `/issues/index.html`
- `/data/issues.json`

These should list archived issues with:
- issue month
- generated date
- audience
- tone
- links to HTML / MD / JSON
- manifest path

### 6. Current state of the archive model
- the archive publishing layer now exists
- the first issue freeze for `2026-04` has been completed
- future chats should treat archive freezing as part of the monthly publishing process, not an optional extra

### 7. Future history rollups
Longer-term rollups may include:
- `/data/history/research_volume_by_month.json`
- `/data/history/concepts_by_month.json`
- `/data/history/workstreams_by_month.json`
- `/data/history/deck_coverage_by_month.json`

These can be derived from the archived evidence rather than maintained manually.

## Email workflow

The project now also has a parallel **email-delivery workflow** for sharing each approved issue.

### Current email approach
- the email is a separate HTML artifact based on a provided on-brand email template
- the current email is derived from the approved default issue’s content and section framing
- the email title is **Research Roundup**, matching the current default newsletter naming
- the CTA links in the email should point to the **frozen archived issue** for that month, not the mutable `/newsletter/default.html` page

### Current email characteristics
- on-brand HTML email layout
- Familjen Grotesk styling where supported
- hero, issue stats, “In this issue,” executive summary, CTA, and footer
- copy aligned to the current default issue rather than hand-written from scratch
- mobile padding refinements have been applied for better phone rendering
- a mobile edge-to-edge variant has been used to remove the dark outer frame on phone screens

### Current test-send workflow
For testing, the email is currently sent through **Google Apps Script / Gmail** rather than through the site build itself.

The practical flow is:
1. export or save the HTML email file
2. upload it to Google Drive if needed
3. use Google Apps Script with `MailApp.sendEmail({ htmlBody: ... })`
4. send to a test inbox
5. review on desktop and phone

### Current recipient workflow
Apps Script can now support:
- a direct BCC list in the script, or
- a spreadsheet-driven recipient list

Recommended spreadsheet tab:
- `Recipients`

Recommended columns:
- `email`
- `active`

The current preferred send pattern is:
- sender/tester email in `to`
- recipients in `bcc`

### Email workflow safety note
Future chats should treat the email as a **separate presentation/delivery artifact** from the website newsletter.
Do not assume the web HTML and email HTML can share the same rendering system directly.

### Recommended future email direction
- continue using the approved default issue as the source for email content
- keep email-specific layout changes isolated to the email HTML
- preserve a mobile-optimized version of the email for testing and sending
- continue pointing email CTA links to the archived approved issue
- eventually consider archiving approved email HTML alongside the monthly issue archive

## Expected environment variables / secrets

### Shared build configuration
- `SOURCE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_FETCH_LIMIT`

### Netlify
These are stored as **Netlify environment variables**.

### GitHub Pages / GitHub Actions
These are stored as **GitHub repository secrets and variables**:
- **Secrets:**
  - `SOURCE_URL`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REFRESH_TOKEN`
- **Variable:**
  - `GOOGLE_FETCH_LIMIT`

## Current architecture

The current data flow is:

1. Build starts
2. Live Notion page is fetched and rendered
3. Parser converts page structure into normalized weekly JSON
4. Deck links are extracted and deduped
5. Google deck fetch retrieves deck artifacts using refresh-token auth
6. Deck PDFs are ingested into normalized deck-content outputs
7. Evidence packs are built
8. Evidence signals are cleaned / filtered
9. Concept-specific default-30d evidence is built
10. Static newsletter/data artifacts are generated
11. A stage-2 default-brief writer may overwrite only the default brief outputs for the current cycle
12. A stage-2 marketing writer may overwrite only the marketing-activity outputs for the current cycle
13. Archive publishing artifacts are generated (`/issues/index.html`, `/data/issues.json`)
14. Filename aliases are fixed for GitHub Pages compatibility
15. Outputs are published to GitHub Pages and, when active, can also be served through Netlify
16. ChatGPT reviews the built outputs and acts as the stage-2 synthesis / refinement pass for the next build cycle
17. Approved monthly issues can be frozen into `/issues/YYYY-MM/...` and evidence history copied into `/history/...`
18. Approved issue content can also be adapted into a standalone HTML email workflow
19. Approved distribution email should point to the frozen issue archive rather than the mutable latest page

## Intermediate evidence artifacts

These are no longer hypothetical. They now exist in the published output.

### Evidence packs
- `/data/evidence_packs.json`
- `/data/evidence-packs.json`
- `/data/evidence_packs_default_30d.json`
- `/data/evidence-packs-default-30d.json`

Purpose:
- give the stage-2 LLM pass a cleaner, more structured evidence substrate than raw `weeks.json`
- separate extraction from synthesis more cleanly
- improve traceability and make newsletter passes more evidence-led

### Concept-specific evidence
- `/data/concept_evidence_default_30d.json`
- `/data/concept-evidence-default-30d.json`

Purpose:
- scope evidence more tightly to specific concepts in the current 30-day default brief
- reduce proof-point leakage across unrelated concepts
- support more defensible `what we found` and `what we should do next` sections

## Normalized data model

Each weekly record generally includes:
- `record_id`
- `source_page_title`
- `source_type`
- `week_date`
- `section_family`
- `week_label_raw`
- `deck`
- `images`
- `content_groups`
- `linked_pages`
- `linked_files`
- `toggles`

Common `content_groups` buckets include:
- `findings`
- `testing_concepts`
- `in_process`
- `initiatives_on_deck`
- `weekly_progress`
- `needs`
- `next_steps`
- `other`

## GitHub deployment notes

### GitHub Pages source
- Pages is configured to deploy from **GitHub Actions**.
- The workflow file is:
  - `.github/workflows/deploy-pages.yml`

### Important GitHub Pages path behavior
This is critical:
- The site is a **project site**, not a root domain site.
- It lives under:
  - `https://brandonjspencer.github.io/everpure-research-newsletter/`
- Static links must therefore work under the repo base path.
- Relative links are safer than root-relative links.

If a link accidentally starts with `/newsletter/...`, it may resolve incorrectly to the domain root and produce a GitHub Pages 404.

### Filename alias note
Some published static files may exist in both underscore and hyphenated forms for compatibility.
Examples include:
- `deck_content.json`
- `deck-content.json`
- `evidence_packs.json`
- `evidence-packs.json`
- `concept_evidence_default_30d.json`
- `concept-evidence-default-30d.json`

Future chats should preserve those aliases where needed rather than accidentally breaking static links.

### Git push auth
- SSH is the preferred GitHub push method for this repo.
- This was adopted because PAT-based pushes were blocked when updating `.github/workflows/*` without the necessary `workflow` scope.
- Future chats should assume SSH-based Git pushes are already configured.

## Netlify preservation notes

The repo is intentionally still Netlify-compatible.

### Important files that should remain in the repo
- `netlify.toml`
- `netlify/build.sh`
- `netlify/functions/...`
- `netlify/generate_static_newsletters.js`
- `netlify/fix_static_aliases.js`

### Why preserve Netlify support
- Netlify may be restored later when credits are available again.
- The user wants the ability to resume Netlify deployment without rebuilding that path from scratch.
- Future work should preserve compatibility with both hosting paths unless the user explicitly says otherwise.

## Known quirks and constraints

### Public Notion is not a stable simple-fetch source
The Notion page is human-readable, but it is not reliable enough through a basic HTTP fetch. This is why the build uses a browser-rendered path.

### Netlify may be unavailable even when the repo is healthy
If Netlify credits are exhausted, the site can be fully paused and unavailable to visitors.

### GitHub Pages is static-first
GitHub Pages is the dependable free hosting path, but it does not replace runtime serverless behavior in the same way Netlify functions did. The static artifacts are especially important.

### Deck coverage depends on `GOOGLE_FETCH_LIMIT`
If the fetch limit is below the total number of discovered decks, the deck-content corpus will be incomplete.

### Not every week has a linked deck
Some weekly entries are text-only or rely on external links instead of a Google Slides findings deck.

### Newsletter quality is still constrained by the deterministic substrate
Even though ChatGPT acts as a stage-2 synthesis pass, weak or generic deterministic evidence extraction will still limit how specific the final issue can be. The Issue 02 refresh confirmed that if deck-content or concept evidence is thin, public copy should become more conservative rather than inventing high-confidence findings. Internal evidence-quality problems should not be surfaced as public Research Roundup findings.

### Avoid broad API rewrites
A prior attempt to add strict proof-point filtering by broadly overwriting `netlify/functions/api.js` broke the build because helper functions were referenced but not defined. Future chats should prefer smaller, safer, incremental changes.

### Avoid repeated HTML cleanup chains
Multiple post-generation cleanup patches can make outputs worse rather than better. Future chats should prefer:
- improving the deterministic evidence substrate, or
- writing cleaner content-first stage-2 briefs directly, or
- making focused, reversible patches to `netlify/render_stage2_default_current.js` that preserve the designed shell while improving current-cycle content,
rather than layering many fragile cleanup passes on generic outputs.

### Current stage-2 writers are build-cycle specific
The current content-first stage-2 writers are intended for the **current build cycle**, not as permanent general solutions. Future chats should review the live evidence and live page outputs again before assuming the same copy or grouping should persist into the next build. The Issue 02 refresh showed that hardcoded issue copy can become stale while the source build is fresh, so renderer content must be data-aware or deliberately patched for the current cycle.

### Email rendering is its own medium
The email version should not be treated as a direct drop-in copy of the web newsletter render. Future chats should preserve email-specific layout and mobile adjustments separately.

### Email links should point to archived issues
For approved sends, the email CTA should link to the frozen `/issues/YYYY-MM/default.html` artifact rather than the mutable latest default newsletter.

## Current editorial priorities

The main editorial goals now are:
1. ensure the default monthly newsletter surfaces **meaningful, research-backed insights** rather than generic summary language
2. clearly distinguish between:
   - validated findings
   - directional signals
   - active workstreams
   - ship-ready confidence
3. make sure comparison tests and high-confidence findings are surfaced in a way that helps decide whether work should ship, iterate, or hold
4. replace vague “leadership implication” language with **what we should do next** for each called-out concept
5. include concrete evidence, key numbers, or evidence snapshots wherever possible so the claims feel validated
6. keep improving the marketing activity-log variant so it better shows cadence, volume, and operating rhythm without repetition
7. keep the homepage useful as a discovery directory for all current outputs
8. preserve the new on-brand presentation quality for the default brief
9. implement and maintain the archive/freeze model so monthly issues and evidence are preserved over time
10. maintain a reliable email version of each approved issue
11. maintain a dependable recipient workflow for test sends and distribution

## What future chats should help with

The most useful future work includes:
1. improving the default newsletter so it is less generic and more insight-dense
2. refining the marketing activity-log output so it better showcases weekly/30-day cadence and volume with less repetition
3. increasing deck-backed insight quality in the generated newsletter
4. strengthening source traceability by week date and deck ID
5. improving the static UI and navigation on GitHub Pages
6. preserving dual-deploy support across GitHub Pages and Netlify
7. improving concept-scoped evidence matching
8. continuing to refine the custom HTML presentation layer for the default brief
9. maintaining the issue archive and evidence-history plan
10. maintaining a reusable but email-safe version of the approved issue for distribution
11. maintaining the Apps Script / spreadsheet recipient workflow
12. deciding whether the stage-2 writers should remain content-first per cycle or evolve into more reusable patterns

## Recommended assumptions for a new chat

A new chat should assume:
- GitHub Pages is the current live source of truth while Netlify is paused
- Netlify support still exists in the repo and should be preserved
- the system is already live and deployed
- the project is past the prototype stage and is now in refinement / editorialization
- the default issue means `30d + exec + strategic`
- the public-facing default issue title is **Research Roundup**
- the marketing activity log exists as a second preset
- evidence packs and concept evidence are live in the published output
- ChatGPT is acting as a manual stage-2 synthesis pass on top of the deterministic build
- the safest editorial path is content-first stage-2 writing, not brittle cleanup chains
- the current default brief has a custom on-brand presentation and should be treated as a designed surface, not just a text dump
- approved monthly issues should be frozen into dated archive folders rather than overwritten forever
- approved issues may also have a separate email artifact for distribution
- distribution email should point to the archived issue rather than the mutable latest page
- the Research Roundup Quality Control Agent and Minimum Agent Suite are now part of the normal review workflow
- the active project sources should stay lean: handoff, QC agent, combined minimum agent suite, and email template when email work is in scope
- because the ChatGPT GitHub app is blocked by admin policy, use public GitHub/GitHub Pages plus the AI context export ZIP for repo visibility
- future code changes should generally be delivered as patch bundles that the user applies locally
- the next work is likely around sending/archiving Issue 02, maintaining the email workflow, applying the same reader-value rubric to future issues, preserving issues over time, improving deck/content evidence extraction, and maintaining the AI context export workflow rather than rebuilding ingestion from scratch

## Suggested starter prompt for a future chat

Use the Everpure Research Newsletter Builder project context. Start with the GitHub Pages site at `https://brandonjspencer.github.io/everpure-research-newsletter/`, review the default monthly issue and marketing activity-log issue with cache-busting URLs, inspect the evidence-pack and concept-evidence outputs, and preserve compatibility with Netlify in the repo. Assume the default newsletter should prioritize meaningful insights, decision confidence, clear evidence, and operational next actions. Treat the live build outputs as the source of truth and ChatGPT as the manual stage-2 synthesis pass. Use the Minimum Agent Suite sequence for major issue work: Evidence Integrity, Research Synthesis, Reader Value, Section Role & Redundancy, then Email Adaptation. Use the Research Roundup Quality Control Agent before approval/freeze/send. Respect the current on-brand HTML presentation of the default brief and preserve it unless the user explicitly asks to redesign it further. Because the ChatGPT GitHub app is blocked, ask for an AI context export ZIP when source-level patching is needed, then return patch bundles for the user to apply locally. Keep the agreed issue archive / history plan and the separate email workflow in mind when proposing new build steps.

## Security note

This document should not contain active secrets. Credentials should remain only in GitHub repository secrets, Netlify environment variables, or other secure user-controlled systems.
