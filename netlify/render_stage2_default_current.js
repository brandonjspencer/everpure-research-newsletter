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
  return {
    latest_week_date: latestWeekDate,
    week_count_30d: new Set(weeks30d.map((w) => w.week_date)).size,
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

const marchDeck = {
  label: 'Source deck',
  href: 'https://docs.google.com/presentation/d/13jB1RYa-3uNGR4KBgjSycNxqAv5v-R9vUUdovsCjlfM/edit'
};
const aprilDeck = {
  label: 'Source deck',
  href: 'https://docs.google.com/presentation/d/1aVwt3b5lEfS7JA1j751_PsnBegVnhZbPd1_5iFOX5KY/edit'
};

const brief = {
  title: 'Everpure monthly leadership brief (30d)',
  generated_at: generatedAt,
  window: '30d',
  audience: 'exec',
  tone: 'strategic',
  summary: counts,
  executive_summary:
    'The month points to three clear direction calls: keep simplifying the platform redesign, anchor knowledge portal positioning in support expectations, and continue the Evergreen rebrand in the higher-appeal direction without adding top-of-page complexity. Events and AI Summary are no longer broad exploration tracks — they now need one decision round each with explicit winning criteria.',
  surfaced_findings: [
    {
      title: 'Platform redesign baselines',
      finding_statement:
        'The platform redesign is strongest when the page is easier to scan at first glance. Reducing upper-page noise improves sentiment, while dense infographic treatment too early makes the page read as meant for advanced technical leads and lowers comprehension.',
      proof_point:
        'Findings suggest the cleaner direction produces a stronger positive reaction and that the top-of-page infographic is the main comprehension risk.',
      next_step:
        'Run one confirmation round that compares the simpler low-noise version against the current redesign, using comprehension plus sentiment together as the release gate.',
      confidence: 'medium',
      decision_status: 'iterate',
      source_label: marchDeck.label,
      source_href: marchDeck.href,
    },
    {
      title: 'Knowledge portal naming & structure',
      finding_statement:
        'This is primarily a naming and discoverability choice, not a broad structural rewrite. People are not strongly confused by either knowledge or support framing, but the support-led version is producing the clearer positive reaction.',
      proof_point:
        'Evidence suggests expectations were roughly even between knowledge and support URL options, while sentiment ran about 10 points higher for the support version.',
      next_step:
        'Keep the next pass anchored in support-led naming and search expectations, then test whether the broader portal model can expand without losing that clarity advantage.',
      confidence: 'medium',
      decision_status: 'iterate',
      source_label: marchDeck.label,
      source_href: marchDeck.href,
    },
    {
      title: 'Evergreen rebrand direction',
      finding_statement:
        'The Evergreen rebrand is strongest when it increases appeal without adding cognitive load too early. Clearer visual pacing helps, while dense infographic treatment near the top hurts both understanding and sentiment.',
      proof_point:
        'Evidence suggests a color break after the hero increases appeal and sentiment, while adding more infographic content at the top reduces comprehension.',
      next_step:
        'Continue with the higher-appeal direction, keep the upper page simpler, and delay denser explanatory content until after the offer is understood.',
      confidence: 'medium',
      decision_status: 'iterate',
      source_label: marchDeck.label,
      source_href: marchDeck.href,
    },
  ],
  comparison_tests: [
    {
      title: 'Events page baseline',
      finding_statement:
        'Events-page work has moved out of broad exploration and into a narrower comparison problem. The open question is which version gives the clearest path into the event content.',
      decision_criteria:
        'Choose on first-glance comprehension of the page offer and clarity of the primary next step — not stylistic preference alone.',
      next_step:
        'Reduce to one decisive V1-versus-V2 comparison and agree on comprehension and progression criteria before the test starts.',
      confidence: 'medium',
      decision_status: 'watch',
      source_label: aprilDeck.label,
      source_href: aprilDeck.href,
    },
    {
      title: 'AI summary variations',
      finding_statement:
        'The AI Summary work now needs selection pressure, not more expansion. The job of the next round is to choose the single framing that is easiest to understand and easiest to trust.',
      decision_criteria:
        'Pick the winning framing based on which version is clearest and most credible at first read, and which makes people most confident about what the AI summary is doing.',
      next_step:
        'Collapse to the two strongest framings and use the next round to choose one on comprehension and confidence — not novelty.',
      confidence: 'medium',
      decision_status: 'watch',
      source_label: aprilDeck.label,
      source_href: aprilDeck.href,
    },
  ],
  unresolved_questions: [
    {
      title: 'Design & UX feedback',
      scope: 'Homepage · Landing · Reader · Search · Header',
      question: 'Which changes materially improve clarity and progression, rather than simply making the design feel cleaner in review?',
    },
    {
      title: 'Support taxonomy',
      question: 'Which label and path model makes support intent obvious without expanding IA complexity or fragmenting the navigation model?',
    },
    {
      title: 'Pathfinder CTA labels',
      question: 'Which label set is clearest at the moment of commitment and least likely to add friction at the point of action?',
    },
  ],
  next_actions: [
    'Validate the simpler platform redesign against the current redesign using comprehension and sentiment together as the release gate.',
    'Keep knowledge portal testing anchored in support-led naming and search expectations before broadening the portal model.',
    'Continue Evergreen in the higher-appeal direction, but hold top-of-page infographic density until after the offer is understood.',
    'Run decisive comparison rounds for Events and AI Summary with explicit winning criteria defined before the test starts.',
  ],
  note:
    'This brief is a current-cycle, content-first stage-2 rendering written over the deterministic evidence layer. It is intended to support prioritization and iteration planning more than broad rollout approval.',
};

function labelConfidence(level) {
  switch (String(level || '').toLowerCase()) {
    case 'high': return 'High confidence';
    case 'low': return 'Low confidence';
    default: return 'Medium confidence';
  }
}

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
  out.push('## Research Findings');
  out.push('');
  for (const item of data.surfaced_findings) {
    out.push(`### ${item.title}`);
    out.push('');
    out.push(item.finding_statement);
    out.push('');
    out.push('#### Evidence');
    out.push('');
    out.push(item.proof_point);
    out.push('');
    if (item.source_href) {
      out.push(`[${item.source_label || 'Source deck'}](${item.source_href})`);
      out.push('');
    }
    out.push('#### Direction');
    out.push('');
    out.push(item.next_step);
    out.push('');
    out.push('#### Confidence');
    out.push('');
    out.push(labelConfidence(item.confidence));
    out.push('');
  }
  out.push('## Meaningful Comparisons');
  out.push('');
  for (const item of data.comparison_tests) {
    out.push(`### ${item.title}`);
    out.push('');
    out.push(item.finding_statement);
    out.push('');
    out.push('#### Criteria');
    out.push('');
    out.push(item.decision_criteria);
    out.push('');
    if (item.source_href) {
      out.push(`[${item.source_label || 'Source deck'}](${item.source_href})`);
      out.push('');
    }
    out.push('#### Direction');
    out.push('');
    out.push(item.next_step);
    out.push('');
    out.push('#### Confidence');
    out.push('');
    out.push(labelConfidence(item.confidence));
    out.push('');
  }
  out.push('## What Is Still Unresolved');
  out.push('');
  for (const item of data.unresolved_questions) {
    const head = item.scope ? `**${item.title}** — ${item.scope}` : `**${item.title}**`;
    out.push(`- ${head}: ${item.question}`);
  }
  out.push('');
  out.push('## Recommended Actions');
  out.push('');
  for (const item of data.next_actions) out.push(`- ${item}`);
  out.push('');
  out.push('## Note');
  out.push('');
  out.push(data.note);
  out.push('');
  return out.join('\n');
}

function sectionLabel(title) {
  return `<div class="section-label"><span class="section-title">${escapeHtml(title)}</span></div>`;
}

function confidenceBadge(level, dark = false) {
  const key = String(level || '').toLowerCase();
  const map = {
    high: { bg: dark ? 'rgba(207,232,212,0.15)' : 'rgba(90,99,89,0.12)', fg: dark ? 'var(--mint-400)' : 'var(--secondary)', dot: dark ? 'var(--mint-400)' : 'var(--secondary)', label: 'High confidence' },
    medium: { bg: dark ? 'rgba(213,93,29,0.14)' : 'rgba(213,93,29,0.12)', fg: 'var(--primary)', dot: 'var(--primary)', label: 'Medium confidence' },
    low: { bg: dark ? 'rgba(255,245,227,0.12)' : 'rgba(143,165,150,0.18)', fg: dark ? 'rgba(255,245,227,0.72)' : 'var(--muted-fg)', dot: dark ? 'rgba(255,245,227,0.72)' : 'var(--muted)', label: 'Low confidence' },
  };
  const c = map[key] || map.medium;
  return `<div class="confidence" style="background:${c.bg};color:${c.fg};"><span class="dot" style="background:${c.dot};"></span>${escapeHtml(c.label)}</div>`;
}

function sourceLinkInline(label, href, dark = false) {
  if (!href) return '';
  return `<a class="source-link-inline ${dark ? 'source-link-inline--dark' : ''}" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label || 'Source deck')} ↗</a>`;
}

function renderFinding(item, idx, isLast) {
  return `
  <div class="dispatch-finding ${isLast ? 'is-last' : ''}">
    <div class="finding-row">
      <span class="finding-index">${String(idx + 1).padStart(2, '0')}</span>
      <div class="finding-title">${escapeHtml(item.title).toUpperCase()}</div>
      ${confidenceBadge(item.confidence)}
    </div>
    <p class="finding-copy">${escapeHtml(item.finding_statement)} ${sourceLinkInline(item.source_label, item.source_href)}</p>
    <div class="finding-columns">
      <div class="finding-col evidence-col">
        <div class="mini-head"><span>EVIDENCE</span><div class="mini-line"></div></div>
        <p>${escapeHtml(item.proof_point)}</p>
      </div>
      <div class="finding-col direction-col">
        <div class="mini-head mini-head--accent"><span>DIRECTION</span><div class="mini-line"></div></div>
        <p>${escapeHtml(item.next_step)}</p>
      </div>
    </div>
  </div>`;
}

function renderComparison(item, idx, isLast) {
  return `
  <div class="dispatch-finding dispatch-finding--dark ${isLast ? 'is-last' : ''}">
    <div class="finding-row">
      <span class="finding-index finding-index--dark">${String(idx + 1).padStart(2, '0')}</span>
      <div class="finding-title finding-title--dark">${escapeHtml(item.title).toUpperCase()}</div>
      ${confidenceBadge(item.confidence, true)}
    </div>
    <p class="finding-copy finding-copy--dark">${escapeHtml(item.finding_statement)} ${sourceLinkInline(item.source_label, item.source_href, true)}</p>
    <div class="finding-columns finding-columns--dark">
      <div class="finding-col evidence-col evidence-col--dark">
        <div class="mini-head mini-head--dark"><span>CRITERIA</span><div class="mini-line mini-line--dark"></div></div>
        <p class="finding-copy-sub finding-copy-sub--dark">${escapeHtml(item.decision_criteria)}</p>
      </div>
      <div class="finding-col direction-col direction-col--dark">
        <div class="mini-head mini-head--accent-dark"><span>DIRECTION</span><div class="mini-line mini-line--dark"></div></div>
        <p class="finding-copy-sub finding-copy-sub--dark">${escapeHtml(item.next_step)}</p>
      </div>
    </div>
  </div>`;
}

function renderHtml(data) {
  const html = [];
  html.push('<!doctype html>');
  html.push('<html lang="en">');
  html.push('<head>');
  html.push('<meta charset="utf-8" />');
  html.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  html.push(`<title>${escapeHtml(data.title)}</title>`);
  html.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  html.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  html.push('<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">');
  html.push(`
<style>
:root {
  --font-family-primary: 'Familjen Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --text-h1: 43px;
  --text-h2: 30px;
  --text-h3: 24px;
  --text-h4: 18px;
  --text-base: 16px;
  --text-label: 14px;
  --background: rgba(255,245,227,1);
  --foreground: rgba(45,42,39,1);
  --primary: rgba(213,93,29,1);
  --primary-fg: rgba(255,245,227,1);
  --orange-100: rgba(255,224,194,1);
  --mint-400: rgba(207,232,212,1);
  --sidebar: rgba(38,35,33,1);
  --sidebar-fg: rgba(255,245,227,1);
  --secondary: rgba(90,99,89,1);
  --muted: rgba(143,165,150,1);
  --muted-fg: rgba(90,99,89,1);
  --chart-4: rgba(189,103,61,1);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--background); color: var(--foreground); }
body { font-family: var(--font-family-primary); }
a { color: inherit; }
.wrapper { max-width: 760px; margin: 0 auto; padding: 0 48px; }
.masthead { background: var(--sidebar); color: var(--sidebar-fg); }
.meta-bar { display:flex; justify-content:space-between; align-items:center; padding:32px 0 24px; border-bottom:1px solid rgba(255,245,227,0.1); }
.meta-left, .meta-issue, .meta-date { font-size: var(--text-label); }
.meta-left { font-weight:700; color: rgba(255,245,227,0.38); letter-spacing:.12em; text-transform:uppercase; }
.meta-right { display:flex; align-items:center; gap:14px; }
.meta-issue { font-weight:700; color: var(--primary); letter-spacing:.1em; text-transform:uppercase; }
.meta-date { font-weight:400; color: rgba(255,245,227,0.38); }
.masthead-grid { display:grid; grid-template-columns:1fr auto; gap:0; }
.title-pane { position:relative; padding:44px 40px 44px 0; border-right:1px solid rgba(255,245,227,0.08); display:flex; flex-direction:column; justify-content:space-between; gap:32px; overflow:hidden; }
.ghost { position:absolute; right:-8px; bottom:-12px; font-size:160px; font-weight:700; color: rgba(255,245,227,0.04); line-height:1; letter-spacing:-.05em; }
.monthly-tag { display:inline-flex; align-items:center; gap:8px; font-size:var(--text-label); font-weight:700; color:var(--primary); letter-spacing:.14em; text-transform:uppercase; }
.monthly-tag::before { content:''; width:16px; height:2px; background:var(--primary); border-radius:1px; display:inline-block; }
.h1 { margin:0; font-size:52px; font-weight:500; line-height:.95; letter-spacing:-.03em; color:var(--sidebar-fg); }
.cycle-note { font-size:var(--text-label); color: rgba(255,245,227,0.28); }
.stats-grid { display:grid; grid-template-columns:1fr 1fr; width:280px; }
.stat { padding:24px 22px; display:flex; flex-direction:column; gap:6px; }
.stat:nth-child(2n) { border-left:1px solid rgba(255,245,227,0.08); }
.stat:nth-child(-n+2) { border-bottom:1px solid rgba(255,245,227,0.08); }
.stat:nth-child(odd) { background: rgba(255,245,227,0.02); }
.stat:nth-child(even) { background: rgba(255,245,227,0.015); }
.stat-value { font-size:28px; font-weight:700; color:var(--primary); line-height:1; letter-spacing:-.02em; }
.stat-label { font-size:var(--text-label); white-space:pre-line; color: rgba(255,245,227,0.38); line-height:1.4; }
.brief-band { background: var(--primary); border-bottom:2px solid var(--orange-100); }
.brief-grid { display:grid; grid-template-columns:120px 1fr; gap:0; }
.brief-sidebar { padding:56px 32px 56px 0; border-right:1px solid rgba(255,245,227,0.18); }
.brief-index { font-size:var(--text-label); font-weight:700; color:var(--primary-fg); opacity:0.4; letter-spacing:.16em; text-transform:uppercase; }
.brief-title { margin-top:6px; font-size:var(--text-base); font-weight:500; color:var(--primary-fg); opacity:0.55; }
.brief-copy { padding:56px 0 56px 40px; font-size:var(--text-h4); line-height:1.85; color:var(--primary-fg); }
.section { padding:68px 0 72px; }
.section-dark { background: var(--sidebar); color: var(--sidebar-fg); border-top:2px solid var(--orange-100); }
.section-mint { background: var(--mint-400); border-top:2px solid var(--orange-100); border-bottom:2px solid var(--orange-100); }
.section-label { display:flex; align-items:baseline; }
.section-title { font-size:var(--text-h2); font-weight:500; line-height:1.5; }
.findings { display:flex; flex-direction:column; gap:0; margin-top:40px; }
.dispatch-finding { padding-bottom:52px; margin-bottom:52px; border-bottom:2px solid var(--orange-100); }
.dispatch-finding.is-last { margin-bottom:0; border-bottom:none; }
.dispatch-finding--dark { border-bottom-color: rgba(255,245,227,0.18); }
.finding-row { display:flex; align-items:center; gap:16px; margin-bottom:16px; flex-wrap:wrap; }
.finding-index { font-size:var(--text-label); font-weight:700; color:var(--primary); opacity:0.7; letter-spacing:.16em; }
.finding-index--dark { color: rgba(255,224,194,0.72); }
.finding-title { flex:1; font-size:var(--text-base); font-weight:700; color:var(--foreground); letter-spacing:.06em; text-transform:uppercase; }
.finding-title--dark { color: var(--sidebar-fg); }
.confidence { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:4px; font-size:var(--text-label); font-weight:700; }
.dot { width:5px; height:5px; border-radius:50%; display:inline-block; }
.source-link-inline { display:inline; white-space:nowrap; font-size:0.72em; font-weight:600; color:var(--muted-fg); text-decoration:none; border-bottom:1px solid rgba(90,99,89,0.35); padding-bottom:1px; margin-left:8px; vertical-align:baseline; }
.source-link-inline:hover { color:var(--primary); border-bottom-color:var(--primary); }
.source-link-inline--dark { color:rgba(255,245,227,0.76); border-bottom-color:rgba(255,245,227,0.32); }
.source-link-inline--dark:hover { color:var(--orange-100); border-bottom-color:var(--orange-100); }
.finding-copy { margin:0 0 36px; font-size:var(--text-h4); line-height:1.82; }
.finding-copy--dark { color: var(--sidebar-fg); }
.finding-columns { display:grid; grid-template-columns:1fr 1fr; gap:0; }
.finding-columns--dark { column-gap:0; }
.finding-col p { margin:0; font-size:var(--text-base); line-height:1.7; }
.finding-copy-sub { margin:0; font-size:var(--text-base); line-height:1.7; }
.finding-copy-sub--dark { color: var(--sidebar-fg); }
.evidence-col { padding-right:32px; border-right:2px solid var(--orange-100); }
.evidence-col--dark { border-right-color: rgba(255,245,227,0.18); }
.direction-col { padding-left:32px; }
.mini-head { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
.mini-head span { flex-shrink:0; font-size:var(--text-label); font-weight:700; color:var(--muted-fg); letter-spacing:.1em; text-transform:uppercase; }
.mini-head--accent span { color:var(--primary); }
.mini-head--dark span { color: rgba(255,245,227,0.58); }
.mini-head--accent-dark span { color: var(--primary); }
.mini-line { flex:1; height:1px; background:var(--orange-100); }
.mini-line--dark { background: rgba(255,245,227,0.18); }
.questions { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; margin-top:40px; }
.question { padding:36px 28px 36px 0; display:flex; flex-direction:column; gap:20px; }
.question + .question { padding-left:28px; border-left:2px solid rgba(90,99,89,0.2); }
.question-num { font-size:72px; font-weight:700; color:var(--primary); opacity:0.45; line-height:1; letter-spacing:-.04em; }
.question-head { display:flex; flex-direction:column; gap:8px; }
.question-title { font-size:var(--text-label); font-weight:700; color:var(--muted-fg); letter-spacing:.07em; text-transform:uppercase; line-height:1.4; }
.question-scope { font-size:13px; font-weight:600; color:rgba(90,99,89,0.78); line-height:1.55; }
.question p { margin:0; font-size:var(--text-base); line-height:1.75; }
.actions { display:flex; flex-direction:column; gap:0; margin-top:40px; }
.action-row { display:grid; grid-template-columns:72px 1fr; gap:24px; align-items:start; padding:28px 0; border-bottom:2px solid var(--orange-100); }
.action-row:first-child { border-top:2px solid var(--orange-100); }
.action-index { font-size:40px; font-weight:700; color:var(--primary); opacity:.35; line-height:1; letter-spacing:-.03em; padding-top:4px; }
.action-row p { margin:0; font-size:var(--text-h4); line-height:1.75; }
.note { margin:48px 0 0; font-size:var(--text-label); line-height:1.75; color:var(--muted-fg); font-style:italic; }
.footer { background: var(--sidebar); border-top:3px solid var(--primary); }
.footer-inner { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:28px 0; }
.footer span { font-size:var(--text-label); color:var(--sidebar-fg); opacity:0.32; }
.back-link { display:inline-block; color:rgba(255,245,227,0.9); text-decoration:none; margin-top:22px; }
.back-link:hover { text-decoration:underline; }
@media (max-width: 900px) {
  .wrapper { padding: 0 24px; }
  .masthead-grid, .questions, .brief-grid, .finding-columns, .action-row { grid-template-columns:1fr; }
  .title-pane { padding-right:0; border-right:none; }
  .stats-grid { width:auto; border-top:1px solid rgba(255,245,227,0.08); }
  .brief-sidebar { border-right:none; padding-right:0; padding-bottom:0; }
  .brief-copy { padding:24px 0 48px; }
  .evidence-col { padding-right:0; border-right:none; margin-bottom:24px; }
  .direction-col { padding-left:0; }
  .question + .question { padding-left:0; border-left:none; padding-top:0; }
}
</style>`);
  html.push('</head>');
  html.push('<body>');
  html.push('<header class="masthead">');
  html.push('<div class="wrapper">');
  html.push('<a class="back-link" href="../">Back to homepage</a>');
  html.push('<div class="meta-bar">');
  html.push('<span class="meta-left">Everpure User Research Program</span>');
  html.push(`<div class="meta-right"><span class="meta-issue">Issue 01</span><span style="opacity:.2">·</span><span class="meta-date">${escapeHtml(issueDate)}</span></div>`);
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
    ['30', 'Day\nReport'],
  ];
  for (const [value, label] of stats) {
    html.push(`<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`);
  }
  html.push('</div></div></div></header>');

  html.push('<section class="brief-band"><div class="wrapper brief-grid">');
  html.push('<div class="brief-sidebar"><div class="brief-index">00</div><div class="brief-title">The Brief</div></div>');
  html.push(`<div class="brief-copy">${escapeHtml(data.executive_summary)}</div>`);
  html.push('</div></section>');

  html.push('<section class="section"><div class="wrapper">');
  html.push(sectionLabel('Research Findings'));
  html.push('<div class="findings">');
  data.surfaced_findings.forEach((item, idx) => html.push(renderFinding(item, idx, idx === data.surfaced_findings.length - 1)));
  html.push('</div></div></section>');

  html.push('<section class="section section-dark"><div class="wrapper">');
  html.push(sectionLabel('Meaningful Comparisons'));
  html.push('<div class="findings">');
  data.comparison_tests.forEach((item, idx) => html.push(renderComparison(item, idx, idx === data.comparison_tests.length - 1)));
  html.push('</div></div></section>');

  html.push('<section class="section section-mint"><div class="wrapper">');
  html.push(sectionLabel('What Is Still Unresolved'));
  html.push('<div class="questions">');
  data.unresolved_questions.forEach((item, idx) => {
    html.push(`<div class="question"><span class="question-num">${String(idx + 1).padStart(2, '0')}</span><div><div class="question-head"><div class="question-title">${escapeHtml(item.title)}</div>${item.scope ? `<div class="question-scope">${escapeHtml(item.scope)}</div>` : ''}</div><p>${escapeHtml(item.question)}</p></div></div>`);
  });
  html.push('</div></div></section>');

  html.push('<section class="section"><div class="wrapper">');
  html.push(sectionLabel('Recommended Actions'));
  html.push('<div class="actions">');
  data.next_actions.forEach((item, idx) => {
    html.push(`<div class="action-row"><span class="action-index">${String(idx + 1).padStart(2, '0')}</span><p>${escapeHtml(item)}</p></div>`);
  });
  html.push('</div>');
  html.push(`<p class="note">${escapeHtml(data.note)}</p>`);
  html.push('</div></section>');

  html.push('<footer class="footer"><div class="wrapper footer-inner">');
  html.push('<span>Everpure User Research Program</span>');
  html.push(`<span>Monthly Leadership Brief · Issue 01 · ${escapeHtml(issueDate)}</span>`);
  html.push('</div></footer>');
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
    path.join(publishRoot, 'api', 'newsletter-default.json')
  ]
}, null, 2));
