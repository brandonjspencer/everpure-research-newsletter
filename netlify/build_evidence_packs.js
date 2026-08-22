#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
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
  if (typeof obj === "string") {
    acc.push(obj);
    return acc;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) extractTextStrings(item, acc);
    return acc;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (["raw_bytes", "binary", "buffer"].includes(k)) continue;
      extractTextStrings(v, acc);
    }
  }
  return acc;
}

function normalizeWhitespace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractNumbers(text) {
  const matches = normalizeWhitespace(text).match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?\b/g);
  return matches ? [...new Set(matches)].slice(0, 8) : [];
}

const BAD_EVIDENCE_PATTERNS = [
  /HTTPError|Client Error|Forbidden for url|Traceback|Exception:/i,
  /sheets\.googleapis\.com|drive_csv_export|Data Comparison Framework/i,
  /\b(?:[A-Za-z0-9_-]{18,})\b/,
  /^https?:\/\//i,
  /^\s*(?:View Findings Deck|View Concepts in Figma|View Google Doc|Research Roundup Audit)\s*$/i,
  /^\s*📌\s*[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}\s*$/i,
];

const INTRO_PATTERNS = [
  /^we have\s+(?:one|two|three|four|five|six|\d+)\s+new concept areas? to review for testing:?$/i,
  /^on deck$/i,
  /^events page findings:?$/i,
  /^webinar landing page:?$/i,
];

function isBadEvidenceText(text) {
  const t = normalizeWhitespace(text);
  if (!t) return true;
  if (BAD_EVIDENCE_PATTERNS.some((rx) => rx.test(t))) return true;
  return false;
}

function isIntroLine(text) {
  const t = normalizeWhitespace(text).replace(/[“”]/g, '"');
  return INTRO_PATTERNS.some((rx) => rx.test(t));
}

function hasSentenceEvidenceShape(text) {
  const t = normalizeWhitespace(text);
  if (isBadEvidenceText(t) || isIntroLine(t)) return false;
  return (
    t.length >= 32 &&
    /\b(users?|participants?|visitors?|readers?|customers?|need|needs|understand|recognize|clear|clearer|credible|useful|worth|engagement|improved?|increased?|outperformed|opportunity|communicate|value|trust|confidence|registration|assessment|workshop|live|watch live|differentiat|business value|platform story)\b/i.test(
      t
    )
  );
}

function cleanupConceptTitle(title) {
  return normalizeWhitespace(title)
    .replace(/^👉\s*/, "")
    .replace(/^🧠\s*/, "")
    .replace(/^📈\s*/, "")
    .replace(/^💜\s*/, "")
    .replace(/^→\s*/, "")
    .replace(/^[-•]\s*/, "")
    .replace(/\b\(in process\)\b/gi, "")
    .replace(/\s+R\d+$/i, "")
    .replace(/\s+V\d+$/i, "")
    .replace(/\s*[:–-]\s*$/g, "")
    .trim();
}

function spansMultipleSentences(text) {
  return /[.!?]\s+[A-Z]/.test(text);
}

function structuredConceptFromLine(text) {
  const t = normalizeWhitespace(text);
  if (!t || isBadEvidenceText(t) || isIntroLine(t)) return null;
  const patterns = [
    /^(.{3,72}?)(?:\s*[-–:]\s*|\s+)Exploring\b/i,
    /^(.{3,72}?)\s+Users?\s+(?:understand|recognize|need|are|can|cannot|don'?t|do not)\b/i,
    /^(.{3,72}?)\s+The biggest opportunity\b/i,
    /^(.{3,72}?)\s+Needs? to\b/i,
    /^(.{3,72}?)\s+should\b/i,
  ];
  for (const rx of patterns) {
    const match = t.match(rx);
    if (!match) continue;
    // A concept title spanning a full sentence break (e.g. matching "Needs
    // to" in a second, unrelated sentence) means the pattern grabbed a whole
    // preceding sentence plus a name/fragment from the next one - not a title.
    if (spansMultipleSentences(match[1])) continue;
    const title = cleanupConceptTitle(match[1]);
    if (title && title.length >= 3 && title.length <= 72) return title;
  }
  return null;
}

function conceptTokens(title) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "page",
    "pages",
    "test",
    "testing",
    "concept",
    "concepts",
    "update",
    "landing",
    "registration",
  ]);
  return normalizeWhitespace(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function snippetMatchesConcept(snippet, concept) {
  const tokens = conceptTokens(concept.title || concept.concept_title || concept.raw_label || "");
  if (!tokens.length) return false;
  const low = normalizeWhitespace(snippet).toLowerCase();
  return tokens.some((tok) => low.includes(tok));
}

function extractConcept(text) {
  const raw = normalizeWhitespace(text);
  if (!raw || isBadEvidenceText(raw) || isIntroLine(raw)) return null;

  const cleaned = cleanupConceptTitle(raw);
  const idMatch = cleaned.match(/^(\d{2,3})\s*[-:–]\s*(.+)$/);
  if (idMatch) {
    const title = cleanupConceptTitle(idMatch[2]);
    if (!title || isIntroLine(title)) return null;
    return {
      concept_id: idMatch[1],
      title,
      raw_label: cleaned,
    };
  }

  const structuredTitle = structuredConceptFromLine(cleaned);
  if (structuredTitle) {
    return {
      concept_id: null,
      title: structuredTitle,
      raw_label: cleaned,
    };
  }

  const candidate = cleanupConceptTitle(cleaned.replace(/:$/, ""));
  if (!candidate || candidate.length > 90) return null;
  if (/^(make|rewrite|improve|reduce|clarify|keep|move|add|remove)\b/i.test(candidate)) return null;
  if (/^(higher contrast|simpler layouts?|a more prominent)\b/i.test(candidate)) return null;

  const useful =
    /baseline|comparison|review|analysis|messaging|labels|navigation|portal|homepage|events|taxonomy|knowledge|platform|journey|rebrand|landing page|reader page|search page|header|feedback|edc|blueprint|accelerate|live stream|contextual intelligence|diagram|webinar|registration|assessment|workshop|pdp|campaign|virtualization/i.test(
      candidate
    );
  if (!useful) return null;
  return {
    concept_id: null,
    title: candidate,
    raw_label: cleaned,
  };
}

function walkItems(items, out = []) {
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string") out.push({ text: item.text, level: item.level ?? 0 });
    if (Array.isArray(item.children) && item.children.length) walkItems(item.children, out);
  }
  return out;
}

function ratingForPack(pack) {
  let score = 0;
  if (pack.groups_seen.has("findings")) score += 3;
  if (pack.weeks_seen.size >= 2) score += 3;
  if (pack.supporting_numbers.size > 0) score += 2;
  if (pack.comparison_cues.length > 0) score += 1;
  if (pack.deck_refs.size > 0) score += 1;
  if (score >= 7)
    return { confidence: "high", status: "validated_finding", next_step: "ship_or_finalize" };
  if (score >= 4)
    return { confidence: "moderate", status: "directional_signal", next_step: "iterate" };
  return { confidence: "low", status: "work_in_motion", next_step: "watch" };
}

function buildPack(rec, group, text, concept, deckTextById, packs) {
  const key = concept.concept_id
    ? `${concept.concept_id}__${concept.title.toLowerCase()}`
    : concept.title.toLowerCase();
  if (!packs.has(key)) {
    packs.set(key, {
      concept_key: key,
      concept_id: concept.concept_id,
      concept_title: concept.title,
      concept_display: concept.concept_id
        ? `${concept.concept_id} - ${concept.title}`
        : concept.title,
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
  if (group === "findings" || hasSentenceEvidenceShape(text))
    pack.raw_finding_excerpts.push(normalizeWhitespace(text));
  for (const n of extractNumbers(text)) pack.supporting_numbers.add(n);
  const cueMatches =
    normalizeWhitespace(text).match(
      /\b(?:baseline|comparison|review|analysis|variant|variation|V\d+|R\d+|A\/B|winner|preferred|lift|increase|decrease|improved?|reduced?)\b/gi
    ) || [];
  if (cueMatches.length) pack.comparison_cues.push(...cueMatches);
  const signalTerms =
    normalizeWhitespace(text).match(
      /\b(?:clarity|comprehension|sentiment|engagement|discoverability|navigation|labeling|messaging|taxonomy|preference|confidence|friction)\b/gi
    ) || [];
  for (const s of signalTerms) pack.behavioral_signals.add(s.toLowerCase());
  if (rec.deck?.file_id) {
    pack.deck_refs.add(rec.deck.file_id);
    const deckBlob = deckTextById.get(rec.deck.file_id);
    if (deckBlob) {
      const snippets = deckBlob
        .split(/(?<=[.!?])\s+/)
        .map(normalizeWhitespace)
        .filter((s) => hasSentenceEvidenceShape(s))
        .filter((s) => snippetMatchesConcept(s, concept))
        .slice(0, 3);
      for (const snippet of snippets) {
        for (const n of extractNumbers(snippet)) pack.supporting_numbers.add(n);
      }
      pack.evidence_snapshot_rule_based.push(...snippets);
    }
  }
}

function ratingForHelioPack(pack) {
  const rounds = pack.helio_compare_ids ? pack.helio_compare_ids.size : 1;
  let score = 0;
  if (rounds >= 2) score += 3;
  if (pack.supporting_numbers.size > 0) score += 2;
  if (pack.deck_refs.size > 0) score += 1;
  if (pack.comparison_cues.length > 0) score += 1;
  if (score >= 6)
    return { confidence: "high", status: "validated_finding", next_step: "ship_or_finalize" };
  if (score >= 3)
    return { confidence: "moderate", status: "directional_signal", next_step: "iterate" };
  return { confidence: "low", status: "work_in_motion", next_step: "watch" };
}

function finalizePack(pack) {
  const rating = pack.is_helio ? ratingForHelioPack(pack) : ratingForPack(pack);
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
    comparison_cues: [...new Set(pack.comparison_cues.map((c) => c.toLowerCase()))],
    behavioral_signals: [...pack.behavioral_signals],
    evidence_snapshot_rule_based: [
      ...new Set(pack.evidence_snapshot_rule_based.filter(Boolean)),
    ].slice(0, 4),
    rule_based_status: rating.status,
    rule_based_next_step: rating.next_step,
    rule_based_confidence: rating.confidence,
    ...(pack.is_helio
      ? { source: "helio_evidence", helio_compare_ids: [...pack.helio_compare_ids] }
      : {}),
  };
}

// --- Helio evidence -> packs -----------------------------------------------
// Helio comparisons are structured, reliably-fetched A/B test data (see
// everpure_helio_ingest.py) that is completely unaffected by the weekly-notes
// prose/heading regression the rest of this file works around. A comparison's
// own `derived_title` is often an unreliable internal Helio codename (reused
// across unrelated concepts, or a raw variant id), so a slide's own
// "<Label> | <Type> | Concept <NN> | ..." caption (when present) is preferred
// and used to merge multiple Helio compare objects that share one real concept.
const HELIO_CONCEPT_LABEL_RE =
  /^(.{2,60}?)\s*\|\s*(?:Design|Signal|Decisions?|Analysis|Recommendations?)\s*\|\s*Concept\s*(\d+)\b/i;

function looksGarbledVariantName(name) {
  const compact = normalizeWhitespace(name)
    .replace(/[\s-]+/g, "")
    .toLowerCase();
  return compact.length >= 16 && /^[0-9a-f]+$/.test(compact);
}

function helioConceptFromExcerpt(excerpt) {
  const m = HELIO_CONCEPT_LABEL_RE.exec(normalizeWhitespace(excerpt || ""));
  if (!m) return null;
  const title = cleanupConceptTitle(m[1]);
  if (!title) return null;
  return { concept_id: m[2], title };
}

function cleanHelioDerivedTitle(title) {
  const t = normalizeWhitespace(title || "");
  if (!t) return null;
  const segments = t.split(/\s+vs\.?\s+/i);
  if (segments.length > 1 && segments.every(looksGarbledVariantName)) return null;
  if (segments.length === 1 && looksGarbledVariantName(t)) return null;
  return t;
}

function helioEvidenceText(entry) {
  const raw = normalizeWhitespace(entry.slide_text_excerpt || "");
  // Strip a leading "Label | Type | Concept NN | Source: ... |" template
  // prefix so the stored evidence line reads as prose, not a slide caption.
  const stripped = raw.replace(/^.*?\|\s*Source:\s*[^|]+\|\s*/i, "").trim();
  return stripped || raw;
}

function buildHelioPack(entry, packs) {
  const excerptConcept = helioConceptFromExcerpt(entry.slide_text_excerpt);
  let key;
  let title;
  let conceptId = null;
  if (excerptConcept) {
    conceptId = excerptConcept.concept_id;
    title = excerptConcept.title;
    key = `helio_concept_${conceptId}`;
  } else {
    const cleaned = cleanHelioDerivedTitle(entry.derived_title);
    if (!cleaned) return; // No honest human-readable label available; skip rather than guess.
    title = cleaned;
    key = `helio_title_${title.toLowerCase()}`;
  }

  if (!packs.has(key)) {
    packs.set(key, {
      concept_key: key,
      concept_id: conceptId,
      concept_title: title,
      concept_display: conceptId ? `${conceptId} - ${title}` : title,
      weeks_seen: new Set(),
      source_refs: [],
      raw_finding_excerpts: [],
      groups_seen: new Set(),
      deck_refs: new Set(),
      supporting_numbers: new Set(),
      comparison_cues: [],
      behavioral_signals: new Set(),
      evidence_snapshot_rule_based: [],
      helio_compare_ids: new Set(),
      is_helio: true,
    });
  }
  const pack = packs.get(key);
  pack.groups_seen.add("helio_evidence");
  pack.helio_compare_ids.add(entry.compare_id);
  for (const w of entry.associated_weeks || []) pack.weeks_seen.add(w);
  if (entry.deck_file_id) pack.deck_refs.add(entry.deck_file_id);
  pack.comparison_cues.push("comparison");

  const evidenceText = helioEvidenceText(entry);
  if (hasSentenceEvidenceShape(evidenceText)) pack.raw_finding_excerpts.push(evidenceText);
  for (const n of extractNumbers(evidenceText)) pack.supporting_numbers.add(n);

  const variantNames = (entry.variants || []).map((v) => v.name).filter(Boolean);
  const namesAreClean =
    variantNames.length > 0 && variantNames.every((n) => !looksGarbledVariantName(n));

  for (const metric of entry.metrics || []) {
    const label = normalizeWhitespace(metric.label || "");
    if (!label) continue;
    const lower = label.toLowerCase();
    if (
      /comprehension|sentiment|engagement|desirability|intent|clarity|confidence|success|expectation/.test(
        lower
      )
    )
      pack.behavioral_signals.add(lower);
    const values = metric.values || [];
    for (const v of values) {
      if (typeof v.score === "number") pack.supporting_numbers.add(String(v.score));
    }
    if (namesAreClean && values.length === 2 && values.every((v) => typeof v.score === "number")) {
      const [a, b] = values;
      pack.raw_finding_excerpts.push(
        `${label}: ${a.name} scored ${a.score}${a.qual_label ? ` (${a.qual_label})` : ""} vs ${b.name} scored ${b.score}${b.qual_label ? ` (${b.qual_label})` : ""}.`
      );
    }
  }

  pack.source_refs.push({
    week_date: (entry.associated_weeks || [])[0] || null,
    record_id: null,
    group: "helio_evidence",
    text: evidenceText.slice(0, 400),
    deck_file_id: entry.deck_file_id || null,
    helio_compare_id: entry.compare_id,
    helio_source_url: entry.source_url || null,
  });
}

function ingestHelioEvidence(helioEvidence, packs) {
  for (const entry of asHelioEntries(helioEvidence)) {
    buildHelioPack(entry, packs);
  }
}

function asHelioEntries(helioEvidence) {
  if (!helioEvidence) return [];
  if (Array.isArray(helioEvidence.evidence)) return helioEvidence.evidence;
  if (Array.isArray(helioEvidence)) return helioEvidence;
  return [];
}

function main() {
  const publishRoot = process.argv[2] || "publish";
  const dataDir = path.join(publishRoot, "data");
  const weeks = readJson(path.join(dataDir, "weeks.json"), []);
  const deckRaw = readJson(
    path.join(dataDir, "deck_content.json"),
    readJson(path.join(dataDir, "deck-content.json"), [])
  );
  const deckItems = flattenDeckContent(deckRaw);
  const helioEvidence = readJson(path.join(dataDir, "helio_evidence.json"), null);

  const latestWeek =
    [...weeks]
      .map((w) => w.week_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
  const latestDate = latestWeek ? new Date(`${latestWeek}T00:00:00Z`) : new Date();
  const cutoff = new Date(latestDate);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);

  const deckTextById = new Map();
  for (const item of deckItems) {
    const fileId = item.file_id || item.deck_file_id || item.id || null;
    if (!fileId) continue;
    const textBlob = normalizeWhitespace(extractTextStrings(item).join(" "));
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
        const concept = extractConcept(entry.text || "");
        if (!concept) continue;
        buildPack(rec, group, entry.text, concept, deckTextById, packs);
      }
    }
  }

  ingestHelioEvidence(helioEvidence, packs);

  const allPacks = [...packs.values()].map(finalizePack).sort((a, b) => {
    if (b.occurrence_count !== a.occurrence_count) return b.occurrence_count - a.occurrence_count;
    return a.concept_display.localeCompare(b.concept_display);
  });
  const default30 = allPacks.filter((p) =>
    p.weeks_seen.some((w) => new Date(`${w}T00:00:00Z`) >= cutoff)
  );

  const fullPayload = {
    generated_at: new Date().toISOString(),
    latest_week_date: latestWeek,
    pack_count: allPacks.length,
    source_counts: {
      weeks: weeks.length,
      deck_items: deckItems.length,
      helio_evidence: asHelioEntries(helioEvidence).length,
    },
    packs: allPacks,
  };

  const defaultPayload = {
    generated_at: new Date().toISOString(),
    latest_week_date: latestWeek,
    window: {
      days: 30,
      start: cutoff.toISOString().slice(0, 10),
      end: latestWeek,
    },
    pack_count: default30.length,
    packs: default30,
  };

  writeJson(path.join(dataDir, "evidence_packs.json"), fullPayload);
  writeJson(path.join(dataDir, "evidence-packs.json"), fullPayload);
  writeJson(path.join(dataDir, "evidence_packs_default_30d.json"), defaultPayload);
  writeJson(path.join(dataDir, "evidence-packs-default-30d.json"), defaultPayload);

  console.log(
    JSON.stringify(
      {
        latest_week_date: latestWeek,
        pack_count: allPacks.length,
        default_30d_pack_count: default30.length,
        outputs: [
          path.join(dataDir, "evidence_packs.json"),
          path.join(dataDir, "evidence-packs.json"),
          path.join(dataDir, "evidence_packs_default_30d.json"),
          path.join(dataDir, "evidence-packs-default-30d.json"),
        ],
      },
      null,
      2
    )
  );
}

main();
