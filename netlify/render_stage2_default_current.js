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

function formatIssueDate(dateStr) {
  if (!dateStr) return 'Current cycle';
  const normalized = String(dateStr).slice(0, 10);
  try {
    return new Date(normalized + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
  } catch {
    return 'Current cycle';
  }
}

function issueNumberForMonth(dateStr) {
  if (!dateStr) return '01';
  const match = String(dateStr).match(/^(\d{4})-(\d{2})/);
  if (!match) return '01';
  const year = Number(match[1]);
  const month = Number(match[2]);
  // April 2026 was the first frozen/public issue. Keep future monthly issues monotonic from there.
  const issue = Math.max(1, (year - 2026) * 12 + (month - 4) + 1);
  return String(issue).padStart(2, '0');
}

const issueDate = formatIssueDate(counts.latest_week_date || generatedAt.slice(0, 10));
const issueNumber = issueNumberForMonth(counts.latest_week_date || generatedAt.slice(0, 10));
const issueLabel = `Issue ${issueNumber}`;

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.concepts)) return payload.concepts;
  if (payload && Array.isArray(payload.records)) return payload.records;
  return [];
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map(cleanText).filter(Boolean).slice(0, 2).join(' ');
      if (joined) return joined;
    } else {
      const text = cleanText(value);
      if (text) return text;
    }
  }
  return '';
}

function normalizeConfidence(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('high')) return 'high';
  if (text.includes('low') || text.includes('directional')) return 'low';
  return 'medium';
}

function titleFor(item) {
  return cleanText(item.title || item.headline || item.workstream || item.theme || item.test || item.name || 'Research signal');
}

function sourceFor(item) {
  if (item.source_href) return { label: item.source_label || 'Source deck', href: item.source_href };
  const refs = asArray(item.source_refs || item.sourceRefs);
  const direct = refs.find((ref) => ref && (ref.canonical_url || ref.deck_url || ref.url || ref.href));
  if (direct) return { label: 'Source deck', href: direct.canonical_url || direct.deck_url || direct.url || direct.href };
  const deckRef = refs.find((ref) => ref && (ref.deck_id || ref.deckId || ref.file_id || ref.fileId));
  if (deckRef) {
    const id = deckRef.deck_id || deckRef.deckId || deckRef.file_id || deckRef.fileId;
    return { label: 'Source deck', href: `https://docs.google.com/presentation/d/${id}/edit` };
  }
  return { label: null, href: null };
}

function uniqueByTitle(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = titleFor(item).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function fallbackFindingStatement(title) {
  return `${title} is showing up as one of the clearest signals in the current 30-day research window. Treat this as a direction to validate, not a blanket launch recommendation.`;
}

function toFinding(item) {
  const source = sourceFor(item);
  const title = titleFor(item);
  return {
    title,
    finding_statement: firstText(item.finding_statement, item.findingStatement, item.summary, item.evidence_snapshot, item.evidenceSnapshot) || fallbackFindingStatement(title),
    proof_point: firstText(item.proof_point, item.proofPoint, item.evidence_snapshot, item.evidenceSnapshot, item.key_numbers, item.keyNumbers, item.supporting_signals, item.supportingSignals) || 'Evidence is present in the current weekly records, but the proof point should be tightened during the manual stage-2 review.',
    next_step: firstText(item.next_step, item.nextStep, item.recommendation, item.implication) || 'Define the specific decision this signal should inform, then validate the strongest direction in the next research round.',
    confidence: normalizeConfidence(item.confidence || item.confidence_level || item.confidenceLevel),
    decision_status: cleanText(item.decision_status || item.decisionStatus || 'iterate'),
    source_label: source.label,
    source_href: source.href,
  };
}

function toComparison(item) {
  const source = sourceFor(item);
  const title = titleFor(item);
  const statement = firstText(item.finding_statement, item.findingStatement, item.summary, item.evidence_snapshot, item.evidenceSnapshot) || `${title} is best treated as a narrowed comparison problem in this issue.`;
  return {
    title,
    finding_statement: statement,
    decision_criteria: firstText(item.decision_criteria, item.decisionCriteria, item.proof_point, item.proofPoint, item.evidence_snapshot, item.evidenceSnapshot) || 'Choose the strongest direction based on first-glance comprehension, user confidence, and clarity of the next step rather than preference alone.',
    next_step: firstText(item.next_step, item.nextStep, item.recommendation, item.implication) || 'Run one decisive comparison round with explicit winning criteria before expanding the design space again.',
    confidence: normalizeConfidence(item.confidence || item.confidence_level || item.confidenceLevel),
    decision_status: cleanText(item.decision_status || item.decisionStatus || 'watch'),
    source_label: source.label,
    source_href: source.href,
  };
}

function toQuestion(item) {
  const title = titleFor(item);
  return {
    title,
    scope: cleanText(item.scope || item.area || ''),
    question: firstText(item.question, item.open_question, item.openQuestion) || `What decision does ${title.toLowerCase()} need to unblock before the next iteration or release decision?`,
  };
}

function looksLikeComparison(item) {
  const text = `${titleFor(item)} ${item.finding_statement || ''} ${item.evidence_snapshot || ''}`.toLowerCase();
  return /\b(v1|v2|v3|r2|r3|baseline|comparison|variant|variation|versus|vs\.?|test)\b/.test(text);
}

function evidencePackPayload() {
  return readJson(path.join(publishRoot, 'data', 'evidence-packs-default-30d.json'), null)
    || readJson(path.join(publishRoot, 'data', 'evidence_packs_default_30d.json'), null)
    || { packs: [] };
}

function readStatusPayload() {
  return readJson(path.join(publishRoot, 'status.json'), {}) || {};
}

function deckContentCount(status) {
  const value = status?._meta?.deck_content_count ?? status?.deck_content_count ?? status?.deckContentCount ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanConceptTitle(value) {
  return cleanText(value)
    .replace(/^concept\s+/i, '')
    .replace(/^\d+\s*[-:–]\s*/i, '')
    .replace(/\s+baseline$/i, ' baseline')
    .trim();
}

function canonicalTopicTitle(title) {
  const text = cleanConceptTitle(title).toLowerCase();
  if (text.includes('events page') || text === 'events' || text.includes('events v1') || text.includes('events v2')) return 'Events Page';
  if (text.includes('homepage ai')) return 'Homepage AI Messaging';
  if (text.includes('pathfinder') && text.includes('cta')) return 'Pathfinder CTA Labels';
  if (text.includes('webinar registration')) return 'Webinar Registration Page';
  if (text.includes('book filter') || text.includes('this book')) return 'Reader Filter: “This Book”';
  if (text.includes('virtualization')) return 'Virtualization Campaign';
  return cleanConceptTitle(title) || 'Research signal';
}

function topicKey(title) {
  const raw = cleanConceptTitle(title).toLowerCase();
  if (raw.includes('book filter') || raw.includes('this book')) return 'this_book_filter';
  return canonicalTopicTitle(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function hasSentenceShape(text) {
  const value = cleanText(text);
  return value.length >= 42 && /[.!?]/.test(value) && /\b(should|because|users?|participants?|customers?|evidence|signal|clear|confusing|prefer|understand|confidence|friction|trust|choose|validated|direction)\b/i.test(value);
}

function looksLabelOnly(text, title = '') {
  const value = cleanText(text);
  if (!value) return true;
  const normalized = value.toLowerCase().replace(/^concept\s+/i, '').replace(/^\d+\s*[-:–]\s*/i, '').trim();
  const normalizedTitle = cleanConceptTitle(title).toLowerCase();
  if (normalizedTitle && normalized === normalizedTitle) return true;
  if (/^(concept\s*)?\d+\s*[-:–]\s*[a-z0-9\s/&()]+$/i.test(value)) return true;
  if (/^[a-z0-9\s/&()]+\s+v\d$/i.test(value)) return true;
  return !hasSentenceShape(value) && value.length < 48;
}

function substantiveText(...values) {
  for (const value of values.flat()) {
    const text = cleanText(value);
    if (text && !looksLabelOnly(text)) return text;
  }
  return '';
}

function sourceFromPack(pack) {
  const refs = asArray(pack.source_refs || pack.sourceRefs);
  const withDeck = refs.find((ref) => ref && (ref.deck_file_id || ref.deck_id || ref.file_id || ref.deckFileId));
  const id = withDeck?.deck_file_id || withDeck?.deck_id || withDeck?.file_id || withDeck?.deckFileId || asArray(pack.deck_refs)[0];
  if (id) return { label: 'Source deck', href: `https://docs.google.com/presentation/d/${id}/edit` };
  return { label: null, href: null };
}

function groupEvidencePacks(packs) {
  const groups = new Map();
  for (const pack of packs || []) {
    const title = canonicalTopicTitle(pack.concept_title || pack.concept_display || pack.concept_key || pack.title || 'Research signal');
    const key = topicKey(title);
    if (!groups.has(key)) {
      groups.set(key, {
        title,
        weeks: new Set(),
        deckRefs: new Set(),
        sourceRefs: [],
        rawExcerpts: [],
        comparisonCues: new Set(),
        behavioralSignals: new Set(),
        occurrence_count: 0,
        first_seen_week: null,
        last_seen_week: null,
        statuses: new Set(),
        confidences: new Set(),
      });
    }
    const group = groups.get(key);
    for (const week of asArray(pack.weeks_seen)) if (week) group.weeks.add(week);
    for (const deck of asArray(pack.deck_refs)) if (deck) group.deckRefs.add(deck);
    for (const cue of asArray(pack.comparison_cues)) if (cue) group.comparisonCues.add(String(cue).toLowerCase());
    for (const signal of asArray(pack.behavioral_signals)) if (signal) group.behavioralSignals.add(String(signal).toLowerCase());
    for (const excerpt of asArray(pack.raw_finding_excerpts)) if (excerpt) group.rawExcerpts.push(cleanText(excerpt));
    for (const ref of asArray(pack.source_refs || pack.sourceRefs)) if (ref) group.sourceRefs.push(ref);
    group.occurrence_count += Number(pack.occurrence_count || asArray(pack.source_refs || pack.sourceRefs).length || 1);
    if (pack.first_seen_week && (!group.first_seen_week || pack.first_seen_week < group.first_seen_week)) group.first_seen_week = pack.first_seen_week;
    if (pack.last_seen_week && (!group.last_seen_week || pack.last_seen_week > group.last_seen_week)) group.last_seen_week = pack.last_seen_week;
    if (pack.rule_based_status) group.statuses.add(pack.rule_based_status);
    if (pack.rule_based_confidence) group.confidences.add(String(pack.rule_based_confidence).toLowerCase());
  }
  return [...groups.values()].map((group) => ({
    ...group,
    weeks_seen: [...group.weeks].sort(),
    deck_refs: [...group.deckRefs],
    comparison_cues: [...group.comparisonCues],
    behavioral_signals: [...group.behavioralSignals],
    source_refs: group.sourceRefs,
    raw_finding_excerpts: [...new Set(group.rawExcerpts)].filter(Boolean),
  })).sort((a, b) => {
    if (b.occurrence_count !== a.occurrence_count) return b.occurrence_count - a.occurrence_count;
    return String(b.last_seen_week || '').localeCompare(String(a.last_seen_week || ''));
  });
}

function weekPhrase(group) {
  const weeks = group.weeks_seen || [];
  if (!weeks.length) return 'the current 30-day window';
  if (weeks.length === 1) return `the ${weeks[0]} update`;
  return `${weeks.length} weekly updates (${weeks.join(', ')})`;
}

function deckPhrase(group) {
  const count = (group.deck_refs || []).length;
  if (!count) return 'without a linked findings deck';
  if (count === 1) return 'with 1 linked findings deck';
  return `with ${count} linked findings decks`;
}

function groupSource(group) {
  return sourceFromPack({ source_refs: group.source_refs, deck_refs: group.deck_refs });
}


// Confidence labels are editorial evidence-readiness labels, not statistical confidence.
// High = ready to decide, Medium = ready to run a decisive next round, Low = real signal that still needs proof.
function confidenceForGroup(group, purpose = 'track') {
  const weeks = asArray(group?.weeks_seen || []);
  const deckRefs = asArray(group?.deck_refs || []);
  const comparisonCues = asArray(group?.comparison_cues || []);
  const behavioralSignals = asArray(group?.behavioral_signals || []);
  const substantiveExcerpts = asArray(group?.raw_excerpts || [])
    .map(cleanText)
    .filter((text) => text && !looksLabelOnly(text));
  const occurrenceCount = Number(group?.occurrence_count || 0);

  const hasRepeatedSignal = weeks.length >= 2 || occurrenceCount >= 2;
  const hasSourceDetail = deckRefs.length >= 1 || substantiveExcerpts.length >= 1;
  const hasBehaviorSignal = behavioralSignals.length >= 1 || substantiveExcerpts.some((text) => /\b(users?|participants?|customers?|visitors?|readers?)\b/i.test(text));
  const hasDecisionShape = comparisonCues.length >= 1 || /comparison|compare|v1|v2|variant|baseline|cta|label|messaging|registration|filter/i.test(String(group?.title || ''));

  if (hasRepeatedSignal && hasSourceDetail && hasBehaviorSignal && hasDecisionShape && purpose !== 'unresolved') {
    return 'high';
  }

  if (hasRepeatedSignal || hasDecisionShape || deckRefs.length >= 2) {
    return 'medium';
  }

  return 'low';
}

function confidenceForCycle(groups) {
  const recurringCount = groups.filter((group) => (group.weeks_seen || []).length >= 2 || Number(group.occurrence_count || 0) >= 2).length;
  const decisionShapedCount = groups.filter((group) => confidenceForGroup(group) !== 'low').length;
  if (recurringCount >= 3 && decisionShapedCount >= 3) return 'medium';
  return 'low';
}

function actionForTopic(title) {
  const key = topicKey(title);
  if (key === 'events_page') return 'Run one final Events decision round that compares the surviving version or page direction against explicit winning criteria: first-glance purpose, event-discovery clarity, primary CTA clarity, and confidence that the page will get visitors to the right event path.';
  if (key === 'homepage_ai_messaging') return 'Define what Homepage AI Messaging is supposed to improve before testing again: faster comprehension, stronger credibility, clearer differentiation, or better pathing. Do not treat positive reaction to AI language as enough to ship.';
  if (key === 'pathfinder_cta_labels') return 'Test Pathfinder CTA labels around expectation-setting and commitment friction. The winning label should make the next step feel specific and safe, not merely more energetic.';
  if (key === 'webinar_registration_page') return 'Review the May 7 webinar registration evidence before calling a direction. Decide whether the issue is registration-page clarity, form friction, offer framing, or content sufficiency.';
  if (key === 'this_book_filter') return 'For the reader/content filter labeled “This Book,” validate whether users understand it as a current-content filter. If the label reads as internal language, rename it before expanding the filter model or promoting it as a finding.';
  if (key === 'virtualization_campaign') return 'Keep the Virtualization Campaign as a watch item unless the next update adds either repeated evidence or a concrete behavior signal.';
  return `Define the decision ${title} should unblock, then run a focused validation pass with explicit success criteria.`;
}

function comparisonCriteriaForTopic(title) {
  const key = topicKey(title);
  if (key === 'events_page') return 'Pick the winner based on first-glance comprehension, clarity of available events, primary CTA clarity, and whether users know how to move from the page into event detail or registration.';
  if (key === 'homepage_ai_messaging') return 'Compare versions on comprehension, credibility, relevance, and whether AI language explains a real user benefit without adding abstraction.';
  if (key === 'pathfinder_cta_labels') return 'Compare labels on expectation-setting, perceived effort, specificity of the next step, and whether the label reduces hesitation at the point of commitment.';
  return 'Choose the strongest direction based on comprehension, confidence, clarity of next step, and decision relevance rather than preference alone.';
}

function comparisonStatementForTopic(title, group) {
  const key = topicKey(title);
  if (key === 'events_page') return 'Events has moved from broad exploration into a decision problem. The research record shows repeated Events Page activity plus an Events V1/V2 comparison cue, so the next round should choose a direction instead of reopening the page model.';
  if (key === 'homepage_ai_messaging') return 'Homepage AI Messaging is recurring enough to treat as a focused messaging decision. The next pass should determine whether AI framing improves comprehension and trust, or simply adds fashionable language to the page.';
  if (key === 'pathfinder_cta_labels') return 'Pathfinder CTA Labels should be treated as an expectation-setting comparison. The issue is not which label sounds best, but which one makes the user understand the next step and feel comfortable taking it.';
  return `${title} is a narrowed research track in ${weekPhrase(group)}. The next step should define the winning criteria before more variants are introduced.`;
}

function buildProgramFinding(groups, statusInfo) {
  const recurring = groups.filter((g) => g.occurrence_count >= 2).map((g) => g.title);
  const latest = statusInfo?._meta?.latest_week_date || counts.latest_week_date || 'the latest update';
  const recurringText = recurring.slice(0, 5).join(', ') || 'the current research workstreams';
  return {
    title: 'Several research tracks now need sharper decision criteria',
    finding_statement: `Across the current research window, several workstreams have moved beyond broad exploration. The useful signal is that teams can now define what each study must prove before choosing a direction.`,
    proof_point: `Recurring research tracks include ${recurringText}. The next evidence pass should clarify the user behavior each track is trying to change or validate.`,
    next_step: 'For each active track, define the decision it should unblock: choose, compare, clarify, or hold. Then focus the next research round on tracks that still lack a clear winner or user-facing success criterion.',
    confidence: confidenceForCycle(groups),
    decision_status: 'iterate',
    source_label: null,
    source_href: null,
  };
}

function findingFromGroup(group) {
  const source = groupSource(group);
  const key = topicKey(group.title);
  if (key === 'events_page') {
    return {
      title: 'Events needs a final decision round, not more exploration',
      finding_statement: 'Events is the clearest recurring decision track in the current cycle. The signal is not yet “ship this version”; it is that the team has enough repeated activity to force a tighter Events page decision.',
      proof_point: `Events appears across ${weekPhrase(group)} ${deckPhrase(group)} and includes V1/V2 comparison cues. That recurrence makes it the clearest place to force a page-direction decision.`,
      next_step: actionForTopic('Events Page'),
      confidence: confidenceForGroup(group, 'comparison'),
      decision_status: 'compare',
      source_label: source.label,
      source_href: source.href,
    };
  }
  if (key === 'homepage_ai_messaging') {
    return {
      title: 'Homepage AI messaging needs a clearer success definition',
      finding_statement: 'Homepage AI Messaging is recurring, which means it should no longer be treated as a generic copy exploration. The next study needs to say whether AI language is improving understanding, trust, differentiation, or pathing.',
      proof_point: `Homepage AI Messaging appears in ${weekPhrase(group)} ${deckPhrase(group)}. The next test needs to isolate whether the AI language improves comprehension, credibility, differentiation, or pathing.`,
      next_step: actionForTopic('Homepage AI Messaging'),
      confidence: confidenceForGroup(group, 'comparison'),
      decision_status: 'define criteria',
      source_label: source.label,
      source_href: source.href,
    };
  }
  if (key === 'pathfinder_cta_labels') {
    return {
      title: 'Pathfinder CTA labels are a commitment-friction problem',
      finding_statement: 'Pathfinder CTA Labels should be framed as a decision about expectation-setting, not as a preference test. The useful question is which label makes the next step feel specific, credible, and low-friction.',
      proof_point: `Pathfinder CTA Labels appears in ${weekPhrase(group)} ${deckPhrase(group)}. The repeated signal makes it worth a focused comparison around expectation-setting and commitment friction.`,
      next_step: actionForTopic('Pathfinder CTA Labels'),
      confidence: confidenceForGroup(group, 'comparison'),
      decision_status: 'compare',
      source_label: source.label,
      source_href: source.href,
    };
  }
  return {
    title: group.title,
    finding_statement: `${group.title} is active in the current research window, but should stay in discovery until the research shows what users understood, preferred, missed, or acted on.`,
    proof_point: `${group.title} appears in ${weekPhrase(group)} ${deckPhrase(group)}. Treat it as a live workstream until the next round shows a clearer user behavior or preference signal.`,
    next_step: actionForTopic(group.title),
    confidence: confidenceForGroup(group, 'track'),
    decision_status: 'review evidence',
    source_label: source.label,
    source_href: source.href,
  };
}

function buildNarrativeFindings(groups, statusInfo) {
  const out = [];
  for (const title of ['Events Page', 'Homepage AI Messaging', 'Pathfinder CTA Labels']) {
    const group = groups.find((g) => topicKey(g.title) === topicKey(title));
    if (group) out.push(findingFromGroup(group));
  }
  if (!out.length) {
    for (const group of groups.slice(0, 4)) {
      out.push(findingFromGroup(group));
    }
  }
  return out.slice(0, 4);
}

function comparisonFromGroup(group) {
  const source = groupSource(group);
  return {
    title: group.title,
    finding_statement: comparisonStatementForTopic(group.title, group),
    decision_criteria: comparisonCriteriaForTopic(group.title),
    next_step: actionForTopic(group.title),
    confidence: confidenceForGroup(group, 'comparison'),
    decision_status: 'compare',
    source_label: source.label,
    source_href: source.href,
  };
}

function buildComparisons(groups, sourceComparisons) {
  const topicOrder = ['Events Page', 'Homepage AI Messaging', 'Pathfinder CTA Labels'];
  const comparisons = [];
  for (const title of topicOrder) {
    const group = groups.find((g) => topicKey(g.title) === topicKey(title));
    if (group) comparisons.push(comparisonFromGroup(group));
  }
  const validSource = uniqueByTitle(sourceComparisons)
    .map(toComparison)
    .filter((item) => !looksLabelOnly(item.finding_statement, item.title) && !looksLabelOnly(item.decision_criteria, item.title));
  return uniqueByTitle([...comparisons, ...validSource]).slice(0, 4);
}

function buildUnresolvedQuestions(groups, statusInfo) {
  const questions = [];
  for (const title of ['Webinar Registration Page', 'This Book Filter', 'Virtualization Campaign']) {
    const group = groups.find((g) => topicKey(g.title) === topicKey(title));
    if (!group) continue;
    const key = topicKey(title);
    if (key === 'webinar_registration_page') {
      questions.push({ title, scope: 'May 7 evidence review', question: 'Is the webinar registration signal about page clarity, form friction, offer framing, or content sufficiency?' });
    } else if (key === 'this_book_filter') {
      questions.push({ title: 'Reader Filter: “This Book”', scope: 'Content filtering clarity', question: 'In the May 7 filtering work, does the “This Book” label clearly tell users they are narrowing within the current content set, or should the label be rewritten in more user-facing language?' });
    } else if (key === 'virtualization_campaign') {
      questions.push({ title, scope: 'Single-occurrence watch item', question: 'Is this a real campaign-direction signal, or a one-week mention that should stay out of executive recommendations until it repeats?' });
    }
  }
  if (!questions.length) {
    questions.push({ title: 'Evidence review', scope: 'Decision readiness', question: 'Which current signals are strong enough to promote from activity into decision guidance?' });
  }
  return questions.slice(0, 5);
}

function actionText(action) {
  if (typeof action === 'string') return cleanText(action);
  return cleanText(action?.action || action?.next_step || action?.nextStep || action?.recommendation || action?.body || action?.text || action?.title || action?.headline);
}

function actionTopic(action) {
  if (typeof action === 'string') return '';
  return cleanText(action?.topic || action?.concept || action?.title || action?.scope || action?.category);
}

function isNewsletterSelfTestAction(item) {
  const text = `${actionTopic(item)} ${actionText(item)}`.toLowerCase();
  return /\b(research roundup|newsletter)\b/.test(text) && /\b(test|testing|validate|validation|research study|study)\b/.test(text);
}

function isInternalOperationalAction(item) {
  const text = `${actionTopic(item)} ${actionText(item)}`.toLowerCase();
  return /\b(deck-content|deck content|deck ingestion|deck-ingestion|evidence extraction|evidence-quality|evidence quality|artifact|build|pipeline|renderer|rendering|publish|publishing|freeze|frozen|email|emailed|stage-2|stage 2|source traceability|extraction)\b/.test(text);
}

function topicAction(topic, action, scope = '') {
  return {
    topic: canonicalTopicTitle(topic || 'Recommended action'),
    scope: cleanText(scope),
    action: cleanText(action),
  };
}

function uniqueActions(actions) {
  const seen = new Set();
  const out = [];
  for (const item of actions) {
    const action = actionText(item);
    if (!action) continue;
    const key = action.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (typeof item === 'string') out.push(topicAction('Recommended action', action));
    else out.push({ ...item, action, topic: actionTopic(item) || 'Recommended action' });
  }
  return out;
}

function buildRecommendedActions(groups, statusInfo, sourceActions) {
  const actions = [];
  for (const title of ['Events Page', 'Homepage AI Messaging', 'Pathfinder CTA Labels', 'Webinar Registration Page', 'This Book Filter', 'Virtualization Campaign']) {
    const group = groups.find((g) => topicKey(g.title) === topicKey(title));
    if (group) actions.push(topicAction(title, actionForTopic(title)));
  }
  const source = sourceActions
    .map((item) => {
      if (typeof item === 'string') return topicAction('Generated recommendation', item);
      const action = firstText(item.next_step, item.nextStep, item.recommendation, item.action, item.body, item.text, item.title, item.headline);
      const topic = firstText(item.topic, item.concept_title, item.concept, item.scope, item.category, item.title);
      return topicAction(topic || 'Generated recommendation', action);
    })
    .filter((item) => item.action && !looksLabelOnly(item.action) && !isNewsletterSelfTestAction(item) && !isInternalOperationalAction(item));
  return uniqueActions([...actions, ...source])
    .filter((item) => !isNewsletterSelfTestAction(item) && !isInternalOperationalAction(item))
    .slice(0, 8);
}

function buildStage2Brief() {
  const sourcePath = path.join(publishRoot, 'newsletter', 'default.json');
  const source = readJson(sourcePath, {});
  const statusInfo = readStatusPayload();
  const sections = source.sections || {};
  const evidencePayload = evidencePackPayload();
  const evidencePacks = asArray(evidencePayload.packs || evidencePayload);
  const evidenceGroups = groupEvidencePacks(evidencePacks);

  const rawFindings = asArray(sections.top_findings).length
    ? asArray(sections.top_findings)
    : asArray(source.surfaced_findings || sections.validated_findings || source.sections?.validated_findings);

  const rawComparisons = [
    ...asArray(sections.comparison_tests),
    ...asArray(source.comparison_tests),
    ...asArray(sections.watch_items).filter(looksLikeComparison),
    ...asArray(sections.in_progress).filter(looksLikeComparison),
  ];

  const sourceFindings = uniqueByTitle(rawFindings)
    .map(toFinding)
    .filter((item) => !looksLabelOnly(item.finding_statement, item.title) && !looksLabelOnly(item.proof_point, item.title));

  const useSourceFindings = sourceFindings.length >= 2 && deckContentCount(statusInfo) > 0;
  const surfacedFindings = useSourceFindings
    ? sourceFindings.slice(0, 4)
    : buildNarrativeFindings(evidenceGroups, statusInfo);

  const comparisonTests = buildComparisons(evidenceGroups, rawComparisons);
  const unresolvedQuestions = buildUnresolvedQuestions(evidenceGroups, statusInfo);
  const sourceActions = asArray(source.next_actions || sections.next_actions);
  const nextActions = buildRecommendedActions(evidenceGroups, statusInfo, sourceActions);
  const deckCount = deckContentCount(statusInfo);

  const latestDate = counts.latest_week_date || statusInfo?._meta?.latest_week_date || 'the latest week';
  const executiveSummary = `The current 30-day research cycle is updated through ${latestDate}. The strongest movement is around Events, Homepage AI Messaging, and Pathfinder CTA Labels, where the next step is to narrow criteria and choose a direction. May 7 also adds Webinar Registration Page and Reader Filter work that should stay unresolved until the next round clarifies the user behavior behind each signal.`;

  const note = "Use this cycle's evidence as a decision-readiness view. The actions identify what each research track needs to prove before it becomes a stronger recommendation.";

  return {
    title: 'Everpure monthly research roundup (30d)',
    generated_at: generatedAt,
    window: '30d',
    audience: 'exec',
    tone: 'strategic',
    issue: { number: issueNumber, label: issueLabel, date: issueDate },
    summary: { ...counts, evidence_pack_count: evidenceGroups.length, deck_content_count: deckCount },
    executive_summary: executiveSummary,
    surfaced_findings: surfacedFindings.length ? surfacedFindings : [
      toFinding({ title: 'Current 30-day research signal', finding_statement: 'The current research window contains active signals, but each one should be tied to clear user behavior before it is promoted.', next_step: 'Use the next research review to decide which signals are strong enough to become decision guidance.' })
    ],
    comparison_tests: comparisonTests,
    unresolved_questions: unresolvedQuestions,
    next_actions: nextActions.length ? nextActions : [
      'Review the refreshed 30-day evidence and promote only the strongest decision-relevant findings.',
      'Use one focused comparison round for any narrowed alternatives before choosing a direction.',
      'Keep unresolved workstreams out of the findings section until the evidence is decision-grade.'
    ],
    note,
  };
}
const brief = buildStage2Brief();

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
  for (const item of data.next_actions) {
    const topic = actionTopic(item);
    const action = actionText(item);
    out.push(topic ? `- **${topic}:** ${action}` : `- ${action}`);
  }
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
  return `<div class="confidence" style="background:${c.bg};color:${c.fg};">${escapeHtml(c.label)}</div>`;
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
.questions--two-up { grid-template-columns:1fr 1fr; }
.question { padding:36px 28px 36px 0; display:flex; flex-direction:column; gap:20px; }
.question + .question { padding-left:28px; border-left:2px solid rgba(90,99,89,0.2); }
.questions--two-up .question { border-left:none; padding-left:0; }
.questions--two-up .question:nth-child(even) { padding-left:28px; border-left:2px solid rgba(90,99,89,0.2); }
.questions--two-up .question:nth-child(n+3) { border-top:2px solid rgba(90,99,89,0.16); }
.question-num { font-size:72px; font-weight:700; color:var(--primary); opacity:0.45; line-height:1; letter-spacing:-.04em; }
.question-head { display:flex; flex-direction:column; gap:8px; }
.question-title { font-size:var(--text-label); font-weight:700; color:var(--muted-fg); letter-spacing:.07em; text-transform:uppercase; line-height:1.4; }
.question-scope { font-size:13px; font-weight:600; color:rgba(90,99,89,0.78); line-height:1.55; }
.question p { margin:0; font-size:var(--text-base); line-height:1.75; }
.actions { display:flex; flex-direction:column; gap:0; margin-top:40px; }
.action-row { display:grid; grid-template-columns:72px 1fr; gap:24px; align-items:start; padding:28px 0; border-bottom:2px solid var(--orange-100); }
.action-row:first-child { border-top:2px solid var(--orange-100); }
.action-index { font-size:40px; font-weight:700; color:var(--primary); opacity:.35; line-height:1; letter-spacing:-.03em; padding-top:4px; }
.action-content { display:flex; flex-direction:column; gap:10px; }
.action-topic { width:max-content; max-width:100%; padding:5px 8px 4px; background:rgba(213,93,29,0.10); border:1px solid var(--orange-100); border-radius:999px; font-size:10px; font-weight:700; color:var(--primary); letter-spacing:.08em; text-transform:uppercase; line-height:1.05; }
.action-scope { display:block; margin-top:-4px; font-size:13px; font-weight:600; color:var(--muted-fg); line-height:1.5; }
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
  .questions--two-up .question:nth-child(even) { padding-left:0; border-left:none; }
  .questions--two-up .question:nth-child(n+3) { border-top:none; }
}
</style>`);
  html.push('</head>');
  html.push('<body>');
  html.push('<header class="masthead">');
  html.push('<div class="wrapper">');
  html.push('<a class="back-link" href="../">Back to homepage</a>');
  html.push('<div class="meta-bar">');
  html.push('<span class="meta-left">Everpure User Research Program</span>');
  html.push(`<div class="meta-right"><span class="meta-issue">${escapeHtml(data.issue?.label || issueLabel)}</span><span style="opacity:.2">·</span><span class="meta-date">${escapeHtml(data.issue?.date || issueDate)}</span></div>`);
  html.push('</div>');
  html.push('<div class="masthead-grid">');
  html.push('<div class="title-pane">');
  html.push(`<div class="ghost">${escapeHtml(data.issue?.number || issueNumber)}</div>`);
  html.push('<div class="monthly-tag">Monthly</div>');
  html.push('<h1 class="h1">Research<br/>Roundup</h1>');
  html.push('<div class="cycle-note">30-day research cycle</div>');
  html.push('</div>');
  html.push('<div class="stats-grid">');
  const stats = [
    [String(data.surfaced_findings.length), 'Research\nFindings'],
    [String(data.comparison_tests.length), 'Comparison\nTests'],
    [String(data.unresolved_questions.length), 'Open\nQuestions'],
    [String(data.next_actions.length), 'Recommended\nActions'],
  ];
  for (const [value, label] of stats) {
    html.push(`<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`);
  }
  html.push('</div></div></div></header>');

  html.push('<section class="brief-band"><div class="wrapper brief-grid">');
  html.push('<div class="brief-sidebar"><div class="brief-index">00</div><div class="brief-title">The Roundup</div></div>');
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
  const unresolvedLayoutClass = data.unresolved_questions.length === 4 ? ' questions--two-up' : '';
  html.push(`<div class="questions${unresolvedLayoutClass}">`);
  data.unresolved_questions.forEach((item, idx) => {
    html.push(`<div class="question"><span class="question-num">${String(idx + 1).padStart(2, '0')}</span><div><div class="question-head"><div class="question-title">${escapeHtml(item.title)}</div>${item.scope ? `<div class="question-scope">${escapeHtml(item.scope)}</div>` : ''}</div><p>${escapeHtml(item.question)}</p></div></div>`);
  });
  html.push('</div></div></section>');

  html.push('<section class="section"><div class="wrapper">');
  html.push(sectionLabel('Recommended Actions'));
  html.push('<div class="actions">');
  data.next_actions.forEach((item, idx) => {
    const topic = actionTopic(item);
    const action = actionText(item);
    html.push(`<div class="action-row"><span class="action-index">${String(idx + 1).padStart(2, '0')}</span><div class="action-content">${topic ? `<span class="action-topic">${escapeHtml(topic)}</span>` : ''}<p>${escapeHtml(action)}</p></div></div>`);
  });
  html.push('</div>');
  html.push(`<p class="note">${escapeHtml(data.note)}</p>`);
  html.push('</div></section>');

  html.push('<footer class="footer"><div class="wrapper footer-inner">');
  html.push('<span>Everpure User Research Program</span>');
  html.push(`<span>Monthly Research Roundup · ${escapeHtml(data.issue?.label || issueLabel)} · ${escapeHtml(data.issue?.date || issueDate)}</span>`);
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
