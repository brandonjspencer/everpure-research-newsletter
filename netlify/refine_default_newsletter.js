#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

const BOILERPLATE = [
  /ux metrics/i,
  /frequency/i,
  /audiences/i,
  /technical leader/i,
  /infrastructure owner/i,
  /front-end/i,
  /full stack/i,
  /expectations/i,
  /satisfaction/i,
  /intent/i,
  /effort/i,
  /success ●/i,
  /frequency audiences/i,
];

const GOOD_SIGNAL = [
  /%/,
  /\b(v1|v2|v3|r2|r3|baseline|comparison|variant)\b/i,
  /\b(prefer|preferred|stronger|weaker|clearer|confus|comprehension|sentiment|engagement|conversion|discoverability|hesitation|drop|increase|decrease|improve|improved|decline|reduced|boost|lift)\b/i,
  /\bfrom\b.+\bto\b/i,
  /\bwon\b|\bwinner\b/i,
];

function cleanLine(line) {
  if (!line) return '';
  let s = String(line).replace(/\s+/g, ' ').trim();
  s = s.replace(/[●•]+/g, ' • ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
function isBoilerplate(line) {
  const s = cleanLine(line);
  return !s || BOILERPLATE.some(r => r.test(s));
}
function scoreLine(line) {
  const s = cleanLine(line);
  if (!s) return -10;
  let score = 0;
  if (isBoilerplate(s)) score -= 6;
  if (s.length < 25) score -= 2;
  if (s.length > 240) score -= 1;
  for (const r of GOOD_SIGNAL) if (r.test(s)) score += 3;
  if (/\d/.test(s)) score += 1;
  if (/^captured in the /i.test(s)) score -= 1;
  if (/supported by \d+ linked findings deck/i.test(s)) score -= 1;
  return score;
}
function bestLine(lines) {
  const ranked = (lines || [])
    .map(cleanLine)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map(line => ({ line, score: scoreLine(line) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}
function collectLines(obj) {
  const candidates = [];
  const maybeArrays = [
    obj.matched_evidence_lines,
    obj.matchedEvidenceLines,
    obj.raw_finding_excerpts,
    obj.rawFindingExcerpts,
    obj.clean_supporting_signals,
    obj.cleanSupportingSignals,
    obj.supporting_signals,
    obj.supportingSignals,
    obj.key_numbers,
    obj.keyNumbers,
  ];
  maybeArrays.forEach(arr => Array.isArray(arr) && arr.forEach(v => candidates.push(v)));
  [
    obj.finding_statement,
    obj.findingStatement,
    obj.evidence_snapshot,
    obj.evidenceSnapshot,
    obj.matched_summary_hint,
    obj.matchedSummaryHint,
    obj.matched_next_step_hint,
    obj.matchedNextStepHint,
  ].forEach(v => { if (typeof v === 'string') candidates.push(v); });
  return candidates.map(cleanLine).filter(Boolean);
}
function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.concepts)) return payload.concepts;
  if (payload && Array.isArray(payload.records)) return payload.records;
  return [];
}
function conceptTitle(item) {
  return item.concept_title || item.conceptTitle || item.headline || item.workstream || item.title || item.theme || item.name || 'Untitled concept';
}
function conceptSourceLabel(item) {
  return item.source_label || item.sourceLabel || item.concept_id || item.conceptId || '';
}
function sourceRefs(item) {
  return item.source_refs || item.sourceRefs || [];
}
function nextStep(item, title) {
  const raw = item.next_step_from_clean_evidence || item.nextStepFromCleanEvidence || item.rule_based_next_step || item.ruleBasedNextStep || item.next_step || item.nextStep || '';
  const s = cleanLine(raw);
  if (s) return s;
  return `Run one tighter follow-up round on ${title.toLowerCase()}, define the decision criteria up front, and use the next pass to confirm whether the direction is ready to ship or still needs another iteration.`;
}
function confidence(item, proof) {
  const explicit = item.rule_based_confidence || item.ruleBasedConfidence || item.confidence_level || item.confidenceLevel || '';
  if (explicit) return explicit;
  if (proof && proof.score >= 6) return 'medium';
  return 'low';
}
function decision(item, proof) {
  const explicit = item.rule_based_status || item.ruleBasedStatus || item.decision_status || item.decisionStatus || '';
  if (explicit) return explicit;
  if (proof && proof.score >= 7) return 'iterate';
  return 'watch';
}
function hasStrongProof(item) {
  const proof = bestLine(collectLines(item));
  return proof && proof.score >= 4;
}
function buildFinding(item) {
  const title = conceptTitle(item);
  const proof = bestLine(collectLines(item));
  const refs = sourceRefs(item);
  const titleSlug = slugify(title);
  const summary = proof && proof.score >= 4
    ? proof.line
    : `${title} is active in the current 30-day window, but the available notes are still stronger on direction than on proof.`;
  const support = [];
  if (proof && proof.score >= 4) support.push(proof.line);
  if (Array.isArray(refs) && refs.length) {
    const weeks = [...new Set(refs.map(r => r.week_date).filter(Boolean))];
    if (weeks.length) support.push(`Seen in ${weeks.length} weekly update${weeks.length === 1 ? '' : 's'} (${weeks.join(', ')}).`);
    const deckCount = [...new Set(refs.map(r => r.deck_id).filter(Boolean))].length;
    if (deckCount) support.push(`Backed by ${deckCount} linked findings deck${deckCount === 1 ? '' : 's'}.`);
  }
  const keyNums = collectLines(item)
    .filter(l => !isBoilerplate(l))
    .filter(l => /%|\bfrom\b.+\bto\b|increase|decrease|drop|boost|lift|decline|improv/i.test(l))
    .slice(0, 2);
  return {
    headline: title,
    finding_statement: summary,
    proof_point: proof && proof.score >= 4 ? proof.line : '',
    evidence_snapshot: support.join(' '),
    supporting_signals: support.slice(0, 3),
    key_numbers: keyNums,
    next_step: nextStep(item, title),
    decision_status: decision(item, proof),
    confidence_level: confidence(item, proof),
    source_refs: refs,
    source_label: conceptSourceLabel(item),
    _proof_score: proof ? proof.score : -10,
    _slug: titleSlug,
  };
}

function renderMarkdown(news) {
  const lines = [];
  lines.push(`# ${news.title}`);
  lines.push('');
  lines.push(`**Window:** ${news.window?.label || '30d'} (${news.window?.since || ''} to ${news.window?.until || ''})  `);
  lines.push(`**Audience:** ${news.audience}  `);
  lines.push(`**Tone:** ${news.tone}`);
  lines.push('');
  lines.push('## Executive summary');
  lines.push('');
  lines.push(news.executive_summary || '');
  lines.push('');
  lines.push('## What the research surfaced');
  lines.push('');
  (news.sections?.top_findings || []).forEach(item => {
    lines.push(`### ${item.headline}`);
    lines.push('');
    lines.push(`**What we found**  `);
    lines.push(item.finding_statement || '');
    lines.push('');
    if (item.proof_point) {
      lines.push(`**Proof point**  `);
      lines.push(item.proof_point);
      lines.push('');
    }
    if ((item.key_numbers || []).length) {
      lines.push(`**Key evidence**  `);
      item.key_numbers.forEach(k => lines.push(`- ${k}`));
      lines.push('');
    }
    lines.push(`**What we should do next**  `);
    lines.push(item.next_step || '');
    lines.push('');
    lines.push(`**Confidence**  `);
    lines.push(`${item.confidence_level || 'low'} confidence • ${item.decision_status || 'watch'}`);
    lines.push('');
  });
  lines.push('## Meaningful comparison tests');
  lines.push('');
  (news.sections?.comparison_tests || []).forEach(item => {
    lines.push(`### ${item.headline || item.test || 'Comparison test'}`);
    lines.push('');
    if (item.finding_statement) lines.push(item.finding_statement + '\n');
    if (item.proof_point) lines.push(`**Proof point**  \n${item.proof_point}\n`);
    if (item.next_step) lines.push(`**What we should do next**  \n${item.next_step}\n`);
  });
  lines.push('## What is still in motion');
  lines.push('');
  (news.sections?.in_progress || []).forEach(item => {
    lines.push(`- **${item.workstream || item.headline || item.title}** — ${item.next_step || item.finding_statement || ''}`);
  });
  lines.push('');
  lines.push('## What we should do next');
  lines.push('');
  (news.next_actions || []).forEach(item => {
    lines.push(`- ${item}`);
  });
  lines.push('');
  return lines.join('\n');
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderHtml(news) {
  const top = (news.sections?.top_findings || []).map(item => `
    <section class="card">
      <h3>${esc(item.headline)}</h3>
      <p><strong>What we found</strong><br>${esc(item.finding_statement)}</p>
      ${item.proof_point ? `<p><strong>Proof point</strong><br>${esc(item.proof_point)}</p>` : ''}
      ${(item.key_numbers || []).length ? `<p><strong>Key evidence</strong></p><ul>${item.key_numbers.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
      <p><strong>What we should do next</strong><br>${esc(item.next_step)}</p>
      <p><strong>Confidence</strong><br>${esc(item.confidence_level)} confidence • ${esc(item.decision_status)}</p>
    </section>
  `).join('\n');
  const inMotion = (news.sections?.in_progress || []).map(item => `<li><strong>${esc(item.workstream || item.headline || item.title)}</strong> — ${esc(item.next_step || item.finding_statement || '')}</li>`).join('');
  const nextActions = (news.next_actions || []).map(item => `<li>${esc(item)}</li>`).join('');
  const comparisons = (news.sections?.comparison_tests || []).map(item => `
    <section class="card compact">
      <h3>${esc(item.headline || item.test || 'Comparison test')}</h3>
      ${item.finding_statement ? `<p>${esc(item.finding_statement)}</p>` : ''}
      ${item.proof_point ? `<p><strong>Proof point</strong><br>${esc(item.proof_point)}</p>` : ''}
      ${item.next_step ? `<p><strong>What we should do next</strong><br>${esc(item.next_step)}</p>` : ''}
    </section>
  `).join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(news.title)}</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.55;color:#111827}
h1,h2,h3{line-height:1.2} .meta{color:#4b5563;margin-bottom:24px}.card{border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin:16px 0}.compact{padding:14px 18px} ul{padding-left:20px} a{color:#2563eb}
</style>
</head>
<body>
<p><a href="../">Back to homepage</a></p>
<h1>${esc(news.title)}</h1>
<p class="meta">Window: ${esc(news.window?.label)} (${esc(news.window?.since)} to ${esc(news.window?.until)}) • Audience: ${esc(news.audience)} • Tone: ${esc(news.tone)}</p>
<h2>Executive summary</h2>
<p>${esc(news.executive_summary || '')}</p>
<h2>What the research surfaced</h2>
${top}
<h2>Meaningful comparison tests</h2>
${comparisons || '<p>No comparison tests were strong enough to promote this month.</p>'}
<h2>What is still in motion</h2>
<ul>${inMotion}</ul>
<h2>What we should do next</h2>
<ul>${nextActions}</ul>
</body>
</html>`;
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: node refine_default_newsletter.js <publish_dir>');
    process.exit(1);
  }
  const dataDir = path.join(root, 'data');
  const newsletterDir = path.join(root, 'newsletter');
  const defaultJsonPath = path.join(newsletterDir, 'default.json');
  const conceptPath = exists(path.join(dataDir, 'concept-evidence-default-30d.json'))
    ? path.join(dataDir, 'concept-evidence-default-30d.json')
    : path.join(dataDir, 'concept_evidence_default_30d.json');

  if (!exists(defaultJsonPath) || !exists(conceptPath)) {
    console.error('Missing default.json or concept evidence file');
    process.exit(1);
  }

  const current = readJson(defaultJsonPath);
  const conceptPayload = readJson(conceptPath);
  const concepts = extractItems(conceptPayload).map(buildFinding);

  const strong = concepts.filter(c => c._proof_score >= 4).sort((a,b)=>b._proof_score-a._proof_score).slice(0,3);
  const watch = concepts.filter(c => c._proof_score < 4).sort((a,b)=> (b.source_refs?.length||0) - (a.source_refs?.length||0)).slice(0,5).map(c => ({
    workstream: c.headline,
    finding_statement: c.finding_statement,
    evidence_snapshot: c.evidence_snapshot,
    supporting_signals: c.supporting_signals,
    key_numbers: c.key_numbers,
    next_step: c.next_step,
    mentions: c.source_refs?.length || 0,
    decision_status: c.decision_status || 'watch',
    confidence_level: c.confidence_level || 'low',
    source_refs: c.source_refs,
    source_label: c.source_label,
  }));

  const comparison = concepts.filter(c => /v1|v2|v3|r2|r3|baseline|comparison|variant/i.test((c.headline||'') + ' ' + (c.finding_statement||'') + ' ' + (c.evidence_snapshot||'')))
    .sort((a,b)=>b._proof_score-a._proof_score)
    .slice(0,4)
    .map(c => ({
      headline: c.headline,
      finding_statement: c.finding_statement,
      proof_point: c.proof_point,
      next_step: c.next_step,
      decision_status: c.decision_status,
      confidence_level: c.confidence_level,
      source_refs: c.source_refs,
      source_label: c.source_label,
    }));

  const topFindings = strong.map(c => ({
    headline: c.headline,
    finding_statement: c.finding_statement,
    proof_point: c.proof_point,
    evidence_snapshot: c.evidence_snapshot,
    supporting_signals: c.supporting_signals,
    key_numbers: c.key_numbers,
    next_step: c.next_step,
    decision_status: c.decision_status,
    confidence_level: c.confidence_level,
    source_refs: c.source_refs,
    source_label: c.source_label,
  }));

  const summaryParts = [];
  if (topFindings.length) {
    summaryParts.push(`The clearest month-to-date proof points are clustered around ${topFindings.map(t => t.headline.toLowerCase()).join(', ')}, but the strongest recommendation is still to iterate rather than ship broadly.`);
  }
  if (watch.length) {
    summaryParts.push(`The rest of the 30-day window is more useful for prioritizing what to test next than for making a broad rollout decision.`);
  }

  current.executive_summary = summaryParts.join(' ');
  current.section_titles = current.section_titles || {};
  current.section_titles.top_findings = 'What the research surfaced';
  current.section_titles.in_progress = 'What is still in motion';
  current.section_titles.recurring_themes = 'Patterns worth paying attention to';
  current.section_titles.recommended_highlights = 'What to feature in the issue';
  current.decision_summary = {
    ship_ready_count: topFindings.filter(x => x.decision_status === 'ship').length,
    iterate_count: topFindings.filter(x => x.decision_status === 'iterate').length,
    watch_count: watch.length,
    comparison_test_count: comparison.length,
    note: 'Only concepts with concept-specific proof points are promoted into the lead findings section.'
  };
  current.sections = current.sections || {};
  current.sections.top_findings = topFindings;
  current.sections.comparison_tests = comparison;
  current.sections.in_progress = watch;
  current.next_actions = topFindings.map(x => x.next_step).filter(Boolean).slice(0,5);
  current.generated_at = new Date().toISOString();

  writeJson(defaultJsonPath, current);
  ensureDir(path.join(newsletterDir, 'default.md'));
  fs.writeFileSync(path.join(newsletterDir, 'default.md'), renderMarkdown(current));
  fs.writeFileSync(path.join(newsletterDir, 'default.html'), renderHtml(current));
  console.log(JSON.stringify({
    rewritten: ['default.json','default.md','default.html'],
    promoted_count: topFindings.length,
    comparison_count: comparison.length,
    in_motion_count: watch.length
  }, null, 2));
}

main();
