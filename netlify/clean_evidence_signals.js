#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.resolve(process.cwd(), 'publish');
const dataDir = path.join(root, 'data');

const files = [
  'evidence_packs.json',
  'evidence-packs.json',
  'evidence_packs_default_30d.json',
  'evidence-packs-default-30d.json',
];

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const value = normalize(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const BOILERPLATE_PATTERNS = [
  /^we have\s+(?:one|two|three|four|five|six|\d+)\s+new concept areas? to review for testing:?$/i,
  /^events page findings:?$/i,
  /^webinar landing page:?$/i,
  /^on deck$/i,
  /^view findings deck$/i,
  /^view concepts in figma$/i,
  /^research roundup audit$/i,
  /^📌\s*[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}$/,
  /^●/,
  /^…$/,
  /UX Metrics/i,
  /Frequency Audiences/i,
  /Technical leader/i,
  /AI Infrastructure and Technical Leaders/i,
  /Infrastructure Owner/i,
  /Front-end & Full Stack Developers/i,
  /Global\)/i,
  /US, UK, GR & FR/i,
  /Expectations/i,
  /Satisfaction/i,
  /Intent/i,
];

const BAD_TEXT_PATTERNS = [
  /HTTPError|Client Error|Forbidden for url|Traceback|Exception:/i,
  /sheets\.googleapis\.com|drive_csv_export/i,
  /\b(?:[A-Za-z0-9_-]{18,})\b/,
  /^https?:\/\//i,
];

const EVIDENCE_PATTERNS = [
  /\b\d{1,3}%\b/,
  /\b\d+(?:\.\d+)?x\b/i,
  /\b(increase|decrease|drop|dropped|lift|uplift|improved|improvement|decline|reduced|reduction|outperform|outperformed)\b/i,
  /\b(comprehension|sentiment|engagement|conversion|success|effort|clarity|clearer|credible|credibility|preference|preferred|trust|confidence|friction|findability|discoverability)\b/i,
  /\b(users?|participants?|visitors?|readers?|customers?)\b/i,
  /\b(understand|recognize|need|needs|hesitat|confus|live|watch live|assessment|workshop|business value|differentiat|platform story)\b/i,
  /\b(v1|v2|r2|r3|baseline|variation|compare|comparison|winner|winning)\b/i,
];

function isBoilerplate(value) {
  const text = normalize(value);
  if (!text) return true;
  if (text.length < 12) return true;
  if (BOILERPLATE_PATTERNS.some(rx => rx.test(text))) return true;
  if ((text.match(/●/g) || []).length >= 3) return true;
  return false;
}

function isBadText(value) {
  const text = normalize(value);
  if (!text) return true;
  if (BAD_TEXT_PATTERNS.some(rx => rx.test(text))) return true;
  return false;
}

function isPublicEvidence(value) {
  const text = normalize(value);
  if (isBoilerplate(text) || isBadText(text)) return false;
  if (text.length < 24 || text.length > 360) return false;
  return EVIDENCE_PATTERNS.some(rx => rx.test(text));
}

function scoreSignal(value) {
  const text = normalize(value);
  if (!isPublicEvidence(text)) return -20;
  let score = 0;
  for (const rx of EVIDENCE_PATTERNS) if (rx.test(text)) score += 2;
  if (/\b\d{1,3}%\b/.test(text)) score += 3;
  if (/\b(from|to|versus|vs\.?|compared)\b/i.test(text) && /\b\d{1,3}%\b/.test(text)) score += 2;
  if (/\b(users?|participants?|visitors?|readers?|customers?)\b/i.test(text)) score += 2;
  return score;
}

function cleanTitle(value) {
  let title = normalize(value)
    .replace(/^\d{2,4}\s*[-:–]\s*/, '')
    .replace(/\b\(in process\)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  title = title.replace(/\s*[-–:]\s*Exploring\b.*$/i, '');
  title = title.replace(/\s+Users?\s+(?:understand|recognize|need|are|can|cannot|don'?t|do not)\b.*$/i, '');
  title = title.replace(/\s+The biggest opportunity\b.*$/i, '');
  title = title.replace(/\s+Needs? to\b.*$/i, '');
  return title.replace(/\s*[:–-]\s*$/g, '').trim();
}

function deckIdsForPack(pack) {
  return new Set((pack.deck_refs || pack.deckRefs || []).map(normalize).filter(Boolean));
}

function externalRefAligned(pack, ref) {
  if (!ref || String(ref.group || '') !== 'external_research_evidence') return true;
  const deckIds = deckIdsForPack(pack);
  if (!deckIds.size) return false;
  const refDeck = normalize(ref.deck_file_id || ref.deck_id || ref.file_id || ref.deckFileId || ref.deckId);
  return refDeck && deckIds.has(refDeck);
}

function cleanArray(values, limit = 8) {
  return uniq(values)
    .filter(isPublicEvidence)
    .map(value => ({ value, score: scoreSignal(value) }))
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)
    .map(item => item.value)
    .slice(0, limit);
}

function extractNumbers(values) {
  return uniq((values || []).flatMap(value => normalize(value).match(/\b\d{1,3}%\b|\b\d+(?:\.\d+)?x\b/gi) || [])).slice(0, 8);
}

function shouldDropPack(pack) {
  const title = normalize(pack.concept_title || pack.concept_display || pack.concept_key || pack.title);
  if (!title) return true;
  if (isBoilerplate(title)) return true;
  if (/^we have\s+/i.test(title)) return true;
  return false;
}

function cleanSourceRefs(pack) {
  const refs = [];
  for (const ref of pack.source_refs || pack.sourceRefs || []) {
    if (!ref || typeof ref !== 'object') continue;
    if (!externalRefAligned(pack, ref)) continue;
    const text = normalize(ref.text || ref.label || '');
    if (String(ref.group || '') === 'external_research_evidence' && !isPublicEvidence(text)) continue;
    refs.push(ref);
  }
  return refs.slice(0, 14);
}

function cleanPack(pack) {
  const cleanedTitle = cleanTitle(pack.concept_title || pack.concept_display || pack.concept_key || pack.title);
  const sourceRefs = cleanSourceRefs(pack);
  const candidateSignals = [
    ...(pack.clean_supporting_signals || []),
    ...(pack.supporting_signals || []),
    ...(pack.key_synthesis_signals || []),
    ...(pack.evidence_snapshot_rule_based || []),
    ...(pack.raw_finding_excerpts || []),
    ...sourceRefs.map(ref => ref.text),
  ];
  const publicSignals = cleanArray(candidateSignals, 8);

  const externalRefs = (pack.external_evidence_refs || [])
    .filter(ref => {
      const deckIds = deckIdsForPack(pack);
      if (!deckIds.size) return false;
      const refDeck = normalize(ref.deck_id || ref.deck_file_id || ref.deckId || ref.deckFileId);
      return refDeck && deckIds.has(refDeck);
    })
    .slice(0, 6);

  return {
    ...pack,
    concept_title: cleanedTitle || pack.concept_title,
    concept_display: pack.concept_id && cleanedTitle ? `${pack.concept_id} - ${cleanedTitle}` : (cleanedTitle || pack.concept_display),
    raw_finding_excerpts: cleanArray(pack.raw_finding_excerpts || [], 6),
    source_refs: sourceRefs,
    supporting_signals: publicSignals,
    key_synthesis_signals: publicSignals.slice(0, 5),
    evidence_snapshot_rule_based: publicSignals.slice(0, 5),
    clean_supporting_signals: publicSignals.slice(0, 6),
    clean_key_numbers: extractNumbers(publicSignals),
    supporting_numbers: extractNumbers(publicSignals),
    external_evidence_refs: externalRefs,
    external_evidence_count: externalRefs.length,
    external_evidence_merge_status: externalRefs.length ? 'matched' : undefined,
  };
}

function payloadPacks(payload) {
  if (Array.isArray(payload)) return { kind: 'array', packs: payload, wrapper: null };
  if (payload && Array.isArray(payload.packs)) return { kind: 'object', packs: payload.packs, wrapper: payload };
  return { kind: 'object', packs: [], wrapper: payload || {} };
}

function writePayload(file, meta, packs) {
  const output = meta.kind === 'array' ? packs : { ...(meta.wrapper || {}), packs, pack_count: packs.length };
  fs.writeFileSync(file, JSON.stringify(output, null, 2) + '\n', 'utf8');
}

const report = {
  generated_at: new Date().toISOString(),
  files: [],
};

for (const name of files) {
  const fp = path.join(dataDir, name);
  if (!fs.existsSync(fp)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const meta = payloadPacks(raw);
    const before = meta.packs.length;
    const cleaned = meta.packs.filter(pack => !shouldDropPack(pack)).map(cleanPack);
    writePayload(fp, meta, cleaned);
    report.files.push({ file: name, before, after: cleaned.length, dropped: before - cleaned.length });
    console.log(`Cleaned ${name}: ${before} -> ${cleaned.length}`);
  } catch (err) {
    console.error(`Failed ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

fs.writeFileSync(path.join(dataDir, 'evidence_quality_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
