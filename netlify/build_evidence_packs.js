#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function flattenDeckContent(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const candidates = [raw.items, raw.decks, raw.deck_content, raw.deckContents, raw.entries];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function extractTextStrings(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === 'string') {
    acc.push(obj);
    return acc;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) extractTextStrings(item, acc);
    return acc;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (['raw_bytes', 'binary', 'buffer'].includes(k)) continue;
      extractTextStrings(v, acc);
    }
  }
  return acc;
}

function normalizeWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function extractNumbers(text) {
  const matches = normalizeWhitespace(text).match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b/g);
  return matches ? [...new Set(matches)].slice(0, 8) : [];
}

function extractConcept(text) {
  const cleaned = normalizeWhitespace(text)
    .replace(/^👉\s*/,'')
    .replace(/^🧠\s*/,'')
    .replace(/^📈\s*/,'')
    .replace(/^💜\s*/,'')
    .replace(/^→\s*/,'')
    .replace(/^[-•]\s*/,'');
  const idMatch = cleaned.match(/^(\d{2,3})\s*[-:–]\s*(.+)$/);
  if (idMatch) {
    return {
      concept_id: idMatch[1],
      title: normalizeWhitespace(idMatch[2].replace(/\(in process\)/ig, '').replace(/\s+R\d+$/i, '').replace(/\s+V\d+$/i, '')),
      raw_label: cleaned,
    };
  }

  const candidate = cleaned
    .replace(/\b\(in process\)\b/ig, '')
    .replace(/\s+R\d+$/i, '')
    .replace(/\s+V\d+$/i, '')
    .replace(/:$/,'')
    .trim();

  if (!candidate) return null;

  const useful = /baseline|comparison|review|analysis|messaging|labels|navigation|portal|homepage|events|taxonomy|knowledge|platform|journey|rebrand|landing page|reader page|search page|header|feedback/i.test(candidate);
  if (!useful) return null;
  return {
    concept_id: null,
    title: candidate,
    raw_label: cleaned,
  };
}

function walkItems(items, out = []) {
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string') out.push({ text: item.text, level: item.level ?? 0 });
    if (Array.isArray(item.children) && item.children.length) walkItems(item.children, out);
  }
  return out;
}

function ratingForPack(pack) {
  let score = 0;
  if (pack.groups_seen.has('findings')) score += 3;
  if (pack.weeks_seen.size >= 2) score += 3;
  if (pack.supporting_numbers.size > 0) score += 2;
  if (pack.comparison_cues.length > 0) score += 1;
  if (pack.deck_refs.size > 0) score += 1;
  if (score >= 7) return { confidence: 'high', status: 'validated_finding', next_step: 'ship_or_finalize' };
  if (score >= 4) return { confidence: 'moderate', status: 'directional_signal', next_step: 'iterate' };
  return { confidence: 'low', status: 'work_in_motion', next_step: 'watch' };
}

function buildPack(rec, group, text, concept, deckTextById, packs) {
  const key = concept.concept_id ? `${concept.concept_id}__${concept.title.toLowerCase()}` : concept.title.toLowerCase();
  if (!packs.has(key)) {
    packs.set(key, {
      concept_key: key,
      concept_id: concept.concept_id,
      concept_title: concept.title,
      concept_display: concept.concept_id ? `${concept.concept_id} - ${concept.title}` : concept.title,
      weeks_seen: new Set(),
      source_refs: [],
      raw_finding_excerpts: [],
      groups_seen: new Set(),
      deck_refs: new Set(),
      supporting_numbers: new Set(),
      comparison_cues: [],
      behavioral_signals: new Set(),
      evidence_snapshot_rule_based: [],
    });
  }
  const pack = packs.get(key);
  pack.weeks_seen.add(rec.week_date);
  pack.groups_seen.add(group);
  pack.source_refs.push({
    week_date: rec.week_date,
    record_id: rec.record_id,
    group,
    text: normalizeWhitespace(text),
    deck_file_id: rec.deck?.file_id || null,
  });
  if (group === 'findings') pack.raw_finding_excerpts.push(normalizeWhitespace(text));
  for (const n of extractNumbers(text)) pack.supporting_numbers.add(n);
  const cueMatches = normalizeWhitespace(text).match(/\b(?:baseline|comparison|review|analysis|variant|variation|V\d+|R\d+|A\/B|winner|preferred|lift|increase|decrease|improved?|reduced?)\b/ig) || [];
  if (cueMatches.length) pack.comparison_cues.push(...cueMatches);
  const signalTerms = normalizeWhitespace(text).match(/\b(?:clarity|comprehension|sentiment|engagement|discoverability|navigation|labeling|messaging|taxonomy|preference|confidence|friction)\b/ig) || [];
  for (const s of signalTerms) pack.behavioral_signals.add(s.toLowerCase());
  if (rec.deck?.file_id) {
    pack.deck_refs.add(rec.deck.file_id);
    const deckBlob = deckTextById.get(rec.deck.file_id);
    if (deckBlob) {
      for (const n of extractNumbers(deckBlob)) pack.supporting_numbers.add(n);
      const snippets = deckBlob.split(/(?<=[.!?])\s+/).filter(s => /improv|increase|decrease|participants|preferred|engagement|comprehension|sentiment|clarity|confidence|successful/i.test(s)).slice(0,2);
      pack.evidence_snapshot_rule_based.push(...snippets.map(normalizeWhitespace));
    }
  }
}

function finalizePack(pack) {
  const rating = ratingForPack(pack);
  const weeks = [...pack.weeks_seen].sort();
  return {
    concept_key: pack.concept_key,
    concept_id: pack.concept_id,
    concept_title: pack.concept_title,
    concept_display: pack.concept_display,
    weeks_seen: weeks,
    first_seen_week: weeks[0] || null,
    last_seen_week: weeks[weeks.length - 1] || null,
    occurrence_count: pack.source_refs.length,
    groups_seen: [...pack.groups_seen],
    deck_refs: [...pack.deck_refs],
    raw_finding_excerpts: pack.raw_finding_excerpts.slice(0, 6),
    source_refs: pack.source_refs.slice(0, 12),
    supporting_numbers: [...pack.supporting_numbers],
    comparison_cues: [...new Set(pack.comparison_cues.map(c => c.toLowerCase()))],
    behavioral_signals: [...pack.behavioral_signals],
    evidence_snapshot_rule_based: [...new Set(pack.evidence_snapshot_rule_based.filter(Boolean))].slice(0, 4),
    rule_based_status: rating.status,
    rule_based_next_step: rating.next_step,
    rule_based_confidence: rating.confidence,
  };
}

function main() {
  const publishRoot = process.argv[2] || 'publish';
  const dataDir = path.join(publishRoot, 'data');
  const weeks = readJson(path.join(dataDir, 'weeks.json'), []);
  const deckRaw = readJson(path.join(dataDir, 'deck_content.json'), readJson(path.join(dataDir, 'deck-content.json'), []));
  const deckItems = flattenDeckContent(deckRaw);

  const latestWeek = [...weeks].map(w => w.week_date).filter(Boolean).sort().slice(-1)[0] || null;
  const latestDate = latestWeek ? new Date(`${latestWeek}T00:00:00Z`) : new Date();
  const cutoff = new Date(latestDate);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);

  const deckTextById = new Map();
  for (const item of deckItems) {
    const fileId = item.file_id || item.deck_file_id || item.id || null;
    if (!fileId) continue;
    const textBlob = normalizeWhitespace(extractTextStrings(item).join(' '));
    if (textBlob) deckTextById.set(fileId, textBlob);
  }

  const packs = new Map();
  for (const rec of weeks) {
    const recordDate = rec.week_date ? new Date(`${rec.week_date}T00:00:00Z`) : null;
    if (!recordDate) continue;
    const groups = rec.content_groups || {};
    for (const [group, groupItems] of Object.entries(groups)) {
      const flat = walkItems(groupItems);
      for (const entry of flat) {
        const concept = extractConcept(entry.text || '');
        if (!concept) continue;
        buildPack(rec, group, entry.text, concept, deckTextById, packs);
      }
    }
  }

  const allPacks = [...packs.values()].map(finalizePack).sort((a,b) => {
    if (b.occurrence_count !== a.occurrence_count) return b.occurrence_count - a.occurrence_count;
    return a.concept_display.localeCompare(b.concept_display);
  });
  const default30 = allPacks.filter(p => p.weeks_seen.some(w => new Date(`${w}T00:00:00Z`) >= cutoff));

  const fullPayload = {
    generated_at: new Date().toISOString(),
    latest_week_date: latestWeek,
    pack_count: allPacks.length,
    source_counts: {
      weeks: weeks.length,
      deck_items: deckItems.length,
    },
    packs: allPacks,
  };

  const defaultPayload = {
    generated_at: new Date().toISOString(),
    latest_week_date: latestWeek,
    window: {
      days: 30,
      start: cutoff.toISOString().slice(0,10),
      end: latestWeek,
    },
    pack_count: default30.length,
    packs: default30,
  };

  writeJson(path.join(dataDir, 'evidence_packs.json'), fullPayload);
  writeJson(path.join(dataDir, 'evidence-packs.json'), fullPayload);
  writeJson(path.join(dataDir, 'evidence_packs_default_30d.json'), defaultPayload);
  writeJson(path.join(dataDir, 'evidence-packs-default-30d.json'), defaultPayload);

  console.log(JSON.stringify({
    latest_week_date: latestWeek,
    pack_count: allPacks.length,
    default_30d_pack_count: default30.length,
    outputs: [
      path.join(dataDir, 'evidence_packs.json'),
      path.join(dataDir, 'evidence-packs.json'),
      path.join(dataDir, 'evidence_packs_default_30d.json'),
      path.join(dataDir, 'evidence-packs-default-30d.json'),
    ]
  }, null, 2));
}

main();
