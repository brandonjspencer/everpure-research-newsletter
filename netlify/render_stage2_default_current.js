#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeText(p, text) {
  ensureDir(p);
  fs.writeFileSync(p, text, 'utf8');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function daysAgo(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function summarizeCounts(publishRoot) {
  const weeks = readJson(path.join(publishRoot, 'data', 'weeks.json'), []);
  const conceptEvidence = readJson(path.join(publishRoot, 'data', 'concept-evidence-default-30d.json'), []);
  const weekDates = weeks.map((w) => w.week_date).filter(Boolean).sort();
  const latestWeekDate = weekDates.length ? weekDates[weekDates.length - 1] : null;
  const cutoff = latestWeekDate ? daysAgo(latestWeekDate, 29) : null;
  const weeks30d = cutoff ? weeks.filter((w) => w.week_date && w.week_date >= cutoff) : weeks;
  const uniqueWeekCount = new Set(weeks30d.map((w) => w.week_date)).size;
  return {
    latest_week_date: latestWeekDate,
    week_count_30d: uniqueWeekCount,
    concept_evidence_count: Array.isArray(conceptEvidence) ? conceptEvidence.length : 0,
  };
}

const publishRoot = path.resolve(process.argv[2] || 'publish');
const counts = summarizeCounts(publishRoot);
const generatedAt = new Date().toISOString();
const issueDate = (() => {
  try {
    return new Date(generatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return 'Current cycle';
  }
})();

const brief = {
  title: 'Everpure monthly leadership brief (30d)',
  generated_at: generatedAt,
  window: '30d',
  audience: 'exec',
  tone: 'strategic',
  summary: counts,
  executive_summary:
    'The month points to three clear direction calls: keep simplifying the platform redesign, anchor knowledge portal positioning in support expectations, and continue the Evergreen rebrand in the higher-appeal direction without adding top-of-page complexity. Events and AI Summary are no longer broad exploration tracks; they now need one decision round each with explicit winning criteria.',
  surfaced_findings: [
    {
      title: 'Platform redesign baselines',
      finding_statement:
        'The platform redesign is strongest when the page is easier to scan at first glance. Reducing upper-page noise improves sentiment, while dense infographic treatment too early makes the page read as meant for advanced technical leads and lowers comprehension.',
      proof_point:
        'Concept 176 evidence ties the cleaner direction to stronger positive reaction and flags the top-of-page infographic as the main comprehension risk when the page starts to feel too technical too early.',
      next_step:
        'Run one confirmation round that compares the simpler low-noise version against the current redesign and use comprehension plus sentiment together as the release gate.',
      confidence: 'Medium',
      decision_status: 'iterate',
    },
    {
      title: 'Knowledge portal naming and structure',
      finding_statement:
        'This is primarily a naming and discoverability choice, not a broad structural rewrite. People are not strongly confused by either knowledge or support framing, but the support-led version is producing the clearer positive reaction.',
      proof_point:
        'Current concept evidence says expectations were roughly even between knowledge and support URL options, while sentiment ran about 10 points higher for the support version.',
      next_step:
        'Keep the next pass anchored in support-led naming and search expectations, then test whether the broader portal model can expand without losing that clarity advantage.',
      confidence: 'Medium',
      decision_status: 'iterate',
    },
    {
      title: 'Evergreen rebrand direction',
      finding_statement:
        'The Evergreen rebrand is strongest when it increases appeal without adding cognitive load too early. Clearer visual pacing helps, while dense infographic treatment near the top hurts both understanding and sentiment.',
      proof_point:
        'Concept 178 evidence says a color break after the hero increases appeal and sentiment, while adding more infographic content at the top reduces comprehension and sentiment.',
      next_step:
        'Continue with the higher-appeal direction, keep the upper page simpler, and delay denser explanatory content until after the offer is understood.',
      confidence: 'Medium',
      decision_status: 'iterate',
    },
  ],
  comparison_tests: [
    {
      title: 'Events page baseline',
      finding_statement:
        'Events-page work has moved out of broad exploration and into a narrower comparison problem. The open question is no longer which direction to explore, but which version makes the page easier to understand and gives the clearest path into the event content.',
      decision_criteria:
        'Choose the winning version based on first-glance comprehension of the page offer and the clarity of the primary next step, not on stylistic preference alone.',
      next_step:
        'Reduce the next round to one decisive V1-versus-V2 comparison and agree on the comprehension and progression criteria before the test starts.',
      confidence: 'Moderate',
      decision_status: 'watch',
    },
    {
      title: 'AI summary variations',
      finding_statement:
        'The AI Summary work now needs selection pressure, not more expansion. The job of the next round is to choose the single framing that is easiest to understand and easiest to trust, rather than generate more exploratory variants.',
      decision_criteria:
        'Pick the winning framing based on which version is clearest and most credible at first read, and which option makes people more confident about what the AI summary is actually doing.',
      next_step:
        'Collapse to the two strongest framings and use the next round to choose one on comprehension and confidence, not novelty.',
      confidence: 'Moderate',
      decision_status: 'watch',
    },
  ],
  unresolved_questions: [
    'Across homepage, landing, reader, search, and header work, which changes materially improve clarity and progression, rather than simply making the design feel cleaner in review?',
    'For support taxonomy, which label and path model makes support intent obvious without expanding IA complexity or fragmenting the navigation model?',
    'For Pathfinder CTA labels, which label set is clearest at the moment of commitment and least likely to add friction at the point of action?',
  ],
  next_actions: [
    'Validate the simpler platform redesign against the current redesign using comprehension and sentiment together as the release gate.',
    'Keep knowledge portal testing anchored in support-led naming and search expectations before broadening the portal model.',
    'Continue Evergreen in the higher-appeal direction, but hold top-of-page infographic density until after the offer is understood.',
    'Run decisive comparison rounds for Events and AI Summary with explicit winning criteria defined before the test starts.',
  ],
  note:
    'This default brief is a current-cycle, content-first stage-2 rendering written over the deterministic evidence layer. It is intended to support prioritization and iteration planning more than broad rollout approval.',
};

function renderMarkdown(data) {
  const out = [];
  out.push(`# ${data.title}`);
  out.push('');
  out.push(`Generated ${data.generated_at} · ${data.window} · ${data.audience} · ${data.tone}`);
  out.push('');
  out.push('## Executive summary');
  out.push('');
  out.push(data.executive_summary);
  out.push('');
  out.push('## What the research surfaced');
  out.push('');
  for (const item of data.surfaced_findings) {
    out.push(`### ${item.title}`);
    out.push('');
    out.push('#### What we found');
    out.push('');
    out.push(item.finding_statement);
    out.push('');
    out.push('#### Proof point');
    out.push('');
    out.push(item.proof_point);
    out.push('');
    out.push('#### What we should do next');
    out.push('');
    out.push(item.next_step);
    out.push('');
    out.push('#### Confidence');
    out.push('');
    out.push(item.confidence);
    out.push('');
  }
  out.push('## Meaningful comparison tests');
  out.push('');
  for (const item of data.comparison_tests) {
    out.push(`### ${item.title}`);
    out.push('');
    out.push('#### What we found');
    out.push('');
    out.push(item.finding_statement);
    out.push('');
    out.push('#### Decision criteria for the next round');
    out.push('');
    out.push(item.decision_criteria);
    out.push('');
    out.push('#### What we should do next');
    out.push('');
    out.push(item.next_step);
    out.push('');
    out.push('#### Confidence');
    out.push('');
    out.push(item.confidence);
    out.push('');
  }
  out.push('## What is still unresolved');
  out.push('');
  for (const item of data.unresolved_questions) out.push(`- ${item}`);
  out.push('');
  out.push('## What we should do next');
  out.push('');
  for (const item of data.next_actions) out.push(`- ${item}`);
  out.push('');
  out.push('## Note');
  out.push('');
  out.push(data.note);
  out.push('');
  return out.join('\n');
}

function pill(text, kind = 'iterate') {
  const cls = kind === 'watch' ? 'pill pill-watch' : 'pill pill-iterate';
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function sectionLabel(index, title) {
  return `
    <div class="section-label">
      <div class="section-index">${escapeHtml(index)}</div>
      <div class="section-title">${escapeHtml(title)}</div>
    </div>`;
}

function renderFinding(item, index) {
  return `
    <article class="dispatch-row">
      <div class="dispatch-num">${String(index + 1).padStart(2, '0')}</div>
      <div class="dispatch-body">
        <div class="dispatch-head">
          <h3>${escapeHtml(item.title)}</h3>
          ${pill(item.confidence, item.decision_status)}
        </div>
        <div class="dispatch-grid">
          <div>
            <p class="eyebrow">What we found</p>
            <p class="lead-copy">${escapeHtml(item.finding_statement)}</p>
          </div>
          <div>
            <p class="eyebrow">Proof point</p>
            <p>${escapeHtml(item.proof_point)}</p>
          </div>
          <div class="dispatch-direction">
            <p class="eyebrow">What we should do next</p>
            <p>${escapeHtml(item.next_step)}</p>
          </div>
        </div>
      </div>
    </article>`;
}

function renderComparison(item, index) {
  return `
    <article class="comparison-card">
      <div class="comparison-top">
        <span class="comparison-index">${String(index + 1).padStart(2, '0')}</span>
        ${pill(item.confidence, item.decision_status)}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="comparison-copy">${escapeHtml(item.finding_statement)}</p>
      <div class="comparison-block">
        <p class="eyebrow">Decision criteria</p>
        <p>${escapeHtml(item.decision_criteria)}</p>
      </div>
      <div class="comparison-block">
        <p class="eyebrow">Next move</p>
        <p>${escapeHtml(item.next_step)}</p>
      </div>
    </article>`;
}

function renderHtml(data) {
  const html = [];
  html.push('<!doctype html>');
  html.push('<html lang="en">');
  html.push('<head>');
  html.push('<meta charset="utf-8" />');
  html.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  html.push(`<title>${escapeHtml(data.title)}</title>`);
  html.push(`
<style>
:root {
  --bg: #fff5e3;
  --fg: #2d2a27;
  --sidebar: #262321;
  --sidebar-fg: #fff5e3;
  --primary: #d55d1d;
  --primary-bright: #ff7023;
  --primary-fg: #fff5e3;
  --orange-100: #ffe0c2;
  --mint-400: #cfe8d4;
  --muted: #8fa596;
  --muted-fg: #5a6359;
  --border: #8fa596;
  --card: #fff5e3;
  --radius: 16px;
  --shadow: 0 10px 30px rgba(0,0,0,0.12);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Pure Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.55;
}
a { color: inherit; }
.shell { width: min(1120px, calc(100vw - 48px)); margin: 0 auto; }
.masthead { background: var(--sidebar); color: var(--sidebar-fg); }
.meta-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 28px 0 22px; border-bottom: 1px solid rgba(255,245,227,0.12);
}
.meta-label, .meta-issue, .meta-date { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; }
.meta-label { color: rgba(255,245,227,.45); font-weight: 700; }
.meta-right { display: flex; align-items: center; gap: 12px; }
.meta-issue { color: var(--primary-bright); font-weight: 700; }
.meta-date { color: rgba(255,245,227,.42); }
.masthead-grid { display: grid; grid-template-columns: 1fr 320px; gap: 0; }
.title-pane {
  position: relative; padding: 44px 40px 44px 0; border-right: 1px solid rgba(255,245,227,.08);
  min-height: 320px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;
}
.ghost { position: absolute; right: -8px; bottom: -24px; font-size: 180px; font-weight: 700; letter-spacing: -.06em; opacity: .045; line-height: .9; }
.monthly-tag { display: inline-flex; align-items: center; gap: 10px; color: var(--primary-bright); font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 700; }
.monthly-tag::before { content: ""; display: inline-block; width: 18px; height: 2px; background: var(--primary-bright); border-radius: 1px; }
.h1 { font-size: clamp(56px, 7vw, 108px); line-height: .92; letter-spacing: -.04em; margin: 0; font-weight: 600; }
.cycle-note { color: rgba(255,245,227,.38); font-size: 14px; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; }
.stat { padding: 24px 22px; border-left: 1px solid rgba(255,245,227,.08); border-bottom: 1px solid rgba(255,245,227,.08); }
.stat:nth-child(1), .stat:nth-child(3) { border-left: none; }
.stat:nth-child(3), .stat:nth-child(4) { border-bottom: none; }
.stat:nth-child(odd) { background: rgba(255,245,227,.022); }
.stat:nth-child(even) { background: rgba(255,245,227,.014); }
.stat-value { color: var(--primary-bright); font-size: 32px; line-height: 1; font-weight: 700; }
.stat-label { color: rgba(255,245,227,.42); white-space: pre-line; font-size: 13px; margin-top: 8px; }
.brief-band { background: var(--primary); color: var(--primary-fg); border-bottom: 2px solid var(--orange-100); }
.brief-grid { display: grid; grid-template-columns: 120px 1fr; }
.brief-sidebar { padding: 52px 32px 52px 0; border-right: 1px solid rgba(255,245,227,.18); }
.brief-index { font-size: 12px; text-transform: uppercase; letter-spacing: .16em; opacity: .48; font-weight: 700; }
.brief-title { margin-top: 6px; font-size: 18px; opacity: .72; }
.brief-copy { padding: 52px 0 52px 40px; font-size: clamp(20px, 2.4vw, 28px); line-height: 1.8; }
.section { padding: 72px 0; }
.section--dark { background: var(--sidebar); color: var(--sidebar-fg); }
.section--mint { background: var(--mint-400); }
.section--footer { background: #efe2cd; border-top: 2px solid var(--orange-100); }
.section-label { display: flex; align-items: baseline; gap: 16px; margin-bottom: 36px; }
.section-index { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--primary); font-weight: 700; }
.section--dark .section-index { color: var(--primary-bright); }
.section-title { font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.dispatch-row { display: grid; grid-template-columns: 72px 1fr; gap: 24px; padding: 28px 0; border-top: 2px solid var(--orange-100); }
.dispatch-row:last-child { border-bottom: 2px solid var(--orange-100); }
.dispatch-num { font-size: 40px; font-weight: 700; color: var(--primary); letter-spacing: -.03em; }
.dispatch-head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.dispatch-head h3, .comparison-card h3 { margin: 0; font-size: clamp(28px, 3vw, 40px); line-height: 1.02; letter-spacing: -.03em; font-weight: 600; }
.dispatch-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 28px 36px; margin-top: 20px; }
.dispatch-direction { grid-column: 1 / -1; padding-top: 4px; border-top: 1px solid rgba(143,165,150,.35); }
.eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted-fg); font-weight: 700; margin: 0 0 8px; }
.section--dark .eyebrow { color: rgba(255,245,227,.58); }
.lead-copy { font-size: 20px; line-height: 1.75; margin: 0; }
.pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; }
.pill-iterate { background: rgba(213,93,29,.12); color: var(--primary); border: 1px solid rgba(213,93,29,.28); }
.pill-watch { background: rgba(255,112,35,.14); color: var(--primary-bright); border: 1px solid rgba(255,112,35,.32); }
.comparisons { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.comparison-card { background: rgba(255,245,227,.03); border: 1px solid rgba(255,245,227,.12); border-radius: 22px; padding: 24px; box-shadow: var(--shadow); }
.comparison-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.comparison-index { color: var(--primary-bright); font-size: 14px; letter-spacing: .16em; font-weight: 700; }
.comparison-copy { font-size: 18px; line-height: 1.75; margin: 10px 0 20px; }
.comparison-block { margin-top: 18px; padding-top: 18px; border-top: 1px solid rgba(255,245,227,.12); }
.questions-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.question-card { background: rgba(255,245,227,.88); border: 1px solid rgba(143,165,150,.32); border-radius: 18px; padding: 24px; min-height: 220px; }
.question-card p { margin: 0; font-size: 18px; line-height: 1.7; }
.question-num { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--primary); font-weight: 700; margin-bottom: 14px; }
.actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.action-card { background: rgba(255,245,227,.92); border: 1px solid rgba(143,165,150,.28); border-radius: 18px; padding: 22px; }
.action-card p { margin: 0; font-size: 20px; line-height: 1.7; }
.action-num { font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--primary); font-weight: 700; margin-bottom: 12px; }
.note { margin-top: 34px; padding-top: 20px; border-top: 1px solid rgba(90,99,89,.26); color: #5a6359; font-size: 14px; }
.back-link { display: inline-block; margin: 22px 0 0; font-size: 14px; color: rgba(255,245,227,.78); }
@media (max-width: 960px) {
  .shell { width: min(100vw - 32px, 1100px); }
  .masthead-grid, .comparisons, .questions-grid, .actions-grid { grid-template-columns: 1fr; }
  .title-pane { padding-right: 0; border-right: none; min-height: auto; }
  .stats-grid { border-top: 1px solid rgba(255,245,227,.08); }
  .brief-grid, .dispatch-row { grid-template-columns: 1fr; }
  .brief-sidebar { border-right: none; padding-right: 0; padding-bottom: 0; }
  .brief-copy { padding: 20px 0 44px; }
  .dispatch-grid { grid-template-columns: 1fr; }
}
</style>`);
  html.push('</head>');
  html.push('<body>');
  html.push('<header class="masthead">');
  html.push('<div class="shell">');
  html.push(`<a class="back-link" href="../">Back to homepage</a>`);
  html.push('<div class="meta-bar">');
  html.push('<div class="meta-label">Everpure User Research Program</div>');
  html.push(`<div class="meta-right"><div class="meta-issue">Issue 01</div><div style="opacity:.18">·</div><div class="meta-date">${escapeHtml(issueDate)}</div></div>`);
  html.push('</div>');
  html.push('<div class="masthead-grid">');
  html.push('<div class="title-pane">');
  html.push('<div class="ghost">01</div>');
  html.push('<div class="monthly-tag">Monthly</div>');
  html.push('<h1 class="h1">Leadership<br/>Brief</h1>');
  html.push('<div class="cycle-note">30-day research cycle</div>');
  html.push('</div>');
  html.push('<div class="stats-grid">');
  const stats = [
    [String(data.surfaced_findings.length), 'Research\nFindings'],
    [String(data.comparison_tests.length), 'Comparison\nTests'],
    [String(data.unresolved_questions.length), 'Open\nQuestions'],
    [String(data.summary.week_count_30d || 30), 'Day\nReport'],
  ];
  for (const [value, label] of stats) {
    html.push(`<div class="stat"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div></div>`);
  }
  html.push('</div></div></div></header>');

  html.push('<section class="brief-band">');
  html.push('<div class="shell brief-grid">');
  html.push('<div class="brief-sidebar"><div class="brief-index">00</div><div class="brief-title">The Brief</div></div>');
  html.push(`<div class="brief-copy">${escapeHtml(data.executive_summary)}</div>`);
  html.push('</div></section>');

  html.push('<section class="section">');
  html.push('<div class="shell">');
  html.push(sectionLabel('01', 'Research Findings'));
  data.surfaced_findings.forEach((item, idx) => html.push(renderFinding(item, idx)));
  html.push('</div></section>');

  html.push('<section class="section section--dark">');
  html.push('<div class="shell">');
  html.push(sectionLabel('02', 'Meaningful Comparison Tests'));
  html.push('<div class="comparisons">');
  data.comparison_tests.forEach((item, idx) => html.push(renderComparison(item, idx)));
  html.push('</div></div></section>');

  html.push('<section class="section section--mint">');
  html.push('<div class="shell">');
  html.push(sectionLabel('03', 'What Is Still Unresolved'));
  html.push('<div class="questions-grid">');
  data.unresolved_questions.forEach((question, idx) => {
    html.push(`<div class="question-card"><div class="question-num">0${idx + 1}</div><p>${escapeHtml(question)}</p></div>`);
  });
  html.push('</div></div></section>');

  html.push('<section class="section section--footer">');
  html.push('<div class="shell">');
  html.push(sectionLabel('04', 'What We Should Do Next'));
  html.push('<div class="actions-grid">');
  data.next_actions.forEach((action, idx) => {
    html.push(`<div class="action-card"><div class="action-num">0${idx + 1}</div><p>${escapeHtml(action)}</p></div>`);
  });
  html.push('</div>');
  html.push(`<p class="note">${escapeHtml(data.note)}</p>`);
  html.push('</div></section>');
  html.push('</body></html>');
  return html.join('');
}

const markdown = renderMarkdown(brief);
const html = renderHtml(brief);
const json = JSON.stringify(brief, null, 2) + '\n';

writeText(path.join(publishRoot, 'newsletter', 'default.md'), markdown);
writeText(path.join(publishRoot, 'newsletter', 'default.html'), html);
writeText(path.join(publishRoot, 'newsletter', 'default.json'), json);
writeText(path.join(publishRoot, 'api', 'newsletter-default.md'), markdown);
writeText(path.join(publishRoot, 'api', 'newsletter-default.json'), json);

console.log(JSON.stringify({
  generated_at: generatedAt,
  outputs: [
    path.join(publishRoot, 'newsletter', 'default.md'),
    path.join(publishRoot, 'newsletter', 'default.html'),
    path.join(publishRoot, 'newsletter', 'default.json'),
    path.join(publishRoot, 'api', 'newsletter-default.md'),
    path.join(publishRoot, 'api', 'newsletter-default.json'),
  ],
}, null, 2));
