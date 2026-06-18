"use strict";

// Pure text helpers shared by the stage-2 renderers. Kept dependency-free
// (Node built-ins only) and side-effect-free so they can be unit-tested.

function normWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Drop a leading concept label from an evidence/proof line.
 *
 * The strongest evidence line is often a raw deck excerpt that repeats the
 * concept label at the front — e.g. the finding titled "EDC Blueprint Page"
 * has the proof line "EDC Blueprint Users understand the Enterprise Data Cloud
 * category…". That prefix is redundant with the finding heading and reads as a
 * duplicated subject. This removes a leading run of words that matches the
 * start of `title` (in order), so EVIDENCE reads as the statement alone.
 *
 * Conservative by design: it only strips when at least two leading words match
 * the title, so a single coincidental word ("Platform messaging…" under a
 * "Platform Diagram Update" finding) is never truncated. Returns `text`
 * unchanged when nothing qualifies, and never returns an empty string.
 */
function stripLeadingConceptLabel(text, title) {
  if (!text || !title) return text;
  const titleWords = title.split(/\s+/).map(normWord).filter(Boolean);
  if (!titleWords.length) return text;

  const tokens = [];
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ end: re.lastIndex, norm: normWord(m[0]) });

  let matched = 0;
  let cut = 0;
  while (
    matched < tokens.length &&
    matched < titleWords.length &&
    tokens[matched].norm &&
    tokens[matched].norm === titleWords[matched]
  ) {
    cut = tokens[matched].end;
    matched += 1;
  }

  if (matched < 2) return text;
  const rest = text.slice(cut).replace(/^\s+/, "");
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Mirror of stripLeadingConceptLabel for a trailing label run. */
function stripTrailingConceptLabel(text, title) {
  if (!text || !title) return text;
  const titleWords = title.split(/\s+/).map(normWord).filter(Boolean);
  if (!titleWords.length) return text;

  const tokens = [];
  const re = /\s*\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) tokens.push({ start: m.index, norm: normWord(m[0]) });

  let matched = 0;
  while (matched < tokens.length && matched < titleWords.length) {
    const tw = tokens[tokens.length - 1 - matched].norm;
    const titw = titleWords[titleWords.length - 1 - matched];
    if (tw && tw === titw) matched += 1;
    else break;
  }
  if (matched < 2) return text;
  const rest = text.slice(0, tokens[tokens.length - matched].start).replace(/\s+$/, "");
  return rest || text;
}

// Common PDF ligatures leak into deck-extracted text (e.g. "ﬁrst",
// "diﬀerentiation"). Normalize them so public copy reads correctly.
const LIGATURES = {
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "ft",
  ﬆ: "st",
};

function normalizeLigatures(text) {
  if (!text) return text;
  return String(text).replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] || ch);
}

// Pipeline scaffolding that bleeds into deck-extracted evidence strings. These
// are *split points*: genuine content can sit before or after them, and a
// single string often splices several concepts together via this scaffolding.
const SCAFFOLD_SPLIT = new RegExp(
  [
    "(?:Signal|Recommendation|Decisions?|Hunch|Design)\\s+Concept\\s+\\d+",
    "Concept\\s+\\d+",
    "Source:\\s*Data Comparison",
    "Source:\\s*Figma File",
    "Source:\\s*\\S+",
    "Decision Rationale",
    "Implement\\s+Refine\\s+Design(?:\\s+Test\\s+Iteration)?",
    "Test\\s+Iteration\\s+Revisit\\s+Later",
    "Revisit\\s+Later",
    "Do\\s+Not\\s+Pursue",
    "Refine\\s+Design",
    "Assumption\\s*[\\u25cf\\u2022]",
    "[\\u25cf\\u2022]",
    "pypdf",
  ].join("|"),
  "gi"
);

// Scaffolding tokens that, if still present after splitting, mark a segment as
// not-clean (used to penalize, not to split).
const SCAFFOLD_REMNANT =
  /\b(concept\s*\d+|source:|decision rationale|implement|iteration|pursue|figma file|data comparison|baseline)\b/i;

// Words that signal a concrete observation/measurement (real evidence).
const OBSERVATION =
  /\b(respondents?|visitors?|responses?|participants?|users?|describe[ds]?|named|clustered|clicked|asked|dominate[ds]?|fragmented|mismatch|friction|grasp(?:ed)?|miss(?:ed)?|understood|understand|comprehension|impression|emotional|expectation|autoplay|labels?|conversion|sentiment)\b/i;

// Words that signal a hunch/recommendation rather than a surfaced signal.
const HUNCH =
  /\b(explor\w+|opportunity|should|could|recommend\w*|establish\w*|reframe|assumption|consider|introduce|rewrite|simplif\w+|needs? to|guiding|biggest opportunity)\b/i;

function splitOnScaffold(text) {
  return String(text || "")
    .split(SCAFFOLD_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Clean one raw evidence string into zero or more presentable segments:
 * normalize ligatures, split off pipeline scaffolding, strip leading/trailing
 * concept labels and bullet artifacts, and drop fragments that are too short.
 */
function leadSentence(text) {
  const parts = String(text || "").split(/(?<=[.?!])\s+(?=[A-Z“"])/);
  return parts[0] || text;
}

function sanitizeEvidenceSegments(raw, title) {
  const normalized = normalizeLigatures(raw);
  const out = [];
  for (let seg of splitOnScaffold(normalized)) {
    seg = seg.replace(/\s+/g, " ").trim();
    // Drop a leading deck section-label like "Conversion (consideration → action) "
    // or "Decision Rationale: " that precedes the real sentence.
    seg = seg.replace(/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s*\([^)]*\)\s+(?=[A-Z])/, "");
    seg = stripLeadingConceptLabel(seg, title);
    seg = stripTrailingConceptLabel(seg, title);
    seg = seg.replace(/^[\s●•:.\-–—]+/, "").replace(/\s+$/, "");
    if (seg.length < 25 || !/[a-z]/i.test(seg)) continue;
    out.push(seg);
    // Also offer the lead sentence as a tighter candidate when the segment is
    // long and multi-sentence — keeps EVIDENCE concise when that reads better.
    const lead = leadSentence(seg).trim();
    if (lead && lead !== seg && lead.length >= 40) out.push(lead);
  }
  return out;
}

function contentTokens(t) {
  return (
    String(t || "")
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g) || []
  );
}

function overlapRatio(a, b) {
  const A = new Set(contentTokens(a));
  const B = new Set(contentTokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit += 1;
  return hit / A.size;
}

/**
 * Score a candidate evidence segment for "concreteness": reward quotes,
 * metrics, and observation language; penalize hunch/recommendation language,
 * leftover scaffolding, and segments that merely restate the finding.
 */
function scoreEvidence(text, ctx = {}) {
  const { findingStatement = "" } = ctx;
  let s = 0;
  if (/["“][^"”]+["”]/.test(text)) s += 4; // contains a quote
  if (/\b\d{1,3}%/.test(text)) s += 3; // a percentage
  if (/\b\d+\b/.test(text)) s += 1; // any number
  if (OBSERVATION.test(text)) s += 5;
  if (HUNCH.test(text)) s -= 4;
  if (SCAFFOLD_REMNANT.test(text)) s -= 8;
  const len = text.length;
  if (len >= 40 && len <= 300) s += 2;
  if (len > 380) s -= 3;
  if (overlapRatio(text, findingStatement) >= 0.6) s -= 6; // restates the hunch
  return s;
}

/**
 * Choose the strongest concrete evidence segment from raw candidate strings.
 * Returns "" when nothing clears the concreteness threshold (caller should then
 * fall back to its existing behavior rather than show a weak/hunchy line).
 */
function pickBestEvidence(rawCandidates, ctx = {}) {
  const title = ctx.title || "";
  const segs = [];
  for (const raw of rawCandidates || []) {
    for (const seg of sanitizeEvidenceSegments(raw, title)) segs.push(seg);
  }
  const seen = new Set();
  let best = "";
  let bestScore = -Infinity;
  for (const seg of segs) {
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreEvidence(seg, ctx);
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  return bestScore >= 4 ? best : "";
}

function ensureSentenceEnd(text) {
  return /[.?!”"]$/.test(text) ? text : `${text}.`;
}

// Trim to a max length at the nearest sentence boundary (preferred) or word
// boundary, so evidence stays within a consistent ceiling.
function capLength(text, maxLen) {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen + 1);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! ")
  );
  if (sentenceEnd >= 80) return text.slice(0, sentenceEnd + 1);
  const space = slice.lastIndexOf(" ");
  const cut = space >= 80 ? space : maxLen;
  return `${text.slice(0, cut).replace(/[\s,;:—-]+$/, "")}…`;
}

/**
 * Compose a concise evidence summary from raw candidate strings: take the
 * strongest concrete segment, then append further *distinct* concrete segments
 * while they fit under `maxLen`. This gives the EVIDENCE column a richer,
 * multi-signal line (the convention curated overrides also follow) with a
 * consistent length ceiling. Returns "" when nothing clears the bar.
 */
function composeEvidenceSummary(rawCandidates, ctx = {}, maxLen = 295) {
  const title = ctx.title || "";
  const segMap = new Map();
  for (const raw of rawCandidates || []) {
    for (const seg of sanitizeEvidenceSegments(raw, title)) {
      const key = seg.toLowerCase();
      if (!segMap.has(key)) segMap.set(key, seg);
    }
  }
  const ranked = [...segMap.values()]
    .map((seg) => ({ seg, score: scoreEvidence(seg, ctx) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || a.seg.length - b.seg.length);
  if (!ranked.length) return "";

  let result = capLength(ranked[0].seg, maxLen);
  for (let i = 1; i < ranked.length; i += 1) {
    const cand = ranked[i].seg;
    if (overlapRatio(cand, result) >= 0.4) continue; // must add a distinct signal
    const joined = `${ensureSentenceEnd(result)} ${cand}`;
    if (joined.length <= maxLen) result = joined;
  }
  return capLength(result, maxLen);
}

// Quoted strings that are CTA labels / marketing taglines, not respondent words.
const QUOTE_DENY =
  /^(watch a demo|start your assessment|book a workshop|learn more|get started|contact (us|sales)|sign up|register now|explore|read more|view all|download|request a demo)\b/i;
// First-person / reaction language that marks a genuine participant utterance.
const UTTERANCE =
  /\b(i|i'?d|i'?m|i'?ve|my|me|we|us|why|what|how|not sure|unclear|confus\w*|assume|expect\w*|think|feel|wish|want|don'?t|can'?t|would|should)\b/i;

function looksLikeRespondentQuote(q) {
  if (q.length < 15 || q.length > 200) return false;
  if (QUOTE_DENY.test(q)) return false;
  // Marketing/product framing with no first-person voice is not a respondent quote.
  if (
    /transform\w*|enrich\w*|governance|ai-ready|fragmented data/i.test(q) &&
    !/\b(i|we|my|me|you)\b/i.test(q)
  )
    return false;
  return /\?/.test(q) || UTTERANCE.test(q);
}

/**
 * Pull the most compelling genuine respondent quote from raw candidate strings,
 * or "" if none qualifies. Deliberately conservative — a curated
 * `respondent_quote` override should win over this. Verbatim, with OCR spacing
 * ("Start Y our" → "Start Your") and ligatures repaired.
 */
function collectRespondentQuotes(rawCandidates) {
  const found = [];
  const seen = new Set();
  const re = /[“"]([^“”"]{12,200})[”"]/g;
  for (const raw of rawCandidates || []) {
    const norm = normalizeLigatures(String(raw || ""))
      .replace(/\s+/g, " ")
      .replace(/\bY our\b/g, "Your");
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(norm)) !== null) {
      // Drop leading punctuation fragments ("\. I think…" → "I think…").
      const q = m[1]
        .trim()
        .replace(/^[^A-Za-z0-9“"']+/, "")
        .trim();
      if (!looksLikeRespondentQuote(q)) continue;
      // Skip ones truncated mid-sentence (dangling function word at the end).
      if (/\b(as|the|a|an|to|of|and|or|but|with|for|in|on)$/i.test(q.replace(/[.,;:\s]+$/, "")))
        continue;
      const key = q
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(q);
    }
  }
  const score = (q) =>
    (/\?/.test(q) ? 3 : 0) +
    (/\b(i|i'?d|i'?m|i'?ve|my|me)\b/i.test(q) ? 3 : 0) +
    (q.length >= 25 && q.length <= 140 ? 2 : 0);
  return found.sort((a, b) => score(b) - score(a) || a.length - b.length);
}

function extractRespondentQuote(rawCandidates) {
  return collectRespondentQuotes(rawCandidates)[0] || "";
}

/**
 * Harvest up to `limit` distinct, clean respondent quotes from raw candidate
 * strings (e.g. deck open-ends) — same filtering/cleaning as extractRespondentQuote,
 * but returns the whole ranked, deduped set instead of just the top one.
 */
function harvestRespondentQuotes(rawCandidates, limit = 24) {
  return collectRespondentQuotes(rawCandidates).slice(0, Math.max(0, limit));
}

module.exports = {
  stripLeadingConceptLabel,
  stripTrailingConceptLabel,
  normalizeLigatures,
  sanitizeEvidenceSegments,
  scoreEvidence,
  pickBestEvidence,
  composeEvidenceSummary,
  extractRespondentQuote,
  harvestRespondentQuotes,
};
