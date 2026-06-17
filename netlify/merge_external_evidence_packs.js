#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function badEvidenceText(text) {
  const t = normalize(text);
  if (!t) return true;
  return /HTTPError|Client Error|Forbidden for url|sheets\.googleapis\.com|drive_csv_export|Traceback|Exception:|\b(?:[A-Za-z0-9_-]{18,})\b/i.test(
    t
  );
}

function dateSet(values) {
  return new Set(
    (values || [])
      .map((v) => normalize(v).slice(0, 10))
      .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
  );
}

function evidenceDeckIds(evidence) {
  const ids = [];
  for (const key of ["deck_file_id", "deck_id", "deckFileId", "deckId"])
    if (evidence && evidence[key]) ids.push(evidence[key]);
  for (const link of evidence?.linked_from || evidence?.linkedFrom || []) {
    for (const key of ["deck_file_id", "deck_id", "deckFileId", "deckId"])
      if (link && link[key]) ids.push(link[key]);
  }
  return uniq(ids);
}

function evidenceWeeks(evidence) {
  return uniq([
    ...(evidence?.associated_weeks || evidence?.associatedWeeks || []),
    ...(evidence?.week_dates || evidence?.weekDates || []),
  ]);
}

function evidenceIsAligned(pack, evidence) {
  const packDecks = new Set(
    [...(pack.deck_refs || []), ...(pack.deckRefs || [])].map(normalize).filter(Boolean)
  );
  const extDecks = evidenceDeckIds(evidence);
  if (packDecks.size && extDecks.some((id) => packDecks.has(id))) return true;

  const packWeeks = dateSet(pack.weeks_seen || pack.weeksSeen || []);
  const extWeeks = dateSet(evidenceWeeks(evidence));
  if (packWeeks.size && extWeeks.size) {
    for (const week of extWeeks) if (packWeeks.has(week)) return true;
    return false;
  }

  // If neither deck nor week alignment is available, do not merge external evidence into a dated 30-day pack.
  if (packDecks.size || packWeeks.size) return false;
  return false;
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

function flattenStrings(obj, out = [], depth = 0) {
  if (obj == null || depth > 8) return out;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    const value = normalize(obj);
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) flattenStrings(item, out, depth + 1);
    return out;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (
        /^(raw|binary|buffer|html|thumbnail|image|screenshot|token|id|gid|url|href|source_url|resolved_url|link_id|spreadsheet_id|deck_id|deck_file_id|record_id|fetch_meta|sheets_api_error|error|errors|status)$/i.test(
          key
        )
      )
        continue;
      flattenStrings(value, out, depth + 1);
    }
  }
  return out;
}

function asArrayPayload(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  for (const key of ["evidence", "items", "records", "sources", "results", "links"]) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

function packPayload(raw) {
  if (Array.isArray(raw)) return { kind: "array", packs: raw, wrapper: null };
  if (raw && Array.isArray(raw.packs)) return { kind: "object", packs: raw.packs, wrapper: raw };
  return { kind: "object", packs: [], wrapper: raw || {} };
}

function writePackPayload(filePath, meta, packs) {
  if (meta.kind === "array") {
    writeJson(filePath, packs);
  } else {
    writeJson(filePath, { ...(meta.wrapper || {}), packs });
  }
}

function titleTokens(title) {
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
    "tests",
    "testing",
    "concept",
    "concepts",
    "design",
    "review",
    "analysis",
    "baseline",
    "version",
    "variant",
    "variation",
    "feedback",
    "research",
    "content",
    "current",
    "signal",
    "study",
    "studies",
    "round",
    "rounds",
    "user",
    "users",
  ]);
  return uniq(
    normalize(title)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token && token.length >= 3 && !stop.has(token))
  );
}

function conceptAliases(pack) {
  const display = normalize(pack.concept_display || pack.concept_title || "");
  const title = normalize(pack.concept_title || display);
  const id = normalize(pack.concept_id || "");
  const aliases = [display, title];
  if (id) aliases.push(id, `${id} ${title}`);
  const low = `${display} ${title}`.toLowerCase();
  if (/event/.test(low)) aliases.push("events page", "event page", "events", "event");
  if (/homepage/.test(low) && /ai/.test(low))
    aliases.push("homepage ai messaging", "ai messaging", "homepage ai");
  if (/pathfinder/.test(low) || /cta/.test(low))
    aliases.push("pathfinder cta labels", "cta labels", "personalize", "start here");
  if (/webinar/.test(low)) aliases.push("webinar registration", "registration page", "webinar");
  if (/book/.test(low) || /filter/.test(low))
    aliases.push("this book", "reader filter", "book filter");
  if (/virtualization/.test(low))
    aliases.push("virtualization campaign", "virtualization", "solutions page", "campaign page");
  if (/summary/.test(low) && /ai/.test(low))
    aliases.push(
      "ai summary",
      "ai summaries",
      "book summary",
      "results summary",
      "publication summary"
    );
  return uniq(aliases.map((a) => normalize(a).toLowerCase()).filter(Boolean));
}

function evidenceConceptStrings(evidence) {
  const values = [];
  for (const key of [
    "concept",
    "concept_title",
    "concept_display",
    "link_text",
    "deck_title",
    "source_title",
    "title",
  ]) {
    if (evidence[key]) values.push(evidence[key]);
  }
  const inferred =
    evidence.inferred_concepts || evidence.concepts || evidence.matched_concepts || [];
  if (Array.isArray(inferred)) {
    for (const item of inferred) {
      if (typeof item === "string") values.push(item);
      else if (item && typeof item === "object") {
        values.push(
          item.title,
          item.name,
          item.label,
          item.concept_title,
          item.concept_display,
          item.concept_id,
          item.id
        );
      }
    }
  }
  return uniq(values.map((v) => normalize(v).toLowerCase()).filter(Boolean));
}

function evidenceText(evidence) {
  return normalize(flattenStrings(evidence).join(" "));
}

function tokenOverlapCount(text, tokens) {
  const low = normalize(text).toLowerCase();
  let count = 0;
  for (const token of tokens) {
    if (token && low.includes(token)) count += 1;
  }
  return count;
}

function matchScore(pack, evidence) {
  const aliases = conceptAliases(pack);
  const conceptStrings = evidenceConceptStrings(evidence);
  const text = evidenceText(evidence).toLowerCase();
  const tokens = titleTokens(pack.concept_title || pack.concept_display || "");
  let score = 0;

  for (const alias of aliases) {
    if (!alias) continue;
    if (conceptStrings.some((c) => c === alias || c.includes(alias) || alias.includes(c)))
      score += 20;
    if (alias.length >= 5 && text.includes(alias)) score += 10;
  }

  if (
    pack.concept_id &&
    new RegExp(`\\b${String(pack.concept_id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)
  )
    score += 16;
  score += tokenOverlapCount(text, tokens) * 3;

  // Conservative topic-specific boosts for common linked research sheets.
  const packLow = normalize(pack.concept_display || pack.concept_title || "").toLowerCase();
  if (/event/.test(packLow) && /\bevents?\b/.test(text)) score += 6;
  if (/homepage.*ai|ai.*homepage/.test(packLow) && /\b(ai|homepage|hero)\b/.test(text)) score += 6;
  if (
    /pathfinder|cta/.test(packLow) &&
    /\b(pathfinder|personalize|start here|cta|label)\b/.test(text)
  )
    score += 6;
  if (/webinar/.test(packLow) && /\b(webinar|registration|register)\b/.test(text)) score += 6;
  if (/book|filter/.test(packLow) && /\b(this book|book|filter|reader)\b/.test(text)) score += 6;
  if (
    /virtualization/.test(packLow) &&
    /\b(virtualization|campaign|solution|solutions)\b/.test(text)
  )
    score += 6;

  return score;
}

function splitSignals(text) {
  const compact = normalize(text);
  if (!compact) return [];
  const pieces = compact
    .split(/(?<=[.!?])\s+|\s+\|\s+|\s+•\s+|\s+\u2022\s+|\n+/)
    .map(normalize)
    .filter(Boolean);
  if (pieces.length <= 1 && compact.length > 260) {
    const chunks = compact.match(/.{1,240}(?:\s|$)/g) || [];
    return chunks.map(normalize).filter(Boolean);
  }
  return pieces;
}

function numbers(text) {
  return uniq(
    normalize(text).match(/\b\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?x\b|\b\d+(?:\.\d+)?\b/gi) || []
  );
}

function signalScore(text) {
  const t = normalize(text);
  if (!t || t.length < 18) return -10;
  if (badEvidenceText(t)) return -10;
  if (/^(https?:|docs\.google|my\.helio|glare-playground)/i.test(t)) return -8;
  let score = 0;
  if (/\b\d{1,3}%\b/.test(t)) score += 7;
  if (/\b\d+(?:\.\d+)?x\b/i.test(t)) score += 5;
  if (/\b(from|to|versus|vs\.?|compared|than)\b/i.test(t) && numbers(t).length) score += 5;
  if (
    /\b(improved?|increase|decrease|lift|uplift|higher|lower|outperform|preferred|winner|winning|successful|success|engagement|sentiment|confidence|trust|clarity|comprehension|findability|discoverability|first-click|frequency)\b/i.test(
      t
    )
  )
    score += 5;
  if (/\b(quote|said|participant|respondent|user|users|visitors)\b/i.test(t)) score += 2;
  if (/\b(should|recommend|move|remove|add|keep|test|validate|compare)\b/i.test(t)) score += 1;
  if (t.length > 320) score -= 2;
  return score;
}

function extractSignals(evidence, limit = 8) {
  const text = evidenceText(evidence);
  const rawSignals = splitSignals(text);
  const scored = [];
  for (const signal of uniq(rawSignals)) {
    const score = signalScore(signal);
    if (score <= 0) continue;
    scored.push({ text: signal, score });
  }
  scored.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return scored.map((item) => item.text).slice(0, limit);
}

function evidenceRef(evidence, signals) {
  const url = evidence.source_url || evidence.url || evidence.href || evidence.resolved_url || null;
  return {
    source_type:
      evidence.source_type || evidence.link_type || evidence.type || "external_research_evidence",
    deck_title: evidence.deck_title || null,
    deck_id: evidence.deck_id || evidence.deck_file_id || null,
    slide_number: evidence.slide_number || evidence.page_number || null,
    link_text: evidence.link_text || evidence.title || null,
    source_url: url,
    inferred_concepts: evidence.inferred_concepts || evidence.concepts || [],
    sheet_count: Array.isArray(evidence.sheets) ? evidence.sheets.length : undefined,
    signal_count: signals.length,
  };
}

function mergePack(pack, matches) {
  const refs = [];
  const signals = [];
  const nums = [];
  for (const match of matches) {
    const matchSignals = extractSignals(match.evidence, 8).filter(
      (signal) => !badEvidenceText(signal)
    );
    if (!matchSignals.length) continue;
    refs.push(evidenceRef(match.evidence, matchSignals));
    signals.push(...matchSignals);
    nums.push(...matchSignals.flatMap(numbers));
  }
  const cleanSignals = uniq(signals).slice(0, 12);
  const externalNumbers = uniq(nums).slice(0, 12);
  if (!cleanSignals.length && !refs.length) return { pack, changed: false };

  const merged = { ...pack };
  merged.external_evidence_count = (merged.external_evidence_count || 0) + refs.length;
  merged.external_evidence_refs = uniqObjects([
    ...(merged.external_evidence_refs || []),
    ...refs,
  ]).slice(0, 12);
  merged.supporting_signals = uniq([...(merged.supporting_signals || []), ...cleanSignals]).slice(
    0,
    18
  );
  merged.key_synthesis_signals = uniq([
    ...(merged.key_synthesis_signals || []),
    ...cleanSignals,
  ]).slice(0, 12);
  merged.evidence_snapshot_rule_based = uniq([
    ...(merged.evidence_snapshot_rule_based || []),
    ...cleanSignals,
  ]).slice(0, 10);
  merged.supporting_numbers = uniq([
    ...(merged.supporting_numbers || []),
    ...externalNumbers,
  ]).slice(0, 18);
  merged.behavioral_signals = uniq([
    ...(merged.behavioral_signals || []),
    ...extractBehavioralSignals(cleanSignals),
  ]).slice(0, 18);
  merged.groups_seen = uniq([...(merged.groups_seen || []), "external_research_evidence"]);
  merged.source_refs = [
    ...(merged.source_refs || []),
    ...refs.slice(0, 6).map((ref, idx) => ({
      group: "external_research_evidence",
      week_date: merged.last_seen_week || (merged.weeks_seen || []).slice(-1)[0] || null,
      record_id: null,
      text: cleanSignals[idx] || ref.link_text || "External research evidence",
      deck_file_id: ref.deck_id || null,
      source_url: ref.source_url || null,
      slide_number: ref.slide_number || null,
    })),
  ].slice(0, 18);
  merged.external_evidence_merge_status = "matched";
  return { pack: merged, changed: true };
}

function extractBehavioralSignals(signals) {
  const terms = [];
  const rx =
    /\b(clarity|comprehension|sentiment|engagement|trust|confidence|findability|discoverability|conversion|success|frequency|preference|friction|effort|first-click)\b/gi;
  for (const signal of signals) {
    for (const match of signal.matchAll(rx)) terms.push(match[1].toLowerCase());
  }
  return terms;
}

function uniqObjects(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function bestMatchesForPack(pack, evidenceItems) {
  const scored = [];
  for (const evidence of evidenceItems) {
    if (!evidenceIsAligned(pack, evidence)) continue;
    const score = matchScore(pack, evidence);
    if (score >= 32) scored.push({ score, evidence });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

function main() {
  const publishRoot = process.argv[2] || "publish";
  const dataDir = path.join(publishRoot, "data");
  const externalRaw = readJson(
    path.join(dataDir, "external_research_evidence.json"),
    readJson(path.join(dataDir, "external-research-evidence.json"), null)
  );
  const evidenceItems = asArrayPayload(externalRaw);
  const report = {
    generated_at: new Date().toISOString(),
    external_evidence_count: evidenceItems.length,
    files_updated: [],
    matched_packs: [],
    unmatched_evidence: [],
    warnings: [],
  };

  const packFiles = [
    "evidence_packs.json",
    "evidence-packs.json",
    "evidence_packs_default_30d.json",
    "evidence-packs-default-30d.json",
  ];

  if (!evidenceItems.length) {
    report.warnings.push(
      "No external evidence records found. Nothing was merged into evidence packs."
    );
    writeJson(path.join(dataDir, "external_research_evidence_match_report.json"), report);
    writeJson(path.join(dataDir, "external-research-evidence-match-report.json"), report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const globalMatchedEvidence = new Set();

  for (const fileName of packFiles) {
    const fp = path.join(dataDir, fileName);
    const raw = readJson(fp, null);
    if (!raw) continue;
    const meta = packPayload(raw);
    const updatedPacks = [];
    let changedCount = 0;

    for (const pack of meta.packs || []) {
      const matches = bestMatchesForPack(pack, evidenceItems);
      const result = mergePack(pack, matches);
      updatedPacks.push(result.pack);
      if (result.changed) {
        changedCount += 1;
        for (const m of matches) globalMatchedEvidence.add(evidenceItems.indexOf(m.evidence));
        report.matched_packs.push({
          file: fileName,
          concept_display: pack.concept_display || pack.concept_title || pack.concept_key,
          match_count: matches.length,
          top_match_score: matches[0]?.score || 0,
          top_link_text: matches[0]?.evidence?.link_text || matches[0]?.evidence?.title || null,
        });
      }
    }

    if (changedCount > 0) {
      writePackPayload(fp, meta, updatedPacks);
      report.files_updated.push({
        file: fileName,
        changed_pack_count: changedCount,
        total_pack_count: updatedPacks.length,
      });
    }
  }

  evidenceItems.forEach((evidence, index) => {
    if (globalMatchedEvidence.has(index)) return;
    report.unmatched_evidence.push({
      index,
      deck_title: evidence.deck_title || null,
      slide_number: evidence.slide_number || null,
      link_text: evidence.link_text || evidence.title || null,
      source_type: evidence.source_type || evidence.link_type || evidence.type || null,
      inferred_concepts: evidence.inferred_concepts || evidence.concepts || [],
    });
  });

  report.matched_external_evidence_count = globalMatchedEvidence.size;
  report.unmatched_external_evidence_count = report.unmatched_evidence.length;
  report.matched_pack_count = report.matched_packs.length;

  writeJson(path.join(dataDir, "external_research_evidence_match_report.json"), report);
  writeJson(path.join(dataDir, "external-research-evidence-match-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main();
