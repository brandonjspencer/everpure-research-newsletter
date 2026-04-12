#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function cleanLine(line) {
  if (!line) return '';
  return String(line).replace(/\s+/g, ' ').replace(/[●•]+/g, ' • ').trim();
}
function normalizeText(s) {
  return cleanLine(s)
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, ' ')
    .replace(/\b(the|a|an|and|or|to|for|of|in|on|with|from|by|this|that|one|round|pass)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const BOILERPLATE = [
  /ux metrics/i,/success/i,/frequency/i,/audiences/i,/technical leader/i,/infrastructure owner/i,
  /front-end/i,/full stack/i,/expectations/i,/satisfaction/i,/intent/i,/effort/i,/supported by \d+ linked findings deck/i,
  /^captured in the /i,/a rundown of the testing/i,/executive brief/i,/pure storage executive brief/i,/everpure executive brief/i
];
const STRONG = [
  /%/,
  /\b(v1|v2|v3|r2|r3|baseline|comparison|variant|winner|won)\b/i,
  /\b(prefer|preferred|stronger|weaker|clearer|confus|comprehension|sentiment|engagement|conversion|discoverability|hesitation|drop|increase|decrease|improve|improved|decline|reduced|boost|lift)\b/i,
  /\bfrom\b.+\bto\b/i,
];
function isBoilerplate(line) {
  const s = cleanLine(line);
  return !s || BOILERPLATE.some(r => r.test(s));
}
function scoreLine(line) {
  const s = cleanLine(line);
  if (!s) return -10;
  let score = 0;
  if (isBoilerplate(s)) score -= 8;
  if (s.length >= 25 && s.length <= 220) score += 1;
  if (/\d/.test(s)) score += 1;
  STRONG.forEach(r => { if (r.test(s)) score += 3; });
  if (/what we should do next/i.test(s)) score -= 2;
  return score;
}
function uniq(arr) {
  return [...new Set((arr || []).map(cleanLine).filter(Boolean))];
}
function collectLines(item) {
  const maybe = [
    item.matched_evidence_lines,
    item.matchedEvidenceLines,
    item.raw_finding_excerpts,
    item.rawFindingExcerpts,
    item.clean_supporting_signals,
    item.cleanSupportingSignals,
    item.supporting_signals,
    item.supportingSignals,
    item.key_numbers,
    item.keyNumbers,
    item.matched_key_numbers,
    item.matchedKeyNumbers,
  ];
  const out = [];
  maybe.forEach(arr => Array.isArray(arr) && arr.forEach(v => out.push(v)));
  [item.finding_statement,item.findingStatement,item.evidence_snapshot,item.evidenceSnapshot,item.matched_summary_hint,item.matchedSummaryHint].forEach(v => { if (typeof v === 'string') out.push(v); });
  return uniq(out);
}
function bestProof(lines) {
  const ranked = uniq(lines)
    .map(line => ({ line, score: scoreLine(line) }))
    .filter(x => !isBoilerplate(x.line))
    .sort((a,b) => b.score - a.score);
  return ranked[0] || null;
}
function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.concepts)) return payload.concepts;
  if (payload && Array.isArray(payload.records)) return payload.records;
  return [];
}
function conceptTitle(item) {
  return item.concept_title || item.conceptTitle || item.headline || item.title || item.workstream || item.theme || item.name || 'Untitled concept';
}
function sourceRefs(item) {
  return item.source_refs || item.sourceRefs || [];
}
function collapseTitle(title) {
  let t = cleanLine(title);
  t = t.replace(/\b(page|pages)\b/ig, '');
  t = t.replace(/\b(homepage|landing page|landing|pathfinder|internal)\b/ig, '$&');
  if (/knowledge portal/i.test(t)) return 'Knowledge Portal';
  if (/events/i.test(t)) return 'Events Page';
  return t.replace(/\s+/g, ' ').trim();
}
function buildConcept(item) {
  const title = conceptTitle(item);
  const refs = sourceRefs(item);
  const proof = bestProof(collectLines(item));
  const keyNums = uniq(collectLines(item).filter(l => /%|\bfrom\b.+\bto\b|increase|decrease|drop|boost|lift|decline|improv/i.test(l))).slice(0, 2);
  const weeks = [...new Set(refs.map(r => r.week_date).filter(Boolean))];
  const finding = proof && proof.score >= 5
    ? proof.line
    : `${title} is active in the current 30-day window, but the available notes are still stronger on direction than on proof.`;
  const nextStep = cleanLine(item.next_step_from_clean_evidence || item.nextStepFromCleanEvidence || item.rule_based_next_step || item.ruleBasedNextStep || item.next_step || item.nextStep) ||
    `Run one tighter follow-up round on ${title.toLowerCase()}, define the decision criteria in advance, and use the next pass to confirm whether the direction is ready to ship or still needs another iteration.`;
  const confidence = cleanLine(item.rule_based_confidence || item.ruleBasedConfidence || item.confidence_level || item.confidenceLevel) || (proof && proof.score >= 7 ? 'medium' : 'low');
  const decision = cleanLine(item.rule_based_status || item.ruleBasedStatus || item.decision_status || item.decisionStatus) || (proof && proof.score >= 7 ? 'iterate' : 'watch');
  const support = [];
  if (proof && proof.score >= 5) support.push(proof.line);
  if (weeks.length) support.push(`Seen in ${weeks.length} weekly update${weeks.length === 1 ? '' : 's'} (${weeks.join(', ')}).`);
  return {
    headline: title,
    collapsed_headline: collapseTitle(title),
    finding_statement: finding,
    proof_point: proof && proof.score >= 5 ? proof.line : '',
    evidence_snapshot: support.join(' '),
    supporting_signals: uniq(support),
    key_numbers: keyNums,
    next_step: nextStep,
    decision_status: decision,
    confidence_level: confidence,
    source_refs: refs,
    _score: proof ? proof.score : -10,
  };
}
function dedupeActions(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleanLine(item));
  }
  return out;
}
function mergeInMotion(items) {
  const out = [];
  const seen = new Map();
  for (const item of items || []) {
    const titleKey = normalizeText(item.collapsed_headline || item.workstream || item.headline || item.title);
    const actionKey = normalizeText(item.next_step || '');
    const proofKey = normalizeText(item.proof_point || item.finding_statement || '');
    const mergedKey = `${titleKey}||${actionKey || proofKey}`;
    if (seen.has(mergedKey)) continue;
    if (/knowledge portal/.test(titleKey)) {
      const existingIdx = out.findIndex(x => /knowledge portal/i.test(x.workstream || x.headline || ''));
      if (existingIdx >= 0) {
        const existing = out[existingIdx];
        existing.workstream = 'Knowledge Portal';
        existing.finding_statement = existing.finding_statement || item.finding_statement;
        existing.evidence_snapshot = uniq([existing.evidence_snapshot, item.evidence_snapshot]).join(' ');
        existing.supporting_signals = uniq([...(existing.supporting_signals || []), ...(item.supporting_signals || [])]);
        existing.key_numbers = uniq([...(existing.key_numbers || []), ...(item.key_numbers || [])]);
        existing.source_refs = [...(existing.source_refs || []), ...(item.source_refs || [])];
        continue;
      }
    }
    seen.set(mergedKey, true);
    out.push({
      workstream: item.collapsed_headline || item.workstream || item.headline || item.title,
      finding_statement: item.finding_statement,
      evidence_snapshot: item.evidence_snapshot,
      supporting_signals: item.supporting_signals,
      key_numbers: item.key_numbers,
      next_step: item.next_step,
      mentions: item.source_refs?.length || item.mentions || 0,
      decision_status: item.decision_status || 'watch',
      confidence_level: item.confidence_level || 'low',
      source_refs: item.source_refs || [],
    });
  }
  return out;
}
function renderMarkdown(news) {
  const lines = [];
  lines.push(`# ${news.title}`,'');
  lines.push(`**Window:** ${news.window?.label || '30d'} (${news.window?.since || ''} to ${news.window?.until || ''})  `);
  lines.push(`**Audience:** ${news.audience}  `);
  lines.push(`**Tone:** ${news.tone}`,'');
  lines.push('## Executive summary','', news.executive_summary || '', '');
  lines.push('## What the research surfaced','');
  (news.sections?.top_findings || []).forEach(item => {
    lines.push(`### ${item.headline}`,'');
    lines.push('**What we found**  ', item.finding_statement || '', '');
    if (item.proof_point) {
      lines.push('**Proof point**  ', item.proof_point, '');
    }
    if ((item.key_numbers || []).length) {
      lines.push('**Key evidence**  ');
      item.key_numbers.forEach(k => lines.push(`- ${k}`));
      lines.push('');
    }
    lines.push('**What we should do next**  ', item.next_step || '', '');
    lines.push('**Confidence**  ', `${item.confidence_level || 'low'} confidence • ${item.decision_status || 'watch'}`, '');
  });
  lines.push('## Meaningful comparison tests','');
  (news.sections?.comparison_tests || []).forEach(item => {
    lines.push(`### ${item.headline || item.test || 'Comparison test'}`,'');
    if (item.finding_statement) lines.push(item.finding_statement,'');
    if (item.proof_point) lines.push('**Proof point**  ', item.proof_point,'');
    if (item.next_step) lines.push('**What we should do next**  ', item.next_step,'');
  });
  lines.push('## What is still in motion','');
  (news.sections?.in_progress || []).forEach(item => lines.push(`- **${item.workstream || item.headline || item.title}** — ${item.next_step || item.finding_statement || ''}`));
  lines.push('','## What we should do next','');
  (news.next_actions || []).forEach(item => lines.push(`- ${item}`));
  lines.push('');
  return lines.join('\n');
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
    </section>`).join('\n');
  const comparisons = (news.sections?.comparison_tests || []).map(item => `
    <section class="card compact">
      <h3>${esc(item.headline || item.test || 'Comparison test')}</h3>
      ${item.finding_statement ? `<p>${esc(item.finding_statement)}</p>` : ''}
      ${item.proof_point ? `<p><strong>Proof point</strong><br>${esc(item.proof_point)}</p>` : ''}
      ${item.next_step ? `<p><strong>What we should do next</strong><br>${esc(item.next_step)}</p>` : ''}
    </section>`).join('\n');
  const inMotion = (news.sections?.in_progress || []).map(item => `<li><strong>${esc(item.workstream || item.headline || item.title)}</strong> — ${esc(item.next_step || item.finding_statement || '')}</li>`).join('');
  const nextActions = (news.next_actions || []).map(item => `<li>${esc(item)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(news.title)}</title><style>
body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.55;color:#111827}h1,h2,h3{line-height:1.2}.meta{color:#4b5563;margin-bottom:24px}.card{border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;margin:16px 0}.compact{padding:14px 18px}ul{padding-left:20px}a{color:#2563eb}</style></head><body>
<p><a href="../">Back to homepage</a></p>
<h1>${esc(news.title)}</h1>
<p class="meta">Window: ${esc(news.window?.label)} (${esc(news.window?.since)} to ${esc(news.window?.until)}) • Audience: ${esc(news.audience)} • Tone: ${esc(news.tone)}</p>
<h2>Executive summary</h2><p>${esc(news.executive_summary || '')}</p>
<h2>What the research surfaced</h2>${top}
<h2>Meaningful comparison tests</h2>${comparisons || '<p>No comparison tests were strong enough to promote this month.</p>'}
<h2>What is still in motion</h2><ul>${inMotion}</ul>
<h2>What we should do next</h2><ul>${nextActions}</ul>
</body></html>`;
}

function main() {
  const root = process.argv[2];
  if (!root) { console.error('Usage: node refine_default_newsletter.js <publish_dir>'); process.exit(1); }
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
  const concepts = asArray(readJson(conceptPath)).map(buildConcept);
  const strong = concepts.filter(c => c._score >= 5).sort((a,b)=>b._score-a._score).slice(0, 3);
  const watchRaw = concepts.filter(c => c._score < 5).sort((a,b)=>(b.source_refs?.length||0)-(a.source_refs?.length||0)).slice(0, 8);
  const watch = mergeInMotion(watchRaw).slice(0, 5);
  const comparison = concepts.filter(c => /v1|v2|v3|r2|r3|baseline|comparison|variant/i.test(`${c.headline} ${c.finding_statement} ${c.evidence_snapshot}`)).sort((a,b)=>b._score-a._score).slice(0, 4).map(c => ({
    headline: c.headline, finding_statement: c.finding_statement, proof_point: c.proof_point, next_step: c.next_step,
    decision_status: c.decision_status, confidence_level: c.confidence_level, source_refs: c.source_refs,
  }));
  const nextActions = dedupeActions(strong.map(x => x.next_step).concat(comparison.map(x => x.next_step)));
  current.executive_summary = strong.length
    ? `The clearest month-to-date proof points are clustered around ${strong.map(t => t.headline.toLowerCase()).join(', ')}, and the strongest recommendation is still to iterate deliberately rather than ship broadly.`
    : 'The current 30-day window is more useful for prioritizing what to test next than for making a broad rollout decision.';
  current.section_titles = current.section_titles || {};
  current.section_titles.top_findings = 'What the research surfaced';
  current.section_titles.in_progress = 'What is still in motion';
  current.section_titles.comparison_tests = 'Meaningful comparison tests';
  current.sections = current.sections || {};
  current.sections.top_findings = strong.map(c => ({ headline: c.headline, finding_statement: c.finding_statement, proof_point: c.proof_point, evidence_snapshot: c.evidence_snapshot, supporting_signals: c.supporting_signals, key_numbers: c.key_numbers, next_step: c.next_step, decision_status: c.decision_status, confidence_level: c.confidence_level, source_refs: c.source_refs }));
  current.sections.comparison_tests = comparison;
  current.sections.in_progress = watch;
  delete current.sections.deck_backed_evidence;
  delete current.sections.deckBackedEvidence;
  delete current.sections.editorial_recommendations;
  delete current.sections.editorialRecommendations;
  delete current.editorial_recommendations;
  delete current.editorialRecommendations;
  current.next_actions = nextActions;
  current.generated_at = new Date().toISOString();
  writeJson(defaultJsonPath, current);
  ensureDir(path.join(newsletterDir, 'default.md'));
  fs.writeFileSync(path.join(newsletterDir, 'default.md'), renderMarkdown(current));
  fs.writeFileSync(path.join(newsletterDir, 'default.html'), renderHtml(current));
  console.log(JSON.stringify({ rewritten: ['default.json','default.md','default.html'], promoted_count: current.sections.top_findings.length, comparison_count: comparison.length, in_motion_count: watch.length, next_action_count: nextActions.length }, null, 2));
}
main();
