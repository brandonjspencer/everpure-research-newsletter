#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.resolve(process.cwd(), 'publish');
const dataDir = path.join(root, 'data');

function readJson(name, fallback = null) {
  const fp = path.join(dataDir, name);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  const fp = path.join(dataDir, name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function flattenText(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.push(normalize(obj));
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) flattenText(item, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (['raw_bytes', 'binary', 'buffer'].includes(k)) continue;
      flattenText(v, out);
    }
  }
  return out;
}

function flattenDeckContent(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  for (const key of ['items', 'decks', 'deck_content', 'deckContents', 'entries']) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr || []) {
    const v = normalize(raw);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function titleTokens(title) {
  const stop = new Set(['the','and','for','with','from','this','that','page','pages','flow','work','testing','concept','concepts','design','ux','review','analysis']);
  return uniq(
    normalize(title)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t && t.length >= 3 && !stop.has(t))
  );
}

function numbers(text) {
  return uniq(normalize(text).match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d+(?:\.\d+)?\b/gi) || []);
}

const boilerplatePatterns = [
  /ux metrics/i,
  /frequency audiences/i,
  /technical leader/i,
  /front-end & full stack/i,
  /ai infrastructure and technical leaders/i,
  /global\)/i,
  /all rights reserved/i,
  /copyright/i,
  /confidential/i,
  /this presentation/i,
  /for internal use/i,
  /^●/,
  /^\.\.\.$/
];

function looksBoilerplate(text) {
  const t = normalize(text);
  if (!t) return true;
  if (t.length < 18) return true;
  if (boilerplatePatterns.some(rx => rx.test(t))) return true;
  if ((t.match(/●/g) || []).length >= 3) return true;
  return false;
}

function sentenceSplit(text) {
  return normalize(text)
    .split(/(?<=[.!?])\s+/)
    .map(normalize)
    .filter(Boolean);
}

function tokenOverlap(text, tokens) {
  const low = normalize(text).toLowerCase();
  let count = 0;
  for (const tok of tokens) if (tok && low.includes(tok)) count += 1;
  return count;
}

function signalScore(text, concept) {
  const t = normalize(text);
  if (!t) return -999;
  let score = 0;
  const low = t.toLowerCase();
  if (looksBoilerplate(t)) score -= 12;
  if (concept.concept_id && new RegExp(`\\b${concept.concept_id}\\b`).test(t)) score += 8;
  const overlap = tokenOverlap(t, concept.tokens || []);
  score += overlap * 3;
  if (/\b(v1|v2|r2|r3|baseline|variation|compare|comparison|preferred|winner|winning)\b/i.test(t)) score += 4;
  if (/\b(increase|decrease|drop|lift|uplift|improved|reduced|reduction|more|less|better|worse)\b/i.test(t)) score += 3;
  if (/\b(comprehension|sentiment|engagement|conversion|clarity|discoverability|confidence|success|preference)\b/i.test(t)) score += 4;
  if (/\b(should|recommend|next|iterate|ship|retest|hold|narrow|focus)\b/i.test(t)) score += 1;
  if (numbers(t).length) score += 4;
  if (t.length < 24) score -= 2;
  return score;
}

function rankLines(lines, concept) {
  const ranked = [];
  for (const line of uniq(lines)) {
    const score = signalScore(line, concept);
    if (score <= 0) continue;
    ranked.push({ text: line, score, numbers: numbers(line) });
  }
  ranked.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return ranked;
}

function packWindow(packs) {
  if (Array.isArray(packs)) return { packs };
  return packs || { packs: [] };
}

function inferSummary(concept, ranked) {
  if (!ranked.length) {
    return `${concept.concept_display} remains an active concept area, but the current evidence is still too thin or too generic to support a strong finding statement.`;
  }
  const best = ranked[0].text;
  if (/\b(preferred|winner|winning|better|clearer|more engaging|more credible)\b/i.test(best)) {
    return `${concept.concept_display} produced a directional preference signal. The strongest matched evidence suggests one option is emerging as clearer or stronger, but the concept still needs a tightly scoped follow-up before rollout.`;
  }
  if (/\b(drop|decrease|reduced|worse|lower)\b/i.test(best)) {
    return `${concept.concept_display} appears to be surfacing a negative signal in the current evidence, which points to another iteration rather than a ship decision.`;
  }
  if (/\b(increase|improved|lift|uplift|higher)\b/i.test(best)) {
    return `${concept.concept_display} shows a positive directional signal in the current evidence, but still needs confirmation that the improvement is tied to the intended change.`;
  }
  if (/\b(comprehension|sentiment|engagement|clarity|discoverability)\b/i.test(best)) {
    return `${concept.concept_display} is surfacing a meaningful signal around user understanding, confidence, or navigation clarity. The current evidence is more useful for deciding the next iteration than for declaring the work finished.`;
  }
  return `${concept.concept_display} is active in the current window and now has concept-matched evidence that should be used to tighten the next round of iteration.`;
}

function inferNextStep(concept, ranked) {
  if (!ranked.length) return 'Narrow the next round to one or two concrete choices and collect stronger concept-specific proof points.';
  const best = ranked[0].text.toLowerCase();
  if (/\b(v1|v2|baseline|variation|comparison|preferred|winner)\b/.test(best)) {
    return 'Reduce the concept to a tighter comparison, define the success criterion up front, and use the next round to produce a clear preferred option.';
  }
  if (/\b(comprehension|clarity|messaging|label|taxonomy|discoverability|navigation)\b/.test(best)) {
    return 'Use the current evidence to simplify the message, label, or structure, then validate that the next pass improves comprehension and wayfinding.';
  }
  if (/\b(engagement|conversion|success|sentiment)\b/.test(best)) {
    return 'Keep the strongest direction, remove the weakest competing elements, and validate the outcome on the primary engagement or conversion signal.';
  }
  return 'Use the current evidence to narrow scope and define one specific next iteration rather than broadening the concept area.';
}

function inferConfidence(ranked) {
  if (!ranked.length) return 'low';
  const best = ranked[0];
  if (best.score >= 16 && best.numbers.length) return 'moderate';
  if (best.score >= 11) return 'moderate';
  return 'low';
}

function inferDecision(ranked) {
  if (!ranked.length) return 'watch';
  const best = ranked[0].text.toLowerCase();
  if (/\b(preferred|winner|winning)\b/.test(best) && /\b\d{1,3}%\b/.test(best)) return 'iterate';
  if (/\b(drop|decrease|reduced|worse|lower)\b/.test(best)) return 'iterate';
  if (/\b(increase|improved|lift|uplift|higher)\b/.test(best)) return 'iterate';
  return 'watch';
}

function main() {
  const weeks = readJson('weeks.json', []);
  const packPayload = packWindow(readJson('evidence_packs_default_30d.json', { packs: [] }));
  const deckRaw = readJson('deck_content.json', readJson('deck-content.json', []));
  const deckItems = flattenDeckContent(deckRaw);

  const deckText = new Map();
  for (const item of deckItems) {
    const fileId = item.file_id || item.deck_file_id || item.id;
    if (!fileId) continue;
    const textBlob = uniq(flattenText(item)).join(' ');
    deckText.set(fileId, textBlob);
  }

  const conceptEvidence = [];
  for (const pack of packPayload.packs || []) {
    const concept = {
      concept_id: pack.concept_id || null,
      concept_title: pack.concept_title || '',
      concept_display: pack.concept_display || pack.concept_title || '',
      tokens: titleTokens(pack.concept_title || pack.concept_display || '')
    };

    const candidateLines = [];
    const weekSet = new Set(pack.weeks_seen || []);
    const deckSet = new Set(pack.deck_refs || []);

    for (const excerpt of pack.raw_finding_excerpts || []) candidateLines.push(excerpt);
    for (const sig of pack.clean_supporting_signals || []) candidateLines.push(sig);
    for (const sig of pack.supporting_signals || []) candidateLines.push(sig);
    for (const sig of pack.key_synthesis_signals || []) candidateLines.push(sig);

    for (const ref of pack.source_refs || []) {
      if (ref.text) candidateLines.push(ref.text);
      if (ref.week_date && weekSet.has(ref.week_date)) {
        const week = (weeks || []).find(w => w.week_date === ref.week_date && w.record_id === ref.record_id) || (weeks || []).find(w => w.week_date === ref.week_date);
        if (week) {
          candidateLines.push(JSON.stringify(week.content_groups || {}));
        }
      }
    }

    for (const fileId of deckSet) {
      if (!deckText.has(fileId)) continue;
      const text = deckText.get(fileId);
      for (const sentence of sentenceSplit(text)) candidateLines.push(sentence);
    }

    const ranked = rankLines(candidateLines, concept).slice(0, 8);
    const matchedNumbers = uniq(ranked.flatMap(r => r.numbers)).slice(0, 6);
    const matchedSignals = ranked.map(r => r.text).slice(0, 5);

    conceptEvidence.push({
      concept_key: pack.concept_key,
      concept_id: concept.concept_id,
      concept_title: concept.concept_title,
      concept_display: concept.concept_display,
      weeks_seen: pack.weeks_seen || [],
      deck_refs: pack.deck_refs || [],
      source_refs: (pack.source_refs || []).slice(0, 12),
      matched_evidence: ranked,
      clean_supporting_signals: matchedSignals,
      clean_key_numbers: matchedNumbers,
      matched_summary: inferSummary(concept, ranked),
      matched_next_step: inferNextStep(concept, ranked),
      matched_confidence: inferConfidence(ranked),
      matched_decision_status: inferDecision(ranked),
      evidence_strength_score: ranked.length ? ranked[0].score : 0,
      evidence_found: ranked.length > 0
    });
  }

  conceptEvidence.sort((a,b) => b.evidence_strength_score - a.evidence_strength_score || (b.weeks_seen || []).length - (a.weeks_seen || []).length || String(a.concept_display).localeCompare(String(b.concept_display)));

  const payload = {
    generated_at: new Date().toISOString(),
    window: { days: 30 },
    concept_count: conceptEvidence.length,
    with_evidence_count: conceptEvidence.filter(c => c.evidence_found).length,
    concepts: conceptEvidence
  };

  writeJson('concept_evidence_default_30d.json', payload);
  writeJson('concept-evidence-default-30d.json', payload);
  console.log(JSON.stringify({
    concept_count: payload.concept_count,
    with_evidence_count: payload.with_evidence_count,
    outputs: [
      path.join(dataDir, 'concept_evidence_default_30d.json'),
      path.join(dataDir, 'concept-evidence-default-30d.json')
    ]
  }, null, 2));
}

main();
