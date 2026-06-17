# Everpure Research Newsletter Builder — Claude Code Handoff

**Prepared for:** Claude Code / repo-level continuation  
**Project:** Everpure Research Roundup / Research Newsletter Builder  
**Current date:** 2026-06-16  
**Primary objective:** Preserve enough project context, operating rules, quality gates, and current source references so Claude Code can safely continue development, issue refreshes, archive freezes, and email artifact updates without re-learning the workflow from scratch.

---

## 1. What this builder does

The Everpure Research Newsletter Builder turns a 30-day research cycle into a leadership-ready monthly **Research Roundup**. The system combines deterministic source ingestion and static publishing with manual editorial synthesis, review gates, archive preservation, and email distribution.

The builder currently supports these surfaces:

1. **Latest mutable issue** on GitHub Pages.
2. **Frozen monthly archives** under dated issue paths.
3. **Evidence artifacts** generated during build.
4. **Email HTML artifact** for distribution through Gmail / Apps Script.
5. **Agent/QC prompts** that protect evidence quality, synthesis quality, reader value, redundancy, and email safety.

The most important operating principle: deterministic build outputs are the evidence substrate; manual/AI-assisted synthesis must not invent certainty beyond what the evidence supports.

---

## 2. Source package contents

This handoff package includes the source artifacts that were available in the workspace at handoff time:

```text
claude_code_handoff_sources/
  EVERPURE_RESEARCH_NEWSLETTER_CLAUDE_CODE_HANDOFF.md
  SOURCE_MANIFEST.md
  sources/
    everpure_project_context_handoff_v9.md
    everpure_minimum_agent_suite_combined.md
    everpure_research_roundup_quality_control_agent.md
    research_roundup_email_template.html
```

Use the files in `sources/` as canonical local references. The most comprehensive source is `everpure_project_context_handoff_v9.md`; the agent suite and QC prompt are operational guardrails; the HTML file is the current standalone email-template reference.

**Important limitation:** this bundle contains the source/context files available in the ChatGPT workspace, not a full repository checkout. Claude Code should still work from the actual Git repository when making code changes.

---

## 3. First action for Claude Code

When Claude Code opens the real repository, start by orienting around the current state:

```bash
git status --short
git branch --show-current
find . -maxdepth 3 -type f | sort | sed 's#^./##' | head -200
```

Then inspect the likely critical areas:

```bash
find .github -maxdepth 3 -type f -print 2>/dev/null | sort
find emails issues history newsletter publish -maxdepth 3 -type f -print 2>/dev/null | sort | head -200
find . -maxdepth 4 -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.ts' -o -name '*.json' -o -name '*.html' -o -name '*.md' \) | sort | head -300
```

Before editing, identify the build system and available scripts:

```bash
ls
cat package.json 2>/dev/null || true
find . -maxdepth 3 -type f -iname '*build*' -o -iname '*deploy*' -o -iname '*freeze*'
```

Do not assume generated files should be committed. Generated `publish/` files are normally not committed unless the task explicitly calls for generated artifacts.

---

## 4. Monthly new-issue start ritual

When the user says it is time to build or update a new issue, do **not** start with editorial synthesis or code patching. First walk through Google OAuth refresh-token rotation and build verification.

Required sequence:

1. Remind the user not to paste credentials, refresh tokens, client secrets, `.env` values, or private keys into chat.
2. Have the user generate a new Google OAuth refresh token in Google OAuth 2.0 Playground using the project’s Drive/Slides read-only scopes.
3. Have the user update the GitHub Actions secret named `GOOGLE_REFRESH_TOKEN`.
4. Trigger a dry GitHub Actions build.
5. Verify cache-busted live artifacts before synthesis.
6. Only after the build is fresh, run the agent/QC sequence.

Expected GitHub Actions secrets and variables, per current handoff context:

```text
Secrets:
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
NOTION_TOKEN

Variable:
NOTION_DATABASE_ID
```

Use the browser-based no-install trigger if the user does not have GitHub CLI:

```bash
git commit --allow-empty -m "Refresh Google token and run monthly build"
git push
```

Then monitor GitHub Actions in the repo UI.

---

## 5. Live artifact verification checklist

After the dry build, inspect cache-busted GitHub Pages artifacts. Use `?cb=<timestamp>` on URLs to avoid stale cached results.

Expected important artifacts include:

```text
status.json
weeks.json
evidence_packs_default_30d.json
concept_evidence_default_30d.json
deck_content.json
newsletter/default.json
newsletter/default.html
```

The latest mutable newsletter is useful for review, but approved distribution should point to a frozen archive path under:

```text
/issues/YYYY-MM/default.html
```

Never point a distribution email CTA to the mutable latest page:

```text
/newsletter/default.html
```

---

## 6. Agent / QC sequence before freeze or email

Run the minimum agent sequence after a deterministic build is live and before freezing or emailing:

1. **Evidence Integrity Agent** — verifies freshness and evidence strength.
2. **Research Synthesis Agent** — converts evidence into reader-facing findings.
3. **Reader Value Agent** — checks whether stakeholders and leaders can understand why the issue matters.
4. **Section Role & Redundancy Agent** — ensures each section has a distinct role and avoids repeated copy.
5. **Email Adaptation Agent** — ensures the approved issue works as an email artifact.
6. **Quality Control Agent** — final gate before freeze and send.

Core reader questions the issue must answer:

1. What did we learn?
2. Why does it matter?
3. How confident are we?
4. What still needs clarity?
5. What should happen next?

Use `sources/everpure_minimum_agent_suite_combined.md` and `sources/everpure_research_roundup_quality_control_agent.md` as the operating prompts.

---

## 7. Editorial rules that must survive future edits

Keep these rules intact unless the user explicitly changes strategy:

- The public title is **Research Roundup**.
- The issue should be evidence-led and reader-facing.
- Public issue copy should not explain internal pipeline mechanics, build steps, archive mechanics, deck extraction, or publishing operations.
- Research Findings should describe what the research taught us, not the newsletter/build process.
- Confidence labels must reflect the evidence substrate.
- “High Confidence” should be reserved for findings with sufficient corroborated evidence, not merely strong stakeholder preference.
- Comparison tests should be framed as narrowed decision problems with explicit winning criteria.
- Recommended actions should be ordered by decision urgency.
- Keep issue copy useful for program participants, cross-functional stakeholders, mid-level leaders, and executives.

---

## 8. Archive freeze workflow

When the user approves an issue, freeze it into a dated archive. The freeze should preserve the approved issue content, evidence snapshot, history entry, and email artifact.

Expected archive pattern:

```text
issues/YYYY-MM/default.html
history/
emails/research_roundup_issueNN_email_monthYYYY.html
```

Expected commit pattern after a freeze:

```bash
git add issues/YYYY-MM history emails/research_roundup_issueNN_email_monthYYYY.html
git commit -m "Freeze Issue NN and add email artifact"
git push
```

After freeze, email CTAs should point to the frozen archive URL, not the mutable latest issue.

---

## 9. Email artifact rules

The email HTML is a separate artifact from the web renderer. Keep it isolated unless the user explicitly asks to merge systems.

Current email rules:

- Use the standalone email template as a starting point.
- Ensure CTA links point to the frozen archive issue.
- Include a Zscaler authentication note for internal access.
- Include the `#research-and-discovery` Slack feedback link when requested.
- Test in Gmail desktop and on a phone before send.
- Watch for small-screen horizontal scroll, especially from stat-row borders and fixed-width table behavior.
- On small breakpoints, the outer shell should have no background padding and the email should render full width.
- The email stats do not need to mirror every web-section count exactly; keep the email focused on the clearest send-ready framing.

The provided `sources/research_roundup_email_template.html` includes the latest known mobile fixes, including full-width shell behavior and zero outer-shell padding at the small breakpoint.

---

## 10. Apps Script / spreadsheet-driven sending notes

The send workflow uses Gmail and a spreadsheet-driven recipient list. The exact Apps Script source was not present in this handoff workspace, but the current process expectations are:

- The spreadsheet tab name matters; if the Apps Script says no spreadsheet/sheet was found, verify the tab name first.
- The email issue link must point to the saved frozen issue, not the default latest page.
- Do not expose or paste tokens/secrets into chat or code comments.
- Test-send before final distribution.

If Claude Code needs to patch Apps Script, request or locate the current script source in the repo or Google Apps Script project before editing.

---

## 11. GitHub / access constraints

The ChatGPT GitHub app has historically been blocked by company admin policy, so future AI work should not depend on direct connector access. Preferred workaround:

1. Use public GitHub Pages outputs and public repo files when available.
2. Use an AI context export ZIP from the local repo when source inspection is needed.
3. Avoid secrets and generated credential files in exports.
4. Make patches against the real repo only after inspecting current files.

Claude Code should be able to work directly from a local checkout, which is the preferred path for code-level continuation.

---

## 12. High-risk areas

Be careful around these areas:

- Stage-2 renderer patching: avoid reintroducing hardcoded Issue 01 copy.
- Generated artifacts: avoid committing generated `publish/` files by default.
- Confidence labels: do not inflate confidence without evidence.
- Email links: never point distribution email to mutable `/newsletter/default.html`.
- Mobile email layout: test small breakpoint for horizontal scroll.
- Auth: do not ask the user to paste secrets, tokens, `.env` files, or credentials.
- Build freshness: cache-bust live checks before interpreting content.

---

## 13. Suggested Claude Code workflow for common tasks

### Build a new issue

1. Confirm Google refresh-token rotation has been completed.
2. Run or trigger a dry GitHub Actions build.
3. Verify cache-busted artifacts.
4. Run the minimum agent sequence.
5. Patch renderer/content only where evidence supports it.
6. Review latest issue on GitHub Pages.
7. Run QC.
8. Freeze approved issue.
9. Build/update email artifact.
10. Confirm email CTA links point to frozen archive.

### Patch email layout

1. Locate current email artifact under `emails/`.
2. Compare against `sources/research_roundup_email_template.html` if useful.
3. Make isolated HTML/CSS changes.
4. Test Gmail desktop and phone behavior.
5. Verify small breakpoint has no horizontal scroll.
6. Confirm CTA and feedback links.

### Patch editorial output

1. Verify source evidence first.
2. Identify whether the issue is still mutable latest or already frozen.
3. Do not change frozen archive unless the user explicitly asks for a corrected archive.
4. Keep copy reader-facing and evidence-led.
5. Run QC before freeze/email.

---

## 14. Open items / what is not included in this package

The package does **not** include:

- Full repository checkout.
- Current Apps Script source.
- Recipient spreadsheet.
- Secrets, tokens, `.env` files, OAuth credentials, or private keys.
- Live Google Drive / Slides / Notion source data.

Claude Code should locate those in the user’s local environment, GitHub repository, or authorized Google/Notion surfaces as appropriate. Do not request secrets in chat.

---

## 15. Source priority order

When sources disagree, use this priority order:

1. Fresh deterministic build artifacts from GitHub Pages.
2. Approved frozen issue archive for already-sent issues.
3. Current repository source files.
4. This handoff package.
5. Older conversation notes or assumptions.

---

## 16. Final instruction for Claude Code

Treat this builder as a production-adjacent internal publishing system. Optimize for safe, repeatable monthly operation, not clever one-off fixes. Preserve the separation between evidence ingestion, editorial synthesis, archive freeze, and email distribution.
