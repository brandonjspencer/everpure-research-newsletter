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
      confidence: 'medium — clear enough to steer the next iteration, not yet broad-rollout ready.',
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
      confidence: 'medium — enough confidence to steer naming direction, not enough to freeze the full portal model.',
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
      confidence: 'medium — solid directional evidence for the next iteration, but still an iteration decision rather than a full ship call.',
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
      confidence: 'moderate — enough evidence to tighten the test design, not enough to ship a version yet.',
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
      confidence: 'moderate — sufficient to narrow the field, but not yet sufficient for rollout.',
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
  for (const item of data.unresolved_questions) {
    out.push(`- ${item}`);
  }
  out.push('');
  out.push('## What we should do next');
  out.push('');
  for (const item of data.next_actions) {
    out.push(`- ${item}`);
  }
  out.push('');
  out.push('## Note');
  out.push('');
  out.push(data.note);
  out.push('');
  return out.join('\n');
}

function renderHtml(data) {
  const html = [];
  html.push('<!doctype html>');
  html.push('<html lang="en">');
  html.push('<head>');
  html.push('<meta charset="utf-8" />');
  html.push('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  html.push(`<title>${escapeHtml(data.title)}</title>`);
  html.push('<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:860px;margin:40px auto;padding:0 20px;line-height:1.6;color:#111}h1,h2,h3,h4{line-height:1.25}h1{margin-bottom:0.2rem}small,.meta{color:#666}section{margin:28px 0}article{border-top:1px solid #e5e5e5;padding-top:18px;margin-top:18px}ul{padding-left:22px}a{color:#0b57d0;text-decoration:none}a:hover{text-decoration:underline}code{background:#f5f5f5;padding:2px 4px;border-radius:4px}</style>');
  html.push('</head>');
  html.push('<body>');
  html.push('<p><a href="../">Back to homepage</a></p>');
  html.push(`<h1>${escapeHtml(data.title)}</h1>`);
  html.push(`<p class="meta">Generated ${escapeHtml(data.generated_at)} · ${escapeHtml(data.window)} · ${escapeHtml(String(data.summary.week_count_30d || 0))} weekly updates · ${escapeHtml(String(data.summary.concept_evidence_count || 0))} concept evidence rows · ${escapeHtml(data.audience)} · ${escapeHtml(data.tone)}</p>`);
  html.push('<section>');
  html.push('<h2>Executive summary</h2>');
  html.push(`<p>${escapeHtml(data.executive_summary)}</p>`);
  html.push('</section>');
  html.push('<section>');
  html.push('<h2>What the research surfaced</h2>');
  for (const item of data.surfaced_findings) {
    html.push('<article>');
    html.push(`<h3>${escapeHtml(item.title)}</h3>`);
    html.push('<h4>What we found</h4>');
    html.push(`<p>${escapeHtml(item.finding_statement)}</p>`);
    html.push('<h4>Proof point</h4>');
    html.push(`<p>${escapeHtml(item.proof_point)}</p>`);
    html.push('<h4>What we should do next</h4>');
    html.push(`<p>${escapeHtml(item.next_step)}</p>`);
    html.push('<h4>Confidence</h4>');
    html.push(`<p>${escapeHtml(item.confidence)}</p>`);
    html.push('</article>');
  }
  html.push('</section>');
  html.push('<section>');
  html.push('<h2>Meaningful comparison tests</h2>');
  for (const item of data.comparison_tests) {
    html.push('<article>');
    html.push(`<h3>${escapeHtml(item.title)}</h3>`);
    html.push('<h4>What we found</h4>');
    html.push(`<p>${escapeHtml(item.finding_statement)}</p>`);
    html.push('<h4>Decision criteria for the next round</h4>');
    html.push(`<p>${escapeHtml(item.decision_criteria)}</p>`);
    html.push('<h4>What we should do next</h4>');
    html.push(`<p>${escapeHtml(item.next_step)}</p>`);
    html.push('<h4>Confidence</h4>');
    html.push(`<p>${escapeHtml(item.confidence)}</p>`);
    html.push('</article>');
  }
  html.push('</section>');
  html.push('<section>');
  html.push('<h2>What is still unresolved</h2>');
  html.push('<ul>');
  for (const item of data.unresolved_questions) {
    html.push(`<li>${escapeHtml(item)}</li>`);
  }
  html.push('</ul>');
  html.push('</section>');
  html.push('<section>');
  html.push('<h2>What we should do next</h2>');
  html.push('<ul>');
  for (const item of data.next_actions) {
    html.push(`<li>${escapeHtml(item)}</li>`);
  }
  html.push('</ul>');
  html.push('</section>');
  html.push('<section>');
  html.push('<h2>Note</h2>');
  html.push(`<p>${escapeHtml(data.note)}</p>`);
  html.push('</section>');
  html.push('</body></html>');
  return html.join('');
}

const md = renderMarkdown(brief);
const html = renderHtml(brief);
const json = JSON.stringify(brief, null, 2);

const outputs = [
  ['newsletter/default.json', json],
  ['newsletter/default.md', md],
  ['newsletter/default.html', html],
  ['api/newsletter-default.json', json],
  ['api/newsletter-default.md', md],
  ['status-stage2-default.json', JSON.stringify({ generated_at: generatedAt, title: brief.title }, null, 2)],
];

for (const [rel, content] of outputs) {
  writeText(path.join(publishRoot, rel), content);
}

console.log(JSON.stringify({
  title: brief.title,
  generated_at: generatedAt,
  outputs: outputs.map(([rel]) => path.join(publishRoot, rel)),
}, null, 2));
